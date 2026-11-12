/**
 * 本机取证工具的路径配置（LovelyMem V3 / LovelySpark）。
 *
 * 用户要求「不要自动发现，路径由我在界面里手动指定」——
 * 所以这里只有读写 `<DSH_HOME>/lovely-cli.json`（`SEEU_LOVELY_CONFIG` 可覆盖），
 * 不做 PATH / 注册表 / 快捷方式 / 目录遍历。dsh 技能调用包装器时由
 * `tools/lovely-cli/cli.mjs` 每次读取同一份配置（环境变量优先，仅供调试）。
 *
 * 细节见 `tools/lovely-tools.mjs`（主进程与 e2e 共用）。
 */

import { LOVELY_TOOL_SPECS, lovelyConfigFile, lovelyToolsView, saveLovelyToolPaths } from '../tools/lovely-tools.mjs'

export { LOVELY_TOOL_SPECS, lovelyConfigFile, lovelyToolsView, saveLovelyToolPaths }

export type LovelyToolId = 'lovelymem' | 'lovelyspark' | 'lovelycarve'

export interface LovelyToolState {
  readonly id: LovelyToolId
  readonly label: string
  readonly env: string
  readonly hint: string
  readonly path: string
  readonly source: 'env' | 'config' | 'unset'
  readonly configured: boolean
  readonly found: boolean
}

export interface LovelyToolsView {
  readonly configFile: string
  readonly tools: LovelyToolState[]
  readonly error?: string
}

export interface LovelyToolsSaveResult {
  readonly ok: boolean
  readonly error?: string
  readonly saved?: { id: LovelyToolId; action: 'set' | 'cleared' }[]
  readonly configFile?: string
  readonly tools?: LovelyToolState[]
}
