// 查询层：只读打开索引库，提供树状导航 / 检索 / 引用 / 统计 / 回查校验。
// 供 CLI（cli.mjs）与桌面插件宿主端（plugins/seeu-case-index）共用。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CASE_DATA_ROOT } from './parse.mjs';
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

// ---------- 树 ----------
export function tree(db, node = 'root') {
  const { one, all } = helpers(db);
  if (!node || node === 'root') {
    return {
      node: 'root',
      case: one("select v from meta where k='case_number'")?.v,
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
      children: all('select eid, count(*) artifacts, sum(line_count) lines from artifact group by eid order by eid')
        .map((r) => ({ id: `ev:${r.eid}`, artifacts: r.artifacts, lines: r.lines })),
      next: '展开检材：node "ev:<eid>"',
    };
  }
  if (node.startsWith('ev:')) {
    const eid = Number(node.slice(3));
    const rows = all(`select app, count(distinct case when ifnull(account,'')<>'' then account end) accounts, count(*) artifacts, sum(line_count) lines
      from artifact where eid=? group by app order by artifacts desc`, eid);
    return {
      node: `ev:${eid}`,
      evidence: one('select eid,name,holder,platform,type,timezone,md5,sha256 from evidence where eid=?', eid) ?? null,
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
  const filters = [];
  const params = [];
  if (opts.eid) { filters.push('r.eid=?'); params.push(Number(opts.eid)); }
  if (opts.app) { filters.push('r.app=?'); params.push(String(opts.app)); }
  if (opts.account) { filters.push("ifnull(r.account,'')=?"); params.push(String(opts.account)); }
  if (opts.category) { filters.push('r.category=?'); params.push(String(opts.category)); }
  if (opts.from) { filters.push('r.ts>=?'); params.push(String(opts.from)); }
  if (opts.to) { filters.push('r.ts<=?'); params.push(String(opts.to)); }
  const where = filters.length ? ` and ${filters.join(' and ')}` : '';
  let engine = 'like';
  let rows = null;
  if (q.length >= 3) {
    engine = 'fts5-trigram';
    try {
      rows = db.prepare(`select r.id, r.eid, r.app, r.account, r.category, r.ts, r.line_no,
          snippet(record_fts, 0, '«', '»', '…', 10) snip
        from record_fts f join record r on r.id=f.rowid
        where record_fts match ?${where} limit ?`).all(q, ...params, limit);
    } catch { rows = null; }
  }
  if (!rows) {
    engine = 'like';
    const like = q.replace(/[\\%_]/g, (m) => '\\' + m);
    rows = db.prepare(`select r.id, r.eid, r.app, r.account, r.category, r.ts, r.line_no, substr(r.text,1,160) snip
      from record r where r.text like '%'||?||'%' escape '\\'${where} limit ?`).all(like, ...params, limit);
  }
  return {
    query: q, engine, returned: rows.length,
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
    id: r.id, eid: r.eid, app: r.app, account: r.account ?? '', cat: r.category,
    sub: r.subcat, ts: r.ts, line: r.line_no, path: shortPath(r.path),
    citable: !!r.base_handle,
    citation: r.base_handle ? `[[1]](${r.base_handle}#${r.line_no})` : null,
    verifyCmd: r.base_handle ? `ges read "${r.path}" --offset ${r.line_no - 1} --limit 1` : '本行无溯源句柄，只能作为导航',
    text: clip(r.text, 300),
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
