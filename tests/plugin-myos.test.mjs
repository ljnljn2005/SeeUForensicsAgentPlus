/**
 * 面板「从 MYOS 导入」宿主端逻辑（plugins/seeu-case-index/myos.mjs）单测。
 * 用假 MYOS MCP 服务端，不需要真实 MYOS。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { myosCases, myosImport, myosImportBatch, myosMaterials, myosResultDbs, myosTableCounts, myosTables } from '../plugins/seeu-case-index/myos.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAKE = join(HERE, 'fixtures', 'fake-myos-mcp.mjs')
const env = { ...process.env, SEEU_MYOS_MCP: FAKE, SEEU_MYOS_NODE: process.execPath }

function withEnv(fn) {
  return async () => {
    const saved = { mcp: process.env.SEEU_MYOS_MCP, node: process.env.SEEU_MYOS_NODE }
    Object.assign(process.env, env)
    try {
      return await fn()
    } finally {
      if (saved.mcp === undefined) delete process.env.SEEU_MYOS_MCP
      else process.env.SEEU_MYOS_MCP = saved.mcp
      if (saved.node === undefined) delete process.env.SEEU_MYOS_NODE
      else process.env.SEEU_MYOS_NODE = saved.node
    }
  }
}

test('myosCases：列出假 MYOS 的两个案件', withEnv(async () => {
  const cases = await myosCases({})
  assert.equal(cases.length, 2)
  assert.equal(cases[0].caseId, 'case-1')
}))

test('myosMaterials：缺 caseId 时 400', withEnv(async () => {
  await assert.rejects(() => myosMaterials(''), (error) => error.status === 400)
}))

test('myosTables：经 MCP sqlite_master 读表名', withEnv(async () => {
  const result = await myosTables('D:/MYOS/Case/案件甲/dev/手机-data.D01/data/MApps.mfs')
  assert.deepEqual(result.tables, ['TBL_APPDATA_MANAGER'])
  assert.equal(result.dbPath, 'D:/MYOS/Case/案件甲/dev/手机-data.D01/data/MApps.mfs')
  // 只给「案件 + 检材 + 库文件名」时，插件自己从 MCP 发现绝对路径（避免中文路径转码）。
  const byName = await myosTables('', { caseId: 'case-1', materialId: 'm1', name: 'MApps.mfs' })
  assert.deepEqual(byName.tables, ['TBL_APPDATA_MANAGER'])
  assert.match(byName.dbPath, /MApps\.mfs$/)
}))

test('myosImport：写 SeeU 索引并返回统计', withEnv(async () => {
  const root = mkdtempSync(join(tmpdir(), 'seeu-myos-plugin-'))
  try {
    const outDir = join(root, '案件甲')
    const result = await myosImport({
      caseId: 'case-1',
      db: 'D:/MYOS/Case/案件甲/dev/手机-data.D01/data/MApps.mfs',
      sql: 'select * from TBL_APPDATA_MANAGER limit 3',
      outDir,
      caseName: '案件甲',
      evidenceName: '手机-data.D01',
    })
    assert.equal(result.records, 3)
    assert.ok(result.entities >= 2)
    assert.ok(existsSync(result.dbFile))
    const db = new DatabaseSync(result.dbFile, { readOnly: true })
    try {
      assert.equal(db.prepare('select count(*) n from record').get().n, 3)
      assert.equal(db.prepare('select type from evidence').get().type, 'myos')
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test('myosImport：缺 outDir 时 400', withEnv(async () => {
  await assert.rejects(() => myosImport({ db: 'x.mfs', sql: 'select 1' }), (error) => error.status === 400)
}))

test('MYOS 未启动/找不到服务端时给出 503 与提示', async () => {
  const saved = process.env.SEEU_MYOS_MCP
  process.env.SEEU_MYOS_MCP = join(tmpdir(), 'not-exist-myos-server.exe')
  try {
    await assert.rejects(() => myosCases({}), (error) => {
      assert.equal(error.status, 503)
      assert.match(error.message, /MYOS MCP 服务端|MYOS 没在运行/)
      return true
    })
  } finally {
    if (saved === undefined) delete process.env.SEEU_MYOS_MCP
    else process.env.SEEU_MYOS_MCP = saved
  }
})

test('myosResultDbs：从结果概览自动发现 .mfs 路径', withEnv(async () => {
  const dbs = await myosResultDbs({ caseId: 'case-1', materialId: 'm1' })
  assert.equal(dbs.length, 2)
  assert.ok(dbs.some((item) => item.path.endsWith('MApps.mfs') && item.tables.length === 1))
}))

test('myosResultDbs：缺 caseId/materialId 时 400', withEnv(async () => {
  await assert.rejects(() => myosResultDbs({}), (error) => error.status === 400)
}))

test('myosImportBatch：多张表追加进同一索引，每张表一个检材', withEnv(async () => {
  const root = mkdtempSync(join(tmpdir(), 'seeu-myos-batch-'))
  try {
    const outDir = join(root, '案件戊')
    const result = await myosImportBatch({
      caseId: 'case-1',
      db: 'D:/MYOS/Case/案件戊/dev/手机-data.D01/data/MApps.mfs',
      tables: ['TBL_APPDATA_MANAGER', 'TBL_CHAT'],
      outDir,
      caseName: '案件戊',
      evidenceName: '手机-data.D01',
    })
    assert.equal(result.ok, true)
    assert.equal(result.tables.length, 2)
    assert.equal(result.tables[0].eid, 1)
    assert.equal(result.tables[1].eid, 2)
    assert.ok(result.totals.records >= 4)
    assert.equal(result.totals.evidences, 2)
    const db = new DatabaseSync(result.dbFile, { readOnly: true })
    try {
      assert.equal(db.prepare('select count(*) n from evidence').get().n, 2)
      const names = db.prepare('select name from evidence order by eid').all().map((row) => row.name)
      assert.match(names[0], /TBL_APPDATA_MANAGER/)
      assert.match(names[1], /TBL_CHAT/)
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test('myosImportBatch：缺 tables 时报 400', withEnv(async () => {
  await assert.rejects(
    () => myosImportBatch({ caseId: 'case-1', db: 'D:/x.mfs', outDir: tmpdir(), tables: [] }),
    (error) => error.status === 400,
  )
}))

test('myosImportBatch：onProgress 按表回报进度', withEnv(async () => {
  const root = mkdtempSync(join(tmpdir(), 'seeu-myos-progress-'))
  try {
    const events = []
    const result = await myosImportBatch({
      caseId: 'case-1',
      db: 'D:/MYOS/Case/案件己/dev/手机-data.D01/data/MApps.mfs',
      tables: ['TBL_A', 'TBL_B'],
      outDir: join(root, '案件己'),
      caseName: '案件己',
      evidenceName: '手机-data.D01',
      onProgress: (event) => events.push(event),
    })
    assert.deepEqual(events.map((event) => event.phase), ['start', 'table', 'imported', 'table', 'imported', 'done'])
    assert.equal(events[1].index, 1)
    assert.equal(events[3].index, 2)
    assert.equal(events.at(-1).tables, 2)
    assert.equal(result.tables.length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}))

test('myosTableCounts：预估每张表行数，空表为 0', withEnv(async () => {
  const result = await myosTableCounts({
    caseId: 'case-1',
    db: 'D:/MYOS/Case/案件庚/dev/手机-data.D01/data/MApps.mfs',
    tables: ['TBL_A', 'TBL_EMPTY'],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.tables.map((item) => [item.table, item.count]), [['TBL_A', 42], ['TBL_EMPTY', 0]])
  assert.equal(result.total, 42)
}))

test('myosTableCounts：缺 tables 时报 400', withEnv(async () => {
  await assert.rejects(
    () => myosTableCounts({ caseId: 'case-1', db: 'D:/x.mfs', tables: [] }),
    (error) => error.status === 400,
  )
}))
