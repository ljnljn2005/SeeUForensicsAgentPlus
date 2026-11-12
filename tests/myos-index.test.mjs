/**
 * MYOS 导入器单测：MCP 客户端握手、案件/检材/行读取、落库映射。
 * 用 tests/fixtures/fake-myos-mcp.mjs 作为假服务端，不需要真实 MYOS。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../tools/myos-index/cli.mjs'
import { findIndexes } from '../tools/ges-index/query.mjs'
import { indexSummary } from '../tools/ges-index/index-meta.mjs'
import { guessTableName, importMyosRows, listMyosCases, listMyosMaterials, mapMyosRow, normalizeMyosCases, readMyosRows } from '../tools/myos-index/import.mjs'
import { MyosMcpClient } from '../tools/myos-index/mcp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = join(HERE, 'fixtures', 'fake-myos-mcp.mjs')
const clientEnv = { ...process.env, SEEU_MYOS_MCP: FAKE, SEEU_MYOS_NODE: process.execPath }

function withClient(fn) {
  return async () => {
    const client = new MyosMcpClient({ env: clientEnv, timeoutMs: 15000 })
    try {
      await client.start()
      return await fn(client)
    } finally {
      await client.close()
    }
  }
}

test('MCP 客户端：握手 + 列工具 + 调用工具', withClient(async (client) => {
  const tools = await client.listTools()
  assert.ok(tools.some((tool) => tool.name === 'myos-forensics.query_cases'))
  const payload = await client.call('myos-forensics.query_cases', {})
  assert.equal(payload.cases.length, 2)
}))

test('MCP 客户端：工具报错会抛异常并带服务端文本', withClient(async (client) => {
  await assert.rejects(() => client.call('myos-forensics.not_exist', {}), /unknown tool/)
}))

test('listMyosCases / listMyosMaterials 归一', withClient(async (client) => {
  const cases = await listMyosCases(client, { keyword: '甲' })
  assert.deepEqual(cases.map((item) => item.caseId), ['case-1', 'case-2'])
  const materials = await listMyosMaterials(client, 'case-1')
  assert.equal(materials.length, 2)
  assert.equal(materials[0].name, '手机-data.D01')
  assert.equal(materials[0].status, '取证完成')
}))

test('readMyosRows 返回列、行与截断标记', withClient(async (client) => {
  const result = await readMyosRows(client, {
    dbPath: 'D:/MYOS/Case/案件甲/dev/手机-data.D01/data/MApps.mfs',
    sql: 'select * from TBL_APPDATA_MANAGER limit 3',
    maxRows: 10,
  })
  assert.deepEqual(result.columns, ['appName', 'time', 'content', 'uin'])
  assert.equal(result.rows.length, 3)
  assert.equal(result.truncated, true)
}))

test('mapMyosRow：应用/时间/账号识别，正文包含主列与其余列', () => {
  const columns = ['appName', 'time', 'content', 'uin']
  const mapped = mapMyosRow({ appName: '微信', time: '2026-01-02 03:04:05', content: '转账 100 元', uin: 'wxid_abc' }, columns)
  assert.equal(mapped.app, '微信')
  assert.equal(mapped.account, 'wxid_abc')
  assert.equal(mapped.ts, '2026-01-02 03:04:05')
  assert.match(mapped.text, /转账 100 元/)
  assert.match(mapped.text, /uin=wxid_abc/)
})

test('guessTableName / normalizeMyosCases 容错', () => {
  assert.equal(guessTableName('SELECT * FROM "TBL_APPDATA_MANAGER" LIMIT 3'), 'TBL_APPDATA_MANAGER')
  assert.equal(guessTableName(''), 'unknown')
  assert.deepEqual(normalizeMyosCases({ rows: [] }), [])
})

test('importMyosRows：建库、写记录、实体与 FTS 可检索', withClient(async (client) => {
  const root = mkdtempSync(join(tmpdir(), 'seeu-myos-'))
  try {
    const { columns, rows } = await readMyosRows(client, {
      dbPath: 'D:/MYOS/Case/案件甲/dev/手机-data.D01/data/MApps.mfs',
      sql: 'select * from TBL_APPDATA_MANAGER limit 3',
      maxRows: 10,
    })
    const out = join(root, '案件甲')
    const result = importMyosRows({
      dbPath: out,
      caseName: '案件甲',
      caseNumber: 'myos-case-1',
      evidenceName: '手机-data.D01',
      columns,
      rows,
      sourceDb: 'D:/MYOS/Case/案件甲/dev/手机-data.D01/data/MApps.mfs',
      sql: 'select * from TBL_APPDATA_MANAGER limit 3',
    })
    assert.ok(existsSync(result.dbFile))
    assert.equal(result.records, 3)
    assert.ok(result.entities >= 2, '应识别出手机号/邮箱等实体')

    const db = new DatabaseSync(result.dbFile, { readOnly: true })
    try {
      const evidence = db.prepare('select * from evidence where eid = 1').get()
      assert.equal(evidence.name, '手机-data.D01')
      assert.equal(evidence.type, 'myos')
      assert.match(evidence.source_path, /MApps\.mfs$/)
      const meta = Object.fromEntries(db.prepare('select k, v from meta').all().map((row) => [row.k, row.v]))
      assert.equal(meta.tool, 'seeu-myso-import')
      assert.equal(meta.case_number, 'myos-case-1')
      const count = db.prepare('select count(*) n from record').get().n
      assert.equal(count, 3)
      const fts = db.prepare("select count(*) n from record_fts where record_fts match 'wxid_abc'").get().n
      assert.equal(fts, 2)
      const entities = db.prepare('select kind, count(*) n from entity group by kind order by kind').all()
      assert.ok(entities.some((row) => row.n > 0))
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test('parseArgs：--key value 与布尔开关', () => {
  const args = parseArgs(['import', '--case', 'c1', '--db', 'x.mfs', '--force'])
  assert.deepEqual(args._, ['import'])
  assert.equal(args.case, 'c1')
  assert.equal(args.db, 'x.mfs')
  assert.equal(args.force, true)
})

test('导入后的索引能被面板发现（findIndexes + manifest）', withClient(async (client) => {
  const root = mkdtempSync(join(tmpdir(), 'seeu-myos-found-'))
  try {
    const caseDir = join(root, '案件丙')
    const { columns, rows } = await readMyosRows(client, {
      dbPath: 'D:/MYOS/Case/案件丙/dev/手机-data.D01/data/MApps.mfs',
      sql: 'select * from TBL_APPDATA_MANAGER limit 3',
      maxRows: 10,
    })
    importMyosRows({
      dbPath: caseDir,
      caseName: '案件丙',
      caseNumber: 'myos-case-3',
      evidenceName: '手机-data.D01',
      columns,
      rows,
      sourceDb: 'D:/MYOS/Case/案件丙/dev/手机-data.D01/data/MApps.mfs',
      sql: 'select * from TBL_APPDATA_MANAGER limit 3',
    })
    const found = findIndexes([caseDir])
    assert.equal(found.length, 1)
    assert.equal(found[0].caseNumber, 'myos-case-3')
    assert.equal(found[0].caseName, '案件丙')
    assert.ok(found[0].counts, '应读到 manifest.json 的 counts')
    assert.equal(found[0].counts.records, 3)
    const summary = indexSummary(found[0])
    assert.match(summary.text, /3 条记录|记录/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))
