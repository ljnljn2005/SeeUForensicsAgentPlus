// 本地模型「低并发重试」端到端验证：
//   mock OpenAI 网关前 2 次请求返回 429（带 Retry-After: 0），第 3 次正常回 SSE 文本，
//   用来验证外壳生成的 retryPolicy { mode: normal, maxRetries: 3 } 是否真的在重试。
import { spawn, execFileSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { join } from 'node:path'

const root = process.cwd()
const CDP_PORT = Number(process.env.SEEU_E2E_CDP ?? 9353)
const MOCK_PORT = Number(process.env.SEEU_E2E_MOCK ?? 18086)
const MODEL_ID = 'mock-retry'
const FINAL = 'MOCK-RETRY-OK：重试后连通'
const FAIL_TIMES = Number(process.env.SEEU_E2E_FAIL_TIMES ?? 2)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let chatCalls = 0
const mock = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID, object: 'model' }] }))
      return
    }
    if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
      chatCalls += 1
      if (chatCalls <= FAIL_TIMES) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' })
        res.end(JSON.stringify({ error: { message: 'mock rate limit', type: 'rate_limit_error' } }))
        return
      }
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* 忽略 */ }
      if (body.stream === false) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'mock-1', object: 'chat.completion', model: MODEL_ID,
          choices: [{ index: 0, message: { role: 'assistant', content: FINAL }, finish_reason: 'stop' }],
        }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
      const base = { id: 'mock-1', object: 'chat.completion.chunk', model: MODEL_ID }
      send({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
      for (const piece of FINAL.match(/.{1,6}/gu) ?? []) {
        send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })
      }
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      res.end('data: [DONE]\n\n')
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"not found"}}')
  })
})
await new Promise((ok) => mock.listen(MOCK_PORT, '127.0.0.1', ok))
console.log(`[mock] listening 127.0.0.1:${MOCK_PORT} (first ${FAIL_TIMES} calls -> 429)`)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.SEEU_DEV_MULTI = '1'
env.SEEU_DSH_HOME = join(root, '.dev', 'retry-home')
env.SEEU_USER_DATA = join(root, '.dev', 'retry-ud')
env.SEEU_LOCAL_MODEL_JSON = JSON.stringify({
  baseURL: `http://127.0.0.1:${MOCK_PORT}/v1`,
  models: [{ id: MODEL_ID, name: 'Mock Retry (本地)' }],
  useAsDefault: true,
  apiKey: 'local',
  contextWindow: 131072,
  maxTokens: 8192,
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
  console.log(JSON.stringify({ ok: false, stage: 'no-page', chatCalls, appLog: appLog.slice(-1200) }))
  child.kill('SIGKILL'); mock.close(); process.exit(1)
}
console.log('[e2e] page:', target.url)

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

let ui = null
for (let i = 0; i < 90; i += 1) {
  ui = await ev(`(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10 }
    return { editables: [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible).length }
  })()`)
  if (ui && ui.editables > 0) break
  await sleep(1000)
}
console.log('[e2e] ui:', JSON.stringify(ui))

await ev(`(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8 }
  const btn = [...document.querySelectorAll('button')].filter(visible).find((b) => b.innerText.trim() === '继续')
  if (btn) btn.click()
})()`)
await sleep(800)

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
const PROMPT = '请回复一句 RETRY 测试'
await send('Input.insertText', { text: PROMPT })
await sleep(500)
const typed = await ev(`(() => (document.activeElement?.innerText ?? '').slice(0, 60))()`)
if (!String(typed ?? '').includes('RETRY')) {
  for (const ch of PROMPT) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }
  await sleep(400)
}
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
console.log('[e2e] submitted via Enter')

let gotReply = false
let text = ''
for (let i = 0; i < 150; i += 1) {
  text = (await ev('document.body.innerText')) ?? ''
  if (text.includes('MOCK-RETRY-OK')) { gotReply = true; break }
  await sleep(1000)
}

const summary = {
  ok: gotReply && chatCalls > FAIL_TIMES,
  chatCalls,
  failTimes: FAIL_TIMES,
  retried: chatCalls > 1,
  gotReply,
  snippet: gotReply ? text.slice(Math.max(0, text.indexOf('MOCK-RETRY-OK') - 80), text.indexOf('MOCK-RETRY-OK') + 120) : text.slice(-500),
  errors: consoleErrors.slice(0, 5),
}
console.log('REPORT ' + JSON.stringify(summary))

ws.close()
try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已退出 */ }
mock.close()
process.exit(summary.ok ? 0 : 1)
