/**
 * 案件索引的「规模 / 新鲜度」摘要（纯函数，供会话概览与单测使用）。
 *
 * findIndexes() 会把 manifest.json 里的 counts / durationMs / leaves / coverageOk
 * 一并带回，这里把它们变成一行给模型看的中文摘要，并对「索引过旧 / 上次建库不完整」给告警。
 */

export const DEFAULT_STALE_DAYS = 7;

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 MiB';
  const mib = n / 1048576;
  if (mib < 0.1) return '0 MiB';
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GiB`;
  if (mib >= 100) return `${mib.toFixed(0)} MiB`;
  return `${mib.toFixed(1)} MiB`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** ISO 时间 → 「2026-11-12 23:52」（本地时区）；无法解析返回 ''。 */
export function formatBuiltAt(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function groupDigits(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function durationText(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 60_000) return `${Math.max(1, Math.round(n / 1000))} 秒`;
  return `${Math.floor(n / 60_000)} 分 ${Math.round((n % 60_000) / 1000)} 秒`;
}

/**
 * @param {object} index  findIndexes() 的一项（含 counts/durationMs/leaves/coverageOk/builtAt/sizeBytes）
 * @param {number} [now]
 * @param {number} [staleDays]
 * @returns {{text:string, warn:string, stale:boolean, ageDays:number}}
 */
export function indexSummary(index, now = Date.now(), staleDays = DEFAULT_STALE_DAYS) {
  const counts = index?.counts ?? {};
  const records = Number(counts.records);
  const entities = Number(counts.entities);
  const artifacts = Number(counts.artifacts);
  const builtAt = formatBuiltAt(index?.builtAt);
  const took = durationText(index?.durationMs);
  const size = formatBytes(index?.sizeBytes);

  const parts = [];
  if (Number.isFinite(records)) parts.push(`${groupDigits(records)} 条记录`);
  if (Number.isFinite(entities)) parts.push(`${groupDigits(entities)} 个实体`);
  if (Number.isFinite(artifacts)) parts.push(`${groupDigits(artifacts)} 个检材文件`);
  const pieces = [`索引：${parts.length ? parts.join(' · ') : '规模未知'}`];
  if (builtAt) pieces.push(`建库 ${builtAt}${took ? `（用时 ${took}）` : ''}`);
  pieces.push(`库 ${size}`);
  const text = pieces.join(' · ');

  let stale = false;
  let ageDays = 0;
  const builtMs = index?.builtAt ? new Date(index.builtAt).getTime() : NaN;
  if (Number.isFinite(builtMs) && Number.isFinite(now)) {
    ageDays = Math.floor((now - builtMs) / 86_400_000);
    stale = ageDays >= Number(staleDays || DEFAULT_STALE_DAYS);
  }

  const failedLeaves = Number(index?.leaves?.failed) || 0;
  const warnings = [];
  if (index?.coverageOk === false || failedLeaves > 0) {
    warnings.push(`上次建库有 ${failedLeaves || '部分'} 个叶子失败，索引可能不完整（重跑「建库 / 更新」可修复）`);
  }
  if (stale) {
    warnings.push(`索引已 ${ageDays} 天未更新，检材可能有新增内容，建议点「建库 / 更新」`);
  }
  return { text, warn: warnings.length ? warnings.join('；') : '', stale, ageDays };
}
