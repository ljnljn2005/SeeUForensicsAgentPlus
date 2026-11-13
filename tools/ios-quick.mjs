// iOS 取证速查（纯函数 + 只读 SQLite），供 scripts/ios-quick.mjs 与单测使用。
// 目标：把美亚杯一类题目里最常问的几类事实（账号、相册、Safari、WhatsApp、微信）一键取出。
import { existsSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export function openDb(file) {
  return new DatabaseSync(file, { readOnly: true })
}

export function analyzeDeviceInfo(text) {
  const read = (key) => {
    const match = new RegExp(`${key}\\s*[:=]\\s*(.+)`, 'i').exec(text || '')
    return match ? match[1].trim() : ''
  }
  return {
    buildVersion: read('BuildVersion'),
    productType: read('ProductType'),
    productVersion: read('ProductVersion'),
    imeiBase: read('MobileEquipmentIdentifier'),
    iccid: read('IntegratedCircuitCardIdentity'),
    simOperator: read('SIMOperatorName')
  }
}

// ---- 账号（Accounts3.sqlite） ----
export function listAccounts(dbFile) {
  const db = openDb(dbFile)
  try {
    return db
      .prepare('select ZUSERNAME as username, ZACCOUNTTYPE as type from ZACCOUNT order by ZUSERNAME')
      .all()
      .filter((row) => row.username)
      .map((row) => ({ username: row.username, type: row.type }))
  } finally {
    db.close()
  }
}

// ---- 相册（Photos.sqlite） ----
export function photoAssets(dbFile, { name, limit = 20 } = {}) {
  const db = openDb(dbFile)
  try {
    const where = name ? "where a.ZFILENAME like ? escape '\\'" : ''
    const sql = `
      select a.Z_PK as pk, a.ZFILENAME as fileName, a.ZLATITUDE as lat, a.ZLONGITUDE as lon,
             a.ZDATECREATED as createdAt, x.ZIMPORTEDBYBUNDLEIDENTIFIER as importBundle,
             x.ZORIGINALFILENAME as originalFileName
      from ZASSET a left join ZADDITIONALASSETATTRIBUTES x on x.ZASSET = a.Z_PK
      ${where}
      order by a.Z_PK limit ?`
    const params = name ? [`%${String(name).replaceAll('%', '\\%')}%`, limit] : [limit]
    return db.prepare(sql).all(...params)
  } finally {
    db.close()
  }
}

export function photoOrder(dbFile, names) {
  const db = openDb(dbFile)
  try {
    const stmt = db.prepare('select Z_PK as pk, ZFILENAME as fileName from ZASSET where ZFILENAME = ? limit 1')
    return (names || []).map((fileName) => {
      const row = stmt.get(fileName)
      return { fileName, exists: Boolean(row), pk: row ? row.pk : null }
    })
  } finally {
    db.close()
  }
}

export function countPhotoImports(dbFile, bundleId) {
  const db = openDb(dbFile)
  try {
    const row = db
      .prepare('select count(*) as n from ZADDITIONALASSETATTRIBUTES where ZIMPORTEDBYBUNDLEIDENTIFIER = ?')
      .get(bundleId)
    return row ? row.n : 0
  } finally {
    db.close()
  }
}

// ---- Safari（History.db） ----
export function safariHistory(dbFile, { limit = 10 } = {}) {
  const db = openDb(dbFile)
  try {
    const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name)
    const out = { tables }
    if (tables.includes('history_items')) out.items = db.prepare('select count(*) as n from history_items').get().n
    if (tables.includes('history_visits')) out.visits = db.prepare('select count(*) as n from history_visits').get().n
    if (tables.includes('history_items')) {
      out.recent = db
        .prepare('select url from history_items order by id desc limit ?')
        .all(limit)
        .map((r) => r.url)
    }
    return out
  } finally {
    db.close()
  }
}

// ---- WhatsApp（ChatStorage.sqlite） ----
export function waSessions(dbFile, { archivedOnly = false } = {}) {
  const db = openDb(dbFile)
  try {
    const where = archivedOnly ? 'where ZARCHIVED = 1' : ''
    return db
      .prepare(
        `select Z_PK as pk, ZPARTNERNAME as name, ZCONTACTJID as jid, ZARCHIVED as archived
         from ZWACHATSESSION ${where} order by Z_PK`
      )
      .all()
  } finally {
    db.close()
  }
}

export function waMembers(dbFile, jid, { adminsOnly = false } = {}) {
  const db = openDb(dbFile)
  try {
    const session = db.prepare('select Z_PK as pk, ZPARTNERNAME as name from ZWACHATSESSION where ZCONTACTJID = ? limit 1').get(jid)
    if (!session) return { session: null, members: [] }
    const where = adminsOnly ? 'and ZISADMIN = 1' : ''
    const members = db
      .prepare(
        `select ZMEMBERJID as jid, ZISADMIN as admin, ZISACTIVE as active
         from ZWAGROUPMEMBER where ZCHATSESSION = ? ${where}`
      )
      .all(session.pk)
    return { session, members }
  } finally {
    db.close()
  }
}

export function waCallStats(dbFile, { whatsappOnly = true } = {}) {
  const db = openDb(dbFile)
  try {
    if (!db.prepare("select name from sqlite_master where type='table' and name='ZCALLRECORD'").get()) {
      return { supported: false, total: 0, whatsapp: 0 }
    }
    const total = db.prepare('select count(*) as n from ZCALLRECORD').get().n
    const whatsapp = whatsappOnly
      ? db.prepare("select count(*) as n from ZCALLRECORD where ZSERVICE_PROVIDER like '%whatsapp%'").get().n
      : total
    return { supported: true, total, whatsapp }
  } catch {
    return { supported: false, total: 0, whatsapp: 0 }
  } finally {
    db.close()
  }
}

export function waLocations(dbFile) {
  const db = openDb(dbFile)
  try {
    return db
      .prepare(
        `select m.ZCHATSESSION as session, m.ZMESSAGEDATE as sentAt, i.ZLATITUDE as lat,
                i.ZLONGITUDE as lon, i.ZMEDIAURL as mediaUrl
         from ZWAMESSAGE m join ZWAMEDIAITEM i on i.ZMESSAGE = m.Z_PK
         where m.ZMESSAGETYPE = 5
         order by m.ZMESSAGEDATE`
      )
      .all()
  } finally {
    db.close()
  }
}

// ---- 微信（Documents/<hash>） ----
export function wechatFinder(dir) {
  const dbFile = `${dir}/finder/db/finder_main.db`
  if (!existsSync(dbFile)) return { available: false, following: 0, tables: {} }
  const db = openDb(dbFile)
  try {
    const names = db
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .map((r) => r.name)
    const counts = {}
    for (const name of names) {
      try {
        counts[name] = db.prepare(`select count(*) as n from "${name}"`).get().n
      } catch {
        counts[name] = -1
      }
    }
    const following = counts.finderFollowingListTable ?? 0
    return { available: true, following, tables: counts }
  } finally {
    db.close()
  }
}

export function wechatWxids(dir) {
  const found = new Set()
  const files = ['MM.sqlite', 'WCDB_Contact.sqlite', 'message_1.sqlite', 'fts/fts_message.db']
  for (const rel of files) {
    const file = `${dir}/${rel}`
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file).toString('latin1')
      for (const match of text.matchAll(/wxid_[a-z0-9]{4,}/g)) found.add(match[0])
    } catch {
      // 忽略不可读文件
    }
  }
  return [...found]
}

export function summarizeIos({ device, accounts, photos, safari, whatsapp, wechat }) {
  const lines = []
  if (device) lines.push(`设备：${device.productType || '?'} · ${device.buildVersion || '?'} · SIM ${device.simOperator || '?'}`)
  if (accounts && accounts.length) lines.push(`账号：${accounts.map((a) => a.username).join(', ')}`)
  if (photos && photos.length) lines.push(`相册：${photos.length} 条匹配（示例 ${photos[0].fileName}）`)
  if (safari) lines.push(`Safari：${safari.items ?? 0} 条历史 / ${safari.visits ?? 0} 次访问`)
  if (whatsapp) lines.push(`WhatsApp：${whatsapp.sessions ?? 0} 个会话 / 通话 ${whatsapp.calls?.whatsapp ?? 0}`)
  if (wechat) lines.push(`微信：关注视频号 ${wechat.following ?? 0} 个 / wxid ${(wechat.wxids || []).join('、') || '无'}`)
  return lines.join('\n')
}
