---
name: usb-winpe-quick
description: USB 检材（E01/DD）快速体检：分区表/卷标/文件系统、WinPE 可引导判断与版本、加密压缩包与 VeraCrypt 容器线索。用于「U 盘/移动盘/启动盘」类题目，避免解开整个镜像。
---

# USB / WinPE 检材快速体检（SeeU）

## 0. 先定位置（不要全盘解压）
1. 索引：`curl -s "$SEEU_INDEX_API/evidences?caseNumber=..."`，找 type=image/pf 的 USB 检材。
2. 火眼只读挂载：`/evidences` 的 `mountRoute`/`mountPoint`（`C:/hlnet/<eid>-...`），优先 `ges ls/glob/grep` 翻。
3. 需要分区级/加密级证据时用 `lovelycarve` 挂载（`mounts create "/part:N"`）——**只读**。

## 1. 分区表与卷标（E01 用 pyewf 直接读，最快）
`pyewf` 已随 Python 环境（`D:/Programming/Python31314/python.exe`）安装；路径必须原生反斜杠：
```python
import glob, struct, pyewf
h=pyewf.handle(); h.open(sorted(glob.glob(r'W:\<image>.E01')))
h.seek(0); mbr=h.read(512); print(mbr[510:512].hex())  # 55aa=MBR
for i in range(4):
    e=mbr[0x1BE+i*16:0x1BE+(i+1)*16]; print(e[0], hex(e[4]), *struct.unpack('<II', e[8:16]))
```
- MBR vs GPT：MBR 有 `55AA`+4×16B 项；GPT 在 LBA1 有 `EFI PART`。
- 每分区 VBR：exFAT（`EXFAT   `，卷标是根目录 0x83 目录项）；NTFS（`NTFS    `，卷标在 0x38+0x03）；FAT16/32（卷标在 0x2B / 0x47，最长 11 字节，常为 `NO NAME`）。
- **卷标日期**：FAT 根目录里属性 0x08 的 Volume Label 目录项，创建时间/日期在 0x0E/0x10（FAT 时间：年=1980+高 7 位等）。

## 2. WinPE 可引导与版本
- 可引导：存在 `bootmgr`（或 `WEPE64` 这类改名 bootmgr）、`EFI\BOOT\bootx64.efi`、`WEPE64.WIM`/`boot.wim`；MBR 分区 boot flag 0x80。
- 版本判断：`WEPE64.WIM` 的大小/`WEPE.TXT` 说明可判断微PE 2.x（基于 Win10）；日志/内核版本可在 WIM 内搜 `10.0.19041` 一类字符串（WIM 内 XML 可能压缩，别只靠 strings）。
- 常见 PE 限制：默认无 PowerShell、无 Eventvwr；有 `hostname`、`diskpart`；核心映像挂 `X:\`。

## 3. 加密压缩包 / VeraCrypt 容器
- zip 条目列表（不需密码）：`python -c "import zipfile;z=zipfile.ZipFile(p);print([(i.filename,i.file_size,i.flag_bits) for i in z.infolist()])"`；`flag_bits & 1` = 加密。
- 条目时间 = `ZipInfo.date_time`，可回答「压缩包创建日期」类问题。
- 带 `VeraCrypt Portable/Setup.exe`、`*.hc`、随机大小整兆文件的组合 ⇒ 大概率 VeraCrypt 容器；容器内是 FAT 时题面会问「文件系统 FAT / 无嵌入式备份头 / 块大小」。
- 不要尝试执行从检材复制出来的 `7z.exe`（沙箱会拒绝）；用 Python `zipfile`/`pyewf` 代替。

## 4. 输出纪律
- 每题给：答案 + 一句证据（分区号/偏移/卷标/日期/文件大小），能复核。
- 只读：所有操作基于挂载或 Python 只读解析；不写检材、不解压到检材盘。
