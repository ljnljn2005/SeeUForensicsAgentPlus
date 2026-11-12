import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEnvReport, formatEnvReport, worstStatus } from '../tools/env-report.mjs'

const fullFacts = () => ({
  tools: { total: 13, ready: 13, missing: [] },
  plugins: { bundles: 6, missing: [] },
  skills: { bundled: 6, sets: ['traffic', 'log', 'memory', 'qiko'], installed: 6 },
  mounts: { found: true, version: '1.3.0', active: 0 },
  myos: { path: 'D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe', found: true },
  indexDirs: { total: 1, existing: 1, missing: [] },
  localModel: { exists: true, config: { enabled: true, models: [{ id: 'qwen3.8-flash-next' }], contextWindow: 131072 } },
})

test('齐全环境：七项全 ok，报告 ok', () => {
  const report = buildEnvReport(fullFacts(), Date.parse('2026-11-13T00:00:00Z'))
  assert.equal(report.items.length, 7)
  assert.equal(report.summary.fail, 0)
  assert.equal(report.summary.warn, 0)
  assert.equal(report.ok, true)
  assert.equal(report.checkedAt, '2026-11-13T00:00:00.000Z')
  assert.deepEqual(
    report.items.map((item) => item.key),
    ['plugins', 'skills', 'tools', 'localModel', 'mounts', 'myos', 'indexDirs'],
  )
})

test('外部工具缺一半以上判 fail，少量缺失判 warn 并列出缺失项', () => {
  const most = buildEnvReport({ ...fullFacts(), tools: { total: 13, ready: 2, missing: ['StarMem', 'IDA', 'jadx'] } })
  const tools = most.items.find((item) => item.key === 'tools')
  assert.equal(tools.status, 'fail')
  assert.match(tools.detail, /2\/13 已就绪/)
  assert.match(tools.detail, /StarMem、IDA、jadx/)
  assert.equal(most.ok, false)

  const some = buildEnvReport({ ...fullFacts(), tools: { total: 13, ready: 12, missing: ['7-Zip'] } })
  assert.equal(some.items.find((item) => item.key === 'tools').status, 'warn')
})

test('插件缺包 / 挂载 CLI 未配置 / 本机模型未配置 → warn 且带提示', () => {
  const report = buildEnvReport({
    ...fullFacts(),
    plugins: { bundles: 6, missing: ['billion-context'] },
    mounts: { found: false, error: '未配置 LovelyCarve CLI' },
    localModel: { exists: false },
  })
  const plugins = report.items.find((item) => item.key === 'plugins')
  assert.equal(plugins.status, 'fail')
  assert.match(plugins.detail, /缺包 billion-context/)
  assert.match(plugins.hint, /重装 SeeU/)

  const mounts = report.items.find((item) => item.key === 'mounts')
  assert.equal(mounts.status, 'warn')
  assert.match(mounts.hint, /lovelycarve-cli\.exe/)

  const localModel = report.items.find((item) => item.key === 'localModel')
  assert.equal(localModel.status, 'warn')
  assert.match(localModel.hint, /Spark 单机\/双机预设/)
})

test('空事实不抛异常；worstStatus / formatEnvReport 可用', () => {
  const report = buildEnvReport({})
  assert.equal(report.ok, false)
  assert.ok(report.summary.warn + report.summary.fail >= 7)
  const text = formatEnvReport(report)
  assert.match(text, /环境体检/)
  assert.match(text, /合计：/)
  assert.equal(worstStatus([{ status: 'ok' }, { status: 'warn' }]), 'warn')
  assert.equal(worstStatus([]), 'ok')
})
