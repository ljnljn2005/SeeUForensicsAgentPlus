/**
 * 随包 dsh 插件（预打包）—— 把「billion-context / dsh-context / dsh-better-sidebar /
 * dsh-gitbash-shell」装进 SeeU 自己的 dsh profile。
 *
 * 为什么不走 `dsh plugin add`：安装包要能离线运行，用户机器上没有 npm 也没有网络。
 * 做法是：
 *   1. 四个插件作为工程依赖装进 `<app>/node_modules`（electron-builder 的
 *      `node_modules/**` 白名单会把它们打进 app.asar）；
 *   2. dsh 的 bundle 解析顺序是「安装目录（@deepseek-ai/dsh 所在 node_modules）
 *      优先，其次 profile 目录」，所以插件包不需要出现在 profile 的
 *      node_modules 里，只要 profile 的 `dsh.profile.bundles` 里写了名字就能解析到；
 *   3. 启动前把 `<DSH_HOME>/profiles/web/package.json` 的 bundles 列表补齐，
 *      保留用户/其它模块已有的条目，只追加缺的。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 随包插件（顺序即 bundle 层叠加顺序，必须保持稳定）。 */
export const BUNDLED_DSH_PLUGINS = [
  'billion-context',
  'dsh-context',
  'dsh-better-sidebar',
  'dsh-gitbash-shell',
]

/** 任何 profile 都必须先有的两个官方 bundle。 */
export const PROFILE_BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** 外壳使用的 dsh profile 名（src/host.ts 里 `--profile web`）。 */
export const SHELL_PROFILE_NAME = 'web'

/**
 * 把插件追加到 profile manifest 的 bundles 列表末尾（纯函数，便于单测）。
 * 已存在的条目保持原位置；不删除、不重排用户已有 bundle。
 * @param {Record<string, unknown>} manifest
 * @param {readonly string[]} pluginBundles
 * @returns {{ manifest: Record<string, unknown>, added: string[] }}
 */
export function mergePluginBundles(manifest, pluginBundles) {
  const dsh = (manifest.dsh ??= {})
  if (dsh === null || typeof dsh !== 'object' || Array.isArray(dsh)) {
    throw new Error('profile manifest 的 dsh 字段必须是 JSON 对象')
  }
  const profile = (dsh.profile ??= {})
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('profile manifest 的 dsh.profile 字段必须是 JSON 对象')
  }
  const current = Array.isArray(profile.bundles)
    ? profile.bundles.filter((item) => typeof item === 'string')
    : []
  const added = pluginBundles.filter((name) => !current.includes(name))
  if (added.length === 0) return { manifest, added }
  profile.bundles = [...current, ...added]
  return { manifest, added }
}

/** 一个插件是否真的随包带了（用它自己的 package.json 判断）。 */
export function pluginPackagePresent(name, root) {
  return existsSync(join(root, 'node_modules', name, 'package.json'))
}

/**
 * 启动前补齐 `<homeDir>/profiles/web/package.json` 的 bundles：
 * 官方基础 bundle + 随包插件。失败只返回 error，不抛（外壳启动不能被插件阻断）。
 * @param {{ homeDir: string, pluginsDir: string, pluginBundles?: readonly string[], baseBundles?: readonly string[] }} options
 */
export function installBundledPluginBundles(options) {
  const { homeDir, pluginsDir } = options
  const pluginBundles = options.pluginBundles ?? BUNDLED_DSH_PLUGINS
  const baseBundles = options.baseBundles ?? PROFILE_BASE_BUNDLES
  const profileDir = join(homeDir, 'profiles', SHELL_PROFILE_NAME)
  const manifestPath = join(profileDir, 'package.json')
  /** @type {{ profileDir: string, manifestPath: string, added: string[], missing: string[], changed: boolean, error?: string }} */
  const result = { profileDir, manifestPath, added: [], missing: [], changed: false }

  const present = pluginBundles.filter((name) => pluginPackagePresent(name, pluginsDir))
  result.missing.push(...pluginBundles.filter((name) => !present.includes(name)))

  try {
    /** @type {Record<string, unknown>} */
    let manifest = { name: `dsh-profile-${SHELL_PROFILE_NAME}`, private: true, dependencies: {} }
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('profile manifest 必须是 JSON 对象')
      }
      manifest = parsed
    }

    const { manifest: next, added } = mergePluginBundles(manifest, [...baseBundles, ...present])
    if (added.length === 0 && existsSync(manifestPath)) return result

    mkdirSync(profileDir, { recursive: true })
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return { ...result, added, changed: true }
  } catch (error) {
    return { ...result, error: error instanceof Error ? error.message : String(error) }
  }
}
