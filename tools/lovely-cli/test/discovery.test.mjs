import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { discoverExecutable, searchDirectories } from '../discovery.mjs';
import { main, resolveExecutable } from '../cli.mjs';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'seeu-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cache = join(root, 'config', 'discovery.json');
  const file = relative => {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'Discovery must never execute this file.');
    return path;
  };
  return { root, cache, file };
}
const noLocations = () => ({ files: [], roots: [], drives: [] });
const memNames = ['lovelymem.v3.exe'];
const sparkNames = ['lovelyspark.exe'];

test('PATH 支持引号、中文和空格；自动发现跳过旧 Lite/Luxe GUI', t => {
  const { root, cache, file } = setup(t);
  file('旧版/lovelymem.exe');
  file('旧版/lovelymemluxe.exe');
  const expected = file('新电脑 软件/lovelymem.v3.exe');
  const env = { Path: [join(root, '旧版'), `"${dirname(expected)}"`].join(delimiter) };
  assert.equal(discoverExecutable('lovelymem', memNames, env, cache, noLocations).path, expected);
  assert.equal(discoverExecutable('lovelymem', memNames, { Path: join(root, '旧版') }, cache, noLocations).found, false);
});

test('其它盘的便携版嵌套目录可自动发现，无用户固定路径', t => {
  const { root, cache, file } = setup(t);
  const expected = file('另一块磁盘/Tools/Forensics/LovelyMem-3.1.11/bin/lovelymem.v3.exe');
  const locations = () => ({ files: [], roots: [], drives: [join(root, '另一块磁盘')] });
  const result = discoverExecutable('lovelymem', memNames, {}, cache, locations);
  assert.equal(result.path, expected);
  assert.equal(result.source, 'search');
  assert.equal(existsSync(cache), true);
});

test('安装记录和快捷方式定位自定义目录；旧 GUI 快捷方式不选用', t => {
  const { cache, file } = setup(t);
  const old = file('old/lovelymemluxe.exe');
  const expected = file('自定义安装/版本号/lovelymem.v3.exe');
  for (const source of ['registry', 'shortcut']) {
    const locations = () => ({ files: [{ path: old, source }, { path: expected, source }], roots: [], drives: [] });
    assert.equal(discoverExecutable('lovelymem', memNames, {}, `${cache}.${source}`, locations).source, source);
  }
});

test('成功路径缓存避免重复查找，程序搬家后缓存失效并重新发现', t => {
  const { root, cache, file } = setup(t);
  const original = file('原目录/lovelyspark.exe');
  const first = () => ({ files: [{ path: original, source: 'shortcut' }] });
  assert.equal(discoverExecutable('lovelyspark', sparkNames, {}, cache, first).path, original);
  const cached = discoverExecutable('lovelyspark', sparkNames, {}, cache, () => { throw Error('不应再次搜索'); });
  assert.equal(cached.source, 'cache');
  const moved = join(root, '搬家后', 'lovelyspark.exe');
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(original, moved);
  assert.equal(existsSync(original), false);
  assert.equal(discoverExecutable('lovelyspark', sparkNames, {}, cache, () => ({ files: [{ path: moved, source: 'registry' }] })).path, moved);
});

test('复制到另一台机器的缓存不直接采用；未发现不写负缓存', t => {
  const { cache, file } = setup(t);
  assert.equal(discoverExecutable('lovelyspark', sparkNames, {}, cache, noLocations).found, false);
  assert.equal(existsSync(cache), false);
  const original = file('old/lovelyspark.exe');
  const actual = file('current/lovelyspark.exe');
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, JSON.stringify({ machine: 'different-machine', tools: { lovelyspark: original } }));
  const result = discoverExecutable('lovelyspark', sparkNames, {}, cache, () => ({ files: [{ path: actual, source: 'registry' }] }));
  assert.equal(result.path, actual);
});

test('有界目录查找不跟随链接、不进入依赖目录，并支持大小写不同的 exe', t => {
  const { root, file } = setup(t);
  file('search/node_modules/package/lovelyspark.exe');
  const outside = file('outside/lovelyspark.exe');
  symlinkSync(dirname(outside), join(root, 'search', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(searchDirectories([join(root, 'search')], sparkNames), null);
  const expected = file('search/a/b/LOVELYSPARK.EXE');
  assert.equal(searchDirectories([join(root, 'search')], sparkNames, { maxDepth: 1 }), null);
  assert.equal(searchDirectories([join(root, 'search')], sparkNames, { maxDirs: 1 }), null);
  assert.equal(searchDirectories([join(root, 'search')], sparkNames), expected);
});

test('旧电脑配置路径失效时自动发现并报告；显式环境变量错误仍明确失败', t => {
  const { root, file } = setup(t);
  const expected = file('Programs/LovelySpark/lovelyspark.exe');
  const env = { SEEU_LOVELY_CONFIG: join(root, 'config.json'), ProgramFiles: join(root, 'Programs') };
  const stale = join(root, 'old-PC', 'lovelyspark.exe');
  writeFileSync(env.SEEU_LOVELY_CONFIG, JSON.stringify({ lovelyspark: stale }));
  const found = resolveExecutable('lovelyspark', env);
  assert.equal(found.path, expected);
  assert.equal(found.staleConfigPath, stale);
  env.SEEU_LOVELYSPARK_EXE = stale;
  assert.equal(resolveExecutable('lovelyspark', env).found, false);
});

test('configure auto 恢复自动发现，保留另一工具设置，不产生分析作业', async t => {
  const { root, file } = setup(t);
  const expected = file('Programs/LovelySpark/lovelyspark.exe');
  const configured = file('manual/lovelyspark.exe');
  const env = { SEEU_LOVELY_CONFIG: join(root, 'config.json'), ProgramFiles: join(root, 'Programs'), SEEU_WORKSPACE: root };
  writeFileSync(env.SEEU_LOVELY_CONFIG, JSON.stringify({ lovelyspark: configured, lovelymem: process.execPath }));
  assert.equal(resolveExecutable('lovelyspark', env).path, configured);
  const result = await main(['configure', 'lovelyspark', 'auto'], env);
  assert.equal(result.path, expected);
  assert.deepEqual(JSON.parse(readFileSync(env.SEEU_LOVELY_CONFIG, 'utf8')), { lovelymem: process.execPath });
  assert.equal(existsSync(join(root, 'lovely-runs')), false);
});
