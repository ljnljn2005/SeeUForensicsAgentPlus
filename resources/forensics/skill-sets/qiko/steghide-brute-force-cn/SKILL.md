---
name: steghide-brute-force-cn
description: 对 steghide 隐写图片（jpg/bmp/wav/au）做密码爆破与载荷提取（电子数据取证）。基于退出码语义做命中判断、字节级字典读取防编码坑、独立验证防假阳性，并处理提取载荷为加密 ZIP/xlsx 的后续识别。当用户提供疑似 steghide 隐写的图片和密码字典、要求破解隐写密码或提取隐藏载荷时使用。
agent_created: true
---

# steghide 隐写密码爆破与载荷提取

对 steghide 加密的隐写图片执行字典爆破，提取隐藏载荷。全程只调用 steghide 官方二进制，不修改原始图片。

## 何时使用

- 拿到 jpg/bmp/wav/au，怀疑用 steghide 嵌入了隐藏数据
- 手头有候选密码字典（每行一个密码），需要批量尝试
- 已知密码但需要规范地提取并识别载荷类型

## 环境与硬约束

- steghide 0.5.1 win32 便携版（含 cygwin1.dll 等依赖，exe 与 dll 必须同目录）
- **路径风格**：steghide.exe 只接受 Windows 绝对路径（`C:\...`），不接受 Git Bash 的 `/c/...`。在 Git Bash 中 `cd` 到工具目录后用相对路径调用最稳。
- 产物一律写 `D:\WorkBuddy取证分析\<YYYY-MM-DD>\`，不污染 C 盘工作区。

## 退出码语义（命中判断的唯一依据）

| 退出码 | 含义 | stderr 特征 |
|--------|------|-------------|
| 0 | 提取成功（密码正确） | `wrote extracted data to "..."` |
| 1 | 密码错误 / 无嵌入数据 | `could not extract any data with that passphrase!` |

**先做健康检查再爆破**：用一个必然错误的密码跑一次，确认退出码语义与本机行为一致（见下面"工作流"第 1 步）。

## 工作流

### 1. 健康检查（必做）

```bash
cd <steghide目录>
./steghide.exe extract -sf "目标.jpg" -p "wrongpass_probe" -xf "/tmp/probe.bin" -f
echo "exit=$?"   # 期望 exit=1 + 密码错误提示
```

注意：`steghide info` 不支持 `-d` 参数，会报 `unknown argument`。info 探测嵌入数据时可交互式输入密码，脚本化场景直接用 extract + 退出码判断即可。

### 2. 图片结构侧写（辅助判断，可选）

用 Python 解析 JPEG 标记段（SOI/APP0/DQT/SOF/DHT/SOS/EOI）。两个经验：

- **steghide 数据嵌在 DCT 系数里，文件结构完全正常**——结构干净不能排除 steghide；EXIF/COM 被清空的"过度干净"反而是人为处理过的暗示。
- 文件尾部无追加数据（EOI 后无字节）可排除最简单的追加式隐写，把嫌疑收敛到系数嵌入类。

### 3. 字典爆破（核心）

运行 `scripts/steghide_crack.py`（纯标准库，Python 3.8+）：

```bash
python scripts/steghide_crack.py \
  --steghide "C:\...\steghide.exe" \
  --image    "C:\...\important.jpg" \
  --wordlist "C:\...\常用密码.txt" \
  --outdir   "D:\WorkBuddy取证分析\<日期>" \
  --variants          # 同时尝试 原样/去首尾空白 变体
```

先 `--dry-run` 验证字典读取健康（看首末条密码与字节数），再实跑。脚本特性：

- **字节级读字典**：剔除 UTF-8 BOM、按字节切行、CRLF/CR/LF 全兼容，密码不因 shell 编码处理走样
- 每条候选独立调 `subprocess`，超时保护，命中即停
- 产出：逐条日志（`brute_force_v2.log`）+ 结果报告（`brute_force_v2_report.txt`）+ 提取载荷（`extracted_payload`）

性能参考：1000 条字典约 40–90 秒（每条约 40–90ms，进程启动开销为主），无需并行。

### 4. 独立验证（防假阳性，必做）

命中后**不要直接采信脚本结论**，用命中的密码手动重跑一次 steghide，确认 exit=0 且输出文件非空：

```bash
./steghide.exe extract -sf "目标.jpg" -p "<命中密码>" -xf "<验证输出>" -f
```

### 5. 载荷识别

对提取出的载荷看文件头：

- `PK\x03\x04` → ZIP（xlsx/docx 本质是 ZIP；若文件名可见中文如 `xx.xlsx`，直接改名 .xlsx）
- `7z¼¯\x27\x1c`、`\x52\x61\x72\x21`、`\x1f\x8b` → 对应压缩格式
- RAR/ZIP 加密 → 下一层密码破解问题（7z 可列名验证：`"C:\Program Files\7-Zip\7z.exe" l <文件>`）

已知现象：steghide 提取的 ZIP 载荷用 Python `zipfile` 可能报 `BadZipFile`（头部有 `PK\x07\x08` 数据描述符前缀等结构变异），但 7-Zip 能正常列出并解压——**用 7z 验证，别只信 Python zipfile**。

## 踩坑记录（重要）

1. **PowerShell 脚本路线全坑**：PS5.1 跑 UTF-8 脚本必须带 BOM；`Set-Content -Encoding UTF8` 会把 GBK 文件二次破坏；`@(...) -join` 在 PS5.1 报错。**优先用 Python 脚本**，PowerShell 只做兜底。
2. **Python 写日志文件**：`open(path, "wb")` 后写 str 直接 TypeError。统一 `open(path, "w", encoding="utf-8")`，别混用 bytes/str。
3. **字典"跑完没命中"先怀疑读取层**：dry-run 打印首末条密码的 `repr()` 和字节数，确认无 BOM、无行尾空白、无编码错位，再怀疑密码真不在字典里。
4. **空密码也试一次**：`-p ""` 是合法参数，不少案例嵌入时未设密码。
5. **退出码 1 的两种含义无法从输出区分**（密码错 vs 文件里根本没有 steghide 数据）。字典穷尽仍未命中时，应转向其他隐写工具排查（jphide/outguess/jsteg/F5 等），不要无限换字典死磕。

## 产出物清单（每次作业固定）

| 文件 | 说明 |
|------|------|
| `brute_force_v2.log` | 逐条尝试日志（含退出码），复核依据 |
| `brute_force_v2_report.txt` | 结果报告（密码、耗时、尝试数） |
| `extracted_payload` | 命中后提取的原始载荷 |
| `<载荷>.xlsx/.zip` 等 | 按文件头改名后的载荷副本 |

报告与日志即取证记录，保留完整链路：字典来源、尝试区间、命中序号、独立验证结果。

## 使用步骤

> 本节作为既有「工作流」的取证化扩展：先做无损分诊，再进入 steghide 爆破；命中后继续做嵌套载荷还原。与原文不冲突；如与本地取证规范冲突，以待人工裁决为准。

### 1. 证据固定与案件分诊
- 对原始文件计算 SHA256，并将原始件设为只读；所有分析使用工作副本。
- 建立统一输出目录，例如 D:/WorkBuddy取证分析/<YYYY-MM-DD>/case_id/。
- 记录来源、提取人、时间、文件路径、磁盘位置；后续每一步命令与产物都要能回溯。
- 适用条件：所有疑似隐写文件；这是电子取证的第一道防线，避免污染原始证据。

### 2. 文件类型与结构初检
- 用 file、magic、ExifTool 或十六进制查看器确认真实类型，不以扩展名为准。
- steghide 适用媒介：JPEG、BMP、WAV、AU；若实际是 PNG、GIF、TIFF、WebP，转其他隐写分析路线。
- 检查 JPEG 结构是否完整：SOI、APP、DQT、SOF、DHT、SOS、EOI；结构过度干净可能提示人为清理。
- 检查文件尾部附加数据：JPEG 看 EOI 之后、BMP 看数据块之后、WAV 看 RIFF chunk 之外是否有追加字节。
- 对可疑文件先做 binwalk 扫描；若识别出压缩包、可执行文件、邮件、宏文档、APK、EXE，优先提取并单独分析。
- 文件头损坏时先做文件头修复，再识别；适用条件是魔术字节异常但数据区仍完整。
- 图片高度修复适用于 BMP/PNG 类尺寸字段异常导致图像被截断的场景；JPEG 通常不适用，避免误改。
- 若图像中存在可见或阈值化后出现的二维码，先解码；若出现文字，做 OCR。
- 音频先听音，再看频谱；适用条件包括摩斯电码、DTMF、SSTV、异常停顿、语音转写线索。

### 3. 固定检查项（防漏清单）
- EXIF 与缩略图：检查拍摄参数、软件、缩略图、隐藏图；缩略图可能独立携带线索。
- 图片尾部附加数据：提取为独立二进制，再做 file、strings、binwalk。
- 压缩包分卷与强制解压：分卷必须收集齐全；对结构异常的 ZIP/RAR 用 7z 列目录与尝试解压。
- Office XML 解析：docx/xlsx/pptx 本质是 ZIP，检查隐藏单元格、批注、自定义属性、宏与 OLE 对象。
- 邮件附件：识别 MIME、RFC822、内嵌对象、附件编码；注意隐藏正文与头字段。
- 宏文档与内嵌文档：先静态解析，不直接启用宏；提取嵌入对象后按文件头重新归类。
- APK/EXE 逆向：仅做静态解包、资源提取、签名与字符串分析；除非有沙箱授权，不直接运行。
- 脚本注释与隐藏文件：检查文本、仓库、压缩包隐藏项、备用数据流、注释中的编码串。

### 4. steghide 健康检查
- 进入 steghide 工具目录，使用工作副本执行一次错误密码探测：
```bash
cd /path/to/steghide
./steghide.exe extract -sf work_copy.jpg -p wrongpass_probe -xf probe.bin -f
echo $?
```
- 预期退出码为 1，并出现密码错误提示；若退出码异常、程序崩溃或依赖缺失，先修复环境。
- 不要跳过健康检查：不同系统封装的 steghide 可能存在退出码、编码、路径行为差异。

### 5. 字典准备与预检
- 字典应为一行一个密码；保留原始字节，避免 shell 或编辑器改变编码。
- 检查 BOM、CRLF/CR/LF、空行、首尾空白；对高价值字典先做 dry-run，打印首末条密码的字节表示。
- 同时准备空密码候选；不少案例嵌入时未设密码。
- 可生成常见变体：去首尾空白、大小写变体、日期后缀；但需记录变体规则，避免结果不可解释。

### 6. 字典爆破
- 使用脚本化爆破，避免手工逐条执行造成日志缺失：
```bash
python scripts/steghide_crack.py --steghide C:/Tools/steghide/steghide.exe --image C:/cases/work_copy.jpg --wordlist C:/cases/wordlist.txt --outdir D:/WorkBuddy取证分析/<日期>/case_id --variants
```
- 先执行 dry-run 验证字典读取层，再实跑。
- 命中判断只采用退出码与 steghide 标准错误输出：退出码 0 且写出提取文件才算命中。
- 对每条候选记录序号、密码表示、退出码、耗时；命中即停，避免覆盖已提取载荷。

### 7. 独立验证
- 命中后必须用命中的密码手动重跑一次，输出到独立验证文件：
```bash
./steghide.exe extract -sf work_copy.jpg -p hit_password -xf verify_payload.bin -f
echo $?
```
- 验证三件事：退出码为 0、输出文件非空、文件头与脚本提取结果一致。
- 对验证文件计算 SHA256；若与脚本产物不一致，标记假阳性并复核日志。

### 8. 载荷识别与嵌套提取
- 先看文件头，再决定后续工具：
  - PK 开头：ZIP、docx、xlsx、pptx、jar、apk 等容器。
  - 7z、RAR、gzip 头：对应压缩格式。
  - PDF、OLE、PE、ELF、Mach-O、SQLite：进入对应取证分析路线。
- 对 ZIP 类载荷优先用 7z 列目录与解压；Python zipfile 对异常结构可能误报，不能单独作为结论。
- 若载荷为加密 ZIP/RAR/7z，记录加密算法、文件名是否可见、错误提示，然后进入下一层密码破解。
- 若载荷为 Office 文档，解包 XML，检查宏、OLE、隐藏单元格、批注、自定义属性、外部链接。
- 若载荷为邮件、APK、EXE，按静态取证流程提取资源、清单、字符串、签名与内嵌对象。

### 9. 多媒体与隐藏线索还原
- 图片尾部附加数据：识别 EOI 后多余字节，提取为 bin，输出文件头与哈希。
- 音频频谱摩斯电码：在频谱图中识别点划节奏，解码为文本，输出 txt 与截图。
- 二进制索引异或词典：当存在可疑偏移、单字节异或或短密文时，用词典生成候选明文并人工复核。
- 脚本注释和隐藏文件：检查注释、隐藏文件、备用数据流、版本控制残留，输出原文与路径。
- 每类线索都要固定三要素：识别特征、提取命令、输出格式；避免只给结论不给复现路径。

### 10. 结束判定与转向
- 命中：归档密码、命中序号、载荷、哈希、日志、报告与验证结果。
- 未命中：字典穷尽后不能无限换字典死磕；记录已尝试范围，转向 jphide、outguess、jsteg、F5、zsteg、音频频谱或容器嵌套分析。
- 若确认无 steghide 数据，也应在报告中说明健康检查、字典预检与退出码证据。

## 输入输出说明

### 输入
- 目标文件：JPEG、BMP、WAV、AU 的工作副本；需提供文件路径、大小、SHA256、来源。
- 原始证据：应保留只读状态，不直接作为提取对象；如必须修复，先复制并在报告中记录修复行为。
- 密码字典：纯文本，每行一个密码；需记录编码、行数、字典哈希、是否包含空密码与变体规则。
- 已知密码：可选；若已知密码，跳过爆破，直接执行提取与验证。
- 工具路径：steghide.exe、Python、7z、binwalk、ExifTool 等；路径应避免 shell 转义问题。
- 输出目录：固定写入案件目录，不写入原始证据目录，避免交叉污染。
- 运行选项：是否 dry-run、是否启用变体、单条超时、是否保留中间文件。

### 输出
- 退出码状态：0 表示提取成功；1 表示密码错误或无嵌入数据；其他值表示环境或参数异常。
- 爆破日志：逐条记录序号、时间、密码表示、退出码、耗时；日志用于复核与法庭可解释性。
- 结果报告：记录目标哈希、字典哈希、工具版本、开始结束时间、尝试数、命中密码、命中序号。
- 提取载荷：原始命名为 extracted_payload，随后按文件头改名；必须记录载荷 SHA256 与文件大小。
- 验证产物：独立验证输出文件、验证退出码、验证文件哈希；用于排除脚本假阳性。
- 嵌套提取产物：解包目录、7z 列表、宏对象、OLE 对象、邮件附件、资源文件、静态分析摘要。
- 辅助证据：文件头识别结果、EXIF 摘要、缩略图、频谱截图、二维码解码文本、OCR 文本。

### 中间产物与命名
- probe.bin：健康检查输出，通常为 0 字节或不存在；用于确认工具行为。
- work_copy：原始文件的工作副本，所有分析基于该副本。
- verify_payload.bin：独立验证输出，必须与脚本提取载荷哈希一致或可解释差异。
- extracted_dir：嵌套解包目录，按层级命名，避免覆盖。
- 所有产物统一放在案件输出目录，并附产物清单与哈希表。

### 异常与边界
- 字典跑完无命中：不能直接断定无隐写；需说明字典覆盖范围，并给出转向其他工具的建议。
- 退出码 1：无法区分密码错误与无嵌入数据；应结合文件类型、结构侧写和其他隐写工具结果判断。
- 载荷为加密压缩包：本技能只能提取到容器，不能保证解密；需记录加密格式并进入下一层破解。
- 文件结构损坏：先修复或镜像分析；任何修复操作必须记录为派生处理。
- 编码异常：字典含 BOM、CRLF、GBK/UTF-8 混编时，优先做字节级读取与 dry-run。

### 交付格式
- 最终交付至少包括：结果报告、爆破日志、提取载荷、验证载荷、哈希清单、命令记录。
- 报告应能复现：给定相同工具版本、目标副本、字典与参数，可得到相同结果。
- 若未命中，交付未命中说明、已尝试字典范围、健康检查证据与后续排查建议。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
