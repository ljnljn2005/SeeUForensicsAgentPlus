import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

import { facets } from '../tools/ges-index/query.mjs'

const makeDb = () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`create table record (id integer primary key, artifact_id integer, eid integer, app text, account text, category text, subcat text, row_no integer, line_no integer, ts text, actor text, body text, text text, fields_json text, origin_record_id text, citable integer, base_handle text)`)
  const ins = db.prepare('insert into record (eid, app, account, category) values (?, ?, ?, ?)')
  const rows = [
    [1, 'WhatsApp', 'acc1', '聊天记录'],
    [1, 'WhatsApp', 'acc1', '聊天记录'],
    [1, 'WhatsApp', 'acc2', '通讯录'],
    [1, '微信', 'acc3', '聊天记录'],
    [2, 'WhatsApp', 'acc1', '聊天记录'],
    [2, '苹果健康', null, '健康数据'],
    [2, '', null, '其他'],
  ]
  for (const r of rows) ins.run(...r)
  return db
}

const asMap = (arr, key) => Object.fromEntries(arr.map((x) => [x[key], x.n]))

test('facets：按 app/category/account 分组计数，过滤空值，首项是计数最大的', () => {
  const db = makeDb()
  const f = facets(db)
  assert.equal(f.eid, null)
  assert.deepEqual(asMap(f.apps, 'app'), { WhatsApp: 4, 微信: 1, 苹果健康: 1 })
  assert.equal(f.apps.length, 3)
  assert.equal(f.apps[0].app, 'WhatsApp')
  assert.deepEqual(asMap(f.categories, 'category'), { 聊天记录: 4, 通讯录: 1, 健康数据: 1, 其他: 1 })
  assert.deepEqual(asMap(f.accounts, 'account'), { acc1: 3, acc2: 1, acc3: 1 })
})

test('facets：eid 过滤只统计该检材', () => {
  const db = makeDb()
  const f = facets(db, { eid: 2 })
  assert.equal(f.eid, 2)
  assert.deepEqual(asMap(f.apps, 'app'), { WhatsApp: 1, 苹果健康: 1 })
  assert.equal(f.apps.length, 2)
  assert.equal(asMap(f.categories, 'category')['聊天记录'], 1)
})

test('facets：空库返回空数组而不是抛错', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('create table record (id integer primary key, eid integer, app text, account text, category text)')
  const f = facets(db)
  assert.deepEqual(f.apps, [])
  assert.deepEqual(f.categories, [])
  assert.deepEqual(f.accounts, [])
})
