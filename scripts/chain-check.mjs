#!/usr/bin/env node
/**
 * SeeU 链路体检：给定案件（caseNumber 或 --db），检查
 *   1) 索引是否可打开、规模与检材覆盖（解析内容 / 仅元数据）
 *   2) 检索链路（FTS5 长关键词 / LIKE 短关键词）
 *   3) 火眼只读挂载目录是否可读
 *   4) 原始镜像能否被 LovelyCarve 解析（分区表）
 * 退出码：0 全通；1 有环节失败；2 参数错误 / 找不到索引。
 *
 * 用法：
 *   node scripts/chain-check.mjs --caseNumber 2919d298-... [--probe Investors] [--json]
 *   node scripts/chain-check.mjs --db "E:/forensics/x/.seeu-index/case-index.db"
 *   node scripts/chain-check.mjs --caseNumber ... --no-images
 */
import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import { evidences, findIndexes, openIndex, search, statsOf } from '../tools/ges-index/query.mjs'
import { attachMounts, loadEvidenceMounts } from '../tools/ges-index/mounts.mjs'
import { createMountManager, resolveLovelyCarveCli } from '../tools/image-mount.mjs'
import {
  checkMountReadable,
  collectIndexDirs,
  describeIndexCoverage,
  formatChainReport,
  summarizeChain,
} from '../tools/chain-check.mjs'

const IMAGE_EXT = new Set(['.e01', '.ex01', '.dd', '.raw', '.img', '.vmdk', '.vhdx', '.qcow2', '.iso', '.bin'])

function parseArgs(argv) {
  const args = { probe: 'Investors', images: true, json: false, out: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--json') args.json = true
    else if (item === '--no-images') args.images = false
    else if (item === '--caseNumber' || item === '--case') args.caseNumber = argv[++i]
    else if (item === '--db') args.db = argv[++i]
    else if (item === '--probe') args.probe = argv[++i] ?? args.probe
    else if (item === '--out') args.out = argv[++i] ?? ''
    else if (item === '--help' || item === '-h') args.help = true
    else if (item.startsWith('-')) throw new Error(`未知参数：${item}`)
  }
  return args
}

function findTargetIndex(args) {
  if (args.db) return { dbPath: args.db }
  if (!args.caseNumber) return null
  const wanted = String(args.caseNumber).trim().toLowerCase()
  const dirs = collectIndexDirs(process.env)
  for (const item of findIndexes(dirs)) {
    const number = String(item.caseNumber ?? '').toLowerCase()
    if (number && (number === wanted || number.includes(wanted))) return item
  }
  return null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write('用法：node scripts/chain-check.mjs --caseNumber <案号> [--probe 关键词] [--no-images] [--json] [--out 文件]\n')
    return 0
  }
  const target = findTargetIndex(args)
  if (!target) {
    process.stderr.write('找不到案件索引：用 --caseNumber（可 /list 查看）或 --db 指定路径\n')
    return 2
  }

  const report = {
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    case: { name: '', number: '' },
    index: { dbPath: target.dbPath, ok: false, counts: null, error: null },
    coverage: { total: 0, parsed: [], metadataOnly: [], ok: false },
    query: null,
    mounts: { ok: false, items: [] },
    images: [],
  }

  let db = null
  try {
    db = openIndex(target.dbPath)
    const stats = statsOf(db)
    report.case = {
      name: String(stats.meta.case_name ?? target.caseName ?? ''),
      number: String(stats.meta.case_number ?? target.caseNumber ?? ''),
    }
    report.index.ok = true
    report.index.counts = { records: stats.counts.records, entities: stats.counts.entities, artifacts: stats.counts.artifacts }
  } catch (error) {
    report.index.error = String(error?.message ?? error)
  }

  let list = []
  if (db) {
    try {
      list = evidences(db)
      report.coverage = describeIndexCoverage(list)
    } catch (error) {
      report.coverage = { total: 0, parsed: [], metadataOnly: [], ok: false, error: String(error?.message ?? error) }
    }
    try {
      const result = search(db, { q: args.probe, limit: 3 })
      report.query = { q: args.probe, ok: true, engine: result.engine, total: result.total }
    } catch (error) {
      report.query = { q: args.probe, ok: false, error: String(error?.message ?? error) }
    }
  }

  // 火眼挂载：ges status 拿 evidence_mounts，按名字优先挂到证据上。
  try {
    const { mounts = [] } = await loadEvidenceMounts()
    const attached = mounts.length ? attachMounts(list, mounts) : list
    report.mounts.items = attached.map((ev) => checkMountReadable(ev))
    report.mounts.ok = report.mounts.items.some((item) => item.readable)
  } catch (error) {
    report.mounts = { ok: false, items: [], error: String(error?.message ?? error) }
  }

  // 原始镜像：只做 inspect（快，不挂载），确认工具链可用。
  if (args.images) {
    const candidates = list
      .map((ev) => String(ev.sourcePath ?? '').trim())
      .filter((path) => path && IMAGE_EXT.has(extname(path).toLowerCase()))
      .filter((path, index, all) => all.indexOf(path) === index)
      .filter((path) => existsSync(path))
      .slice(0, 3)
    if (candidates.length) {
      const cli = resolveLovelyCarveCli(process.env)
      if (!cli.path || cli.error) {
        report.images.push({ image: candidates[0], inspectOk: false, error: cli.error ?? '未找到 LovelyCarve CLI' })
      } else {
        const manager = createMountManager({ env: () => process.env, log: () => {} })
        try {
          for (const image of candidates) {
            const result = await manager.inspect(image)
            if (result.ok) {
              report.images.push({
                image,
                inspectOk: true,
                sizeBytes: result.image?.sizeBytes,
                partitions: (result.image?.partitions ?? []).map((p) => ({ index: p.index, label: p.label })),
                inspectMs: result.ms,
              })
            } else {
              report.images.push({ image, inspectOk: false, error: result.error?.message ?? result.error ?? '解析失败' })
            }
          }
        } finally {
          await manager.dispose()
        }
      }
    }
  }

  try {
    if (db) db.close()
  } catch {
    // 忽略。
  }

  const summary = summarizeChain(report)
  const text = formatChainReport(report)
  if (args.out) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(args.out, text + '\n', 'utf8')
  }
  process.stdout.write(args.json ? JSON.stringify({ ...report, summary }, null, 2) + '\n' : text + '\n')
  return summary.ok ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`链路体检失败：${error?.stack ?? error}\n`)
    process.exit(1)
  })
