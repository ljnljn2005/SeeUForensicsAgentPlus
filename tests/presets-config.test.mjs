import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
  return yaml.load(readFileSync(OVERLAY, 'utf8'), { schema })
}

function presets(entries) {
  const out = new Map()
  for (const entry of entries) {
    const rows = Array.isArray(entry?.insert) ? entry.insert : [entry]
    for (const row of rows) {
      if (row?.id?.startsWith('preset-')) out.set(row.id, row)
    }
  }
  return out
}

function skillPlugin(preset) {
  return preset.config.plugins.find((p) => p.id === 'skill-filesystem')
}

const entries = loadOverlay()
const byId = presets(entries)

test('新增三个分析预设，顺序与名称正确', () => {
  for (const [id, name, order] of [
    ['preset-traffic', '流量分析（Traffic）', 3],
    ['preset-log', '日志分析（Log）', 4],
    ['preset-memory', '内存分析（Memory）', 5],
  ]) {
    const preset = byId.get(id)
    assert.ok(preset, `缺少 ${id}`)
    assert.equal(preset.name, '@deepseek-ai/dsh-agent-preset')
    assert.equal(preset.config.name, name)
    assert.equal(preset.config.order, order)
    assert.ok(preset.config.description.length > 10)
  }
})

test('流量/日志预设注入 lovelyspark-cli 技能根，内存预设注入 lovelymem-cli', () => {
  const expect = {
    'preset-traffic': 'SEEU_SKILL_SET_TRAFFIC',
    'preset-log': 'SEEU_SKILL_SET_LOG',
    'preset-memory': 'SEEU_SKILL_SET_MEMORY',
  }
  for (const [id, env] of Object.entries(expect)) {
    const dirs = skillPlugin(byId.get(id)).config.customSkillDirs
    assert.equal(typeof dirs?.js, 'string', `${id} 的 customSkillDirs 不是 !!js 表达式`)
    assert.match(dirs.js, new RegExp(env), `${id} 没有引用 ${env}`)
  }
  // persona 里要真的告诉模型用哪个 CLI 技能
  assert.match(byId.get('preset-traffic').config.plugins[0].config.prefix, /lovelyspark-cli/)
  assert.match(byId.get('preset-log').config.plugins[0].config.prefix, /lovelyspark-cli/)
  assert.match(byId.get('preset-memory').config.plugins[0].config.prefix, /lovelymem-cli/)
})

test('取证预设不再引用分组技能根（只在默认根里保留通用技能）', () => {
  for (const id of ['preset-standard', 'preset-seeu-lite']) {
    const dirs = skillPlugin(byId.get(id)).config?.customSkillDirs
    assert.equal(dirs, undefined, `${id} 不应配置 customSkillDirs`)
  }
})

test('随包技能目录：通用技能在 skills/，lovelyspark/lovelymem 在 skill-sets/', () => {
  const skills = readdirSync(join(REPO, 'resources', 'forensics', 'skills'))
  assert.ok(skills.includes('ges-case-index'))
  assert.ok(skills.includes('lovelycarve-forensics'))
  assert.ok(!skills.includes('lovelymem-cli'), 'lovelymem 不应再装在默认技能根')
  assert.ok(!skills.includes('lovelyspark-cli'), 'lovelyspark 不应再装在默认技能根')

  const setRoot = join(REPO, 'resources', 'forensics', 'skill-sets')
  for (const [id, skill] of [
    ['traffic', 'lovelyspark-cli'],
    ['log', 'lovelyspark-cli'],
    ['memory', 'lovelymem-cli'],
  ]) {
    const dir = join(setRoot, id)
    assert.ok(existsSync(join(dir, skill, 'SKILL.md')), `skill-sets/${id}/${skill}/SKILL.md 不存在`)
  }
})
