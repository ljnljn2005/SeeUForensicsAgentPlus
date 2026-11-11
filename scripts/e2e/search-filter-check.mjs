/**
 * 第 17 轮前端验收：取证索引面板「检索」视图的筛选与引用清单导出。
 *
 * 场景：打开真实案件库 → 关键词「加密」检索 → 用结果里出现的检材号做筛选
 * （按筛选检索）→ 断言结果全部落在该检材 → 点「复制引用清单」→ 断言复制成功提示，
 * 并尽量读回剪贴板校验清单头与引用句柄 → 清空筛选 → 断言筛选框已空。
 *
 * 用法（仓库根）：npm run test:e2e:search（需先 npm run build）
 * 打包态：SEEU_UI_EXE=<绝对路径 exe> SEEU_NO_KILL=1 npm run test:e2e:search
 * 产出：一行 REPORT JSON。
 */
import { spawn, execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { join } from 'node:path'

const root = process.cwd()
const port = Number(process.env.SEEU_SEARCH_E2E_PORT || 9352)
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
const report = { ok: false, keyword: KEYWORD, errors }
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

try {
  await send('Runtime.enable')
  await sleep(3000)

  report.panelOpened = await clickText('取证索引')
  await sleep(1200)
  if (!report.panelOpened) throw new Error('侧栏没有「取证索引」')

  report.dirFilled = await setInput('案件目录', CASE_DIR)
  report.scanned = await clickText('扫描已有索引')
  await sleep(4500)

  // 打开「检索」标签（此时卡片里的检索按钮还不存在，命中的是标签页）
  report.tabOpened = await clickText('检索')
  await sleep(800)
  report.queryFilled = await setInput('关键词', KEYWORD)
  report.searched = await clickText('检索')
  await sleep(2000)

  const base = await readSearchRows()
  report.baseRows = base.length
  // 命中词高亮：结果片段里应有 <mark class="seeu-hl">，且内容就是查询词
  report.highlights = await evaluate('(() => { const ms = [...document.querySelectorAll(\'mark.seeu-hl\')]; return { count: ms.length, sample: ms.slice(0, 3).map((m) => m.textContent) } })()')
  report.highlightOk = (report.highlights?.count ?? 0) > 0 && (report.highlights?.sample ?? []).every((t) => String(t).includes("加密"))
  if (!base.length) throw new Error('关键词检索没有结果，无法继续')
  const eid = base[0].eid
  report.filterEid = eid

  report.eidFilled = await setInput('检材号 eid', String(eid))
  report.filterApplied = await clickText('按筛选检索')
  await sleep(2000)
  const filtered = await readSearchRows()
  report.filteredRows = filtered.length
  report.filteredAllMatch = filtered.length > 0 && filtered.every((r) => r.eid === eid)
  report.filterNarrowed = filtered.length <= base.length

  // 复制引用清单（Electron 走 preload 桥）
  report.copyClicked = await clickText('复制引用清单')
  await sleep(2500)
  const body = String((await evaluate('document.body.innerText')) ?? '')
  const copyMatch = body.match(/已复制\s*(\d+)\s*条引用清单/)
  report.copyNote = copyMatch ? copyMatch[0] : ''
  report.copyNoteShown = !!copyMatch

  // 读回剪贴板：渲染进程 readText 被权限拒绝，改从系统剪贴板（PowerShell Get-Clipboard）校验
  let clip = ''
  try {
    clip = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'], { encoding: 'utf8' })
  } catch (e) { report.clipboardError = String(e?.message ?? e) }
  report.clipboard = {
    len: clip.length,
    hasHeader: clip.includes('# SeeU 取证索引 · 检索引用清单'),
    hasCite: /引用：\S+/.test(clip),
    hasRecheck: /回查：/.test(clip),
    head: clip.split('\n').slice(0, 3).join(' | '),
  }

  // 清空筛选后筛选框应为空
  report.cleared = await clickText('清空筛选')
  await sleep(600)
  report.afterClear = await evaluate(`(() => {
    const el = Array.from(document.querySelectorAll('input')).find((i) => (i.placeholder || '').includes('检材号 eid'))
    return el ? el.value : null
  })()`)

  report.ok = report.panelOpened && report.scanned && report.tabOpened && report.queryFilled &&
    report.searched && report.baseRows > 0 && report.highlightOk && report.filterApplied && report.filteredRows > 0 &&
    report.filteredAllMatch && report.filterNarrowed && report.copyNoteShown &&
    report.clipboard.len > 0 && report.clipboard.hasHeader && report.clipboard.hasCite &&
    report.afterClear === '' && errors.length === 0
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
