import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildEnvReport,
  envFixTargets,
  envReportMarkdown,
  formatEnvReport,
  worstStatus
} from '../tools/env-report.mjs'

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

test('envReportMarkdown：标题/合计/表格行/提示列', () => {
  const report = buildEnvReport(
    {
      plugins: { total: 6, resolvable: 6 },
      skills: { bundled: 6, skillSets: 4, installed: 6 },
      tools: { ready: 13, total: 13 },
      localModel: { enabled: false },
      mounts: { cliConfigured: false, active: 0 },
      myos: { mcpPath: 'D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe' },
      indexDirs: [],
    },
    Date.parse('2026-11-13T06:00:00+08:00'),
  )
  const markdown = envReportMarkdown(report)
  assert.match(markdown, /^# SeeU 运行环境体检/)
  assert.match(markdown, /\| 项目 \| 状态 \| 详情 \| 提示 \|/)
  assert.match(markdown, /\*\*\d+ 项正常 \/ \d+ 项注意 \/ \d+ 项不可用\*\*/)
  const lines = markdown.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| 项目') && !line.startsWith('| ---'))
  assert.equal(lines.length, report.items.length)
  assert.ok(lines.some((line) => line.includes('案件索引目录')))
  assert.ok(lines.some((line) => line.includes('→') === false))
})

test('envFixTargets：只认可自动修复且状态非 ok 的项', () => {
  const report = buildEnvReport(
    {
      plugins: { bundles: 6, missing: ['billion-context'] },
      skills: { bundled: 5, installed: 0, sets: ['qiko'] },
      tools: { ready: 10, total: 13 },
      localModel: { configured: false, enabled: false, model: '' },
      mounts: { cliConfigured: true, cliFound: true, mounts: 0 },
      myos: { configured: false, path: '' },
      indexDirs: { dirs: 0 },
    },
    Date.parse('2026-11-13T00:00:00Z'),
  )
  assert.deepEqual(envFixTargets(report).sort(), ['plugins', 'skills'])
  const okReport = buildEnvReport(
    {
      plugins: { bundles: 6, missing: [] },
      skills: { bundled: 5, installed: 6, sets: ['traffic', 'log', 'memory', 'qiko'] },
      tools: { ready: 13, total: 13 },
      localModel: { configured: true, enabled: true, model: 'deepseek-flash' },
      mounts: { cliConfigured: true, cliFound: true, mounts: 0 },
      myos: { configured: true, path: 'D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe' },
      indexDirs: { dirs: 2 },
    },
    Date.parse('2026-11-13T00:00:00Z'),
  )
  assert.deepEqual(envFixTargets(okReport), [])
})
