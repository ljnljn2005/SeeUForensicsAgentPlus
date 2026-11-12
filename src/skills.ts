/**
 * 把随包的取证技能（resources/forensics/skills/**）安装到 dsh 的「用户级技能根」。
 *
 * 为什么不用 overlay 里配 customSkillDirs：
 *   - `skill-filesystem` 的 customSkillDirs 会经 `path.resolve()` 解析，相对路径按
 *     dsh 子进程的 cwd（= 工作区）算，不是按 overlay 文件算；
 *   - 而绝对路径在「开发态=仓库根 / 安装态=安装目录 / 便携态=%TEMP% 解包目录」三种
 *     形态下都不同，静态 overlay 里写不出来。
 * dsh 的默认技能根之一就是 `<DSH_HOME>/skills`（见 dsh-skill-filesystem 的 roots()），
 * 所以外壳在启动 host 前把技能文件复制过去即可：默认根天然生效，不需要任何 patch，
 * 也不受安装位置影响。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appRoot, dshHome } from './paths.js'
import { SKILL_SET_IDS, installSkillSet, removeRetiredSkills, skillSetHomeDir, skillSetsHomeDir } from '../tools/skill-sets.mjs'

export { SKILL_SET_IDS, skillSetHomeDir, skillSetsHomeDir }

/** 随包技能目录（开发态=仓库 resources/，打包态=app.asar 内）。 */
export function bundledSkillsDir(): string {
  return join(appRoot(), 'resources', 'forensics', 'skills')
}

/** 随包分组技能目录：`resources/forensics/skill-sets/<id>`。 */
export function bundledSkillSetsDir(): string {
  return join(appRoot(), 'resources', 'forensics', 'skill-sets')
}

/** dsh 用户级技能根：`<DSH_HOME>/skills`。 */
export function userSkillsDir(): string {
  return join(dshHome(), 'skills')
}

function listFiles(dir: string, prefix = ''): Array<{ rel: string; abs: string }> {
  const out: Array<{ rel: string; abs: string }> = []
  let entries: string[]
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

export interface SkillsInstallResult {
  readonly dir: string
  readonly skills: string[]
  readonly files: number
  /** 本次是否真的写了文件（技能内容没变时为 false）。 */
  readonly changed: boolean
  /** 按预设分组的技能安装结果（流量/日志/内存）。 */
  readonly sets: Array<{ id: string; dir: string; skills: string[]; files: number; changed: boolean }>
  /** 本次从默认技能根清掉的旧技能（改为分组安装的技能）。 */
  readonly retired: string[]
}

/**
 * 幂等安装随包技能：内容相同则跳过；用 `installed.json` 记录版本与文件指纹。
 * 失败（例如安装目录只读、asar 读取异常）只返回空结果，不阻塞启动。
 */
export function installBundledSkills(version: string): SkillsInstallResult {
  const src = bundledSkillsDir()
  const dest = userSkillsDir()
  // 先装「按预设分组」的技能（流量/日志/内存），再清掉默认根里的旧分组技能。
  const sets = SKILL_SET_IDS.map((id) =>
    installSkillSet({ sourceDir: join(bundledSkillSetsDir(), id), homeDir: dshHome(), id, version }),
  )
  const retired = removeRetiredSkills(dshHome()).removed
  const result: SkillsInstallResult = { dir: dest, skills: [], files: 0, changed: false, sets, retired }
  if (!existsSync(src)) return result

  const markerPath = join(dest, '.seeu-skills.json')
  let installed: { version?: string; fingerprint?: string } = {}
  try {
    if (existsSync(markerPath)) installed = JSON.parse(readFileSync(markerPath, 'utf8')) as typeof installed
  } catch {
    // 坏标记当没装过
  }

  const files = listFiles(src)
  const fingerprint = `${version}:${files.map((f) => `${f.rel}:${statSync(f.abs).size}`).join(',')}`
  result.skills = [...new Set(files.map((f) => f.rel.split('/')[0]).filter((n) => n !== ''))]
  result.files = files.length
  if (installed.fingerprint === fingerprint) return result

  for (const file of files) {
    const target = join(dest, file.rel)
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, readFileSync(file.abs))
      result.changed = true
    } catch {
      return { ...result, changed: false }
    }
  }
  try {
    mkdirSync(dest, { recursive: true })
    writeFileSync(markerPath, JSON.stringify({ version, fingerprint, skills: result.skills, installedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
  } catch {
    // 标记写不了不影响本轮生效
  }
  return result
}
