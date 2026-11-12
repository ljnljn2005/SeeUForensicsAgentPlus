/**
 * 第 5 轮前端验收（开发态，不进打包产物）：
 *   1. 欢迎页品牌块：logo + 「证据链优先 · 只读取证 · 结论可回查」+ 三步上手提示
 *   2. 本地模型状态：启动探测结果出现在托盘 tooltip / 设置窗口 #probe 行
 *
 * 用法：node scripts/e2e/welcome-check.mjs [--port 9355] [--exe <打包产物 exe>]
 * 产出：一行 JSON。
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(repo, 'node_modules', 'electron', 'dist', 'electron.exe')

const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.findIndex((a) => a === `--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const cdpPort = Number(arg('port', '9355'))
const argExe = argv.indexOf('--exe')
const exe = argExe > -1 ? resolve(argv[argExe + 1]) : electron
const exeArgs = argExe > -1 ? [] : [repo]
const mockPort = Number(arg('mock-port', '18083'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(url) {
  return new Promise((res, rej) => {
    http
      .get(url, { timeout: 2000 }, (r) => {
        let b = ''
        r.setEncoding('utf8')
        r.on('data', (c) => (b += c))
        r.on('end', () => {
          try {
            res(JSON.parse(b))
          } catch (e) {
            rej(e)
          }
        })
      })
      .on('error', rej)
      .on('timeout', () => rej(new Error('timeout')))
  })
}

function startMock() {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5-32b-instruct', object: 'model' }] }))
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
  return new Promise((res) => server.listen(mockPort, '127.0.0.1', () => res(server)))
}

async function findTargets() {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const list = await getJson(`http://127.0.0.1:${cdpPort}/json/list`)
      const main_ = list.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url))
      const settings = list.find((t) => t.type === 'page' && /local-model\.html/.test(t.url))
      if (main_ && settings) return { main: main_, settings }
    } catch {
      // CDP 未就绪
    }
    await sleep(500)
  }
  return {}
}

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) j(new Error(JSON.stringify(msg.error)))
        else r(msg.result)
      }
    })
    ws.addEventListener('open', () =>
      res({
        send(method, params) {
          const rid = ++id
          return new Promise((r, j) => {
            pending.set(rid, { resolve: r, reject: j })
            ws.send(JSON.stringify({ id: rid, method, params: params ?? {} }))
          })
        },
        close() {
          try {
            ws.close()
          } catch {
            // ignore
          }
        },
      }),
    )
    ws.addEventListener('error', () => rej(new Error('ws error')))
  })
}

async function evaluate(conn, expression) {
  const res = await conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return res?.result?.value
}

const report = { ok: false, warnings: [], errors: [] }
let child
let mock
try {
  const devHome = join(repo, '.dev', 'welcome-home')
  const devUserData = join(repo, '.dev', 'welcome-ud')
  rmSync(devHome, { recursive: true, force: true })
  rmSync(devUserData, { recursive: true, force: true })
  mkdirSync(devHome, { recursive: true })
  mkdirSync(devUserData, { recursive: true })
  cpSync(join(repo, 'resources', 'forensics', 'skills'), join(devHome, 'skills'), { recursive: true })

  mock = await startMock()
  report.mock = `http://127.0.0.1:${mockPort}/v1`

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.SEEU_LOCAL_MODEL_FILE
  env.SEEU_DEV_MULTI = '1'
  env.SEEU_OPEN_SETTINGS = '1'
  env.SEEU_DSH_HOME = devHome
  env.SEEU_USER_DATA = devUserData
  env.SEEU_LOCAL_MODEL_JSON = JSON.stringify({
    baseURL: `${report.mock}`,
    models: [{ id: 'qwen2.5-32b-instruct', name: 'Qwen2.5 32B (本地)' }],
    useAsDefault: true,
    apiKey: 'local',
    contextWindow: 131072,
    maxTokens: 8192,
  })

  child = spawn(exe, [...exeArgs, `--remote-debugging-port=${cdpPort}`], {
    cwd: exeArgs.length === 0 ? resolve(exe, '..') : repo,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const stderr = []
  child.stderr.on('data', (c) => stderr.push(String(c)))

  const targets = await findTargets()
  if (!targets.main) throw new Error('主页面未出现（检查单实例锁 / 启动日志）')

  const mainConn = await connect(targets.main.webSocketDebuggerUrl)
  const settingsConn = await connect(targets.settings.webSocketDebuggerUrl)
  try {
    await sleep(2500)

    const bodyText = await evaluate(mainConn, 'document.body ? document.body.innerText : ""')
    report.title = await evaluate(mainConn, 'document.title')
    report.heroTagline = typeof bodyText === 'string' && bodyText.includes('证据链优先 · 只读取证 · 结论可回查')
    report.heroSteps = typeof bodyText === 'string' && bodyText.includes('侧栏「取证索引」选案件目录') && bodyText.includes('看引用回查')
    report.themeApplied = await evaluate(mainConn, "!!document.getElementById('seeu-theme') || !!document.querySelector('link[data-seeu-theme]')")

    const probeText = await evaluate(settingsConn, "document.getElementById('probe') ? document.getElementById('probe').textContent : ''")
    report.probeLine = probeText
    report.probeOkShown = typeof probeText === 'string' && probeText.includes('可用') && probeText.includes('qwen2.5-32b-instruct')

    const probeAgain = await evaluate(settingsConn, "(async () => { const p = await window.seeu.localModel.probe(); return p && p.ok ? 'ok:' + (p.models||[]).join(',') : 'fail'; })()")
    report.manualProbe = probeAgain

    report.ok = report.heroTagline === true && report.heroSteps === true && report.themeApplied === true && report.probeOkShown === true && String(probeAgain).startsWith('ok:')
    if (!report.ok) report.warnings.push('部分断言未通过，见字段')
    report.consoleLog = stderr.join('').split('\n').filter((l) => /error/i.test(l)).slice(0, 5)
  } finally {
    mainConn.close()
    settingsConn.close()
  }
} catch (error) {
  report.errors.push(String(error && error.message ? error.message : error))
} finally {
  if (child && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  }
  if (mock) mock.close()
  console.log(JSON.stringify(report))
  process.exit(report.ok ? 0 : 1)
}
