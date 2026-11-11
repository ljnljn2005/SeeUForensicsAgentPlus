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
