---
name: cracking-password-protected-documents
description: "Recover the password of encrypted / password-protected Office documents — Word, Excel, PowerPoint (.docx / .doc / .xlsx / .xls / .pptx / .ppt) — and other encrypted files (.zip / .rar / .7z / .pdf). Extracts a crackable hash with office2john and cracks it with John the Ripper (default, CPU) or hashcat (when a GPU is present) using a bundled wordlist plus mask fallback. Use for ANY task where a document/archive is locked, encrypted, asks for a password, cannot be opened, or where you must recover / crack / brute-force / find the password of an Office file, ZIP, RAR, 7z or PDF — including CTF and forensic password-recovery questions."
version: '1.0'
author: honglian
domain: cybersecurity
subdomain: digital-forensics
tags:
- password-cracking
- office
- john-the-ripper
- hashcat
- office2john
- encrypted-documents
- zip
- rar
- pdf
license: Apache-2.0
---

# Cracking Password-Protected Documents

Recover the password of an **encrypted Office document** (Word / Excel / PowerPoint) so its contents can be
examined, and — with the same pipeline — of encrypted **ZIP / RAR / 7z / PDF** files. Applies to forensic
password recovery and to CTF challenges that hand you a locked file.

**Methodology: extract, then exhaust.** A modern Office file stores a *verifier hash* derived from the
password; you cannot reverse it, but you can hash-and-compare candidate passwords until one matches. The whole
job is two moves — (1) pull the crackable hash out of the file with `office2john`, (2) run a wordlist / mask
attack over it with John the Ripper or hashcat. The tools just package that loop; do not hand-roll a Python
brute-forcer or give up because a tool "looks unavailable" before you have run the self-check below.

## Runtime Environment (Important)

This application runs on **Windows**; the `exec` tool uses **PowerShell** syntax.

- The engines are **`john`** (John the Ripper *jumbo*, the default), **`hashcat`** (used only when a GPU is
  present), and **`office2john`** (a Python script that ships inside the John *jumbo* `run/` directory — there
  is **no `.exe` wrapper** for it). A tool invocation itself is platform-neutral (`john --format=office <hash>`
  is the same everywhere); only loops / pipes / redirection follow PowerShell.
- **Self-check before you start.** On this product `exec` prepends the app's `tools\` directory (and each of its
  first-level subdirectories) to PATH, so `john` and `hashcat` resolve by bare name whenever they are bundled —
  even if a bare shell would not find them:
  ```powershell
  Get-Command john -ErrorAction SilentlyContinue     # John the Ripper jumbo binary (required)
  Get-Command uv   -ErrorAction SilentlyContinue     # Python runner for office2john.py (required)
  Get-Command hashcat -ErrorAction SilentlyContinue  # optional GPU cracker
  ```
  If **`john` or `uv` is genuinely missing** (`Get-Command` returns nothing), the cracking environment is **not
  ready** — report *"password-cracking environment is not ready (john/uv not on PATH)"* and stop. **Do not** fall
  back to Linux commands (`sha256sum`, `hashcat.bin`, `/tmp/...`) or silently pretend the file is unbreakable.
- **`office2john` is a `.py`, not an exe — locate it via `john`.** PATH only resolves the exe. Find the John
  directory from `john.exe`, then run the script with `uv` (bundled, on PATH). `office2john` is essentially
  stdlib, so `uv run` needs no network — but offline it still needs a Python interpreter (the app ships one that
  `uv` finds); if `uv` is somehow unavailable yet a system `python` exists, `python "$johnDir\office2john.py"`
  works too:
  ```powershell
  $johnDir = Split-Path (Get-Command john).Source     # ...\tools\john
  uv run "$johnDir\office2john.py" .\secret.docx
  ```
- **Use a large timeout for cracking.** A wordlist or mask run can take many minutes — pass a large `exec`
  timeout (e.g. `600000` ms). The default 30 s will kill the crack mid-run and lose progress.

> ⚠️ **Forensic integrity**: hash the original document first (`Get-FileHash`), then read it **in place** (office2john
> never writes to the document — no copy needed), and write every artifact (`.hash` files, potfiles, cracked output)
> into your firmament **workspace** directory — never into the source evidence directory. Never modify the evidence
> original.

## When to Use

- A Word / Excel / PowerPoint file (`.docx .doc .xlsx .xls .pptx .ppt`) is password-protected / encrypted and
  you must recover the password to read it.
- Any file asks for a password, "cannot be opened", or is reported as encrypted — including `.zip .rar .7z .pdf`.
- A forensic case or CTF task asks you to **crack / recover / brute-force / find** a document or archive password.

**Out of scope:** encrypted **iTunes/Finder** backup `Manifest.plist` / `BackupKeyBag` → use skill
`itunes-backup-password-recover` (not office2john / this pipeline).

## Workflow

The examples use a placeholder case directory `C:\cases\case-01` and write `.hash` files into it. **On this
product, substitute your firmament workspace directory** (a `scratch/` subfolder is ideal for the intermediate
`.hash` / potfiles). Treat the source document as read-only evidence.

### Step 0: Forensic integrity

```powershell
Get-FileHash .\secret.docx -Algorithm SHA256   # record the original hash
```

office2john only **reads** the document, and john/hashcat crack the extracted `.hash` file — never the doc itself — so
analyze the original **in place**; there is no need to copy it. Write the `.hash`, potfiles, and cracked output into your
workspace (a `scratch\` subfolder).

### Step 1: Extract the hash with office2john

`office2john` reads the encrypted document and prints a crackable hash line of the form
`secret.docx:$office$*2013$*...`. Locate the script via `john`, then run it with `uv`:

```powershell
$johnDir = Split-Path (Get-Command john).Source
$doc     = '.\secret.docx'                          # the original evidence, read in place

# Full line (filename:hash) — John the Ripper consumes this as-is:
uv run "$johnDir\office2john.py" $doc | Set-Content C:\cases\case-01\secret.hash
Get-Content C:\cases\case-01\secret.hash
```

If office2john prints nothing / errors that the file is not encrypted, the document is **not** password-protected
— open it directly. If it reports a missing dependency (rare — it is essentially stdlib; legacy OLE `.doc`/`.xls`
can want `olefile`), retry with `uv run --with <dep> "$johnDir\office2john.py" $doc` — which only succeeds if that
dep is already cached offline.

If office2john dies with **`AttributeError: 'ElementTree' object has no attribute 'getiterator'`** (or
`getchildren`), that is a **Python 3.9+ incompatibility** in this 2019 script — `uv` provisions modern Python
(3.13), which removed those ElementTree methods; the `getiterator` one is on the Office **2013+** (agile) parsing
path, so it hits the most common case. The shipped bundle should already carry the patch; if this copy does not,
self-recover: copy the script into `scratch\`, replace `getiterator(` → `iter(` (and any `getchildren(x)` →
`list(x)`), and run the patched copy:

```powershell
$fix = 'C:\cases\case-01\office2john.py'
Copy-Item "$johnDir\office2john.py" $fix
(Get-Content $fix) -replace '\.getiterator\(', '.iter(' | Set-Content $fix
uv run $fix $doc
```

### Step 2: Pick the cracker — probe for a *discrete* GPU

Default to **john** (CPU, rock-solid). Switch to **hashcat** only when the machine has a **discrete** GPU
(NVIDIA, AMD Radeon RX, Intel Arc) — that is where hashcat's big speed-up comes from. An **integrated** GPU
(Intel HD / UHD / Iris, or an AMD APU's built-in Radeon) is barely faster than the CPU for the slow Office KDFs
and can be flaky, so **treat an iGPU like no GPU and stay on john.**

> ⚠️ **hashcat must run from its own install directory.** It resolves `OpenCL\` / `kernels\` / `modules\`
> **relative to the current directory** (not to the .exe), with no override flag — run it from anywhere else and
> even `hashcat -I` dies with `./OpenCL/: No such file or directory`. So for **every** hashcat call (probe,
> crack, mask): `cd` into its folder (located via `hashcat` on PATH) and pass **absolute** hash / wordlist /
> potfile paths.

Probe, and classify discrete-vs-integrated automatically:

```powershell
$hcDir = Split-Path (Get-Command hashcat).Source        # ...\tools\hashcat
$info  = & { Push-Location $hcDir; try { hashcat -I 2>&1 } finally { Pop-Location } } | Out-String
$info   # also read the full device inventory yourself

# Discrete GPU if EITHER a CUDA/HIP backend block is present (those backends only target discrete NVIDIA/AMD),
# OR a GPU device reports dedicated VRAM (Memory.Unified: 0). Integrated GPUs report Memory.Unified: 1.
$discrete = ($info -match '(?m)^\s*(CUDA|HIP)\s+Info:') -or ($info -match 'Memory\.Unified.*?:\s*0')
if ($discrete) { 'discrete GPU -> hashcat (Step 3b)' } else { 'integrated / CPU only -> john (Step 3a)' }
```

- **`discrete GPU`** → **hashcat** (Step 3b, orders of magnitude faster). If the box has *both* a discrete GPU and
  an iGPU, hashcat uses all GPU devices by default; to pin the fast one, read its `Backend Device ID` from the
  `-I` output and add `-d <id>`.
- **otherwise** (only an iGPU, only a CPU device, or `No devices found`) → **john** (Step 3a). This is the normal
  offline-forensics path; no discrete GPU is required to proceed.

### Step 3a: Crack with John the Ripper (default, CPU)

`--format=office` auto-detects the 2007 / 2010 / 2013+ agile variants; for legacy 97–2003 files use
`--format=oldoffice`.

```powershell
# Re-derive $johnDir here — each exec runs in a fresh PowerShell, so variables do not carry across steps.
$johnDir  = Split-Path (Get-Command john).Source                       # ...\tools\john
# Bundled curated wordlist sits at tools\wordlists\forensic.txt — ONE level up from tools\john:
$wordlist = Join-Path (Split-Path $johnDir) 'wordlists\forensic.txt'
$johnList = Join-Path $johnDir 'password.lst'                          # John's own bundled list (next to john.exe)
if (-not (Test-Path $wordlist)) { $wordlist = $johnList }              # fall back to John's list if the curated one is absent
$pot = 'C:\cases\case-01\john.pot'                                     # keep the potfile in the workspace, not next to the binary

john --format=office --pot=$pot --wordlist=$wordlist C:\cases\case-01\secret.hash
john --format=office --pot=$pot --wordlist=$johnList C:\cases\case-01\secret.hash   # also try John's built-in list

# Retrieve the recovered password (John caches cracked results in the potfile above):
john --show --format=office --pot=$pot C:\cases\case-01\secret.hash
```

### Step 3b: Crack with hashcat (when a GPU is present)

hashcat wants **only the hash** (`$office$...`), not the `filename:` prefix — strip it. Choose `-m` by the hash
prefix that office2john emitted:

```powershell
# strip the "filename:" prefix that office2john adds — hashcat wants only the $office$... hash.
# Cut everything before the first "$" (robust even if the label contains a drive-letter colon):
(Get-Content C:\cases\case-01\secret.hash) -replace '^.*?(?=\$)', '' | Set-Content C:\cases\case-01\secret.hc

$johnDir  = Split-Path (Get-Command john).Source
$wordlist = Join-Path (Split-Path $johnDir) 'wordlists\forensic.txt'
if (-not (Test-Path $wordlist)) { $wordlist = Join-Path $johnDir 'password.lst' }

# hashcat runs from its own dir (see Step 2). Every file is ABSOLUTE, so cwd = $hcDir does not break them.
$hcDir = Split-Path (Get-Command hashcat).Source
$hash  = 'C:\cases\case-01\secret.hc'
$pot   = 'C:\cases\case-01\hashcat.potfile'   # absolute — potfile stays in the workspace
Push-Location $hcDir
try {
  hashcat -m 9600 -a 0 --potfile-path=$pot $hash $wordlist   # -a 0 = wordlist attack (add --force if it rejects a CPU-only device)
  hashcat -m 9600 --show --potfile-path=$pot $hash           # print the cracked password
} finally { Pop-Location }
```

| office2john hash prefix | Office version | hashcat `-m` |
|---|---|---|
| `$office$*2007$` | 2007 | 9400 |
| `$office$*2010$` | 2010 | 9500 |
| `$office$*2013$` (also 2016 / 2019 / 365, agile) | 2013+ | 9600 |
| `$oldoffice$*0$` / `*1$` | 97–2003 (MD5 + RC4) | **9700** (9710/9720 = collider variants, not plain recovery) |
| `$oldoffice$*3$` / `*4$` | 97–2003 (SHA1 + RC4) | **9800** (9810/9820 = collider variants, not plain recovery) |

(John's `--format=office` / `--format=oldoffice` does this selection for you; the table only matters on the
hashcat path.)

### Step 4: When the plain wordlist misses — climb the escalation ladder

**You do not need to know the password's format up front — do not try to.** Real passwords are not uniformly
distributed; they cluster in dictionary words, dates, names+digits and common patterns. So when the format is
unknown (the normal forensic case) the winning move is not "pick digits vs letters vs a mask" — it is to run this
ladder **top-down and stop on the first hit**. Rules (Rung 1) and incremental / Markov (Rung 3) order the whole
space by real-world frequency for you, spanning every length and character class automatically; only reach for a
hand-built mask when the case hands you a structural lead (Rung 0) — guessing a mask with no lead is just a
slower brute force.

Steps 3a/3b ran the **plain** `tools\wordlists\forensic.txt` (~80k common passwords, pinyin, dates) and John's
`password.lst`. When those miss, do **not** jump straight to a naked `?a` brute force — it is hopeless against
the slow Office KDF (2013+ runs SHA-512 ×100k iterations, so a CPU manages only hundreds–a few thousand
guesses/s; `?a?a?a?a?a?a?a?a` = 95⁸ ≈ 6.6×10¹⁵ would take millennia). Instead climb this ladder — **cheapest /
highest-hit first**. Everything below is **already bundled** (`john.conf` rule + incremental sections, the `.chr`
stat files, `hashcat\rules\`, `hashcat\masks\`); no extra downloads. Re-derive `$johnDir` / `$wordlist` / `$pot`
in each `exec` (fresh PowerShell — variables do not carry across calls).

**Rung 0 — Targeted candidates from the case (forensics' biggest edge; try FIRST).** A real suspect's password
is usually *their own* data: phone number, birthday (`YYYYMMDD` / `YYMMDD`), name pinyin, a company name, or a
password already recovered from another artifact in the case. Build a tiny list from those known facts (or a
narrow mask — e.g. the exact 11-digit phone) and run it before anything generic. A **known** phone number is one
candidate, not a 1.8-billion keyspace.

```powershell
$pot = 'C:\cases\case-01\john.pot'
Set-Content C:\cases\case-01\leads.txt @('13800138000','19900101','zhangsan','ZhangSan1990')  # case-specific facts
john --format=office --pot=$pot --wordlist=C:\cases\case-01\leads.txt C:\cases\case-01\secret.hash
```

**Rung 1 — Rule mutation (the single biggest lever, and it was missing).** Rules turn each dictionary word into
human-style variants (`password`→`Password1`, `p@ssw0rd`, `password2024`). This is exactly what catches "a word
that is *close to* the dictionary but not literally in it" — the common reason a crack stalls. Run cheap → broad:

```powershell
$johnDir  = Split-Path (Get-Command john).Source
$wordlist = Join-Path (Split-Path $johnDir) 'wordlists\forensic.txt'
$pot      = 'C:\cases\case-01\john.pot'
john --format=office --pot=$pot --wordlist=$wordlist --rules=best64 C:\cases\case-01\secret.hash  # fast: top mutations
john --format=office --pot=$pot --wordlist=$wordlist --rules=Jumbo  C:\cases\case-01\secret.hash  # much broader (slower)
```
hashcat path (discrete GPU), run from `$hcDir` with absolute paths (Step 2):
`hashcat -m 9600 -a 0 <abs .hc> <abs wordlist> -r rules\best66.rule` then `-r rules\dive.rule`.

**Rung 2 — Hybrid: word + digits / year** (`名字2024`, `公司123`, `pinyin888`). hashcat only; John approximates
it via `--rules=Jumbo` (which already appends digit strings):
```powershell
$hcDir = Split-Path (Get-Command hashcat).Source
Push-Location $hcDir; try {
  hashcat -m 9600 -a 6 C:\cases\case-01\secret.hc $wordlist ?d?d?d?d   # word + up to 4 digits
  hashcat -m 9600 -a 7 C:\cases\case-01\secret.hc ?d?d?d?d $wordlist   # up to 4 digits + word
} finally { Pop-Location }
```

**Rung 3 — Statistical brute force (the "format-unknown" engine; smarter than a naked mask).** John's incremental
mode walks the keyspace in **frequency order** from the bundled `.chr` stats — every length and character class,
most-probable first — so you never have to declare the format. It hits far earlier than a left-to-right `?a` sweep
and runs until cracked or stopped, so time-box it (large `exec` timeout, then read the potfile). Go cheap → broad:
numeric first (a huge cluster — most 6-/8-digit passwords are dates), then the full printable space:
```powershell
john --format=office --pot=$pot --incremental=Digits C:\cases\case-01\secret.hash  # numeric PIN / date, any length
john --format=office --pot=$pot --incremental=ASCII  C:\cases\case-01\secret.hash  # everything, frequency-ordered
```
> **Numeric cliff (why 6 digits crack instantly but 7 crawl):** the bundled list holds ~37k six-digit and ~32k
> eight-digit entries — they are **dates** — but almost no seven-digit (7 digits has no date/PIN shape). So a
> 6-/8-digit date is a wordlist hit in seconds, while a 7-digit number drops to a full 10⁷ brute force. Expected,
> not a bug: `--incremental=Digits` catches any non-random 7-digit fast; a uniform-random 7-digit needs the whole
> space (~30 min at ~5k c/s on CPU, seconds on a discrete GPU). Do **not** "fix" it by stuffing every 7-digit
> number into the wordlist — the KDF runs per candidate either way, so a mask is the right tool, not a bloated list.

**Rung 4 — Ordered mask sets / one targeted mask.** hashcat ships `masks\rockyou-1-60.hcmask` …
`rockyou-7-2592000.hcmask`: mask collections **pre-sorted by how often they crack real passwords** — use them
instead of hand-guessing masks. Or run a single mask the case implies (e.g. 8-digit date):
```powershell
Push-Location $hcDir; try { hashcat -m 9600 -a 3 C:\cases\case-01\secret.hc masks\rockyou-2-1800.hcmask } finally { Pop-Location }
john --format=office --pot=$pot --mask='?d?d?d?d?d?d?d?d' C:\cases\case-01\secret.hash   # john path, YYYYMMDD
```
> ⚠️ The seconds in those `.hcmask` names (60 … 2592000) are calibrated for **fast** hashes on a **GPU** — they
> do **not** predict wall-clock against the slow Office KDF. The *ordering* still helps (most-likely masks first),
> but on CPU only the low-numbered sets (`rockyou-1` / `-2`) finish in practical time; bigger keyspaces need a
> discrete GPU. Mask tokens: `?d`=digit, `?l`=lower, `?u`=upper, `?a`=all printable — each `?a` position ×95.

**Rung 5 — Bigger wordlist (the one real bundling gap).** `tools\wordlists\` ships **only** `forensic.txt`. If
rungs 0–4 all miss, the fix is a broader list (`rockyou.txt`, or a Chinese phone-segment / name-pinyin+birthday
list) dropped into `tools\wordlists\`, then re-run rungs 0–2 over it. That is a packaging/environment change —
surface it like a missing engine; do not try to brute-force around it.

### Step 5: Report honestly (and know where CPU stops)

- **Cracked** → report the recovered plaintext **verbatim**, and note which rung / engine found it (e.g. "hashcat,
  forensic.txt + best66 rules").
- **Not cracked** → say so plainly and **list the ladder you climbed** (which rungs, which lists / rules / masks),
  so the reader sees the actual coverage. Then give the **specific** next step, not "try harder":
  - **no discrete GPU** and you stopped at rung 3/4 → the remaining keyspace (long/complex passwords, the full
    phone-number space, `?a`⁸) is **GPU-scale**; recommend re-running on an NVIDIA/AMD box via hashcat.
  - **rungs 0–2 exhausted** forensic.txt + rules → recommend a **larger wordlist** (rung 5) or **more case leads**
    (rung 0) — the two levers that actually move the needle against a slow KDF.
- **Never fabricate a password** and never claim "uncrackable". An honest *"not recovered with the bundled
  wordlist + rules + masks; needs a GPU / a larger list / more case-specific leads"* is the correct terminal state.

## Generalizing to ZIP / RAR / 7z / PDF

The exact same `*2john → crack` pipeline works for other encrypted containers — the companion extractors live in
the **same flattened** `tools\john\` directory. Mind what each needs: `zip2john.exe` / `rar2john.exe` are **native
exes** and `office2john.py` runs via `uv` — these work out of the box. **But in this bundle `pdf2john.pl` and
`7z2john.pl` are Perl scripts and Perl is NOT bundled** (there is no `pdf2john.py` / `7z2john.py` here), so **PDF
and 7z hash-extraction are an environment gap** — install Perl to run them, or surface the gap the way you would a
missing engine; don't silently give up. Extract the hash, then crack with john (auto-detects the format) or
hashcat (`-m` by the hash prefix):

```powershell
$johnDir = Split-Path (Get-Command john).Source   # re-derive: variables do not carry across exec calls
& "$johnDir\zip2john.exe" .\archive.zip | Set-Content C:\cases\case-01\zip.hash   # ZIP  → works (native exe)
& "$johnDir\rar2john.exe" .\archive.rar | Set-Content C:\cases\case-01\rar.hash   # RAR  → works (native exe)
# PDF / 7z extraction needs Perl (NOT bundled):
#   perl "$johnDir\pdf2john.pl" .\locked.pdf | Set-Content C:\cases\case-01\pdf.hash   # requires a Perl install

john C:\cases\case-01\zip.hash        # John auto-detects zip/rar format — no --format needed
john --show C:\cases\case-01\zip.hash
```

Common hashcat modes if you take the GPU path (or confirm via `hashcat --help`):

| Container | hashcat `-m` |
|---|---|
| ZIP (WinZip AES) | 13600 |
| PKZIP (legacy ZIP) | 17200 / 17210 / 17220 / 17225 / 17230 |
| 7-Zip | 11600 |
| RAR3 (`-hp`) | 12500 |
| RAR5 | 13000 |
| PDF 1.1–1.3 (Acrobat 2–4, RC4 40-bit) | 10400 |
| PDF 1.4–1.6 (Acrobat 5–8) | 10500 |
| PDF 1.7 L3 (Acrobat 9) | 10600 |
| PDF 1.7 L8 (Acrobat 10–11) | 10700 |

## Pitfalls

1. **Locate `office2john` via `john` — never hard-code a path.** It is a `.py` with no exe wrapper; `where.exe
   john` / `Get-Command john` gives you its directory in both dev and packaged builds.
2. **hashcat needs the bare hash; John takes the whole `filename:hash` line.** Feeding hashcat the prefix, or
   feeding it a `$oldoffice$` hash under the wrong `-m`, produces "No hashes loaded" / "Token length exception".
3. **hashcat only runs from its own install directory.** It finds `OpenCL\`/`kernels\`/`modules\` relative to the
   current directory, so every hashcat call — including `-I` — must be wrapped `Push-Location (Split-Path
   (Get-Command hashcat).Source)` … `Pop-Location`, with **absolute** hash/wordlist/potfile paths. Run it from
   elsewhere and it dies with `./OpenCL/: No such file or directory`. john has no such constraint.
4. **Default to john; switch to hashcat only for a *discrete* GPU** (NVIDIA / AMD RX / Intel Arc — a `CUDA`/`HIP`
   block, or a GPU with `Memory.Unified: 0`). An integrated GPU (`Memory.Unified: 1`; Intel HD/UHD/Iris) barely
   beats the CPU for the slow Office KDFs — keep it on john. (CPU-only OpenCL devices also need `--force`.)
5. **If `john` is not on PATH, stop and report** — do not silently claim the file is uncrackable or improvise a
   Python cracker. Cracking is only as good as the wordlist; missing engines is an environment problem to surface.
6. **Use a `600000` ms timeout** for the crack step, and keep intermediate `.hash` / potfiles in your workspace,
   not in the evidence directory. Password-cracking binaries are commonly AV-flagged; that is expected here.
## 使用步骤

> 待人工裁决：补充加密介质与密码恢复；覆盖Office/压缩包/PDF/BitLocker/VeraCrypt/密码管理器/钱包/数据库；不替代原Workflow，仅闭环。

### 1. 受理与证据固定
- 授权/案号/来源/只读/输出边界；`Get-FileHash -Algorithm SHA256`；建`scratch/`、`out/`、`leads/`，禁写证据目录；登记类型/路径/大小/时间/容器/疑似加密。

### 2. 识别加密对象与破解入口
- 文件头/扩展名/魔数/工具识别：Office OLE/OOXML、ZIP、RAR、7z、PDF、BitLocker、VeraCrypt/TrueCrypt、KeePass、密码管理器导出、wallet.dat、keystore、SQLCipher、自定义。
- 区分无密码/伪加密/损坏/真加密：ZIP标志位/局部文件头；Office `office2john`无输出/提示；PDF打开/权限口令。
- 可执行打包物：DIE、EXEInfoPe识别语言/编译器/壳，再反编译/脱壳/动态调试取密钥。

### 3. 先找密钥、恢复文件与线索
- 优先密钥/恢复文件/密码管理器记录/明文配置，后爆破。
- 线索：系统/应用（便签/记事本/邮件/浏览器密码/密码管理器库/配置/脚本/环境变量/历史命令/日志）、介质（BitLocker恢复密钥密码、VeraCrypt keyfile、KeePass主密码keyfile、钱包助记词、keystore密码、数据库密钥、salt、IV、迭代）、人员（手机号/生日/姓名拼音/公司名/昵称/车牌/工号/提示）、隐写附件（图片尾部/音频频谱/隐藏文件/脚本注释/邮件附件）。
- `leads.txt`：原文/大小写/手机号/日期/拼音+数字/弱口令。

### 4. 提取可破解Hash或加密参数
- Office：`office2john.py`→`$office$`/`$oldoffice$`；ZIP/RAR：`zip2john.exe`、`rar2john.exe`；7z/PDF：有Perl用`7z2john.pl`、`pdf2john.pl`，否则记环境缺口，不伪装成功。
- BitLocker/VeraCrypt/钱包/密码管理器/数据库：提取卷头、salt、迭代、模式、keyfile路径，转john/hashcat。
- 自定义：记录key/iv/salt/截取规则/编码/模式（CBC、GCM、RC4、XOR），留最小密文；输出`案号_对象.hash`+来源SHA256。

### 5. 选择破解策略
- 顺序：线索→字典→规则→混合→掩码→统计增量→大字典；`leads.txt`优先。
- 字典：`forensic.txt`、`password.lst`、定制；规则：best64、Jumbo、best66、dive；混合：词/数字、年份、手机尾号、公司+数字；掩码仅结构线索（8位日期、11位手机号、固定前后缀）；统计增量/Markov按频率，避免全字符。
- CPU默认john；离散GPU hashcat；集成GPU不优先；慢速KDF（Office 2013+、VeraCrypt、BitLocker、KeePass、argon2id、PBKDF2）大超时并记速率/耗时。

### 6. 解密验证与结果复核
- 命中不能只`--show`；须打开/挂载/解压/查询。
- Office打开/解密副本；ZIP/RAR/7z列条目/解压`out/`/校验CRC/文件头/样本；PDF渲染/附件/权限；VeraCrypt/BitLocker挂载列目录/读样本/可导出解密卷；数据库/钱包/密码管理器打开查询导出/验证结构。
- 失败查：编码、冒号、空格、Unicode、伪加密、错误hash模式、损坏、keyfile缺失。

### 7. 闭环记录与失败报告
- 记录原始哈希、提取/破解命令、字典、规则、掩码、potfile、命中候选、验证、耗时速率。
- 未破解：尝试层级、覆盖率、瓶颈（CPU/字典/线索/环境缺口）、建议（离散GPU、更大字典、更多线索、专用提取器、动态调试、格式修复）。
- 不声称不可破解/不伪造密码/环境缺失不包装成破解失败。

### 8. 特殊场景分支
- SQLCipher：优先应用配置/内存/源码/keystore；确认页大小/KDF/HMAC/派生。
- 自定义XOR/凯撒/RC4/AES：还原算法后脚本解密；双向验证（重加密或校验明文结构）。
- 源码/脚本/加壳：反编译/脱壳/动态调试取运行时密钥；不凭静态字符串猜。
- 密码管理器：区分主密码/keyfile/格式版本；导出后校验条目数/字段/时间戳。

## 输入输出说明

### 输入
1. 加密对象：路径/文件名/类型/大小/SHA256/只读；对象同步骤2。
2. 案件线索：同步骤3。
3. 破解资源：字典/规则/掩码/候选/超时/GPU策略/potfile/工作区。
4. 环境：john、hashcat、uv、python、perl；GPU离散/集成、工具目录、权限、允许挂载/解压。
5. 授权：范围/写入/挂载/网络下载（默认不允许）。

### 中间产物
- `.hash`（john完整行）、`.hc`（hashcat裸hash）、`leads.txt`、`john.pot`/`hashcat.potfile`、`out/`、`report.md`/`report.json`。

### 成功输出
- 密码原样；特殊字符给转义/十六进制；命中来源：线索/字典/规则/掩码/keyfile/恢复密钥/动态调试/密钥文件；验证同步骤6；产物：路径/文件列表/样本/SHA256；证据链：原始SHA256、命令、引擎版本、参数、字典、规则、耗时速率。

### 失败输出
- 未恢复，非不可破解；已尝试字典/规则/掩码/增量/混合/GPU/CPU/时间盒；覆盖候选规模/覆盖率/速率；缺口Perl/GPU/字典/专用提取器/运行时调试权限；建议更大字典/更多线索/离散GPU/修复hash/动态调试/逆向/keyfile。

### 结构化结果字段建议
- status：cracked/not_cracked/environment_gap/not_encrypted/corrupted；password；password_encoding：原样/转义/十六进制；object_type：office/zip/rar/7z/pdf/bitlocker/veracrypt/keepass/wallet/database/custom；hash_type：office2013/office2010/oldoffice/zip/rar/7z/pdf/veracrypt/bitlocker/custom；engine：john/hashcat/script/manual；attack：leads/wordlist/rules/hybrid/mask/incremental/keyfile/recovery_key；validation：opened/extracted/mounted/queried/failed；evidence：原始哈希/命令/日志/产物路径。

### 边界与约束
- 原始证据只读；中间产物写工作区；不改原始加密文件；不在证据目录生成potfile/解压；密码仅受控报告，避免日志扩散；未验证候选不标最终密码；工具缺失/格式不识别/损坏单独报告，不混同破解失败。

### 常见输入异常
- 未加密：说明并打开验证；伪加密：标志位异常，修复/验证；损坏：区分解析失败/CRC失败/密码错误；工具缺失：报组件与影响；格式不识别：需逆向/专用提取器/人工裁决。

## D3-02

### 结果校验、闭环证据与误判控制

#### 1. 命中不等于可用
- `john --show`/`hashcat --show`仅证明候选与hash匹配；须命中、访问、内容校验；potfile命中须对应当前hash与文件版本。

#### 2. 分类型验证要求
- 按步骤6验证；VeraCrypt/BitLocker隐藏卷/预启动单独说明；数据库/钱包/密码管理器验证账户结构/交易字段。

#### 3. 闭环证据字段
- 补步骤7：提取参数（salt/IV/迭代/模式）、引擎版本、john format/hashcat mode、候选来源、操作人/时间/环境/失败项/建议。

#### 4. 误判与规避
- hashcat裸hash；John完整`文件名:hash`；Office 2007/2010/2013+/OldOffice模式不混用；特殊字符原样+转义/十六进制；先排除伪加密/损坏/权限口令/keyfile；集成GPU慢速KDF收益低，关键结果CPU/john复核；命中打不开查同一文件版本。

#### 5. 失败结论规范
- 不写无法破解/密码不存在；写当前授权、字典、规则、掩码、算力、时间内未恢复；列线索/字典/规则/混合/掩码/增量/大字典；给增线索/扩字典/离散GPU/修复提取/keyfile/动态调试/逆向。

#### 6. 与既有流程的关系
- 补充结果报告与校验，不替代Runtime Environment、Workflow、Pitfalls；扩展介质（BitLocker、VeraCrypt、钱包、数据库）差异需人工裁决纳入。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
