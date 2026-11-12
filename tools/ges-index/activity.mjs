/**
 * 索引活动记录：谁在什么时候建了库 / 从 MYOS 导入了什么。
 *
 * 存在 `<DSH_HOME>/index-activity.json`（`SEEU_INDEX_ACTIVITY` 可覆盖），
 * 只保留最近 30 条，给面板「最近活动」和排查用；不参与索引检索。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

export const ACTIVITY_MAX = 30

export function activityHome(env = process.env) {
  const home = env['SEEU_DSH_HOME'] || env['DSH_HOME'] || join(homedir(), '.dsh')
  return resolve(home)
}

export function activityFile(env = process.env) {
  return env['SEEU_INDEX_ACTIVITY'] ? resolve(env['SEEU_INDEX_ACTIVITY']) : join(activityHome(env), 'index-activity.json')
}

/** 读活动列表（坏文件/空文件都返回 []，不让面板挂掉）。 */
export function readActivity(env = process.env) {
  const file = activityFile(env)
  if (!existsSync(file)) return []
  try {
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (!text.trim()) return []
    const value = JSON.parse(text)
    if (!Array.isArray(value?.entries)) return []
    return value.entries.filter((item) => item && typeof item === 'object')
  } catch {
    return []
  }
}

/** 追加一条活动（最新的在前，最多 ACTIVITY_MAX 条）。 */
export function recordActivity(entry, env = process.env) {
  const item = { at: new Date().toISOString(), ...entry }
  const entries = [item, ...readActivity(env)].slice(0, ACTIVITY_MAX)
  const file = activityFile(env)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ updatedAt: item.at, entries }, null, 2)}\n`, 'utf8')
  return item
}

/** 清空（面板「清空」按钮用）。 */
export function clearActivity(env = process.env) {
  const file = activityFile(env)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ updatedAt: new Date().toISOString(), entries: [] }, null, 2)}\n`, 'utf8')
}

/** 活动统计窗口（天）。 */
export const ACTIVITY_SUMMARY_DAYS = 7

/** 把毫秒格式化成「X 秒 / X 分 Y 秒 / X 小时 Y 分」。 */
export function formatActivityDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0))
  const seconds = Math.round(total / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

/**
 * 最近 N 天的活动统计（纯函数，给面板摘要行用）。
 *
 * 只统计窗口内的记录：建库次数/平均用时、MYOS 导入次数/累计条数。
 * 时间字段坏掉（无法解析）的条目计入次数但不参与平均。
 */
export function summarizeActivity(entries, now = Date.now(), days = ACTIVITY_SUMMARY_DAYS) {
  const list = Array.isArray(entries) ? entries.filter((item) => item && typeof item === 'object') : []
  const since = now - Math.max(1, Number(days) || ACTIVITY_SUMMARY_DAYS) * 24 * 60 * 60 * 1000
  let builds = 0
  let imports = 0
  let buildMsTotal = 0
  let buildMsCount = 0
  let rows = 0
  let lastAt = ''
  for (const entry of list) {
    const at = Date.parse(String(entry.at ?? ''))
    if (!Number.isFinite(at) || at < since) continue
    if (!lastAt || at > Date.parse(lastAt)) lastAt = String(entry.at ?? '')
    if (entry.kind === 'build') {
      builds += 1
      const duration = Number(entry.durationMs)
      if (Number.isFinite(duration) && duration > 0) {
        buildMsTotal += duration
        buildMsCount += 1
      }
    } else if (entry.kind === 'myos-import') {
      imports += 1
      const count = Number(entry.rows)
      if (Number.isFinite(count) && count > 0) rows += count
    }
  }
  return {
    days: Math.max(1, Number(days) || ACTIVITY_SUMMARY_DAYS),
    builds,
    imports,
    avgBuildMs: buildMsCount > 0 ? Math.round(buildMsTotal / buildMsCount) : null,
    rows,
    lastAt,
    total: builds + imports,
  }
}

/** 摘要文案（无活动返回空串，面板据此隐藏这一行）。 */
export function formatActivitySummary(summary) {
  if (!summary || summary.total === 0) return ''
  const parts = []
  if (summary.builds > 0) {
    const avg = summary.avgBuildMs ? `平均 ${formatActivityDuration(summary.avgBuildMs)}` : '无用时数据'
    parts.push(`建库 ${summary.builds} 次（${avg}）`)
  }
  if (summary.imports > 0) {
    const rows = summary.rows > 0 ? `，${summary.rows.toLocaleString('zh-CN')} 条` : ''
    parts.push(`MYOS 导入 ${summary.imports} 次${rows}`)
  }
  return `近 ${summary.days} 天：${parts.join(' · ')}`
}
