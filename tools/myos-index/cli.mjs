#!/usr/bin/env node
/**
 * MYOS（超级取证大师）取证结果导入 SeeU 索引库的命令行。
 *
 * 用法：
 *   node tools/myos-index/cli.mjs cases [--keyword 关键字]
 *   node tools/myos-index/cli.mjs materials --case <caseId>
 *   node tools/myos-index/cli.mjs tables --db <结果库.mfs>
 *   node tools/myos-index/cli.mjs import --case <caseId> --db <结果库.mfs> --sql "<select ...>" \
 *     --out <案件目录> [--case-name 名称] [--evidence 检材名] [--max-rows 2000] [--app 应用]
 *
 * 注意：需要「超级取证大师」正在运行；MCP 服务端默认
 * `D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe`，可用 SEEU_MYOS_MCP 覆盖。
 */
import { resolve } from 'node:path'
import { withMyosClient } from './mcp.mjs'
import { importMyosRows, listMyosCases, listMyosMaterials, readMyosRows } from './import.mjs'

const USAGE = `用法：
  node tools/myos-index/cli.mjs cases [--keyword 关键字]
  node tools/myos-index/cli.mjs materials --case <caseId>
  node tools/myos-index/cli.mjs tables --db <结果库.mfs>
  node tools/myos-index/cli.mjs import --case <caseId> --db <结果库.mfs> --sql "<select ...>" --out <案件目录> [--append] [--case-name 名称] [--evidence 检材名] [--max-rows 2000] [--app 应用]

说明：--append 追加到已有索引（同一案件多个检材/多张表）；不带时整库重建。

说明：先启动「超级取证大师」；路径可用 SEEU_MYOS_MCP 覆盖（默认 D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe）。`

/** 解析 `--key value` 形式的参数。 */
export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item.startsWith('--')) {
      const key = item.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else {
        out[key] = next
        i += 1
      }
    } else {
      out._.push(item)
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  if (!command || command === 'help' || args.help) {
    console.log(USAGE)
    return
  }
  const log = (message) => console.error(`[myos] ${message}`)
  await withMyosClient(async (client) => {
    if (command === 'cases') {
      const cases = await listMyosCases(client, { keyword: typeof args.keyword === 'string' ? args.keyword : '' })
      console.log(JSON.stringify({ cases }, null, 2))
      return
    }
    if (command === 'materials') {
      if (!args.case) throw new Error('materials 需要 --case <caseId>')
      const materials = await listMyosMaterials(client, String(args.case))
      console.log(JSON.stringify({ materials }, null, 2))
      return
    }
    if (command === 'tables') {
      if (!args.db) throw new Error('tables 需要 --db <结果库.mfs>')
      const { rows } = await readMyosRows(client, {
        dbPath: String(args.db),
        sql: "select name from sqlite_master where type='table' order by name",
        maxRows: 500,
      })
      console.log(JSON.stringify({ tables: rows.map((row) => Object.values(row)[0]) }, null, 2))
      return
    }
    if (command === 'import') {
      for (const key of ['case', 'db', 'sql', 'out']) {
        if (!args[key] || args[key] === true) throw new Error(`import 需要 --${key}`)
      }
      const caseId = String(args.case)
      log(`打开案件 ${caseId}（若已打开会自动复用）`)
      try {
        await client.call('myos-forensics.open_case', { caseId, timeoutMs: 120000 })
      } catch (error) {
        log(`open_case 跳过：${error instanceof Error ? error.message : String(error)}`)
      }
      const maxRows = Number(args['max-rows'] ?? 2000)
      log(`查询 ${args.db}（最多 ${maxRows} 行）`)
      const { columns, rows, truncated } = await readMyosRows(client, {
        dbPath: String(args.db),
        sql: String(args.sql),
        maxRows,
      })
      if (rows.length === 0) throw new Error('查询没有返回任何行，检查 --sql 与 --db')
      const caseName = typeof args['case-name'] === 'string' ? args['case-name'] : `MYOS 案件 ${caseId}`
      const result = importMyosRows({
        dbPath: resolve(String(args.out)),
        caseName,
        caseNumber: `myos-${caseId}`,
        evidenceName: typeof args.evidence === 'string' ? args.evidence : `MYOS ${caseId}`,
        columns,
        rows,
        sourceDb: String(args.db),
        sql: String(args.sql),
        app: typeof args.app === 'string' ? args.app : '',
        casePath: typeof args['case-path'] === 'string' ? args['case-path'] : '',
        mode: args.append ? 'append' : 'rebuild',
      })
      console.log(JSON.stringify({ ok: true, truncated, ...result }, null, 2))
      return
    }
    throw new Error(`未知命令：${command}\n\n${USAGE}`)
  }, { log })
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('cli.mjs')) {
  main().catch((error) => {
    console.error(`[myos] 失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
