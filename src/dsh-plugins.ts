/**
 * 随包 dsh 插件的薄层：默认路径来自 Electron（appRoot / dshHome），
 * 纯逻辑在 `tools/dsh-plugins.mjs`（可被 node:test 直接单测）。
 */
import { appRoot, dshHome } from './paths.js'
import {
  BUNDLED_DSH_PLUGINS,
  PROFILE_BASE_BUNDLES,
  SHELL_PROFILE_NAME,
  installBundledPluginBundles as installInto,
  mergePluginBundles,
  pluginPackagePresent,
} from '../tools/dsh-plugins.mjs'

export { BUNDLED_DSH_PLUGINS, PROFILE_BASE_BUNDLES, SHELL_PROFILE_NAME, mergePluginBundles, pluginPackagePresent }

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
