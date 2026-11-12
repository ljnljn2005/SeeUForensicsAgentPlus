---
name: lovelycarve-forensics
display_name: LovelyCarve 取证分析
display_name_en: LovelyCarve Forensics
description: 用 LovelyCarve CLI 对磁盘镜像、分区、文件夹、归档、备份与加密容器做只读取证分析：建案建索引、按名/按内容检索、读文本与解析格式、雕刻恢复删除文件、解锁 BitLocker/LUKS/VeraCrypt、组装 RAID/LVM、跑插件分析与时间线、哈希与导出。含本机部署路径、精确命令、退出码语义与实测踩过的坑。触发词：LovelyCarve、lovelycarve-cli、镜像分析、文件雕刻、carving、签名雕刻、磁盘取证、镜像浏览、BitLocker 解锁、LUKS 解锁、RAID 组装、卷索引、时间线、E01 分析。
description_zh: "LovelyCarve（lovelycarve-cli）取证操作手册：只读浏览镜像与分区、建案建卷索引、文件名通配与内容检索、文本/编码读取与格式解析、删除文件恢复与签名雕刻、BitLocker/LUKS/VeraCrypt/iOS 备份解锁、RAID/LVM 组装、插件分析与时间线、哈希导出与读故障审计；含真实检材实测基线、退出码语义、效率开关与 30 余条实测坑。"
description_en: "Operating manual for LovelyCarve CLI forensic analysis: read-only image and partition browsing, case and volume indexes, filename glob and content search, text decoding and format parsing, deleted-file recovery and signature carving, BitLocker/LUKS/VeraCrypt/iOS backup unlocking, RAID/LVM assembly, plugin analysis, timelines, hashing and export with read-fault auditing; includes a real-evidence tested baseline, exit-code semantics, output-efficiency switches and 30+ field-verified pitfalls."
version: 1.1.0
author: AI_工具开发者
category: coding
allowed-tools: Read, Write, Edit, Bash
whenToUse: 用户给出磁盘/分区镜像（E01、RAW、VMDK、VHDX、QCOW2、dd 分片等）、检材文件夹、归档、iOS/Android 备份或加密容器，要求浏览、检索、提取、恢复、解锁、组装、出时间线或做哈希导出时；或明确提到 LovelyCarve / lovelycarve-cli / 雕刻 / carving。
---

# LovelyCarve 取证分析（lovelycarve-forensics）

**它是什么（先立住，否则命令会用错）**：它不是"镜像查看器"，是一条**取证流水线**——证据源适配层（EWF/VMDK/VHD(X)/QCOW/VDI/RAW 分片/LVM/md/固件封装…）→ 案件台账与**卷快照 + 元数据索引**（只索引 MFT/目录项，不读文件体，所以万级条目秒级完成）→ 检索层（索引内通配检索、内容搜索）→ 解析层（文本解码、SQLite/Realm/ZIP/PE/USN/ext4 日志…）→ 恢复层（NTFS/FAT/exFAT 删除记录 + 签名雕刻）→ 分析层（插件任务、时间线）→ 交付层（SHA/DFXML/JSONL 报告、导出）。**GUI 与 CLI 是同一个后端**，CLI 是它的无头入口；本技能的判据对桌面端同样成立。

一条原则：**证据只读，结论可复核，未执行就写未执行**。

## 0 · 三十秒上手

```bash
# 本机部署（Windows，v1.3.0，171 条命令）
LC='E:\LovelyCarve\cli\lovelycarve-cli.exe'          # bash
# $LC = 'E:\LovelyCarve\cli\lovelycarve-cli.exe'      # PowerShell（调用要写 & $LC）

export LOVELYCARVE_AGENT=1                            # 机器输出：紧凑 JSON、目录默认 50/页、无交互无颜色
export LOVELYCARVE_SESSION_DIR='E:\SeeU\runtime\sessions'   # 可选：把常驻会话文件移出系统盘（默认 %APPDATA%）
"$LC" -q system get | head -c 400                     # 自检：commands/exitCodes/agentMode/ocr/qrcode
```

**找不到可执行文件时按序判定，别猜**：① 调用方已给的路径（`$LC`、或某技能自带 `bin/lovelycarve-cli.exe`）；② `E:\LovelyCarve\cli\lovelycarve-cli.exe`（本机 CLI 独立部署）；③ `app\LovelyCarve.exe` 同目录的 `lovelycarve-cli.exe`（GUI 安装目录）；④ `where lovelycarve-cli`；⑤ 都没有 → 明确告知"未安装/路径未知"并停下，**不要伪造命令输出**。

- 必须与 `lovelycarve-cli.exe` 同目录保留 `lc-plugin-host.exe`、`plugins\`、运行库 DLL；**不要** `cd` 进该目录执行。
- 启动即退（`0xC0000135`）＝缺 `libcrypto-3-x64.dll`；本机部署已把官方 `libcrypto-4-x64.dll` 原样复制为 `libcrypto-3-x64.dll`，见 `E:\LovelyCarve\DEPLOYMENT.md`。
- 版本敏感：v1.3.0 已移除 `cli search`、`tools`、`docs search/list/get`（旧脚本按退出码 1 失败）。
- 只读物理盘、采集内存、Dokan 挂载需要**管理员**终端；普通镜像/文件夹分析不需要。

## 1 · 心智模型（五条，先立住再敲命令）

1. **语法固定**：`lovelycarve-cli [全局选项] <集合> <子集合…> <动词> [主体] [选项]`。动词表固定（`get/list/count/create/update/edit/delete/open/close/read/export/hash/identify/search/scan/detect/lookup/unlock/lock/assemble/build/audit/start/pause/resume/restart/cancel/wait/release/share/unshare/reveal/set/use/attach/serve`）。`list`、`count` **不接受位置参数**。
2. **绝对路径必须带卷段**（实测）：`/` 只列分区/卷；文件路径是 `/<分区或卷>/…`，例如 `/part:0/WINDOWS/...`、LVM 里 `/part:1/root/etc/...`。**写成 `/WINDOWS/...` 会 `notFound`**（错误信息写"/ 下找不到"）。首段可写节点 ID（`part:0`），也可写显示名——但显示名会被归一化（空格、括号、`·` → `_`，合成节点是中文如 `分区0`、`未使用空间1`），**以 `files list` 返回的 `name`/`id` 为准**。
3. **ID 优先于路径**：重名、已删除条目、NTFS 数据流、特殊节点用 `--node-id <id>`（取自 `items[].id` / 索引的 `nid`）。ID 精确指向且**不跟随符号链接**；路径像 shell 一样跟随（中间必跟随，末尾由读/哈希/导出类命令跟随）。
4. **四种执行载体，按"状态是否要跨命令存活"选**：

| 载体 | 形态 | 状态存活 | 适用 |
| --- | --- | --- | --- |
| 一次性 | `--image <路径> <集合> <动词>` | 进程内，退出即丢 | 单次读/查/哈希，最省事 |
| 常驻会话 | `sessions open exam` → `--session exam …` | 跨进程（后台进程活着） | 多轮连续调查 |
| shell | `shell` + 管道脚本 | 单进程内全存活 | 多步脚本，出错即停 |
| JSONL 会话 | `session` + 每行一请求 | 单进程内全存活，可 `--jobs` 并发 | 批量、`$ref` 串接、并发 |

> **解锁的卷、组装的阵列、雕刻/恢复扫描、挂载点全在内存**：必须在同一进程内完成"解锁→浏览→导出"。工具链会回收子进程时常驻会话报 `sessionExited`，改用 `shell` 或 `session`。

5. **两套"索引"别混**：`indexes list`（案件级，列每卷索引状态）与 `indexes files list`（按卷查元数据，要 `--image`）。索引只覆盖**元数据**；内容检索走 `files search`，是另一条路径。

## 2 · 标准开工序列（每次调查都走）

```bash
# ① 建案（索引/搜索/时间线/分析结果都落在案件里；不给案件＝索引退出即丢）
"$LC" -q cases create "E:\cases\2026-001" --name "案例名" --case-number "LC-001" --examiner "检验人"
# ② 开检材（登记进案件并自动起后台快照+索引）
"$LC" -q --case "E:\cases\2026-001" images open "E:\evidence\disk.E01"
# ③ 等后台任务（只表示跑完，不代表成功）
"$LC" -q --case "E:\cases\2026-001" tasks wait
# ④ 验索引：indexed=true && stale=false && truncated=false
"$LC" -q --case "E:\cases\2026-001" --image "E:\evidence\disk.E01" indexes list
# ⑤ 看卷与卷键（检索范围参数从这里取）
"$LC" -q --case "C" --image "I" indexes volumes list
# ⑥ 定位文件（先索引按名，别递归 dump）
"$LC" -q --case "C" --image "I" files list --path / --fields name,id,kind,size
# ⑦ 读内容（文本 text get；字节 read/export）
"$LC" -q --case "C" --image "I" files text get --path "/part:0/etc/os-release" --max-bytes 65536
```

- 索引缺失/过期：`indexes volumes list` 取 `volumeKey` → `indexes create --volume-key <键>` → `tasks wait` → 再验。
- `indexes volumes list`、`indexes files list`、`searches`、`files search` **要同时给 `--case` 和 `--image`**（只给案件报 `noImage`）；`indexes list` 是案件级、不吃 `imageId`。
- 不支持的卷（加密、未知 FS、索引器不支持）**单独记为覆盖限制**，不能算"没有证据"。
- 收尾：自己开的会话 `sessions close exam`；用户已有会话默认不关。

## 3 · 任务 → 命令速查

| 我要… | 命令（省前缀 `"$LC" -q --case <C> --image <I>`） |
| --- | --- |
| 看检材概况 | `images get`（`partitions`/`sizeBytes`/`sectorSize`/`ewf` 采集记录） |
| 认平台/系统 | `images os detect`（实测认到"Microsoft Windows XP"；**LVM 上的 Linux 可能 `detections` 为空**） |
| 列目录 | `files list --path "/part:0/Users" --page-size 100 --fields name,id,kind,size` |
| 递归找名（有界） | `files tree list --path "/part:0" --depth 4 --name report --limit 500` |
| 按通配找名（最快） | `indexes files list --volume-key part:0 --filter '{"nameGlob":"*.evt","limit":100,"offset":0}'` |
| 按内容搜 | `files search 关键词 "/part:0/Users" --ignore-case --limit 200` |
| 读文本 | `files text get --path <p> --max-bytes 65536`（`nextOffset` 非空则 `--offset` 续读） |
| 指定编码 | `files text get --path <p> --encoding gbk\|big5\|utf-16le\|…` |
| 原始字节 | `files read --path <p> --offset 0 --length 4096` |
| 属性/时间 | `files get --path <p>`（`timestamps` 已转换；`timestampsOriginal` 为原值） |
| 哈希 | `files hash --path <p> --algos md5 sha256`；整盘 `images hash --algorithms md5` |
| 类型识别 | `files identify --path <p>` |
| 二进制日志取串 | `files strings list --node-id <id> --encoding utf-16le --min-length 10` |
| 结构解析 | `files sqlite get/rows list`、`files zip get/members get`、`files csv get`、`files usn-journal records list`、`files ext4-journal get`、`files binary get` |
| 导出单文件 | `files export --path <p> --destination "E:\out\x.bin"`（父目录必须先存在） |
| 导出目录 | `files directories export --path <d> --mode zip --destination "E:\out\d.zip"` |
| 删除文件恢复 | `carve scans create --options '{"scope":"partition","partition_id":0,"filesystems":{"ntfs":true},"signatures":false}'` → `tasks wait` → `carve files list --scan-id <id>` → `carve scans export` |
| 签名雕刻 | `carve scans create --options '{"scope":"range","start_sector":N,"sector_count":M,"format_ids":["jpg","png","pdf"],"signatures":true}'` |
| BitLocker | `bitlocker metadata get 0` → `bitlocker unlock 0 --recovery-password @k.txt` → `bitlocker export 0 --destination …` |
| LUKS/VeraCrypt/FileVault | `encrypted-volumes unlock --options @unlock.json` → `context use <image.id>` 或 `images open <image.path>` |
| iOS 加密备份 | `ios-backups unlock --password @pw.txt` → 子会话浏览；`ios-backups audit` |
| RAID/LVM | 同进程 `images open` 各成员 → `raid detect` → `context use <assembledImageId>` |
| 卷影副本 | `shadow-copies list` → `shadow-copies open <分区> --index <n>` |
| 插件分析 | `plugins systems list` → `plugins functions list` → `plugins tasks create --function <id> --system-id <系统ID>` → `tasks wait` → `analysis tree get` → `analysis records list --run-id <r> --record-type <t>` |
| 时间线 | `timeline build` → `timeline range get` → `timeline types list` → `timeline events list --query '{…}' --skip 0 --limit 100` |
| 时区 | `timezones get` → `--timezone Asia/Shanghai`（显式指定后 `timestampDisplay.timeZone.source="command"`） |
| 后台任务 | `tasks list` / `tasks get <id>` / `tasks cancel <id>` / `tasks wait` |
| 坏区审计 | `images bad-regions list` |

## 4 · 效率开关（决定 10 倍差距）

1. **一律 `-q` + `LOVELYCARVE_AGENT=1`**：否则进度行 + 人类版缩进 JSON 翻倍占输出。
2. **`--fields` 只投影列表字段**（仅 `list`/`search`；`get` 用会报 `usage`）：`--fields name,id,kind,size`。分页元数据照常保留。
3. **先索后扫**：`indexes files list --filter` 在分页前过滤（SQLite GLOB 语义：整名匹配、忽略大小写、`*`/`?`/`[a-z]`，`**` 无递归含义；目录范围另给 `pathPrefix`，拼写取自返回的 `fullPath`）。实测：8.6 GB 的 XP 盘两卷共 15,802 条元数据，`*.pf` 查询毫秒级。
4. **有界读取**：目录 `--page-size`（1–5000）；树 `--depth`/`--limit`；文本 `--max-bytes`（单段 2 MiB，`--offset` 是**字节偏移**）；命中 `--limit`。
5. **一次进程做多步**：`session` JSONL 支持 `--jobs 1..64`（查询可重叠；状态变更与 `tasks wait` 是屏障），用 `{"$ref":"<id>#/…"}` 引用上一步结果。**JSONL 里 Windows 路径必须写正斜杠** `E:/x/y.raw`——`E:\x` 会报 `invalidInput: invalid escape`（实测），该行失败但后续行继续。
6. **不要用 `--help` 逐层探索**：`schema <命令>` 给请求结构，`<命令> --help` 看单命令选项，`schema --list` 列全部；完整清单见 `references/commands.md`。
7. **大结果落盘**：JSONL 顶层 `output` 或命令 `--destination`，再按需读片段；单条 JSONL 16 MiB 上限。

## 5 · 判读：退出码与"结果可信度"

| 退出 | 含义 | 必须做什么 |
| --- | --- | --- |
| `0` | 成功且完整 | 仍看任务结局与覆盖范围 |
| `1` | 失败（`notFound`/`alreadyExists`/`isDirectory`/`usage`/`sessionExited`/后台任务失败） | 按 `error.code` 分支，别原样重试 |
| `2` | **完成但结果不完整**（补零坏区、命中上限、导出提前停止） | 结果可用，**必须标注不完整**并给字段 |
| `130` | 中断 | 不当成"没有结果" |

- 代理模式 stderr 是**单行 JSON**：`{"error":{"code","message","details","ipcCommand"}}`；不完整时 stdout 结果后另有 `{"warning":{"code":"incompleteResult",…}}`。
- `readFaultsDetected=true` / `badRegions` 非空 / `syntheticBytes>0` ⇒ 哈希或导出**含合成零字节**，不能用于完整性论证；`truncated=false` **不代表**没有读故障。
- `files read` 遇读故障直接失败（1）且可能已写出部分/补零字节 ⇒ **丢弃 stdout**，改用 `files export` 保留审计。
- **错误信息本身可能是错的**（实测）：`files sqlite get` 对普通 `IconCache.db` 报 `SQLITE_LOCKED: 数据库已加密，请提供密钥`；`files usn-journal` 在 XP 上返回**空数组而非报错**（XP 没有 USN 日志）。**错误/空结果都要回到"该机制在该系统上是否存在"再下结论。**
- 语义边界（报告必须带）：目录页、`truncated:true` 的有界遍历、`--limit` 上限、索引 `truncated`、搜索读错误/命中上限、时间线 `skippedInvalidTime`，都**不能**支撑"不存在"。缺源字节、索引失败、格式不支持同理。

## 6 · 真实检材实测基线（v1.3.0，本机）

| 场景 | 实测结果 |
| --- | --- |
| 640 MB E01（2010 年 Windows XP 盘，8.6 GB 逻辑、MBR、双 NTFS、3 分段、内置 MD5） | `images open` 0.6 s；两卷元数据索引 13,454 + 2,348 条；`*.pf` 命中真实 Prefetch |
| `images hash --algorithms md5` | 8.6 GB / 11.4 s，结果 `fc907ecf…` **与 E01 采集记录 `storedMd5` 完全一致** |
| NTFS 删除记录恢复（`scope:partition`，只开 ntfs） | 10 s 扫完 5.2 GB / 16,168 条记录，产出 **2,713 个已删除文件 + 1,105 个已删除目录**，`readFaults` 全 0 |
| 恢复导出 | 3 个文件 34 MB，树形还原 `v0-NTFS/…`，`recovery-report.jsonl` 的 `sha256` 与落盘文件**逐字节一致**；孤儿文件落在 `/$Parent-<inode>/` |
| 签名雕刻（range 200 MB，jpg/png/pdf） | 0.45 s 出 81 个 artifact，`confidence` 100，带 `offset`/`length` |
| 1.4 GB E01（CentOS 7：XFS `/boot` + LVM swap/root-xfs） | 3.7 s 打开；`/part:1` 列出 `root`、`swap` 两个 LV；`/etc/os-release` 读出 `CentOS Linux 7 (Core)` |
| 时区自动识别 | **Windows 盘与 LVM 上的 Linux 根卷都回退 UTC**；该机 `/etc/localtime → …/Asia/Shanghai` 仍未被自动采用；显式 `--timezone` 后 +08:00 且 `source=command` |
| 插件/平台识别 | 该 CentOS 检材 `images os detect` 的 `detections` 为空、`plugins systems list` 返回 `[]` ⇒ 插件无法启动，需回落普通文件命令 |
| 时间线 | 15,802 条文件事件，`skippedInvalidTime=4`；事件 `content` 中非 ASCII 文件名出现 mojibake（用 `oid` 定位，别用字符串比对） |

**本轮未实测（本机无样本/无口令，用到时按文档执行并标注"未在本机验证"）**：BitLocker 解锁与导出、LUKS/VeraCrypt/FileVault 解锁、多盘 RAID 组装、APFS/HFS+、iOS 加密备份、卷影副本打开、Dokan 挂载、物理盘与内存采集、签名雕刻之外的全格式覆盖。
复跑本表：`python test/verify_real.py`（20 条断言，纯标准库，只读检材；自建临时案件、结束自动删除；路径可用 `XP_IMAGE` / `LNX_IMAGE` / `LC` 覆盖）。

## 7 · 实测踩到的坑（都会让人得出错误结论）

| 症状 | 真相与处置 |
| --- | --- |
| `/WINDOWS/...` 报 `notFound` | 绝对路径**必须带卷段**：`/part:0/WINDOWS/...`；LVM 是 `/part:N/<LV名>/...` |
| `--with-source` 报 `usage: 未知选项` | 它是**命令选项**，必须写在命令之后：`files get --path … --with-source`；返回 `{result, source}`（caseId/evidencePath/imageId/nodeId）；`result.path` 是显示名（`/分区0/…`），不是输入 ID 形式 |
| 找不到 `.evtx` 就以为没日志 | XP 是 `WINDOWS/system32/config/*.Evt`（二进制、UTF-16LE）；Vista+ 才是 `winevt/Logs/*.evtx`。先 `images os detect` 定系统版本再选工件 |
| 二进制日志 strings 读不出 | 加 `--encoding utf-16le`；实测能读出 `wuaueng.dll`、`SecurityCenter` 等串 |
| `carve scans export` 顶层 `recovered:0` | 顶层计数只描述**雕刻**结果；文件系统记录在 `files.recovered`（实测 3）。别把 0 当没恢复 |
| 恢复结果出现 `/$Parent-1234/xxx.sys` | 父目录已删除/不可定位的**孤儿文件**，不能当原路径引用；原路径以报告 `candidate.path` 为准并注明"父目录丢失" |
| `alreadyExists` | 导出**从不覆盖**；`--mode tree` 连空目录都拒。批量导出每次换新目录 |
| `internal (os error 3)` | 导出目标**父目录不存在**（不是"已存在"）。先建父目录 |
| `noImage` | `indexes volumes list`/`indexes files list`/`searches`/`files search` **要同时给 `--case` 和 `--image`** |
| `sessionExited` | 后台进程已死，内存态（解锁/组装/扫描/目录）全丢；重开重建，或改 `shell`/`session` |
| 时间"被改成 UTC" | `auto` 找不到检材时区就回退 UTC（**Windows 必然如此；LVM 上的 Linux 实测也如此**）；先 `files get /etc/localtime` 看 `linkTarget`，再 `--timezone` 指定并在报告写来源 |
| 插件跑不起来 | `plugins systems list` 为空（实测 LVM/XFS 的 CentOS）⇒ 不等插件，改用 `/etc/passwd`、`/var/lib/dpkg/status`、`crontab`、`/var/log` 等普通文件取证，并记为"插件未覆盖" |
| Git Bash 下 `--path /` 变味 | MSYS 把 `/…` 改写成 Windows 路径；加 `MSYS2_ARG_CONV_EXCL='*'`（`--dry-run` 显示的也是还原前原样） |
| 导出"成功"但 E 盘找不到文件 | 在 Git Bash 里把主机路径写成 `/e/out/x`，Windows 程序解析成 `<当前盘>:\e\out\x`（实测落到 `E:\e\…`，**且不报错**） | 主机路径一律写 Windows 形式：`E:/out/x` 或 `E:\out\x` |
| `cases evidence delete` 报 `notFound` 或 `未知参数：force` | 它要求**同一进程内先 `images open`**，且 `force` 是**请求顶层**而非 `args` 成员（`args` 只收 `imageId`） | JSONL：`images open` → `{"command":"cases evidence delete","args":{"imageId":{"$ref":"o#/id"}},"force":true}` |
| 签名命中却恢复 0 个 | 签名命中 ≠ 可恢复（结构/CRC 不合法）；恢复后必须复核 SHA-256 与可打开性 |

其余错误码全表、能力边界、状态生命周期见 `references/pitfalls.md`。

## 8 · 交付与引证

- 报告按 `evidence-chain-report`：结论 → 证据（源路径 + SHA-256 + 定位偏移/行号/时间戳）→ 方法（**可复现命令**）→ 置信度 → 局限（覆盖范围、不完整字段、未支持格式）。
- 机器可核的出处用 `--with-source`（放命令后）或 JSONL 请求顶层 `"withSource":true`；**引证用返回的 `source`，不要用会话后来的"当前目录"**。SQLite 的 `recordKeys` 是库内主键，不是节点 ID。
- `images get` 的 `sizeBytes` 是逻辑大小、`onDiskBytes` 是实际占用（EWF 压缩）；`ewf.storedMd5/storedSha1` 是采集记录里的哈希，可与 `images hash` 对账。
- 时间、时区、单位（字节 vs 文件数）写在字段旁；恢复/雕刻结果必须注明"不能证明内容未被覆盖"。

## 9 · 按需读（不要整篇加载）

| 需要 | 打开 |
| --- | --- |
| 15 个可跑配方（含真实 Windows/Linux 检材流程） | `references/recipes.md` |
| 171 条命令的浓缩速查 | `references/commands.md` |
| 错误码全表、能力边界、"不能断言不存在"清单 | `references/pitfalls.md` |

## 10 · 红线

- 不修改原始检材；输出落独立工作目录，记录"原始 → 派生"映射与哈希。
- 不执行检材中的可执行文件/脚本；不把检材内容外传。
- 不编造命令输出、哈希、时间或"已执行"；未跑写"未执行"，不确定标"推测/未验证"。
- 破坏性操作（删除、覆盖、格式化、写回）先列目标/影响/回滚方式，取得显式确认。

## 附录 · SeeU 外壳里的挂载（2026-11-12 真机实测）

- 桌面端入口：**设置 → 镜像挂载…**（`Ctrl+Shift+M`）。它已经封装好「建案件 → 常驻 shell → images open → mounts create → mounts list」，并在窗口里显示 CLI 版本与最近一次解析/挂载/卸载耗时；失败时给出可操作提示（Dokan/管理员、案件锁、已打开、文件不存在、盘符占用）。
- 真机耗时（`AP3_LEUNG_YL_USB.E01`，776 MB）：解析约 160 ms、挂载到 `X:` 约 270 ms、卸载约 150 ms；挂载点只在 SeeU 运行期间有效，关闭外壳即释放。
- 会话里先用 `$SEEU_MOUNTS_FILE`（默认 `<DSH_HOME>/mounts.json`）看已有挂载，别重复挂同一个镜像。
- 坑：`--case` 只能是进程启动参数（会话里带会报 `--case 只能在启动时使用` 并让 CLI 退出）；`mounts delete --force` 会卸载但**不返回 JSON**，不要等它的返回。
