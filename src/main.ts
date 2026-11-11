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

import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, session, shell, type MenuItemConstructorOptions } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_ID,
  APP_USER_MODEL_ID,
  COLORS,
  PRODUCT_DISPLAY_NAME,
  PRODUCT_NAME,
} from './brand.js'
import { DshHost, type HostState } from './host.js'
import { installBundledSkills } from './skills.js'
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

async function startHost(): Promise<void> {
  if (host !== undefined) await host.stop()
  await showLoadingPage()
  setStatus({ phase: 'starting', message: '正在启动取证运行时…' })
  const skills = installBundledSkills(app.getVersion())
  logShell(
    `skills: ${skills.skills.length} 个（${skills.skills.join(', ') || '无'}）→ ${skills.dir}${skills.changed ? ' [已更新]' : ' [无变化]'}`,
  )
  logShell(`start host: runtime=${dshRuntimeDir()} home=${dshHome()} patch=${forensicsPatchPath()}`)

  const next = new DshHost()
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

function createTray(): void {
  const icon = trayIconPath()
  if (!existsSync(icon)) {
    logShell(`tray icon missing: ${icon}`)
    return
  }
  try {
    tray = new Tray(nativeImage.createFromPath(icon))
    tray.setToolTip(PRODUCT_NAME)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => focusMainWindow() },
      { type: 'separator' },
      { label: '打开取证工作区', click: () => void shell.openPath(workspaceDir()) },
      { label: '打开日志目录', click: () => void shell.openPath(logDir()) },
      { type: 'separator' },
      { label: '退出', click: () => void requestQuit() },
    ]))
    tray.on('click', () => focusMainWindow())
  } catch (error) {
    logShell(`tray create failed: ${String(error)}`)
  }
}

function showAbout(): void {
  void dialog.showMessageBox({
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
}

// ── 启动 ────────────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
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
    await startHost()
  })
}

export { PRODUCT_NAME }
