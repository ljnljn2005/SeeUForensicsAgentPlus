---
name: performing-sqlite-database-forensics
description: Perform forensic analysis of SQLite databases to recover deleted records
  from freelists and WAL files, decode encoded timestamps, and extract evidence from
  browser history, messaging apps, and mobile device databases.
domain: cybersecurity
subdomain: digital-forensics
tags:
- sqlite
- database-forensics
- freelist
- wal
- write-ahead-log
- browser-history
- mobile-forensics
- deleted-records
- b-tree
- unallocated-space
version: '1.0'
author: mahipal
license: Apache-2.0
nist_csf:
- RS.AN-01
- RS.AN-03
- DE.AE-02
- RS.MA-01
mitre_attack:
- T1005
- T1074
- T1119
- T1070
- T1059
---

# Performing SQLite Database Forensics

## Overview

SQLite is the most widely deployed database engine in the world, used by virtually every mobile application, web browser, and many desktop applications to store user data. In digital forensics, SQLite databases are critical evidence sources containing browser history, messaging records, call logs, GPS locations, application preferences, and cached content. Forensic analysis goes beyond simple SQL queries to examine the internal B-tree page structures, freelist pages containing deleted records, Write-Ahead Log (WAL) files preserving transaction history, and unallocated space within database pages where recoverable data may persist after deletion.

## Runtime Environment (Important)

This application runs on **Windows**; the `exec` tool uses **PowerShell** syntax.

- Analysis is driven by **`python`** (3.8+) using only the standard library (`sqlite3`, `struct`) — **no pip
  packages required**. The bundled `scripts/process.py` is a self-contained, read-only analyzer. Optional GUI
  / CLI helpers: the `sqlite3` CLI, **DB Browser for SQLite**, and a hex editor (**HxD** / 010 Editor) for
  manual page inspection.
- **Self-check before you start.** Confirm Python resolves; if it is missing the environment is **not ready** —
  tell the user and stop. Do not invent paths or fall back to Linux commands:
  ```powershell
  Get-Command python -ErrorAction SilentlyContinue
  python --version
  ```
  If `python` is not found, report: *"SQLite-forensics environment is not ready (python not on PATH)."* and stop.
- **Use a large timeout for big databases.** Browser `History` and `msgstore.db` can be hundreds of MB to
  multi-GB; freelist/WAL scans take minutes — pass a large `exec` timeout (e.g. `600000` ms). The default 30 s
  will kill the scan mid-run.

> ⚠️ **Forensic integrity (SQLite-specific)**: SQLite is the **sanctioned exception** to the general "analyze evidence
> in place, don't copy it into the workspace" rule — here you MUST copy, because the database needs a consistent
> multi-file snapshot. Copy it **together with its sidecar files** — `<db>-wal`, `<db>-shm`, and `<db>-journal` — into
> your workspace. Analyzing the `.db` alone loses uncommitted (WAL) and rolled-back (journal) evidence, and **simply
> opening the original can trigger a checkpoint that destroys the WAL**. Hash the original first (`Get-FileHash`),
> analyze the copy, and open it **read-only** (`?mode=ro` URI / `PRAGMA query_only = ON`). Never modify the evidence
> original.

## When to Use

- Recovering **deleted records** (browser history, chat messages, call logs) from freelist pages, WAL frames, and unallocated space inside B-tree pages
- Examining **browser artifacts** — Chrome/Firefox/Safari history, downloads, and search terms
- Extracting evidence from **messaging / mobile app** databases — WhatsApp, Signal, iMessage, Skype, Android SMS
- Reconstructing **transaction history** from `-wal` / `-journal` sidecars that were never checkpointed
- Decoding application **timestamps** (Chrome/WebKit, Unix, Mac Absolute Time, Mozilla PRTime)
- Detecting **anti-forensics** — residual freelist/WAL data left after a user cleared history

**Do not use** on a live or locked database without first copying it and its sidecar files, or on an encrypted
database (SQLCipher / WhatsApp crypt) without the decryption key.

## Prerequisites

- **Python 3.8+** on `PATH` (standard library `sqlite3` + `struct` only — no extra packages)
- The database **plus** its `-wal`, `-shm`, and `-journal` sidecar files, copied together
- Optional: the `sqlite3` CLI, **DB Browser for SQLite** (sqlitebrowser), **HxD** / 010 Editor for manual page inspection
- Understanding of B-tree data structures

## Quick Triage with the Bundled Analyzer

`scripts/process.py` opens the database **read-only** and emits a structured JSON report — header fields, full
schema, per-table row counts + column metadata, freelist inventory, and WAL status — without touching the
evidence:

```powershell
# python scripts\process.py <db_path> <output_dir>
python scripts\process.py C:\cases\<case-id>\History C:\cases\<case-id>\out
Get-Content C:\cases\<case-id>\out\sqlite_forensic_report.json
```

Use the report to spot non-zero freelist pages and a present/uncheckpointed WAL, then drill into deleted-record
recovery (Methods 1–3 below).

## SQLite Internal Structure

### Database Header (First 100 Bytes)

| Offset | Size | Description |
|--------|------|-------------|
| 0 | 16 | Magic string: "SQLite format 3\000" |
| 16 | 2 | Page size (512-65536 bytes) |
| 18 | 1 | File format write version |
| 19 | 1 | File format read version |
| 24 | 4 | File change counter |
| 28 | 4 | Database size in pages |
| 32 | 4 | First freelist trunk page number |
| 36 | 4 | Total freelist pages |
| 52 | 4 | Text encoding (1=UTF-8, 2=UTF-16le, 3=UTF-16be) |
| 96 | 4 | Version-valid-for number |

### Page Types

| Type | ID | Description |
|------|----|-------------|
| B-tree Interior | 0x05 | Internal table node |
| B-tree Leaf | 0x0D | Table leaf page containing actual records |
| Index Interior | 0x02 | Internal index node |
| Index Leaf | 0x0A | Index leaf page |
| Freelist Trunk | - | Tracks freed pages |
| Freelist Leaf | - | Freed page with recoverable data |
| Overflow | - | Continuation of large records |

## Deleted Record Recovery

> The snippets below are standard-library Python (`struct`, `sqlite3`, `os`) and run as-is on Windows. Save to a
> `.py` file and run with `python`, or paste into a `python` session. Always point them at a **copy**.

### Method 1: Freelist Page Analysis

When records are deleted, SQLite may place their pages on the freelist rather than overwriting them immediately.

```python
import struct
import sqlite3
import os


def analyze_freelist(db_path: str) -> dict:
    """Analyze SQLite freelist to identify pages containing deleted data."""
    with open(db_path, "rb") as f:
        # Read header
        header = f.read(100)
        page_size = struct.unpack(">H", header[16:18])[0]
        if page_size == 1:
            page_size = 65536
        first_freelist_page = struct.unpack(">I", header[32:36])[0]
        total_freelist_pages = struct.unpack(">I", header[36:40])[0]

        freelist_info = {
            "page_size": page_size,
            "first_freelist_page": first_freelist_page,
            "total_freelist_pages": total_freelist_pages,
            "trunk_pages": [],
            "leaf_pages": []
        }

        if first_freelist_page == 0:
            return freelist_info

        # Walk the freelist trunk chain
        trunk_page = first_freelist_page
        while trunk_page != 0:
            offset = (trunk_page - 1) * page_size
            f.seek(offset)
            page_data = f.read(page_size)

            next_trunk = struct.unpack(">I", page_data[0:4])[0]
            leaf_count = struct.unpack(">I", page_data[4:8])[0]

            leaves = []
            for i in range(leaf_count):
                leaf_page = struct.unpack(">I", page_data[8 + i * 4:12 + i * 4])[0]
                leaves.append(leaf_page)

            freelist_info["trunk_pages"].append({
                "page_number": trunk_page,
                "next_trunk": next_trunk,
                "leaf_count": leaf_count,
                "leaf_pages": leaves
            })
            freelist_info["leaf_pages"].extend(leaves)
            trunk_page = next_trunk

    return freelist_info


def extract_freelist_content(db_path: str, output_dir: str):
    """Extract raw content from freelist pages for analysis."""
    info = analyze_freelist(db_path)
    os.makedirs(output_dir, exist_ok=True)

    with open(db_path, "rb") as f:
        page_size = info["page_size"]
        for page_num in info["leaf_pages"]:
            offset = (page_num - 1) * page_size
            f.seek(offset)
            page_data = f.read(page_size)
            output_file = os.path.join(output_dir, f"freelist_page_{page_num}.bin")
            with open(output_file, "wb") as out:
                out.write(page_data)

    return len(info["leaf_pages"])
```

### Method 2: WAL (Write-Ahead Log) Analysis

The WAL file contains pending transactions that have not yet been checkpointed back to the main database.

```python
def parse_wal_header(wal_path: str) -> dict:
    """Parse SQLite WAL file header and frame inventory."""
    with open(wal_path, "rb") as f:
        header = f.read(32)
        magic = struct.unpack(">I", header[0:4])[0]
        file_format = struct.unpack(">I", header[4:8])[0]
        page_size = struct.unpack(">I", header[8:12])[0]
        checkpoint_seq = struct.unpack(">I", header[12:16])[0]
        salt1 = struct.unpack(">I", header[16:20])[0]
        salt2 = struct.unpack(">I", header[20:24])[0]

        wal_info = {
            "magic": hex(magic),
            "format": file_format,
            "page_size": page_size,
            "checkpoint_sequence": checkpoint_seq,
            "frames": []
        }

        # Parse frames (24-byte header + page_size data each)
        frame_offset = 32
        frame_num = 0
        file_size = os.path.getsize(wal_path)

        while frame_offset + 24 + page_size <= file_size:
            f.seek(frame_offset)
            frame_header = f.read(24)
            page_number = struct.unpack(">I", frame_header[0:4])[0]
            db_size_after = struct.unpack(">I", frame_header[4:8])[0]

            wal_info["frames"].append({
                "frame_number": frame_num,
                "page_number": page_number,
                "db_size_pages": db_size_after,
                "offset": frame_offset
            })
            frame_offset += 24 + page_size
            frame_num += 1

    return wal_info
```

### Method 3: Unallocated Space Within Pages

Deleted cells within active B-tree pages leave data in the unallocated region between the cell pointer array and the cell content area.

```python
def analyze_unallocated_space(db_path: str, page_number: int) -> dict:
    """Analyze unallocated space within a specific B-tree page."""
    with open(db_path, "rb") as f:
        header = f.read(100)
        page_size = struct.unpack(">H", header[16:18])[0]
        if page_size == 1:
            page_size = 65536

        offset = (page_number - 1) * page_size
        f.seek(offset)
        page_data = f.read(page_size)

        # Parse page header (8 or 12 bytes depending on type)
        page_type = page_data[0]
        first_freeblock = struct.unpack(">H", page_data[1:3])[0]
        cell_count = struct.unpack(">H", page_data[3:5])[0]
        cell_content_offset = struct.unpack(">H", page_data[5:7])[0]
        if cell_content_offset == 0:
            cell_content_offset = 65536

        header_size = 12 if page_type in (0x02, 0x05) else 8
        cell_pointer_end = header_size + cell_count * 2

        unallocated_start = cell_pointer_end
        unallocated_end = cell_content_offset
        unallocated_size = unallocated_end - unallocated_start

        return {
            "page_number": page_number,
            "page_type": hex(page_type),
            "cell_count": cell_count,
            "unallocated_start": unallocated_start,
            "unallocated_end": unallocated_end,
            "unallocated_size": unallocated_size,
            "unallocated_data": page_data[unallocated_start:unallocated_end].hex()
        }
```

## Common Forensic Databases

| Application | Database File | Key Tables |
|------------|--------------|------------|
| Chrome | History | urls, visits, downloads, keyword_search_terms |
| Firefox | places.sqlite | moz_places, moz_historyvisits |
| Safari | History.db | history_items, history_visits |
| WhatsApp | msgstore.db | messages, chat_list |
| Signal | signal.sqlite | sms, mms |
| iMessage | sms.db | message, handle, chat |
| Android SMS | mmssms.db | sms, mms, threads |
| Skype | main.db | Messages, Conversations |

## Timestamp Decoding

```python
from datetime import datetime, timedelta

def decode_chrome_timestamp(chrome_ts: int) -> datetime:
    """Convert Chrome/WebKit timestamp to datetime (microseconds since 1601-01-01)."""
    epoch_delta = 11644473600
    return datetime.utcfromtimestamp((chrome_ts / 1000000) - epoch_delta)

def decode_unix_timestamp(unix_ts: int) -> datetime:
    """Convert Unix timestamp to datetime."""
    return datetime.utcfromtimestamp(unix_ts)

def decode_mac_absolute_time(mac_ts: float) -> datetime:
    """Convert Mac Absolute Time (seconds since 2001-01-01)."""
    mac_epoch = datetime(2001, 1, 1)
    return mac_epoch + timedelta(seconds=mac_ts)

def decode_mozilla_timestamp(moz_ts: int) -> datetime:
    """Convert Mozilla PRTime (microseconds since Unix epoch)."""
    return datetime.utcfromtimestamp(moz_ts / 1000000)
```

## Reference Files

- `references/workflows.md` — step-by-step flowcharts for full analysis and deleted-record recovery
- `references/api-reference.md` — quick tables: header layout, page-type bytes, timestamp decoders, common DBs
- `references/standards.md` — standards (NIST SP 800-86, SWGDE), tooling, and on-device DB locations
- `assets/template.md` — forensic analysis report template

## References

- SQLite File Format: https://www.sqlite.org/fileformat2.html
- Spyder Forensics SQLite Training: https://www.spyderforensics.com/sqlite-forensic-fundamentals-2025/
- Forensic Analysis of Damaged SQLite Databases: https://www.forensicfocus.com/articles/forensic-analysis-of-damaged-sqlite-databases/

## Output Template

> **TEMPLATE ONLY:** This is a fictional shape-only example. Replace every angle-bracketed field only with values returned
> by the current investigation. Placeholders and labels must never appear in a real report; do not copy example URLs,
> counts, timestamps, filenames, or conclusions into a real report.

```text
> python scripts\process.py C:\cases\<case-id>\<database-file> C:\cases\<case-id>\out

[*] Database: C:\cases\<case-id>\<database-file>
[*] Page size: <page-size>
[*] Tables: <table-count>
[*] Freelist pages: <freelist-page-count>
[*] WAL present: <true-or-false>
[*] Report: C:\cases\<case-id>\out\sqlite_forensic_report.json
```

Deeper carving (Methods 1–3) over the freelist and WAL then recovers the deleted rows, e.g.:

```text
--- Recovered Deleted URLs ---
Row ID | URL                                              | Visit Count | Last Visit (UTC)
-------|--------------------------------------------------|-------------|---------------------
<row-id> | https://example.invalid/<path>                    | <N>         | <timestamp>
<row-id> | <observed-url-or-redacted>                       | <N>         | <timestamp>
<row-id> | <observed-url-or-redacted>                       | <N>         | <timestamp>

--- Recovered Deleted Downloads ---
Row ID | Filename               | Size      | Start Time (UTC)
-------|------------------------|-----------|---------------------
<row-id> | <observed-filename>     | <size>    | <timestamp>
<row-id> | <observed-filename>     | <size>    | <timestamp>

Summary:
  Active records:          <N>
  Deleted / WAL records:   <recovered-row-count> (recovered)
  Anti-forensics evidence: <observed evidence or none; do not infer from a non-zero count alone>
```

## 使用步骤

> 本章按 固定证据 → 只读分诊 → 活动数据查询 → 删除数据恢复 → 时间线重建 → 加密与备份扩展 → 误判控制 → 报告输出 的顺序执行。SQLite 取证的第一原则：不要直接打开原始 .db。打开主库可能触发 WAL checkpoint，导致 -wal 中未合并事务被清空。所有分析必须在哈希固定后的只读副本上进行。

### 1. 环境自检与检材固定

1. 确认 Python 可用；脚本只依赖标准库。
```powershell
Get-Command python -ErrorAction SilentlyContinue
python --version
```
2. 枚举数据库主体与 sidecar 文件。必须同时识别 `-wal`、`-shm`、`-journal`，不要只复制 `.db`。
```powershell
Get-ChildItem -LiteralPath C:/cases/<case-id>/evidence -Force -Recurse -Include *.db,*.sqlite,*.sqlite3,*-wal,*-shm,*-journal
```
3. 对原始文件计算哈希并记录到案件笔录。
```powershell
Get-FileHash -LiteralPath C:/cases/<case-id>/evidence/History -Algorithm SHA256 | Format-List
Get-FileHash -LiteralPath C:/cases/<case-id>/evidence/History-wal -Algorithm SHA256 | Format-List
Get-FileHash -LiteralPath C:/cases/<case-id>/evidence/History-shm -Algorithm SHA256 | Format-List
Get-FileHash -LiteralPath C:/cases/<case-id>/evidence/History-journal -Algorithm SHA256 | Format-List
```
4. 复制到工作区。即使 `-wal` 为 0 字节、`-shm` 看似无用，也保留原始状态。
```powershell
New-Item -ItemType Directory -Force C:/cases/<case-id>/work
Copy-Item -LiteralPath C:/cases/<case-id>/evidence/History -Destination C:/cases/<case-id>/work/History
Copy-Item -LiteralPath C:/cases/<case-id>/evidence/History-wal -Destination C:/cases/<case-id>/work/History-wal -ErrorAction SilentlyContinue
Copy-Item -LiteralPath C:/cases/<case-id>/evidence/History-shm -Destination C:/cases/<case-id>/work/History-shm -ErrorAction SilentlyContinue
Copy-Item -LiteralPath C:/cases/<case-id>/evidence/History-journal -Destination C:/cases/<case-id>/work/History-journal -ErrorAction SilentlyContinue
```
5. 将工作副本设为只读，并再次哈希确认副本状态。
```powershell
Set-ItemProperty -LiteralPath C:/cases/<case-id>/work/History -Name IsReadOnly -Value $true
Get-FileHash -LiteralPath C:/cases/<case-id>/work/History -Algorithm SHA256 | Format-List
```

常见陷阱：
- 只复制 `.db` 会丢失 WAL 中未 checkpoint 的新记录或回滚前状态。
- 使用资源管理器移动、重命名或压缩原始文件可能改变时间戳和文件流。
- 原始库被工具自动打开后，`-wal` 可能被 checkpoint 并清空，必须在笔录中记录该风险。

### 2. 只读分诊

1. 使用自带分析器生成结构化报告。
```powershell
python scripts/process.py C:/cases/<case-id>/work/History C:/cases/<case-id>/out
Get-Content C:/cases/<case-id>/out/sqlite_forensic_report.json
```
2. 重点查看以下字段：
- `page_size`、`text_encoding`：决定后续手工 carving 的字节宽度与解码方式。
- `freelist_pages`、`first_freelist_page`：非零时优先做 freelist 恢复。
- `wal_present`、`wal_frames`：有未合并 WAL 时优先做 WAL 帧解析。
- `schema`：确认目标表是否存在，避免盲目套用 Chrome/Firefox 查询。
3. 如需手工 SQL，只允许只读连接。
```powershell
sqlite3 'file:C:/cases/<case-id>/work/History?mode=ro' '.tables'
sqlite3 'file:C:/cases/<case-id>/work/History?mode=ro' 'PRAGMA journal_mode;'
sqlite3 'file:C:/cases/<case-id>/work/History?mode=ro' 'SELECT name FROM sqlite_master WHERE type=''table'';'
```
4. Python 连接同样强制只读。
```python
import sqlite3
con = sqlite3.connect('file:C:/cases/<case-id>/work/History?mode=ro', uri=True)
con.execute('PRAGMA query_only = ON;')
```

禁止操作：
- `PRAGMA wal_checkpoint;`
- `VACUUM;`
- `REINDEX;`
- 直接对原始路径执行 `.dump`、`.recover` 或写回同名目录。
- 让 GUI 工具以可写模式自动创建 `-shm`、`-wal`。

### 3. 活动数据查询与统计

1. 先确认 schema，再写查询。不同应用版本会改列名，不要直接假设字段存在。
```sql
SELECT name, sql FROM sqlite_master WHERE type IN ('table','view','index');
PRAGMA table_info(urls);
```
2. 对关键表做行数统计，形成基线。
```sql
SELECT 'urls' AS tbl, COUNT(*) AS cnt FROM urls
UNION ALL SELECT 'visits', COUNT(*) FROM visits
UNION ALL SELECT 'downloads', COUNT(*) FROM downloads
UNION ALL SELECT 'keyword_search_terms', COUNT(*) FROM keyword_search_terms;
```
3. Chrome/Chromium 历史记录示例。时间戳通常为 WebKit/Chrome 微秒，自 1601-01-01 起算。
```sql
SELECT id, url, title, visit_count, typed_count, hidden,
       datetime((last_visit_time/1000000)-11644473600,'unixepoch') AS last_visit_utc
FROM urls
ORDER BY last_visit_time DESC
LIMIT 200;
```
4. Chrome 访问明细与跳转分析。
```sql
SELECT v.url AS url_id, u.url, u.title,
       datetime((v.visit_time/1000000)-11644473600,'unixepoch') AS visit_utc,
       v.visit_duration, v.transition
FROM visits v
JOIN urls u ON u.id = v.url
ORDER BY v.visit_time DESC
LIMIT 500;
```
5. 下载记录。重点看 `target_path`、`tab_url`、`state`、`danger_type`。
```sql
SELECT id, target_path, tab_url, total_bytes,
       datetime((start_time/1000000)-11644473600,'unixepoch') AS start_utc,
       datetime((end_time/1000000)-11644473600,'unixepoch') AS end_utc,
       state, danger_type
FROM downloads
ORDER BY start_time DESC;
```
6. 搜索词。
```sql
SELECT keyword, lower_term, url
FROM keyword_search_terms;
```
7. Firefox places.sqlite 示例。Mozilla PRTime 通常为 Unix 微秒。
```sql
SELECT h.url, h.title, h.visit_count,
       datetime(h.last_visit_date/1000000,'unixepoch') AS last_visit_utc,
       datetime(v.visit_date/1000000,'unixepoch') AS visit_utc
FROM moz_places h
JOIN moz_historyvisits v ON v.place_id = h.id
ORDER BY v.visit_date DESC
LIMIT 500;
```
8. 移动聊天/短信数据库先定位候选表，再按应用版本细化。
```sql
SELECT name FROM sqlite_master
WHERE name LIKE '%message%'
   OR name LIKE '%chat%'
   OR name LIKE '%sms%'
   OR name LIKE '%thread%';
```

实操要点：
- 查询前用 `PRAGMA table_info(...)` 验证列名，避免 SQL 报错。
- 对大表先 `LIMIT`，再导出，避免内存溢出。
- 将活动记录导出为 CSV/JSON，作为后续删除数据恢复的对照基线。

### 4. 时间线重建与异常筛选

1. 将多类事件统一到 UTC 时间线。
```sql
SELECT 'history_visit' AS event, u.url AS item,
       datetime((v.visit_time/1000000)-11644473600,'unixepoch') AS utc
FROM visits v
JOIN urls u ON u.id = v.url
UNION ALL
SELECT 'download_start', target_path,
       datetime((start_time/1000000)-11644473600,'unixepoch')
FROM downloads
ORDER BY utc;
```
2. 按案件时间窗过滤。Chrome 时间窗需先换算为 WebKit 微秒。
```sql
SELECT v.url, u.url, datetime((v.visit_time/1000000)-11644473600,'unixepoch') AS utc
FROM visits v
JOIN urls u ON u.id = v.url
WHERE v.visit_time BETWEEN 13251456000000000 AND 13254134400000000;
```
3. 异常字段筛选。
- 浏览器：`hidden=1`、`visit_duration=0`、`typed_count=0`、空标题、`file://`、临时目录下载、下载中断状态。
- 聊天：已读/未读、撤回标记、发送失败、本地删除标记、附件路径缺失。
- 短信：`type`、`read`、`status`、`date_sent` 与 `date_received` 差异。
4. 对异常记录不要直接下结论，需结合同应用其他表、系统时间、WAL/freelist 恢复结果交叉验证。

### 5. 删除记录恢复

1. 先看分诊报告：`freelist_pages > 0` 或 `wal_frames > 0` 时，删除/未合并数据概率显著上升。
2. Freelist 恢复。
- 使用文档中 Method 1 的 `analyze_freelist` 与 `extract_freelist_content` 函数，保存为独立脚本后对工作副本执行。
- 输出目录应独立于证据目录。
```powershell
python freelist_recover.py C:/cases/<case-id>/work/History C:/cases/<case-id>/out/freelist
```
- 对导出的 freelist page 做字符串与记录头 carving。优先寻找符合目标表 schema 的 varint 记录头、UTF-8/UTF-16 文本、已知 URL/手机号/消息片段。
3. WAL 恢复。
- 使用 Method 2 解析 `-wal` 帧头和帧列表。
- 对同一 `page_number` 的多个帧保留帧序；较早帧可能保存删除前状态，较晚帧可能保存覆盖后状态。
- 若帧内页类型为表叶页 `0x0D`，按 cell pointer array 和 record header 解析；与主库同页对比，识别新增、修改、删除前镜像。
4. 页内未分配空间恢复。
- 使用 Method 3 检查活跃 B-tree 页中 cell pointer array 与 cell content area 之间的空隙。
- 对 freeblock 链进行遍历，提取被删除 cell 残留。
- 对大字段溢出页，需同时检查 overflow page 链，避免只恢复半截文本。
5. 恢复结果必须分级标注：
- `active`：当前 SQL 可查询。
- `wal_only`：仅存在于 WAL 帧。
- `freelist`：来自 freelist 页。
- `unallocated`：来自页内未分配空间或 freeblock。
- `partial`：仅字符串级恢复，无法完整校验记录头。

### 6. 加密、备份与连接配置扩展

1. 若文件头不是 `SQLite format 3` 或第 1 页无法解析，先判断是否为加密库、损坏库或非 SQLite 容器。不要继续用普通 freelist 逻辑强行解释。
2. SQLCipher/应用加密数据库：
- 先定位密钥来源：应用配置、Keychain、DPAPI、Keystore、内存镜像、用户凭据或备份清单。
- 取得授权后再解密；解密产物应作为新的工作副本，重新哈希并只读处理。
- 解密导出示例仅在工作区执行。
```sql
PRAGMA key = '...';
PRAGMA cipher_compatibility = 4;
ATTACH DATABASE 'decrypted.db' AS decrypted KEY '';
SELECT sqlcipher_export('decrypted');
DETACH DATABASE decrypted;
```
3. 备份文件：
- 收集 `.backup`、`.bak`、`.db`、`.sqlcipher`、应用云备份、卸载残留和旧设备镜像中的同名数据库。
- 备份可能保留当前库中已被删除或覆盖的记录，应单独哈希、单独分诊。
4. 连接配置与数据库路径：
- 对嵌入式应用，优先从配置文件、plist、XML、SharedPreferences、注册表或应用日志中确认实际 SQLite 路径。
- 对混合架构中同时存在 MySQL/PostgreSQL/Redis 的场景，记录连接串、配置文件和密钥位置，但不要在未授权情况下连接生产库。
5. 密钥与凭据提取必须记录来源、提取时间、哈希值和取证授权。

### 7. 误判控制

- `freelist_pages` 非零不等于用户主动删除；VACUUM、表重建、页回收都可能产生 freelist。
- WAL 中的记录可能是未提交事务、回滚事务或崩溃残留，不必然代表用户可见数据。
- 时间戳必须确认纪元、单位、时区和夏令时；同一应用可能混用 UTC 与本地时间。
- 浏览器同步、预取、后台任务可能生成访问或下载记录，不能仅凭存在记录推断人工操作。
- 删除聊天可能只是本地隐藏、服务器撤回或缓存过期，需要结合应用语义判断。
- 对每条关键证据至少使用一种独立验证：SQL 查询、页内结构解析、WAL 帧对比、哈希或导出文件内容。

### 8. 报告与证据封装

1. 输出目录建议固定为 `C:/cases/<case-id>/out`，并记录所有导出文件哈希。
2. 报告至少包含：
- 原始文件与工作副本的 SHA256。
- 使用的工具、版本、命令行和超时设置。
- 数据库头信息、页大小、编码、WAL/freelist 状态。
- 活动表统计与关键查询结果。
- 删除/残留记录的来源页、帧号、恢复方法和置信度。
- 时间线转换规则与时区说明。
- 反取证观察：仅在有 freelist、WAL 截断、文件时间异常、清理工具痕迹等支撑时记录。
3. 最终交付前，用只读方式重新打开工作副本抽查关键记录，确认分析过程没有改变证据状态。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
