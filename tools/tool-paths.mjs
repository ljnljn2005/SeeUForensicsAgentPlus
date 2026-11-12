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
  { id: 'ida', label: 'IDA (idat)', kind: 'file', env: 'SEEU_TOOL_IDA', defaultPath: 'D:/Programs/IDA Professional 9.4/idat.exe' },
  { id: 'tshark', label: 'tshark', kind: 'file', env: 'SEEU_TOOL_TSHARK', defaultPath: WIRESHARK_DIR + '/tshark.exe' },
  { id: 'capinfos', label: 'capinfos', kind: 'file', env: 'SEEU_TOOL_CAPINFOS', defaultPath: WIRESHARK_DIR + '/capinfos.exe' },
  { id: 'editcap', label: 'editcap', kind: 'file', env: 'SEEU_TOOL_EDITCAP', defaultPath: WIRESHARK_DIR + '/editcap.exe' },
  { id: 'python', label: 'Python', kind: 'file', env: 'SEEU_TOOL_PYTHON', defaultPath: 'D:/Programming/Python31314/python.exe' },
  { id: 'jadx', label: 'jadx', kind: 'file', env: 'SEEU_TOOL_JADX', defaultPath: CTF + '/2-PhoneAnalysis/Android取证/jadx-1.1.0/bin/jadx.bat' },
  { id: 'apktool', label: 'apktool.jar', kind: 'file', env: 'SEEU_TOOL_APKTOOL', defaultPath: CTF + '/2-PhoneAnalysis/Android取证/Apktool/tool/apktool.jar' },
  { id: 'adb', label: 'adb', kind: 'file', env: 'SEEU_TOOL_ADB', defaultPath: CTF + '/2-PhoneAnalysis/Android取证/adb/bin/adb.exe' },
  { id: 'sevenzip', label: '7-Zip', kind: 'file', env: 'SEEU_TOOL_SEVENZIP', defaultPath: CTF + '/4-其他工具/【8】解压工具/7z/7z.exe' },
  { id: 'sqlite3', label: 'sqlite3', kind: 'file', env: 'SEEU_TOOL_SQLITE3', defaultPath: CTF + '/7-物联网取证/SQLite/sqlite3.exe' },
  {
    id: 'volatility',
    label: 'Volatility 目录',
    kind: 'dir',
    env: 'SEEU_TOOL_VOLATILITY',
    defaultPath: CTF + '/1-ComputerAnalysis/3-MemAnalysis',
    hint: 'lovelymem 不可用时的兜底；默认指向 Volatility 2.6 / Workbench 所在目录',
  },
]

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
    const configured = saved[spec.id]
    const path = configured || spec.defaultPath
    const state = pathState(path, spec.kind)
    return {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      env: spec.env,
      hint: spec.hint ?? '',
      defaultPath: spec.defaultPath,
      configured: Boolean(configured),
      source: configured ? 'config' : 'default',
      path,
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
    const path = saved[spec.id] || spec.defaultPath
    if (!path) continue
    const state = pathState(path, spec.kind)
    if (state.found) out[spec.env] = path
  }
  return out
}
