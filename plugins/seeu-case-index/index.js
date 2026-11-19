// 宿主端：把「建库 + 查库」暴露成 Web UI 可调用的本地 HTTP 路由（前缀 /seeu-index）。
// 桌面外壳把本包装进 web profile，Web 客户端插件（client.js）在设置页里给界面。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildIndex, IndexBuildError } from '../../tools/ges-index/build.mjs';
import { describeBuildProgress, findRunningBuild } from '../../tools/ges-index/progress.mjs';
import { indexSummary } from '../../tools/ges-index/index-meta.mjs';
import { openIndex, findIndexes, tree, search, cite, statsOf, verify, typedTables, table, entity, timeline, records, evidences, facets } from '../../tools/ges-index/query.mjs';
import { genericCsv, recordsCsv } from '../../tools/ges-index/csv.mjs';
import { attachMounts, loadEvidenceMounts } from '../../tools/ges-index/mounts.mjs';
import { crossDbPath, findEntity, findImage, listCases, openCross, crossStats, syncAll, syncCase, topShared } from '../../tools/ges-index/cross.mjs';
import { myosCases, myosImport, myosImportBatch, myosMaterials, myosResultDbs, myosTableCounts, myosTables } from './myos.mjs';
import { forgetExtraDir, readExtraDirs, rememberExtraDir } from '../../tools/ges-index/extra-dirs.mjs';
import { activityFile, clearActivity, formatActivitySummary, readActivity, recordActivity, removeActivity, summarizeActivity } from '../../tools/ges-index/activity.mjs';
import { runChainCheck } from '../../tools/chain-check-run.mjs';
import { saveScanBudget, scanBudgetMs, scanBudgetView } from '../../tools/index-scan-budget.mjs';

function pathBase(value) {
  const text = String(value ?? '').replace(/[\/]+$/, '');
  const parts = text.split(/[\/]/);
  return parts[parts.length - 1] || text;
}

const ROUTE = '/seeu-index';
const jobs = new Map();
// MYOS 批量导入：同一时间只跑一个，面板轮询进度。
let myosBatchJob = null;
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

/**
 * 从 query 里解析索引库：`db` 优先；也接受 `caseNumber` / `case` / `caseDir`。
 * 中文路径经 shell → HTTP 传输时可能被按 GBK 编码，服务端按 UTF-8 解码后
 * 「索引库不存在」；模型/脚本可以只传 /list 里的 caseNumber 避开中文路径。
 */
function resolveDbParam(query) {
  const dbParam = query.get('db');
  if (dbParam) return safeDb(dbParam);
  const key = String(query.get('caseNumber') ?? query.get('case') ?? query.get('caseDir') ?? '').trim();
  if (!key) throw Object.assign(new Error('缺少 db 参数（也可以传 caseNumber，见 /list）'), { status: 400 });
  const indexes = findIndexes(briefDirs());
  const wantedDir = resolve(key).toLowerCase();
  const hit = indexes.find((ix) => {
    if (String(ix.caseNumber ?? '') === key) return true;
    if (String(ix.caseName ?? '') === key) return true;
    if (resolve(ix.caseDir ?? '\u0000').toLowerCase() === wantedDir) return true;
    return resolve(ix.dbPath ?? '\u0000').toLowerCase() === wantedDir;
  });
  if (!hit) {
    throw Object.assign(new Error('找不到案件索引：' + key + '（用 /list 查看 caseNumber）'), { status: 404 });
  }
  return safeDb(hit.dbPath);
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

const SOURCE_LABELS = { ges: '火眼建库', myos: 'MYOS 导入', external: '外部目录' };

function defaultDirs() {
  const env = process.env['SEEU_INDEX_SEARCH_DIRS'] ?? '';
  const dirs = env.split(';').map((s) => s.trim()).filter(Boolean);
  // MYOS 导入可以写到任意输出目录；这些目录记在 <DSH_HOME>/index-extra-dirs.json，
  // 下次扫描自动带上（外壳下发的 SEEU_INDEX_SEARCH_DIRS 只是默认集合）。
  return [...new Set([...dirs, ...readExtraDirs()])];
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
  const running = findRunningBuild(jobs.values(), dir);
  if (running) return { jobId: running.id, dir, existing: true };
  const job = { id: randomUUID(), dir, status: 'running', phase: 'probe', completed: 0, total: 0, percent: 0, startedAt: Date.now() };
  job.abort = new AbortController();
  jobs.set(job.id, job);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
  buildIndex({
    caseDir: dir,
    concurrency: Number(args.concurrency) || 3,
    rebuild: args.rebuild !== false,
    signal: job.abort.signal,
    onProgress: (p) => {
      job.phase = p.phase ?? job.phase;
      if (typeof p.completed === 'number') job.completed = p.completed;
      if (typeof p.total === 'number') job.total = p.total;
      if (typeof p.percent === 'number') job.percent = p.percent;
      if (typeof p.etaMs === 'number') job.etaMs = p.etaMs;
      if (p.message) job.message = p.message;
    },
    log: () => {},
  }).then(async (result) => {
    job.status = 'done';
    job.phase = 'done';
    job.percent = 100;
    job.result = result;
    job.cross = syncOneCase(result.db);
    job.brief = await refreshBrief();
    job.elapsedMs = Date.now() - job.startedAt;
    try {
      const counts = result.manifest?.counts ?? {};
      recordActivity({
        kind: 'build',
        title: pathBase(dir),
        detail: `${counts.records ?? 0} 条记录 · ${counts.entities ?? 0} 个实体 · 用时 ${Math.round(job.elapsedMs / 1000)} 秒`,
        caseDir: dir,
        dbFile: result.db,
        records: counts.records ?? 0,
        entities: counts.entities ?? 0,
        durationMs: job.elapsedMs,
      });
    } catch {
      // 活动记录失败不影响建库本身。
    }
  }).catch((error) => {
    if (error?.code === 'E_CANCELLED') {
      job.status = 'cancelled';
      job.phase = 'cancelled';
      job.elapsedMs = Date.now() - job.startedAt;
      return;
    }
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
    if (req.method === 'POST' && path === '/build/cancel') {
      const body = await readBody(req);
      const job = jobs.get(String(body.job ?? ''));
      if (!job) return send(res, 404, { error: 'job 不存在' });
      if (job.status !== 'running') return send(res, 409, { error: `任务已结束（${job.status}）` });
      job.abort.abort();
      return send(res, 200, { ok: true, jobId: job.id });
    }
    if (req.method === 'GET' && path === '/build') {
      const job = jobs.get(url.searchParams.get('job') ?? '');
      if (!job) return send(res, 404, { error: 'job 不存在' });
      // 运行中的任务没有落盘的 elapsedMs，这里补实时值；同时附带可直接渲染的中文进度。
      const { abort, ...rest } = job;
      return send(res, 200, { ...rest, progress: describeBuildProgress(job) });
    }
    if (req.method === 'GET' && path === '/activity') {
      const entries = readActivity();
      const summary = summarizeActivity(entries);
      return send(res, 200, { file: activityFile(), entries, summary, summaryText: formatActivitySummary(summary) });
    }
    if (req.method === 'POST' && path === '/activity/clear') {
      clearActivity();
      return send(res, 200, { ok: true, entries: [] });
    }
    if (req.method === 'POST' && path === '/activity/remove') {
      const body = await readBody(req);
      const entries = removeActivity({ at: body?.at ?? '', title: body?.title ?? '' });
      const summary = summarizeActivity(entries);
      return send(res, 200, { ok: true, entries, summary, summaryText: formatActivitySummary(summary) });
    }
    if (req.method === 'GET' && path === '/list') {
      const dirs = [
        ...url.searchParams.getAll('dir').flatMap((v) => v.split(/[;,]/)).filter(Boolean),
        ...defaultDirs(),
      ];
      const indexes = findIndexes([...new Set(dirs)]);
      rememberDirs(indexes.map((i) => i.caseDir));
      await refreshBrief(indexes);
      const extraSet = new Set(readExtraDirs().map((item) => resolve(item).toLowerCase()));
      // meta 是给面板直接用的人类可读摘要（与写入会话概览的口径一致）。
      return send(res, 200, {
        indexes: indexes.map((ix) => {
          const extra = extraSet.has(ix.caseDir ? resolve(ix.caseDir).toLowerCase() : '');
          const source = ix.tool === 'seeu-myso-import' ? 'myos' : extra ? 'external' : 'ges';
          return { ...ix, meta: ix.dbPath ? indexSummary(ix) : null, extra, source, sourceLabel: SOURCE_LABELS[source] };
        }),
      });
    }
    // ---------- 短词扫描预算（设置页可调，影响 /search 与 /records 的逐行扫描时长） ----------
    if (path === '/scan-budget') {
      if (req.method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const result = saveScanBudget(body?.scanBudgetMs);
        return send(res, result.ok ? 200 : 400, result.ok ? { ...result, ...scanBudgetView() } : result);
      }
      return send(res, 200, scanBudgetView());
    }
    // ---------- 会话上下文里的案件概览（AGENTS.md 注入状态） ----------
    if (path === '/brief') {
      if (req.method === 'POST') {
        const result = await refreshBrief();
        return send(res, 200, { result, state: briefState });
      }
      let current = null;
      try {
        {
          const abs = resolveDbParam(url.searchParams);
          const list = findIndexes(briefDirs());
          current = { dbPath: abs, included: list.some((i) => resolve(i.dbPath) === abs) };
        }
      } catch {
        current = null;
      }
      return send(res, 200, { state: briefState, current, dshHome: process.env.DSH_HOME ?? null });
    }
    // ---------- 额外索引目录（MYOS 导入的输出目录） ----------
    if (req.method === 'POST' && path === '/extra-dirs/remove') {
      const body = await readBody(req);
      if (!body.dir) return send(res, 400, { error: '缺少 dir' });
      const dirs = forgetExtraDir(body.dir);
      return send(res, 200, { ok: true, dirs });
    }
    // ---------- 链路体检（索引 / 检索 / 火眼挂载 / 镜像解析） ----------
    if (req.method === 'GET' && path === '/chain-check') {
      const caseNumber = url.searchParams.get('caseNumber') ?? url.searchParams.get('case') ?? '';
      const db = url.searchParams.get('db') ?? '';
      const probe = url.searchParams.get('probe') ?? 'Investors';
      const images = url.searchParams.get('images') !== '0';
      const result = await runChainCheck({ caseNumber, db, probe, images, env: process.env });
      if (url.searchParams.get('text') === '1') {
        res.statusCode = result.exitCode === 2 ? 404 : 200;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(result.text);
        return true;
      }
      return send(res, result.exitCode === 2 ? 404 : 200, { ok: result.exitCode === 0, ...result });
    }
    // ---------- MYOS（超级取证大师）取证结果导入 ----------
    // 面板「从 MYOS 导入」走这里：列案件/检材/结果库表，再把一张表落成 SeeU 索引。
    if (path.startsWith('/myos/')) {
      if (req.method === 'GET' && path === '/myos/cases') {
        const cases = await myosCases({ keyword: url.searchParams.get('keyword') ?? '' });
        return send(res, 200, { cases });
      }
      if (req.method === 'GET' && path === '/myos/materials') {
        const materials = await myosMaterials(url.searchParams.get('caseId') ?? '');
        return send(res, 200, { materials });
      }
      if (req.method === 'GET' && path === '/myos/dbs') {
        const dbs = await myosResultDbs({
          caseId: url.searchParams.get('caseId') ?? '',
          materialId: url.searchParams.get('materialId') ?? '',
        });
        return send(res, 200, { dbs });
      }
      if (req.method === 'GET' && path === '/myos/tables') {
        const result = await myosTables(url.searchParams.get('db') ?? '', {
          caseId: url.searchParams.get('caseId') ?? '',
          materialId: url.searchParams.get('materialId') ?? '',
          name: url.searchParams.get('name') ?? '',
        });
        return send(res, 200, result);
      }
      if (req.method === 'POST' && path === '/myos/import') {
        const body = await readBody(req);
        const result = await myosImport(body);
        if (body.outDir) rememberExtraDir(body.outDir);
        try {
          const table = String(body.sql ?? '').match(/from\s+"?([A-Za-z0-9_]+)"?/i)?.[1] ?? '';
          recordActivity({
            kind: 'myos-import',
            title: pathBase(result.caseDir ?? body.outDir ?? 'MYOS 导入'),
            detail: `${result.records ?? result.rows ?? 0} 条${table ? ` · ${table}` : ''}${result.mode === 'append' ? ' · 追加' : ''}`,
            caseDir: result.caseDir ?? body.outDir ?? '',
            dbFile: result.dbFile ?? '',
            rows: result.records ?? result.rows ?? 0,
            table,
          });
        } catch {
          // 忽略活动记录失败。
        }
        return send(res, 200, result);
      }
      if (req.method === 'POST' && path === '/myos/row-counts') {
        const counts = await myosTableCounts(await readBody(req));
        return send(res, 200, counts);
      }
      if (req.method === 'GET' && path === '/myos/import-batch') {
        return send(res, 200, { job: myosBatchJob });
      }
      if (req.method === 'POST' && path === '/myos/import-batch') {
        if (myosBatchJob && myosBatchJob.status === 'running') {
          return send(res, 409, { error: '已有批量导入在进行中，等它结束再试' });
        }
        const body = await readBody(req);
        const tables = Array.isArray(body.tables) ? body.tables.filter(Boolean) : [];
        if (!body.outDir || (!body.db && !body.dbName) || tables.length === 0) {
          return send(res, 400, { error: '缺少 outDir / db（或 dbName）/ tables' });
        }
        const job = {
          id: `myos-batch-${Date.now()}`,
          status: 'running',
          phase: 'start',
          index: 0,
          total: tables.length,
          table: '',
          records: 0,
          entities: 0,
          totals: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          error: null,
          result: null,
        };
        myosBatchJob = job;
        void myosImportBatch({
          ...body,
          tables,
          onProgress: (progress) => {
            if (progress.phase) job.phase = progress.phase;
            if (Number.isFinite(progress.index)) job.index = progress.index;
            if (progress.table) job.table = progress.table;
            if (Number.isFinite(progress.records)) job.records += progress.records;
            if (Number.isFinite(progress.entities)) job.entities += progress.entities;
            if (progress.totals) job.totals = progress.totals;
          },
        })
          .then((result) => {
            job.status = 'done';
            job.result = result;
            job.totals = result.totals;
            job.finishedAt = new Date().toISOString();
            // 导入成功时才记录输出目录（目录此时已存在）。
            if (body.outDir) rememberExtraDir(body.outDir);
            try {
              recordActivity({
                kind: 'myos-import',
                title: pathBase(result.caseDir ?? body.outDir ?? 'MYOS 批量导入'),
                detail: `${result.totals?.records ?? job.records ?? 0} 条 · ${result.tables?.length ?? job.totals?.tables ?? 0} 张表 · 追加`,
                caseDir: result.caseDir ?? body.outDir ?? '',
                dbFile: result.dbFile ?? '',
                rows: result.totals?.records ?? job.records ?? 0,
              });
            } catch {
              // 忽略活动记录失败。
            }
          })
          .catch((error) => {
            job.status = 'failed';
            job.error = error instanceof Error ? error.message : String(error);
            job.finishedAt = new Date().toISOString();
          });
        return send(res, 202, { jobId: job.id });
      }
      return send(res, 404, { error: `未知 MYOS 接口 ${path}` });
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

    const dbPath = resolveDbParam(url.searchParams);
    const db = openIndex(dbPath);
    try {
      if (path === '/tree') return send(res, 200, tree(db, url.searchParams.get('node') || 'root'));
      if (path === '/search') {
        const opts = { q: url.searchParams.get('q'), limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset'), scanBudgetMs: scanBudgetMs() };
        for (const k of ['eid', 'app', 'account', 'category', 'from', 'to']) if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        return send(res, 200, search(db, opts));
      }
      if (path === '/cite') return send(res, 200, cite(db, url.searchParams.get('id')));
      if (path === '/stats') return send(res, 200, statsOf(db));
      if (path === '/evidences') {
        const list = evidences(db);
        const mounts = await loadEvidenceMounts();
        return send(res, 200, { evidences: attachMounts(list, mounts.mounts) });
      }
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
        const opts = { limit: url.searchParams.get('limit') ?? 20, offset: url.searchParams.get('offset') ?? 0, scanBudgetMs: scanBudgetMs() };
        for (const k of ['eid', 'app', 'account', 'category', 'artifact', 'q', 'from', 'to']) if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        return send(res, 200, records(db, opts));
      }
      if (path === '/cite') {
        const id = Number(url.searchParams.get('id'));
        if (!Number.isFinite(id) || id <= 0) return send(res, 400, { error: '缺少 id（记录编号）' });
        try {
          return send(res, 200, cite(db, id));
        } catch (error) {
          if (error?.code === 'E_NOT_FOUND') return send(res, 404, { error: error.message });
          throw error;
        }
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
        // 导出整批：短词逐页扫描会重复扫，预算按页给足（每页最多 2.5 s × 页数会太慢），
        // 有短词时跳过 totalApprox 的近似页，只导出扫描到的命中。
        opts.scanBudgetMs = Math.min(30_000, Math.max(2500, Number(url.searchParams.get('scanBudgetMs')) || 8000));
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

/** 生成带标记的 Markdown 区块：案件 → 检材表 + 火眼已挂载的原始只读目录 + 查询/定位规则。 */
function briefText(indexes, mounts = []) {
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
    '若 db 路径含中文、在 shell 里被转码成「索引库不存在」，改用 caseNumber：curl -s "$SEEU_INDEX_API/evidences?caseNumber=<案号>"（案号见 /list）。',
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
    lines.push('- 规模：检材 ' + evs.length + ' 个' + (totals ? ' · 记录 ' + totals.records + ' 条 · 实体 ' + totals.entities + ' 个' : ''));
    const summary = indexSummary(ix);
    lines.push('- ' + summary.text);
    if (summary.warn) lines.push('⚠ ' + summary.warn);
    if (timeRange?.f) lines.push('- 数据时间范围：' + timeRange.f + ' → ' + timeRange.t);
    if (evs.length) {
      lines.push(
        '',
        '| eid | 检材名称 | 类型 | 平台 | 入库记录 | 火眼统计 | 原始文件 | 备注 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
      );
      for (const ev of evs.slice(0, 50)) {
        const thin = Number(ev.reportedRecordCount) >= 20 && Number(ev.recordCount ?? 0) < Number(ev.reportedRecordCount) / 2;
        lines.push('| ' + ev.eid + ' | ' + String(ev.name ?? '') + ' | ' + String(ev.type ?? '') + ' | ' + String(ev.platform ?? '') + ' | ' + (ev.recordCount ?? '') + (thin ? ' ⚠' : '') + ' | ' + (ev.reportedRecordCount ?? '') + ' | ' + String(ev.sourcePath ?? '') + ' | ' + String(ev.remark ?? '').replace(/\|/g, '/') + ' |');
      }
      lines.push(
        '',
        '（「入库记录」是本索引实际解析入库的行数，「火眼统计」是火眼界面上的记录数，口径不同；⚠ 表示索引里几乎只剩元数据。）',
      );
      const thinEvs = evs.filter((ev) => Number(ev.reportedRecordCount) >= 20 && Number(ev.recordCount ?? 0) < Number(ev.reportedRecordCount) / 2);
      if (thinEvs.length) {
        lines.push('⚠ 索引覆盖不足：' + thinEvs.map((ev) => String(ev.name ?? ('检材 ' + ev.eid)) + '（入库 ' + (ev.recordCount ?? 0) + ' / 火眼 ' + (ev.reportedRecordCount ?? '?') + '）').join('、') + '。这些检材（手机全量提取 `pf`、磁盘镜像 `image` 等）的内容不在索引里，需按下面「取证定位规则」第 2 条处理。');
      }
      const evNames = new Set(evs.map((ev) => String(ev.name ?? '').trim().toLowerCase()));
      const matchedMounts = mounts.filter((mount) => evNames.has(String(mount.name ?? '').trim().toLowerCase()));
      if (matchedMounts.length) {
        lines.push('', '原始检材只读挂载（火眼已挂好，**直接翻这里，不要再用 LovelyCarve 重复挂载**）：');
        for (const mount of matchedMounts) {
          const owner = evs.find((ev) => String(ev.name ?? '').trim().toLowerCase() === String(mount.name ?? '').trim().toLowerCase());
          lines.push(
            '- ' + String(mount.name ?? '') + '（挂载 eid ' + mount.eid + (owner ? '，索引 eid ' + owner.eid : '') + '）→ `' + mount.route + '`' +
              (mount.mountPoint ? '，本机目录 `' + mount.mountPoint + '`' : ''),
          );
        }
        lines.push('（`/evidence_mounts/` 是火眼已挂载检材的原始只读文件系统：用 `ges ls /evidence_mounts/eid-N/`、`ges glob -p "**/*.db" --path /evidence_mounts/eid-N/` 浏览；需要本地处理时 `ges copy <路径> --dest <目录>`。直接读上面「本机目录」也可以。）');
      }
    }
    lines.push('');
  }
  lines.push(
    '## 取证定位规则（必须遵守）',
    '',
    '1. **设备信息类问题**（操作系统版本、机型、IMEI/序列号）：先看上面每行「备注」列和火眼设备信息表，备注里常直接写着机型/系统版本——有就直接回答，不要去找原始文件。备注里没有时，先 `ges status --json` 查 `evidence_mounts[]`，翻火眼只读挂载目录（`/evidence_mounts/eid-N/` 或本机目录）里的设备信息文件；**不要直接去解压 `W:\\` 上的原始压缩包**。',
    '2. **索引没有数据时**（「入库记录」很小、带 ⚠）：说明该检材是手机全量提取（`pf`）或磁盘镜像（`image`），索引用不上。按顺序：① 先看这行「备注」「原始文件」，以及上面的「原始检材只读挂载」表——**火眼已经把检材挂成只读目录了**，直接 `ges ls` / 读本机目录即可，不要再挂载一遍；② 火眼没给挂载（表里没有该检材）时，才用外壳「设置 → 镜像挂载…」（快捷键 Ctrl+Shift+M）把镜像挂载成只读盘符，挂载清单在环境变量 `$SEEU_MOUNTS_FILE`；③ 最后才考虑让用户把原始检材文件拷到工作目录。**禁止在 `W:\\` 上直接解压或整份读取原始 `.zip`/`.E01`/`.dd`**；确实没有挂载时才按需只读单个条目，并在答复里说明"火眼未提供该检材挂载入口"。',
    '3. **禁止全盘递归搜索**：不要执行 `Get-ChildItem -Recurse C:\\`、`dir /s E:\\`、`find / -name ...` 这类命令——会卡死、污染现场，也违反取证规范。只允许列检材表里「原始文件」所在目录、挂载出来的盘符，或用户明确指出的目录。',
    '4. **只在必要时读原始文件**：检材文件可能几 GB，不要整份复制/解压到工作目录；优先只读挂载，或按需读取单个文件。读原始文件前先确认"已经查过火眼挂载目录且确实不可用"，不要把它当默认路径。',
    '',
  );
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
export async function writeCaseBrief(indexes) {
  try {
    const list = indexes ?? findIndexes(briefDirs());
    const sig = list.map((i) => i.caseDir + "|" + i.builtAt).join(";");
    const globalPath = process.env.DSH_HOME ? join(process.env.DSH_HOME, "AGENTS.md") : null;
    const target = globalPath ?? (process.env.SEEU_WORKSPACE ? join(process.env.SEEU_WORKSPACE, BRIEF_NAME) : null);
    if (target === null) return { ok: false, error: "未设置 DSH_HOME / SEEU_WORKSPACE" };
    if (sig === briefSig && existsSync(target)) return { ok: true, skipped: true, cases: list.length };
    let mounts = [];
    try {
      mounts = (await loadEvidenceMounts()).mounts;
    } catch {
      mounts = [];
    }
    const block = briefText(list, mounts);
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
async function refreshBrief(indexes) {
  const r = await writeCaseBrief(indexes);
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

export { resolveDbParam };

export function apply(ctx) {
  void refreshBrief().catch(() => { /* 启动期失败不影响查库 */ });
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: ROUTE, handler: handle }), 'seeu-case-index: /seeu-index 路由');
  });
}

export const name = 'seeu-case-index';
