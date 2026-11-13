// 链路体检编排器：给定案件（caseNumber 或索引库路径），依次检查
//   1) 索引可打开、规模与检材覆盖（解析内容 / 仅元数据）
//   2) 检索链路（FTS5 长关键词 / LIKE 短关键词）
//   3) 火眼只读挂载目录是否可读
//   4) 原始镜像能否被 LovelyCarve 解析（分区表）
// 同时被 CLI（scripts/chain-check.mjs）与面板路由（plugins/seeu-case-index）复用。
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { evidences, findIndexes, openIndex, search, statsOf } from './ges-index/query.mjs';
import { attachMounts, loadEvidenceMounts } from './ges-index/mounts.mjs';
import { createMountManager, resolveLovelyCarveCli } from './image-mount.mjs';
import {
  checkMountReadable,
  collectIndexDirs,
  describeIndexCoverage,
  formatChainReport,
  summarizeChain,
} from './chain-check.mjs';

export const CHAIN_IMAGE_EXT = new Set(['.e01', '.ex01', '.dd', '.raw', '.img', '.vmdk', '.vhdx', '.qcow2', '.iso', '.bin']);

export function findChainTarget({ caseNumber, db, env = process.env, deps = {} } = {}) {
  if (db) return { dbPath: String(db) };
  if (!caseNumber) return null;
  const findIndexesFn = deps.findIndexes ?? findIndexes;
  const dirs = deps.collectIndexDirs ? deps.collectIndexDirs(env) : collectIndexDirs(env);
  const wanted = String(caseNumber).trim().toLowerCase();
  for (const item of findIndexesFn(dirs)) {
    const number = String(item.caseNumber ?? '').toLowerCase();
    if (number && (number === wanted || number.includes(wanted))) return item;
  }
  return null;
}

/**
 * @param {object} options
 * @param {string} [options.caseNumber]
 * @param {string} [options.db] 索引库路径（与 caseNumber 二选一）
 * @param {string} [options.probe] 检索探针，默认 Investors
 * @param {boolean} [options.images] 是否检查镜像解析，默认 true
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {object} [options.deps] 测试注入（findIndexes/openIndex/statsOf/evidences/search/loadEvidenceMounts/attachMounts/describeIndexCoverage/createMountManager/resolveLovelyCarveCli）
 */
export async function runChainCheck(options = {}) {
  const { caseNumber = '', db: dbPath = '', probe = 'Investors', images = true } = options;
  const env = options.env ?? process.env;
  const deps = options.deps ?? {};
  const findIndexesFn = deps.findIndexes ?? findIndexes;
  const collectDirs = deps.collectIndexDirs ?? collectIndexDirs;
  const openIndexFn = deps.openIndex ?? openIndex;
  const statsOfFn = deps.statsOf ?? statsOf;
  const evidencesFn = deps.evidences ?? evidences;
  const searchFn = deps.search ?? search;
  const loadMountsFn = deps.loadEvidenceMounts ?? loadEvidenceMounts;
  const attachMountsFn = deps.attachMounts ?? attachMounts;
  const coverageFn = deps.describeIndexCoverage ?? describeIndexCoverage;
  const inspectFn = deps.inspectImage ?? null;

  let target = dbPath ? { dbPath: String(dbPath) } : null;
  if (!target && caseNumber) {
    const wanted = String(caseNumber).trim().toLowerCase();
    for (const item of findIndexesFn(collectDirs(env))) {
      const number = String(item.caseNumber ?? '').toLowerCase();
      if (number && (number === wanted || number.includes(wanted))) {
        target = item;
        break;
      }
    }
  }
  if (!target) {
    return {
      exitCode: 2,
      report: null,
      summary: null,
      text: '找不到案件索引：用 --caseNumber（可 /list 查看）或 --db 指定路径',
    };
  }

  const report = {
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    case: { name: '', number: '' },
    index: { dbPath: target.dbPath, ok: false, counts: null, error: null },
    coverage: { total: 0, parsed: [], metadataOnly: [], ok: false },
    query: null,
    mounts: { ok: false, items: [] },
    images: [],
  };

  let db = null;
  try {
    db = openIndexFn(target.dbPath);
    const stats = statsOfFn(db);
    report.case = {
      name: String(stats.meta.case_name ?? target.caseName ?? ''),
      number: String(stats.meta.case_number ?? target.caseNumber ?? ''),
    };
    report.index.ok = true;
    report.index.counts = {
      records: stats.counts.records,
      entities: stats.counts.entities,
      artifacts: stats.counts.artifacts,
    };
  } catch (error) {
    report.index.error = String(error?.message ?? error);
  }

  let list = [];
  if (db) {
    try {
      list = evidencesFn(db);
      report.coverage = coverageFn(list);
    } catch (error) {
      report.coverage = { total: 0, parsed: [], metadataOnly: [], ok: false, error: String(error?.message ?? error) };
    }
    try {
      const result = searchFn(db, { q: probe, limit: 3 });
      report.query = { q: probe, ok: true, engine: result.engine, total: result.total };
    } catch (error) {
      report.query = { q: probe, ok: false, error: String(error?.message ?? error) };
    }
  }

  // 火眼挂载：ges status 拿 evidence_mounts，按名字优先挂到证据上。
  try {
    const loaded = await loadMountsFn();
    const mounts = Array.isArray(loaded) ? loaded : (loaded?.mounts ?? []);
    const attached = mounts.length ? attachMountsFn(list, mounts) : list;
    report.mounts.items = attached.map((ev) => checkMountReadable(ev));
    report.mounts.ok = report.mounts.items.some((item) => item.readable);
  } catch (error) {
    report.mounts = { ok: false, items: [], error: String(error?.message ?? error) };
  }

  // 原始镜像：只做 inspect（快，不挂载），确认工具链可用。
  if (images) {
    const candidates = list
      .map((ev) => String(ev.sourcePath ?? '').trim())
      .filter((path) => path && CHAIN_IMAGE_EXT.has(extname(path).toLowerCase()))
      .filter((path, index, all) => all.indexOf(path) === index)
      .filter((path) => existsSync(path))
      .slice(0, 3);
    if (candidates.length) {
      if (inspectFn) {
        for (const image of candidates) {
          try {
            const result = await inspectFn(image);
            report.images.push(result);
          } catch (error) {
            report.images.push({ image, inspectOk: false, error: String(error?.message ?? error) });
          }
        }
      } else {
        const resolveCli = deps.resolveLovelyCarveCli ?? resolveLovelyCarveCli;
        const cli = resolveCli(env);
        if (!cli.path || cli.error) {
          report.images.push({ image: candidates[0], inspectOk: false, error: cli.error ?? '未找到 LovelyCarve CLI' });
        } else {
          const manager = (deps.createMountManager ?? createMountManager)({ env: () => env, log: () => {} });
          try {
            for (const image of candidates) {
              const result = await manager.inspect(image);
              if (result.ok) {
                report.images.push({
                  image,
                  inspectOk: true,
                  sizeBytes: result.image?.sizeBytes,
                  partitions: (result.image?.partitions ?? []).map((p) => ({ index: p.index, label: p.label })),
                  inspectMs: result.ms,
                });
              } else {
                report.images.push({
                  image,
                  inspectOk: false,
                  error: result.error?.message ?? result.error ?? '解析失败',
                });
              }
            }
          } finally {
            await manager.dispose?.();
          }
        }
      }
    }
  }

  try {
    db?.close();
  } catch {
    // 忽略。
  }

  const summary = summarizeChain(report);
  const text = formatChainReport(report);
  return { exitCode: summary.ok ? 0 : 1, report, summary, text };
}
