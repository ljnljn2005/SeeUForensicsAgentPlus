#!/usr/bin/env node
/**
 * 真实取证工具基准（本机已安装的工具链 → 实际跑一遍，产出可核对的数字）。
 *
 * 用法：
 *   node scripts/e2e/real-tools-bench.mjs
 *   CARVE_IMAGE=W:/xxx.E01 BENCH_PCAP=E:/.../L1-6.pcapng BENCH_MEM=E:/.../image.raw node scripts/e2e/real-tools-bench.mjs
 *
 * 说明：
 * - LovelyCarve：inspect（分区表）→ mount 只读盘 → 列目录 → unmount；
 * - LovelySpark：用 `tools/lovely-cli/cli.mjs lovelyspark -- analyze <pcap>` 走与技能一致的包装器；
 * - StarMem：`starmem.exe --json info <镜像>`（不跑耗时的解析类命令）。
 * 工具路径优先取环境变量（SEEU_LOVELYCARVE_CLI / SEEU_LOVELYSPARK_EXE / SEEU_TOOL_STARMEM），
 * 否则用开发机实测默认路径；文件不存在就跳过该工具（报告里标 skipped）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMountManager } from '../../tools/image-mount.mjs'
import { TOOL_PATH_SPECS } from '../../tools/tool-paths.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const envOf = (name, fallback) => process.env[name] || fallback
const spec = (id) => TOOL_PATH_SPECS.find((item) => item.id === id)
const report = { at: new Date().toISOString(), tools: {} }

const carveCli = envOf('SEEU_LOVELYCARVE_CLI', 'D:/Programs/LovelyCarve/lovelycarve-cli.exe')
const carveImage = envOf('CARVE_IMAGE', 'W:/AP3_LEUNG_YL_USB.E01')
if (carveCli && existsSync(carveCli) && existsSync(carveImage)) {
  const home = join(root, '.dev', 'bench-carve-home')
  const manager = createMountManager({
    env: () => ({ ...process.env, SEEU_LOVELYCARVE_CLI: carveCli, SEEU_DSH_HOME: home }),
  })
  const result = { ok: false }
  try {
    const t0 = Date.now()
    const inspected = await manager.inspect(carveImage)
    result.inspect = { ok: inspected.ok, ms: Date.now() - t0, partitions: inspected.image?.partitions?.length ?? 0, error: inspected.ok ? undefined : inspected.error }
    const status = await manager.status()
    const t1 = Date.now()
    const mounted = await manager.mount({ imagePath: carveImage, partition: 0, mountPoint: status.defaultMountPoint })
    result.mount = { ok: mounted.ok, ms: Date.now() - t1, mountPoint: mounted.mount?.mountPoint, error: mounted.ok ? undefined : mounted.error }
    if (mounted.ok) {
      try {
        result.rootListing = readdirSync(mounted.mount.mountPoint).slice(0, 8)
      } catch (error) {
        result.rootListingError = String(error?.message ?? error)
      }
      const t2 = Date.now()
      const unmounted = await manager.unmount(mounted.mount.id)
      result.unmount = { ok: unmounted.ok, ms: Date.now() - t2 }
    }
    result.ok = Boolean(result.inspect?.ok && result.mount?.ok && result.unmount?.ok)
  } catch (error) {
    result.error = String(error?.message ?? error)
  } finally {
    await manager.dispose()
  }
  report.tools.lovelycarve = result
} else {
  report.tools.lovelycarve = { skipped: true, cli: carveCli, image: carveImage }
}

const sparkExe = envOf('SEEU_LOVELYSPARK_EXE', 'E:/CTFTools/Misc/综合工具箱/lovelyspark.exe')
const pcap = envOf('BENCH_PCAP', 'E:/CTFTools/Forensics/8-流量分析/题目/L1-6.pcapng')
if (existsSync(sparkExe) && existsSync(pcap)) {
  const t0 = Date.now()
  const run = spawnSync(process.execPath, [join(root, 'tools', 'lovely-cli', 'cli.mjs'), 'lovelyspark', '--', 'analyze', pcap], {
    encoding: 'utf8',
    timeout: 300_000,
    cwd: root,
    env: {
      ...process.env,
      SEEU_CLI_NODE: process.execPath,
      SEEU_LOVELY_CLI: join(root, 'tools', 'lovely-cli', 'cli.mjs'),
      SEEU_LOVELYSPARK_EXE: sparkExe,
    },
  })
  let parsed = null
  try { parsed = JSON.parse(String(run.stdout || '')) } catch { /* 保留原文 */ }
  report.tools.lovelyspark = {
    ok: parsed?.ok === true,
    ms: Date.now() - t0,
    pcap,
    pcapBytes: statSync(pcap).size,
    dbPath: parsed?.db_path,
    error: parsed ? undefined : String(run.stderr || run.stdout || '').slice(0, 400),
  }
} else {
  report.tools.lovelyspark = { skipped: true, exe: sparkExe, pcap }
}

const starmemExe = envOf('SEEU_TOOL_STARMEM', spec('starmem')?.defaultPath)
const memImage = envOf('BENCH_MEM', 'E:/CTFTools/Forensics/8-流量分析/w3流量分析工具/Examples/CS流量/cs4内存解密流量/pid.6492.dmp')
if (starmemExe && existsSync(starmemExe) && existsSync(memImage)) {
  const t0 = Date.now()
  const run = spawnSync(starmemExe, ['--json', 'info', memImage], { encoding: 'utf8', timeout: 180_000, windowsHide: true })
  let parsed = null
  try { parsed = JSON.parse(String(run.stdout || '')) } catch { /* 保留原文 */ }
  report.tools.starmem = {
    ok: run.status === 0 && Boolean(parsed?.ok ?? true),
    ms: Date.now() - t0,
    image: memImage,
    imageBytes: statSync(memImage).size,
    engineVersion: parsed?.engine_identity?.version,
    format: parsed?.source_identity?.format,
    error: run.status === 0 ? undefined : String(run.stderr || '').slice(0, 300),
  }
} else {
  report.tools.starmem = { skipped: true, exe: starmemExe, image: memImage }
}

report.ok = Object.values(report.tools).every((item) => item.ok === true || item.skipped === true)
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.ok ? 0 : 1
