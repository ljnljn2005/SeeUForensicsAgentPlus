/**
 * MYOS（超级取证大师）取证结果 → SeeU 案件索引库（case-index.db）导入器。
 *
 * 数据来源分两步：
 *   1. 通过 MYOS MCP 的 `query_*_forensics_results_overview` 拿到结果库（*.mfs）路径；
 *   2. 通过 `sqlite_query` 只读查询这些库，把行写入 SeeU 的 case-index.db。
 *
 * 这里只做「结构映射 + 落库」，不做业务判断；MYOS 的 .mfs 是加密/专有格式，
 * 直接读会报「file is not a database」，必须走 MCP。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DDL, SCHEMA_VERSION, extractEntities } from '../ges-index/parse.mjs'

export const TOOL = 'seeu-myso-import'
export const TOOL_VERSION = '0.1.0'

/** 一列里像「应用名」的字段名。 */
const APP_KEYS = ['app', 'appname', 'app_name', 'pkgname', 'package', 'package_name', '应用', '应用名']
/** 一列里像「账号」的字段名。 */
const ACCOUNT_KEYS = ['account', 'user', 'username', 'userid', 'uin', 'wxid', 'phone', '账号', '手机号', '用户']
/** 一列里像「时间」的字段名。 */
const TIME_KEYS = ['time', 'ts', 'datetime', 'date', 'timestamp', 'occurtime', 'createtime', '更新时间', '时间']
/** 一列里像「正文」的字段名。 */
const TEXT_KEYS = ['content', 'text', 'body', 'data', 'value', 'message', 'msg', 'detail', 'summary', '内容', '正文']

const normKey = (key) => String(key).toLowerCase().replace(/[\s_-]+/g, '')

function pickColumn(columns, candidates) {
  const normalized = columns.map((column) => ({ column, norm: normKey(column) }))
  for (const candidate of candidates) {
    const hit = normalized.find((item) => item.norm === normKey(candidate))
    if (hit) return hit.column
  }
  return undefined
}

/** 把值转成字符串（对象转 JSON，null 转空串）。 */
function asText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 从一列里挑出最像时间的一列，返回它的值（没有就空串）。 */
function pickTimestamp(row, column) {
  if (!column) return ''
  return asText(row[column]).trim()
}

/**
 * 把 MYOS sqlite_query 的一行映射成 SeeU 记录字段。
 * @param {Record<string, unknown>} row
 * @param {string[]} columns
 * @returns {{ts:string, text:string, app:string, account:string, fields:Record<string, unknown>}}
 */
export function mapMyosRow(row, columns) {
  const app = asText(row[pickColumn(columns, APP_KEYS)] ?? '').trim()
  const account = asText(row[pickColumn(columns, ACCOUNT_KEYS)] ?? '').trim()
  const ts = pickTimestamp(row, pickColumn(columns, TIME_KEYS))
  const primary = pickColumn(columns, TEXT_KEYS)
  const parts = []
  for (const column of columns) {
    if (column === primary) continue
    const value = asText(row[column]).trim()
    if (value) parts.push(`${column}=${value}`)
  }
  const head = primary ? asText(row[primary]).trim() : ''
  const text = [head, parts.join(' | ')].filter(Boolean).join(' | ')
  return { ts, text, app, account, fields: row }
}

/** 从 SQL 里猜表名（用来做 subcat 与日志展示）。 */
export function guessTableName(sql) {
  const match = /\bfrom\s+["'`[]?([A-Za-z0-9_.$]+)/i.exec(String(sql ?? ''))
  return match ? match[1] : 'unknown'
}

/**
 * 把一次 sqlite_query 结果导入一个全新的 SeeU 索引库。
 *
 * @param {object} options
 * @param {string} options.dbPath 输出目录（会写 `<dbPath>/.seeu-index/case-index.db`；传入 .db 路径则直接写该文件）
 * @param {string} options.caseName 案件名
 * @param {string} options.caseNumber 案号（默认 myos-<时间戳>）
 * @param {string} options.evidenceName 检材名（例如「手机-data.D01」）
 * @param {string[]} options.columns 列名
 * @param {Record<string, unknown>[]} options.rows 行
 * @param {string} options.sourceDb MYOS 结果库路径（写进 evidence.source_path）
 * @param {string} options.sql 查询语句（写进 evidence.remark，便于复现）
 * @param {string} [options.app] 覆盖应用名
 * @param {string} [options.casePath] MYOS 案件目录
 * @returns {{dbFile:string, records:number, entities:number, evidenceName:string}}
 */
export function importMyosRows(options) {
  const { dbPath, caseName, caseNumber, evidenceName, columns, rows, sourceDb, sql, app, casePath } = options
  if (!dbPath) throw new Error('缺少输出目录')
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('没有列名，无法导入')
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('没有可导入的行')
  const dbFile = /\.db$/i.test(dbPath) ? dbPath : join(dbPath, '.seeu-index', 'case-index.db')
  mkdirSync(dirname(dbFile), { recursive: true })
  // 导入是「整库重建」，避免旧记录与新结果混在一起。
  if (existsSync(dbFile)) rmSync(dbFile, { force: true })

  const db = new DatabaseSync(dbFile)
  try {
    db.exec('pragma journal_mode = wal;')
    db.exec(DDL)
    const now = new Date().toISOString()
    const cn = caseNumber || `myos-${Date.now()}`
    const meta = db.prepare('insert or replace into meta(k,v) values(?,?)')
    meta.run('tool', TOOL)
    meta.run('tool_version', TOOL_VERSION)
    meta.run('schema_version', String(SCHEMA_VERSION))
    meta.run('case_number', cn)
    meta.run('case_name', caseName ?? '')
    meta.run('source', 'myos')
    meta.run('source_db', sourceDb ?? '')
    meta.run('source_sql', String(sql ?? ''))
    meta.run('built_at', now)
    const caseInfo = db.prepare('insert or replace into case_info(k,v) values(?,?)')
    caseInfo.run('case_number', cn)
    caseInfo.run('name', caseName ?? '')
    caseInfo.run('location', casePath ?? '')

    db.prepare(
      `insert or replace into evidence(eid,name,holder,platform,type,timezone,md5,sha1,sha256,size_bytes,source_path,storage_path,created,updated,raw_json,person_name,remark,evidence_number,record_count)
       values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      1,
      evidenceName ?? 'MYOS 检材',
      '',
      'myos',
      'myos',
      '',
      '',
      '',
      '',
      null,
      sourceDb ?? '',
      '',
      now,
      now,
      JSON.stringify({ caseName, casePath, sourceDb }),
      '',
      `由 MYOS MCP 导入（${guessTableName(sql)}）；原始 SQL：${String(sql ?? '').slice(0, 500)}`,
      '',
      rows.length,
    )

    const table = guessTableName(sql)
    const artifactId = Number(
      db
        .prepare(
          `insert into artifact(eid,app,account,category,subcat,virtual_path,kind,base_handle,node_id,line_count,record_count,citable,citable_reason,ingested_at)
           values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(1, app ?? '', '', 'myos', table, `myos://${cn}/${table}`, 'myos', `myos:${cn}`, table, rows.length, rows.length, 1, '', now)
        .lastInsertRowid,
    )

    const insertRecord = db.prepare(
      `insert into record(artifact_id,eid,app,account,category,subcat,row_no,line_no,ts,actor,body,text,fields_json,origin_record_id,citable,base_handle)
       values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    const insertFts = db.prepare('insert into record_fts(rowid,text,fields_text) values(?,?,?)')
    const insertEntity = db.prepare('insert into entity(kind,value_norm,record_id,eid) values(?,?,?,?)')
    const entitySeen = new Set()
    let entities = 0
    rows.forEach((row, index) => {
      const mapped = mapMyosRow(row, columns)
      const result = insertRecord.run(
        artifactId,
        1,
        mapped.app,
        mapped.account,
        'myos',
        table,
        index + 1,
        index + 1,
        mapped.ts,
        '',
        mapped.text,
        mapped.text,
        JSON.stringify(mapped.fields),
        '',
        1,
        `myos:${cn}`,
      )
      const recordId = Number(result.lastInsertRowid)
      insertFts.run(recordId, mapped.text, mapped.text)
      for (const entity of extractEntities(mapped.text)) {
        const key = `${entity.kind}\u0000${entity.value}`
        if (entitySeen.has(key)) continue
        entitySeen.add(key)
        insertEntity.run(entity.kind, entity.value, recordId, 1)
        entities += 1
      }
    })
    db.prepare('insert into ingest_log(leaf,kind,status,lines,records,ms,error,base_handle,citable) values(?,?,?,?,?,?,?,?,?)').run(
      sourceDb ?? table,
      'myos',
      'ok',
      rows.length,
      rows.length,
      0,
      '',
      `myos:${cn}`,
      1,
    )
    db.exec('pragma wal_checkpoint(truncate);')
    // 写 manifest.json，让面板/会话概览能显示规模与建库时间（与 ges 建库同一口径）。
    const builtAt = new Date().toISOString()
    const manifest = {
      tool: TOOL,
      toolVersion: TOOL_VERSION,
      schemaVersion: SCHEMA_VERSION,
      builtAt,
      durationMs: 0,
      counts: { records: rows.length, entities, artifacts: 1, evidences: 1 },
      leaves: { total: 1, ok: 1, failed: 0 },
      coverageOk: true,
      integrityOk: true,
      source: { kind: 'myos', dbPath: sourceDb ?? '', table },
    }
    writeFileSync(join(dirname(dbFile), 'manifest.json'), `${JSON.stringify(manifest, null, 2)}
`)
    return { dbFile, records: rows.length, entities, evidenceName: evidenceName ?? 'MYOS 检材' }
  } finally {
    db.close()
  }
}

/** 归一 query_cases 的返回（兼容 `{cases:[]}` 与直接数组）。 */
export function normalizeMyosCases(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.cases) ? payload.cases : []
  return list
    .map((item) => ({
      caseId: String(item?.caseId ?? item?.caseid ?? item?.id ?? ''),
      caseName: String(item?.caseName ?? item?.casename ?? item?.name ?? ''),
      displayName: String(item?.displayName ?? item?.displayname ?? ''),
      casePath: String(item?.casePath ?? item?.casepath ?? ''),
    }))
    .filter((item) => item.caseId || item.caseName)
}

/** 列出 MYOS 案件（需要 MYOS 正在运行）。 */
export async function listMyosCases(client, { keyword = '' } = {}) {
  const payload = await client.call('myos-forensics.query_cases', keyword ? { keyword } : {})
  return normalizeMyosCases(payload)
}

/** 列出某个案件的检材。 */
export async function listMyosMaterials(client, caseId) {
  const payload = await client.call('myos-forensics.query_materials', { caseId, statusOnly: true })
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.materials) ? payload.materials : []
  return list.map((item) => ({
    materialId: String(item?.materialId ?? item?.id ?? ''),
    name: String(item?.name ?? item?.displayName ?? ''),
    status: String(item?.frscStatusName ?? item?.frscStatusText ?? ''),
    typeCode: item?.typeCode ?? '',
    fileSize: item?.fileSize ?? 0,
  }))
}

/** 通过 MCP 只读查询一个 MYOS 结果库，返回归一后的列与行。 */
export async function readMyosRows(client, { dbPath, sql, maxRows = 2000 }) {
  const payload = await client.call('myos-forensics.sqlite_query', { dbPath, sql, maxRows })
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.rows) ? payload.rows : []
  const columns = Array.isArray(payload?.columns) && payload.columns.length > 0 ? payload.columns.map(String) : Object.keys(rows[0] ?? {})
  return { columns, rows, truncated: Boolean(payload?.truncated), rowCount: payload?.rowCount ?? rows.length }
}

/**
 * 从 MYOS 结果概览的任意 JSON 里收集结果库路径（`*.mfs`）与表名提示。
 *
 * MYOS 的 `query_phone_forensics_results_overview` / `query_computer_forensics_results_overview`
 * 返回结构随版本变化（有时嵌在 `material` 下，有时是 `results` 数组，有时是
 * `sqliteQueryHints` 里「文件名 → 表名数组」），所以这里做深度遍历：
 *   - 任何以 `.mfs` 结尾的字符串都当成结果库路径；
 *   - `{"xxx.mfs": ["TBL_A", ...]}` 形式记录成该文件的表名提示。
 */
export function collectMfsPaths(payload) {
  const paths = new Set()
  const hints = new Map()
  const walk = (node) => {
    if (typeof node === 'string') {
      const text = node.trim()
      if (/\.mfs$/i.test(text) && text.length > 4) paths.add(text)
      return
    }
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        const text = value.trim()
        if (/\.mfs$/i.test(text) && text.length > 4) paths.add(text)
        continue
      }
      if (Array.isArray(value) && /\.mfs$/i.test(key)) {
        const tables = value.filter((item) => typeof item === 'string' && item.trim())
        if (tables.length) hints.set(normalizeBase(key), tables.map((item) => item.trim()))
        continue
      }
      walk(value)
    }
  }
  walk(payload)
  const byBase = new Map([...hints.entries()])
  return [...paths].map((path) => ({
    path,
    tables: byBase.get(normalizeBase(path)) ?? [],
  }))
}

function normalizeBase(path) {
  return String(path).split(/[\/]/).pop()?.toLowerCase() ?? ''
}

/**
 * 列出某案件/检材的结果库（.mfs）。
 * 手机检材走 `query_phone_forensics_results_overview`（需要 materialId），
 * 计算机案件走 `query_computer_forensics_results_overview`（需要 caseId）；
 * 任一调用失败都忽略，返回能拿到的部分。
 */
export async function listMyosResultDbs(client, { caseId = '', materialId = '' } = {}) {
  const found = new Map()
  const merge = (payload) => {
    for (const item of collectMfsPaths(payload)) {
      const hit = found.get(item.path)
      if (!hit) found.set(item.path, item)
      else if (!hit.tables.length && item.tables.length) hit.tables = item.tables
    }
  }
  if (materialId) {
    try {
      merge(await client.call('myos-forensics.query_phone_forensics_results_overview', { caseMaterialId: materialId }))
    } catch {
      // 忽略：可能不是手机检材。
    }
  }
  if (caseId) {
    try {
      merge(await client.call('myos-forensics.query_computer_forensics_results_overview', { caseId }))
    } catch {
      // 忽略：可能没有计算机检材。
    }
  }
  return [...found.values()]
}
