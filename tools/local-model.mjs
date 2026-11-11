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
  // 本地模型默认用「取证分析（本地模型精简）」预设：工具表约 10 个、系统提示紧凑，
  // 固定开销从 ~33k 字符降到 ~11k（32k 窗口才留得下对话）。关掉则沿用完整取证预设。
  litePreset: true,
  // 少数网关不支持 stream_options.include_usage（会直接 400），所以默认关闭；
  // 打开后流式响应末尾会带回 usage，会话里的 token 用量/上下文占比才有数。
  usageInStreaming: false,
  // 会话标题生成是每次新会话的一次额外请求：本地网关并发低时它会跟首轮对话抢队列。
  // 默认开着（标题更好读），关掉后首轮少一次请求、标题回退到首句截断。
  titleGeneration: true,
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
/**
 * 常见窗口档位：比赛环境通常给 128k（个人赛）/ 256k（团体赛），小机器给 32k。
 * 设置页一键套用，避免手填 contextWindow 时填错（例如把模型名里的数字当窗口）。
 */
export const CONTEXT_PRESETS = [
  { id: '32k', label: '32k 小窗口', contextWindow: 32768, maxTokens: 4096 },
  { id: '128k', label: '128k 个人赛', contextWindow: 131072, maxTokens: 8192 },
  { id: '256k', label: '256k 团体赛', contextWindow: 262144, maxTokens: 8192 },
]

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
    litePreset: input.litePreset !== false,
    usageInStreaming: input.usageInStreaming === true || input.usageInStreaming === 'true',
    titleGeneration: !(input.titleGeneration === false || input.titleGeneration === 'false'),
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
    supportsUsageInStreaming: c.usageInStreaming,
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
  // 低并发网关（一次只能跑一个请求）下这次请求会跟首轮对话抢队列，可以整行关掉：
  // 标题回退到首句截断，首轮只发一次请求。
  if (c.titleGeneration === false) {
    lines.push(
      '# 本地模型低并发：不再为会话标题额外发一次请求（标题回退到首句截断）',
      '- id: session-title-llm',
      '  disabled: true',
    )
  } else {
    lines.push(
      '- id: session-title-llm',
      '  config:',
      '    targetWords: 5',
      '    targetCjkCharacters: 10',
      '    maxInputBytes: 4096',
      `    maxOutputTokens: ${c.titleMaxOutputTokens}`,
      `    timeoutMs: ${c.titleTimeoutMs}`,
    )
  }

  if (c.defaultModel !== undefined) {
    lines.push(
      '- id: agent-default-model',
      '  config:',
      `    provider: ${q(c.route)}`,
      `    model: ${q(c.defaultModel)}`,
    )
  }

  // 精简预设：工具描述是固定开销的大头（27 个工具 ≈26,687 字符），本地小窗口模型
  // 用 seeu-lite 把工具表压到 ~10 个（≈9,900 字符）。默认建议开着，可在设置里关。
  if (c.litePreset) {
    lines.push(
      '# 本地模型默认预设：取证分析（本地模型精简），由 resources/forensics/cordis.patch.yml 定义',
      '- id: agent-preset-registry',
      '  config:',
      '    default: seeu-lite',
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

/**
 * 配置健康度检查：返回可直接展示给用户的建议（不抛异常）。
 * cfg 应是 normalizeLocalModel() 的结果。
 */
export function localModelWarnings(cfg) {
  const out = []
  if (!cfg || cfg.enabled === false) return out
  const window = num(cfg.contextWindow, DEFAULTS.contextWindow)
  const output = num(cfg.maxTokens, DEFAULTS.maxTokens)
  const retries = num(cfg.retryMaxRetries, DEFAULTS.retryMaxRetries)
  const timeout = num(cfg.timeoutMs, DEFAULTS.timeoutMs)
  const idle = num(cfg.streamIdleTimeoutMs, DEFAULTS.streamIdleTimeoutMs)

  if (output >= window) {
    out.push({ level: 'err', key: 'output-window', message: '输出上限 ' + output + ' 不小于上下文窗口 ' + window + '：一次回答就可能把历史挤掉，压缩也无法工作。建议调到窗口的 1/4 以内。' })
  } else if (output > window / 4) {
    out.push({ level: 'warn', key: 'output-window', message: '输出上限 ' + output + ' 占窗口 ' + window + ' 的 ' + Math.round((output / window) * 100) + '%：本地模型很少用满，建议不超过 ' + Math.floor(window / 4) + '，给工具结果和历史留空间。' })
  }
  if (window < 32768) {
    out.push({ level: 'warn', key: 'window-small', message: '上下文窗口 ' + window + ' 小于 32k：系统提示与工具描述本身就占掉不少，建议至少 32k。' })
  }
  if (retries > 5) {
    out.push({ level: 'warn', key: 'retries', message: '重试上限 ' + retries + ' 次：低并发网关排队时会把一次失败放大成多次长超时，建议 2-3 次。' })
  }
  if (timeout < 60000) {
    out.push({ level: 'warn', key: 'timeout', message: '请求超时 ' + Math.round(timeout / 1000) + 's 偏短：本地 32B 模型长上下文首 token 可能要 30s 以上，建议不少于 120s。' })
  }
  if (idle > timeout) {
    out.push({ level: 'info', key: 'idle', message: '流式空闲超时（' + Math.round(idle / 1000) + 's）大于总超时（' + Math.round(timeout / 1000) + 's），实际按总超时生效。' })
  }
  if (!CONTEXT_PRESETS.some((p) => p.contextWindow === window)) {
    const nearest = CONTEXT_PRESETS.reduce((a, b) => (Math.abs(b.contextWindow - window) < Math.abs(a.contextWindow - window) ? b : a))
    out.push({ level: 'info', key: 'preset', message: '窗口 ' + window + ' 不在常用档位；如果模型实测窗口是 ' + nearest.contextWindow + '，可一键套用「' + nearest.label + '」。' })
  }
  return out
}
/**
 * 网关 /v1/models 条目里可能带上下文窗口，各家字段名不一致：
 * vLLM 用 max_model_len，llama.cpp/LM Studio 用 n_ctx 或 context_length，
 * 也有网关放在 meta/metadata/config 子对象里。
 */
const CONTEXT_FIELDS = ['max_model_len', 'context_length', 'context_window', 'max_context_length', 'n_ctx', 'max_input_tokens']

export function modelContextWindow(entry) {
  if (entry === null || typeof entry !== "object") return undefined
  const sources = [entry, entry.meta, entry.metadata, entry.config]
  for (const source of sources) {
    if (source === null || typeof source !== "object") continue
    for (const key of CONTEXT_FIELDS) {
      const value = num(source[key], undefined)
      // 小于 2k 的多半不是窗口（例如 n_ctx=512 的测试值），不当真
      if (value !== undefined && value >= 2048) return value
    }
  }
  return undefined
}

/** 把 /v1/models 的 data[] 归一化成 { id, name, contextWindow? }。 */
/**
 * 配置的上下文窗口是否超过网关自报能力。
 * 超了意味着超出部分请求会被网关拒绝（常见报错 context length exceeded），应提醒用户改小。
 * @param {number} contextWindow 本地配置的窗口
 * @param {string[]} modelIds 配置里的模型 id
 * @param {{ id?: string, contextWindow?: number }[]} gatewayModels /v1/models 解析结果
 * @returns {{ configured: number, gateway: number } | null}
 */
export function contextWindowMismatch(contextWindow, modelIds, gatewayModels) {
  const num = (value) => {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : 0
  }
  const ids = (modelIds ?? []).map(String)
  const known = (gatewayModels ?? []).filter(
    (item) => item && ids.includes(String(item.id)) && num(item.contextWindow) >= 2048,
  )
  if (known.length === 0) return null
  const gateway = Math.min(...known.map((item) => num(item.contextWindow)))
  const configured = num(contextWindow)
  if (configured <= 0 || configured <= gateway) return null
  return { configured, gateway }
}

export function normalizeGatewayModels(data) {
  if (!Array.isArray(data)) return []
  const out = []
  for (const entry of data) {
    if (entry === null || typeof entry !== "object") continue
    const id = str(entry.id) ?? str(entry.name)
    if (id === undefined) continue
    const contextWindow = modelContextWindow(entry)
    const name = str(entry.name) ?? id
    out.push(contextWindow === undefined ? { id, name } : { id, name, contextWindow })
  }
  return out
}
/**
 * 固定上下文开销实测值（来自 scripts/e2e/local-tools-e2e.mjs 记录的请求体）：
 * 工具描述 + 系统提示是每次请求都要付的固定成本，压缩只能减少历史消息。
 * 本地模型调参时用它给出「还剩多少窗口给对话」的直观估算。
 */
const CONTEXT_BUDGET = {
  full: { preset: 'full', toolsCount: 27, toolsChars: 26687, systemChars: 6061 },
  lite: { preset: 'lite', toolsCount: 12, toolsChars: 10229, systemChars: 4379 },
}

/** 粗略 token 估算：中文为主的 JSON 约 2.2 字符/token（英文 JSON 约 4，中文约 1.5）。 */
const CHARS_PER_TOKEN = 2.2

export function estimateContextBudget(cfg) {
  const c = normalizeLocalModel(cfg)
  const budget = c.litePreset ? CONTEXT_BUDGET.lite : CONTEXT_BUDGET.full
  const fixedChars = budget.toolsChars + budget.systemChars
  const fixedTokens = Math.round(fixedChars / CHARS_PER_TOKEN)
  const remainingTokens = Math.max(0, c.contextWindow - fixedTokens)
  return {
    preset: budget.preset,
    toolsCount: budget.toolsCount,
    fixedChars,
    fixedTokens,
    contextWindow: c.contextWindow,
    remainingTokens,
    conversationShare: c.contextWindow > 0 ? Math.round((remainingTokens / c.contextWindow) * 100) / 100 : 0,
  }
}

/** 对网关探测失败给出可操作的中文提示（net 的原始错误对非开发者不友好）。 */
export function explainGatewayError(error) {
  const text = String(error ?? '')
  if (text === '') return '没有拿到错误信息：确认网关地址是否填写。'
  if (/缺少 baseURL|not valid URL|baseURL 不合法/i.test(text)) return 'baseURL 写法不对：要写成 http://127.0.0.1:8000/v1（带 /v1，不含 /chat/completions）。'
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|connect ECONNREFUSED/i.test(text)) return '连不上：网关没启动、端口不对，或被防火墙拦了。先确认进程在监听，再核对 baseURL 的端口。'
  if (/ERR_UNSAFE_PORT/i.test(text)) return '这个端口被网络栈禁用（浏览器/Chromium 拒绝 1、7、9 等端口）：换一个正常端口，例如 8000、8080、11434。'
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(text)) return '域名解析失败：检查主机名拼写；本机网关用 127.0.0.1 而不是 localhost 可以避开部分 DNS 问题。'
  if (/请求超时|ETIMEDOUT|timed out|AbortError/i.test(text)) return '网关无响应：模型可能还在加载，或这个地址代理到了别处。加载大模型后重试，必要时提高超时时间。'
  if (/HTTP 401|HTTP 403/i.test(text)) return '鉴权失败：网关要求 apiKey，但没传或传错。在「apiKey」里填网关控制台给的 key。'
  if (/HTTP 404/i.test(text)) return '404：路径不对。多数网关的模型列表在 <baseURL>/models，确认 baseURL 以 /v1 结尾。'
  if (/HTTP 5\d\d/i.test(text)) return '网关内部错误（5xx）：看网关自己的日志；也可能是请求体字段不被支持（可试 compat 里的兼容项）。'
  if (/MISSING_CREDENTIAL/i.test(text)) return '缺少凭据：apiKeyEnv 指向的环境变量没有值，保存配置并重启应用即可（外壳会注入占位值）。'
  return '检查 baseURL、apiKey 与网关日志；如仍失败，点「复制诊断信息」把配置与错误一起发给开发者。'
}

export { DEFAULTS as LOCAL_MODEL_DEFAULTS }
