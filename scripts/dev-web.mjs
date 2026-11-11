#!/usr/bin/env node
// 开发态预览：不打包 Electron，直接用官方 dsh web 起一份带取证插件/技能的会话服务，浏览器打开验收。
//   node scripts/dev-web.mjs [--port 0] [--workspace <案件目录>]
// 与桌面版的差异只在外壳（窗口/托盘/单实例），插件、overlay、技能、索引 API 完全一致。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};

const dshEntry = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
if (!existsSync(dshEntry)) {
  console.error(`[dev-web] 找不到 dsh 运行时：${dshEntry}\n先执行 npm install`);
  process.exit(1);
}
const overlay = join(root, 'resources/forensics/cordis.patch.yml');
const devHome = resolve(process.env.SEEU_DEV_HOME ?? join(root, '.dev/dsh-home'));
const defaultWorkspace = join(process.env.USERPROFILE ?? process.cwd(), 'Documents', 'SeeUForensicsWorkspace');
const workspace = resolve(opt('workspace', process.env.SEEU_WORKSPACE ?? defaultWorkspace));
const port = Number(opt('port', 0)) || 0;

// 1) 技能落到 <DSH_HOME>/skills（dsh 默认发现根，与桌面版 src/skills.ts 同一机制）
const skillsSrc = join(root, 'resources/forensics/skills');
const skillsDst = join(devHome, 'skills');
mkdirSync(skillsDst, { recursive: true });
cpSync(skillsSrc, skillsDst, { recursive: true });
const skills = readdirSync(skillsDst).filter((n) => statSync(join(skillsDst, n)).isDirectory());

// 2) 固定端口（会话里的 $SEEU_INDEX_API 要和插件实际监听端口一致）
function pickFreePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => ok(p));
    });
  });
}

const listenPort = port || (await pickFreePort());

// 3) 上次案件目录（面板选过的库，与桌面版 index-state.json 同格式）
function readIndexStateDirs(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return (j.dirs ?? []).filter((d) => typeof d === 'string' && d.trim() !== '');
  } catch {
    return [];
  }
}
const stateFile = join(devHome, 'index-state.json');
const searchDirs = [...new Set([...readIndexStateDirs(stateFile), workspace, join(devHome, 'indexes')])];

const env = {
  ...process.env,
  DSH_HOME: devHome,
  SEEU_FORENSICS_DESKTOP: '1',
  DSH_CLIENT_VERSION: pkg.version,
  NO_COLOR: '1',
  SEEU_WORKSPACE: workspace,
  SEEU_SKILLS_DIR: skillsDst,
  SEEU_INDEX_API: `http://127.0.0.1:${listenPort}/seeu-index`,
  SEEU_INDEX_SEARCH_DIRS: searchDirs.join(';'),
  SEEU_INDEX_STATE_FILE: stateFile,
  SEEU_CROSS_DB: join(workspace, 'indexes', 'crosscase.db'),
};
delete env.ELECTRON_RUN_AS_NODE;

mkdirSync(workspace, { recursive: true });
const argv = [dshEntry, '--patch', overlay, '--profile', 'web', '--host', '127.0.0.1', '--port', String(listenPort), '--no-open'];
console.log('[dev-web] 工作目录：' + workspace);
console.log('[dev-web] DSH_HOME：' + devHome);
console.log('[dev-web] 技能：' + skills.join(', '));
console.log('[dev-web] 索引 API：' + env.SEEU_INDEX_API);
console.log('[dev-web] 启动：node ' + argv.slice(1).join(' '));

const child = spawn(process.execPath, argv, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const logFile = join(devHome, 'dev-web.log');
mkdirSync(devHome, { recursive: true });
writeFileSync(logFile, '');

let url = null;
child.stdout.setEncoding('utf8');
child.stdout.on('data', (buf) => {
  process.stdout.write(buf);
  const m = buffer_match(buf);
  if (m && !url) {
    url = m;
    console.log('\n[dev-web] 打开这个地址验收：' + url + '\n');
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (buf) => {
  process.stderr.write(buf);
  const m = buffer_match(buf);
  if (m && !url) {
    url = m;
    console.log('\n[dev-web] 打开这个地址验收：' + url + '\n');
  }
});

function buffer_match(buf) {
  const m = String(buf).match(/dsh web:\s+(https?:\/\/\S+)/);
  return m ? m[1] : null;
}

child.on('exit', (code, signal) => {
  console.log(`[dev-web] dsh 退出 code=${code} signal=${signal ?? ''}`);
  process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { child.kill('SIGTERM'); } catch { /* 忽略 */ }
  });
}
