/**
 * 回归：127.0.0.1 的 dsh-auth cookie 按端口累积（cookie 不区分端口），攒到 >16 KB 后
 * dsh 的 Node HTTP 服务直接回 431，首页白屏。修复后：外壳在 loadURL 前清掉非当前端口的旧 cookie。
 *
 * 做法：首页正式加载前（loading.html 阶段）用 CDP 往 127.0.0.1 塞 80 条旧端口 dsh-auth cookie
 * （约 18 KB，未修复时必然 431），断言日志出现「清理 80 个」且首页能渲染正文。
 *
 * 用法：node scripts/e2e/auth-cookie-check.mjs [--exe <打包版 exe>]
 * 环境：SEEU_AUTH_E2E_PORT（CDP 端口，默认 9361）
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = process.cwd()
const argExe = process.argv.indexOf('--exe')
const EXE = argExe > -1 ? resolve(process.argv[argExe + 1]) : join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const EXE_ARGS = argExe > -1 ? [] : [REPO]
const PORT = Number(process.env.SEEU_AUTH_E2E_PORT ?? 9361)
const UD = join(REPO, '.dev', 'auth-ud')
const HOME = join(REPO, '.dev', 'auth-home')
const STALE = 80

const report = { ok: false, steps: [], errors: [] }
const log = (step) => report.steps.push(step)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function startApp() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  // 用隔离 HOME 让外壳把 4 个插件包复制进 profile（不碰用户数据）；userData 也隔离。
  env.SEEU_DEV_MULTI = '1'
  env.SEEU_DSH_HOME = HOME
  env.SEEU_USER_DATA = UD
  env.SEEU_INDEX_SEARCH_DIRS = join(REPO, '.dev', 'empty-indexes')
  return spawn(EXE, [...EXE_ARGS, `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`], {
    cwd: REPO,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function targetsOf() {
  try {
    return JSON.parse(await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).text())
  } catch {
    return []
  }
}

async function waitTarget(match, timeoutMs = 120000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const page = (await targetsOf()).find((x) => x.type === 'page' && match(String(x.url)))
    if (page !== undefined) return page
    await sleep(300)
  }
  return undefined
}

function cdpOf(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const ready = new Promise((r) => (ws.onopen = r))
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id
      pending.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  return { ready, send, close: () => ws.close() }
}

const staleCookieValue = (port) =>
  'v1.' + Buffer.from(JSON.stringify({ version: 1, authority: `127.0.0.1:${port}` }), 'utf8').toString('base64url')

const pruneLine = () => {
  try {
    const text = readFileSync(join(UD, 'logs', 'shell.log'), 'utf8')
    return text.split(String.fromCharCode(10)).filter((l) => l.includes('auth cookies:')).at(-1) ?? ''
  } catch {
    return ''
  }
}

let child
try {
  rmSync(UD, { recursive: true, force: true })
  mkdirSync(UD, { recursive: true })
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })

  child = startApp()

  // 1) 在 loading.html 阶段塞旧端口 cookie（此时 dsh 还没 ready，清理逻辑尚未执行）。
  const loading = await waitTarget((url) => url.startsWith('file:'), 120000)
  if (loading === undefined) throw new Error('没等到 loading 页（启动窗口未出现）')
  const early = cdpOf(loading.webSocketDebuggerUrl)
  await early.ready
  const cookies = Array.from({ length: STALE }, (_, i) => ({
    name: `dsh-auth-stale${i}`,
    value: staleCookieValue(40000 + i),
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    expires: Math.floor(Date.now() / 1000) + 86400,
  }))
  const seeded = await early.send('Storage.setCookies', { cookies })
  if (seeded.error !== undefined) throw new Error(`写入旧 cookie 失败：${JSON.stringify(seeded.error)}`)
  const check = await early.send('Storage.getCookies', {})
  report.seeded = (check.result?.cookies ?? []).filter((c) => c.name.startsWith('dsh-auth-stale')).length
  if (report.seeded < STALE) throw new Error(`只写入了 ${report.seeded}/${STALE} 条旧 cookie`)
  early.close()
  log(`loading 阶段注入并确认 ${report.seeded} 条旧端口 dsh-auth cookie（约 ${Math.round(report.seeded * 0.225)} KB）`)

  // 2) 等外壳正式页；能渲染出正文即说明 cookie 已被清理（否则 18 KB 头 → 431 白屏）。
  const shell = await waitTarget((url) => url.startsWith('http://127.0.0.1'), 180000)
  if (shell === undefined) throw new Error(`没等到外壳页；stderr=${String(child.__stderr ?? '').slice(-400)}`)
  const cdp = cdpOf(shell.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Runtime.enable')
  let text = ''
  for (let i = 0; i < 240; i++) {
    text = String(
      (await cdp.send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText.trim().slice(0,120) : ""', returnByValue: true }))
        .result?.result?.value ?? '',
    )
    if (text.length > 2) break
    await sleep(500)
  }
  report.pageText = text
  report.rendered = text.length > 2
  report.pruneLine = pruneLine()
  const left = await cdp.send('Storage.getCookies', {})
  report.authCookies = (left.result?.cookies ?? []).filter((c) => c.name.startsWith('dsh-auth-')).length
  cdp.close()
  if (!report.rendered) throw new Error('首页没有渲染（仍被 431 挡住）')
  if (!/清理 [1-9]\d* 个/.test(report.pruneLine)) throw new Error(`外壳没有清理旧端口 cookie（日志：${report.pruneLine || '无'}）`)
  const pruned = Number(report.pruneLine.split('清理 ')[1].split(' ')[0])
  report.pruned = pruned
  if (pruned < STALE) throw new Error(`清理数量不足：${pruned}/${STALE}（旧 cookie 没被识别）`)
  if (report.authCookies > 2) throw new Error(`旧 cookie 没清干净：还剩 ${report.authCookies} 个`)
  report.ok = true
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error))
} finally {
  if (child !== undefined) {
    try {
      child.kill()
    } catch {
      // 忽略
    }
    await new Promise((done) => {
      if (child.exitCode !== null) return done()
      child.once('exit', done)
      setTimeout(done, 15000)
    })
  }
  console.log('REPORT', JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}
