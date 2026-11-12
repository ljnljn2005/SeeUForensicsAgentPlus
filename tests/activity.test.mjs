import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ACTIVITY_MAX,
  activityFile,
  clearActivity,
  formatActivityDuration,
  formatActivitySummary,
  readActivity,
  recordActivity,
  removeActivity,
  summarizeActivity
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

test('summarizeActivity：窗口内统计建库平均用时与导入条数，窗口外忽略', () => {
  const now = Date.parse('2026-11-13T00:00:00Z')
  const entries = [
    { kind: 'build', at: '2026-11-12T20:00:00Z', durationMs: 120000 },
    { kind: 'build', at: '2026-11-11T20:00:00Z', durationMs: 60000 },
    { kind: 'myos-import', at: '2026-11-12T21:00:00Z', rows: 1234 },
    { kind: 'myos-import', at: '2026-10-01T00:00:00Z', rows: 9999 },
    { kind: 'build', at: 'not-a-date', durationMs: 1 },
  ]
  const summary = summarizeActivity(entries, now)
  assert.equal(summary.builds, 2)
  assert.equal(summary.imports, 1)
  assert.equal(summary.avgBuildMs, 90000)
  assert.equal(summary.rows, 1234)
  assert.equal(summary.total, 3)
  const text = formatActivitySummary(summary)
  assert.match(text, /近 7 天/)
  assert.match(text, /建库 2 次（平均 1 分 30 秒）/)
  assert.match(text, /MYOS 导入 1 次，1,234 条/)
})

test('summarizeActivity：空列表/坏输入返回 0，文案为空串', () => {
  const summary = summarizeActivity(undefined, Date.now())
  assert.equal(summary.total, 0)
  assert.equal(summary.avgBuildMs, null)
  assert.equal(formatActivitySummary(summary), '')
  assert.equal(formatActivitySummary(null), '')
  assert.equal(formatActivityDuration(0), '0 秒')
  assert.equal(formatActivityDuration(5000), '5 秒')
  assert.equal(formatActivityDuration(125000), '2 分 5 秒')
  assert.equal(formatActivityDuration(3725000), '1 小时 2 分')
})

test('summarizeActivity：按天分桶（最近 N 天，最后一天是今天，窗口外不计）', () => {
  const now = Date.parse('2026-11-13T05:00:00+08:00')
  const entries = [
    { kind: 'build', at: '2026-11-13T04:00:00+08:00', durationMs: 120000 },
    { kind: 'myos-import', at: '2026-11-12T10:00:00+08:00', rows: 10 },
    { kind: 'build', at: '2026-11-11T09:00:00+08:00', durationMs: 60000 },
    { kind: 'build', at: '2026-11-01T09:00:00+08:00', durationMs: 60000 },
  ]
  const summary = summarizeActivity(entries, now)
  assert.equal(summary.buckets.length, 7)
  assert.deepEqual(summary.buckets[6], { date: '2026-11-13', builds: 1, imports: 0, total: 1 })
  assert.deepEqual(summary.buckets[5], { date: '2026-11-12', builds: 0, imports: 1, total: 1 })
  assert.deepEqual(summary.buckets[4], { date: '2026-11-11', builds: 1, imports: 0, total: 1 })
  assert.equal(summary.buckets.reduce((sum, item) => sum + item.total, 0), 3)
  assert.equal(summary.builds, 2)
})

test('removeActivity：按 at+title 精确删除一条，未命中不改文件', () => {
  const { env, cleanup } = tempEnv()
  try {
    const first = recordActivity({ kind: 'build', title: 'case-a' }, env)
    recordActivity({ kind: 'myos-import', title: 'case-b', rows: 3 }, env)
    assert.equal(readActivity(env).length, 2)
    const next = removeActivity({ at: first.at, title: first.title }, env)
    assert.equal(next.length, 1)
    assert.equal(next[0].title, 'case-b')
    assert.equal(readActivity(env).length, 1)
    const unchanged = removeActivity({ at: 'nope', title: 'nope' }, env)
    assert.equal(unchanged.length, 1)
    assert.equal(readActivity(env).length, 1)
  } finally {
    cleanup()
  }
})
