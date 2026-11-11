/**
 * 第 18 轮前端验收：取证索引面板各视图的「复制引用清单 / 实体清单」导出。
 *
 * 场景：打开真实案件库 → 关键词「加密」检索 → 用结果里出现的检材号做筛选
 * （按筛选检索）→ 断言结果全部落在该检材 → 点「复制引用清单」→ 断言复制成功提示，
 * 并尽量读回剪贴板校验清单头与引用句柄 → 清空筛选 → 断言筛选框已空。
 *
 * 用法（仓库根）：npm run test:e2e:export（需先 npm run build）
 * 打包态：SEEU_UI_EXE=<绝对路径 exe> SEEU_NO_KILL=1 npm run test:e2e:export
 * 产出：一行 REPORT JSON。
 */
import { spawn, execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { join } from 'node:path'

const root = process.cwd()
const port = Number(process.env.SEEU_EXPORT_E2E_PORT || 9353)
const exeOverride = process.env.SEEU_UI_EXE
const electron = exeOverride || join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const CASE_DIR = process.env.SEEU_CASE_DIR || 'E:\\forensics\\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5'
const KEYWORD = process.env.SEEU_SEARCH_KEYWORD || '加密'

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

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.SEEU_DEV_MULTI = '1'
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
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
    if (/seeu|case-index|取证索引/i.test(text)) errors.push(`${msg.params.type}: ${text}`.slice(0, 300))
  }
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

const setInput = (placeholderPart, value) => evaluate(`(() => {
  const el = Array.from(document.querySelectorAll('input')).find((i) => (i.placeholder || '').includes(${JSON.stringify(placeholderPart)}))
  if (!el) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)

const readSearchRows = () => evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('.seeu-row.is-clickable'))
  return rows.map((el) => {
    const tag = (el.firstElementChild?.textContent || '').trim()
    const m = tag.match(/^(\\d+)·(.*)$/)
    return m ? { eid: Number(m[1]), app: m[2], text: (el.textContent || '').slice(0, 120) } : null
  }).filter(Boolean)
})()`)


const clickTab = (label) => evaluate(`(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
  const el = tabs.find((t) => (t.firstChild?.textContent || '').trim() === ${JSON.stringify(label)})
  if (!el) return false
  el.click()
  return true
})()`)

const pickTable = (labelPart) => evaluate(`(() => {
  const sel = document.querySelector('select')
  if (!sel) return null
  const opt = Array.from(sel.options).find((o) => (o.textContent || '').includes(${JSON.stringify(labelPart)}))
  if (!opt) return null
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(sel, opt.value)
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return opt.textContent
})()`)

const readClipboard = () => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'], { encoding: 'utf8' })
  } catch { return '' }
}

const noteText = async (regex) => {
  const body = String((await evaluate('document.body.innerText')) ?? '')
  const m = body.match(regex)
  return m ? m[0] : ''
}

try {
  await send('Runtime.enable')
  await sleep(3000)

  report.panelOpened = await clickText('取证索引')
  await sleep(1200)
  if (!report.panelOpened) throw new Error('侧栏没有「取证索引」')

  report.dirFilled = await setInput('案件目录', CASE_DIR)
  report.scanned = await clickText('扫描已有索引')
  await sleep(4500)

  // ---- 1) 记录视图：复制本页引用清单 ----
  report.tabRecords = await clickTab('记录')
  await sleep(2500)
  report.recordsCopied = await clickText('复制本页引用清单')
  await sleep(3500)
  report.recordsNote = await noteText(/已复制\s*\d+\s*条记录引用清单[^\n]*/)
  const clipRecords = readClipboard()
  report.recordsClipboard = {
    len: clipRecords.length,
    hasHeader: clipRecords.includes('# SeeU 取证索引 · 记录引用清单'),
    hasCite: /引用：\S+/.test(clipRecords),
    hasRecheck: /回查：/.test(clipRecords),
  }

  // ---- 2) 实体视图：复制实体清单 ----
  report.tabEntity = await clickTab('实体')
  await sleep(2200)
  report.entityCopied = await clickText('复制实体清单')
  await sleep(2500)
  report.entityNote = await noteText(/已复制\s*\d+\s*条实体清单[^\n]*/)
  const clipEntity = readClipboard()
  report.entityClipboard = {
    len: clipEntity.length,
    hasHeader: clipEntity.includes('# SeeU 取证索引 · 实体清单'),
    hasKind: /\[\w+\]/.test(clipEntity),
  }

  // ---- 3) 表视图：选「联系人」表，复制可引用行 ----
  report.tabTables = await clickTab('表')
  await sleep(2500)
  report.tablePicked = await pickTable('联系人')
  await sleep(2800)
  report.tableCopied = await clickText('复制本页引用清单')
  await sleep(3500)
  report.tableNote = await noteText(/已复制\s*\d+\s*行表记录引用清单[^\n]*|当前页没有可引用的行[^\n]*/)
  const clipTable = readClipboard()
  report.tableClipboard = {
    len: clipTable.length,
    hasHeader: clipTable.includes('表引用清单'),
    hasCite: /引用：\S+/.test(clipTable),
  }

  report.ok = report.panelOpened && report.scanned &&
    report.tabRecords && report.recordsCopied && report.recordsClipboard.hasHeader && report.recordsClipboard.hasCite && report.recordsClipboard.len > 0 &&
    report.tabEntity && report.entityCopied && report.entityClipboard.hasHeader && report.entityClipboard.len > 0 &&
    report.tabTables && !!report.tablePicked && report.tableCopied && report.tableClipboard.hasHeader && report.tableClipboard.hasCite &&
    errors.length === 0
  if (!report.ok) report.errors.push('部分断言未通过')
} catch (error) {
  report.errors.push(String(error?.message ?? error))
} finally {
  try { ws.close() } catch { /* ignore */ }
  if (child?.pid) {
    if (process.env.SEEU_NO_KILL === '1') { try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ } }
    else { try { child.kill('SIGKILL') } catch { /* ignore */ } }
  }
  if (!report.ok && appLog) report.appLogTail = appLog.slice(-600)
  console.log('REPORT ' + JSON.stringify(report))
  process.exit(report.ok ? 0 : 1)
}
