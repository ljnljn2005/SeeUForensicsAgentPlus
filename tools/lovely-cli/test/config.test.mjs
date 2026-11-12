import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LOVELY_TOOL_SPECS, lovelyConfigFile, lovelyToolsView, saveLovelyToolPaths } from '../../lovely-tools.mjs';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'seeu-lovely-tools-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { SEEU_LOVELY_CONFIG: join(root, '配置 目录', 'lovely-cli.json') };
  const exe = (name) => {
    const dir = join(root, '程序');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, 'binary placeholder');
    return path;
  };
  return { root, env, exe };
}

test('未配置时两款工具都是 unconfigured，且配置路径来自 SEEU_LOVELY_CONFIG', (t) => {
  const { env } = setup(t);
  const view = lovelyToolsView(env);
  assert.equal(view.configFile, lovelyConfigFile(env));
  assert.equal(view.error, undefined);
  assert.equal(view.tools.length, 3);
  // lovelymem/lovelyspark 必须未配置；lovelycarve 有内置默认路径（D:/Programs/LovelyCarve/lovelycarve-cli.exe）。
  for (const tool of view.tools.filter((item) => item.id !== 'lovelycarve')) {
    assert.equal(tool.found, false);
    assert.equal(tool.source, 'unset');
    assert.equal(tool.configured, false);
    assert.equal(tool.path, '');
  }
  const carve = view.tools.find((item) => item.id === 'lovelycarve');
  assert.equal(carve.configured, false);
  assert.equal(carve.source, 'default');
  assert.match(String(carve.defaultPath), /lovelycarve-cli\.exe$/);
  assert.deepEqual(LOVELY_TOOL_SPECS.map((s) => s.id), ['lovelymem', 'lovelyspark', 'lovelycarve']);
});

test('保存写盘后重新读取是 config 来源；可以只保存一个工具', (t) => {
  const { env, exe } = setup(t);
  const mem = exe('lovelymem.v3.exe');
  const saved = saveLovelyToolPaths({ lovelymem: mem }, env);
  assert.equal(saved.ok, true);
  assert.equal(saved.saved[0].action, 'set');
  const written = JSON.parse(readFileSync(lovelyConfigFile(env), 'utf8'));
  assert.deepEqual(written, { lovelymem: mem });
  const view = lovelyToolsView(env);
  assert.equal(view.tools[0].path, mem);
  assert.equal(view.tools[0].source, 'config');
  assert.equal(view.tools[0].found, true);
  assert.equal(view.tools[1].configured, false);
});

test('清除单项会从配置里删除，不影响另一项', (t) => {
  const { env, exe } = setup(t);
  const mem = exe('lovelymem.v3.exe');
  const spark = exe('lovelyspark.exe');
  saveLovelyToolPaths({ lovelymem: mem, lovelyspark: spark }, env);
  const cleared = saveLovelyToolPaths({ lovelymem: '' }, env);
  assert.equal(cleared.saved[0].action, 'cleared');
  assert.deepEqual(JSON.parse(readFileSync(lovelyConfigFile(env), 'utf8')), { lovelyspark: spark });
});

test('校验绝对路径、文件存在与 .exe 后缀，失败时不动原配置', (t) => {
  const { env, exe } = setup(t);
  const mem = exe('lovelymem.v3.exe');
  saveLovelyToolPaths({ lovelymem: mem }, env);
  assert.throws(() => saveLovelyToolPaths({ lovelyspark: 'relative.exe' }, env), /绝对路径/);
  assert.throws(() => saveLovelyToolPaths({ lovelyspark: join(env.SEEU_LOVELY_CONFIG, 'nope.exe') }, env), /不存在/);
  const txt = join(dirname(lovelyConfigFile(env)), 'note.txt');
  writeFileSync(txt, 'x');
  assert.throws(() => saveLovelyToolPaths({ lovelyspark: txt }, env), /\.exe/);
  assert.deepEqual(JSON.parse(readFileSync(lovelyConfigFile(env), 'utf8')), { lovelymem: mem });
});

test('环境变量优先于配置文件（调试用）', (t) => {
  const { env, exe } = setup(t);
  const mem = exe('lovelymem.v3.exe');
  const other = exe('other-lovelymem.v3.exe');
  saveLovelyToolPaths({ lovelymem: mem }, env);
  const view = lovelyToolsView({ ...env, SEEU_LOVELYMEM_EXE: other });
  assert.equal(view.tools[0].path, other);
  assert.equal(view.tools[0].source, 'env');
});

test('坏 JSON 在视图里报错而不是抛出', (t) => {
  const { env } = setup(t);
  mkdirSync(join(env.SEEU_LOVELY_CONFIG, '..'), { recursive: true });
  writeFileSync(env.SEEU_LOVELY_CONFIG, '{ not json');
  const view = lovelyToolsView(env);
  assert.match(view.error, /JSON/);
  assert.equal(view.tools[0].found, false);
});
