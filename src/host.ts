/**
 * dsh Host 子进程生命周期管理。
 *
 * 设计对标官方 desktop 的 `host-process.ts`（Electron Node 模式 + `--expose-internals`
 * + 通过 IPC 收 ready URL），但本工程复用公开 npm 运行时，因此：
 *   - 入口是 `@deepseek-ai/dsh/lib/bin.js`（launcher），命令 `web --no-open --port 0`；
 *   - 就绪信号取自 stdout 的 `dsh web: <url>` 行（含一次性 auth token）；
 *   - 配置文件通过 `--patch <overlay.yml>` 叠加在官方 web profile 之上。
 *
 * 所有 stdout/stderr 都会写入日志文件，供错误页与排障使用。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshCliEntry, dshHome, forensicsPatchPath, hostLogFile, workspaceDir } from './paths.js'
import { DESKTOP_MARKER_ENV, PRODUCT_NAME } from './brand.js'

/** 首次启动可能需要初始化 profile，给足预算；超时视为启动失败。 */
const READY_TIMEOUT_MS = 180_000
const STDERR_TAIL_CHARS = 64 * 1024
const STOP_GRACE_MS = 5_000

const READY_LINE = /^dsh web:\s+(https?:\/\/\S+)\s*$/
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g

/**
 * dsh 的 `node-addon-require-builtin` 只认若干 Electron 版本的 V8 指纹；如果打包/开发用
 * 的 Electron 恰好在支持列表之外，Electron Node 模式会直接拒绝启动。识别出这个特征后
 * 回退到系统 Node（存在时），比让用户面对一屏指纹诊断友好。
 */
const UNSUPPORTED_ELECTRON_RUNTIME = /unsupported Electron runtime fingerprint/i

export interface HostOptions {
  /** 运行 dsh 的 Node 可执行文件；默认当前 Electron 二进制（Node 模式）。 */
  readonly nodeBinary?: string
  /** Electron Node 模式不被运行时支持时回退用的 Node；默认 env SEEU_NODE_BINARY 或 PATH 上的 node。 */
  readonly fallbackNodeBinary?: string
  readonly runtimeEntry?: string
  readonly homeDir?: string
  readonly workspace?: string
  readonly patchPath?: string
  readonly logFile?: string
  /** 额外环境变量（测试/排障用）。 */
  readonly env?: NodeJS.ProcessEnv
}

export interface HostFatal {
  readonly message: string
  readonly diagnostic?: string
}

export type HostState =
  | { readonly phase: 'starting' }
  | { readonly phase: 'ready'; readonly url: string; readonly origin: string }
  | { readonly phase: 'error'; readonly message: string; readonly diagnostic?: string }
  | { readonly phase: 'stopped' }

export class DshHost extends EventEmitter {
  private child: ChildProcess | undefined
  private logStream: import('node:fs').WriteStream | undefined
  private stderrTail = ''
  private readyUrl: string | undefined
  private stopping = false
  private startedAt = 0
  private readonly nodeBinary: string
  private readonly fallbackNodeBinary: string
  private readonly runtimeEntry: string
  private readonly homeDir: string
  private readonly workspace: string
  private readonly patchPath: string | undefined
  private readonly logFile: string
  private readonly extraEnv: NodeJS.ProcessEnv

  constructor(options: HostOptions = {}) {
    super()
    // process.execPath 在开发态是 electron.exe；ELECTRON_RUN_AS_NODE=1 时它以 Node 运行。
    this.nodeBinary = options.nodeBinary ?? process.execPath
    this.fallbackNodeBinary = options.fallbackNodeBinary ?? process.env.SEEU_NODE_BINARY ?? 'node'
    this.runtimeEntry = options.runtimeEntry ?? dshCliEntry()
    this.homeDir = options.homeDir ?? dshHome()
    this.workspace = options.workspace ?? workspaceDir()
    this.patchPath = options.patchPath ?? forensicsPatchPath()
    this.logFile = options.logFile ?? hostLogFile()
    this.extraEnv = options.env ?? {}
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  get url(): string | undefined {
    return this.readyUrl
  }

  /** 启动子进程并等待就绪 URL；Electron 指纹不被支持时自动回退系统 Node。 */
  async start(): Promise<string> {
    if (this.child !== undefined) throw new Error('dsh host 已在运行')
    try {
      return await this.attempt(this.nodeBinary)
    } catch (error) {
      const diagnostic = (error as { diagnostic?: string }).diagnostic ?? ''
      if (!UNSUPPORTED_ELECTRON_RUNTIME.test(diagnostic)) throw error
      this.appendShellLog(
        `electron node mode unsupported by dsh runtime; falling back to "${this.fallbackNodeBinary}"`,
      )
      return await this.attempt(this.fallbackNodeBinary)
    }
  }

  private appendShellLog(message: string): void {
    try {
      mkdirSync(dirname(this.logFile), { recursive: true })
      appendFileSync(this.logFile, `[${new Date().toISOString()}] [shell] ${message}\n`, 'utf8')
    } catch {
      // 日志失败不影响启动流程
    }
  }

  private async attempt(nodeBinary: string): Promise<string> {
    this.stopping = false
    this.readyUrl = undefined
    this.stderrTail = ''
    this.startedAt = Date.now()

    mkdirSync(dirname(this.logFile), { recursive: true })
    mkdirSync(this.homeDir, { recursive: true })
    mkdirSync(this.workspace, { recursive: true })
    const log = createWriteStream(this.logFile, { flags: 'a' })
    const writeLog = (channel: string, text: string): void => {
      try { log.write(`[${new Date().toISOString()}] [${channel}] ${text}\n`) } catch { /* 日志不可用 */ }
    }
    this.logStream = log

    // 参数顺序（实测约束，`dsh/lib/bin.js`）：
    //   - `dsh web ...` 只有在 argv[0] 不以 '-' 开头时才会被展开成 `--profile web`；
    //   - 因此要带 launcher 选项（--patch）就必须显式写 `--profile web`，
    //     否则会报 `error: --profile <name> is required`；
    //   - 其后的 --host/--port/--no-open 作为未知选项透传给 web app。
    const args = [
      '--expose-internals',
      this.runtimeEntry,
      ...(this.patchPath !== undefined && existsSync(this.patchPath) ? ['--patch', this.patchPath] : []),
      '--profile',
      'web',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ]

    writeLog(
      'shell',
      `spawn dsh host: ${nodeBinary} ${args.join(' ')} cwd=${this.workspace} home=${this.homeDir}`,
    )

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.extraEnv,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: this.homeDir,
      [DESKTOP_MARKER_ENV]: '1',
      DSH_CLIENT_VERSION: PRODUCT_NAME,
      // 案件索引插件扫描"已建库案件"的默认目录（Web UI 里可再手工输入）。
      SEEU_INDEX_SEARCH_DIRS: [this.workspace, join(this.homeDir, 'indexes')].join(';'),
      // 桌面版不接收远端访问；CLI 已绑定 loopback，这里再收敛一次。
      NO_COLOR: '1',
    }
    // 避免父进程的 Node 选项干扰子进程（例如 Electron 注入的 --inspect）。
    delete env.NODE_OPTIONS
    delete env.ELECTRON_INSPECT

    this.emit('state', { phase: 'starting' } satisfies HostState)
    const child = spawn(nodeBinary, args, {
      cwd: this.workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child

    let stdoutBuffer = ''

    const ready = new Promise<string>((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }
      const timer = setTimeout(() => {
        finish(() => reject(new Error(`dsh host 在 ${String(READY_TIMEOUT_MS / 1000)}s 内未就绪`)))
      }, READY_TIMEOUT_MS)
      timer.unref()

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdoutBuffer += chunk
        const parts = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = parts.pop() ?? ''
        for (const raw of parts) {
          const line = raw.replace(ANSI, '').trimEnd()
          if (line === '') continue
          writeLog('stdout', line)
          this.emit('stdout', line)
          const match = READY_LINE.exec(line)
          if (match?.[1] !== undefined) {
            this.readyUrl = match[1]
            finish(() => resolve(match[1]!))
          }
        }
      })

      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        const text = chunk.replace(ANSI, '')
        writeLog('stderr', text.trimEnd())
        this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_CHARS)
        this.emit('stderr', text)
      })

      child.once('error', (error) => {
        writeLog('shell', `spawn error: ${error.message}`)
        finish(() => reject(new Error(`无法启动 dsh 运行时：${error.message}`)))
      })

      child.once('exit', (code, signal) => {
        writeLog('shell', `dsh host exited code=${String(code)} signal=${String(signal)}`)
        this.emit('exit', { code, signal })
        finish(() => reject(Object.assign(new Error('dsh host 在就绪前退出'), {
          diagnostic: this.stderrTail || `exit code=${String(code)} signal=${String(signal)}`,
        })))
      })
    })

    try {
      const url = await ready
      this.emit('state', { phase: 'ready', url, origin: new URL(url).origin } satisfies HostState)
      return url
    } catch (error) {
      const err = error as Error & { diagnostic?: string }
      writeLog('shell', `host start failed: ${err.message}${err.diagnostic === undefined ? '' : `\n${err.diagnostic}`}`)
      this.emit('state', {
        phase: 'error',
        message: err.message,
        ...(err.diagnostic === undefined ? {} : { diagnostic: err.diagnostic }),
      } satisfies HostState)
      void this.stop()
      throw error
    }
  }

  /** 停止子进程（Windows 上先 terminate，再强杀兜底）。 */
  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    const closeLog = (): void => {
      try { this.logStream?.end() } catch { /* 忽略 */ }
      this.logStream = undefined
    }
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
      closeLog()
      return
    }
    this.stopping = true
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => { resolve() })
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* 进程可能已退出 */ }
        resolve()
      }, STOP_GRACE_MS)
      timer.unref()
    })
    try {
      // Windows 无 POSIX 信号语义：kill() 即 TerminateProcess。
      child.kill('SIGTERM')
    } catch {
      /* 忽略 */
    }
    await exited
    closeLog()
    this.readyUrl = undefined
    this.emit('state', { phase: 'stopped' } satisfies HostState)
  }

  get uptimeMs(): number {
    return this.startedAt === 0 ? 0 : Date.now() - this.startedAt
  }

  get stoppingFlag(): boolean {
    return this.stopping
  }

  /** 最近一次 stderr（错误页展示用）。 */
  get stderr(): string {
    return this.stderrTail
  }
}
