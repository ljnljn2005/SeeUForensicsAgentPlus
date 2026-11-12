import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import {
  normalizeGatewayModels,
  modelContextWindow,
  normalizeLocalModel,
  localModelPatch,
  localModelEnv,
  LOCAL_MODEL_DEFAULTS,
  LocalModelConfigError,
  CONTEXT_PRESETS,
  localModelWarnings,
  estimateContextBudget,
  explainGatewayError,
  contextWindowMismatch,
  gatewayContextReported,
} from '../tools/local-model.mjs'

const require = createRequire(import.meta.url)
const YAML = require('yaml')

const base = {
  baseURL: 'http://127.0.0.1:8000/v1',
  models: [{ id: 'qwen2.5-32b-instruct', name: 'Qwen2.5 32B（本地）' }],
}

test('默认值：route/apiKeyEnv/上下文/输出/重试/标题上限', () => {
  const c = normalizeLocalModel(base)
  assert.equal(c.enabled, true)
  assert.equal(c.route, 'local-openai')
  assert.equal(c.apiKeyEnv, LOCAL_MODEL_DEFAULTS.apiKeyEnv)
  assert.equal(c.contextWindow, 131072)
  assert.equal(c.maxTokens, 8192)
  assert.equal(c.retryMaxRetries, 3)
  assert.equal(c.titleMaxOutputTokens, 512)
  assert.deepEqual(c.models.map((m) => m.id), ['qwen2.5-32b-instruct'])
  assert.equal(c.models[0].name, 'Qwen2.5 32B（本地）')
  assert.equal(c.defaultModel, undefined)
})

test('单模型写法 model 等价于 models[0]', () => {
  const c = normalizeLocalModel({ baseURL: 'http://127.0.0.1:1234/v1', model: 'llama-3.1-8b', useAsDefault: true })
  assert.deepEqual(c.models.map((m) => m.id), ['llama-3.1-8b'])
  assert.equal(c.defaultModel, 'llama-3.1-8b')
})

test('非法路由名回退默认值（避免 dsh UNSTORABLE_PROVIDER_ID）', () => {
  assert.equal(normalizeLocalModel({ ...base, route: 'Bad Route' }).route, 'local-openai')
  assert.equal(normalizeLocalModel({ ...base, route: 'local-gw' }).route, 'local-gw')
})

test('缺少 baseURL / 非 http(s) baseURL / 缺模型都要报 LocalModelConfigError', () => {
  assert.throws(() => normalizeLocalModel({ models: [{ id: 'x' }] }), (e) => e instanceof LocalModelConfigError && /baseURL/.test(e.message))
  assert.throws(() => normalizeLocalModel({ baseURL: '127.0.0.1:8000/v1', model: 'x' }), /http/)
  assert.throws(() => normalizeLocalModel({ baseURL: 'http://127.0.0.1:8000/v1' }), /模型/)
})

test('未启用时不校验必填项，patch/env 都为空', () => {
  const c = normalizeLocalModel({ enabled: false })
  assert.equal(c.enabled, false)
  assert.equal(localModelPatch({ enabled: false }), undefined)
  assert.deepEqual(localModelEnv({ enabled: false }), {})
})

test('生成的 patch 关键行：openai-completions、保守 compat、retryPolicy、session-title', () => {
  const yamlText = localModelPatch(base)
  assert.ok(yamlText.includes('- id: llm-pi-ai'))
  assert.ok(yamlText.includes('api: openai-completions'))
  assert.ok(yamlText.includes('maxRetries: 3'))
  assert.ok(yamlText.includes('supportsUsageInStreaming: false'))
  assert.ok(/maxTokensField: "?max_tokens"?/.test(yamlText))
  assert.ok(yamlText.includes('supportsStore: false'))
  assert.ok(yamlText.includes('supportsDeveloperRole: false'))
  assert.ok(yamlText.includes('- id: session-title-llm'))
  assert.ok(yamlText.includes('maxOutputTokens: 512'))
  assert.ok(!yamlText.includes('- id: agent-default-model'))

  const doc = YAML.parse(yamlText)
  const rows = Array.isArray(doc) ? doc : [doc]
  const ids = rows.map((r) => r.id)
  assert.deepEqual(ids, ['llm-pi-ai', 'session-title-llm', 'agent-preset-registry'])
  const provider = rows[0].config.providers['local-openai']
  assert.equal(provider.api, 'openai-completions')
  assert.equal(provider.baseURL, 'http://127.0.0.1:8000/v1')
  assert.deepEqual(provider.retryPolicy, { mode: 'normal', maxRetries: 3 })
  assert.equal(provider.models[0].contextWindow, 131072)
  assert.equal(provider.models[0].maxTokens, 8192)
  assert.deepEqual(provider.models[0].input, ['text'])
})

test('useAsDefault 追加 agent-default-model 行', () => {
  const doc = YAML.parse(localModelPatch({ ...base, useAsDefault: true }))
  const rows = Array.isArray(doc) ? doc : [doc]
  const row = rows.find((r) => r.id === 'agent-default-model')
  assert.ok(row, 'patch 里应有 agent-default-model 行')
  assert.deepEqual(row.config, { provider: 'local-openai', model: 'qwen2.5-32b-instruct' })
})

test('自定义值覆盖默认（超时/重试/标题/上下文/输出），compat 覆盖保留其它默认', () => {
  const c = normalizeLocalModel({
    ...base,
    contextWindow: 262144,
    maxTokens: 16384,
    timeoutMs: 900000,
    streamIdleTimeoutMs: 300000,
    retryMaxRetries: 1,
    titleMaxOutputTokens: 256,
    compat: { supportsUsageInStreaming: true, maxTokensField: 'max_completion_tokens' },
  })
  assert.equal(c.contextWindow, 262144)
  assert.equal(c.maxTokens, 16384)
  const text = localModelPatch(c)
  const rows = YAML.parse(text)
  const rowsArr = Array.isArray(rows) ? rows : [rows]
  const provider = rowsArr[0].config.providers['local-openai']
  assert.equal(provider.timeoutMs, 900000)
  assert.equal(provider.streamIdleTimeoutMs, 300000)
  assert.deepEqual(provider.retryPolicy, { mode: 'normal', maxRetries: 1 })
  assert.equal(provider.compat.supportsUsageInStreaming, true)
  assert.equal(provider.compat.maxTokensField, 'max_completion_tokens')
  assert.equal(provider.compat.supportsStore, false) // 未被覆盖的默认仍在
  assert.equal(rowsArr[1].config.maxOutputTokens, 256)
})

test('headers 原样写入 patch，且 YAML 可解析（含冒号/空格的值）', () => {
  const text = localModelPatch({ ...base, headers: { 'X-Gateway-Key': 'a: b"c' } })
  const rows = YAML.parse(text)
  const rowsArr = Array.isArray(rows) ? rows : [rows]
  assert.deepEqual(rowsArr[0].config.providers['local-openai'].headers, { 'X-Gateway-Key': 'a: b"c' })
})

test('localModelEnv 注入 apiKeyEnv 占位值', () => {
  assert.deepEqual(localModelEnv(base), { SEEU_LOCAL_LLM_API_KEY: 'local' })
  assert.deepEqual(localModelEnv({ ...base, apiKey: 'sk-123' }), { SEEU_LOCAL_LLM_API_KEY: 'sk-123' })
  assert.deepEqual(localModelEnv({ ...base, apiKeyEnv: 'MY_KEY', apiKey: 'k' }), { MY_KEY: 'k' })
})

test('每个模型可单独指定上下文/输出上限', () => {
  const c = normalizeLocalModel({
    baseURL: 'http://127.0.0.1:8000/v1',
    models: [
      { id: 'a', contextWindow: 32768, maxTokens: 4096 },
      { id: 'b' },
    ],
  })
  assert.equal(c.models[0].contextWindow, 32768)
  assert.equal(c.models[0].maxTokens, 4096)
  assert.equal(c.models[1].contextWindow, 131072)
  assert.equal(c.models[1].maxTokens, 8192)
})

test('窗口档位：32k / 128k / 256k 三档，输出上限不超过窗口的 1/4', () => {
  assert.equal(CONTEXT_PRESETS.length, 3)
  assert.deepEqual(CONTEXT_PRESETS.map((p) => p.id), ['32k', '128k', '256k'])
  for (const preset of CONTEXT_PRESETS) {
    assert.ok(preset.contextWindow >= 32768)
    assert.ok(preset.maxTokens <= preset.contextWindow / 4)
  }
})

test('默认配置没有健康度警告', () => {
  const cfg = normalizeLocalModel(base)
  assert.deepEqual(localModelWarnings(cfg), [])
})

test('输出上限接近窗口时给出警告，达到窗口时报错级', () => {
  const warn = normalizeLocalModel({ ...base, contextWindow: 32768, maxTokens: 16384 })
  const warnKeys = localModelWarnings(warn).map((w) => w.key)
  assert.ok(warnKeys.includes('output-window'))

  const bad = normalizeLocalModel({ ...base, contextWindow: 32768, maxTokens: 32768 })
  const badItem = localModelWarnings(bad).find((w) => w.key === 'output-window')
  assert.equal(badItem.level, 'err')
})

test('重试过多、超时过短、窗口过小都会提示', () => {
  const cfg = normalizeLocalModel({
    ...base,
    contextWindow: 16384,
    maxTokens: 2048,
    retryMaxRetries: 8,
    timeoutMs: 30000,
  })
  const keys = localModelWarnings(cfg).map((w) => w.key)
  for (const key of ['window-small', 'retries', 'timeout']) assert.ok(keys.includes(key), key)
})

test('非档位窗口提示最近档位，未启用时无警告', () => {
  const odd = normalizeLocalModel({ ...base, contextWindow: 200000 })
  const hint = localModelWarnings(odd).find((w) => w.key === 'preset')
  assert.ok(hint && hint.message.includes('256k'))

  const disabled = normalizeLocalModel({ ...base, enabled: false })
  assert.deepEqual(localModelWarnings(disabled), [])
})

test('modelContextWindow 能读常见网关字段', () => {
  assert.equal(modelContextWindow({ id: 'a', max_model_len: 32768 }), 32768)
  assert.equal(modelContextWindow({ id: 'b', meta: { n_ctx: 8192 } }), 8192)
  assert.equal(modelContextWindow({ id: 'c', metadata: { context_length: 131072 } }), 131072)
  assert.equal(modelContextWindow({ id: 'd' }), undefined)
  // 太小的值（可能是 max_tokens 而不是窗口）不采信
  assert.equal(modelContextWindow({ id: 'e', n_ctx: 512 }), undefined)
})

test('normalizeGatewayModels 归一化 /v1/models 响应', () => {
  const list = normalizeGatewayModels([
    { id: 'a', max_model_len: 32768 },
    { id: 'b', meta: { n_ctx: 8192 } },
    { id: 'c' },
    { name: 'd', context_length: 131072 },
  ])
  assert.deepEqual(
    list.map((m) => [m.id, m.contextWindow]),
    [
      ['a', 32768],
      ['b', 8192],
      ['c', undefined],
      ['d', 131072],
    ],
  )
  assert.deepEqual(normalizeGatewayModels(undefined), [])
})

test('usageInStreaming 默认关闭，打开后 compat.supportsUsageInStreaming=true', () => {
  const off = normalizeLocalModel({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }] })
  assert.equal(off.usageInStreaming, false)
  assert.ok(localModelPatch({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }] }).includes('supportsUsageInStreaming: false'))

  const on = normalizeLocalModel({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }], usageInStreaming: true })
  assert.equal(on.usageInStreaming, true)
  const yamlText = localModelPatch({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }], usageInStreaming: true })
  assert.ok(yamlText.includes('supportsUsageInStreaming: true'))
  // 用户在 compat 里显式覆盖仍优先
  const forced = localModelPatch({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }], usageInStreaming: true, compat: { supportsUsageInStreaming: false } })
  assert.ok(forced.includes('supportsUsageInStreaming: false'))
})

test('litePreset 默认开启：patch 里把默认预设指到 seeu-lite', () => {
  const patch = localModelPatch({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }] })
  assert.ok(patch.includes('- id: agent-preset-registry'))
  assert.ok(patch.includes('default: seeu-lite'))
  assert.equal(normalizeLocalModel({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }] }).litePreset, true)
})

test('litePreset=false 时不写 registry 行（仍保留模型与标题行）', () => {
  const patch = localModelPatch({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }], litePreset: false })
  assert.ok(!patch.includes('agent-preset-registry'))
  assert.ok(patch.includes('- id: session-title-llm'))
  assert.equal(normalizeLocalModel({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm' }], litePreset: false }).litePreset, false)
})

test('estimateContextBudget：精简预设的固定开销更小，32k 窗口仍留出大半', () => {
  const lite = estimateContextBudget({ ...base, contextWindow: 32768, litePreset: true })
  assert.equal(lite.preset, 'lite')
  assert.equal(lite.toolsCount, 12)
  assert.equal(lite.fixedChars, 10229 + 4379)
  assert.equal(lite.fixedTokens, Math.round((10229 + 4379) / 2.2))
  assert.equal(lite.remainingTokens, 32768 - lite.fixedTokens)
  assert.ok(lite.conversationShare > 0.6, '32k 窗口下精简预设应留出 60% 以上给对话')
  const full = estimateContextBudget({ ...base, contextWindow: 32768, litePreset: false })
  assert.equal(full.preset, 'full')
  assert.equal(full.toolsCount, 27)
  assert.ok(full.fixedTokens > lite.fixedTokens, '完整预设固定开销应更大')
  assert.ok(full.remainingTokens < lite.remainingTokens)
})

test('explainGatewayError：常见网关错误都有中文可操作提示', () => {
  assert.match(explainGatewayError('connect ECONNREFUSED 127.0.0.1:8000'), /网关没启动|端口/)
  assert.match(explainGatewayError('HTTP 401: {"error":"bad key"}'), /apiKey|鉴权/)
  assert.match(explainGatewayError('请求超时（8000ms）'), /无响应|超时/)
  assert.match(explainGatewayError('HTTP 404: not found'), /404|路径/)
  assert.match(explainGatewayError(''), /确认网关地址/)
  assert.match(explainGatewayError('some unknown failure'), /诊断信息/)
})

test('contextWindowMismatch 只在配置超过网关自报能力时返回数值', () => {
  const gw = [{ id: 'qwen', contextWindow: 32768 }, { id: 'other', contextWindow: 131072 }]
  assert.deepEqual(contextWindowMismatch(131072, ['qwen'], gw), { configured: 131072, gateway: 32768 })
  assert.equal(contextWindowMismatch(32768, ['qwen'], gw), null)
  assert.equal(contextWindowMismatch(16384, ['qwen'], gw), null)
  assert.equal(contextWindowMismatch(131072, ['missing'], gw), null)
  assert.equal(contextWindowMismatch(131072, ['qwen'], [{ id: 'qwen' }]), null)
})

test('gatewayContextReported：只有 id 的网关算没自报窗口', () => {
  assert.equal(gatewayContextReported([{ id: 'deepseek-flash' }, { id: 'qwen3.8-flash-next' }]), false)
  assert.equal(gatewayContextReported([{ id: 'a', contextWindow: 32768 }]), true)
  assert.equal(gatewayContextReported([{ id: 'a' }, { id: 'b', contextWindow: 2048 }]), true)
  assert.equal(gatewayContextReported([{ id: 'a', contextWindow: 512 }]), false)
  assert.equal(gatewayContextReported([]), false)
  assert.equal(gatewayContextReported(undefined), false)
})

test('titleGeneration 默认给 session-title-llm 配小输出；关掉时整行 disabled', () => {
  const on = localModelPatch({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm1' }] })
  assert.match(on, /- id: session-title-llm\n {2}config:/)
  assert.match(on, /maxOutputTokens: 512/)
  const off = localModelPatch({ baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm1' }], titleGeneration: false })
  assert.match(off, /- id: session-title-llm\n {2}disabled: true/)
  assert.ok(!off.includes('targetWords'))
  const base = { baseURL: 'http://127.0.0.1:8000/v1', models: [{ id: 'm1' }] }
  assert.equal(normalizeLocalModel(base).titleGeneration, true)
  assert.equal(normalizeLocalModel({ ...base, titleGeneration: false }).titleGeneration, false)
  assert.equal(normalizeLocalModel({ ...base, titleGeneration: 'false' }).titleGeneration, false)
})
