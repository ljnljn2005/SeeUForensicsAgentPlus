/**
 * 技能上传：把用户给定的技能（文件夹 / ZIP 包）安装进 dsh 用户级技能根。
 *
 * 设计约束：
 *   - 本模块不 import electron，全部路径由调用方注入，方便脱离主进程单测。
 *   - ZIP 自己解析（中央目录 + zlib.inflateRawSync），不引第三方依赖、
 *     不 spawn PowerShell；条目名逐段消毒，杜绝 `..` / 绝对路径 / 盘符穿越。
 *   - dsh-skill-filesystem 默认 watch=true，写入 `<DSH_HOME>/skills/<name>` 后
 *     运行时自动失效重扫，新技能无需重启即可被 agent 发现。
 *
 * 技能契约（与 dsh-skill-filesystem 一致）：
 *   目录式技能 `<root>/<name>/SKILL.md`，frontmatter 至少含
 *   `name`（kebab-case）与 `description`。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

// ── 限制 ────────────────────────────────────────────────────────────────────

/** ZIP 包体上限（压缩后）。 */
export const MAX_ZIP_BYTES = 64 * 1024 * 1024
/** 单文件解压后上限。 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024
/** 全部文件解压后合计上限。 */
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024
/** 单个技能内文件数上限。 */
export const MAX_FILES = 2000

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

// ── 结果类型 ────────────────────────────────────────────────────────────────

export interface SkillSummary {
  readonly name: string
  readonly description: string
  /** true = 随包技能（应用启动时由外壳同步，不允许在此处卸载/覆盖）。 */
  readonly bundled: boolean
  readonly files: number
}

export type ImportErrorCode =
  | 'cancelled'
  | 'notFound'
  | 'notASkill'
  | 'badFrontmatter'
  | 'badName'
  | 'alreadyExists'
  | 'isBundled'
  | 'badZip'
  | 'tooLarge'
  | 'unsafeEntry'
  | 'ioError'

export interface ImportResult {
  readonly ok: boolean
  readonly code?: ImportErrorCode
  readonly message?: string
  /** 成功时给出安装后的技能名与文件数。 */
  readonly skill?: SkillSummary
}

const fail = (code: ImportErrorCode, message: string): ImportResult => ({ ok: false, code, message })

// ── frontmatter 解析（够用即可：name/description 单行标量） ──────────────────

export function parseSkillFrontmatter(skillMd: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd)
  if (m === null) return {}
  const body = m[1]
  const pick = (key: string): string | undefined => {
    const r = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(body)
    if (r === null) return undefined
    return r[1].replace(/^["']|["']$/g, '')
  }
  const name = pick('name')
  const description = pick('description')
  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
  }
}

// ── ZIP 解析（stored + deflate，拒绝 ZIP64/加密/分卷） ────────────────────────

interface ZipEntry {
  /** 以 `/` 分隔、已规范化的相对路径。 */
  readonly name: string
  readonly method: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localHeaderOffset: number
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD 固定 22 字节 + 最长 65535 字节注释；从尾部倒扫签名 0x06054b50。
  const min = Math.max(0, buf.length - (22 + 65535))
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf)
  if (eocd < 0) throw new Error('不是有效的 ZIP（找不到中央目录结尾记录）')
  const diskNo = buf.readUInt16LE(eocd + 4)
  const cdDisk = buf.readUInt16LE(eocd + 6)
  if (diskNo !== 0 || cdDisk !== 0) throw new Error('不支持分卷 ZIP')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('不支持 ZIP64')

  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('ZIP 中央目录损坏')
    }
    const method = buf.readUInt16LE(p + 10)
    const flags = buf.readUInt16LE(p + 8)
    if ((flags & 0x1) !== 0) throw new Error('不支持加密 ZIP')
    const compressedSize = buf.readUInt32LE(p + 20)
    const uncompressedSize = buf.readUInt32LE(p + 24)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('不支持 ZIP64')
    }
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localHeaderOffset = buf.readUInt32LE(p + 42)
    // 通用标志位 bit11 = UTF-8；未置位时按 GBK 之外的事实标准处理：
    // Windows 资源管理器/PowerShell 产出多为 UTF-8 或 CP437，取证技能名
    // 规范要求 kebab-case ASCII，非 UTF-8 名称会在后续校验中被拒。
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 条目路径消毒：返回规范化相对路径；不安全时返回 null。 */
export function sanitizeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/')
  if (name === '' || name.startsWith('/') || name.endsWith('/')) return null
  if (/^[a-zA-Z]:\//.test(name)) return null
  const segments = name.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return null
    // Windows 非法字符 + 控制字符；段尾点/空格在 NTFS 上会被吃掉，也拒。
    if (/[<>:"|?*\x00-\x1f]/.test(seg)) return null
    if (/[. ]$/.test(seg)) return null
  }
  return segments.join('/')
}

export interface ZipFile {
  readonly path: string
  readonly data: Buffer
}

export function extractZip(buf: Buffer): ZipFile[] {
  if (buf.length > MAX_ZIP_BYTES) throw new Error(`ZIP 超过 ${MAX_ZIP_BYTES / 1024 / 1024} MB 上限`)
  const entries = readCentralDirectory(buf)
  const files: ZipFile[] = []
  let total = 0
  for (const entry of entries) {
    const safe = sanitizeEntryName(entry.name)
    if (safe === null) {
      if (entry.name.endsWith('/')) continue // 目录条目
      throw new Error(`不安全的条目路径：${entry.name}`)
    }
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error(`不支持的压缩方式 method=${String(entry.method)}（${entry.name}）`)
    }
    if (entry.uncompressedSize > MAX_FILE_BYTES) {
      throw new Error(`单文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB：${entry.name}`)
    }
    total += entry.uncompressedSize
    if (total > MAX_TOTAL_BYTES) throw new Error(`解压总量超过 ${MAX_TOTAL_BYTES / 1024 / 1024} MB`)
    if (files.length >= MAX_FILES) throw new Error(`文件数超过 ${String(MAX_FILES)}`)

    const lh = entry.localHeaderOffset
    if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) {
      throw new Error('ZIP 本地文件头损坏')
    }
    const nameLen = buf.readUInt16LE(lh + 26)
    const extraLen = buf.readUInt16LE(lh + 28)
    const dataStart = lh + 30 + nameLen + extraLen
    const raw = buf.subarray(dataStart, dataStart + entry.compressedSize)
    if (raw.length !== entry.compressedSize) throw new Error('ZIP 数据截断')
    const data = entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw)
    if (data.length !== entry.uncompressedSize) throw new Error(`解压长度不符：${entry.name}`)
    files.push({ path: safe, data })
  }
  return files
}

// ── 技能校验与安装 ───────────────────────────────────────────────────────────

interface LocatedSkill {
  /** 剥离包装目录后的相对路径 → 内容。 */
  readonly files: ZipFile[]
  readonly skillMd: string
}

/**
 * 定位 SKILL.md：允许 ZIP/文件夹根即技能根，或恰好一层包装目录
 * （GitHub 下载的 zip 常见结构 `<repo>-<branch>/SKILL.md`）。
 */
function locateSkill(files: ZipFile[]): LocatedSkill | null {
  const at = files.find((f) => f.path === 'SKILL.md')
  if (at !== undefined) return { files, skillMd: at.data.toString('utf8') }
  const depth1 = files.filter((f) => /^[^/]+\/SKILL\.md$/.test(f.path))
  const wrappers = [...new Set(depth1.map((f) => f.path.split('/')[0]))]
  if (wrappers.length !== 1) return null
  const prefix = `${wrappers[0]}/`
  const stripped = files
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ path: f.path.slice(prefix.length), data: f.data }))
    .filter((f) => f.path !== '')
  const md = stripped.find((f) => f.path === 'SKILL.md')
  if (md === undefined) return null
  return { files: stripped, skillMd: md.data.toString('utf8') }
}

function readFolderFiles(root: string, prefix = ''): ZipFile[] {
  const out: ZipFile[] = []
  for (const name of readdirSync(root)) {
    const abs = join(root, name)
    const rel = prefix === '' ? name : `${prefix}/${name}`
    const st = statSync(abs)
    if (st.isDirectory()) out.push(...readFolderFiles(abs, rel))
    else if (st.isFile()) {
      if (st.size > MAX_FILE_BYTES) throw new Error(`单文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB：${rel}`)
      out.push({ path: rel, data: readFileSync(abs) })
      if (out.length > MAX_FILES) throw new Error(`文件数超过 ${String(MAX_FILES)}`)
    }
  }
  return out
}

function writeSkill(destRoot: string, name: string, files: ZipFile[]): number {
  const dir = join(destRoot, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let written = 0
  for (const f of files) {
    const target = join(dir, ...f.path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, f.data)
    written++
  }
  return written
}

export interface ImportOptions {
  /** 用户级技能根（<DSH_HOME>/skills）。 */
  readonly userSkillsDir: string
  /** 随包技能名集合（这些名字拒绝覆盖/卸载）。 */
  readonly bundledNames: ReadonlySet<string>
  /** 覆盖同名用户技能。 */
  readonly overwrite?: boolean
}

function installLocated(located: LocatedSkill, opts: ImportOptions): ImportResult {
  const fm = parseSkillFrontmatter(located.skillMd)
  if (fm.name === undefined || fm.description === undefined) {
    return fail('badFrontmatter', 'SKILL.md frontmatter 必须包含 name 与 description')
  }
  if (!SKILL_NAME_RE.test(fm.name)) {
    return fail('badName', `技能名 "${fm.name}" 非法：必须 kebab-case（小写字母/数字/连字符，≤64 字符）`)
  }
  if (opts.bundledNames.has(fm.name)) {
    return fail('isBundled', `"${fm.name}" 与随包技能同名，请改名后再导入（随包技能由应用统一升级）`)
  }
  const dest = join(opts.userSkillsDir, fm.name)
  if (existsSync(dest) && opts.overwrite !== true) {
    return fail('alreadyExists', `已存在同名技能 "${fm.name}"，确认覆盖后重试`)
  }
  try {
    const files = writeSkill(opts.userSkillsDir, fm.name, located.files)
    return {
      ok: true,
      skill: { name: fm.name, description: fm.description, bundled: false, files },
    }
  } catch (error) {
    return fail('ioError', `写入失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 从文件夹导入（所选目录必须直接含 SKILL.md；也容忍一层包装目录）。 */
export function importSkillFolder(folder: string, opts: ImportOptions): ImportResult {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    return fail('notFound', `目录不存在：${folder}`)
  }
  let files: ZipFile[]
  try {
    files = readFolderFiles(folder)
  } catch (error) {
    return fail('tooLarge', error instanceof Error ? error.message : String(error))
  }
  if (files.length === 0) return fail('notASkill', '目录为空')
  const located = locateSkill(files)
  if (located === null) return fail('notASkill', '未找到 SKILL.md（应位于所选目录根部，或仅隔一层包装目录）')
  return installLocated(located, opts)
}

/** 从 ZIP 包导入。 */
export function importSkillZip(zipPath: string, opts: ImportOptions): ImportResult {
  if (!existsSync(zipPath)) return fail('notFound', `文件不存在：${zipPath}`)
  let files: ZipFile[]
  try {
    files = extractZip(readFileSync(zipPath))
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return fail(msg.startsWith('不安全') ? 'unsafeEntry' : 'badZip', msg)
  }
  if (files.length === 0) return fail('badZip', 'ZIP 内没有文件')
  const located = locateSkill(files)
  if (located === null) return fail('notASkill', 'ZIP 内未找到 SKILL.md（允许根目录或一层包装目录）')
  return installLocated(located, opts)
}

/** 列出用户级技能根下的全部技能（随包 + 用户导入）。 */
export function listInstalledSkills(userSkillsDir: string, bundledDir: string): SkillSummary[] {
  const bundledNames = new Set<string>()
  if (existsSync(bundledDir)) {
    for (const name of readdirSync(bundledDir)) {
      if (existsSync(join(bundledDir, name, 'SKILL.md'))) bundledNames.add(name)
    }
  }
  const out: SkillSummary[] = []
  if (!existsSync(userSkillsDir)) return out
  for (const name of readdirSync(userSkillsDir)) {
    const dir = join(userSkillsDir, name)
    const md = join(dir, 'SKILL.md')
    try {
      if (!statSync(dir).isDirectory() || !existsSync(md)) continue
      const fm = parseSkillFrontmatter(readFileSync(md, 'utf8'))
      out.push({
        name: fm.name ?? name,
        description: fm.description ?? '',
        bundled: bundledNames.has(fm.name ?? name),
        files: readFolderFiles(dir).length,
      })
    } catch {
      // 单个技能读坏了不影响列表
    }
  }
  out.sort((a, b) => Number(b.bundled) - Number(a.bundled) || a.name.localeCompare(b.name))
  return out
}

/** 卸载用户导入的技能；随包技能拒绝卸载。 */
export function removeInstalledSkill(userSkillsDir: string, name: string, bundledNames: ReadonlySet<string>): ImportResult {
  if (!SKILL_NAME_RE.test(name)) return fail('badName', `非法技能名：${name}`)
  if (bundledNames.has(name)) return fail('isBundled', `"${name}" 是随包技能，不能卸载`)
  const dir = join(userSkillsDir, name)
  if (!existsSync(dir)) return fail('notFound', `技能不存在：${name}`)
  try {
    rmSync(dir, { recursive: true, force: true })
    return { ok: true }
  } catch (error) {
    return fail('ioError', `删除失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 随包技能名集合。 */
export function bundledSkillNames(bundledDir: string): Set<string> {
  const names = new Set<string>()
  if (!existsSync(bundledDir)) return names
  for (const name of readdirSync(bundledDir)) {
    if (existsSync(join(bundledDir, name, 'SKILL.md'))) names.add(name)
  }
  return names
}
