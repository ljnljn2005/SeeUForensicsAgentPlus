/**
 * SeeU Forensics Agent Plus — Electron 主进程。
 *
 * 职责边界：
 *   - 窗口 / 托盘 / 菜单 / 单实例 / 退出编排；
 *   - 拉起并守护 dsh Host 子进程（见 host.ts），把就绪 URL 载入窗口；
 *   - 品牌化加载页与故障页（renderer/），并暴露最小只读 IPC 给页面。
 *
 * 明确不负责：dsh agent 本身的工具、模型、会话 —— 那些在 dsh 运行时里。
 */

import { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, session, shell, type MenuItemConstructorOptions } from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_ID,
  APP_USER_MODEL_ID,
  COLORS,
  PRODUCT_DISPLAY_NAME,
  PRODUCT_NAME,
} from './brand.js'
import { DshHost, type HostState } from './host.js'
import {
  describeLocalModelConfig,
  diagnoseLocalGateway,
  disableLocalModel,
  localModelConfigFile,
  previewLocalModelPatch,
  probeableLocalModel,
  readLocalModelConfig,
  testLocalGateway,
  warmupLocalGateway,
  contextWindowMismatch,
  gatewayContextReported,
  writeLocalModelConfig,
} from './local-model.js'
import { LOVELY_TOOL_SPECS, lovelyToolsView, saveLovelyToolPaths } from './lovely-tools.js'
import { mountHostEnv, mountManager, setMountLogger } from './mounts.js'
import { installBundledPluginBundles } from './dsh-plugins.js'
import { bundledSkillsDir, installBundledSkills, userSkillsDir } from './skills.js'
import {
  bundledSkillNames,
  importSkillFolder,
  importSkillZip,
  listInstalledSkills,
  removeInstalledSkill,
  type ImportResult,
} from './skill-upload.js'
import {
  dshHome,
  dshRuntimeDir,
  forensicsPatchPath,
  hostLogFile,
  logDir,
  preloadFile,
  rendererDir,
  shellLogFile,
  trayIconPath,
  userDataDir,
  windowIconPath,
  workspaceDir,
} from './paths.js'

type StatusPhase = 'starting' | 'ready' | 'error'

interface StatusPayload {
  readonly phase: StatusPhase
  readonly message: string
  readonly detail?: string
  readonly url?: string
}

let mainWindow: BrowserWindow | undefined
let skillsWindow: BrowserWindow | undefined
let settingsWindow: BrowserWindow | undefined
let mountsWindow: BrowserWindow | undefined
let tray: Tray | undefined
let host: DshHost | undefined
let quitting = false
let appOrigin: string | undefined
let lastStatus: StatusPayload = { phase: 'starting', message: '正在启动取证运行时…' }

// ── 外壳日志 ────────────────────────────────────────────────────────────────

function logShell(message: string): void {
  try {
    mkdirSync(logDir(), { recursive: true })
    appendFileSync(shellLogFile(), `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  } catch {
    // 日志失败不能影响主流程
  }
}

// 镜像挂载模块的日志走同一份 shell 日志。
setMountLogger(logShell)

function errorDetail(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  if (error instanceof Error) {
    const extra = (error as Error & { diagnostic?: string }).diagnostic
    return extra ?? error.message
  }
  return String(error)
}

// ── 状态广播 ────────────────────────────────────────────────────────────────

function setStatus(next: StatusPayload): void {
  lastStatus = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('seeu:status', lastStatus)
  }
}

function broadcastStatus(contents: Electron.WebContents): void {
  if (!contents.isDestroyed()) contents.send('seeu:status', lastStatus)
}

// ── 页面装载 ────────────────────────────────────────────────────────────────

/**
 * 页面装载失败（常见 ERR_ABORTED：上一次导航被新导航打断）不应抛到未处理拒绝里，
 * 否则会在主进程刷 UnhandledPromiseRejectionWarning 并掩盖真正的启动错误。
 */
async function loadPage(win: BrowserWindow, target: string): Promise<boolean> {
  try {
    await win.loadFile(target)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ERR_ABORTED') logShell(`load ${target} failed: ${String(error)}`)
    return false
  }
}

async function showLoadingPage(): Promise<void> {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  const loading = join(rendererDir(), 'loading.html')
  if (!existsSync(loading)) return
  await loadPage(mainWindow, loading)
}

async function showErrorPage(message: string, detail?: string): Promise<void> {
  setStatus({ phase: 'error', message, ...(detail === undefined ? {} : { detail }) })
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  const errorPage = join(rendererDir(), 'error.html')
  if (!existsSync(errorPage)) {
    // 兜底：没有错误页时把错误塞进窗口标题，日志里可查。
    mainWindow.setTitle(`${PRODUCT_NAME} — 启动失败`)
    return
  }
  await loadPage(mainWindow, errorPage)
}

// ── dsh Host 生命周期 ───────────────────────────────────────────────────────

/**
 * 已配置本地模型时，启动阶段先做一次短超时连通性探测。
 * 目的：本地网关没开时不要等到用户发第一条消息才报错——先在日志和加载页里说清楚。
 * 探测失败不阻塞启动（仍可以继续用官方模型），只更新提示。
 *
 * 结果会缓存到 `localModelProbeState`，供托盘 tooltip、菜单「本地模型状态…」和
 * 设置窗口显示；`reason = 'manual'` 时（用户主动点重新探测）不改加载页状态。
 */
interface LocalModelProbeState {
  readonly ok: boolean
  readonly baseURL: string
  readonly models: string[]
  /** 配置里写了、但网关 /v1/models 没返回的模型 id（通常是模型改名或抄错）。 */
  readonly missing?: string[]
  /** 配置的上下文窗口超过网关自报能力时给出两者数值。 */
  readonly mismatch?: { configured: number; gateway: number }
  /** 网关 /v1/models 没有自报任何上下文窗口（Ollama 等）时为 true：窗口只能按模型文档手填。 */
  readonly noContextWindow?: boolean
  readonly error?: string
  readonly at: string
}

let localModelProbeState: LocalModelProbeState | undefined

function modelStatusLabel(): string {
  if (localModelProbeState === undefined) return '官方模型'
  if (localModelProbeState.ok) {
    const first = localModelProbeState.models[0]
    return first === undefined ? '本地模型（网关已连通）' : `本地模型 ${first}`
  }
  return '本地网关未连通（当前用官方模型）'
}

/** 托盘提示与菜单是外壳里唯一常驻的「我现在用哪个模型」提示位。 */
function refreshModelIndicators(): void {
  if (tray === undefined) return
  try {
    tray.setToolTip(`${PRODUCT_NAME} · ${modelStatusLabel()}`)
  } catch {
    // 托盘已销毁时忽略
  }
}

async function probeLocalModelGateway(reason: 'startup' | 'manual' = 'startup'): Promise<LocalModelProbeState | undefined> {
  const target = probeableLocalModel()
  if (target === undefined) {
    localModelProbeState = undefined
    refreshModelIndicators()
    broadcastLocalModelProbe()
    if (reason === 'manual') logShell('local model probe: 未配置本地模型，跳过')
    return undefined
  }
  const { baseURL, apiKey } = target
  try {
    const probe = await testLocalGateway({ baseURL, apiKey, timeoutMs: 4000 })
    const ids = (probe.models ?? []).map((item) => item.id ?? item.name ?? '').filter(Boolean)
    const missing = target.models.filter((id) => !ids.includes(id))
    const mismatch = contextWindowMismatch(target.contextWindow, target.models, probe.models)
    const noContextWindow = probe.ok && ids.length > 0 && !gatewayContextReported(probe.models)
    localModelProbeState = probe.ok
      ? {
          ok: true,
          baseURL,
          models: ids,
          ...(missing.length === 0 ? {} : { missing }),
          ...(mismatch === null ? {} : { mismatch }),
          ...(noContextWindow ? { noContextWindow: true } : {}),
          at: new Date().toISOString(),
        }
      : { ok: false, baseURL, models: [], ...(probe.error === undefined ? {} : { error: probe.error }), at: new Date().toISOString() }
    refreshModelIndicators()
    broadcastLocalModelProbe()
    if (probe.ok) {
      logShell(`local model probe: ${baseURL} 可用（${ids.join(', ') || '网关未返回模型列表'}）`)
      if (missing.length > 0) {
        logShell(`local model probe: 配置的模型 ${missing.join(', ')} 不在网关列表里（网关有：${ids.join(', ')}）`)
      }
      if (mismatch !== null) {
        logShell(`local model probe: 配置的上下文窗口 ${mismatch.configured} 超过网关自报的 ${mismatch.gateway}，超出部分请求会被拒`)
      }
      if (noContextWindow) {
        logShell(`local model probe: 网关没有自报上下文窗口（只有模型 id），按配置的 ${target.contextWindow} 使用，模型实际窗口更小会报 400`)
      }
      return localModelProbeState
    }
    logShell(`local model probe: ${baseURL} 不可用 → ${probe.error ?? '未知错误'}`)
    if (reason === 'startup' && lastStatus.phase === 'starting') {
      setStatus({ phase: 'starting', message: '本地模型网关暂未连通，先用官方模型启动…' })
    }
    return localModelProbeState
  } catch (error) {
    logShell(`local model probe 异常: ${errorDetail(error) ?? error}`)
    return undefined
  }
}

/** 把探测结果推给所有窗口：设置窗口可能在探测完成前就已经打开。 */
function broadcastLocalModelProbe(): void {
  const payload = localModelProbeState ?? null
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('seeu:local-model:probe', payload)
  }
}

/** 工具 → 本地模型状态…：把配置文件、探测地址/时间/结果一次讲清楚。 */
function showLocalModelStatus(): void {
  const view = describeLocalModelConfig()
  const probe = localModelProbeState
  const lines: string[] = [`配置文件：${view.path}${view.exists ? '' : '（不存在）'}`]
  if (view.error !== undefined) lines.push(`配置错误：${view.error}`)
  if (probe === undefined) {
    lines.push('启动探测：未配置本地模型（使用官方模型）')
  } else {
    lines.push(
      `启动探测：${probe.ok ? `可用 · ${probe.models.join(', ') || '网关未返回模型列表'}` : `不可用 · ${probe.error ?? '未知错误'}`}`,
      `探测地址：${probe.baseURL}`,
      `探测时间：${probe.at}`,
    )
  }
  lines.push('', '修改配置：工具 → 本地模型设置…（保存后需重启应用才生效）')
  const canProbe = probe !== undefined
  const buttons = canProbe ? ['重新探测', '关闭'] : ['关闭']
  void dialog
    .showMessageBox({
      type: probe?.ok === true ? 'info' : 'warning',
      title: '本地模型状态',
      message: modelStatusLabel(),
      detail: lines.join('\n'),
      buttons,
      defaultId: buttons.length - 1,
      cancelId: buttons.length - 1,
    })
    .then((result) => {
      if (result.response === 0 && canProbe) {
        void probeLocalModelGateway('manual').then(() => {
          showLocalModelStatus()
        })
      }
    })
}

async function startHost(): Promise<void> {
  if (host !== undefined) await host.stop()
  await showLoadingPage()
  setStatus({ phase: 'starting', message: '正在启动取证运行时…' })
  const skills = installBundledSkills(app.getVersion())
  logShell(
    `skills: ${skills.skills.length} 个（${skills.skills.join(', ') || '无'}）→ ${skills.dir}${skills.changed ? ' [已更新]' : ' [无变化]'}`,
  )
  logShell(`start host: runtime=${dshRuntimeDir()} home=${dshHome()} patch=${forensicsPatchPath()}`)
  // 随包 dsh 插件：把 bundles 补进 <DSH_HOME>/profiles/web/package.json（离线、无需 npm）。
  const dshPlugins = process.env.SEEU_DISABLE_DSH_PLUGINS === '1'
    ? { added: [], missing: [], changed: false, manifestPath: '(disabled)' }
    : installBundledPluginBundles()
  logShell(
    `dsh plugins: ${dshPlugins.added.length > 0 ? `已补 ${dshPlugins.added.join(', ')}` : '已就绪'}` +
      `${dshPlugins.missing.length > 0 ? `；缺少 ${dshPlugins.missing.join(', ')}` : ''}` +
      `${dshPlugins.error !== undefined ? `；错误 ${dshPlugins.error}` : ''} → ${dshPlugins.manifestPath}`,
  )
  void probeLocalModelGateway()

  const next = new DshHost({ env: mountHostEnv() })
  host = next
  next.on('state', (state: HostState) => {
    if (state.phase === 'ready') {
      appOrigin = state.origin
      logShell(`host ready: ${state.url}`)
      setStatus({ phase: 'ready', message: '运行时已就绪', url: state.url })
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
        void mainWindow.loadURL(state.url)
      }
    }
  })
  next.on('exit', ({ code, signal }: { code: number | null; signal: NodeJS.Signals | null }) => {
    if (quitting || next.stoppingFlag) return
    const detail = [`dsh host 意外退出 code=${String(code)} signal=${String(signal)}`, next.stderr].filter(Boolean).join('\n\n')
    logShell('host exited unexpectedly')
    void showErrorPage('取证运行时意外退出', detail)
  })

  try {
    await next.start()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logShell(`startHost failed: ${message}`)
    await showErrorPage('取证运行时启动失败', errorDetail(error))
  }
}

async function retryHost(): Promise<void> {
  if (quitting) return
  logShell('retry requested')
  if (host !== undefined) await host.stop()
  host = undefined
  appOrigin = undefined
  await startHost()
}

async function requestQuit(): Promise<void> {
  if (quitting) return
  quitting = true
  logShell('quit requested')
  try {
    // 挂载点是 CLI 进程内的资源：先释放，再停 dsh。
    await mountManager.dispose()
  } catch (error) {
    logShell(`mounts dispose failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    if (host !== undefined) await host.stop()
  } finally {
    host = undefined
    app.quit()
  }
}

// ── 窗口 / 托盘 / 菜单 ──────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: COLORS.background,
    title: PRODUCT_NAME,
    // 菜单栏常显（设置/镜像挂载/技能都在里面），不要让用户记快捷键或按 Alt。
    autoHideMenuBar: false,
    icon: existsSync(windowIconPath()) ? windowIconPath() : undefined,
    webPreferences: {
      preload: preloadFile(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.setMenuBarVisibility(true)

  // dsh Web UI 的 document.title 来自官方客户端包（"DeepSeek Harness"），页面加载后
  // 会把窗口标题改写掉。这里拦截标题变更，让任务栏/标题栏始终显示本产品名。
  win.on('page-title-updated', (event) => {
    event.preventDefault()
    win.setTitle(PRODUCT_NAME)
  })

  // 桌面版习惯：关闭窗口=最小化到托盘，真正退出走托盘/菜单。
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })

  win.webContents.on('did-finish-load', () => broadcastStatus(win.webContents))

  // 外部链接一律交给系统浏览器，窗口内不允许新开窗口。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://') || (appOrigin !== undefined && url.startsWith(appOrigin))
    if (allowed) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    logShell(`renderer gone: ${details.reason}`)
    if (!quitting) void showErrorPage('界面进程异常退出', `reason=${details.reason} exitCode=${String(details.exitCode)}`)
  })

  void showLoadingPage()
  return win
}

function focusMainWindow(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * 本地模型设置窗口：只读写 `<userData>/local-model.json`，保存后重启生效。
 * 用独立窗口而不是 dsh 设置页，是因为同一服务行的 settings 写入会被 overlay
 * 覆盖并硬拒（`Configuration for "<id>" is overridden by …`）。
 */
function openLocalModelSettings(): void {
  if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 700,
    height: 780,
    minWidth: 560,
    minHeight: 520,
    title: '本地模型设置',
    parent: mainWindow === undefined || mainWindow.isDestroyed() ? undefined : mainWindow,
    modal: false,
    show: false,
    backgroundColor: COLORS.background,
    icon: existsSync(windowIconPath()) ? windowIconPath() : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadFile(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  settingsWindow.once('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => { settingsWindow = undefined })
  void settingsWindow.loadFile(join(rendererDir(), 'local-model.html'))
}

function createTray(): void {
  const icon = trayIconPath()
  if (!existsSync(icon)) {
    logShell(`tray icon missing: ${icon}`)
    return
  }
  try {
    tray = new Tray(nativeImage.createFromPath(icon))
    tray.setToolTip(`${PRODUCT_NAME} · ${modelStatusLabel()}`)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => focusMainWindow() },
      { type: 'separator' },
      { label: '打开取证工作区', click: () => void shell.openPath(workspaceDir()) },
      { label: '打开日志目录', click: () => void shell.openPath(logDir()) },
      { label: '本地模型设置…', click: () => openLocalModelSettings() },
      { label: '本地模型状态…', click: () => showLocalModelStatus() },
      { label: '镜像挂载…', click: () => openMountsWindow() },
      { type: 'separator' },
      { label: '退出', click: () => void requestQuit() },
    ]))
    tray.on('click', () => focusMainWindow())
  } catch (error) {
    logShell(`tray create failed: ${String(error)}`)
  }
}

// ── 技能上传 / 管理 ─────────────────────────────────────────────────────────
//
// 入口：应用菜单「技能」与技能管理器窗口。导入的 ZIP/文件夹经 skill-upload.ts
// 校验（SKILL.md + frontmatter + 路径消毒）后写入 `<DSH_HOME>/skills/<name>`；
// dsh-skill-filesystem 默认 watch=true，写入即失效重扫，新会话立即可见。

function skillsImportOptions(overwrite?: boolean) {
  return {
    userSkillsDir: userSkillsDir(),
    bundledNames: bundledSkillNames(bundledSkillsDir()),
    ...(overwrite === undefined ? {} : { overwrite }),
  }
}

/** 菜单直导：选文件夹 → 安装 → 弹结果。 */
async function importSkillFromFolderDialog(): Promise<void> {
  const win = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined
  const picked = await dialog.showOpenDialog({
    ...(win === undefined ? {} : { parent: win }),
    title: '选择技能文件夹（含 SKILL.md）',
    properties: ['openDirectory'],
  })
  if (picked.canceled || picked.filePaths.length === 0) return
  const result = importSkillFolder(picked.filePaths[0], skillsImportOptions())
  await reportImportResult(result, async () => {
    // 同名用户技能：询问是否覆盖
    const answer = await dialog.showMessageBox({
      type: 'question',
      title: '覆盖技能',
      message: result.message ?? '同名技能已存在',
      buttons: ['覆盖', '取消'],
      defaultId: 0,
      cancelId: 1,
    })
    if (answer.response === 0) {
      const retry = importSkillFolder(picked.filePaths[0], skillsImportOptions(true))
      await reportImportResult(retry)
    }
  })
}

/** 菜单直导：选 ZIP → 安装 → 弹结果。 */
async function importSkillFromZipDialog(): Promise<void> {
  const win = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined
  const picked = await dialog.showOpenDialog({
    ...(win === undefined ? {} : { parent: win }),
    title: '选择技能 ZIP 包',
    filters: [{ name: '技能包', extensions: ['zip'] }],
    properties: ['openFile'],
  })
  if (picked.canceled || picked.filePaths.length === 0) return
  const result = importSkillZip(picked.filePaths[0], skillsImportOptions())
  await reportImportResult(result, async () => {
    const answer = await dialog.showMessageBox({
      type: 'question',
      title: '覆盖技能',
      message: result.message ?? '同名技能已存在',
      buttons: ['覆盖', '取消'],
      defaultId: 0,
      cancelId: 1,
    })
    if (answer.response === 0) {
      const retry = importSkillZip(picked.filePaths[0], skillsImportOptions(true))
      await reportImportResult(retry)
    }
  })
}

async function reportImportResult(result: ImportResult, onAlreadyExists?: () => Promise<void>): Promise<void> {
  if (result.ok && result.skill !== undefined) {
    logShell(`skill imported: ${result.skill.name} (${String(result.skill.files)} files)`)
    await dialog.showMessageBox({
      type: 'info',
      title: '技能已导入',
      message: `技能 "${result.skill.name}" 已安装`,
      detail: `共 ${String(result.skill.files)} 个文件。新会话立即可用；进行中的会话在下一次检索技能时也会发现它。`,
      buttons: ['确定'],
    })
    broadcastSkillsChanged()
    return
  }
  if (result.code === 'alreadyExists' && onAlreadyExists !== undefined) {
    await onAlreadyExists()
    return
  }
  logShell(`skill import failed: ${result.code ?? ''} ${result.message ?? ''}`)
  await dialog.showMessageBox({
    type: 'warning',
    title: '技能导入失败',
    message: result.message ?? '未知错误',
    buttons: ['确定'],
  })
}

/** 技能变化后通知管理器窗口刷新。 */
function broadcastSkillsChanged(): void {
  if (skillsWindow !== undefined && !skillsWindow.isDestroyed()) {
    skillsWindow.webContents.send('seeu:skills-changed')
  }
}

function openSkillsWindow(): void {
  if (skillsWindow !== undefined && !skillsWindow.isDestroyed()) {
    skillsWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 820,
    height: 660,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: COLORS.background,
    title: `${PRODUCT_NAME} — 技能管理器`,
    icon: existsSync(windowIconPath()) ? windowIconPath() : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadFile(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  skillsWindow = win
  win.on('closed', () => { skillsWindow = undefined })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void win.loadFile(join(rendererDir(), 'skills.html'))
}

/**
 * 镜像挂载窗口：把取证镜像（E01/RAW/VMDK…）通过 LovelyCarve CLI 挂成只读盘符。
 * 挂载点只在 CLI 进程存活期间有效，所以窗口只负责“让用户操作”，
 * 常驻进程与清单都在主进程的 mountManager 里。
 */
function openMountsWindow(): void {
  if (mountsWindow !== undefined && !mountsWindow.isDestroyed()) {
    mountsWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 820,
    height: 760,
    minWidth: 640,
    minHeight: 520,
    backgroundColor: COLORS.background,
    title: `${PRODUCT_NAME} — 镜像挂载`,
    icon: existsSync(windowIconPath()) ? windowIconPath() : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadFile(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  mountsWindow = win
  win.on('closed', () => { mountsWindow = undefined })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void win.loadFile(join(rendererDir(), 'mounts.html'))
}

function showAbout(): void {  void dialog.showMessageBox({
    type: 'info',
    title: `关于 ${PRODUCT_NAME}`,
    message: `${PRODUCT_NAME}（${PRODUCT_DISPLAY_NAME}）`,
    detail: [
      `版本：${app.getVersion()}`,
      `应用 ID：${APP_ID}`,
      `Electron：${process.versions.electron}`,
      `Chromium：${process.versions.chrome}`,
      `Node：${process.versions.node}`,
      `运行时：@deepseek-ai/dsh（web profile + 取证 overlay）`,
      `本地模型：${modelStatusLabel()}`,
      `DSH_HOME：${dshHome()}`,
      `工作区：${workspaceDir()}`,
    ].join('\n'),
    buttons: ['确定'],
  })
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '打开取证工作区', click: () => void shell.openPath(workspaceDir()) },
        { label: '打开日志目录', click: () => void shell.openPath(logDir()) },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => void requestQuit() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载界面' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '技能',
      submenu: [
        { label: '技能管理器…', accelerator: 'Ctrl+Shift+S', click: () => openSkillsWindow() },
        { type: 'separator' },
        { label: '导入技能包（文件夹）…', click: () => void importSkillFromFolderDialog() },
        { label: '导入技能包（ZIP）…', click: () => void importSkillFromZipDialog() },
        { type: 'separator' },
        { label: '打开技能目录', click: () => void shell.openPath(userSkillsDir()) },
      ],
    },
    {
      label: '工具',
      submenu: [
        { label: '本地模型设置…', click: () => openLocalModelSettings() },
        { label: '本地模型状态…', click: () => showLocalModelStatus() },
        { label: '镜像挂载…', accelerator: 'Ctrl+Shift+M', click: () => openMountsWindow() },
        { label: '重新探测本地网关', click: () => { void probeLocalModelGateway('manual').then(() => { showLocalModelStatus() }) } },
        { type: 'separator' },
        { label: '打开配置文件目录', click: () => void shell.openPath(userDataDir()) },
      ],
    },
    {
      // 一级「设置」菜单：设置/镜像/技能都在这里，不用记快捷键。
      label: '设置',
      submenu: [
        { label: '本地模型与工具路径…', accelerator: 'Ctrl+,', click: () => openLocalModelSettings() },
        { label: '镜像挂载…', accelerator: 'Ctrl+Shift+M', click: () => openMountsWindow() },
        { label: '技能管理器…', accelerator: 'Ctrl+Shift+S', click: () => openSkillsWindow() },
        { type: 'separator' },
        { label: '本地模型状态…', click: () => showLocalModelStatus() },
        { label: '重新探测本地网关', click: () => { void probeLocalModelGateway('manual').then(() => { showLocalModelStatus() }) } },
        { type: 'separator' },
        { label: '打开配置文件目录', click: () => void shell.openPath(userDataDir()) },
        { label: '打开日志目录', click: () => void shell.openPath(logDir()) },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: `关于 ${PRODUCT_NAME}`, click: () => showAbout() },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── IPC ────────────────────────────────────────────────────────────────────

function registerIpc(): void {
  ipcMain.handle('seeu:clipboard:write', (_event, text: unknown) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  // 面板导出的落盘（CSV 等）：默认存到 <下载>/seeu-exports，SEEU_EXPORT_DIR 可覆盖（e2e 用）。
  ipcMain.handle('seeu:file:save-export', (_event, input: unknown) => {
    const payload = input as { name?: unknown; text?: unknown } | null
    const text = typeof payload?.text === 'string' ? payload.text : ''
    if (!text) return { ok: false, error: '导出内容为空' }
    const dir = process.env.SEEU_EXPORT_DIR || join(app.getPath('downloads'), 'seeu-exports')
    const rawName = typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : 'seeu-export.csv'
    const safeName = rawName.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120) || 'seeu-export.csv'
    try {
      mkdirSync(dir, { recursive: true })
      const target = join(dir, safeName)
      writeFileSync(target, text, 'utf8')
      return { ok: true, path: target, bytes: Buffer.byteLength(text, 'utf8') }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('seeu:info', () => ({
    productName: PRODUCT_NAME,
    displayName: PRODUCT_DISPLAY_NAME,
    appId: APP_ID,
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dshHome: dshHome(),
    workspace: workspaceDir(),
    logs: logDir(),
    patch: forensicsPatchPath(),
    hostLog: hostLogFile(),
  }))
  ipcMain.on('seeu:retry', () => { void retryHost() })
  ipcMain.on('seeu:open-logs', () => { void shell.openPath(logDir()) })
  ipcMain.on('seeu:open-workspace', () => { void shell.openPath(workspaceDir()) })
  ipcMain.on('seeu:quit', () => { void requestQuit() })

  // ── 技能管理 IPC（供技能管理器页面调用；文件选择仍在主进程弹原生对话框）──
  ipcMain.handle('seeu:skills:list', () => listInstalledSkills(userSkillsDir(), bundledSkillsDir()))
  ipcMain.handle('seeu:skills:import-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const picked = await dialog.showOpenDialog({
      ...(win === null ? {} : { parent: win }),
      title: '选择技能文件夹（含 SKILL.md）',
      properties: ['openDirectory'],
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, code: 'cancelled' } satisfies ImportResult
    const result = importSkillFolder(picked.filePaths[0], skillsImportOptions())
    if (result.ok) { logShell(`skill imported: ${result.skill?.name ?? ''}`); broadcastSkillsChanged() }
    return { ...result, sourcePath: picked.filePaths[0] }
  })
  ipcMain.handle('seeu:skills:import-zip', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const picked = await dialog.showOpenDialog({
      ...(win === null ? {} : { parent: win }),
      title: '选择技能 ZIP 包',
      filters: [{ name: '技能包', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, code: 'cancelled' } satisfies ImportResult
    const result = importSkillZip(picked.filePaths[0], skillsImportOptions())
    if (result.ok) { logShell(`skill imported: ${result.skill?.name ?? ''}`); broadcastSkillsChanged() }
    return { ...result, sourcePath: picked.filePaths[0] }
  })
  // 管理器确认覆盖后走这里。
  ipcMain.handle('seeu:skills:import-folder-overwrite', async (_event, folder: string) => {
    if (typeof folder !== 'string' || folder === '') return { ok: false, code: 'notFound' } satisfies ImportResult
    const result = importSkillFolder(folder, skillsImportOptions(true))
    if (result.ok) { logShell(`skill imported(overwrite): ${result.skill?.name ?? ''}`); broadcastSkillsChanged() }
    return result
  })
  ipcMain.handle('seeu:skills:import-zip-overwrite', async (_event, zipPath: string) => {
    if (typeof zipPath !== 'string' || zipPath === '') return { ok: false, code: 'notFound' } satisfies ImportResult
    const result = importSkillZip(zipPath, skillsImportOptions(true))
    if (result.ok) { logShell(`skill imported(overwrite): ${result.skill?.name ?? ''}`); broadcastSkillsChanged() }
    return result
  })
  ipcMain.handle('seeu:skills:remove', (_event, name: string) => {
    const result = removeInstalledSkill(userSkillsDir(), String(name), bundledSkillNames(bundledSkillsDir()))
    if (result.ok) { logShell(`skill removed: ${name}`); broadcastSkillsChanged() }
    return result
  })
  ipcMain.on('seeu:skills:open-dir', () => { void shell.openPath(userSkillsDir()) })

  ipcMain.on('seeu:open-settings', () => { openLocalModelSettings() })
  ipcMain.on('seeu:open-mounts', () => { openMountsWindow() })
  ipcMain.on('seeu:open-skills', () => { openSkillsWindow() })

  // 本地模型设置窗口。配置文件存在时以文件为准（生产路径）；
  // 只在 SEEU_LOCAL_MODEL_JSON 注入、没有文件时（开发/联调）也返回生效配置，
  // 否则欢迎页的「本地模型」chip 会看不到当前正在跑的路由。
  ipcMain.handle('seeu:local-model:get', () => {
    const view = describeLocalModelConfig()
    const probe = localModelProbeState ?? null
    if (view.exists) return { ...view, probe }
    try {
      const inline = readLocalModelConfig()
      return inline === undefined ? { ...view, probe } : { ...view, config: inline, probe }
    } catch {
      return { ...view, probe }
    }
  })
  ipcMain.handle('seeu:local-model:probe', async () => (await probeLocalModelGateway('manual')) ?? null)
  ipcMain.handle('seeu:local-model:save', (_event, input: unknown) => writeLocalModelConfig(input))
  ipcMain.handle('seeu:local-model:preview', (_event, input: unknown) => previewLocalModelPatch(input))
  ipcMain.handle('seeu:local-model:test', (_event, probe: { baseURL?: string; apiKey?: string }) =>
    testLocalGateway(probe ?? {}))
  ipcMain.handle('seeu:local-model:warmup', async (_event, probe: { baseURL?: string; apiKey?: string; model?: string } | undefined) => {
    const input = probe ?? {}
    if (input.baseURL !== undefined && input.baseURL !== '') return warmupLocalGateway(input)
    const target = probeableLocalModel()
    if (target === undefined) {
      return { ok: false, elapsedMs: 0, error: '未配置本地模型', hint: '先在设置页填网关地址与模型，保存后再预热。' }
    }
    return warmupLocalGateway({ baseURL: target.baseURL, apiKey: target.apiKey, model: target.models[0] })
  })
  ipcMain.handle('seeu:local-model:diagnose', (_event, probe: { baseURL?: string; apiKey?: string; model?: string }) =>
    diagnoseLocalGateway(probe ?? {}))
  ipcMain.handle('seeu:local-model:disable', () => {
    const res = disableLocalModel()
    logShell(res.ok ? `local model: 已禁用（${res.path}）` : `local model: 禁用失败（${res.error}）`)
    return res
  })
  ipcMain.handle('seeu:local-model:disable-restart', () => {
    const res = disableLocalModel()
    logShell(res.ok
      ? `local model: 启动失败兜底，已禁用本地模型并重启（${res.path}）`
      : `local model: 启动失败兜底，禁用本地模型失败（${res.error}）`)
    if (res.ok) setTimeout(() => { app.relaunch(); void requestQuit() }, 250)
    return res
  })
  ipcMain.on('seeu:local-model:restart', () => {
    logShell('local model: 用户从设置页请求重启')
    app.relaunch()
    void requestQuit()
  })
  ipcMain.on('seeu:local-model:open-file', () => {
    const file = localModelConfigFile()
    if (existsSync(file)) shell.showItemInFolder(file)
    else void shell.openPath(userDataDir())
  })

  // 本机取证工具路径：不自动发现，路径只来自设置窗口（写 <DSH_HOME>/lovely-cli.json）。
  ipcMain.handle('seeu:lovely-tools:get', () => lovelyToolsView(process.env))
  ipcMain.handle('seeu:lovely-tools:pick', async (_event, tool: unknown) => {
    const id = LOVELY_TOOL_SPECS.some((spec) => spec.id === tool) ? String(tool) : 'lovelymem'
    const label = LOVELY_TOOL_SPECS.find((spec) => spec.id === id)?.label ?? '取证工具'
    const result = await dialog.showOpenDialog({
      title: `选择 ${label} 的 exe`,
      properties: ['openFile'],
      filters: [{ name: '可执行文件', extensions: ['exe'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    return { ok: true, path: result.filePaths[0] }
  })
  ipcMain.handle('seeu:lovely-tools:save', (_event, input: unknown) => {
    try {
      const res = saveLovelyToolPaths(input, process.env)
      logShell(`lovely tools: 已保存工具路径（${res.saved.map((item) => `${item.id}:${item.action}`).join(', ')}）`)
      return res
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ── 镜像挂载（LovelyCarve CLI 常驻进程；挂载点只在进程存活期间有效）──
  ipcMain.handle('seeu:mounts:get', () => mountManager.status())
  ipcMain.handle('seeu:mounts:pick-image', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择取证镜像',
      properties: ['openFile'],
      filters: [
        { name: '取证镜像', extensions: ['e01', 'E01', 'ex01', 'dd', 'raw', 'img', 'vmdk', 'vhdx', 'qcow2', 'iso'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    return { ok: true, path: result.filePaths[0] }
  })
  ipcMain.handle('seeu:mounts:inspect', (_event, imagePath: unknown) => mountManager.inspect(String(imagePath ?? '')))
  ipcMain.handle('seeu:mounts:mount', (_event, input: unknown) => {
    const payload = (input ?? {}) as { imagePath?: unknown; partition?: unknown; mountPoint?: unknown }
    return mountManager.mount({
      imagePath: payload.imagePath === undefined ? undefined : String(payload.imagePath),
      partition: payload.partition === undefined ? 0 : Number(payload.partition),
      mountPoint: payload.mountPoint === undefined ? undefined : String(payload.mountPoint),
    })
  })
  ipcMain.handle('seeu:mounts:unmount', (_event, id: unknown) => mountManager.unmount(String(id ?? '')))
  ipcMain.handle('seeu:mounts:open', async (_event, mountPoint: unknown) => {
    const point = String(mountPoint ?? '').trim()
    if (!point) return { ok: false, error: '缺少挂载点' }
    const error = await shell.openPath(point.endsWith('\\') ? point : `${point}\\`)
    return error ? { ok: false, error } : { ok: true }
  })
}

// ── 启动 ────────────────────────────────────────────────────────────────────

// 开发/截图时允许并行实例（例如用户正开着安装版验收，开发态要另起一个窗口截图）。
// 仅当显式设置 SEEU_DEV_MULTI=1 时生效，装出来的桌面版不受影响。
const allowMultiInstance = process.env.SEEU_DEV_MULTI === '1'
const gotLock = allowMultiInstance ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  // 必须在 ready 之前设置：决定 userData 目录与任务栏归属。
  app.setName(PRODUCT_NAME)
  app.setPath('userData', join(app.getPath('appData'), PRODUCT_NAME))
  app.setAppUserModelId(APP_USER_MODEL_ID)

  app.on('window-all-closed', () => {
    // 有托盘时保留后台常驻；无托盘则按 Windows 习惯退出。
    if (tray === undefined) void requestQuit()
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    void requestQuit()
  })

  void app.whenReady().then(async () => {
    logShell(`shell start: ${PRODUCT_NAME} ${app.getVersion()} packaged=${String(app.isPackaged)}`)
    logShell(`paths: runtime=${dshRuntimeDir()} patch=${forensicsPatchPath()} home=${dshHome()}`)

    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)

    registerIpc()
    buildMenu()
    createTray()
    mainWindow = createWindow()
    // 开发/自动化：SEEU_OPEN_SETTINGS=1 时启动即打开本地模型设置窗口（截图与 CDP 验收用）。
    if (process.env.SEEU_OPEN_SETTINGS === '1') openLocalModelSettings()
    if (process.env.SEEU_OPEN_MOUNTS === '1') openMountsWindow()
    await startHost()
  })
}

export { PRODUCT_NAME }
