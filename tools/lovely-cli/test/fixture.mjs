import { spawn } from 'node:child_process';

const scene = process.env.SEEU_TEST_SCENE;
const args = process.argv.slice(2);
if (scene === 'large') {
  process.stdout.write(JSON.stringify({ ok: true, data: '中'.repeat(900000) }));
  process.stderr.write('诊断'.repeat(10000));
} else if (scene === 'timeout' || scene === 'cancel') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  console.log(JSON.stringify({ childPid: child.pid }));
  setInterval(() => {}, 1000);
} else if (scene === 'partial') {
  console.log(JSON.stringify({ status: 'partial', result: { success: true }, run_dir: 'D:\\案件 空格\\运行结果' }));
  process.exitCode = 5;
} else if (scene === 'false') {
  console.log(JSON.stringify({ ok: false, error: { message: 'license invalid' } }));
} else if (scene === 'inner-false') {
  console.log(JSON.stringify({ ok: true, data: { tool: 'module_summary', ok: false, error: 'query failed' } }));
} else if (scene === 'failed') {
  console.error('license invalid');
  process.exitCode = 3;
} else if (scene === 'large-failure') {
  console.log(JSON.stringify({ ok: false, data: 'x'.repeat(1100000) }));
} else {
  console.log(JSON.stringify({ ok: true, args, data: { db_path: 'D:\\案件 空格\\流量.db' } }));
}
