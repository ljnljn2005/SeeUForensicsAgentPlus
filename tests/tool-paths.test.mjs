import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  TOOL_PATH_SPECS,
  readToolPaths,
  saveToolPaths,
  toolPathsEnv,
  toolPathsFile,
  toolPathsView,
} from '../tools/tool-paths.mjs'

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'seeu-tool-paths-'))
  const env = { SEEU_DSH_HOME: home }
  return { home, env }
}

test('默认值：未配置时用实测默认路径，视图带 env/来源/存在性', () => {
  const { home, env } = sandbox()
  const view = toolPathsView(env)
  assert.equal(view.configFile, join(home, 'tool-paths.json'))
  assert.equal(view.tools.length, TOOL_PATH_SPECS.length)
  const ghidra = view.tools.find((t) => t.id === 'ghidra')
  assert.equal(ghidra.source, 'default')
  assert.match(ghidra.defaultPath, /ghidra-12\.1\.4$/)
  assert.equal(ghidra.env, 'SEEU_TOOL_GHIDRA')
  assert.ok(!existsSync(view.configFile))
})

test('保存文件路径：写入 JSON、重读生效、来源变 config', () => {
  const { env, home } = sandbox()
  const dir = join(home, 'tools')
  mkdirSync(dir)
  const exe = join(dir, 'tshark.exe')
  writeFileSync(exe, 'x')
  const res = saveToolPaths({ tshark: exe }, env)
  assert.equal(res.ok, true)
  assert.deepEqual(readToolPaths(env), { tshark: exe })
  const view = toolPathsView(env)
  const row = view.tools.find((t) => t.id === 'tshark')
  assert.equal(row.source, 'config')
  assert.equal(row.path, exe)
  assert.equal(row.found, true)
})

test('清空某个工具会回到默认值；目录类型拒绝文件', () => {
  const { env, home } = sandbox()
  const dir = join(home, 'g')
  mkdirSync(dir)
  const file = join(home, 'f.txt')
  writeFileSync(file, 'x')
  assert.equal(saveToolPaths({ ghidra: dir }, env).ok, true)
  assert.equal(saveToolPaths({ ghidra: '' }, env).ok, true)
  assert.equal(readToolPaths(env).ghidra, undefined)
  const bad = saveToolPaths({ ghidra: file }, env)
  assert.equal(bad.ok, false)
  assert.match(bad.error, /需要选择目录/)
  assert.equal(saveToolPaths({ tshark: 'relative/tshark.exe' }, env).ok, false)
  assert.equal(saveToolPaths({ tshark: join(home, 'nope.exe') }, env).ok, false)
})

test('坏 JSON 不覆盖原文件并报错', () => {
  const { env, home } = sandbox()
  const file = toolPathsFile(env)
  writeFileSync(file, '{oops', 'utf8')
  const view = toolPathsView(env)
  assert.ok(view.error)
  const res = saveToolPaths({ tshark: file }, env)
  assert.equal(res.ok, false)
  assert.equal(readFileSync(file, 'utf8'), '{oops')
})

test('toolPathsEnv 只注入存在的工具，环境变量名为 SEEU_TOOL_<ID>', () => {
  const { env, home } = sandbox()
  const dir = join(home, 'g')
  mkdirSync(dir)
  assert.equal(saveToolPaths({ ghidra: dir }, env).ok, true)
  const map = toolPathsEnv(env)
  assert.equal(map.SEEU_TOOL_GHIDRA, dir)
  for (const spec of TOOL_PATH_SPECS) {
    const value = map[spec.env]
    if (value) assert.equal(existsSync(value), true)
  }
})
