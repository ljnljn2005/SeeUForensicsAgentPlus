/**
 * 镜像挂载窗口的 CDP 验收脚本（不需要真实 LovelyCarve / Dokan）。
 *
 * 做四件事：
 *   1. 用 `SEEU_LOVELYCARVE_CLI` 指向假 CLI（tests/fixtures/fake-lovelycarve-cli.mjs），
 *      `SEEU_OPEN_MOUNTS=1` 让外壳启动即打开「镜像挂载」窗口；
 *   2. 通过 CDP 调 `window.seeu.mounts`：get → inspect → mount → unmount；
 *   3. 直接核对 `<SEEU_DSH_HOME>/mounts.json` 的内容；
 *   4. 截图 + 输出一行 JSON 报告。
 *
 * 用法：node scripts/e2e/mount-check.mjs [--out .dev/shots/mounts.png]
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CDP_PORT = Number(process.env.SEEU_MOUNT_E2E_PORT || 9461)
const argOut = process.argv.indexOf('--out')
const OUT = argOut > -1 ? process.argv[argOut + 1] : join(REPO, '.dev', 'shots', 'mounts.png')
const argExe = process.argv.indexOf('--exe')
const EXE = argExe > -1 ? resolve(process.argv[argExe + 1]) : join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const EXE_ARGS = argExe > -1 ? [] : [REPO]
const UD = join(REPO, '.dev', 'mount-ud')
const HOME = join(REPO, '.dev', 'mount-home')
const IMAGE_DIR = join(REPO, '.dev', 'mount-img')
const IMAGE = join(IMAGE_DIR, 'disk.E01')
const MOUNTS_FILE = join(HOME, 'mounts.json')

const report = { ok: false, steps: [], errors: [] }
function log(step, detail) {
  report.steps.push(detail === undefined ? step : `${step}: ${detail}`)
}

async function cdpTargets() {
  const text = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).text()
  return JSON.parse(text)
}

async function waitForPage(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await cdpTargets()
      const page = targets.find((t) => t.type === 'page' && String(t.url).includes('mounts.html'))
      if (page !== undefined) return page
    } catch {
      // devtools endpoint 还没起来
    }
    await sleep(400)
  }
  return undefined
}

function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { done, fail } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) fail(new Error(msg.error.message))
      else done(msg.result)
    }
  })
  const ready = new Promise((done, fail) => {
    socket.addEventListener('open', () => done())
    socket.addEventListener('error', () => fail(new Error('CDP websocket 连接失败')))
  })
  return {
    ready,
    send(method, params = {}) {
      const id = nextId++
      return new Promise((done, fail) => {
        pending.set(id, { done, fail })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      try { socket.close() } catch { /* ignore */ }
    },
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 抛异常')
  }
  return result.result?.value
}

let child
try {
  rmSync(UD, { recursive: true, force: true })
  mkdirSync(UD, { recursive: true })
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
  rmSync(IMAGE_DIR, { recursive: true, force: true })
  mkdirSync(IMAGE_DIR, { recursive: true })
  writeFileSync(IMAGE, Buffer.alloc(4096, 7))

  // 假 CLI 复制到 HOME 下，避免测试过程写 tests/fixtures
  const fakeCli = join(HOME, 'fake-lovelycarve-cli.mjs')
  copyFileSync(join(REPO, 'tests', 'fixtures', 'fake-lovelycarve-cli.mjs'), fakeCli)

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.SEEU_DEV_MULTI = '1'
  env.SEEU_OPEN_MOUNTS = '1'
  env.SEEU_DSH_HOME = HOME
  env.SEEU_USER_DATA = UD
  env.SEEU_LOVELYCARVE_CLI = fakeCli
  env.SEEU_MOUNT_NODE = process.execPath
  env.SEEU_MOUNTS_FILE = MOUNTS_FILE
  env.SEEU_MOUNT_CASE_DIR = join(HOME, 'mount-case')
  delete env.SEEU_LOCAL_MODEL_JSON

  child = spawn(EXE, [...EXE_ARGS, `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`], {
    cwd: REPO,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const page = await waitForPage()
  if (page === undefined) throw new Error('镜像挂载窗口没出现（CDP page 超时）')
  log('窗口已加载', page.url.replace(/^file:\/\/\//, ''))

  const client = cdp(page.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await sleep(800)

  const bridge = await evaluate(client, 'Boolean(window.seeu && window.seeu.mounts)')
  if (bridge !== true) throw new Error('preload 桥未暴露 window.seeu.mounts')
  log('preload 桥', 'OK')

  const status = await evaluate(client, 'window.seeu.mounts.get()')
  report.cli = status?.cli
  if (!status?.cli?.path) throw new Error(`CLI 未识别：${JSON.stringify(status?.cli)}`)
  if (status.cli.source !== 'env') throw new Error(`CLI 来源应为 env，实际 ${status.cli.source}`)
  report.defaultMountPoint = status.defaultMountPoint
  if (!/^[A-Z]:$/.test(String(status.defaultMountPoint))) throw new Error(`默认挂载点不合法：${status.defaultMountPoint}`)
  report.cliStateText = await evaluate(client, "document.getElementById('cliState').textContent")
  if (!/已找到/.test(String(report.cliStateText))) throw new Error(`CLI 状态未显示已找到：${report.cliStateText}`)
  log('CLI 状态', `${status.cli.path}（${status.cli.source}），默认挂载点 ${status.defaultMountPoint}`)

  const inspected = await evaluate(client, `window.seeu.mounts.inspect(${JSON.stringify(IMAGE)})`)
  report.inspect = { ok: inspected?.ok, partitions: inspected?.image?.partitions?.length ?? 0, name: inspected?.image?.name, ms: inspected?.ms }
  if (!(Number(inspected?.ms) > 0)) throw new Error(`解析应返回耗时 ms，实际 ${JSON.stringify(inspected?.ms)}`)
  if (inspected?.ok !== true) throw new Error(`解析镜像失败：${JSON.stringify(inspected)}`)
  if (report.inspect.partitions !== 2) throw new Error(`分区数应为 2，实际 ${report.inspect.partitions}`)
  log('解析镜像', `${report.inspect.name} · ${report.inspect.partitions} 个分区`)

  const mountPoint = status.defaultMountPoint
  const mounted = await evaluate(
    client,
    `window.seeu.mounts.mount({ imagePath: ${JSON.stringify(IMAGE)}, partition: 0, mountPoint: ${JSON.stringify(mountPoint)} })`,
  )
  report.mount = mounted?.ok === true ? { mountPoint: mounted.mount?.mountPoint, id: mounted.mount?.id, ms: mounted.ms } : mounted
  if (mounted?.ok === true && !(Number(mounted.ms) > 0)) throw new Error(`挂载应返回耗时 ms，实际 ${JSON.stringify(mounted.ms)}`)
  if (mounted?.ok !== true) throw new Error(`挂载失败：${JSON.stringify(mounted)}`)
  if (mounted.mount?.mountPoint !== mountPoint) throw new Error(`挂载点不符：${mounted.mount?.mountPoint}`)
  if (!existsSync(MOUNTS_FILE)) throw new Error('mounts.json 没有写出')
  const state = JSON.parse(readFileSync(MOUNTS_FILE, 'utf8'))
  report.state = { count: state.mounts?.length ?? 0, imagePath: state.mounts?.[0]?.imagePath, note: state.note }
  if (report.state.count !== 1) throw new Error(`mounts.json 应有 1 条，实际 ${report.state.count}`)
  if (state.mounts[0].imagePath !== IMAGE) throw new Error('mounts.json 里的镜像路径不符')
  log('挂载', `${mountPoint} → ${state.mounts[0].imagePath}（${report.mount.ms} ms）`)
  const timingWired = await evaluate(
    client,
    "Boolean(document.getElementById('timing')) && /noteTiming/.test(String(document.querySelector('script').textContent))",
  )
  report.timingWired = timingWired
  if (!timingWired) throw new Error('界面缺少耗时展示元素或 noteTiming 逻辑')

  // 页面重新加载后应看到活动挂载卡片
  await client.send('Page.reload')
  await sleep(1600)
  const bodyText = String(await evaluate(client, 'document.body.innerText'))
  report.listVisible = bodyText.includes(mountPoint) && bodyText.includes('disk.E01')
  if (!report.listVisible) throw new Error('页面刷新后没有显示活动挂载')
  log('页面列表', `显示 ${mountPoint} · disk.E01`)
  // 第 41 轮：最近一次挂载摘要（挂载中 / 已卸载）。
  report.lastMountText = String(await evaluate(client, "(document.querySelector('[data-last-mount]') || {}).textContent || ''"))
  report.lastMountOk = /最近一次挂载：/.test(report.lastMountText) && report.lastMountText.includes('disk.E01') && /运行中/.test(report.lastMountText)
  if (!report.lastMountOk) throw new Error('最近一次挂载摘要不对（挂载中）：' + report.lastMountText)

  const unmounted = await evaluate(client, `window.seeu.mounts.unmount(${JSON.stringify(mounted.mount.id)})`)
  report.unmount = unmounted?.ok
  report.unmountMs = unmounted?.ms
  if (unmounted?.ok === true && !(Number(unmounted.ms) > 0)) throw new Error(`卸载应返回耗时 ms，实际 ${JSON.stringify(unmounted.ms)}`)
  if (unmounted?.ok !== true) throw new Error(`卸载失败：${JSON.stringify(unmounted)}`)
  const after = JSON.parse(readFileSync(MOUNTS_FILE, 'utf8'))
  report.stateAfter = after.mounts?.length ?? 0
  if (report.stateAfter !== 0) throw new Error(`卸载后 mounts.json 应为空，实际 ${report.stateAfter}`)
  log('卸载', '清单已清空')
  await evaluate(client, "document.getElementById('btnRefresh').click(), true")
  await sleep(900)
  report.lastMountReleasedText = String(await evaluate(client, "(document.querySelector('[data-last-mount]') || {}).textContent || ''"))
  report.lastMountReleasedOk = /已卸载/.test(report.lastMountReleasedText) && report.lastMountReleasedText.includes('disk.E01')
  if (!report.lastMountReleasedOk) throw new Error('最近一次挂载摘要不对（已卸载）：' + report.lastMountReleasedText)

  // 第 42 轮：卸载后点【重新挂载最近镜像】，应直接恢复挂载，再卸载收尾。
  report.remountButtonVisible = await evaluate(client, "document.getElementById('remountRow').style.display !== 'none'")
  if (report.remountButtonVisible !== true) throw new Error('卸载后没有出现「重新挂载最近镜像」按钮')
  await evaluate(client, "document.getElementById('btnRemount').click(), true")
  const remounted = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      await sleep(400)
      const state = await evaluate(client, 'window.seeu.mounts.get()')
      if ((state?.mounts?.length ?? 0) === 1) return state
    }
    return null
  })()
  report.remountedCount = remounted?.mounts?.length ?? 0
  if (report.remountedCount !== 1) throw new Error('重新挂载失败：' + JSON.stringify(remounted))
  report.remountedPoint = String(remounted.mounts[0].mountPoint || '')
  const remountText = String(await evaluate(client, "(document.getElementById('remountHint') || {}).textContent || ''"))
  report.remountHintOk = /已重新挂载/.test(remountText)
  if (!report.remountHintOk) throw new Error('重新挂载提示不对：' + remountText)
  const unmountAgain = await evaluate(client, `window.seeu.mounts.unmount(${JSON.stringify(remounted.mounts[0].id)})`)
  report.remountCleanup = unmountAgain?.ok === true
  if (report.remountCleanup !== true) throw new Error('重新挂载后收尾卸载失败：' + JSON.stringify(unmountAgain))

  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(join(OUT, '..'), { recursive: true })
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  report.screenshot = OUT.replaceAll('\\', '/')
  report.ok = true
  client.close()
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error))
} finally {
  try { child?.kill() } catch { /* ignore */ }
  console.log(`REPORT ${JSON.stringify(report)}`)
  if (!report.ok) process.exitCode = 1
}
