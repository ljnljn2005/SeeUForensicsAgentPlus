import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SKILL_SET_IDS, RETIRED_SKILL_DIRS, installSkillSet, removeRetiredSkills, skillSetHomeDir, skillSetsHomeDir } from '../tools/skill-sets.mjs'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'seeu-skill-sets-'))
  const src = join(dir, 'resources', 'skill-sets', 'traffic')
  const skillDir = join(src, 'lovelyspark-cli')
  mkdirSync(join(skillDir, 'references'), { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), '# lovelyspark\n')
  writeFileSync(join(skillDir, 'references', 'cli.md'), 'usage\n')
  const home = join(dir, 'home')
  mkdirSync(join(home, 'skills', 'lovelymem-cli'), { recursive: true })
  writeFileSync(join(home, 'skills', 'lovelymem-cli', 'SKILL.md'), '# old\n')
  mkdirSync(join(home, 'skills', 'lovelyspark-cli'), { recursive: true })
  writeFileSync(join(home, 'skills', 'lovelyspark-cli', 'SKILL.md'), '# old\n')
  mkdirSync(join(home, 'skills', 'ges-case-index'), { recursive: true })
  writeFileSync(join(home, 'skills', 'ges-case-index', 'SKILL.md'), '# keep\n')
  return { dir, src, home }
}

test('skillSet 目录常量', () => {
  assert.deepEqual(SKILL_SET_IDS, ['traffic', 'log', 'memory'])
  assert.deepEqual(RETIRED_SKILL_DIRS, ['lovelymem-cli', 'lovelyspark-cli'])
  assert.equal(skillSetsHomeDir('H:/h'), join('H:/h', 'skill-sets'))
  assert.equal(skillSetHomeDir('H:/h', 'memory'), join('H:/h', 'skill-sets', 'memory'))
})

test('installSkillSet 复制整组技能并幂等', () => {
  const { dir, src, home } = fixture()
  try {
    const first = installSkillSet({ sourceDir: src, homeDir: home, id: 'traffic', version: '0.3.2' })
    assert.equal(first.changed, true)
    assert.deepEqual(first.skills, ['lovelyspark-cli'])
    assert.equal(first.files, 2)
    assert.equal(readFileSync(join(first.dir, 'lovelyspark-cli', 'references', 'cli.md'), 'utf8'), 'usage\n')
    assert.match(readFileSync(join(first.dir, '.seeu-skill-set.json'), 'utf8'), /0\.3\.2/)

    const second = installSkillSet({ sourceDir: src, homeDir: home, id: 'traffic', version: '0.3.2' })
    assert.equal(second.changed, false)
    assert.deepEqual(second.skills, ['lovelyspark-cli'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('installSkillSet 源目录不存在时返回空结果，不抛错', () => {
  const { dir, home } = fixture()
  try {
    const result = installSkillSet({ sourceDir: join(dir, 'nope'), homeDir: home, id: 'memory', version: '0.3.2' })
    assert.deepEqual(result, { id: 'memory', dir: skillSetHomeDir(home, 'memory'), skills: [], files: 0, changed: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('removeRetiredSkills 只清掉分组技能，保留默认根其它技能', () => {
  const { dir, home } = fixture()
  try {
    const { removed } = removeRetiredSkills(home)
    assert.deepEqual(removed.sort(), ['lovelymem-cli', 'lovelyspark-cli'])
    assert.equal(readFileSync(join(home, 'skills', 'ges-case-index', 'SKILL.md'), 'utf8'), '# keep\n')
    assert.deepEqual(removeRetiredSkills(home).removed, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
