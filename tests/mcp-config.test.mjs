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

function loadOverlay() {
  const layers = yaml.load(readFileSync(OVERLAY, 'utf8'), { schema })
  const entries = []
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue
    if (Array.isArray(layer.insert)) entries.push(...layer.insert)
    else if (layer.id) entries.push(layer)
  }
  return { layers, entries }
}

function presetPlugins(entries, id) {
  const preset = entries.find((entry) => entry?.id === id)
  assert.ok(preset, `缺少预设 ${id}`)
  const plugins = preset.config?.plugins
  assert.ok(Array.isArray(plugins), `${id} 缺少 plugins`)
  return plugins
}

function mcpRows(plugins) {
  return plugins.filter((row) => row?.name === '@deepseek-ai/dsh-mcp-client')
}

test('星睿连接器按预设注入，不再全局注册', () => {
  const { layers, entries } = loadOverlay()

  // 不应再有全局星睿连接器行（上一版是全量注册）。
  const globalXingrui = entries.filter((row) => String(row?.id ?? '').startsWith('seeu-mcp-xingrui'))
  assert.equal(globalXingrui.length, 0, '星睿连接器不应再作为全局 insert 行')

  const mapping = {
    'preset-standard': 'xingrui-server',
    'preset-mobile': 'xingrui-computer',
    'preset-apk': 'xingrui-apk',
    'preset-traffic': 'xingrui-traffic',
    'preset-data': 'xingrui-data',
    'preset-files': 'xingrui-files',
    'preset-iot': 'xingrui-iot',
  }
  for (const [preset, server] of Object.entries(mapping)) {
    const rows = mcpRows(presetPlugins(entries, preset))
    assert.equal(rows.length, 1, `${preset} 应恰好挂 1 个星睿连接器`)
    assert.equal(rows[0].config.serverName, server)
    assert.equal(rows[0].config.transport, 'streamable-http')
    assert.equal(rows[0].config.failOnStartupError, false)
    assert.ok(String(rows[0].config.url).startsWith('http://127.0.0.1:'))
  }

  // 轻量/专用预设保持不挂星睿（避免工具面膨胀与依赖星睿运行）。
  for (const preset of ['preset-seeu-lite', 'preset-log', 'preset-memory', 'preset-exe', 'preset-db']) {
    assert.equal(mcpRows(presetPlugins(entries, preset)).length, 0, `${preset} 不应挂星睿连接器`)
  }

  // 每个预设内的 MCP serverName 不应重复（同一 server 不能挂两次）。
  const allServers = []
  for (const entry of entries) {
    if (!entry?.id?.startsWith('preset-')) continue
    for (const row of mcpRows(entry.config?.plugins ?? [])) allServers.push(row.config.serverName)
  }
  assert.equal(new Set(allServers).size, allServers.length, '同一 serverName 被多个预设重复注册')

  // MYOS 仍是全局 stdio MCP。
  const myos = entries.find((row) => row?.id === 'seeu-mcp-myos')
  assert.ok(myos, '缺少全局 MYOS MCP')
  assert.equal(myos.config.transport, 'stdio')

  // SeeU 内置 MCP（索引列表 / 链路体检）：全局 stdio，命令与脚本路径由外壳注入。
  const seeu = entries.find((row) => row?.id === 'seeu-mcp-tools')
  assert.ok(seeu, '缺少全局 SeeU MCP')
  assert.equal(seeu.config.transport, 'stdio')
  assert.equal(seeu.config.serverName, 'seeu')
  assert.match(String(seeu.config.command?.js ?? ''), /SEEU_MCP_NODE/)
  assert.match(String(seeu.config.args?.js ?? ''), /SEEU_MCP_SERVER/)
})
