import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

import { entity } from '../tools/ges-index/query.mjs'

const makeDb = () => {
  const db = new DatabaseSync(':memory:')
  db.exec('create table entity (id integer primary key, record_id integer, eid integer, kind text, value_norm text)')
  const ins = db.prepare('insert into entity (record_id, eid, kind, value_norm) values (?, ?, ?, ?)')
  // 12 个不同值：u0..u7（url，出现次数递减）+ m0..m3（mail）
  let id = 1
  for (let i = 0; i < 8; i += 1) {
    for (let k = 0; k <= 7 - i; k += 1) ins.run(id, 1 + (k % 2), 'url', `https://u${i}.example.com`)
    id += 1
  }
  for (let i = 0; i < 4; i += 1) {
    ins.run(id, 1, 'mail', `m${i}@example.com`)
    id += 1
  }
  return db
}

test('entity：limit/offset/total/next 分页，翻页不重叠', () => {
  const db = makeDb()
  const p1 = entity(db, { limit: 5, offset: 0 })
  assert.equal(p1.total, 12)
  assert.equal(p1.offset, 0)
  assert.equal(p1.returned, 5)
  assert.equal(p1.next, 5)
  assert.equal(p1.rows[0].value, 'https://u0.example.com')
  assert.equal(p1.rows[0].count, 8)

  const p2 = entity(db, { limit: 5, offset: p1.next })
  assert.equal(p2.offset, 5)
  assert.equal(p2.returned, 5)
  assert.equal(p2.next, 10)
  const v1 = new Set(p1.rows.map((r) => r.value))
  assert.equal(p2.rows.filter((r) => v1.has(r.value)).length, 0)

  const p3 = entity(db, { limit: 5, offset: p2.next })
  assert.equal(p3.returned, 2)
  assert.equal(p3.next, null)
})

test('entity：kind 过滤后 total 只算该类别', () => {
  const db = makeDb()
  const mail = entity(db, { kind: 'mail', limit: 3 })
  assert.equal(mail.total, 4)
  assert.equal(mail.returned, 3)
  assert.equal(mail.rows.every((r) => r.kind === 'mail'), true)
  const url = entity(db, { kind: 'url', limit: 50 })
  assert.equal(url.total, 8)
  assert.equal(url.returned, 8)
})
