import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, resolveExecutable, runCli } from '../cli.mjs';

const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
function setup(t, scene = 'echo') {
  const root = mkdtempSync(join(tmpdir(), 'seeu-lovely-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, SEEU_LOVELY_CONFIG: join(root, 'config.json'),
    SEEU_LOVELYMEM_EXE: process.execPath, SEEU_LOVELYSPARK_EXE: process.execPath,
    SEEU_WORKSPACE: join(root, '中文 工作区'), SEEU_TEST_SCENE: scene };
  const spawnProcess = (_exe, args, options) => spawn(process.execPath, [fixture, ...args], options);
  return { env, spawnProcess, root };
}

test('原生 argv 保留中文、空格、JSON、shell 元字符；Mem 自动补 --cli/独立产物路径', async (t) => {
  const options = setup(t);
  const args = ['run', '--image', 'D:\\案件 空格\\镜像.mem', '--plugin', 'pslist', '--', '--filter', '$(whoami); & test', '{"q":"中文"}'];
  const result = await runCli('lovelymem', args, options);
  assert.equal(result.ok, true);
  const native = JSON.parse(readFileSync(result.stdout.path, 'utf8')).args;
  assert.equal(native[0], '--cli');
  assert.equal(native[native.indexOf('--output-dir') + 1], join(result.runDir, 'artifacts'));
  assert.ok(native.indexOf('--output-dir') < native.indexOf('--'));
  assert.deepEqual(native.slice(native.indexOf('--')), args.slice(args.indexOf('--')));
  assert.ok(native.includes('D:\\案件 空格\\镜像.mem'));
  assert.equal(args.includes('--output-dir'), false);
  assert.equal(JSON.parse(readFileSync(join(result.runDir, 'request.json'), 'utf8')).executable, process.execPath);
});

test('Spark 不加 --cli；返回 db_path；调用记录可回查', async (t) => {
  const result = await runCli('lovelyspark', ['tools', 'schema', 'module_summary'], setup(t));
  const json = JSON.parse(result.stdout.preview);
  assert.deepEqual(json.args, ['tools', 'schema', 'module_summary']);
  assert.equal(result.db_path, 'D:\\案件 空格\\流量.db');
  assert.deepEqual(JSON.parse(readFileSync(join(result.runDir, 'result.json'), 'utf8')), result);
});

test('显式 output-dir 不改写，每次调用目录互不覆盖', async (t) => {
  const options = setup(t);
  const args = ['run', '--output-dir=D:/explicit'];
  const first = await runCli('lovelymem', args, options);
  const second = await runCli('lovelymem', args, options);
  assert.notEqual(first.runDir, second.runDir);
  assert.deepEqual(JSON.parse(first.stdout.preview).args, ['--cli', ...args]);
});

test('Spark 原生全局 timeout/pretty 选项可透传，不和调用器选项混淆', async (t) => {
  const args = ['--timeout', '1200', '--pretty', 'analyze', 'D:/case.pcap'];
  const result = await runCli('lovelyspark', args, setup(t));
  assert.deepEqual(JSON.parse(result.stdout.preview).args, args);
});

test('多 MB 输出完整落盘，模型预览有界且标记截断', async (t) => {
  const result = await runCli('lovelyspark', ['tools', 'list'], { ...setup(t, 'large'), maxChars: 200 });
  assert.equal(result.ok, true);
  assert.equal(result.stdout.truncated, true);
  assert.equal(result.stderr.truncated, true);
  assert.ok(result.stdout.preview.length <= 203);
  assert.ok(result.stderr.preview.length <= 203);
  assert.ok(result.stdout.bytes > 2_000_000);
  assert.equal(JSON.parse(readFileSync(result.stdout.path, 'utf8')).data.length, 900000);
  assert.ok(JSON.stringify(result).length < 2500);
});

test('exit 0 的失败信封与大失败结果都不伪装成功', async (t) => {
  for (const scene of ['false', 'inner-false', 'large-failure', 'failed']) {
    const result = await runCli('lovelyspark', ['analyze', 'D:/fixture.pcap'], setup(t, scene));
    assert.equal(result.ok, false, scene);
    assert.equal(result.status, 'failed');
  }
});

test('Mem partial + exit 5 保留可用结果与 run_dir；Spark exit 5 仍失败', async (t) => {
  const options = setup(t, 'partial');
  const mem = await runCli('lovelymem', ['doctor'], options);
  assert.equal(mem.ok, true);
  assert.equal(mem.status, 'partial');
  assert.equal(mem.run_dir, 'D:\\案件 空格\\运行结果');
  assert.notEqual(mem.run_dir, mem.runDir);
  assert.equal((await runCli('lovelyspark', ['tools', 'list'], options)).ok, false);
});

test('超时终止子进程树并保存已有输出', { timeout: 15000 }, async (t) => {
  const result = await runCli('lovelyspark', ['analyze', 'D:/fixture.pcap'], { ...setup(t, 'timeout'), timeout: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'timeout');
  assert.ok(result.elapsedMs < 10000);
  const { childPid } = JSON.parse(result.stdout.preview);
  assert.throws(() => process.kill(childPid, 0));
});

test('取消终止子进程树并清除信号监听器', { timeout: 15000 }, async (t) => {
  const count = process.listenerCount('SIGTERM');
  const options = setup(t, 'cancel');
  const cancel = setTimeout(() => process.emit('SIGTERM'), 700);
  t.after(() => clearTimeout(cancel));
  const result = await runCli('lovelyspark', ['analyze', 'D:/fixture.pcap'], options);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.ok, false);
  assert.equal(process.listenerCount('SIGTERM'), count);
  const { childPid } = JSON.parse(result.stdout.preview);
  assert.throws(() => process.kill(childPid, 0));
});

test('缺失程序和坏配置明确报错，不退回其它版本', async (t) => {
  const { env, root } = setup(t);
  env.SEEU_LOVELYMEM_EXE = join(root, 'missing.exe');
  assert.equal(resolveExecutable('lovelymem', env).found, false);
  await assert.rejects(runCli('lovelymem', ['doctor'], { env }), /配置的 lovelymem 路径不存在/);
  writeFileSync(env.SEEU_LOVELY_CONFIG, 'not json');
  assert.throws(() => resolveExecutable('lovelymem', env));
});

test('未配置时提示去设置窗口指定，不做自动发现', async (t) => {
  const { env } = setup(t);
  delete env.SEEU_LOVELYMEM_EXE;
  delete env.SEEU_LOVELYSPARK_EXE;
  const state = resolveExecutable('lovelymem', env);
  assert.equal(state.found, false);
  assert.equal(state.source, 'unconfigured');
  assert.equal(state.configured, false);
  await assert.rejects(runCli('lovelymem', ['doctor'], { env }), /未配置 lovelymem 路径.*本机取证工具路径/);
  const status = await main(['status'], env);
  assert.equal(status.lovelymem.found, false);
  assert.match(status.note, /不做自动发现/);
});

test('配置按调用重读，环境变量优先；支持 BOM，status 不启动进程', async (t) => {
  const { env, root } = setup(t);
  const other = join(root, 'other.exe');
  writeFileSync(other, 'placeholder');
  delete env.SEEU_LOVELYSPARK_EXE;
  const configured = await main(['configure', 'lovelyspark', other], env);
  assert.equal(configured.source, 'config');
  assert.equal(resolveExecutable('lovelyspark', env).path, other);
  writeFileSync(env.SEEU_LOVELY_CONFIG, '\uFEFF' + JSON.stringify({ lovelyspark: process.execPath }));
  assert.equal((await main(['status'], env)).lovelyspark.path, process.execPath);
  env.SEEU_LOVELYSPARK_EXE = other;
  assert.equal(resolveExecutable('lovelyspark', env).source, 'env');
  assert.equal(existsSync(join(env.SEEU_WORKSPACE, 'lovely-runs')), false);
});

test('拒绝错误参数、超预算预览、后台 MCP 模式，且不执行程序', async (t) => {
  const options = setup(t);
  await assert.rejects(main(['lovelyspark', 'tools', 'list'], options.env), /分隔符/);
  await assert.rejects(main(['lovelyspark', '--typo', '3', '--', 'tools'], options.env), /仅支持/);
  await assert.rejects(runCli('lovelyspark', ['mcp'], options), /不支持/);
  await assert.rejects(runCli('lovelymem', ['doctor'], { ...options, maxChars: 999999 }), /max-chars/);
  await assert.rejects(runCli('lovelymem', ['doctor'], { ...options, timeout: 0 }), /timeout/);
  await assert.rejects(runCli('toString', [], options), /工具只能/);
  assert.equal(existsSync(join(options.env.SEEU_WORKSPACE, 'lovely-runs')), false);
});

test('spawn 失败保留文件与失败信息', async (t) => {
  const options = setup(t);
  options.spawnProcess = (_exe, args, spawnOptions) => spawn(join(options.root, 'missing.exe'), args, spawnOptions);
  const result = await runCli('lovelyspark', ['--version'], options);
  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
  assert.ok(existsSync(result.stdout.path));
});
