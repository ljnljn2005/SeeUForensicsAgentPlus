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
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        let body = {}
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        } catch {
          body = {}
        }
        const NL = String.fromCharCode(10)
        // 流式自检：先返回 reasoning_content，再返回正文（模拟 Spark 单机 Qwen 的思考流）
        if (body.stream === true) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
          const emit = (delta) => res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta }] }) + NL + NL)
          emit({ reasoning_content: '让我想一下，' })
          emit({ reasoning_content: '先确认这是流式自检。' })
          emit({ content: 'ok' })
          res.write('data: [DONE]' + NL + NL)
          res.end()
          return
        }
        // 工具自检：模型返回 ping_tool 调用
        const wantsTool = Array.isArray(body.tools) && body.tools.some((tool) => tool?.function?.name === 'ping_tool')
        if (wantsTool) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'mock-tool-' + Date.now(),
              object: 'chat.completion',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      { id: 'call_ping', type: 'function', function: { name: 'ping_tool', arguments: '{"value":1}' } },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }),
          )
          return
        }
        // 预热用的最小非流式补全：返回一句 pong
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'mock-chat-' + Date.now(),
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        )
      })
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
  const EXPORT_DIR = join(REPO, '.dev', 'settings-exports')
  rmSync(EXPORT_DIR, { recursive: true, force: true })
  mkdirSync(EXPORT_DIR, { recursive: true })
  env.SEEU_EXPORT_DIR = EXPORT_DIR
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

  // 流式带用量：勾复选框 → 页面自己重新 preview 时应出现 supportsUsageInStreaming: true
  await evaluate(client, `(() => {
    const box = document.getElementById('usageInStreaming')
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(700)
  const usagePreview = await evaluate(client, `document.getElementById('preview').textContent || ''`)
  report.usagePreview = /supportsUsageInStreaming:\s*true/.test(String(usagePreview))
  if (!report.usagePreview) throw new Error('勾选流式用量后 preview 未打开 supportsUsageInStreaming')
  // 标题生成：默认开着（配 session-title-llm 的小输出）；取消勾选后该行应直接 disabled
  report.titleGenDefault = await evaluate(client, "document.getElementById('titleGen').checked === true")
  if (!report.titleGenDefault) throw new Error('标题生成默认没勾上')
  await evaluate(client, `(() => {
    const box = document.getElementById('titleGen')
    box.checked = false
    box.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(600)
  const titleOff = String(await evaluate(client, "document.getElementById('preview').textContent || ''"))
  report.titleGenOffPreview = /session-title-llm\s*\n\s*disabled: true/.test(titleOff) && !/targetWords/.test(titleOff)
  if (!report.titleGenOffPreview) throw new Error('取消标题生成后 preview 没有把 session-title-llm 置为 disabled')
  log('标题生成', '关掉后 session-title-llm 整行 disabled')
  await evaluate(client, `(() => {
    const box = document.getElementById('titleGen')
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(400)
  log('流式用量', 'preview 已切到 supportsUsageInStreaming: true')
  log('preview', `patch ${preview.patch.length} 字符，含 retryPolicy=${report.previewHasRetryPolicy}`)


  // 窗口档位按钮：点「256k 团体赛」应当把两个输入框都换成档位值
  await evaluate(client, `(() => { document.querySelector("#presets button[data-preset='256k']").click(); return true })()`)
  await sleep(300)
  const presetState = await evaluate(client, `({ contextWindow: document.getElementById('contextWindow').value, maxTokens: document.getElementById('maxTokens').value })`)
  report.budgetText = await evaluate(client, 'document.getElementById("budget").textContent')
  if (!/固定开销估算/.test(report.budgetText) || !/留给对话/.test(report.budgetText)) {
    throw new Error('设置页没有显示固定开销估算：' + report.budgetText)
  }
  log('固定开销', String(report.budgetText).trim())
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

  // 能力自检（流式 + 思考流 + 工具调用）：mock 网关同时模拟流式 reasoning 与 ping_tool
  const diag = await evaluate(client, `window.seeu.localModel.diagnose({
    baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1',
    apiKey: 'local',
    model: 'qwen2.5-32b-instruct',
    thinkingFormat: 'qwen-chat-template'
  })`)
  report.diagItems = (diag?.items ?? []).map((item) => ({ key: item.key, ok: item.ok }))
  const diagByKey = Object.fromEntries((diag?.items ?? []).map((item) => [item.key, item]))
  if (diagByKey.models?.ok !== true || diagByKey.chat?.ok !== true) throw new Error('自检基础项失败：' + JSON.stringify(diag))
  if (diagByKey.stream?.ok !== true) throw new Error('流式自检失败：' + JSON.stringify(diagByKey.stream))
  if (diagByKey.reasoning?.ok !== true) throw new Error('思考流自检失败：' + JSON.stringify(diagByKey.reasoning))
  if (diagByKey.tools?.ok !== true) throw new Error('工具自检失败：' + JSON.stringify(diagByKey.tools))
  report.diagOk = diag.ok === true
  if (!report.diagOk) throw new Error('自检整体未通过：' + JSON.stringify(report.diagItems))
  log('能力自检', report.diagItems.map((item) => item.key + (item.ok ? ':✓' : ':✗')).join(' '))

  const saved = await evaluate(client, `window.seeu.localModel.save({
    enabled: true,
    baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1',
    apiKey: 'local',
    models: [{ id: 'qwen2.5-32b-instruct', name: 'Qwen2.5 32B（本地）' }],
    contextWindow: 131072,
    maxTokens: 8192,
    useAsDefault: true,
    litePreset: true,
    usageInStreaming: true,
    titleGeneration: true,
    thinkingFormat: 'deepseek',
    chatTemplateKwargs: { enable_thinking: true }
  })`)
  if (saved?.ok !== true) throw new Error(`保存失败：${JSON.stringify(saved)}`)
  if (!existsSync(CONFIG)) throw new Error(`保存后配置文件不存在：${CONFIG}`)
  const written = JSON.parse(readFileSync(CONFIG, 'utf8'))
  report.savedModels = written.models.map((m) => m.id)
  report.litePresetSaved = written.litePreset === true
  if (!report.litePresetSaved) throw new Error('保存的配置里 litePreset 不是 true')
  report.titleGenSaved = written.titleGeneration === true
  if (!report.titleGenSaved) throw new Error('保存的配置里 titleGeneration 不是 true')
  report.usageSaved = written.usageInStreaming === true
  if (!report.usageSaved) throw new Error('保存的配置里 usageInStreaming 不是 true')
  report.thinkingSaved = written.thinkingFormat === 'deepseek' && written.chatTemplateKwargs?.enable_thinking === true
  if (!report.thinkingSaved) {
    throw new Error('保存的配置里 thinkingFormat/chatTemplateKwargs 不符：' + JSON.stringify({ f: written.thinkingFormat, k: written.chatTemplateKwargs }))
  }
  log('保存', `写入 ${CONFIG}，模型 ${report.savedModels.join(',')}`)

  const reread = await evaluate(client, 'window.seeu.localModel.get()')
  if (reread?.config?.baseURL !== `http://127.0.0.1:${MOCK_PORT}/v1`) throw new Error('重新读取的 baseURL 不一致')
  log('重新读取', '一致')

  // 本机取证工具路径：只支持手动指定（不做自动发现），写 <DSH_HOME>/lovely-cli.json
  const TOOLS_CONFIG = join(HOME, 'lovely-cli.json')
  const toolsView = await evaluate(client, 'window.seeu.lovelyTools.get()')
  report.toolsConfigFile = toolsView?.configFile ?? null
  report.toolsRows = Array.isArray(toolsView?.tools) ? toolsView.tools.length : 0
  report.toolsSectionVisible = await evaluate(client, `(() => {
    const rows = document.querySelectorAll('.tools .tool[data-tool]')
    const ids = [...rows].map((row) => row.getAttribute('data-tool'))
    return rows.length === 3 && ids.join(',') === 'lovelymem,lovelyspark,lovelycarve' && document.getElementById('btn-tools-save') !== null
  })()`)
  if (report.toolsRows !== 3 || report.toolsSectionVisible !== true) {
    throw new Error('工具路径区渲染异常：rows=' + report.toolsRows + ' visible=' + report.toolsSectionVisible)
  }
  const memExe = join(HOME, 'fake-lovelymem.exe')
  const sparkExe = join(HOME, 'fake-lovelyspark.exe')
  writeFileSync(memExe, 'MZ')
  writeFileSync(sparkExe, 'MZ')
  const apiSaved = await evaluate(client, `window.seeu.lovelyTools.save({ lovelymem: ${JSON.stringify(memExe)} })`)
  report.toolsApiSaved = apiSaved?.ok === true && (apiSaved.tools ?? []).some((tool) => tool.id === 'lovelymem' && tool.found === true)
  if (!report.toolsApiSaved) throw new Error('lovelyTools.save 失败：' + JSON.stringify(apiSaved))
  // 再走真实 UI：填 LovelySpark 路径 → 点「保存工具路径」→ 等提示
  report.toolsUiSaved = await evaluate(client, `(async () => {
    document.querySelector('[data-tool-path="lovelymem"]').value = ${JSON.stringify(memExe)}
    document.querySelector('[data-tool-path="lovelyspark"]').value = ${JSON.stringify(sparkExe)}
    document.getElementById('btn-tools-save').click()
    const t0 = Date.now()
    while (Date.now() - t0 < 5000) {
      if (/已保存工具路径/.test(document.getElementById('tools-status').textContent)) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  })()`)
  if (report.toolsUiSaved !== true) throw new Error('点「保存工具路径」后没有出现成功提示')
  const toolsWritten = JSON.parse(readFileSync(TOOLS_CONFIG, 'utf8'))
  report.toolsFile = toolsWritten
  report.toolsFileOk = toolsWritten.lovelymem === memExe && toolsWritten.lovelyspark === sparkExe
  if (!report.toolsFileOk) throw new Error('工具配置文件内容不符：' + JSON.stringify(toolsWritten))
  // 清空一项：走 UI 清空 + 保存，配置里应删键
  await evaluate(client, `document.querySelector('[data-tool-path="lovelymem"]').value = '', document.getElementById('btn-tools-save').click(), true`)
  let clearedWritten = null
  for (let i = 0; i < 50; i += 1) {
    await sleep(100)
    try {
      clearedWritten = JSON.parse(readFileSync(TOOLS_CONFIG, 'utf8'))
      if (!Object.hasOwn(clearedWritten, 'lovelymem')) break
    } catch { /* 文件正被写入，重试 */ }
  }
  report.toolsAfterClear = clearedWritten
  report.toolsClearOk = Boolean(clearedWritten) && !Object.hasOwn(clearedWritten, 'lovelymem') && clearedWritten.lovelyspark === sparkExe
  if (!report.toolsClearOk) throw new Error('清除工具路径后配置不符：' + JSON.stringify(clearedWritten))
  log('工具路径', '分区可见，保存/清除后 ' + TOOLS_CONFIG)

  // 外部取证工具路径（Ghidra/IDA/tshark/jadx/python/7z/sqlite3/starmem/volatility）：13 行默认值 + 可改 + 写 tool-paths.json
  const TOOL_PATHS_CONFIG = join(HOME, 'tool-paths.json')
  const toolPathsView = await evaluate(client, 'window.seeu.toolPaths.get()')
  report.toolPathsConfigFile = toolPathsView?.configFile ?? null
  report.toolPathsRows = Array.isArray(toolPathsView?.tools) ? toolPathsView.tools.length : 0
  if (report.toolPathsRows !== 13) throw new Error('外部工具路径条数不对：' + report.toolPathsRows)
  if (report.toolPathsConfigFile !== TOOL_PATHS_CONFIG) throw new Error('外部工具路径配置文件不符：' + report.toolPathsConfigFile)
  const ghidraRow = (toolPathsView?.tools ?? []).find((tool) => tool.id === 'ghidra')
  report.toolPathsGhidra = ghidraRow?.path ?? null
  if (!String(report.toolPathsGhidra).includes('ghidra-12.1.4')) throw new Error('Ghidra 默认路径不对：' + report.toolPathsGhidra)
  const starmemRow = (toolPathsView?.tools ?? []).find((tool) => tool.id === 'starmem')
  report.toolPathsStarmem = starmemRow?.path ?? null
  if (!String(report.toolPathsStarmem).includes('starmem-v0.2.2')) throw new Error('StarMem 默认路径不对：' + report.toolPathsStarmem)
  report.toolPathsSectionVisible = await evaluate(client, `(() => {
    const rows = document.querySelectorAll('[data-tool-path-row]')
    const input = document.querySelector('[data-tool-path-input="ghidra"]')
    return rows.length === 13 && input !== null && /ghidra-12\.1\.4/.test(input.value) && document.getElementById('btn-tool-paths-save') !== null
  })()`)
  if (report.toolPathsSectionVisible !== true) throw new Error('外部工具路径区渲染异常')
  const ghidraDir = join(HOME, 'fake-ghidra')
  mkdirSync(ghidraDir, { recursive: true })
  const pathsSaved = await evaluate(client, `window.seeu.toolPaths.save({ ghidra: ${JSON.stringify(ghidraDir)} })`)
  report.toolPathsApiSaved = pathsSaved?.ok === true && (pathsSaved.tools ?? []).some((tool) => tool.id === 'ghidra' && tool.path === ghidraDir)
  if (!report.toolPathsApiSaved) throw new Error('toolPaths.save 失败：' + JSON.stringify(pathsSaved))
  report.toolPathsUiSaved = await evaluate(client, `(async () => {
    document.querySelector('[data-tool-path-input="ghidra"]').value = ${JSON.stringify(ghidraDir)}
    document.getElementById('btn-tool-paths-save').click()
    const t0 = Date.now()
    while (Date.now() - t0 < 5000) {
      if (/已保存外部工具路径/.test(document.getElementById('tool-paths-status').textContent)) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  })()`)
  if (report.toolPathsUiSaved !== true) throw new Error('点「保存外部工具路径」后没有成功提示')
  const toolPathsWritten = JSON.parse(readFileSync(TOOL_PATHS_CONFIG, 'utf8'))
  report.toolPathsFileOk = toolPathsWritten.ghidra === ghidraDir
  if (!report.toolPathsFileOk) throw new Error('外部工具路径配置内容不符：' + JSON.stringify(toolPathsWritten))
  log('外部工具路径', '13 行默认值，保存后 ' + TOOL_PATHS_CONFIG)

  // 运行环境体检：点按钮 → 插件/技能/工具/模型/挂载/MYOS/索引 七项清单 + 汇总
  await evaluate(client, `document.getElementById('btn-env-check').click(), true`)
  const envReport = await evaluate(client, `(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 8000) {
      const rows = document.querySelectorAll('[data-env-key]')
      if (rows.length >= 7) {
        return {
          count: rows.length,
          statuses: [...rows].map((el) => el.dataset.envStatus),
          keys: [...rows].map((el) => el.dataset.envKey),
          summary: document.getElementById('env-summary').textContent,
          text: document.getElementById('env-items').textContent,
        }
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    return null
  })()`)
  report.envItemCount = envReport?.count ?? 0
  report.envKeys = envReport?.keys ?? []
  report.envStatuses = envReport?.statuses ?? []
  report.envSummary = envReport?.summary ?? ''
  report.envReportOk = report.envItemCount >= 7 && /体检结果/.test(report.envSummary) && (envReport?.statuses ?? []).includes('ok') && /插件|技能|工具/.test(envReport?.text ?? '')
  if (!report.envReportOk) throw new Error('环境体检没渲染出完整清单：' + JSON.stringify(envReport))
  log('环境体检', report.envSummary)
  await evaluate(client, `document.getElementById('btn-env-copy').click(), true`)
  await sleep(400)
  const envClipboard = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'], { encoding: 'utf8' })
  report.envClipboardChars = String(envClipboard ?? '').trim().length
  report.envCopyOk = /SeeU 环境体检/.test(envClipboard) && /合计：/.test(envClipboard) && /外部工具路径/.test(envClipboard)
  if (!report.envCopyOk) throw new Error('复制体检结果内容不符：' + String(envClipboard).slice(0, 160))
  log('复制体检结果', `${report.envClipboardChars} 字符`)

  // 第 38 轮：导出体检报告 .md（走 save-export IPC，落 SEEU_EXPORT_DIR）。
  await evaluate(client, `document.getElementById('btn-env-export').click(), true`)
  await sleep(700)
  const exported = readdirSync(EXPORT_DIR).filter((f) => f.toLowerCase().endsWith('.md'))
  const latest = exported.map((f) => ({ f, t: statSync(join(EXPORT_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]
  report.envExportFile = latest ? join(EXPORT_DIR, latest.f) : ''
  report.envExportText = latest ? readFileSync(join(EXPORT_DIR, latest.f), 'utf8') : ''
  report.envExportOk = latest
    ? /^# SeeU 运行环境体检/.test(report.envExportText) &&
      /\| 项目 \| 状态 \| 详情 \| 提示 \|/.test(report.envExportText) &&
      /合计：\*\*\d+ 项正常/.test(report.envExportText)
    : false
  if (!report.envExportOk) throw new Error('导出体检报告 .md 失败：' + JSON.stringify({ files: exported, head: String(report.envExportText).slice(0, 120) }))
  log('导出体检报告', report.envExportFile)

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

  // 预热：API 直调 + 真实点按钮，确认「模型冷启动」这笔时间可以被用户主动付掉
  const warmApi = await evaluate(client, `window.seeu.localModel.warmup({ baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1', apiKey: 'local', model: 'mock-14b' })`)
  report.warmupApiOk = warmApi?.ok === true
  report.warmupElapsedMs = warmApi?.elapsedMs
  if (!report.warmupApiOk) throw new Error('warmup API 失败：' + JSON.stringify(warmApi))
  if (typeof report.warmupElapsedMs !== 'number') throw new Error('warmup 没返回 elapsedMs')
  await evaluate(client, `document.getElementById('btn-warmup').click(), true`)
  report.warmupText = await evaluate(client, `(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      const s = document.getElementById('status').textContent
      if (/预热完成|预热失败/.test(s)) return s
      await new Promise((r) => setTimeout(r, 150))
    }
    return document.getElementById('status').textContent
  })()`)
  report.warmupOk = /预热完成/.test(String(report.warmupText)) && /首次响应/.test(String(report.warmupText))
  log('预热模型', String(report.warmupText).trim())
  if (!report.warmupOk) throw new Error('预热按钮没成功：' + report.warmupText)
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

  // 配置窗口 131072 > 网关自报 32768：探测应给出 mismatch，并在页面黄字提示
  report.probeMismatch = ghostProbe?.mismatch ?? null
  if (!report.probeMismatch || report.probeMismatch.configured !== 131072 || report.probeMismatch.gateway !== 32768) {
    throw new Error('配置窗口超过网关自报时没有返回 mismatch：' + JSON.stringify(ghostProbe))
  }
  report.probeText = await evaluate(client, `(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 3000) {
      const el = document.getElementById('probe')
      if (el && /超过网关自报/.test(el.textContent)) return el.textContent
      await new Promise((r) => setTimeout(r, 100))
    }
    return (document.getElementById('probe') || {}).textContent || ''
  })()`)
  if (!/超过网关自报/.test(report.probeText)) throw new Error('设置页没有显示窗口超限提示：' + report.probeText)
  log('窗口超限', report.probeText)

  // 本 mock 网关自报了 max_model_len ⇒ 不应该出现「没有自报窗口」的提示
  report.probeNoContextWindow = ghostProbe?.noContextWindow ?? false
  if (report.probeNoContextWindow !== false) {
    throw new Error('自报窗口的网关不应标记 noContextWindow：' + JSON.stringify(ghostProbe))
  }

  const bad = await evaluate(client, `window.seeu.localModel.test({ baseURL: 'http://127.0.0.1:19999/v1' })`)
  report.badGatewayRejected = bad?.ok === false
  report.badGatewayHint = bad?.hint
  if (!report.badGatewayHint || !/连不上|网关没启动|端口/.test(report.badGatewayHint)) {
    throw new Error('网关失败时没有给出可操作提示：' + JSON.stringify(bad))
  }
  log('错误网关', report.badGatewayRejected ? '按预期失败，提示：' + report.badGatewayHint : '意外成功')

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

  // 跟随系统浅色：CDP 模拟 prefers-color-scheme: light，窗口底色应切成浅色
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await sleep(600)
  report.lightShellStyles = await evaluate(client, `(() => {
    const bg = getComputedStyle(document.body).backgroundColor
    const m = bg.match(/\\d+/g) || []
    const lum = (0.2126 * Number(m[0]) + 0.7152 * Number(m[1]) + 0.0722 * Number(m[2])) / 255
    return { bg, text: getComputedStyle(document.body).color, lum: Number(lum.toFixed(3)) }
  })()`)
  report.lightShell = (report.lightShellStyles?.lum ?? 0) > 0.7
  if (!report.lightShell) throw new Error('浅色模式下设置窗口底色没变浅：' + JSON.stringify(report.lightShellStyles))
  log('浅色跟随', `body 背景 ${report.lightShellStyles.bg}（亮度 ${report.lightShellStyles.lum}）`)
  await client.send('Emulation.setEmulatedMedia', { features: [] })
  await sleep(300)

  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(join(REPO, '.probe', 'shots'), { recursive: true })
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  log('截图', OUT)

  // 本机部署预设：Spark 单机（qwen3.8-flash-next）/ Spark 双机（dsv4.1-flash）
  const deploySingle = await evaluate(client, `(() => {
    document.querySelector('#deploy-presets button[data-deploy="spark-single"]').click()
    return {
      models: document.getElementById('models').value,
      context: document.getElementById('contextWindow').value,
      maxTokens: document.getElementById('maxTokens').value,
      lite: document.getElementById('litePreset').checked,
      usage: document.getElementById('usageInStreaming').checked,
      title: document.getElementById('titleGen').checked,
      thinkingFormat: document.getElementById('thinkingFormat').value,
      kwargs: document.getElementById('thinkingFormatKwargs').value,
      note: document.getElementById('deploy-note').textContent,
    }
  })()`)
  report.deploySingle = deploySingle
  if (!deploySingle.models.includes('qwen3.8-flash-next')) throw new Error('Spark 单机预设没填模型：' + JSON.stringify(deploySingle))
  if (deploySingle.context !== '131072' || deploySingle.lite !== true || deploySingle.usage !== true) {
    throw new Error('Spark 单机预设字段不符：' + JSON.stringify(deploySingle))
  }
  if (deploySingle.thinkingFormat !== 'qwen-chat-template' || !/enable_thinking/.test(deploySingle.kwargs)) {
    throw new Error('Spark 单机预设没打开 Qwen 思考流：' + JSON.stringify(deploySingle))
  }
  const deployDual = await evaluate(client, `(() => {
    document.querySelector('#deploy-presets button[data-deploy="spark-dual"]').click()
    return {
      models: document.getElementById('models').value,
      context: document.getElementById('contextWindow').value,
      lite: document.getElementById('litePreset').checked,
      thinkingFormat: document.getElementById('thinkingFormat').value,
      note: document.getElementById('deploy-note').textContent,
    }
  })()`)
  report.deployDual = deployDual
  if (!deployDual.models.includes('dsv4.1-flash') || deployDual.context !== '262144' || deployDual.lite !== false) {
    throw new Error('Spark 双机预设字段不符：' + JSON.stringify(deployDual))
  }
  if (deployDual.thinkingFormat !== 'deepseek') {
    throw new Error('Spark 双机预设没切 reasoning_content：' + JSON.stringify(deployDual))
  }
  log('本机部署预设', `单机 ${deploySingle.context}+${deploySingle.thinkingFormat} / 双机 ${deployDual.context}+${deployDual.thinkingFormat}`)

  const lmView = await evaluate(client, 'window.seeu.localModel.get()')
  report.probeLatencyMs = lmView?.probe?.latencyMs ?? null
  if (!(Number(report.probeLatencyMs) > 0)) throw new Error('启动探测缺少 latencyMs：' + JSON.stringify(lmView?.probe ?? null))
  log('探测延迟', `${report.probeLatencyMs} ms`)

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
  try { rmSync(join(HOME, 'lovely-cli.json'), { force: true }) } catch { /* ignore */ }
}

console.log(`REPORT ${JSON.stringify(report)}`)
process.exit(report.ok ? 0 : 1)
