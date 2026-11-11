#!/usr/bin/env node
/**
 * 加载页「本地模型状态行」端到端检查。
 *
 * 做法：拿一个**必然连不上**的网关地址启动真 Electron（`127.0.0.1:19999`），
 * 在壳子还在显示 loading.html 的时间窗里，用 CDP 读 `#model` 的文本，
 * 断言它出现「网关不可用（仍可用官方模型）」，然后杀掉进程。
 *
 * 用法（在仓库根）：npm run test:e2e:loading（需先 npm run build）
 * 环境：SEEU_DEV_MULTI=1 由脚本注入（绕开单实例锁），userData/DSH_HOME 用独立临时目录。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PORT = Number(process.env.SEEU_LOADING_CDP_PORT ?? 9362)
const ELECTRON = join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const UD = join(REPO, '.dev', 'loading-ud')
const HOME = join(REPO, '.dev', 'loading-home')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = { ok: false, steps: [], errors: [] }
const log = (step, detail) => {
  report.steps.push(detail === undefined ? step : `${step}: ${detail}`)
  console.log(`[loading-check] ${step}${detail === undefined ? '' : `: ${detail}`}`)
}

async function cdpJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
  return res.json()
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    }
  })
  return {
    send(method, params = {}) {
      const mid = ++id
      ws.send(JSON.stringify({ id: mid, method, params }))
      return new Promise((res, rej) => pending.set(mid, { res, rej }))
    },
    close: () => ws.close(),
  }
}

async function evaluate(client, expression) {
  const r = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluate 失败')
  return r.result?.value
}

let child
try {
  rmSync(UD, { recursive: true, force: true })
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(UD, { recursive: true })
  mkdirSync(HOME, { recursive: true })

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  Object.assign(env, {
    SEEU_DEV_MULTI: '1',
    SEEU_USER_DATA: UD,
    SEEU_DSH_HOME: HOME,
    // 必然连不上的网关：探测会在 ~1s 内失败，加载页应如实显示
    SEEU_LOCAL_MODEL_JSON: JSON.stringify({
      enabled: true,
      baseURL: 'http://127.0.0.1:19999/v1',
      apiKey: 'local',
      models: [{ id: 'mock-14b' }],
      contextWindow: 131072,
      maxTokens: 8192,
      useAsDefault: false,
    }),
  })

  child = spawn(ELECTRON, [REPO, `--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })
  log('启动 Electron', `pid=${child.pid}，坏网关 127.0.0.1:19999`)

  let page = null
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await cdpJson('/json/list')
      page = list.find((p) => p.type === 'page' && p.url.includes('loading.html'))
      if (page) break
    } catch {
      // CDP 还没起来
    }
    await sleep(200)
  }
  if (!page) throw new Error('没有捕获到 loading.html 页面（壳子可能已经跳转到主界面）')
  log('页面', page.url)

  const client = await connect(page.webSocketDebuggerUrl)
  await client.send('Runtime.enable')

  let text = ''
  for (let i = 0; i < 40; i += 1) {
    text = String((await evaluate(client, "document.getElementById('model').textContent")) ?? '')
    if (text.includes('不可用')) break
    await sleep(250)
  }
  report.modelLine = text
  log('状态行', text || '（空）')
  if (!text.includes('不可用')) throw new Error(`状态行没有提示网关不可用：${JSON.stringify(text)}`)
  if (!text.includes('官方模型')) throw new Error(`状态行没有提示仍可用官方模型：${JSON.stringify(text)}`)
  client.close()
  report.ok = true
} catch (error) {
  report.errors.push(String(error?.message ?? error))
  console.error(`[loading-check] 失败：${report.errors.at(-1)}`)
} finally {
  if (child?.pid) {
    const { execFileSync } = await import('node:child_process')
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // 已经退出
    }
    await sleep(400)
  }
}

console.log('REPORT ' + JSON.stringify(report))
process.exit(report.ok ? 0 : 1)
