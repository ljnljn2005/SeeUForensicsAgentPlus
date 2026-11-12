import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
for (const packaged of [false, true]) {
  test(`${packaged ? 'asar 打包' : '开发'}模式：host → dsh 环境过滤 → shell → CLI，配置位置保持隔离`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'seeu-lovely-host-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const appRoot = packaged ? join(root, 'app.asar') : repo;
    const script = packaged ? join(`${appRoot}.unpacked`, 'tools/lovely-cli/cli.mjs') : join(repo, 'tools/lovely-cli/cli.mjs');
    if (packaged) {
      mkdirSync(dirname(script), { recursive: true });
      copyFileSync(join(repo, 'tools/lovely-cli/cli.mjs'), script);
    }
    const hostModule = join(root, 'host.mjs');
    await build({ entryPoints: [join(repo, 'src/host.ts')], outfile: hostModule, bundle: true, platform: 'node', format: 'esm',
      plugins: [{ name: 'electron-test-paths', setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
        b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const app = {getAppPath:()=>${JSON.stringify(appRoot)},getPath:()=>${JSON.stringify(root)}}; export const net = {fetch: globalThis.fetch};` }));
      } }],
    });
    const report = join(root, 'report.json');
    const fakeHost = join(root, 'fake-dsh.mjs');
    writeFileSync(fakeHost, `
      import {scrubbedParentEnv} from ${JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-subprocess'))};
      import {spawnSync} from 'node:child_process';
      import {writeFileSync} from 'node:fs';
      const env = scrubbedParentEnv();
      const result = spawnSync(env.SEEU_CLI_NODE, [env.SEEU_LOVELY_CLI, 'status'], {env, encoding:'utf8', windowsHide:true});
      writeFileSync(${JSON.stringify(report)}, JSON.stringify({shellHome:env.DSH_HOME ?? null, script:env.SEEU_LOVELY_CLI, code:result.status, stdout:result.stdout}));
      console.log('dsh web: http://127.0.0.1:12345/');
      setInterval(()=>{},1000);
    `);
    const { DshHost } = await import(pathToFileURL(hostModule).href);
    const homeDir = join(root, '独立配置');
    const host = new DshHost({ nodeBinary: process.execPath, runtimeEntry: fakeHost, homeDir,
      workspace: join(root, '工作区'), logFile: join(root, 'host.log'),
      env: { SEEU_LOVELYMEM_EXE: process.execPath, SEEU_LOVELYSPARK_EXE: process.execPath } });
    try {
      await host.start();
      const result = JSON.parse(readFileSync(report, 'utf8'));
      assert.equal(result.code, 0, result.stdout);
      assert.equal(result.shellHome, null);
      assert.equal(resolve(result.script), resolve(script));
      assert.equal(JSON.parse(result.stdout).config, join(homeDir, 'lovely-cli.json'));
    } finally { await host.stop(); }
  });
}
