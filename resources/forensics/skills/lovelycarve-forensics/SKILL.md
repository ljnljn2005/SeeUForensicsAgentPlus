---
name: lovelycarve-forensics
display_name: LovelyCarve 取证分析
display_name_en: LovelyCarve Forensics
description: 用 LovelyCarve CLI 对磁盘镜像、分区、文件夹、归档、备份与加密容器做只读取证分析：建案建索引、按名/按内容检索、读文本与解析格式、雕刻恢复删除文件、解锁 BitLocker/LUKS/VeraCrypt、组装 RAID/LVM、跑插件分析与时间线、哈希与导出。含本机部署路径、精确命令、退出码语义与常见坑处置。触发词：LovelyCarve、lovelycarve-cli、镜像分析、文件雕刻、carving、签名雕刻、磁盘取证、镜像浏览、BitLocker 解锁、LUKS 解锁、RAID 组装、卷索引、时间线、E01 分析。
description_zh: "LovelyCarve（lovelycarve-cli）取证操作手册：只读浏览镜像与分区、建案建卷索引、文件名通配与内容检索、文本/编码读取与格式解析、删除文件恢复与签名雕刻、BitLocker/LUKS/VeraCrypt/iOS 备份解锁、RAID/LVM 组装、插件分析与时间线、哈希导出与读故障审计；含退出码语义、效率开关与 20 余条常见坑。"
description_en: "Operating manual for LovelyCarve CLI forensic analysis: read-only image and partition browsing, case and volume indexes, filename glob and content search, text decoding and format parsing, deleted-file recovery and signature carving, BitLocker/LUKS/VeraCrypt/iOS backup unlocking, RAID/LVM assembly, plugin analysis, timelines, hashing and export with read-fault auditing; includes exit-code semantics, output-efficiency switches and 20+ pitfalls."
version: 1.0.0
author: AI_工具开发者
category: coding
allowed-tools: Read, Write, Edit, Bash
whenToUse: 用户给出磁盘/分区镜像（E01、RAW、VMDK、VHDX、QCOW2、dd 分片等）、检材文件夹、归档、iOS/Android 备份或加密容器，要求浏览、检索、提取、恢复、解锁、组装、出时间线或做哈希导出时；或明确提到 LovelyCarve / lovelycarve-cli / 雕刻 / carving。
---

# LovelyCarve 取证分析（lovelycarve-forensics）

一条原则：**证据只读，结论可复核，未执行就写未执行**。本技能给的是「一次就对」的命令与判据，不要靠逐层翻 `--help` 摸索。

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
- 版本敏感：v1.3.0 已移除 `cli search`、`tools`、`docs search/list/get`（旧脚本按退出码 1 失败）。用 `--help` / `schema` / 本技能替代。
- 只读物理盘、采集内存、Dokan 挂载需要**管理员**终端；普通镜像/文件夹分析不需要。

## 1 · 心智模型（四条，先立住再敲命令）

1. **语法固定**：`lovelycarve-cli [全局选项] <集合> <子集合…> <动词> [主体] [选项]`。动词表固定：`get / list / count / create / update / edit / delete / open / close / read / export / hash / identify / search / scan / detect / lookup / unlock / lock / assemble / build / audit / start / pause / resume / restart / cancel / wait / release / share / unshare / reveal / set / use / attach / serve`。`list`、`count` **不接受位置参数**（路径写 `--path`）。
2. **路径模型**：`/` 是检材合成根（列出分区/卷）→ `/<卷名>/…`。首段可直接写根节点 ID，如 `/part:0/Windows/...`。卷入口名会把空格、括号、`·` 归一为 `_`（`ext4 (md · host:0)` → `ext4_md_host_0`），**以 `files list` 返回的 `name` 为准，不要自己拼**。
3. **ID 优先于路径**：重名文件、已删除条目、NTFS 数据流、特殊节点一律用 `--node-id <id>`（取自 `items[].id`）。ID 是精确指向，**不跟随符号链接**；路径则像 shell 一样跟随（中间必跟随，末尾由读/哈希/导出类命令跟随）。
4. **四种执行载体，按"状态是否需要跨命令存活"选**：

| 载体 | 命令形态 | 状态存活 | 适用 |
| --- | --- | --- | --- |
| 一次性 | `--image <路径> <集合> <动词>` | 进程内，退出即丢 | 单次读/查/哈希，最省事 |
| 常驻会话 | `sessions open exam` → `--session exam …` | 跨进程（后台进程活着） | 多轮连续调查，复用已开检材与缓存 |
| 交互/脚本 shell | `shell` + 管道脚本 | 单进程内全存活 | 多步脚本，一步失败即停 |
| JSONL 会话 | `session` + 每行一个请求 | 单进程内全存活，可 `--jobs` 并发 | 批量、带 `$ref` 串接、需并发 |

> **解锁的卷、组装的阵列、雕刻扫描、恢复扫描、挂载点全在内存里**：必须在同一个 `shell` / `session` / 常驻会话里完成"解锁→浏览→导出"，换进程就要重来。工具链会回收子进程时（后台进程被清理），常驻会话会报 `sessionExited`，改用 `shell` 管道或 `session` JSONL。

## 2 · 标准开工序列（每次调查都走，不许跳）

```bash
# ① 建案（索引/搜索/时间线/分析结果都落在案件里；不给案件 = 索引退出即丢）
"$LC" -q cases create "E:\cases\2026-001" --name "案例名" --case-number "LC-001" --examiner "检验人"
# ② 开检材（登记进案件并自动起后台建索引）
"$LC" -q --case "E:\cases\2026-001" images open "E:\evidence\disk.E01"
# ③ 等后台任务（自动识别平台、卷快照、索引）
"$LC" -q --case "E:\cases\2026-001" tasks wait
# ④ 验索引：indexed=true && stale=false && truncated=false 才算就绪
"$LC" -q --case "E:\cases\2026-001" --image "E:\evidence\disk.E01" indexes list
# ⑤ 看卷与卷键（检索/meta 查询的范围参数从这里取）
"$LC" -q --case "E:\cases\2026-001" --image "E:\evidence\disk.E01" indexes volumes list
# ⑥ 定位文件（先索引按名，别递归 dump）
"$LC" -q --case "E:\cases\2026-001" --image "E:\evidence\disk.E01" files list --path / --fields name,id,kind,size
# ⑦ 读内容（文本用 text get，字节用 read/export）
"$LC" -q --case "E:\cases\2026-001" --image "E:\evidence\disk.E01" files text get --path "/卷名/路径.txt" --max-bytes 65536
```

判据与例外：

- `tasks wait` **只表示跑完，不表示成功**（被取消的任务不会让它失败）——必须再看 `indexes list` / 具体结果。
- 索引缺失或过期：`indexes volumes list` 取 `volumeKey` → `indexes create --volume-key <键>` → 再 `tasks wait` → 再验。
- **`indexes volumes list` / `indexes files list` / `searches` / `files search` 要同时给 `--case` 和 `--image`**（只给案件会报 `noImage`）；**`indexes list` 是案件级**，不吃 `imageId`。
- 不支持的卷（加密、未知文件系统、索引器不支持）**单独记为覆盖限制**，不能算"没有证据"。
- 收尾：自己开的会话 `sessions close exam`；用户已有会话默认不关。

## 3 · 任务 → 命令速查（照抄即可）

| 我要… | 命令（省略前缀 `"$LC" -q --case <C> --image <I>`） |
| --- | --- |
| 看检材概况 | `images get`（`partitions`/`sizeBytes`/`sectorSize`/`ewf`/`opticalDisc`） |
| 列目录 | `files list --path "/卷名/dir" --page-size 100 --fields name,id,kind,size` |
| 递归找名（有界） | `files tree list --path "/卷名" --depth 4 --name report --limit 500` |
| 按通配找名（最快） | `indexes files list --volume-key <键> --filter '{"nameGlob":"auth*.log.*","kinds":["file"],"limit":100,"offset":0}'` |
| 按内容搜 | `files search 关键词 "/卷名/Users" --ignore-case --limit 200` |
| 读文本（自动编码） | `files text get --path <p> --max-bytes 65536`（`nextOffset` 非空则 `--offset` 续读） |
| 读指定编码 | `files text get --path <p> --encoding gbk`（`gbk`/`gb18030`/`big5`/`shift_jis`/`utf-16le`） |
| 取原始字节 | `files read --path <p> --offset 0 --length 4096`（输出到 stdout，可重定向） |
| 文件属性/时间 | `files get --path <p>`（`timestamps` 已按时区转换，`timestampsOriginal` 为原值） |
| 哈希 | `files hash --path <p> --algos md5 sha256`；整盘 `images hash --algorithms sha256` |
| 类型识别（不看扩展名） | `files identify --path <p>` |
| 字符串/熵/数据运行 | `files strings list --path <p> --min-length 6`；`files content get --path <p>` |
| 解析结构 | `files sqlite get/rows list …`、`files zip get/members get`、`files csv get`、`files usn-journal records list`、`files ext4-journal get`、`files binary get` |
| 导出单文件 | `files export --path <p> --destination "E:\out\x.bin"`（父目录必须先存在） |
| 导出目录 | `files directories export --path "/卷名/dir" --mode zip --destination "E:\out\d.zip"` |
| 删除文件恢复/雕刻 | `carve scans create --options '{"scope":"whole","filesystems":{"ntfs":true},"signatures":false}'` → `tasks wait` → `carve files list --scan-id <id>` → `carve scans export <id> --options '{...}'` |
| 签名雕刻 | 同上，`{"scope":"whole","format_ids":["png","pdf","jpg"],"signatures":true}`（`filesystems` 缺省全关＝只雕刻） |
| BitLocker | `bitlocker metadata get 0` → `bitlocker unlock 0 --recovery-password @key.txt` → `files list --path /`；导出 `bitlocker export 0 --destination …` |
| LUKS/VeraCrypt/FileVault | `encrypted-volumes unlock --options @unlock.json` → `images open <返回的 image.path>` 或 `context use <image.id>` |
| iOS 加密备份 | `ios-backups unlock --password @pw.txt` → 用返回子会话浏览；`ios-backups audit` 出异常观察 |
| RAID/LVM | 同一进程内 `images open` 各成员盘 → `raid detect` → `context use <assembledImageId>` |
| 卷影副本 | `shadow-copies list` → `shadow-copies open <分区> --index <n>` |
| 插件分析 | `plugins systems list` → `plugins functions list` → `plugins tasks create --function <id> --system-id <系统ID>` → `tasks wait` → `analysis tree get` → `analysis records list --run-id <r> --record-type <t>` |
| 时间线 | `timeline build` → `timeline range get` → `timeline types list` → `timeline events list --query '{"time_zone_hours":0,"time_unit":"day",...}' --skip 0 --limit 100` |
| 时区 | `timezones get` → `--timezone Asia/Shanghai`（或 `timezones set <zone> --scope case\|image`） |
| 后台任务 | `tasks list` / `tasks get <id>` / `tasks cancel <id>` / `tasks wait` |
| 坏区审计 | `images bad-regions list` |

## 4 · 效率开关（这几条决定 10 倍差距）

1. **一律 `-q` + `LOVELYCARVE_AGENT=1`**：否则进度行与人类版 JSON 会翻倍占输出。
2. **`--fields` 只投影列表字段**（仅 `list` / `search` 生效，`get` 会报 `usage`）：`--fields name,id,kind,size`。分页元数据（`nextCursor`/`total`/`truncated`）照常保留。
3. **先索后扫**：`indexes files list --filter` 在分页前过滤，比"逐页列目录 + jq 筛"快几个数量级；`nameGlob` 是 SQLite GLOB（整名匹配、忽略大小写、`*`/`?`/`[a-z]`，`**` 无递归含义），目录范围另给 `pathPrefix`（拼写取自返回的 `fullPath`）。
4. **有界读取**：目录 `--page-size`（1–5000，默认 agent 50）；树 `--depth`/`--limit`；文本 `--max-bytes`（单段 2 MiB）；命中 `--limit`。
5. **一次进程做多步**：`session` JSONL 支持 `--jobs 1..64` 并发（查询可重叠，状态变更与 `tasks wait` 是屏障），并用 `{"$ref":"<id>#/…"}` 直接引用上一步结果，免抄 ID。**JSONL 里的 Windows 路径必须写 `E:/x/y.raw` 正斜杠**——`E:\x` 会被当非法转义，整行报 `invalidInput: invalid escape`（实测），后续行仍会继续执行。
6. **不要用 `--help` 逐层探索**：`schema <命令>` 给请求结构，`<命令> --help` 给单命令选项；`schema --list` 列全部。完整命令清单见 `references/commands.md`。
7. **别把大结果塞进上下文**：JSONL 顶层 `output` 或命令 `--destination` 落盘，再按需读片段；单条 JSONL 16 MiB 上限。

## 5 · 判读：退出码与"结果可信度"

| 退出 | 含义 | 必须做什么 |
| --- | --- | --- |
| `0` | 成功且完整 | 仍要看任务结局与覆盖范围 |
| `1` | 失败（含 `notFound`、`alreadyExists`、`isDirectory`、`usage`、`sessionExited`、后台任务失败） | 按 `error.code` 分支处置，不要重试同一参数 |
| `2` | **命令完成但结果不完整**（补零坏区、命中上限、导出提前停止） | 结果可用，但**必须在报告里标注不完整**并给字段 |
| `130` | 被中断 | 不要当成"没有结果" |

- 代理模式下 stderr 是**单行 JSON**：`{"error":{"code":…,"message":…,"details":…}}`，不完整时 stdout 结果后另有 `{"warning":{"code":"incompleteResult",…}}`。
- `readFaultsDetected=true` / `badRegions` 非空 / `syntheticBytes>0` ⇒ 该哈希或导出**含合成零字节**，不能用于完整性论证；`truncated=false` **不代表**没有读故障。
- `files read` 遇读故障直接失败（退出 1）且可能已写出部分/补零字节 ⇒ **丢弃 stdout**，改用 `files export` 保留容错数据+审计。
- 语义边界（写报告必须带）：目录页、有界树遍历、`--limit` 上限、索引 `truncated`、搜索读错误/命中上限、时间线 `skippedInvalidTime` —— 这些都**不能**支撑"不存在"的结论。缺源字节、索引失败、格式不支持同样不能。

## 6 · 必避的八个坑（全表见 `references/pitfalls.md`）

| 症状 | 真相与处置 |
| --- | --- |
| `alreadyExists` | 导出**从不覆盖**；`--mode tree` 连空目录都拒。批量导出每次换新目录。 |
| `internal (os error 3)` | 导出目标的**父目录不存在**（不是"已存在"）。先建父目录。 |
| `noImage` | `indexes` / `searches` 查询**同时**要 `--case` 和 `--image`。 |
| 路径 `notFound` / 卷名对不上 | 卷名会把空格、括号、`·` 归一为 `_`；以 `files list` 的 `name` 为准，或直接用 `--node-id`。 |
| Git Bash 下 `--path /` 变味 | MSYS 把 `/…` 改写成 Windows 路径；加 `MSYS2_ARG_CONV_EXCL='*'`（`--dry-run` 显示的也是还原前原样）。 |
| `sessionExited` | 后台进程已死，内存态（解锁/组装/扫描/目录）全丢；重开重建，或改用 `shell` / `session` 单进程完成。 |
| 时间被"改成 UTC" | `auto` 找不到检材时区时**回退 UTC**（显示回退，不是证据用 UTC）；报告写 `timestampDisplay.timeZone.source`，必要时 `--timezone` 显式指定。 |
| 签名命中却恢复 0 个 | 签名命中 ≠ 可恢复（结构/CRC 不合法）；恢复后必须复核 SHA-256 与可打开性。 |

另六条（同一份 pitfalls 里有完整处置）：索引未就绪（`indexed/stale/truncated`）时检索不可信；`files search` 需案件+索引+源可读三者齐；雕刻/恢复/解锁/挂载/组装全在内存、退出即失；密码用 `@file`/stdin 不进命令行；加密卷"打不开≠密码错"（不支持的布局要记限制）；删除类命令非交互必须 `--force`（先 `--dry-run`）。


## 7 · 交付与引证

- 报告按 `evidence-chain-report` 结构：结论 → 证据（源路径 + SHA-256 + 定位偏移/行号/时间戳）→ 方法（**可复现命令**）→ 置信度 → 局限（覆盖范围、不完整字段、未支持格式）。
- 需要机器可核的出处时加 `--with-source`（普通命令）或请求顶层 `"withSource":true`（JSONL）：返回 `{"source":{…},"result":…}`，含检材路径、imageId、nodeId、卷/证据内路径与读取范围。**引证用 source，不要用会话后来的"当前目录"。**
- SQLite 等数据库记录的 `recordKeys` 是**库内主键**，不是文件系统节点 ID，不得拼成节点 ID 引用。
- 时间、时区、单位（字节数 vs 文件数）都要写在字段旁；`images get` 的 `sizeBytes` 是逻辑大小。

## 8 · 按需读（不要整篇加载）

| 需要 | 打开 |
| --- | --- |
| 完整可跑场景配方（建案到出报告、解锁、组装、雕刻、时间线） | `references/recipes.md` |
| 精确命令与选项（按集合索引，60+ 高频命令） | `references/commands.md` |
| 错误码全表、边界断言、格式与平台限制 | `references/pitfalls.md` |

## 9 · 红线

- 不修改原始检材；一切输出落独立工作目录，并记录"原始 → 派生"映射与哈希。
- 不执行检材中的可执行文件/脚本；不把检材内容外传。
- 不编造命令输出、哈希、时间或"已执行"；未跑就写"未执行"，不确定就标"推测/未验证"。
- 破坏性操作（删除、覆盖、格式化、写回）先列目标/影响/回滚方式，取得显式确认。
