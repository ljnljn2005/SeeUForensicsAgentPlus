#!/usr/bin/env node
/**
 * 测试用假 MYOS MCP 服务端（stdio + JSON-RPC 行协议子集）。
 *
 * 支持：initialize / notifications/initialized / tools/list / tools/call。
 * 数据是固定的，只为验证 SeeU 的导入器与客户端，不连真实 MYOS。
 */
let buffer = ''

const TOOLS = [
  'myos-forensics.query_cases',
  'myos-forensics.open_case',
  'myos-forensics.query_materials',
  'myos-forensics.query_device_info',
  'myos-forensics.sqlite_query',
].map((name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } }))

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function textResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError }
}

function handle(call) {
  const { id, method, params } = call
  if (method === 'initialize') {
    reply(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-myos', version: '1.0.0' },
    })
    return
  }
  if (method === 'notifications/initialized') return
  if (method === 'tools/list') {
    reply(id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments ?? {}
    if (name === 'myos-forensics.query_cases') {
      reply(id, textResult({ cases: [
        { caseId: 'case-1', caseName: '案件甲', displayName: '甲', casePath: 'D:/MYOS/Case/案件甲' },
        { caseId: 'case-2', caseName: '案件乙', displayName: '', casePath: 'D:/MYOS/Case/案件乙' },
      ] }))
      return
    }
    if (name === 'myos-forensics.open_case') {
      reply(id, textResult({ ok: true, caseId: args.caseId }))
      return
    }
    if (name === 'myos-forensics.query_materials') {
      reply(id, textResult({ materials: [
        { materialId: 'm1', name: '手机-data.D01', frscStatusName: '取证完成', typeCode: 1, fileSize: 123 },
        { materialId: 'm2', name: '手机-sdcard.D01', frscStatusName: '解析中', typeCode: 1, fileSize: 456 },
      ] }))
      return
    }
    if (name === 'myos-forensics.sqlite_query') {
      const sql = String(args.sql ?? '')
      if (/sqlite_master/i.test(sql)) {
        reply(id, textResult({ columns: ['name'], rows: [{ name: 'TBL_APPDATA_MANAGER' }], truncated: false }))
        return
      }
      reply(id, textResult({
        columns: ['appName', 'time', 'content', 'uin'],
        rows: [
          { appName: '微信', time: '2026-01-02 03:04:05', content: '转账给张三 100 元，电话 13800138000', uin: 'wxid_abc' },
          { appName: 'QQ', time: '2026-02-03 04:05:06', content: '登录 IP 10.0.0.5，邮箱 a@b.com', uin: '10001' },
          { appName: '微信', time: '2026-03-04 05:06:07', content: '文件 hash 0xdeadbeef', uin: 'wxid_abc' },
        ],
        truncated: true,
        rowCount: 3,
      }))
      return
    }
    reply(id, textResult({ message: `unknown tool: ${name}` }, true))
    return
  }
  if (id !== undefined) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })}\n`)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    try {
      handle(JSON.parse(line))
    } catch {
      // 忽略坏行。
    }
  }
})
