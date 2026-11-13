// 外部取证工具路径：默认值来自开发机实测，可在「设置 → 本地模型与工具路径 → 外部取证工具」里改。
// 会话里通过 SEEU_TOOL_<ID> 环境变量读取（外壳启动 dsh 时注入），没配置就用这里的默认值。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const GHIDRA_DIR = 'C:/Users/ASUS/.dsh/plugins/dsh-infinite-gen-5/third_party/sources/ghidra-12.1.4'
const CTF = 'E:/CTFTools/Forensics'
const WIRESHARK_DIR = CTF + '/4-其他工具/【15】网络分析/Wireshark'

/** @typedef {'file' | 'dir'} ToolPathKind */

/**
 * id 只用小写字母/数字，环境变量为 SEEU_TOOL_<大写 id>。
 * @type {ReadonlyArray<{id:string,label:string,kind:ToolPathKind,env:string,defaultPath:string,hint?:string}>}
 */
export const TOOL_PATH_SPECS = [
  {
    id: 'ghidra',
    label: 'Ghidra 12.1.4',
    kind: 'dir',
    env: 'SEEU_TOOL_GHIDRA',
    defaultPath: GHIDRA_DIR,
    hint: '安装/源码目录；批处理脚本在 Ghidra/RuntimeScripts/Windows/support/analyzeHeadless.bat',
  },
  { id: 'ida', label: 'IDA (idat)', kind: 'file', env: 'SEEU_TOOL_IDA', command: 'idat', defaultPath: 'D:/Programs/IDA Professional 9.4/idat.exe' },
  { id: 'tshark', label: 'tshark', kind: 'file', env: 'SEEU_TOOL_TSHARK', command: 'tshark', defaultPath: WIRESHARK_DIR + '/tshark.exe' },
  { id: 'capinfos', label: 'capinfos', kind: 'file', env: 'SEEU_TOOL_CAPINFOS', command: 'capinfos', defaultPath: WIRESHARK_DIR + '/capinfos.exe' },
  { id: 'editcap', label: 'editcap', kind: 'file', env: 'SEEU_TOOL_EDITCAP', command: 'editcap', defaultPath: WIRESHARK_DIR + '/editcap.exe' },
  { id: 'python', label: 'Python', kind: 'file', env: 'SEEU_TOOL_PYTHON', command: 'python', defaultPath: 'D:/Programming/Python31314/python.exe' },
  { id: 'jadx', label: 'jadx', kind: 'file', env: 'SEEU_TOOL_JADX', command: 'jadx', defaultPath: CTF + '/2-PhoneAnalysis/Android取证/jadx-1.1.0/bin/jadx.bat' },
  { id: 'apktool', label: 'apktool.jar', kind: 'file', env: 'SEEU_TOOL_APKTOOL', defaultPath: CTF + '/2-PhoneAnalysis/Android取证/Apktool/tool/apktool.jar' },
  { id: 'adb', label: 'adb', kind: 'file', env: 'SEEU_TOOL_ADB', command: 'adb', defaultPath: CTF + '/2-PhoneAnalysis/Android取证/adb/bin/adb.exe' },
  { id: 'sevenzip', label: '7-Zip', kind: 'file', env: 'SEEU_TOOL_SEVENZIP', command: '7z', defaultPath: CTF + '/4-其他工具/【8】解压工具/7z/7z.exe' },
  { id: 'sqlite3', label: 'sqlite3', kind: 'file', env: 'SEEU_TOOL_SQLITE3', command: 'sqlite3', defaultPath: CTF + '/7-物联网取证/SQLite/sqlite3.exe' },
  {
    id: 'starmem',
    label: 'StarMem（内存分析）',
    kind: 'file',
    env: 'SEEU_TOOL_STARMEM',
    command: 'starmem',
    defaultPath: CTF + '/1-ComputerAnalysis/3-MemAnalysis/Lovelymem/starmem-v0.2.2-windows-x64-upx/starmem.exe',
    hint: 'StarMem 0.2.2 高速内存取证引擎（lovelymem.v3 的后续替代）；用法 starmem.exe [--json] <命令> <镜像文件>',
  },
  {
    id: 'volatility',
    label: 'Volatility 目录',
    kind: 'dir',
    env: 'SEEU_TOOL_VOLATILITY',
    defaultPath: CTF + '/1-ComputerAnalysis/3-MemAnalysis',
    hint: 'StarMem / lovelymem 都不可用时的兜底；默认指向 Volatility 2.6 / Workbench 所在目录',
  },
  {
    id: 'ldplayer',
    label: '雷电模拟器（LDPlayer 目录）',
    kind: 'dir',
    env: 'SEEU_TOOL_LDPLAYER',
    defaultPath: 'D:/Games/leidian/LDPlayer14',
    hint: 'APK 动态分析用；目录内应有 ldconsole.exe / dnplayer.exe / adb.exe',
  },
  {
    id: 'vmware',
    label: 'VMware Workstation（目录）',
    kind: 'dir',
    env: 'SEEU_TOOL_VMWARE',
    defaultPath: 'D:/Programs/VMware',
    hint: 'EXE 动态分析用；目录内含 vmrun.exe / vmware.exe',
  },
]

/** PATH 里能直接跑的命令名（用于「优先环境变量 PATH」的解析）。 */
function fileExists(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * 在 PATH 环境变量里查找命令（Windows 按 PATHEXT 补全扩展名）。
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} 命中返回绝对路径，否则空串
 */
export function findOnPath(command, env = process.env) {
  if (!command) return ''
  const dirs = String(env.PATH || env.Path || env.path || '')
    .split(';')
    .map((dir) => dir.trim())
    .filter(Boolean)
  const exts = String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean)
  for (const dir of dirs) {
    const base = join(dir, command)
    if (fileExists(base)) return base
    for (const ext of exts) {
      if (fileExists(base + ext)) return base + ext
    }
  }
  return ''
}

/**
 * 单个工具的最终路径：设置里显式指定 → PATH 环境变量 → 默认实测路径。
 * @param {typeof TOOL_PATH_SPECS[number]} spec
 * @param {Record<string,string>} saved
 * @param {NodeJS.ProcessEnv} env
 */
function resolveToolPath(spec, saved, env) {
  const configured = saved[spec.id]
  if (configured) return { path: configured, source: 'config' }
  const onPath = spec.command ? findOnPath(spec.command, env) : ''
  if (onPath) return { path: onPath, source: 'path' }
  return { path: spec.defaultPath, source: 'default' }
}

/** @param {NodeJS.ProcessEnv} [env] */
function resolveHome(env = process.env) {
  return env.SEEU_DSH_HOME || env.DSH_HOME || join(homedir(), '.dsh')
}

/** @param {NodeJS.ProcessEnv} [env] */
export function toolPathsFile(env = process.env) {
  return resolve(env.SEEU_TOOL_PATHS_CONFIG || join(resolveHome(env), 'tool-paths.json'))
}

/** @param {NodeJS.ProcessEnv} [env] @returns {Record<string,string>} */
export function readToolPaths(env = process.env) {
  const file = toolPathsFile(env)
  if (!existsSync(file)) return {}
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim()
  if (!text) return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error('外部工具路径配置不是合法 JSON：' + file)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('外部工具路径配置必须是 JSON 对象：' + file)
  }
  const out = {}
  for (const spec of TOOL_PATH_SPECS) {
    const value = parsed[spec.id]
    if (typeof value === 'string' && value.trim()) out[spec.id] = value.trim()
  }
  return out
}

/** @param {string} p @param {ToolPathKind} kind */
function pathState(p, kind) {
  if (!p) return { exists: false, found: false }
  const abs = isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)
  if (!abs || !existsSync(p)) return { exists: false, found: false }
  try {
    const st = statSync(p)
    const okKind = kind === 'dir' ? st.isDirectory() : st.isFile()
    return { exists: true, found: okKind }
  } catch {
    return { exists: false, found: false }
  }
}

/**
 * 视图：每項给默认值/配置值、来源与存在性，供设置页渲染。
 * @param {NodeJS.ProcessEnv} [env]
 */
export function toolPathsView(env = process.env) {
  let saved = {}
  let error
  try {
    saved = readToolPaths(env)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  const tools = TOOL_PATH_SPECS.map((spec) => {
    const resolved = resolveToolPath(spec, saved, env)
    const state = pathState(resolved.path, spec.kind)
    return {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      env: spec.env,
      command: spec.command ?? '',
      hint: spec.hint ?? '',
      defaultPath: spec.defaultPath,
      configured: Boolean(saved[spec.id]),
      source: resolved.source,
      path: resolved.path,
      exists: state.exists,
      found: state.found,
    }
  })
  return { configFile: toolPathsFile(env), ...(error ? { error } : {}), tools }
}

/**
 * 保存：只处理传入的已知 id；空字符串表示清除（回到默认）；校验绝对路径与类型。
 * @param {Record<string, unknown>} input
 * @param {NodeJS.ProcessEnv} [env]
 */
export function saveToolPaths(input, env = process.env) {
  const file = toolPathsFile(env)
  let saved
  try {
    saved = readToolPaths(env)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const saved2 = { ...saved }
  for (const spec of TOOL_PATH_SPECS) {
    if (!Object.prototype.hasOwnProperty.call(input ?? {}, spec.id)) continue
    const raw = input[spec.id]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value) {
      delete saved2[spec.id]
      continue
    }
    const absolute = isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
    if (!absolute) return { ok: false, error: '外部工具路径必须是绝对路径：' + value }
    if (!existsSync(value)) return { ok: false, error: '路径不存在：' + value }
    const kindOk = spec.kind === 'dir' ? statSync(value).isDirectory() : statSync(value).isFile()
    if (!kindOk) {
      return { ok: false, error: spec.label + ' 需要选择' + (spec.kind === 'dir' ? '目录' : '文件') + '：' + value }
    }
    saved2[spec.id] = value
  }
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(saved2, null, 2) + '\n', 'utf8')
  } catch (error) {
    return { ok: false, error: '写入配置失败：' + (error instanceof Error ? error.message : String(error)) }
  }
  return { ok: true, configFile: file, ...toolPathsView(env), saved: Object.keys(saved2) }
}

/**
 * 注入 dsh 子进程的环境变量（只注入存在/可用的路径）。
 * @param {NodeJS.ProcessEnv} [env]
 */
export function toolPathsEnv(env = process.env) {
  const out = {}
  let saved = {}
  try {
    saved = readToolPaths(env)
  } catch {
    saved = {}
  }
  for (const spec of TOOL_PATH_SPECS) {
    const resolved = resolveToolPath(spec, saved, env)
    if (!resolved.path) continue
    const state = pathState(resolved.path, spec.kind)
    if (state.found) out[spec.env] = resolved.path
  }
  return out
}
