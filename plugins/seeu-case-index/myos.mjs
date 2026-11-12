// MYOS（超级取证大师）取证结果导入：供面板调用的宿主端逻辑。
//
// 面板的「从 MYOS 导入」按钮走这里：
//   列案件 → 选案件看检材 → 选检材查结果库里的表 → 选表导入成 SeeU 索引。
// 依赖 MYOS 正在运行（MCP 服务端由 MYOS 提供），未启动时给出可读的错误。
import { dirname, join, resolve } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
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
export async function myosTables(db, { caseId = '', materialId = '', name = '' } = {}) {
  let dbPath = String(db ?? '').trim()
  // 中文路径经控制台/HTTP 转码容易变成乱码（服务端看到的字节与 MYOS 里的不一致），
  // 所以允许只给「案件 + 检材 + 库文件名」，由插件自己从 MCP 发现绝对路径。
  if (!dbPath && name) {
    const id = String(caseId ?? '').trim()
    const dbs = await myosResultDbs({ caseId: id, materialId: String(materialId ?? '').trim() })
    const wanted = String(name).trim().toLowerCase()
    const hit = dbs.find((item) => String(item.path).split(/[\\/]/).pop().toLowerCase() === wanted)
    if (!hit) throw fail(`在案件/检材里找不到结果库 ${name}（可用 /myos/dbs 查看）`, 404)
    dbPath = hit.path
  }
  if (!dbPath) throw fail('缺少 db（结果库 .mfs 路径，或 caseId+materialId+name）')
  const { rows } = await call((client) =>
    readMyosRows(client, { dbPath, sql: "select name from sqlite_master where type='table' order by name", maxRows: 500 }),
  )
  return { dbPath, tables: rows.map((row) => String(Object.values(row)[0] ?? '')).filter(Boolean) }
}

/**
 * 列出某案件/检材在 MYOS 里的结果库（.mfs），面板用来做下拉选择。
 * 手机检材需要 materialId，计算机案件需要 caseId；拿不到的调用会被忽略。
 */
export async function myosResultDbs({ caseId = '', materialId = '' } = {}) {
  const id = String(caseId ?? '').trim()
  const mid = String(materialId ?? '').trim()
  if (!id && !mid) throw fail('缺少 caseId 或 materialId')
  const dbs = await call((client) => listMyosResultDbs(client, { caseId: id, materialId: mid }))
  return [...dbs, ...collectRootDbs(dbs)]
}

/**
 * MYOS 自动发现通常只给「按 app 拆分的子库」（data/MApps/<App>{guid}.mfs），
 * 根库 data/MApps.mfs、data/FSData.mfs 等不在列表里。这里从每个已发现路径往上找
 * 同目录下的根库，补进下拉，避免用户手打路径（中文路径经控制台/HTTP 会转码）。
 */
export function collectRootDbs(dbs, { maxDepth = 3 } = {}) {
  const extra = []
  const seen = new Set(dbs.map((item) => String(item.path).toLowerCase()))
  for (const item of dbs) {
    let dir = dirname(String(item.path))
    for (let depth = 0; depth < maxDepth; depth += 1) {
      let entries = []
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        break
      }
      for (const entry of entries) {
        if (!entry.isFile() || !/\.mfs$/i.test(entry.name)) continue
        const full = join(dir, entry.name)
        const key = full.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        extra.push({ path: full, name: entry.name, tables: [], source: 'root' })
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return extra
}

/**
 * 把一张表的查询结果导入 SeeU 索引库。
 * outDir 是案件目录（会写 `<outDir>/.seeu-index/case-index.db`）。
 */
export async function myosImport({ caseId, db, sql, outDir, caseName, evidenceName, app = '', maxRows = 2000, mode = 'rebuild' } = {}) {
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
      mode: mode === 'append' ? 'append' : 'rebuild',
    })
    return { ...imported, truncated, rows: rows.length, caseDir }
  })
  return result
}


/** 按「库文件名」解析绝对路径；避免中文路径在控制台/HTTP 里被转码成乱码。 */
async function resolveDbByName({ caseId, materialId, name }) {
  const dbs = await myosResultDbs({ caseId: String(caseId ?? '').trim(), materialId: String(materialId ?? '').trim() })
  const wanted = String(name ?? '').trim().toLowerCase()
  const hit = dbs.find((item) => String(item.path).split(/[\/]/).pop().toLowerCase() === wanted)
  if (hit) return hit.path
  // MYOS 自动发现通常只给到「按 app 拆分的子库」（例如 data/MApps/<App>{guid}.mfs），
  // 而根库 data/MApps.mfs 不在列表里：从已发现路径往上找同名文件。
  const seen = new Set()
  for (const item of dbs) {
    let dir = dirname(String(item.path))
    for (let depth = 0; depth < 3; depth += 1) {
      const candidate = join(dir, String(name ?? ''))
      if (!seen.has(candidate)) {
        seen.add(candidate)
        if (existsSync(candidate)) return candidate
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw fail(`在案件/检材里找不到结果库 ${name}（可用 /myos/dbs 查看已发现的库）`, 404)
}

/**
 * 批量导入：一次把结果库里选中的多张表写入同一个 SeeU 索引（追加模式）。
 * 每张表各算一个检材（eid 递增），面板显示每张表的记录数。
 */
export async function myosImportBatch({ caseId, db, dbName = '', materialId = '', tables, outDir, caseName, evidenceName, app = '', maxRows = 2000, onProgress = null } = {}) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const caseDir = resolve(String(outDir ?? ''))
  if (!outDir) throw fail('缺少 outDir（案件目录）')
  let dbPath = String(db ?? '').trim()
  if (!dbPath && dbName) dbPath = await resolveDbByName({ caseId, materialId, name: dbName })
  if (!dbPath) throw fail('缺少 db（结果库 .mfs 路径，或 dbName + caseId/materialId）')
  const list = (Array.isArray(tables) ? tables : []).map((item) => String(item ?? '').trim()).filter(Boolean)
  if (list.length === 0) throw fail('缺少 tables（要导入的表）')
  const limit = Math.min(Math.max(Number(maxRows) || 2000, 1), 20000)
  const id = String(caseId ?? '').trim()
  const baseName = String(evidenceName ?? '').trim() || 'MYOS 检材'

  return call(async (client) => {
    if (id) {
      try {
        await client.call('myos-forensics.open_case', { caseId: id, timeoutMs: 120000 })
      } catch {
        // 忽略：结果库能读就行。
      }
    }
    const items = []
    const skipped = []
    let dbFile = ''
    let totals = null
    progress({ phase: 'start', index: 0, total: list.length })
    for (const [offset, table] of list.entries()) {
      progress({ phase: 'table', index: offset + 1, total: list.length, table })
      const statement = `select * from ${JSON.stringify(table)} limit ${limit}`
      let payload
      try {
        payload = await readMyosRows(client, { dbPath, sql: statement, maxRows: limit })
      } catch (error) {
        skipped.push({ table, reason: error instanceof Error ? error.message : String(error) })
        continue
      }
      if (!payload.rows.length) {
        skipped.push({ table, reason: '没有数据' })
        continue
      }
      const imported = importMyosRows({
        dbPath: caseDir,
        caseName: String(caseName ?? '').trim() || `MYOS 案件 ${id || 'unknown'}`,
        caseNumber: id ? `myos-${id}` : `myos-${Date.now()}`,
        evidenceName: `${baseName} · ${table}`,
        columns: payload.columns,
        rows: payload.rows,
        sourceDb: dbPath,
        sql: statement,
        app: String(app ?? '') || table,
        mode: 'append',
      })
      dbFile = imported.dbFile
      totals = imported.totals
      const item = { table, records: imported.records, entities: imported.entities, eid: imported.eid, truncated: payload.truncated }
      items.push(item)
      progress({ phase: 'imported', index: offset + 1, total: list.length, table, records: item.records, entities: item.entities, totals })
    }
    if (items.length === 0) throw fail('选中的表都没有数据（可换表或调大 SQL）', 422)
    progress({ phase: 'done', index: list.length, total: list.length, tables: items.length, skipped: skipped.length, totals })
    return { ok: true, dbFile, caseDir, caseName, evidenceName: baseName, mode: 'append', tables: items, skipped, totals }
  })
}

/**
 * 预估每张表的行数（导入前预览，避免把空表/巨型表一起导）。
 * count(*) 只查一行，代价远小于导入；失败的表单独标 error。
 */
export async function myosTableCounts({ caseId, db, dbName = '', materialId = '', tables, maxTables = 200 } = {}) {
  let dbPath = String(db ?? '').trim()
  if (!dbPath && dbName) dbPath = await resolveDbByName({ caseId, materialId, name: dbName })
  if (!dbPath) throw fail('缺少 db（结果库 .mfs 路径，或 dbName + caseId/materialId）')
  const list = (Array.isArray(tables) ? tables : []).map((item) => String(item ?? '').trim()).filter(Boolean)
  if (list.length === 0) throw fail('缺少 tables（要预估的表）')
  const id = String(caseId ?? '').trim()
  const picked = list.slice(0, Math.min(Math.max(Number(maxTables) || 200, 1), 1000))

  return call(async (client) => {
    if (id) {
      try {
        await client.call('myos-forensics.open_case', { caseId: id, timeoutMs: 120000 })
      } catch {
        // 忽略：结果库能读就行。
      }
    }
    const rows = []
    for (const table of picked) {
      const statement = `select count(*) as n from ${JSON.stringify(table)}`
      try {
        const payload = await readMyosRows(client, { dbPath, sql: statement, maxRows: 1 })
        const first = payload.rows[0] ?? {}
        const value = first.n ?? first.count ?? Object.values(first)[0] ?? 0
        const count = Number(value)
        rows.push({ table, count: Number.isFinite(count) ? count : 0 })
      } catch (error) {
        rows.push({ table, count: null, error: error instanceof Error ? error.message : String(error) })
      }
    }
    const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.count) ? row.count : 0), 0)
    return { ok: true, tables: rows, total }
  })
}
