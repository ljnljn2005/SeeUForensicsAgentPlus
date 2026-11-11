// 本地网关「能力自检」端到端验证：
//   mock OpenAI 网关支持 tool_calls；另有一个 no-tool-model 只回文本。
//   在设置窗口里点【测试连接与能力自检】，断言：
//     · 支持工具的模型：模型列表/基础对话/工具调用 三项全绿
//     · no-tool-model：工具调用项标红，并给出「只能聊天」的结论
import { spawn, execFileSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { join } from 'node:path'

const root = process.cwd()
const CDP_PORT = Number(process.env.SEEU_DIAG_CDP ?? 9354)
const MOCK_PORT = Number(process.env.SEEU_DIAG_MOCK ?? 18087)
const MODELS = ['mock-32b', 'no-tool-model']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let calls = 0
const mock = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) }))
      return
    }
    if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
      calls += 1
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* 忽略 */ }
      const wantsTools = Array.isArray(body.tools) && body.tools.length > 0
      const supportsTools = body.model !== 'no-tool-model'
      res.writeHead(200, { 'content-type': 'application/json' })
      if (wantsTools && supportsTools) {
        res.end(JSON.stringify({
          id: 'diag-1', object: 'chat.completion', model: body.model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ping_tool', arguments: '{"value":1}' } }],
            },
            finish_reason: 'tool_calls',
          }],
        }))
        return
      }
      res.end(JSON.stringify({
        id: 'diag-1', object: 'chat.completion', model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"not found"}}')
  })
})
await new Promise((ok) => mock.listen(MOCK_PORT, '127.0.0.1', ok))
console.log(`[mock] listening 127.0.0.1:${MOCK_PORT} models=${MODELS.join(',')}`)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.SEEU_LOCAL_MODEL_JSON
env.SEEU_DEV_MULTI = '1'
env.SEEU_OPEN_SETTINGS = '1'
env.SEEU_DSH_HOME = join(root, '.dev', 'diag-home')
env.SEEU_USER_DATA = join(root, '.dev', 'diag-ud')
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
      target = JSON.parse(r.body).find((p) => p.type === 'page' && /local-model\.html/.test(p.url))
      if (target) break
    } catch { /* 未就绪 */ }
  }
  await sleep(500)
}
if (!target) {
  console.log(JSON.stringify({ ok: false, stage: 'no-settings-page', appLog: appLog.slice(-1200) }))
  child.kill('SIGKILL'); mock.close(); process.exit(1)
}
console.log('[diag] page:', target.url)

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

// 等页面脚本就绪
for (let i = 0; i < 60; i += 1) {
  const ready = await ev(`Boolean(window.seeu && window.seeu.localModel && document.getElementById('btn-test'))`)
  if (ready === true) break
  await sleep(500)
}

const fill = async (modelLine) => {
  return ev(`(() => {
    const set = (id, value) => {
      const el = document.getElementById(id)
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('baseURL', ${JSON.stringify(`http://127.0.0.1:${MOCK_PORT}/v1`)})
    set('models', ${JSON.stringify(modelLine)})
    set('apiKey', 'local')
    return { baseURL: document.getElementById('baseURL').value, models: document.getElementById('models').value }
  })()`)
}

const runProbe = async () => {
  await ev(`document.getElementById('btn-test').click()`)
  for (let i = 0; i < 120; i += 1) {
    const state = await ev(`(() => ({
      rows: document.querySelectorAll('#diag .row').length,
      disabled: document.getElementById('btn-test').disabled,
      status: document.getElementById('status').textContent,
    }))()`)
    if (state && state.rows > 0 && state.disabled === false) return state
    await sleep(500)
  }
  return null
}

const readRows = async () => ev(`(() => [...document.querySelectorAll('#diag .row')].map((r) => ({
  ok: r.classList.contains('ok'),
  text: r.innerText.replace(/\\s+/g, ' ').trim(),
})).concat([...document.querySelectorAll('#diag .sum')].map((s) => ({ ok: null, text: s.innerText.trim() }))))()`)

await fill('mock-32b | Mock 32B（本地）')
const first = await runProbe()
const firstRows = await readRows()

await fill('no-tool-model | 不支持工具的模型')
const second = await runProbe()
const secondRows = await readRows()

const firstOk = Array.isArray(firstRows) && firstRows.length >= 4 && firstRows.slice(0, 3).every((r) => r.ok === true)
const toolsRowBad = Array.isArray(secondRows) && secondRows.some((r) => r.ok === false && /工具调用/.test(r.text))
const summaryMentionsChatOnly = Array.isArray(secondRows) && secondRows.some((r) => r.ok === null && /只能聊天/.test(r.text))

const report = {
  ok: firstOk && toolsRowBad && summaryMentionsChatOnly,
  chatCalls: calls,
  supportedModel: { status: first?.status ?? null, rows: firstRows },
  noToolModel: { status: second?.status ?? null, rows: secondRows },
  checks: { firstOk, toolsRowBad, summaryMentionsChatOnly },
  errors: consoleErrors.slice(0, 5),
  appLogTail: appLog.slice(-300),
}
console.log('REPORT ' + JSON.stringify(report))

ws.close()
try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已退出 */ }
mock.close()
process.exit(report.ok ? 0 : 1)
