---
name: 网络/PCAP 取证
description: 网络/PCAP 取证答题：对 .pcap/.pcapng 调用 tshark/capinfos；若抓包嵌在检材中，先用枢纽工具定位。触发词：pcap、tshark、抓包取证、流量题、会话还原。
version: 1.1.0
name_en: Network / PCAP Exam
name_ru: Сетевая экспертиза / PCAP
description_en: >-
  Network/PCAP exam playbook — run tshark/capinfos on .pcap/.pcapng; locate nested captures via hub
  tools first. Triggers: pcap, tshark, traffic exam, session reconstruction.
description_ru: >-
  Плейбук сетевой/PCAP экспертизы — tshark/capinfos для .pcap/.pcapng; сначала найдите захват через
  hub, если он вложен в носитель.
---

# Analyzing Network Traffic with Packet Captures (Qiko)

## Default rhythm

```text
hub locate/export ONE .pcap → tshark/capinfos on that file → close-out.
Stay on the capture; do not unpack whole-disk images. Recipes SSOT → hub tool-call-recipes.md.
```

**You must call tools** (or honestly stop if CLIs are missing).

## When to use this (and when not)

**Use when** evidence is a capture file or the question is traffic-scoped.

**Do NOT use first** on a whole disk with no capture path → `qiko-forensic-lite-investigate` (then `fl_list_files` / `glob_find` / `forensic_task_manage` to locate/export the pcap).

## Navigation

```text
hub (find/export .pcap)
  → THIS SKILL — bash tshark/capinfos
```

## Tool calls

### 0. If capture path unknown

- Hub Chain A/C: `forensic_task_manage` / `fl_list_files` / `glob_find` for `*.pcap*`.
- Export/copy **only** the capture into workspace if the suite gives a path; never unpack whole disk images.

### 1. Check CLI availability

```powershell
Get-Command tshark, capinfos, dumpcap -ErrorAction SilentlyContinue | Select-Object Name, Source
```

If empty: stop and report missing `tshark`/`capinfos`. Do not invent packet contents.

### 2. Overview

```powershell
capinfos -T -m .\evidence.pcapng
```

```powershell
tshark -r .\evidence.pcapng -q -z endpoints,ip
```

### 3. Question-driven filters

```powershell
tshark -r .\evidence.pcapng -Y "dns" -T fields -e frame.number -e ip.src -e dns.qry.name
```

```powershell
tshark -r .\evidence.pcapng -Y "http.request" -T fields -e frame.number -e ip.src -e http.host -e http.request.uri
```

```powershell
tshark -r .\evidence.pcapng -q -z follow,tcp,ascii,0
```

(Adjust stream index from conversation output.)

### 4. Extract to workspace only

Export objects / credentials / IOC lists under the session workspace. Hash originals if the contest requires it.

## Output

- **答案** line + 溯源: capture path + filter / stream / frame list.
- Chinese 详细解题思路 only when asked.

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
