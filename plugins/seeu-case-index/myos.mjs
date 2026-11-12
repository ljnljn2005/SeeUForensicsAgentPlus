// MYOS（超级取证大师）取证结果导入：供面板调用的宿主端逻辑。
//
// 面板的「从 MYOS 导入」按钮走这里：
//   列案件 → 选案件看检材 → 选检材查结果库里的表 → 选表导入成 SeeU 索引。
// 依赖 MYOS 正在运行（MCP 服务端由 MYOS 提供），未启动时给出可读的错误。
import { resolve } from 'node:path'
import { withMyosClient } from '../../tools/myos-index/mcp.mjs'
import { importMyosRows, listMyosCases, listMyosMaterials, listMyosResultDbs, readMyosRows } from '../../tools/myos-index/import.mjs'

const MCP_HINT = '请先启动「超级取证大师」（MYOS），连上后重试。'

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

/** MYOS 未启动/调用失败时统一成一句可操作的话。 */
function myosError(error) {
  const text = error instanceof Error ? error.message : String(error)
  if (/请先运行 MYOS|拒绝：请先运行/.test(text)) return fail(`MYOS 没在运行：${MCP_HINT}`, 503)
  if (/找不到 MYOS MCP 服务端/.test(text)) return fail(`${text}${text.includes('SEEU_MYOS_MCP') ? '' : '；可设置 SEEU_MYOS_MCP 指向 myos_mcp_server.exe。'}`, 503)
  if (/ENOENT|not found|spawn/i.test(text)) return fail(`找不到 MYOS MCP 服务端：${text}。可设置 SEEU_MYOS_MCP 指向 myos_mcp_server.exe。`, 503)
  return fail(`调用 MYOS 失败：${text}`, 502)
}

async function call(fn) {
  try {
    return await withMyosClient(fn, { timeoutMs: 120000 })
  } catch (error) {
    throw myosError(error)
  }
}

/** 列出 MYOS 案件（可按关键字过滤）。 */
export async function myosCases({ keyword = '' } = {}) {
  return call((client) => listMyosCases(client, { keyword: String(keyword ?? '') }))
}

/** 列出某案件的检材。 */
export async function myosMaterials(caseId) {
  const id = String(caseId ?? '').trim()
  if (!id) throw fail('缺少 caseId')
  return call((client) => listMyosMaterials(client, id))
}

/** 列出结果库（.mfs）里的表：只认 sqlite_master，走 MYOS 的只读 sqlite_query。 */
export async function myosTables(db) {
  const dbPath = String(db ?? '').trim()
  if (!dbPath) throw fail('缺少 db（结果库 .mfs 路径）')
  const { rows } = await call((client) =>
    readMyosRows(client, { dbPath, sql: "select name from sqlite_master where type='table' order by name", maxRows: 500 }),
  )
  return rows.map((row) => String(Object.values(row)[0] ?? '')).filter(Boolean)
}

/**
 * 列出某案件/检材在 MYOS 里的结果库（.mfs），面板用来做下拉选择。
 * 手机检材需要 materialId，计算机案件需要 caseId；拿不到的调用会被忽略。
 */
export async function myosResultDbs({ caseId = '', materialId = '' } = {}) {
  const id = String(caseId ?? '').trim()
  const mid = String(materialId ?? '').trim()
  if (!id && !mid) throw fail('缺少 caseId 或 materialId')
  return call((client) => listMyosResultDbs(client, { caseId: id, materialId: mid }))
}

/**
 * 把一张表的查询结果导入 SeeU 索引库。
 * outDir 是案件目录（会写 `<outDir>/.seeu-index/case-index.db`）。
 */
export async function myosImport({ caseId, db, sql, outDir, caseName, evidenceName, app = '', maxRows = 2000 } = {}) {
  const caseDir = resolve(String(outDir ?? ''))
  if (!outDir) throw fail('缺少 outDir（案件目录）')
  const dbPath = String(db ?? '').trim()
  if (!dbPath) throw fail('缺少 db（结果库 .mfs 路径）')
  const statement = String(sql ?? '').trim()
  if (!statement) throw fail('缺少 sql（要导入的查询语句）')
  const limit = Math.min(Math.max(Number(maxRows) || 2000, 1), 20000)
  const id = String(caseId ?? '').trim()

  const result = await call(async (client) => {
    if (id) {
      // 打开案件不是必须的（只读查库即可），失败也不阻断导入。
      try {
        await client.call('myos-forensics.open_case', { caseId: id, timeoutMs: 120000 })
      } catch {
        // 忽略：结果库能读就行。
      }
    }
    const { columns, rows, truncated } = await readMyosRows(client, { dbPath, sql: statement, maxRows: limit })
    if (rows.length === 0) throw fail('查询没有返回任何行：检查 sql 与 db 是否正确', 422)
    const imported = importMyosRows({
      dbPath: caseDir,
      caseName: String(caseName ?? '').trim() || `MYOS 案件 ${id || 'unknown'}`,
      caseNumber: id ? `myos-${id}` : `myos-${Date.now()}`,
      evidenceName: String(evidenceName ?? '').trim() || 'MYOS 检材',
      columns,
      rows,
      sourceDb: dbPath,
      sql: statement,
      app: String(app ?? ''),
    })
    return { ...imported, truncated, rows: rows.length, caseDir }
  })
  return result
}
