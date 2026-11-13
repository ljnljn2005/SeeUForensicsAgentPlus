import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

/** 只做一次链路的覆盖度判断：索引里有内容的检材 vs 只有元数据的检材。 */
export function describeIndexCoverage(evidences = []) {
  const parsed = []
  const metadataOnly = []
  for (const ev of evidences) {
    const rows = Number(ev.recordCount ?? 0)
    const reported = Number(ev.reportedRecordCount ?? 0)
    if (rows > 0 && (reported === 0 || rows >= reported * 0.5 || rows > 1)) parsed.push({ ...ev, rows, reported })
    else metadataOnly.push({ ...ev, rows, reported })
  }
  return {
    total: evidences.length,
    parsed: parsed.map((ev) => ev.name),
    metadataOnly: metadataOnly.map((ev) => ev.name),
    ok: parsed.length > 0,
  }
}

/** 挂载点是否真能读：目录存在且（尽量）能列目录。 */
export function checkMountReadable(evidence, fs = { statSync, readdirSync }) {
  const point = evidence.mountPoint
  if (!point) return { name: evidence.name, mounted: false, readable: false, reason: '没有火眼挂载入口' }
  try {
    if (!fs.statSync(point).isDirectory()) return { name: evidence.name, mounted: true, readable: false, reason: '挂载点不是目录' }
    const entries = fs.readdirSync(point)
    return { name: evidence.name, mounted: true, readable: true, entries: entries.length, sample: entries.slice(0, 3) }
  } catch (error) {
    return { name: evidence.name, mounted: true, readable: false, reason: String(error?.message ?? error) }
  }
}

/** 汇总链路结论；任一必需环节失败则 ok=false。 */
export function summarizeChain(report) {
  const fails = []
  if (!report.index?.ok) fails.push('index: ' + (report.index?.error ?? '索引不可用'))
  if (report.query && report.query.ok === false) fails.push('query: ' + (report.query.error ?? '检索失败'))
  if (report.mounts && report.mounts.ok === false) fails.push('mounts: ' + (report.mounts.error ?? '挂载不可用'))
  if (report.images && report.images.some((item) => item.inspectOk === false)) fails.push('images: 镜像解析失败')
  return { ok: fails.length === 0, fails }
}

export function formatChainReport(report) {
  const lines = []
  const push = (line = '') => lines.push(line)
  push(`# SeeU 链路体检 ${report.timestamp}`)
  push('')
  push(`案件：${report.case?.name ?? ''}（${report.case?.number ?? ''}）`)
  push(`索引：${report.index?.dbPath ?? ''}`)
  if (report.index?.counts) {
    push(`规模：${report.index.counts.records ?? 0} 条记录 · ${report.index.counts.entities ?? 0} 个实体 · ${report.index.counts.artifacts ?? 0} 个检材文件`)
  }
  push('')
  push('## 1. 索引覆盖')
  push(`- 有解析内容：${(report.coverage?.parsed ?? []).join('、') || '无'}`)
  push(`- 仅元数据：${(report.coverage?.metadataOnly ?? []).join('、') || '无'}`)
  push('')
  push('## 2. 检索链路')
  if (report.query) {
    push(`- ${report.query.ok ? '✅' : '❌'} q="${report.query.q}" · 引擎 ${report.query.engine ?? '-'} · ${report.query.total ?? 0} 命中`)
  }
  push('')
  push('## 3. 火眼只读挂载')
  for (const item of report.mounts?.items ?? []) {
    const sample = (item.sample ?? []).slice(0, 3).join('、')
    push(`- ${item.readable ? '✅' : '⚠️'} ${item.name}${item.reason ? '：' + item.reason : `（${item.entries ?? 0} 项${sample ? '：' + sample : ''}）`}`)
  }
  if (!report.mounts?.items?.length) push('- 没有检材条目，无法核对挂载')
  else if (!report.mounts.ok) push('- 提示：先打开火眼案件（`ges status --json` 应含 `evidence_mounts`），再重跑本体检')
  push('')
  push('## 4. 镜像（LovelyCarve）')
  for (const item of report.images ?? []) {
    const parts = (item.partitions ?? []).map((p) => p.label || `#${p.index}`).join(' / ')
    push(`- ${item.inspectOk ? '✅' : '❌'} ${item.image}：${item.inspectOk ? `${item.sizeBytes ?? '?'} B · ${(item.partitions ?? []).length} 分区${parts ? '（' + parts + '）' : ''} · ${item.inspectMs} ms` : item.error}`)
  }
  if (!report.images?.length) push('- 本案件没有可解析的镜像文件')
  push('')
  const summary = summarizeChain(report)
  push(summary.ok ? '结论：✅ 链路打通' : '结论：❌ 存在失败环节： ' + summary.fails.join('；'))
  return lines.join('\n')
}

/** 从环境变量/额外目录/外壳 index-state 里收集可扫描的索引根目录（与插件行为一致）。 */
export function collectIndexDirs(env = process.env, fs = { readFileSync }) {
  const dirs = []
  const add = (value) => {
    const text = String(value ?? '').trim()
    if (!text) return
    const abs = text.startsWith('~') ? join(homedir(), text.slice(1)) : text
    if (!dirs.some((dir) => dir.toLowerCase() === abs.toLowerCase())) dirs.push(abs)
  }
  for (const part of String(env.SEEU_INDEX_SEARCH_DIRS ?? '').split(';')) add(part)

  const home = env.SEEU_DSH_HOME || env.DSH_HOME || join(homedir(), '.dsh')
  for (const file of [join(home, 'index-extra-dirs.json'), join(home, 'index-state.json')]) {
    try {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
      const value = JSON.parse(text)
      const list = Array.isArray(value?.dirs) ? value.dirs : []
      for (const dir of list) add(dir)
    } catch {
      // 没有或坏了都不影响，跳过。
    }
  }
  return dirs
}

/** 被调用的模块（CLI）用 require.resolve 找可复用工具，避免重复实现。 */
export function resolveHelper(name) {
  return require.resolve(name)
}
