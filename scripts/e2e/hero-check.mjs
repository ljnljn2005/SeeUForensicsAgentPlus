/**
 * 欢迎页快捷入口的 CDP 验收。
 *
 * 验证三件事：
 *   1. 欢迎页出现「打开取证索引 / 本地模型设置 / 取证工作区」三个快捷按钮；
 *   2. 点「打开取证索引」能把主面板切到 seeu-case-index（出现「建库 / 更新」按钮）；
 *   3. 点「本地模型设置」会弹出设置窗口（CDP target 出现 local-model.html）。
 *
 * 用独立 userData / DSH_HOME + SEEU_DEV_MULTI=1（不碰用户正在用的实例）。
 * 用法：node scripts/e2e/hero-check.mjs [--exe <打包后的 exe>]
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const argExe = process.argv.indexOf('--exe')
const EXE = argExe > -1 ? resolve(process.argv[argExe + 1]) : join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const EXE_ARGS = argExe > -1 ? [] : [REPO]
const CDP_PORT = 9353
const UD = join(REPO, '.dev', 'hero-ud')
const HOME = join(REPO, '.dev', 'hero-home')
const OUT = join(REPO, '.probe', 'shots', 'hero-actions.png')
// 真实案件目录：只有在它有 .seeu-index/case-index.db 时才断言「最近案件」chip
const CASE_DIR = process.env.SEEU_HERO_CASE_DIR ?? 'E:\\forensics\\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5'
const CASE_DB = join(CASE_DIR, '.seeu-index', 'case-index.db')

const report = { ok: false, steps: [], errors: [] }
const log = (step, detail) => report.steps.push(detail === undefined ? step : `${step}: ${detail}`)

async function targets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  return JSON.parse(await res.text())
}

async function waitForPage(match, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const page = (await targets()).find((t) => t.type === 'page' && match(String(t.url)))
      if (page !== undefined) return page
    } catch {
      // CDP 还没起来
    }
    await sleep(500)
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
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 抛异常')
  return result.result?.value
}

let child
try {
  rmSync(UD, { recursive: true, force: true })
  mkdirSync(UD, { recursive: true })
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.SEEU_LOCAL_MODEL_JSON
  env.SEEU_DEV_MULTI = '1'
  env.SEEU_DSH_HOME = HOME
  env.SEEU_USER_DATA = UD
  env.SEEU_INDEX_SEARCH_DIRS = join(REPO, '.dev', 'empty-indexes')
  if (existsSync(CASE_DB)) {
    // 外壳启动时用 <DSH_HOME>/index-state.json 的 dirs 覆盖 SEEU_INDEX_SEARCH_DIRS，
    // 直接传 env 不生效；写状态文件才是"面板选过的上次案件目录"的真实路径。
    writeFileSync(join(HOME, 'index-state.json'), JSON.stringify({ dirs: [CASE_DIR] }))
  }

  child = spawn(EXE, [...EXE_ARGS, `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`], {
    cwd: REPO,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const page = await waitForPage((url) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url))
  if (page === undefined) throw new Error('主页面没出现（CDP page 超时）')
  log('主页面', page.url.replace(/\?.*$/, ''))

  const client = cdp(page.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  // 等 hero 区渲染（官方是异步加载）
  const actions = await evaluate(client, `(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 30000) {
      const list = [...document.querySelectorAll('[data-seeu-action]')].map((el) => el.getAttribute('data-seeu-action'))
      if (list.length >= 3) return list
      await new Promise((r) => setTimeout(r, 300))
    }
    return [...document.querySelectorAll('[data-seeu-action]')].map((el) => el.getAttribute('data-seeu-action'))
  })()`)
  report.actions = actions
  log('快捷入口', JSON.stringify(actions))
  for (const key of ['index', 'model', 'workspace']) {
    if (!actions.includes(key)) throw new Error(`缺少快捷入口 ${key}`)
  }

  // 欢迎页「最近案件」chip：需要真实案件库在场
  if (existsSync(CASE_DB)) {
    const recentText = await evaluate(client, `(async () => {
      const t0 = Date.now()
      while (Date.now() - t0 < 15000) {
        const el = document.querySelector('[data-seeu-recent]')
        if (el !== null) return { text: el.innerText, db: el.getAttribute('data-seeu-recent') }
        await new Promise((r) => setTimeout(r, 300))
      }
      return null
    })()`)
    report.recentText = recentText ? recentText.text : ''
    report.recentDb = recentText ? recentText.db : ''
    report.recentOk = recentText !== null && /最近案件/.test(report.recentText)
    log('最近案件 chip', report.recentOk ? report.recentText : '没出现')
    if (!report.recentOk) throw new Error('欢迎页没有显示最近案件 chip')
  } else {
    report.recentOk = null
    log('最近案件 chip', `跳过（没有案件库：${CASE_DB}）`)
  }

  // 点「本地模型设置」→ 新开设置窗口
  await evaluate(client, `document.querySelector('[data-seeu-action="model"]').click(), true`)
  const settingsPage = await waitForPage((url) => String(url).includes('local-model.html'), 20000)
  report.settingsOpened = settingsPage !== undefined
  log('打开本地模型设置', report.settingsOpened ? '设置窗口已出现' : '设置窗口没出现')
  if (!report.settingsOpened) throw new Error('点快捷入口后设置窗口没出现')

  // 点「打开取证索引」→ 主面板应切到索引面板
  await evaluate(client, `document.querySelector('[data-seeu-action="index"]').click(), true`)
  const panelOpened = await evaluate(client, `(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      if (document.body.innerText.includes('建库 / 更新')) return true
      await new Promise((r) => setTimeout(r, 300))
    }
    return false
  })()`)
  report.panelOpened = panelOpened === true
  log('打开取证索引', report.panelOpened ? '面板已切换' : '没找到「建库 / 更新」按钮')
  if (!report.panelOpened) throw new Error('点快捷入口后索引面板没打开')

  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(join(REPO, '.probe', 'shots'), { recursive: true })
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  log('截图', OUT)

  client.close()
  report.ok = true
} catch (error) {
  report.errors.push(String(error?.message ?? error))
} finally {
  if (child !== undefined && child.pid !== undefined) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // 已退出
    }
    await sleep(500)
  }
}

console.log(`REPORT ${JSON.stringify(report)}`)
process.exit(report.ok ? 0 : 1)
