// 查询层：只读打开索引库，提供树状导航 / 检索 / 引用 / 统计 / 回查校验。
// 供 CLI（cli.mjs）与桌面插件宿主端（plugins/seeu-case-index）共用。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CASE_DATA_ROOT, SCHEMA_VERSION } from './parse.mjs';
import { TYPED_TABLES } from './typed.mjs';
import { ges } from './ges.mjs';

export const PAGE = 10;
const enc = (s) => encodeURIComponent(s ?? '');
const dec = (s) => decodeURIComponent(s ?? '');
const clip = (s, n) => ((s ?? '').length > n ? (s ?? '').slice(0, n) + '…' : (s ?? ''));
const shortPath = (p) => (p ?? '').replace(CASE_DATA_ROOT, '…/');
const baseName = (p) => (p ?? '').split('/').filter(Boolean).pop();

export function openIndex(dbPath) {
  if (!existsSync(dbPath)) {
    const e = new Error(`找不到索引库：${dbPath}`);
    e.code = 'E_NO_INDEX';
    throw e;
  }
  return new DatabaseSync(dbPath, { readOnly: true });
}

/** 列出 root 自身与向下两层的子目录（跳过隐藏/系统目录，最多 400 个），用于找案件库。 */
function candidateDirs(root, depth = 2, budget = { left: 400 }) {
  const out = [];
  const walk = (dir, level) => {
    if (budget.left <= 0) return;
    out.push(dir);
    if (level >= depth) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const ent of entries) {
      if (budget.left <= 0) return;
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      budget.left -= 1;
      walk(join(dir, ent.name), level + 1);
    }
  };
  walk(resolve(root), 0);
  return out;
}

/** 在若干目录里找 `.seeu-index/case-index.db`：先看目录本身，再向下扫两层子目录。 */
export function findIndexes(dirs = []) {
  const found = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!dir) continue;
    for (const abs of candidateDirs(dir)) {
      const db = join(abs, '.seeu-index', 'case-index.db');
      if (seen.has(db) || !existsSync(db)) continue;
      seen.add(db);
      let meta = null;
      try {
        const d = new DatabaseSync(db, { readOnly: true });
        meta = Object.fromEntries(d.prepare('select k,v from meta').all().map((r) => [r.k, r.v]));
        d.close();
      } catch { /* 坏库跳过 meta */ }
      let builtAt = null;
      try {
        const manifestPath = join(abs, '.seeu-index', 'manifest.json');
        if (existsSync(manifestPath)) builtAt = JSON.parse(readFileSync(manifestPath, 'utf8')).builtAt ?? null;
      } catch { /* manifest 坏了不影响列出 */ }
      found.push({
        caseDir: abs,
        dbPath: db,
        caseNumber: meta?.case_number ?? null,
        caseName: meta?.case_name ?? null,
        builtAt,
        sizeBytes: statSync(db).size,
      });
    }
  }
  return found;
}

function helpers(db) {
  return {
    one: (sql, ...p) => db.prepare(sql).get(...p),
    all: (sql, ...p) => db.prepare(sql).all(...p),
  };
}

// ---------- 检材（evidence）----------

/** 检材清单：eid → 名称/持有人/平台/备注/记录数（模型和面板判断「分析哪个检材」的依据）。 */
export function evidences(db) {
  let rows = [];
  try {
    rows = db.prepare(`select eid,name,holder,person_name,platform,type,timezone,remark,
        evidence_number,record_count,size_bytes,sha256 from evidence order by eid`).all();
  } catch {
    rows = db.prepare('select eid,name,holder,platform,type,timezone from evidence order by eid').all();
  }
  return rows.map((r) => ({
    eid: r.eid, name: r.name ?? '', holder: r.person_name || r.holder || '',
    platform: r.platform ?? '', type: r.type ?? '', timezone: r.timezone ?? '',
    remark: r.remark ?? '', evidenceNumber: r.evidence_number ?? '',
    recordCount: r.record_count ?? null, sizeBytes: r.size_bytes ?? null,
    sha256: r.sha256 ?? null,
    label: [r.name, r.person_name || r.holder, r.platform].filter(Boolean).join(' · '),
  }));
}

function evidenceName(db, eid) {
  try {
    const r = db.prepare('select name,person_name from evidence where eid=?').get(Number(eid));
    return r ? [r.name, r.person_name].filter(Boolean).join(' · ') || null : null;
  } catch {
    return null;
  }
}

// ---------- 树 ----------
export function tree(db, node = 'root') {
  const { one, all } = helpers(db);
  if (!node || node === 'root') {
    const schemaVersion = one("select v from meta where k='schema_version'")?.v ?? null;
    return {
      node: 'root',
      case: one("select v from meta where k='case_number'")?.v,
      schemaVersion,
      currentSchemaVersion: SCHEMA_VERSION,
      needsRebuild: schemaVersion !== null && String(schemaVersion) !== String(SCHEMA_VERSION),
      name: one("select v from meta where k='case_name'")?.v,
      totals: {
        evidences: one('select count(*) n from evidence').n || one('select count(distinct eid) n from artifact').n,
        artifacts: one('select count(*) n from artifact').n,
        records: one('select count(*) n from record').n,
        messages: one('select count(*) n from msg').n,
        chats: one('select count(*) n from chat_meta').n,
        entities: one('select count(*) n from entity').n,
      },
      timeRange: one("select min(ts) f, max(ts) t from record where ts is not null and ts <> ''"),
      children: all(`select a.eid, count(*) artifacts, sum(a.line_count) lines,
          (select name from evidence e where e.eid=a.eid) name,
          (select person_name from evidence e where e.eid=a.eid) person,
          (select platform from evidence e where e.eid=a.eid) platform,
          (select remark from evidence e where e.eid=a.eid) remark
        from artifact a group by a.eid order by a.eid`)
        .map((r) => ({
          id: `ev:${r.eid}`, eid: r.eid, name: r.name ?? null, person: r.person || null,
          platform: r.platform || null, remark: r.remark || null,
          artifacts: r.artifacts, lines: r.lines,
        })),
      next: '展开检材：node "ev:<eid>"（children 里的 name 就是火眼里的检材名称）',
    };
  }
  if (node.startsWith('ev:')) {
    const eid = Number(node.slice(3));
    const rows = all(`select app, count(distinct case when ifnull(account,'')<>'' then account end) accounts, count(*) artifacts, sum(line_count) lines
      from artifact where eid=? group by app order by artifacts desc`, eid);
    return {
      node: `ev:${eid}`,
      evidence: one(`select eid,name,holder,platform,type,timezone,md5,sha256,
        person_name,remark,evidence_number,record_count from evidence where eid=?`, eid) ?? null,
      totals: one('select count(*) artifacts, sum(line_count) lines from artifact where eid=?', eid),
      children: rows.map((r) => ({ id: `app:${eid}|${enc(r.app)}`, app: r.app, accounts: r.accounts, artifacts: r.artifacts, lines: r.lines })),
    };
  }
  if (node.startsWith('app:')) {
    const [eid, app] = node.slice(4).split('|').map(dec);
    const rows = all(`select ifnull(account,'') account, count(*) artifacts from artifact where eid=? and app=? group by account`, Number(eid), app);
    const hasAccounts = rows.some((r) => r.account !== '');
    if (hasAccounts) {
      return {
        node, totals: one('select count(*) artifacts, sum(line_count) lines from artifact where eid=? and app=?', Number(eid), app),
        children: rows.map((r) => ({
          id: `acc:${eid}|${enc(app)}|${enc(r.account)}`,
          account: r.account === '' ? '(无账号)' : r.account, artifacts: r.artifacts,
        })),
      };
    }
    const cats = all(`select category, count(*) artifacts, sum(line_count) lines from artifact where eid=? and app=? group by category order by artifacts desc`, Number(eid), app);
    return {
      node, totals: one('select count(*) artifacts, sum(line_count) lines from artifact where eid=? and app=?', Number(eid), app),
      children: cats.map((r) => ({ id: `cat:${eid}|${enc(app)}||${enc(r.category)}`, cat: r.category, artifacts: r.artifacts, lines: r.lines })),
    };
  }
  if (node.startsWith('acc:')) {
    const [eid, app, account] = node.slice(4).split('|').map(dec);
    const cats = all(`select category, count(*) artifacts, sum(line_count) lines from artifact
      where eid=? and app=? and ifnull(account,'')=? group by category order by artifacts desc`, Number(eid), app, account);
    return {
      node, totals: one(`select count(*) artifacts, sum(line_count) lines from artifact where eid=? and app=? and ifnull(account,'')=?`, Number(eid), app, account),
      children: cats.map((r) => ({ id: `cat:${eid}|${enc(app)}|${enc(account)}|${enc(r.category)}`, cat: r.category, artifacts: r.artifacts, lines: r.lines })),
    };
  }
  if (node.startsWith('cat:')) {
    const [eid, app, account, category] = node.slice(4).split('|').map(dec);
    const rows = all(`select id, subcat, virtual_path, kind, line_count, citable from artifact
      where eid=? and app=? and ifnull(account,'')=? and category=? order by id`, Number(eid), app, account, category);
    return {
      node, totals: { artifacts: rows.length, lines: rows.reduce((s, r) => s + (r.line_count || 0), 0) },
      children: rows.map((r) => ({
        id: `art:${r.id}`, name: clip(r.subcat || baseName(r.virtual_path), 60),
        kind: r.kind, lines: r.line_count, citable: !!r.citable,
      })),
    };
  }
  if (node.startsWith('art:')) {
    const [idStr, pageStr] = node.slice(4).split(':');
    const artifactId = Number(idStr);
    const page = Math.max(0, Number(pageStr) || 0);
    const art = one('select * from artifact where id=?', artifactId);
    if (!art) { const e = new Error('artifact 不存在'); e.code = 'E_NOT_FOUND'; throw e; }
    const rows = all('select id, line_no, ts, substr(text,1,160) text from record where artifact_id=? order by line_no limit ? offset ?', artifactId, PAGE, page * PAGE);
    return {
      node: `art:${artifactId}`,
      artifact: {
        app: art.app, account: art.account ?? '', cat: art.category, sub: clip(art.subcat, 60),
        path: shortPath(art.virtual_path), kind: art.kind, lines: art.line_count,
        citable: !!art.citable, baseHandle: art.base_handle,
      },
      records: {
        returned: rows.length, offset: page * PAGE, total: art.record_count,
        next: rows.length === PAGE ? `art:${artifactId}:${page + 1}` : null,
        rows: rows.map((r) => ({ id: r.id, line: r.line_no, ts: r.ts, text: clip(r.text, 140) })),
      },
      citeHint: '引用：node "cite:<recordId>"',
    };
  }
  if (node.startsWith('cite:')) {
    const r = one(`select r.*, a.virtual_path path from record r join artifact a on a.id=r.artifact_id where r.id=?`, Number(node.slice(5)));
    if (!r) { const e = new Error('记录不存在'); e.code = 'E_NOT_FOUND'; throw e; }
    return {
      node: `cite:${r.id}`, ts: r.ts, line: r.line_no, path: shortPath(r.path),
      citable: !!r.base_handle,
      citation: r.base_handle ? `[[1]](${r.base_handle}#${r.line_no})` : null,
      verifyCmd: r.base_handle ? `ges read "${r.path}" --offset ${r.line_no - 1} --limit 1` : '本行无溯源句柄，只能作为导航',
      text: clip(r.text, 200),
    };
  }
  { const e = new Error('未知节点'); e.code = 'E_BAD_NODE'; throw e; }
}

// ---------- 检索 ----------
export function search(db, opts = {}) {
  const q = String(opts.q ?? '').trim();
  if (!q) { const e = new Error('缺少关键词'); e.code = 'E_NO_QUERY'; throw e; }
  const limit = Math.min(100, Number(opts.limit) || 10);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const filters = [];
  const params = [];
  if (opts.eid) { filters.push('r.eid=?'); params.push(Number(opts.eid)); }
  if (opts.app) { filters.push('r.app=?'); params.push(String(opts.app)); }
  if (opts.account) { filters.push("ifnull(r.account,'')=?"); params.push(String(opts.account)); }
  if (opts.category) { filters.push('r.category=?'); params.push(String(opts.category)); }
  if (opts.from) { filters.push('r.ts>=?'); params.push(String(opts.from)); }
  if (opts.to) { filters.push('r.ts<=?'); params.push(String(opts.to)); }
  const kw = typeof opts.q === 'string' ? opts.q.trim() : '';
  const filterParams = [...params];
  if (kw) {
    if (kw.length >= 3) {
      filters.push('r.id in (select rowid from record_fts where record_fts match ?)');
      params.push(ftsQuery(kw));
    } else {
      filters.push('(r.text like ? or r.body like ?)');
      params.push('%' + kw + '%', '%' + kw + '%');
    }
  }
  const where = filters.length ? ` and ${filters.join(' and ')}` : '';
  let engine = 'like';
  let rows = null;
  let total = null;
  if (q.length >= 3) {
    engine = 'fts5-trigram';
    try {
      rows = db.prepare(`select r.id, r.eid, r.app, r.account, r.category, r.ts, r.line_no,
          snippet(record_fts, 0, '«', '»', '…', 10) snip
        from record_fts f join record r on r.id=f.rowid
        where record_fts match ?${where} limit ? offset ?`).all(q, ...params, limit, offset);
      total = db.prepare(`select count(*) n
        from record_fts f join record r on r.id=f.rowid
        where record_fts match ?${where}`).get(q, ...params).n;
    } catch { rows = null; total = null; }
  }
  if (!rows) {
    engine = 'like';
    const like = q.replace(/[\\%_]/g, (m) => '\\' + m);
    rows = db.prepare(`select r.id, r.eid, r.app, r.account, r.category, r.ts, r.line_no, substr(r.text,1,160) snip
      from record r where r.text like '%'||?||'%' escape '\\'${where} limit ? offset ?`).all(like, ...params, limit, offset);
    total = db.prepare(`select count(*) n from record r where r.text like '%'||?||'%' escape '\\'${where}`).get(like, ...params).n;
  }
  const nextOffset = offset + rows.length < total ? offset + rows.length : null
  return {
    query: q, engine, returned: rows.length, total, offset, limit, next: nextOffset,
    rows: rows.map((r) => ({
      id: r.id, eid: r.eid, app: r.app, account: r.account ?? '', cat: r.category,
      ts: r.ts, line: r.line_no, snip: clip(r.snip, 100),
    })),
    citeHint: '取引用：nodes cite <id>',
  };
}

export function cite(db, id) {
  const r = db.prepare(`select r.*, a.virtual_path path from record r join artifact a on a.id=r.artifact_id where r.id=?`).get(Number(id));
  if (!r) { const e = new Error(`记录 ${id} 不存在`); e.code = 'E_NOT_FOUND'; throw e; }
  return {
    id: r.id, eid: r.eid, ev: evidenceName(db, r.eid), app: r.app, account: r.account ?? '', cat: r.category,
    sub: r.subcat, ts: r.ts, line: r.line_no, path: shortPath(r.path),
    citable: !!r.base_handle,
    citation: r.base_handle ? `[[1]](${r.base_handle}#${r.line_no})` : null,
    verifyCmd: r.base_handle ? `ges read "${r.path}" --offset ${r.line_no - 1} --limit 1` : '本行无溯源句柄，只能作为导航',
    text: clip(r.text, 300),
  };
}


// ---------- M2：typed 表 / 实体 / 时间线 / 记录分页 ----------

const TYPED_LABELS = {
  contact: '联系人', account_info: '账号信息', msg_csv: '消息(CSV)', chat_group: '群/频道/社群',
  call_log: '通话记录', sms: '短信', web_visit: '浏览/搜索/书签', exif: '图片 Exif',
  file_meta: '图片/视频元数据', app_install: '应用列表', app_usage: 'App 使用详情',
  app_permission: '应用授权', sim_card: 'SIM 卡', wifi_record: 'Wi-Fi/热点', bt_device: '蓝牙设备',
  net_usage: '网络流量', calendar_event: '日历', mini_program: '小程序', moment: '朋友圈',
  favorite: '收藏', device_info: '设备信息', device_storage: '设备容量', entity_row: '实体分类',
  health_metric: '健康指标',
};

/** 可投影查询的表清单 + 行数（给面板做下拉/概览）。 */
export function typedTables(db) {
  const out = [];
  for (const name of Object.keys(TYPED_TABLES)) {
    let n = 0;
    try { n = db.prepare(`select count(*) n from ${name}`).get().n; } catch { continue; }
    out.push({ table: name, label: TYPED_LABELS[name] ?? name, rows: n });
  }
  return out;
}

const TS_FIELD = { call_log: 'start_ts', msg_csv: 'ts', sms: 'ts', web_visit: 'ts', exif: 'taken_at', app_usage: 'ts', calendar_event: 'start_ts', device_storage: 'ts' };

/** 分页查一张 typed 表。filters: eid/app/account/q/from/to/limit/offset。 */
export function table(db, name, opts = {}) {
  if (!TYPED_TABLES[name]) { const e = new Error(`未知表：${name}`); e.code = 'E_BAD_TABLE'; throw e; }
  const cols = TYPED_TABLES[name];
  const limit = Math.min(200, Number(opts.limit) || 20);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const filters = [];
  const params = [];
  if (opts.eid) { filters.push('eid=?'); params.push(Number(opts.eid)); }
  if (opts.app) { filters.push('app=?'); params.push(String(opts.app)); }
  if (opts.account) { filters.push("ifnull(account,'')=?"); params.push(String(opts.account)); }
  if (opts.subcat) { filters.push('subcat=?'); params.push(String(opts.subcat)); }
  const tsCol = TS_FIELD[name] ?? 'ts';
  if (opts.from && cols.includes(tsCol)) { filters.push(`${tsCol}>=?`); params.push(String(opts.from)); }
  if (opts.to && cols.includes(tsCol)) { filters.push(`${tsCol}<=?`); params.push(String(opts.to)); }
  const q = String(opts.q ?? '').trim();
  if (q) {
    const textCols = cols.filter((c) => !/_id$|^ts$|_at$|^lat$|^lon$/.test(c));
    if (textCols.length) {
      filters.push('(' + textCols.map((c) => `ifnull(${c},'')` + " like '%'||?||'%'").join(' or ') + ')');
      for (let i = 0; i < textCols.length; i++) params.push(q);
    }
  }
  const where = filters.length ? ' where ' + filters.join(' and ') : '';
  const total = db.prepare(`select count(*) n from ${name}${where}`).get(...params).n;
  const rows = db.prepare(`select * from ${name}${where} order by id limit ? offset ?`).all(...params, limit, offset);
  return {
    table: name, label: TYPED_LABELS[name] ?? name,
    returned: rows.length, total, offset, next: offset + rows.length < total ? offset + rows.length : null,
    columns: ['id', 'record_id', 'eid', 'app', 'account', 'subcat', ...cols],
    rows: rows.map((r) => ({ ...r, text: undefined })),
  };
}

/** 跨检材实体聚合：默认按 (kind,value) 聚合，带 eid 分布；带 value/q 时下钻到提及记录。 */
export function entity(db, opts = {}) {
  const limit = Math.min(200, Number(opts.limit) || 20);
  const filters = [];
  const params = [];
  if (opts.kind) { filters.push('kind=?'); params.push(String(opts.kind)); }
  if (opts.eid) { filters.push('eid=?'); params.push(Number(opts.eid)); }
  const q = String(opts.q ?? opts.value ?? '').trim();
  if (q) { filters.push("value_norm like '%'||?||'%'"); params.push(q); }
  const where = filters.length ? ' where ' + filters.join(' and ') : '';

  // 带 value/q 且命中唯一值 → 下钻
  if (q) {
    const top = db.prepare(`select kind, value_norm, count(*) n, count(distinct eid) eids, group_concat(distinct eid) eid_list
      from entity${where} group by kind, value_norm order by n desc limit ?`).all(...params, limit);
    if (top.length === 1) {
      const t = top[0];
      const mentions = db.prepare(`select e.id record_id, e.eid, r.app, r.category, r.ts, r.line_no, a.virtual_path path
        from entity e join record r on r.id=e.record_id join artifact a on a.id=r.artifact_id
        where e.kind=? and e.value_norm=? order by r.ts limit ?`).all(t.kind, t.value_norm, limit);
      return {
        query: q, matched: 'mention', kind: t.kind, value: t.value_norm, evidences: t.eids,
        returned: mentions.length,
        mentions: mentions.map((m) => ({
          record: m.record_id, eid: m.eid, app: m.app, cat: m.category, ts: m.ts, line: m.line_no,
          citeHint: `cite:${m.record_id}`,
        })),
      };
    }
    return { query: q, matched: 'aggregate', returned: top.length, rows: top.map((r) => ({ kind: r.kind, value: r.value_norm, count: r.n, evidences: r.eids, eids: r.eid_list.split(',').map(Number) })) };
  }

  const rows = db.prepare(`select kind, value_norm, count(*) n, count(distinct eid) eids, group_concat(distinct eid) eid_list
    from entity${where} group by kind, value_norm order by n desc, eids desc limit ?`).all(...params, limit);
  const kinds = db.prepare('select kind, count(*) n from entity group by kind order by n desc').all();
  return {
    returned: rows.length,
    kinds,
    crossEvidence: rows.filter((r) => r.eids > 1).length,
    rows: rows.map((r) => ({ kind: r.kind, value: r.value_norm, count: r.n, evidences: r.eids, eids: r.eid_list.split(',').map(Number) })),
  };
}

/** 时间线分桶统计：bucket = hour | day | month。 */
export function timeline(db, opts = {}) {
  const bucket = ['hour', 'day', 'month'].includes(String(opts.bucket)) ? String(opts.bucket) : 'day';
  const len = bucket === 'hour' ? 13 : bucket === 'day' ? 10 : 7;
  const filters = ["ts is not null", "ts <> ''"];
  const params = [];
  if (opts.eid) { filters.push('eid=?'); params.push(Number(opts.eid)); }
  if (opts.app) { filters.push('app=?'); params.push(String(opts.app)); }
  if (opts.from) { filters.push('ts>=?'); params.push(String(opts.from)); }
  if (opts.to) { filters.push('ts<=?'); params.push(String(opts.to)); }
  const limit = Math.min(400, Number(opts.limit) || 60);
  const rows = db.prepare(`select substr(ts,1,${len}) bucket, count(*) n, count(distinct eid) eids, count(distinct app) apps
    from record where ${filters.join(' and ')} group by bucket order by bucket desc limit ?`).all(...params, limit);
  return { bucket, returned: rows.length, rows: rows.reverse() };
}

/** 记录分页（给面板「记录」视图与深链）。 */
export function records(db, opts = {}) {
  const limit = Math.min(200, Number(opts.limit) || 20);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const filters = [];
  const params = [];
  if (opts.eid) { filters.push('r.eid=?'); params.push(Number(opts.eid)); }
  if (opts.app) { filters.push('r.app=?'); params.push(String(opts.app)); }
  if (opts.account) { filters.push("ifnull(r.account,'')=?"); params.push(String(opts.account)); }
  if (opts.category) { filters.push('r.category=?'); params.push(String(opts.category)); }
  if (opts.artifact) { filters.push('r.artifact_id=?'); params.push(Number(opts.artifact)); }
  if (opts.from) { filters.push('r.ts>=?'); params.push(String(opts.from)); }
  if (opts.to) { filters.push('r.ts<=?'); params.push(String(opts.to)); }
  const kw = typeof opts.q === 'string' ? opts.q.trim() : '';
  const where = filters.length ? ' where ' + filters.join(' and ') : '';
  const select = 'select r.id, r.eid, r.app, r.account, r.category, r.subcat, r.line_no, r.ts, r.actor, substr(r.text,1,200) text from record r';
  let engine = kw ? 'like' : 'none';
  let where2 = where;
  let params2 = [...params];
  let rows = null;
  if (kw) {
    if (kw.length >= 3) {
      try {
        const ftsWhere = (filters.length ? ' where ' : ' where ') + filters.join(' and ') + (filters.length ? ' and ' : '') + ' r.id in (select rowid from record_fts where record_fts match ?)';
        const total = db.prepare('select count(*) n from record r' + ftsWhere).get(...params, kw).n;
        rows = db.prepare(select + ftsWhere + ' order by r.ts desc, r.id desc limit ? offset ?').all(...params, kw, limit, offset);
        engine = 'fts5-trigram';
        const evMap = new Map(db.prepare('select eid,name from evidence').all().map((r2) => [r2.eid, r2.name]));
        return {
          query: kw, engine, returned: rows.length, total, offset,
          next: offset + rows.length < total ? offset + rows.length : null,
          rows: rows.map((r2) => ({ id: r2.id, eid: r2.eid, ev: evMap.get(r2.eid) ?? null, app: r2.app, account: r2.account ?? '', cat: r2.category, sub: r2.subcat, line: r2.line_no, ts: r2.ts, actor: r2.actor, text: clip(r2.text, 180) })),
        };
      } catch {
        rows = null;
      }
    }
    const like = kw.replace(/[\\%_]/g, (m) => '\\' + m);
    const likeFilter = "(r.text like '%'||?||'%' escape '\\' or r.body like '%'||?||'%' escape '\\')";
    where2 = (filters.length ? ' where ' + filters.join(' and ') + ' and ' : ' where ') + likeFilter;
    params2 = [...params, like, like];
  }
  const total = db.prepare('select count(*) n from record r' + where2).get(...params2).n;
  rows = db.prepare(select + where2 + ' order by r.ts desc, r.id desc limit ? offset ?').all(...params2, limit, offset);
  const evMap = new Map(db.prepare('select eid,name from evidence').all().map((r) => [r.eid, r.name]));
  return {
    query: kw || null, engine, returned: rows.length, total, offset,
    next: offset + rows.length < total ? offset + rows.length : null,
    rows: rows.map((r) => ({ id: r.id, eid: r.eid, ev: evMap.get(r.eid) ?? null, app: r.app, account: r.account ?? '', cat: r.category, sub: r.subcat, line: r.line_no, ts: r.ts, actor: r.actor, text: clip(r.text, 180) })),
  };
}

export function statsOf(db) {
  const { one } = helpers(db);
  return {
    meta: Object.fromEntries(db.prepare('select k,v from meta').all().map((r) => [r.k, r.v])),
    counts: {
      evidence: one('select count(*) n from evidence').n,
      artifacts: one('select count(*) n from artifact').n,
      records: one('select count(*) n from record').n,
      messages: one('select count(*) n from msg').n,
      entities: one('select count(*) n from entity').n,
      chats: one('select count(*) n from chat_meta').n,
    },
    citable: one('select sum(citable) yes, sum(1-citable) no from artifact'),
    byApp: db.prepare('select app, count(*) artifacts, sum(record_count) records from artifact group by app order by artifacts desc').all(),
    errors: db.prepare("select leaf, error from ingest_log where status='error' limit 10").all(),
    noHandle: db.prepare('select eid, app, category, count(*) n from artifact where citable=0 group by eid, app, category').all(),
    typed: typedTables(db),
    entityKinds: db.prepare('select kind, count(*) n, count(distinct eid) eids from entity group by kind order by n desc').all(),
    citations: one('select count(*) n from citation').n,
    evidences: evidences(db),
  };
}

/** 随机抽样回火眼核对：正文逐字一致 + 基址一致。 */
export async function verify(db, opts = {}) {
  const sample = Math.min(100, Number(opts.sample) || 20);
  const rows = db.prepare(`select r.id, r.line_no, r.base_handle, r.text, a.virtual_path path
    from record r join artifact a on a.id=r.artifact_id
    where r.citable=1 and r.base_handle is not null order by random() limit ?`).all(sample);
  const checks = [];
  for (const r of rows) {
    let fetched = null;
    let baseOk = null;
    try {
      const outText = await ges(['read', r.path, '--offset', String(Math.max(0, r.line_no - 1)), '--limit', '1']);
      const base = outText.match(/Goldeneyes:\/\/[^\s〕]+/)?.[0] ?? null;
      baseOk = base === r.base_handle;
      for (const line of outText.split(/\r?\n/)) {
        const m = line.match(/^\s*(\d+)\s\s(.*)$/);
        if (m && Number(m[1]) === r.line_no) { fetched = m[2]; break; }
      }
    } catch (e) {
      checks.push({ id: r.id, ok: false, error: String(e.message).slice(0, 200) });
      continue;
    }
    checks.push({ id: r.id, ok: fetched === r.text, baseOk, line: r.line_no, path: shortPath(r.path) });
  }
  const exact = checks.filter((c) => c.ok).length;
  const base = checks.filter((c) => c.baseOk === true).length;
  return { sample, exact, baseHandleOk: base, pass: exact === checks.length && base === checks.length, failures: checks.filter((c) => !c.ok || c.baseOk !== true) };
}
