# 题型路由经验库

本文件只记录可复用方法，不记录原题答案。经验来源主要为 XD Forensics Wiki 的美亚杯手机相关题解：

- https://forensics.xidian.edu.cn/writeups/MeiyaCup2025Group/
- https://forensics.xidian.edu.cn/writeups/MeiyaCup2025Individual/
- https://forensics.xidian.edu.cn/writeups/MeiyaCup2024Individual/
- https://forensics.xidian.edu.cn/writeups/MeiyaCup2024Group/

遇到平台无答案、App 专项题或题目问法不熟时，先按本表选择高概率证据路径，再回到检材验证。
不得根据经验来源、旧题印象或相似题目回忆具体答案；本表只能用于选择证据路径和防错点。

| 题型 | 典型问法 | 首选证据 | 备用证据 | 关键字段/表 | 防错点 |
| --- | --- | --- | --- | --- | --- |
| 设备系统/型号 | 操作系统、Model、Build Number | 平台设备信息 | Android `build.prop`、iOS 设备配置库、`Contents.db` | `ro.build.*`、Model、ProductType | 型号代号和显示型号不要混用；Android 不同版本 `build.prop` 路径可能不同。 |
| IMEI/ICCID/SIM | IMEI 数量、IMEI1、ICCID、SIM 序号 | 平台设备/SIM 信息 | telephony/subscriber、`Contents.db`、NV/persist/modem | IMEI、ICCID、subscriber id | App 内 `deviceId` 不等于硬件 IMEI；IMEI 需 15 位数字并可做 Luhn 校验。 |
| Apple ID/iCloud | 最后登录 Apple ID、iCloud 注册邮箱、同步文件 | 平台账号/iCloud 结果 | iOS Accounts、Preferences、iCloud 配置、文件同步痕迹 | account id、email、ubiquity/container | 区分 Apple ID、iCloud 邮箱、邮件账号和浏览器登录账号。 |
| 手机号/热点 | 最后使用电话号码、热点名称、热点密码 | 平台 SIM/热点结果 | 系统配置、Wi-Fi/热点 plist、`Contents.db` | phone number、SSID、password | 热点 SSID 不等于曾连接 Wi-Fi；密码输出要按题面格式。 |
| Wi-Fi 位置 | 哪个 Wi-Fi 有地理位置、BSSID、首次连接时间 | 平台 Wi-Fi 记录 | iOS `/var/preferences/com.apple.wifi.known-networks.plist`、Android Wi-Fi 配置 | SSID、BSSID、AddedAt、latitude、longitude | APN/热点不等于 Wi-Fi；`AddedAt` 常需时区转换。 |
| WhatsApp 账号/版本 | WhatsApp ID、版本、已登录设备 | 平台 WhatsApp 账号/应用列表 | App 元数据、`DeviceAgents.sqlite` | versionName、jid、`ZWASMBDEVICEAGENT` | 账号常是手机号格式；版本题区分显示版本和内部版本。 |
| WhatsApp 消息类型 | sticker、图片、文件、收发方向、发送时间 | 平台消息详情 | Android `msgstore.db`、iOS `ChatStorage.sqlite` | `message_type`、`ZMESSAGEDATE`、`ZISFROMME`、media path | Android/iOS 字段不同；用消息时间或内容回表筛选，iOS `ZMESSAGEDATE` 常需 Cocoa Core Time 转换。 |
| WhatsApp 封存群组 | 哪个群被封存/存档 | 平台群组列表 | `ChatStorage.sqlite` | `ZWACHATSESSION.ARCHIVED=1` | 平台翻译可能写“封存/存档”；必须回源确认 archived 标志。 |
| WhatsApp 群创建者/创建时间 | 群组 ID、创建者、创建时间 | 平台群组信息 | `ChatStorage.sqlite`、群组 JID | `<phone>-<unix>@g.us`、creation timestamp | 旧格式群组 ID 可推出创建者和时间；群主不一定是创建者。 |
| WhatsApp 群头像 | 群头像文件名、下载/更改时间 | 平台附件/头像 | `ChatStorage.sqlite`、`Media/Profile/` | profile image path、文件名时间戳 | 头像更改时间可能藏在文件名 Unix 时间戳；题面可能要求 UTC+0。 |
| WhatsApp 位置/通话/PDF | 发送坐标、通话记录、PDF 附件内容 | 平台消息/通话/附件 | `ChatStorage.sqlite`、附件目录、PDF 原文件 | message type、latitude/longitude、call log、media path | 位置要验证坐标和发送方；PDF 内容题需打开附件，不只看文件名。 |
| WeChat 账号/消息 | 微信 ID、聊天内容、发送图片、删除消息 | 平台微信结果 | `com.tencent.mm_preferences.xml`、`EnMicroMsg.db`、`MM.sqlite` | wxid、message table、talker、type | 昵称不能单独证明联系人；删除题区分删除标记、恢复残留和缓存。 |
| WeChat 视频号 | 关注了多少视频号 | 平台微信视频号结果 | `finder_main.db` | `finderContactTable3.followState=1` | 平台缓存量不等于已关注量；按关注字段筛选。 |
| Telegram 验证码 | Telegram 验证短信、UserID | 平台短信/Telegram 账号 | `Contents.db`、SMS/MMS、通知 | sender、body、code、user id | 验证码题要验证发送方、应用名、接收时间。 |
| 浏览器搜索/书签/下载 | Safari/Chrome 搜索词、书签数、下载文件 | 平台浏览器结果 | Safari/Chrome History、Downloads、Bookmarks、WebView | title、URL query、keyword、download path | title 和 URL 不要混用；统计前先定 URL 行数/访问次数/唯一域名口径。 |
| Gmail/云盘账号 | Gmail 账号、Google Drive 最后同步时间 | 平台账号/应用结果 | Gmail/Chrome/Drive 配置、同步日志、通知 | account email、sync timestamp | 浏览器登录账号、App 账号、系统账号需分层验证。 |
| Facebook 群组/发图 | 建立的群组、发布照片数量、上传媒体 | 平台 Facebook/社交结果 | `/data/com.facebook.katana/app_uploads/`、`databases/local_media_db` | upload folders、media hash、local media records | Facebook 群组可能以 Community 呈现；上传目录和数据库统计可能冲突，需去重并标注口径。 |
| 外卖/订单 App | 餐厅、付款方式、最后使用时间 | 平台 App/订单结果 | Foodpanda `cart-db`、`order-db`、`pandora.db.perseus` | cart/order/payment、server fetch timestamp、db mtime | 最后使用时间可能与数据库修改时间冲突；区分用户操作、后台访问和取证后联网痕迹。 |
| 照片数量/截图 | 某日照片数量、截图文件、保存路径 | 平台媒体结果 | iOS `Photos.sqlite`、Android `MediaStore`、DCIM/Screenshots | asset id、filename、media type、path | 拍摄时间、导入时间、文件修改时间不同；截图通常不能证明真实拍摄设备/GPS。 |
| EXIF/GPS/相机型号 | 照片坐标、相机型号、方向、镜头 | 平台媒体元数据 | 原始图片 EXIF、Photos/MediaStore | DateTimeOriginal、Make、Model、Orientation、GPS | 坐标顺序、小数位和时区要按题面；导出图/缩略图需与原图区分。 |
| Live Photo | 哪些照片是实况照片 | 平台媒体类型 | iOS `Photos.sqlite` | `ZASSET`、`ZUNIFORMTYPEIDENTIFIER='public.heic'`、`ZVIDEOCPDURATIONVALUE != 0` | Live Photo 需主图和伴随视频共同证明。 |
| AirDrop/文件传输 | 传送/接收文件、对端设备 ID、传输模式 | 平台传输记录 | iOS Sharing/AirDrop、Send Anywhere 类 App 数据 | device id、direction、file name、mode | 传送方/接收方和接收设备要分清；问 ID 勿交名称；以题干检材原文字段为准，跨机交叉仅印证。 |
| Line/其他 IM | 聊天对象、逃离地点、指示内容 | 平台聊天结果 | App 消息库、附件、缓存、通知 | sender、room/conversation id、message body、timestamp | 不要只查主流 IM；题干出现人名或别名时跨 WhatsApp/Line/Telegram 搜索。 |
| APK/RAT 分析 | 恶意 APK 组成、权限、C2、录音/截图功能 | APK 静态分析 | `AndroidManifest.xml`、`smali/`、resources、layout XML | permissions、activity、service、C2 host、MediaRecorder、screenshot code | APK 题可能来自电脑检材但属于移动端经验；无 `classes.dex` 时检查 smali 文件结构。 |
| 智能家居/米家 | 家庭名称、房间、设备、did、事件、清扫图片 | 平台米家结果 | `home_room_manager_sp_.xml`、MMKV、JSON、`onetrack`、插件目录 | `home_room_content`、roomlist、dids、event、plugin path | 平台可能漏房间/设备；XML 内嵌 JSON 需反转义后解析。 |
| 健康/运动 · 机主账号 | 健康/运动 App 机主账号、UID、登录账号、小米账号 ID（健康语境） | 平台结果树/`fl_search`：类别「运动健康」「健康」「*运动」+ 节点「机主账号 / 账户 / USER」 | 目标包 `shared_prefs` / MMKV（`getMMKVValuefromKey` / `getMMKVdict`）；不足再交叉同账号体系其它 App | ACCOUNT_ID、userId、uid、机主账号列 | **先树后源**。旁路 App（画报/桌面/查找设备等）命中只能交叉印证，不得当唯一出处；平台已有节点时答案出处写平台路径。MMKV 禁止当明文 `strings` 扫 `.bak`。详见 `app-artifacts.md` 与 `myos-plugin-mobile` health playbook。 |
| 加密 iTunes/Finder 备份口令 | 备份密码、Manifest 加密、BackupKeyBag、解锁加密备份 | 产品密码交互/`submit_interaction`；否则技能 `itunes-backup-password-recover` 标准校验 | 短 PIN 掩码（脚本 brute）；hashcat `-m 14700`/`14800` | IsEncrypted、BackupKeyBag、WPKY | **禁止**现场自写伪 KeyBag 校验；校验失败禁止交「备选猜密码」。Office/ZIP 仍用 `cracking-password-protected-documents`。 |
| 通知/OCR/缓存 | OCR 次数、App 通知、缓存证据 | 平台通知/OCR/缓存 | 通知数据库、OCR 记录、截图/缓存图片 | app、version、timestamp、source file | 截图、通知栏、缓存图片常是关键证据，不能只查主数据库。 |
| 钱包账户/交易 | 钱包账户数、交易时间、失败原因 | 平台钱包结果 | MetaMask `persist-root`、Redux/engine state | account address、transaction、status/error、timestamp | token 不是账户；交易时间戳可能是毫秒；失败原因优先取原始错误字段。 |
| 删除/残缺数据 | 删除消息类型、残缺会议数据、恢复记录 | 平台删除/恢复项 | WAL/SHM、旧库、freelist、附件目录、残留文件 | deleted flag、message type、media path | 区分已删除消息、缓存、恢复残留；统计要说明过滤条件。 |
