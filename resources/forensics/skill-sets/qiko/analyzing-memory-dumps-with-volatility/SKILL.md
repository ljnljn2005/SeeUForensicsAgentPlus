---
name: analyzing-memory-dumps-with-volatility
description: Use when analyzing Windows memory dumps or RAM captures with Volatility 3 (`vol`) for process, injection, rootkit, network, YARA, timeline, or LSASS credential exposure work with pypykatz.
domain: cybersecurity
subdomain: digital-forensics
tags:
- malware
- memory-forensics
- Volatility
- RAM-analysis
- incident-response
- credential-extraction
- pypykatz
- password-hashes
mitre_attack:
- T1055
- T1003
- T1059
- T1620
- T1005
- T1074
- T1070
- T1119
version: 1.0.0
author: mahipal
license: Apache-2.0
nist_csf:
- DE.AE-02
- RS.AN-03
- ID.RA-01
- DE.CM-01
- RS.AN-01
- RS.MA-01
---

# Analyzing Memory Dumps with Volatility

Memory forensics for Windows RAM captures. **Part 1** triages a compromised image — processes, injected code, network
activity, rootkit artifacts, YARA hits, timeline. **Part 2** escalates to full credential recovery for post-breach impact
assessment — SAM/LSA/cached hashes plus NTLM / Kerberos / WDigest / DPAPI secrets from LSASS.

**Do not use** for disk-image analysis — use Autopsy, FTK, or Sleuth Kit for disk forensics.

## Runtime Environment (Important)

This application runs on **Windows**; the `exec` tool uses **PowerShell** syntax.

- The Volatility 3 CLI is **`vol`** (not `vol3`/`vol2`) and the credential tool is **`pypykatz`**. Volatility 3 is
  user-provided: the environment detector locates `vol.exe` from `tools\`, Python `Scripts\`, or `PATH`, then injects that
  directory into the `exec` PATH. `pypykatz` has no automated detector yet; verify it separately before LSASS credential
  extraction. A tool invocation itself is platform-neutral (`vol -f <image> <plugin>`); only loops / pipes / redirection
  follow PowerShell.
- **Self-check before the relevant phase.** Part 1 only requires `vol`; full Part 2 credential extraction requires
  `pypykatz` in addition to `vol`. Do not block triage just because `pypykatz` is absent. Do not invent paths, do not fall
  back to `vol3` or Linux commands:
  ```powershell
  Get-Command vol -ErrorAction SilentlyContinue
  vol --version
  # Before Part 2 only:
  Get-Command pypykatz -ErrorAction SilentlyContinue
  ```
  If `vol` is not found, report: *"Memory-forensics environment is not ready (`vol` not on PATH). Check Volatility 3 status
  under **Settings → 解析工具检测** (Volatility 3 card) — it shows whether `vol` is installed and where it resolves from.
  Prepare the environment before memory analysis can run."* and stop.
  If Part 2 needs `pypykatz` and it is not found, report: *"Credential extraction is not ready (`pypykatz` not on PATH).
  Volatility 3 triage and native hashdump/lsadump/cachedump can still run, but install or expose `pypykatz` before LSASS
  credential parsing."* and skip the pypykatz steps.
- **Use a large timeout.** Plugins over multi-GB images take minutes — pass a large `exec` timeout (e.g. `600000` ms). The
  default 30 s will kill the analysis mid-run.
- The Settings -> 解析工具检测 Volatility 3 card only proves `vol.exe` was located and `vol` can be called by the agent; it
  does **not** prove symbol readiness for this memory image. Verify symbols at runtime with `vol -f <image> windows.info`.
  With network access, `vol` fetches missing ISF symbols automatically. Offline investigations must pre-stage matching
  symbols under `%APPDATA%\volatility3\symbols`. A wrong/missing symbol table is the #1 cause of plugin failures or garbage
  output.

Need plugin names, options, or pypykatz JSON shape? Read `references/api-reference.md` in this skill directory.

> ⚠️ **Forensic integrity**: hash the original first (`Get-FileHash`), analyze the dump **in place** (read-only — do NOT
> copy a multi-GB image into the workspace; `vol` never writes to it), and write every dump/export to a dedicated output
> directory in your workspace. Never modify the evidence original.

## When to Use

- A compromised system's RAM has been captured and needs forensic analysis for malware artifacts.
- Detecting fileless / memory-resident malware that leaves no persistent disk artifacts.
- Identifying process injection, DLL injection, or process hollowing.
- Analyzing rootkit activity that hides from disk-based tools.
- Determining what credentials an attacker could access after a breach (scope of compromise, accounts to reset).
- Investigating lateral movement and pass-the-hash / pass-the-ticket (NTLM hashes, Kerberos tickets).
- Recovering encryption keys, tokens, or cloud credentials from process memory.

## Prerequisites

- A memory dump acquired from the target (WinPmem / DumpIt), in raw, crash, or ELF form. Dumps can be 4–64 GB — analyze
  them in place (do NOT copy into the workspace); ensure disk space for the dumped artifacts only.
- The forensic environment prepared (`vol` for Part 1; `pypykatz` only for full Part 2 credential extraction; see Runtime
  Environment).
- The source OS version, for correct symbol selection.
- YARA rules, for signature scanning of memory (Part 1, Step 6).
- Understanding of Windows authentication (NTLM, Kerberos, DPAPI) for interpreting Part 2 output.
- Appropriate legal authorization for credential extraction.

## Step 0 · Forensic Integrity

```powershell
Get-FileHash .\memory.raw -Algorithm SHA256          # record the original hash
New-Item -ItemType Directory -Force .\analysis | Out-Null   # dedicated output dir (in your workspace)
```

Record the hash, then analyze the dump **in place** via its absolute path — do NOT copy a multi-GB image into the
workspace; `vol` opens it read-only. Write every artifact under `.\analysis\` (your workspace, not the evidence
directory). Examples below use `.\memory.raw` for brevity — substitute the dump's real absolute path.

---

# Part 1 — Triage & Analysis

### Step 1: Identify the Image

```powershell
vol -f .\memory.raw windows.info     # OS / build / kernel base — runtime symbol-readiness check
vol -f .\memory.raw --help           # list available plugins
```

### Step 2: Enumerate Processes

```powershell
vol -f .\memory.raw windows.pslist           # active (linked) process list
vol -f .\memory.raw windows.pstree           # parent-child tree
vol -f .\memory.raw windows.psscan           # pool-tag scan — finds hidden/unlinked processes
```

Compare `pslist` vs `psscan`: entries present in `psscan` but **not** `pslist` are potentially hidden by a rootkit (DKOM).

```
Suspicious Process Indicators
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- svchost.exe not spawned by services.exe (wrong parent)
- csrss.exe / lsass.exe with an unusual parent
- Multiple lsass.exe instances (there should be exactly one)
- Misspelled names (scvhost.exe, lssas.exe)
- cmd.exe / powershell.exe spawned by WINWORD.EXE or a browser
- Processes running from %TEMP% / %APPDATA%
- Orphaned processes (parent already terminated)
```

### Step 3: Detect Malicious Code Injection

```powershell
vol -f .\memory.raw windows.malfind                    # RWX regions + PE headers in non-image VADs
vol -f .\memory.raw windows.malfind --dump --pid 2184  # dump injected regions for a PID
vol -f .\memory.raw windows.dlllist --pid 2184         # loaded DLLs per process
vol -f .\memory.raw windows.hollowfind                 # process hollowing (mapped image vs disk)
vol -f .\memory.raw windows.driverscan                 # driver objects (rootkit drivers)
vol -f .\memory.raw windows.modules                    # loaded kernel modules
```

### Step 4: Analyze Network Connections

```powershell
vol -f .\memory.raw windows.netscan                          # all connections + listeners
vol -f .\memory.raw windows.netscan | Select-String "ESTABLISHED"   # only established
```

Cross-reference PIDs with the process list. Suspicious: `svchost.exe` connected to an external IP on a non-standard port; a
GUI app like `notepad.exe` with network connections.

### Step 5: Extract Artifacts

```powershell
vol -f .\memory.raw windows.cmdline                          # process command lines
vol -f .\memory.raw windows.memmap --dump --pid 2184         # dump a process's memory
vol -f .\memory.raw windows.registry.printkey --key "Software\Microsoft\Windows\CurrentVersion\Run"   # persistence
vol -f .\memory.raw windows.filescan | Select-String -Pattern "payload|malware|suspicious"
vol -f .\memory.raw windows.dumpfiles --virtaddr 0xFA8001234560   # extract a file from memory
```

### Step 6: Scan Memory with YARA

```powershell
vol -f .\memory.raw yarascan.YaraScan --yara-file .\malware_rules.yar
vol -f .\memory.raw yarascan.YaraScan --yara-file .\malware_rules.yar --pid 2184
vol -f .\memory.raw yarascan.YaraScan --yara-rules 'rule FindC2 { strings: $s1 = "gate.php" condition: $s1 }'
```

### Step 7: Timeline

```powershell
vol -f .\memory.raw timeliner.Timeliner --output-file .\analysis\timeline.csv
vol -f .\memory.raw windows.pslist --output csv | Out-File .\analysis\processes.csv
vol -f .\memory.raw windows.netscan --output csv | Out-File .\analysis\network.csv
```

---

# Part 2 — Credential Extraction

Run after triage when you need to assess credential compromise. Volatility recovers stored hashes; **pypykatz** recovers the
live LSASS secrets (NTLM, Kerberos, WDigest plaintext, DPAPI).

### Step 1: Locate LSASS

```powershell
vol -f .\memory.raw windows.pslist | Select-String "lsass"
# note the LSASS PID (e.g. 684) for the dumps below
```

### Step 2: Volatility-Native Credential Dumps

```powershell
vol -f .\memory.raw windows.hashdump  | Tee-Object .\analysis\hashdump.txt    # SAM local-account NTLM hashes
vol -f .\memory.raw windows.lsadump   | Tee-Object .\analysis\lsadump.txt     # LSA secrets (service passwords)
vol -f .\memory.raw windows.cachedump | Tee-Object .\analysis\cachedump.txt   # DCC2 cached domain creds
```

```
hashdump format:
User           RID    LM Hash                           NTLM Hash
<account>       <rid>  <lm-hash>                         <ntlm-hash>
```

### Step 3: Dump LSASS Process Memory

```powershell
vol -f .\memory.raw windows.memmap --pid 684 --dump -o .\analysis\lsass\
Move-Item .\analysis\lsass\pid.684.dmp .\analysis\lsass.dmp     # rename for pypykatz
```

### Step 4: Extract Credentials with pypykatz

```powershell
pypykatz lsa minidump .\analysis\lsass.dmp | Tee-Object .\analysis\pypykatz.txt   # human-readable
pypykatz rekall .\memory.raw | Tee-Object .\analysis\pypykatz_full.txt            # against the raw image directly
```

For structured parsing, take pypykatz JSON (`-j`) and parse it in PowerShell — **no inline Python heredocs**:

```powershell
$data = pypykatz lsa minidump .\analysis\lsass.dmp -j | ConvertFrom-Json
$data.logon_sessions.PSObject.Properties.Value | ForEach-Object {
  $s = $_
  if ($s.username -and $s.username -ne '(null)') {
    "Session: $($s.domainname)\$($s.username)  (SID $($s.sid))"
    $s.msv_creds     | Where-Object { $_.NThash }  | ForEach-Object { "  NTLM:   $($_.NThash)" }
    $s.wdigest_creds | Where-Object { $_.password } | ForEach-Object { "  WDigest(plaintext): $($_.password)" }
    $s.kerberos_creds| ForEach-Object { $_.tickets } | ForEach-Object { "  Kerberos ticket: $($_.server)" }
    $s.dpapi_creds   | Where-Object { $_.masterkey } | ForEach-Object { "  DPAPI masterkey: $($_.masterkey)" }
  }
}
```

### Step 5: Kerberos Tickets and Token / Cloud-Credential Hunting

```powershell
pypykatz lsa minidump .\analysis\lsass.dmp -k .\analysis\kerberos\    # export .kirbi tickets
Get-ChildItem .\analysis\kerberos\*.kirbi                             # list recovered tickets
```

Hunt auth tokens and cloud keys in memory with YARA (reliable, needs no pre-generated strings file):

```powershell
vol -f .\memory.raw yarascan.YaraScan --yara-rules 'rule CloudCreds {
  strings:
    $aws  = /AKIA[A-Z0-9]{16}/
    $awss = "aws_secret_access_key" nocase
    $auth = "authorization: bearer" nocase
  condition: any of them }'
```

> `windows.strings` can also dump readable strings but requires a strings file generated up front from the image — prefer the
> YARA approach above for targeted IOC/secret hunting.

### Step 6: Credential Compromise Report

Summarize what was recovered and the required actions:

> **TEMPLATE ONLY:** Every angle-bracketed field below must be replaced with a value returned by tools in the current
> investigation. The placeholders and labels below are not findings and must never appear in a real report as evidence.

```
CREDENTIAL COMPROMISE ASSESSMENT
================================
Local NTLM hashes (SAM):    <local-account-count>
Domain NTLM hashes (LSASS): <domain-account-count>
Kerberos tickets:           <tgt-count> TGT, <tgs-count> TGS
Plaintext (WDigest):        <plaintext-count> (<accounts-or-none>)
Cached domain creds (DCC2): <cached-credential-count>
DPAPI master keys:          <dpapi-key-count>
Cloud credentials:          <cloud-credential-count> (<types-or-none>)

Highest privilege exposed: <highest-verified-privilege> (<account-or-none>)

Required actions:
- <action justified by the recovered evidence>
- <additional action or none>
```

---

## Key Concepts

| Term | Definition |
|------|------------|
| **Memory Forensics** | Analysis of volatile RAM to find processes, connections, and in-memory artifacts absent from disk |
| **Process Hollowing** | Creating a suspended legit process, replacing its image with malicious code, then resuming it |
| **Malfind** | Volatility plugin flagging injected code: executable (RWX) regions with PE headers in non-image VADs |
| **VAD** | Virtual Address Descriptor — kernel structure tracking a process's memory regions; anomalies indicate injection |
| **Pool-Tag Scanning** | Finds kernel objects (processes/files/connections) by their pool tags even when unlinked (rootkit-hidden) |
| **Fileless Malware** | Operates entirely in memory with no disk file; only detectable via memory forensics |
| **LSASS** | Windows process managing authentication; holds NTLM/Kerberos/WDigest/DPAPI secrets in memory |
| **NTLM hash** | Hash of a user password usable for authentication (and pass-the-hash) |
| **Kerberos TGT/TGS** | Ticket-Granting Ticket / service ticket; basis of pass-the-ticket and golden/silver tickets |
| **WDigest** | Legacy protocol that kept **plaintext** passwords in LSASS (pre-Win8.1 / when re-enabled) |
| **DPAPI** | Data Protection API; master keys derived from user credentials protect secrets at rest |
| **DCC2** | Domain Cached Credentials — cached domain password hashes for offline logon |

## Tools & Systems

| Tool | Purpose |
|------|---------|
| **Volatility 3 (`vol`)** | Memory forensics framework; triage plugins + `hashdump`/`lsadump`/`cachedump` |
| **pypykatz** | Python Mimikatz; recovers NTLM/Kerberos/WDigest/DPAPI from LSASS dumps or raw images |
| **WinPmem / DumpIt** | Windows memory acquisition (raw dump) |
| **hashcat / John the Ripper** | Offline cracking of recovered NTLM / DCC2 hashes |
| **Mimikatz / Rubeus / Impacket** | Advanced (separate install) — offline LSASS parsing, Kerberos ticket manipulation, secretsdump |

## Common Scenarios

**Fileless malware after an EDR alert** — disk artifacts were wiped, but a pre-reboot dump exists. `windows.pstree` to find
what spawned PowerShell → `windows.malfind` for injected code → dump the suspect process and extract C2 strings →
`windows.netscan` for connections → `windows.cmdline` for executed commands → YARA for known families → then Part 2 to
assess credential exposure.

**Post-breach credential assessment** — go straight to Part 2: `hashdump`/`lsadump`/`cachedump`, dump LSASS, run pypykatz for
all credential types, check for krbtgt / domain-admin material, prioritize resets by privilege.

**Lateral-movement investigation** — extract NTLM hashes and Kerberos tickets (pypykatz) to reconstruct pass-the-hash /
pass-the-ticket activity; correlate recovered accounts with logon events.

**Pitfalls**: wrong symbol table for the OS build (plugin failures / garbage); not comparing `pslist` vs `psscan` (missing
hidden processes); concluding before dumping full process memory (strings may hold extra IOCs); forgetting the large `exec`
timeout on big images.

## Output Format

> **TEMPLATE ONLY:** This block defines structure, not case content. Replace every angle-bracketed field only with values
> returned by tools in the current investigation. These placeholders must never appear in a real report as evidence.

```
MEMORY FORENSICS ANALYSIS REPORT
================================
Dump File:   <dump-file>       OS: <verified-os-and-build>
Dump Size:   <dump-size>       Capture: <capture-tool-and-time-or-unknown>
SHA-256:     <source-sha256>

SUSPICIOUS PROCESSES
PID    PPID    Name            Path              Observed anomaly
<pid>  <ppid>  <process-name>  <process-path>    <observation-or-none>

CODE INJECTION (malfind)
PID <pid> (<process-name>): <address>  <permissions>  <observed-signature>  SHA-256(dump)=<dump-sha256>

NETWORK
PID    Process         Local                      Foreign                    State
<pid>  <process-name>  <local-ip>:<local-port>    <remote-ip>:<remote-port>  <state>

CREDENTIALS (see Part 2 report block above)
YARA: PID <pid> -> <rule-name-or-no-hit> @ <address-or-none>

TIMELINE
<timestamp>  <event supported by a named plugin or artifact>
<timestamp>  <event supported by a named plugin or artifact>
```

## 使用步骤

本章给出 Volatility 3 内存取证的标准闭环流程。将本技能用于 Windows 内存镜像时，按以下顺序执行；每一步都应记录插件名、参数、输出文件、异常点和复核方式。

### 0. 检材接入与案件初始化
1. 登记案件信息：镜像路径、大小、SHA-256、采集工具、采集时间、目标系统版本、主机名、时区、用户账户和案件目标。
2. 保持原始镜像只读：不复制超大镜像到工作区，不在证据目录生成中间文件；所有导出物写入独立 `analysis/` 目录。
3. 验证 Volatility 3 可用性：执行 `Get-Command vol` 和 `vol --version`；Part 2 前再验证 `pypykatz`。
4. 验证符号与镜像可解析性：执行 `vol -f <image> windows.info`，确认 OS 版本、构建号、内核基址和插件输出正常。
5. 若离线分析，提前准备匹配 ISF 符号；符号错误会导致插件失败、字段缺失或结果不可信。

### 1. 进程、会话与命令行分析
1. 运行 `windows.pslist`、`windows.pstree`、`windows.psscan`，比对活动进程、父子关系和池扫描结果。
2. 对可疑 PID 补充 `windows.cmdline`、`windows.envars`、`windows.sessions`、`windows.handles`，确认启动参数、环境变量、会话和句柄。
3. 重点识别：错误父进程、异常进程名、临时目录启动、孤儿进程、重复 lsass、浏览器或 Office 派生 shell、无签名路径、异常启动时间。
4. 对进程异常不要仅凭名称下结论；必须结合路径、父进程、命令行、网络行为和 malfind 结果交叉判断。

### 2. 网络连接与流量联合分析
1. 运行 `windows.netscan`，导出全部连接；筛选 `ESTABLISHED`、`SYN_SENT`、`CLOSE_WAIT` 和异常监听端口。
2. 将网络 PID 回填到进程分析结果，确认外联进程是否具备合理网络用途。
3. 如有 PCAP 或流量日志，按协议过滤 HTTP、DNS、FTP、ICMP、Telnet 和潜在隐蔽通道，再追踪可疑会话。
4. 从流量中导出文件、Cookie、Token、明文凭据或 C2 地址，并与内存中的进程命令行、注入代码、配置文件和 YARA 命中互证。
5. 对 DNS 隧道、ICMP 载荷、非标准端口 HTTP 和长连接心跳保持敏感；不要只看端口号，要看进程、载荷和时间模式。

### 3. 代码注入、Rootkit 与持久化检查
1. 对可疑进程运行 `windows.malfind`，识别 RWX 私有内存、PE 头、shellcode 或异常内存保护。
2. 需要取证复核时，使用 `windows.malfind --dump --pid <pid>` 或 `windows.memmap --dump --pid <pid>` 导出区域。
3. 运行 `windows.dlllist --pid <pid>`、`windows.hollowfind`、`windows.driverscan`、`windows.modules`，检查 DLL 注入、进程镂空、恶意驱动和内核模块。
4. 对注册表 Run 键、服务、计划任务相关内存痕迹进行抽查；如存在磁盘取证结果，应与磁盘持久化证据互证。
5. malfind 命中需排除合法 JIT、.NET、调试器、安全软件和驱动自保护；导出后应继续做字符串、哈希、YARA 或反编译验证。

### 4. 内存字符串、密钥与敏感配置搜索
1. 根据案件目标构造搜索策略：C2 域名、URL、UA、互斥量、注册表路径、密钥标识、数据库口令、加密容器配置。
2. 优先使用 `yarascan.YaraScan` 做规则化扫描；规则应覆盖字符串、正则、文件魔数和协议特征。
3. 对数据库或应用密钥，搜索 `PRAGMA key`、`keyfile`、`PIM`、`volume header`、`salt`、`AES`、`SHA` 等候选标识，并结合进程定位来源。
4. 对 VeraCrypt、BitLocker、加密数据库或自定义加密场景，先定位持有密钥材料的进程，再导出该进程内存或相关区域。
5. 所有候选密钥、口令、哈希和配置都必须编号登记，记录来源 PID、虚拟地址、插件和命中上下文。

### 5. 凭据提取与账户影响评估
1. 定位 LSASS：运行 `windows.pslist` 或 `windows.psscan`，确认唯一合法 lsass PID。
2. 先运行 Volatility 原生 `windows.hashdump`、`windows.lsadump`、`windows.cachedump`，获取 SAM、LSA Secrets 和 DCC2。
3. 使用 `windows.memmap --dump --pid <lsass-pid>` 导出 LSASS 内存，再用 `pypykatz` 解析 NTLM、Kerberos、WDigest、DPAPI。
4. 对导出的哈希、明文、票据和 masterkey 做账户级归并，识别最高权限、域管、服务账户和机器账户。
5. 如需离线破解，将 NTLM/DCC2 转换为 Hashcat 或 John 格式；破解结果必须与账户策略、历史口令和系统配置交叉验证。

### 6. 磁盘、日志与外部证据交叉验证
1. 本技能不替代磁盘取证；磁盘镜像深度分析应使用 Autopsy、FTK、Sleuth Kit 等工具完成。
2. 将内存结论与磁盘证据比对：浏览器历史、下载记录、最近文件、.lnk、注册表、日志、配置文件和可执行文件时间戳。
3. 对 API 投毒、配置篡改或中转服务器场景，检查本地权限白名单、endpoint 配置、工具调用日志和下载记录。
4. 注册表 RecentDocs 和最近文件键更新时间不能直接等同于真实访问时间；应结合 .lnk、文件时间戳和其他访问痕迹复核。
5. 对来自流量、内存、磁盘和日志的同一指标建立映射表：进程、PID、文件、IP、域名、账户、时间和证据来源。

### 7. 解密验证与结果闭环
1. 对每个候选密钥或口令执行验证：尝试解密目标数据库、加密容器、文件或配置，检查文件头、魔数、明文字段或业务数据。
2. 对 BitLocker 场景，结合恢复密钥校验规则、EFDD、Passware Kit 或工具恢复结果判断有效性，不轻信单一字符串命中。
3. 对 VeraCrypt 或应用密码场景，结合进程、配置文件、打包程序逆向和哈希算法还原爆破目标；必要时构造 Hashcat 格式。
4. 对勒索或自定义加密文件，先分析文件结构、魔数、偏移、原始大小和算法，再用内存中提取的密钥标识或对称密钥验证解密。
5. 验证成功后记录完整闭环：候选来源、验证命令、解密结果、输出哈希和可复现步骤；验证失败则标记为待排除候选。

### 8. 时间线、报告与复盘
1. 使用 `timeliner.Timeliner`、进程列表、网络连接、cmdline、YARA 命中和磁盘日志构建统一时间线。
2. 时间线应覆盖系统启动、进程创建、文件下载、文件修改、网络连接、凭据使用和清理动作。
3. 对每个结论标注证据等级：直接内存证据、流量证据、磁盘佐证、推断、未验证候选。
4. 输出报告应包含：镜像哈希、OS 信息、可疑进程、注入结果、网络结果、凭据暴露、密钥验证、时间线和处置建议。
5. 重要结论必须可复现：重跑插件、重算哈希、重新解密或重新解析 LSASS，避免一次性截图作为唯一依据。

## D2-05 输入输出说明

### 输入
1. 内存镜像：raw、crash、ELF 或工具封装格式；应记录路径、大小、采集时间、采集工具、SHA-256 和写保护状态。
2. 案件元数据：目标系统版本、构建号、主机名、时区、用户账户、域信息、案件编号和授权范围。
3. 运行环境：`vol` 可执行路径、Python 运行环境、符号目录、网络代理策略；Part 2 需要 `pypykatz`。
4. 辅助证据：YARA 规则、PCAP、流量日志、磁盘取证导出结果、注册表导出、日志、配置文件、数据库或加密容器样本。
5. 分析目标：恶意进程、注入、C2、凭据暴露、密钥恢复、勒索解密、横向移动或特定应用取证。

### 输出
1. 分析目录：所有输出统一写入 `analysis/`，包括 CSV、TXT、DMP、BIN、KIRBI、规则命中和报告文件。
2. 进程与网络输出：`windows.info`、`pslist`、`pstree`、`psscan`、`cmdline`、`netscan` 的标准化导出文件。
3. 注入与内存输出：malfind 摘要、dump 出的内存区域、进程内存、文件对象、YARA 命中和哈希清单。
4. 凭据输出：hashdump、lsadump、cachedump、LSASS dump、pypykatz 文本或 JSON、Kerberos tickets、DPAPI masterkey。
5. 验证输出：解密尝试记录、文件头校验结果、哈希反查结果、爆破任务配置、解密后样本哈希和验证截图/日志。

### 命名与证据链
1. 输出文件命名建议：`<case>_<plugin>_<pid-or-target>_<timestamp>.<ext>`，避免覆盖和歧义。
2. 每个导出文件记录来源插件、命令行、原始镜像哈希、生成时间、生成人和输出路径。
3. 对关键证据（LSASS dump、注入代码、密钥候选、解密后文件）计算 SHA-256，并写入报告附录。
4. 任何需要回传或归档的证据文件，都应保持只读；不得在原始镜像上执行写操作或格式转换覆盖。

### 边界与失败处理
1. `vol` 未找到时停止分析，并提示检查 Volatility 3 环境；不得伪造路径或退回错误工具。
2. `pypykatz` 缺失时，可继续 Volatility 原生 triage 和 hashdump/lsadump/cachedump，但跳过 LSASS 深度解析。
3. 符号缺失或版本不匹配时，先修复符号再继续；不得将乱码输出直接作为结论。
4. 超大镜像必须使用长超时；对耗时插件采用分阶段导出和断点复核，而不是反复重跑同一命令。

## D3-01 交叉验证与误报控制

### 1. 进程结论验证
1. `pslist` 与 `psscan` 差异不能直接判定 rootkit；需结合 `pstree`、`cmdline`、`sessions`、`handles` 和时间线复核。
2. 可疑进程必须至少满足两个维度异常：父进程、路径、名称、命令行、网络、注入、签名或时间。
3. 对安全软件、虚拟化代理、调试器、EDR 注入和系统工具保持白名单意识，避免把正常防护行为当作攻击。

### 2. 注入与内存区域验证
1. malfind 命中需检查内存保护、区域类型、PE 头、字符串、模块路径和进程用途。
2. 对 .NET、Java、浏览器 JIT、调试器、反作弊或加壳程序，可能出现 RWX 区域；必须导出后做哈希和规则扫描。
3. 如注入区域包含完整 PE，记录基址、大小、SHA-256，并尝试与磁盘文件、YARA 和沙箱结论比对。
4. 如仅有字符串或配置，应标记为配置候选，不得直接称为可执行恶意代码。

### 3. 网络与流量验证
1. `windows.netscan` 结果可能包含已退出进程、残留连接或时间偏差；需与进程存活时间和流量时间对齐。
2. 外联 IP 和域名应与 DNS、代理日志、防火墙、PCAP 或内存中的 C2 配置互证。
3. 对隐蔽通道（DNS TXT、ICMP payload、非标准端口、长连接心跳）要查看载荷模式和会话频率，而非仅看端口。
4. 如流量中导出文件或凭据，应与内存进程、命令行、文件路径和账户登录痕迹建立映射。

### 4. 凭据与密钥验证
1. 哈希、明文、票据和 masterkey 必须归并到账户、域、登录会话和来源进程，避免重复计数。
2. 对 WDigest 明文和 LSASS 敏感数据，需结合系统版本、补丁、凭据保护和 RunAs 场景判断可信度。
3. 对 VeraCrypt、BitLocker、数据库口令或应用密码，不能仅凭字符串命中；应通过挂载、解密、文件头校验或哈希反查验证。
4. 对候选口令构造 Hashcat/John 任务时，记录算法、盐、PIM、keyfile、迭代次数和来源偏移，确保可复核。

### 5. 时间线与磁盘证据验证
1. 时间线应使用统一时区；比较内存进程创建时间、网络连接时间、文件下载时间、注册表更新时间和日志事件。
2. 注册表 RecentDocs 键更新时间、最近文件键或缓存时间可能滞后或被系统维护更新，不能单独证明用户访问。
3. 磁盘证据应优先使用 .lnk、Jump List、Prefetch、USN、事件日志、浏览器历史和文件时间戳进行交叉印证。
4. 如内存与磁盘时间冲突，需考虑时区错误、镜像采集时间、系统休眠、时钟漂移或日志覆盖。

### 6. 结论分级与可复现要求
1. 每个结论分为：已验证、强嫌疑、弱嫌疑、待排除、误报。
2. 已验证结论必须有闭环证据：插件输出、导出文件、哈希、解密结果、流量命中或日志佐证。
3. 重要命令和参数必须可重放；报告不得只写结论而不保留输出文件。
4. 在最终报告前重新运行关键插件或重新解析关键导出物，确认结果稳定且无符号/超时导致的污染。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
