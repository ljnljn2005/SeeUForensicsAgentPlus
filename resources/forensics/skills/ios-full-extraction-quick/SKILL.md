---
name: ios-full-extraction-quick
description: iOS 全量提取（火眼已展开的 zip/tar）速查：先用一个 iDevice_info.txt 回答系统版本/IMEI/ICCID/蓝牙等设备题，再按路径找 WiFi、已装应用、Safari 历史、IM 数据；适用于「手机全量提取」(type=pf) 检材。命令统一用 bash（Git Bash），仅当 bash 不可用才降级 pwsh。
---

# iOS 全量提取速查（Fireeye 展开目录）

## 使用前提
- 检材是手机**全量提取**（火眼 `evidence.type=pf`），索引里通常只有元数据（`recordCount` 远小于 `reportedRecordCount`）。
- 检材定位顺序：① `$SEEU_INDEX_API` 的 `/evidences` 看 `mountRoute`/`mountPoint` → ② 直接翻火眼只读挂载（虚拟路径 `/evidence_mounts/eid-N/`，本机目录一般 `C:/hlnet/<eid>-<hash>/`）→ ③ 没有挂载入口才用 LovelyCarve 挂镜像 → ④ 最后才碰 `W:/` 原始压缩包（禁止整份解压）。
- 挂载根下通常是 `<检材名>.tar/`（例如 `C:/hlnet/4-1793357718/CHAN_MH_mobile.tar/`）。

## 第一步：设备信息（一个文件解决大半设备题）
```bash
M="C:/hlnet/4-1793357718/CHAN_MH_mobile.tar"
grep -E "^(BuildVersion|ProductVersion|ProductType|DeviceClass|IntegratedCircuitCardIdentity|InternationalMobileSubscriberIdentity|MobileEquipmentIdentifier|BluetoothAddress|EthernetAddress|SerialNumber|UniqueDeviceID)" "$M/iDevice_info.txt"
```
- `BuildVersion: 21B91` → iOS **17.1.1`（对照型号表或题目选项；21B91 即 17.1.1）。
- `IntegratedCircuitCardIdentity` = **ICCID**（15–20 位，常直接就是答案）。
- `MobileEquipmentIdentifier` = **MEID**（14 位）；**IMEI = MEID 前 14 位 + Luhn 校验位**（本套题 `35732809820522` → `357328098205226`）。
- `InternationalMobileSubscriberIdentity` = IMSI；`BluetoothAddress`/`EthernetAddress` = 蓝牙/WiFi MAC。

## 第二步：WiFi 历史（没有连接过哪个 SSID）
```bash
python - <<'PY'
import plistlib
base='C:/hlnet/4-1793357718/CHAN_MH_mobile.tar'
p=base+'/var/preferences/com.apple.wifi.known-networks.plist'
with open(p,'rb') as f: d=plistlib.load(f)
print('\n'.join(k.replace('wifi.network.ssid.','') for k in d if k.startswith('wifi.network.ssid.')))
PY
```
- 已知网络在 **`var/preferences/com.apple.wifi.known-networks.plist`**，键形如 `wifi.network.ssid.<SSID>`；隐藏网络也会出现（`Hidden=True`）。
- 也看 `var/preferences/SystemConfiguration/com.apple.wifi-private-mac-networks.plist`（`SSID_STR`、`lastJoined`）。
- 判断「没有连接过」：选项 SSID 不在上面列表里即可；不要拿运营商名（CMHK 等）当 SSID。

## 第三步：已安装应用（IM / 浏览器 / 文件传输）
```bash
ls "$M/var/mobile/Applications" | sed 's/\.app$//'
```
- 常见包名：WhatsApp `net.whatsapp.WhatsApp`、WeChat `com.tencent.xin`、WhatsApp Business `net.whatsapp.WhatsAppSMB`、QQ `com.tencent.mqq`、Telegram `ph.telegra.Telegraph`、Chrome `com.google.chrome.ios`、Firefox `org.mozilla.ios.Firefox`、Edge `com.microsoft.msedge`。
- 「文件传输软件」对应 `com.apple.Sharing.AirDropUI`、`com.lenovo.anyshare`、`com.estmob.paprika` 等。

## 第四步：Safari 历史/搜索词
- 数据库：`var/mobile/Library/Safari/History.db`（WAL 模式，**直接只读打开会 `unable to open database file`**）。
```bash
mkdir -p .dev/ios-copy && cp "$M/var/mobile/Library/Safari/History.db"* .dev/ios-copy/
node - <<'JS'
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync('.dev/ios-copy/History.db', { readOnly: true })
for (const r of db.prepare("select i.url, v.title from history_visits v join history_items i on i.id=v.history_item order by v.visit_time desc limit 200").all()) {
  if (/search\?|q=/.test(r.url||'')) console.log(decodeURIComponent(String(r.title||'')))
}
db.close()
JS
```
- 搜索词在 `history_items.url` 的 `q=` 里，`title` 常是「xxx - Google Search」。

## 第五步（前置）：文件传输类应用（AirDrop / SHAREit / Send Anywhere）
```bash
A="$M/var/mobile/Applications"
ls "$A" | grep -E "estmob|anyshare|Sharing"
ls "$A/com.estmob.paprika/Documents" "$A/com.lenovo.anyshare/Documents"
```
- **Send Anywhere**（`com.estmob.paprika`）：
  - `Library/SendAnywhere.sqlite`：`ZTRANSFERHISTORY`（`ZDIDRECEIVE` 0/1、`ZTRANSFERTYPE`、`ZFIRSTFILENAME`、`ZDATE`、`ZCOUNTOFFILES`）+ `ZTRANSFERFILE`（逐文件 `ZNAME`/`ZITEMTYPE`/`ZSIZEOFDATA`）——但常见情况这张表为空（历史只留在 Realm）。
  - `Library/com.estmob.sendanywhere.sdk.database.realm`（Realm 二进制，不能当 SQLite 打开）：`strings -n 5` 可读到 `deviceName`/`peerDeviceId`/`transferMode`/`sentTime`、对端设备名（如 `Samsung SM-G930F`）和传输过的文件名（如 `Screenshot_20250423-105307_Gallery.jpg`）——**判断用过哪个传输软件、传了什么的最快证据**。
- **SHAREit**（`com.lenovo.anyshare`）：`Documents/.shareit/{shareit,downloader,contacts,adcs}.db`；`shareit.db` 有 `transfer`/`file` 表（传过东西才有行）。
- **AirDrop**：`com.apple.Sharing.AirDropUI` 无数据目录；`var/mobile/Library/Preferences/com.apple.sharingd.plist` 只有 AirDropID/哈希（**没有成功传输清单**）；AirDrop 成功痕迹更多在相册/文件中转（`PhotoData`、`Documents`）或设备日志，不要只凭 sharingd.plist 下结论。
- 只读：先 `cp` 到 `$SEEU_WORKSPACE` 再解析；WAL 库连同 `-wal`/`-shm` 一起复制。
- **判断「发送方/接收方」的三条硬线索**：① 文件名风格（Android 截图 `Screenshot_YYYYMMDD-HHMMSS_Gallery.jpg` vs iOS `IMG_xxxx.PNG`/`IMG_xxxx.MOV`）；② Realm/DB 里的对端设备名（`Samsung SM-G930F`、`HUAWEI …`）；③ 文件落在谁的本机容器（`.../Application/<UUID>/Documents/...` 属于本机 App 就是收到，反之可能是发出后残留的记录）。
- **Photos.sqlite 只代表「照片」App 里的资产**：收到的文件未必进相册（在 App 容器里），别用「相册里没有」去否定接收。


## 相册 / 照片库（Photos.sqlite 秒答「谁生成的、先后顺序」）
```bash
P="$M/var/mobile/Media/PhotoData/Photos.sqlite"; mkdir -p .dev/ios-copy/p && cp "$P"* .dev/ios-copy/p/
node - <<'JS'
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync('.dev/ios-copy/p/Photos.sqlite', { readOnly: true })
// 某文件由哪个 App 生成/导入（WPS、Infltr、Snapseed、AirDrop 等）
console.log(db.prepare(`select a.ZFILENAME fn, x.ZIMPORTEDBYBUNDLEIDENTIFIER bid, x.ZIMPORTEDBYDISPLAYNAME name, x.ZEXIFTIMESTAMPSTRING exif
  from ZASSET a left join ZADDITIONALASSETATTRIBUTES x on x.ZASSET=a.Z_PK where a.ZFILENAME like 'IMG_%' limit 20`).all())
// 顺序类问题：Z_PK 与 ZADDEDDATE 是「入库顺序」，FILENAME 只是显示名（可被改）
console.log(db.prepare(`select Z_PK pk, ZFILENAME fn, ZDATECREATED dc, ZADDEDDATE ad, ZHIDDEN hid, ZTRASHEDDATE tr
  from ZASSET order by Z_PK limit 30`).all())
db.close()
JS
```
- `ZIMPORTEDBYBUNDLEIDENTIFIER` 直接给出生成/导入 App（如 `com.Yooshr.Infltr` = Infltr）。
- 「两个文件之间有没有别的文件」看 **`Z_PK` 是否连续** + `ZADDEDDATE` 排序，不要只看文件名编号（Trust 文件名可能跳号/被改）。
- 隐藏/回收站：`ZHIDDEN=1`、`ZTRASHEDDATE` 非空；也要看 `DCIM/100APPLE` 目录里实际是否存在同名文件。

## 第六步：IM 数据（WhatsApp/微信）
- WhatsApp：`var/mobile/Applications/net.whatsapp.WhatsApp/`（`Documents/` 下 `ChatStorage.sqlite`，媒体在 `Library/Media/` 或 `Message/Media/`；数据库可能是 WAL，同样先复制）。
- 微信：`var/mobile/Applications/com.tencent.xin/Documents/`（`MM.sqlite`、`WCDB_Contact.sqlite`；新版可能拆分库）。
- 以上只做只读复制后解析，不修改挂载目录。

## 输出与红线
- 比武模式：`Q<n>｜答案｜思路`；事实与推断分开；命中只是线索要回查原文。
- 原件只读；不整份解压原始 zip/E01；不执行未知样本；无管理员/授权不做动态分析。

## WhatsApp 题速查（ChatStorage.sqlite）
- 群名/群 ID：`ZWACHATSESSION`（`ZCONTACTJID like '%@g.us'`、`ZPARTNERNAME`）；**封存群** = `ZARCHIVED=1`。
- 成员数：`ZWAGROUPMEMBER where ZCHATSESSION=? and ZISACTIVE=1`；管理员 = `ZISADMIN=1`。
- 位置消息：`ZWAMESSAGE.ZMESSAGETYPE=5` → `ZWAMEDIAITEM` 的 `ZLATITUDE`/`ZLONGITUDE`、`ZMEDIAURL`（foursquare 链接）。
- 通话记录在 `var/mobile/Library/CallHistoryDB/CallHistory.storedata` 的 `ZCALLRECORD`（`ZSERVICE_PROVIDER` 含 `net.whatsapp.WhatsApp`；iOS 时间 = unix-978307200）。
- 群头像哈希：`Media/Profile/<jid>-<ts>.jpg` 直接 sha256 与选项比对；社群（community）看 session 描述含 “This community is…”。
- 群消息正文：`ZWAMESSAGE.ZTEXT`；`ZISFROMME=1` 才是本机发出。

## 微信（WeChat）题速查
- 数据目录：`var/mobile/Applications/com.tencent.xin/Documents/<hash>/`（全量提取）或 `Documents/<hash>/`（备份），DB 目录含 `MM.sqlite`（Friend/Friend_Ext/RevokeMsgTable/RoomHistory 等）、`WCDB_Contact.sqlite`（Friend/MassSendContact/OpenIMContact）、`message_1..4.sqlite`（`Chat_<hash>`/`ChatExt2_<hash>` 分表）、`WCDB_OpLog.sqlite`、`fts/fts_message.db`。
- 本案例库为**明文 SQLite**（非 SQLCipher），可直接 `node:sqlite` 只读打开；先 `select name from sqlite_master` 看表。
- 视频号（Channels）：`Documents/<hash>/finder/db/finder_main.db` 的 `finderFollowingListTable`（关注列表，空表=没关注）、`finder_main.aff.db`（feed/profile/contact/comment_list）、`FinderMsg/MsgSessionStatus.db`；全 0 行时答案就是「（无内容）」。
- 本机 wxid 判定：备份文件名 `com.tencent.xin.backupinfo.wxid_<id>.crc` 指该备份所属账号；同机多个 wxid 时结合 `fts_message.db`/`WCDB_Contact` 关系判断。

## 快速命令（优先用 CLI，少写脚本）
题干问到账号/相册/Safari/WhatsApp/微信时，直接用随包脚本（只读）：

```bash
node scripts/ios-quick.mjs device  <iDevice_info.txt>
node scripts/ios-quick.mjs accounts <Accounts3.sqlite>
node scripts/ios-quick.mjs photos  <Photos.sqlite> --name IMG_0027
node scripts/ios-quick.mjs order   <Photos.sqlite> IMG_0014.MOV IMG_0016.MOV
node scripts/ios-quick.mjs safari  <History.db>
node scripts/ios-quick.mjs wa-sessions <ChatStorage.sqlite> [--archived]
node scripts/ios-quick.mjs wa-members  <ChatStorage.sqlite> <jid> [--admins]
node scripts/ios-quick.mjs wa-calls    <CallHistory.storedata>
node scripts/ios-quick.mjs wa-locations <ChatStorage.sqlite>
node scripts/ios-quick.mjs wechat  <Documents/<hash>>
```

工作区运行时（dev/preview）也可 `npm run ios:quick -- <子命令…>`。脚本缺失时按本技能里的 SQL 手查。
