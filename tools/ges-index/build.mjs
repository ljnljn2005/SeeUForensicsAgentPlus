// 建库核心：探测火眼案件 → 枚举叶子 → 并发抓取解析 → SQLite 建库 → 校验 → 原子替换。
// 供 CLI（cli.mjs）与桌面插件（plugins/seeu-case-index 宿主端）共用；不含任何进程退出逻辑。
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  classifyPath, parseChat, parseCsvLine, parseCsvRow, extractEntities, ENTITY_TYPES,
  DDL, SCHEMA_VERSION, CASE_DATA_ROOT,
} from './parse.mjs';
import { listCases, status as gesStatus, openCase, globAll, readLeaf } from './ges.mjs';

export const TOOL = 'ges-index';
export const TOOL_VERSION = '0.1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class IndexBuildError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'IndexBuildError';
    this.code = code;
    Object.assign(this, detail);
  }
}

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

/**
 * 建库。
 * @param {object} opts
 * @param {string} [opts.caseNumber]  案件号（与 caseDir 二选一）
 * @param {string} [opts.caseDir]     案件目录（dsh 工作目录）
 * @param {string} [opts.out]         索引输出目录（默认 <caseDir>/.seeu-index，或 --out 指定的目录本身）
 * @param {number} [opts.concurrency] 并发抓取数，默认 3
 * @param {boolean} [opts.rebuild]    丢弃 .building 重新开始
 * @param {boolean} [opts.resume]     复用 .building 里已成功的叶子
 * @param {number} [opts.limitLeaves] 只抓前 N 个叶子（冒烟）
 * @param {(p:object)=>void} [opts.onProgress] 进度回调
 * @param {(msg:string)=>void} [opts.log]      日志回调
 * @returns {Promise<{ok:true, db:string, manifest:object}>}
 */
export async function buildIndex(opts = {}) {
  const {
    caseNumber = null, caseDir = null, out = null, concurrency = 3,
    rebuild = false, resume = false, limitLeaves = null,
    onProgress = () => {}, log = () => {},
  } = opts;
  const progress = (p) => { try { onProgress(p); } catch { /* 进度回调不应影响建库 */ } };
  const startedAt = Date.now();
  const t0 = Date.now();

  progress({ phase: 'probe', message: '探测案件', elapsedMs: 0 });
  const cases = await listCases();
  if (!cases.length) throw new IndexBuildError('E_NO_CASE', '没有找到任何火眼案件（ges case ls 为空）');
  let target;
  if (caseNumber) target = cases.find((c) => c.case_number === String(caseNumber));
  else if (caseDir) {
    const dir = resolve(caseDir).toLowerCase();
    target = cases.find((c) => {
      const loc = (c.location ?? '').toLowerCase();
      return loc === dir || loc.startsWith(dir) || dir.startsWith(loc);
    });
  } else if (cases.length === 1) target = cases[0];
  if (!target) {
    throw new IndexBuildError('E_CASE_NOT_FOUND', `未能确定案件（共 ${cases.length} 个），请指定案件号或案件目录`, { cases });
  }
  const cn = target.case_number;
  log(`[build] 案件 ${cn} ${target.name ?? ''} → ${target.location ?? ''}`);

  await openCase(cn).catch(() => {});
  const st = await gesStatus();
  const cid = st.cid ?? target.cid ?? null;

  const baseDir = resolve(String(out ?? target.location ?? '.'));
  const indexDir = out ? baseDir : join(baseDir, '.seeu-index');
  if (!caseDirWritable(indexDir)) {
    throw new IndexBuildError('E_CASE_DIR_READONLY', `索引目录不可写：${indexDir}`, { dir: indexDir });
  }
  const buildingPath = join(indexDir, 'case-index.db.building');
  const finalPath = join(indexDir, 'case-index.db');
  const manifestPath = join(indexDir, 'manifest.json');
  if (rebuild) rmSync(buildingPath, { force: true });
  const resuming = !!resume && existsSync(buildingPath);

  progress({ phase: 'enumerate', message: '枚举叶子', elapsedMs: Date.now() - t0 });
  const csvLeaves = await globAll('**/data.csv', CASE_DATA_ROOT);
  const chatLeaves = await globAll('**/chat.txt', CASE_DATA_ROOT);
  let leaves = [...new Set([...csvLeaves, ...chatLeaves])].filter((p) => classifyPath(p).eid != null);
  if (limitLeaves) leaves = leaves.slice(0, Number(limitLeaves));
  if (!leaves.length) throw new IndexBuildError('E_NO_LEAF', '没有枚举到任何叶子文件');
  const byEid = new Map();
  for (const leaf of leaves) {
    const { eid } = classifyPath(leaf);
    byEid.set(eid, (byEid.get(eid) ?? 0) + 1);
  }
  log(`[build] 叶子 ${leaves.length} 个，检材 ${byEid.size} 个（csv ${csvLeaves.length} / chat ${chatLeaves.length}）`);
  progress({
    phase: 'enumerate', done: true, total: leaves.length, evidences: byEid.size,
    csv: csvLeaves.length, chat: chatLeaves.length, elapsedMs: Date.now() - t0,
  });

  const db = new DatabaseSync(buildingPath);
  db.exec(DDL);
  db.exec('pragma journal_mode=delete; pragma synchronous=off;');
  const meta = db.prepare('insert or replace into meta(k,v) values(?,?)');
  meta.run('tool', TOOL);
  meta.run('tool_version', TOOL_VERSION);
  meta.run('schema_version', String(SCHEMA_VERSION));
  meta.run('case_number', cn);
  meta.run('case_name', target.name ?? '');
  meta.run('case_location', target.location ?? '');
  meta.run('ges_url', target.ges_url ?? st.ges_url ?? '');
  meta.run('cid', String(cid ?? ''));
  const ci = db.prepare('insert or replace into case_info(k,v) values(?,?)');
  ci.run('case_number', cn);
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
    log(`[build] 断点续跑：已完成 ${done.size} 个叶子`);
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
  let lastEmit = 0;

  function emitFetch(force = false, current = null) {
    const now = Date.now();
    if (!force && now - lastEmit < 400) return;
    lastEmit = now;
    const elapsed = (Date.now() - t0) / 1000;
    const eta = completed > 0 ? (elapsed / completed) * (todo.length - completed) : 0;
    progress({
      phase: 'fetch', completed, total: todo.length,
      percent: todo.length ? Math.round((1000 * completed) / todo.length) / 10 : 100,
      elapsedMs: Math.round(elapsed * 1000), etaMs: Math.round(eta * 1000), current,
    });
  }

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
        if (c.category === '检材信息' || leaf.includes('/检材信息/')) {
          const ev = pickEvidence(fetched, c);
          if (ev) evidenceSeen.set(c.eid, ev);
        }
      } catch (e) {
        const msg = String(e?.message ?? e).slice(0, 500);
        errors.push({ leaf, error: msg });
        try { insLog.run(leaf, c.kind, 'error', 0, 0, Date.now() - started, msg, null, 0); } catch { /* 忽略 */ }
      } finally {
        completed++;
        emitFetch(completed === todo.length, leaf);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, () => worker()));
  log(`[build] 抓取完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  for (const [eid, ev] of evidenceSeen) {
    insEv.run(eid, ev.name, ev.holder, ev.platform, ev.type, ev.timezone, ev.md5, ev.sha1, ev.sha256,
      ev.size, ev.source_path, ev.storage_path, ev.created, ev.updated, ev.raw_json);
  }

  progress({ phase: 'finalize', message: '校验与原子替换', elapsedMs: Date.now() - t0 });
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
    case: { number: cn, name: target.name ?? '', location: target.location ?? '', cid, gesUrl: target.ges_url ?? st.ges_url ?? '' },
    builtAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    leaves: { total: leaves.length, csv: csvLeaves.length, chat: chatLeaves.length, evidence: byEid.size, failed: errors.length },
    counts, fingerprint, integrityOk, coverageOk, errors,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  if (!coverageOk) {
    progress({ phase: 'failed', manifest, elapsedMs: Date.now() - t0 });
    throw new IndexBuildError('E_VALIDATION', `校验失败：叶子 ${leaves.length} != artifact ${counts.artifacts}，或失败叶子 ${errors.length} 个（保留 building 库）`, { manifest, db: buildingPath });
  }
  if (existsSync(finalPath)) {
    rmSync(`${finalPath}.bak`, { force: true });
    renameSync(finalPath, `${finalPath}.bak`);
  }
  renameSync(buildingPath, finalPath);
  const out2 = { ok: true, db: finalPath, indexPath: indexDir, manifest: { ...manifest, sizeBytes: statSync(finalPath).size } };
  progress({ phase: 'done', ...out2, elapsedMs: Date.now() - t0 });
  log(`[build] 完成：${finalPath}（${(statSync(finalPath).size / 1048576).toFixed(2)} MiB，${((Date.now() - startedAt) / 1000).toFixed(0)}s）`);
  return out2;
}
