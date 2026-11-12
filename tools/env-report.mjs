/**
 * 运行环境体检：把「取证 Agent 到底能不能干活」需要的东西汇总成一张清单。
 *
 * 纯函数模块：宿主（`src/env-report.ts`）负责收集事实，这里只负责判定状态与文案，
 * 这样可以在单测里构造各种缺件场景，不必真的动文件系统或起进程。
 *
 * 状态约定：
 *   ok   —— 该项齐全，可以直接用；
 *   warn —— 缺一部分 / 依赖用户补配置，仍能跑但能力受限；
 *   fail —— 关键项不可用，会话里基本干不了这类活。
 */

export const ENV_REPORT_VERSION = 1

const STATUS_RANK = { ok: 0, warn: 1, fail: 2 }

/** 汇总状态：只要有 fail 就是 fail，否则有 warn 就是 warn。 */
export function worstStatus(items) {
  let worst = 'ok'
  for (const item of items ?? []) {
    const status = item?.status
    if (!(status in STATUS_RANK)) continue
    if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status
  }
  return worst
}

function item(key, label, status, detail, hint = '') {
  return { key, label, status, detail, ...(hint ? { hint } : {}) }
}

/** 外部工具：13 条路径里有多少条解析到了真实文件。 */
function toolsItem(tools) {
  const total = Number(tools?.total ?? 0)
  const ready = Number(tools?.ready ?? 0)
  const missing = Array.isArray(tools?.missing) ? tools.missing.filter(Boolean) : []
  if (total === 0) return item('tools', '外部工具路径', 'fail', '没有读取到工具清单（配置模块异常）')
  const detail = `${ready}/${total} 已就绪`
  if (ready === total) return item('tools', '外部工具路径', 'ok', detail)
  const short = missing.slice(0, 3).join('、')
  const more = missing.length > 3 ? ` 等 ${missing.length} 项` : ''
  return item(
    'tools',
    '外部工具路径',
    ready >= Math.ceil(total / 2) ? 'warn' : 'fail',
    `${detail}（缺：${short}${more}）`,
    '打开「设置 → 本地模型与工具路径」逐项指定，或确认对应软件已安装',
  )
}

/** 随包 dsh 插件：profile 里写了几个 bundle、哪些包实际找不到。 */
function pluginsItem(plugins) {
  const bundles = Number(plugins?.bundles ?? 0)
  const missing = Array.isArray(plugins?.missing) ? plugins.missing.filter(Boolean) : []
  if (bundles === 0) {
    return item('plugins', '随包 dsh 插件', 'warn', '会话 profile 里还没有插件清单（首次启动会自动补）')
  }
  const detail = `${bundles} 个 bundle${missing.length ? `，缺包 ${missing.slice(0, 3).join('、')}${missing.length > 3 ? '…' : ''}` : ''}`
  if (missing.length === 0) return item('plugins', '随包 dsh 插件', 'ok', detail)
  return item('plugins', '随包 dsh 插件', 'fail', detail, '重新启动外壳；仍缺则重装 SeeU（插件包需要随包复制到会话 profile）')
}

/** 技能：随包技能数 + 技能组数（traffic/log/memory/qiko 等）。 */
function skillsItem(skills) {
  const bundled = Number(skills?.bundled ?? 0)
  const sets = Array.isArray(skills?.sets) ? skills.sets.filter(Boolean) : []
  const installed = Number(skills?.installed ?? 0)
  if (bundled === 0) return item('skills', '取证技能', 'fail', '随包技能目录为空（安装不完整）')
  const setText = sets.length ? `，技能组 ${sets.length} 组（${sets.slice(0, 4).join(' / ')}${sets.length > 4 ? '…' : ''}）` : ''
  const installText = installed > 0 ? `，已安装 ${installed} 个到 DSH_HOME` : ''
  const status = installed > 0 ? 'ok' : 'warn'
  return item(
    'skills',
    '取证技能',
    status,
    `随包 ${bundled} 个技能${setText}${installText}`,
    installed > 0 ? '' : '重启外壳会把随包技能安装到 DSH_HOME/skills',
  )
}

/** 镜像挂载：LovelyCarve CLI 是否解析到。 */
function mountsItem(mounts) {
  if (!mounts) return item('mounts', '镜像挂载（LovelyCarve）', 'warn', '没有读取到挂载状态')
  if (mounts.found === false) {
    return item(
      'mounts',
      '镜像挂载（LovelyCarve）',
      'warn',
      mounts.error ? String(mounts.error) : '未找到 LovelyCarve CLI',
      '打开「设置 → 本机取证工具路径」选择 lovelycarve-cli.exe（在安装目录的 cli 子目录里）',
    )
  }
  const version = mounts.version ? ` ${mounts.version}` : ''
  const active = Number(mounts.active ?? 0)
  return item('mounts', '镜像挂载（LovelyCarve）', 'ok', `CLI${version} 可用${active > 0 ? `，当前 ${active} 个挂载` : ''}`)
}

/** MYOS MCP：超级取证大师的 MCP 服务端文件在不在。 */
function myosItem(myos) {
  if (!myos?.path) return item('myos', 'MYOS 取证结果（MCP）', 'warn', '未配置 MYOS MCP 服务端路径')
  if (!myos.found) {
    return item(
      'myos',
      'MYOS 取证结果（MCP）',
      'warn',
      `找不到 ${String(myos.path)}`,
      '确认「超级取证大师」已安装；或在环境变量 SEEU_MYOS_MCP 里指定 myos_mcp_server.exe 的绝对路径',
    )
  }
  return item('myos', 'MYOS 取证结果（MCP）', 'ok', `服务端就绪（${String(myos.path)}）`)
}

/** 索引：已登记的扫描目录里有多少能真正打开。 */
function indexDirsItem(indexDirs) {
  const total = Number(indexDirs?.total ?? 0)
  const existing = Number(indexDirs?.existing ?? 0)
  if (total === 0) {
    return item('indexDirs', '案件索引目录', 'warn', '还没有登记案件目录（首次建库或导入后会自动出现）')
  }
  const missing = Array.isArray(indexDirs?.missing) ? indexDirs.missing.filter(Boolean) : []
  const detail = `${existing}/${total} 个目录可访问${missing.length ? `，缺 ${missing.slice(0, 2).join('；')}${missing.length > 2 ? '…' : ''}` : ''}`
  return item('indexDirs', '案件索引目录', missing.length === 0 ? 'ok' : 'warn', detail)
}

/** 本机模型：配置存在且启用。 */
function localModelItem(localModel) {
  if (!localModel?.exists) {
    return item('localModel', '本机模型网关', 'warn', '还没有配置本机模型（当前会用默认云端模型）', '打开「设置 → 本地模型与工具路径」按 Spark 单机/双机预设填写')
  }
  if (localModel.error) {
    return item('localModel', '本机模型网关', 'fail', `配置读取失败：${localModel.error}`, '重新保存一次本地模型设置')
  }
  const config = localModel.config ?? {}
  const enabled = config.enabled !== false
  const models = Array.isArray(config.models) ? config.models.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean) : []
  const modelText = models.length ? models.join(', ') : '（未填模型）'
  if (!enabled) return item('localModel', '本机模型网关', 'warn', `已配置但被禁用（${modelText}）`)
  if (models.length === 0) {
    return item('localModel', '本机模型网关', 'warn', '已启用但没填模型 id', '在设置页填模型 id，或点「从网关拉取模型列表」')
  }
  return item('localModel', '本机模型网关', 'ok', `${modelText} · ${Number(config.contextWindow ?? 0) > 0 ? `${Math.round(Number(config.contextWindow) / 1024)}k 窗口` : '窗口未设置'}`)
}

/**
 * 生成体检报告。
 *
 * @param {object} facts 宿主收集到的事实（缺项按 warn/fail 处理，不会抛异常）。
 * @returns {{ok:boolean, version:number, checkedAt:string, summary:{total:number,ok:number,warn:number,fail:number,worst:string}, items:Array}}
 */
export function buildEnvReport(facts = {}, now = Date.now()) {
  const items = [
    pluginsItem(facts.plugins),
    skillsItem(facts.skills),
    toolsItem(facts.tools),
    localModelItem(facts.localModel),
    mountsItem(facts.mounts),
    myosItem(facts.myos),
    indexDirsItem(facts.indexDirs),
  ]
  const summary = { total: items.length, ok: 0, warn: 0, fail: 0, worst: 'ok' }
  for (const entry of items) summary[entry.status] += 1
  summary.worst = worstStatus(items)
  return {
    ok: summary.fail === 0,
    version: ENV_REPORT_VERSION,
    checkedAt: new Date(now).toISOString(),
    summary,
    items,
  }
}

/** 纯文本版（方便贴进聊天/报告；设置页用卡片渲染，不依赖这个）。 */
export function formatEnvReport(report) {
  const mark = { ok: '[OK]', warn: '[!]', fail: '[X]' }
  const lines = [`SeeU 环境体检 ${report?.checkedAt ?? ''}`]
  for (const entry of report?.items ?? []) {
    lines.push(`${mark[entry.status] ?? '[?]'} ${entry.label}：${entry.detail}`)
    if (entry.hint && entry.status !== 'ok') lines.push(`     → ${entry.hint}`)
  }
  const summary = report?.summary ?? { ok: 0, warn: 0, fail: 0 }
  lines.push(`合计：${summary.ok} 项正常 / ${summary.warn} 项注意 / ${summary.fail} 项不可用`)
  return lines.join('\n')
}

/** Markdown 版体检报告（用于「导出 .md」，比纯文本更适合留档/贴工单）。 */
export function envReportMarkdown(report) {
  const icon = { ok: '✓', warn: '!', fail: '×' }
  const summary = report?.summary ?? { ok: 0, warn: 0, fail: 0 }
  const lines = [
    '# SeeU 运行环境体检',
    '',
    `- 检查时间：${report?.checkedAt ?? ''}`,
    `- 合计：**${summary.ok} 项正常 / ${summary.warn} 项注意 / ${summary.fail} 项不可用**`,
    '',
    '| 项目 | 状态 | 详情 | 提示 |',
    '| --- | --- | --- | --- |',
  ]
  const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\|').replace(/\r?\n/g, ' ')
  for (const entry of report?.items ?? []) {
    const status = `${icon[entry.status] ?? '?'} ${entry.status ?? ''}`.trim()
    lines.push(`| ${escapeCell(entry.label)} | ${escapeCell(status)} | ${escapeCell(entry.detail)} | ${escapeCell(entry.status === 'ok' ? '' : entry.hint)} |`)
  }
  lines.push('')
  lines.push('> 由 SeeU 设置页「运行环境体检」生成；提示列给出可操作的下一步。')
  return lines.join('\n')
}
