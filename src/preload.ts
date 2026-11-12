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
}

contextBridge.exposeInMainWorld('seeu', api)
