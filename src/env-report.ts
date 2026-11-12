/**
 * 运行环境体检的宿主侧拼接：收集各模块事实，交给 `tools/env-report.mjs` 判定。
 *
 * 只读操作：不启动 dsh/CLI 进程，不写文件。挂载状态来自 `mountManager.status()`，
 * 它是廉价的（只读清单 + 解析 CLI 路径）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { buildEnvReport, formatEnvReport } from '../tools/env-report.mjs'
import { resolveMyosMcp } from '../tools/myos-index/mcp.mjs'
import { describeLocalModelConfig } from './local-model.js'
import { mountManager } from './mounts.js'
import { appRoot, dshHome } from './paths.js'
import { toolPathsView } from './tool-paths.js'

export type EnvStatus = 'ok' | 'warn' | 'fail'

export interface EnvReportItem {
  key: string
  label: string
  status: EnvStatus
  detail: string
  hint?: string
}

export interface EnvReport {
  ok: boolean
  version: number
  checkedAt: string
  summary: { total: number; ok: number; warn: number; fail: number; worst: EnvStatus }
  items: EnvReportItem[]
}

/** 目录下「含 SKILL.md 的子目录」数量（技能根/技能组都用这个口径）。 */
function countSkillDirs(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')),
    ).length
  } catch {
    return 0
  }
}

/** 技能组：`skill-sets/<id>/` 下数量 >0 的组 id。 */
function skillSetIds(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && countSkillDirs(join(dir, entry.name)) > 0)
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 判断标准与 dsh 一致：先看会话 profile 的 node_modules，再看安装目录。 */
function bundleResolvable(name: string, profileDir: string): boolean {
  if (existsSync(join(profileDir, 'node_modules', name, 'package.json'))) return true
  if (existsSync(join(appRoot(), 'node_modules', name, 'package.json'))) return true
  try {
    const require = createRequire(join(appRoot(), 'package.json'))
    require.resolve(`${name}/package.json`)
    return true
  } catch {
    return false
  }
}

export async function collectEnvReport(): Promise<EnvReport> {
  const home = dshHome()
  const profileDir = join(home, 'profiles', 'web')
  const root = appRoot()

  // 外部工具：工具路径视图里 found 的比例。
  let tools = { total: 0, ready: 0, missing: [] as string[] }
  try {
    const view = toolPathsView(process.env)
    const rows = Array.isArray(view.tools) ? view.tools : []
    tools = {
      total: rows.length,
      ready: rows.filter((row) => row.found).length,
      missing: rows.filter((row) => !row.found).map((row) => row.label),
    }
  } catch {
    // 保持空清单，由报告判 fail。
  }

  // 随包插件：profile 清单里的每个 bundle 能不能解析到包。
  let plugins = { bundles: 0, missing: [] as string[] }
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
    const bundles: string[] = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    plugins = { bundles: bundles.length, missing: bundles.filter((name) => !bundleResolvable(name, profileDir)) }
  } catch {
    // 文件不存在 = 首次启动前的正常状态。
  }

  // 技能：随包技能 / 随包技能组 / 已安装数量。
  const bundledSkills = countSkillDirs(join(root, 'resources', 'forensics', 'skills'))
  const sets = skillSetIds(join(root, 'resources', 'forensics', 'skill-sets'))
  const installed = countSkillDirs(join(home, 'skills'))

  // 索引目录：登记在 index-state.json 里的扫描目录，有多少真实存在。
  let indexDirs = { total: 0, existing: 0, missing: [] as string[] }
  try {
    const state = JSON.parse(readFileSync(join(home, 'index-state.json'), 'utf8').replace(/^\uFEFF/, ''))
    const dirs: string[] = Array.isArray(state?.dirs) ? state.dirs.filter((dir: unknown) => typeof dir === 'string') : []
    const missing = dirs.filter((dir) => !existsSync(dir))
    indexDirs = { total: dirs.length, existing: dirs.length - missing.length, missing }
  } catch {
    // 没有登记过案件目录。
  }

  // 镜像挂载：只读状态，不启动 CLI。
  let mounts: { found: boolean; version?: string; error?: string; active?: number } = { found: false }
  try {
    const status = await mountManager.status()
    const cliPath = status?.cli?.path ?? ''
    mounts = {
      found: Boolean(cliPath) && existsSync(cliPath),
      version: status?.cli?.version,
      error: status?.cli?.error,
      active: Array.isArray(status?.mounts) ? status.mounts.length : 0,
    }
  } catch (error) {
    mounts = { found: false, error: error instanceof Error ? error.message : String(error) }
  }

  // MYOS MCP 服务端文件。
  const myosPath = resolveMyosMcp(process.env)
  const myos = { path: myosPath, found: existsSync(myosPath) }

  // 本机模型配置。
  const localModel = describeLocalModelConfig()

  const report = buildEnvReport({ tools, plugins, skills: { bundled: bundledSkills, sets, installed }, indexDirs, mounts, myos, localModel })
  return report as EnvReport
}

export function envReportText(report: EnvReport): string {
  return formatEnvReport(report)
}
