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

export interface LocalModelProbeState {
  readonly ok: boolean
  readonly baseURL: string
  readonly models: string[]
  readonly error?: string
  readonly at: string
  readonly missing?: string[]
  /** 配置的上下文窗口超过网关自报能力时给出两者数值。 */
  readonly mismatch?: { configured: number; gateway: number }
}

export interface LocalModelView {
  readonly path: string
  readonly exists: boolean
  readonly config?: unknown
  readonly error?: string
  readonly probe?: LocalModelProbeState | null
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
  writeClipboard: (text: string): Promise<boolean> => ipcRenderer.invoke('seeu:clipboard:write', text) as Promise<boolean>,
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
}

contextBridge.exposeInMainWorld('seeu', api)
