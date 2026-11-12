#!/usr/bin/env node
// 共用 CLI 薄层：原生 argv、磁盘输出、有界预览。不加载第三方依赖或工具目录。
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

// 只做手动配置（设置窗口写 lovely-cli.json），不做 PATH/注册表/全盘自动发现：
// 自动发现会误命中旧版 Lite/Luxe GUI，在负载高时还会拖慢第一次调用。
function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

const TOOLS = {
  lovelymem: { env: 'SEEU_LOVELYMEM_EXE', names: ['lovelymem.v3.exe'], prefix: ['--cli'], timeout: 1800,
    commands: ['help', 'version', 'doctor', 'plugins', 'describe', 'run', 'native', 'artifacts', 'sql', 'query', 'read', '--help', '--version'] },
  lovelyspark: { env: 'SEEU_LOVELYSPARK_EXE', names: ['lovelyspark.exe'], prefix: [], timeout: 600,
    commands: ['help', '--help', '--version', 'license', 'tools', 'analyze', 'config', 'capture', 'prepare', 'tshark', 'traffic', 'investigate', 'call'] },
};

function definition(tool) {
  if (!Object.hasOwn(TOOLS, tool)) throw new Error('工具只能是 lovelymem 或 lovelyspark');
  return TOOLS[tool];
}

function configPath(env) {
  return resolve(env.SEEU_LOVELY_CONFIG || join(env.DSH_HOME || join(homedir(), '.dsh'), 'lovely-cli.json'));
}

function readConfig(env) {
  const file = configPath(env);
  if (!existsSync(file)) return {};
  const value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`配置必须是 JSON 对象：${file}`);
  return value;
}

export function resolveExecutable(tool, env = process.env) {
  const spec = definition(tool);
  const config = readConfig(env);
  const fromEnv = env[spec.env];
  const configured = fromEnv || config[tool];
  if (!configured) return { path: null, source: 'unconfigured', found: false, configured: false, envVar: spec.env };
  if (typeof configured !== 'string' || !isAbsolute(configured)) throw new Error(`${spec.env} / ${tool} 配置必须是绝对文件路径`);
  const found = isFile(configured);
  return { path: configured, source: fromEnv ? 'env' : 'config', found, configured: true, ...(found ? {} : { staleConfigPath: configured }) };
}

function positiveInt(value, fallback, max, name) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${name} 必须是 1–${max} 的整数`);
  return n;
}

function commandIndex(tool, args) {
  let index = 0;
  if (tool === 'lovelyspark') {
    while (index < args.length) {
      if (args[index] === '--pretty' || args[index].startsWith('--timeout=')) index++;
      else if (args[index] === '--timeout') index += 2;
      else break;
    }
  }
  return index;
}

function readBytes(file, offset, length) {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    return buffer.subarray(0, readSync(fd, buffer, 0, length, offset));
  } finally { closeSync(fd); }
}

export function preview(file, maxChars) {
  const bytes = statSync(file).size;
  const head = readBytes(file, 0, Math.min(bytes, maxChars * 4)).toString('utf8');
  const truncated = bytes > maxChars * 4 || head.length > maxChars;
  if (!truncated) return { path: file, bytes, truncated: false, preview: head };
  const tailChars = Math.floor(maxChars / 4);
  const tail = readBytes(file, Math.max(0, bytes - tailChars * 4), Math.min(bytes, tailChars * 4)).toString('utf8');
  return { path: file, bytes, truncated: true, preview: head.slice(0, maxChars - tailChars) + '\n…\n' + (tailChars ? tail.slice(-tailChars) : '') };
}

function metadata(file) {
  // 小信封解析后提取关键句柄；大结果只看有限前缀，避免加载整个取证结果。
  const bytes = statSync(file).size;
  const text = readBytes(file, 0, Math.min(bytes, 1024 * 1024)).toString('utf8');
  try {
    const data = JSON.parse(text);
    const refs = {};
    for (const value of [data, data?.data, data?.result]) {
      for (const key of ['db_path', 'run_dir']) {
        if (typeof value?.[key] === 'string') refs[key] = value[key].slice(0, 4096);
      }
    }
    const partial = data?.status === 'partial';
    const failed = data?.ok === false || data?.success === false || data?.data?.ok === false || data?.data?.success === false
      || data?.result?.success === false || ['error', 'failed'].includes(data?.status);
    return { refs, partial, failed };
  } catch {
    // 大 JSON 信封仍保留显式失败状态；详细结果可按文件路径检索。
    const prefix = text.slice(0, 4096);
    return { refs: {}, partial: /^\s*\{[^{}]*"status"\s*:\s*"partial"/.test(prefix),
      failed: /^\s*\{[^{}]*"(?:ok|success)"\s*:\s*false/.test(prefix) || /^\s*\{[^{}]*"status"\s*:\s*"(?:error|failed)"/.test(prefix) };
  }
}

export async function runCli(tool, args, options = {}) {
  const env = options.env || process.env;
  const spec = definition(tool);
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('CLI 参数必须是字符串数组');
  args = args.length ? [...args] : ['--help'];
  if (!spec.commands.includes(args[commandIndex(tool, args)])) throw new Error(`不支持的 ${tool} CLI 命令；使用 --help 查看。`);
  const timeout = positiveInt(options.timeout, spec.timeout, 86400, 'timeout');
  const maxChars = positiveInt(options.maxChars, 2000, 8000, 'max-chars');
  const executable = resolveExecutable(tool, env);
  if (!executable.found) {
    const guide = '打开外壳「设置 → 本机取证工具路径」选择 exe';
    if (!executable.configured) throw new Error(`未配置 ${tool} 路径：${guide}（或设置 ${spec.env} 环境变量）。`);
    throw new Error(`配置的 ${tool} 路径不存在：${executable.path}；请重新选择（${guide}）。`);
  }
  const workspace = resolve(env.SEEU_WORKSPACE || process.cwd());
  const dir = join(workspace, 'lovely-runs', `${tool}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const separator = args.indexOf('--');
  const ownArgs = separator < 0 ? args : args.slice(0, separator);
  if (tool === 'lovelymem' && ['run', 'native'].includes(args[0]) && !ownArgs.some((arg) => arg === '--output-dir' || arg.startsWith('--output-dir='))) {
    args.splice(separator < 0 ? args.length : separator, 0, '--output-dir', join(dir, 'artifacts'));
  }
  const nativeArgs = [...spec.prefix, ...args];
  const stdoutFile = join(dir, 'stdout.txt');
  const stderrFile = join(dir, 'stderr.txt');
  const startedAt = new Date().toISOString();
  const started = Date.now();
  writeFileSync(join(dir, 'request.json'), JSON.stringify({ tool, executable: executable.path, args: nativeArgs, cwd: workspace, startedAt, timeout }, null, 2) + '\n');
  const out = openSync(stdoutFile, 'w');
  const err = openSync(stderrFile, 'w');
  let child;
  try {
    child = (options.spawnProcess || spawn)(executable.path, nativeArgs, {
      cwd: workspace, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', out, err],
    });
  } finally { closeSync(out); closeSync(err); }

  let stopped;
  let spawnError;
  const stop = (reason) => {
    if (stopped || child.exitCode !== null || child.signalCode !== null) return;
    stopped = reason;
    if (!child.pid) return;
    if (process.platform === 'win32') {
      const kill = spawn(join(env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      kill.on('error', () => child.kill('SIGKILL'));
      kill.on('exit', (code) => { if (code !== 0) child.kill('SIGKILL'); });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  };
  const cancel = () => stop('cancelled');
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const timer = setTimeout(() => stop('timeout'), timeout * 1000);
  let exitCode, signal;
  try {
    ({ exitCode, signal } = await new Promise((done) => {
      child.once('error', (error) => { spawnError = error; });
      child.once('close', (code, sig) => done({ exitCode: code, signal: sig }));
    }));
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
  const meta = metadata(stdoutFile);
  const partial = tool === 'lovelymem' && meta.partial && (exitCode === 0 || exitCode === 5);
  const ok = !stopped && !spawnError && !meta.failed && (exitCode === 0 || partial);
  const result = {
    ok, tool, status: stopped || (ok ? (partial ? 'partial' : 'completed') : 'failed'), exitCode, signal,
    elapsedMs: Date.now() - started, runDir: dir, ...meta.refs,
    ...(spawnError ? { error: `${spawnError.code || 'SPAWN'}: ${spawnError.message}`.slice(0, 800) } : {}),
    stdout: preview(stdoutFile, maxChars), stderr: preview(stderrFile, Math.min(maxChars, 500)),
  };
  writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...rest] = argv;
  if (!command || command === '--help') return { usage: ['status', 'configure <lovelymem|lovelyspark> <exe绝对路径>', 'configure <lovelymem|lovelyspark> clear', '<lovelymem|lovelyspark> [--timeout 秒] [--max-chars 字符] -- <原生CLI参数>'], config: configPath(env), note: '路径请在外壳「设置 → 本机取证工具路径」里指定；不做自动发现。' };
  if (command === 'status') return { config: configPath(env), note: '路径请在外壳「设置 → 本机取证工具路径」里指定；不做自动发现。', ...Object.fromEntries(Object.keys(TOOLS).map((tool) => [tool, resolveExecutable(tool, env)])) };
  if (command === 'configure') {
    const [tool, file] = rest;
    definition(tool);
    if (rest.length !== 2 || file === 'auto' || (file !== 'clear' && (!isAbsolute(file || '') || !isFile(file)))) {
      throw new Error('configure 需要 clear 或存在的 exe 绝对路径（不支持自动发现）');
    }
    const config = readConfig(env);
    if (file === 'clear') delete config[tool];
    else config[tool] = file;
    const target = configPath(env);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(config, null, 2) + '\n');
    return { ok: true, tool, ...resolveExecutable(tool, env), config: target };
  }
  definition(command);
  const split = rest.indexOf('--');
  if (split < 0) throw new Error('原生 CLI 参数前需要 -- 分隔符');
  const options = { env };
  for (let i = 0; i < split; i += 2) {
    const key = rest[i] === '--timeout' ? 'timeout' : rest[i] === '--max-chars' ? 'maxChars' : null;
    if (!key || i + 1 >= split) throw new Error('调用器仅支持 --timeout 秒 和 --max-chars 字符');
    options[key] = rest[i + 1];
  }
  return runCli(command, rest.slice(split + 1), options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.ok === false) process.exitCode = result.status === 'timeout' ? 124 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
