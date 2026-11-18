/**
 * 「关于 SeeU」信息（主进程用）：版本、运行时版本、dsh 版本、关键目录。
 *
 * 只读、无副作用；打包态与 dev 的差异（asar 内路径）都在这里消化，
 * 页面只负责渲染，便于 settings-check 断言。
 */

import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appRoot, dshHome } from './paths.js'

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

export const RELEASE_URL = 'https://github.com/ljnljn2005/SeeUForensicsAgentPlus/releases'

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

export function buildAppInfo(input: {
  version: string
  packaged: boolean
  electron: string
  chromium: string
  node: string
  dshVersion: string | null
  platform: string
  arch: string
  appRoot: string
  dshHome: string
}): AppInfo {
  return {
    name: 'SeeU 取证外壳',
    version: input.version,
    packaged: input.packaged,
    electron: input.electron,
    chromium: input.chromium,
    node: input.node,
    dshVersion: input.dshVersion,
    platform: input.platform,
    arch: input.arch,
    appRoot: input.appRoot,
    dshHome: input.dshHome,
    releaseUrl: RELEASE_URL,
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
  })
}

export function formatAppInfoText(info: AppInfo): string {
  return [
    `${info.name} v${info.version}${info.packaged ? '（安装版）' : '（开发模式）'}`,
    `Electron ${info.electron} · Chromium ${info.chromium} · Node ${info.node}`,
    `dsh ${info.dshVersion ?? '未找到'}`,
    `平台 ${info.platform}/${info.arch}`,
    `程序目录 ${info.appRoot}`,
    `数据目录 ${info.dshHome}`,
    `发布页 ${info.releaseUrl}`,
  ].join('\n')
}
