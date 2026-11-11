import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvLine, recordsCsv, RECORD_CSV_HEADER } from '../tools/ges-index/csv.mjs';

test('csvCell 转义逗号、引号与换行', () => {
  assert.equal(csvCell('普通'), '普通');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('他说"你好"'), '"他说""你好"""');
  assert.equal(csvCell('第一行\n第二行'), '"第一行\n第二行"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
});

test('csvLine 用逗号拼接并逐格转义', () => {
  assert.equal(csvLine(['a', 'b,c', 1]), 'a,"b,c",1');
});

test('recordsCsv 带 BOM、CRLF 与表头，行字段映射正确', () => {
  const rows = [
    { id: 'rec-1', eid: 3, ev: 'LEUNG_YL_mobile.zip', app: 'WhatsApp', account: '852...', cat: '群聊消息', sub: '消息', ts: '2025-04-16 11:21:53', line: 120, text: '是否加密,是' },
    { id: 'rec-2', eid: 1, ev: null, app: '微信', account: '', cat: '基本信息', sub: null, ts: '2025-01-01 00:00:00', line: 7, text: '含"引号"' },
  ];
  const csv = recordsCsv(rows);
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], RECORD_CSV_HEADER.join(','));
  assert.equal(lines[1], '3,LEUNG_YL_mobile.zip,WhatsApp,852...,群聊消息,消息,2025-04-16 11:21:53,120,rec-1,"是否加密,是"');
  assert.ok(lines[2].includes('"含""引号"""'));
  assert.equal(lines.at(-1), '');
});

test('recordsCsv 可关闭 BOM（写给非 Excel 消费者时）', () => {
  const csv = recordsCsv([], { bom: false });
  assert.ok(csv.startsWith(RECORD_CSV_HEADER[0]));
  assert.ok(!csv.includes('\uFEFF'));
  assert.equal(csv, RECORD_CSV_HEADER.join(',') + '\r\n');
});
