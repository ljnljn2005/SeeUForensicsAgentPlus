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
import { myosCases, myosImport, myosMaterials, myosResultDbs, myosTables } from '../plugins/seeu-case-index/myos.mjs'

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
  const tables = await myosTables('D:/MYOS/Case/案件甲/dev/手机-data.D01/data/MApps.mfs')
  assert.deepEqual(tables, ['TBL_APPDATA_MANAGER'])
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
