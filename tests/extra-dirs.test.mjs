import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { extraDirsFile, forgetExtraDir, readExtraDirs, rememberExtraDir } from '../tools/ges-index/extra-dirs.mjs'

function withHome(fn) {
  return () => {
    const home = mkdtempSync(join(tmpdir(), 'seeu-extra-'))
    const env = { SEEU_DSH_HOME: home }
    try {
      fn(env, home)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
}

test('extraDirsFile：默认在 DSH_HOME 下，可由环境变量覆盖', () => {
  assert.equal(extraDirsFile({ SEEU_DSH_HOME: 'D:/x/dsh-home' }).split(String.fromCharCode(92)).join('/'), 'D:/x/dsh-home/index-extra-dirs.json')
  assert.equal(extraDirsFile({ SEEU_INDEX_EXTRA_DIRS: 'D:/x/e.json' }).split(String.fromCharCode(92)).join('/'), 'D:/x/e.json')
  assert.equal(extraDirsFile({}), '')
})

test('rememberExtraDir：记录、去重、最近优先', withHome((env, home) => {
  const a = join(home, 'case-a')
  const b = join(home, 'case-b')
  mkdirSync(a, { recursive: true })
  mkdirSync(b, { recursive: true })
  rememberExtraDir(a, env)
  rememberExtraDir(b, env)
  assert.deepEqual(readExtraDirs(env), [b, a])
  rememberExtraDir(a, env)
  assert.deepEqual(readExtraDirs(env), [a, b])
  const saved = JSON.parse(readFileSync(extraDirsFile(env), 'utf8'))
  assert.equal(saved.dirs.length, 2)
  assert.ok(saved.updatedAt)
}))

test('rememberExtraDir：忽略相对路径与不存在的目录', withHome((env, home) => {
  rememberExtraDir('relative/dir', env)
  rememberExtraDir(join(home, 'nope'), env)
  assert.deepEqual(readExtraDirs(env), [])
  assert.equal(existsSync(extraDirsFile(env)), false)
}))

test('readExtraDirs：坏 JSON 不抛错，读时过滤非绝对路径', withHome((env, home) => {
  const a = join(home, 'case-a')
  mkdirSync(a, { recursive: true })
  const file = extraDirsFile(env)
  writeFileSync(file, '{bad json', 'utf8')
  assert.deepEqual(readExtraDirs(env), [])
  writeFileSync(file, JSON.stringify({ dirs: [a, 'rel/path', 42] }), 'utf8')
  assert.deepEqual(readExtraDirs(env), [a])
}))

test('forgetExtraDir：只移除指定目录，大小写不敏感', withHome((env, home) => {
  const a = join(home, 'case-a')
  const b = join(home, 'case-b')
  mkdirSync(a, { recursive: true })
  mkdirSync(b, { recursive: true })
  rememberExtraDir(a, env)
  rememberExtraDir(b, env)
  const left = forgetExtraDir(a.toUpperCase(), env)
  assert.deepEqual(left.map((item) => item.toLowerCase()), [b.toLowerCase()])
  assert.deepEqual(readExtraDirs(env).map((item) => item.toLowerCase()), [b.toLowerCase()])
  // 移除不存在的目录不报错也不改清单
  assert.deepEqual(forgetExtraDir(join(home, 'nope'), env).length, 1)
}))
