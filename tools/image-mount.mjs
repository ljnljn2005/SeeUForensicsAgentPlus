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

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const CASE_DIR_NAME = 'mount-case'
const DRIVE_LETTERS = 'XYZUVWTSRQ'

/** LovelyCarve CLI 的候选位置（只作兜底，优先用户在设置里指定的路径）。 */
const CLI_CANDIDATES = [
  'D:/Programs/LovelyCarve/lovelycarve-cli.exe',
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
  constructor({ cli, env = process.env, prefixArgs = [], startArgs = [], timeoutMs = 180_000, log = () => {} }) {
    this.cli = cli
    this.prefixArgs = prefixArgs
    this.startArgs = startArgs
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
    const args = [...this.prefixArgs, '-q', ...this.startArgs, 'shell']
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

  /** 只写命令、不等响应：`mounts delete` 在 CLI 1.3.0 里不返回 JSON。 */
  write(line) {
    this.start()
    if (this.exited !== undefined) return false
    try {
      this.child.stdin.write(`${line}
`)
      return true
    } catch {
      return false
    }
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
 * 把 LovelyCarve/系统的常见失败翻译成用户能照做的提示。
 * 返回 undefined 表示没有更具体的信息，前端直接显示原始错误。
 */
export function mountErrorHint(message) {
  const text = String(message ?? '')
  if (/Dokan|管理员|拒绝访问|access is denied|AccessDenied|elevat/i.test(text)) {
    return '挂载需要管理员权限与 Dokan 驱动：请以管理员身份重新启动 SeeU 后再试。'
  }
  if (/already contains a case|case.*lock|locked|已被.*打开|alreadyOpen/i.test(text)) {
    return '该案件已被 LovelyCarve 桌面端打开（案件锁）：请先关闭桌面端，或改用另一个查看器。'
  }
  if (/already open|isOpen|alreadyExists.*image|检材.*已打开/i.test(text)) {
    return '检材已经在当前会话里打开过：直接点「挂载为只读盘」或「刷新」即可。'
  }
  if (/ENOENT|does not exist|不存在|not found/i.test(text)) {
    return '镜像文件不存在或路径已变化：请重新选择镜像。'
  }
  if (/盘符.*占|already.*drive|in use/i.test(text)) {
    return '盘符已被占用：换一个盘符（如 Y:、Z:）再挂载。'
  }
  return undefined
}

/** 管理器：解析 CLI、按需拉起常驻 shell、维护挂载表并写入 mounts.json。
 * `env` 每次操作时读取，便于测试/环境变量在进程内变化。
 */
export function createMountManager({ env = () => process.env, log = () => {} } = {}) {
  let host
  let hostCaseDir
  let hostSourceCli
  let staleEnv
  /** 已经在本会话里 `images open` 过的检材；shell 里重复 open 会让 CLI 报错退出。 */
  const openedImages = new Set()

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

  /** CLI 可能是一个 .mjs 假实现：真实路径要用 node 跑（测试/自动化用）。 */
  function cliInvocation(cli, current) {
    if (/\.(mjs|cjs|js)$/i.test(cli)) {
      const node = current.SEEU_MOUNT_NODE
        || (process.execPath.toLowerCase().endsWith('electron.exe') ? 'node' : process.execPath)
      return { cli: node, prefixArgs: [cli] }
    }
    return { cli, prefixArgs: [] }
  }

  function runCliOnce(cli, prefixArgs, args, timeout = 120_000) {
    return spawnSync(cli, [...prefixArgs, '-q', ...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout,
      env: {
        ...currentEnv(),
        LOVELY_CARVE_AGENT: '1',
        LOVELYCARVE_AGENT: '1',
        NO_COLOR: '1',
      },
    })
  }

  /**
   * 准备案件目录：`--case` 只能作为启动参数，所以案件必须在拉起常驻 shell 之前
   * 就用一次性命令建好。已有 `case.db` 说明案件存在，直接复用。
   */
  function ensureCaseFolder(caseDir) {
    mkdirSync(caseDir, { recursive: true })
    const dbFile = join(caseDir, 'case.db')
    if (existsSync(dbFile)) {
      // 上次异常退出可能留下空的 case.lock；此时没有存活 shell，可以安全清掉。
      const lock = join(caseDir, 'case.lock')
      if (!(host && host.running) && existsSync(lock)) {
        try { unlinkSync(lock) } catch { /* 清不掉就让 CLI 自己报 */ }
      }
      return
    }
    const cli = cliOrThrow()
    const { cli: bin, prefixArgs } = cliInvocation(cli, currentEnv())
    const out = runCliOnce(bin, prefixArgs, ['cases', 'create', caseDir, '--name', 'SeeU 镜像挂载'])
    if (out.error) throw out.error
    const text = `${out.stdout ?? ''}
${out.stderr ?? ''}`
    if (out.status !== 0 && !/already contains|already exists|已存在/i.test(text)) {
      throw new Error(`创建 LovelyCarve 案件失败：${text.trim().slice(0, 400)}`)
    }
    if (!existsSync(dbFile)) {
      // 假 CLI（测试/e2e）只实现 JSONL 协议，不会真的落 case.db；真实 CLI 会。
      log(`mount: 案件目录没有 case.db（可能是假 CLI）：${caseDir}`)
    }
  }

  let cliVersionCache
  /** CLI 版本号（只取一次；失败返回 undefined，不影响主流程）。 */
  function cliVersionOf(cli) {
    if (!cli) return undefined
    if (!cliVersionCache) cliVersionCache = new Map()
    if (cliVersionCache.has(cli)) return cliVersionCache.get(cli)
    let version
    try {
      const lower = cli.toLowerCase()
      const isScript = lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js')
      const node = currentEnv().SEEU_MOUNT_NODE
        || (process.execPath.toLowerCase().endsWith('electron.exe') ? 'node' : process.execPath)
      const out = spawnSync(isScript ? node : cli, isScript ? [cli, '--version'] : ['--version'], {
        encoding: 'utf8',
        timeout: 20_000,
        windowsHide: true,
      })
      const match = String(out.stdout || '').match(/(\d+\.\d+\.\d+)/)
      if (match) version = match[1]
    } catch {
      version = undefined
    }
    cliVersionCache.set(cli, version)
    return version
  }

  function ensureHost(caseDir) {
    const cli = cliOrThrow()
    const wantCase = caseDir ? resolve(caseDir) : undefined
    if (host && (hostSourceCli !== cli || hostCaseDir !== wantCase)) {
      void host.stop()
      host = undefined
      openedImages.clear()
    }
    if (!host) {
      const current = currentEnv()
      const { cli: bin, prefixArgs } = cliInvocation(cli, current)
      // 关键：`--case` 只有在进程启动时传才有效；会话里再带会被 CLI 拒绝并退出。
      host = new LovelyCarveHost({
        cli: bin,
        prefixArgs,
        startArgs: wantCase ? ['--case', wantCase] : [],
        env: current,
        log,
      })
      hostCaseDir = wantCase
      hostSourceCli = cli
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
    const all = state.mounts.map((item) => ({
      ...item,
      exists: typeof item.mountPoint === 'string' ? existsSync(`${item.mountPoint}\\`) : false,
    }))
    // 进程退出时挂载会被系统释放；此时还留在清单里的记录属于上次异常退出，清掉。
    const live = host !== undefined && host.running
    const mounts = live ? all : all.filter((item) => item.exists)
    if (!live && mounts.length !== all.length) writeMountState(current, mounts)
    return {
      ok: true,
      cli: { path: resolved.path, source: resolved.source, version: cliVersionOf(resolved.path), error: resolved.path ? undefined : resolved.error },
      stateFile: mountsFile(current),
      caseDir: mountCaseDir(current),
      hostRunning: host !== undefined && host.running,
      defaultMountPoint: defaultMountPoint(current, mounts.map((item) => item.mountPoint)),
      mounts,
    }
  }

  async function inspect(imagePath) {
    const startedAt = Date.now()
    const path = String(imagePath ?? '').trim()
    if (!path) return { ok: false, error: '请先选择镜像文件', ms: 0 }
    if (!isAbsolute(path)) return { ok: false, error: `镜像路径必须是绝对路径：${path}`, ms: Date.now() - startedAt }
    if (!existsSync(path)) {
      const message = `镜像文件不存在：${path}`
      return { ok: false, error: message, ms: Date.now() - startedAt, hint: mountErrorHint(message) }
    }
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
        ms: Date.now() - startedAt,
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
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message, ms: Date.now() - startedAt, hint: mountErrorHint(message) }
    } finally {
      await host.stop()
    }
  }

  async function mount({ imagePath, partition = 0, mountPoint } = {}) {
    const startedAt = Date.now()
    const path = String(imagePath ?? '').trim()
    if (!path) return { ok: false, error: '请先选择镜像文件', ms: 0 }
    if (!isAbsolute(path)) return { ok: false, error: `镜像路径必须是绝对路径：${path}`, ms: Date.now() - startedAt }
    if (!existsSync(path)) {
      const message = `镜像文件不存在：${path}`
      return { ok: false, error: message, ms: Date.now() - startedAt, hint: mountErrorHint(message) }
    }
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
    try {
      ensureCaseFolder(caseDir)
      const runner = ensureHost(caseDir)
      if (!openedImages.has(path)) {
        await runner.send(`--image ${quote(path)} images open ${quote(path)}`)
        openedImages.add(path)
      }
      const created = await runner.send(`--image ${quote(path)} mounts create ${quote(`/part:${index}`)} --mount-point ${quote(point)}`)
      const listing = await runner.send(`--image ${quote(path)} mounts list`).catch(() => ({ result: null }))
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
      return { ok: true, mount: record, mounts, ms: Date.now() - startedAt }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message, ms: Date.now() - startedAt, hint: mountErrorHint(message) }
    }
  }

  async function unmount(id) {
    const startedAt = Date.now()
    const key = String(id ?? '').trim()
    if (!key) return { ok: false, error: '缺少挂载 ID' }
    const state = readMountState(currentEnv())
    const record = state.mounts.find((item) => String(item.id) === key)
    if (!record) return { ok: false, error: `没有找到挂载记录：${key}` }
    let released = false
    let fallback = false
    try {
      const point = typeof record.mountPoint === 'string'
        ? `${record.mountPoint.replace(/\\+$/, '')}\\`
        : ''
      const gone = () => !point || !existsSync(point)
      released = gone()
      if (!released && host && host.running) {
        // LovelyCarve 1.3.0 的 mounts delete --force 实际会卸载，但不回任何 JSON；
        // 所以这里只写命令、轮询盘符是否消失，必要时兜底停进程（进程退出 = 释放挂载）。
        host.write(`--image ${quote(record.imagePath)} mounts delete ${quote(key)} --force`)
        const deadline = Date.now() + 12_000
        while (Date.now() < deadline && !gone()) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 150))
        }
        released = gone()
        if (!released) {
          fallback = true
          await host.stop()
          host = undefined
          openedImages.clear()
          for (let i = 0; i < 10 && !released; i += 1) {
            await new Promise((resolveWait) => setTimeout(resolveWait, 300))
            released = gone()
          }
        }
      }
      const mounts = state.mounts.filter((item) => String(item.id) !== key)
      writeMountState(currentEnv(), mounts)
      return { ok: true, mounts, released, fallback, ms: Date.now() - startedAt }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function dispose() {
    if (host) {
      await host.stop()
      host = undefined
    }
    hostCaseDir = undefined
    hostSourceCli = undefined
    openedImages.clear()
  }

  /** 供测试观察：当前是否持有 CLI 进程。 */
  function debugHost() {
    return { running: host !== undefined && host.running, env: staleEnv }
  }

  return { status, inspect, mount, unmount, dispose, hostEnv, debugHost }
}
