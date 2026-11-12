/**
 * 随包 dsh 插件（预打包）验收。
 *
 * 验证：
 *   1. 外壳启动时把 `<DSH_HOME>/profiles/web/package.json` 的 bundles 补齐为
 *      `@deepseek-ai/dsh-base / @deepseek-ai/dsh-web-app / billion-context /
 *      dsh-context / dsh-better-sidebar / dsh-gitbash-shell`；
 *   2. 页面里真的出现了插件提供的界面（「上下文洞察」「插件」），说明 client
 *      侧插件也被 web app 正常加载；
 *   3. 外壳日志里有 `dsh plugins:` 一行且没有「缺少」。
 *
 * 用独立 userData / DSH_HOME + SEEU_DEV_MULTI=1（不碰用户在用的实例）。
 * 用法：node scripts/e2e/plugins-check.mjs [--exe <打包后的 exe>]
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const argExe = process.argv.indexOf('--exe')
const EXE = argExe > -1 ? resolve(process.argv[argExe + 1]) : join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const EXE_ARGS = argExe > -1 ? [] : [REPO]
const CDP_PORT = Number(process.env.SEEU_PLUGINS_E2E_PORT ?? 9357)
const MOCK_PORT = CDP_PORT + 1
const UD = join(REPO, '.dev', 'plugins-ud')
const HOME = join(REPO, '.dev', 'plugins-home')
const REQUIRED = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'billion-context',
  'dsh-context',
  'dsh-better-sidebar',
  'dsh-gitbash-shell',
]
/** 必须复制进 profile/node_modules 的插件包（@deepseek-ai/* 由安装目录提供，不复制）。 */
const REQUIRED_PACKAGES = ['billion-context', 'dsh-context', 'dsh-better-sidebar', 'dsh-gitbash-shell']

const report = { ok: false, errors: [] }

async function targets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  return JSON.parse(await res.text())
}

async function waitForPage(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const page = (await targets()).find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(String(t.url)))
      if (page !== undefined) return page
    } catch {
      // CDP 还没起来
    }
    await sleep(500)
  }
  return undefined
}

function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { done, fail } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) fail(new Error(msg.error.message))
      else done(msg.result)
    }
  })
  const ready = new Promise((done, fail) => {
    socket.addEventListener('open', () => done())
    socket.addEventListener('error', () => fail(new Error('CDP websocket 连接失败')))
  })
  return {
    ready,
    send(method, params = {}) {
      const id = nextId++
      return new Promise((done, fail) => {
        pending.set(id, { done, fail })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      try { socket.close() } catch { /* ignore */ }
    },
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 抛异常')
  return result.result?.value
}

let child
let mockGateway
try {
  rmSync(UD, { recursive: true, force: true })
  mkdirSync(UD, { recursive: true })
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })

  mockGateway = http.createServer((req, res) => {
    if (String(req.url ?? '').endsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-14b', name: 'Mock 14B' }] }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{}')
  })
  await new Promise((done) => mockGateway.listen(MOCK_PORT, '127.0.0.1', done))

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.SEEU_LOCAL_MODEL_JSON = JSON.stringify({
    enabled: true,
    baseURL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    apiKey: 'local',
    models: [{ id: 'mock-14b', name: 'Mock 14B' }],
    contextWindow: 131072,
    maxTokens: 8192,
    useAsDefault: true,
    litePreset: true,
  })
  env.SEEU_DEV_MULTI = '1'
  env.SEEU_DSH_HOME = HOME
  env.SEEU_USER_DATA = UD
  env.SEEU_INDEX_SEARCH_DIRS = join(REPO, '.dev', 'empty-indexes')

  child = spawn(EXE, [...EXE_ARGS, `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`], {
    cwd: REPO,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const page = await waitForPage()
  if (page === undefined) throw new Error('主页面没出现（CDP page 超时）')
  report.pageUrl = page.url.replace(/\?.*$/, '')

  // 1. profile bundles：外壳在 spawn host 之前写入，这里轮询等它落盘
  const manifestPath = join(HOME, 'profiles', 'web', 'package.json')
  let bundles = []
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      bundles = JSON.parse(readFileSync(manifestPath, 'utf8')).dsh?.profile?.bundles ?? []
      if (REQUIRED.every((name) => bundles.includes(name))) break
    } catch {
      // 还没写
    }
    await sleep(300)
  }
  report.bundles = bundles
  report.bundlesOk = REQUIRED.every((name) => bundles.includes(name))

  // 1b. 插件包必须真复制进 <profile>/node_modules：只写 bundles 不够，
  //     dsh 用 profile 目录作 baseUrl import 插件行，缺包会 ERR_MODULE_NOT_FOUND、插件不激活。
  const profileNodeModules = join(HOME, 'profiles', 'web', 'node_modules')
  let packagesOk = false
  const pkgDeadline = Date.now() + 120000
  while (Date.now() < pkgDeadline) {
    packagesOk = REQUIRED_PACKAGES.every((name) => existsSync(join(profileNodeModules, name, 'package.json')))
    if (packagesOk) break
    await sleep(500)
  }
  report.profileNodeModules = profileNodeModules
  report.packagesOk = packagesOk

  // 2. client 侧插件真的加载了：插件导航/上下文面板文案
  const client = cdp(page.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  const ui = await evaluate(client, `(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 40000) {
      const text = document.body ? document.body.innerText : ''
      const hasContext = /上下文洞察/.test(text)
      const hasPlugins = /插件/.test(text)
      if (hasContext && hasPlugins) return { text: text.slice(0, 400), hasContext, hasPlugins }
      await new Promise((r) => setTimeout(r, 400))
    }
    const text = document.body ? document.body.innerText : ''
    return { text: text.slice(0, 400), hasContext: /上下文洞察/.test(text), hasPlugins: /插件/.test(text) }
  })()`)
  report.ui = ui
  report.clientOk = ui !== null && ui.hasContext === true && ui.hasPlugins === true

  // 3. 外壳日志：dsh plugins 行不应报「缺少」
  const shellLog = join(UD, 'logs', 'shell.log')
  let pluginLine = ''
  const logDeadline = Date.now() + 30000
  while (Date.now() < logDeadline) {
    try {
      pluginLine = readFileSync(shellLog, 'utf8').split(/\r?\n/).filter((line) => line.includes('dsh plugins:')).pop() ?? ''
      if (pluginLine !== '') break
    } catch {
      // 日志还没写
    }
    await sleep(300)
  }
  report.pluginLine = pluginLine
  report.logOk = pluginLine !== '' && !pluginLine.includes('缺少（必需）') && !pluginLine.includes('错误')
  report.packagesLine = readFileSync(shellLog, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('插件包'))
    .pop() ?? ''

  // 3b. dsh 子进程日志里不能有「插件导入失败 / 未激活」——这是 v0.3.2 的真实故障形态。
  const hostLogDir = join(UD, 'logs')
  let hostLog = ''
  const hostDeadline = Date.now() + 30000
  while (Date.now() < hostDeadline) {
    try {
      const files = readdirSync(hostLogDir).filter((file) => /^dsh-host-.*\.log$/.test(file))
      hostLog = files.map((file) => readFileSync(join(hostLogDir, file), 'utf8')).join('\n')
      if (/did not activate|failed to import|ERR_MODULE_NOT_FOUND/.test(hostLog)) break
      if (hostLog.includes('host ready')) break
    } catch {
      // 还没写
    }
    await sleep(500)
  }
  report.activationFailures = hostLog
    .split(/\r?\n/)
    .filter((line) => /did not activate|failed to import|ERR_MODULE_NOT_FOUND/.test(line))
    .slice(0, 5)
  report.activationOk = report.activationFailures.length === 0

  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(join(REPO, '.probe', 'shots'), { recursive: true })
    writeFileSync(join(REPO, '.probe', 'shots', 'plugins.png'), Buffer.from(shot.data, 'base64'))
    report.screenshot = '.probe/shots/plugins.png'
  } catch (error) {
    report.screenshotError = String(error)
  }

  client.close()
  report.ok = report.bundlesOk === true && report.packagesOk === true && report.clientOk === true
    && report.logOk === true && report.activationOk === true
  if (!report.ok) throw new Error('插件验收未通过（见 bundles/packages/client/log/activation）')
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error)
  report.ok = false
} finally {
  try { child?.kill() } catch { /* ignore */ }
  if (mockGateway !== undefined) await new Promise((done) => mockGateway.close(done))
  await sleep(800)
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok === true ? 0 : 1)
}

