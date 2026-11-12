# App 与系统痕迹经验库

本文件沉淀手机题常见数据位置和字段，不保存具体题目答案。遇到平台无答案、App 专项题、题目需要回源时使用。

## 通用回源路由

- **设备标识符**：回源系统配置、设备信息库、备份清单、telephony/subscriber、硬件标识字段；区分 IMEI/IMEI2/MEID/ICCID/IMSI/序列号/Android ID/广告 ID/MAC/UUID。
- **App 版本**：回源 package metadata、AndroidManifest、Info.plist、安装包信息；区分显示版本、内部版本、versionName、versionCode、BundleShortVersionString、BundleVersion。
- **统计题**：回源原始记录表或文件集合，先确定时间范围、方向、对象、去重规则、是否包含缓存/删除/缩略图/重复附件，再计数。
- **时间题**：回源原始时间戳，记录单位、时区和字段含义；区分创建、修改、发送、接收、导入、服务器拉取和后台访问时间。
- **媒体题**：回源原图 EXIF、媒体库、文件路径、hash、尺寸、asset id、缩略图关系；区分截图、缓存图、导出图、云同步图和原图。
- **聊天题**：回源消息表、会话表、联系人表、附件表、方向字段和 WAL/SHM；验证发送方、接收方、会话 id、消息类型和附件路径。
- **浏览器题**：回源 History、Tabs、Bookmarks、Downloads、WebView/Cache；区分访问记录、标签页、书签、下载记录和页面缓存。
- **删除题**：回源删除标记、recovered 表、旧库、WAL/SHM、freelist、缓存和残留附件；说明是逻辑删除、恢复残留还是缓存证据。

## 未知 App 通用六步

1. 确认包名、Bundle ID、版本和数据根目录，区分主容器、App Group、外部存储和导出目录。
2. 枚举 `databases`、`shared_prefs`、`files`、`cache`、`Documents`、`Library`、`Preferences` 等目录。
3. 先看 SQLite schema、表名、索引、字段名，再按题干关键词、账号、时间、文件名、URL、坐标、金额等搜索。
4. 识别时间字段、方向字段、对象字段、删除标记、附件路径和状态字段，必要时检查 WAL/SHM、旧库和备份副本。
5. 对加密、压缩、Protobuf、MMKV、LevelDB、JSON/XML 内嵌结构先做结构识别，再抽取关键字段。
6. 用文件内容、截图、通知、缓存、EXIF、系统库或其他 App 记录交叉验证，形成最短证据链后停止。

## 备份与系统结构定位

- **iOS 备份**：先看 `Manifest.db`，用 `domain`、`relativePath`、`fileID` 定位真实文件；常见域包括 `AppDomain-<bundle id>`、`AppDomainGroup-*`、`CameraRollDomain`、`HomeDomain`、`SysContainerDomain-*`。平台路径、导出路径和备份哈希文件名要映射回同一个原始文件。
- **iOS App 容器**：主容器常在 `Documents`、`Library`、`Library/Preferences`、`Library/Caches`；共享数据常在 App Group。账号、会话、WebKit 缓存、推送和附件可能分散在不同容器。
- **Android 镜像/备份**：优先定位 `/data/data/<package>/`、`/data/user/<userId>/<package>/`、`/sdcard/Android/data/<package>/`、`/sdcard/Android/media/<package>/`、`obb` 和多用户目录；不要把外部缓存当成唯一原始证据。
- **跨容器映射**：同一图片、附件或数据库副本可能同时存在于 App 私有目录、外部存储、系统媒体库和平台导出目录，按 hash、大小、时间、asset id 和源路径去重。

## 应用使用痕迹与时间线

- **Android 使用痕迹**：查 `usagestats`、`packages.xml`、安装/更新时间、`notification`/通知库、launcher 数据、`appops`、最近任务和系统日志，区分用户主动打开、后台拉取、安装升级和取证后访问。
- **iOS 使用痕迹**：查 `KnowledgeC.db`、Biome、Screen Time、SpringBoard、通知和应用容器修改时间。`KnowledgeC.db` 与 Screen Time 更适合证明使用行为，不直接等同业务事件。
- **时间线拼接**：平台没有“最后使用/最近访问/何时发生”答案时，按系统使用痕迹、App 原始事件、文件时间、通知时间、媒体时间交叉排序，优先提交能被业务表或系统库共同支持的时间。

## WebView 与网页缓存

- **Android WebView**：常见目录包括 `app_webview/Default`、`databases`、`Local Storage`、`IndexedDB`、`Session Storage`、`Service Worker/CacheStorage`、`Cookies`、`Network/Cookies`。
- **iOS WebKit**：查 App 容器或 App Group 下的 WebKit、Cookies、LocalStorage、IndexedDB、Cache 和 `Library/Safari` 类目录。
- **网页证据分层**：Cookies/Local Storage 可证明登录或状态，History/Cache 可证明访问线索，IndexedDB/Service Worker Cache 可能保存页面业务数据；需要结合题干区分“浏览过”“登录过”“下载过”“内容是什么”。

## 位置与地图

- **坐标系**：常见为 WGS84、GCJ-02、BD-09；国内地图 App 或小程序可能使用 GCJ-02/BD-09，照片 EXIF 通常偏 WGS84。选项坐标接近但不闭合时，考虑坐标系转换。
- **证据含义**：地图缓存位置、搜索地点、路线点、Wi-Fi 地理位置、照片 GPS、聊天位置消息和设备实际到达位置不是同一概念。按题干问法选择证据，不要把缓存点当真实轨迹。
- **复核字段**：位置题优先保留经纬度字段名、坐标系判断、时间字段、地点名称和来源 App/系统库。

## 私有格式与降级路径

- **常见格式**：SQLCipher、MMKV、Protobuf、Realm、Binary Plist、LevelDB、压缩 JSON、Base64、XOR/轻量混淆、序列化对象。
- **先识别再解析**：看文件头、magic、扩展名、字符串、schema、相邻配置和 App 代码引用；能用现有工具解析就解析，不能解析时不要硬猜字段。
- **拿不到 key 或格式暂不可解**：查平台摘要、缓存、通知、截图、附件、搜索索引、WebView 存储、导出副本、WAL/SHM、旧库和系统时间线，记录“主库不可解”和已用降级证据。

## iOS 备份/镜像

- **容器判断**：`.zip` 不一定是真 iTunes 备份；若平台要求密码但目录结构更像文件集合，应改用文件夹/文件集合方式分析。
- **设备与账号**：优先平台设备信息；回源看 Accounts、Preferences、iCloud 配置、`Contents.db` 类聚合库。
- **Wi-Fi**：`/var/preferences/com.apple.wifi.known-networks.plist` 可含 SSID、BSSID、首次连接时间 `AddedAt` 和地理位置字段。
- **照片**：`Photos.sqlite` 常看 `ZASSET`；Live Photo 可筛 `ZUNIFORMTYPEIDENTIFIER='public.heic'` 且 `ZVIDEOCPDURATIONVALUE != 0`。
- **Safari**：查 History、Bookmarks、Downloads；搜索词可能在 URL query、title 或 keyword 表里。
- **AirDrop/传输**：查平台传输记录和对应 App 数据；注意方向、本机设备 ID、对端设备 ID、文件名、传输模式。

## Android 镜像/导出目录

- **系统版本/Build**：平台设备信息优先；回源查 `build.prop`，路径可能是 `/build.prop`、`/system/build.prop` 或 vendor/product 相关位置。
- **设备/SIM**：查 telephony/subscriber/system profile、平台 SIM、`Contents.db` 类聚合结果；IMEI 与 App 层 ID 分开。
- **App 沙盒**：常见结构为 `/data/data/<package>/databases`、`shared_prefs`、`files`、`cache`，外部目录在 `/sdcard/Android/data/<package>/`。
- **媒体**：查 `MediaStore`、DCIM、Pictures、Screenshots、App 私有媒体目录；截图和缓存图片也可能是答案证据。
- **照片库文件**：部分 Android 检材中照片记录可落在 `external.db`，平台媒体结果可用于跳转源数据库。

## WhatsApp

- **账号/版本**：平台账号和应用列表优先；账号常为手机号/JID，版本题区分显示版本和内部版本。
- **iOS 群组/消息**：`/var/mobile/Applications/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`。
- **封存群组**：`ZWACHATSESSION.ARCHIVED=1` 表示聊天被存档/封存。
- **已登录设备**：`DeviceAgents.sqlite` 的 `ZWASMBDEVICEAGENT` 可记录多设备登录信息。
- **群组 JID**：旧格式 `<建立者手机号>-<建立时间 Unix>@g.us` 可辅助判断创建者和创建时间；群主可能已转移，不能等同创建者。
- **头像**：`Media/Profile/` 常保存头像文件；头像文件名可能含群 ID 和上传时间戳。
- **位置/附件/PDF/视频**：先看平台消息、通话、附件；回源查 message/media 表和附件目录，必要时打开 PDF/字幕/视频文件验证内容。
- **Android 消息类型**：`msgstore.db` 中 `message_type` 可用于判断 sticker、图片、文件等消息类型；用消息接收/发送时间转时间戳后回表筛选更快。
- **iOS 消息方向/时间**：`ChatStorage.sqlite` 中 `ZMESSAGEDATE` 是消息创建时间，`ZISFROMME=1` 通常代表机主发送；`ZMESSAGEDATE` 需按 Cocoa Core Time/UTC 规则换算。

## Facebook

- **群组/社群**：平台社交结果优先；Facebook 里的群组概念可能在界面或数据中写作 Community，不一定出现 Group。
- **上传照片**：Android Facebook 上传历史可能在 `/data/com.facebook.katana/app_uploads/`；每个子目录可对应上传媒体。
- **媒体数据库**：`/data/com.facebook.katana/databases/local_media_db` 可辅助确认上传/本地媒体统计。
- **统计口径**：上传目录、hash 去重和数据库记录可能给出不同数量；统计题要说明口径并防止直接套选项。

## WeChat / 微信

- **账号**：平台账号优先；回源常看 `com.tencent.mm_preferences.xml`、账号库、登录缓存。
- **消息**：常见 `EnMicroMsg.db`、`MM.sqlite`、消息表、联系人表、附件目录；用 wxid、手机号、talker、会话 id 交叉确认。
- **视频号**：`finder_main.db` 的 `finderContactTable3.followState=1` 可用于筛已关注视频号；平台缓存数量不等于关注数量。
- **删除/撤回**：查平台删除项、WAL/SHM、旧库、删除标记和附件残留，说明来源。

## Telegram

- **验证码**：优先平台短信；回源查 `Contents.db`、SMS/MMS、通知记录，验证发送方、应用名和接收时间。
- **UserID/账号**：平台账号优先；回源查 App 配置、用户表、会话库和缓存。

## Chrome / Safari / Gmail / 云盘

- **浏览器搜索**：History 的 URL query、title、keyword/search terms 都可能含搜索词。
- **书签/下载**：Bookmarks、Downloads、文件系统路径共同验证。
- **Gmail/Google Drive**：平台账号优先；回源查 Chrome/Gmail/Drive 配置、同步日志、通知和缓存页面。
- **账号分层**：系统账号、浏览器登录账号、App 账号、邮件账号不要混用。

## Foodpanda / 外卖订单

- **包名定位**：先从 App 列表确认包名，例如 `com.global.foodpanda.android`，再进入 App 沙盒。
- **订单/购物车**：常见数据库在 `/data/com.global.foodpanda.android/databases/`，重点看 `cart-db`、`order-db`。
- **使用时间**：`pandora.db.perseus` 等埋点/用户信息库可能含服务器获取信息时间戳；数据库修改时间可能只是后台访问或取证后联网造成。
- **付款方式**：购物车或订单详情比平台摘要更可靠；要保留字段来源。

## Line / 其他即时通讯

- **跨 App 搜索**：案情人物可能同时出现在 WhatsApp、Line、Telegram 等多个 IM；题干有别名、人名或地点时应跨 App 搜索。
- **聊天内容**：平台聊天结果优先；平台无答案时回源消息库、附件、缓存和通知记录。

## APK / Android RAT

- **静态入口**：查 `AndroidManifest.xml`、resources、layout XML、`smali/` 或 `classes.dex`。
- **无 classes.dex**：若 APK 没有 `classes.dex`，不要直接判异常结束；检查是否已反编译为 smali 结构。
- **权限与能力**：围绕录音、截图、文件读取、C2 通信、服务/广播接收器定位功能。
- **C2/网络**：在 smali、字符串、配置文件中搜 host、port、URL、socket、sendReq 等关键词。

## Photos / Media / EXIF

- **数量题**：先定统计口径：拍摄时间、导入时间、创建时间、文件修改时间、是否包含截图/缓存/重复。
- **坐标题**：优先原始 EXIF 和媒体库 GPS；注意 WGS84、经纬顺序、小数位、时区。
- **同图判断**：比较 hash、尺寸、EXIF、asset id、缩略图关系和文件路径。
- **导出图/截图**：截图可作内容证据，但通常不能回答真实拍摄设备、镜头、GPS。
- **iOS 截图来源**：`Photos.sqlite` 中可结合 `ZASSET` 与 `ZCLOUDMASTER`/来源字段判断，`SpringBoard` 常提示系统截图。

## Xiaomi Home / 米家

- **账号/家庭/房间**：平台米家结果优先；平台缺字段时回源 `/data/com.xiaomi.smarthome/shared_prefs/home_room_manager_sp_.xml`。
- **XML 内嵌 JSON**：`home_room_content` 需反转义和 JSON 美化后看 `homelist`、`roomlist`、`dids`。
- **设备与 did**：平台可能漏设备；全局搜索 did，常可在 MMKV/JSON 中找到设备详情。
- **事件与通知**：`databases/onetrack`、通知记录、App 日志可用于事件统计；统计题必须说明口径。
- **插件目录**：米家插件文件可能在 `files/plugin/install/rn/<plugin-id>/data/<did>/files/`，如清扫图片、轨迹文件等。

## 健康 / 运动 · 机主账号

- **平台优先**：凡问健康/运动 App 机主账号、UID、登录账号（含「小米账号 ID」且语境为运动健康）→ 先 `fl_search` / 结果树：`运动健康` / `健康` / `*运动` → `机主账号` / `账户` / USER 类节点；命中后答案出处写平台路径。
- **回源**：平台无行或需复核时，进目标包 `shared_prefs` / MMKV；用 `myos-plugin-mobile` 的 `getMMKVValuefromKey` / `getMMKVdict`，勿对 MMKV 二进制做明文 `strings` 当唯一解。
- **交叉印证**：同厂商账号体系其它 App（画报、云服务、桌面等）可印证 UID，**不得**在平台已有「机主账号」节点时把旁路当作唯一出处。
- **节点/字段经验**：见 `myos-plugin-mobile/references/playbooks/health.md`（账户表、ACCOUNT_ID、多账号 DB 模式）。
- **加密 iTunes 备份口令**：`Manifest.plist` 含 `BackupKeyBag` / `IsEncrypted` 时走 `itunes-backup-password-recover`，不要现场另写校验脚本。

## MetaMask / 钱包

- **状态文件**：常看 `persist-root`、Redux/engine state。
- **账户数**：按唯一账户地址计，不把 token 或链当账户。
- **交易时间**：交易状态里常见毫秒时间戳，换算题面时区后答。
- **失败原因**：优先读取原始 `status/error` 字段，如 gas/手续费不足、网络错误等，不按选项近似猜。

## Send Anywhere / AirDrop / 文件传输

- **传输题**：查平台文件传输记录、App 数据库、设备 ID、传输方向、模式、文件名。
- **字段**：题干问装置 ID 就交 ID 字段原文，问名称就交名称；勿把同一条记录的兄弟字段填进答案槽。
- **口径**：以题干点名检材上的原文字段为准；跨机看到的异形态 ID（prefs/数字串等）只作交叉印证，除非题干明确要那种形态。
- **同文件**：同一文件可能同时存在于 Files 和 Photos，需比较文件名、hash、大小、时间和路径。
