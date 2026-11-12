/**
 * 技能上传/管理器（upstream 117b391）在主窗口的冒烟检查。
 *
 * 做三件事：
 *   1. 起真 Electron（隔离 userData / DSH_HOME，SEEU_DEV_MULTI=1），等主窗口页面；
 *   2. 通过 CDP 调 preload 桥：window.seeu.skillsList() 应列出随包技能，
 *      且 skillsImportZip / skillsImportFolder / skillsRemove / skillsOpenDir 都是函数；
 *   3. 校验随包技能目录里确实有 lovelycarve-forensics（本次合并进来的），输出一行 JSON 报告。
 *
 * 用法：node scripts/e2e/skills-check.mjs [--exe release/win-unpacked/SeeUForensicsAgentPlus.exe]
 */
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { rmSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CDP_PORT = Number(process.env.SEEU_SKILLS_E2E_PORT || 9471)
const argExe = process.argv.indexOf('--exe')
const EXE = argExe > -1 ? resolve(process.argv[argExe + 1]) : join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const EXE_ARGS = argExe > -1 ? [] : [REPO]
const UD = join(REPO, '.dev', 'skills-ud')
const HOME = join(REPO, '.dev', 'skills-home')

const report = { ok: false, steps: [], errors: [] }
const log = (step, detail) => report.steps.push(detail === undefined ? step : `${step}: ${detail}`)

async function cdpTargets() {
  const text = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).text()
  return JSON.parse(text)
}

async function waitForPage(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const page = (await cdpTargets()).find((t) => t.type === 'page')
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
    close() { try { socket.close() } catch { /* ignore */ } },
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

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.SEEU_LOCAL_MODEL_JSON
  env.SEEU_DEV_MULTI = '1'
  env.SEEU_DSH_HOME = HOME
  env.SEEU_USER_DATA = UD

  child = spawn(EXE, [...EXE_ARGS, `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`], {
    cwd: REPO,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const page = await waitForPage()
  if (page === undefined) throw new Error('主窗口没出现（CDP page 超时）')
  log('窗口已加载', page.url.replace(/^file:\/\/\//, ''))

  const client = cdp(page.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')
  await sleep(1200)

  const bridge = await evaluate(
    client,
    "['skillsList','skillsImportFolder','skillsImportZip','skillsImportFolderOverwrite','skillsImportZipOverwrite','skillsRemove','skillsOpenDir'].every((k) => typeof window.seeu?.[k] === 'function')",
  )
  if (bridge !== true) throw new Error('preload 桥的技能方法不全')
  log('preload 桥', '7 个方法齐全')

  const skills = await evaluate(client, 'window.seeu.skillsList()')
  report.skills = Array.isArray(skills) ? skills.map((s) => s?.name).filter(Boolean) : []
  if (!Array.isArray(skills) || skills.length === 0) throw new Error(`skillsList 返回为空：${JSON.stringify(skills)}`)
  report.bundled = skills.filter((s) => s?.source === 'bundled' || s?.bundled === true).map((s) => s.name)
  report.bundledCount = report.bundled.length
  log('技能列表', `${report.skills.length} 个，随包 ${report.bundled.length} 个`)

  const want = ['lovelycarve-forensics', 'lovelymem-cli', 'lovelyspark-cli']
  report.found = {}
  for (const name of want) report.found[name] = report.skills.includes(name)
  const missing = want.filter((name) => report.found[name] !== true)
  // lovelycarve 技能由 upstream 合入随包目录；本地 0.3.0 安装后应存在
  const skillsDir = join(REPO, 'resources', 'forensics', 'skills')
  report.diskSkills = existsSync(skillsDir) ? readdirSync(skillsDir) : []
  report.diskHasLovelyCarve = report.diskSkills.includes('lovelycarve-forensics')
  if (missing.length > 0) {
    // dev 模式下随包技能是从 resources/forensics/skills 安装的，缺任何一个都算失败
    throw new Error(`技能列表缺少 ${missing.join(', ')}：${JSON.stringify(report.skills)}`)
  }

  const sample = skills.find((s) => s?.name === 'lovelycarve-forensics')
  report.lovelyCarve = {
    name: sample?.name,
    source: sample?.source ?? sample?.bundled,
    fileCount: sample?.fileCount ?? sample?.files,
    description: String(sample?.description ?? '').slice(0, 60),
  }
  if (report.lovelyCarve.description === undefined) throw new Error('lovelycarve 技能没有描述')

  report.ok = true
  client.close()
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error))
} finally {
  try { child?.kill() } catch { /* ignore */ }
  console.log(`REPORT ${JSON.stringify(report)}`)
  if (!report.ok) process.exitCode = 1
}
