/**
 * 本地 OpenAI 兼容网关的接入配置 → dsh overlay 片段。
 *
 * 背景：dsh 的 `- id: llm-pi-ai` 行默认是「挂载但零路由」，只有 overlay/config 里
 * 声明 providers 才会注册对应 provider 路由（见 `@deepseek-ai/dsh-base/cordis.patch.yml`
 * 第 128–136 行注释）。路由声明必须写 baseURL 与 models（模型 id 由网关决定），
 * 这两个值因机器而变，无法静态写进随包 overlay，所以外壳按 `local-model.json`
 * 生成一份补丁叠加在随包取证 overlay 之后。
 *
 * 本文件是纯 JS（无 Electron/TS 依赖），外壳（src/local-model.ts 引用）与
 * `scripts/dev-web.mjs`（开发预览）共用同一套生成逻辑，避免两态行为分叉。
 */

/** provider 路由名只允许小写字母/数字/连字符（dsh 侧否则报 UNSTORABLE_PROVIDER_ID）。 */
const ROUTE_RE = /^[a-z0-9][a-z0-9-]*$/

const DEFAULTS = {
  route: 'local-openai',
  displayName: '本地模型（OpenAI 兼容网关）',
  apiKeyEnv: 'SEEU_LOCAL_LLM_API_KEY',
  contextWindow: 131072,
  maxTokens: 8192,
  timeoutMs: 600_000,
  streamIdleTimeoutMs: 600_000,
  // 本地网关并发低：默认 5 次重试会在网关排队时把一次失败放大成 5 次长超时，
  // 因此默认压到 3 次（仍保留 normal 模式的指数退避）。
  retryMaxRetries: 3,
  // 标题生成是每次新会话的额外一次请求：本地模型不值得给 4096 输出 tokens。
  titleMaxOutputTokens: 512,
  titleTimeoutMs: 20_000,
}

export class LocalModelConfigError extends Error {
  constructor(message, code = 'E_LOCAL_MODEL_CONFIG') {
    super(message)
    this.name = 'LocalModelConfigError'
    this.code = code
  }
}

function num(value, fallback) {
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function str(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 把用户配置归一化。接受两种写法：
 *   { baseURL, model: 'qwen2.5-14b', ... }                    ← 单个模型
 *   { baseURL, models: [{ id, name?, contextWindow?, maxTokens? }, ...] }
 */
export function normalizeLocalModel(input = {}) {
  if (input === null || typeof input !== 'object') {
    throw new LocalModelConfigError('local-model 配置必须是 JSON 对象')
  }
  const enabled = input.enabled !== false
  const baseURL = str(input.baseURL)
  const modelsInput = Array.isArray(input.models) ? input.models : []
  const singleModel = str(input.model)

  let models = modelsInput
    .filter((m) => m !== null && typeof m === 'object' && str(m.id) !== undefined)
    .map((m) => ({
      id: str(m.id),
      name: str(m.name) ?? str(m.id),
      contextWindow: num(m.contextWindow, undefined),
      maxTokens: num(m.maxTokens, undefined),
    }))

  if (models.length === 0 && singleModel !== undefined) {
    models = [{ id: singleModel, name: singleModel, contextWindow: undefined, maxTokens: undefined }]
  }

  if (enabled) {
    if (baseURL === undefined) throw new LocalModelConfigError('缺少 baseURL（例如 http://127.0.0.1:8000/v1）')
    if (!/^https?:\/\//i.test(baseURL)) throw new LocalModelConfigError(`baseURL 必须以 http:// 或 https:// 开头：${baseURL}`)
    if (models.length === 0) throw new LocalModelConfigError('缺少模型：请写 model 或 models[].id')
  }

  const contextWindow = num(input.contextWindow, DEFAULTS.contextWindow)
  const maxTokens = num(input.maxTokens, DEFAULTS.maxTokens)
  const route = ROUTE_RE.test(str(input.route) ?? '') ? str(input.route) : DEFAULTS.route

  const defaultModel = enabled
    ? (str(input.defaultModel) ?? (input.useAsDefault === true ? models[0].id : undefined))
    : undefined

  return {
    enabled,
    route,
    displayName: str(input.displayName) ?? DEFAULTS.displayName,
    baseURL,
    apiKeyEnv: str(input.apiKeyEnv) ?? DEFAULTS.apiKeyEnv,
    apiKey: str(input.apiKey),
    headers: input.headers !== null && typeof input.headers === 'object' ? input.headers : undefined,
    contextWindow,
    maxTokens,
    timeoutMs: num(input.timeoutMs, DEFAULTS.timeoutMs),
    streamIdleTimeoutMs: num(input.streamIdleTimeoutMs, DEFAULTS.streamIdleTimeoutMs),
    retryMaxRetries: num(input.retryMaxRetries, DEFAULTS.retryMaxRetries),
    titleMaxOutputTokens: num(input.titleMaxOutputTokens, DEFAULTS.titleMaxOutputTokens),
    titleTimeoutMs: num(input.titleTimeoutMs, DEFAULTS.titleTimeoutMs),
    compat: input.compat !== null && typeof input.compat === 'object' ? input.compat : {},
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow ?? contextWindow,
      maxTokens: m.maxTokens ?? maxTokens,
    })),
    defaultModel,
  }
}

/** YAML 标量：用 JSON 双引号字符串（YAML 1.2 是 JSON 超集，转义规则一致）。 */
function q(value) {
  return JSON.stringify(String(value))
}

/** 生成叠加在取证 overlay 之后的 patch 文本；未启用时返回 undefined。 */
export function localModelPatch(cfg) {
  if (cfg === undefined || cfg === null) return undefined
  const c = normalizeLocalModel(cfg)
  if (!c.enabled) return undefined

  const lines = [
    '# 由 SeeUForensicsAgentPlus 依据 local-model.json 自动生成，请勿手工编辑。',
    '# 改配置请改 local-model.json（外壳启动时会重新生成本文件）。',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    `      ${c.route}:`,
    `        displayName: ${q(c.displayName)}`,
    '        api: openai-completions',
    `        baseURL: ${q(c.baseURL)}`,
    `        apiKeyEnv: ${q(c.apiKeyEnv)}`,
    `        timeoutMs: ${c.timeoutMs}`,
    `        streamIdleTimeoutMs: ${c.streamIdleTimeoutMs}`,
    '        retryPolicy:',
    '          mode: normal',
    `          maxRetries: ${c.retryMaxRetries}`,
  ]
  if (c.headers !== undefined) {
    lines.push('        headers:')
    for (const [k, v] of Object.entries(c.headers)) lines.push(`          ${q(k)}: ${q(v)}`)
  }
  // 本地/自建网关的保守兼容档：不发 store、不用 developer 角色、不回传 usage 流事件，
  // 输出上限字段用 max_tokens。用户的 compat 覆盖这几个默认值。
  const compat = {
    supportsUsageInStreaming: false,
    maxTokensField: 'max_tokens',
    supportsStore: false,
    supportsDeveloperRole: false,
    ...c.compat,
  }
  lines.push('        compat:')
  for (const [k, v] of Object.entries(compat)) {
    lines.push(`          ${k}: ${typeof v === 'boolean' || typeof v === 'number' ? String(v) : q(v)}`)
  }
  lines.push('        models:')
  for (const m of c.models) {
    lines.push(`          - id: ${q(m.id)}`)
    lines.push(`            name: ${q(m.name)}`)
    lines.push(`            contextWindow: ${m.contextWindow}`)
    lines.push(`            maxTokens: ${m.maxTokens}`)
    lines.push('            input: [text]')
    lines.push('            reasoningEfforts: false')
  }

  // 会话标题生成是每次新会话的额外一次 LLM 请求；本地模型不需要 4096 输出 tokens。
  lines.push(
    '- id: session-title-llm',
    '  config:',
    '    targetWords: 5',
    '    targetCjkCharacters: 10',
    '    maxInputBytes: 4096',
    `    maxOutputTokens: ${c.titleMaxOutputTokens}`,
    `    timeoutMs: ${c.titleTimeoutMs}`,
  )

  if (c.defaultModel !== undefined) {
    lines.push(
      '- id: agent-default-model',
      '  config:',
      `    provider: ${q(c.route)}`,
      `    model: ${q(c.defaultModel)}`,
    )
  }
  return `${lines.join('\n')}\n`
}

/** 外壳需要注入给 dsh 子进程的环境变量（credentials seam 走 apiKeyEnv）。 */
export function localModelEnv(cfg) {
  if (cfg === undefined || cfg === null) return {}
  const c = normalizeLocalModel(cfg)
  if (!c.enabled) return {}
  // 本地网关通常不校验 key，但 pi-ai 在声明了 apiKeyEnv 且取不到值时会抛
  // MISSING_CREDENTIAL，因此给一个非空占位值。
  return { [c.apiKeyEnv]: c.apiKey ?? 'local' }
}

export { DEFAULTS as LOCAL_MODEL_DEFAULTS }
