// 真机网关联调（headless，一个脚本跑完两轮）：用与桌面外壳相同的 overlay 组合，
// 直接跑 dsh headless，验证「本地模型 → 会话 → 案件概览 → 工具调用」整条链路。
// 凭据只走环境变量，不落仓库：
//   GW_BASE=http://host:8080/v1 GW_KEY=sk-... GW_MODEL=deepseek-flash \
//     node scripts/e2e/real-gateway-headless.mjs
// 可选：GW_CONTEXT（默认 131072）、GW_MAX_TOKENS（默认 8192）、SEEU_CASE_DIR、SEEU_REAL_HOME。
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const base = (process.env.GW_BASE || '').replace(/\/+$/, '')
const key = process.env.GW_KEY || ''
const model = process.env.GW_MODEL || ''
const ctxWindow = Number(process.env.GW_CONTEXT || 131072)
const maxTokens = Number(process.env.GW_MAX_TOKENS || 8192)
const caseDir = process.env.SEEU_CASE_DIR || 'E:\\forensics\\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5'
const home = process.env.SEEU_REAL_HOME || join(root, '.dev', 'real-home')
// 会话工作区必须放在仓库外：沙箱给 D:\Coding\... 授权会失败（grantWrite 报 Win32 5），
// 这跟产品无关，headless 只是借一个可写的临时目录当工作区。
const work = process.env.SEEU_REAL_WORK || join(tmpdir(), 'seeu-real-work')
const taskTimeoutMs = Number(process.env.SEEU_REAL_TASK_TIMEOUT || 600_000)
// headless 子进程里 PowerShell 自动发现偶尔超时（技能任务跑在负载高的机器上），
// 允许显式给 LovelyMem V3 exe：GW_LOVELYMEM_EXE='E:\...\lovelymem.v3.exe'。
const lovelyExe = process.env.GW_LOVELYMEM_EXE || ''
const patchFile = join(root, '.dev', 'real-gateway.patch.yml')
const CASE_NAMES = ['CHAN_MH_mobile.zip', 'LEUNG_YL_mobile.zip', 'FUNG_CC_mobile.zip', 'IQ_Coin_Type_Transactions.zip', 'AP3_LEUNG_YL_USB.E01']

if (!base || !key || !model) {
  console.log('REPORT ' + JSON.stringify({ ok: false, errors: ['缺少 GW_BASE/GW_KEY/GW_MODEL'] }))
  process.exit(1)
}

mkdirSync(home, { recursive: true })
mkdirSync(work, { recursive: true })
// 技能根 = <DSH_HOME>/skills（与外壳 installBundledSkills 一致）；不装的话 headless 里
// 模型看不到 lovelymem-cli / lovelyspark-cli 等随包技能。
cpSync(join(root, 'resources', 'forensics', 'skills'), join(home, 'skills'), { recursive: true, force: true })
mkdirSync(join(root, '.dev'), { recursive: true })
writeFileSync(join(home, 'index-state.json'), JSON.stringify({ dirs: [caseDir] }))
// 跑之前用当前代码重写一遍 <DSH_HOME>/AGENTS.md 的概览区块：插件进程内会缓存 briefSig，
// 否则复跑时用的还是上一次写下的旧内容（例如修复记录数口径后仍看到旧数字）。
const briefRun = spawnSync(
  process.execPath,
  ['--input-type=module', '-e', "const m = await import('./plugins/seeu-case-index/index.js'); console.log(JSON.stringify(m.writeCaseBrief()))"],
  {
    cwd: root,
    env: {
      ...process.env,
      DSH_HOME: home,
      SEEU_INDEX_STATE_FILE: join(home, 'index-state.json'),
      SEEU_INDEX_SEARCH_DIRS: caseDir,
    },
    encoding: 'utf8',
  },
)
const briefInfo = (() => {
  try {
    return JSON.parse(String(briefRun.stdout || '').trim().split('\n').pop() || '{}')
  } catch {
    return { ok: false, error: String(briefRun.stderr || '').slice(-300) }
  }
})()
// 与外壳 genLocalModelPatch 同构的最小 overlay：provider + 默认模型 + 精简预设 + 会话标题关闭。
writeFileSync(patchFile, `- id: llm-pi-ai
  config:
    providers:
      local-openai:
        displayName: "本地模型（OpenAI 兼容网关）"
        api: openai-completions
        baseURL: "${base}"
        apiKeyEnv: "SEEU_LOCAL_LLM_API_KEY"
        timeoutMs: 600000
        streamIdleTimeoutMs: 600000
        retryPolicy:
          mode: normal
          maxRetries: 3
        compat:
          supportsUsageInStreaming: true
          maxTokensField: "max_tokens"
          supportsStore: false
          supportsDeveloperRole: false
        models:
          - id: "${model}"
            name: "${model}"
            contextWindow: ${ctxWindow}
            maxTokens: ${maxTokens}
            input: [text]
            reasoningEfforts: false
- id: session-title-llm
  disabled: true
- id: agent-default-model
  config:
    provider: "local-openai"
    model: "${model}"
- id: agent-preset-registry
  config:
    default: seeu-lite
`)

const dshBin = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const overlay = join(root, 'resources', 'forensics', 'cordis.patch.yml')

function runTask(task, timeoutMs = taskTimeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [
      dshBin,
      '--patch', overlay,
      '--patch', patchFile,
      '--profile', 'headless',
      '--approval-policy', 'never',
      '--json',
      task,
    ], {
      cwd: work, // 工作区放临时目录：仓库目录交给沙箱会让 ACL 授权失败（见 plan §20.57）
      env: {
        ...process.env,
        DSH_HOME: home,
        SEEU_LOCAL_LLM_API_KEY: key,
        // 与外壳 host.ts 注入的一致：技能里的 & $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI
        // 需要这两个变量才能找到薄层包装器（开发态=仓库里的 tools/lovely-cli/cli.mjs）。
        SEEU_CLI_NODE: process.execPath,
        SEEU_LOVELY_CLI: join(root, 'tools', 'lovely-cli', 'cli.mjs'),
        SEEU_LOVELY_CONFIG: join(home, 'lovely-cli.json'),
        ...(lovelyExe ? { SEEU_LOVELYMEM_EXE: lovelyExe } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    let firstTextMs = null
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c) => {
      out += c
      if (firstTextMs === null && /"type":"(text|thinking)"/.test(out)) firstTextMs = Date.now() - started
    })
    child.stderr.on('data', (c) => (err += c))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      const events = out.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean)
      const toolCalls = events.filter((e) => e.type === 'tool_call').map((e) => ({ tool: e.tool, input: e.input }))
      const toolResults = events.filter((e) => e.type === 'tool_result').map((e) => ({ status: e.status, result: String(e.result ?? '').slice(0, 400) }))
      const final = events.filter((e) => e.type === 'final').pop()
      // 流式阶段就能看到正文，超时被杀时也能判断模型答出了什么
      const streamedText = events.filter((e) => e.type === 'text' && e.text).map((e) => String(e.text)).join('')
      const usage = events.filter((e) => e.type === 'status' && e.usage).map((e) => e.usage)
      const firstUsage = usage[0] ?? null
      const lastUsage = usage[usage.length - 1] ?? null
      resolve({
        ok: code === 0 && Boolean(final?.text),
        exitCode: code,
        elapsedMs: Date.now() - started,
        firstTextMs,
        thinkingSeen: events.some((e) => e.type === 'thinking'),
        toolCalls,
        toolResults,
        usage,
        firstStepInputTokens: firstUsage?.inputTokens ?? null,
        totalTokens: lastUsage?.totalTokens ?? null,
        finalText: String(final?.text ?? ''),
        answerText: String(final?.text ?? streamedText),
        stderrTail: err.slice(-600),
      })
    })
  })
}

const report = { ok: false, base, model, ctxWindow, maxTokens, brief: briefInfo, errors: [] }
try {
  const t1 = await runTask('不要调用任何工具，直接根据系统提示里已有的「案件概览」回答：本机案件索引里有哪些检材？只列检材名称，不要猜测。')
  report.question = {
    ok: t1.ok,
    elapsedMs: t1.elapsedMs,
    firstTextMs: t1.firstTextMs,
    thinkingSeen: t1.thinkingSeen,
    firstStepInputTokens: t1.firstStepInputTokens,
    totalTokens: t1.totalTokens,
    briefUsed: CASE_NAMES.filter((n) => t1.answerText.includes(n)),
    answerHead: t1.answerText.slice(0, 400),
  }

  const t2 = await runTask('请用 pwsh 工具执行 node -v，然后只回复版本号。')
  const pwsh = t2.toolCalls.find((c) => c.tool === 'pwsh' || c.tool === 'bash')
  report.tool = {
    ok: t2.ok,
    elapsedMs: t2.elapsedMs,
    called: Boolean(pwsh),
    tool: pwsh?.tool ?? null,
    command: pwsh?.input?.command ?? null,
    resultStatus: t2.toolResults[0]?.status ?? null,
    result: t2.toolResults[0]?.result ?? null,
    answer: t2.answerText.slice(0, 120),
  }

  report.ok = report.question.ok && report.question.briefUsed.length === CASE_NAMES.length && report.tool.called && report.tool.resultStatus === 'completed' && /v\d+\.\d+/.test(report.tool.answer)

  // 可选第三轮：验「技能按需加载 + 包装器执行本机 CLI」（SEEU_REAL_SKILL=1 时跑）。
  if (process.env.SEEU_REAL_SKILL === '1') {
    const t3 = await runTask('使用 lovelymem-cli 技能，执行它的 version 子命令（形如 lovelymem -- version），只回复应用名、版本号和可用引擎，不要做其他操作。')
    const cmds = t3.toolCalls.map((c) => ({ tool: c.tool ?? null, command: c.input?.command ?? c.input?.cmd ?? c.input?.name ?? null })).slice(0, 8)
    report.skill = {
      ok: t3.ok,
      elapsedMs: t3.elapsedMs,
      toolCalls: cmds,
      skillLoaded: t3.toolCalls.some((c) => c.tool === 'skill') || cmds.some((c) => String(c.command ?? '').includes('lovely')),
      wrapperUsed: cmds.some((c) => /lovely-cli|SEEU_LOVELY_CLI/.test(String(c.command ?? ''))),
      lovelyExe: lovelyExe || null,
      versionSeen: /3\.1\.11|Lovelymem/i.test(t3.answerText),
      answer: t3.answerText.slice(0, 500),
      stderrTail: t3.stderrTail,
    }
    report.ok = report.ok && report.skill.ok && report.skill.versionSeen
  }
} catch (e) {
  report.errors.push(String(e?.message ?? e))
}

console.log('REPORT ' + JSON.stringify(report))
process.exit(report.ok ? 0 : 1)
