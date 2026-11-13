# 链路实测：2025 美亚杯个人赛（W:\ 检材）

- 时间：2026-11-13
- 素材：`W:\` 下 5 份检材 + 题目复现文档 `D:\知识库\取证\比赛WriteUp\2025\2025美亚杯个人赛复现.md`（约 90 题）
- 目标：不是答题，而是**验证从检材到 AI 取证链路的每一环能否打通**（火眼解析/挂载、SeeU 索引、镜像挂载、Android/Windows 分区读取）。

## 检材

| 文件 | 大小 | 类型 |
|---|---|---|
| `W:\CHAN_MH_mobile.zip` | 249,278,021 B | iPhone 全量提取（iOS 17.1.1） |
| `W:\FUNG_CC_mobile.zip` | 1,169,150,778 B | iPhone 备份 |
| `W:\LEUNG_YL_mobile.zip` | 425,908,392 B | iPhone 备份 |
| `W:\IQ_Coin_Type_Transactions.zip` | 762,298 B | 交易记录 |
| `W:\AP3_LEUNG_YL_USB.E01` | 776,733,201 B | U 盘镜像（E01） |
| `W:\blk0_sda.bin` | 31,981,568,000 B | Android 手机 eMMC 原始镜像（题目第 18 题接收装置） |

## 链路结果

| 链路 | 结果 | 证据 |
|---|---|---|
| 火眼案件服务（`ges`） | ✅ | 冷启动时 `ges status --json` 返回 `case_backend_unreachable`（案件未打开）；案件打开后返回 `cid:1`、`ges_url: http://127.0.0.1:8621`、`routes: ["/case/","/evidence_mounts/"]`、4 个 `evidence_mounts` |
| 火眼只读挂载（`C:\hlnet\*`） | ✅ | `CHAN_MH` 挂载目录可直接读 `iDevice_info.txt`（`BuildVersion: 21B91` → iOS 17.1.1），`var/` 下有 `Manifest.db_DEC`、`Info.plist`、`keychains` 等 |
| SeeU 索引 API（`/list` `/evidences` `/search`） | ✅（修 bug 后） | `/evidences` 返回 5 条（`recordCount` 1/8443/14331/1/1，`reportedRecordCount` 3065/13718/25669/68/3）；`/search?q=Investors` → `fts5-trigram·11 命中`，`q=IMG_0021` → 2 命中，`q=85254974406` → 200 命中 |
| SeeU 面板（树/检索/记录/实体/时间线/表） | ✅ | 打包态 `m2-ui-check`：树过滤、记录筛选（22,776→X）、实体分页、时间线筛选、来源筛选、活动、MYOS 弹窗全部通过 |
| LovelyCarve：U 盘 E01 | ✅ | `inspect` 276 ms（2 分区）；挂载 `X:` 687–701 ms；根目录 `System Volume Information`/`WEPE`/`Sunny.zip`/`vera_key`；卸载 163 ms |
| LovelyCarve：Android eMMC（`blk0_sda.bin`） | ✅ | `inspect` 244 ms，18 个分区（`BOTA0`/`BOTA1`/`EFS`/`PARAM`/`BOOT`/`RECOVERY`/`OTA`/`RADIO`/…/`SYSTEM`/`CACHE`/`USERDATA`）；挂载 `USERDATA`（17）838–1,001 ms，`/data` 下可见 `com.whatsapp`/`com.instagram.android`/`com.facebook.katana`；`SYSTEM`（13）501 ms 可读 `app`/`framework`/`priv-app`；卸载均成功 |
| 手机 zip → 文件级分析 | ✅（经火眼挂载） | 移动端 zip 在火眼挂载下已是展开目录（`iDevice_info.txt` + `var/`），可直接 `grep/find` 读备份数据 |
| LovelySpark（流量分析） | ⚠️ 未测 | 本套检材**没有 pcap/流量包**；工具链此前已用 `L1-6.pcapng` 验证（analyze ≈ 11 s） |
| StarMem（内存分析） | ⚠️ 未测 | 本套检材**没有内存镜像**；此前仅用 `pid.6492.dmp` 验证 `info` 可用（该 dmp 非完整镜像，`windows-info` 失败） |
| VMware 动态分析 | ⚠️ 未测 | 本套题目**没有可执行样本**；需用户确认快照 + 样本后再测 |

## 本轮发现并修复的问题

1. **`/seeu-index/search` 对 ≥3 字关键词直接 500**：`tools/ges-index/query.mjs` 的 `search()` 里调用了不存在的 `ftsQuery()`（历史重构遗留），而 `q.length >= 3` 走 FTS 分支必触发 `ReferenceError: ftsQuery is not defined`；只有 2 字关键词走 LIKE 才正常，所以此前 e2e 一直用「加密」（2 字）没暴露。
   - 修复：删除重复的 FTS 前置过滤，短词（<3 字）走 LIKE，长词（≥3 字）走 `record_fts match ?`，异常时回退 LIKE。
   - 回归：新增 `tests/search-fts.test.mjs`（2 例）；`m2-ui-check` 增加长关键词「Investors」断言（`引擎 fts5-trigram · 11 命中`）。
   - 已随 **v0.3.15** 打包；v0.3.14 及更早的包检索 ≥3 字关键词会失败，建议升级。

## 结论

- 「火眼解析/挂载 → SeeU 索引/面板 → LovelyCarve 镜像挂载」这条主链路在本套真实检材上**已打通**（含 31.9 GB Android eMMC 与 E01 U 盘）。
- 火眼对 `pf`（全量提取）与 `E01` 类检材只提供「元数据 + 只读挂载」，索引里几乎没有记录 → AI 侧必须按「索引 → 挂载目录 → LovelyCarve → 原始文件」顺序工作（提示词已按此加固）。
- 火眼 E01 挂载是「分区节点视图」（`$FAT1`/`$MBR`/`未使用空间`），不适合直接翻文件；U 盘 E01 建议走 LovelyCarve 分区挂载。
- 流量/内存/动态分析三类检材本套题未提供，链路仍按此前单点验证，等有对应样本再补。

## 附：题目实测（CHAN_MH_mobile.zip / 火眼挂载目录）

挂载根：`C:/hlnet/4-1793357718/CHAN_MH_mobile.tar/`（eid 4）。

| 题号 | 问题 | 结论 | 证据（可复现） |
|---|---|---|---|
| 1 | 手机操作系统 | **A. iOS 17.1.1** | `iDevice_info.txt` 的 `BuildVersion: 21B91` |
| 3 | IMEI | **A. 357328098205226** | `MobileEquipmentIdentifier: 35732809820522`（14 位 MEID）+ Luhn 校验位 `6` |
| 4 | 最后使用 SIM 的 ICCID | **A. 89852122206020998419** | `iDevice_info.txt` 的 `IntegratedCircuitCardIdentity`（另 `CFBundleIdentifier: com.apple.CMCC_hk`） |
| 8 | 没连接过哪个 SSID | **A. Hongn Home** | `var/preferences/com.apple.wifi.known-networks.plist` 已知网络 = `ErrorError` / `1010 free wifi` / `3109` / `.HKT-Hotel`；全盘 grep 无 `Hongn`，`CMHK` 仅出现在网络服务缓存（运营商名） |
| 10 | 安装了哪些 IM | **A. 只有 i) WhatsApp 和 ii) WeChat** | `var/mobile/Applications`：`net.whatsapp.WhatsApp`、`com.tencent.xin` 存在；`net.whatsapp.WhatsAppSMB`、`com.tencent.mqq` 不存在 |
| 20 | 从未安装的浏览器（多选） | **B. Chrome、C. Firefox、D. Edge** | Applications 里只有 `com.apple.mobilesafari`；grep `com.google.chrome.ios`/`org.mozilla.ios.Firefox`/`com.microsoft.msedge` 均无 |
| 22 | Safari 搜索过的字词 | **B. escape room hong kong** | `var/mobile/Library/Safari/History.db`（复制 `-wal` 后只读）搜索 URL `q=escape+room+hong+kong` |
| 12 | 哪个文件传输软件用过 | **C. com.estmob.paprika（Send Anywhere）** | `com.estmob.paprika/Documents` 有 `SA_Beat.mp3`/`SA_iTunes.mkv`；`Library/com.estmob.sendanywhere.sdk.database.realm` 有传输记录（`peerDeviceId`/`transferMode`/`sentTime` 与截图文件名）；SHAREit `transfer`/`file` 表为空；AirDropUI 无数据 |
| 17 | 传送的档案类型 | **A. 屏幕截图** | Realm 内文件名 `Screenshot_20250423-105307_Gallery.jpg`、`Screenshot_20250424-083131_Gallery.jpg` |
| 16 | 传送方或接收方 | **B. 接收方**（CHAN_MH 收到文件） | 传的是 `Screenshot_20250423-105307_Gallery.jpg` 这类 **Android 风格命名**（iOS 自己截图为 `IMG_xxxx.PNG`），且文件落在本机 `com.estmob.paprika` 的 Documents（Realm 路径 `.../Application/033732ED-…/Documents/Screenshot_…jpg`）；对端设备名 `Samsung SM-G930F` ⇒ 由三星发出、CHAN 接收 |
| 18 | 接收至哪一个装置 | **A. CHAN_MH_mobile.zip** | 同上：文件被收到本机 Send Anywhere 容器/Realm 记录里；FUNG_CC/LEUNG_YL 均为 iPhone，且其相册（Photos.sqlite）未见这两个文件 |
| 19 | 传送方的传输模式 | **待深挖** | Realm 字段 `transferMode` 是枚举整数（不是字符串），需要 App 枚举表/动调才能映射 `SEND_DIRECTLY` 等；`strings` 里无 `SEND_*` 字面量 |
| 30 | 两个 GIF 由哪个软件拍摄/生成 | **A. Infltr** | FUNG_CC 相册 `Photos.sqlite`：`IMG_0057.GIF`/`IMG_0062.GIF` 的 `ZIMPORTEDBYBUNDLEIDENTIFIER = com.Yooshr.Infltr`、`ZIMPORTEDBYDISPLAYNAME = Infltr`，EXIF 2025:04:16 13:25/13:42 |
| 38 | IMG_0014.MOV 与 IMG_0016.MOV 之间有无其他多媒体文件 | **没有** | FUNG_CC 相册 `ZASSET`：`IMG_0014.MOV` 的 `Z_PK=14`、`IMG_0016.MOV` 的 `Z_PK=15`（连续，无中间资产）；`IMG_0015/0017.MOV` 在 DB 与 `DCIM/100APPLE` 磁盘上都不存在 |
| 39 | 上一题的陈述哪条正确 | **D（IMG_0015.MOV 制作时名称被更改为 IMG_0016.MOV）** | 由 38 推断：编号跳号（0014→0016、0018）且无 0015 资产/文件，pk 连续说明没有隐藏/额外文件；名称改写是唯一能同时解释「编号缺口 + 无中间资产」的选项（建议与官方答案复核） |
| 31 | AirDrop 成功传送的条数 | **待深挖** | `com.apple.sharingd.plist` 只有 AirDropID/哈希；`Photos.sqlite` 的 40 个资产里无 AirDrop 导入的截图（`ZIMPORTEDBY` 无对应记录）——AirDrop 成功痕迹不在这些库里 |

复现命令（一条链路体检 + 上述解析）：`npm run chain:check -- --caseNumber 2919d298`，详见 `resources/forensics/skills/ios-full-extraction-quick/SKILL.md`。

## 第 50 轮补：USB / WinPE 题（Q77–90）

| 题号 | 答案 | 证据 |
| --- | --- | --- |
| 77 | **2** | `pyewf` 读 MBR：`55AA`、2 个有效分区（part0 起始 614400、58,007,224 扇区；part1 起始 60,620,800、716,799 扇区） |
| 78 | **MBR** | MBR 签名 `55AA` + 4 项分区表（非 GPT：LBA1 无 `EFI PART`） |
| 79 | **D 以上皆非** | 镜像总容量 31,406,948,352 B（≈29.3 GiB，非 16 GB）；分区文件系统 **exFAT**（part0，卷标 `TIM`）与 **FAT16**（part1，隐藏类型 0x16），没有 FAT32/NTFS；exFAT 分区 29,699,698,688 B（非 16 GB）；卷标 `TIM`≠`SanDisk` |
| 80 | **C（ii 和 iii）** | part0 根有 `Sunny.zip`（157,777,503 B，5 个条目**全部加密**）；zip 条目时间：`Sunny/` 2025-05-15 21:51:16、`xcontainer` 2025-05-15 21:45:40、`VeraCrypt Setup 1.25.9.exe` 2025-05-15 21:39:50（`VeraCrypt Portable 1.26.24.exe` 为 2025-08-13，疑后期替换）。「连接到 PC」本机证据待补（FAT 卷无注册表痕迹） |
| 82 | **D 以上皆是** | i) 可引导：MBR part0 boot flag 0x80 + part1 有 `EFI\BOOTootx64.efi`、`bootmgr`（`WEPE/WEPE64`）；ii) FAT16 卷标目录项 = **`EFI`**；iii) 卷标创建日期 0x5aaf/0xacd8 = **2025-05-15 21:38:48**；iv) part1 共 367,001,088 B（350 MB）< 500 MB |
| 83 | 待解（`tammy.txt` 在 VeraCrypt 容器内） | 需先用压缩包密码解 `Sunny.zip` → 用 VeraCrypt 打开 `xcontainer`（5,242,880 B）→ 挂载后读 `tammy.txt` |
| 84 | 待解（`xcontainer` 加密算法） | 同上：`xcontainer` 是 VeraCrypt 容器，算法需挂载/`veracrypt --text` 查看卷头 |
| 85 | **A（只有 i 和 ii）** | `xcontainer` 条目大小 5,242,880 B（题面 4,943,872 B 为容器内可见逻辑卷大小？待 VeraCrypt 头确认）；VeraCrypt 卷默认文件系统 FAT（格式化选项）；VeraCrypt 无嵌入式备份头（`--backup` 除外）；块大小 128 **位**=16 字节不成立 → iii/iv 假 |
| 86 | **C X:\** | WinPE 启动后把核心映像（boot.wim）挂载为 `X:` 虚拟盘 |
| 87 | **A（i 和 ii）** | WinPE 预设不含 PowerShell 与事件查看器（Eventvwr），`hostname`、`diskpart` 可用 |
| 88 | **A WEPE64.wim** | part1 `WEPE\WEPE64.WIM` 336,406,005 B，为 WinPE 核心映像；`install.wim` 是安装镜像、`WinPE.log`/`hiberfil.sys` 与启动无关 |
| 89 | **B（i, ii, iii）** | part1 有 `WEPE\WEPE64.WIM`、`WEPE\WEPE64`（原 bootmgr）、`EFI\BOOTootx64.efi`；`hiberfil.sys` 与可引导判断无关 |
| 90 | **C Windows 10 PE** | 微PE（WEPE64.WIM，336 MB）+ `WEPE.TXT` 说明为微PE 2.x，其内核基于 Windows 10；镜像内未检出 Windows 11 构建号 |
| 97 | **A 正确** | BIP-39 助记词 12–24 个单词 |

- 补充技术记录：`Sunny.zip` 的 5 个条目全部 ZipCrypto 加密；容器 `xcontainer` 与 `VeraCrypt Portable/Setup` 同包分发 ⇒ Q91「加密软件名称」为 **VeraCrypt**；Q92–96（IQ Coin 钱包地址/币种/存入次数/支账地址/BEP-20 数量）需挂载 `xcontainer` 后读取；Q98（助记词文件 MD5）同。

## 第 50 轮补 2：26/31/40/41/42/48/50/52/55/59 题

| 题号 | 答案 | 证据 |
| --- | --- | --- |
| 26 | **B（只有 ii 和 iii）** | FUNG_CC `var/preferences/com.apple.wifi.known-networks.plist` 只有 `wanchai`、`iPhone (2)` 两个 SSID（无 THREE_WIFI/Router） |
| 31 | 待确认（倾向 A） | FUNG_CC 相册 `ZADDITIONALASSETATTRIBUTES.ZIMPORTEDBYBUNDLEIDENTIFIER=com.apple.sharingd` 有 1 个资产 `IMG_0084.MOV`（AirDrop 收到 1 个多媒体文件）；CHAN 侧无 AirDrop 导入记录，选项表述与「视频」不完全对齐，建议对照官方答案 |
| 40 | **A (22.2816569, 114.1756115)** | FUNG `Photos.sqlite`：`IMG_0027.HEIC` 的 `ZLATITUDE=22.2816569`、`ZLONGITUDE=114.1756115` |
| 41 | **B（2）** | FUNG 相册中 `ZIMPORTEDBYBUNDLEIDENTIFIER=com.apple.mobilesafari` 的资产 2 个：`IMG_0026.JPG`、`IMG_0097.JPG` |
| 42 | **A IMG_0085.mov** | FUNG `Photos.sqlite`：`IMG_0085.MOV` 的 `ZORIGINALFILENAME=IMG_0004.mov`、`ZIMPORTEDBY=com.apple.mobileslideshow`（照片 App 编辑后另存） |
| 50 | **A 凤凰VIP会员心得交流群** | FUNG `ZWACHATSESSION.ZARCHIVED=1`：`鳳凰VIP會員心得交流群`（`85263834763-1563607573@g.us`） |
| 52 | **B（i 和 ii）** | LEUNG `ZWAGROUPMEMBER`（Investors 群 `120363417204753192`，ZISADMIN=1）：`85254974406@s.whatsapp.net`、`85260927726@s.whatsapp.net` |
| 55 | **A** | 四选项哈希逐一比对：`B1A370…`=「We are 3」社群头像（`Media/Profile/120363397792833003-1744811346.jpg`）、`B8BA25…`=Happy Sharing、`E43ADC…`=Foodies、`20E64C…`=Photographers ⇒ 社群「We are 3」对应 A |
| 59 | **A 诈骗** | IQ COIN 群（FUNG session 38）消息：「impersonate CEO to give instructions… Ask them to pay by the 'Coin'… To our created address」→ 冒充 CEO 诈骗转账 |
| 48 | 待解 | 需查 WeChat 视频号关注表（`wcdb`），当前未定位到可读表 |

- 技术：WhatsApp 群头像在 `group.net.whatsapp.WhatsApp.shared/Media/Profile/<jid>-<ts>.jpg`，直接 `sha256` 与选项比对即可；社群（community）在 `ZWACHATSESSION` 描述里含 “This community is for members to chat in topic-based groups”。

## 第 50 轮补 3：78–90 题（USB / WinPE）

| 题号 | 答案 | 证据 |
| --- | --- | --- |
| 77 | **2** | E01 MBR 分区表 2 项 |
| 78 | **MBR** | 分区表起始 `55AA`，4 项分区项 |
| 79 | **D 以上皆非** | 总容量 29.7 GB≠16 GB；文件系统仅 exFAT（part0）+FAT16（part1），无 FAT32/NTFS；part0 29.7 GB；卷标 part0=`TIM`、part1=`EFI`（非 SanDisk） |
| 80 | **C（ii 和 iii）** | ii 有 AES 加密 `Sunny.zip`；iii 压缩包条目时间 2025-05-15 21:39–21:51；i「连接过名为 PC 的电脑」未检出证据（part0/part1 无 PC 痕迹），故不选 D |
| 81 | **待解** | `Sunny.zip` 为 AES-256（method 99、extra 0x9901），需密码；FUNG 聊天记录「I put the list of password in the NAS…」⇒ 密码清单不在检材中，需 NAS 材料或人工提供 |
| 82 | **D 以上皆是** | i) part1 boot flag 0x80 + EFI\BOOTootx64.efi；ii) part1 FAT 根目录卷标项 `EFI`；iii) 卷标时间 2025-05-15 21:38:48（UTC+8）；iv) part1 367,001,088 B < 500 MB |
| 83 | 待解 | 需先解压 `Sunny/xcontainer`（AES 密码）+ VeraCrypt 挂载后读 `tammy.txt` |
| 84 | 待解（预期 AES） | xcontainer 为 VeraCrypt 卷，默认 AES；需挂载后确认 |
| 85 | 待解 | 需挂载 xcontainer 看卷属性（大小/文件系统/备份头/块大小） |
| 86 | **C X:** | WinPE 启动后核心映像挂载为 X:（微PE 默认 RamDisk 盘符 X:） |
| 87 | **A（Powershell、Eventvwr）** | 微PE 精简环境默认移除 PowerShell 与 Event Viewer；hostname/diskpart 可用 |
| 88 | **A WEPE64.wim** | 启动必需核心映像（WEPE64.WIM 336,406,005 B） |
| 89 | **B（i、ii、iii）** | WEPE64.wim/boot.wim + bootmgr + EFI\Bootootx64.efi；hiberfil.sys 非必需（iv 不选） |
| 90 | **C Windows 10 PE** | 微PE 2.x 内核基于 Windows 10（WEPE64.WIM 为压缩镜像，无法直接读构建号；按微PE 版本判定，建议对官方答案） |
| 97 | **A 正确** | BIP-39 助记词 12–24 个英文单词 |

## 阻塞项

- Q81/83/84/85/91–96/98 依赖 `Sunny.zip`（AES-256）密码 → `Sunny/xcontainer`（VeraCrypt 卷）→ `tammy.txt` / 钱包地址 / BEP-20 交易 / 助记词文件 MD5。聊天记录显示密码清单在 NAS（检材未提供）。
- Q31 AirDrop 计数：仅有 FUNG 收到 1 个 `com.apple.sharingd` 导入的 `IMG_0084.MOV` 证据，选项表述为图片/文件，建议对官方答案。
- Q48 WeChat 视频号关注数：需 wx 视频号表，当前 iOS 备份中未定位。

## 第 51 轮补：19 / 47 / 48 题

| 题号 | 答案 | 证据 |
| --- | --- | --- |
| 19 | 待定（倾向 C SEND_DIRECTLY） | Send Anywhere Realm（`com.estmob.sendanywhere.sdk.database.realm`）中该传输记录带 `peerDeviceId`/`peerDeviceName: Samsung SM-G930F`（点对点直传特征）；`transferMode` 为整数枚举（无 SEND_* 字面量），需对照官方答案；选项 A SEND_PARTIALLY / B SEND_PAPRIKA / C SEND_DIRECTLY / D SEND_BYCLOUD / E SEND_BLUETOOTH |
| 47 | 待确认（倾向 **wxid_zt3dtp69pc7v12**） | CHAN WeChat `Documents/a1c9cfc3…/fts/fts_message.db` 与 `WCDB_Contact.sqlite` 出现两个 wxid：`wxid_c9xyspglub7512`（FUNG 备份文件名 `…backupinfo.wxid_c9xyspglub7512.crc` 指向 FUNG）、`wxid_zt3dtp69pc7v12` ⇒ CHAN 的 WeChat ID 应为后者；题面选项未在提取文本中 |
| 48 | **D（无内容）** | CHAN `…/finder/db/finder_main.db`：`finderFollowingListTable` 0 行；`finder_main.aff.db`（feed/profile/contact/comment_list）全 0；`finder_main_aff.db` 0；`FinderMsg/MsgSessionStatus.db` 0 ⇒ 视频号关注列表为空（选项含「（无内容）」） |

- 补充发现：CHAN WeChat 数据库为**明文 SQLite**（非 SQLCipher）：`MM.sqlite`（Friend/Friend_Ext/RevokeMsgTable 等 10 表）、`WCDB_Contact.sqlite`（Friend/MassSendContact/OpenIMContact 等 8 表）、`message_1..4.sqlite`（Chat_*/ChatExt2_* 分表）、`WCDB_OpLog.sqlite`；`finder/db/` 下为视频号库；`fts/fts_message.db` 为全文索引。三条手机（CHAN 全量提取 / LEUNG、FUNG 备份）WeChat 数据量都很小（MM.sqlite 均 90,112 B），大量表为空，属「装了但基本没用」。
