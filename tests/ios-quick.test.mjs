import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  analyzeDeviceInfo,
  countPhotoImports,
  listAccounts,
  photoAssets,
  photoOrder,
  safariHistory,
  waCallStats,
  waLocations,
  waMembers,
  waSessions,
  wechatFinder,
  wechatWxids
} from '../tools/ios-quick.mjs'

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'ios-quick-'))
}

function createDb(file, sql) {
  const db = new DatabaseSync(file)
  db.exec(sql)
  db.close()
}

function setup() {
  const dir = makeDir()
  createDb(
    join(dir, 'Accounts3.sqlite'),
    `create table ZACCOUNT (ZUSERNAME text, ZACCOUNTTYPE integer);
     insert into ZACCOUNT values ('lingleung1502@gmail.com', 1), (null, 2);`
  )
  createDb(
    join(dir, 'Photos.sqlite'),
    `create table ZASSET (Z_PK integer primary key, ZFILENAME text, ZLATITUDE real, ZLONGITUDE real, ZDATECREATED real);
     create table ZADDITIONALASSETATTRIBUTES (ZASSET integer, ZIMPORTEDBYBUNDLEIDENTIFIER text, ZORIGINALFILENAME text);
     insert into ZASSET values (14,'IMG_0014.MOV',null,null,760000000);
     insert into ZASSET values (15,'IMG_0016.MOV',null,null,760000010);
     insert into ZASSET values (27,'IMG_0027.HEIC',22.2816569,114.1756115,766473142);
     insert into ZADDITIONALASSETATTRIBUTES values (15,'com.apple.mobileslideshow','IMG_0004.mov');
     insert into ZADDITIONALASSETATTRIBUTES values (27,'com.apple.mobilesafari',null);`
  )
  createDb(
    join(dir, 'History.db'),
    `create table history_items (id integer primary key, url text);
     create table history_visits (id integer primary key, item integer);
     insert into history_items(url) values ('https://example.com/a'), ('https://example.com/b');
     insert into history_visits(item) values (1),(2),(1);`
  )
  createDb(
    join(dir, 'ChatStorage.sqlite'),
    `create table ZWACHATSESSION (Z_PK integer primary key, ZPARTNERNAME text, ZCONTACTJID text, ZARCHIVED integer);
     create table ZWAGROUPMEMBER (ZCHATSESSION integer, ZMEMBERJID text, ZISADMIN integer, ZISACTIVE integer);
     create table ZWAMESSAGE (Z_PK integer primary key, ZCHATSESSION integer, ZMESSAGETYPE integer, ZMESSAGEDATE real);
     create table ZWAMEDIAITEM (ZMESSAGE integer, ZLATITUDE real, ZLONGITUDE real, ZMEDIAURL text);
     create table ZCALLRECORD (Z_PK integer primary key, ZSERVICE_PROVIDER text);
     insert into ZWACHATSESSION values (19,'Investors','120363417204753192@g.us',0);
     insert into ZWACHATSESSION values (2,'凤凰VIP','85263834763-1563607573@g.us',1);
     insert into ZWAGROUPMEMBER values (19,'85254974406@s.whatsapp.net',1,1);
     insert into ZWAGROUPMEMBER values (19,'85260927726@s.whatsapp.net',1,1);
     insert into ZWAGROUPMEMBER values (19,'85254961408@s.whatsapp.net',0,1);
     insert into ZWAMESSAGE values (1,19,5,760000000);
     insert into ZWAMEDIAITEM values (1,22.326923370361328,114.16840362548828,'https://foursquare.com/v/x');
     insert into ZCALLRECORD values (1,'net.whatsapp.WhatsApp');
     insert into ZCALLRECORD values (2,'net.whatsapp.WhatsApp');
     insert into ZCALLRECORD values (3,'com.apple.Phone');`
  )
  const wx = join(dir, 'Documents', 'hash')
  mkdirSync(join(wx, 'finder', 'db'), { recursive: true })
  createDb(
    join(wx, 'finder', 'db', 'finder_main.db'),
    `create table finderFollowingListTable (id integer primary key);
     create table finderWXContactExtDatasTable1 (name text);`
  )
  writeFileSync(join(wx, 'MM.sqlite'), 'sqlite fake wxid_zt3dtp69pc7v12 wxid_c9xyspglub7512')
  return { dir, wx }
}

test('analyzeDeviceInfo 提取 BuildVersion/IMEI/ICCID', () => {
  const info = analyzeDeviceInfo('BuildVersion: 21B91\nMobileEquipmentIdentifier: 35732809820522\nIntegratedCircuitCardIdentity: 89852122206020998419\nSIMOperatorName: CMCC_hk')
  assert.equal(info.buildVersion, '21B91')
  assert.equal(info.imeiBase, '35732809820522')
  assert.equal(info.iccid, '89852122206020998419')
  assert.equal(info.simOperator, 'CMCC_hk')
})

test('listAccounts 过滤空账号', () => {
  const { dir } = setup()
  try {
    const rows = listAccounts(join(dir, 'Accounts3.sqlite'))
    assert.deepEqual(rows, [{ username: 'lingleung1502@gmail.com', type: 1 }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('photoAssets 按名称取 GPS/导入来源/原名', () => {
  const { dir } = setup()
  try {
    const rows = photoAssets(join(dir, 'Photos.sqlite'), { name: 'IMG_0027' })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].lat, 22.2816569)
    assert.equal(rows[0].lon, 114.1756115)
    assert.equal(rows[0].importBundle, 'com.apple.mobilesafari')
    assert.equal(countPhotoImports(join(dir, 'Photos.sqlite'), 'com.apple.mobilesafari'), 1)
    const order = photoOrder(join(dir, 'Photos.sqlite'), ['IMG_0014.MOV', 'IMG_0016.MOV', 'IMG_0015.MOV'])
    assert.deepEqual(order.map((item) => item.pk), [14, 15, null])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('safariHistory 统计条目与访问次数', () => {
  const { dir } = setup()
  try {
    const out = safariHistory(join(dir, 'History.db'))
    assert.equal(out.items, 2)
    assert.equal(out.visits, 3)
    assert.equal(out.recent.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('waSessions/waMembers/waCallStats/waLocations', () => {
  const { dir } = setup()
  try {
    const db = join(dir, 'ChatStorage.sqlite')
    assert.equal(waSessions(db).length, 2)
    assert.deepEqual(waSessions(db, { archivedOnly: true }).map((s) => s.name), ['凤凰VIP'])
    const all = waMembers(db, '120363417204753192@g.us')
    assert.equal(all.members.length, 3)
    const admins = waMembers(db, '120363417204753192@g.us', { adminsOnly: true })
    assert.deepEqual(admins.members.map((m) => m.jid), ['85254974406@s.whatsapp.net', '85260927726@s.whatsapp.net'])
    assert.equal(waCallStats(db).whatsapp, 2)
    const loc = waLocations(db)
    assert.equal(loc.length, 1)
    assert.equal(loc[0].lat, 22.326923370361328)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('wechatFinder 报告关注数与表计数，wechatWxids 提取 wxid', () => {
  const { dir, wx } = setup()
  try {
    const finder = wechatFinder(wx)
    assert.equal(finder.available, true)
    assert.equal(finder.following, 0)
    assert.equal(finder.tables.finderFollowingListTable, 0)
    const wxids = wechatWxids(wx)
    assert.deepEqual(wxids.sort(), ['wxid_c9xyspglub7512', 'wxid_zt3dtp69pc7v12'])
    assert.equal(wechatFinder(join(dir, 'missing')).available, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
