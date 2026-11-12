---
name: iTunes 备份密码恢复
description: >-
  Recover or verify the password of an encrypted iTunes/Finder iOS backup from
  Manifest.plist BackupKeyBag (IsEncrypted). Standard PBKDF2 + AES key-unwrap
  verify and short PIN brute. Use when the task asks for backup password,
  encrypted Manifest, BackupKeyBag, unlock iTunes/Finder backup — NOT for
  Office/ZIP/PDF (use cracking-password-protected-documents). Prefer product
  submit_interaction when a forensics task is waiting for a password.
version: '1.0.0'
author: qikoclaw
domain: cybersecurity
subdomain: digital-forensics
tags:
  - itunes-backup
  - backupkeybag
  - manifest-plist
  - password-recovery
  - ios
license: Apache-2.0
name_en: iTunes Backup Password Recover
name_ru: Восстановление пароля резервной копии iTunes
description_en: >-
  Verify or recover encrypted iTunes/Finder backup passwords via Manifest.plist
  BackupKeyBag (PBKDF2 + AES unwrap). Not for Office/ZIP/PDF.
description_ru: >-
  Проверка/восстановление пароля шифрованной резервной копии iTunes/Finder по
  BackupKeyBag в Manifest.plist. Не для Office/ZIP/PDF.
---

# iTunes / Finder Backup Password Recover

Recover or **verify** the encryption password of an **iTunes/Finder iOS backup**
using the standard `BackupKeyBag` algorithm. Use this skill instead of inventing
a one-off Python KeyBag checker in the session (that path caused false negatives
on real 4-digit PINs).

## Navigation

```text
Encrypted Manifest.plist / BackupKeyBag / "备份密码"
  → Prefer forensic_task_manage submit_interaction (if pending password UI)
  → THIS SKILL (verify / brute short PIN)
  → Optional: hashcat -m 14700 / 14800 for long passwords
Office / ZIP / RAR / PDF password
  → cracking-password-protected-documents (NOT this skill)
```

## When to Use

- `Manifest.plist` shows `IsEncrypted=True` or contains `BackupKeyBag`
- Exam / case asks for **iTunes / Finder backup password** / 备份密码
- Need to unlock an encrypted backup directory before further iOS analysis
- Agent is about to write a custom `break_pw.py` / KeyBag brute — **stop and use this script**

## When NOT to Use

- Office / ZIP / RAR / 7z / PDF → `cracking-password-protected-documents`
- Filesystem extract that only *looks* like a zip (no real BackupKeyBag) → treat as folder exhibit (`myos-exam-phone` pitfalls)
- Malware scan when the **user already provided** the backup password → `iphone-malware-scan`

## Script

Path (relative to this skill directory):

```text
scripts/verify_itunes_backup_password.py
```

Windows (product `exec` / PowerShell; prefer `uv run` or `python`):

```powershell
# Self-check (no evidence)
python .\scripts\verify_itunes_backup_password.py self-test

# Inspect KeyBag
python .\scripts\verify_itunes_backup_password.py info .\Manifest.plist

# Test one candidate
python .\scripts\verify_itunes_backup_password.py verify .\Manifest.plist 1111

# Common PINs then 0000–9999 (warns if DPIC is huge)
python .\scripts\verify_itunes_backup_password.py brute .\Manifest.plist --digits 4
```

Substitute the real Manifest path under the firmament workspace. **Never modify** the original evidence file; copy Manifest into workspace if needed.

Algorithm details: `references/algorithm.md`.

## Workflow

1. Confirm the file is a real encrypted backup Manifest (`info` shows `BackupKeyBag`, `ITER`, optional `DPIC`).
2. If the forensics task has a **password pending interaction**, call `submit_interaction` / ask the user first.
3. Run `verify` on likely short PINs, or `brute --digits 4` (common list first).
4. On `OK` / `FOUND: …` — report that password with method (`verify_itunes_backup_password.py`). Submit to product interaction if required.
5. On `FAIL` / `NOT_FOUND` — answer **未能恢复备份口令** and list what was tried. **Do not** invent a “备选” guess (e.g. 1234).
6. If `DPIC` is enormous and 4-digit full space is impractical, say so and optionally move to hashcat `-m 14800` after exporting an itunes backup hash — still no guessed answer.

## Hard rules

- **Forbidden**: hand-rolled KeyBag verify/brute that is not this script (or hashcat with a correctly exported hash).
- **Forbidden**: submitting a guessed backup password after failed verify.
- **Allowed**: product password vault / user-provided password / this script / hashcat 14700/14800.

## Related

- Phone exam routing: `myos-exam-phone` (`question-routing` → 加密 iTunes/Finder 备份口令)
- iOS path map: `ios-mobile-forensics`
- Known-password malware scan: `iphone-malware-scan`

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
