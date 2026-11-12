// 真机网关（OpenAI 兼容）桌面 UI 联调：
//   1. 用真实网关（GW_BASE / GW_KEY / GW_MODEL）生成 local-model.patch.yml，并以它作为默认模型；
//   2. 隔离 DSH_HOME，写入 index-state.json 指向真实案件目录，让「案件概览」注入 AGENTS.md；
//   3. 在真实 Electron 窗口里发一条问题，量首字延迟，断言答出真实检材名；
//   4. 截图 docs/screenshots/10-real-gateway-chat.png。
// 凭据只走环境变量，不落仓库文件。
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'

const root = process.cwd()
const CDP_PORT = Number(process.env.SEEU_REAL_UI_CDP ?? 9361)
const GW_BASE = (process.env.GW_BASE ?? '').replace(/\/+$/, '').replace(/\/v1$/i, '')
const GW_KEY = process.env.GW_KEY ?? ''
const GW_MODEL = process.env.GW_MODEL ?? ''
const CASE_DIR = process.env.CASE_DIR ?? 'E:\\forensics\\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5'
const EVIDENCE_NAMES = ['CHAN_MH_mobile.zip', 'IQ_Coin_Type_Transactions.zip', 'LEUNG_YL_mobile.zip', 'AP3_LEUNG_YL_USB.E01', 'FUNG_CC_mobile.zip']
const PROMPT = '不要调用任何工具，直接根据系统提示里已有的「案件概览」回答：本机案件索引里有哪些检材？只列检材名称，不要猜测。'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!GW_BASE || !GW_MODEL) {
  console.log(JSON.stringify({ ok: false, error: '缺少 GW_BASE / GW_MODEL 环境变量' }))
  process.exit(2)
}

const home = join(root, '.dev', 'real-ui-home')
mkdirSync(home, { recursive: true })
writeFileSync(join(home, 'index-state.json'), JSON.stringify({ dirs: [CASE_DIR] }))

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.SEEU_DEV_MULTI = '1'
env.SEEU_DSH_HOME = home
env.SEEU_USER_DATA = process.env.SEEU_USER_DATA ?? join(root, '.dev', 'real-ui-ud')
env.SEEU_EXPORT_DIR = join(root, '.dev', 'real-ui-exports')
env.SEEU_LOCAL_MODEL_JSON = JSON.stringify({
  baseURL: `${GW_BASE}/v1`,
  models: [{ id: GW_MODEL, name: 'DeepSeek Flash（真机网关）' }],
  useAsDefault: true,
  apiKey: GW_KEY || 'local',
  contextWindow: Number(process.env.GW_CONTEXT ?? 131072),
  maxTokens: 8192,
  litePreset: true,
  usageInStreaming: true,
  titleGeneration: false,
  timeoutSec: 300,
  streamIdleSec: 120,
})

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${CDP_PORT}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
let appLog = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (c) => (appLog += c))
child.stderr.on('data', (c) => (appLog += c))

function get(url, timeout = 3000) {
  return new Promise((resolve) => {
    const req = request(url, { method: 'GET', timeout }, (res) => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (b += c))
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    req.on('error', (e) => resolve({ status: 0, error: String(e.message) }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }) })
    req.end()
  })
}

const finish = async (report, code = 0) => {
  try { child.kill('SIGKILL') } catch { /* 已退出 */ }
  console.log('REPORT ' + JSON.stringify(report))
  process.exit(code)
}

const deadline = Date.now() + 150_000
let target = null
while (Date.now() < deadline && child.exitCode === null) {
  const r = await get(`http://127.0.0.1:${CDP_PORT}/json/list`)
  if (r.status === 200) {
    try {
      target = JSON.parse(r.body).find((p) => p.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+/.test(p.url))
      if (target) break
    } catch { /* 未就绪 */ }
  }
  await sleep(500)
}
if (!target) await finish({ ok: false, stage: 'no-page', appLog: appLog.slice(-1500) }, 1)

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
const consoleErrors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.text ?? 'exception')
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

// 等输入框出现（最多 60s）
let ui = null
for (let i = 0; i < 60; i += 1) {
  ui = await ev(`(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10 }
    const editables = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible)
    return { editables: editables.length, bodyHead: document.body.innerText.slice(0, 200) }
  })()`)
  if (ui && ui.editables > 0) break
  await sleep(1000)
}
if (!ui || ui.editables === 0) await finish({ ok: false, stage: 'no-composer', ui, appLog: appLog.slice(-1200) }, 1)

// 关掉「预览版说明」提示卡
const dismissed = await ev(`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8 }
  const btn = [...document.querySelectorAll('button')].filter(visible).find((b) => b.innerText.trim() === '继续')
  if (!btn) return null
  btn.click()
  return '继续'
})()`)
await sleep(800)

// 点击 composer 聚焦 + 原生输入
const box = await ev(`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10 }
  const list = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible)
  const el = list[list.length - 1]
  if (!el) return null
  el.focus()
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
if (!box) await finish({ ok: false, stage: 'no-box', ui, appLog: appLog.slice(-1200) }, 1)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
await sleep(300)
await send('Input.insertText', { text: PROMPT })
await sleep(500)
const typed = await ev(`(() => {
  const el = document.activeElement
  return { tag: el?.tagName, text: (el?.innerText ?? '').slice(0, 120) }
})()`)
if (!String(typed?.text ?? '').includes('案件概览')) await finish({ ok: false, stage: 'type-failed', typed, ui, appLog: appLog.slice(-1200) }, 1)

const t0 = Date.now()
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })

// 轮询：思考块出现时间、首段文字时间、全文
let firstSignalMs = null
let firstTextMs = null
let thinkingSeen = false
let text = ''
let settledHits = 0
for (let i = 0; i < 300; i += 1) {
  const state = await ev(`(() => ({
    body: document.body.innerText,
    thinking: /思考|已思考|Thinking/i.test(document.body.innerText),
    steps: document.querySelectorAll('[data-chat-flow-kind="assistant-step"]').length,
  }))()`)
  text = String(state?.body ?? '')
  if (state?.thinking && !thinkingSeen) { thinkingSeen = true; firstSignalMs = firstSignalMs ?? Date.now() - t0 }
  const hasName = EVIDENCE_NAMES.some((n) => text.includes(n))
  if (hasName && firstTextMs === null) firstTextMs = Date.now() - t0
  if (hasName) settledHits += 1
  if (settledHits >= 2) break
  await sleep(1000)
}

const totalMs = Date.now() - t0
const names = EVIDENCE_NAMES.filter((n) => text.includes(n))
const usage = await ev(`(() => {
  const m = document.body.innerText.match(/用量[^\\n]{0,40}/)
  return m ? m[0] : null
})()`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) {
  mkdirSync(join(root, 'docs', 'screenshots'), { recursive: true })
  writeFileSync(join(root, 'docs', 'screenshots', '10-real-gateway-chat.png'), Buffer.from(shot.result.data, 'base64'))
}

const report = {
  ok: names.length === EVIDENCE_NAMES.length,
  stage: 'done',
  model: GW_MODEL,
  baseURL: GW_BASE,
  prompt: PROMPT,
  dismissed,
  typed,
  thinkingSeen,
  firstSignalMs,
  firstTextMs,
  totalMs,
  names,
  namesOk: names.length === EVIDENCE_NAMES.length,
  usage,
  bodyTail: text.slice(-700),
  consoleErrors,
  appLogTail: appLog.slice(-800),
}
await finish(report, report.ok ? 0 : 1)
