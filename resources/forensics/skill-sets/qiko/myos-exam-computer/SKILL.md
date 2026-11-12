---
name: 计算机取证答题
description: 计算机取证比武答题：解析 E01/dd/raw 等镜像，优先平台概览与 sqlite_query_cli，避免盲目扫盘。非整卷计算机题时先整检材技能。
name_en: Computer Forensics Exam
name_ru: Компьютерная экспертиза (экзамен)
description_en: >-
  Computer forensics exam playbook for E01/dd/raw images. Prefer platform overview +
  sqlite_query_cli before raw filesystem walks. For whole-exhibit triage without computer-exam
  focus, start at investigate skill.
description_ru: >-
  Плейбук компьютерной форензики для образов E01/dd/raw. Сначала platform/overview и
  sqlite_query_cli, не слепой обход ФС. Для целого носителя без фокуса экзамена — навык triage.
---

# Computer Forensics Exam Skill

## Default rhythm

```text
hub prepare (if needed) → lock primary evidence domain
  → targeted query → format close-out.
Do not shotgun unrelated stores / blind FS walks. Tool shapes → hub tool-call-recipes.md (SSOT).
```

## Navigation

```text
qiko-forensic-lite-investigate (hub / first structured pass)
  → THIS SKILL (MYOS computer exam chain)
  → forensic-sqlite-exam (single DB deep dive)
  → intrusion-case-forensics (Prefetch / remote-access lab report)
  → forensics-exam-server (server/CTF role, not desktop image)
```

## When to use this (and when not)

**Use when:** computer contest/exam questions, Windows image via MYOS, need automated parse + result queries.

**Do NOT use when:** phone-only paper → `myos-exam-phone`; single pcap → `forensic-network-pcap-exam`; memory dump → `forensics-memory-exam`.

## Overview

This skill answers **computer image** contest/exam questions. **You must invoke tools**; do not read this file alone and skip database queries.

Shared call recipes: `../qiko-forensic-lite-investigate/references/tool-call-recipes.md` — follow **Solve rhythm**. Do not re-copy full Chain JSON here.

## Dual entry (match the live tool surface this turn)

### Entry M — MYOS MCP visible (preferred)

Follow the **Standard workflow** below: `health_check_dbus` → create case / load → submit task → `sqlite_query` / overview. Use MCP schema for parameters; do not invent tool names. Prefer already-parsed overview nodes (system info, adapters, browser) before raw FS.

### Entry Q — No MYOS, Qiko tools available (required path)

1. Whole exhibit not yet structured: `Read` and execute `qiko-forensic-lite-investigate` (`forensic_task_manage` open case / mount).
2. Locate DBs via CASE STATUS / known cards / focused `search_forensic_result_map` (recipes) — **not** recursive bash under `os/`.
3. Lock the stem’s primary `.mfs` / table family → targeted `sqlite_query_cli` (Solve rhythm). Prefer parsed system / network / browser / recycle nodes over opening every leaf.
4. Single DB deep dive → `forensic-sqlite-exam`; do **not** unpack the disk image with `7z`.

## Applicable scenarios

- Computer forensics contest/exam answers
- Electronic data forensics analysis
- Windows system image analysis
- Forensic report generation from structured results

## Prerequisites

- This turn exposes **MYOS MCP** or **Qiko** (`forensic_task_manage` / `sqlite_query_cli` / map) — at least one
- Computer image file (`.e01`, `.dd`, `.raw`, etc.) or an already mounted case
- Disk space for case data

## Standard workflow (Entry M)

### Step 1: Environment check

```
1.1 Call health_check_dbus() to confirm D-Bus service is healthy
1.2 Confirm case manager and task manager are available
```

### Step 2: Create case

```
2.1 Call create_case_and_open() to create a new case
    - caseDir: case root (e.g. "D:/MYOS/Case")
    - caseName: case name (e.g. "XXX_Analysis")
2.2 Record returned caseId
```

### Step 3: Add exhibit

```
3.1 Call add_image_material() to add the image exhibit
    - caseId: caseId from step 2
    - imagePaths: image path (e.g. "W:\\David_Laptop_64GB.e01")
    - materialName: exhibit name
3.2 Record returned materialId
```

### Step 4: Submit forensic task

```
4.1 Call submit_computer_forensic_task() to submit the forensic task
    - caseId: case ID
    - caseName: case name
    - materialId: exhibit ID
    - materialKind: "image" (image) / "disk" (physical disk) / "files" (file set)
    - materialName: exhibit name
    - paths: image path(s)
4.2 Record returned taskId (subtask)
```

### Step 5: Wait for task completion

```
5.1 Call wait_task_completion() to wait for completion
    - taskId: subtask ID
    - timeoutMs: timeout (default 300000 ms = 5 minutes)
    - pollIntervalMs: poll interval (default 2000 ms)
5.2 If wait_task_completion() fails, try query_task_status()
5.3 If both fail, proceed to step 6 and query results directly
```

### Step 6: Query forensic results overview

```
6.1 Call query_computer_forensics_results_overview() for the overview
    - caseId: case ID
6.2 Analyze ResultsStatistics.json and DiskPartitions.json
6.3 Collect system info, partitions, file distribution, etc.
```

### Step 7: Load case into memory

```
7.1 Call load_case() to load the case
    - caseId: case ID
    - dbDir: data directory (e.g. ".../dev/<exhibit>/data")
    - materialId: exhibit ID
7.2 Record device_guid
```

### Step 8: Query device info

```
8.1 Call query_device_info() for device information
    - dbPath: FSData.mfs path
    - materialId: exhibit ID
8.2 Collect partition list, node counts, etc.
```

### Step 9: Deep data query (SQLite)

```
9.1 Use sqlite_query() against forensic result databases
    - DB path: .../data/IntegrateForensics/*.mfs

9.2 Common forensic databases:
    - Win_SystemInfo.mfs: system info, user accounts, login records
    - Win_WirelessInfo.mfs: WiFi connection history
    - Win_UsbInfo.mfs: USB device connections
    - Any_Firefox.mfs / Any_Chrome.mfs: browser history
    - Win_InstallSoftWare.mfs: installed software
    - Any_ShortCutInfo.mfs: shortcut (.lnk) records
    - Win_BitlockerRecoveryKey.mfs: BitLocker recovery keys
    - Win_RecentVisitInfo.mfs: recent access records

9.3 Filesystem query (FSData.mfs):
    - Table: TBL_FS_ENTRY_<device_guid>
    - Common fields: filename, filepath, filesize, createtime, accesstime, updatetime
    - LIKE fuzzy search supported
```

### Step 10: Answer and verify

```
10.1 Extract answers from the matching database per question
10.2 Verify accuracy
10.3 Cross-check uncertain answers from multiple angles
```

## Common question types and data sources

| Question type | Data source | Query method |
|------|--------|----------|
| System info (computer name, OS version, install time, timezone) | Win_SystemInfo.mfs → TBL_AF_WINSYSINFO_ST_SYSTEMINFO | SELECT * FROM TBL_AF_WINSYSINFO_ST_SYSTEMINFO |
| User accounts (last logged-in user) | Win_SystemInfo.mfs → TBL_AF_WINSYSINFO_ST_USERACCOUNT | SELECT ACCOUNT, LAST_LOGIN_TIME FROM ... |
| Partition style (GPT/MBR) | FSData.mfs → TBL_FS_DISK_INFO | SELECT parttype FROM TBL_FS_DISK_INFO |
| WiFi (SSID, MAC) | Win_WirelessInfo.mfs → TBL_AF_WIRELESS_PS_ACCOUNT | SELECT SSID, AP_MAC FROM ... |
| USB devices (connection count) | Win_UsbInfo.mfs → TBL_AF_WINUSBINFO_ST_DEVICES | SELECT COUNT(*) FROM ... |
| Browser history | Any_Firefox.mfs / Any_Chrome.mfs → TBL_AF_*_WEB_HISTORY | SELECT URL, VISIT_TIME FROM ... |
| Installed software | Win_InstallSoftWare.mfs → TBL_AF_WININSTALLSOFTWARE_ST_NORMAL | SELECT SOFTWARE_NAME, INSTALLL_TIME FROM ... |
| Shortcuts / recent access | Any_ShortCutInfo.mfs → TBL_LNK_SHORTCUT | SELECT FILE_NAME, VISIT_TIME FROM ... ORDER BY VISIT_TIME DESC |
| BitLocker keys | Win_BitlockerRecoveryKey.mfs | Query encryption info tables |
| File search | FSData.mfs → TBL_FS_ENTRY_<guid> | SELECT filename, filepath FROM ... WHERE ... |

## Notes

### 1. Partition type codes

- `parttype = 1` → MBR
- `parttype = 2` → GPT
- `parttype = 3` → RAW

### 2. USB device counting

- Distinguish **external USB devices** from **built-in devices**
- Built-in devices (e.g. Dell ControlVault, Smartcard Reader) usually do not count
- Temporary devices (e.g. install USB stick connected for minutes) may not count

### 3. Shortcut access times

- `.lnk` files under Recent sort by access time
- Distinguish **folders** vs **files**
- When access times tie, use FILE_PATH to identify the actual target

### 4. Timezone conversion

- DB timestamps are usually local time
- Watch for UTC+8 and similar labels in questions

### 5. Common traps

- **"Devices" vs "external devices"** → exclude built-in devices
- **"File" vs "folder"** → read the question carefully
- **Identical access times** → use context
- **BitLocker keys** → may also appear in event logs or backup files

## Example: full answer flow

```
# Step 1: Environment check
health_check_dbus()

# Step 2: Create case
case = create_case_and_open(caseDir="D:/MYOS/Case", caseName="Target_Analysis")
caseId = case.caseId

# Step 3: Add exhibit
material = add_image_material(caseId=caseId, imagePaths="W:\\Target.e01", materialName="Target")
materialId = material.materialId

# Step 4: Submit forensic task
task = submit_computer_forensic_task(caseId=caseId, materialId=materialId, materialKind="image", ...)
taskId = task.taskId

# Step 5: Wait for completion
wait_task_completion(taskId=taskId)

# Step 6: Query results
overview = query_computer_forensics_results_overview(caseId=caseId)

# Step 7: Load case
load_case(caseId=caseId, dbDir=".../data", materialId=materialId)

# Step 8–10: Query specific data per question
# ...
```

## Troubleshooting

| Issue | Fix |
|------|----------|
| wait_task_completion() error | Try query_task_status(), or query results directly |
| query_task_status() error | Run query_computer_forensics_results_overview() |
| sqlite_query returns "not authorized" | Try another table or path |
| BitLocker key not found | Search event logs, registry, backup files |
| Empty data | Confirm task finished, or re-run forensic task |

## Version info

- Created: 2026-06-10
- Platform: MYOS electronic data forensics
- Image formats: E01, DD, RAW, VMDK, etc.
- OS focus: Windows 10/11

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
