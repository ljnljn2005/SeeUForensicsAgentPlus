/**
 * SeeU Forensics Agent Plus — 品牌与产品常量。
 *
 * 只放"外壳层"品牌信息（窗口/托盘/菜单/关于框/加载页）。
 * 通信与运行时相关的产品标识见 paths.ts / host.ts。
 */

export const PRODUCT_NAME = 'SeeUForensicsAgentPlus'

/** 中文展示名，用于窗口标题、关于框、欢迎页。 */
export const PRODUCT_DISPLAY_NAME = 'SeeU 取证智能体增强版'

export const APP_ID = 'com.seeu.forensicsagentplus'

/** Windows 应用用户模型 ID（任务栏分组/通知归属）。 */
export const APP_USER_MODEL_ID = APP_ID

export const COLORS = {
  background: '#0B1220',
  surface: '#111C31',
  accent: '#22D3EE',
  accentSoft: '#164E63',
  text: '#E2E8F0',
  textMuted: '#94A3B8',
  danger: '#F87171',
} as const

/** 默认取证工作区目录名（位于"文档"下）。 */
export const WORKSPACE_DIR_NAME = 'SeeUForensicsWorkspace'

/** 运行时子进程对外暴露的标记，供取证 overlay / 技能判断当前处于桌面版。 */
export const DESKTOP_MARKER_ENV = 'SEEU_FORENSICS_DESKTOP'
