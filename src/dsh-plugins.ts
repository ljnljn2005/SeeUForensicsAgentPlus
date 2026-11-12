/**
 * 随包 dsh 插件的薄层：默认路径来自 Electron（appRoot / dshHome），
 * 纯逻辑在 `tools/dsh-plugins.mjs`（可被 node:test 直接单测）。
 */
import { appRoot, dshHome } from './paths.js'
import {
  BUNDLED_DSH_PLUGINS,
  PLUGIN_PACKAGES_MARKER,
  PROFILE_BASE_BUNDLES,
  SHELL_PROFILE_NAME,
  collectPluginClosure,
  ensurePluginPackages as ensurePackagesInto,
  installBundledPluginBundles as installInto,
  mergePluginBundles,
  pluginPackagePresent,
  resolveDependencyDir,
} from '../tools/dsh-plugins.mjs'

export {
  BUNDLED_DSH_PLUGINS,
  PLUGIN_PACKAGES_MARKER,
  PROFILE_BASE_BUNDLES,
  SHELL_PROFILE_NAME,
  collectPluginClosure,
  mergePluginBundles,
  pluginPackagePresent,
  resolveDependencyDir,
}

export interface PluginBundlesInstallResult {
  readonly profileDir: string
  readonly manifestPath: string
  readonly added: string[]
  readonly missing: string[]
  readonly changed: boolean
  readonly error?: string
}

/** 启动前调用：补齐 `<DSH_HOME>/profiles/web/package.json` 的 bundles。 */
export function installBundledPluginBundles(): PluginBundlesInstallResult {
  return installInto({ homeDir: dshHome(), pluginsDir: appRoot() })
}

export interface PluginPackagesResult {
  readonly profileDir: string
  readonly targetRoot: string
  readonly markerPath: string
  readonly packages: string[]
  readonly copied: number
  readonly removed: string[]
  readonly changed: boolean
  readonly missing: string[]
  readonly optionalMissing: string[]
  readonly error?: string
}

/**
 * 启动前调用：把插件包（含非 @deepseek-ai 依赖闭包）复制进
 * `<DSH_HOME>/profiles/web/node_modules`，否则 dsh 从 profile 目录导入会
 * `ERR_MODULE_NOT_FOUND`、插件不激活。
 */
export function ensureBundledPluginPackages(version: string): PluginPackagesResult {
  return ensurePackagesInto({ homeDir: dshHome(), pluginsDir: appRoot(), version })
}
