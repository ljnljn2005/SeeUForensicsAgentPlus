#!/usr/bin/env node
/**
 * 打包前校验：用随包的 @deepseek-ai/dsh 把 resources/forensics/cordis.patch.yml
 * 与 web profile 组合一遍（--dump-config，隔离 DSH_HOME），确认 overlay 可被解析、
 * 目标行都存在、工具面与设计一致。
 *
 * 起因：v0.1.2 打包时 overlay 正在被改写，asar 里落进了半截内容 —— 应用启动时
 * `failed to parse overlay ... YAMLException`，外壳只能显示错误页。该检查接入
 * package:dir / package:win 的 prepackage 钩子，打包前直接失败，不再产出坏包。
 *
 * 用法：node scripts/check-overlay.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const overlay = path.join(root, 'resources', 'forensics', 'cordis.patch.yml')
const cli = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const failures = []
const fail = (message) => failures.push(message)

/** 从 dump 中截出 preset-standard 的 plugins 段，避免与 web-app patch 的顶层行混淆。 */
function presetSection(dump) {
  const lines = dump.split(/\r?\n/)
  const start = lines.findIndex((line) => line === '- id: preset-standard')
  if (start < 0) return ''
  const end = lines.findIndex((line, index) => index > start && /^- id: /.test(line))
  return lines.slice(start, end < 0 ? undefined : end).join('\n')
}

function main() {
  const source = readFileSync(overlay, 'utf8')
  if (!source.startsWith('# SeeUForensicsAgentPlus')) {
    fail('overlay 文件头不对（可能被其它写入覆盖成别的内容）')
  }

  const home = mkdtempSync(path.join(tmpdir(), 'seeu-overlay-check-'))
  try {
    const result = spawnSync(
      process.execPath,
      [cli, '--patch', overlay, '--profile', 'web', '--dump-config'],
      {
        cwd: root,
        env: { ...process.env, DSH_HOME: home, NO_COLOR: '1' },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
      },
    )

    const stderr = result.stderr ?? ''
    const dump = result.stdout ?? ''

    if (result.status !== 0) fail(`--dump-config 退出码 ${String(result.status)}`)
    if (stderr.trim() !== '') fail(`stderr 非空：${stderr.trim().split(/\r?\n/)[0]}`)
    if (/failed to parse overlay/.test(stderr)) fail('overlay 解析失败（YAML 语法/编码）')
    if (/patch: entry .* not found/.test(stderr)) fail('overlay 有未命中的行 id')

    const preset = presetSection(dump)
    if (!preset) fail('dump 里找不到 preset-standard')

    // preset 里的行缩进 6 空格，去掉后按顶层 entry 逐块比对。
    const entries = preset
      .replace(/^ {6}(?=- id: )/gm, '')
      .split(/^(?=- id: )/m)
      .filter((block) => block.startsWith('- id: '))
    const ids = new Set(
      entries.map((block) => /^- id: (\S+)/.exec(block)?.[1]).filter(Boolean),
    )

    const required = [
      'persona',
      'agent-instructions',
      'time-context',
      'tool-bash',
      'tool-pwsh',
      'tool-fs',
      'tool-fs-search',
      'tool-jobs',
      'tool-schedule',
      'skill-filesystem',
      'tool-skill',
      'command-goal',
      'tool-goal',
      'planning',
      'compaction',
      'delegation',
      'tool-ask-user',
      'tool-todo',
      'present',
    ]
    for (const id of required) {
      if (!ids.has(id)) fail(`preset 缺少工具行：${id}`)
    }
    if (ids.has('tool-web')) fail('preset 里仍有 tool-web（联网抓取应关闭）')

    const toolFs = entries.find((block) => block.startsWith('- id: tool-fs')) ?? ''
    if (!/write: false/.test(toolFs) || !/edit: false/.test(toolFs)) {
      fail('tool-fs 未收敛为只读（write/edit 应为 false）')
    }
    if (!/name: 取证分析（Forensics）/.test(preset)) fail('preset 名称不是取证预设名')

    const lineCount = dump.trimEnd().split(/\r?\n/).length
    if (lineCount < 1200) fail(`dump 行数异常（${String(lineCount)}），配置可能没生效`)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    console.error('[check-overlay] 失败：')
    for (const message of failures) console.error(`  - ${message}`)
    process.exit(1)
  }
  console.log('[check-overlay] OK：overlay 可解析，preset 工具面符合取证设计')
}

main()
