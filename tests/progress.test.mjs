import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILD_PHASE_LABELS,
  buildPhaseLabel,
  formatDuration,
  describeBuildProgress,
} from '../tools/ges-index/progress.mjs'

test('buildPhaseLabel 覆盖各阶段并回退原文', () => {
  assert.equal(buildPhaseLabel('fetch'), '读取检材数据')
  assert.equal(buildPhaseLabel('enumerate'), '枚举检材')
  assert.equal(buildPhaseLabel('done'), '完成')
  assert.equal(buildPhaseLabel('custom-phase'), 'custom-phase')
  assert.equal(buildPhaseLabel(undefined), '建库')
  assert.equal(Object.keys(BUILD_PHASE_LABELS).length, 6)
})

test('formatDuration 输出紧凑中文时长', () => {
  assert.equal(formatDuration(0), '0 秒')
  assert.equal(formatDuration(120), '不足 1 秒')
  assert.equal(formatDuration(4200), '4.2 秒')
  assert.equal(formatDuration(12_340), '12 秒')
  assert.equal(formatDuration(83_000), '1 分 23 秒')
})

test('running 任务用 startedAt 计算实时 elapsedMs', () => {
  const job = { status: 'running', phase: 'records', startedAt: 1000, completed: 1200, total: 22777, percent: 5 }
  const view = describeBuildProgress({ ...job, phase: 'fetch' }, 13_400)
  assert.equal(view.running, true)
  assert.equal(view.elapsedMs, 12_400)
  assert.equal(view.elapsedText, '12 秒')
  assert.equal(view.phaseLabel, '读取检材数据')
  assert.equal(view.detail, '1,200 / 22,777 条 · 5%')
  assert.equal(view.hint, '')
})

test('running 超过 90 秒给「可切走」提示，用 elapsedMs 优先并带 ETA', () => {
  const job = { status: 'running', phase: 'finalize', startedAt: 0, elapsedMs: 125_000, etaMs: 42_000, percent: 60 }
  const view = describeBuildProgress(job, 999_999)
  assert.equal(view.elapsedMs, 125_000)
  assert.equal(view.elapsedText, '2 分 5 秒')
  assert.equal(view.etaText, '42 秒')
  assert.match(view.hint, /可以.*其他视图.*后台继续/)
})

test('done 给出记录/实体/索引体积摘要，failed 给出错误摘要', () => {
  const done = describeBuildProgress({
    status: 'done',
    phase: 'done',
    startedAt: 0,
    elapsedMs: 34_500,
    result: { manifest: { counts: { records: 22777, entities: 8191 }, sizeBytes: 12_582_912 } },
  })
  assert.equal(done.percent, 0)
  assert.match(done.summary, /建库完成：22,777 条记录 · 8,191 个实体 · 用时 35 秒/)
  assert.match(done.summary, /索引 12\.0 MiB/)
  assert.equal(done.hint, '')

  const failed = describeBuildProgress({ status: 'failed', phase: 'records', code: 'E_GES', error: 'ges 不可用', elapsedMs: 5000 })
  assert.equal(failed.summary, '建库失败（E_GES）：ges 不可用')
})

test('同一目录已有运行中任务时复用，不重复建库', async () => {
  const { findRunningBuild } = await import('../tools/ges-index/progress.mjs')
  const dir = 'E:/cases/a'
  const jobs = [
    { id: 'done-1', dir, status: 'done' },
    { id: 'run-1', dir, status: 'running' },
    { id: 'run-2', dir: 'E:/cases/b', status: 'running' },
  ]
  assert.equal(findRunningBuild(jobs, dir)?.id, 'run-1')
  assert.equal(findRunningBuild(jobs, 'E:/cases/c'), null)
  assert.equal(findRunningBuild([], dir), null)
})
