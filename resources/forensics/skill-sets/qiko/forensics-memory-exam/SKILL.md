---
name: 内存取证答题
description: >-
  内存取证答题：Volatility 2/3，BitLocker/TrueCrypt/VeraCrypt 密钥检索，Windows/Linux/macOS 转储。适用于
  .mem/.raw/.dmp/.vmem。非整盘、非纯流量题。
agent_created: true
disable: false
name_en: Memory Forensics Exam
name_ru: Экспертиза памяти
description_en: >-
  Memory forensics exam playbook — Volatility 2/3, BitLocker/TrueCrypt/VeraCrypt key search,
  Windows/Linux/macOS dumps (.mem/.raw/.dmp/.vmem). Not for whole-disk or pcap-only cases.
description_ru: >-
  Плейбук экспертизы памяти: Volatility 2/3, поиск ключей BitLocker/TrueCrypt/VeraCrypt, дампы
  Windows/Linux/macOS (.mem/.raw/.dmp/.vmem). Не для целого диска и не для чистого pcap.
---

# Memory Forensics Exam Skill

## Default rhythm

```text
hub export dump if nested → lock THIS dump path → Volatility/plugin for stem intent → close-out.
Do not treat memory skill as whole-disk triage. Tool/import shapes → hub tool-call-recipes.md when needed.
```

## Navigation

```text
qiko-forensic-lite-investigate (only if dump is nested inside a larger exhibit and not yet exported)
  → THIS SKILL (Volatility / MYOS MemoryAnalysis tool paths)
  → forensic-network-pcap-exam if a capture is carved out and traffic is the remaining question
```

## When to use this (and when not)

**Use when:** memory-dump contest questions, process/injection/network-in-memory, credential/key recovery from RAM.

**Do NOT use when:** no dump file (only disk image) → hub / computer exam; only `.pcap` → `forensic-network-pcap-exam`.

## Purpose

This skill answers **memory forensics** contest/exam questions. Unlike general memory analysis, it focuses on:

- Rapid question intent and exam-point identification
- Precise command-line solutions
- Contest-format standardized answers
- Volatility 2 and 3 (competitions may specify either)

## Trigger conditions

Use when the user:

- Presents one or more memory forensics contest/exam questions
- Provides a memory image (`.mem` / `.raw` / `.dmp` / `.vmem`) for analysis
- Asks for Volatility-based answers on processes, network, injection, registry, credentials, etc.
- Needs competition-format output
- Asks how to solve a specific memory forensics question

## Core workflow

### Step 0: Resolve MYOS tool paths dynamically (required)

Before any Volatility 3 command or key-search tool, **must** locate the MYOS install root and build tool paths.

#### Path lookup (priority order — stop on first hit)

**Priority 1 — Environment variable**: PowerShell check `MYOS_HOME`:

```powershell
$env:MYOS_HOME
```

If valid → use as `MYOS_ROOT`.

**Priority 2 — Registry**: Search MYOS / Meiya / forensic product uninstall keys:

```powershell
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" | Where-Object { $_.DisplayName -like "*MYOS*" -or $_.DisplayName -like "*美亚*" } | Select-Object DisplayName, InstallLocation
```

If `InstallLocation` found → `MYOS_ROOT`.

**Priority 3 — Common install paths**: Check for `ToolSet\MemoryAnalysis\tools\vol.exe`:

```
D:\MYOS
C:\MYOS
C:\Program Files\MYOS
C:\Program Files (x86)\MYOS
```

First match → `MYOS_ROOT`.

**Priority 4 — Full-disk search** (only if above fail): PowerShell quick search:

```powershell
Get-ChildItem -Path C:\,D:\,E:\ -Filter "vol.exe" -Recurse -ErrorAction SilentlyContinue -Depth 4 | Where-Object { $_.FullName -like "*ToolSet\MemoryAnalysis\tools\vol.exe" } | Select-Object -First 1
```

Derive `MYOS_ROOT` from parent of `ToolSet\MemoryAnalysis\tools`.

**Priority 5 — Ask user**: If all fail, output:

> ⚠️ Could not auto-locate MYOS install directory
>
> Provide MYOS root (e.g. `D:\MYOS`) or full paths for:
> - Volatility 3: `vol.exe`
> - BitlockerKeySearch: `BitlockerKeySearch.exe`
> - TrueCryptKeySearch: `TrueCryptKeySearch.exe`

#### Path variables (internal)

After `MYOS_ROOT` is set:

| Variable | Value | Notes |
|------|-----|------|
| `{MYOS_TOOLS}` | `{MYOS_ROOT}\ToolSet\MemoryAnalysis\tools` | Tool directory |
| `{MYOS_VOL3}` | `{MYOS_TOOLS}\vol.exe` | Volatility 3 |
| `{MYOS_BITLOCKER}` | `{MYOS_TOOLS}\BitlockerKeySearch.exe` | BitLocker key search |
| `{MYOS_TRUECRYPT}` | `{MYOS_TOOLS}\TrueCryptKeySearch.exe` | TrueCrypt/VeraCrypt key search |

> **Path rules**:
> - All `{MYOS_*}` placeholders in this skill must be resolved to real paths before execution
> - User-supplied tool paths override auto-detection
> - Volatility 2 `vol.py` resolves from `$PATH` — no MYOS step needed
> - After resolution, optionally record `MYOS_ROOT` in workspace memory `MEMORY.md` for the session

#### File existence check

Verify these exist; if missing, tell the user and seek alternatives:

```
{MYOS_VOL3}
{MYOS_BITLOCKER}
{MYOS_TRUECRYPT}
```

---

#### Memory encryption key search tools

Three dedicated tools under `{MYOS_TOOLS}`:

| Tool | Path | Encryption type |
|------|------|------------|
| BitlockerKeySearch | `{MYOS_BITLOCKER}` | BitLocker |
| TrueCryptKeySearch | `{MYOS_TRUECRYPT}` | TrueCrypt / VeraCrypt |

**Generic command format**:

```bash
<tool_path>  <memory_image>  <output_dir>
```

**Examples**:

```bash
{MYOS_BITLOCKER}  memory.raw  .\output_keys
{MYOS_TRUECRYPT}  memory.raw  .\output_keys
```

**Use these instead of Volatility when** the question mentions:

- BitLocker / Bitlocker / drive encryption
- TrueCrypt / VeraCrypt / TC / VC
- Encryption key / FVE_KEY
- Disk decryption / partition decryption

### Step 1: Classify the question

Identify question type and load the matching reference section:

| Type | Focus | Reference |
|---------|---------|---------|
| A-Process | Process list / PID / parent / cmdline / start time | `references/common_question_patterns.md` §A |
| B-Network | IP / port / state / C2 | `references/common_question_patterns.md` §B |
| C-File extract | In-memory file scan / dump / content | `references/common_question_patterns.md` §C |
| D-Registry | Keys / autostart / services / users | `references/common_question_patterns.md` §D |
| E-Credentials | NTLM / passwords / AES / BitLocker / TrueCrypt / VeraCrypt / clipboard | `references/common_question_patterns.md` §E |
| F-Malware | Injection / VAD anomalies / hidden processes / modules | `references/common_question_patterns.md` §F |
| G-System info | OS / patches / timezone / env vars | `references/common_question_patterns.md` §G |
| H-Combined | Multi-topic / attack chain | `references/common_question_patterns.md` §H |

### Step 2: Choose Volatility version

```bash
# Volatility 2:
vol.py -f memory.mem --profile=Win10x64_19041 <plugin>

# Volatility 3:
{MYOS_VOL3} -f memory.mem windows.<plugin>
```

**Version rules:**

- Question mentions `vol.py` or `--profile` → Volatility 2
- Question mentions `vol` or `windows.xxx` plugins → Volatility 3
- Older competitions (pre-2023) → prefer Volatility 2
- Newer → prefer Volatility 3
- Uncertain → provide both formats

> **Volatility 3 path**: resolved at step 0 as `{MYOS_VOL3}`.

See `references/volatility_cheatsheet.md` for full command mapping.

### Step 3: Run analysis

Follow the type-specific SOP with these principles:

1. **Read info first** — confirm OS and architecture
2. **pslist/pstree first** — process landscape
3. **Correlate** — process → network → files → registry
4. **Watch timezone** — questions may want UTC+0 vs local
5. **Keep raw output** — answers may require evidence lines

### Step 4: Answer output

Use the standardized template:

```markdown
## Question X: [original question text]

### Analysis approach
1. [Which image/plugin to start from]
2. [Commands/tools used]
3. [Key findings and reasoning]

### Key commands
```bash
{MYOS_VOL3} -f memory.mem windows.xxx --args
```

### Key evidence
[Output snippet / critical lines]

### Answer
**[Final answer in required format]**

### Exam points
- [Techniques involved]
```

## Volatility 2/3 quick reference

| Topic | Volatility 2 | Volatility 3 |
|------|-------------|-------------|
| Image info | `imageinfo` | `windows.info` |
| Process list | `pslist` / `psscan` | `windows.pslist` / `windows.psscan` |
| Process tree | `pstree` | `windows.pstree` |
| Command line | `cmdline` / `consoles` | `windows.cmdline` |
| Network | `netscan` | `windows.netscan` |
| DLL list | `dlllist` | `windows.dlllist` |
| File scan | `filescan` | `windows.filescan` |
| File dump | `dumpfiles -Q <offset>` | `windows.dumpfiles --virtaddr <addr>` |
| Process mem dump | `memdump -p <PID>` | `windows.memmap --pid <PID> --dump` |
| Registry hive | `hivelist` | `windows.registry.hivelist` |
| Registry key | `printkey -K "<key>"` | `windows.registry.printkey --key "<key>"` |
| Password hashes | `hashdump` | `windows.hashdump` |
| LSA secrets | `lsadump` | `windows.lsadump` |
| Malware find | `malfind` | `windows.malfind` |
| Services | `svcscan` | `windows.svcscan` |
| Sessions | `sessions` | `windows.sessions` |
| Clipboard | `clipboard` | `windows.clipboard` |
| Environment | `envars` | `windows.envars` |
| BitLocker keys | N/A (BitlockerKeySearch.exe) | dedicated tool / `windows.aeskeyfind` |
| TrueCrypt/VeraCrypt | N/A (TrueCryptKeySearch.exe) | dedicated tool / `windows.aeskeyfind` |
| Modules | `modscan` / `modules` | `windows.modules` |
| VAD | `vadinfo` | `windows.vadinfo` |
| Mutants | `mutantscan` | `windows.mutantscan` |
| Drivers | `driverscan` | `windows.driverscan` |
| Timeline | `timeliner` | `timeliner.Timeliner` |

Full reference: `references/volatility_cheatsheet.md`.

## Traps to avoid

1. **Timezone** — Volatility defaults to UTC; questions may want local time
2. **PID reuse** — terminated PIDs may be reused; `psscan` keeps dead processes
3. **Offset format** — Vol2 physical offset (`0x…`); Vol3 virtual addresses (longer)
4. **Profile** — Vol2 needs correct profile; Vol3 auto-detects
5. **Case sensitivity** — registry paths and filenames in grep
6. **Encoding** — non-ASCII paths/names may garble in output
7. **Hidden processes** — missing from `pslist` may appear in `psscan`
8. **Injection** — `malfind` false positives; combine VAD permissions + behavior
9. **Network state** — CLOSE_WAIT/TIME_WAIT may be stale; ESTABLISHED = active
10. **File paths** — `filescan` paths are in-memory, not guaranteed on disk

## Reference index

| File | Content | When to load |
|------|------|---------|
| `references/common_question_patterns.md` | 8 question types + templates | After classifying question |
| `references/volatility_cheatsheet.md` | Vol2+3 commands + sample output | When looking up parameters |
| `references/windows_memory_artifacts.md` | Windows artifact locations | Deep Windows structure analysis |

## Related skills

- `forensics-memory-analysis` — general memory forensics knowledge base
- `forensics-competition` — broad competition playbook; this skill is T5 depth
- `forensics-anti-forensics` — crypto/stego; overlaps credential extraction

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
