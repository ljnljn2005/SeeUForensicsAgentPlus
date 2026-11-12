// 宿主端：把「建库 + 查库」暴露成 Web UI 可调用的本地 HTTP 路由（前缀 /seeu-index）。
// 桌面外壳把本包装进 web profile，Web 客户端插件（client.js）在设置页里给界面。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildIndex, IndexBuildError } from '../../tools/ges-index/build.mjs';
import { openIndex, findIndexes, tree, search, cite, statsOf, verify, typedTables, table, entity, timeline, records, evidences, facets } from '../../tools/ges-index/query.mjs';
import { genericCsv, recordsCsv } from '../../tools/ges-index/csv.mjs';
import { crossDbPath, findEntity, findImage, listCases, openCross, crossStats, syncAll, syncCase, topShared } from '../../tools/ges-index/cross.mjs';

const ROUTE = '/seeu-index';
const jobs = new Map();
const MAX_JOBS = 20;

/** 只接受形如 <...>/.seeu-index/case-index.db 且存在的库文件。 */
function safeDb(param) {
  if (!param) throw Object.assign(new Error('缺少 db 参数'), { status: 400 });
  const abs = resolve(param);
  if (!abs.endsWith('.db') || basename(dirname(abs)) !== '.seeu-index') {
    throw Object.assign(new Error('db 必须是 <案件目录>/.seeu-index/case-index.db'), { status: 403 });
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) throw Object.assign(new Error('索引库不存在'), { status: 404 });
  return abs;
}

/** 跨案中央库位置：SEEU_CROSS_DB 优先，否则 <工作区>/indexes/crosscase.db。 */
function crossPath() {
  if (process.env.SEEU_CROSS_DB) return resolve(process.env.SEEU_CROSS_DB);
  const ws = process.env.SEEU_WORKSPACE || process.cwd();
  return crossDbPath(resolve(ws));
}

/** 把一个建好/更新的案件库同步进中央库（失败只记日志，不影响主流程）。 */
function syncOneCase(dbPath) {
  try {
    const xdb = openCross(crossPath());
    try {
      const caseDb = new (require('node:sqlite').DatabaseSync)(dbPath, { readOnly: true });
      try { return syncCase(xdb, caseDb, { dbPath }); } finally { caseDb.close(); }
    } finally { xdb.close(); }
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

function defaultDirs() {
  const env = process.env.SEEU_INDEX_SEARCH_DIRS ?? '';
  return env.split(';').map((s) => s.trim()).filter(Boolean);
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // 同源调用；显式允许本机其它端口的调试读取（不涉及凭据）
    'access-control-allow-origin': '*',
  });
  res.end(text);
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    ...headers,
  });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function startBuild(args) {
  const dir = resolve(String(args.dir ?? ''));
  if (!existsSync(dir)) throw Object.assign(new Error(`案件目录不存在：${dir}`), { status: 404 });
  const job = { id: randomUUID(), dir, status: 'running', phase: 'probe', completed: 0, total: 0, percent: 0, startedAt: Date.now() };
  jobs.set(job.id, job);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
  buildIndex({
    caseDir: dir,
    concurrency: Number(args.concurrency) || 3,
    rebuild: args.rebuild !== false,
    onProgress: (p) => {
      job.phase = p.phase ?? job.phase;
      if (typeof p.completed === 'number') job.completed = p.completed;
      if (typeof p.total === 'number') job.total = p.total;
      if (typeof p.percent === 'number') job.percent = p.percent;
      if (p.message) job.message = p.message;
    },
    log: () => {},
  }).then((result) => {
    job.status = 'done';
    job.phase = 'done';
    job.percent = 100;
    job.result = result;
    job.cross = syncOneCase(result.db);
    job.brief = refreshBrief();
    job.elapsedMs = Date.now() - job.startedAt;
  }).catch((error) => {
    job.status = 'failed';
    job.code = error instanceof IndexBuildError ? error.code : (error?.code ?? 'E_UNKNOWN');
    job.error = error?.message ?? String(error);
    job.elapsedMs = Date.now() - job.startedAt;
  });
  return { jobId: job.id, dir };
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname.slice(ROUTE.length) || '/';
  try {
    if (req.method === 'POST' && path === '/build') {
      return send(res, 200, startBuild(await readBody(req)));
    }
    if (req.method === 'GET' && path === '/build') {
      const job = jobs.get(url.searchParams.get('job') ?? '');
      if (!job) return send(res, 404, { error: 'job 不存在' });
      return send(res, 200, job);
    }
    if (req.method === 'GET' && path === '/list') {
      const dirs = [
        ...url.searchParams.getAll('dir').flatMap((v) => v.split(/[;,]/)).filter(Boolean),
        ...defaultDirs(),
      ];
      const indexes = findIndexes([...new Set(dirs)]);
      rememberDirs(indexes.map((i) => i.caseDir));
      refreshBrief(indexes);
      return send(res, 200, { indexes });
    }
    // ---------- 会话上下文里的案件概览（AGENTS.md 注入状态） ----------
    if (path === '/brief') {
      if (req.method === 'POST') {
        const result = refreshBrief();
        return send(res, 200, { result, state: briefState });
      }
      const dbParam = url.searchParams.get('db') ?? '';
      let current = null;
      if (dbParam) {
        try {
          const abs = safeDb(dbParam);
          const list = findIndexes(briefDirs());
          current = { dbPath: abs, included: list.some((i) => resolve(i.dbPath) === abs) };
        } catch {
          current = null;
        }
      }
      return send(res, 200, { state: briefState, current, dshHome: process.env.DSH_HOME ?? null });
    }
    // ---------- 跨案中央库（M5） ----------
    if (path.startsWith('/cross/')) {
      const xdb = openCross(crossPath());
      try {
        if (path === '/cross/list') {
          return send(res, 200, { crossPath: crossPath(), stats: crossStats(xdb), cases: listCases(xdb) });
        }
        if (req.method === 'POST' && path === '/cross/sync') {
          const dirs = [...new Set([...defaultDirs()])];
          const indexes = findIndexes(dirs);
          const results = syncAll(xdb, indexes);
          xdb.prepare("insert or replace into schema_meta(k, v) values('lastSync', ?)").run(new Date().toISOString());
          return send(res, 200, { crossPath: crossPath(), indexes: indexes.length, cases: results });
        }
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
        if (path === '/cross/entity') {
          const opts = { minCases: url.searchParams.get('minCases') ?? 1, limit: url.searchParams.get('limit') ?? 30 };
          for (const k of ['kind', 'value', 'q']) if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
          return send(res, 200, findEntity(xdb, opts));
        }
        if (path === '/cross/top') {
          const opts = { minCases: url.searchParams.get('minCases') ?? 2, limit: url.searchParams.get('limit') ?? 30 };
          if (url.searchParams.get('kind')) opts.kind = url.searchParams.get('kind');
          return send(res, 200, topShared(xdb, opts));
        }
        if (path === '/cross/files') {
          return send(res, 200, findImage(xdb, { sha256: url.searchParams.get('sha256'), md5: url.searchParams.get('md5') }));
        }
        if (path === '/cross/stats') return send(res, 200, crossStats(xdb));
      } finally {
        xdb.close();
      }
      return send(res, 404, { error: `未知跨案接口 ${path}` });
    }

    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });

    const dbPath = safeDb(url.searchParams.get('db'));
    const db = openIndex(dbPath);
    try {
      if (path === '/tree') return send(res, 200, tree(db, url.searchParams.get('node') || 'root'));
      if (path === '/search') {
        const opts = { q: url.searchParams.get('q'), limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') };
        for (const k of ['eid', 'app', 'account', 'category', 'from', 'to']) if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        return send(res, 200, search(db, opts));
      }
      if (path === '/cite') return send(res, 200, cite(db, url.searchParams.get('id')));
      if (path === '/stats') return send(res, 200, statsOf(db));
      if (path === '/evidences') return send(res, 200, { evidences: evidences(db) });
      if (path === '/facets') {
        const opts = {};
        if (url.searchParams.get('eid')) opts.eid = url.searchParams.get('eid');
        return send(res, 200, facets(db, opts));
      }
      if (path === '/tables') return send(res, 200, { tables: typedTables(db) });
      if (path === '/table') {
        const name = url.searchParams.get('name') ?? '';
        const opts = { limit: url.searchParams.get('limit') ?? 20, offset: url.searchParams.get('offset') ?? 0 };
        for (const k of ['eid', 'app', 'account', 'subcat', 'q', 'from', 'to']) if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        return send(res, 200, table(db, name, opts));
      }
      if (path === '/entity') {
        const opts = { limit: url.searchParams.get('limit') ?? 20 };
        for (const k of ['kind', 'q', 'value', 'eid']) if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        return send(res, 200, entity(db, opts));
      }
      if (path === '/timeline') {
        const opts = {};
        for (const k of ['eid', 'app', 'bucket', 'from', 'to', 'limit']) if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        return send(res, 200, timeline(db, opts));
      }
      if (path === '/records') {
        const opts = { limit: url.searchParams.get('limit') ?? 20, offset: url.searchParams.get('offset') ?? 0 };
        for (const k of ['eid', 'app', 'account', 'category', 'artifact', 'from', 'to']) if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        return send(res, 200, records(db, opts));
      }
      if (path === '/export/table.csv') {
        const name = String(url.searchParams.get('name') ?? '');
        if (!name) return send(res, 400, { error: '缺少 name' });
        const opts = {};
        for (const k of ['eid', 'app', 'account', 'subcat', 'from', 'to', 'q']) {
          if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        }
        const max = Math.min(20000, Math.max(1, Number(url.searchParams.get('max')) || 20000));
        const pageSize = 200;
        const rows = [];
        let total = 0;
        let columns = [];
        for (let off = 0; off < max; off += pageSize) {
          const page = table(db, name, { ...opts, limit: pageSize, offset: off });
          total = page.total;
          columns = page.columns;
          rows.push(...page.rows);
          if (page.next == null || rows.length >= max) break;
        }
        const csv = genericCsv(columns, rows.slice(0, max));
        return sendText(res, 200, csv, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="seeu-table-${name}-${Date.now()}.csv"`,
          'x-seeu-rows': String(rows.length),
          'x-seeu-total': String(total),
          'x-seeu-truncated': String(total > rows.length),
        });
      }
      if (path === '/export/records.csv') {
        const opts = {};
        for (const k of ['eid', 'app', 'account', 'category', 'artifact', 'from', 'to', 'q']) {
          if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        }
        const max = Math.min(20000, Math.max(1, Number(url.searchParams.get('max')) || 20000));
        const pageSize = 100;
        const rows = [];
        let total = 0;
        for (let off = 0; off < max; off += pageSize) {
          const page = records(db, { ...opts, limit: pageSize, offset: off });
          total = page.total;
          rows.push(...page.rows);
          if (page.next == null || rows.length >= max) break;
        }
        const csv = recordsCsv(rows.slice(0, max));
        return sendText(res, 200, csv, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="seeu-records-${Date.now()}.csv"`,
          'x-seeu-rows': String(rows.length),
          'x-seeu-total': String(total),
          'x-seeu-truncated': String(total > rows.length),
        });
      }
      if (path === '/verify') return send(res, 200, await verify(db, { sample: url.searchParams.get('sample') ?? 20 }));
    } finally {
      db.close();
    }
    return send(res, 404, { error: `未知接口 ${path}` });
  } catch (error) {
    return send(res, error?.status ?? 500, { error: error?.message ?? String(error), code: error?.code });
  }
}

/**
 * Cordis 宿主插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 */
// ---------- 「案件概览」指令注入 ----------
// 本地小模型常常「不知道分析哪个检材」就乱猜，或者懒得调 /evidences。
// 建库/扫描后把索引里的案件与检材清单写成：
//   1. <DSH_HOME>/AGENTS.md 里的 seeu 区块（dsh 的用户级指令文件，任何会话都会读到，最可靠）；
//   2. <工作区>/SEEU-CASE-BRIEF.md（会话工作区恰好是外壳工作区时也读得到）。
// 两处都带标记，只替换自己的区块，绝不动用户手写内容。
const BRIEF_NAME = 'SEEU-CASE-BRIEF.md';
const BRIEF_MARKER = '<!-- seeu-case-brief';
const BRIEF_END = '<!-- /seeu-case-brief -->';
let briefSig = '';
// 最近一次注入结果（面板可见，便于确认「会话里确实带上了案件概览」）
const briefState = { at: null, ok: null, path: null, cases: 0, chars: 0, error: null };

function briefDirs() {
  const dirs = [...defaultDirs()];
  const file = process.env.SEEU_INDEX_STATE_FILE;
  try {
    if (file && existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      dirs.push(...(Array.isArray(parsed.dirs) ? parsed.dirs : []));
    }
  } catch {
    /* 状态文件损坏就当没有 */
  }
  return [...new Set(dirs.map((d) => String(d ?? '').trim()).filter(Boolean))];
}

/** 生成带标记的 Markdown 区块：案件 → 检材表（eid/名称/平台/记录数）+ 查询提示。 */
function briefText(indexes) {
  const lines = [
    BRIEF_MARKER + '：由 SeeU 取证智能体自动生成，重建索引后自动刷新，请勿手工编辑 -->',
    '',
    '## 本机案件索引概览',
    '',
  ];
  if (!indexes.length) {
    lines.push('本机当前还没有案件索引库。若用户提到检材或案件，先请他在「取证索引」面板里选择案件目录并点「建库 / 更新」，再开始分析。');
    lines.push(BRIEF_END);
    return lines.join('\n') + '\n';
  }
  lines.push(
    '查询入口：环境变量 SEEU_INDEX_API（如 curl -s "$SEEU_INDEX_API/list"）。',
    '规则：用户说检材名时，用下表把名称对应到 eid 再查，**不要猜 eid**；表里没有就问用户。',
    '',
  );
  for (const ix of indexes.slice(0, 5)) {
    let evs = [];
    let totals = null;
    let timeRange = null;
    try {
      const db = openIndex(ix.dbPath);
      try {
        const rootView = tree(db, 'root') ?? null;
        totals = rootView?.totals ?? null;
        timeRange = rootView?.timeRange ?? null;
        evs = evidences(db);
      } finally {
        db.close();
      }
    } catch {
      evs = [];
    }
    lines.push('### ' + (ix.caseName || ix.caseDir || ix.dbPath), '');
    lines.push('- 索引库：' + ix.dbPath);
    lines.push('- 规模：检材 ' + evs.length + ' 个' + (totals ? ' · 记录 ' + totals.records + ' 条 · 实体 ' + totals.entities + ' 个' : '') + (ix.builtAt ? ' · 生成 ' + ix.builtAt : ''));
    if (timeRange?.f) lines.push('- 数据时间范围：' + timeRange.f + ' → ' + timeRange.t);
    if (evs.length) {
      lines.push('', '| eid | 检材 | 名称 | 平台 | 记录数 |', '| --- | --- | --- | --- | --- |');
      for (const ev of evs.slice(0, 50)) {
        lines.push('| ' + ev.eid + ' | 检材 ' + ev.eid + ' | ' + String(ev.name ?? '') + ' | ' + String(ev.platform ?? '') + ' | ' + (ev.recordCount ?? '') + ' |');
      }
      lines.push('', '（记录数按本索引实际解析入库的行数统计，与火眼界面上的「记录数」口径不同；各检材之和等于上面的记录总数。）');
    }
    lines.push('');
  }
  lines.push(BRIEF_END);
  return lines.join('\n') + '\n';
}

/** 把我们的区块合并进已有文件：有旧区块就替换，没有就追加，绝不整文件覆盖。 */
function mergeBrief(existing, block) {
  if (existing === null || existing.trim() === '') return block;
  const start = existing.indexOf(BRIEF_MARKER);
  if (start >= 0) {
    const end = existing.indexOf(BRIEF_END, start);
    if (end >= 0) return existing.slice(0, start) + block + existing.slice(end + BRIEF_END.length).replace(/^\n+/, '\n');
    return existing.slice(0, start) + block;
  }
  return existing.replace(/\s*$/, '') + '\n\n' + block;
}

function writeBriefFile(target, block) {
  let prev = null;
  try {
    if (existsSync(target)) prev = readFileSync(target, 'utf8');
  } catch {
    prev = null;
  }
  const next = mergeBrief(prev, block);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, next, 'utf8');
  return next.length;
}

/** 写/刷新概览（内容没变就跳过）。写到 dsh 用户级 AGENTS.md，任何会话都会读到；
 *  没有 DSH_HOME 时退回到工作区文件。
 */
export function writeCaseBrief(indexes) {
  try {
    const list = indexes ?? findIndexes(briefDirs());
    const sig = list.map((i) => i.caseDir + "|" + i.builtAt).join(";");
    const globalPath = process.env.DSH_HOME ? join(process.env.DSH_HOME, "AGENTS.md") : null;
    const target = globalPath ?? (process.env.SEEU_WORKSPACE ? join(process.env.SEEU_WORKSPACE, BRIEF_NAME) : null);
    if (target === null) return { ok: false, error: "未设置 DSH_HOME / SEEU_WORKSPACE" };
    if (sig === briefSig && existsSync(target)) return { ok: true, skipped: true, cases: list.length };
    const block = briefText(list);
    const bytes = writeBriefFile(target, block);
    briefSig = sig;
    Object.assign(briefState, { at: new Date().toISOString(), ok: true, path: target, cases: list.length, chars: block.length, error: null });
    return { ok: true, path: target, cases: list.length, chars: block.length, bytes };
  } catch (error) {
    Object.assign(briefState, { at: new Date().toISOString(), ok: false, error: error?.message ?? String(error) });
    return { ok: false, error: error?.message ?? String(error) };
  }
}
/** /list 与建库完成后顺手刷新；失败只记日志。 */
function refreshBrief(indexes) {
  const r = writeCaseBrief(indexes);
  if (!r.ok && !r.skipped) console.warn('[seeu-case-index] 案件概览写入失败：' + r.error);
  return r;
}

/** 记住最近用过的案件目录，下次启动由外壳拼进 SEEU_INDEX_SEARCH_DIRS。 */
function rememberDirs(dirs) {
  const file = process.env.SEEU_INDEX_STATE_FILE
  if (!file) return
  try {
    let prev = []
    try {
      if (existsSync(file)) prev = JSON.parse(readFileSync(file, 'utf8')).dirs ?? []
    } catch {
      prev = []
    }
    const merged = [...new Set([...dirs.filter(Boolean), ...prev.filter(Boolean)])].slice(0, 10)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ dirs: merged, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
  } catch {
    /* 状态文件写不了不影响查询 */
  }
}

export function apply(ctx) {
  try { refreshBrief(); } catch { /* 启动期失败不影响查库 */ }
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: ROUTE, handler: handle }), 'seeu-case-index: /seeu-index 路由');
  });
}

export const name = 'seeu-case-index';
