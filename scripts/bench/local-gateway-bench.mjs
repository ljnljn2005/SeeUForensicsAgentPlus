#!/usr/bin/env node
/**
 * 本机模型网关基准：Spark 单机（qwen3.8-flash-next）/ 双机（dsv4.1-flash）。
 *
 * 用法：
 *   GW_BASE=http://127.0.0.1:8080/v1 GW_KEY=sk-... node scripts/bench/local-gateway-bench.mjs
 *   GW_MODELS=qwen3.8-flash-next,dsv4.1-flash   # 可选，默认就是这两个
 *   GW_BENCH_OUT=.dev/bench/my.json             # 可选，写 JSON 报告
 *
 * 每个模型跑三项，全部走真实 HTTP（不依赖 dsh）：
 *   1. 非流式对话：延迟、usage、正文长度；
 *   2. 流式对话（带 stream_options.include_usage）：首 token（TTFB）、总耗时、
 *      chunk 数、输出 token、tok/s、是否有 reasoning_content；
 *   3. 工具调用（非流式）：是否返回 tool_calls、finish_reason、延迟。
 *
 * 网关没起 / 模型不存在时该项标 skipped，不会假装跑过。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_MODELS = ['qwen3.8-flash-next', 'dsv4.1-flash']
const PING_TOOL = {
  type: 'function',
  function: {
    name: 'ping_tool',
    description: '返回 pong，用于验证工具调用链路',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: [] },
  },
}

export function normalizeBaseURL(base) {
  return String(base || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
}

export function tokensPerSecond(tokens, ms) {
  if (!Number.isFinite(tokens) || !Number.isFinite(ms) || ms <= 0) return null
  return Math.round((tokens / (ms / 1000)) * 10) / 10
}

async function postJSON(fetchImpl, url, apiKey, body, signal) {
  const started = Date.now()
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { error: { message: text.slice(0, 200) } }
  }
  return { status: res.status, json, ms: Date.now() - started }
}

/** 逐行解析 SSE：返回 { chunks, ttfbMs, totalMs, reasoningChars, contentChars, usage, finish }。 */
export async function readSSE(fetchImpl, url, apiKey, body, signal) {
  const started = Date.now()
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    return { error: `HTTP ${res.status}: ${text.slice(0, 160)}`, ms: Date.now() - started }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let chunks = 0
  let ttfbMs = null
  let reasoningChars = 0
  let contentChars = 0
  let usage = null
  let finish = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let event
      try {
        event = JSON.parse(payload)
      } catch {
        continue
      }
      if (ttfbMs === null) ttfbMs = Date.now() - started
      chunks += 1
      if (event.usage) usage = event.usage
      const choice = event.choices?.[0]
      if (!choice) continue
      const delta = choice.delta || {}
      if (typeof delta.reasoning_content === 'string') reasoningChars += delta.reasoning_content.length
      if (typeof delta.reasoning === 'string') reasoningChars += delta.reasoning.length
      if (typeof delta.content === 'string') contentChars += delta.content.length
      if (choice.finish_reason) finish = choice.finish_reason
    }
  }
  const ms = Date.now() - started
  const completion = usage?.completion_tokens ?? null
  return {
    ok: true,
    ms,
    ttfbMs,
    chunks,
    reasoningChars,
    contentChars,
    usage,
    finish,
    // 极快网关里 TTFB 可能与总耗时同一毫秒，避免除以 0。
    tokensPerSecond: tokensPerSecond(completion, Math.max(1, ms - (ttfbMs ?? 0))),
  }
}

/** 跑一个模型的三项基准。 */
export async function benchModel({ baseURL, apiKey, model, fetchImpl = globalThis.fetch, signal }) {
  const base = normalizeBaseURL(baseURL)
  const url = `${base}/chat/completions`
  const report = { model, chat: null, stream: null, tools: null }
  const common = { model, temperature: 0, max_tokens: 64 }

  const chat = await postJSON(
    fetchImpl,
    url,
    apiKey,
    { ...common, messages: [{ role: 'user', content: '只回复两个字：收到' }] },
    signal,
  ).catch((error) => ({ error: String(error?.message || error) }))
  if (chat.error) {
    report.chat = { ok: false, error: chat.error }
    report.stream = { ok: false, skipped: true, reason: 'chat 失败' }
    report.tools = { ok: false, skipped: true, reason: 'chat 失败' }
    return report
  }
  const chatChoice = chat.json?.choices?.[0]
  report.chat = {
    ok: chat.status === 200 && Boolean(chatChoice),
    status: chat.status,
    ms: chat.ms,
    content: String(chatChoice?.message?.content ?? '').slice(0, 80),
    usage: chat.json?.usage ?? null,
    error: chat.status === 200 ? null : chat.json?.error?.message ?? 'HTTP 非 200',
  }

  const stream = await readSSE(
    fetchImpl,
    url,
    apiKey,
    {
      ...common,
      max_tokens: 256,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: '用一句话说明什么是电子数据取证。' }],
    },
    signal,
  ).catch((error) => ({ error: String(error?.message || error) }))
  report.stream = stream.error ? { ok: false, error: stream.error } : stream

  const tools = await postJSON(
    fetchImpl,
    url,
    apiKey,
    {
      ...common,
      tools: [PING_TOOL],
      tool_choice: 'auto',
      messages: [{ role: 'user', content: '调用 ping_tool 工具，参数 text 填 hello。' }],
    },
    signal,
  ).catch((error) => ({ error: String(error?.message || error) }))
  if (tools.error) {
    report.tools = { ok: false, error: tools.error }
    return report
  }
  const toolChoice = tools.json?.choices?.[0]
  const calls = toolChoice?.message?.tool_calls ?? []
  report.tools = {
    ok: tools.status === 200 && Boolean(toolChoice),
    status: tools.status,
    ms: tools.ms,
    finish: toolChoice?.finish_reason ?? '',
    toolCalls: calls.length,
    names: calls.map((call) => call?.function?.name).filter(Boolean),
    error: tools.status === 200 ? null : tools.json?.error?.message ?? 'HTTP 非 200',
  }
  return report
}

export async function runBench({ baseURL, apiKey, models = DEFAULT_MODELS, fetchImpl = globalThis.fetch, log = () => {} }) {
  const report = { at: new Date().toISOString(), baseURL: normalizeBaseURL(baseURL), models: [], errors: [] }
  let available = []
  try {
    const res = await fetchImpl(`${normalizeBaseURL(baseURL)}/models`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    })
    const json = await res.json()
    available = (json?.data ?? []).map((item) => item?.id).filter(Boolean)
  } catch (error) {
    report.errors.push(`网关不可用：${String(error?.message || error)}`)
    log(report.errors[0])
    return report
  }
  for (const model of models) {
    const entry = { model, available: available.includes(model), result: null }
    if (!entry.available) {
      entry.skipped = true
      // 仍然尝试一次，兼容不实现 /models 的网关。
      log(`模型 ${model} 不在 /models 列表里，仍尝试调用`)
    }
    entry.result = await benchModel({ baseURL, apiKey, model, fetchImpl })
    report.models.push(entry)
  }
  return report
}

function fmtMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : '—'
}

export function formatReport(report) {
  const lines = []
  lines.push(`网关：${report.baseURL || '—'}  ·  ${report.at}`)
  if (report.errors?.length) lines.push(`错误：${report.errors.join('；')}`)
  for (const entry of report.models ?? []) {
    const result = entry.result ?? {}
    const stream = result.stream ?? {}
    const tools = result.tools ?? {}
    lines.push('')
    lines.push(`【${entry.model}】${entry.available ? '' : '（/models 未列出，已尝试）'}`)
    lines.push(`  非流式：${result.chat?.ok ? 'ok' : '失败'} · ${fmtMs(result.chat?.ms)} · usage ${JSON.stringify(result.chat?.usage ?? null)}`)
    if (stream.ok) {
      lines.push(
        `  流式：TTFB ${fmtMs(stream.ttfbMs)} · 总 ${fmtMs(stream.ms)} · ${stream.chunks} chunk · 输出 ${stream.usage?.completion_tokens ?? '?'} tok · ${stream.tokensPerSecond ?? '?'} tok/s` +
          (stream.reasoningChars ? ` · 思考 ${stream.reasoningChars} 字符` : ' · 无思考流'),
      )
    } else {
      lines.push(`  流式：失败${stream.error ? ` · ${stream.error}` : stream.reason ? ` · ${stream.reason}` : ''}`)
    }
    lines.push(
      `  工具调用：${tools.ok ? `ok · ${fmtMs(tools.ms)} · finish ${tools.finish || '—'} · ${tools.toolCalls ?? 0} 个调用${tools.names?.length ? `（${tools.names.join(', ')}）` : ''}` : `失败${tools.error ? ` · ${tools.error}` : ''}`}`,
    )
  }
  return lines.join('\n')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const baseURL = process.env.GW_BASE || process.env.SEEU_GW_BASE || ''
  const apiKey = process.env.GW_KEY || process.env.SEEU_GW_KEY || ''
  const models = String(process.env.GW_MODELS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!baseURL) {
    console.error('缺少网关地址：GW_BASE=http://127.0.0.1:8080/v1 GW_KEY=sk-... [GW_MODELS=...]')
    process.exit(2)
  }
  const report = await runBench({
    baseURL,
    apiKey,
    models: models.length ? models : DEFAULT_MODELS,
    log: (message) => console.error(message),
  })
  console.log(formatReport(report))
  const out = process.env.GW_BENCH_OUT || resolve(root, '.dev', 'bench', `gateway-${Date.now()}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`\n结果已写入 ${out}`)
  const failed = (report.models ?? []).filter((entry) => !entry.result?.chat?.ok || !entry.result?.stream?.ok || !entry.result?.tools?.ok)
  process.exit(report.errors?.length || failed.length ? 1 : 0)
}
