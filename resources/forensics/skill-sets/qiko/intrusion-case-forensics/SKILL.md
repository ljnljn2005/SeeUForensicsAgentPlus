---
name: 入侵案件计算机检材分析
slug: intrusion-case-forensics
version: 2.4.1
description: 入侵类案件计算机检材分析：Prefetch、最近访问、软件安装、远程连接、系统日志与远控日志，抽取可疑记录并构建入侵时间线与研判报告。不做采样/沙箱/调证。
agent_created: true
disable: false
name_en: Intrusion Case Computer Forensics
name_ru: Анализ компьютерных носителей по делам о вторжении
description_en: >-
  Computer exhibit analysis for intrusion cases: Prefetch, recent files, installs, remote access,
  system and RAT logs — build timelines and judgment reports. No sampling/sandbox/legal requests.
description_ru: >-
  Анализ компьютерных образов по делам о вторжении: Prefetch, недавние файлы, ПО, удалённый доступ,
  системные и RAT-логи — таймлайн и отчёт. Без сэмплинга/песочницы/выемки.
---

# Intrusion Case Computer Exhibit Analysis

## Overview

Focus on **computer exhibits as primary evidence, case facts as secondary context**. This skill extracts and timelines exhibit data only; it does not cover follow-on actions (sampling, sandboxing, legal process requests, field collection, etc.).

Core method: **analyze as soon as data is available** (start immediately; do not wait) → use case facts to set the focus window → extract suspicious records from 6 key forensic dimensions + **priority tagging of executables/scripts** → build an intrusion timeline → produce a judgment report.

**Data intake notes**: Exhibits are usually provided as a forensics-platform export directory or index database. First step after intake: extract a **full file inventory** from available indexes/manifests (e.g. Meiya-exported `FSDataIndex.mfs` SQLite filename index, platform file-list exports) as the base material for tagging and timeline work. If the index lacks path/timestamp, tag at filename level first; backfill path and timestamps after locating items in the platform.

**Meiya Super Forensics Master (MFS) intake practice (validated)**:
- **Filesystem index DB**: `{caseRoot}/dev/{exhibitName}/data/FSData.mfs`, table `TBL_FS_ENTRY_{device_guid}`. Core columns: `filename, filepath, filesize, createtime, updatetime, deletetime, isdelete, md5`; timestamps are **Unix seconds (Beijing time UTC+8)**; `isdelete=1` for deleted files (note `deletetime` may be -1 or unavailable — filter by `isdelete` directly); `md5` may be empty.
- **AV databases**: Tencent PC Manager `QUARANTINE` table (detection/quarantine records: sample name, source path, TIME), `STARTUP_INFO` table (autostart snapshot: key name and target path) — these two tables are the direct source for the "AV/security software records" dimension.
- **Query method**: Read-only SQLite SELECT via `sqlite_query_cli` (`db_path` = absolute `.mfs` / DB file). Prefer host-listed primary DB paths. Return JSON shape is often `{"columns": [...], "rows": [[...]]}` (rows are lists, not dicts). Parse by **column index**; do not use `row.get(col)`. Large results may spill to disk; parse spilled JSON the same way.
- **Case-analysis Pi tools only**: `read` / `write` / `bash` / `edit` / `sqlite_query_cli`. Discover paths with `bash` one-level `ls` (or host digest); no recursive disk walks.
- **Direct image read via dokan mount**: When the platform has mounted the image, `read` (or bash/python) file content under `C:\osmap\{GUID}_{timestamp}\Root\PartitionN[driveLetter]\...`. Chinese logs are often **GBK-encoded**; open with `open(p, encoding='gbk', errors='replace')` to avoid UTF-8 mojibake.

## Analysis Workflow (3 Phases)

### Phase 1: Fuse Case Facts

Absorb the case narrative first: decide **what to look for and which time window**. Exhibit analysis is not blind scanning; validate case hypotheses.

**Must-confirm case points** (with investigators):
1. What was the loss/anomaly? When discovered?
2. Where are sensitive data (accounts/card secrets/passwords/trade secrets) stored? How do they flow in the business process?
3. Suspected intrusion vector (ran a suspicious program? clicked a link? USB? remote assistance?)
4. Was anyone on-site operating the PC during the incident window? (distinguish insider vs remote intrusion)

**Outputs**:
- Focus time window (e.g. 72h before incident ~ 24h after)
- Focus data-type list (which files/accounts/apps matter)
- Initial hypothesis: remote intrusion vs insider? (drives emphasis on remote-connection traces vs user-activity traces)

### Phase 2: Key Forensic Extraction (6 Mandatory Categories)

For computer images/exhibits, extract records in each of the 6 categories below. Tag "suspicious" while extracting to feed Phase 3 timeline construction.

#### ① Prefetch Traces (program execution history)

| Item | Content |
|------|---------|
| Data source | `C:\Windows\Prefetch\*.pf` |
| Tools | PECmd / WinPrefetchView / NirSoft PrefetchView |
| Fields of interest | Executable path, first run time, last run time, run count, referenced files/directories |
| Anomaly signals | Execution from abnormal paths (Public/Temp/AppData); exe names masquerading as legitimate software; unknown programs first run in the incident window; new programs with very low run counts but matching timing |

> Prefetch retains the most recent 1024 programs (Win10+); older entries are rotated out. For older incidents, supplement with AmCache/ShimCache.

#### ② Recent Access Records (user activity traces)

| Item | Content |
|------|---------|
| Data source | LNK files, Jump Lists, ShellBags, registry MRU (RecentDocs/TypedPaths/RunMRU/WordWheelQuery), LastActivityView aggregated output |
| Fields of interest | File/directory access times, program open times, search-box input history |
| Anomaly signals | Access/save of sensitive files in the incident window; file ops in late-night unattended periods; residual access records for deleted files; abnormal search terms/path inputs |

> LastActivityView aggregates multi-source traces into a unified timeline — suitable as the draft for Phase 3.

#### ③ Software Install Records (including AV/security software)

| Item | Content |
|------|---------|
| Data source | Registry uninstall keys (`HKLM\...\Uninstall`), `C:\Windows\Installer`, install logs; **AV/security product own logs** (Tencent PC Manager / 360 / Huorong / Kaspersky detection, quarantine, protection event logs), Windows Defender event log (`Microsoft-Windows-Windows Defender/Operational`), AMSI logs |
| Fields of interest | Software name, install time, install path; **AV install time, detect/quarantine/clean times, quarantined sample names, protection toggle and exclusion-change times** |
| Anomaly signals | **AV install time (⚠️ important time anchor: victims often install AV after fearing infection — install time often sits next to malware execution)**; unknown software added around the incident; **AV protection disabled/uninstalled/exclusions added (classic attacker behavior); AV detection records with sample names matching the incident window** |

> AV/security records are dual-value leads: **install time** is one of the most reliable deterministic anchors (often used to back-calculate malware execution); **detection logs** give hard records of "when what sample was seen", crossable with Prefetch and recent-access to lock intrusion sequencing. Common AV log locations: Tencent PC Manager (`ProgramData\Tencent\QQPCMgr`), 360 (`ProgramData\360safe`), Huorong (`ProgramData\Huorong`), Defender event logs.

#### ④ Remote Connection Records

| Item | Content |
|------|---------|
| Data source | RDP: event logs (logon 4624 / logoff 4634/4647 type 10), bitmap cache (`%LocalAppData%\Microsoft\Terminal Server Client\Cache`); third-party remote tools: Sunlogin / ToDesk / TeamViewer / AnyDesk logs |
| Fields of interest | Logon time, source IP, logon type, remote-session start/end, device ID |
| Anomaly signals | Remote logons outside work hours; unusual source IPs; successful type-10 (remote interactive) events; remote-tool connection records in the incident window that the subject denies |

> For remote-intrusion cases, this category is key to judging "remote vs insider".

#### ⑤ System Logs

| Item | Content |
|------|---------|
| Data source | Security, System, Application logs; PowerShell/WinRM operational logs |
| Fields of interest | Logon/logoff (4624/4625/4634/4647), privilege use (4672), process creation (4688), service install (7045), account create/password change (4720/4724) |
| Anomaly signals | Successful logons in the incident window; failed-logon brute patterns; new services (possible malicious); new accounts; abnormal PowerShell execution |

#### ⑥ Remote-Control Software Logs

| Item | Content |
|------|---------|
| Data source | Sunlogin (`SunloginClient` logs/driver logs), ToDesk/TeamViewer/AnyDesk connection and device logs |
| Fields of interest | Session start/end, peer device ID/IP, file-transfer records |
| Anomaly signals | Remote sessions in the incident window that the subject denies; file transfers involving sensitive data; unusual device IDs |

> Comparing whether the subject "admits operating" vs remote-control logs is a key adjudication point.

#### ⑦ Priority Tagging of Executables and Scripts (mandatory, core action)

Tag suspicion level for every executable/script-class file in the full inventory. This is the **must-emphasis** tagging step of the whole analysis.

**Tagging scope (malware/execution extension list)**:
- Executables: `.exe` `.dll` `.scr` `.pif` `.com` `.msi` `.hta` `.ocx` `.cpl` `.drv` `.sys`
- Scripts: `.bat` `.cmd` `.ps1` `.vbs` `.vbe` `.js` `.jse` `.wsf` `.wsh` `.py` `.sh` `.jar`
- Payloads: `.tmp` `.dat` `.bin` `.lnk` (when shortcut targets are abnormal)

**Tagging rules (tiers)**:

| Level | Traits |
|-------|--------|
| 🔴 High suspicion | Built-in password / full version / crack wording (e.g. `todesk完整版0000密码.exe`); numeric prefix + software name (e.g. `-870503696AweSunHost.exe`); spelling anomalies (e.g. `systme`, `AndrowsInstaller`); remote-control installer + matching Prefetch record |
| 🟠 Medium suspicion | Remote-control family files (ToDesk/Sunlogin/AweSun/TeamViewer/AnyDesk exe, dll, logs, config, browser indexeddb visits to official sites); white-black paired files (legit software-named exe+dll, e.g. `BaiduNetdiskService.exe/.dll`); unsigned / uncommon paths |
| 🟡 Needs review | bat/cmd/ps1/vbs and similar scripts (must inspect content); generic names (`Client.exe`, `setup.exe`); semantic keywords like Spy/Keygen/Dump |

**Detection points**:
- **Name masquerading**: Legitimate software/system component names (svchost, explorer, WindowsCamera, GoogleUpdate, BaiduNetDisk, etc.) + abnormal location = high suspicion
- **Semantic keywords**: password/pwd/dump/spy/steal/remote-control/trojan/crack/keygen/backdoor/payload/miner/brute-force, etc.
- **Prefetch cross-check**: `.pf` files (e.g. `TODESK.EXE-0CBCCE41.pf`) prove a program **actually ran** — hard evidence for "executed" tagging and a timeline anchor
- **Multi-RAT warning**: Multiple remote-control products on one exhibit (ToDesk + AweSun + Sunlogin) inconsistent with normal office needs → high alert for planted backdoors
- **Browser-trace linkage**: Visits to remote-control official sites (e.g. `sunlogin.oray.com` indexeddb/leveldb cache) indicate remote-tool provenance

**Output**: Executable/script suspicion table (filename, level, rationale, related leads), with priority files explicitly marked 🔴/🟠/🟡.

**Extended dimensions (on demand, not mandatory)**: Registry persistence (Run keys/services/scheduled tasks/WMI), ShimCache/AmCache, filesystem timestamp filters, USN Journal, outbound network (DNS cache / memory-image netstat), browser history.

### Phase 3: Suspicious Record Filter and Timeline Construction

**Suspicious-record extraction rules**:
1. Filter the 6 categories by the focus time window; drop clearly irrelevant items (system maintenance, routine software updates, etc.)
2. Mark "anchor candidates": high-certainty-time records (AV install, file create, remote logon, first program execution)
3. Mark "anomaly flags": abnormal path, abnormal time-of-day, name masquerading, conflicts with subject statements

**Timeline construction**:
- Arrange into a single timeline; each entry: time, source category, event, evidence location, suspicion level
- Apply the **time-anchor method**:
  1. Pick a deterministic anchor (e.g. AV install time)
  2. Trace **before** the anchor → find intrusion actions (first malware execution time)
  3. Trace **after** the anchor → find follow-on behavior (persistence, data ops, anti-forensics)
- Contrast subject statements: claims "no one operated" but traces show late-night activity → supports remote-intrusion hypothesis

**Timeline output**: A sequenced table with suspicion tags — the core deliverable of this skill — and the basis for the judgment report.

## Timeline Construction Spec

The timeline is this skill's core deliverable. Spec:

- **Granularity**: Minute-level minimum; critical events to the second
- **Fields**: `Time | Source category (①~⑥/extended) | Event description | Evidence location (image name + path/log entry) | Suspicion (high/medium/low) | Notes`
- **Suspicion criteria**:
  - High: abnormal time-of-day (late night) + name masquerading/abnormal path + conflict with subject statements
  - Medium: non-routine ops inside the incident window, without strong contradiction
  - Low: routine program execution in the incident window, background only
- **Anchor highlight**: Mark deterministic anchors in the timeline and note backtrace direction (before/after)

## Judgment Report Template

```
# [Case Name] Computer Exhibit Analysis Judgment Report

## 1. Case and Exhibit Overview
- Case summary (loss / discovery time / suspected vector / on-duty situation)
- Exhibit list (image name, source, hash)

## 2. Key Forensic Extraction Results
Per each of 6 categories: extracted count, suspicious count, sample suspicious excerpts

## 3. Intrusion Timeline (Core)
Sequenced table + anchor marks + subject-statement contrast

## 4. Analysis Conclusions
- Preliminary intrusion-mode judgment (remote / insider)
- Basis for attributing source terminal
- Key suspicious programs and files list
- Suggested next actions (sample analysis / C2 legal process / data-flow tracking, etc. — for investigator decision; this report does not execute them)

## 5. Evidence Index
Evidence location for each conclusion (image + path + entry ID)
```

## Methodology Quick Reference

**Time-anchor method**: Any deterministic timestamp (AV install, file create, remote logon, first program execution) can be an anchor for bidirectional behavior-chain reconstruction. AV install time is a high-frequency usable anchor.

**Timestamp handling**: Convert Unix-second timestamps to Beijing time (UTC+8) before comparison; time strings in log text/event XML (e.g. ToDesk session times, 7045 TimeCreated) are already local — use as-is. **Both are trustworthy, but do not treat string times as Unix seconds and convert again**. If cross-tool checks show "same event, two times", first confirm whether two bases were mixed.

**White-black (DLL sideload) recognition**: Public/Temp/AppData + legitimate software names + exe/dll pair = DLL-hijack persistence. (Recognize as anomaly signal; flag for investigators; do not perform sample actions.)

**Statement contrast for adjudication**: Whether the subject "admits operating" vs remote-control/access traces is key to remote intrusion vs insider.

## Deliverables Checklist

- [ ] Full file inventory (extract on data intake)
- [ ] 6-category key forensic extraction records (with suspicion tags)
- [ ] Executable/script priority suspicion table (🔴/🟠/🟡 tiers)
- [ ] Intrusion timeline (with anchors and statement contrast)
- [ ] Judgment report (per template)

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
