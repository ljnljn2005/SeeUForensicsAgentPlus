/**
 * 建库进度的展示模型（纯函数，服务端与单测共用）。
 *
 * 服务端 GET /build 会在原始 job 上附加 `progress: describeBuildProgress(job)`，
 * 面板直接渲染这些人类可读字段，避免「只有 40%」这种看不出还要多久的信息。
 */

export const BUILD_PHASE_LABELS = {
  probe: '探测案件',
  enumerate: '枚举检材',
  fetch: '读取检材数据',
  finalize: '校验与替换',
  done: '完成',
  failed: '失败',
};

const RUNNING_HINT_MS = 90_000;

export function buildPhaseLabel(phase) {
  if (typeof phase !== 'string' || !phase) return '建库';
  return BUILD_PHASE_LABELS[phase] ?? phase;
}

/** 毫秒 → 「12.3 秒」「1 分 23 秒」这类紧凑中文时长。 */
export function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '0 秒';
  if (value < 1000) return '不足 1 秒';
  if (value < 60_000) {
    const seconds = value / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
  }
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function groupDigits(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * @param {object} job  服务端的建库任务（status/phase/completed/total/percent/startedAt/elapsedMs/result/code/error）
 * @param {number} [now] 当前时间，便于单测注入
 */
export function describeBuildProgress(job, now = Date.now()) {
  const status = job?.status ?? 'running';
  const running = status === 'running';
  const elapsedMs = Number.isFinite(job?.elapsedMs)
    ? Number(job.elapsedMs)
    : running && Number.isFinite(job?.startedAt)
      ? Math.max(0, now - Number(job.startedAt))
      : 0;
  const elapsedText = formatDuration(elapsedMs);
  const total = Number(job?.total) || 0;
  const completed = Number(job?.completed) || 0;
  const percent = Number.isFinite(Number(job?.percent)) ? Math.max(0, Math.min(100, Number(job.percent))) : 0;
  const detail = total > 0 ? `${groupDigits(completed)} / ${groupDigits(total)} 条 · ${percent}%` : `${percent}%`;
  const etaMs = Number(job?.etaMs) || 0;
  const etaText = running && etaMs > 0 ? formatDuration(etaMs) : '';
  const hint = running && elapsedMs >= RUNNING_HINT_MS
    ? '大案件首次建库可能需要几分钟；可以先切到其他视图，任务会在后台继续。'
    : '';

  let summary = '';
  if (status === 'done') {
    const counts = job?.result?.manifest?.counts ?? {};
    const sizeBytes = Number(job?.result?.manifest?.sizeBytes) || 0;
    summary = `建库完成：${groupDigits(counts.records)} 条记录 · ${groupDigits(counts.entities)} 个实体 · 用时 ${elapsedText}`;
    if (sizeBytes > 0) summary += ` · 索引 ${(sizeBytes / 1048576).toFixed(1)} MiB`;
  } else if (status === 'failed') {
    summary = `建库失败（${job?.code ?? 'E_UNKNOWN'}）：${job?.error ?? ''}`.trim();
  }

  return {
    status,
    running,
    phaseLabel: buildPhaseLabel(job?.phase),
    elapsedMs,
    elapsedText,
    detail,
    etaText,
    percent,
    hint,
    summary,
  };
}
