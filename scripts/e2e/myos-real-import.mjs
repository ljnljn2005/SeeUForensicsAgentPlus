#!/usr/bin/env node
// 真实 MYOS（超级取证大师）端到端：MCP 列案件 → 结果库 → 导入 SeeU 索引。
// MYOS 未运行时自动跳过（ok:true, skipped:true），不会让回归链失败。
//
// 用法：
//   node scripts/e2e/myos-real-import.mjs
//   SEEU_MYOS_CASE=案件20261015145357 SEEU_MYOS_DB=<*.mfs> SEEU_MYOS_SQL='select ...' node scripts/e2e/myos-real-import.mjs
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findIndexes } from '../../tools/ges-index/query.mjs'
import { withMyosClient } from '../../tools/myos-index/mcp.mjs'
import {
  importMyosRows,
  listMyosCases,
  listMyosMaterials,
  listMyosResultDbs,
  readMyosRows,
} from '../../tools/myos-index/import.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const OUT = process.env.SEEU_MYOS_E2E_OUT || join(ROOT, '.dev', 'myos-e2e')
const CASE_KEYWORD = process.env.SEEU_MYOS_CASE || ''
const DB_OVERRIDE = process.env.SEEU_MYOS_DB || ''
const SQL_OVERRIDE = process.env.SEEU_MYOS_SQL || ''

function pickDb(dbs) {
  if (DB_OVERRIDE) return dbs.find((item) => item.path.toLowerCase() === DB_OVERRIDE.toLowerCase()) ?? { path: DB_OVERRIDE, tables: [] }
  // 优先选带表名提示的库（MYOS 概览的 sqliteQueryHints），其次 MApps.mfs。
  return dbs.find((item) => item.tables.length > 0) ?? dbs.find((item) => /MApps\.mfs$/i.test(item.path)) ?? dbs[0] ?? null
}

function pickSql(db) {
  if (SQL_OVERRIDE) return SQL_OVERRIDE
  const table = db.tables[0] || 'TBL_APPDATA_MANAGER'
  return `select * from "${table}" limit 200`
}

async function main() {
  const report = { ok: false, skipped: false, errors: [] }
  try {
    await withMyosClient(async (client) => {
      const cases = await listMyosCases(client, {})
      const hit = cases.find((item) => !CASE_KEYWORD || item.caseName === CASE_KEYWORD || item.caseId === CASE_KEYWORD) ?? cases[0]
      if (!hit) {
        report.skipped = true
        report.ok = true
        report.reason = 'MYOS 可用但没有案件'
        return
      }
      report.case = { id: hit.caseId, name: hit.caseName }
      const materials = await listMyosMaterials(client, hit.caseId)
      report.materials = materials.map((item) => item.name)

      let dbs = []
      for (const material of materials) {
        const found = await listMyosResultDbs(client, { caseId: hit.caseId, materialId: material.materialId })
        dbs.push(...found.map((item) => ({ ...item, material: material.name })))
        if (dbs.some((item) => item.tables.length > 0)) break
      }
      if (dbs.length === 0) {
        const found = await listMyosResultDbs(client, { caseId: hit.caseId })
        dbs = found.map((item) => ({ ...item, material: '' }))
      }
      report.resultDbs = dbs.slice(0, 8)
      const db = pickDb(dbs)
      if (!db) {
        report.skipped = true
        report.ok = true
        report.reason = '案件里没有可导入的 .mfs 结果库'
        return
      }
      const sql = pickSql(db)
      const { columns, rows, truncated } = await readMyosRows(client, { dbPath: db.path, sql, maxRows: 200 })
      if (rows.length === 0) {
        report.skipped = true
        report.ok = true
        report.reason = `查询没有返回行：${sql}`
        return
      }
      rmSync(OUT, { recursive: true, force: true })
      const result = importMyosRows({
        dbPath: OUT,
        caseName: `${hit.caseName}-MYOS`,
        caseNumber: `myos-${hit.caseId}`,
        evidenceName: db.material || 'MYOS 结果库',
        columns,
        rows,
        sourceDb: db.path,
        sql,
      })
      report.import = { ...result, rows: rows.length, truncated, sql }
      const indexes = findIndexes([OUT])
      report.discovered = indexes.map((item) => ({ caseName: item.caseName, dbPath: item.dbPath }))
      if (!existsSync(join(OUT, '.seeu-index', 'case-index.db'))) throw new Error('导入后没有生成 case-index.db')
      if (result.records !== rows.length) throw new Error(`记录数不一致：${result.records} != ${rows.length}`)
      if (indexes.length !== 1) throw new Error('findIndexes 没有发现导入的索引')
      report.ok = true
    })
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error))
    if (/MYOS|请先运行|ENOENT|mcp|MCP/i.test(report.errors[0])) {
      report.skipped = true
      report.ok = true
      report.reason = `MYOS 未运行或 MCP 不可用：${report.errors[0]}`
      report.errors = []
    }
  }
  console.log('REPORT', JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

main()
