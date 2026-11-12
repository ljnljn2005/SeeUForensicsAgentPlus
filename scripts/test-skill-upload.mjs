// 对 skill-upload.ts 的独立验证（node 直跑，不依赖 electron）。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname as _dn } from 'node:path'
const HERE = _dn(fileURLToPath(import.meta.url))
buildSync({ entryPoints: [join(HERE, '..', 'src', 'skill-upload.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(HERE, '..', 'dist', 'test-skill-upload.cjs'), logLevel: 'warning' })
const su = await import('../dist/test-skill-upload.cjs')

const T = join(HERE, '..', 'dist', 'su-test-tmp')
rmSync(T, { recursive: true, force: true })
mkdirSync(T, { recursive: true })
const USER = join(T, 'skills')
const BUNDLED = join(T, 'bundled')

let pass = 0, fail = 0
function chk(label, cond) {
  if (cond) { pass++; console.log('PASS', label) }
  else { fail++; console.log('FAIL', label) }
}

// 造随包技能（同名拒绝用）
mkdirSync(join(BUNDLED, 'bundled-skill'), { recursive: true })
writeFileSync(join(BUNDLED, 'bundled-skill', 'SKILL.md'), '---\nname: bundled-skill\ndescription: bundled\n---\n')
const bundledNames = su.bundledSkillNames(BUNDLED)
chk('bundledSkillNames 找到随包技能', bundledNames.has('bundled-skill'))

// 1) 真实技能文件夹直导
const srcFolder = join(HERE, '..', 'resources', 'forensics', 'skills', 'lovelycarve-forensics')
let r = su.importSkillFolder(srcFolder, { userSkillsDir: USER, bundledNames })
chk('文件夹导入成功', r.ok && r.skill.name === 'lovelycarve-forensics' && r.skill.files >= 5)
chk('落盘 SKILL.md 存在', existsSync(join(USER, 'lovelycarve-forensics', 'SKILL.md')))
chk('落盘 references 存在', existsSync(join(USER, 'lovelycarve-forensics', 'references', 'recipes.md')))

// 2) 同名重复导入 → alreadyExists；带 overwrite → 成功
r = su.importSkillFolder(srcFolder, { userSkillsDir: USER, bundledNames })
chk('重复导入报 alreadyExists', !r.ok && r.code === 'alreadyExists')
r = su.importSkillFolder(srcFolder, { userSkillsDir: USER, bundledNames, overwrite: true })
chk('overwrite 覆盖成功', r.ok)

// 3) 随包同名拒绝
const fakeBundled = join(T, 'fake-bundled')
mkdirSync(fakeBundled, { recursive: true })
writeFileSync(join(fakeBundled, 'SKILL.md'), '---\nname: bundled-skill\ndescription: fake\n---\n')
r = su.importSkillFolder(fakeBundled, { userSkillsDir: USER, bundledNames, overwrite: true })
chk('随包同名 isBundled 拒绝', !r.ok && r.code === 'isBundled')

// 4) 坏 frontmatter
const bad = join(T, 'bad')
mkdirSync(bad, { recursive: true })
writeFileSync(join(bad, 'SKILL.md'), '---\nname: Bad_Name\n---\n')
r = su.importSkillFolder(bad, { userSkillsDir: USER, bundledNames })
chk('缺 description 报 badFrontmatter', !r.ok && r.code === 'badFrontmatter')
writeFileSync(join(bad, 'SKILL.md'), '---\nname: Bad_Name\ndescription: x\n---\n')
r = su.importSkillFolder(bad, { userSkillsDir: USER, bundledNames })
chk('非 kebab-case 报 badName', !r.ok && r.code === 'badName')

// 5) 无 SKILL.md
const empty = join(T, 'empty')
mkdirSync(empty, { recursive: true })
writeFileSync(join(empty, 'a.txt'), 'x')
r = su.importSkillFolder(empty, { userSkillsDir: USER, bundledNames })
chk('无 SKILL.md 报 notASkill', !r.ok && r.code === 'notASkill')

// 6) 真 ZIP（PowerShell Compress-Archive，一层包装目录）
const zip1 = join(T, 'skill1.zip')
execFileSync('powershell', ['-NoProfile', '-Command',
  `Compress-Archive -Path '${srcFolder}' -DestinationPath '${zip1}' -Force`], { stdio: 'pipe' })
r = su.importSkillZip(zip1, { userSkillsDir: USER, bundledNames, overwrite: true })
chk('包装 ZIP 导入成功', r.ok && r.skill.name === 'lovelycarve-forensics')

// 7) 恶意 ZIP（路径穿越）
import { deflateRawSync } from 'node:zlib'
function mkZip(entries) {
  // 手工构造最小 zip：local headers + central directory + eocd
  const chunks = []; const centrals = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const data = e.store ? Buffer.from(e.data) : deflateRawSync(Buffer.from(e.data))
    const raw = Buffer.from(e.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6)
    lh.writeUInt16LE(e.store ? 0 : 8, 8)
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    chunks_push(lh, nameBuf, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(e.store ? 0 : 8, 10)
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([ch, nameBuf]))
    offset += 30 + nameBuf.length + data.length
  }
  function chunks_push(...bufs) { for (const b of bufs) chunks.push(b) }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cd, eocd])
}
const evil = mkZip([{ name: 'evil-skill/SKILL.md', data: '---\nname: evil-skill\ndescription: x\n---\n' }, { name: 'evil-skill/../../evil.txt', data: 'pwn' }])
writeFileSync(join(T, 'evil.zip'), evil)
r = su.importSkillZip(join(T, 'evil.zip'), { userSkillsDir: USER, bundledNames })
chk('穿越 ZIP 被拒绝', !r.ok)
chk('没有写出 evil.txt', !existsSync(join(T, 'evil.txt')))

// 8) 正常手工 ZIP（stored + deflate 混合）
const good = mkZip([
  { name: 'mini-skill/SKILL.md', data: '---\nname: mini-skill\ndescription: 迷你技能\n---\n# body\n' },
  { name: 'mini-skill/references/r.md', data: '参考内容'.repeat(100) },
  { name: 'mini-skill/stored.txt', data: 'plain', store: true },
])
writeFileSync(join(T, 'good.zip'), good)
r = su.importSkillZip(join(T, 'good.zip'), { userSkillsDir: USER, bundledNames })
chk('手工 ZIP（stored+deflate）导入成功', r.ok && r.skill.name === 'mini-skill' && r.skill.files === 3)
chk('stored 文件内容正确', readFileSync(join(USER, 'mini-skill', 'stored.txt'), 'utf8') === 'plain')
chk('deflate 中文文件正确', readFileSync(join(USER, 'mini-skill', 'references', 'r.md'), 'utf8').startsWith('参考内容'))

// 9) 列表与卸载（用户根下应只有 lovelycarve-forensics + mini-skill；随包在另一目录）
const list = su.listInstalledSkills(USER, BUNDLED)
chk('列表含 2 个用户根技能', list.length === 2)
chk('列表含 mini-skill 与 lovelycarve-forensics', list.some(s => s.name === 'mini-skill') && list.some(s => s.name === 'lovelycarve-forensics'))
r = su.removeInstalledSkill(USER, 'mini-skill', bundledNames)
chk('卸载用户技能成功', r.ok && !existsSync(join(USER, 'mini-skill')))
r = su.removeInstalledSkill(USER, 'bundled-skill', bundledNames)
chk('卸载随包技能被拒', !r.ok && r.code === 'isBundled')
r = su.removeInstalledSkill(USER, '../etc', bundledNames)
chk('卸载非法名被拒', !r.ok && r.code === 'badName')

// 10) 损坏 ZIP
writeFileSync(join(T, 'broken.zip'), Buffer.from('not a zip at all'))
r = su.importSkillZip(join(T, 'broken.zip'), { userSkillsDir: USER, bundledNames })
chk('坏 ZIP 报 badZip', !r.ok && r.code === 'badZip')

console.log(`PASS=${pass} FAIL=${fail}`)
process.exit(fail === 0 ? 0 : 1)
