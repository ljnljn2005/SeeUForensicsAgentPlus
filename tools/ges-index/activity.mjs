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
