# 错误码、边界与限制（pitfalls）

## 1 · 退出码

| 退出 | 语义 | 处置 |
| --- | --- | --- |
| `0` | 成功且完整 | 仍检查 `tasks wait` 的结局与覆盖字段 |
| `1` | 失败（命令行/后端/`notFound`/`alreadyExists`/`aborted`/后台任务 `tasksFailed`/会话请求失败） | 按 `error.code` 分支；不要原样重试 |
| `2` | **结果不完整**（补零坏区、命中上限、导出提前停止、部分文件恢复失败） | 结果可用但必须标注不完整，并把字段写进报告 |
| `130` | Ctrl+C / SIGINT / SIGTERM 中断 | 不要当作"无结果"，记录中断点 |

代理模式（`LOVELYCARVE_AGENT=1`）下 stderr 为单行 JSON：`{"error":{"code","message","details","ipcCommand"}}`；不完整时 stdout 结果后追加 `{"warning":{"code":"incompleteResult","details":{"fields":{…}}}}`。PowerShell 里原生命令后**立刻**看 `$LASTEXITCODE` 再解析 JSON。

## 2 · 错误码处置表

| code | 真实原因 | 正确动作 |
| --- | --- | --- |
| `notFound` | 路径解析不到 / 按 ID 查的对象不存在 | 错误里已写所在目录与缺失名；`files list --path <目录>` 核对真实名称（含卷名归一化） |
| `alreadyExists` | 导出目标已存在（导出**永不覆盖**） | 换新目标；批量导出每次用新目录（`tree` 模式连空目录也拒） |
| `internal` + `os error 3` | 目标**父目录不存在**（实测：不是 `alreadyExists`） | 先创建父目录再导出 |
| `isDirectory` | `files export` 遇到目录 | 用 `files directories export --mode tree|zip` |
| `usage` | 参数用错（如 `--fields` 用在 `get`；`list` 写了位置参数；`args` 里写了 kebab-case/snake_case 键） | 看 `error.details.allowedFields` / `schemaRequest` / `retryRequest`，改正后显式重试（工具不会自动重试） |
| `noImage` | 命令需要检材但没给（`indexes`/`searches` 只给 `--case` 不够） | 补 `--image`，或设 `LOVELYCARVE_IMAGE` |
| `sessionNotFound` / `sessionExited` | 会话不存在 / 后台进程已退出（崩溃、被杀、重启） | 重新 `sessions open <name>`；内存态（解锁、组装、扫描、目录）需重建 |
| `sessionUnavailable` | 进程仍持有会话名但未应答（可能正在开检材） | 用 `sessions get` 复查，别急着重启 |
| `tasksFailed` | 后台任务失败，或结束却没有报告结果 | `details` 里有每条任务；取消不算失败 |
| `aborted` | 删除类命令缺 `--force`（非交互） | 先 `--dry-run` 看请求体，再加 `--force` |
| `readFaultsDetected` | 字节流命令命中读故障（`files read`） | stdout 可能有部分/补零数据，**丢弃**；改用 `files export` 保留审计 |
| `noDataDirectory` | 解析不到用户数据目录 | 设 `LOVELYCARVE_SESSION_DIR` 并检查权限 |
| `invalidInput: invalid escape`（JSONL） | JSON 行里写了 Windows 反斜杠路径 `E:\x\y.raw`，`\x` 被当非法转义 | 改成正斜杠 `E:/x/y.raw`（或双反斜杠）。该行失败不影响后续行，但依赖它的 `$ref` 会连锁报"无效结果引用" |
| `invalidInput: 无效结果引用` | `$ref` 指向的请求失败了，或指针路径不存在 | 先看那一行的 `error`；`$ref` 只指向上一步的 `result` |

## 3 · "结果不完整"的具体字段（退出码 2 的来源）

| 场景 | 字段 | 含义 |
| --- | --- | --- |
| 哈希/导出（`images`/`files`） | `readFaultsDetected`、`syntheticBytes`、`badRegions` | 源坏区被补零；摘要**不能**用于完整性论证；`truncated=false` 不代表无故障 |
| 目录导出 | `truncated`、`cancelled`、`skippedCount` | 提前停止 / 跳过条目 |
| 搜索 | `summary.readErrors`、`summary.truncated` | 有文件读不出 / 命中达上限 |
| 恢复导出 | 失败文件数、`syntheticArtifacts`、`reportError` | 报告或条目写入失败 |

`--limit` 等**调用方自己给的上限不算不完整**（但要在报告里说明"有界采样"）。

## 4 · 不能据此断言"不存在"的情形（写报告必须带上）

1. 目录单页、`truncated:true` 的树遍历、`--limit` 截断的命中列表；
2. 索引未建 / `stale:true` / `truncated:true` / 该卷无索引；
3. 搜索有 `readErrors`、命中上限、编码不支持；
4. 时间线 `skippedInvalidTime>0`（时间无法解释，未投影）；
5. 卷加密未解锁、文件系统不支持、卷被跳过；
6. `files text get` 找不到字符串（只代表该段解码后没有，**不代表**二进制/压缩流里没有）；
7. 雕刻未命中（受 512 字节对齐、碎片化、格式覆盖范围限制）；
8. `indexOnly` 检材（源缺失）：能浏览索引，读字节必失败。

## 5 · 平台/格式能力边界（v1.3.0）

| 类 | 支持 | 明确不支持（会报错，别绕） |
| --- | --- | --- |
| 镜像 | RAW/分片 `.001`/`.dd`、E01/Ex01（纯 Rust，含存储哈希与采集元数据）、VMDK（flat/sparse/streamOptimized/分卷/COWD/seSparse，含父链）、VHD/VHDX、QCOW v1-3（DEFLATE、差分父链）、VDI、Parallels（`DiskDescriptor.xml`/`.hdd`）、ISO/BIN/CUE、AD1、DMG、LDBK、PMFX | VMDK 多分卷差异快照、VHD/VHDX 差分（无父盘绑定）、QCOW 内嵌 LUKS/Zstd/extended L2、加密 EWF2、Android sparse 未展开 |
| 文件系统 | NTFS、FAT12/16/32、exFAT、ext2-4、XFS、Btrfs（子卷/snapshot）、APFS/HFS+、ReFS（读取）、ZFS（视版本）、bcachefs、NILFS2、OCFS2、GFS2、BeFS、ReiserFS、JFS2、Minix、UDF 1.02-2.01、QNX4/6、F2FS、EROFS、SquashFS 1.0-4.0、CramFS/ROMFS、JFFS2、UBIFS、YAFFS1/2、UBI 与多种固件封装 | 需要日志重放/加密/认证的 UBIFS 卷、F2FS 压缩文件内容、EROFS fragments/ztailpacking、NILFS2 dirty/recovery、无原生历史视图（NILFS2 CLI） |
| 加密 | BitLocker（AES-CBC/Elephant/XTS，密码/48 位恢复密钥/BEK/明文密钥/FVEK/VMK，EOW 卷）、LUKS1/2（PBKDF2/Argon2，512/4096 扇区）、VeraCrypt（普通/隐藏、级联、PIM 0-1000）、FileVault 2/CoreStorage | TPM/SID 保护器、LUKS2 完整性/重加密/多数据段/分离头/备份头恢复、VeraCrypt 密钥文件、APFS 原生加密 |
| 逻辑证据 | 文件夹、ZIP/TAR/7z、AD1、Docker 合并视图、iOS 备份（含加密）、Android `.ab`、小米 `.bak`/HDR1、BCP、SQLite/Realm/ZIP/CSV/PE/ELF/Mach-O/GGUF 结构视图、Vim swap、USN/ext4 日志 | 旧 `Manifest.mbdb`、iCloud 下载、二维码/OCR（仅 `*-full` 构建，本机为轻量构建：`system get` 的 `qrcode:false`、`ocr:false`） |

## 6 · Windows 环境与部署（本机实测）

- 部署根 `E:\LovelyCarve\`：`app\`（GUI）、`cli\`（独立 CLI + `lc-plugin-host.exe` + `plugins\linuxinfo`）、`source\`（源码与 `docs/`）、`packages\`（发行包与 SHA256SUMS）、`DEPLOYMENT.md`、`deployment.json`；入口 `E:\LovelyCarve\lovelycarve-cli.cmd`。
- **DLL 偏离**：官方 v1.3.0 的两个 exe 静态导入 `libcrypto-3-x64.dll`，包内只有 `libcrypto-4-x64.dll`（干净机器上以 `0xC0000135` 立即退出）。处置＝把 4 原样复制为 3（app/ 与 cli/ 各一份，两份 SHA-256 相同）；回退 1.2.0 时要删掉这两个文件。
- **写盘位置**（重要）：案件注册表固定写在 `%APPDATA%\app.lovelycarve\case_index.json`（Windows Known Folder，**无法用环境变量重定向**，仅数百字节）；会话文件在 `%APPDATA%\app.lovelycarve\cli-sessions\`，可用 `LOVELYCARVE_SESSION_DIR` 重定向；预览临时文件走系统临时目录，用 `TMP`/`TEMP` 重定向。要求"所有产物限定在某个盘"时：会话/临时目录都能改道，**只有案件注册表这一处改不了**，需在报告里如实说明。
- 需要管理员：读物理磁盘（`disks list` + `images open \\.\PhysicalDriveN`）、采集实时内存、Dokan 挂载/共享。普通镜像与文件夹分析不需要 UAC。
- Git Bash / MSYS2：以 `/` 开头的参数会被改写成 Windows 路径（`--path /` 可能变成 Git 安装目录）。镜像内路径若被改写到 MSYS 安装目录内会被 CLI 还原；**还原不了的（含搜索模式、`--dry-run` 的输出）要在调用前加 `MSYS2_ARG_CONV_EXCL='*'`**。
- PowerShell：`& '<exe>'`；JSON 参数一律存 UTF-8 文件用 `@文件` 传，避免原生参数丢引号；`$LASTEXITCODE` 必须在原生调用后立刻读。
- 同一案件**不能**被桌面端与 CLI 或两个会话同时打开（案件锁）；检材始终以只读打开。

## 7 · 数据与状态生命周期

| 状态 | 存在哪 | 何时丢 |
| --- | --- | --- |
| 案件（台账、索引、搜索历史、时间线、分析结果） | 案件目录 + `case.db` | 手动删除；案件锁定后不能加/删检材或重建快照 |
| 卷索引（无案件时） | 进程内存 | 命令退出 |
| 常驻会话（检材句柄、缓存、组装卷、当前目录） | 后台进程 | 进程结束 / 崩溃 / `sessions close` |
| 解锁的加密卷、`decrypted://` 镜像 | 进程内存 | 进程结束；关闭源镜像会连带关闭其解密镜像 |
| 雕刻/恢复扫描 | 进程内存 | 进程结束（**不落盘**） |
| 挂载点、SMB 共享、媒体预览临时文件 | 进程内存/临时目录 | 进程结束 |
| 凭据 | 从不写入案件/任务/日志 | 进程结束需重新输入 |

## 8 · 交付前自查清单

- [ ] 报告里每条结论都有：源路径 + 定位（偏移/行号/时间戳）+ 方法（可复现命令）
- [ ] 文件类证据有 SHA-256；含读故障的哈希已标注 `readFaultsDetected`/`syntheticBytes`
- [ ] 时区来源写明（`timestampDisplay.timeZone.source`），未转换字段已列出
- [ ] 覆盖范围写明：哪些卷/文件系统未支持、哪些索引未建/被截断、哪些搜索有读错误
- [ ] 雕刻/恢复结果已复核（格式可打开 + SHA-256 与恢复报告一致），"签名命中"未被当成"已恢复"
- [ ] 所有导出落在独立工作目录，未覆盖任何已存在文件，未写入检材目录
- [ ] 未执行的操作标注"未执行"；推测标注"推测"
