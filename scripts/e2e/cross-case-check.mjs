/**
 * 第 47 轮前端验收：跨案中央库（M5）双案件夹具端到端。
 *
 * 场景：把真实案件索引库复制成两个不同案号/案名的夹具（案件甲/案件乙）→ 启动外壳 →
 * 索引面板「扫描已有索引」→ 切到「跨案」→【同步全部案件】→ 断言两案都进了中央库、
 * 重合实体 Top 有数据 →【复制重合实体清单】→ 读回剪贴板校验抬头/案数/案号。
 *
 * 用法（仓库根）：npm run test:e2e:cross（需先 npm run build）
 * 打包态：SEEU_UI_EXE=<绝对路径 exe> SEEU_NO_KILL=1 npm run test:e2e:cross
 * 产出：一行 REPORT JSON。
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { request } from 'node:http'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const port = Number(process.env.SEEU_CROSS_E2E_PORT || 9384)
const exeOverride = process.env.SEEU_UI_EXE
const electron = exeOverride || join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const CASE_DIR = process.env.SEEU_CASE_DIR || 'E:\\forensics\\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5'
const srcDb = join(CASE_DIR, '.seeu-index', 'case-index.db')
const srcManifest = join(CASE_DIR, '.seeu-index', 'manifest.json')

const fixtureRoot = join(root, '.dev', 'cross')
const dirA = join(fixtureRoot, '案件甲_2919')
const dirB = join(fixtureRoot, '案件乙_77aa')
const homeDir = join(root, '.dev', 'cross-home')
const udDir = join(root, '.dev', 'cross-ud')
const crossDb = join(fixtureRoot, 'indexes', 'crosscase.db')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function get(url, timeout = 3000) {
  return new Promise((resolve) => {
    const req = request(url, { method: 'GET', timeout }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', (e) => resolve({ status: 0, error: String(e.message) }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }) })
    req.end()
  })
}

// ---------- 夹具：两个不同案号/案名的索引库 ----------
function patchCase(dbPath, { caseNumber, caseName, location }) {
  const db = new DatabaseSync(dbPath)
  try {
    const up = db.prepare('update meta set v=? where k=?')
    for (const [k, v] of [['case_number', caseNumber], ['case_name', caseName], ['case_location', location]]) up.run(v, k)
    try {
      for (const [k, v] of [['case_number', caseNumber], ['name', caseName], ['location', location]]) {
        db.prepare('update case_info set v=? where k=?').run(v, k)
      }
    } catch { /* 老库可能没有 case_info */ }
  } finally { db.close() }
}

function ensureFixture(dir, patch) {
  const idx = join(dir, '.seeu-index')
  mkdirSync(idx, { recursive: true })
  const dbPath = join(idx, 'case-index.db')
  if (!existsSync(dbPath)) copyFileSync(srcDb, dbPath)
  if (existsSync(srcManifest)) copyFileSync(srcManifest, join(idx, 'manifest.json'))
  patchCase(dbPath, patch)
  return dbPath
}

if (!existsSync(srcDb)) {
  console.log('REPORT ' + JSON.stringify({ ok: false, errors: [`真实案件索引库不存在：${srcDb}`] }))
  process.exit(1)
}
ensureFixture(dirA, { caseNumber: 'cross-fixture-a', caseName: '跨案夹具A', location: dirA })
ensureFixture(dirB, { caseNumber: 'cross-fixture-b', caseName: '跨案夹具B', location: dirB })

mkdirSync(homeDir, { recursive: true })
mkdirSync(udDir, { recursive: true })
writeFileSync(join(homeDir, 'index-state.json'), JSON.stringify({ dirs: [dirA, dirB] }, null, 1))

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.SEEU_DEV_MULTI = '1'
env.SEEU_DSH_HOME = homeDir
env.SEEU_USER_DATA = udDir
env.SEEU_WORKSPACE = fixtureRoot
env.SEEU_CROSS_DB = crossDb
if (process.env.SEEU_NO_KILL !== '1') {
  try {
    execFileSync('taskkill', ['/F', '/IM', exeOverride ? 'SeeUForensicsAgentPlus.exe' : 'electron.exe', '/T'], { stdio: 'ignore' })
  } catch { /* 无残留 */ }
}
const args = exeOverride ? [`--remote-debugging-port=${port}`] : ['.', `--remote-debugging-port=${port}`]
const child = spawn(electron, args, { cwd: exeOverride ? join(electron, '..') : root, env, stdio: ['ignore', 'pipe', 'pipe'] })
let appLog = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (c) => (appLog += c))
child.stderr.on('data', (c) => (appLog += c))

const errors = []
let target = null
const deadline = Date.now() + 120000
while (Date.now() < deadline && child.exitCode === null) {
  const r = await get(`http://127.0.0.1:${port}/json/list`)
  if (r.status === 200) {
    try {
      target = JSON.parse(r.body).find((p) => p.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+/.test(p.url))
      if (target) break
    } catch { /* 未就绪 */ }
  }
  await sleep(500)
}
const report = { ok: false, errors }
if (!target) {
  report.errors.push('没有拿到 Web UI 页面')
  console.log('REPORT ' + JSON.stringify(report))
  child.kill('SIGKILL')
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    errors.push(`exception: ${d.text} ${d.exception?.description ?? ''}`.slice(0, 300))
  }
}
const send = (method, params) => new Promise((res) => {
  const id = ++seq
  pending.set(id, res)
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'evaluate 失败')
  return r.result?.result?.value
}
const bodyText = async () => String((await evaluate('document.body.innerText')) ?? '')

const clickText = (text, box) => evaluate(`(() => {
  const scope = ${box ? `document.querySelector(${JSON.stringify(box)})` : 'document'}
  if (!scope) return false
  const all = Array.from(scope.querySelectorAll('button,a,div,span'))
  const hits = all.filter((el) => el.children.length <= 2 && (el.textContent || '').trim() === ${JSON.stringify(text)})
  const el = hits[hits.length - 1]
  if (!el) return false
  el.click()
  return true
})()`)

const clickTab = (label) => evaluate(`(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
  const el = tabs.find((t) => (t.firstChild?.textContent || '').trim() === ${JSON.stringify(label)})
  if (!el) return false
  el.click()
  return true
})()`)

const readClipboard = () => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'], { encoding: 'utf8' })
  } catch { return '' }
}

const waitFor = async (regex, ms) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const text = await bodyText()
    const m = text.match(regex)
    if (m) return m[0]
    await sleep(1000)
  }
  return ''
}

try {
  await send('Runtime.enable')
  await sleep(3000)

  report.panelOpened = await clickText('取证索引')
  await sleep(1500)
  if (!report.panelOpened) throw new Error('侧栏没有「取证索引」')

  report.scanned = await clickText('扫描已有索引')
  await sleep(7000)
  report.treeHasBoth = /跨案夹具A/.test(await bodyText()) && /跨案夹具B/.test(await bodyText())

  report.tabCross = await clickTab('跨案')
  await sleep(2000)
  report.synced = await clickText('同步全部案件')
  report.syncNote = await waitFor(/同步完成：[^\n]*/, 90000)
  await sleep(2500)

  const text = await bodyText()
  report.crossPathLine = (text.match(/跨案库：[^\n]*/) ?? [''])[0]
  report.casesListedA = /跨案夹具A/.test(text)
  report.casesListedB = /跨案夹具B/.test(text)
  report.overlapNote = (text.match(/共\s*\d+\s*条\s*·\s*点一行看各案提及[^\n]*/) ?? [''])[0]

  report.copyClicked = await clickText('复制重合实体清单')
  await sleep(3500)
  report.copyNote = (await bodyText()).match(/已复制\s*\d+\s*条重合实体清单[^\n]*/)?.[0] ?? ''
  const clip = readClipboard()
  report.clipboard = {
    len: clip.length,
    hasHeader: clip.includes('# SeeU 跨案 · 重合实体清单'),
    hasTwoCases: /2 案/.test(clip),
    hasCaseNumbers: /cross-fixture-[ab]/.test(clip),
    hasKinds: /\[(phone|email|url|sha256|md5|wallet|ip)\]/i.test(clip),
  }

  report.ok = report.scanned === true && report.treeHasBoth === true && /同步完成/.test(report.syncNote) &&
    report.casesListedA === true && report.casesListedB === true &&
    report.copyClicked === true && report.clipboard.hasHeader === true &&
    report.clipboard.hasTwoCases === true && report.clipboard.hasCaseNumbers === true &&
    report.clipboard.hasKinds === true && errors.length === 0
} catch (error) {
  report.fatal = String(error?.message ?? error)
} finally {
  console.log('REPORT ' + JSON.stringify(report))
  try { ws.close() } catch { /* ignore */ }
  child.kill('SIGKILL')
}
process.exit(report.ok ? 0 : 1)
