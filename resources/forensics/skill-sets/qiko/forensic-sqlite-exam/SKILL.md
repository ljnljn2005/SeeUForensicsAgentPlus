---
name: SQLite 取证深挖
description: >-
  对单个 .db/.sqlite/.mfs/.amf/.dmf/.cmf 或 CloudData_RECORD 做 SQLite
  取证深挖：schema、SELECT、WAL/SHM，删除记录须用真实工具恢复。枢纽定位库后或用户给出库路径时使用。触发词：SQLite取证、WAL、freelist、sqlite_query_cli、AMF、CloudData_RECORD。
version: 1.1.1
name_en: SQLite Forensic Exam
name_ru: Глубокая экспертиза SQLite
description_en: >-
  SQLite forensic deep dive on one .db/.sqlite/.mfs/.amf/.dmf/.cmf or CloudData_RECORD: schema, SELECT, WAL/SHM; recover deleted rows
  only with real tools. Use after hub locates the DB or when a DB path is given.
description_ru: >-
  Глубокий разбор одной БД SQLite (.db/.sqlite/.mfs/.amf/.dmf/.cmf или CloudData_RECORD): схема, SELECT, WAL/SHM; удалённые строки —
  только реальными инструментами. После локализации hub-ом или при заданном пути.
---

# Performing SQLite Database Forensics (Qiko)

## Default rhythm

```text
hub locate path (if needed) → lock THIS one db_path → schema if needed
  → question-driven SELECT → close-out (or hand back to exam skill for sheet format).
Do not page entire tables without predicates. Tool shapes → hub tool-call-recipes.md §2–§3 + Solve rhythm.
```

**You must call tools.** Prefer recipes in `../qiko-forensic-lite-investigate/references/tool-call-recipes.md` §2–§3.

## When to use this (and when not)

**Use when** the target is one database file / one `.mfs` (or `.amf` / `.dmf` / `.cmf` / `CloudData_RECORD*`) table family. Prefer `sqlite_query_cli` with built-in keys — do not pass `no_key` for encrypted forensics DBs.

**Do NOT use** as whole-exhibit triage → `qiko-forensic-lite-investigate` first. Stay on **one** DB; do not fan out to sibling App stores from this skill.

## Navigation

```text
qiko-forensic-lite-investigate (locate path)
  → THIS SKILL — call sqlite_query_cli
  → exam skill for answer-sheet formatting if needed
```

## Tool calls (required sequence)

### 1. Resolve `db_path`

- From hub / CASE STATUS / dbDir card / user path.
- If SmartQuiz map exists and path unclear:

```json
{ "query": "<app or IntegrateForensics or table hint>", "limit": 5 }
```

(`search_forensic_result_map` — do not paste full map to user.)

### 2. Schema

```json
{
  "db_path": "<absolute file path>",
  "sql": "PRAGMA table_list",
  "max_rows": 100
}
```

```json
{
  "db_path": "<absolute file path>",
  "sql": "PRAGMA table_info('TargetTable')",
  "max_rows": 100
}
```

For plain app SQLite (not forensics-keyed `.mfs`):

```json
{
  "db_path": "<path>",
  "sql": "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  "no_key": true,
  "max_rows": 100
}
```

### 3. Live rows (question-driven)

```json
{
  "db_path": "<path>",
  "sql": "SELECT col1, col2 FROM TargetTable WHERE <predicate> LIMIT 50",
  "max_rows": 50
}
```

Decode timestamps only from actual column values returned by the tool.

### 4. WAL / SHM

```text
bash `ls` beside the DB for *-wal / *-shm
```

If present, note them in 溯源. Deleted-row / freelist recovery: only with a **real** available CLI/script this turn; otherwise report live rows only and state that recovery tools are absent — **do not invent** recovery output.

### 5. Field enums (SmartQuiz)

When codes need expansion and the tool exists: `search_forensic_field_enum` (do not dump full enum tables to the user).

## Output

| Field | Required |
|-------|----------|
| Answer | Yes |
| `db_path` | Yes |
| SQL / table / predicate | Yes |
| Tool name | `sqlite_query_cli` (or map/enum tool used) |

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
