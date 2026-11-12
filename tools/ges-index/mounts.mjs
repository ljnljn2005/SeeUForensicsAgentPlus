// 火眼 GES 已经为每个检材挂好了「原始只读文件系统」：`ges status --json` 的
// `evidence_mounts[]` 给出 `/evidence_mounts/eid-N/` 虚拟路径与真实本机目录
// （`C:\hlnet\<eid>-<hash>`）。把这些映射写进案件概览，AI 就能直接翻，不必再用
// LovelyCarve 重新挂载镜像。
//
// 本模块只读：调用 `ges status --json`，不做任何挂载/卸载。
import { gesJson } from './ges.mjs';

/** `/evidence_mounts/eid-<n>/` 虚拟路径。 */
export function evidenceMountRoute(eid) {
  return '/evidence_mounts/eid-' + Number(eid) + '/';
}

/**
 * 把 `ges status --json`（或 `ges context --json`）的挂载信息归一成数组。
 * 兼容字段缺失/类型不对：任何一条坏数据都不影响其它条目。
 * @param {unknown} context
 * @returns {{ mounts: Array<{ eid: number, name: string, route: string, mountPoint: string, rootEnv: string, realRootEnv: string, accessMode: string }>, skipped: Array<{ eid: number | null, name: string, reason: string }> }}
 */
export function parseEvidenceMounts(context) {
  const source = context !== null && typeof context === 'object' ? /** @type {Record<string, unknown>} */ (context) : {};
  const mounts = [];
  const raw = Array.isArray(source.evidence_mounts) ? source.evidence_mounts : [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const eid = Number(item.eid);
    if (!Number.isFinite(eid)) continue;
    mounts.push({
      eid,
      name: typeof item.name === 'string' ? item.name : '',
      route: typeof item.route === 'string' && item.route !== '' ? item.route : evidenceMountRoute(eid),
      mountPoint: typeof item.mount_point === 'string' ? item.mount_point : '',
      rootEnv: typeof item.root_env === 'string' ? item.root_env : '',
      realRootEnv: typeof item.real_root_env === 'string' ? item.real_root_env : '',
      accessMode: typeof item.access_mode === 'string' ? item.access_mode : '',
    });
  }
  const skipped = [];
  for (const item of Array.isArray(source.skipped_evidence_mounts) ? source.skipped_evidence_mounts : []) {
    if (item === null || typeof item === 'object') {
      const eid = Number(item.eid);
      skipped.push({
        eid: Number.isFinite(eid) ? eid : null,
        name: typeof item.name === 'string' ? item.name : '',
        reason: typeof item.reason === 'string' ? item.reason : '',
      });
    } else if (typeof item === 'string' || typeof item === 'number') {
      skipped.push({ eid: Number.isFinite(Number(item)) ? Number(item) : null, name: String(item), reason: '' });
    }
  }
  return { mounts, skipped };
}

/**
 * 把挂载信息贴到 `/evidences` 返回的检材上。
 * 先按名称匹配（索引 eid 与火眼 eid 不一定一致），再退回按 eid 匹配。
 * @param {Array<Record<string, any>>} list
 * @param {Array<{ eid: number, name: string, route: string, mountPoint: string }>} mounts
 */
export function attachMounts(list, mounts) {
  const byName = new Map();
  for (const mount of mounts) {
    const key = String(mount.name ?? '').trim().toLowerCase();
    if (key !== '') byName.set(key, mount);
  }
  const byEid = new Map(mounts.map((mount) => [Number(mount.eid), mount]));
  return list.map((ev) => {
    const key = String(ev.name ?? '').trim().toLowerCase();
    const mount = byName.get(key) ?? byEid.get(Number(ev.eid));
    if (mount === undefined) return { ...ev, mountRoute: null, mountPoint: null, mountEid: null };
    return { ...ev, mountRoute: mount.route, mountPoint: mount.mountPoint, mountEid: mount.eid };
  });
}

let cached = null;
let cachedAt = 0;
const CACHE_MS = 5000;

/** 读当前 GES 案件的检材挂载（5 秒缓存，失败返回空表，不让查库受火眼影响）。 */
export async function loadEvidenceMounts() {
  if (cached !== null && Date.now() - cachedAt < CACHE_MS) return cached;
  try {
    const context = await gesJson(['status', '--json'], { timeout: 20_000 });
    cached = parseEvidenceMounts(context);
  } catch {
    cached = { mounts: [], skipped: [] };
  }
  cachedAt = Date.now();
  return cached;
}

/** 测试/调试用：清缓存。 */
export function resetEvidenceMountsCache() {
  cached = null;
  cachedAt = 0;
}
