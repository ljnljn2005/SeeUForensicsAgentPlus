---
name: image-steganography
version: 2.0.0
description: "识别与破解图片隐写（steganography）。当任务涉及图片中可能藏有隐藏文件 / flag / 附加数据、LSB 位平面隐写、EXIF/元数据线索、文件尾追加、PNG 高度/宽度被改、通道/位平面分析、二维码隐藏、GIF/APNG 多帧、JPEG steghide 口令隐写、盲水印/频域，或对可疑图片做取证、解 CTF Misc/Stego 题时使用。流程化：先判图片真实类型，再按隐写类型逐层穷举；以自带 Python(uv run) 脚本为主，zsteg/exiftool/steghide 等便携工具可用时优先调用。"
author: honglian
---

# 图片隐写识别与破解

帮助对一张可疑图片完成**隐写排查**：判断里面是否藏了文件、flag、附加数据或隐写信息，并给出提取办法。
适用于数字取证中的可疑图片分析，以及 CTF 的 Misc/Stego 题。

**方法论：先判类型，再按隐写类型逐层穷举。** 现成工具（zsteg/Stegsolve/binwalk）只是把常见思路打包；底层都是「遍历参数 → 抽数据 → 看是否可读」。本 skill 以**自带 Python 写脚本穷举**为主干，不被「工具装没装」卡住。

---

## 何时使用

- 怀疑图片里藏了另一个文件（压缩包、文本、第二张图、可执行文件）
- 找隐藏的 flag / 口令 / 坐标 / URL / 二维码
- 图片打开正常但「体积异常偏大」「显示不全」「来路不明」「题目暗示有隐藏内容」
- 需要分析 EXIF/元数据、LSB 位平面、颜色通道、文件尾追加、PNG 尺寸篡改、GIF 帧、盲水印

---

## 运行环境（重要）

本应用运行在 **Windows**，`exec` 工具用 **PowerShell 语法**。

- **跑 Python 脚本一律用 `uv run`**：`uv` 已随包提供并在 PATH 上，`uv run` 会自动按脚本头部声明装好依赖（pillow / numpy 等），离线即用，**无需你先 `pip install`**：
  ```powershell
  uv run "<skill 目录>\scripts\identify.py" .\suspect.png
  ```
  `<skill 目录>` 用本 skill 的真实绝对路径替换。脚本会把提取产物写到 `.\<图名>_steg\` 输出目录。
- **第三方便携工具按需调用**：zsteg / exiftool / binwalk / steghide / stegseek / pngcheck 若已放进应用 `tools\` 目录（在 PATH 上）或系统 PATH，可直接调用，效果更强；**没装也不影响**——核心能力都有 Python 脚本兜底。
- 工具的调用方式与平台无关（`zsteg -a a.png` 在哪都一样）；只有「循环、管道、重定向」才按 PowerShell 写。

> ⚠️ **取证完整性**：**先对原图算哈希（`Get-FileHash`），再在原图上只读分析**（脚本/工具都不写原图），不要改证据原件、也不必复制原图。所有提取/分离产物写到 workspace 里的独立输出目录。

---

## 排查流程

### 步骤 0 · 取证完整性
```powershell
Get-FileHash .\suspect.png -Algorithm SHA256    # 先留存原图哈希
```
先算哈希留证，然后**直接在原图上只读分析**——下面所有脚本/工具都只读原图，产物一律写到独立输出目录，**无需复制原图**。若某工具（如 `binwalk -e`）默认把提取物落在输入文件同级目录，就把 `exec` 的 `cwd` 设成你 workspace 的输出目录，别污染证据目录。

### 步骤 1 · 判断图片真实类型（先做这步）
扩展名会骗人，结构异常本身就是线索。
```powershell
uv run "<skill 目录>\scripts\identify.py" .\suspect.png
```
`identify.py` 报告：真实格式 vs 扩展名是否对不上、尺寸、颜色类型、**IEND/FFD9 后的追加数据**、多图拼接（多个文件签名）、文本块/调色板/APNG 等结构特征、以及 **PNG 高度疑似被改**——并据此建议优先试哪些技法。

### 步骤 2 · 按隐写类型逐层排查
按下表逐个试；一个没结果**不代表没隐写**，换一个继续，常见是「尾部追加 + LSB」等多手法叠加。

| # | 隐写类型 | 首选（Python，自带） | 适用格式 | 便携工具更强（若可用） |
|---|----------|----------------------|----------|------------------------|
| 1 | **LSB / 位平面** | `uv run "<skill 目录>\scripts\lsb_scan.py" .\suspect.png --show-best` | PNG/BMP/GIF | `zsteg -a .\suspect.png` |
| 2 | **EXIF / 元数据** | `uv run "<skill 目录>\scripts\exif_dump.py" .\suspect.jpg` | 全部 | `exiftool -a -G1 -u .\suspect.jpg` |
| 3 | **文件尾追加 / 内嵌** | `uv run "<skill 目录>\scripts\carve.py" .\suspect.png` | 全部 | `binwalk -e .\suspect.png` |
| 4 | **PNG 高度/宽度篡改** | `uv run "<skill 目录>\scripts\png_height_fix.py" .\suspect.png` | PNG | `pngcheck -v .\suspect.png`（先确认 CRC 错） |
| 5 | **通道 / 位平面分析** | `uv run "<skill 目录>\scripts\bit_planes.py" .\suspect.png` | PNG/BMP | （Stegsolve GUI，需人工查看时） |

**扩展技法**（按线索触发）：

| 隐写类型 | 脚本 | 何时用 |
|----------|------|--------|
| **二维码 / 条码** | `uv run "<skill 目录>\scripts\qr_decode.py" .\suspect.png` | 图里有二维码/条码，或位平面导出后发现码图 |
| **GIF / APNG 多帧** | `uv run "<skill 目录>\scripts\frames.py" .\suspect.gif` | 动图，疑似某帧藏信息 / 逐帧编码 |
| **盲水印 / 频域** | `uv run "<skill 目录>\scripts\freq.py" .\suspect.png` | 题面提示水印 / 像素域查不到 / 看 FFT 幅度谱找周期图案 |

**JPEG 专项**（LSB 对 JPEG 无效，有损压缩会破坏像素低位）：
- 口令隐写是 JPEG 主向量，**优先用便携工具**（无 Python 等价、但单 exe 易打包）：
  ```powershell
  steghide info .\suspect.jpg              # 是否含 steghide 数据
  steghide extract -sf .\suspect.jpg -p "" # 空口令试一发
  stegseek .\suspect.jpg .\rockyou.txt     # 字典爆破口令
  ```
- EXIF 缩略图与主图不一致（藏图经典手法）：`exif_dump.py` 会自动提取缩略图；或 `exiftool -b -ThumbnailImage .\suspect.jpg -o thumb.jpg`。
- 多个 `FFD8` 拼接：`identify.py` 会报，`carve.py` 负责分离。

### 步骤 3 · 通用兜底：有思路就 `uv run` 现写脚本
**隐写破解的本质是「有思路就能穷举」。** 可穷举的维度：**通道、位平面、像素遍历顺序、比特序、起始偏移、按行/列、是否异或/再解码**。一个组合没结果就换一个维度继续，必要时多维度一起爆破。
`references\python-recipes.md` 提供可直接改的片段：通道分离、双图异或、拼图、像素值转文本、palette 隐写、单字节异或爆破、最小 LSB 提取等。

---

## per-format 清单（逐项核对）

**PNG**：① 真实格式/尺寸（identify）② IEND 后追加数据（carve）③ LSB/位平面（lsb_scan / bit_planes）④ tEXt/zTXt/iTXt 文本块（carve）⑤ 高度/宽度被改（png_height_fix）⑥ 调色板隐写（palette，见 recipes）⑦ APNG 多帧（frames）⑧ IDAT 异常/非常规 filter。

**JPEG**：① EXIF/Comment（exif_dump）② 缩略图≠主图（exif_dump）③ steghide/stegseek 口令隐写 ④ FFD9 后追加数据（carve）⑤ 多个 FFD8 拼接（identify→carve）。**不要对 JPEG 做像素 LSB**。

**GIF**：① 多帧逐帧（frames）② Comment Extension（carve/exif）③ 调色板 ④ 帧延迟编码。

**BMP**：① 无压缩、LSB 容量大（lsb_scan / bit_planes）② 像素行 padding 可藏数据 ③ 尾部追加（carve）。

---

## 套路速查（特征 → 解法）

| 套路 | 特征 | 解法 |
|------|------|------|
| PNG 高度被改 | 图显示不全 / pngcheck 报 CRC 错 | `png_height_fix.py`（爆破高/宽 + 导正 CRC） |
| LSB 隐写 | 图看着正常但有隐藏信息 | `lsb_scan.py --show-best`；PNG 另可 `zsteg -a` |
| EXIF 隐藏 | 元数据藏 flag/提示 | `exif_dump.py`（重点 Comment/Description/Artist/GPS） |
| 文件拼接/图后藏包 | 体积偏大 / 尾部有数据 | `carve.py`（IEND·FFD9 后数据 + 签名雕复 + 解码链） |
| Steghide 加密 | JPG，info 提示需口令 | 空口令 → `stegseek` 字典爆破（口令常在题面/文件名） |
| 通道隐写 | 某颜色通道异常 | `bit_planes.py` 导各通道×位平面 PNG 看 |
| 二维码隐藏 | 图中有码 / 某位平面是码图 | `qr_decode.py`（pyzbar） |
| 图片拼图 | 多张需拼接 | recipes 的「拼接」片段 |
| 像素值编码 | 像素值对应 ASCII | `lsb_scan.py --mode pixel`，或 recipes 像素转文 |
| GIF 帧分析 | 动图某帧藏信息 | `frames.py` 逐帧导出再逐张排查 |

---

## 常见线索模式（搜字符串时重点看）
`flag{` / `FLAG{` / `ctf` / `PK\x03\x04`(zip) / `Rar!`(rar) / `http(s)://` / base64 串（`[A-Za-z0-9+/]{20,}={0,2}`）/ 十六进制串 / Morse / 坐标。

## 联网可用时（在线整合工具，作交叉验证）
- **aperisolve.com**：一键跑 zsteg/steghide/binwalk/Stegsolve 并汇总。
- **stegonline.net**：在线 LSB / 位平面分析。
- **29a.ch/photo-forensics**：ELA 等图片取证。

## 注意事项
1. **先哈希、在原图上只读分析**（产物写独立目录），保护证据原件，无需复制原图。
2. 一个工具/脚本没结果 ≠ 没隐写，**多种手法叠加排查**（尤其「尾部追加 + LSB」组合）。
3. 找到疑似数据再判编码：base64 / hex / 压缩包 / 进一步隐写（**套娃常见**）。
4. 所有提取产物集中放到独立输出目录，便于归档与复核。

## 使用步骤

本节补充标准化实操步骤，与已有「排查流程」互补；所有操作保持原检材只读，先哈希、后提取、再交叉验证。

### 0. 操作原则
- 先固定、再无损、后派生提取；派生包括修复、解压、异或、解码，均不覆盖原件。
- 每一步记录命令、工具版本、输入哈希、输出文件与父文件关系。
- 多手法叠加是常态：尾部附加 + LSB + 二次编码很常见，单项阴性不能停止排查。
- 外部工具仅在可用时调用；不可用时回到自带脚本、Python 解析与手工结构分析。

### 1. 受案与证据固定
- 适用条件：任何可疑图片、嵌套文件、邮件附件、多媒体检材进入分析台。
- 操作：
  1. 记录来源、文件名、大小、时间戳、题面或案情线索。
  2. 计算哈希：`Get-FileHash ./suspect.png -Algorithm SHA256`。
  3. 建立独立输出目录，例如 `./case_001/suspect_steg/`。
  4. 只读分析；若工具会写回输入文件，将工作目录指向输出目录，或生成派生副本，不覆盖原件。
- 专家考量：不要急于打开图片；先记录异常体积、重复魔数、熵值与文件尾偏移，后续所有结论都要能回溯到哈希与命令日志。

### 2. 快速识别与异常定位
- 适用条件：扩展名不可信、文件打不开、体积异常、显示异常、题目提示隐藏内容。
- 固定检查：真实类型、魔数、尺寸、颜色模式、熵、字符串、多签名、尾部附加数据。
- 命令：`uv run <skill_dir>/scripts/identify.py ./suspect.png`
- 识别特征：PNG 看 `89 50 4E 47 0D 0A 1A 0A` 与 IEND；JPEG 看 `FF D8` 与 `FF D9`；GIF 看 `GIF87a` 或 `GIF89a`；BMP 看 `BM`；WebP 看 `RIFF` 与 `WEBP`。
- 输出：真实格式、结构异常、疑似偏移、优先技法建议。

### 3. 文件头修复
- 适用条件：文件无法识别但残留图片结构；魔数被截断、单字节异或、头部字段损坏。
- 操作：
  1. 备份原始字节到 `02_fixed/original_header.bin`。
  2. 按已知签名修复：PNG 补 8 字节魔数与 IHDR；JPEG 补 `FF D8 FF`；GIF 补 `GIF89a`；BMP 补 `BM` 与文件大小字段。
  3. 若整体疑似异或，先对文件头做单字节异或还原，使魔数对齐。
  4. 生成 `*_fixed` 副本，不修改原件。
- 陷阱：错误修复会污染后续解码；每个修复版本都要记录父哈希、差异偏移和修复依据。

### 4. 嵌套文件与尾部附加提取
- 适用条件：体积偏大、IEND 或 FFD9 后仍有数据、binwalk 报多签名、图后藏压缩包/文档/音频/第二张图。
- 固定检查：
  - `uv run <skill_dir>/scripts/carve.py ./suspect.png`
  - `binwalk ./suspect.png`
  - `binwalk -e ./suspect.png`
  - `foremost -i ./suspect.png -o ./case_001/suspect_steg/foremost`
- 将 binwalk 或 foremost 的工作目录设为输出目录，避免污染证据目录。
- 压缩包与分卷：合并分卷后再解压；对损坏结构可尝试 `7z x -y` 强制解压，但必须记录原始压缩结构与加密标志。
- 输出：`01_carved/`，按偏移命名，例如 `offset_00012345.zip`，并记录来源偏移、签名、大小、哈希。

### 5. 图片几何与显示修复
- 适用条件：PNG 显示不全、pngcheck 报 CRC 错、宽高被改、图片下半部缺失。
- 操作：
  1. `pngcheck -v ./suspect.png` 定位 IHDR CRC 错。
  2. `uv run <skill_dir>/scripts/png_height_fix.py ./suspect.png`
  3. 对 JPEG 截断，检查 `FF D9` 是否完整；若缺失，可尝试按已有扫描数据渲染副本，但只能作为线索，不作为原始证据。
  4. 输出 `02_fixed/height_fixed.png`、修复参数、正确宽高、CRC 变更。
- 陷阱：不要直接改原图；不要仅凭视觉判断修复成功，需复核 CRC、边界像素和文件结构。

### 6. 元数据、缩略图与可视层固定检查
- 适用条件：EXIF/XMP/IPTC 藏文本、缩略图与主图不一致、图中出现二维码/条码/文字、位平面异常。
- 固定检查：
  - `uv run <skill_dir>/scripts/exif_dump.py ./suspect.jpg`
  - `exiftool -a -G1 -u ./suspect.jpg`
  - 提取缩略图：`exiftool -b -ThumbnailImage ./suspect.jpg -o ./case_001/suspect_steg/thumb.jpg`
  - 二维码/条码：`uv run <skill_dir>/scripts/qr_decode.py ./suspect.png`，必要时先反色、放大、补静区，再用 `zbarimg`。
  - OCR：对位平面导出图或文本区域执行 `tesseract ./candidate.png out --psm 6`，多语言时加 `-l eng+chi_sim`。
  - LSB 与位平面：`uv run <skill_dir>/scripts/lsb_scan.py ./suspect.png --show-best`、`uv run <skill_dir>/scripts/bit_planes.py ./suspect.png`。
- 输出：元数据文本、缩略图、码内容、OCR 文本、位平面图。
- 误判规避：OCR 结果需人工复核；二维码需保留原始码图、解码坐标和纠错等级。

### 7. 频域、盲水印与变换域
- 适用条件：题面提示水印、像素域无结果、图像有周期纹理、JPEG 有损压缩导致 LSB 不可靠。
- 操作：
  1. `uv run <skill_dir>/scripts/freq.py ./suspect.png` 查看 FFT 幅度谱。
  2. 对 JPEG 优先看 DCT 系数、量化表、注释与缩略图，不做像素 LSB 作为主结论。
  3. 若频谱出现周期亮点或规则图案，导出频谱图并尝试反变换、裁剪、阈值化。
- 输出：`03_freq/fft.png`、DCT 分块结果、候选水印文本或图案。

### 8. 音频与多媒体扩展隐写
- 适用条件：图片内嵌音频、附件为音频、题目提示语音、摩斯电码、频谱图、语音转写。
- 固定检查：
  1. `ffprobe ./embedded_audio.wav` 判断编码、通道、采样率。
  2. `ffmpeg -i ./embedded_audio.wav ./audio_norm.wav` 归一化。
  3. `ffmpeg -i ./audio_norm.wav -filter_complex showspectrogram=mode=combined:color=intensity ./spectrogram.png` 查看频谱文字、二维码、摩斯电码。
  4. 对 WAV 做 PCM LSB 提取；对 MP3 检查帧注释、ID3/APE、异常附件。
  5. 若频谱出现点划间隔，按摩斯电码转写，输出 `morse.txt` 与解码文本。
- 输出：音频流、频谱图、转写文本、时间轴、置信度。

### 9. 邮件、Office、宏与内嵌文档
- 适用条件：图片来自邮件附件、文档内嵌对象、OLE/OOXML 容器、题目给出 doc/docx/xls/xlsm/eml/msg。
- 操作：
  1. 对 `.eml/.msg` 用 `munpack` 或 `ripmime` 提取附件。
  2. 对 OLE 文档检查流名与宏：`olevba ./doc.docm`。
  3. 对 OOXML 解包查看 `word/media/`、`docProps/custom.xml`、`[Content_Types].xml`、隐藏文本与批注。
  4. 对宏文档提取 `vbaProject.bin`，分析自动执行函数、Base64、PowerShell、URL。
- 输出：附件清单、宏代码、隐藏文本、外部链接、二次检材。

### 10. APK/EXE 资源与二进制逆向扩展
- 适用条件：图片藏在安装包、PE 资源、Android assets、可执行文件尾部，或线索指向脚本注释、隐藏文件、二进制索引。
- 操作：
  1. 对 APK 解包检查 `assets/`、`res/drawable/`、`resources.arsc`。
  2. 对 PE 检查资源段、版本信息、图标、字符串与尾部附加：`strings -el ./sample.exe`、`binwalk -e ./sample.exe`。
  3. 对可疑二进制做索引异或：用已知文件头与目标魔数异或得到 key，再按偏移批量解码。
  4. 对脚本注释、隐藏文件、NTFS ADS、`.git`、`.DS_Store`、`Thumbs.db` 做固定排查。
- 输出：资源文件、异或 key、偏移范围、还原文件。恶意样本必须在隔离环境分析。

### 11. 解码链与递归验证
- 适用条件：提取结果仍是 base64、hex、rot、xor、压缩包、二次图片、嵌套音频或文档。
- 操作：
  1. 识别编码：长度与字符集、等号填充、`PK 03 04`、`Rar!`、`7z`、`MZ`。
  2. 按链解码：base64 到 hex，再到 xor，再到 zip，再到图片。
  3. 每层输出到独立目录，保留父文件哈希与层级关系。
  4. 对最终文本搜索 `flag{`、`ctf`、`http`、坐标、口令。
- 输出：`06_decoded/chain.md`，包含每一层输入、命令、输出、置信度。

### 12. 结果确认与报告
- 至少用两种方法或两个工具交叉验证同一结论。
- 对误报做排除：随机高熵不等于隐写；可解压但无有效载荷不算结论；OCR 单字命中需上下文。
- 报告包含：原始哈希、工具版本、命令、输出目录、关键截图、提取文件哈希、结论与置信度。

## 输入输出说明

### 输入
#### 1. 检材对象
- 原始图片：PNG、JPEG、GIF、BMP、WebP、TIFF。
- 嵌套检材：邮件、压缩包、Office 文档、APK/EXE、音频、视频、内存转储。
- 上下文：题面、口令、字典、来源系统、时间范围、业务场景。

#### 2. 环境与参数
- `skill_dir`：脚本所在目录。
- `output_dir`：独立输出目录，禁止与证据原件混放。
- `wordlist`：口令字典或异或词典。
- `recursive`：是否递归处理嵌套文件。
- `force_extract`：是否强制解压或强制修复。
- 取证要求：原检材只读、哈希固定、输出目录隔离。

#### 3. 最小输入字段
- `sample_path`
- `case_id`
- `output_dir`
- `wordlist`
- `known_clues`

### 输出
#### 1. 目录结构
- `00_meta/`：哈希、命令日志、工具版本、EXIF 导出。
- `01_carved/`：雕复文件，按偏移命名。
- `02_fixed/`：修复副本与修复参数。
- `03_planes/`：通道、位平面、LSB 导出。
- `04_qr_ocr/`：二维码、条码、OCR 结果。
- `05_media/`：音频、频谱、摩斯转写。
- `06_decoded/`：解码链、最终文本、压缩包内容。
- `report.md` 与 `report.json`。

#### 2. 结果字段
- `sample_id`、`sha256`、`true_type`、`anomalies`
- `embedded_files`：来源偏移、签名、大小、哈希
- `decoded_items`：编码链、偏移、内容摘要、置信度
- `flags`、`credentials`、`urls`、`coordinates`
- `false_positive_checks`：已排除项与理由
- `next_actions`：建议继续执行的脚本或工具

#### 3. 证据链要求
- 每个输出文件必须能追溯到输入文件、命令、参数、父文件哈希。
- 修复、解压、异或等派生操作必须保留原始副本或原始偏移。
- 对高价值结论，例如 flag、口令、坐标，要求至少两个独立证据或工具验证。

#### 4. 常见误判与规避
- 高熵噪声误判为压缩包：查看签名、CRC、可解压文件清单。
- OCR 误读：保留原图区域、反色或放大后复核。
- 二维码部分遮挡：补静区、纠偏、多帧合并。
- 频谱图案误读：对照原音频时长、采样率与已知摩斯节奏。
- 强制解压产生垃圾文件：记录压缩结构与加密标志，不以文件名为唯一依据。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
