/**
 * 本地模型设置窗口的 CDP 验收脚本。
 *
 * 做四件事：
 *   1. 起一个 mock OpenAI 网关（仅 /v1/models），验证设置页的「测试连接」；
 *   2. 用独立 userData / DSH_HOME 启动 Electron（SEEU_DEV_MULTI=1，避免和用户实例抢单实例锁；
 *      SEEU_OPEN_SETTINGS=1 让启动即打开设置窗口）；
 *   3. 通过 CDP 在设置页里执行 get → 填表 → preview → save → test；
 *   4. 截图 + 输出一行 JSON 报告。
 *
 * 用法：node scripts/e2e/settings-check.mjs [--out scripts/e2e/shots/local-model.png]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const argOut = process.argv.indexOf('--out')
const OUT = argOut > -1 ? process.argv[argOut + 1] : join(REPO, '.probe', 'shots', 'local-model-settings.png')
const CDP_PORT = 9351
const MOCK_PORT = 18081
const argExe = process.argv.indexOf('--exe')
const EXE = argExe > -1 ? resolve(process.argv[argExe + 1]) : join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const EXE_ARGS = argExe > -1 ? [] : [REPO]
const ELECTRON = join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe')
const UD = join(REPO, '.dev', 'settings-ud')
const HOME = join(REPO, '.dev', 'settings-home')
const CONFIG = join(UD, 'local-model.json')

const report = { ok: false, steps: [], errors: [] }

function log(step, detail) {
  report.steps.push(detail === undefined ? step : `${step}: ${detail}`)
}

async function startMockGateway() {
  const server = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      // 模拟 vLLM：/v1/models 里自报 max_model_len，设置页应能自动填上下文窗口
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'qwen2.5-32b-instruct', max_model_len: 32768 },
            { id: 'mock-14b', max_model_len: 32768 },
          ],
        }),
      )
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
  await new Promise((done) => server.listen(MOCK_PORT, '127.0.0.1', done))
  return server
}

async function cdpTargets() {
  const text = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).text()
  return JSON.parse(text)
}

async function waitForSettingsPage(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await cdpTargets()
      const page = targets.find((t) => t.type === 'page' && String(t.url).includes('local-model.html'))
      if (page !== undefined) return page
    } catch {
      // devtools endpoint 还没起来
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
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 抛异常')
  }
  return result.result?.value
}

let child
let mock
try {
  mock = await startMockGateway()
  log('mock 网关', `http://127.0.0.1:${MOCK_PORT}/v1`)

  // 干净的用户数据目录，避免污染真实 %APPDATA%
  rmSync(UD, { recursive: true, force: true })
  mkdirSync(UD, { recursive: true })
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.SEEU_DEV_MULTI = '1'
  env.SEEU_OPEN_SETTINGS = '1'
  env.SEEU_DSH_HOME = HOME
  env.SEEU_USER_DATA = UD
  delete env.SEEU_LOCAL_MODEL_JSON

  child = spawn(EXE, [...EXE_ARGS, `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`], {
    cwd: REPO,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const page = await waitForSettingsPage()
  if (page === undefined) throw new Error('设置页没出现（CDP page 超时）')
  log('设置页已加载', page.url.replace(/^file:\/\/\//, ''))

  const client = cdp(page.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')
  await client.send('Page.enable')

  const bridge = await evaluate(client, 'Boolean(window.seeu && window.seeu.localModel)')
  if (bridge !== true) throw new Error('preload 桥未暴露 window.seeu.localModel')
  log('preload 桥', 'OK')

  const view = await evaluate(client, 'window.seeu.localModel.get()')
  log('get', JSON.stringify(view))
  const expected = CONFIG.toLowerCase().replaceAll('\\', '/')
  const actual = String(view?.path ?? '').toLowerCase().replaceAll('\\', '/')
  if (actual !== expected) throw new Error(`配置路径不是独立 userData：${actual} != ${expected}`)

  // 填表（走真实 DOM，输入事件会触发即时预览）
  await evaluate(client, `(() => {
    const set = (id, value) => {
      const el = document.getElementById(id)
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    document.getElementById('enabled').checked = true
    set('baseURL', 'http://127.0.0.1:${MOCK_PORT}/v1')
    set('apiKey', 'local')
    set('models', 'qwen2.5-32b-instruct | Qwen2.5 32B（本地）')
    set('contextWindow', '131072')
    set('maxTokens', '8192')
    document.getElementById('useAsDefault').checked = true
    document.getElementById('litePreset').checked = true
    return true
  })()`)
  log('填表', '完成')

  const preview = await evaluate(client, `window.seeu.localModel.preview({
    enabled: true,
    baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1',
    apiKey: 'local',
    models: [{ id: 'qwen2.5-32b-instruct', name: 'Qwen2.5 32B（本地）' }],
    contextWindow: 131072,
    maxTokens: 8192,
    useAsDefault: true,
    litePreset: true
  })`)
  if (preview?.ok !== true) throw new Error(`preview 失败：${JSON.stringify(preview)}`)
  report.previewHasRetryPolicy = /retryPolicy/.test(preview.patch)
  report.previewHasTitleRow = /session-title-llm/.test(preview.patch)
  // 精简预设：默认开启时要把 agent-preset-registry.default 指到 seeu-lite
  report.previewHasLitePreset = /agent-preset-registry/.test(preview.patch) && /seeu-lite/.test(preview.patch)
  if (!report.previewHasLitePreset) throw new Error('preview 里没有 seeu-lite 预设切换行')
  const fullPreview = await evaluate(client, `window.seeu.localModel.preview({
    enabled: true,
    baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1',
    models: [{ id: 'qwen2.5-32b-instruct' }],
    litePreset: false
  })`)
  report.litePresetOptional = fullPreview?.ok === true && !/agent-preset-registry/.test(fullPreview.patch)
  if (!report.litePresetOptional) throw new Error('关掉精简预设后仍生成了 registry 行')
  log('preview', `patch ${preview.patch.length} 字符，含 retryPolicy=${report.previewHasRetryPolicy}`)


  // 窗口档位按钮：点「256k 团体赛」应当把两个输入框都换成档位值
  await evaluate(client, `(() => { document.querySelector("#presets button[data-preset='256k']").click(); return true })()`)
  await sleep(300)
  const presetState = await evaluate(client, `({ contextWindow: document.getElementById('contextWindow').value, maxTokens: document.getElementById('maxTokens').value })`)
  report.presetApplied = presetState.contextWindow === '262144' && presetState.maxTokens === '8192'
  if (!report.presetApplied) throw new Error(`预设未生效：${JSON.stringify(presetState)}`)
  log('窗口档位', `256k → 窗口 ${presetState.contextWindow} / 输出 ${presetState.maxTokens}`)

  // 健康度提示：输出上限接近窗口时应出现警告条
  const warnPreview = await evaluate(client, `window.seeu.localModel.preview({
    enabled: true,
    baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1',
    models: [{ id: 'qwen2.5-32b-instruct' }],
    contextWindow: 32768,
    maxTokens: 16384,
    retryMaxRetries: 8
  })`)
  report.previewWarnings = (warnPreview?.warnings ?? []).map((w) => w.key)
  if (!report.previewWarnings.includes('output-window')) throw new Error(`缺少 output-window 警告：${JSON.stringify(warnPreview)}`)
  if (!report.previewWarnings.includes('retries')) throw new Error('缺少 retries 警告')
  log('健康度警告', report.previewWarnings.join(','))
  // 复制诊断信息：按钮存在且点击后状态行有反馈（文本长度 > 200 说明拼装正常）
  const copyResult = await evaluate(client, `(async () => {
    const btn = document.getElementById('btn-copy')
    if (!btn) return { ok: false, reason: 'no-button' }
    btn.click()
    await new Promise((r) => setTimeout(r, 300))
    return { ok: true, status: document.getElementById('status').textContent }
  })()`)
  report.copiedDiagnostics = copyResult.ok === true && /已复制诊断信息（\d+ 字符）/.test(String(copyResult.status || ''))
  if (!report.copiedDiagnostics) throw new Error(`复制诊断信息失败：${JSON.stringify(copyResult)}`)
  log('复制诊断信息', String(copyResult.status).trim())
  const probe = await evaluate(client, `window.seeu.localModel.test({ baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1', apiKey: 'local' })`)
  if (probe?.ok !== true) throw new Error(`测试连接失败：${JSON.stringify(probe)}`)
  report.gatewayModels = (probe.models ?? []).map((m) => m.id)
  log('测试连接', `HTTP ${probe.status}，模型 ${report.gatewayModels.join(',')}`)

  const saved = await evaluate(client, `window.seeu.localModel.save({
    enabled: true,
    baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1',
    apiKey: 'local',
    models: [{ id: 'qwen2.5-32b-instruct', name: 'Qwen2.5 32B（本地）' }],
    contextWindow: 131072,
    maxTokens: 8192,
    useAsDefault: true,
    litePreset: true
  })`)
  if (saved?.ok !== true) throw new Error(`保存失败：${JSON.stringify(saved)}`)
  if (!existsSync(CONFIG)) throw new Error(`保存后配置文件不存在：${CONFIG}`)
  const written = JSON.parse(readFileSync(CONFIG, 'utf8'))
  report.savedModels = written.models.map((m) => m.id)
  report.litePresetSaved = written.litePreset === true
  if (!report.litePresetSaved) throw new Error('保存的配置里 litePreset 不是 true')
  log('保存', `写入 ${CONFIG}，模型 ${report.savedModels.join(',')}`)

  const reread = await evaluate(client, 'window.seeu.localModel.get()')
  if (reread?.config?.baseURL !== `http://127.0.0.1:${MOCK_PORT}/v1`) throw new Error('重新读取的 baseURL 不一致')
  log('重新读取', '一致')

  // 真实点「从网关拉取模型列表」按钮：应把 /v1/models 的 id 填进 textarea（保留已有显示名）
  await evaluate(client, `document.getElementById('btn-models').click(), true`)
  const pulled = await evaluate(client, `(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 8000) {
      const v = document.getElementById('models').value
      if (v.includes('mock-14b') && v.includes('qwen2.5-32b-instruct')) return v
      await new Promise((r) => setTimeout(r, 100))
    }
    return document.getElementById('models').value
  })()`)
  report.pulledModels = String(pulled).split('\n').map((l) => l.trim()).filter(Boolean)
  if (!report.pulledModels.some((l) => l.startsWith('mock-14b'))) throw new Error(`拉取模型列表失败：${JSON.stringify(pulled)}`)
  if (!report.pulledModels.some((l) => l.includes('Qwen2.5 32B（本地）'))) throw new Error('拉取后丢失了已有显示名')
  log('拉取模型', report.pulledModels.join(' / '))
  report.pulledContextWindow = await evaluate(client, `(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 3000) {
      const v = document.getElementById('contextWindow').value
      if (v === '32768') return v
      await new Promise((r) => setTimeout(r, 100))
    }
    return document.getElementById('contextWindow').value
  })()`)
  if (report.pulledContextWindow !== '32768') throw new Error(`网关自报窗口没填进表单：${report.pulledContextWindow}`)
  log('网关自报窗口', `已填入 ${report.pulledContextWindow}`)

  // 配置里写一个网关没有的模型：探测应返回 missing（提醒模型改名/抄错）
  const ghostSaved = await evaluate(client, `window.seeu.localModel.save({
    enabled: true,
    baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1',
    apiKey: 'local',
    models: [{ id: 'qwen2.5-32b-instruct' }, { id: 'ghost-7b' }],
    contextWindow: 131072,
    maxTokens: 8192
  })`)
  if (ghostSaved?.ok !== true) throw new Error(`写缺失模型配置失败：${JSON.stringify(ghostSaved)}`)
  const ghostProbe = await evaluate(client, 'window.seeu.localModel.probe()')
  report.probeMissing = ghostProbe?.missing
  if (!Array.isArray(report.probeMissing) || !report.probeMissing.includes('ghost-7b')) {
    throw new Error(`缺失模型没被探测出来：${JSON.stringify(ghostProbe)}`)
  }
  log('缺失模型', report.probeMissing.join(','))

  const bad = await evaluate(client, `window.seeu.localModel.test({ baseURL: 'http://127.0.0.1:1/v1' })`)
  report.badGatewayRejected = bad?.ok === false
  log('错误网关', report.badGatewayRejected ? '按预期失败' : '意外成功')

  // 错误页兜底：禁用本地模型（enabled=false），其余字段必须原样保留
  const disabled = await evaluate(client, 'window.seeu.localModel.disable()')
  if (disabled?.ok !== true) throw new Error(`禁用本地模型失败：${JSON.stringify(disabled)}`)
  const afterDisable = JSON.parse(readFileSync(CONFIG, 'utf8'))
  report.disableLocalModel = { enabled: afterDisable.enabled, keptModel: afterDisable.models?.[0]?.id, keptContext: afterDisable.contextWindow }
  if (afterDisable.enabled !== false) throw new Error('禁用后 enabled 仍不是 false')
  if (afterDisable.models?.[0]?.id !== 'qwen2.5-32b-instruct') throw new Error('禁用时丢掉了其它字段（models）')
  const viewAfter = await evaluate(client, 'window.seeu.localModel.get()')
  if (viewAfter?.config?.enabled !== false) throw new Error('get() 读到的 enabled 不是 false')
  log('禁用本地模型', `enabled=false，其余字段保留（models=${report.disableLocalModel.keptModel}）`)

  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(join(REPO, '.probe', 'shots'), { recursive: true })
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  log('截图', OUT)

  client.close()
  report.ok = true
} catch (error) {
  report.errors.push(String(error?.message ?? error))
} finally {
  if (mock !== undefined) mock.close()
  if (child !== undefined && child.pid !== undefined) {
    const { execFileSync } = await import('node:child_process')
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch { /* 已退出 */ }
    await sleep(500)
  }
  // 清理测试写入的配置，避免影响下次开发启动
  try { rmSync(CONFIG, { force: true }) } catch { /* ignore */ }
}

console.log(`REPORT ${JSON.stringify(report)}`)
process.exit(report.ok ? 0 : 1)
