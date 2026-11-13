import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OVERLAY = join(REPO, 'resources', 'forensics', 'cordis.patch.yml')

// dsh 的 overlay 方言：`!!js <expr>` 是标量，这里保留表达式文本，不执行。
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ js: data }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

function insertRows() {
  const layers = yaml.load(readFileSync(OVERLAY, 'utf8'), { schema })
  const rows = []
  for (const layer of layers) {
    if (layer && Array.isArray(layer.insert)) rows.push(...layer.insert)
  }
  return rows
}

test('星睿连接器：7 个 streamable-http MCP，端口与星睿客户端一致', () => {
  const rows = insertRows().filter((row) => String(row?.id ?? '').startsWith('seeu-mcp-xingrui-'))
  assert.equal(rows.length, 7, '应有 7 个星睿连接器（computer/server/data/files/iot/apk/traffic）')

  const byServer = new Map(rows.map((row) => [row.config.serverName, row.config]))
  const expected = {
    'xingrui-computer': 'http://127.0.0.1:30188/mcp',
    'xingrui-server': 'http://127.0.0.1:30190/mcp',
    'xingrui-data': 'http://127.0.0.1:30191/mcp',
    'xingrui-files': 'http://127.0.0.1:30193/mcp',
    'xingrui-iot': 'http://127.0.0.1:30196/mcp',
    'xingrui-apk': 'http://127.0.0.1:30195/mcp/',
    'xingrui-traffic': 'http://127.0.0.1:3008/mcp/streamable',
  }
  for (const [server, url] of Object.entries(expected)) {
    const config = byServer.get(server)
    assert.ok(config, `缺少 ${server}`)
    assert.equal(config.transport, 'streamable-http')
    assert.equal(config.url, url)
    assert.equal(config.failOnStartupError, false, `${server} 未运行时应只告警`)
    assert.ok(config.toolCallTimeoutMs >= 120000, `${server} 工具调用超时应放宽`)
    assert.equal(config.reconnect?.enabled, true, `${server} 应自动重连`)
  }
  for (const row of rows) {
    assert.equal(row.name, '@deepseek-ai/dsh-mcp-client', `${row.id} 应使用 dsh-mcp-client`)
  }
})

test('MYOS MCP 仍以 stdio 注册', () => {
  const row = insertRows().find((item) => item?.id === 'seeu-mcp-myos')
  assert.ok(row, '缺少 seeu-mcp-myos')
  assert.equal(row.config.transport, 'stdio')
  assert.equal(row.config.serverName, 'myos-forensics')
  assert.match(String(row.config.command), /myos_mcp_server\.exe$/i)
})
