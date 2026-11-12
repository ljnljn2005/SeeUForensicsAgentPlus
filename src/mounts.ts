/**
 * 镜像挂载接口（主进程侧单例）。
 *
 * 取证镜像（E01/RAW/VMDK/VHDX/QCOW2…）不能被 Windows 直接当目录浏览，
 * 需要 LovelyCarve CLI 的 `mounts` 命令组挂成只读盘符；而它的挂载点只在
 * CLI 进程存活期间有效，所以外壳必须自己起一个常驻 CLI 进程，并在退出时释放。
 *
 * 细节见 `tools/image-mount.mjs`（纯 Node，主进程与 e2e 共用）。
 */

import { createMountManager } from '../tools/image-mount.mjs'

export { createMountManager, mountsFile, mountCaseDir, resolveLovelyCarveCli } from '../tools/image-mount.mjs'

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

export interface UnmountResult {
  readonly ok: boolean
  readonly error?: string
  readonly mounts?: MountRecord[]
}

/** 进程级单例：常驻 CLI 进程 + 挂载清单都挂在它身上。 */
export const mountManager = createMountManager({
  env: () => process.env,
  log: (message: string) => {
    // 复用主进程的 shell 日志（main.ts 通过 setMountLogger 注入，避免循环依赖）。
    mountLogger(message)
  },
})

let mountLogger: (message: string) => void = () => {}

export function setMountLogger(logger: (message: string) => void): void {
  mountLogger = logger
}

/** 下发给 dsh 子进程的环境：告诉会话里的技能「挂载清单在哪」。 */
export function mountHostEnv(): NodeJS.ProcessEnv {
  return mountManager.hostEnv()
}
