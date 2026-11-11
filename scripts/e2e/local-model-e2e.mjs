// 本地模型（OpenAI 兼容网关）端到端验证：
//   1. 起一个 mock OpenAI 网关（/v1/models + /v1/chat/completions SSE）
//   2. 用 SEEU_LOCAL_MODEL_JSON 让外壳生成 local-model.patch.yml 并以本地模型为默认模型
//   3. 在真实 Electron 窗口里发一条消息，断言收到 mock 回复
// 只依赖 Node 内置模块 + 已安装的 Electron。
import { spawn, execFileSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { join } from 'node:path'

const root = process.cwd()
const CDP_PORT = Number(process.env.SEEU_E2E_CDP ?? 9351)
const MOCK_PORT = Number(process.env.SEEU_E2E_MOCK ?? 18080)
const MODEL_ID = 'mock-14b'
const REPLY = 'MOCK-OK：本地网关已连通，模型是 ' + MODEL_ID

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── mock OpenAI 网关 ────────────────────────────────────────────────────────
let chatCalls = 0
let usageAsked = 0
const mock = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID, object: 'model' }] }))
      return
    }
    if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
      chatCalls += 1
      let parsed = {}
      try { parsed = JSON.parse(body) } catch { /* 忽略 */ }
      const wantsStream = parsed.stream !== false
      const wantsUsage = parsed.stream_options?.include_usage === true
      if (wantsUsage) usageAsked += 1
      if (!wantsStream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'mock-1', object: 'chat.completion', model: MODEL_ID,
          choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
        }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
      send({ id: 'mock-1', object: 'chat.completion.chunk', model: MODEL_ID, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
      for (const piece of REPLY.match(/.{1,8}/gu) ?? []) {
        send({ id: 'mock-1', object: 'chat.completion.chunk', model: MODEL_ID, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })
      }
      send({ id: 'mock-1', object: 'chat.completion.chunk', model: MODEL_ID, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      if (wantsUsage) send({ id: 'mock-1', object: 'chat.completion.chunk', model: MODEL_ID, choices: [], usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 } })
      res.end('data: [DONE]\n\n')
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"not found"}}')
  })
})
await new Promise((ok) => mock.listen(MOCK_PORT, '127.0.0.1', ok))
console.log(`[mock] listening 127.0.0.1:${MOCK_PORT}`)

// ── 起外壳 ──────────────────────────────────────────────────────────────────
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.SEEU_DEV_MULTI = '1'
env.SEEU_DSH_HOME = join(root, '.dev', 'local-home')
env.SEEU_LOCAL_MODEL_JSON = JSON.stringify({
  baseURL: `http://127.0.0.1:${MOCK_PORT}/v1`,
  models: [{ id: MODEL_ID, name: 'Mock 14B (本地)' }],
  useAsDefault: true,
  apiKey: 'local',
  contextWindow: 131072,
  maxTokens: 8192,
  // 打开流式用量：验证网关回 usage 后会话里能看到 token 用量
  usageInStreaming: true,
})
try { execFileSync('taskkill', ['/F', '/IM', 'electron.exe', '/T'], { stdio: 'ignore' }) } catch { /* 无残留 */ }

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${CDP_PORT}`], {
  cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
})
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
if (!target) {
  console.log(JSON.stringify({ ok: false, stage: 'no-page', appLog: appLog.slice(-1500) }))
  child.kill('SIGKILL'); mock.close(); process.exit(1)
}
console.log('[e2e] page:', target.url)

// ── CDP ────────────────────────────────────────────────────────────────────
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
const consoleErrors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push((m.params.exceptionDetails?.text ?? '') + ' ' + (m.params.exceptionDetails?.exception?.description ?? ''))
  }
}
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})
await send('Runtime.enable')
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `ERR: ${r.result.exceptionDetails.text}`
  return r.result?.result?.value
}

// 等 UI 稳定（出现输入框）
let ui = null
for (let i = 0; i < 90; i += 1) {
  ui = await ev(`(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10 }
    const editables = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible)
    return {
      textareas: document.querySelectorAll('textarea').length,
      editables: editables.length,
      totalEditables: document.querySelectorAll('[contenteditable="true"]').length,
      text: document.body.innerText.slice(0, 400),
    }
  })()`)
  if (ui && ui.editables > 0) break
  await sleep(1000)
}
console.log('[e2e] ui:', JSON.stringify(ui))

// 关掉「预览版说明」提示卡（它会挡住 composer）
const dismissed = await ev(`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8 }
  const btn = [...document.querySelectorAll('button')].filter(visible).find((b) => b.innerText.trim() === '继续')
  if (!btn) return null
  btn.click()
  return '继续'
})()`)
console.log('[e2e] dismiss notice:', JSON.stringify(dismissed))
await sleep(800)

// 真实输入：CDP Input 域（React/ProseMirror 需要原生事件，直接改 DOM 不会触发提交）
const box = await ev(`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10 }
  const list = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible)
  const el = list[list.length - 1]
  if (!el) return null
  el.focus()
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
await sleep(300)
const PROMPT = '请回复一句 MOCK 测试'
await send('Input.insertText', { text: PROMPT })
await sleep(400)
let typedOk = await ev(`(() => {
  const el = document.activeElement
  return { tag: el?.tagName, editable: el?.getAttribute?.('contenteditable'), text: (el?.innerText ?? '').slice(0, 60) }
})()`)
console.log('[e2e] active after insertText:', JSON.stringify(typedOk))
if (!String(typedOk?.text ?? '').includes('MOCK')) {
  for (const ch of PROMPT) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }
  await sleep(400)
  typedOk = await ev(`(() => {
    const el = document.activeElement
    return { tag: el?.tagName, editable: el?.getAttribute?.('contenteditable'), text: (el?.innerText ?? '').slice(0, 60) }
  })()`)
  console.log('[e2e] active after keyDown loop:', JSON.stringify(typedOk))
}
const afterType = await ev(`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10 }
  const list = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible)
  const el = list[list.length - 1]
  const btns = [...document.querySelectorAll('button')].filter(visible).map((b) => ({
    label: (b.getAttribute('aria-label') ?? '') + '|' + (b.getAttribute('title') ?? ''),
    disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
    text: (b.innerText || '').slice(0, 12),
  })).filter((b) => b.label !== '|' || b.text)
  return { composer: el ? { tag: el.tagName, text: (el.innerText || '').slice(0, 80), html: (el.innerHTML || '').slice(0, 120) } : null, buttons: btns.slice(0, 12) }
})()`)
console.log('[e2e] afterType:', JSON.stringify(afterType))
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
console.log('[e2e] submitted via Enter')
await sleep(5000)

// Enter 没发出去的兜底：点发送按钮
if (chatCalls === 0) {
  const clicked = await ev(`(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8 }
    const btn = [...document.querySelectorAll('button')].filter(visible).find((b) => /发送|Send/i.test((b.getAttribute('aria-label') ?? '') + (b.getAttribute('title') ?? '') + b.innerText))
    if (!btn) return null
    btn.click()
    return (btn.getAttribute('aria-label') ?? btn.getAttribute('title') ?? btn.innerText ?? '').slice(0, 40)
  })()`)
  console.log('[e2e] fallback click send:', JSON.stringify(clicked))
}

// 等 mock 回复出现在页面里
let got = false
let text = ''
for (let i = 0; i < 120; i += 1) {
  text = (await ev('document.body.innerText')) ?? ''
  if (text.includes('MOCK-OK')) { got = true; break }
  await sleep(1000)
}

const afterSend = await ev(`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10 }
  const list = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible)
  const el = list[list.length - 1]
  return { composerText: el ? (el.innerText || '').slice(0, 80) : null, bodyHasPrompt: document.body.innerText.includes('请回复一句 MOCK 测试') }
})()`)
console.log('[e2e] afterSend:', JSON.stringify(afterSend))

const usageIdx = text.indexOf('用量')
const usageText = usageIdx >= 0 ? text.slice(usageIdx, usageIdx + 40).split('\n')[0] : ''
const usageShown = /用量\s*[:：]?\s*(?!0\b)\d+/.test(usageText)

const summary = {
  ok: got && usageShown && usageAsked > 0,
  chatCalls,
  usageAsked,
  usageText,
  usageShown,
  gotReply: got,
  snippet: text.includes(REPLY.slice(0, 8)) ? text.slice(Math.max(0, text.indexOf('MOCK-OK') - 120), text.indexOf('MOCK-OK') + 200) : text.slice(-600),
  errors: consoleErrors.slice(0, 5),
  appLogTail: appLog.slice(-400),
}
console.log('REPORT ' + JSON.stringify(summary))

ws.close()
try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已退出 */ }
mock.close()
process.exit(got ? 0 : 1)
