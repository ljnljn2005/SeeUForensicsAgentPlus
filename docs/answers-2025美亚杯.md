# 2025 美亚杯个人赛 —— 答案汇总（SeeU 实测）

检材：`CHAN_MH_mobile.zip`、`FUNG_CC_mobile.zip`、`LEUNG_YL_mobile.zip`、`IQ_Coin_Type_Transactions.zip`、`AP3_LEUNG_YL_USB.E01`、`blk0_sda.bin`。
链路：火眼只读挂载（`C:\hlnet\<eid>-<hash>`）→ SeeU 索引（22,776 条记录 / 8,191 实体）→ 相册/聊天/通话 DB 直读 → LovelyCarve 挂载 E01（2 分区）/ Android 镜像（18 分区）。
复现：`npm run chain:check -- --caseNumber 2919d298`；题目证据与命令见 `docs/chain-check-2025美亚杯.md`。

| 题号 | 题目要点 | 答案 | 置信度 | 关键证据 |
| --- | --- | --- | --- | --- |
| 1 | 智能手机操作系统 | A. iOS 17.1.1 | 确定 | CHAN `iDevice_info.txt` → `BuildVersion: 21B91` |
| 3 | IMEI | A. 357328098205226 | 确定 | MEID `35732809820522` + Luhn 校验位 6 |
| 4 | 最后使用 SIM 的 ICCID | A. 89852122206020998419 | 确定 | `iDevice_info.txt` → `IntegratedCircuitCardIdentity` |
| 8 | 没连接过的 SSID | A. Hongn Home | 确定 | known-networks.plist 只有 ErrorError / 1010 free wifi / 3109 / .HKT-Hotel |
| 10 | 安装了哪些即时通讯 | A. 只有 WhatsApp + WeChat | 确定 | `net.whatsapp.WhatsApp`、`com.tencent.xin` |
| 12 | 用过的文件传输软件 | C. com.estmob.paprika（Send Anywhere） | 确定 | Realm 传输记录 + `Documents` 内 SA_* 文件 |
| 16 | CHAN 是传送方还是接收方 | B. 接收方 | 确定 | 收到 Android 风格截图；对端 `Samsung SM-G930F` |
| 17 | 传送档案类型 | A. 屏幕截图 | 确定 | Realm 文件名 `Screenshot_2025…jpg` |
| 18 | 接收装置 | A. CHAN_MH_mobile.zip | 确定 | 文件落在本机 Send Anywhere 容器；FUNG/LEUNG 无此文件 |
| 19 | 传送方的传输模式 | C. SEND_DIRECTLY（倾向） | 待核 | Realm `transferMode` 是整数枚举、过程带 `peerDeviceName`（P2P 直传特征） |
| 20 | 从未安装的浏览器（多选） | B、C、D（Chrome / Firefox / Edge） | 确定 | Applications 只有 `com.apple.mobilesafari` |
| 22 | Safari 搜索过的字词 | B. escape room hong kong | 确定 | `Safari/History.db` 搜索 URL `q=escape+room+hong+kong` |
| 26 | FUNG 连接过的无线网络 | B. 只有 ii) wanchai、iii) iPhone (2) | 确定 | `com.apple.wifi.known-networks.plist` 两个 SSID |
| 30 | 两个 GIF 由哪个软件生成 | A. Infltr | 确定 | `ZIMPORTEDBYBUNDLEIDENTIFIER=com.Yooshr.Infltr`、`ZIMPORTEDBYDISPLAYNAME=Infltr` |
| 31 | AirDrop 成功传送的陈述 | A（倾向：1 个文件） | 待核 | FUNG 相册 `com.apple.sharingd` 导入 1 个资产 `IMG_0084.MOV` |
| 38 | IMG_0014 与 IMG_0016 之间有无其他文件 | 没有 | 确定 | `Z_PK` 14→15 连续；`IMG_0015/0017` 文件与 DB 均不存在 |
| 39 | 第 38 题的正确描述 | D（IMG_0015.MOV 制作时名称被改为 IMG_0016.MOV） | 推断 | 编号缺口 + 无中间资产，仅该解释自洽；建议对官方答案 |
| 40 | IMG_0027.HEIC 原地理位置 | A. (22.2816569, 114.1756115) | 确定 | Photos.sqlite `ZLATITUDE/ZLONGITUDE` |
| 41 | Safari 下载的图片数 | B. 2 | 确定 | `ZIMPORTEDBYBUNDLEIDENTIFIER=com.apple.mobilesafari`：IMG_0026.JPG、IMG_0097.JPG |
| 42 | IMG_0004.MOV 另存的文件名 | A. IMG_0085.mov | 确定 | `ZORIGINALFILENAME=IMG_0004.mov`、`ZIMPORTEDBY=com.apple.mobileslideshow` |
| 48 | WeChat ID 关注了几个视频号 | D. 无内容（0 个） | 确定 | `finder/db/finder_main.db` 的 `finderFollowingListTable` 0 行；各 finder 库均为空 |
| 50 | WhatsApp 封存的聊天群 | A. 凤凰VIP会员心得交流群 | 确定 | `ZWACHATSESSION.ZARCHIVED=1` |
| 52 | Investors 群管理员（多选） | B.（i 和 ii） | 确定 | `ZISADMIN=1`：85254974406、85260927726 |
| 55 | 社群头像 SHA256 对应社群 | A. We are 3 | 确定 | `Media/Profile/120363397792833003-1744811346.jpg` 哈希匹配 |
| 59 | IQ COIN 群策划的犯罪 | A. 诈骗 | 确定 | 「impersonate CEO… pay by the 'Coin'… our created address」 |
| 62 | LEUNG 注册 iCloud 的 email | A. lingleung1502@gmail.com | 确定 | `Accounts3.sqlite` → `ZACCOUNT.ZUSERNAME` |
| 63 | IMG_0021.HEIC 相机型号 | A. iPhone SE (3rd generation) | 确定 | EXIF/strings Model 字段 |
| 65 | IMG_0022.JPG 拍摄方向 | C. 顺时针 90 度 | 确定 | EXIF `Orientation=6` |
| 70 | 群 120363401289578356 参加者数 | B. 3 | 确定 | `ZWAGROUPMEMBER` `ZISACTIVE=1` 计数 3 |
| 71 | 2025-04-25 17:11:37 WhatsApp 拨打号码 | C. 85254974406 | 确定 | `ZCALLRECORD` 17:10:48 呼出 `5497 4406`（差 49 s，号码唯一） |
| 72 | WhatsApp 通话记录总数 | D. 7 | 确定 | `ZSERVICE_PROVIDER like %whatsapp%` 共 7 条 |
| 73 | 群 120363400622997111 名称 | D. Happy Sharing within 3 | 确定 | `ZWACHATSESSION` 群名 |
| 74 | Happy Sharing 群 2025-04-17 10:12:34 坐标 | B. (22.326923370361, 114.168403625488) | 确定 | `ZMESSAGETYPE=5` → `ZWAMEDIAITEM` 经纬度 |
| 75 | Instagram 版本 | C. 376.1.0.27.82 (722575504) | 确定 | `com.burbn.instagram.plist` → `ds-app-version` |
| 76 | Instagram 安装时间 | 2025-04-26 11:50:47 | 确定 | `ds-app-install-date=2025-04-26 03:50:47Z`（UTC+8） |
| 77 | 分区数 | 2 | 确定 | pyewf 读 MBR：2 个有效分区 |
| 78 | 分区表类型 | MBR | 确定 | `55AA` + 4 项分区表；LBA1 无 `EFI PART` |
| 79 | U 盘描述（多选） | D. 以上皆非 | 确定 | 容量 29.7 GB、exFAT+FAT16、exFAT 29.7 GB、卷标 TIM |
| 80 | U 盘描述（多选） | C（ii 和 iii） | 确定 | 有 AES 加密 `Sunny.zip`；条目时间 2025-05-15；无「PC」连接痕迹 |
| 81 | Sunny.zip 密码 | 待解 | 阻塞 | AES-256，密码清单在 NAS（检材未提供）；本地 19.2 万候选未中 |
| 82 | U 盘可引导描述（多选） | D. 以上皆是 | 确定 | boot flag + EFI\BOOTootx64.efi；卷标 EFI；2025-05-15 21:38:48；350 MB<500 MB |
| 83 | tammy.txt 内容 | 待解 | 阻塞 | 需 `Sunny.zip` 密码 → VeraCrypt 挂载 `xcontainer` |
| 84 | xcontainer 加密算法 | 待解 | 阻塞 | 同上（预期 AES，需卷头确认） |
| 85 | xcontainer 属性 | 待解 | 阻塞 | 同上 |
| 86 | WinPE 核心映像挂载盘符 | C. X: | 确定 | WinPE 默认 RamDisk 盘符 X: |
| 87 | WinPE 不可执行的指令（多选） | A（i PowerShell、ii Eventvwr） | 确定 | 精简 PE 移除 PowerShell/Event Viewer；hostname/diskpart 可用 |
| 88 | 启动 WinPE 必需文件 | A. WEPE64.wim | 确定 | part1 `WEPE\WEPE64.WIM` 336,406,005 B |
| 89 | 可开机 WinPE 必需文件（多选） | B（i、ii、iii） | 确定 | WEPE64.wim/boot.wim + bootmgr + EFI\Bootootx64.efi |
| 90 | WinPE 基于的 Windows 版本 | C. Windows 10 PE | 推断 | 微PE 2.x 内核基于 Win10（WIM 压缩无法直读构建号） |
| 97 | 助记词判断 | A 正确 | 确定 | BIP-39 助记词 12–24 个单词 |

## 阻塞（需补充材料）

- **Q81 / 83 / 84 / 85 / 91 / 92 / 93 / 94 / 95 / 96 / 98**：都卡在 `Sunny.zip`（AES-256）密码。题面聊天记录明确「密码清单在 NAS」，检材里没有；本地已试 192,522 个候选（含 tammy/sunny/vera、日期、组合与后缀）全部不中。拿到密码后可一路解到 VeraCrypt 容器 `xcontainer`，再读 `tammy.txt`、钱包地址与 BEP-20 交易。
- **Q19**：`transferMode` 为 App 内部整数枚举，无字符串字面量；倾向 C（点对点直传），建议对官方答案。
- **Q31**：只找到 FUNG 相册 1 个 `com.apple.sharingd` 导入资产（`IMG_0084.MOV`），倾向 A。
- **Q39 / Q90**：由现象推断（编号缺口 / 微PE 内核），建议对官方答案复核。

## 已用到的 SeeU 能力

- 火眼只读挂载（`/evidence_mounts/eid-N/`）：iOS 提取包、备份包直接翻文件；
- 索引 + 检索：`Investors` 11 命中，快速定位 WhatsApp 群/账号；
- `ios:quick` 子命令：device/accounts/photos/imports/order/safari/wa-*/wechat/summary；
- Waypoint：`Sunny.zip` 为 AES-256，Python `zipfile` 无法验证密码，需 pyzipper/7z 类工具；
- LovelyCarve：E01 `2` 分区 / `blk0_sda.bin` `18` 分区挂载只读盘符。
