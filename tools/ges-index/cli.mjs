#!/usr/bin/env node
// ges-index：火眼案件解析结果 → 本地 SQLite 索引（建库 + 树状渐进式查询）。
// 用法见 README.md；全部只读火眼数据，不写案件目录（只写 <case_dir>\.seeu-index\）。
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { classifyPath, parseChat, parseCsvLine, parseCsvRow, extractEntities, ENTITY_TYPES, DDL, SCHEMA_VERSION, CASE_DATA_ROOT } from './parse.mjs';
import { ges, gesJson, listCases, status as gesStatus, openCase, globAll, readLeaf } from './ges.mjs';

const TOOL = 'ges-index';
const TOOL_VERSION = '0.1.0';
const PAGE = 10;

// ---------- 参数 ----------
function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (/^--?[A-Za-z]/.test(a)) {
      const key = a.replace(/^--?/, '');
      const next = argv[i + 1];
      if (next !== undefined && !/^-/.test(next)) { opts[key] = next; i++; }
      else opts[key] = true;
    } else opts._.push(a);
  }
  return opts;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 公共 ----------
function resolveDb(opts) {
  if (opts.db) return resolve(String(opts.db));
  if (opts['case-dir']) return join(resolve(String(opts['case-dir'])), '.seeu-index', 'case-index.db');
  return join(process.cwd(), '.seeu-index', 'case-index.db');
}
function openReadOnly(dbPath) {
  if (!existsSync(dbPath)) fail(`找不到索引库：${dbPath}\n先运行：ges-index build --case <案件号>`);
  return new DatabaseSync(dbPath, { readOnly: true });
}
function fail(msg) {
  console.error(`[${TOOL}] ${msg}`);
  process.exit(2);
}
const out = (obj) => console.log(JSON.stringify(obj));

function caseDirWritable(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.probe');
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

// ---------- build ----------
async function cmdBuild(opts) {
  const concurrency = Math.max(1, Math.min(8, Number(opts.concurrency) || 3));
  const startedAt = Date.now();
  const t0 = Date.now();
  console.error(`[build] 探测案件…`);
  const cases = await listCases();
  if (!cases.length) fail('没有找到任何火眼案件（ges case ls 为空）');
  let target;
  if (opts.case) target = cases.find((c) => c.case_number === String(opts.case));
  else if (opts['case-dir']) {
    const dir = resolve(String(opts['case-dir'])).toLowerCase();
    target = cases.find((c) => (c.location ?? '').toLowerCase() === dir || (c.location ?? '').toLowerCase().startsWith(dir));
  } else if (cases.length === 1) target = cases[0];
  if (!target) fail(`未能确定案件（共 ${cases.length} 个）。请用 --case <case_number> 或 --case-dir <dir> 指定。`);
  const caseNumber = target.case_number;
  console.error(`[build] 案件 ${caseNumber} ${target.name ?? ''} → ${target.location ?? ''}`);

  await openCase(caseNumber).catch(() => {});
  const st = await gesStatus();
  const cid = st.cid ?? target.cid ?? null;
  const evidenceMounts = st.evidence_mounts ?? [];

  const caseDir = resolve(String(opts['out'] ?? target.location ?? '.'));
  const indexDir = opts['out'] ? caseDir : join(caseDir, '.seeu-index');
  if (!caseDirWritable(indexDir)) {
    console.error(JSON.stringify({ ok: false, code: 'E_CASE_DIR_READONLY', dir: indexDir }));
    process.exit(3);
  }
  const buildingPath = join(indexDir, 'case-index.db.building');
  const finalPath = join(indexDir, 'case-index.db');
  const manifestPath = join(indexDir, 'manifest.json');
  if (opts.rebuild) { rmSync(buildingPath, { force: true }); }
  const resuming = !!opts.resume && existsSync(buildingPath);

  console.error(`[build] 枚举叶子（${CASE_DATA_ROOT}**）…`);
  const csvLeaves = await globAll('**/data.csv', CASE_DATA_ROOT);
  const chatLeaves = await globAll('**/chat.txt', CASE_DATA_ROOT);
  let leaves = [...new Set([...csvLeaves, ...chatLeaves])].filter((p) => classifyPath(p).eid != null);
  if (opts['limit-leaves']) leaves = leaves.slice(0, Number(opts['limit-leaves']));
  if (!leaves.length) fail('没有枚举到任何叶子文件');
  const byEid = new Map();
  for (const leaf of leaves) {
    const { eid } = classifyPath(leaf);
    byEid.set(eid, (byEid.get(eid) ?? 0) + 1);
  }
  console.error(`[build] 叶子 ${leaves.length} 个，检材 ${byEid.size} 个（csv ${csvLeaves.length} / chat ${chatLeaves.length}）`);

  const db = new DatabaseSync(buildingPath);
  db.exec(DDL);
  db.exec('pragma journal_mode=delete; pragma synchronous=off;');
  const meta = db.prepare('insert or replace into meta(k,v) values(?,?)');
  meta.run('tool', TOOL);
  meta.run('tool_version', TOOL_VERSION);
  meta.run('schema_version', String(SCHEMA_VERSION));
  meta.run('case_number', caseNumber);
  meta.run('case_name', target.name ?? '');
  meta.run('case_location', target.location ?? '');
  meta.run('ges_url', target.ges_url ?? st.ges_url ?? '');
  meta.run('cid', String(cid ?? ''));
  const ci = db.prepare('insert or replace into case_info(k,v) values(?,?)');
  ci.run('case_number', caseNumber);
  ci.run('name', target.name ?? '');
  ci.run('location', target.location ?? '');
  ci.run('availability', JSON.stringify(target.availability ?? null));

  const insArt = db.prepare(`insert into artifact(eid,app,account,category,subcat,virtual_path,kind,base_handle,node_id,line_count,record_count,citable,citable_reason,ingested_at)
    values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insRec = db.prepare(`insert into record(artifact_id,eid,app,account,category,subcat,row_no,line_no,ts,actor,body,text,fields_json,origin_record_id,citable,base_handle)
    values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insFts = db.prepare('insert into record_fts(rowid,text,fields_text) values(?,?,?)');
  const insMsg = db.prepare(`insert into msg(record_id,artifact_id,app,account,peer,ts,speaker,is_local,body,line_no,base_handle,citable)
    values(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insChat = db.prepare('insert into chat_meta(artifact_id,msg_count,sent_count,time_from,time_to,summary) values(?,?,?,?,?,?)');
  const insEntity = db.prepare('insert into entity(kind,value_norm,record_id,eid) values(?,?,?,?)');
  const insLog = db.prepare('insert or replace into ingest_log(leaf,kind,status,lines,records,ms,error,base_handle,citable) values(?,?,?,?,?,?,?,?,?)');
  const insEv = db.prepare(`insert or replace into evidence(eid,name,holder,platform,type,timezone,md5,sha1,sha256,size_bytes,source_path,storage_path,created,updated,raw_json)
    values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const done = new Set();
  if (resuming) {
    for (const r of db.prepare("select leaf from ingest_log where status='ok'").all()) done.add(r.leaf);
    console.error(`[build] 断点续跑：已完成 ${done.size} 个叶子`);
  }

  const errors = [];
  let completed = 0;
  let artCount = 0;
  let recCount = 0;
  let msgCount = 0;
  let entCount = 0;
  const evidenceSeen = new Map();

  function insertCsv(leaf, c, fetched, artId) {
    let records = 0;
    let header = null;
    for (const { no, content } of fetched.lines) {
      if (no === 1) { header = parseCsvLine(content).map((s) => s.trim()); continue; }
      const parsed = parseCsvRow(content, header ?? []);
      const fieldsJson = JSON.stringify(parsed.fields);
      const r = insRec.run(artId, c.eid, c.app, c.account ?? null, c.category, c.subcat, no, no,
        parsed.ts, parsed.actor, content, content, fieldsJson, null, 1, fetched.baseHandle);
      const recordId = Number(r.lastInsertRowid);
      insFts.run(recordId, content, fieldsJson);
      records++;
      if (ENTITY_TYPES.has(c.category)) {
        const val = (parsed.cells ?? []).find((v) => v && v.trim() !== '') ?? parsed.cells?.[0];
        if (val) { insEntity.run(c.category, String(val).trim(), recordId, c.eid); entCount++; }
      }
      for (const e of extractEntities(content)) { insEntity.run(e.kind, e.value, recordId, c.eid); entCount++; }
    }
    return { records, header };
  }

  function insertChat(leaf, c, fetched, artId) {
    const { header, messages } = parseChat(fetched.lines);
    let records = 0;
    const account = c.account ?? '';
    const peer = c.rest[c.rest.length - 1] ?? '';
    for (const row of messages) {
      const r = insRec.run(artId, c.eid, c.app, account, c.category, c.subcat, row.no, row.no,
        row.ts, row.speaker, row.body, row.text, null, row.originRecordId, 1, fetched.baseHandle);
      const recordId = Number(r.lastInsertRowid);
      insFts.run(recordId, row.text, '');
      insMsg.run(recordId, artId, c.app, account, peer, row.ts, row.speaker ?? '', row.isLocal ?? 0,
        row.body, row.no, fetched.baseHandle, 1);
      records++;
      for (const e of extractEntities(row.body)) { insEntity.run(e.kind, e.value, recordId, c.eid); entCount++; }
    }
    if (header) insChat.run(artId, header.msgCount, header.sent, header.from, header.to, header.summary);
    msgCount += messages.length;
    return { records, header };
  }

  async function fetchLeaf(path) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await readLeaf(path); }
      catch (e) { lastErr = e; await sleep(500 * (attempt + 1)); }
    }
    throw lastErr;
  }

  const todo = leaves.filter((p) => !done.has(p));
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= todo.length) return;
      const leaf = todo[idx];
      const started = Date.now();
      const c = classifyPath(leaf);
      try {
        const fetched = await fetchLeaf(leaf);
        const citable = fetched.baseHandle ? 1 : 0;
        const nodeId = fetched.baseHandle ? fetched.baseHandle.split('/').pop() : null;
        db.exec('begin');
        let records = 0;
        try {
          const art = insArt.run(c.eid, c.app, c.account ?? null, c.category, c.subcat, leaf, c.kind,
            fetched.baseHandle, nodeId, fetched.total ?? fetched.lines.length, 0, citable,
            citable ? null : 'no-base-handle', new Date().toISOString());
          const artId = Number(art.lastInsertRowid);
          const r = c.kind === 'chat' ? insertChat(leaf, c, fetched, artId) : insertCsv(leaf, c, fetched, artId);
          records = r.records;
          db.prepare('update artifact set record_count=? where id=?').run(records, artId);
          insLog.run(leaf, c.kind, 'ok', fetched.lines.length, records, Date.now() - started, null, fetched.baseHandle, citable);
          db.exec('commit');
          artCount++;
          recCount += records;
        } catch (e) {
          db.exec('rollback');
          throw e;
        }
        // 检材元数据（检材信息/data.csv）
        if (c.category === '检材信息' || leaf.includes('/检材信息/')) {
          const ev = pickEvidence(fetched, c);
          if (ev) evidenceSeen.set(c.eid, ev);
        }
      } catch (e) {
        const msg = String(e?.message ?? e).slice(0, 500);
        errors.push({ leaf, error: msg });
        try { insLog.run(leaf, c.kind, 'error', 0, 0, Date.now() - started, msg, null, 0); } catch {}
      } finally {
        completed++;
        if (completed % 5 === 0 || completed === todo.length) {
          const elapsed = (Date.now() - t0) / 1000;
          const eta = completed > 0 ? (elapsed / completed) * (todo.length - completed) : 0;
          console.error(`[build] ${completed}/${todo.length} ${(100 * completed / todo.length).toFixed(1)}% elapsed=${elapsed.toFixed(0)}s eta=${eta.toFixed(0)}s`);
        }
      }
    }
  }
  const tEnum = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.error(`[build] 抓取完成，用时 ${((Date.now() - tEnum) / 1000).toFixed(1)}s`);

  for (const [eid, ev] of evidenceSeen) {
    insEv.run(eid, ev.name, ev.holder, ev.platform, ev.type, ev.timezone, ev.md5, ev.sha1, ev.sha256,
      ev.size, ev.source_path, ev.storage_path, ev.created, ev.updated, ev.raw_json);
  }

  const integrity = db.prepare('pragma integrity_check').get();
  const integrityOk = Object.values(integrity ?? {})[0] === 'ok' || JSON.stringify(integrity).includes('ok');
  const counts = {
    artifacts: db.prepare('select count(*) n from artifact').get().n,
    records: db.prepare('select count(*) n from record').get().n,
    messages: db.prepare('select count(*) n from msg').get().n,
    entities: db.prepare('select count(*) n from entity').get().n,
    chats: db.prepare('select count(*) n from chat_meta').get().n,
    citableArtifacts: db.prepare('select count(*) n from artifact where citable=1').get().n,
    nonCitableArtifacts: db.prepare('select count(*) n from artifact where citable=0').get().n,
  };
  db.close();

  const coverageOk = counts.artifacts === leaves.length && errors.length === 0;
  const fingerprint = createHash('sha256')
    .update(leaves.slice().sort().join('\n'))
    .update(JSON.stringify([...evidenceSeen.values()].map((e) => [e.eid, e.updated])))
    .digest('hex');

  const manifest = {
    tool: TOOL, toolVersion: TOOL_VERSION, schemaVersion: SCHEMA_VERSION,
    case: { number: caseNumber, name: target.name ?? '', location: target.location ?? '', cid, gesUrl: target.ges_url ?? st.ges_url ?? '' },
    builtAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    leaves: { total: leaves.length, csv: csvLeaves.length, chat: chatLeaves.length, evidence: byEid.size, failed: errors.length },
    counts,
    fingerprint,
    integrityOk,
    coverageOk,
    errors,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  if (!coverageOk) {
    console.error(`[build] 校验失败：叶子 ${leaves.length} != artifact ${counts.artifacts}，或存在失败叶子 ${errors.length} 个；保留 building 库不替换。`);
    console.error(JSON.stringify({ ok: false, ...manifest }));
    process.exit(1);
  }
  if (existsSync(finalPath)) {
    rmSync(`${finalPath}.bak`, { force: true });
    renameSync(finalPath, `${finalPath}.bak`);
  }
  renameSync(buildingPath, finalPath);
  console.error(`[build] 完成：${finalPath}（${(statSync(finalPath).size / 1048576).toFixed(2)} MiB，${(Date.now() - startedAt) / 1000}s）`);
  out({ ok: true, db: finalPath, manifest });
}

function pickEvidence(fetched, c) {
  if (!fetched.lines.length) return null;
  const header = parseCsvLine(fetched.lines[0].content).map((s) => s.trim());
  const row = fetched.lines[1] ? parseCsvLine(fetched.lines[1].content) : [];
  const get = (name) => {
    const i = header.indexOf(name);
    return i >= 0 ? (row[i] ?? '') : '';
  };
  return {
    eid: c.eid,
    name: get('检材名称'),
    holder: get('持有人'),
    platform: get('平台'),
    type: get('检材类型'),
    timezone: get('时区'),
    md5: get('MD5'),
    sha1: get('SHA1'),
    sha256: get('SHA256'),
    size: Number(get('检材大小(字节)') || 0) || null,
    source_path: get('原始路径'),
    storage_path: get('存储路径'),
    created: get('创建时间'),
    updated: get('更新时间'),
    raw_json: JSON.stringify(Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']))),
  };
}

// ---------- 查询：树 ----------
const enc = (s) => encodeURIComponent(s ?? '');
const dec = (s) => decodeURIComponent(s ?? '');
const clip = (s, n) => ((s ?? '').length > n ? (s ?? '').slice(0, n) + '…' : (s ?? ''));
const STRIP = CASE_DATA_ROOT;
const shortPath = (p) => (p ?? '').replace(STRIP, '…/');
const baseName = (p) => (p ?? '').split('/').filter(Boolean).pop();

function cmdTree(db, node) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
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
    if (!art) fail('artifact 不存在');
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
    if (!r) fail('记录不存在');
    return {
      node: `cite:${r.id}`, ts: r.ts, line: r.line_no, path: shortPath(r.path),
      citable: !!r.base_handle,
      citation: r.base_handle ? `[[1]](${r.base_handle}#${r.line_no})` : null,
      verifyCmd: r.base_handle ? `ges read "${r.path}" --offset ${r.line_no - 1} --limit 1` : '本行无溯源句柄，只能作为导航',
      text: clip(r.text, 200),
    };
  }
  fail('未知节点。可用：root | ev:<eid> | app:<eid>|<app> | acc:<eid>|<app>|<account> | cat:<eid>|<app>|<account>|<cat> | art:<id>[:page] | cite:<recordId>');
}

// ---------- 查询：search / cite / stats / verify ----------
function cmdSearch(db, opts) {
  const q = String(opts.q ?? opts._?.[1] ?? '').trim();
  if (!q) fail('缺少关键词：ges-index search -q <关键词>');
  const limit = Math.min(50, Number(opts.limit) || 10);
  const filters = [];
  const params = [];
  if (opts.eid) { filters.push('r.eid=?'); params.push(Number(opts.eid)); }
  if (opts.app) { filters.push('r.app=?'); params.push(String(opts.app)); }
  if (opts.account) { filters.push('ifnull(r.account,\'\')=?'); params.push(String(opts.account)); }
  if (opts.category) { filters.push('r.category=?'); params.push(String(opts.category)); }
  if (opts.from) { filters.push('r.ts>=?'); params.push(String(opts.from)); }
  if (opts.to) { filters.push('r.ts<=?'); params.push(String(opts.to)); }
  const where = filters.length ? ` and ${filters.join(' and ')}` : '';
  let engine = 'like';
  let rows;
  if (q.length >= 3) {
    engine = 'fts5-trigram';
    const sql = `select r.id, r.eid, r.app, r.account, r.category, r.ts, r.line_no,
        snippet(record_fts, 0, '«', '»', '…', 10) snip
      from record_fts f join record r on r.id=f.rowid
      where record_fts match ?${where} limit ?`;
    try { rows = db.prepare(sql).all(q, ...params, limit); }
    catch { engine = 'like'; }
  }
  if (!rows) {
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
    citeHint: '取引用：ges-index cite <id>',
  };
}

function cmdCite(db, id) {
  const r = db.prepare(`select r.*, a.virtual_path path from record r join artifact a on a.id=r.artifact_id where r.id=?`).get(Number(id));
  if (!r) fail(`记录 ${id} 不存在`);
  return {
    id: r.id, eid: r.eid, app: r.app, account: r.account ?? '', cat: r.category,
    sub: r.subcat, ts: r.ts, line: r.line_no, path: shortPath(r.path),
    citable: !!r.base_handle,
    citation: r.base_handle ? `[[1]](${r.base_handle}#${r.line_no})` : null,
    verifyCmd: r.base_handle ? `ges read "${r.path}" --offset ${r.line_no - 1} --limit 1` : '本行无溯源句柄，只能作为导航',
    text: clip(r.text, 300),
  };
}

function cmdStats(db) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
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

async function cmdVerify(db, opts) {
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

// ---------- main ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0] ?? 'help';
  if (cmd === 'version') return out({ tool: TOOL, version: TOOL_VERSION, schemaVersion: SCHEMA_VERSION });
  if (cmd === 'build') return cmdBuild(opts);
  if (cmd === 'help' || cmd === '--help') {
    console.log(`ges-index ${TOOL_VERSION}

建库：
  ges-index build --case <case_number>|--case-dir <dir> [--concurrency 3] [--rebuild|--resume] [--limit-leaves N]

查询（树状渐进式披露）：
  ges-index tree                      根：案件概览 + 检材
  ges-index tree "ev:3"               检材 → 应用
  ges-index tree "app:3|WhatsApp"     应用 → 账号或分类
  ges-index tree "cat:3|WhatsApp||群聊消息"
  ges-index tree "art:45"             文件 → 前 10 条记录
  ges-index tree "cite:1"             记录 → Goldeneyes 引用
  ges-index search -q <kw> [--eid 3] [--app WhatsApp] [--limit 10]
  ges-index cite <recordId>
  ges-index stats
  ges-index verify [--sample 20]      随机回火眼核对引用一致性

索引库位置：<case_dir>\\.seeu-index\\case-index.db（或用 --db 指定）`);
    return;
  }

  const dbPath = resolveDb(opts);
  const db = openReadOnly(dbPath);
  let result;
  if (cmd === 'tree') result = cmdTree(db, opts._[1] ?? 'root');
  else if (cmd === 'search') result = cmdSearch(db, { ...opts, _: opts._ });
  else if (cmd === 'cite') result = cmdCite(db, opts._[1]);
  else if (cmd === 'stats') result = cmdStats(db);
  else if (cmd === 'verify') result = await cmdVerify(db, opts);
  else fail(`未知命令：${cmd}（ges-index help 查看用法）`);
  db.close();
  out(result);
}

main().catch((e) => {
  console.error(`[${TOOL}] 失败：${e?.stack ?? e}`);
  process.exit(1);
});
