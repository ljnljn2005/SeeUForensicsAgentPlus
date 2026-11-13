// 真实 Electron 外壳里的「案件索引」插件端到端检查：
// 启动 → 等侧栏出现「取证索引」→ 点开 → 自动扫描索引 → 打开案件 → 树导航 → 关键词检索。
import { spawn, execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const port = 9345
// 打包态验证：SEEU_UI_EXE 指向 release/win-unpacked 下的 exe
const exeOverride = process.env.SEEU_UI_EXE
const electron = exeOverride || join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const CASE_DIR = 'E:\\forensics\\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5'

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
if (process.env.SEEU_NO_KILL !== '1') {
  try {
    execFileSync('taskkill', ['/F', '/IM', exeOverride ? 'SeeUForensicsAgentPlus.exe' : 'electron.exe', '/T'], { stdio: 'ignore' })
  } catch { /* 无残留 */ }
}

// 第 37~39 轮：活动卡片需要可复现的历史（今天 1 条 + 昨天 1 条）。
// SEEU_DSH_HOME 必须是绝对路径（相对路径会被插件按 dsh 进程 cwd 解析，读不到）。
const dshHome = process.env.SEEU_DSH_HOME
if (dshHome && /^[A-Za-z]:[\/]/.test(dshHome)) {
  try {
    mkdirSync(dshHome, { recursive: true })
    const now = new Date()
    writeFileSync(
      join(dshHome, 'index-activity.json'),
      JSON.stringify({
        updatedAt: now.toISOString(),
        entries: [
          { kind: 'build', at: now.toISOString(), title: '今日建库样例', detail: '2 条', durationMs: 60000, caseDir: 'E:/seeu-missing-today', dbFile: 'E:/seeu-missing-today/.seeu-index/case-index.db' },
          { kind: 'myos-import', at: new Date(now.getTime() - 86400000).toISOString(), title: '昨日导入样例', detail: '1 条', rows: 1, caseDir: 'E:/seeu-missing-yesterday' },
        ],
      }, null, 2) + String.fromCharCode(10),
      'utf8',
    )
  } catch (error) {
    console.error('seed activity failed:', String(error && error.message ? error.message : error))
  }
}

const args = exeOverride ? [`--remote-debugging-port=${port}`] : ['.', `--remote-debugging-port=${port}`]
const child = spawn(electron, args, { cwd: exeOverride ? join(electron, '..') : root, env, stdio: ['ignore', 'pipe', 'pipe'] })
let appLog = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (c) => (appLog += c))
child.stderr.on('data', (c) => (appLog += c))

const deadline = Date.now() + 120000
let target = null
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
if (!target) {
  console.log('FAIL: 没有拿到 Web UI 页面', JSON.stringify(appLog.slice(-1200)))
  child.kill('SIGKILL')
  process.exit(1)
}
console.log('page:', target.url)

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
const errors = []
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
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})
await send('Runtime.enable')
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `ERR: ${r.result.exceptionDetails.text}`
  return r.result?.result?.value
}
const bodyText = () => ev('document.body.innerText')
const clickText = (text, tagFilter = 'button,div,a,li') => ev(`(() => {
  const nodes = [...document.querySelectorAll(${JSON.stringify(tagFilter)})]
  const hit = nodes.filter((n) => (n.innerText || '').trim() === ${JSON.stringify(text)} || (n.innerText || '').includes(${JSON.stringify(text)}))
    .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]
  if (!hit) return 'not-found'
  hit.click()
  return 'clicked:' + hit.tagName + '|' + (hit.className||'') + '|' + (hit.outerHTML||'').slice(0,180)
})()`)
const typeInto = (selector, value) => ev(`(() => {
  const list = [...document.querySelectorAll(${JSON.stringify(selector)})]
  const input = list[list.length - 1]
  if (!input) return 'no-input'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'typed'
})()`)
const pressEnter = () => ev(`(() => {
  const list = [...document.querySelectorAll('input')]
  const input = list[list.length - 1]
  if (!input) return 'no-input'
  for (const type of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  return 'enter'
})()`)

await sleep(8000)
const searchByKeyword = (value) => ev(`(() => {
  const input = [...document.querySelectorAll('input')].find((el) => (el.placeholder || '').includes('关键词'))
  if (!input) return 'no-input'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  for (const type of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  return 'typed-enter'
})()`)

const report = {}
report.sidebar = (await bodyText()).includes('取证索引')
// 1) 把上次使用的案件目录写进 localStorage，然后刷新，让面板初始状态就用它（等价于用户上次输入过）
report.seed = await ev('(() => { localStorage.setItem("seeu.indexDir", ' + JSON.stringify(CASE_DIR) + '); return "seeded" })()')
await ev('location.reload()')
await sleep(9000)
report.openPanel = await clickText('取证索引', 'button')
await sleep(9000)
let text = await bodyText()
report.scanFoundCase = text.includes('W盘')
report.treeRoot = /检材 5/.test(text) && /文件 370/.test(text)
// v0.1.8：树根每个检材要显示火眼里的名称与备注
report.evNames = /CHAN_MH_mobile\.zip/.test(text) && /LEUNG_YL_mobile\.zip/.test(text)
report.evRemark = text.includes('伤人案')
// KPI 里要能直接看到数据时间范围
report.kpiRange = /时间范围/.test(text) && /\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/.test(text)
// 会话上下文注入状态（AGENTS.md 里的案件概览）要能在面板上看到
report.briefVisible = /会话语境/.test(text) && /已注入/.test(text)
report.briefText = (text.match(/会话语境[^\n]{0,120}/) || [''])[0]
// 索引卡片显示「记录/实体/建库时间/体积」摘要（与写入会话概览的口径一致）
report.indexMeta = /条记录/.test(text) && /个实体/.test(text) && /建库 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
report.indexMetaText = (text.match(/索引：[^\n]{0,120}/) || [''])[0]
// 刷新按钮要真的能重写 AGENTS.md
report.briefRefreshClick = await clickText('刷新会话概览', 'button')
await sleep(2500)
report.briefRefreshText = (await bodyText()).match(/已刷新|刷新失败[^\n]{0,60}/)
  ? (await bodyText()).match(/已刷新|刷新失败[^\n]{0,60}/)[0]
  : ''
report.briefRefreshOk = /已刷新/.test(report.briefRefreshText)
// MYOS 导入入口：按钮存在，点开对话框（未启动 MYOS 时对话框内显示错误提示，属预期）
report.myosButton = await clickText('从 MYOS 导入…', 'button')
await sleep(1500)
{
  const t = await bodyText()
  report.myosDialog = /从超级取证大师（MYOS）导入/.test(t) && /结果库/.test(t) && /案件/.test(t)
}
await clickText('关闭', 'button')
await sleep(600)
// 索引来源筛选：全部 / 火眼建库 / MYOS 导入 / 外部目录
report.idxFilterChips = await ev("document.querySelectorAll('[data-index-src]').length")
report.idxFilterChipTexts = await ev("[...document.querySelectorAll('[data-index-src]')].map((el) => el.textContent).join('|')")
report.idxFilterClickMyos = await ev("(() => { const el = document.querySelector('[data-index-src=\"myos\"]'); if (!el) return false; el.click(); return true })()")
await sleep(700)
{
  const t = await bodyText()
  report.idxFilterEmpty = /没有来源为/.test(t)
}
report.idxFilterClickAll = await ev("(() => { const el = document.querySelector('[data-index-src=\"all\"]'); if (!el) return false; el.click(); return true })()")
await sleep(700)
{
  const t = await bodyText()
  report.idxFilterRestore = /W盘/.test(t) && !/没有来源为/.test(t)
}
// 链路体检：点索引行的「体检」，出现结果卡片（索引/检索/火眼挂载）
{
  report.idxChainButton = await ev("(() => { const el = document.querySelector('[data-chain-check]'); if (!el) return 0; el.click(); return 1 })()")
  for (let i = 0; i < 60; i += 1) {
    const textNow = await ev("(() => { const el = document.querySelector('[data-chain-result]'); return el ? el.innerText : '' })()")
    if (/案件：/.test(textNow) || /有环节失败/.test(textNow)) break
    await sleep(500)
  }
  report.idxChainResult = await ev("document.querySelectorAll('[data-chain-result]').length")
  report.idxChainText = await ev("(() => { const el = document.querySelector('[data-chain-result]'); return el ? el.innerText : '' })()")
  report.idxChainOk = report.idxChainButton === 1 && report.idxChainResult === 1 && /链路体检/.test(report.idxChainText) && /案件：/.test(report.idxChainText)
  await clickText('关闭', 'button')
  await sleep(400)
}
// 最近活动卡片：新 home 里没有历史活动，应显示空提示（有活动时至少有一行 data-activity-kind）
{
  const t = await bodyText()
  report.activityVisible = /最近活动/.test(t)
  report.activityRows = await ev("document.querySelectorAll('[data-activity-kind]').length")
  report.activityEmptyHint = /还没有活动记录/.test(t) || /建库或从 MYOS 导入后/.test(t)
  report.activitySummaryPresent = await ev("document.querySelectorAll('[data-activity-summary]').length")
  // 第 36 轮：最近活动按天分布小条形（7 根，无历史时也可能存在空桶）。
  report.activityBars = await ev("document.querySelectorAll('[data-activity-bars] > div').length")
  report.activityBarColors = await ev("Array.from(document.querySelectorAll('[data-activity-bars] > div')).slice(0,3).map(el => el.title)")
  // 第 37 轮：点某天条形 → 只显示当天活动，再点取消。e2e 预置了今天 1 条 / 昨天 1 条活动。
  const bars = await ev("document.querySelectorAll('[data-activity-bars] > div').length")
  if (bars === 7) {
    await ev("document.querySelectorAll('[data-activity-bars] > div')[6].click(), true")
    await sleep(350)
    report.activityFilterText = await ev("(document.querySelector('[data-activity-filter]') || {}).textContent || ''")
    report.activityHeaderText = await ev("(document.querySelector('[data-activity-count]') || {}).textContent || ''")
    report.activityFilterHint = /当天 1 条/.test(String(report.activityHeaderText))
    await ev("document.querySelectorAll('[data-activity-bars] > div')[6].click(), true")
    await sleep(350)
    report.activityFilterCleared = await ev("document.querySelectorAll('[data-activity-filter]').length === 0")
    report.activityDayFilterOk = /只看/.test(String(report.activityFilterText)) && report.activityFilterHint === true && report.activityFilterCleared === true
    // 第 39 轮：点一条指向已不存在目录的活动 → 给出可读提示，不静默失败。
    report.activityRowCount = await ev("document.querySelectorAll('[data-activity-kind]').length")
    report.activityRowText = await ev("(document.querySelector('[data-activity-kind]') || {}).textContent || ''")
    await ev("(document.querySelector('[data-activity-kind]') || {click(){}}).click(), true")
    await sleep(2600)
    report.activityNoteEls = await ev("document.querySelectorAll('[data-activity-note]').length")
    report.activityOpenNote = await ev("(document.querySelector('[data-activity-note]') || {}).textContent || ''")
    report.activityOpenNoteOk = /打不开该活动/.test(String(report.activityOpenNote))
    if (!report.activityOpenNoteOk) throw new Error('活动行打开失败时没有提示：' + JSON.stringify({ note: report.activityOpenNote, rows: report.activityRowCount, rowText: report.activityRowText, noteEls: report.activityNoteEls, firstRows: report.activityRows, visible: report.activityVisible, emptyHint: report.activityEmptyHint, bars: report.activityBars, filterText: report.activityFilterText }))
    console.log('活动打开失败提示:', String(report.activityOpenNote).slice(0, 60))
    // 第 40 轮：移除单条活动（按钮不冒泡触发打开）。
    report.activityRowsBeforeRemove = await ev("document.querySelectorAll('[data-activity-kind]').length")
    await ev("(document.querySelector('[data-activity-remove]') || {click(){}}).click(), true")
    await sleep(900)
    report.activityRowsAfterRemove = await ev("document.querySelectorAll('[data-activity-kind]').length")
    report.activityRemoveOk = report.activityRowsBeforeRemove === 2 && report.activityRowsAfterRemove === 1

    // 第 43 轮：活动文本筛选（案件名 / 表名 / 类型）。
    const setActivitySearch = (value) => ev(`(() => { const i = document.querySelector('[data-activity-search]'); if (!i) return 'no-input'; const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok' })()`)
    report.activitySearchInput = await ev("document.querySelectorAll('[data-activity-search]').length")
    await setActivitySearch('昨日')
    await sleep(600)
    report.activitySearchRows = await ev("document.querySelectorAll('[data-activity-kind]').length")
    report.activitySearchCountText = String(await ev("(document.querySelector('[data-activity-search-count]') || {}).textContent || ''"))
    await setActivitySearch('不存在')
    await sleep(600)
    report.activitySearchEmpty = await ev("Boolean(document.querySelector('[data-activity-empty]'))")
    report.activitySearchEmptyText = String(await ev("(document.querySelector('[data-activity-empty]') || {}).textContent || ''"))
    await setActivitySearch('')
    await sleep(600)
    report.activitySearchRestored = await ev("document.querySelectorAll('[data-activity-kind]').length")
    report.activitySearchOk = report.activitySearchInput === 1 && report.activitySearchRows === 1 && /1 条匹配/.test(report.activitySearchCountText) && report.activitySearchEmpty === true && /没有匹配/.test(report.activitySearchEmptyText) && report.activitySearchRestored === 1
    if (!report.activitySearchOk) throw new Error('活动筛选失败：' + JSON.stringify({ input: report.activitySearchInput, rows: report.activitySearchRows, count: report.activitySearchCountText, empty: report.activitySearchEmpty, emptyText: report.activitySearchEmptyText, restored: report.activitySearchRestored }))
    if (!report.activityRemoveOk) throw new Error('移除活动失败：' + JSON.stringify({ before: report.activityRowsBeforeRemove, after: report.activityRowsAfterRemove }))
  }

  report.activitySummaryText = await ev("(() => { const el = document.querySelector('[data-activity-summary]'); return el ? el.textContent.trim() : '' })()")
  report.activityOk = report.activityVisible === true && (report.activityRows > 0 || report.activityEmptyHint === true) && report.activitySummaryPresent === 1 && report.activityBars === 7 && report.activityDayFilterOk === true && report.activityOpenNoteOk === true && report.activityRemoveOk === true && report.activitySearchOk === true
}
report.idxFilterOk = report.idxFilterChips === 4 && report.idxFilterClickMyos === true && report.idxFilterEmpty === true && report.idxFilterClickAll === true && report.idxFilterRestore === true
report.rootText = text.slice(text.indexOf('取证案件索引'), text.indexOf('取证案件索引') + 900)
report.drill3 = await clickText('检材 3', 'div')
await sleep(6000)
text = await bodyText()
report.drilledApps = text.includes('WhatsApp') || text.includes('Safari')
report.drilledText = text.slice(text.indexOf('检材 3') >= 0 ? text.indexOf('检材 3') : 0, text.indexOf('检材 3') + 900)

// 树视图：本层过滤（分类里文件很多时按名字找）
const treeRowCount = () => ev("document.querySelectorAll('.seeu-tree-row').length")
report.treeFilterVisible = await ev("!!document.querySelector('[data-seeu-tree-filter]')")
report.treeRowsBefore = await treeRowCount()
const setTreeFilter = (value) => ev(`(() => { const i = document.querySelector('[data-seeu-tree-filter]'); if (!i) return 'no-input'; const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok' })()`)
report.treeFilterTyped = await setTreeFilter('zzzz-no-match')
await sleep(500)
report.treeFilterEmpty = /本层没有匹配的节点/.test(await bodyText())
await setTreeFilter('')
await sleep(500)
report.treeRowsAfter = await treeRowCount()
report.treeFilterOk = report.treeFilterVisible === true && report.treeFilterEmpty === true && report.treeRowsBefore === report.treeRowsAfter && Number(report.treeRowsBefore) > 1
// 先切到「检索」标签，否则 last input 是顶部的案件目录输入框
await clickText('检索', 'button')
await sleep(1500)
report.searchTyped = await searchByKeyword('加密')
await sleep(400)
report.searchEnter = report.searchTyped
await sleep(7000)
text = await bodyText()
report.searchOk = /引擎 (?:fts5-)?(?:trigram|like) · \d+ 命中/.test(text)
// 长关键词（>=3 字）必须走 trigram 且有命中：回归 ftsQuery is not defined 导致 /search 500 的问题
report.searchLongTyped = await searchByKeyword('Investors')
await sleep(7000)
const searchLongText = await bodyText()
const longIdx = searchLongText.indexOf('引擎')
report.searchLongText = longIdx >= 0 ? searchLongText.slice(longIdx, longIdx + 200) : searchLongText.slice(0, 200)
report.searchLongOk = /引擎 (?:fts5-)?trigram · ([1-9]\d*) 命中/.test(report.searchLongText)
// 检索视图的应用筛选应是下拉（选项来自 /facets，带记录数）
report.searchAppOptions = await ev(`(() => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /（\\d+）$/.test(o.textContent)))
  return sel ? sel.options.length : 0
})()`)
report.searchAppSelect = Number(report.searchAppOptions) > 1
// 检索结果行的检材标签应是名称（如 LEUNG_YL_mobile.zip），而不是只有 eid
report.searchEvNames = /(CHAN_MH_mobile\.zip|LEUNG_YL_mobile\.zip|FUNG_CC_mobile\.zip|IQ_Coin_Type_Transactions\.zip|AP3_LEUNG_YL_USB\.E01)/.test(text)
const idx = text.indexOf('引擎')
report.searchText = idx >= 0 ? text.slice(idx, idx + 800) : text.slice(0, 600)

// ---------- M2：四个新视图（记录 / 实体 / 时间线 / 表） ----------
report.tabNames = await ev('[...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter(Boolean).slice(0, 24)')
const openTab = async (label) => {
  const r = await clickText(label, 'button')
  await sleep(4500)
  return r
}
report.tabRecordsClick = await openTab('记录')
text = await bodyText()
report.recordsText = text.slice(text.indexOf('记录'), text.indexOf('记录') + 700)
// 记录视图筛选：检材下拉（按名称找选项）+ 起止日期输入
report.recordsBeforeCount = Number((text.match(/记录 (\d+) 条/) || [])[1] ?? 0)
report.recordsFilterPick = await ev(`(() => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /LEUNG_YL_mobile\\.zip/.test(o.textContent)))
  if (!sel) return 'no-select'
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(sel, '3')
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '查询')
  if (btn) btn.click()
  return 'ok'
})()`)
await sleep(3500)
text = await bodyText()
report.recordsAfterCount = Number((text.match(/记录 (\d+) 条/) || [])[1] ?? 0)
report.recordsFilterText = (text.match(/记录 \d+ 条/) || [''])[0]
report.recordsFilterOk = report.recordsFilterPick === 'ok' && report.recordsBeforeCount > 0 && report.recordsAfterCount > 0 && report.recordsAfterCount < report.recordsBeforeCount && /LEUNG_YL_mobile\.zip/.test(text)
// 记录视图：应用下拉（来自 /facets）——选第二个应用后条数应减少且大于 0
report.recordsAppPick = await ev(`(() => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /（\\d+）$/.test(o.textContent)))
  if (!sel) return 'no-select'
  const opt = [...sel.options].find(o => o.value && /（\\d+）$/.test(o.textContent))
  if (!opt) return 'no-option'
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(sel, opt.value)
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '查询')
  if (btn) btn.click()
  return opt.value
})()`)
await sleep(3000)
text = await bodyText()
report.recordsAppCount = Number((text.match(/记录 (\d+) 条/) || [])[1] ?? 0)
report.recordsAppFilterOk = typeof report.recordsAppPick === 'string' && report.recordsAppPick !== 'no-select' && report.recordsAppPick !== 'no-option' && report.recordsAppCount > 0 && report.recordsAppCount < report.recordsBeforeCount
await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '清空')
  if (btn) btn.click()
  return 'cleared'
})()`)
await sleep(2500)
report.tabEntityClick = await openTab('实体')
text = await bodyText()
report.entityText = text.slice(text.indexOf('实体'), text.indexOf('实体') + 700)
// 实体视图：共 N 条聚合 + 下一页（第一版只显示前 30 条，8191 个实体看不到后面的）
report.entityPager = text.match(/共 (\d+) 条聚合 · 当前 (\d+)-(\d+)/)
report.entityTotal = report.entityPager ? Number(report.entityPager[1]) : 0
report.entityFirstPageText = await bodyText()
report.entityNextClick = await clickText('下一页', 'button')
if (report.entityNextClick) {
  await sleep(1800)
  text = await bodyText()
  report.entitySecondPageText = text.slice(text.indexOf('实体'), text.indexOf('实体') + 700)
  report.entityPagingOk = report.entityTotal > 30 && report.entityFirstPageText !== report.entitySecondPageText
// 实体视图的检材筛选也应是下拉
report.entityEvOptions = await ev(`(() => {
  const sels = [...document.querySelectorAll('select')]
  const evSel = sels.find(s => [...s.options].some(o => /LEUNG_YL_mobile\\.zip/.test(o.textContent)))
  return evSel ? evSel.options.length : 0
})()`)
report.entityEvSelectOk = report.entityEvOptions > 1
}
report.tabTimelineClick = await openTab('时间线')
text = await bodyText()
report.timelineText = text.slice(text.indexOf('时间线'), text.indexOf('时间线') + 700)
// 时间线筛选也应是下拉：检材（带名称）+ 应用（带记录数）
report.timelineFilterOptions = await ev(`(() => {
  const sels = [...document.querySelectorAll('select')]
  const evSel = sels.find(s => [...s.options].some(o => /LEUNG_YL_mobile\.zip/.test(o.textContent)))
  const appSel = sels.find(s => [...s.options].some(o => /（\\d+）$/.test(o.textContent)))
  return { ev: evSel ? evSel.options.length : 0, app: appSel ? appSel.options.length : 0 }
})()`)
report.timelineFiltersOk = report.timelineFilterOptions.ev > 1 && report.timelineFilterOptions.app > 1
report.tabTablesClick = await openTab('表')
text = await bodyText()
report.tablesText = text.slice(text.indexOf('表'), text.indexOf('表') + 1600)
report.myosImportOk = String(report.myosButton ?? '').startsWith('clicked') && report.myosDialog === true
report.m2ok = /联系人/.test(report.tablesText) && report.entityText.length > 10 && report.timelineText.length > 10 && report.briefVisible === true && report.briefRefreshOk === true && report.recordsFilterOk === true && report.recordsAppFilterOk === true && report.kpiRange === true && report.treeFilterOk === true && report.searchEvNames === true && report.searchAppSelect === true && report.searchLongOk === true && report.timelineFiltersOk === true && report.entityPagingOk === true && report.entityEvSelectOk === true && report.indexMeta === true && report.myosImportOk === true

// ---------- 浅色主题回归（SEEU_E2E_THEME=light；暗色为默认） ----------
if (process.env.SEEU_E2E_THEME === 'light') {
  report.lightRemoved = await ev(`(() => {
    document.body.removeAttribute('data-ds-dark-theme')
    document.documentElement.removeAttribute('data-ds-dark-theme')
    return !document.body.hasAttribute('data-ds-dark-theme')
  })()`)
  await sleep(1500)
  report.lightStyles = await ev(`(() => {
    const parse = (c) => (String(c).match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
    const lum = (a) => (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) / 255
    const row = document.querySelector('.seeu-row.is-clickable') || document.body
    const bodyBg = getComputedStyle(document.body).backgroundColor
    const rowColor = getComputedStyle(row).color
    return { bodyBg, rowColor, bodyLum: lum(parse(bodyBg)), rowLum: lum(parse(rowColor)) }
  })()`)
  report.lightOk = report.lightRemoved && report.lightStyles.bodyLum > 0.75 && report.lightStyles.rowLum < 0.45
}

report.errors = errors.slice(0, 6)
console.log('REPORT', JSON.stringify(report, null, 2))

try { execFileSync('taskkill', ['/F', '/PID', String(child.pid), '/T'], { stdio: 'ignore' }) } catch { /* ignore */ }
child.kill('SIGKILL')
process.exit(0)
