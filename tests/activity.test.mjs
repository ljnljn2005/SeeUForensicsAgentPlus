import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ACTIVITY_MAX,
  activityFile,
  clearActivity,
  readActivity,
  recordActivity,
} from '../tools/ges-index/activity.mjs'

const tempEnv = () => {
  const home = mkdtempSync(join(tmpdir(), 'seeu-activity-'))
  return { env: { SEEU_DSH_HOME: home }, home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

test('活动文件默认落在 DSH_HOME 下，可被 SEEU_INDEX_ACTIVITY 覆盖', () => {
  const { env, home, cleanup } = tempEnv()
  try {
    assert.equal(activityFile(env), join(home, 'index-activity.json'))
    assert.equal(activityFile({ ...env, SEEU_INDEX_ACTIVITY: 'D:/tmp/act.json' }).replace(/\\/g, '/'), 'D:/tmp/act.json')
  } finally {
    cleanup()
  }
})

test('recordActivity 最新在前，且只保留 ACTIVITY_MAX 条', () => {
  const { env, cleanup } = tempEnv()
  try {
    for (let i = 0; i < ACTIVITY_MAX + 5; i += 1) {
      recordActivity({ kind: 'build', title: `case-${i}` }, env)
    }
    const entries = readActivity(env)
    assert.equal(entries.length, ACTIVITY_MAX)
    assert.equal(entries[0].title, `case-${ACTIVITY_MAX + 4}`)
    assert.ok(entries[0].at)
  } finally {
    cleanup()
  }
})

test('clearActivity 清空；坏 JSON 读回空数组', () => {
  const { env, cleanup } = tempEnv()
  try {
    recordActivity({ kind: 'myos-import', title: 'M盘', rows: 10 }, env)
    assert.equal(readActivity(env).length, 1)
    clearActivity(env)
    assert.deepEqual(readActivity(env), [])
    writeFileSync(activityFile(env), '{bad json', 'utf8')
    assert.deepEqual(readActivity(env), [])
  } finally {
    cleanup()
  }
})

test('不存在的文件返回空数组且不创建目录', () => {
  const { env, home, cleanup } = tempEnv()
  try {
    assert.deepEqual(readActivity(env), [])
    assert.equal(existsSync(join(home, 'index-activity.json')), false)
  } finally {
    cleanup()
  }
})
