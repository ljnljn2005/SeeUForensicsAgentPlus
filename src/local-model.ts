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
