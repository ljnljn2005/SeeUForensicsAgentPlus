// SeeU 内置 MCP 服务端（stdio）：把本地「索引 / 检索 / 链路体检」暴露成 AI 可调用工具。
// 不直接读索引文件，只转发到外壳内运行的 seeu-case-index 插件 HTTP 接口，
// 因此打包后也不需要访问 asar 内的其它模块。
const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'seeu-index', version: '0.2.0' }

function apiBase() {
  const base = process.env.SEEU_INDEX_API
  return typeof base === 'string' ? base.replace(/\/+$/, '') : ''
}

async function httpText(pathAndQuery) {
  const base = apiBase()
  if (!base) throw new Error('缺少 SEEU_INDEX_API：请从 SeeU 外壳启动的会话里调用（或先确认索引插件已加载）')
  const res = await fetch(base + pathAndQuery)
  const text = await res.text()
  if (!res.ok) throw new Error(`索引接口返回 ${res.status}：${text.slice(0, 500)}`)
  return text
}

async function httpJson(pathAndQuery) {
  const text = await httpText(pathAndQuery)
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}

function firstLine(value) {
  const text = String(value ?? '')
  const cut = text.indexOf('\n')
  return (cut >= 0 ? text.slice(0, cut) : text).trim()
}

// 允许传完整 caseNumber、前缀或案件名，统一解析成 /list 里的完整 caseNumber。
async function resolveCaseNumber(input) {
  const key = typeof input === 'string' ? input.trim() : ''
  if (!key) return ''
  const data = await httpJson('/list')
  const list = Array.isArray(data?.indexes) ? data.indexes : []
  const hit =
    list.find((ix) => ix?.caseNumber === key) ??
    list.find((ix) => String(ix?.caseNumber ?? '').startsWith(key)) ??
    list.find((ix) => String(ix?.caseName ?? '').includes(key))
  return hit?.caseNumber ?? key
}

function withTarget(params) {
  const qs = new URLSearchParams()
  if (params.caseNumber) qs.set('caseNumber', params.caseNumber)
  if (params.db) qs.set('db', params.db)
  return qs
}

const TOOLS = [
  {
    name: 'index_list',
    description: '列出本机可用的 SeeU 案件索引（caseNumber / 案件名 / 记录数 / 数据库路径）。取证开始前先调用它确认要查哪个案件。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'evidence_list',
    description:
      '列出某案件的检材（eid / 名称 / 类型 / 入库记录数 / 火眼统计 / 原始文件 / 备注 / 火眼只读挂载路径）。回答「手机系统/型号/镜像」这类题先看备注；索引没有内容时用 mountPoint 翻火眼挂载目录。',
    inputSchema: {
      type: 'object',
      properties: {
        caseNumber: { type: 'string', description: '案件编号（完整、前缀或案件名均可）' },
        db: { type: 'string', description: '直接指定索引库路径（可选）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'index_search',
    description:
      '在案件索引里检索（≥3 字走 FTS5 trigram，短词走 LIKE），返回命中摘要。定位聊天、账号、URL、手机号等时用。',
    inputSchema: {
      type: 'object',
      properties: {
        caseNumber: { type: 'string', description: '案件编号（完整、前缀或案件名均可）' },
        db: { type: 'string', description: '直接指定索引库路径（可选）' },
        q: { type: 'string', description: '关键词' },
        limit: { type: 'number', description: '返回条数，默认 10，最大 50' },
      },
      required: ['q'],
      additionalProperties: false,
    },
  },
  {
    name: 'index_tables',
    description: '列出案件索引里的结构化表（表名 / 记录数），用于看有哪些可查的数据类型（聊天、联系人、浏览器历史等）。',
    inputSchema: {
      type: 'object',
      properties: {
        caseNumber: { type: 'string', description: '案件编号（完整、前缀或案件名均可）' },
        db: { type: 'string', description: '直接指定索引库路径（可选）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'chain_check',
    description:
      '链路体检：只读检查某案件「索引可打开 / 检索可用 / 火眼只读挂载可读 / 镜像可解析」，返回可读文本。深入取证前或查不到数据时先跑它；失败先修链路，不要用全盘 grep 代替。',
    inputSchema: {
      type: 'object',
      properties: {
        caseNumber: { type: 'string', description: '案件编号（完整、前缀或案件名均可）' },
        db: { type: 'string', description: '直接指定索引库路径（可选，替代 caseNumber）' },
        probe: { type: 'string', description: '检索验证用的关键词，默认 Investors' },
        images: { type: 'boolean', description: '是否顺带解析镜像（E01/DD），默认 false' },
      },
      additionalProperties: false,
    },
  },
]

async function callTool(name, args) {
  if (name === 'index_list') {
    const data = await httpJson('/list')
    const list = Array.isArray(data?.indexes) ? data.indexes : []
    if (!list.length) return textResult('没有找到案件索引。请先在面板里建库，或让用户确认检材已解析。')
    const lines = list.map((ix, i) => {
      const counts = ix?.counts ?? {}
      const records = counts.records ?? ix?.recordCount ?? '?'
      return `${i + 1}. ${ix?.caseName ?? '未命名'} · caseNumber=${ix?.caseNumber ?? '?'} · ${records} 条记录 · ${ix?.dbPath ?? ''}`
    })
    return textResult(`可用案件索引（${list.length} 个）：` + String.fromCharCode(10) + lines.join(String.fromCharCode(10)))
  }

  const target = {
    caseNumber: await resolveCaseNumber(args?.caseNumber),
    db: typeof args?.db === 'string' ? args.db : '',
  }

  if (name === 'evidence_list') {
    const data = await httpJson('/evidences?' + withTarget(target).toString())
    const rows = Array.isArray(data?.evidences) ? data.evidences : []
    if (!rows.length) return textResult('没有检材记录（索引可能还没建好）。')
    const lines = rows.map((ev) => {
      const parts = [
        `eid ${ev?.eid ?? '?'}`,
        ev?.name ?? '未命名',
        ev?.type ?? '',
        `入库 ${ev?.recordCount ?? '?'} / 火眼 ${ev?.reportedRecordCount ?? '?'}`,
        ev?.sourcePath ? `原始 ${ev.sourcePath}` : '',
        ev?.mountRoute ? `挂载 ${ev.mountRoute}` : ev?.mountPoint ? `挂载点 ${ev.mountPoint}` : '',
        ev?.remark ? `备注 ${firstLine(ev.remark)}` : '',
      ]
      return '- ' + parts.filter(Boolean).join(' · ')
    })
    return textResult(`检材（${rows.length} 个）：` + String.fromCharCode(10) + lines.join(String.fromCharCode(10)))
  }

  if (name === 'index_search') {
    const qs = withTarget(target)
    qs.set('q', String(args?.q ?? ''))
    const limit = Math.max(1, Math.min(50, Number(args?.limit) || 10))
    qs.set('limit', String(limit))
    const data = await httpJson('/search?' + qs.toString())
    const hits = Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.hits) ? data.hits : []
    if (!hits.length) return textResult(`没有命中「${args?.q ?? ''}」。`)
    const lines = hits.slice(0, limit).map((hit, i) => {
      const text = firstLine(hit?.snip ?? hit?.snippet ?? hit?.text ?? hit?.value ?? '')
      const where = [hit?.eid ? 'eid ' + hit.eid : '', hit?.app ?? '', hit?.ts ?? ''].filter(Boolean).join(' · ')
      return `${i + 1}. ${text}${where ? '  [' + where + ']' : ''}`
    })
    const engine = data?.engine ? `（引擎 ${data.engine}，共 ${data.total ?? hits.length} 命中）` : `（共 ${hits.length} 命中）`
    return textResult(`检索「${args?.q ?? ''}」${engine}：` + String.fromCharCode(10) + lines.join(String.fromCharCode(10)))
  }

  if (name === 'index_tables') {
    const data = await httpJson('/tables?' + withTarget(target).toString())
    const rows = Array.isArray(data?.tables) ? data.tables : []
    if (!rows.length) return textResult('没有结构化表（可能只有原始文件索引）。')
    const lines = rows.map((t) => `- ${t?.name ?? t?.table ?? '?'}${Number.isFinite(t?.count) ? ' · ' + t.count + ' 条' : ''}`)
    return textResult(`结构化表（${rows.length} 张）：` + String.fromCharCode(10) + lines.join(String.fromCharCode(10)))
  }

  if (name === 'chain_check') {
    const qs = new URLSearchParams({ text: '1' })
    if (target.caseNumber) qs.set('caseNumber', target.caseNumber)
    if (target.db) qs.set('db', target.db)
    if (typeof args?.probe === 'string' && args.probe) qs.set('probe', args.probe)
    if (args?.images === true) qs.set('images', '1')
    const text = await httpText('/chain-check?' + qs.toString())
    return textResult(text)
  }

  return textResult(`未知工具：${name}`, true)
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + String.fromCharCode(10))
}

async function handle(message) {
  const { id, method, params } = message ?? {}
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO } })
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
    try {
      send({ jsonrpc: '2.0', id, result: await callTool(params?.name, params?.arguments ?? {}) })
    } catch (error) {
      send({ jsonrpc: '2.0', id, result: textResult('工具调用失败：' + (error?.message ?? String(error)), true) })
    }
    return
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
}

let buffer = ''
let pending = 0
let ended = false

function maybeExit() {
  if (ended && pending === 0) process.exit(0)
}

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
        process.stderr.write('[seeu-mcp] ' + (error?.stack ?? String(error)) + String.fromCharCode(10))
      })
      .finally(() => {
        pending -= 1
        maybeExit()
      })
  }
})
process.stdin.on('end', () => {
  ended = true
  maybeExit()
})
process.on('uncaughtException', (error) => {
  process.stderr.write('[seeu-mcp] ' + (error?.stack ?? String(error)) + String.fromCharCode(10))
  process.exit(1)
})
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
