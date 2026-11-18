/**
 * 「关于 SeeU」信息（主进程用）：版本、运行时版本、dsh 版本、关键目录。
 *
 * 纯整形逻辑在 `tools/app-info.mjs`（可单测）；这里只负责从 Electron/fs 采集事实，
 * 打包态与 dev 的 asar 路径差异也在此消化，页面只负责渲染。
 */

import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAppInfo, formatAppInfoText, RELEASE_URL } from '../tools/app-info.mjs'
import { appRoot, dshHome } from './paths.js'

export { buildAppInfo, formatAppInfoText, RELEASE_URL }

export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly packaged: boolean
  readonly electron: string
  readonly chromium: string
  readonly node: string
  readonly dshVersion: string | null
  readonly platform: string
  readonly arch: string
  readonly appRoot: string
  readonly dshHome: string
  readonly releaseUrl: string
}

function readDshVersion(root: string): string | null {
  try {
    const file = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    if (!existsSync(file)) return null
    const value = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }
    return typeof value.version === 'string' ? value.version : null
  } catch {
    return null
  }
}

export function collectAppInfo(): AppInfo {
  const root = appRoot()
  return buildAppInfo({
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron ?? '',
    chromium: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    dshVersion: readDshVersion(root),
    platform: process.platform,
    arch: process.arch,
    appRoot: root,
    dshHome: dshHome(),
  }) as AppInfo
}
