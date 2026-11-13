import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { openIndex, search } from '../tools/ges-index/query.mjs'

function makeIndex(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'seeu-search-'))
  const dbPath = join(dir, 'case-index.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    create table record(
      id integer primary key, eid integer, app text, account text, category text,
      ts text, line_no integer, text text, body text
    );
    create virtual table record_fts using fts5(text, tokenize='trigram');
  `)
  const insert = db.prepare('insert into record(id,eid,app,account,category,ts,line_no,text,body) values(?,?,?,?,?,?,?,?,?)')
  const fts = db.prepare('insert into record_fts(rowid,text) values(?,?)')
  for (const r of rows) {
    insert.run(r.id, r.eid, r.app, r.account, r.category, r.ts, r.line_no, r.text, r.body ?? null)
    fts.run(r.id, r.text)
  }
  db.close()
  const ro = openIndex(dbPath)
  return { dir, db: ro, cleanup: () => { try { ro.close() } catch {} rmSync(dir, { recursive: true, force: true }) } }
}

test('长关键词走 FTS5，不再抛 ftsQuery is not defined', () => {
  const { db, cleanup } = makeIndex([
    { id: 1, eid: 5, app: 'WhatsApp', account: '85254974406', category: 'msg', ts: '2025-04-25 17:11:37', line_no: 10, text: 'Investors group 创建了群组' },
    { id: 2, eid: 5, app: '照片', account: '', category: 'file', ts: '2025-04-25 18:00:00', line_no: 11, text: 'IMG_0021.HEIC 拍摄自 iPhone SE' },
  ])
  try {
    const hit = search(db, { q: 'Investors', limit: 5 })
    assert.equal(hit.engine, 'fts5-trigram')
    assert.equal(hit.total, 1)
    assert.equal(hit.rows[0].id, 1)

    const hit2 = search(db, { q: 'IMG_0021', limit: 5 })
    assert.equal(hit2.total, 1)
    assert.equal(hit2.rows[0].id, 2)

    // 命中不到时返回 0，而不是抛错
    const none = search(db, { q: 'zzzznohit', limit: 5 })
    assert.equal(none.total, 0)
    assert.equal(none.rows.length, 0)
  } finally {
    cleanup()
  }
})

test('短关键词走 LIKE 兜底，空关键词报 E_NO_QUERY', () => {
  const { db, cleanup } = makeIndex([
    { id: 3, eid: 1, app: '微信', account: 'wxid_abc', category: 'msg', ts: '2025-01-01 00:00:00', line_no: 1, text: 'ab 测试' },
  ])
  try {
    const hit = search(db, { q: 'ab', limit: 5 })
    assert.equal(hit.engine, 'like')
    assert.equal(hit.total, 1)

    assert.throws(() => search(db, { q: '  ' }), (e) => e.code === 'E_NO_QUERY')
  } finally {
    cleanup()
  }
})
