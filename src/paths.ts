/**
 * 路径解析：把"开发运行"与"打包运行"两种形态收敛到同一组路径。
 *
 * 打包形态下 app.getAppPath() 指向 `resources/app.asar`，dsh 运行时随
 * `node_modules/@deepseek-ai/dsh` 一起打进 asar；Electron 的 asar 支持让
 * Node 模式子进程可以直接 require/执行 asar 内的 JS 入口（原生 .node
 * 由 electron-builder 的 asarUnpack 解包）。
 */

import { app } from 'electron'
import { join } from 'node:path'
import { PRODUCT_NAME, WORKSPACE_DIR_NAME } from './brand.js'

/** 应用根目录（开发时为工程根，打包后为 app.asar 根）。 */
export function appRoot(): string {
  return app.getAppPath()
}

/** dsh npm 运行时包目录。 */
export function dshRuntimeDir(): string {
  return join(appRoot(), 'node_modules', '@deepseek-ai', 'dsh')
}

/** dsh CLI 入口（launcher：负责 profile/patch 组合后启动 web app）。 */
export function dshCliEntry(): string {
  return join(dshRuntimeDir(), 'lib', 'bin.js')
}

/** 本次桌面版专用的 DSH_HOME：与用户 `~/.dsh` 完全隔离，避免污染/被污染。 */
export function dshHome(): string {
  return process.env.SEEU_DSH_HOME ?? join(app.getPath('userData'), 'dsh-home')
}

/** 取证 profile 覆盖层（随应用分发，位于 asar 内）。 */
export function forensicsPatchPath(): string {
  return process.env.SEEU_FORENSICS_PATCH
    ?? join(appRoot(), 'resources', 'forensics', 'cordis.patch.yml')
}

/** 默认取证工作区；可用 `SEEU_WORKSPACE` 覆盖。 */
export function workspaceDir(): string {
  return process.env.SEEU_WORKSPACE
    ?? join(app.getPath('documents'), WORKSPACE_DIR_NAME)
}

/** 外壳日志目录（dsh 子进程 stdout/stderr 也落在这里）。 */
export function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

export function hostLogFile(): string {
  return join(logDir(), `dsh-host-${new Date().toISOString().slice(0, 10)}.log`)
}

export function shellLogFile(): string {
  return join(logDir(), 'shell.log')
}

/** 加载页 / 错误页所在目录（dist/renderer）。 */
export function rendererDir(): string {
  return join(__dirname, 'renderer')
}

/** 预加载脚本（与主进程同目录）。 */
export function preloadFile(): string {
  return join(__dirname, 'preload.cjs')
}

/** 托盘/窗口图标；缺失时调用方需降级处理。 */
export function trayIconPath(): string {
  return join(appRoot(), 'build', 'tray.ico')
}

export function windowIconPath(): string {
  return join(appRoot(), 'build', 'icon.ico')
}

/**
 * 用户数据根（%APPDATA%/SeeUForensicsAgentPlus）。
 *
 * `SEEU_USER_DATA` 可覆盖：自动化截图/验收要用独立目录，避免污染真实配置
 * （Electron 的 `--user-data-dir` 只影响 Chromium 数据，不改 `app.getPath('userData')`）。
 */
export function userDataDir(): string {
  const override = process.env.SEEU_USER_DATA
  if (override !== undefined && override.trim() !== '') return override
  return app.getPath('userData')
}

export { PRODUCT_NAME }
