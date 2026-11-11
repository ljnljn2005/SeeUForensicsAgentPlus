/**
 * 本地模型（OpenAI 兼容网关）接入。
 *
 * 用户配置存放在 `<userData>/local-model.json`（也可用 `SEEU_LOCAL_MODEL_JSON`
 * 直接给一段 JSON）。外壳启动时把它编译成 `<userData>/local-model.patch.yml`，
 * 作为第二个 `--patch` 叠加在随包取证 overlay 之后 —— dsh 的 patch 层顺序是
 * 「后层覆盖前层」，所以本地模型行能盖住官方默认值，而普通用户不需要改 asar。
 *
 * 细节见 `tools/local-model.mjs`（生成逻辑与开发预览脚本共用）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { net } from 'electron'
import { userDataDir } from './paths.js'
import {
  LocalModelConfigError,
  localModelEnv,
  localModelPatch,
  normalizeLocalModel,
} from '../tools/local-model.mjs'

export interface LocalModelPrepared {
  /** 生成出来的补丁文件；未启用时为 undefined（不要传给 dsh）。 */
  patchPath?: string
  /** 追加给 dsh 子进程的环境变量（apiKeyEnv → 占位/真实 key）。 */
  env: NodeJS.ProcessEnv
  /** 写进 shell 日志的一行说明。 */
  summary: string
}

export interface PrepareOptions {
  /** 覆盖配置来源，主要用于测试/开发。 */
  configFile?: string
  /** 覆盖生成文件位置，主要用于测试/开发。 */
  patchFile?: string
}

export function localModelConfigFile(): string {
  return join(userDataDir(), 'local-model.json')
}

export function localModelPatchFile(): string {
  return join(userDataDir(), 'local-model.patch.yml')
}

/** 读取配置：`SEEU_LOCAL_MODEL_JSON` > 配置文件。文件不存在＝未启用。 */
export function readLocalModelConfig(configFile = localModelConfigFile()): unknown {
  const inline = process.env.SEEU_LOCAL_MODEL_JSON
  if (inline !== undefined && inline.trim() !== '') {
    try {
      return JSON.parse(inline)
    } catch (error) {
      throw new LocalModelConfigError(`SEEU_LOCAL_MODEL_JSON 不是合法 JSON：${(error as Error).message}`)
    }
  }
  if (!existsSync(configFile)) return undefined
  try {
    return JSON.parse(readFileSync(configFile, 'utf8'))
  } catch (error) {
    throw new LocalModelConfigError(`${configFile} 不是合法 JSON：${(error as Error).message}`)
  }
}

/**
 * 准备本地模型补丁。任何配置错误都不应阻塞启动：调用方拿到 `undefined`
 * 就按「只用官方 DeepSeek 账号」继续运行，并把错误写进日志。
 */
export function prepareLocalModel(options: PrepareOptions = {}): LocalModelPrepared {
  const configFile = options.configFile ?? localModelConfigFile()
  const patchFile = options.patchFile ?? localModelPatchFile()

  let raw: unknown
  try {
    raw = readLocalModelConfig(configFile)
  } catch (error) {
    return { env: {}, summary: `local model: ${(error as Error).message}` }
  }
  if (raw === undefined) return { env: {}, summary: 'local model: 未配置（仅官方模型可用）' }

  let cfg: ReturnType<typeof normalizeLocalModel>
  let patch: string | undefined
  try {
    cfg = normalizeLocalModel(raw)
    patch = localModelPatch(cfg)
  } catch (error) {
    return { env: {}, summary: `local model: ${(error as Error).message}` }
  }
  if (patch === undefined || !cfg.enabled) {
    return { env: {}, summary: 'local model: 已禁用（仅官方模型可用）' }
  }

  try {
    mkdirSync(join(patchFile, '..'), { recursive: true })
    writeFileSync(patchFile, patch, 'utf8')
  } catch (error) {
    return { env: {}, summary: `local model: 写入补丁失败 ${(error as Error).message}` }
  }

  const models = cfg.models.map((m) => m.id).join(', ')
  const tail = cfg.defaultModel !== undefined ? `，默认模型 ${cfg.defaultModel}` : ''
  return {
    patchPath: patchFile,
    env: localModelEnv(cfg),
    summary: `local model: ${cfg.route} → ${cfg.baseURL}（模型 ${models}${tail}）`,
  }
}

// ── 设置界面（renderer/local-model.html）用到的读写/探测 ────────────────────

/** 启动探测用：把 env/文件配置归一化，未启用或配置非法都返回 undefined。 */
export function probeableLocalModel(
  configFile = localModelConfigFile(),
): { baseURL: string; apiKey?: string } | undefined {
  try {
    const raw = readLocalModelConfig(configFile)
    if (raw === undefined) return undefined
    const normalized = normalizeLocalModel(raw)
    if (!normalized.enabled) return undefined
    return normalized.apiKey === undefined
      ? { baseURL: normalized.baseURL }
      : { baseURL: normalized.baseURL, apiKey: normalized.apiKey }
  } catch {
    return undefined
  }
}

export interface LocalModelView {
  readonly path: string
  readonly exists: boolean
  readonly config?: unknown
  readonly error?: string
}

/** 给设置界面读取：文件不存在或损坏都返回结构化结果，不抛异常。 */
export function describeLocalModelConfig(configFile = localModelConfigFile()): LocalModelView {
  if (!existsSync(configFile)) return { path: configFile, exists: false }
  try {
    return { path: configFile, exists: true, config: JSON.parse(readFileSync(configFile, 'utf8')) }
  } catch (error) {
    return { path: configFile, exists: true, error: (error as Error).message }
  }
}

/**
 * 设置界面保存：先用与启动路径相同的 `normalizeLocalModel()` 校验，
 * 再落盘；校验不过不写文件（避免把坏配置留给下次启动）。
 */
export function writeLocalModelConfig(
  input: unknown,
  configFile = localModelConfigFile(),
): { ok: true; path: string } | { ok: false; error: string } {
  try {
    const normalized = normalizeLocalModel(input)
    if (normalized.enabled) localModelPatch(normalized) // 只为校验生成过程不再抛错
    mkdirSync(join(configFile, '..'), { recursive: true })
    writeFileSync(configFile, `${JSON.stringify(input, null, 2)}\n`, 'utf8')
    return { ok: true, path: configFile }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 启动失败的兜底：把现有配置里的 `enabled` 置为 false（其余字段原样保留），
 * 让下一次启动回到官方账号链路。文件不存在时也会写一份 `{ enabled: false }`，
 * 这样错误页按钮在任何情况下都有确定行为；文件损坏时直接覆盖兜底。
 */
export function disableLocalModel(
  configFile = localModelConfigFile(),
): { ok: true; path: string } | { ok: false; error: string } {
  try {
    let raw: Record<string, unknown> = {}
    if (existsSync(configFile)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(configFile, 'utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          raw = parsed as Record<string, unknown>
        }
      } catch {
        // 配置本身坏了也要能兜底：直接覆盖成 enabled:false
      }
    }
    mkdirSync(join(configFile, '..'), { recursive: true })
    writeFileSync(configFile, `${JSON.stringify({ ...raw, enabled: false }, null, 2)}\n`, 'utf8')
    return { ok: true, path: configFile }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/** 设置界面实时预览：把表单内容编译成 patch 文本（不落盘）。 */
export function previewLocalModelPatch(input: unknown): { ok: true; patch?: string } | { ok: false; error: string } {
  try {
    return { ok: true, patch: localModelPatch(input) }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export interface GatewayProbe {
  readonly baseURL?: string
  readonly apiKey?: string
  readonly timeoutMs?: number
}

/**
 * 「测试连接」：由主进程直接请求 `GET <baseURL>/models`。
 * 走 Electron 的 net（不受渲染进程 CORS 限制），8 秒超时。
 */
export async function testLocalGateway(probe: GatewayProbe): Promise<
  | { ok: true; status: number; models: Array<{ id?: string; name?: string }> }
  | { ok: false; error: string }
> {
  const raw = (probe.baseURL ?? '').trim()
  if (raw === '') return { ok: false, error: '缺少 baseURL' }
  let url: string
  try {
    url = `${raw.replace(/\/+$/, '')}/models`
    // 提前校验协议与合法性，给出比 net 更清楚的信息
    void new URL(url)
  } catch (error) {
    return { ok: false, error: `baseURL 不合法：${(error as Error).message}` }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), probe.timeoutMs ?? 8000)
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (probe.apiKey !== undefined && probe.apiKey !== '') headers.authorization = `Bearer ${probe.apiKey}`
    const response = await net.fetch(url, { method: 'GET', headers, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}：${text.slice(0, 300)}` }
    }
    let models: Array<{ id?: string; name?: string }> = []
    try {
      const body = JSON.parse(text) as { data?: Array<{ id?: string; name?: string }> }
      if (Array.isArray(body.data)) models = body.data
    } catch {
      // 网关返回非 JSON 时不视为失败：能连通、HTTP 200 就说明地址对了
    }
    return { ok: true, status: response.status, models }
  } catch (error) {
    const message = (error as Error).name === 'AbortError'
      ? `请求超时（${probe.timeoutMs ?? 8000}ms）`
      : (error as Error).message
    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}

// ── 网关能力自检 ────────────────────────────────────────────────────────────

export interface GatewayProbeInput extends GatewayProbe {
  /** 参与自检的模型 id；不给就取 /models 的第一个。 */
  readonly model?: string
}

export interface DiagnosisItem {
  readonly key: 'models' | 'chat' | 'tools'
  readonly label: string
  readonly ok: boolean
  readonly detail: string
  readonly ms?: number
}

export interface GatewayDiagnosis {
  readonly ok: boolean
  readonly baseURL: string
  readonly model?: string
  readonly items: DiagnosisItem[]
}

interface CompletionJson {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
    }
  }>
}

/** 网关返回 JSON，或（少数网关即使 stream:false 也回 SSE）从 `data:` 行拼一个结果。 */
function parseCompletionText(text: string): CompletionJson | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed) as CompletionJson
  } catch {
    // 继续尝试 SSE
  }
  const content: string[] = []
  const toolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> = []
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            content?: string
            tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
          }
        }>
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta
        if (delta?.content !== undefined) content.push(delta.content)
        for (const call of delta?.tool_calls ?? []) {
          const slot = toolCalls[call.index ?? 0] ?? {}
          toolCalls[call.index ?? 0] = {
            id: call.id ?? slot.id,
            function: {
              name: call.function?.name ?? slot.function?.name,
              arguments: (slot.function?.arguments ?? '') + (call.function?.arguments ?? ''),
            },
          }
        }
      }
    } catch {
      // 单个 chunk 坏掉不影响整体
    }
  }
  if (content.length === 0 && toolCalls.length === 0) return undefined
  return { choices: [{ message: { content: content.join(''), tool_calls: toolCalls } }] }
}

async function postCompletion(
  url: string,
  apiKey: string | undefined,
  body: unknown,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; text: string; ms: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    if (apiKey !== undefined && apiKey !== '') headers.authorization = `Bearer ${apiKey}`
    const response = await net.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, text, ms: Date.now() - started }
  } catch (error) {
    const message = (error as Error).name === 'AbortError' ? `超时（${timeoutMs}ms）` : (error as Error).message
    return { ok: false, status: 0, text: message, ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 「测试连接与能力自检」：本地网关能不能用，不只看 `/models` 通不通。
 *
 * 1. `GET /models`：地址与鉴权；
 * 2. `POST /chat/completions`（非流式、`max_tokens: 16`）：模型真能出字；
 * 3. 同一端点带一个 `ping_tool` 函数调用：网关/模型是否支持 OpenAI 工具调用
 *    —— 取证会话几乎每一步都依赖工具，这一项不过，模型只能聊天。
 */
export async function diagnoseLocalGateway(input: GatewayProbeInput): Promise<GatewayDiagnosis> {
  const base = (input.baseURL ?? '').trim().replace(/\/+$/, '')
  if (base === '') {
    return { ok: false, baseURL: '', items: [{ key: 'models', label: '地址', ok: false, detail: '缺少 baseURL' }] }
  }
  const timeoutMs = input.timeoutMs ?? 20_000
  const items: DiagnosisItem[] = []

  // 1) /models
  const modelsStarted = Date.now()
  let models: Array<{ id?: string; name?: string }> = []
  let model = input.model
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (input.apiKey !== undefined && input.apiKey !== '') headers.authorization = `Bearer ${input.apiKey}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await net.fetch(`${base}/models`, { method: 'GET', headers, signal: controller.signal })
    clearTimeout(timer)
    const text = await response.text()
    if (!response.ok) {
      items.push({ key: 'models', label: '模型列表', ok: false, detail: `HTTP ${response.status}：${text.slice(0, 200)}`, ms: Date.now() - modelsStarted })
      return { ok: false, baseURL: base, items }
    }
    try {
      const parsed = JSON.parse(text) as { data?: Array<{ id?: string; name?: string }> }
      if (Array.isArray(parsed.data)) models = parsed.data
    } catch {
      // 非 JSON 也算连通：地址对了、鉴权过了
    }
    if (model === undefined || model === '') model = models[0]?.id
    const names = models.map((m) => m.id ?? m.name ?? '?').slice(0, 6).join(', ')
    items.push({
      key: 'models',
      label: '模型列表',
      ok: true,
      detail: models.length > 0 ? `${models.length} 个模型：${names}${models.length > 6 ? '…' : ''}` : 'HTTP 200（网关未返回模型清单）',
      ms: Date.now() - modelsStarted,
    })
  } catch (error) {
    const message = (error as Error).name === 'AbortError' ? `超时（${timeoutMs}ms）` : (error as Error).message
    items.push({ key: 'models', label: '模型列表', ok: false, detail: message, ms: Date.now() - modelsStarted })
    return { ok: false, baseURL: base, items }
  }

  // 2) 基础对话
  const chat = await postCompletion(
    `${base}/chat/completions`,
    input.apiKey,
    {
      model,
      messages: [{ role: 'user', content: '只回复：ok' }],
      stream: false,
      max_tokens: 16,
    },
    timeoutMs,
  )
  const chatJson = chat.ok ? parseCompletionText(chat.text) : undefined
  const chatText = (chatJson?.choices?.[0]?.message?.content ?? '').trim()
  items.push({
    key: 'chat',
    label: '基础对话',
    ok: chat.ok && chatJson !== undefined,
    detail: chat.ok
      ? chatJson === undefined
        ? `HTTP ${chat.status}，但响应不是可解析的 chat completion`
        : `回复「${chatText.slice(0, 40) || '（空）'}」`
      : `HTTP ${chat.status}：${chat.text.slice(0, 200)}`,
    ms: chat.ms,
  })
  if (!chat.ok || chatJson === undefined) {
    return { ok: false, baseURL: base, model, items }
  }

  // 3) 工具调用
  const tool = await postCompletion(
    `${base}/chat/completions`,
    input.apiKey,
    {
      model,
      messages: [{ role: 'user', content: '调用 ping_tool，参数 value 填 1，不要用文字回答。' }],
      stream: false,
      max_tokens: 128,
      tools: [
        {
          type: 'function',
          function: {
            name: 'ping_tool',
            description: '连通性测试工具：把 value 原样回显。',
            parameters: {
              type: 'object',
              properties: { value: { type: 'number', description: '任意数字' } },
              required: ['value'],
              additionalProperties: false,
            },
          },
        },
      ],
    },
    timeoutMs,
  )
  const toolJson = tool.ok ? parseCompletionText(tool.text) : undefined
  const toolCalls = toolJson?.choices?.[0]?.message?.tool_calls ?? []
  const firstCall = toolCalls[0]?.function
  items.push({
    key: 'tools',
    label: '工具调用',
    ok: tool.ok && toolCalls.length > 0,
    detail: !tool.ok
      ? `HTTP ${tool.status}：${tool.text.slice(0, 200)}`
      : toolCalls.length === 0
        ? `未返回 tool_calls（该模型/网关可能不支持函数调用，会话里只能聊天、不能查库）`
        : `返回 ${firstCall?.name ?? '?'}(${(firstCall?.arguments ?? '').slice(0, 80)})`,
    ms: tool.ms,
  })

  return {
    ok: items.every((item) => item.ok),
    baseURL: base,
    model,
    items,
  }
}
