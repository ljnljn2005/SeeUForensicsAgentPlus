// SeeU 内置 MCP 服务端（stdio）：把本地「索引 + 链路体检」暴露成 AI 可调用工具。
// 不直接读索引文件，只转发到外壳内运行的 seeu-case-index 插件 HTTP 接口，
// 因此打包后也不需要访问 asar 内的其它模块。
const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'seeu-index', version: '0.1.0' }

function apiBase() {
  const base = process.env.SEEU_INDEX_API
  return typeof base === 'string' ? base.replace(/\/+$/, '') : ''
}

async function httpJson(pathAndQuery) {
  const base = apiBase()
  if (!base) throw new Error('缺少 SEEU_INDEX_API：请从 SeeU 外壳启动的会话里调用（或先确认索引插件已加载）')
  const res = await fetch(base + pathAndQuery)
  const text = await res.text()
  if (!res.ok) throw new Error(`索引接口返回 ${res.status}：${text.slice(0, 500)}`)
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

async function httpText(pathAndQuery) {
  const base = apiBase()
  if (!base) throw new Error('缺少 SEEU_INDEX_API：请从 SeeU 外壳启动的会话里调用（或先确认索引插件已加载）')
  const res = await fetch(base + pathAndQuery)
  const text = await res.text()
  if (!res.ok) throw new Error(`索引接口返回 ${res.status}：${text.slice(0, 500)}`)
  return text
}

const TOOLS = [
  {
    name: 'index_list',
    description: '列出本机可用的 SeeU 案件索引（caseNumber / 案件名 / 记录数 / 数据库路径）。取证开始前先调用它确认要查哪个案件。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'chain_check',
    description:
      '链路体检：只读检查某案件「索引可打开 / 检索可用 / 火眼只读挂载可读 / 镜像可解析」，返回可读文本。深入取证前或查不到数据时先跑它；失败先修链路，不要用全盘 grep 代替。',
    inputSchema: {
      type: 'object',
      properties: {
        caseNumber: { type: 'string', description: '案件编号（index_list 返回的 caseNumber）' },
        db: { type: 'string', description: '直接指定索引库路径（可选，替代 caseNumber）' },
        probe: { type: 'string', description: '检索验证用的关键词，默认 Investors' },
        images: { type: 'boolean', description: '是否顺带解析镜像（E01/DD），默认 false' },
      },
      additionalProperties: false,
    },
  },
]

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}

async function callTool(name, args) {
  if (name === 'index_list') {
    const data = await httpJson('/list')
    const list = Array.isArray(data?.indexes) ? data.indexes : []
    if (!list.length) return textResult('没有找到案件索引。请先在面板里建库，或让用户确认检材已解析。')
    const lines = list.map((ix, i) => {
      const counts = ix?.meta?.counts ?? ix?.counts ?? {}
      const records = counts.records ?? ix?.recordCount ?? '?'
      return `${i + 1}. ${ix?.caseName ?? '未命名'} · caseNumber=${ix?.caseNumber ?? '?'} · ${records} 条记录 · ${ix?.dbPath ?? ''}`
    })
    return textResult(`可用案件索引（${list.length} 个）：\n` + lines.join('\n'))
  }
  if (name === 'chain_check') {
    const qs = new URLSearchParams({ text: '1' })
    if (typeof args?.caseNumber === 'string' && args.caseNumber) qs.set('caseNumber', args.caseNumber)
    if (typeof args?.db === 'string' && args.db) qs.set('db', args.db)
    if (typeof args?.probe === 'string' && args.probe) qs.set('probe', args.probe)
    if (args?.images === true) qs.set('images', '1')
    const text = await httpText('/chain-check?' + qs.toString())
    return textResult(text)
  }
  return textResult(`未知工具：${name}`, true)
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

async function handle(message) {
  const { id, method, params } = message ?? {}
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    })
    return
  }
  if (method === 'notifications/initialized') return
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
    return
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    return
  }
  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments ?? {}
    try {
      const result = await callTool(name, args)
      send({ jsonrpc: '2.0', id, result })
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      send({ jsonrpc: '2.0', id, result: textResult('工具调用失败：' + message, true) })
    }
    return
  }
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

let buffer = ''
let pending = 0
let ended = false
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    pending += 1
    handle(message)
      .catch((error) => {
        process.stderr.write('[seeu-mcp] ' + (error && error.stack ? error.stack : String(error)) + String.fromCharCode(10))
      })
      .finally(() => {
        pending -= 1
        if (ended && pending === 0) process.exit(0)
      })
  }
})
process.stdin.on('end', () => {
  ended = true
  if (pending === 0) process.exit(0)
})
process.on('uncaughtException', (error) => {
  process.stderr.write('[seeu-mcp] ' + (error && error.stack ? error.stack : String(error)) + '\n')
  process.exit(1)
})
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
