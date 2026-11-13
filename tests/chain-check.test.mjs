import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  checkMountReadable,
  collectIndexDirs,
  describeIndexCoverage,
  formatChainReport,
  summarizeChain,
} from '../tools/chain-check.mjs'

test('describeIndexCoverage 区分有内容与仅元数据', () => {
  const result = describeIndexCoverage([
    { name: 'a.zip', recordCount: 8443, reportedRecordCount: 13718 },
    { name: 'b.zip', recordCount: 1, reportedRecordCount: 3065 },
    { name: 'c.E01', recordCount: 0, reportedRecordCount: 68 },
  ])
  assert.equal(result.total, 3)
  assert.deepEqual(result.parsed, ['a.zip'])
  assert.deepEqual(result.metadataOnly, ['b.zip', 'c.E01'])
  assert.equal(result.ok, true)
  assert.equal(describeIndexCoverage([]).ok, false)
})

test('checkMountReadable 处理目录可读/不可读/无挂载', () => {
  const root = mkdtempSync(join(tmpdir(), 'chain-mount-'))
  try {
    const dir = join(root, 'mount')
    mkdirSync(dir)
    writeFileSync(join(dir, 'iDevice_info.txt'), 'x')
    const ok = checkMountReadable({ name: 'ev', mountPoint: dir })
    assert.equal(ok.readable, true)
    assert.equal(ok.entries, 1)
    const missing = checkMountReadable({ name: 'ev', mountPoint: join(root, 'nope') })
    assert.equal(missing.readable, false)
    assert.equal(checkMountReadable({ name: 'ev' }).mounted, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('collectIndexDirs 合并环境变量和 home 下的目录清单', () => {
  const home = mkdtempSync(join(tmpdir(), 'chain-home-'))
  try {
    writeFileSync(join(home, 'index-extra-dirs.json'), JSON.stringify({ dirs: ['D:/forensics/extra'] }))
    const dirs = collectIndexDirs({ SEEU_INDEX_SEARCH_DIRS: 'D:/forensics/a; D:/forensics/b', SEEU_DSH_HOME: home })
    assert.deepEqual(dirs, ['D:/forensics/a', 'D:/forensics/b', 'D:/forensics/extra'])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('summarizeChain 与 formatChainReport 输出结论', () => {
  const report = {
    timestamp: '2026-11-14 02:00:00',
    case: { name: 'W盘', number: '2919d298' },
    index: { dbPath: 'D:/case/.seeu-index/case-index.db', ok: true, counts: { records: 22777, entities: 8191, artifacts: 360 } },
    coverage: { total: 5, parsed: ['LEUNG_YL_mobile.zip'], metadataOnly: ['CHAN_MH_mobile.zip'], ok: true },
    query: { q: 'Investors', ok: true, engine: 'fts5-trigram', total: 11 },
    mounts: { ok: true, items: [{ name: 'CHAN_MH_mobile.zip', readable: true, entries: 12 }] },
    images: [{ image: 'W:/AP3.E01', inspectOk: true, sizeBytes: 100, partitions: [{ index: 0, label: 'p0' }], inspectMs: 100 }],
  }
  assert.equal(summarizeChain(report).ok, true)
  const text = formatChainReport(report)
  assert.match(text, /链路打通/)
  assert.match(text, /fts5-trigram · 11 命中/)
  const bad = formatChainReport({ ...report, index: { ok: false, error: '坏库' } })
  assert.match(bad, /存在失败环节/)
})
