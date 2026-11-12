/**
 * 镜像挂载接口（只读）。
 *
 * 为什么放在这里：取证镜像（E01/RAW/VMDK/VHDX/QCOW2…）本身不是 Windows 能直接
 * 浏览的文件系统，技能与工具要「按路径看文件」就得先挂成一个盘符。LovelyCarve
 * CLI 自带 `mounts` 命令组（Windows + Dokan），但**挂载点只在进程存活期间有效**，
 * 所以外壳必须自己持有一个常驻的 CLI 进程（`lovelycarve-cli -q shell`），把
 * `mounts create / mounts delete` 都发给同一个进程。
 *
 * 对外只暴露一个 MountManager：
 *   - status()  当前 CLI、挂载列表、状态文件位置
 *   - inspect(imagePath)  预览镜像（分区表）
 *   - mount({imagePath, partition, mountPoint})  挂载为只读盘
 *   - unmount(id)  卸载
 *   - dispose()  关外壳时收尾
 *
 * 挂载列表同时写入 `<DSH_HOME>/mounts.json`（`SEEU_MOUNTS_FILE` 可覆盖），
 * 环境变量 `SEEU_MOUNTS_FILE` 随 dsh 子进程下发，会话里的技能可以直接读到
 * 「现在有哪些盘挂着」而不必自己猜盘符。
 *
 * 测试友好：`SEEU_LOVELYCARVE_CLI` 可以指向一个 .mjs 假 CLI（用 node 执行），
 * e2e/单测因此不需要真的装 LovelyCarve 或 Dokan。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const CASE_DIR_NAME = 'mount-case'
const DRIVE_LETTERS = 'XYZUVWTSRQ'

/** LovelyCarve CLI 的候选位置（只作兜底，优先用户在设置里指定的路径）。 */
const CLI_CANDIDATES = [
  'E:/LovelyCarve/cli/lovelycarve-cli.exe',
  'C:/LovelyCarve/cli/lovelycarve-cli.exe',
  'C:/Program Files/LovelyCarve/lovelycarve-cli.exe',
  'C:/Program Files/LovelyCarve/cli/lovelycarve-cli.exe',
]

function dshHome(env) {
  return resolve(env.SEEU_DSH_HOME || env.DSH_HOME || join(homedir(), '.dsh'))
}

/** 挂载清单文件（dsh 子进程通过 SEEU_MOUNTS_FILE 读同一份）。 */
export function mountsFile(env = process.env) {
  return resolve(env.SEEU_MOUNTS_FILE || join(dshHome(env), 'mounts.json'))
}

/** 挂载用的 LovelyCarve 案件目录（CLI 需要 --case 才能挂载）。 */
export function mountCaseDir(env = process.env) {
  return resolve(env.SEEU_MOUNT_CASE_DIR || join(dshHome(env), CASE_DIR_NAME))
}

/**
 * 找到可用的 LovelyCarve CLI。顺序：
 *   1. `SEEU_LOVELYCARVE_CLI`（测试/调试）
 *   2. 设置窗口保存的 `lovely-cli.json` 的 `lovelycarve` 键
 *   3. 常见安装位置
 */
export function resolveLovelyCarveCli(env = process.env) {
  const fromEnv = typeof env.SEEU_LOVELYCARVE_CLI === 'string' ? env.SEEU_LOVELYCARVE_CLI.trim() : ''
  if (fromEnv) {
    if (!isAbsolute(fromEnv)) return { path: null, source: 'env', error: `SEEU_LOVELYCARVE_CLI 不是绝对路径：${fromEnv}` }
    if (!existsSync(fromEnv)) return { path: null, source: 'env', error: `SEEU_LOVELYCARVE_CLI 指向的文件不存在：${fromEnv}` }
    return { path: fromEnv, source: 'env' }
  }
  let configured = ''
  try {
    const configFile = resolve(join(dshHome(env), 'lovely-cli.json'))
    if (existsSync(configFile)) {
      const text = readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')
      if (text.trim()) {
        const config = JSON.parse(text)
        if (config && typeof config === 'object' && !Array.isArray(config) && typeof config.lovelycarve === 'string') {
          configured = config.lovelycarve
        }
      }
    }
  } catch {
    // 配置文件坏掉不阻塞启动：继续按默认位置找。
  }
  if (configured) {
    if (!isAbsolute(configured) || !existsSync(configured)) {
      return { path: null, source: 'config', error: `配置的 LovelyCarve CLI 路径不存在：${configured}，请在设置窗口重新选择。` }
    }
    return { path: configured, source: 'config' }
  }
  for (const candidate of CLI_CANDIDATES) {
    if (existsSync(candidate)) return { path: candidate, source: 'auto' }
  }
  return {
    path: null,
    source: 'unset',
    error: '未配置 LovelyCarve CLI：打开外壳「设置 → 本机取证工具路径」选择 lovelycarve-cli.exe（它随 LovelyCarve 安装包提供，不是 GUI 的 LovelyCarve.exe）。',
  }
}

/** 选一个没被占用的盘符（优先 X:，避免动 C:/D: 这些常见盘）。 */
export function defaultMountPoint(env = process.env, taken = []) {
  const used = new Set(taken.map((item) => String(item).toUpperCase()))
  for (const letter of DRIVE_LETTERS) {
    const point = `${letter}:`
    if (used.has(point.toUpperCase())) continue
    if (process.platform !== 'win32' || !existsSync(`${letter}:\\`)) return point
  }
  return 'X:'
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

/** 把一行的 JSON 响应解析成 { result, warning }；带 error 时抛错。 */
function parseResponse(obj) {
  if (!obj || typeof obj !== 'object') return { result: obj }
  if (obj.error) {
    const error = new Error(String(obj.error.message ?? obj.error.code ?? 'LovelyCarve 命令失败'))
    error.code = obj.error.code
    error.details = obj.error.details
    throw error
  }
  if ('result' in obj || 'warning' in obj) return { result: obj.result ?? null, warning: obj.warning }
  return { result: obj }
}

/**
 * 常驻 CLI 进程。`lovelycarve-cli -q shell` 从 stdin 读命令、stdout 每行一个 JSON。
 * 只有同一进程里创建的挂载点才能被后续命令看到，所以管理器全局共用一个实例。
 */
export class LovelyCarveHost {
  constructor({ cli, env = process.env, prefixArgs = [], timeoutMs = 180_000, log = () => {} }) {
    this.cli = cli
    this.prefixArgs = prefixArgs
    this.env = env
    this.timeoutMs = timeoutMs
    this.log = log
    this.child = undefined
    this.waiters = []
    this.stderrTail = ''
    this.exited = undefined
  }

  get running() {
    return this.child !== undefined && this.exited === undefined
  }

  start() {
    if (this.child) return
    const args = [...this.prefixArgs, '-q', 'shell']
    const options = {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...this.env,
        // 机器可读输出：紧凑 JSON、无进度行、无颜色。
        LOVELY_CARVE_AGENT: '1',
        LOVELYCARVE_AGENT: '1',
        NO_COLOR: '1',
      },
    }
    this.log(`mount: start ${this.cli} ${args.join(' ')}`)
    this.child = spawn(this.cli, args, options)
    this.exited = undefined
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    let buffer = ''
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) this.#onLine(line)
      }
    })
    this.child.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4000)
    })
    this.child.on('error', (error) => {
      this.log(`mount: spawn failed: ${String(error)}`)
      this.#shutdown(`LovelyCarve CLI 启动失败：${error instanceof Error ? error.message : String(error)}`)
    })
    this.child.on('exit', (code, signal) => {
      if (this.exited !== undefined) return
      this.#shutdown(`LovelyCarve CLI 已退出（code=${String(code)}, signal=${String(signal)}）${this.stderrTail.trim() ? `\n${this.stderrTail.trim().slice(-800)}` : ''}`)
    })
  }

  #onLine(line) {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      // 非 JSON 行（进度/人类输出）直接忽略，继续等真正的响应。
      this.log(`mount: 忽略非 JSON 输出 ${line.slice(0, 200)}`)
      return
    }
    const waiter = this.waiters.shift()
    if (!waiter) {
      this.log(`mount: 无对应请求的响应 ${line.slice(0, 200)}`)
      return
    }
    clearTimeout(waiter.timer)
    try {
      waiter.resolve(parseResponse(parsed))
    } catch (error) {
      waiter.reject(error)
    }
  }

  #shutdown(message) {
    this.exited = message
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(message))
    }
  }

  send(line) {
    this.start()
    if (this.exited !== undefined) return Promise.reject(new Error(this.exited))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new Error(`LovelyCarve 命令超时（${Math.round(this.timeoutMs / 1000)}s）：${line}`))
      }, this.timeoutMs)
      const waiter = {
        timer,
        resolve: (value) => resolve(value),
        reject: (error) => reject(error),
      }
      this.waiters.push(waiter)
      this.child.stdin.write(`${line}\n`)
    })
  }

  async stop() {
    if (!this.child) return
    const child = this.child
    this.child = undefined
    this.#shutdown('LovelyCarve CLI 已停止')
    try {
      child.stdin.end()
    } catch {
      // stdin 可能已关闭。
    }
    try {
      child.kill()
    } catch {
      // 进程可能已退出。
    }
  }
}

function readMountState(env) {
  const file = mountsFile(env)
  if (!existsSync(file)) return { mounts: [] }
  try {
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (!text.trim()) return { mounts: [] }
    const value = JSON.parse(text)
    const mounts = Array.isArray(value?.mounts) ? value.mounts : []
    return { mounts: mounts.filter((item) => item && typeof item === 'object') }
  } catch {
    return { mounts: [] }
  }
}

function writeMountState(env, mounts, extra = {}) {
  const file = mountsFile(env)
  mkdirSync(dirname(file), { recursive: true })
  const payload = {
    updatedAt: new Date().toISOString(),
    note: '只读镜像挂载点；仅在 SeeU 外壳运行期间有效，关闭外壳即释放。',
    ...extra,
    mounts,
  }
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  return file
}

function extractMounts(result) {
  if (!result || typeof result !== 'object') return []
  if (Array.isArray(result.mounts)) return result.mounts
  if (Array.isArray(result.items)) return result.items
  return []
}

function pickMountId(result, mountPoint) {
  if (result && typeof result === 'object') {
    if (typeof result.id === 'string' || typeof result.id === 'number') return String(result.id)
    if (typeof result.mountId === 'string' || typeof result.mountId === 'number') return String(result.mountId)
    const mounts = extractMounts(result)
    const match = mounts.find((item) => String(item?.mountPoint ?? item?.point ?? '').toUpperCase().startsWith(String(mountPoint).toUpperCase()))
    if (match && (match.id !== undefined || match.mountId !== undefined)) return String(match.id ?? match.mountId)
  }
  return `mount-${Date.now()}`
}

/**
 * 管理器：解析 CLI、按需拉起常驻 shell、维护挂载表并写入 mounts.json。
 * `env` 每次操作时读取，便于测试/环境变量在进程内变化。
 */
export function createMountManager({ env = () => process.env, log = () => {} } = {}) {
  let host
  let staleEnv

  function currentEnv() {
    return env()
  }

  function cliOrThrow() {
    const resolved = resolveLovelyCarveCli(currentEnv())
    if (!resolved.path) {
      const error = new Error(resolved.error ?? '未配置 LovelyCarve CLI')
      error.code = 'CLI_NOT_CONFIGURED'
      throw error
    }
    return resolved.path
  }

  function ensureHost() {
    const cli = cliOrThrow()
    if (host && host.cli !== cli) {
      void host.stop()
      host = undefined
    }
    if (!host) {
      const current = currentEnv()
      const fakePrefix = []
      // 测试/自动化：指向 .mjs 的「假 CLI」用 node 跑，避免依赖真实安装。
      if (/\.(mjs|cjs|js)$/i.test(cli)) {
        const node = current.SEEU_MOUNT_NODE
          || (process.execPath.toLowerCase().endsWith('electron.exe') ? 'node' : process.execPath)
        host = new LovelyCarveHost({ cli: node, prefixArgs: [cli], env: current, log })
      } else {
        host = new LovelyCarveHost({ cli, prefixArgs: fakePrefix, env: current, log })
      }
      host.start()
    }
    staleEnv = currentEnv()
    return host
  }

  function hostEnv() {
    return { SEEU_MOUNTS_FILE: mountsFile(currentEnv()) }
  }

  async function status() {
    const current = currentEnv()
    const resolved = resolveLovelyCarveCli(current)
    const state = readMountState(current)
    const mounts = state.mounts.map((item) => ({
      ...item,
      exists: typeof item.mountPoint === 'string' ? existsSync(`${item.mountPoint}\\`) : false,
    }))
    return {
      ok: true,
      cli: { path: resolved.path, source: resolved.source, error: resolved.path ? undefined : resolved.error },
      stateFile: mountsFile(current),
      caseDir: mountCaseDir(current),
      hostRunning: host !== undefined && host.running,
      defaultMountPoint: defaultMountPoint(current, mounts.map((item) => item.mountPoint)),
      mounts,
    }
  }

  async function inspect(imagePath) {
    const path = String(imagePath ?? '').trim()
    if (!path) return { ok: false, error: '请先选择镜像文件' }
    if (!isAbsolute(path)) return { ok: false, error: `镜像路径必须是绝对路径：${path}` }
    if (!existsSync(path)) return { ok: false, error: `镜像文件不存在：${path}` }
    const cli = cliOrThrow()
    const sizeBytes = (() => {
      try {
        return statSync(path).size
      } catch {
        return undefined
      }
    })()
    // 一次性命令即可（不需要进程内的挂载状态）。
    const host = new LovelyCarveHost({ cli: /\.(mjs|cjs|js)$/i.test(cli)
      ? (currentEnv().SEEU_MOUNT_NODE || (process.execPath.toLowerCase().endsWith('electron.exe') ? 'node' : process.execPath))
      : cli, prefixArgs: /\.(mjs|cjs|js)$/i.test(cli) ? [cli] : [], env: currentEnv(), timeoutMs: 120_000, log })
    try {
      const { result } = await host.send(`--image ${quote(path)} images get`)
      const image = result && typeof result === 'object' ? (result.image ?? result) : {}
      const partitions = Array.isArray(image.partitions) ? image.partitions : Array.isArray(result?.partitions) ? result.partitions : []
      return {
        ok: true,
        image: {
          path,
          name: basename(path),
          sizeBytes: Number(image.sizeBytes ?? image.size_bytes ?? sizeBytes) || sizeBytes,
          format: image.format ?? image.imageFormat ?? undefined,
          partitions: partitions.map((item, index) => ({
            index: Number(item.index ?? item.partitionId ?? index),
            label: item.label ?? item.name ?? item.volumeLabel ?? undefined,
            fileSystem: item.fileSystem ?? item.fs ?? item.type ?? undefined,
            sizeBytes: Number(item.sizeBytes ?? item.size_bytes ?? 0) || undefined,
            offsetBytes: Number(item.offsetBytes ?? item.offset_bytes ?? 0) || undefined,
          })),
        },
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      await host.stop()
    }
  }

  async function mount({ imagePath, partition = 0, mountPoint } = {}) {
    const path = String(imagePath ?? '').trim()
    if (!path) return { ok: false, error: '请先选择镜像文件' }
    if (!isAbsolute(path)) return { ok: false, error: `镜像路径必须是绝对路径：${path}` }
    if (!existsSync(path)) return { ok: false, error: `镜像文件不存在：${path}` }
    const index = Number(partition)
    if (!Number.isInteger(index) || index < 0) return { ok: false, error: `分区序号不合法：${String(partition)}` }
    const state = readMountState(currentEnv())
    const taken = state.mounts.map((item) => item.mountPoint)
    const point = (() => {
      const raw = String(mountPoint ?? '').trim().toUpperCase()
      if (!raw) return defaultMountPoint(currentEnv(), taken)
      const normalized = raw.endsWith(':') ? raw : `${raw}:`
      if (!/^[A-Z]:$/.test(normalized)) throw new Error(`挂载点必须是盘符（如 X:），收到：${raw}`)
      if (taken.some((item) => String(item).toUpperCase() === normalized)) throw new Error(`盘符 ${normalized} 已被本工具占用`)
      return normalized
    })()
    if (process.platform === 'win32' && existsSync(`${point}\\`)) {
      return { ok: false, error: `盘符 ${point} 已被系统占用，请换一个（如 X: 或 Y:）` }
    }
    const caseDir = mountCaseDir(currentEnv())
    mkdirSync(caseDir, { recursive: true })
    const runner = ensureHost()
    try {
      await runner.send(`cases create ${quote(caseDir)} --name ${quote('SeeU 镜像挂载')}`).catch((error) => {
        const message = String(error instanceof Error ? error.message : error)
        if (!/alreadyExists|already exists|已存在/i.test(message)) throw error
      })
      await runner.send(`--case ${quote(caseDir)} --image ${quote(path)} images open ${quote(path)}`).catch((error) => {
        const message = String(error instanceof Error ? error.message : error)
        if (!/alreadyExists|already exists|已存在|isOpen|opened/i.test(message)) throw error
      })
      const created = await runner.send(`--case ${quote(caseDir)} --image ${quote(path)} mounts create ${quote(`/part:${index}`)} --mount-point ${quote(point)}`)
      const listing = await runner.send(`--case ${quote(caseDir)} --image ${quote(path)} mounts list`).catch(() => ({ result: null }))
      const id = pickMountId(created.result ?? listing.result, point)
      const record = {
        id,
        imagePath: path,
        imageName: basename(path),
        partition: index,
        mountPoint: point,
        mountedAt: new Date().toISOString(),
        caseDir,
      }
      const mounts = state.mounts.filter((item) => String(item.mountPoint).toUpperCase() !== point).concat(record)
      writeMountState(currentEnv(), mounts)
      return { ok: true, mount: record, mounts }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function unmount(id) {
    const key = String(id ?? '').trim()
    if (!key) return { ok: false, error: '缺少挂载 ID' }
    const state = readMountState(currentEnv())
    const record = state.mounts.find((item) => String(item.id) === key)
    if (!record) return { ok: false, error: `没有找到挂载记录：${key}` }
    try {
      if (host && host.running) {
        await host.send(`--case ${quote(record.caseDir ?? mountCaseDir(currentEnv()))} --image ${quote(record.imagePath)} mounts delete ${quote(key)} --force`)
      }
      const mounts = state.mounts.filter((item) => String(item.id) !== key)
      writeMountState(currentEnv(), mounts)
      return { ok: true, mounts }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function dispose() {
    if (host) {
      await host.stop()
      host = undefined
    }
  }

  /** 供测试观察：当前是否持有 CLI 进程。 */
  function debugHost() {
    return { running: host !== undefined && host.running, env: staleEnv }
  }

  return { status, inspect, mount, unmount, dispose, hostEnv, debugHost }
}
