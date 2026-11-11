import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CASE_DATA_ROOT,
  classifyPath,
  parseCsvLine,
  parseCsvRow,
  parseChat,
  extractEntities,
  SCHEMA_VERSION,
} from '../tools/ges-index/parse.mjs'

test('classifyPath：检材/应用/类别/文件（WhatsApp 图片消息）', () => {
  const p = classifyPath(`${CASE_DATA_ROOT}未指定持有人/3/WhatsApp/图片消息/Foodies(120363401679693148@g.us)/data.csv`)
  assert.equal(p.holder, '未指定持有人')
  assert.equal(p.eid, 3)
  assert.equal(p.app, 'WhatsApp')
  assert.equal(p.account, null)
  assert.equal(p.category, '图片消息')
  assert.equal(p.subcat, 'Foodies(120363401679693148@g.us)')
  assert.equal(p.fileName, 'data.csv')
  assert.equal(p.kind, 'csv')
})

test('classifyPath：社交应用第二段识别为账号（微信 图片消息 的账号目录）', () => {
  const p = classifyPath(`${CASE_DATA_ROOT}未指定持有人/3/微信/U+1F495~Ling~🎶(wxid_abc)/图片消息/data.csv`)
  assert.equal(p.app, '微信')
  assert.equal(p.account, 'U+1F495~Ling~🎶(wxid_abc)')
  assert.equal(p.category, '图片消息')
})

test('classifyPath：chat.txt 判定为 chat，多级 subcat 保留', () => {
  const p = classifyPath(`${CASE_DATA_ROOT}未指定持有人/5/微信/群聊消息/群A/chat.txt`)
  assert.equal(p.kind, 'chat')
  assert.equal(p.category, '群聊消息')
  assert.equal(p.subcat, '群A')
})

test('classifyPath：不在检材分析数据根下也不崩，eid 为 null', () => {
  const p = classifyPath('/case/关联分析/持有人/检材持有人/data.csv')
  assert.equal(p.eid, null)
  assert.equal(p.kind, 'csv')
})

test('parseCsvLine：引号内的逗号与双写引号', () => {
  assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c'])
  assert.deepEqual(parseCsvLine('"a,1",b,"he said ""hi"""'), ['a,1', 'b', 'he said "hi"'])
  assert.deepEqual(parseCsvLine(''), [''])
})

test('parseCsvRow：字段、事件时间、行为人（不把创建时间当事件时间）', () => {
  const header = ['名称', '号码', '类型', '时间', '内容', '创建时间']
  const row = parseCsvRow('12,85254877240,接收,2025-04-07 15:09:29,你好,2026-11-09T12:00:00Z', header)
  assert.equal(row.ts, '2025-04-07 15:09:29')
  assert.equal(row.actor, '12') // 名称优先于号码
  assert.equal(row.fields['内容'], '你好')
  assert.equal(row.cells.length, header.length)
})

test('parseCsvRow：缺列不越界，空行为空字段', () => {
  const row = parseCsvRow('', ['a', 'b'])
  assert.deepEqual(row.fields, { a: '', b: '' })
  assert.equal(row.ts, null)
  assert.equal(row.actor, null)
})

test('parseChat：摘要行（含/不含本机发送）+ 消息行 + 原文记录ID', () => {
  const lines = [
    { no: 1, content: '[摘要] 时间: 2025-04-08 ~ 2025-04-09 | 消息: 12条（本机发送8条）' },
    { no: 2, content: '2025-04-08 11:27:38 `陳民浩` 说：你好' },
    { no: 3, content: '2025-04-08 11:28:00 `💕~Ling~💕🎶`[本机] 说：在' },
    { no: 4, content: '2025-04-08 11:29:00 `` 说：系统消息' },
    { no: 5, content: '〔原文记录ID：9988〕2025-04-08 11:30:00 `陳民浩` 说：带原文ID' },
  ]
  const r = parseChat(lines)
  assert.equal(r.header.msgCount, 12)
  assert.equal(r.header.sent, 8)
  assert.equal(r.header.from, '2025-04-08')
  assert.equal(r.header.to, '2025-04-09')
  assert.equal(r.messages.length, 4)
  assert.equal(r.messages[0].speaker, '陳民浩')
  assert.equal(r.messages[0].ts, '2025-04-08 11:27:38')
  assert.equal(r.messages[1].isLocal, 1)
  assert.equal(r.messages[2].speaker, '') // 群系统消息发言人为空，但不能丢
})

test('parseChat：群聊摘要没有「本机发送N条」也能解析', () => {
  const r = parseChat([
    { no: 1, content: '[摘要] 时间: 2023-06-30 ~ 2025-05-09 | 消息: 12条' },
    { no: 2, content: '2025-05-09 10:00:00 `群成员` 说：hi' },
  ])
  assert.equal(r.header.msgCount, 12)
  assert.equal(r.header.sent, null)
  assert.equal(r.messages.length, 1)
})

test('parseChat：非消息行进 rows（保留行号供引用）', () => {
  const r = parseChat([
    { no: 1, content: '[摘要] 时间: 2025-01-01 ~ 2025-01-02 | 消息: 1条' },
    { no: 2, content: '这一行不是消息格式' },
  ])
  assert.equal(r.messages.length, 0)
  // 摘要行不进 rows（它没有行号级引用价值），其余非消息行保留
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].no, 2)
})

test('extractEntities：手机号去空格、邮箱/URL 命中、超长文本跳过', () => {
  const got = extractEntities('联系 +852 5487 7240 或 a.b@example.com 或 https://x.test/a')
  const kinds = new Set(got.map((e) => e.kind))
  assert.ok(kinds.has('phone'))
  assert.ok(kinds.has('email'))
  assert.ok(kinds.has('url'))
  assert.equal(extractEntities('x'.repeat(5000)).length, 0)
})

test('SCHEMA_VERSION 与 v0.2.x 一致（改 schema 必须同步此断言与文档）', () => {
  assert.equal(SCHEMA_VERSION, 4)
})
