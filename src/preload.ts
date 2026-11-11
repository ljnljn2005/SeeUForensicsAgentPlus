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
  quit: (): void => { ipcRenderer.send('seeu:quit') },
}

contextBridge.exposeInMainWorld('seeu', api)
