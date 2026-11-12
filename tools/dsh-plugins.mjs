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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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


/** 插件包就位指纹（写在 profile 目录里，记录版本与已复制包名）。 */
export const PLUGIN_PACKAGES_MARKER = '.seeu-dsh-plugins.json'

/** 这些包由 dsh 安装目录自身提供（loader 会从安装目录解析），不需要复制进 profile。 */
function isInstallationDependency(name) {
  return name.startsWith('@deepseek-ai/')
}

/**
 * 递归复制目录（逐文件 read/write）。
 *
 * 为什么不用 `fs.cpSync`：打包后源目录在 `app.asar` 里，Electron 的 asar 补丁覆盖了
 * open/read/readdir，但 `copyFile` 走 native `copyfile`，从 asar 读会失败。逐文件复制
 * 在两个模式下都能工作（开发态是普通目录，打包态是 asar 虚拟目录）。
 * @param {string} source
 * @param {string} target
 */
export function copyDirectoryTree(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) {
      copyDirectoryTree(from, to)
    } else if (entry.isFile()) {
      writeFileSync(to, readFileSync(from))
    }
    // 符号链接/特殊文件跳过：插件包里不应出现，真出现也不影响运行。
  }
}

/**
 * 从 `fromDir` 向上逐级找 `node_modules/<name>`，返回真实包目录（找不到返回 undefined）。
 * @param {string} name
 * @param {string} fromDir
 */
export function resolveDependencyDir(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function manifestDependencyNames(manifest, field) {
  const source = manifest[field] ?? {}
  if (source === null || typeof source !== 'object') return []
  return Object.keys(source)
}

/**
 * 计算插件及其运行期依赖闭包（跳过 dsh 安装目录提供的 @deepseek-ai/*）。
 *
 * 分两轮：先收 `dependencies`（硬依赖，缺了插件大概率跑不起来），再收
 * `optionalDependencies`/`peerDependencies`（软依赖，缺了通常由宿主或插件自己兜底）。
 * 返回的 Map 是「包名 → 安装目录里的包路径」，顺序即发现顺序。
 * @param {readonly string[]} pluginNames
 * @param {string} pluginsDir
 * @returns {{ packages: Map<string, string>, missing: string[], optionalMissing: string[] }}
 */
export function collectPluginClosure(pluginNames, pluginsDir) {
  /** @type {Map<string, string>} */
  const packages = new Map()
  /** @type {string[]} */
  const missing = []
  /** @type {string[]} */
  const optionalMissing = []

  const visit = (name, soft) => {
    if (name === undefined || packages.has(name) || isInstallationDependency(name)) return
    const dir = resolveDependencyDir(name, join(pluginsDir, 'node_modules', name))
    if (dir === undefined) {
      const bucket = soft ? optionalMissing : missing
      if (!bucket.includes(name)) bucket.push(name)
      return
    }
    packages.set(name, dir)
  }

  /** 收硬依赖闭包；同时把发现到的包记下来，供第二轮扫软依赖。 */
  const hardQueue = [...pluginNames]
  while (hardQueue.length > 0) {
    const name = hardQueue.shift()
    if (name === undefined) continue
    const before = packages.size
    visit(name, false)
    if (packages.size === before) continue
    const dir = packages.get(name)
    if (dir === undefined) continue
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    hardQueue.push(...manifestDependencyNames(manifest, 'dependencies'))
  }

  /** 软依赖：只补包里已存在的，缺的记进 optionalMissing。 */
  for (const name of [...packages.keys()]) {
    const dir = packages.get(name)
    if (dir === undefined) continue
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    for (const field of ['peerDependencies', 'optionalDependencies']) {
      for (const dep of manifestDependencyNames(manifest, field)) {
        if (packages.has(dep)) continue
        if (isInstallationDependency(dep)) continue
        visit(dep, true)
      }
    }
  }
  return { packages, missing, optionalMissing }
}

/**
 * 把随包插件及其依赖闭包复制到 `<homeDir>/profiles/web/node_modules`。
 *
 * dsh 的 bundle 解析只负责定位 patch 文件；插件行（`name: billion-context` 等）在
 * profile 目录里用 ESM 导入，必须能在 `<profile>/node_modules` 找到真包，否则会
 * `ERR_MODULE_NOT_FOUND`、整批插件不激活（v0.3.2 的实际故障）。
 *
 * 用指纹文件避免每次启动重复复制；版本变化时重抄。失败只返回 error，不抛。
 * @param {{ homeDir: string, pluginsDir: string, pluginNames?: readonly string[], version?: string }} options
 * @returns {{ profileDir: string, targetRoot: string, markerPath: string, packages: string[], copied: number, removed: string[], changed: boolean, missing: string[], optionalMissing: string[], error?: string }}
 */
export function ensurePluginPackages(options) {
  const { homeDir, pluginsDir } = options
  const pluginNames = options.pluginNames ?? BUNDLED_DSH_PLUGINS
  const version = options.version ?? ''
  const profileDir = join(homeDir, 'profiles', SHELL_PROFILE_NAME)
  const targetRoot = join(profileDir, 'node_modules')
  const markerPath = join(profileDir, PLUGIN_PACKAGES_MARKER)
  /** @type {{ profileDir: string, targetRoot: string, markerPath: string, packages: string[], copied: number, removed: string[], changed: boolean, missing: string[], optionalMissing: string[], error?: string }} */
  const result = {
    profileDir,
    targetRoot,
    markerPath,
    packages: [],
    copied: 0,
    removed: [],
    changed: false,
    missing: [],
    optionalMissing: [],
  }

  try {
    const present = pluginNames.filter((name) => pluginPackagePresent(name, pluginsDir))
    const { packages, missing, optionalMissing } = collectPluginClosure(present, pluginsDir)
    result.packages = [...packages.keys()]
    result.missing = missing
    result.optionalMissing = optionalMissing

    /** @type {string[]} */
    let previous = []
    /** @type {string} */
    let previousVersion = ''
    if (existsSync(markerPath)) {
      try {
        const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
        if (Array.isArray(marker?.packages)) previous = marker.packages.filter((item) => typeof item === 'string')
        if (typeof marker?.version === 'string') previousVersion = marker.version
      } catch {
        /* 坏指纹当作没有，重新抄一遍即可 */
      }
    }

    const allPresent = result.packages.every((name) => existsSync(join(targetRoot, name, 'package.json')))
    if (allPresent && result.packages.length > 0 && previousVersion === version) {
      return result
    }

    mkdirSync(targetRoot, { recursive: true })
    for (const name of previous) {
      if (result.packages.includes(name)) continue
      rmSync(join(targetRoot, name), { recursive: true, force: true })
      result.removed.push(name)
    }
    for (const [name, source] of packages) {
      const target = join(targetRoot, name)
      rmSync(target, { recursive: true, force: true })
      copyDirectoryTree(source, target)
      result.copied += 1
    }
    writeFileSync(
      markerPath,
      `${JSON.stringify({ version, packages: result.packages, updatedAt: new Date().toISOString() }, null, 2)}
`,
      'utf8',
    )
    return { ...result, changed: true }
  } catch (error) {
    return { ...result, error: error instanceof Error ? error.message : String(error) }
  }
}
