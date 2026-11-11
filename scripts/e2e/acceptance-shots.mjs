// 验收截图：拉起 Electron 外壳（开发态或打包态），把关键界面截图存到 docs/screenshots/。
// 用法（仓库根，需先 npm run build）：
//   SEEU_DEV_MULTI=1 SEEU_DSH_HOME=.dev/ui-home-shots SEEU_USER_DATA=.dev/ui-ud-shots node scripts/e2e/acceptance-shots.mjs
// 打包态：SEEU_UI_EXE=<exe 的 Windows 路径> SEEU_DEV_MULTI=1 node scripts/e2e/acceptance-shots.mjs
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'

const root = process.cwd()
const port = Number(process.env.SEEU_SHOTS_PORT || 9435)
const exeOverride = process.env.SEEU_UI_EXE
const electron = exeOverride || join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const CASE_DIR = process.env.SEEU_CASE_DIR || 'E:\\forensics\\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5'
const OUT_DIR = join(root, 'docs', 'screenshots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function get(url, timeout = 3000) {
  return new Promise((resolve) => {
    const req = request(url, { method: 'GET', timeout }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', (e) => resolve({ status: 0, error: String(e.message) }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }) })
    req.end()
  })
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.SEEU_DEV_MULTI = '1'
if (process.env.SEEU_NO_KILL !== '1') {
  try {
    execFileSync('taskkill', ['/F', '/IM', exeOverride ? 'SeeUForensicsAgentPlus.exe' : 'electron.exe', '/T'], { stdio: 'ignore' })
  } catch { /* 无残留 */ }
}

mkdirSync(OUT_DIR, { recursive: true })
const args = exeOverride ? [`--remote-debugging-port=${port}`] : ['.', `--remote-debugging-port=${port}`]
const child = spawn(electron, args, { cwd: exeOverride ? join(electron, '..') : root, env, stdio: ['ignore', 'pipe', 'pipe'] })
let appLog = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (c) => (appLog += c))
child.stderr.on('data', (c) => (appLog += c))

const report = { ok: false, shots: [], errors: [] }
const deadline = Date.now() + 120000
let target = null
while (Date.now() < deadline && child.exitCode === null) {
  const r = await get(`http://127.0.0.1:${port}/json/list`)
  if (r.status === 200) {
    try {
      target = JSON.parse(r.body).find((p) => p.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+/.test(p.url))
      if (target) break
    } catch { /* 未就绪 */ }
  }
  await sleep(500)
}
if (!target) {
  console.log('REPORT ' + JSON.stringify({ ...report, errors: ['没有拿到 Web UI 页面', appLog.slice(-800)] }))
  child.kill('SIGKILL')
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return }
  if (msg.method === 'Runtime.exceptionThrown') {
    report.errors.push(`exception: ${msg.params.exceptionDetails.text}`.slice(0, 200))
  }
}
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})
await send('Runtime.enable')
await send('Page.enable')

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `ERR: ${r.result.exceptionDetails.text}`
  return r.result?.result?.value
}
const bodyText = () => ev('document.body.innerText')
const clickText = (text, tagFilter = 'button,div,a,li') => ev(`(() => {
  const nodes = [...document.querySelectorAll(${JSON.stringify(tagFilter)})]
  const hit = nodes.filter((n) => (n.innerText || '').trim() === ${JSON.stringify(text)} || (n.innerText || '').includes(${JSON.stringify(text)}))
    .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]
  if (!hit) return 'not-found'
  hit.click()
  return 'clicked:' + hit.tagName
})()`)
const typeInto = (selector, value) => ev(`(() => {
  const list = [...document.querySelectorAll(${JSON.stringify(selector)})]
  const input = list[list.length - 1]
  if (!input) return 'no-input'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  for (const type of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  return 'typed-enter'
})()`)
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const data = r.result?.data
  if (!data) return null
  const path = join(OUT_DIR, file)
  writeFileSync(path, Buffer.from(data, 'base64'))
  report.shots.push(file)
  return path
}

try {
  await sleep(9000)
  await shot('01-welcome-dark.png')

  // 面板：让初始状态就用真实案件目录
  await ev('(() => { localStorage.setItem("seeu.indexDir", ' + JSON.stringify(CASE_DIR) + '); return "seeded" })()')
  await ev('location.reload()')
  await sleep(9500)
  await clickText('取证索引', 'button')
  await sleep(9000)
  report.panelText = (await bodyText()).includes('W盘')
  await shot('02-panel-tree.png')

  await clickText('检索', 'button')
  await sleep(1500)
  report.searchTyped = await ev(`(() => {
    const input = [...document.querySelectorAll('input')].find((el) => (el.placeholder || '').includes('关键词'))
    if (!input) return 'no-input'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '加密')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    for (const type of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    return 'typed-enter'
  })()`)
  await sleep(5000)
  const searchText = String((await bodyText()) ?? '')
  report.searchRows = (searchText.match(/共\s*\d+\s*条/) ?? [''])[0]
  report.searchHit = (searchText.match(/(\d+)\s*命中/) ?? [''])[0]
  report.rowCount = await ev("document.querySelectorAll('.seeu-row.is-clickable').length")
  await shot('03-panel-search.png')

  await clickText('记录', 'button')
  await sleep(3000)
  await shot('04-panel-records.png')

  await clickText('时间线', 'button')
  await sleep(3000)
  await shot('05-panel-timeline.png')

  // 浅色：去掉 dsh 的暗色属性（ui-theme 依据它切换 token）
  await clickText('树', 'button')
  await sleep(1200)
  await ev(`document.body.removeAttribute('data-ds-dark-theme'); document.documentElement.removeAttribute('data-ds-dark-theme')`)
  await sleep(1500)
  report.lightBodyBg = await ev('getComputedStyle(document.body).backgroundColor')
  await shot('06-panel-light.png')

  report.ok = report.panelText === true && Number(report.rowCount) > 0 && report.shots.length >= 6 && report.errors.length === 0
} catch (e) {
  report.errors.push(String(e?.message ?? e))
} finally {
  try { ws.close() } catch { /* ignore */ }
  if (child?.pid) { try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ } }
  console.log('REPORT ' + JSON.stringify(report))
  process.exit(report.ok ? 0 : 1)
}
