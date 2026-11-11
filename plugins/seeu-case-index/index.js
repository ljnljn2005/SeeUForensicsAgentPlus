// 宿主端：把「建库 + 查库」暴露成 Web UI 可调用的本地 HTTP 路由（前缀 /seeu-index）。
// 桌面外壳把本包装进 web profile，Web 客户端插件（client.js）在设置页里给界面。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildIndex, IndexBuildError } from '../../tools/ges-index/build.mjs';
import { openIndex, findIndexes, tree, search, cite, statsOf, verify, typedTables, table, entity, timeline, records, evidences } from '../../tools/ges-index/query.mjs';
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
      return send(res, 200, { indexes });
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
        const opts = { q: url.searchParams.get('q'), limit: url.searchParams.get('limit') };
        for (const k of ['eid', 'app', 'account', 'category', 'from', 'to']) if (url.searchParams.get(k)) opts[k] = url.searchParams.get(k);
        return send(res, 200, search(db, opts));
      }
      if (path === '/cite') return send(res, 200, cite(db, url.searchParams.get('id')));
      if (path === '/stats') return send(res, 200, statsOf(db));
      if (path === '/evidences') return send(res, 200, { evidences: evidences(db) });
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
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: ROUTE, handler: handle }), 'seeu-case-index: /seeu-index 路由');
  });
}

export const name = 'seeu-case-index';
