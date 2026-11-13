import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { findChainTarget, runChainCheck } from '../tools/chain-check-run.mjs'

function baseDeps(overrides = {}) {
  const db = { closed: false, close() { this.closed = true } }
  const mountDir = mkdtempSync(join(tmpdir(), 'seeu-mount-'))
  return {
    db,
    mountDir,
    deps: {
      findIndexes: () => [{ dbPath: 'C:/case/.seeu-index/case-index.db', caseNumber: '2919d298', caseName: 'W盘' }],
      collectIndexDirs: () => ['C:/case'],
      openIndex: () => db,
      statsOf: () => ({ meta: { case_name: 'W盘', case_number: '2919d298' }, counts: { records: 10, entities: 2, artifacts: 1 } }),
      evidences: () => [{ name: 'CHAN_MH_mobile.zip' }],
      describeIndexCoverage: () => ({ total: 1, parsed: ['CHAN_MH_mobile.zip'], metadataOnly: [], ok: true }),
      search: () => ({ engine: 'fts5-trigram', total: 3 }),
      loadEvidenceMounts: async () => ({
        mounts: [{ eid: 1, name: 'CHAN_MH_mobile.zip', route: '/evidence_mounts/eid-1/', mount_point: mountDir }],
      }),
      attachMounts: (list) => list.map((ev) => ({ ...ev, mountPoint: mountDir, mountRoute: '/evidence_mounts/eid-1/' })),
      ...overrides,
    },
  }
}

test('链路体检：全部通过时 exitCode=0 且报告字段完整', async () => {
  const { deps } = baseDeps()
  const result = await runChainCheck({ caseNumber: '2919d298', images: false, deps })
  assert.equal(result.exitCode, 0)
  assert.equal(result.report.index.ok, true)
  assert.deepEqual(result.report.index.counts, { records: 10, entities: 2, artifacts: 1 })
  assert.equal(result.report.query.total, 3)
  assert.equal(result.report.query.engine, 'fts5-trigram')
  assert.equal(result.report.coverage.ok, true)
  assert.match(result.text, /链路体检/)
  assert.deepEqual(result.summary.fails, [])
})

test('链路体检：索引打不开时 exitCode=1 并给出错误', async () => {
  const { deps } = baseDeps({ openIndex: () => { throw new Error('SQLITE_NOTADB') } })
  const result = await runChainCheck({ db: 'C:/case/.seeu-index/case-index.db', images: false, deps })
  assert.equal(result.exitCode, 1)
  assert.equal(result.report.index.ok, false)
  assert.match(String(result.report.index.error), /SQLITE_NOTADB/)
  assert.ok(result.summary.fails.some((line) => line.startsWith('index:')))
})

test('链路体检：找不到案件索引时 exitCode=2', async () => {
  const { deps } = baseDeps({ findIndexes: () => [] })
  const result = await runChainCheck({ caseNumber: 'nope', images: false, deps })
  assert.equal(result.exitCode, 2)
  assert.equal(result.report, null)
  assert.match(result.text, /找不到案件索引/)
})

test('链路体检：镜像解析通过/失败都进入报告（注入 inspectImage）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seeu-chain-'))
  const image = join(dir, 'disk.E01')
  writeFileSync(image, 'x')
  const seen = []
  const { deps } = baseDeps({
    evidences: () => [{ name: 'disk', sourcePath: image }],
    inspectImage: async (path) => {
      seen.push(path)
      return { image: path, inspectOk: true, sizeBytes: 1024, partitions: [{ index: 0, label: 'T' }] }
    },
  })
  const result = await runChainCheck({ caseNumber: '2919d298', images: true, deps })
  assert.equal(result.exitCode, 0)
  assert.equal(seen.length, 1)
  assert.ok(seen[0].endsWith('disk.E01'))
  assert.equal(result.report.images.length, 1)
  assert.equal(result.report.images[0].inspectOk, true)
  assert.match(result.text, /镜像/)
})

test('findChainTarget：按案号前缀匹配，也支持直接指定 db', () => {
  const deps = { findIndexes: () => [{ dbPath: 'C:/a/case-index.db', caseNumber: '2919d298-f083-4a81' }], collectIndexDirs: () => [] }
  assert.equal(findChainTarget({ caseNumber: '2919d298', deps }).dbPath, 'C:/a/case-index.db')
  assert.deepEqual(findChainTarget({ db: 'C:/b/case-index.db', deps }), { dbPath: 'C:/b/case-index.db' })
  assert.equal(findChainTarget({ caseNumber: 'zzz', deps }), null)
})
