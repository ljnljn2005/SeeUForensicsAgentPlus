#!/usr/bin/env node
// ges-index CLI：薄封装。建库在 build.mjs，查询在 query.mjs，二者也供桌面插件复用。
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildIndex, IndexBuildError, TOOL, TOOL_VERSION } from './build.mjs';
import { openIndex, findIndexes, tree, search, cite, statsOf, verify, typedTables, table, entity, timeline, records } from './query.mjs';
import { SCHEMA_VERSION } from './parse.mjs';
import { crossDbPath, findEntity, findImage, listCases, openCross, crossStats, syncAll, topShared } from './cross.mjs';

const out = (obj) => console.log(JSON.stringify(obj));

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

function resolveDb(opts) {
  if (opts.db) return resolve(String(opts.db));
  if (opts['case-dir']) return join(resolve(String(opts['case-dir'])), '.seeu-index', 'case-index.db');
  return join(process.cwd(), '.seeu-index', 'case-index.db');
}

const HELP = `ges-index ${TOOL_VERSION}

建库：
  ges-index build --case <case_number>|--case-dir <dir> [--out <dir>] [--concurrency 3]
                  [--rebuild|--resume] [--limit-leaves N]

查询（树状渐进式披露，主入口）：
  ges-index tree [node]               不给 node = 案件概览 + 检材
  ges-index tree "ev:3"               检材 → 应用
  ges-index tree "app:3|WhatsApp"     应用 → 账号或类别
  ges-index tree "acc:3|WhatsApp|<账号>"
  ges-index tree "cat:3|WhatsApp|<账号>|群聊消息"
  ges-index tree "art:45"             文件 → 前 10 条记录（art:45:1 翻页）
  ges-index tree "cite:21697"         记录 → Goldeneyes 引用

  ges-index search -q <kw> [--eid 3] [--app WhatsApp] [--from 2025-04-01] [--to ...] [--limit 10]
  ges-index cite <recordId>
  ges-index stats
  ges-index tables                              列出 typed 投影表与行数
  ges-index table <name> [--eid 3] [--q kw] [--from ...] [--limit 20] [--offset 0]
  ges-index entity [--kind phone] [--q 8525] [--eid 3] [--limit 20]   跨检材实体聚合/下钻
  ges-index timeline [--eid 3] [--bucket day|hour|month] [--from ...] [--to ...]
  ges-index records [--eid 3] [--app WhatsApp] [--category 通讯录] [--limit 20] [--offset 0]
  ges-index verify [--sample 20]      随机回火眼核对正文与基址

跨案（中央库 <workspace>\\indexes\\crosscase.db，--workspace / --out / SEEU_CROSS_DB 可覆盖）：
  ges-index xcase sync [dir...]       扫描这些目录下的案件库并同步进中央库（不给目录=工作区 + dsh-home\indexes）
  ges-index xcase list                已同步的案件清单
  ges-index xcase top [--min-cases 2] [--kind phone]      跨案重合实体排行
  ges-index xcase entity [--value 85254877240] [--kind phone] [--q 8525] [--min-cases 1]
  ges-index xcase files --sha256 <hex> | --md5 <hex>      同一镜像哈希出现在哪些案件
  ges-index xcase stats
  ges-index list <dir>...             列出这些目录下已建库的案件
  ges-index version

索引库位置：<case_dir>\\.seeu-index\\case-index.db（--db 可覆盖）`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0] ?? 'help';

  if (cmd === 'version') return out({ tool: TOOL, version: TOOL_VERSION, schemaVersion: SCHEMA_VERSION });
  if (cmd === 'help' || cmd === '--help') { console.log(HELP); return; }

  if (cmd === 'build') {
    const res = await buildIndex({
      caseNumber: opts.case ? String(opts.case) : null,
      caseDir: opts['case-dir'] ? String(opts['case-dir']) : null,
      out: opts.out ? String(opts.out) : null,
      concurrency: Number(opts.concurrency) || 3,
      rebuild: !!opts.rebuild,
      resume: !!opts.resume,
      limitLeaves: opts['limit-leaves'] ? Number(opts['limit-leaves']) : null,
      log: (m) => console.error(m),
      onProgress: (p) => {
        if (p.phase === 'fetch' && p.total) {
          console.error(`[build] ${p.completed}/${p.total} ${p.percent}% elapsed=${Math.round((p.elapsedMs ?? 0) / 1000)}s eta=${Math.round((p.etaMs ?? 0) / 1000)}s`);
        } else if (p.message) {
          console.error(`[build] ${p.message}`);
        }
      },
    });
    return out(res);
  }

  if (cmd === 'list') {
    const dirs = opts._.slice(1).filter((d) => !d.startsWith('-'));
    return out({ dirs, indexes: findIndexes(dirs.length ? dirs : [process.cwd()]) });
  }

  if (cmd === 'xcase') {
    const sub = opts._[1] ?? 'list';
    const workspace = opts.workspace ? resolve(String(opts.workspace)) : (process.env.SEEU_WORKSPACE ? resolve(process.env.SEEU_WORKSPACE) : process.cwd());
    const crossPath = opts.out ? resolve(String(opts.out)) : (process.env.SEEU_CROSS_DB ? resolve(process.env.SEEU_CROSS_DB) : crossDbPath(workspace));
    const xdb = openCross(crossPath);
    try {
      let result;
      if (sub === 'sync' || sub === 'build') {
        const dirs = opts._.slice(2).filter((d) => typeof d === 'string' && !d.startsWith('-'));
        const scan = dirs.length ? dirs : [workspace];
        const indexes = findIndexes(scan);
        result = { crossPath, scanned: scan, indexes: indexes.length, cases: syncAll(xdb, indexes) };
        xdb.prepare("insert or replace into schema_meta(k, v) values('lastSync', ?)").run(new Date().toISOString());
      } else if (sub === 'list') result = { crossPath, cases: listCases(xdb) };
      else if (sub === 'entity') result = findEntity(xdb, { kind: opts.kind, value: opts.value ?? opts._[2], q: opts.q, minCases: Number(opts['min-cases']) || 1, limit: opts.limit });
      else if (sub === 'top') result = topShared(xdb, { minCases: Number(opts['min-cases']) || 2, kind: opts.kind, limit: opts.limit });
      else if (sub === 'files') result = findImage(xdb, { sha256: opts.sha256, md5: opts.md5 });
      else if (sub === 'stats') result = crossStats(xdb);
      else { console.error(HELP); process.exit(2); }
      return out(result);
    } finally { xdb.close(); }
  }

  const dbPath = resolveDb(opts);
  const db = openIndex(dbPath);
  let result;
  try {
    if (cmd === 'tree') result = tree(db, opts._[1] ?? 'root');
    else if (cmd === 'search') result = search(db, { ...opts });
    else if (cmd === 'cite') result = cite(db, opts._[1]);
    else if (cmd === 'stats') result = statsOf(db);
    else if (cmd === 'tables') result = { tables: typedTables(db) };
    else if (cmd === 'table') {
      if (!opts._[1]) { console.error('用法：ges-index table <name>'); process.exit(2); }
      result = table(db, opts._[1], { ...opts });
    } else if (cmd === 'entity') result = entity(db, { ...opts });
    else if (cmd === 'timeline') result = timeline(db, { ...opts });
    else if (cmd === 'records') result = records(db, { ...opts });
    else if (cmd === 'verify') result = await verify(db, opts);
    else { console.error(HELP); process.exit(2); }
  } finally {
    db.close();
  }
  out(result);
}

main().catch((e) => {
  if (e instanceof IndexBuildError) {
    console.error(`[${TOOL}] ${e.code}: ${e.message}`);
    if (e.code === 'E_CASE_DIR_READONLY') console.error(JSON.stringify({ ok: false, code: e.code, dir: e.dir }));
    process.exit(e.code === 'E_CASE_DIR_READONLY' ? 3 : 1);
  }
  console.error(`[${TOOL}] 失败：${e?.stack ?? e}`);
  process.exit(1);
});
