---
name: android-sqlcipher-db-analysis
description: |
  Reverse-engineer and decrypt SQLCipher / WCDB encrypted SQLite databases shipped
  inside Android APKs. Use when given an APK plus a `databases/` folder pulled
  from `/data/data/<pkg>/`, and the goal is to (1) locate the key-derivation
  logic in the dex, (2) recover the passphrase template, (3) determine the
  exact KDF / HMAC / iter / page-size parameters, and (4) decrypt the database
  end-to-end. Covers the common open-source wrappers: SQLCipher direct,
  Tencent WCDB / WCDB 2, and Room + WCDBOpenHelperFactory.
tags: [android, reverse-engineering, sqlcipher, wcdb, forensics, dex, jadx]
supporting_files:
  - scan_dex_strings.py    # locate the right classes*.dex without full-APK decompile
  - verify_sqlcipher.py    # PRAGMA-ladder verification primitive
  - report_template.md     # standardized output table
  - tools.md               # external tool paths (apktool, jadx, sqlcipher3) & install
  - requirements.txt       # Python dependencies
  - check_env.py           # one-shot environment check
---

# Android SQLCipher / WCDB Database Decryption

A repeatable **two-stage methodology — static recon, then dynamic verification**
— for recovering plaintext from SQLCipher / WCDB-protected SQLite databases on
Android.

The single most important lesson encoded here: **the WCDB `CipherVersion` enum
is not authoritative**. Source code can declare `version4` while real-world
files only open with SQLCipher v3 defaults. Always finish with a PRAGMA
enumeration that actually reads `sqlite_master`.

---

## When to Invoke

Trigger this skill when **all** of the following hold:

- You have an Android APK or its decoded form (`apktool-out/`).
- You have at least one encrypted SQLite database file (typically pulled from
  `/data/data/<pkg>/databases/`). Filename hints: anything that does not begin
  with the magic bytes `SQLite format 3\0`.
- The goal is **decryption** (not just classifying the engine).

Do **not** use this skill if the APK is still inside an active jiagu/packer
shell (see §7), or if the encryption is plainly not SQLCipher (Realm /
hand-rolled AES — magic-byte inspection rules these out in seconds).

---

## 0. Preconditions / Inputs

| Input | Where it usually comes from |
|---|---|
| The APK | `/data/app/<pkg>-<n>/base.apk`, distribution channel, or a forensics image |
| `databases/<encrypted_files>` | `/data/data/<pkg>/databases/` (root or `adb backup`) |
| `shared_prefs/*.xml` | Same parent dir; often holds the uid / sec_uid used in the passphrase |
| Tools | `apktool`, `jadx ≥ 1.5`, Python ≥ 3.10 with `sqlcipher3` (auto-detected) |

First-time setup:

```bash
python check_env.py --install --json env.json   # auto-install missing + write config
```

This auto-detects and installs all missing tools (pip, brew, apt, GitHub
download). Re-run to verify. See `tools.md` for manual install instructions.

Missing the SP dump? Look for identifiers embedded in the encrypted DB
filename itself — many apps name their databases using account or device
identifiers (e.g. `<prefix>_<id>.db`).

---

## 1. Stage A — Static Recon

### 1.1 Decode the manifest first (cheap, high value)

```bash
apktool d -s -f -o apktool-out2 target.apk    # -s = skip dex, only resources
```

From `apktool-out2/AndroidManifest.xml` capture three things up-front:

- `package=` → package name.
- `<application android:name="…">` → real Application class. **If it is a
  vendor stub** (e.g. `…SecApplication`, `…StubApp`, `…ApplicationWrapper`,
  `…StubShell.*`, etc.) the APK is shelled and you must unshell first (§7).
- `<uses-permission>` list → quickly answer permission questions.

### 1.2 Locate the right dex BEFORE running jadx

Do NOT decompile a multidex APK end-to-end. Large multidex APKs can take
tens of minutes on jadx and often OOM. Treat each `classes*.dex` as a flat
ASCII blob and grep for **log-format strings** and **hard-coded passphrase
fragments** — these survive obfuscation.

Use `scan_dex_strings.py`:

```bash
python scan_dex_strings.py <apktool-out-dir>
# add domain strings if needed:
python scan_dex_strings.py <apktool-out-dir> --extra "customString1" "customString2"
```

It parallel-scans every `classes*.dex` against the default keyword set and
prints the minimal jadx command to run next — **auto-detecting the jadx
path** from PATH, `env.json`, or common install directories. Throughput is
typically on the order of 100+ MB/s, so even a large multidex APK scans in
seconds rather than minutes.

### 1.3 Decompile only what hit

The `scan_dex_strings.py` output already prints a ready-to-run jadx command
with the auto-detected path. Alternatively, run directly:

```bash
# jadx is auto-detected from PATH / env.json / common install dirs
jadx -d <out_dir> --show-bad-code --deobf --threads-count 8 <path-to-classesNN.dex>
```

If jadx is not on PATH, generate a config first:

```bash
python check_env.py --json env.json   # auto-locates all tools
python scan_dex_strings.py <apktool-out-dir>   # uses env.json for jadx path
```

`--show-bad-code` keeps method bodies even on `Code restructure failed`.
`--deobf` rewrites placeholder names (e.g. `X.AnonymousClassNN`) where
possible.

### 1.4 What to harvest from decompiled Java

Map every database file to its construction path. Three common shapes:

**Shape A — Direct WCDB Database**
```java
Database db = new Database(<absolutePath>);
db.setCipherKey(passphraseBytes, pageSize, Database.CipherVersion.versionN);
```

**Shape B — WCDB SupportFactory + Room**
```java
WCDBOpenHelperFactory f = new WCDBOpenHelperFactory();
f.passphrase(bytes);
SQLiteCipherSpec spec = new SQLiteCipherSpec();
spec.setSQLCipherVersion(Database.CipherVersion.version3.ordinal());
spec.setPageSize(4096);
spec.setKDFIteration(64000);            // ← rare but explicit
f.cipherSpec(spec);
roomBuilder.openHelperFactory(f);
```

**Shape C — Two-step OpenHelper**
```java
SQLiteCipherSpec spec = new SQLiteCipherSpec();
spec.setSQLCipherVersion(CipherVersion.version3.ordinal());
spec.setPageSize(PAGE_SIZE_CONST);              // resolve constant by hand
super.<init>(ctx, name, key, spec, version, errHandler);
```

For each shape capture **four** facts:

| Fact | Where to look |
|---|---|
| Passphrase **template** | `String.append(...)` / `getBytes(UTF_8)` chain |
| Passphrase **dynamic params** | account-id getters, SP keys |
| `CipherVersion` enum | `setSQLCipherVersion(... .ordinal())` |
| `pageSize` / `kdfIter` constants | `static final int` fields, often resolved by hand |

### 1.5 Passphrase recovery methodology

There is no universal passphrase taxonomy — each app constructs keys
differently. Instead of matching to a preset template, follow this process:

1. **Trace the `String` / `byte[]` chain** from the point where
   `setCipherKey()` or `passphrase()` is called, backwards through every
   `append()`, `concat()`, `format()`, and `getBytes()` call.
2. **Identify dynamic inputs**: any variable whose value comes from
   `SharedPreferences`, account SDK getters, device identifiers, or
   runtime computation. Resolve each to a concrete value using the
   `shared_prefs/` dump or by re-running the app.
3. **Identify static parts**: string literals that appear directly in the
   source. These are often stable across app versions because rotating
   them would force a full database re-encryption migration.
4. **Assemble the full passphrase** by substituting resolved dynamic
   values into the template, then verify with `verify_sqlcipher.py`.

If the passphrase contains only static literals, the APK alone suffices.
If it embeds account/device identifiers, you also need the `shared_prefs/`
dump or a runtime extraction.

---

## 2. Stage B — Dynamic Verification

### 2.1 Why static is not enough — the WCDB `CipherVersion` trap

`Database.CipherVersion` is a WCDB-internal enum and **does not necessarily
map 1:1 to SQLCipher's standard v3/v4 default profiles**. Empirically:

- `CipherVersion.version3` → behaves like SQLCipher v3 (HMAC-SHA1, KDF-SHA1,
  iter=64000, page=1024 unless overridden).
- `CipherVersion.version4` → in many observed WCDB-wrapped samples **also**
  behaves like the v3 profile, NOT like SQLCipher v4 (SHA512, iter=256000).
  Counter-intuitive.

Treat the static `CipherVersion` reading as a **hypothesis**, not a fact.

### 2.2 Verification primitive: try-and-read-page1

Use `verify_sqlcipher.py`. Core idea:

```python
cur.execute(f"PRAGMA key = '{pw}'")
cur.execute("PRAGMA cipher_compatibility = 3")
cur.execute("PRAGMA cipher_page_size = 4096")
cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
```

`SELECT … FROM sqlite_master` is the cheapest read that forces page-1
decryption and HMAC verification. Wrong params → `DatabaseError(file is not a
database)` or `hmac check failed for pgno=1`. Right params → instant table
list. **There is no "almost right" outcome** — this is what makes the method
trustworthy.

### 2.3 Standard search ladder (run in order, stop on first OK)

```
1. compat=3,  page=4096                                  # WCDB-wrapped default
2. compat=4,  page=4096                                  # SQLCipher 4 default
3. compat=3,  page=1024                                  # legacy / vanilla v3
4. compat=4,  page=4096, kdf_iter=256000                 # explicit v4
5. enumerate kdf_alg ∈ {SHA1,SHA256,SHA512}
            × hmac_alg ∈ {SHA1,SHA256,SHA512}
            × kdf_iter ∈ {1, 4000, 64000, 256000}        # only if 1-4 all fail
```

In practice WCDB-wrapped samples almost always stop at step 1 or 2.

### 2.4 Record what worked

When a combination opens the DB, **also log every PRAGMA that was redundant**.
This distinguishes "explicitly required" from "happens-to-equal-default",
which matters when writing the report.

---

## 3. Stage C — Sanity Checks

After tables list, do these BEFORE declaring victory:

1. **Read a real row** from a non-empty table (`SELECT * FROM <t> LIMIT 1`).
   HMAC failures on later pages will show up here, not on page 1.
2. **Open the matching `-wal` file**: SQLCipher decrypts WAL transparently if
   it lives next to the main DB, but missing WAL = missing recent writes.
3. **Cross-validate account ids** between the DB filename, the SP files, and
   any account-SDK keys you reverse-engineered. Mismatches indicate
   multi-account state.
4. **Re-run with passphrase off-by-one** (flip a single byte in the template)
   and confirm it now fails. Rules out lucky-decode false positives.

---

## 4. Output

Use `report_template.md` per database. Always include both the **declared**
`CipherVersion` (from source) and the **effective** profile (what actually
opened the file), since they disagree more often than not.

---

## 5. Common Pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| `hmac check failed for pgno=1` everywhere | Wrong KDF/HMAC algo or wrong key | Walk the compat=3 ↔ compat=4 ladder |
| `file is not a database` | Wrong cipher version OR file is plain SQLite | Check first 16 bytes; `SQLite format 3\0` = plaintext |
| Page-1 OK, later page `database disk image is malformed` | Page size mismatch | Try `cipher_page_size = 1024` or `8192` |
| Works on dev sample, fails on prod | Code path like `if ("".length() > 0) … else …` toggles dev/prod key | Re-read source for `isLocalTest()` / debug toggles |
| Same template, different DB → fails | Per-DB passphrase salt differs (unlike per-DB header salt). Re-check whether template embeds uid / sec_uid / db filename |
| Right params, `SELECT` returns 0 rows | WAL not committed | Merge `*-wal` or `PRAGMA wal_checkpoint(TRUNCATE)` |
| `file is encrypted or is not a database` only on Windows | Backslash treated as escape inside SQL string | Use forward slashes, or pass via `sqlite.connect(path)` not via PRAGMA |
| `setKDFIteration` not present in source | Code path relied on `CipherVersion` defaults | Walk the ladder; do not assume 256000 just because version4 is declared |

---

## 6. Reference Profiles (quick lookup)

| Profile | page | kdf_iter | KDF | HMAC | Cipher |
|---|---|---|---|---|---|
| SQLCipher v3 default | 1024 | 64 000 | PBKDF2-HMAC-SHA1 | HMAC-SHA1 | AES-256-CBC |
| SQLCipher v4 default | 4096 | 256 000 | PBKDF2-HMAC-SHA512 | HMAC-SHA512 | AES-256-CBC |
| WCDB `version3` (typical) | 4096 | 64 000 | PBKDF2-HMAC-SHA1 | HMAC-SHA1 | AES-256-CBC |
| WCDB `version4` (typical) | 4096 | 64 000 | PBKDF2-HMAC-SHA1 | HMAC-SHA1 | AES-256-CBC |

Note the bottom two rows: **WCDB's `version4` is observed to use v3-style
parameters in the wild**, not the SQLCipher v4 standard. Always verify.

---

## 7. When This Skill Does NOT Apply

- **Native-side key derivation** (key generated inside `.so` via JNI, often
  bound to a device fingerprint). Static dex analysis alone won't recover the
  passphrase; pivot to Frida hooking on `Database.setCipherKey` /
  `sqlite3_key_v2` / `sqlite3_key`.
- **Hardware-backed keys** (Android Keystore wrapping the SQLCipher key).
  Same Frida pivot; or extract the wrapped key and replay on the same device.
- **Custom encryption** (Realm, vendor crypt layers, AES-CTR rolled by hand,
  ChaCha20). File-header inspection rules in/out quickly.
- **Active jiagu / packer shells** (Application class is a vendor stub, dex is
  mostly empty). Unshell first (FART / BlackDex / Frida Dexdump) before this
  skill applies.

---

## Files in This Skill

| File | Role |
|---|---|
| `SKILL.md` | This document. |
| `scan_dex_strings.py` | Stage A: parallel multi-pattern dex scanner. Tells you which dex(es) to decompile. |
| `verify_sqlcipher.py` | Stage B: implements the §2.3 ladder + brute-force; prints the winning PRAGMA sequence. |
| `report_template.md` | Stage C: fill-in-the-blanks Markdown report, one block per DB. |
| `tools.md` | External tool reference (apktool, jadx, JDK, sqlcipher3) with paths and install commands. |
| `requirements.txt` | Python deps — `pip install -r requirements.txt`. |
| `check_env.py` | Run before starting; auto-detects all tools, optionally writes `env.json`. |
| `env.json` | (generated) Tool path cache written by `check_env.py --json`; read by other scripts. |

## 适用场景

本技能用于 Android 应用数据目录中的 SQLCipher / WCDB 加密 SQLite 数据库取证分析，典型适用于以下情况：

- 已从 root 设备、ADB backup、物理镜像、逻辑提取或云备份中获取 `/data/data/<package>/databases/` 下的 `.db`、`.sqlite`、`.sqlcipher` 或自定义后缀数据库，且文件头不是明文 SQLite。
- 需要判断数据库是否为 SQLCipher/WCDB 加密、恢复明文、固定证据，并对业务表、聊天记录、缓存表、账户表、消息表进行查询统计。
- 已获取目标 APK 或解码后的 `apktool-out/`，可通过静态反编译定位 `setCipherKey`、`passphrase`、`SQLiteCipherSpec`、`WCDBOpenHelperFactory` 等密钥配置点。
- 需要结合 `shared_prefs/*.xml`、账户 SDK、设备标识、数据库文件名中的 uid/sec_uid，重建密钥模板并完成解密。
- 对备份文件、WAL/SHM 附属文件、多账户数据库、迁移后数据库进行一致性校验和时间线重建。

不适用或需先处理前置条件的场景：

- APK 仍在加固壳内，需先脱壳。
- 密钥在 native `.so`、Android Keystore、TEE/StrongBox 中生成，需 Frida hook、设备侧抓取或密钥导出。
- 文件为 Realm、自研 AES、ChaCha20 等非 SQLCipher 加密。
- 仅有数据库文件且无任何密钥线索时，只能做加密特征识别，不能保证解密成功。

## 使用步骤

以下步骤按“证据固定 → 配置定位 → 密钥重建 → 解密验证 → 查询统计 → 结果固定”的顺序执行。原则：永远先对原始证据计算哈希并生成只读工作副本，所有解密与查询均在工作副本上进行。

### 1. 证据固定与输入准备

1. 对 APK、`databases/`、`shared_prefs/`、`files/`、备份文件分别计算 SHA-256：

```bash
find evidence/ -type f -exec sha256sum {} + > evidence_sha256.txt
```

2. 建立只读原始目录和可写工作目录：

```bash
mkdir -p work/case01
cp -a evidence/data_data/<pkg>/databases work/case01/
cp -a evidence/data_data/<pkg>/shared_prefs work/case01/
```

3. 检查文件头，排除明文 SQLite：

```bash
for f in work/case01/databases/*; do xxd -l 16 $f; done
```

若出现 `SQLite format 3`，转入普通 SQLite 取证流程；否则按加密库处理。

4. 同步收集 `-wal`、`-shm`、`-journal`、备份 `.bak`、`*.db-journal`、`cache/`、`files/` 中可能的密钥文件或配置。

### 2. 定位数据库连接配置与密钥材料

1. 解码资源，识别包名、Application 类、是否加固：

```bash
apktool d -s -f -o apktool-out target.apk
```

2. 快速扫描 dex 字符串，锁定包含数据库配置、密钥拼接、日志特征的 dex：

```bash
python scan_dex_strings.py apktool-out --extra "setCipherKey" "passphrase" "SQLiteCipherSpec" "WCDBOpenHelperFactory"
```

3. 只反编译命中的 dex：

```bash
jadx -d jadx-out --show-bad-code --deobf --threads-count 8 apktool-out/classesN.dex
```

4. 在反编译结果中搜索以下关键字并建立映射：

```bash
rg -n "setCipherKey|passphrase|SQLiteCipherSpec|setSQLCipherVersion|setPageSize|setKDFIteration|cipherSpec|sqlite3_key" jadx-out
```

5. 对每个数据库文件记录：数据库路径/文件名、密钥模板、动态参数来源、`CipherVersion`、`pageSize`、`kdfIter`、KDF/HMAC 线索。

### 3. 密钥提取与解密流程

1. 从 `shared_prefs/*.xml` 提取 uid、sec_uid、token、device_id、账号字段：

```bash
rg -n "uid|sec_uid|user_id|account|device" work/case01/shared_prefs
```

2. 将静态模板与动态参数拼接成候选 passphrase。若密钥来自 native、Keystore 或运行时计算，则切换 Frida hook：

```bash
frida -U -f <pkg> -l hook_sqlcipher_key.js --no-pause
```

重点 hook `Database.setCipherKey`、`sqlite3_key`、`sqlite3_key_v2`、`PRAGMA key`。

3. 使用验证脚本按兼容参数梯度测试：

```bash
python verify_sqlcipher.py work/case01/databases/target.db --passphrase-file candidates.txt
```

4. 若脚本命中，记录完整 PRAGMA 组合；若未命中，按以下顺序人工复核：
   - `cipher_compatibility=3` + `cipher_page_size=4096`
   - `cipher_compatibility=4` + `cipher_page_size=4096`
   - `cipher_compatibility=3` + `cipher_page_size=1024`
   - 显式 `kdf_iter`、`kdf_algorithm`、`hmac_algorithm` 组合

5. 解密成功后立即导出明文工作副本：

```bash
sqlcipher work/case01/databases/target.db <<'SQL'
PRAGMA key = 'RECOVERED_KEY';
PRAGMA cipher_compatibility = 3;
PRAGMA cipher_page_size = 4096;
ATTACH DATABASE 'work/case01/decrypted/target_plain.db' AS plain KEY '';
SELECT sqlcipher_export('plain');
DETACH DATABASE plain;
SQL
```

6. 若存在 WAL，先合并或检查点，再导出：

```bash
sqlite3 work/case01/decrypted/target_plain.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

### 4. 查询统计与时间线重建

1. 列出全部对象，确认表结构：

```bash
sqlite3 target_plain.db "SELECT type,name,sql FROM sqlite_master ORDER BY type,name;"
```

2. 统计重点表行数，优先处理消息、联系人、账户、缓存、日志类表：

```bash
sqlite3 target_plain.db "SELECT COUNT(*) FROM message;"
sqlite3 target_plain.db "SELECT COUNT(*) FROM account;"
sqlite3 target_plain.db "SELECT COUNT(*) FROM cache;"
```

3. 重建时间线时优先筛选时间字段：

```bash
sqlite3 target_plain.db "SELECT datetime(create_time/1000,'unixepoch','localtime') AS ts, * FROM message ORDER BY create_time;"
```

4. 对聊天记录、业务数据库进行异常字段筛选：

```bash
sqlite3 target_plain.db "SELECT * FROM message WHERE content LIKE '%转账%' OR content LIKE '%验证码%';"
```

5. 对缓存类表检查 TTL、过期字段、序列化 blob：

```bash
sqlite3 target_plain.db "SELECT key, expires_at, hex(value) FROM cache LIMIT 20;"
```

### 5. 结果固定与报告

1. 对解密后的明文库再次计算 SHA-256，记录“原始哈希 → 解密参数 → 明文哈希”链路。
2. 保存命中的 PRAGMA 序列、候选密钥生成脚本、Frida hook 日志、反编译证据位置。
3. 在报告中写明：声明的 `CipherVersion`、实际生效参数、是否依赖 WAL、多账户差异、失败参数组合，避免将 WCDB 枚举直接当作 SQLCipher 版本。

## D3-01

D3-01 关注数据库取证中的“证据获取、完整性保护与可复现解密”。在 Android SQLCipher/WCDB 场景中，不能只拿到一个 `.db` 就开始解密，必须同步固定以下材料：

- 主数据库文件、`-wal`、`-shm`、`-journal` 附属文件。
- `shared_prefs/`、`files/`、`cache/` 中可能保存 uid、sec_uid、token、设备指纹、密钥派生输入的配置。
- APK 或反编译产物，用于证明密钥模板来源。
- 备份文件、多用户目录、双开空间、工作资料目录中的同名数据库，用于交叉验证。
- 运行时密钥抓取日志（如 Frida hook 输出），用于解释无法静态恢复的密钥。

执行要求：

1. 原始文件只读保存，禁止直接在原始证据上执行 `PRAGMA key`、`sqlcipher_export`、WAL 合并或修复操作。
2. 每次解密尝试都应记录输入文件哈希、候选密钥来源、PRAGMA 参数、成功/失败原因。
3. 成功后必须保留可复现命令链：从 APK 定位、密钥拼接、参数验证到明文导出。
4. 若静态分析显示 `CipherVersion.version4`，但动态验证以 `compat=3` 打开，应在报告中记录“声明版本”和“实际生效版本”的差异。
5. 对无法解密的样本，应输出排除结论：是否 SQLCipher、是否缺少密钥材料、是否需要设备侧提取或 native 分析。

该章节的目标是确保最终分析结论可被复核：即使换一名取证人员，也能根据证据包和命令链复现同一份明文数据库与统计结果。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
