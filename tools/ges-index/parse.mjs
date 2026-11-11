// 解析层：CSV / chat.txt 解析、路径分类（含账号层）、实体抽取、建库 DDL。

export const CASE_DATA_ROOT = '/case/检材分析数据/';

// 火眼已知的"类别"目录名（用于把路径切成 app / account / category / subcat）
const KNOWN_CATS = new Set([
  '好友消息', '群聊消息', '通讯录', '朋友圈', '公众号消息', '小程序', '视频号', '消息碎片', '验证消息', '账户信息',
  '书签记录', '历史记录', '搜索历史', '标签页记录', '未关闭的标签页',
  'SIM卡记录', 'Wi-Fi连接记录', '个人热点', '图片', '应用列表', '应用授权日志', '日历', '短信',
  '网络使用详情', '蓝牙', '视频', '设备信息', '设备容量记录', '账号信息', '通话记录',
  '未设置', '数据',
  'IP地址', '快递单号', '手机号', '网址', '虚拟钱包', '身份证', '车牌号', '邮箱', '银行卡',
]);

const FILE_RE = /\.(csv|txt|md|json|xml|db|html?)$/i;

/** 路径 → 结构化分类。例：/case/检材分析数据/未指定持有人/3/WhatsApp/<acct>/群聊消息/<群>/chat.txt */
export function classifyPath(virtualPath) {
  const after = virtualPath.startsWith(CASE_DATA_ROOT) ? virtualPath.slice(CASE_DATA_ROOT.length) : virtualPath;
  const segs = after.split('/').filter(Boolean);
  const fileName = segs[segs.length - 1] ?? '';
  const dirs = segs.slice(0, -1);
  const eidIdx = dirs.findIndex((s) => /^\d+$/.test(s));
  const holder = eidIdx > 0 ? dirs.slice(0, eidIdx).join('/') : '';
  const eid = eidIdx >= 0 ? Number(dirs[eidIdx]) : null;
  const rest = eidIdx >= 0 ? dirs.slice(eidIdx + 1) : dirs;

  const app = rest[0] ?? '';
  let account = null;
  let start = 1;
  // 社交应用的第二个目录是"账号"（如 WhatsApp 的 `U+1F495~Ling~…(8526…)`、微信的 `昵称(wxid)`）
  if (rest.length >= 2 && !KNOWN_CATS.has(rest[1]) && !FILE_RE.test(rest[1])) {
    account = rest[1];
    start = 2;
  }
  let catIdx = -1;
  for (let i = start; i < rest.length; i++) if (KNOWN_CATS.has(rest[i])) { catIdx = i; break; }
  let category = '';
  let subcat = '';
  if (catIdx >= 0) {
    category = rest[catIdx];
    subcat = rest.slice(catIdx + 1).join('/');
  } else {
    category = rest[start] ?? '';
    subcat = rest.slice(start + 1).join('/');
  }
  const kind = fileName.endsWith('chat.txt') ? 'chat' : fileName.endsWith('.csv') ? 'csv' : 'other';
  return { holder, eid, app, account, category, subcat, fileName, kind, rest };
}

export function parseCsvLine(s) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// 只取"事件时间"列；创建时间/更新时间/修改时间 是元数据（常为 ISO 入库时间），不参与时间线。
const TS_COLS = ['时间', '拍摄时间', '通话时间', '日期', '发送时间', '接收时间', '交易时间', 'timestamp', 'time', 'date'];
const ACTOR_COLS = ['名称', '姓名', '联系人', '持有人', '对方', '账号昵称', '用户ID', '账户名', '号码'];

function pick(row, names) {
  for (const n of names) if (row[n] != null && row[n] !== '') return row[n];
  return null;
}

/** CSV 内容行 → 记录。text 保留原始行用于引用。 */
export function parseCsvRow(content, header) {
  const cells = parseCsvLine(content);
  const fields = {};
  header.forEach((h, i) => { fields[h || `col${i + 1}`] = cells[i] ?? ''; });
  const ts = pick(fields, TS_COLS);
  const actor = pick(fields, ACTOR_COLS);
  return { cells, fields, ts: ts ? String(ts) : null, actor: actor ? String(actor) : null };
}

const TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) `([^`]*)`(\[本机\])? 说：(.*)$/;
const SUMMARY_RE = /^\[摘要\] 时间: (\S+) ~ (\S+) \| 消息: (\d+)条(?:（本机发送(\d+)条）)?/;
const ORIGIN_ID_RE = /^〔原文记录ID：(\d+)〕\s*/;

/** chat.txt 全部行 → { header, messages, rows }。rows 为所有非摘要行（含系统消息）。 */
export function parseChat(lines) {
  let header = null;
  const messages = [];
  const rows = [];
  for (const { no, content } of lines) {
    if (no === 1) {
      const sm = content.match(SUMMARY_RE);
      header = {
        summary: content,
        msgCount: sm ? Number(sm[3]) : null,
        sent: sm && sm[4] != null ? Number(sm[4]) : null,
        from: sm?.[1] ?? null,
        to: sm?.[2] ?? null,
      };
      continue;
    }
    const cleaned = content.replace(ORIGIN_ID_RE, '');
    const originId = content.match(ORIGIN_ID_RE)?.[1] ?? null;
    const m = cleaned.match(TS_RE);
    const row = {
      no,
      text: content,
      ts: m ? m[1] : null,
      speaker: m ? m[2] : null,
      isLocal: m ? (m[3] ? 1 : 0) : null,
      body: m ? m[4] : cleaned,
      originRecordId: originId,
    };
    rows.push(row);
    if (m) messages.push(row);
  }
  return { header, messages, rows };
}

const ENTITY_PATTERNS = [
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ['url', /https?:\/\/[^\s"'<>）)】]+/g],
  ['ip', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ['phone', /(?:\+?852[\s-]?\d{4}[\s-]?\d{4}|\+?86[\s-]?1\d{10}|\b\d{8,11}\b)/g],
  ['wallet', /\b(?:0x[a-fA-F0-9]{40}|T[A-Za-z1-9]{33})\b/g],
];

export function extractEntities(text) {
  const out = [];
  if (!text || text.length > 4000) return out;
  for (const [kind, re] of ENTITY_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0];
      out.push({ kind, value: kind === 'phone' ? value.replace(/[\s-]/g, '') : value });
      if (out.length > 40) return out;
    }
  }
  return out;
}

export const ENTITY_TYPES = new Set(['IP地址', '快递单号', '手机号', '网址', '虚拟钱包', '身份证', '车牌号', '邮箱', '银行卡']);

export const SCHEMA_VERSION = 4;

export const DDL = `
create table if not exists meta(k text primary key, v text);
create table if not exists case_info(k text primary key, v text);
create table if not exists evidence(
  eid integer primary key, name text, holder text, platform text, type text, timezone text,
  md5 text, sha1 text, sha256 text, size_bytes integer, source_path text, storage_path text,
  created text, updated text, raw_json text,
  person_name text, remark text, evidence_number text, record_count integer);
create table if not exists artifact(
  id integer primary key, eid integer, app text, account text, category text, subcat text,
  virtual_path text unique, kind text, base_handle text, node_id text,
  line_count integer, record_count integer, citable integer, citable_reason text, ingested_at text);
create table if not exists record(
  id integer primary key, artifact_id integer, eid integer, app text, account text, category text,
  subcat text, row_no integer, line_no integer, ts text, actor text, body text,
  text text, fields_json text, origin_record_id text, citable integer, base_handle text);
create virtual table if not exists record_fts using fts5(text, fields_text, tokenize='trigram');
create table if not exists msg(
  id integer primary key, record_id integer, artifact_id integer, app text, account text, peer text,
  ts text, speaker text, is_local integer, body text, line_no integer, base_handle text, citable integer);
create table if not exists chat_meta(
  id integer primary key, artifact_id integer, msg_count integer, sent_count integer,
  time_from text, time_to text, summary text);
create table if not exists entity(
  id integer primary key, kind text, value_norm text, record_id integer, eid integer);
create table if not exists ingest_log(
  leaf text primary key, kind text, status text, lines integer, records integer, ms real,
  error text, base_handle text, citable integer);
create index if not exists idx_record_artifact on record(artifact_id);
create index if not exists idx_record_ts on record(ts);
create index if not exists idx_record_app on record(app, account, category);
create index if not exists idx_msg_peer on msg(peer);
create index if not exists idx_msg_ts on msg(ts);
create index if not exists idx_entity_kind on entity(kind, value_norm);
create index if not exists idx_artifact_path on artifact(eid, app, account, category);
`;
