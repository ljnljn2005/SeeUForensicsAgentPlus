// 本地模型「工具调用」端到端验证：
//   1. mock OpenAI 网关：首轮按 OpenAI 规范回 SSE 的 tool_calls（调用 todo_write），
//      第二轮（请求里带 role:"tool" 结果消息）回最终文本
//   2. 用 SEEU_LOCAL_MODEL_JSON 让外壳生成 local-model.patch.yml 并以该模型为默认
//   3. 真实 Electron 窗口里发一条消息，断言：请求里带 tools、工具调用被执行、最终答复可见
// 只依赖 Node 内置模块 + 已安装的 Electron。
import { spawn, execFileSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { join } from 'node:path'

const root = process.cwd()
const CDP_PORT = Number(process.env.SEEU_E2E_CDP ?? 9352)
const MOCK_PORT = Number(process.env.SEEU_E2E_MOCK ?? 18085)
const MODEL_ID = 'mock-tools'
const TOOL_ARGS = JSON.stringify({ todos: [{ content: '验证本地模型工具调用', status: 'in_progress' }] })
const FINAL = 'MOCK-TOOLS-OK：工具调用已回传，todos 已写入'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── mock OpenAI 网关 ────────────────────────────────────────────────────────
let chatCalls = 0
let sawToolResult = false
const shapes = []

const mock = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID, object: 'model' }] }))
      return
    }
    if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
      chatCalls += 1
      let body = {}
      try { body = JSON.parse(raw) } catch { /* 忽略 */ }
      const messages = Array.isArray(body.messages) ? body.messages : []
      const hasToolResult = messages.some((m) => m?.role === 'tool')
      if (hasToolResult) sawToolResult = true
      shapes.push({
        stream: body.stream,
        tools: Array.isArray(body.tools) ? body.tools.length : 0,
        toolChoice: body.tool_choice ?? null,
        maxTokensField: Object.prototype.hasOwnProperty.call(body, 'max_tokens')
          ? 'max_tokens'
          : Object.prototype.hasOwnProperty.call(body, 'max_completion_tokens') ? 'max_completion_tokens' : 'none',
        hasStreamOptions: Object.prototype.hasOwnProperty.call(body, 'stream_options'),
        hasStore: Object.prototype.hasOwnProperty.call(body, 'store'),
        hasToolResult,
        // 上下文预算：本地模型最关心「固定开销」占多少
        toolsChars: Array.isArray(body.tools) ? JSON.stringify(body.tools).length : 0,
        toolsByName: Array.isArray(body.tools)
          ? body.tools.map((t) => ({ name: t?.function?.name ?? t?.name ?? '?', chars: JSON.stringify(t).length })).sort((a, b) => b.chars - a.chars)
          : [],
        systemChars: messages.filter((m) => m?.role === 'system').reduce((n, m) => n + String(m?.content ?? '').length, 0),
        toolsCount: Array.isArray(body.tools) ? body.tools.length : 0,
        strictTrue: Array.isArray(body.tools) ? body.tools.filter((t) => t?.function?.strict === true).length : 0,
        strictAny: Array.isArray(body.tools) ? body.tools.filter((t) => t?.function?.strict !== undefined).length : 0,
        requestChars: raw.length,
        keys: Object.keys(body).join(','),
        roles: messages.map((m) => m?.role).join(','),
        // 工作区「案件概览」指令文件（SEEU-CASE-BRIEF.md）是否被 agent-instructions 读进上下文
        briefSeen: messages.some((m) => String(m?.content ?? '').includes('本机案件索引概览')),
        briefChars: messages.reduce((n, m) => n + (String(m?.content ?? '').includes('本机案件索引概览') ? String(m.content).length : 0), 0),
      })

      const stream = body.stream !== false
      const chunksOut = []
      if (!stream) {
        const message = hasToolResult
          ? { role: 'assistant', content: FINAL }
          : {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'todo_write', arguments: TOOL_ARGS } }],
          }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'mock-1', object: 'chat.completion', model: MODEL_ID,
          choices: [{ index: 0, message, finish_reason: hasToolResult ? 'stop' : 'tool_calls' }],
          usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
        }))
        return
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
      const base = { id: 'mock-1', object: 'chat.completion.chunk', model: MODEL_ID }
      if (hasToolResult) {
        send({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
        for (const piece of FINAL.match(/.{1,8}/gu) ?? []) {
          send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })
        }
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      } else {
        // OpenAI 流式 tool_calls：首块建索引，后续块补 arguments 片段
        send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'todo_write', arguments: '' } }] }, finish_reason: null }] })
        for (const piece of TOOL_ARGS.match(/.{1,24}/gu) ?? [TOOL_ARGS]) {
          send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] }, finish_reason: null }] })
        }
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      }
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
env.SEEU_DSH_HOME = join(root, '.dev', 'tools-home')
env.SEEU_USER_DATA = join(root, '.dev', 'tools-ud')
env.SEEU_LOCAL_MODEL_JSON = JSON.stringify({
  baseURL: `http://127.0.0.1:${MOCK_PORT}/v1`,
  models: [{ id: MODEL_ID, name: 'Mock Tools (本地)' }],
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
    return { editables: editables.length, text: document.body.innerText.slice(0, 200) }
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
const PROMPT = '请调用 todo_write 记录一条测试任务，然后回复 MOCK-TOOLS'
await send('Input.insertText', { text: PROMPT })
await sleep(400)
let typedOk = await ev(`(() => {
  const el = document.activeElement
  return { tag: el?.tagName, text: (el?.innerText ?? '').slice(0, 60) }
})()`)
console.log('[e2e] active after insertText:', JSON.stringify(typedOk))
if (!String(typedOk?.text ?? '').includes('todo_write')) {
  for (const ch of PROMPT) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }
  await sleep(400)
  typedOk = await ev(`(() => {
    const el = document.activeElement
    return { tag: el?.tagName, text: (el?.innerText ?? '').slice(0, 60) }
  })()`)
  console.log('[e2e] active after keyDown loop:', JSON.stringify(typedOk))
}
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
console.log('[e2e] submitted via Enter')
await sleep(6000)

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

// 等最终答复（第二轮）与工具结果出现在页面里
let gotReply = false
let text = ''
for (let i = 0; i < 120; i += 1) {
  text = (await ev('document.body.innerText')) ?? ''
  if (text.includes('MOCK-TOOLS-OK')) { gotReply = true; break }
  await sleep(1000)
}
const todoVisible = text.includes('验证本地模型工具调用')
const todoCard = /任务/.test(text) && /进行中|已完成/.test(text)
const first = shapes[0] ?? {}
const toolRound = shapes.find((s) => s.hasToolResult) ?? {}

// 工具卡片样式：验证 theme.css 的 [data-tool] 规则（圆角 ≥10、边框不是 transparent）
const toolCardStyle = await ev(`(() => {
  const el = document.querySelector('[data-tool]')
  if (el === null) return { count: 0 }
  const cs = getComputedStyle(el)
  return {
    count: document.querySelectorAll('[data-tool]').length,
    radius: parseFloat(cs.borderTopLeftRadius) || 0,
    border: cs.borderTopColor,
    bg: cs.backgroundColor,
  }
})()`)
const toolCardStyleOk = toolCardStyle.count === 0 ? true : (toolCardStyle.radius >= 10 && toolCardStyle.border !== 'rgba(0, 0, 0, 0)')

// 默认本地模型配置会切到「取证分析（本地模型精简）」：工具表从 27 个降到约 12 个。
const litePresetActive = (first.toolsCount ?? 99) <= 14
// agent-instructions 应把 <工作区>/SEEU-CASE-BRIEF.md 读成会话指令（overlay 候选名之一）
const briefSeen = shapes.some((x) => x.briefSeen === true)
const summary = {
  ok: gotReply && sawToolResult && (first.tools ?? 0) > 0 && first.maxTokensField === 'max_tokens' && first.hasStreamOptions === false && first.hasStore === false && toolCardStyleOk && litePresetActive && briefSeen,
  chatCalls,
  rounds: shapes.length,
  gotReply,
  toolResultSeen: sawToolResult,
  todoVisible,
  todoCard,
  toolCardStyle,
  toolCardStyleOk,
  litePresetActive,
  litePresetTools: first.toolsCount,
  briefSeen,
  briefChars: (shapes.find((x) => x.briefSeen) ?? {}).briefChars ?? 0,

  firstRequest: {
    stream: first.stream,
    tools: first.tools,
    toolChoice: first.toolChoice,
    maxTokensField: first.maxTokensField,
    hasStreamOptions: first.hasStreamOptions,
    hasStore: first.hasStore,
    strictTrue: first.strictTrue,
    strictAny: first.strictAny,
    keys: first.keys,
  },
  toolRoundRoles: toolRound.roles ?? null,
  budget: (() => {
    const toolReq = shapes.find((x) => (x.toolsCount ?? 0) > 0) ?? first;
    return {
    toolsCount: toolReq.toolsCount,
    toolsChars: toolReq.toolsChars,
    systemChars: toolReq.systemChars,
    requestChars: toolReq.requestChars,
    titleRequestChars: (shapes.find((x) => (x.toolsCount ?? 0) === 0) ?? {}).requestChars ?? 0,
    // 中文按 ~1.6 字符/token、英文 JSON 按 ~4 字符/token 粗估，取 2.2 折中
    approxTokens: Math.round((first.requestChars ?? 0) / 2.2),
    toolsByName: toolReq.toolsByName ?? [],
    };
  })(),
  snippet: gotReply ? text.slice(Math.max(0, text.indexOf('MOCK-TOOLS-OK') - 100), text.indexOf('MOCK-TOOLS-OK') + 160) : text.slice(-600),
  errors: consoleErrors.slice(0, 5),
  appLogTail: appLog.slice(-400),
}
console.log('REPORT ' + JSON.stringify(summary))

ws.close()
try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已退出 */ }
mock.close()
process.exit(summary.ok ? 0 : 1)
