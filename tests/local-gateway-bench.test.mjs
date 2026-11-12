import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import {
  benchModel,
  normalizeBaseURL,
  readSSE,
  runBench,
  tokensPerSecond,
} from '../scripts/bench/local-gateway-bench.mjs'

const MODELS = ['qwen3.8-flash-next', 'dsv4.1-flash']

function startMockGateway() {
  const server = createServer((req, res) => {
    const sendJson = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      return sendJson(200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) })
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        const body = JSON.parse(raw || '{}')
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
          const events = [
            { choices: [{ delta: { reasoning_content: '先想一下。' } }] },
            { choices: [{ delta: { content: '电子数据取证是' } }] },
            { choices: [{ delta: { content: '依法提取分析电子数据。' } }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 } },
          ]
          for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
          res.write('data: [DONE]\n\n')
          return res.end()
        }
        if (Array.isArray(body.tools) && body.tools.length) {
          return sendJson(200, {
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ping_tool', arguments: '{"text":"hello"}' } }],
                },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
          })
        }
        return sendJson(200, {
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '收到' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        })
      })
      return
    }
    sendJson(404, { error: { message: 'not found' } })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

test('normalizeBaseURL 归一', () => {
  assert.equal(normalizeBaseURL('http://127.0.0.1:8080/v1/'), 'http://127.0.0.1:8080/v1')
  assert.equal(normalizeBaseURL('http://x/v1/chat/completions'), 'http://x/v1')
  assert.equal(normalizeBaseURL(''), '')
})

test('tokensPerSecond', () => {
  assert.equal(tokensPerSecond(10, 2000), 5)
  assert.equal(tokensPerSecond(0, 1000), 0)
  assert.equal(tokensPerSecond(10, 0), null)
  assert.equal(tokensPerSecond(null, 100), null)
})

test('readSSE 解析思考流、正文与 usage', async () => {
  const { server, port } = await startMockGateway()
  try {
    const result = await readSSE(fetch, `http://127.0.0.1:${port}/v1/chat/completions`, '', {
      model: 'qwen3.8-flash-next',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    })
    assert.equal(result.ok, true)
    assert.ok(Number.isFinite(result.ttfbMs))
    assert.equal(result.chunks, 4)
    assert.equal(result.reasoningChars, 5)
    assert.ok(result.contentChars > 0)
    assert.equal(result.usage.completion_tokens, 9)
    assert.equal(result.finish, 'stop')
  } finally {
    server.close()
  }
})

test('benchModel 三项都拿到数字', async () => {
  const { server, port } = await startMockGateway()
  try {
    const result = await benchModel({
      baseURL: `http://127.0.0.1:${port}/v1/`,
      apiKey: 'test-key',
      model: 'qwen3.8-flash-next',
    })
    assert.equal(result.chat.ok, true)
    assert.equal(result.chat.content, '收到')
    assert.equal(result.chat.usage.total_tokens, 7)
    assert.equal(result.stream.ok, true)
    assert.ok(result.stream.tokensPerSecond > 0)
    assert.equal(result.tools.ok, true)
    assert.equal(result.tools.toolCalls, 1)
    assert.deepEqual(result.tools.names, ['ping_tool'])
    assert.equal(result.tools.finish, 'tool_calls')
  } finally {
    server.close()
  }
})

test('runBench 遍历两个模型并标出缺失模型', async () => {
  const { server, port } = await startMockGateway()
  try {
    const report = await runBench({
      baseURL: `http://127.0.0.1:${port}/v1`,
      apiKey: '',
      models: ['qwen3.8-flash-next', 'dsv4.1-flash', 'ghost-model'],
    })
    assert.deepEqual(report.errors, [])
    assert.equal(report.models.length, 3)
    assert.equal(report.models[0].available, true)
    assert.equal(report.models[1].available, true)
    assert.equal(report.models[2].available, false)
    for (const entry of report.models) assert.equal(entry.result.tools.toolCalls, 1)
  } finally {
    server.close()
  }
})

test('网关不可用时返回错误而不是抛异常', async () => {
  const report = await runBench({ baseURL: 'http://127.0.0.1:1/v1', apiKey: '', models: MODELS })
  assert.equal(report.errors.length, 1)
  assert.match(report.errors[0], /网关不可用/)
})
