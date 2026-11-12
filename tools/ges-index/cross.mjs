// 跨案中央库（M5）：把每个「案件索引库」里的实体/提及/检材镜像哈希汇总到
// `<dsh 工作目录>\indexes\crosscase.db`，用于「同一手机号/邮箱/钱包/网址/镜像哈希
// 在哪些案件、哪些检材里出现过」。
//
// 设计：中央库只存跨案检索需要的投影，不存原始记录正文（提到提及片段，最长 200 字）。
// 各案件库仍是唯一事实来源；中央库可以随时删掉重建（--rebuild）。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const clip = (t, n) => (typeof t === 'string' && t.length > n ? t.slice(0, n) + '…' : t);

export const CROSS_VERSION = 1;
export const CROSS_FILE = 'crosscase.db';

export function crossDbPath(workspace) {
  return join(workspace, 'indexes', CROSS_FILE);
}

export const CROSS_DDL = `
create table if not exists schema_meta(k text primary key, v text);
create table if not exists case_ref(
  case_number text primary key, case_name text, case_dir text, db_path text,
  built_at text, fingerprint text, schema_version integer, records integer,
  typed_coverage real, synced_at text);
create table if not exists cross_entity(
  id integer primary key, kind text, value_norm text, value_text text,
  case_number text, case_name text, eid integer, hits integer, last_ts text,
  unique(kind, value_norm, case_number, eid));
create table if not exists cross_mention(
  id integer primary key, entity_id integer, case_number text, eid integer,
  record_id integer, app text, category text, ts text, line_no integer,
  base_handle text, citable integer, snippet text);
create table if not exists cross_image(
  id integer primary key, case_number text, case_name text, eid integer, name text,
  sha256 text, md5 text, size_bytes integer, unique(case_number, eid));
create index if not exists idx_ce_kind_value on cross_entity(kind, value_norm);
create index if not exists idx_ce_case on cross_entity(case_number);
create index if not exists idx_cm_entity on cross_mention(entity_id);
create index if not exists idx_ci_sha on cross_image(sha256);
create index if not exists idx_ci_md5 on cross_image(md5);
`;

export function openCross(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = WAL; pragma busy_timeout = 5000;');
  db.exec(CROSS_DDL);
  db.prepare('insert or replace into schema_meta(k, v) values(?, ?)').run('crossVersion', String(CROSS_VERSION));
  return db;
}

function readCaseMeta(caseDb, { caseDir = '', dbPath = '' } = {}) {
  const kv = {};
  try { for (const row of caseDb.prepare('select k, v from meta').all()) kv[row.k] = row.v; } catch { /* 老库可能没有 meta */ }
  const info = {};
  try { for (const row of caseDb.prepare('select k, v from case_info').all()) info[row.k] = row.v; } catch { /* ignore */ }
  let manifest = null;
  try {
    const manPath = dbPath ? join(dirname(dbPath), 'manifest.json') : '';
    if (manPath && existsSync(manPath)) manifest = JSON.parse(readFileSync(manPath, 'utf8'));
  } catch { manifest = null; }
  let records = 0;
  try { records = caseDb.prepare('select count(*) n from record').get().n; } catch { records = 0; }
  return {
    caseNumber: kv.case_number ?? info.case_number ?? '',
    caseName: kv.case_name ?? info.name ?? '',
    caseDir: kv.case_location ?? info.location ?? caseDir ?? '',
    dbPath,
    builtAt: manifest?.builtAt ?? manifest?.built_at ?? '',
    fingerprint: manifest?.fingerprint ?? '',
    schemaVersion: Number(kv.schema_version ?? info.schema_version ?? 0),
    records: Number(manifest?.counts?.records ?? records),
    typedCoverage: Number(manifest?.typed?.coverage ?? 0),
  };
}

/** 把一个案件库同步进中央库（幂等：先删该案旧投影，再全量写入）。 */
export function syncCase(crossDb, caseDb, { caseDir = '', dbPath = '' } = {}) {
  const meta = readCaseMeta(caseDb, { caseDir, dbPath });
  const caseNumber = meta.caseNumber;
  if (!caseNumber) throw Object.assign(new Error('案件库缺少 case_number（可能不是 ges-index 生成的库）'), { code: 'E_BAD_CASE_DB' });
  const tx = () => {
    for (const t of ['cross_entity', 'cross_mention', 'cross_image']) {
      crossDb.prepare(`delete from ${t} where case_number = ?`).run(caseNumber);
    }
  };
  crossDb.exec('begin');
  try {
    tx();
    // 1) 实体聚合：entity 表按 (kind, value_norm) 聚合到 (案号, 检材)
    const ents = caseDb.prepare(`
      select en.kind, en.value_norm, en.eid, count(*) hits, max(r.ts) last_ts
        from entity en join record r on r.id = en.record_id
       group by en.kind, en.value_norm, en.eid`).all();
    const insEnt = crossDb.prepare(`insert into cross_entity(kind, value_norm, value_text, case_number, case_name, eid, hits, last_ts)
      values(?,?,?,?,?,?,?,?)`);
    const idOf = new Map();
    for (const e of ents) {
      const info = insEnt.run(e.kind, e.value_norm, e.value_norm, caseNumber, meta.caseName, e.eid, e.hits, e.last_ts);
      idOf.set(`${e.kind}\u0000${e.value_norm}\u0000${e.eid}`, Number(info.lastInsertRowid));
    }
    // 2) 提及明细（每个实体最多留 5 条，避免中央库膨胀）
    const mentions = caseDb.prepare(`
      select en.kind, en.value_norm, en.eid, en.record_id, r.app, r.category, r.ts, r.line_no,
             r.base_handle, r.citable, substr(r.text, 1, 200) snip
        from entity en join record r on r.id = en.record_id
       order by en.kind, en.value_norm, en.eid, r.ts desc`).all();
    const insMen = crossDb.prepare(`insert into cross_mention(entity_id, case_number, eid, record_id, app, category, ts, line_no, base_handle, citable, snippet)
      values(?,?,?,?,?,?,?,?,?,?,?)`);
    const seen = new Map();
    let mentionCount = 0;
    for (const m of mentions) {
      const key = `${m.kind}\u0000${m.value_norm}\u0000${m.eid}`;
      const n = (seen.get(key) ?? 0) + 1;
      if (n > 5) continue;
      seen.set(key, n);
      const entityId = idOf.get(key);
      if (entityId == null) continue;
      insMen.run(entityId, caseNumber, m.eid, m.record_id, m.app, m.category, m.ts, m.line_no, m.base_handle, m.citable, m.snip);
      mentionCount += 1;
    }
    // 3) 检材镜像哈希（同镜像跨案复用）
    const evs = caseDb.prepare('select eid, name, sha256, md5, size_bytes from evidence').all();
    const insImg = crossDb.prepare('insert or replace into cross_image(case_number, case_name, eid, name, sha256, md5, size_bytes) values(?,?,?,?,?,?,?)');
    for (const e of evs) insImg.run(caseNumber, meta.caseName, e.eid, e.name, e.sha256, e.md5, e.size_bytes);
    crossDb.prepare(`insert or replace into case_ref(case_number, case_name, case_dir, db_path, built_at, fingerprint,
        schema_version, records, typed_coverage, synced_at) values(?,?,?,?,?,?,?,?,?,?)`).run(
      caseNumber, meta.caseName, meta.caseDir ?? '', meta.dbPath ?? '', meta.builtAt, meta.fingerprint,
      meta.schemaVersion, meta.records, meta.typedCoverage, new Date().toISOString());
    crossDb.exec('commit');
    return { caseNumber, caseName: meta.caseName, entities: ents.length, mentions: mentionCount, images: evs.length };
  } catch (error) {
    try { crossDb.exec('rollback'); } catch { /* ignore */ }
    throw error;
  }
}

/** 扫描若干目录下所有案件库并同步（返回每个案件的结果或错误）。 */
export function syncAll(crossDb, cases) {
  const results = [];
  for (const c of cases) {
    try {
      const caseDb = new DatabaseSync(c.dbPath, { readOnly: true });
      try {
        const info = syncCase(crossDb, caseDb, { caseDir: c.caseDir, dbPath: c.dbPath });
        results.push({ ...info, caseDir: c.caseDir, dbPath: c.dbPath, ok: true });
      } finally {
        caseDb.close();
      }
    } catch (error) {
      results.push({ dbPath: c.dbPath, caseDir: c.caseDir, ok: false, error: error?.message ?? String(error) });
    }
  }
  return results;
}

export function listCases(crossDb) {
  return crossDb.prepare(`select cr.case_number caseNumber, cr.case_name caseName, cr.case_dir caseDir, cr.db_path dbPath,
      cr.built_at builtAt, cr.schema_version schemaVersion, cr.records, cr.typed_coverage typedCoverage, cr.synced_at syncedAt,
      (select count(*) from cross_entity ce where ce.case_number = cr.case_number) entities,
      (select count(*) from cross_mention cm where cm.case_number = cr.case_number) mentions,
      (select count(*) from cross_image ci where ci.case_number = cr.case_number) images
    from case_ref cr order by cr.synced_at desc`).all();
}

/** 跨案查实体：value 精确（归一化后）或关键词模糊；返回按案件分组的命中。 */
export function findEntity(crossDb, { kind, value, q, minCases = 1, limit = 30 } = {}) {
  const where = [];
  const params = [];
  if (kind) { where.push('kind = ?'); params.push(String(kind)); }
  if (value) { where.push('value_norm = ?'); params.push(String(value).trim().toLowerCase()); }
  if (q) { where.push('value_norm like ?'); params.push('%' + String(q).trim().toLowerCase() + '%'); }
  const w = where.length ? ' where ' + where.join(' and ') : '';
  const groups = crossDb.prepare(`select kind, value_norm valueNorm, min(value_text) valueText,
      count(distinct case_number) caseCount, count(distinct eid) evidenceCount, sum(hits) hits, max(last_ts) lastTs
    from cross_entity${w}
    group by kind, value_norm having count(distinct case_number) >= ?
    order by caseCount desc, hits desc limit ?`).all(...params, Number(minCases), Math.min(200, Number(limit) || 30));
  const mentions = crossDb.prepare(`select cm.entity_id entityId, cm.case_number caseNumber, cr.case_name caseName,
      cm.eid, cm.record_id recordId, cm.app, cm.category, cm.ts, cm.line_no lineNo, cm.base_handle baseHandle,
      cm.citable, cm.snippet
    from cross_mention cm left join case_ref cr on cr.case_number = cm.case_number
    where cm.entity_id in (select id from cross_entity where kind = ? and value_norm = ?)
    order by cm.ts desc limit 8`);
  const rows = groups.map((g) => ({
    kind: g.kind, value: g.valueText || g.valueNorm, caseCount: g.caseCount, evidenceCount: g.evidenceCount, hits: g.hits, lastTs: g.lastTs,
    cases: [...new Set(mentions.all(g.kind, g.valueNorm).map((m) => m.caseNumber))].map((cn) => {
      const list = mentions.all(g.kind, g.valueNorm).filter((m) => m.caseNumber === cn);
      return {
        caseNumber: cn, caseName: list[0]?.caseName ?? '', eids: [...new Set(list.map((m) => m.eid))],
        mentions: list.map((m) => ({ recordId: m.recordId, eid: m.eid, app: m.app, category: m.category, ts: m.ts, lineNo: m.lineNo, baseHandle: m.baseHandle, citable: m.citable, snippet: clip(m.snippet, 120) })),
      };
    }),
  }));
  return { returned: rows.length, minCases: Number(minCases), rows };
}

/** 出现在 >= minCases 个案件里的实体排行（比赛思路：先看跨案重合点）。 */
export function topShared(crossDb, { minCases = 2, kind, limit = 30 } = {}) {
  const params = [];
  let where = '';
  if (kind) { where = ' where kind = ?'; params.push(String(kind)); }
  const rows = crossDb.prepare(`select kind, value_norm valueNorm, min(value_text) valueText,
      count(distinct case_number) caseCount, count(distinct eid) evidenceCount, sum(hits) hits,
      group_concat(distinct case_number) caseNumbers
    from cross_entity${where}
    group by kind, value_norm having count(distinct case_number) >= ?
    order by caseCount desc, hits desc limit ?`).all(...params, Number(minCases), Math.min(200, Number(limit) || 30));
  return { minCases: Number(minCases), returned: rows.length, rows };
}

/** 按镜像哈希查：同一检材镜像出现在哪些案件（同一份检材被多案引用）。 */
export function findImage(crossDb, { sha256, md5, limit = 50 } = {}) {
  const where = [];
  const params = [];
  if (sha256) { where.push('sha256 = ?'); params.push(String(sha256)); }
  if (md5) { where.push('md5 = ?'); params.push(String(md5)); }
  if (!where.length) throw Object.assign(new Error('需要 sha256 或 md5'), { code: 'E_BAD_PARAM' });
  const rows = crossDb.prepare(`select case_number caseNumber, case_name caseName, eid, name, sha256, md5, size_bytes sizeBytes
    from cross_image where ${where.join(' or ')} order by case_number, eid limit ?`).all(...params, Math.min(200, Number(limit) || 50));
  return { returned: rows.length, rows };
}

export function crossStats(crossDb) {
  const one = (sql, ...p) => crossDb.prepare(sql).get(...p);
  const cases = one('select count(*) n from case_ref').n;
  const entities = one('select count(*) n from cross_entity').n;
  const shared = one('select count(*) n from (select kind, value_norm from cross_entity group by kind, value_norm having count(distinct case_number) >= 2)').n;
  const images = one('select count(*) n from cross_image').n;
  const kinds = crossDb.prepare('select kind, count(*) n from (select distinct kind, value_norm from cross_entity) group by kind order by n desc').all();
  const lastSync = one("select v from schema_meta where k = 'lastSync'")?.v ?? null;
  return { crossVersion: CROSS_VERSION, cases, entities, sharedEntities: shared, images, kinds, lastSync };
}
