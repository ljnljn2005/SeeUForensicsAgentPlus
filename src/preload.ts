/**
 * 预加载脚本：只暴露最小、只读、无 Node 能力的桥。
 *
 * 注意：该 preload 同时挂在本地加载/错误页与 dsh Web UI 页面（同为
 * 本窗口），因此命名空间统一用 `window.seeu`，且不注入任何可执行能力。
 */

import { contextBridge, ipcRenderer } from 'electron'

export interface SeeuStatus {
  readonly phase: 'starting' | 'ready' | 'error'
  readonly message: string
  readonly detail?: string
  readonly url?: string
}

export interface SeeuInfo {
  readonly productName: string
  readonly displayName: string
  readonly appId: string
  readonly version: string
  readonly packaged: boolean
  readonly platform: string
  readonly arch: string
  readonly electron: string
  readonly chrome: string
  readonly node: string
  readonly dshHome: string
  readonly workspace: string
  readonly logs: string
  readonly patch: string
  readonly hostLog: string
}

export interface SeeuSkillSummary {
  readonly name: string
  readonly description: string
  readonly bundled: boolean
  readonly files: number
}

export interface SeeuSkillImportResult {
  readonly ok: boolean
  readonly code?: string
  readonly message?: string
  readonly skill?: SeeuSkillSummary
  /** 导入对话框选中的源路径（覆盖重试时回传给主进程）。 */
  readonly sourcePath?: string
}

export interface LovelyToolState {
  readonly id: 'lovelymem' | 'lovelyspark' | 'lovelycarve'
  readonly label: string
  readonly env: string
  readonly hint: string
  readonly path: string
  readonly source: 'env' | 'config' | 'unset'
  readonly configured: boolean
  readonly found: boolean
}

export interface LovelyToolsView {
  readonly configFile: string
  readonly tools: LovelyToolState[]
  readonly error?: string
}

export interface LovelyToolsSaveResult {
  readonly ok: boolean
  readonly error?: string
  readonly saved?: { id: 'lovelymem' | 'lovelyspark' | 'lovelycarve'; action: 'set' | 'cleared' }[]
  readonly configFile?: string
  readonly tools?: LovelyToolState[]
}

export interface MountRecord {
  readonly id: string
  readonly imagePath: string
  readonly imageName: string
  readonly partition: number
  readonly mountPoint: string
  readonly mountedAt: string
  readonly caseDir?: string
  readonly exists?: boolean
}

export interface MountStatus {
  readonly ok: boolean
  readonly cli: { path: string | null; source: 'env' | 'config' | 'auto' | 'unset'; error?: string }
  readonly stateFile: string
  readonly caseDir: string
  readonly hostRunning: boolean
  readonly defaultMountPoint: string
  readonly mounts: MountRecord[]
}

export interface MountPartition {
  readonly index: number
  readonly label?: string
  readonly fileSystem?: string
  readonly sizeBytes?: number
  readonly offsetBytes?: number
}

export interface ImageInspectResult {
  readonly ok: boolean
  readonly error?: string
  readonly image?: {
    readonly path: string
    readonly name: string
    readonly sizeBytes?: number
    readonly format?: string
    readonly partitions: MountPartition[]
  }
}

export interface MountResult {
  readonly ok: boolean
  readonly error?: string
  readonly mount?: MountRecord
  readonly mounts?: MountRecord[]
}

export interface LocalModelProbeState {
  readonly ok: boolean
  readonly baseURL: string
  readonly models: string[]
  readonly error?: string
  readonly at: string
  readonly missing?: string[]
  /** 配置的上下文窗口超过网关自报能力时给出两者数值。 */
  readonly mismatch?: { configured: number; gateway: number }
  /** 网关没有自报上下文窗口（Ollama 等）：窗口只能按模型文档手填。 */
  readonly noContextWindow?: boolean
}

export interface LocalModelView {
  readonly path: string
  readonly exists: boolean
  readonly config?: unknown
  readonly error?: string
  readonly probe?: LocalModelProbeState | null
}

export interface LocalModelWarmupResult {
  readonly ok: boolean
  /** 非流式最小请求的往返毫秒数（模型冷启动时可能几十秒）。 */
  readonly elapsedMs: number
  readonly reply?: string
  readonly error?: string
  readonly hint?: string
}

export interface LocalModelSaveResult {
  readonly ok: boolean
  readonly path?: string
  readonly error?: string
}

export interface LocalModelDiagnosisItem {
  readonly key: string
  readonly label: string
  readonly ok: boolean
  readonly detail: string
  readonly ms?: number
}

export interface LocalModelDiagnosis {
  readonly ok: boolean
  readonly baseURL: string
  readonly model?: string
  readonly items: LocalModelDiagnosisItem[]
}

export interface LocalModelWarning {
  readonly level: 'err' | 'warn' | 'info'
  readonly key: string
  readonly message: string
}

export interface LocalModelProbeResult {
  readonly ok: boolean
  readonly status?: number
  readonly models?: Array<{ id?: string; name?: string; contextWindow?: number }>
  readonly error?: string
  readonly hint?: string
}

const api = {
  info: (): Promise<SeeuInfo> => ipcRenderer.invoke('seeu:info') as Promise<SeeuInfo>,
  onStatus: (callback: (status: SeeuStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: SeeuStatus): void => callback(status)
    ipcRenderer.on('seeu:status', listener)
    return () => ipcRenderer.removeListener('seeu:status', listener)
  },
  retry: (): void => { ipcRenderer.send('seeu:retry') },
  openLogs: (): void => { ipcRenderer.send('seeu:open-logs') },
  openWorkspace: (): void => { ipcRenderer.send('seeu:open-workspace') },
  openLocalModelSettings: (): void => { ipcRenderer.send('seeu:open-settings') },
  quit: (): void => { ipcRenderer.send('seeu:quit') },
  // ── 技能管理（技能管理器页面专用；导入由主进程弹原生选择框）──
  skillsList: (): Promise<SeeuSkillSummary[]> =>
    ipcRenderer.invoke('seeu:skills:list') as Promise<SeeuSkillSummary[]>,
  skillsImportFolder: (): Promise<SeeuSkillImportResult> =>
    ipcRenderer.invoke('seeu:skills:import-folder') as Promise<SeeuSkillImportResult>,
  skillsImportZip: (): Promise<SeeuSkillImportResult> =>
    ipcRenderer.invoke('seeu:skills:import-zip') as Promise<SeeuSkillImportResult>,
  skillsImportFolderOverwrite: (folder: string): Promise<SeeuSkillImportResult> =>
    ipcRenderer.invoke('seeu:skills:import-folder-overwrite', folder) as Promise<SeeuSkillImportResult>,
  skillsImportZipOverwrite: (zipPath: string): Promise<SeeuSkillImportResult> =>
    ipcRenderer.invoke('seeu:skills:import-zip-overwrite', zipPath) as Promise<SeeuSkillImportResult>,
  skillsRemove: (name: string): Promise<SeeuSkillImportResult> =>
    ipcRenderer.invoke('seeu:skills:remove', name) as Promise<SeeuSkillImportResult>,
  skillsOpenDir: (): void => { ipcRenderer.send('seeu:skills:open-dir') },
  onSkillsChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('seeu:skills-changed', listener)
    return () => ipcRenderer.removeListener('seeu:skills-changed', listener)
  },
  writeClipboard: (text: string): Promise<boolean> => ipcRenderer.invoke('seeu:clipboard:write', text) as Promise<boolean>,
  saveExport: (name: string, text: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }> =>
    ipcRenderer.invoke('seeu:file:save-export', { name, text }) as Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>,
  localModel: {
    get: (): Promise<LocalModelView> => ipcRenderer.invoke('seeu:local-model:get') as Promise<LocalModelView>,
    save: (config: unknown): Promise<LocalModelSaveResult> =>
      ipcRenderer.invoke('seeu:local-model:save', config) as Promise<LocalModelSaveResult>,
    preview: (
      config: unknown,
    ): Promise<{
      ok: boolean
      patch?: string
      error?: string
      warnings?: LocalModelWarning[]
      budget?: {
        preset: 'full' | 'lite'
        toolsCount: number
        fixedChars: number
        fixedTokens: number
        contextWindow: number
        remainingTokens: number
        conversationShare: number
      }
    }> =>
      ipcRenderer.invoke('seeu:local-model:preview', config) as Promise<{
        ok: boolean
        patch?: string
        error?: string
        warnings?: LocalModelWarning[]
        budget?: {
          preset: 'full' | 'lite'
          toolsCount: number
          fixedChars: number
          fixedTokens: number
          contextWindow: number
          remainingTokens: number
          conversationShare: number
        }
      }>,
    test: (probe: { baseURL?: string; apiKey?: string }): Promise<LocalModelProbeResult> =>
      ipcRenderer.invoke('seeu:local-model:test', probe) as Promise<LocalModelProbeResult>,
    warmup: (probe: { baseURL?: string; apiKey?: string; model?: string }): Promise<LocalModelWarmupResult> =>
      ipcRenderer.invoke('seeu:local-model:warmup', probe) as Promise<LocalModelWarmupResult>,
    diagnose: (probe: { baseURL?: string; apiKey?: string; model?: string }): Promise<LocalModelDiagnosis> =>
      ipcRenderer.invoke('seeu:local-model:diagnose', probe) as Promise<LocalModelDiagnosis>,
    disable: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('seeu:local-model:disable') as Promise<{ ok: boolean; path?: string; error?: string }>,
    disableAndRestart: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('seeu:local-model:disable-restart') as Promise<{ ok: boolean; path?: string; error?: string }>,
    probe: (): Promise<LocalModelProbeState | null> =>
      ipcRenderer.invoke('seeu:local-model:probe') as Promise<LocalModelProbeState | null>,
    onProbe: (callback: (probe: LocalModelProbeState | null) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, probe: LocalModelProbeState | null): void => callback(probe)
      ipcRenderer.on('seeu:local-model:probe', listener)
      return () => ipcRenderer.removeListener('seeu:local-model:probe', listener)
    },
    restart: (): void => { ipcRenderer.send('seeu:local-model:restart') },
    openFile: (): void => { ipcRenderer.send('seeu:local-model:open-file') },
  },
  // 本机取证工具路径：只支持手动指定（不自动发现）。
  lovelyTools: {
    get: (): Promise<LovelyToolsView> => ipcRenderer.invoke('seeu:lovely-tools:get') as Promise<LovelyToolsView>,
    pick: (tool: 'lovelymem' | 'lovelyspark'): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('seeu:lovely-tools:pick', tool) as Promise<{ ok: boolean; path?: string; canceled?: boolean }>,
    save: (paths: Partial<Record<'lovelymem' | 'lovelyspark' | 'lovelycarve', string>>): Promise<LovelyToolsSaveResult> =>
      ipcRenderer.invoke('seeu:lovely-tools:save', paths) as Promise<LovelyToolsSaveResult>,
  },
  // 镜像挂载：取证镜像 → 只读盘符（LovelyCarve CLI 常驻进程，关闭外壳释放）。
  mounts: {
    get: (): Promise<MountStatus> => ipcRenderer.invoke('seeu:mounts:get') as Promise<MountStatus>,
    pickImage: (): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('seeu:mounts:pick-image') as Promise<{ ok: boolean; path?: string; canceled?: boolean }>,
    inspect: (imagePath: string): Promise<ImageInspectResult> =>
      ipcRenderer.invoke('seeu:mounts:inspect', imagePath) as Promise<ImageInspectResult>,
    mount: (input: { imagePath: string; partition?: number; mountPoint?: string }): Promise<MountResult> =>
      ipcRenderer.invoke('seeu:mounts:mount', input) as Promise<MountResult>,
    unmount: (id: string): Promise<{ ok: boolean; error?: string; mounts?: MountRecord[] }> =>
      ipcRenderer.invoke('seeu:mounts:unmount', id) as Promise<{ ok: boolean; error?: string; mounts?: MountRecord[] }>,
    open: (mountPoint: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('seeu:mounts:open', mountPoint) as Promise<{ ok: boolean; error?: string }>,
  },
}

contextBridge.exposeInMainWorld('seeu', api)
