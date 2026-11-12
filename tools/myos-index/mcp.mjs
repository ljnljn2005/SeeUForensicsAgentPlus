/**
 * MYOS（超级取证大师）MCP 客户端。
 *
 * 只做一件事：用 stdio + JSON-RPC 行协议跟 `myos_mcp_server.exe` 说话。
 * 导入器（import.mjs）与命令行（cli.mjs）都复用它，测试用假服务器
 * （tests/fixtures/fake-myos-mcp.mjs）注入。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/** 默认的 MYOS MCP 服务端（可用 SEEU_MYOS_MCP 覆盖）。 */
export const DEFAULT_MYOS_MCP = 'D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe'

/** 取 MCP 服务端路径：环境变量优先，其次默认安装位置。 */
export function resolveMyosMcp(env = process.env) {
  const fromEnv = String(env.SEEU_MYOS_MCP ?? '').trim()
  if (fromEnv) return fromEnv
  return DEFAULT_MYOS_MCP
}

/** 判断某个路径是否需要用 node 来跑（测试里的假服务器）。 */
function scriptInvocation(command, env) {
  if (!/\.(mjs|cjs|js)$/i.test(command)) return { command, args: [] }
  const node = String(env.SEEU_MYOS_NODE ?? '').trim() || (process.versions.electron ? 'node' : process.execPath)
  return { command: node, args: [command] }
}

/**
 * MYOS MCP 客户端。
 *
 * - 行分隔 JSON：每次请求一行，忽略通知行的响应；
 * - `start()` 幂等，首次会自动 initialize + notifications/initialized；
 * - 工具报错（isError）以异常抛出，消息里带服务端文本。
 */
export class MyosMcpClient {
  constructor({ command, env = process.env, timeoutMs = 120000, log } = {}) {
    this.command = command ?? resolveMyosMcp(env)
    this.env = env
    this.timeoutMs = timeoutMs
    this.log = log ?? (() => {})
    this.child = undefined
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    this.stderrTail = ''
    this.starting = undefined
    this.started = false
  }

  /** 启动并完成握手（重复调用安全）。 */
  start() {
    this.starting ??= this.#start()
    return this.starting
  }

  async #start() {
    if (this.started) return
    const { command, args } = scriptInvocation(this.command, this.env)
    if (/\.exe$/i.test(command) && !existsSync(command)) {
      throw new Error(`找不到 MYOS MCP 服务端：${command}（先安装/启动「超级取证大师」，或设置 SEEU_MYOS_MCP）`)
    }
    this.log(`myos: start ${command} ${args.join(' ')}`)
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...this.env } })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.#onData(chunk))
    child.stderr.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4096)
    })
    child.on('exit', (code) => {
      this.started = false
      this.child = undefined
      for (const [, pending] of this.pending) pending.reject(new Error(`MYOS MCP 进程退出（code=${code}）${this.stderrTail ? `：${this.stderrTail.trim()}` : ''}`))
      this.pending.clear()
    })
    await this.#request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'seeu-myso-import', version: '1.0.0' },
    })
    this.#notify('notifications/initialized', {})
    this.started = true
  }

  #onData(chunk) {
    this.buffer += chunk
    let index
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        // MYOS 偶尔会往 stdout 打非 JSON 行，跳过即可。
        continue
      }
      if (message.id === undefined) continue
      const pending = this.pending.get(message.id)
      if (pending === undefined) continue
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(String(message.error.message ?? JSON.stringify(message.error))))
      else pending.resolve(message.result)
    }
  }

  #notify(method, params) {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  #request(method, params, timeoutMs = this.timeoutMs) {
    if (this.child === undefined) throw new Error('MYOS MCP 尚未启动')
    const id = this.nextId++
    const child = this.child
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MYOS MCP 调用超时（${method}，>${Math.round(timeoutMs / 1000)}s）`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  /** 列出服务端全部工具（名字形如 myos-forensics.query_cases）。 */
  async listTools() {
    await this.start()
    const result = await this.#request('tools/list', {})
    return Array.isArray(result?.tools) ? result.tools : []
  }

  /** 调用一个工具，返回 MCP 原始 result（含 content/structuredContent）。 */
  async callRaw(name, args = {}, { timeoutMs } = {}) {
    await this.start()
    return this.#request('tools/call', { name, arguments: args }, timeoutMs)
  }

  /** 调用工具并把返回文本按 JSON 解析（解析失败返回原文）。 */
  async call(name, args = {}, options) {
    const result = await this.callRaw(name, args, options)
    const texts = (result?.content ?? []).map((item) => item?.text ?? '').filter(Boolean)
    const text = texts.join('\n')
    if (result?.isError) throw new Error(`MYOS 工具 ${name} 报错：${text || '未知错误'}`)
    if (result?.structuredContent !== undefined) return result.structuredContent
    const trimmed = text.trim()
    if (!trimmed) return text
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return text
      }
    }
    return text
  }

  /** 关闭子进程（重复调用安全）。 */
  async close() {
    const child = this.child
    this.child = undefined
    this.started = false
    this.starting = undefined
    for (const [, pending] of this.pending) pending.reject(new Error('MYOS MCP 已关闭'))
    this.pending.clear()
    if (child === undefined) return
    try {
      child.stdin.end()
    } catch {
      // 已经结束。
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // 忽略
        }
        resolve()
      }, 2000)
      child.on('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

/** 便捷函数：起一个客户端、执行、关闭。 */
export async function withMyosClient(fn, options = {}) {
  const client = new MyosMcpClient(options)
  try {
    await client.start()
    return await fn(client)
  } finally {
    await client.close()
  }
}
