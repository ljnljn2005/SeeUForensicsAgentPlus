import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { resolveDbParam } from '../plugins/seeu-case-index/index.js'

// 中文路径 + 临时案件库：验证「只传 caseNumber」也能解析出 db（避免中文路径经 shell/HTTP 乱码）
const root = mkdtempSync(join(tmpdir(), 'seeu-dbparam-'))
const caseDir = join(root, '案件甲_中文路径')
const indexDir = join(caseDir, '.seeu-index')
const dbPath = join(indexDir, 'case-index.db')
mkdirSync(indexDir, { recursive: true })
{
  const db = new DatabaseSync(dbPath)
  db.exec('create table meta (k text primary key, v text)')
  db.prepare('insert into meta (k, v) values (?, ?)').run('case_number', 'case-abc-123')
  db.prepare('insert into meta (k, v) values (?, ?)').run('case_name', '跨案夹具A')
  db.close()
}

process.env.SEEU_INDEX_SEARCH_DIRS = root

test('resolveDbParam：db 参数照旧可用', () => {
  const abs = resolveDbParam(new URLSearchParams({ db: dbPath }))
  assert.equal(abs.replace(/\\/g, '/').toLowerCase(), dbPath.replace(/\\/g, '/').toLowerCase())
})

test('resolveDbParam：用 caseNumber 解析到 db（中文路径无需出现在 URL 里）', () => {
  const abs = resolveDbParam(new URLSearchParams({ caseNumber: 'case-abc-123' }))
  assert.ok(abs.endsWith('case-index.db'))
  assert.ok(abs.includes('.seeu-index'))
})

test('resolveDbParam：用 case 别名 / caseDir / 案件名都能解析', () => {
  for (const params of [
    new URLSearchParams({ case: 'case-abc-123' }),
    new URLSearchParams({ caseDir }),
    new URLSearchParams({ caseNumber: '跨案夹具A' }),
  ]) {
    const abs = resolveDbParam(params)
    assert.ok(abs.endsWith('case-index.db'), 'should resolve ' + params.toString())
  }
})

test('resolveDbParam：未知案件号 → 404；完全缺参 → 400', () => {
  assert.throws(() => resolveDbParam(new URLSearchParams({ caseNumber: 'no-such-case' })), (error) => error.status === 404)
  assert.throws(() => resolveDbParam(new URLSearchParams({})), (error) => error.status === 400)
})

test.after(() => {
  rmSync(root, { recursive: true, force: true })
})
