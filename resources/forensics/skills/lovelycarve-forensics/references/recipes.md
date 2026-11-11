# LovelyCarve 可跑配方（recipes）

> 约定：`LC` = `lovelycarve-cli.exe` 绝对路径；`C` = 案件目录；`I` = 检材路径或 imageId；`V` = 卷入口（`/part:0`、LVM 下的 `/part:1/root`，取自 `files list`）。
> **本版全部配方都在真实检材上跑过**（2010 年 Windows XP 盘 E01、CentOS 7 服务器 E01、8 KB 合成夹具），标注的数字是实测值。内联 JSON 在 PowerShell 里存 UTF-8 文件用 `@文件` 传；JSONL 里的 Windows 路径写正斜杠。

## R1 · 镜像初查（Windows 盘，实测 0.6 秒打开）

```bash
"$LC" -q cases create "$C" --name "初查" --case-number "LC-001"
"$LC" -q --case "$C" images open "$I"                     # 登记进案件并自动起快照+索引
"$LC" -q --case "$C" --image "$I" tasks wait              # 只表示跑完，不代表成功
"$LC" -q --case "$C" --image "$I" indexes list            # 每卷 indexed/stale/truncated + entryCount
"$LC" -q --case "$C" --image "$I" images get              # 分区表/扇区/逻辑大小/EWF 采集记录
"$LC" -q --case "$C" --image "$I" images os detect        # 系统版本（决定后面选 .evt 还是 .evtx）
"$LC" -q --case "$C" --image "$I" files list --path / --fields name,kind
# 进分区：路径必须带卷段
"$LC" -q --case "$C" --image "$I" files list --path /part:0 --page-size 30 --fields name,id,kind,size
```

实测（`E:\作业\李自勇泄密案\disk.E01`，640 MB / 8.6 GB 逻辑）：`open` 0.6 s，`indexes list` 两卷 13,454 + 2,348 条，`os detect` → `Microsoft Windows XP`，根节点 `分区0`/`分区1`/`未使用空间1`，`$MFT`、`$LogFile`、`$Secure:$SDS (数据流)` 等元数据节点直接可见。

坑：`images get` 里 `partitions[].id` 才是 `--partition-id` 用的编号；`sizeBytes` 是逻辑大小、`onDiskBytes` 是压缩后实际占用。

## R2 · 按文件名找（索引内通配，毫秒级）

```bash
"$LC" -q --case "$C" --image "$I" indexes volumes list     # 取 volumeKey（part:0 / part:1 / lvm:1:1 …）
"$LC" -q --case "$C" --image "$I" indexes files list --volume-key part:0 \
  --filter '{"nameGlob":"*.pf","kinds":["file"],"limit":20,"offset":0}'
# 收窄目录：pathPrefix 的拼写取自返回的 fullPath（含卷根名，末尾带 /）
"$LC" -q --case "$C" --image "$I" indexes files list --volume-key part:0 \
  --filter '{"nameGlob":"*.dat","pathPrefix":"/Documents and Settings/","limit":10,"offset":0}'
```

实测返回：`[{"nid":"ntfs:part:0:5288","name":"ALCMTR.EXE-235F9538.pf","fullPath":"/WINDOWS/Prefetch/…","kind":"file","size":11862,"isDelete":2}]` —— **裸数组**，不是 `items[]`；`nid` 直接给 `files get --node-id`。

坑：`--volume-key` 省略时会对"当前检材所有已索引卷"分别套用 `limit/offset`；索引缺失/被截断时**该命令明确失败**，别把失败当"没有"。

## R3 · 老系统（XP/2003）的日志与工件

```bash
"$LC" -q --case "$C" --image "$I" images os detect                     # 先定版本
"$LC" -q --case "$C" --image "$I" indexes files list --volume-key part:0 \
  --filter '{"nameGlob":"*.evt","limit":10,"offset":0}'                # XP 是 config/*.Evt
"$LC" -q --case "$C" --image "$I" files strings list --node-id ntfs:part:0:2757 --encoding utf-16le --min-length 10
"$LC" -q --case "$C" --image "$I" files get --node-id ntfs:part:0:2761  # 时间戳 + 大小
```

实测：`AppEvent.Evt`/`SecEvent.Evt`/`SysEvent.Evt` 在 `WINDOWS/system32/config/`，`--encoding utf-16le` 才能读出 `wuaueng.dll`、`SUS20ClientDataStore`、`SecurityCenter` 等串；默认 ASCII 几乎取不到东西。

坑：`*.evtx` 在 XP 上命中 0 条——**别据此写"无日志"**。Windows 事件日志格式分水岭是 Vista（EVTX），XP/2003 是 EVT。

## R4 · 读文本与编码纠错

```bash
"$LC" -q --case "$C" --image "$I" files text get --path "/part:1/root/etc/os-release" --max-bytes 300
# nextOffset 非空 → 用 --offset 续读（offset 是字节偏移，不是行/字符）
"$LC" -q --case "$C" --image "$I" files text get --path "/part:1/root/etc/services" --max-bytes 200 --offset 199
# 乱码先看原始字节，再显式指定编码，后续每段都用同一编码
"$LC" -q --case "$C" --image "$I" files read --path "/part:0/1.txt" --length 64
"$LC" -q --case "$C" --image "$I" files text get --path "/part:0/1.txt" --encoding gbk
```

实测：`os-release` 返回 `encoding:UTF-8`、`nextOffset:300`；`services` 首段 200 字节 → `nextOffset:200`，`--offset 199` 续读 → `nextOffset:399`，无缝衔接。

坑：`hadErrors:false` 只表示"没出现替换字符"，**不表示编码猜对**（短 GBK 文本很容易在错误编码下"干净"解出）。`files read --text` 只按 UTF-8 解码。

## R5 · 删除文件恢复（真实 NTFS，实测 10 秒 / 2713 个文件）

```bash
"$LC" -q --case "$C" --image "$I" carve scans create --options '{"scope":"partition","partition_id":0,"filesystems":{"ntfs":true,"fat":false,"exfat":false,"include_existing":false},"signatures":false}'
"$LC" -q --case "$C" --image "$I" tasks wait
"$LC" -q --case "$C" --image "$I" carve scans get <scanId>          # phase/filesystem 摘要
"$LC" -q --case "$C" --image "$I" carve files list --scan-id <scanId>   # candidates/directories/volumes
"$LC" -q --case "$C" --image "$I" carve scans export <scanId> --options '{"artifact_ids":[],"file_ids":["967","706"],"destination":"E:/out/recover-01","task_id":"rec-01"}'
```

实测：5.2 GB 分区 10 s 完成（16,168 条记录），`candidates` 2,713 条（每条含 `path`、`node.deleted:true`、`inode`、时间戳），`directories` 1,105 条，`readFaults` 全 0；导出 3 个文件 34 MB，落地为 `recovery-<uuid>/v0-NTFS/<原目录>/<文件名>`，`/$Parent-<inode>/` 是父目录已丢失的孤儿。

**判读三条**：
1. 导出结果顶层 `recovered:0 / bytesWritten:0` 是**雕刻**计数；文件系统记录看 `files.recovered`（实测 3）。
2. 报告 `recovery-report.jsonl` 里每条都有 `sha256`，与落盘文件**逐字节一致**（实测 `e2cc5495…`）——这是交付时必须核的一步。
3. `carve files list` 在文件系统阶段结束前返回 `null`；扫描全在内存，**同一进程内**完成扫描→分页→导出。

## R6 · 签名雕刻（真实未分配空间，实测 0.45 秒 / 81 个）

```bash
"$LC" -q --case "$C" --image "$I" carve formats list
"$LC" -q --case "$C" --image "$I" carve scans create --options '{"scope":"range","start_sector":4000000,"sector_count":400000,"format_ids":["jpg","png","pdf"],"signatures":true}'
"$LC" -q --case "$C" --image "$I" tasks wait
"$LC" -q --case "$C" --image "$I" carve artifacts list --scan-id <scanId> --limit 20
"$LC" -q --case "$C" --image "$I" carve scans export <scanId> --options '{"destination":"E:/out/carve-01","task_id":"cv-01"}'
```

实测：200 MB 范围 0.45 s 出 81 个 artifact，每条含 `offset`（镜像内字节偏移）、`length`、`confidence:100`、`formatId`；导出另写 DFXML 报告。

坑：`scope` 取 `whole|partition|unallocated|range`（`range` 配 `start_sector`+`sector_count`）；只在 512 字节块边界检查签名，碎片化/不对齐的文件会漏；签名命中 ≠ 可恢复。

## R7 · 整盘哈希与采集记录对账

```bash
"$LC" -q --case "$C" --image "$I" images get | grep -o '"storedMd5":"[0-9a-f]*"'   # 采集时写入的哈希
"$LC" -q --case "$C" --image "$I" images hash --algorithms md5                      # 重算
"$LC" -q --case "$C" --image "$I" images bad-regions list                            # 坏区审计
```

实测：8.6 GB / 11.4 s，`fc907ecf63e1586ddf4678f9cd7e4865` 与 `ewf.storedMd5` **完全一致**；`badRegions:[]`、`syntheticBytes:0`、退出码 0。若退出码 2 或 `readFaultsDetected=true`，该摘要含补零，不能用于完整性论证（要"坏区即失败"加 `--read-fault-policy strict`）。

## R8 · 单文件/目录导出（导出永不覆盖）

```bash
mkdir -p /e/out/batch-01                      # 父目录必须先存在，否则 internal os error 3
"$LC" -q --case "$C" --image "$I" files export --path "/part:0/Users/a.docx" --destination "E:/out/batch-01/a.docx"
"$LC" -q --case "$C" --image "$I" files directories export --path "/part:0/Users" --mode tree --destination "E:/out/users-01"
"$LC" -q --case "$C" --image "$I" files directories export --path "/part:0/Users" --mode zip  --destination "E:/out/users-01.zip"
```

坑：目标已存在 → `alreadyExists`（退出 1，什么都不写）；`--mode tree` 要求目标目录不存在（空目录也拒）；`files export` 只导单文件，目录用 `files directories export`。

批量多文件用 JSONL，一文件一请求，互不影响：

```jsonl
{"id":"e1","command":"files export","args":{"nodeId":"ntfs:part:0:1001","destination":"E:/out/batch-01/1-a.docx"}}
{"id":"e2","command":"files export","args":{"nodeId":"ntfs:part:0:1002","destination":"E:/out/batch-01/2-b.docx"}}
```

## R9 · 出处封装（引证用）

```bash
"$LC" -q --case "$C" --image "$I" files get --path "/part:0/WINDOWS/system32/config/SecEvent.Evt" --with-source
```

实测返回 `{"result":{…"nodeId":"ntfs:part:0:2761","path":"/分区0/WINDOWS/…","timestamps":{…}},"source":{"caseId":…,"evidencePath":"E:/作业/…/disk.E01","imageId":…,"nodeId":…}}`。

坑：`--with-source` 是**命令选项**，写在命令前会报 `usage: 未知选项`；`result.path` 用的是显示名（`/分区0/…`），不是输入的 `part:0` 形式——引用时两者都给，避免读者找不到。

## R10 · Linux 服务器（LVM + XFS，实测 3.7 秒）

```bash
"$LC" -q --case "$C" --image "$I" files list --path / --fields name,kind     # 分区0(xfs) / 分区1(lvm)
"$LC" -q --case "$C" --image "$I" files list --path /part:1 --fields name,id,kind   # → root(lvm:1:1)、swap(lvm:1:0)
"$LC" -q --case "$C" --image "$I" files list --path /part:1/root/etc --page-size 20 --fields name,kind
"$LC" -q --case "$C" --image "$I" files text get --path /part:1/root/etc/os-release --max-bytes 300
"$LC" -q --case "$C" --image "$I" files text get --path /part:1/root/etc/passwd --max-bytes 8192
"$LC" -q --case "$C" --image "$I" plugins systems list                       # 可能为空，见下
```

实测：CentOS 7，`/etc` 194 项，`os-release` 读出 `CentOS Linux 7 (Core)`。

**两个真实限制**：
1. `plugins systems list` 返回 `[]`、`images os detect` 的 `detections` 为空 ⇒ 插件跑不起来，改用 `/etc/passwd`、`/etc/shadow`、`/var/lib/dpkg/status`、`/etc/crontab` 等普通文件取证，并在报告写"插件未覆盖"。
2. `timezones get` 回退 UTC，即使 `/etc/localtime → /usr/share/zoneinfo/Asia/Shanghai`：先 `files get --path /part:1/root/etc/localtime` 读 `linkTarget`，再 `--timezone Asia/Shanghai`（之后 `timestampDisplay.timeZone.source="command"`）。

## R11 · RAID / LVM 组装（多盘）

```bash
# 同一进程内打开全部成员盘再检测（之后 assembledImageId 只在本次会话有效）
"$LC" -q shell <<'EOF'
images open "E:/evidence/m1.img"
images open "E:/evidence/m2.img"
raid detect
images list
EOF
"$LC" -q --case "$C" context use <assembledImageId>
"$LC" -q --case "$C" --image <assembledImageId> files list --path /
```

- 缺成员可降级：`raid detect --degraded-sets <setId>`；手工几何：`raid assemble --params <json>`。
- 克隆机同 VG/PV UUID：`raid detect --image-ids <已加载源ID>…` 只测一台。
- 完整单 PV 的 LVM 不必组装，直接 `/part:N` 下浏览（R10 就是这种）。

## R12 · BitLocker

```bash
"$LC" -q --case "$C" --image "$I" bitlocker metadata get 0        # 无需凭据：算法/卷GUID/FILETIME/保护器类型
"$LC" -q --case "$C" --image "$I" bitlocker unlock 0 --recovery-password @E:/secret/rk.txt
"$LC" -q --case "$C" --image "$I" files list --path /            # 解锁后按普通分区浏览
"$LC" -q --case "$C" --image "$I" bitlocker export 0 --destination "E:/out/vol0.raw"
```

- 凭据四选一：`--password` / `--recovery-password`（48 位）/ `--startup-key-path`（BEK）/ `--fvek-hex`（Diffuser 加 `--tweak-hex`）；全不给＝尝试卷内明文密钥。
- 内存镜像找 VMK：`bitlocker vmks scan <内存镜像> --partition-id <n>` → `bitlocker vmks unlock <分区> --vmk-hex <hex>`；TPM/SID 不支持。
- 原始 FVEK 无认证标签 ⇒ 解锁后**必须**抽查明文；`bitlocker export` 遇已审计合成字节会失败。
- 解锁状态只在本进程存活；同一会话内完成解锁→浏览→导出。

## R13 · LUKS / VeraCrypt / FileVault

凭据写私有 JSON（不要进命令行）：

```json
{"scheme":"luks","partitionId":0,"password":"<口令>","target":"newImage"}
```

```bash
"$LC" -q --case "$C" --image "$I" encrypted-volumes unlock --options @E:/secret/unlock.json
"$LC" -q --case "$C" context use <返回的 image.id>
"$LC" -q --case "$C" --image <返回的 image.id> files list --path /
"$LC" -q --case "$C" --image <返回的 image.id> images export --destination "E:/out/plain.raw" --read-fault-policy strict
```

- `scheme`: `luks` | `veracrypt`（可加 `pim` 0–1000、`hidden`）| `filevault`（先 `filevault get --options '{}'` 取 `index`，再传 `logicalVolumeIndex`）。
- LUKS 可用 `masterKeyHex` 替代口令（不可同时传），LUKS1/2 都先校验密钥摘要。
- `target:"sourcePartition"` 把明文挂回源分区（要求单个完整卷，节点仍 `part:N`）；整体导出明文用 `images export --mode unlockedPartitions`。
- 不支持：分离头、备份头恢复、LUKS2 完整性/重加密/多数据段、VeraCrypt 密钥文件、APFS 原生加密——报错即记限制，别反复换方案。

## R14 · iOS 本地备份（含加密）

```bash
# 选"同时含 Manifest.plist 与 Manifest.db"的那一层目录（通常以 UDID 命名）
"$LC" -q --case "$C" --image "E:/evidence/UDID" files list --path /
"$LC" -q --case "$C" --image "E:/evidence/UDID" ios-backups unlock --password @E:/secret/pw.txt
"$LC" -q --case "$C" --image <返回子会话 id 或 decrypted:// 路径> files list --path /
"$LC" -q --case "$C" --image "E:/evidence/UDID" ios-backups audit
```

判读：未加密备份直接显示 `HomeDomain/Library/SMS/sms.db` 等原始域路径；`audit` 的观察（加密声明矛盾、缺失/孤立数据文件、文件 ID 与路径 SHA-1 不一致、未完成备份）要按代码与严重程度原样引用。它是逻辑证据：无分区/RAW 哈希，整盘雕刻不适用。

## R15 · 插件分析与时间线

```bash
"$LC" -q --case "$C" --image "$I" plugins systems list        # 例：linux@part:2；可能为空
"$LC" -q --case "$C" --image "$I" plugins functions list      # 作用域/平台/选项
"$LC" -q --case "$C" --image "$I" plugins tasks create --function org.lovelycarve.linuxinfo/linuxbaseinfo --system-id "linux@part:2"
"$LC" -q --case "$C" --image "$I" tasks wait
"$LC" -q --case "$C" --image "$I" analysis tree get
"$LC" -q --case "$C" --image "$I" analysis records list --run-id <r> --record-type linux.user --sort uid --limit 50
"$LC" -q --case "$C" --image "$I" analysis runs get <r>       # 输入/选项/告警/补零字节

"$LC" -q --case "$C" --image "$I" timeline build
"$LC" -q --case "$C" --image "$I" timeline types list
"$LC" -q --case "$C" --image "$I" timeline events list --query '{"time_zone_hours":0,"time_unit":"day","from_apps":[],"data_types":[],"pairs":[],"show_delete":false}' --skip 0 --limit 50 --order asc
"$LC" -q --case "$C" --image "$I" timeline events export --query '{…}' --destination "E:/out/tl.csv"
```

实测时间线：`filesTotal 15802 / fileRows 15798 / skippedInvalidTime 4`；`types list` 按 `fromApp`（卷键）分组、`dataType 1 = 文件`；事件 `tlTime` 是 Unix 秒（`1280921847` = 2010-08-04，与采集日吻合）。

坑：`analysis records list` 必须同时给 `--run-id` 与 `--record-type`；空页不等于没证据（先看 `analysis runs get` 的告警）。事件 `content` 的非 ASCII 文件名可能是 mojibake（用 `oid`/`nodeId` 定位，别做字符串比对）。`skippedInvalidTime>0` 表示部分时间未投影，不能当"当时没活动"。

## R16 · 一条 JSONL 走完"扫描→恢复→引用"

```jsonl
{"id":"img","command":"images open","args":{"path":"E:/evidence/disk.E01"}}
{"id":"scan","command":"carve scans create","args":{"options":{"scope":"partition","partition_id":0,"filesystems":{"ntfs":true},"signatures":false}}}
{"id":"done","command":"tasks wait"}
{"id":"files","command":"carve files list","args":{"scanId":{"$ref":"scan#/scanId"}}}
{"id":"exp","command":"carve scans export","args":{"scanId":{"$ref":"scan#/scanId"},"options":{"artifact_ids":[],"file_ids":["967"],"destination":"E:/out/carve-02","task_id":"cv-02"}}}
```

```bash
"$LC" -q --case "$C" session --jobs 4 < scan.jsonl
```

判读：响应按完成顺序输出，**必须按 `id` 关联**；失败行不影响后续行（实测：某行路径写成 `E:\x` → `invalid escape`，其余行照常执行）；带 `warning` 的是"结果不完整但可用"。`$ref` 指向**上一步的 result**，引用失败请求会连锁报"无效结果引用"。

## R17 · 卷影副本与物理磁盘

```bash
"$LC" -q --case "$C" --image "$I" shadow-copies list
"$LC" -q --case "$C" --image "$I" shadow-copies open 2 --index 0      # 只读镜像，可再浏览
"$LC" -q disks list                                                   # 需管理员；先确认不是工作盘
```

坑：VSS 区存在但无副本时显示"无卷影副本"；副本时间是 UTC，报告要标来源。物理磁盘 `images open <\\.\PhysicalDriveN>` 需管理员且只读。

## R18 · 挂载（Windows + Dokan，仅临时）

```bash
"$LC" -q mounts points list
"$LC" -q --case "$C" --image "$I" mounts create "/part:0/Users" --mount-point "X:"
"$LC" -q --case "$C" --image "$I" mounts list
"$LC" -q --case "$C" --image "$I" mounts delete <mountId> --force
```

挂载只在进程存活期间有效 ⇒ 必须在常驻会话 / `shell` / `session` 里用；要长期保留就导出。
