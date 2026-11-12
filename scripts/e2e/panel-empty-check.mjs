/**
 * 第 11 轮前端验收：取证索引面板的「首次使用引导」。
 *
 * 场景：一个索引库都没有（`SEEU_INDEX_SEARCH_DIRS` 指向空目录、无 index-state），
 * 打开面板时应显示「三步开始」引导，而不是只给一句「还没有索引库」。
 *
 * 用法（仓库根）：npm run test:e2e:panel-empty（需先 npm run build）
 * 产出：一行 REPORT JSON。
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const repo = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'))
const electron = join(repo, 'node_modules', 'electron', 'dist', 'electron.exe')
const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.findIndex((a) => a === `--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const cdpPort = Number(arg('port', '9364'))
const mockPort = Number(arg('mock-port', '18089'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const getJson = (url) =>
  new Promise((res, rej) => {
    http.get(url, { timeout: 2000 }, (r) => {
      let b = ''
      r.setEncoding('utf8')
      r.on('data', (c) => (b += c))
      r.on('end', () => { try { res(JSON.parse(b)) } catch (e) { rej(e) } })
    }).on('error', rej).on('timeout', () => rej(new Error('timeout')))
  })

const startMock = () => new Promise((res) => {
  const server = http.createServer((req, resp) => {
    if (req.url === '/v1/models') {
      resp.writeHead(200, { 'content-type': 'application/json' })
      resp.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5-32b-instruct' }] }))
      return
    }
    resp.writeHead(404); resp.end('{}')
  })
  server.listen(mockPort, '127.0.0.1', () => res(server))
})

async function findPage() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const list = await getJson(`http://127.0.0.1:${cdpPort}/json/list`)
      const page = list.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url))
      if (page) return page
    } catch { /* CDP 未起 */ }
    await sleep(200)
  }
  throw new Error('主页面超时未出现')
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
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

const evaluate = async (conn, expression) => {
  const r = await conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluate 失败')
  return r.result?.value
}

const report = { ok: false, errors: [] }
let child
let mock
try {
  const home = join(repo, '.dev', 'panel-empty-home')
  const ud = join(repo, '.dev', 'panel-empty-ud')
  const emptyDirs = join(repo, '.dev', 'panel-empty-search')
  for (const dir of [home, ud, emptyDirs]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }

  mock = await startMock()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  Object.assign(env, {
    SEEU_DEV_MULTI: '1',
    SEEU_DSH_HOME: home,
    SEEU_USER_DATA: ud,
    // 关键：搜索路径指向空目录且没有 index-state ⇒ 面板必须走「一个库都没有」的分支
    SEEU_INDEX_SEARCH_DIRS: emptyDirs,
    SEEU_INDEX_STATE_FILE: join(home, 'index-state.json'),
    SEEU_LOCAL_MODEL_JSON: JSON.stringify({
      baseURL: `http://127.0.0.1:${mockPort}/v1`,
      models: [{ id: 'qwen2.5-32b-instruct' }],
      useAsDefault: true, apiKey: 'local', contextWindow: 131072, maxTokens: 8192,
    }),
  })

  child = spawn(electron, [repo, `--remote-debugging-port=${cdpPort}`], { env, stdio: 'ignore', windowsHide: true })
  const page = await findPage()
  const conn = await connect(page.webSocketDebuggerUrl)
  await conn.send('Runtime.enable')
  await sleep(3000)

  // 点侧栏「取证索引」打开面板
  report.clicked = await evaluate(conn, `(() => {
    const all = Array.from(document.querySelectorAll('div,button,a,span'))
    const hit = all.find((el) => el.children.length <= 3 && (el.textContent || '').trim() === '取证索引')
    if (!hit) return false
    hit.click()
    return true
  })()`)
  await sleep(1200)

  const text = String((await evaluate(conn, 'document.body.innerText')) ?? '')
  report.hasSteps = text.includes('三步开始')
  report.hasStep1 = text.includes('火眼（GoldenEyes）里跑完检材解析')
  report.hasStep3 = text.includes('回查 Goldeneyes 句柄')
  report.hasBuildButton = text.includes('建库 / 更新')
  report.noIndexText = text.includes('还没有索引库')
  conn.close()

  report.ok = report.clicked === true && report.hasSteps && report.hasStep1 && report.hasStep3 && report.hasBuildButton && report.noIndexText
  if (!report.ok) report.errors.push('引导卡片断言未全部通过')
} catch (error) {
  report.errors.push(String(error?.message ?? error))
} finally {
  if (child?.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  if (mock) mock.close()
  console.log('REPORT ' + JSON.stringify(report))
  process.exit(report.ok ? 0 : 1)
}
