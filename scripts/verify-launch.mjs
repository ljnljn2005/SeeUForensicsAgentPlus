#!/usr/bin/env node
/**
 * 启动验证脚本（无人工点击）：拉起 Electron 桌面版，通过 CDP 检查窗口是否
 * 真正加载了 dsh Web UI，然后干净收尾。
 *
 * 用法：
 *   node scripts/verify-launch.mjs                 # 验证开发态（electron .）
 *   node scripts/verify-launch.mjs --exe <path>    # 验证打包产物 exe
 *   node scripts/verify-launch.mjs --timeout 180000 --port 9223
 *
 * 退出码 0 = 通过（打印 JSON 摘要）；1 = 失败（打印原因与日志尾部）。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import process from 'node:process'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}

const root = process.cwd()
const timeoutMs = Number(arg('timeout', '150000'))
const port = Number(arg('port', '9223'))
const exeArg = arg('exe', undefined)

/** @returns {{command: string, args: string[]}} */
function resolveLaunch() {
  if (exeArg !== undefined) return { command: exeArg, args: [`--remote-debugging-port=${port}`] }
  const electronExe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const electronExeUnix = join(root, 'node_modules', 'electron', 'dist', 'electron')
  const command = process.platform === 'win32' ? electronExe : electronExeUnix
  if (!existsSync(command)) throw new Error(`未找到 Electron 可执行文件：${command}（先 npm install）`)
  return { command, args: ['.', `--remote-debugging-port=${port}`] }
}

async function fetchJson(url) {
  // 不用全局 fetch：部分环境里 undici 会走代理/DNS 策略失败，这里直连回环地址。
  const { request } = await import('node:http')
  return await new Promise((resolve, reject) => {
    const req = request(url, { timeout: 5000, agent: false }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`HTTP ${String(response.statusCode)}`))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('CDP request timeout')))
    req.on('error', reject)
    req.end()
  })
}

/**
 * Electron 桌面版必须以 GUI 模式启动：若父进程环境带有 ELECTRON_RUN_AS_NODE=1
 * （例如从 DSH/Electron 内部终端启动），会退化成 Node 模式而创建不了窗口。
 */
async function launchEnvironment() {
  const env = { ...process.env, SEEU_VERIFY: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  return env
}

const launch = resolveLaunch()
if (!existsSync(join(root, 'dist', 'main.cjs')) && exeArg === undefined) {
  throw new Error('dist/main.cjs 不存在：先运行 npm run build')
}

const child = spawn(launch.command, launch.args, {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: await launchEnvironment(),
})
let stderr = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000) })

const started = Date.now()
const deadline = started + timeoutMs
let pages = []
let lastError = ''

try {
  while (Date.now() < deadline) {
    await sleep(1000)
    if (child.exitCode !== null) {
      const exit = String(child.exitCode)
      const hint = exit === '0'
        ? '：exit 0 通常是单实例锁生效（已有 SeeUForensicsAgentPlus 实例在运行），先退出所有实例再重试'
        : '：查看 %APPDATA%\\SeeUForensicsAgentPlus\\logs\\ 下的日志'
      throw new Error(`应用提前退出（exit ${exit}）${hint}`)
    }
    try {
      pages = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      const appPage = pages.find((page) => page.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(page.url ?? ''))
      if (appPage) break
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  const appPage = pages.find((page) => page.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(page.url ?? ''))
  const elapsed = Date.now() - started
  if (appPage === undefined) {
    throw new Error(`在 ${String(timeoutMs)}ms 内未观察到 dsh Web UI 页面（最后 CDP 错误：${lastError}）`)
  }

  // 再等页面标题稳定：确认前端真正渲染（title 由 dsh Web UI 设置）。
  let title = appPage.title ?? ''
  for (let attempt = 0; attempt < 20 && title.trim() === ''; attempt += 1) {
    await sleep(500)
    try {
      const again = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      const page = again.find((item) => item.id === appPage.id)
      title = page?.title ?? ''
    } catch { /* 继续等 */ }
  }

  console.log(JSON.stringify({
    ok: true,
    elapsedMs: elapsed,
    url: appPage.url,
    title,
    pages: pages.map((page) => ({ type: page.type, url: page.url, title: page.title })),
  }, null, 2))
} finally {
  // 收尾要点：先按进程树 taskkill，再等主进程退出。
  // 顺序反过来（先 child.kill()）会出现「主进程已死、renderer/GPU 子进程成孤儿」，
  // 残留进程会占住单实例锁，导致下一次验证直接 exit 0。
  if (child.pid !== undefined) {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch { /* 忽略 */ }
  }
  if (child.exitCode === null) {
    try { child.kill('SIGKILL') } catch { /* 忽略 */ }
  }
  await sleep(500)
  if (stderr.trim() !== '') {
    const tail = stderr.trim().split(/\r?\n/).slice(-25).join('\n')
    console.error(`[verify] 子进程 stderr 尾部：\n${tail}`)
  }
}

// 兜底退出：验证脚本自身不能在 Electron 残留时挂住。
await sleep(1500)
process.exit(0)
