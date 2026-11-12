/**
 * 外部取证工具路径（Ghidra / IDA / tshark / jadx / python / 7z / sqlite3 …）。
 *
 * 默认值来自开发机实测，用户可以在「设置 → 本地模型与工具路径 → 外部取证工具」里改；
 * 配置写 `<DSH_HOME>/tool-paths.json`（`SEEU_TOOL_PATHS_CONFIG` 可覆盖），
 * 会话里由外壳通过 `SEEU_TOOL_<ID>` 环境变量注入。
 *
 * 细节见 `tools/tool-paths.mjs`（主进程与 e2e 共用）。
 */

import { TOOL_PATH_SPECS, saveToolPaths, toolPathsEnv, toolPathsFile, toolPathsView } from '../tools/tool-paths.mjs'

export { TOOL_PATH_SPECS, findOnPath, saveToolPaths, toolPathsEnv, toolPathsFile, toolPathsView }

export type ToolPathId =
  | 'ghidra'
  | 'ida'
  | 'tshark'
  | 'capinfos'
  | 'editcap'
  | 'python'
  | 'jadx'
  | 'apktool'
  | 'adb'
  | 'sevenzip'
  | 'sqlite3'
  | 'volatility'

export type ToolPathKind = 'file' | 'dir'

export interface ToolPathState {
  readonly id: ToolPathId
  readonly label: string
  readonly kind: ToolPathKind
  readonly env: string
  readonly command: string
  readonly hint: string
  readonly defaultPath: string
  readonly path: string
  readonly source: 'config' | 'path' | 'default'
  readonly configured: boolean
  readonly exists: boolean
  readonly found: boolean
}

export interface ToolPathsView {
  readonly configFile: string
  readonly tools: ToolPathState[]
  readonly error?: string
}

export interface ToolPathsSaveResult {
  readonly ok: boolean
  readonly error?: string
  readonly configFile?: string
  readonly tools?: ToolPathState[]
  readonly saved?: string[]
}
