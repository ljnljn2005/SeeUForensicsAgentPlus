import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_STALE_DAYS,
  formatBytes,
  formatBuiltAt,
  indexSummary,
} from '../tools/ges-index/index-meta.mjs'

const NOW = new Date('2026-11-12T16:00:00.000Z').getTime()

test('formatBytes / formatBuiltAt 基本格式', () => {
  assert.equal(formatBytes(0), '0 MiB')
  assert.equal(formatBytes(1024 * 1024 * 63), '63.0 MiB')
  assert.equal(formatBytes(1024 * 1024 * 1024 * 1.5), '1.50 GiB')
  assert.equal(formatBuiltAt('2026-11-12T23:52:00+08:00'), '2026-11-12 23:52')
  assert.equal(formatBuiltAt('not-a-date'), '')
  assert.equal(formatBuiltAt(undefined), '')
})

test('indexSummary 组合规模/建库时间/用时/体积', () => {
  const s = indexSummary({
    builtAt: new Date(NOW - 3_600_000).toISOString(),
    durationMs: 189_000,
    sizeBytes: 63 * 1024 * 1024,
    counts: { records: 22776, entities: 8191, artifacts: 360 },
    leaves: { failed: 0 },
    coverageOk: true,
  }, NOW)
  assert.match(s.text, /22,776 条记录 · 8,191 个实体 · 360 个检材文件/)
  assert.match(s.text, /建库 .*（用时 3 分 9 秒）/)
  assert.match(s.text, /库 63\.0 MiB/)
  assert.equal(s.warn, '')
  assert.equal(s.stale, false)
  assert.equal(DEFAULT_STALE_DAYS, 7)
})

test('manifest 缺失时只给体积，不抛错', () => {
  const s = indexSummary({ builtAt: null, sizeBytes: 2048, counts: null, leaves: null, coverageOk: null }, NOW)
  assert.equal(s.text, '索引：规模未知 · 库 0 MiB')
  assert.equal(s.warn, '')
  assert.equal(s.stale, false)
})

test('索引超过 7 天给出「已 N 天未更新」告警', () => {
  const built = new Date(NOW - 9 * 86_400_000).toISOString()
  const s = indexSummary({ builtAt: built, sizeBytes: 1024, counts: { records: 1 } }, NOW)
  assert.equal(s.stale, true)
  assert.equal(s.ageDays, 9)
  assert.match(s.warn, /索引已 9 天未更新/)
})

test('上次建库有失败叶子时给出不完整告警（可与过旧告警并存）', () => {
  const built = new Date(NOW - 9 * 86_400_000).toISOString()
  const s = indexSummary({ builtAt: built, sizeBytes: 1024, counts: { records: 10 }, leaves: { failed: 17 }, coverageOk: false }, NOW)
  assert.match(s.warn, /17 个叶子失败/)
  assert.match(s.warn, /索引已 9 天未更新/)
})
