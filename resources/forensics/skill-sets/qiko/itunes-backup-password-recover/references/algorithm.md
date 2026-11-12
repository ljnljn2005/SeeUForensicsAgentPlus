# BackupKeyBag 口令校验算法

与公开实现一致：`iphone_backup_decrypt`（Google iPhone Data Protection）、`iOSbackup`。

## 输入

- 可读的 `Manifest.plist`（XML 或 binary plist）
- 字段：`IsEncrypted`（可选）、`BackupKeyBag`（TLV blob，必需）

## TLV

每块：`tag`（4 字节 ASCII）+ `length`（uint32 BE）+ `data`。

Bag 级常见标签：`TYPE`、`UUID`（袋 UUID）、`WRAP`、`SALT`、`ITER`、`DPSL`、`DPIC` 等。

每个 protection class：新的 `UUID` 起一段，含 `CLAS` / `WRAP` / `WPKY` / `KTYP`。

## 口令派生

- **双层**（存在 `DPSL` + `DPIC`，典型 iOS ≥ 10.2）：
  1. `temp = PBKDF2-HMAC-SHA256(password, DPSL, DPIC, dkLen=32)`
  2. `KEK = PBKDF2-HMAC-SHA1(temp, SALT, ITER, dkLen=32)`
- **单层**（无 DPSL/DPIC）：`KEK = PBKDF2-HMAC-SHA1(password, SALT, ITER, dkLen=32)`

脚本在存在 DPSL 时优先双层，失败再试单层（兼容异常袋）。

## 校验

对每个 `WRAP & 2`（passcode wrap）的 class：`AES-Key-Unwrap(KEK, WPKY)`（RFC 3394）。  
成功条件：unwrap 后 IV 字为 `0xa6a6a6a6a6a6a6a6`。  
任一 passcode-wrapped class 全部成功 unwrap → 口令正确。

## 常见失败模式（会话教训）

- 只做单层或只做双层、参数解析错（把 `DPWT` 等标签当派生输入）
- unwrap 实现与 RFC 3394 不一致 → 全空间扫完仍 `FOUND: None`（假阴性）
- `DPIC` 极大（如千万级）时 4 位全量极慢：先 `verify` 常见 PIN，或导出 hashcat `-m 14700`/`14800`

## 与 hashcat

- `< iOS 10`：`-m 14700`
- `>= iOS 10`：`-m 14800`
- 可用 `itunes_backup2hashcat` 从 Manifest 导出 `$itunes_backup$*…`（本技能 MVP 不强制导出）

## 不做

- 完整备份文件解密 / 替代 ForensicLite 导入
- Office/ZIP/PDF（见 `cracking-password-protected-documents`）
