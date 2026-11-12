/**
 * 本机取证工具（LovelyMem V3 / LovelySpark）的路径配置。
 *
 * 设计取舍（2026-11 用户明确要求）：**只支持手动指定，不做自动发现**。
 * 原因：PATH/注册表/快捷方式/全盘搜索会误命中旧版 Lite/Luxe GUI，在负载高时还会
 * 超时拖慢第一次调用；两款工具装在什么位置是用户清楚的，让用户在设置窗口里选一次
 * 最省事、也最可控。
 *
 * 配置写进 `<DSH_HOME>/lovely-cli.json`（`SEEU_LOVELY_CONFIG` 可覆盖），格式：
 *   { "lovelymem": "E:\\...\\lovelymem.v3.exe", "lovelyspark": "E:\\...\\lovelyspark.exe" }
 * `tools/lovely-cli/cli.mjs` 每次调用都读这份文件；环境变量
 * `SEEU_LOVELYMEM_EXE` / `SEEU_LOVELYSPARK_EXE` 优先级更高（调试用）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const LOVELY_TOOL_SPECS = [
  {
    id: 'lovelymem',
    label: 'LovelyMem V3',
    env: 'SEEU_LOVELYMEM_EXE',
    hint: '选择支持 --cli 的 lovelymem.v3.exe；不要选 Lite / Luxe 的 GUI 程序。',
  },
  {
    id: 'lovelyspark',
    label: 'LovelySpark',
    env: 'SEEU_LOVELYSPARK_EXE',
    hint: '选择 lovelyspark.exe（用于流量包分析）。',
  },
  {
    id: 'lovelycarve',
    label: 'LovelyCarve CLI',
    env: 'SEEU_LOVELYCARVE_CLI',
    hint: '选择 lovelycarve-cli.exe（随 LovelyCarve 安装包提供，用于镜像挂载/分区解析；不是 GUI 的 LovelyCarve.exe）。',
  },
]

/** 与 cli.mjs 的 configPath() 保持一致的解析顺序。 */
export function lovelyConfigFile(env = process.env) {
  // 与应用一致：外壳用 SEEU_DSH_HOME 指定 dsh 主目录（e2e/开发隔离），其次 DSH_HOME，最后 ~/.dsh。
  return resolve(env.SEEU_LOVELY_CONFIG || join(env.SEEU_DSH_HOME || env.DSH_HOME || join(homedir(), '.dsh'), 'lovely-cli.json'))
}

export function readLovelyConfig(env = process.env) {
  const file = lovelyConfigFile(env)
  if (!existsSync(file)) return {}
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  if (!text.trim()) return {}
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`配置必须是 JSON 对象：${file}`)
  return value
}

function toolState(spec, env, config) {
  const fromEnv = typeof env[spec.env] === 'string' ? env[spec.env] : ''
  const configured = fromEnv || (typeof config[spec.id] === 'string' ? config[spec.id] : '')
  const found = Boolean(configured) && isAbsolute(configured) && existsSync(configured)
  return {
    id: spec.id,
    label: spec.label,
    env: spec.env,
    hint: spec.hint,
    path: configured || '',
    /** env = 环境变量覆盖（调试）；config = 设置窗口保存；unset = 还没指定。 */
    source: fromEnv ? 'env' : configured ? 'config' : 'unset',
    configured: Boolean(configured),
    found,
  }
}

/** 设置窗口展示用：配置位置 + 两款工具的当前状态。 */
export function lovelyToolsView(env = process.env) {
  const configFile = lovelyConfigFile(env)
  let config = {}
  let error
  try {
    config = readLovelyConfig(env)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  return { configFile, error, tools: LOVELY_TOOL_SPECS.map((spec) => toolState(spec, env, config)) }
}

/**
 * 保存设置窗口里的路径。`{ lovelymem: 'D:\\...\\x.exe' }`；空字符串表示清除该项。
 * 校验：绝对路径、文件存在、`.exe` 结尾（两款都是 Windows 可执行文件）。
 */
export function saveLovelyToolPaths(input, env = process.env) {
  const payload = input && typeof input === 'object' ? input : {}
  const config = readLovelyConfig(env)
  const saved = []
  for (const spec of LOVELY_TOOL_SPECS) {
    if (!Object.hasOwn(payload, spec.id)) continue
    const raw = payload[spec.id]
    const value = typeof raw === 'string' ? raw.trim().replace(/^"(.*)"$/, '$1') : ''
    if (!value) {
      delete config[spec.id]
      saved.push({ id: spec.id, action: 'cleared' })
      continue
    }
    if (!isAbsolute(value)) throw new Error(`${spec.label} 路径必须是绝对路径`)
    if (!existsSync(value)) throw new Error(`${spec.label} 文件不存在：${value}`)
    if (!/\.exe$/i.test(value)) throw new Error(`${spec.label} 需要选择 .exe 文件`)
    config[spec.id] = value
    saved.push({ id: spec.id, action: 'set', path: value })
  }
  const file = lovelyConfigFile(env)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
  return { ok: true, saved, ...lovelyToolsView(env) }
}
