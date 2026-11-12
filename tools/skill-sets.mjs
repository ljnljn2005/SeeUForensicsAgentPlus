/**
 * 技能分组安装（纯 Node，可被 node:test 直接单测）。
 *
 * 背景：随包技能原本全量装进 `<DSH_HOME>/skills`（dsh 的默认用户级技能根），
 * 所有预设都能看到。现在要「按预设注入不同 CLI 技能」：
 *   - 取证预设：<DSH_HOME>/skills（默认根，含 ges-case-index / lovelycarve-forensics 等）
 *   - 流量分析 / 日志分析：<DSH_HOME>/skill-sets/traffic、<DSH_HOME>/skill-sets/log（lovelyspark-cli）
 *   - 内存分析：<DSH_HOME>/skill-sets/memory（starmem-cli 主用；lovelymem-cli 兜底）
 *   - 取证/流量/手机/数据与研判：额外的 Qiko 技能组 <DSH_HOME>/skill-sets/qiko
 *     （从 QikoAgent 迁移并做过 SeeU 工具链适配的技能，比武比赛用）
 * 各个预设的 `skill-filesystem` 通过 `customSkillDirs` 指向自己那组技能根，
 * 默认根仍保留（案件索引技能所有预设都要用）。
 *
 * 为什么装到 <DSH_HOME> 而不是在 overlay 里写死仓库路径：
 *   开发态/安装态/便携态三种形态的资源路径不同，静态 overlay 写不出来；
 *   而 <DSH_HOME> 永远是 dsh 的默认技能根，装过去即可，不依赖安装位置。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 独立技能组的目录名（与 resources/forensics/skill-sets/<id> 对应）。 */
export const SKILL_SET_IDS = ['traffic', 'log', 'memory', 'qiko']

/** 曾经装在 <DSH_HOME>/skills 下、现在改为按预设分组的技能（升级时要清掉，避免取证预设还看得到）。 */
export const RETIRED_SKILL_DIRS = ['lovelymem-cli', 'lovelyspark-cli']

/** `<DSH_HOME>/skill-sets` */
export function skillSetsHomeDir(homeDir) {
  return join(homeDir, 'skill-sets')
}

/** `<DSH_HOME>/skill-sets/<id>` */
export function skillSetHomeDir(homeDir, id) {
  return join(skillSetsHomeDir(homeDir), id)
}

function listFiles(dir, prefix = '') {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const abs = join(dir, name)
    const rel = prefix === '' ? name : `${prefix}/${name}`
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) out.push(...listFiles(abs, rel))
    else out.push({ rel, abs })
  }
  return out
}

/**
 * 把一组技能从随包目录复制到 `<DSH_HOME>/skill-sets/<id>`（幂等，体积小）。
 * @returns {{id: string, dir: string, skills: string[], files: number, changed: boolean}}
 */
export function installSkillSet({ sourceDir, homeDir, id, version = '' }) {
  const dest = skillSetHomeDir(homeDir, id)
  const result = { id, dir: dest, skills: [], files: 0, changed: false }
  if (!existsSync(sourceDir)) return result

  const markerPath = join(dest, '.seeu-skill-set.json')
  let installed = {}
  try {
    if (existsSync(markerPath)) installed = JSON.parse(readFileSync(markerPath, 'utf8'))
  } catch {
    // 坏标记当没装过
  }

  const files = listFiles(sourceDir)
  const fingerprint = `${version}:${id}:${files.map((f) => `${f.rel}:${statSync(f.abs).size}`).join(',')}`
  result.skills = [...new Set(files.map((f) => f.rel.split('/')[0]).filter((n) => n !== ''))]
  result.files = files.length
  if (installed.fingerprint === fingerprint) return result

  for (const file of files) {
    const target = join(dest, file.rel)
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, readFileSync(file.abs))
    } catch {
      return result
    }
  }
  try {
    mkdirSync(dest, { recursive: true })
    writeFileSync(markerPath, JSON.stringify({ version, id, fingerprint, skills: result.skills, installedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
  } catch {
    // 标记写不了不影响本轮生效
  }
  result.changed = true
  return result
}

/** 从 `<DSH_HOME>/skills` 删除已改成分组安装的旧技能目录。 */
export function removeRetiredSkills(homeDir) {
  const root = join(homeDir, 'skills')
  const removed = []
  for (const name of RETIRED_SKILL_DIRS) {
    const dir = join(root, name)
    if (!existsSync(dir)) continue
    try {
      rmSync(dir, { recursive: true, force: true })
      removed.push(name)
    } catch {
      // 被占用时下次启动再试
    }
  }
  return { removed }
}
