import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { cite, openIndex } from '../tools/ges-index/query.mjs'

function makeIndex() {
  const dir = mkdtempSync(join(tmpdir(), 'seeu-cite-'))
  const dbPath = join(dir, 'case-index.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    create table evidence(eid integer primary key, name text, person_name text, remark text);
    create table artifact(id integer primary key, eid integer, app text, account text, category text,
      subcat text, virtual_path text unique, base_handle text);
    create table record(id integer primary key, artifact_id integer, eid integer, app text, account text,
      category text, subcat text, row_no integer, line_no integer, ts text, actor text, body text,
      text text, fields_json text, origin_record_id text, citable integer, base_handle text);
    create virtual table record_fts using fts5(text, fields_text, tokenize='trigram');
  `)
  db.prepare('insert into evidence(eid,name,person_name,remark) values(?,?,?,?)').run(5, 'FUNG_CC_mobile.zip', null, 'iOS 备份')
  db.prepare('insert into artifact(id,eid,app,account,category,subcat,virtual_path,base_handle) values(?,?,?,?,?,?,?,?)')
    .run(1, 5, 'WhatsApp', '85254974406', 'msg', 'chat', '/case/检材分析数据/5/WhatsApp/chat.data.csv', 'Goldeneyes-CID')
  db.prepare('insert into record(id,artifact_id,eid,app,account,category,subcat,line_no,ts,text,base_handle) values(?,?,?,?,?,?,?,?,?,?,?)')
    .run(42, 1, 5, 'WhatsApp', '85254974406', 'msg', 'chat', 96, '2025-05-16 14:23:50', 'Investors 群创建', 'Goldeneyes-CID')
  db.prepare('insert into record(id,artifact_id,eid,app,account,category,subcat,line_no,ts,text,base_handle) values(?,?,?,?,?,?,?,?,?,?,?)')
    .run(43, 1, 5, 'WhatsApp', '85254974406', 'msg', 'chat', 97, '2025-05-16 14:24:00', '无句柄记录', null)
  db.close()
  const ro = openIndex(dbPath)
  return { db: ro, cleanup: () => { try { ro.close() } catch { /* 已关闭 */ } rmSync(dir, { recursive: true, force: true }) } }
}

test('cite 返回正文、溯源句柄与复核命令', () => {
  const { db, cleanup } = makeIndex()
  try {
    const one = cite(db, 42)
    assert.equal(one.id, 42)
    assert.equal(one.ev, 'FUNG_CC_mobile.zip')
    assert.equal(one.citable, true)
    assert.equal(one.citation, '[[1]](Goldeneyes-CID#96)')
    assert.match(one.verifyCmd, /^ges read /)
    assert.match(one.text, /Investors/)
    assert.ok(one.path.endsWith('chat.data.csv'))
  } finally {
    cleanup()
  }
})

test('cite 对无句柄记录标记不可引用', () => {
  const { db, cleanup } = makeIndex()
  try {
    const two = cite(db, 43)
    assert.equal(two.citable, false)
    assert.equal(two.citation, null)
    assert.match(two.verifyCmd, /无溯源句柄/)
  } finally {
    cleanup()
  }
})

test('cite 不存在的 id 抛 E_NOT_FOUND', () => {
  const { db, cleanup } = makeIndex()
  try {
    assert.throws(() => cite(db, 9999), (error) => error?.code === 'E_NOT_FOUND')
  } finally {
    cleanup()
  }
})
