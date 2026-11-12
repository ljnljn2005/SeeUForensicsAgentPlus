---
name: analyzing-network-traffic-with-wireshark
description: 'Read and analyze network packet captures (.pcap / .pcapng) with Wireshark and tshark — and optionally capture live traffic — to answer questions about the traffic: follow streams, extract files / credentials / IOCs, identify hosts, DNS, TLS and protocols, and spot malicious patterns (C2, exfiltration, scanning, MITM). Use for ANY traffic / packet-capture question or CTF / forensics task that hands you a .pcap or .pcapng file, as well as authorized incident-response capture on a network segment.'
domain: cybersecurity
subdomain: network-security
tags:
- network-security
- wireshark
- packet-analysis
- traffic-analysis
- pcap
version: '1.0'
author: mahipal
license: Apache-2.0
nist_csf:
- PR.IR-01
- DE.CM-01
- ID.AM-03
- PR.DS-02
mitre_attack:
- T1040
- T1071
- T1557
- T1046
---
# Analyzing Network Traffic with Wireshark

Packet-level analysis for network security investigations. Capture or read PCAP/PCAPNG files, apply
display filters, follow streams, extract artifacts and IOCs, and produce evidence with chain-of-custody hashes.

**Do not use** to capture traffic on networks without authorization, to intercept private communications
without legal authority, or as a substitute for a full SIEM in production monitoring.

## Runtime Environment (Important)

This application runs on **Windows**; the `exec` tool uses **PowerShell** syntax.

- The CLI tools are **`tshark`** (headless capture/analysis), **`dumpcap`**, **`editcap`** and **`mergecap`**, all
  shipped with a **Wireshark** install. Live capture additionally needs the **Npcap** driver and an
  **elevated (Administrator)** session. A tool invocation itself is platform-neutral
  (`tshark -r <file> -Y <filter>`); only loops / pipes / redirection follow PowerShell.
- **Self-check before you start.** Confirm `tshark` resolves — it is the preferred engine (3,000+ dissectors,
  stream / object export, `-z` statistics). `tshark` ships with Wireshark, and on this product `exec` adds
  Wireshark's install directory to PATH, so it resolves here whenever Wireshark is installed (even if a bare
  shell would not find it):
  ```powershell
  Get-Command tshark -ErrorAction SilentlyContinue
  tshark -v
  ```
- **If `tshark` is genuinely missing, do NOT just stop** — fall back to a pure-Python parser so a `.pcap` /
  `.pcapng` question can still be answered. Write a short Python script to the workspace and run it with
  `uv run` using **scapy** (pure-Python, reads both pcap and pcapng; `uv` auto-provisions it — no manual pip):
  ```powershell
  # after writing e.g. parse.py  (from scapy.all import PcapReader; for p in PcapReader(path): ...)
  uv run --with scapy .\parse.py "<capture.pcapng>"
  ```
  scapy covers the common needs (iterate frames, filter, reassemble TCP streams, pull DNS / HTTP / payloads)
  but is weaker than tshark at deep dissection — note that and recommend installing Wireshark for full
  capability. (`pyshark` is NOT a tshark-free fallback: it shells out to tshark, so it still needs Wireshark —
  use scapy or dpkt.) Do not invent tshark paths or fall back to Linux commands (`sha256sum`, `sort -u`,
  `uniq`, `/tmp/...`).
- **Use a large timeout for capture and big-PCAP work.** A live capture runs for its full duration and
  protocol stats over multi-GB captures take minutes — pass a large `exec` timeout (e.g. `600000` ms). The
  default 30 s will kill the capture/analysis mid-run.
- **Windows interfaces have no `eth0`.** Enumerate with `tshark -D` and capture by the **number** it prints
  (`tshark -i 1 ...`), not a Linux interface name.

> ⚠️ **Forensic integrity**: hash the original capture first (`Get-FileHash`), analyze it **in place** (read-only —
> tshark/scapy never write to it, so a multi-GB capture need not be copied into the workspace), and write every export
> into your workspace directory. Never modify the evidence original.

## When to Use

- Investigating suspected network intrusions by examining packet-level evidence of command-and-control traffic, data exfiltration, or lateral movement
- Diagnosing network performance issues such as retransmissions, fragmentation, or DNS resolution failures
- Analyzing malware communication patterns by capturing traffic from sandboxed or isolated hosts
- Validating firewall and IDS rules by confirming what traffic is actually traversing network segments
- Extracting files, credentials, or indicators of compromise from captured network sessions

## Prerequisites

- Wireshark 4.0+ installed (provides `tshark`, `dumpcap`, `editcap`, `mergecap`)
- **Npcap** driver installed and an **Administrator** PowerShell session for live packet capture
- Network interface access (physical NIC, span port, or network tap) to the monitored segment
- Sufficient disk space for capture files (estimate 1 GB per minute on busy gigabit links)
- Familiarity with TCP/IP protocols, HTTP, DNS, TLS, and SMB at the packet level

## Workflow

> The examples below use the symbolic case directory `C:\cases\<case-id>`. **On this product, write your
> outputs into your firmament workspace directory instead** (see the environment instructions for its path) and
> substitute that path for `C:\cases\<case-id>` throughout. Never write into the directory of the source
> capture — treat it as read-only evidence.

### Step 1: Configure Capture Environment

Set up the capture interface and filters to target relevant traffic:

```powershell
# List available interfaces (capture by the NUMBER shown, e.g. -i 1)
tshark -D

# Start capture on interface 1 with a capture filter to limit scope
tshark -i 1 -f "host <source-ip> and (port 80 or port 443 or port 445)" -w C:\cases\<case-id>\capture.pcapng

# Capture with ring buffer to manage disk usage (10 files, ~100 MB each)
tshark -i 1 -b filesize:102400 -b files:10 -w C:\cases\<case-id>\rolling_capture.pcapng

# Capture on multiple interfaces simultaneously
tshark -i 1 -i 2 -w C:\cases\<case-id>\multi_interface.pcapng
```

For the Wireshark GUI, set the capture filter in the Capture Options dialog before starting.

### Step 2: Apply Display Filters for Targeted Analysis

```powershell
# Filter HTTP traffic containing suspicious user agents
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'http.user_agent contains "curl" or http.user_agent contains "Wget"'

# Find DNS queries to suspicious TLDs
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'dns.qry.name contains ".xyz" or dns.qry.name contains ".top" or dns.qry.name contains ".tk"'

# Identify TCP retransmissions indicating network issues
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'tcp.analysis.retransmission'

# Filter SMB traffic for lateral movement detection
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'smb2.cmd == 5 or smb2.cmd == 3' -T fields -e ip.src -e ip.dst -e smb2.filename

# Find cleartext credential transmission
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'ftp.request.command == "PASS" or http.authbasic'

# Detect beaconing patterns (regular interval connections)
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'ip.dst == 192.0.2.50' -T fields -e frame.time_relative -e ip.src -e tcp.dstport
```

### Step 3: Protocol-Specific Deep Analysis

```powershell
# Follow a TCP stream to reconstruct a conversation
tshark -r C:\cases\<case-id>\capture.pcapng -q -z follow,tcp,ascii,0

# Analyze HTTP request/response pairs
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'http' -T fields -e frame.time -e ip.src -e ip.dst -e http.request.method -e http.request.uri -e http.response.code

# Extract DNS query/response statistics
tshark -r C:\cases\<case-id>\capture.pcapng -q -z dns,tree

# Analyze TLS handshakes (Server Hello) for negotiated cipher suites
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'tls.handshake.type == 2' -T fields -e ip.src -e ip.dst -e tls.handshake.ciphersuite

# SMB file access enumeration
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'smb2' -T fields -e frame.time -e ip.src -e ip.dst -e smb2.filename -e smb2.cmd
```

### Step 4: Extract Artifacts and IOCs

```powershell
# Export HTTP objects (files transferred over HTTP)
tshark -r C:\cases\<case-id>\capture.pcapng --export-objects "http,C:\cases\<case-id>\http_objects"

# Export SMB objects (files transferred over SMB)
tshark -r C:\cases\<case-id>\capture.pcapng --export-objects "smb,C:\cases\<case-id>\smb_objects"

# Extract all unique destination IPs for threat intelligence lookup
tshark -r C:\cases\<case-id>\capture.pcapng -T fields -e ip.dst | Sort-Object -Unique | Set-Content C:\cases\<case-id>\unique_dest_ips.txt

# Extract TLS certificate subject / SAN information
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'tls.handshake.type == 11' -T fields -e x509sat.uTF8String -e x509ce.dNSName

# Extract all URLs accessed (host + URI), de-duplicated
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'http.request' -T fields -e http.host -e http.request.uri | Sort-Object -Unique | Set-Content C:\cases\<case-id>\urls.txt

# Hash extracted files for IOC matching
Get-ChildItem -File -Recurse C:\cases\<case-id>\http_objects | Get-FileHash -Algorithm SHA256 |
  Export-Csv C:\cases\<case-id>\extracted_file_hashes.csv -NoTypeInformation
```

### Step 5: Statistical Analysis and Anomaly Detection

```powershell
# Protocol hierarchy statistics
tshark -r C:\cases\<case-id>\capture.pcapng -q -z io,phs

# Conversation statistics (TCP and UDP)
tshark -r C:\cases\<case-id>\capture.pcapng -q -z conv,tcp -z conv,udp

# Identify top talkers
tshark -r C:\cases\<case-id>\capture.pcapng -q -z endpoints,ip

# IO statistics (packets per second)
tshark -r C:\cases\<case-id>\capture.pcapng -q -z io,stat,1,"COUNT(frame) frame"

# Detect port scanning patterns (count SYN-only packets per src/port)
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'tcp.flags.syn == 1 and tcp.flags.ack == 0' -T fields -e ip.src -e tcp.dstport |
  Group-Object | Sort-Object Count -Descending | Select-Object -First 20 Count, Name

# Top contacted HTTP hosts (C2 / beaconing candidates by request frequency)
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'http.request' -T fields -e http.host |
  Group-Object | Sort-Object Count -Descending | Select-Object -First 20 Count, Name

# ARP cache poisoning / MITM (T1557): list every IP-to-MAC mapping claimed in ARP
# replies, de-duplicated. The same IP appearing with two different MACs is the tell.
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'arp.opcode == 2' -T fields -e arp.src.proto_ipv4 -e arp.src.hw_mac |
  Sort-Object -Unique

# Wireshark's built-in duplicate-IP heuristic (gratuitous-ARP floods, cache poisoning)
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'arp.duplicate-address-frame' -T fields -e arp.src.proto_ipv4 -e arp.src.hw_mac

# LLMNR / NBT-NS name poisoning (Responder-style MITM): a host answering broadcast
# name lookups it should not. Review which IP is responding.
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'llmnr && dns.flags.response == 1' -T fields -e ip.src -e dns.qry.name
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'nbns.flags.response == 1' -T fields -e ip.src -e nbns.name
```

### Step 6: Generate Reports and Export Evidence

```powershell
# Export filtered packets to a new PCAP for evidence preservation
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'ip.addr == <source-ip> and tcp.port == 4444' -w C:\cases\<case-id>\evidence_c2_traffic.pcapng

# Generate packet summary in CSV format
tshark -r C:\cases\<case-id>\capture.pcapng -T fields -E header=y -E 'separator=,' -e frame.number -e frame.time -e ip.src -e ip.dst -e ip.proto -e tcp.srcport -e tcp.dstport -e frame.len |
  Set-Content C:\cases\<case-id>\traffic_summary.csv

# Export to JSON / Elastic (EK) for SIEM ingestion (Splunk / ELK)
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'http or dns' -T json | Set-Content C:\cases\<case-id>\packets.json
tshark -r C:\cases\<case-id>\capture.pcapng -T ek | Set-Content C:\cases\<case-id>\packets.ek.json

# Create PDML (XML) output for programmatic analysis
tshark -r C:\cases\<case-id>\capture.pcapng -T pdml | Set-Content C:\cases\<case-id>\capture_analysis.xml

# Calculate capture file hash for chain of custody
Get-FileHash C:\cases\<case-id>\capture.pcapng -Algorithm SHA256 | Tee-Object C:\cases\<case-id>\capture_hash.txt
```

### Step 7: Extract Credentials and Authentication Artifacts

Recover credentials sent in the clear or as crackable hashes (authorized forensics only — treat everything
recovered here as highly sensitive):

```powershell
# HTTP Basic Auth — Wireshark dissects the decoded "user:password" for you
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'http.authbasic' -T fields -e ip.src -e http.authbasic

# ...or decode the raw Authorization header yourself (PowerShell equivalent of `base64 -d`)
$h = tshark -r C:\cases\<case-id>\capture.pcapng -Y 'http.authorization' -T fields -e http.authorization | Select-Object -First 1
[Text.Encoding]::ASCII.GetString([Convert]::FromBase64String(($h -replace '^Basic ', '')))

# FTP credentials (cleartext)
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'ftp.request.command == "USER" or ftp.request.command == "PASS"' -T fields -e ip.src -e ftp.request.command -e ftp.request.arg

# NTLMv2 challenge/response (SMB or HTTP NTLMSSP) — crack offline with hashcat -m 5600
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'ntlmssp.auth.ntlmv2response' -T fields -e ntlmssp.auth.username -e ntlmssp.auth.domain -e ntlmssp.auth.ntlmv2response |
  Set-Content C:\cases\<case-id>\ntlm_hashes.txt

# Kerberos principals / realms (AS-REQ pre-auth)
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'kerberos.CNameString' -T fields -e kerberos.CNameString -e kerberos.realm

# SMTP / POP3 / IMAP auth on un-encrypted mail sessions
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'pop.request.command == "USER" or pop.request.command == "PASS"' -T fields -e ip.src -e pop.request.parameter
tshark -r C:\cases\<case-id>\capture.pcapng -Y 'imap.request contains "LOGIN"' -T fields -e ip.src -e imap.request
```

> Credentials only appear in cleartext on **un-encrypted** sessions. NTLMv2 responses are not reversible but
> are crackable offline — store them under the case directory and follow the evidence-handling policy.

### Step 8: Decrypt TLS (when session keys are available)

With the session keys, tshark decrypts TLS so the inner HTTP / HTTP2 / gRPC becomes readable:

```powershell
# Preferred: an SSLKEYLOGFILE of pre-master secrets exported by the browser/app at capture time
tshark -r C:\cases\<case-id>\capture.pcapng -o tls.keylog_file:C:\cases\<case-id>\sslkeys.log -Y 'http2 or http'

# Server RSA private key — only decrypts non-forward-secret (RSA key-exchange) cipher suites
tshark -r C:\cases\<case-id>\capture.pcapng -o 'tls.keys_list:<source-ip>,443,http,C:\cases\<case-id>\server.key' -Y 'http'
```

## Key Concepts

| Term | Definition |
|------|------------|
| **Capture Filter (BPF)** | Berkeley Packet Filter syntax applied at capture time to limit which packets are recorded, reducing file size and improving performance |
| **Display Filter** | Wireshark-specific filter syntax applied to already-captured packets for focused analysis without altering the capture file |
| **PCAPNG** | Next-generation packet capture format supporting multiple interfaces, name resolution, annotations, and metadata in a single file |
| **TCP Stream** | Reassembled sequence of TCP segments representing a complete bidirectional conversation between two endpoints |
| **Protocol Dissector** | Wireshark module that decodes a specific protocol's fields and structure, enabling deep inspection of packet contents |
| **IO Graph** | Time-series view of packet or byte rates over the capture duration, useful for identifying traffic spikes or beaconing |

## Tools & Systems

- **Wireshark 4.0+**: GUI packet analyzer with dissectors for 3,000+ protocols, stream reassembly, and export capabilities
- **tshark**: Command-line Wireshark for headless capture, batch processing, and scripted analysis pipelines
- **dumpcap**: Lightweight capture engine (bundled with Wireshark) for high-rate captures with minimal overhead — the Windows alternative to tcpdump
- **mergecap**: Combines multiple capture files into a single PCAP for unified analysis
- **editcap**: Splits, time-slices, filters, and converts between capture file formats

See `references/api-reference.md` for the full tshark cheat-sheet — display-filter and field tables, statistics
(`-z`) options, object-export / stream-follow forms, credential & auth fields, TLS-decryption and export
formats, and `editcap` / `mergecap` usage.

## Common Scenarios

### Scenario: Investigating Suspected Data Exfiltration via DNS Tunneling

**Context**: The SOC team detected unusually high DNS query volumes from a workstation (<source-ip>) to an external domain. The SIEM alert flagged DNS queries averaging <observed-rate> compared to <baseline>. A packet capture was initiated from the network tap on the workstation's VLAN.

**Approach**:
1. Capture traffic from the workstation (interface <interface-number> = the <segment-description>): `tshark -i <interface-number> -f "host <source-ip> and port 53" -w C:\cases\<case-id>\dns_exfil.pcapng`
2. Analyze DNS query patterns: `tshark -r C:\cases\<case-id>\dns_exfil.pcapng -Y 'dns.qry.name contains "<domain>.invalid"' -T fields -e frame.time -e dns.qry.name`
3. Examine subdomain labels for encoded data (long base64-like subdomains indicate tunneling): `tshark -r C:\cases\<case-id>\dns_exfil.pcapng -Y 'dns.qry.type == 16' -T fields -e dns.qry.name -e dns.txt`
4. Estimate exfiltration bandwidth by summing query-name lengths over time
5. Extract unique query names and decode base64 subdomains to recover exfiltrated content
6. Export evidence packets to a separate PCAP and `Get-FileHash` it for chain of custody

**Pitfalls**:
- Capturing unfiltered traffic on a busy network and running out of disk space before collecting relevant data
- Using display filters instead of capture filters, resulting in massive files that are slow to process
- Overlooking encrypted DNS (DoH/DoT) traffic that bypasses traditional DNS capture on port 53
- Failing to establish a capture-file hash and chain-of-custody documentation for forensic evidence

## Output Format

```
## Traffic Analysis Report

> **TEMPLATE ONLY:** The following is a fictional shape-only example. Replace every placeholder with values produced by the current capture; placeholders and labels must never appear in a real report.

**Case ID**: `<case-id>`
**Capture File**: `<capture-file>.pcapng`
**SHA-256**: `<sha256-of-source-capture>`
**Duration**: `<start-time>` to `<end-time>` `<timezone>`
**Source Interface**: `<interface-number>` (`<segment-description>`)

### Findings

**1. `<finding title: e.g. suspected DNS tunneling>`**
- Source: `<source-ip>`
- Destination DNS: `<resolver-ip>` (forwarded to `<nameserver>.invalid`)
- Query volume: <query-count> queries in `<duration>` (`<rate>` vs `<baseline>`)
- Average subdomain label length: `<N>` characters (`<encoding hypothesis>`)
- Estimated data exfiltrated: `<quantity and unit>` via `<record type>` responses

**2. Indicators of Compromise**
- Domain: `<domain>.invalid` (registration age: `<observed value or not available>`)
- Nameserver: `<nameserver>.invalid` (`<documentation-address>`)
- Query pattern: `<observed filter and pattern>`
- Response pattern: `<observed response pattern>`
```
## 使用步骤

> 面向 `.pcap/.pcapng` 案件的固定 SOP：证据固定 -> 总览协议分层 -> 过滤定位可疑协议 -> Follow Stream 还原会话 -> 载荷解码 -> 文件/凭据导出 -> 交叉印证。若与环境或命令路径冲突，保持原始检材只读，并将差异标记为待人工裁决。

### 1. 证据固定与案件初始化
- 原始流量包只读；禁止重命名、覆盖、截断、重新保存。
- 先计算哈希，再建立工作目录；导出、解码、报告均写入工作目录。
- 记录检材来源、采集接口、采集过滤器、时间范围、时区、提交人。

```powershell
Get-FileHash ./capture.pcapng -Algorithm SHA256 | Tee-Object ./reports/capture_hash.txt
```

- 若提供 `sslkeys.log`、`server.key`、密码本、Web 日志或主机镜像，分别哈希并登记用途。

### 2. 总览协议分层与可疑端点
- 先做协议分层与端点统计，再决定过滤器；不要直接全局搜索关键字。

```powershell
tshark -r ./capture.pcapng -q -z io,phs
tshark -r ./capture.pcapng -q -z conv,ip
tshark -r ./capture.pcapng -q -z endpoints,ip
```

- 重点观察：非常用端口承载 HTTP/TLS、DNS 查询量异常、ICMP 载荷过大、Telnet/FTP 明文、SMB 文件读写、单主机对外高频连接。

### 3. 协议分层定位：先过滤协议，再锁定流
- 按协议逐层排查，记录可疑会话的 `tcp.stream` 或 `udp.stream`。

```powershell
tshark -r ./capture.pcapng -Y 'http' -T fields -e frame.number -e ip.src -e ip.dst -e http.request.method -e http.host -e http.request.uri -e http.response.code
tshark -r ./capture.pcapng -Y 'dns' -T fields -e frame.number -e ip.src -e ip.dst -e dns.qry.name -e dns.resp.type
tshark -r ./capture.pcapng -Y 'ftp' -T fields -e frame.number -e ip.src -e ip.dst -e ftp.request.command -e ftp.request.arg -e ftp.response.code
tshark -r ./capture.pcapng -Y 'telnet' -T fields -e frame.number -e ip.src -e ip.dst -e tcp.stream
tshark -r ./capture.pcapng -Y 'icmp' -T fields -e frame.number -e ip.src -e ip.dst -e icmp.type -e icmp.code -e data.len
```

### 4. HTTP/HTTP 响应头分析
- 先还原请求与响应关键字段，再判断登录、上传、下载、Webshell、命令执行或 C2。

```powershell
tshark -r ./capture.pcapng -Y 'http.request' -T fields -e frame.number -e ip.src -e ip.dst -e http.request.method -e http.host -e http.request.uri -e http.user_agent -e http.cookie
tshark -r ./capture.pcapng -Y 'http.response' -T fields -e frame.number -e http.response.code -e http.content_type -e http.server -e http.content_length
```

- 常用攻击定位过滤：

```powershell
tshark -r ./capture.pcapng -Y 'http.request.method == "POST"'
tshark -r ./capture.pcapng -Y 'http.response.code != 404'
tshark -r ./capture.pcapng -Y 'http.user_agent contains "curl" or http.user_agent contains "Wget" or http.user_agent contains "python"'
```

- 使用 Follow HTTP Stream 还原完整请求体、响应体、上传文件名、响应头和回显内容：

```powershell
tshark -r ./capture.pcapng -q -z follow,http,ascii,0
```

- 判定规则：
  - `Authorization: Basic` 后为 Base64，解码后通常为 `user:password`。
  - 出现 `Content-Disposition: form-data`、上传文件名或响应中的脚本路径时，优先导出 HTTP 对象。
  - `Server`、`X-Powered-By`、`Set-Cookie`、`Location` 可识别框架、会话固定、重定向登录和后台路径。
  - 不能只凭 `eval`、`base64_decode`、`cmd`、`whoami` 定案；必须回到完整流确认请求参数、响应状态和后续行为。

### 5. DNS 分析

```powershell
tshark -r ./capture.pcapng -Y 'dns.flags.response == 0' -T fields -e frame.number -e ip.src -e dns.qry.name
tshark -r ./capture.pcapng -Y 'dns.qry.type == 16' -T fields -e dns.qry.name -e dns.txt
```

- DNS 隧道判定：
  - 子域名标签长度异常，常见超过 30~50 字符。
  - 字符集呈 Base32/Base64/Hex 特征，或末尾带固定分隔符、序号、`=` 填充。
  - 同一父域高频查询，TXT/NULL/CNAME 响应承载返回数据。
- 还原顺序：按时间或序号提取子域名标签，剥离父域与协议前缀，依次尝试 Base64、Base32、Hex；乱序时优先查找标签内序号字段。

### 6. FTP 分析

```powershell
tshark -r ./capture.pcapng -Y 'ftp.request.command == "USER" or ftp.request.command == "PASS"' -T fields -e ip.src -e ftp.request.command -e ftp.request.arg
tshark -r ./capture.pcapng -Y 'ftp.request.command == "RETR" or ftp.request.command == "STOR"' -T fields -e ftp.request.arg
```

- 关注 `230` 登录成功、`226` 传输完成、`550` 文件不存在；被动模式需同时追踪控制连接和数据连接。
- 文件传输不完整时，不直接判定文件损坏；先检查重传、乱序、端口协商失败或捕获截断。

### 7. Telnet 分析

```powershell
tshark -r ./capture.pcapng -Y 'telnet' -T fields -e frame.number -e ip.src -e ip.dst -e tcp.stream
tshark -r ./capture.pcapng -q -z follow,tcp,ascii,<stream>
```

- Telnet 会话常包含明文账号、密码、命令和回显；注意 IAC 控制字节、终端换行、回显延迟可能导致密码显示不完整。
- ASCII 视图控制字符过多时改用 hex 视图，剥离 `0xff` 开头的 IAC 序列后再还原命令。

### 8. ICMP 与隐蔽信道分析

```powershell
tshark -r ./capture.pcapng -Y 'icmp.type == 8 or icmp.type == 0' -T fields -e frame.number -e ip.src -e ip.dst -e icmp.seq -e data.len
```

- 异常特征：
  - Echo Request/Reply 载荷长度固定且明显大于常规 ping。
  - 载荷包含可见 ASCII、Base64、Hex 或重复模式。
  - 数据只出现在 Request 或 Reply 单方向。
- 还原方法：编写或使用 scapy 解析器，按 `icmp.seq` 或时间排序，提取 payload 后拼接首字符/可见字符串，再做编码还原。

```python
from scapy.all import PcapReader, ICMP
for p in PcapReader(path):
    if ICMP in p and p[ICMP].type in (8, 0):
        print(p[ICMP].seq, bytes(p[ICMP].payload))
```

### 9. TLS/HTTPS 分析
- 无密钥时不得臆测明文内容；先分析 SNI、证书、ALPN、连接时序、字节长度和会话间隔。

```powershell
tshark -r ./capture.pcapng -Y 'tls.handshake.type == 1' -T fields -e ip.src -e ip.dst -e tls.handshake.extensions_server_name
tshark -r ./capture.pcapng -Y 'tls.handshake.type == 11' -T fields -e x509sat.uTF8String -e x509ce.dNSName
```

- 有 `sslkeys.log` 时：

```powershell
tshark -r ./capture.pcapng -o tls.keylog_file:./sslkeys.log -Y 'http or http2'
```

- 有服务器 RSA 私钥且会话使用非前向保密套件时：

```powershell
tshark -r ./capture.pcapng -o tls.keys_list:<server-ip>,443,http,./server.key -Y 'http'
```

- 解密成功后，按 HTTP 流程继续分析请求、响应、上传/下载和编码载荷。

### 10. 载荷解码与编码/加密还原判定
- 按“协议层 -> 编码层 -> 加密层”处理，避免直接暴力破解。
- 常见判定规则：
  - URL Encoding：出现 `%xx`，优先解码 URI、POST 参数和 Cookie。
  - Base64：A-Z/a-z/0-9、`+`、`/`，长度接近 4 的倍数，可能带 `=`；常见于 Authorization、DNS 标签、HTTP body、ICMP payload。
  - Hex：连续 `0-9a-fA-F` 且长度为偶数；常见于密钥、shellcode、文件片段。
  - XOR：有已知明文、文件头或题目密钥（如 `EDU`、`key`、`secret`）时优先尝试；未知密钥可通过重复模式、已知文件头异或推断密钥长度。
  - gzip/deflate：出现 `1f 8b`、`78 9c` 等魔数；HTTP 压缩响应先解压再分析。
- 推荐判定顺序：
  1. 查文件头和协议头：PNG、JPEG、ZIP、PDF、MZ、ELF。
  2. 查文本结构：JSON、HTML、SQL、命令、账号密码。
  3. 查高熵数据：加密、压缩、随机化载荷。
  4. 解码后仍高熵时，考虑多层编码、异或或自定义加密。

### 11. 文件导出与离线检验

```powershell
tshark -r ./capture.pcapng --export-objects http,./exports/http
tshark -r ./capture.pcapng --export-objects smb,./exports/smb
```

- 每个导出文件记录来源帧号、协议、流编号，并计算 SHA-256。
- 对导出文件做文件头检查、字符串提取、熵分析、压缩包结构检查、伪加密识别和隐写线索排查。
- 导出失败时回到原始流检查重传、分片、TLS 未解密、协议解析错误或捕获截断。

### 12. 交叉印证与结论输出
- 将流量中的源/目的 IP、时间戳、URI、文件名、哈希、账号与 Web 日志、系统日志、镜像取证、数据库记录交叉比对。
- 最小证据链包含：攻击者 IP、受害者 IP、首次异常时间、协议、关键载荷、解码结果、文件哈希、凭据类型和影响范围。
- 无法完全还原时明确限制条件，例如缺少 TLS 密钥、捕获截断、载荷加密或协议私有化。

## 输入输出说明

> 本章定义流量分析任务的输入边界、输出物和证据要求。所有输出必须能回溯到原始帧号、流编号、过滤器或导出文件；不能只给结论。

### 输入要求

| 输入类型 | 是否必需 | 说明 | 质量与陷阱 |
|---|---|---|---|
| `.pcap` / `.pcapng` / `.cap` | 必需 | 原始网络流量检材 | 必须先哈希固定；分片、截断、乱序、重传会影响还原 |
| 采集元数据 | 强烈建议 | 采集时间、时区、接口、捕获过滤器、网络段、镜像端口 | 缺时区会导致时间线错位；捕获过滤器可能导致关键流量缺失 |
| TLS 解密材料 | 视场景 | `sslkeys.log`、服务器私钥、主密钥、会话密钥 | 无密钥只能做元数据分析；私钥仅对非前向保密 RSA 套件有效 |
| 辅助日志 | 建议 | Web 访问日志、系统安全日志、DNS 日志、代理日志 | 用于交叉印证流量中的 IP、URI、时间和账号 |
| 已知样本/文件 | 建议 | 导出文件、webshell、脚本、压缩包、密码本 | 需要提供来源帧号或哈希，避免污染证据链 |
| 任务问题 | 必需 | 要查找的 IOC、凭据、文件、攻击路径或时间线 | 问题不清会导致过滤器过宽或结论发散 |

### 输入处理原则
- 原始检材只读：分析、导出、解码均不得写回原始文件。
- 多检材编号：为每个输入文件建立 `evidence_id`，记录哈希、来源、用途和输出引用。
- 加密流量：有密钥先验证密钥格式和协议版本；无密钥时输出“加密不可还原”的限制。
- 大文件：先做协议统计和抽样过滤，再对可疑流做深度重组，避免一次性全量导出。
- 编码载荷：先记录原始帧号和十六进制片段，再输出解码结果，确保可复核。

### 输出要求

| 输出类型 | 内容 | 推荐格式 | 证据字段 |
|---|---|---|---|
| 分析报告 | 案件信息、发现、攻击路径、限制条件 | Markdown | 帧号、流编号、过滤器、哈希 |
| 结构化指标 | 可疑连接、请求、响应、凭据、文件 | CSV / JSON | `frame.number`、`tcp.stream`、`ip.src`、`ip.dst`、`http.host`、`http.request.uri`、`http.response.code` |
| 导出对象 | HTTP/SMB/FTP 文件、证书、载荷片段 | 文件目录 | 来源协议、流编号、SHA-256 |
| IOC 列表 | IP、域名、URL、UA、文件哈希、证书指纹 | TXT / CSV | 首次/末次出现时间、出现次数 |
| 凭据结果 | 明文账号、Basic Auth、FTP/Telnet 凭据、NTLMv2 哈希 | 受控文本 | 协议、帧号、来源流、脱敏策略 |
| 时间线 | 首次异常、登录、上传、下载、外传、清理 | Markdown / CSV | UTC/本地时间、时区、事件类型 |

### 输出字段建议
- 基础字段：`case_id`、`evidence_id`、`frame_number`、`frame_time`、`ip.src`、`ip.dst`、`protocol`、`stream_id`。
- HTTP 字段：`http.request.method`、`http.host`、`http.request.uri`、`http.response.code`、`http.user_agent`、`http.content_type`。
- DNS 字段：`dns.qry.name`、`dns.qry.type`、`dns.resp.type`、`dns.txt`。
- 文件字段：`filename`、`file_size`、`sha256`、`source_protocol`、`export_path`。
- 解码字段：`original_encoding`、`decoded_preview`、`decoded_sha256`、`decoder_command`。

### 敏感信息与证据链
- 凭据、Cookie、私钥、个人身份信息只能写入受控证据目录，报告中默认脱敏。
- 每个导出文件必须能回答：从哪个帧/流导出、使用什么过滤器、是否经过解码、解码命令是什么。
- 最终报告应包含原始检材哈希、导出对象哈希、关键命令、过滤器、时间范围和未解决问题。
- 输入不足（如缺少密钥、日志或完整捕获）时，输出必须写明不能验证的部分，而不是给出推测性结论。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
