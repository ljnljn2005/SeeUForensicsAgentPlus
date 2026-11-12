---
name: ransom-rc4-memkey
summary: Recover an RC4 key from a Windows memory dump via sentinel bytes and decrypt a custom ransomware ".enc" container (magic + LE size + RC4 ciphertext). For CTF/ransomware memory forensics.
description: Use when a challenge gives a Windows memory dump (raw/vmem/dmp) plus an encrypted file (often .enc/.locked) from a ransomware sample, and asks to recover the symmetric key from RAM and decrypt the file. Covers recognizing the custom container format, locating the key in memory using fixed sentinels, and RC4 decryption with pycryptodome.
---

# ransom-rc4-memkey — RC4 key recovery from memory dumps

## When to use
- A CTF/malware challenge provides a Windows memory dump AND an encrypted artifact (`.enc`, `.locked`, etc.).
- You must recover the symmetric key from RAM (not crack a password) and decrypt the file.
- Ciphertext entropy is ~5–6 (low-entropy plaintext encrypted with a stream cipher) rather than ~8.

## Do NOT assume AES + IV
Common wrong turn: assuming AES-256-CBC with a 16-byte IV at offset 8. Many custom ransomwares use **RC4** (a stream cipher) with **no IV**. Verify before burning time on IV/keyfile hunts.

## Custom container format (typical)
```
offset 0x00 : 4-byte magic, e.g. "RNSM"
offset 0x04 : 4-byte original file size, LITTLE-ENDIAN
offset 0x08 : RC4 ciphertext (starts immediately; NO IV)
```
- A "first N bytes magic" question may include the low byte of the size field (e.g. `RNSMa` where `0x61` is the size LSB). Read the magic literally but mind the question wording.
- Original size = `int.from_bytes(data[4:8], "little")`.

## Key layout in memory (sentinel-wrapped)
The key is often stored as a fixed-size struct wrapped by magic sentinels so it survives reboots in RAM until reboot:
```
+0x00 : 0xDEADC0DE  (4 bytes; little-endian memory bytes DE C0 AD DE)
+0x04 : RC4 key     (16 bytes typical; or 32 — read the code)
+0x14 : 0xCAFEBABE  (4 bytes; memory bytes BE BA FE CA)
```
Total in example = 24 bytes.

### Locate it in the dump
```python
SENT_PRE  = b"\xde\xc0\xad\xde"
SENT_POST = b"\xbe\xba\xfe\xca"
with open(DMP, "rb") as f:
    prev = b""
    while chunk := f.read(64*1024*1024):
        buf = prev + chunk
        i = 0
        while (i := buf.find(SENT_PRE, i)) >= 0:
            if buf[i+20:i+24] == SENT_POST:
                key = buf[i+4:i+20]      # 16 bytes between sentinels
                print("key @", hex(base+i), key.hex())
            i += 1
        prev = chunk[-24:]
        base += len(chunk)
```

## Decrypt (pycryptodome)
```python
from Crypto.Cipher import ARC4
data = open(ENC, "rb").read()
size = int.from_bytes(data[4:8], "little")   # sanity check
pt   = ARC4.new(KEY).decrypt(data[8:])         # RC4, ciphertext from offset 8
open("out.bin", "wb").write(pt[:size])         # trim to declared size
```
- A `.docx`/`.zip` result starts with `PK\x03\x04`. The flag is usually inside `word/document.xml` but **split across `<w:t>` runs** — strip XML tags (`re.sub(r'<[^>]+>','',xml)`) before regex-matching `flag\{[^}]+\}`.

## Key length & generation API
- Key length is whatever the sample calls `CryptGenRandom(hProv, dwLen, pbBuffer)` with. `dwLen=0x10` → 16 bytes. Read the sample (IDA/jadx strings + xrefs) to confirm; do not guess.
- The CryptoAPI function that fills the random key is `CryptGenRandom` (lowercase in answers). `CryptGenKey` is for generating key *pairs/objects*, not raw random bytes.

## Memory text tips (Windows)
- Chinese text is stored **UTF-16LE**. To grep the dump: `kw.encode("utf-16-le")` — never a `b"中文"` literal (SyntaxError / wrong bytes).
- Extract a region for eyeballing: `open(DMP).seek(off); data=f.read(n); data.decode("utf-16-le","ignore")`.

## Verification checklist
1. Decrypted bytes start with expected magic (`PK\x03\x04` for Office/zip).
2. Decrypted length == declared size field.
3. Flag regex matches after stripping XML/format tags.
4. Memory sentinel hit recovers the EXACT key used to decrypt (`match=True`).

## 使用步骤

### 1. 检材接入与基线固定
- 将内存镜像、加密容器、样本、磁盘镜像、流量包统一放入只读目录，计算 SHA256，记录文件大小、采集时间、来源。
- 用 file、strings、Volatility 3 的 windows.info 或 Volatility 2 的 imageinfo/kdbgscan 确认系统版本、架构、建议 profile。
- 建立案件目标：恢复 RC4 密钥、解密 .enc、确认加密进程与密钥驻留位置。

### 2. 确认加密容器格式
- 检查加密文件前 16 字节，确认 4 字节 magic、4 字节小端长度、后续密文。
- 若 magic 为 RNSM，读取 original_size = int.from_bytes(data[4:8], 'little')。
- 不要默认 AES-CBC 或 16 字节 IV；本场景优先验证 RC4 无 IV 假设。
- 记录熵值：密文段通常高熵，但若明文本身低熵，整体熵可能只有 5～6。

### 3. 内存侧进程、网络与注入分析
- 运行 pslist、pstree、psxview、cmdline、envars、sessions，定位可疑进程、异常父进程、临时目录启动、异常命令行。
- 运行 netscan 或 netscan --profile，关注 SYN_SENT、ESTABLISHED、异常外联端口、反向 shell、命名管道。
- 对可疑进程运行 malfind、memmap、procdump，检查 RWX 私有页、注入代码、隐藏配置。
- 若存在流量包：按协议过滤 HTTP、DNS、FTP、ICMP、Telnet；追踪可疑会话，导出文件、凭据、请求体；将 C2 地址、User-Agent、DNS 隧道、ICMP payload 与内存中的进程命令行、网络连接、配置字符串互证。

### 4. 定位 sentinel 包裹的 RC4 密钥
- 在全镜像中搜索前置哨兵 DE C0 AD DE 与后置哨兵 BE BA FE CA。
- 使用分块扫描时保留上一块尾部 24 字节，避免跨块漏检。
- 命中后提取两个哨兵之间的字节作为候选 key；典型长度为 16 字节，也可能是 32 字节，需结合样本或哨兵间距确认。
- 对每个候选 key 记录 offset、key_hex、key_len、post_sentinel_ok、命中进程或内存区域。

### 5. 解密与结果验证
- 使用 ARC4/RC4 从偏移 8 开始解密，不添加 IV。
- 按容器声明长度截断输出，避免尾部填充或噪声干扰。
- 验证解密结果：文件头是否为 PK、MZ、PDF、JPEG 等预期魔数；长度是否等于 original_size；内容是否可被对应解析器打开。
- 若输出为 docx/zip，解压后检查 word/document.xml；flag 可能被拆分在多个 w:t 标签中，先去除 XML 标签再匹配。

### 6. 多候选密钥与误报消除
- 若命中多个哨兵结构，不要直接采信第一个；逐一解密并比较文件头、长度、熵和可读内容。
- 若密钥候选解密失败，回到进程内存区域、样本字符串、C2 配置、CryptGenRandom 调用长度重新确认。
- 对可疑进程做 procdump 后，在进程地址空间内二次搜索密钥，可提高归属判断。

### 7. 与磁盘、流量、时间线闭环
- 联合磁盘证据检查下载记录、浏览器历史、最近文件、.lnk、注册表、日志，确认加密文件来源和执行链。
- 对注册表 RecentDocs 的最后写入时间保持谨慎，应结合 .lnk、文件时间戳、USN/Journal 或日志交叉验证。
- 使用时间线验证：进程创建时间、文件加密时间、外联时间、密钥驻留时间应能形成连续闭环。
- 最终输出前复现一次关键命令：密钥 offset、解密脚本、文件头校验、flag 提取。

## 输入输出说明

### 输入
- 内存镜像：raw、vmem、dmp、limemem；记录 SHA256、大小、采集时间、来源主机。
- 加密容器：.enc、.locked 等；记录文件名、大小、magic、original_size、密文起始偏移。
- 可选样本：勒索程序、脚本、打包文件；用于确认密钥长度、CryptGenRandom 调用、加密逻辑。
- 可选磁盘镜像/流量包/日志：用于交叉验证执行链、C2、下载、访问痕迹。

### 中间输出
- 进程证据：PID、PPID、进程名、完整路径、命令行、会话、启动时间、退出时间。
- 网络证据：协议、本地地址、远端地址、端口、状态、关联 PID、创建时间。
- 注入证据：进程 PID、内存区域、保护属性、RWX 标记、malfind 命中、dump 路径。
- 密钥候选：内存偏移、前置哨兵、候选 key、后置哨兵、key_len、是否通过解密验证、置信度。
- 解密产物：输出文件路径、解密长度、文件头、SHA256、是否匹配 original_size、是否提取到 flag。

### 最终输出字段
建议以表格或 JSON 呈现：
- case_id、image_sha256、os_profile、tool_version
- suspicious_pid、suspicious_process、process_path
- key_offset、key_hex、key_len、sentinel_pre、sentinel_post
- enc_file、enc_magic、declared_size、cipher_offset
- decrypted_file、decrypted_magic、decrypted_sha256、flag
- timeline：进程创建、文件写入、外联连接、密钥命中时间
- confidence：high/medium/low，并说明依据

### 最终答案呈现要求
- 若题目要求进程 PID，输出可疑加密进程 PID 与进程名。
- 若要求密钥，输出十六进制小写，并注明长度。
- 若要求时间，统一 UTC 或本地时区，并注明来源字段。
- 若要求访问次数，需说明统计口径：最近文件、.lnk、注册表、日志或内存命中次数；无法确定时写 N/A，不要猜测。

### 边界与异常
- 镜像分页或缺页：标记 key_not_found 或 partial_memory，并给出已扫描范围。
- 多个候选 key：输出全部候选，并标记哪一个通过解密验证。
- 无法解密：输出失败原因，例如 magic 不符、长度异常、密钥长度不匹配、疑似非 RC4。

## D3-01

### 章节目标
D3-01 用于约束内存取证结论必须经过同主题证据交叉比对，避免仅凭单一插件输出或单个内存字符串下结论。本技能的核心闭环是：内存镜像 → 可疑进程/网络 → 密钥候选 → 解密验证 → 磁盘/流量/时间线互证。

### 交叉验证矩阵
- 内存进程证据：确认哪个进程持有密钥、创建加密文件或发起外联。
- 内存密钥证据：哨兵结构、进程私有内存、字符串搜索、配置块。
- 文件证据：加密容器 magic、长度、密文偏移、解密后的文件头和内容。
- 流量证据：HTTP、DNS、FTP、ICMP、Telnet 或隐蔽通道中的 C2、下载、凭据、回传文件。
- 磁盘证据：样本落盘路径、下载记录、浏览器历史、.lnk、注册表、日志。
- 时间线证据：进程创建、文件修改、网络连接、注册表更新、日志记录应相互吻合。

### 必做步骤
1. 固定检材：计算镜像和加密文件哈希，记录系统版本、主机名、用户、启动时间。
2. 进程与网络互证：用 pslist、pstree、cmdline、netscan 找到可疑进程，并检查其外联地址与端口。
3. 内存区域互证：对可疑进程执行 malfind、memmap、procdump，确认密钥是否位于该进程私有内存或相关内存区域。
4. 密钥候选验证：所有哨兵命中都必须经过解密验证；不能仅因格式匹配就认定为最终密钥。
5. 解密结果验证：检查文件头、长度、熵、可解析性；若为 Office/ZIP，需进一步解包并提取内容。
6. 磁盘与流量互证：若有磁盘或流量，确认样本来源、C2 地址、文件下载、密钥传输或加密文件回传。
7. 时间线闭环：将进程创建、文件加密、外联、日志时间合并成一条时间线，排除历史痕迹和误报。
8. 可复现实验：保留命令、插件版本、偏移、哈希和脚本，确保复核人员可重复得到相同结论。

### 置信度判定
- 高置信：密钥可成功解密，且进程、内存偏移、文件头、时间线至少三项互相印证。
- 中置信：密钥可解密，但缺少进程归属或时间线证据。
- 低置信：仅发现格式相似候选，无法解密，或存在多个未排除候选。

### 常见误判与规避
- 将注册表 RecentDocs 最后修改时间当作文件真实访问时间；应结合 .lnk、文件时间戳、日志。
- 将多个哨兵命中全部当作有效密钥；必须逐一解密验证。
- 将 AES/IV 模型套用到 RC4 自定义容器；先验证密文起始偏移和文件头。
- 忽略 UTF-16LE 编码；中文关键词需按 UTF-16LE 编码搜索。
- 只报告插件输出，不做解密复现；最终结论必须包含可复现验证命令或脚本。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
