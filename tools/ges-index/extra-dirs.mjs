/**
 * 「额外索引目录」持久化：MYOS 导入可以把索引写到任意输出目录，
 * 但面板 /list 默认只扫外壳下发的 SEEU_INDEX_SEARCH_DIRS。这里把导入用过的
 * 输出目录记到 <DSH_HOME>/index-extra-dirs.json，下次扫描自动带上。
 *
 * 外壳自己的索引目录状态（<DSH_HOME>/index-state.json）由 src/host.ts 维护，
 * 本文件故意用独立文件名，避免两个写者互相覆盖。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

const MAX_DIRS = 20

function dshHome(env) {
  const home = env['SEEU_DSH_HOME'] || env['DSH_HOME'] || ''
  return home ? resolve(home) : ''
}

export function extraDirsFile(env = process.env) {
  const override = env['SEEU_INDEX_EXTRA_DIRS']
  if (override) return resolve(override)
  const home = dshHome(env)
  return home ? resolve(home, 'index-extra-dirs.json') : ''
}

function readState(env) {
  const file = extraDirsFile(env)
  if (!file || !existsSync(file)) return { dirs: [] }
  try {
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (!text.trim()) return { dirs: [] }
    const value = JSON.parse(text)
    const dirs = Array.isArray(value?.dirs) ? value.dirs : []
    return { dirs: dirs.filter((item) => typeof item === 'string' && item.trim()) }
  } catch {
    return { dirs: [] }
  }
}

function writeState(dirs, env) {
  const file = extraDirsFile(env)
  if (!file) return false
  mkdirSync(dirname(file), { recursive: true })
  const body = { dirs, updatedAt: new Date().toISOString() }
  writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8')
  return true
}

/** 读额外目录（去掉重复/非绝对路径，忽略已不存在的目录）。 */
export function readExtraDirs(env = process.env) {
  const seen = new Set()
  const out = []
  for (const raw of readState(env).dirs) {
    if (!isAbsolute(raw)) continue
    const dir = resolve(raw)
    const key = dir.toLowerCase()
    if (seen.has(key) || !existsSync(dir)) continue
    seen.add(key)
    out.push(dir)
  }
  return out
}

/** 记住一个导入输出目录（幂等，最多 20 个，最近的在前）。 */
export function rememberExtraDir(dir, env = process.env) {
  const target = String(dir ?? '').trim()
  if (!target || !isAbsolute(target)) return readExtraDirs(env)
  const abs = resolve(target)
  if (!existsSync(abs)) return readExtraDirs(env)
  const current = readExtraDirs(env)
  const next = [abs, ...current.filter((item) => item.toLowerCase() !== abs.toLowerCase())].slice(0, MAX_DIRS)
  writeState(next, env)
  return next
}

/** 忘掉一个额外目录（只从清单移除，不动索引文件）。 */
export function forgetExtraDir(dir, env = process.env) {
  const target = String(dir ?? '').trim()
  if (!target || !isAbsolute(target)) return readExtraDirs(env)
  const abs = resolve(target).toLowerCase()
  const next = readExtraDirs(env).filter((item) => item.toLowerCase() !== abs)
  writeState(next, env)
  return next
}
