# LovelyCarve 可跑配方（recipes）

> 每个配方都可直接照抄。约定：`LC` = `lovelycarve-cli.exe` 绝对路径；`C` = 案件目录；`I` = 检材路径或 imageId；`V` = 卷名（取自 `files list --path /`）。
> 所有示例都已在 v1.3.0 + 合成检材上实跑。内联 JSON 在 PowerShell 里改存 UTF-8 文件，用 `@文件` 传。

## R1 · 镜像初查（10 分钟出第一版画像）

```bash
"$LC" -q cases create "$C" --name "初查" --case-number "LC-001"
"$LC" -q --case "$C" --image "$I" images open "$I"        # 已加载可省略
"$LC" -q --case "$C" --image "$I" tasks wait
"$LC" -q --case "$C" --image "$I" images get              # 平台/分区/扇区/大小/EWF 元数据
"$LC" -q --case "$C" --image "$I" indexes list            # indexed / stale / truncated
"$LC" -q --case "$C" --image "$I" files list --path / --fields name,id,kind,size
"$LC" -q --case "$C" --image "$I" files list --path "/$V" --page-size 100 --fields name,id,kind,size
```

判读：`partitions[]` 给出分区号、文件系统、起止扇区；没有文件系统的分区记"未挂载/不支持"。`sizeBytes` 是逻辑大小，压缩/稀疏格式另有实际占用。

坑：`images get` 的 `partitions` 里 `id` 才是 `--partition-id` 用的编号（不是行号、不是节点 ID）。

## R2 · 按文件名找（先索引，别递归 dump）

```bash
"$LC" -q --case "$C" --image "$I" indexes volumes list     # 取 volumeKey 与 indexes[].pathPrefix
"$LC" -q --case "$C" --image "$I" indexes files list --volume-key "$KEY" \
  --filter '{"nameGlob":"*.evtx","kinds":["file"],"limit":100,"offset":0}'
# 缩小目录（pathPrefix 拼写取自返回的 fullPath，末尾带 /）
"$LC" -q --case "$C" --image "$I" indexes files list --volume-key "$KEY" \
  --filter '{"nameGlob":"auth*.log.*","pathPrefix":"/root/var/log/","kinds":["file"],"limit":100,"offset":0}'
```

判读：返回的是**裸数组**（元素含 `nid`/`name`/`fullPath`/`kind`/`size`/`isDelete`），不是 `items[]`；`nid` 可直接给 `files get --node-id`。`limit` 1–5000，`offset` 按**实际返回条数**推进；空页才算查完。索引缺失/被截断时该命令**明确失败**，此时不要写"无命中"。删除/现存标志键是 `isDelete`（枚举 `1`/`2`/`null`，可放进 filter），**含义以实际卷核验为准，不要凭值推断**。

## R3 · 按内容检索（关键词 / 正则 / 指定编码）

```bash
"$LC" -q --case "$C" --image "$I" files search 18912345678 "/$V/Users" --limit 50
"$LC" -q --case "$C" --image "$I" files search 'pass(wd|word)\s*=' / --regex --ignore-case --limit 50
"$LC" -q --case "$C" --image "$I" files search 合同 / --codepage GBK --exclude-deleted
# 命中多时翻页（命中已存案件）
"$LC" -q --case "$C" --image "$I" searches hits list --search-id <searchId> --skip 50 --limit 50
```

判读：`summary.readErrors>0` 或 `summary.truncated=true` ⇒ 覆盖不完整；`hitSeq`/`nodeId`/`fileOffset`/`encoding` 是引证要素。`--search-id` 自己给一个稳定值便于后续翻页与导出。

坑：默认**区分大小写**且**包含已删除文件**；`/` 表示"全部已索引卷"，需要案件+索引+源可读。

## R4 · 读文本与编码纠错

```bash
"$LC" -q --case "$C" --image "$I" files text get --path "/$V/etc/passwd" --max-bytes 65536
# nextOffset 非空 → 续读（段末截断的字符会留给下一段）
"$LC" -q --case "$C" --image "$I" files text get --path "/$V/var/log/x.log" --max-bytes 65536 --offset 65535
# 乱码先看原始字节，再显式指定编码，且后续每段都用同一编码
"$LC" -q --case "$C" --image "$I" files read --path "/$V/1.txt" --length 64
"$LC" -q --case "$C" --image "$I" files text get --path "/$V/1.txt" --encoding gbk
```

判读：`hadErrors:false` 只表示"没出现替换字符"，**不表示编码猜对**（短 GBK 文本很容易在错误编码下"干净"解出）。`files read --text` 只按 UTF-8 解码，二进制不要走文本管道。

## R5 · 删文件恢复（文件系统记录）

```bash
"$LC" -q --case "$C" --image "$I" carve scans create --options '{"scope":"whole","filesystems":{"fat":true,"ntfs":true,"exfat":true,"include_existing":false},"signatures":false}'
"$LC" -q --case "$C" --image "$I" tasks wait
"$LC" -q --case "$C" --image "$I" carve scans get <scanId>          # phase/filesystem 摘要
"$LC" -q --case "$C" --image "$I" carve files list --scan-id <scanId>   # 候选、readable、reconstruction
"$LC" -q --case "$C" --image "$I" carve scans export <scanId> --options '{"artifact_ids":[],"file_ids":["<候选ID>"],"destination":"E:/out/recover-01","task_id":"rec-01"}'
```

判读：只导 `readable` 候选；输出按 `v<卷号>-<卷标>/原目录/文件名` 还原，`recovery-report.jsonl` 记录每条的原路径、来源节点、输出路径、SHA-256 与读故障。NTFS 引导区被覆盖但 `$MFT` 可自证时会出现"重建卷"（`reconstruction`）。

坑：`carve files list` 在文件系统阶段结束前返回 `null`；扫描在内存里，**同一进程内**完成扫描→分页→导出。

## R6 · 签名雕刻（无目录记录的文件）

```bash
"$LC" -q --case "$C" --image "$I" carve formats list                       # 可选 format_ids 与签名
"$LC" -q --case "$C" --image "$I" carve scans create --options '{"scope":"unallocated","format_ids":["png","jpg","pdf","zip"],"signatures":true}'
"$LC" -q --case "$C" --image "$I" tasks wait
"$LC" -q --case "$C" --image "$I" carve artifacts list --scan-id <scanId> --limit 50
"$LC" -q --case "$C" --image "$I" carve scans export <scanId> --options '{"destination":"E:/out/carve-01","task_id":"cv-01"}'
```

判读：`offset` 是镜像内字节偏移（引证要素）、`confidence` 是结构校验置信度、`length` 由解析出的结构决定。导出同时写 DFXML 报告与每条 SHA-256。

坑：`scope` 可取 `whole|partition|unallocated|range`（`range` 配 `start_sector`+`sector_count`）；512 字节块边界检查 ⇒ 不对齐的碎片化文件会漏；签名命中≠可恢复（CRC/结构不合法时 `artifactsFound` 会少于 `signaturesFound`）。

## R7 · BitLocker

```bash
"$LC" -q --case "$C" --image "$I" bitlocker metadata get 0        # 无需凭据：算法/卷GUID/FILETIME/保护器类型
"$LC" -q --case "$C" --image "$I" bitlocker unlock 0 --recovery-password @E:/secret/rk.txt
"$LC" -q --case "$C" --image "$I" files list --path /            # 解锁后按普通分区浏览
"$LC" -q --case "$C" --image "$I" bitlocker export 0 --destination "E:/out/vol0.raw"
```

- 凭据四选一：`--password` / `--recovery-password`（48 位）/ `--startup-key-path`（BEK）/ `--fvek-hex`（Diffuser 加 `--tweak-hex`）；全不给＝尝试卷内明文密钥。
- 内存镜像里找 VMK：`bitlocker vmks scan <内存镜像> --partition-id <n>` → `bitlocker vmks unlock <分区> --vmk-hex <hex>`（可拿到恢复密钥；TPM/SID 不支持）。
- 原始 FVEK 无认证标签 ⇒ 解锁后**必须**抽查明文内容；`bitlocker export` 遇到已审计的合成字节会失败（先 `images bad-regions list`）。
- 解锁状态只在本进程存活；同一会话内完成解锁→浏览→导出。

## R8 · LUKS / VeraCrypt / FileVault

先看分区，选区域（`partitionId`，或源镜像内字节 `offset`+`length`；两者不可混用），凭据写成私有 JSON 文件：

```json
{"scheme":"luks","partitionId":0,"password":"<口令>","target":"newImage"}
```

```bash
"$LC" -q --case "$C" --image "$I" encrypted-volumes unlock --options @E:/secret/unlock.json
# 返回 image.id 与 image.path(decrypted://…)：二选一继续
"$LC" -q --case "$C" context use <返回的 image.id>
"$LC" -q --case "$C" --image <返回的 image.path> files list --path /
"$LC" -q --case "$C" --image <返回的 image.id> images export --destination "E:/out/plain.raw" --read-fault-policy strict
```

- `scheme`: `luks` | `veracrypt`（可加 `pim` 0–1000、`hidden`）| `filevault`（先 `filevault get --options '{}'` 取逻辑卷 `index`，再传 `logicalVolumeIndex`）。
- LUKS 可用 `masterKeyHex` 替代口令（与口令**不可同时**传）；LUKS1/2 都会先校验密钥摘要。
- `target:"sourcePartition"` 把明文挂回源分区（要求单个完整卷，节点仍是 `part:N`）；`"newImage"`（默认）产出独立 `decrypted://` 镜像。整体导出明文用 `images export --mode unlockedPartitions`。
- 不支持：分离头、备份头恢复、LUKS2 完整性/重加密/多数据段、VeraCrypt 密钥文件、APFS 原生加密 —— 报错即记录限制，别反复换方案。
- `.hc` / `.tc` / `.luks` 可直接当检材 `images open`。

## R9 · iOS 本地备份（含加密）

```bash
# 备份目录要选"同时含 Manifest.plist 与 Manifest.db"的那一层（通常以 UDID 命名）
"$LC" -q --case "$C" --image "E:/evidence/UDID" files list --path /
"$LC" -q --case "$C" --image "E:/evidence/UDID" ios-backups unlock --password @E:/secret/pw.txt
"$LC" -q --case "$C" --image <返回子会话 id 或 decrypted:// 路径> files list --path /
"$LC" -q --case "$C" --image "E:/evidence/UDID" ios-backups audit     # 异常观察数组
```

判读：未加密备份直接显示 `HomeDomain/Library/SMS/sms.db` 等原始域路径；`audit` 的观察（加密声明矛盾、缺失/孤立数据文件、文件 ID 与路径 SHA-1 不一致、未完成备份）要按代码与严重程度原样引用。逻辑证据：没有分区/RAW 哈希，整盘雕刻不适用。

## R10 · RAID / LVM 组装

```bash
# 同一进程内（shell 或 session）打开全部成员盘再检测
"$LC" -q shell <<'EOF'
images open "E:/evidence/m1.img"
images open "E:/evidence/m2.img"
raid detect
images list
EOF
# 取 volumeGroups[].logicalVolumes[].assembledImageId
"$LC" -q --case "$C" context use <assembledImageId>
"$LC" -q --case "$C" --image <assembledImageId> files list --path /
```

- 缺成员但可降级：`raid detect --degraded-sets <setId>`；手工几何：`raid assemble --params <json>`。
- 克隆机同 UUID：`raid detect --image-ids <已加载源ID>…` 只测一台。
- 完整单 PV 的 LVM 可直接在源检材分区下浏览，不必显式组装。
- `assembled://` 与 assembled ID 只在该会话有效；会话结束需重开成员盘重检测。

## R11 · 插件分析与时间线

```bash
"$LC" -q --case "$C" --image "$I" plugins systems list        # linux@part:2 …
"$LC" -q --case "$C" --image "$I" plugins functions list      # 作用域/平台/选项
"$LC" -q --case "$C" --image "$I" plugins tasks create --function org.lovelycarve.linuxinfo/linuxbaseinfo --system-id "linux@part:2"
"$LC" -q --case "$C" --image "$I" tasks wait
"$LC" -q --case "$C" --image "$I" analysis tree get
"$LC" -q --case "$C" --image "$I" analysis records list --run-id <r> --record-type linux.user --sort uid --limit 50
"$LC" -q --case "$C" --image "$I" analysis runs get <r>       # 输入、选项、告警、补零字节

"$LC" -q --case "$C" --image "$I" timeline build
"$LC" -q --case "$C" --image "$I" timeline range get
"$LC" -q --case "$C" --image "$I" timeline types list
"$LC" -q --case "$C" --image "$I" timeline events list --query '{"time_zone_hours":0,"time_unit":"day","from_apps":[],"data_types":[],"pairs":[],"show_delete":true}' --skip 0 --limit 100 --order asc
```

判读：系统级分析器要 `--system-id`，文件级要 `--node-id` + `--file-name`；同一目标重复创建返回已有任务。`analysis records list` 必须同时给 `--run-id` 与 `--record-type`，空页不等于没证据（先看 `analysis runs get` 的告警与补零字节）。

时间线：`timeline build` 的 `skippedInvalidTime` > 0 表示部分时间无法解释 ⇒ 不能投影；`timeline get` 显示构建状态（取消会留部分结果）。文件事件目前只投影**修改时间**；无时区的本地时间不参与投影。`query` 内部字段是 **snake_case**（与顶层 camelCase 不同），`time_zone_hours` 是聚合偏移，与文件显示 `--timezone` 无关。

## R12 · 哈希、导出与读故障审计

```bash
"$LC" -q --case "$C" --image "$I" images hash --algorithms md5 sha256            # 整盘
"$LC" -q --case "$C" --image "$I" files hash --path "/$V/a.docx" --algos sha256
"$LC" -q --case "$C" --image "$I" files export --path "/$V/a.docx" --destination "E:/out/a.docx"
"$LC" -q --case "$C" --image "$I" files directories export --path "/$V/Users" --mode tree --destination "E:/out/users-01"
"$LC" -q --case "$C" --image "$I" images bad-regions list
```

判据：`readFaultsDetected`/`syntheticBytes`/`badRegions` 任一非空 ⇒ 摘要含合成零字节，**不能**当作完整原件哈希；要"坏区即失败"用 `--read-fault-policy strict`。`--mode tree` 目标目录必须不存在；导出永不覆盖。

批量导出多条时用 JSONL（每条一个 `files export`，各报各的错，互不影响）：

```jsonl
{"id":"e1","command":"files export","args":{"nodeId":"<id1>","destination":"E:/out/batch-01/1-a.docx"}}
{"id":"e2","command":"files export","args":{"nodeId":"<id2>","destination":"E:/out/batch-01/2-b.docx"}}
```

## R13 · 一条 JSONL 走完"雕刻→恢复→引用"

```jsonl
{"id":"img","command":"images open","args":{"path":"E:/evidence/disk.raw"}}
{"id":"scan","command":"carve scans create","args":{"options":{"scope":"whole","format_ids":["png"],"signatures":true}}}
{"id":"done","command":"tasks wait"}
{"id":"art","command":"carve artifacts list","args":{"scanId":{"$ref":"scan#/scanId"},"limit":20}}
{"id":"exp","command":"carve scans export","args":{"scanId":{"$ref":"scan#/scanId"},"options":{"destination":"E:/out/carve-02","task_id":"cv-02"}}}
```

```bash
"$LC" -q --case "$C" session --jobs 4 < scan.jsonl
```

判读：响应按完成顺序输出，**必须按 `id` 关联**；失败行不影响后续行；带 `warning` 的是"结果不完整但可用"。`$ref` 指向**上一步的 result**（不是外壳），引用未完成请求会等待，未知 ID/指针会明确报错。

## R14 · 卷影副本与物理磁盘

```bash
"$LC" -q --case "$C" --image "$I" shadow-copies list
"$LC" -q --case "$C" --image "$I" shadow-copies open 2 --index 0      # 只读镜像，可再浏览
"$LC" -q disks list                                                   # 管理员终端；读前先确认不是工作盘
```

坑：VSS 区存在但无副本时显示"无卷影副本"；副本时间是 UTC，报告要标来源。物理磁盘 `images open <\\.\PhysicalDriveN>` 需要管理员，且**只读**。

## R15 · 挂载（Windows + Dokan，仅临时）

```bash
"$LC" -q mounts points list
"$LC" -q --case "$C" --image "$I" mounts create "/$V/Users" --mount-point "X:"
"$LC" -q --case "$C" --image "$I" mounts list
"$LC" -q --case "$C" --image "$I" mounts delete <mountId> --force
```

挂载只在该进程存活期间有效 ⇒ 必须在常驻会话 / `shell` / `session` 里用；要长期保留就导出。
