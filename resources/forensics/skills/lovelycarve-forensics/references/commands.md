# 命令速查（v1.3.0，171 条命令的浓缩版）

> 全局选项对所有命令生效：`-q/--quiet`、`-i/--image <ID|路径>`、`--case <目录>`、`--session <名>`、`--timezone <auto|evidence|case|UTC|IANA|±HH:MM>`、`--events`、`--dry-run`、`--body <json|@file>`、`--fields <a,b.c>`（仅 list/search）、`--text`、`--force`。
> 位置参数可写成同名选项（`files get --path <p>`），**两种写法不能同时用**；`list`/`count` 只能写选项。
> 未列出选项默认取后端默认值；拿不准时 `schema <命令>` 看请求字段，`<命令> --help` 看单命令选项。
> 「路径命令」都接受 `--node-id <id>` 替代路径（已删除条目/重名/特殊流）。嵌套 JSON（`--options`/`--query`/`--filter`）的键名沿用后端契约，多为 snake_case。

## images（检材）
```
images open <path> [--raw-read-mode strict|force] [--qcow-password <secret>] [--qcow-key-hex <secret>]
images get [image]            images list            images close [image]
images hash [image] [--algorithms md5|sha1|sha256|sm3 …] [--read-fault-policy zeroFillAndReport|strict]
images export [image] --destination <p> [--mode source|unlockedPartitions] [--read-fault-policy …]
images bad-regions list
images os detect              images platform detect   images platform set <auto|android|ios|windows|macos|linux|harmony|huaweihmos|othermobile|drone>
images tags list/get/edit/update     images digests list/get/edit     images file-types list/get/edit
images drive-letters list
```

## files（检材内文件）
```
files list [--path <p>|--parent-id <id>] [--cursor <c>] [--page-size 1..5000] [--query <json>]
files tree list [--path <p>] [--depth 1..128] [--name <子串>] [--limit 1..100000]
files flat list --path <p> [--allow-all-files] [--keyword <s>] [--sort <f>] [--sortdesc] [--skip n] [--limit n] [--filter <json>] [--refresh]
files get <p>                 files identify <p>        files content get <p>        files stats get <p> --path-hint <s>
files read <p> [--offset n] [--length n] [--text]
files text get <p> [--max-bytes n] [--offset n] [--encoding gbk|gb18030|big5|shift_jis|euc-kr|utf-16le…]
files hash <p> [--algos md5|sha1|sha256|sm3 …]
files strings list <p> [--encoding ascii|utf-8|utf-16le|utf-16be] [--min-length n] [--limit n] [--offset n]
files search <pattern> [path] [--regex] [--ignore-case] [--exclude-deleted] [--codepage <标签>…] [--limit n] [--search-id <id>]
files export <p> --destination <新文件>
files directories export <p> --destination <新目录|新zip> [--mode tree|zip]
files streams list <p> / streams get <p> --stream-name <名> / streams export <p> --stream-name <名> --destination <新文件>
files size-tree get <p> [--depth n] [--metric bytes|files] [--include-deleted] [--min-share 0..1]
files sqlite get <p> / sqlite rows list <p> --table <名> [--order-by <col>] [--descending] [--offset n] [--limit n]
files sqlite deleted-records list <p>
files realm get <p> / realm rows list <p> --table-number <n>
files zip get <p> / zip members get <p> --member-path <m> [--max-bytes n] [--text]
files csv get <p> [--delimiter <s>]      files binary get <p>        files gguf get <p>      files vim-swap get <p>
files usn-journal records list --path <p> [--cursor <c>] [--page-size n]
files ext4-journal get --path <p> / ext4-journal blocks list --path <p>
files docker get --path <p> / docker build --path <p>
files ancestors list --path <p>          files extensions count --path <p>      files children count --parent-ids <id>…
files empty-dirs list --parent-ids <id>… files lookup --root-id <id> --path <相对路径>
files timeline export <p> --destination <csv>     files media create/release     files qr-codes scan / files ocr scan（需 full 构建）
```

## cases / context / sessions
```
cases create <dir> --name <名> [--case-number <s>] [--examiner <s>] [--description <s>]
cases open <dir>   cases get   cases list   cases close   cases lock   cases unlock
cases edit --name <名>   cases options list [--prefix <s>] / options edit --entries <json>
cases evidence list / evidence delete [image] [--force]     cases delete <dir> [--force]
context get        context set [--dir <p>|--node-id <id>]    context use [image]
sessions open <name> [--image <p>] [--case <dir>] [--timezone <z>]   sessions attach <name>
sessions get <name>   sessions list   sessions close <name>
```

## indexes / searches / timeline
```
indexes list          indexes volumes list
indexes create --volume-key <键> [--task-id <t>]      indexes delete --volume-key <键> [--force]
indexes files list [--volume-key <键>] --filter '{"nameGlob":"…","pathPrefix":"/…/","kinds":["file"],"extensions":["evtx"],"limit":100,"offset":0}'
indexes files lookup --query <json>
searches create --options <json> [--search-id <id>]   searches hits list --search-id <id> [--skip n] [--limit n] [--distinct file|sha256]
searches export <id> --destination <csv> [--keyword <s>] [--distinct <s>]     searches list   searches delete <id>
timeline build        timeline get        timeline range get        timeline types list        timeline buckets list --query <json>
timeline events list --query '{"time_zone_hours":0,"time_unit":"day","from_apps":[],"data_types":[],"pairs":[],"show_delete":true}' [--skip n] [--limit n] [--order asc|desc]
timeline events export --query <json> --destination <csv>
```

## carve（恢复与雕刻）
```
carve formats list
carve scans create --options '{"scope":"whole|partition|unallocated|range","start_sector":n,"sector_count":n,
  "filesystems":{"fat":true,"ntfs":true,"exfat":true,"include_existing":false},"signatures":true,
  "format_ids":["png","pdf"],"max_file_size":n,"max_results":n}'
carve scans get <id>   list   pause <id>   resume <id>   delete <id> [--force]
carve files list --scan-id <id>                      # 文件系统阶段结果（未完成返回 null）
carve artifacts list --scan-id <id> [--cursor <c>] [--limit n] [--filter <json>]
carve artifacts get <artifact-id> --scan-id <id> [--max-bytes n] [--text]
carve scans export <id> --options '{"destination":"<新目录>","artifact_ids":null|[ids],"file_ids":["<候选ID>"],"task_id":"…"}'
```

## 加密与备份
```
bitlocker get <分区>   metadata get <分区>
bitlocker unlock <分区> [--password|--recovery-password|--startup-key-path|--fvek-hex] [--tweak-hex] [--task-id <t>]
bitlocker export <分区> --destination <新文件>
bitlocker vmks scan <内存镜像> --partition-id <n>      bitlocker vmks unlock <分区> --vmk-hex <secret>
encrypted-volumes unlock --options '{"scheme":"luks|veracrypt|filevault","password"|"masterKeyHex","partitionId"|"offset"+"length","target":"newImage|sourcePartition","pim":0,"hidden":false,"logicalVolumeIndex":0}'
filevault get --options '{}'                          ios-backups unlock --password <secret>      ios-backups audit
```

## raid / disks / shadows / mounts
```
raid detect [--image-ids <id>…] [--degraded-sets <setId>…]      raid assemble --params <json>
disks list
shadow-copies list      shadow-copies open <分区> --index <n>
mounts list   mounts create <path> --mount-point <盘符|目录>   mounts delete <id> [--force]
mounts share <id> [--share-name <s>]   mounts unshare <id>   mounts points list/create/get
```

## plugins / analysis / bcp
```
plugins list   plugins create <包.lcpkg>   plugins delete <id> [--force]   plugins restart <id>
plugins functions list   plugins systems list
plugins tasks create --function <fn> [--system-id <sys>] [--node-id <id> --file-name <名>] [--options <json>]
plugins tasks cancel|restart|start|delete <taskId>
analysis tree get   analysis records list --run-id <r> --record-type <t> [--keyword <s>] [--sort <列>] [--descending] [--skip n] [--limit n] [--legacy]
analysis records get <record-id>   analysis runs get <run-id>
bcp tables list   bcp rows list --code <数据集> [--cursor <json>]
```

## tasks / timezones / system / 根命令
```
tasks list [--image-id <id>]   tasks get <id>   tasks cancel <id>   tasks wait
timezones get    timezones set <auto|evidence|case|UTC|IANA|±HH:MM> [--scope session|case|image]
system get   system modules list   system paths get <path>   system paths reveal <path>
schema [命令…]   schema --list   complete [bash|zsh|fish|powershell]   shell   session [--jobs 1..64]
```

## 常用枚举
- 动词：`get list count create update edit delete open close read export hash identify search scan detect lookup unlock lock assemble build audit start pause resume restart cancel wait release share unshare reveal set use attach serve`
- `--algos`：`md5 sha1 sha256 sm3`；`--read-fault-policy`：`zeroFillAndReport`（默认，补零并告警）/ `strict`（遇坏区即失败）
- `files search --codepage`：`ASCII`、`UTF-8`、`UTF-16LE/BE`、`GBK`、`GB18030`…（省略＝全部受支持编码）
- 时间线 `time_unit`：按聚合粒度（如 `day`/`hour`）；`start`/`end` 为**闭区间 Unix 秒**
- 雕刻 `scope`：`whole` | `partition` | `unallocated` | `range`
