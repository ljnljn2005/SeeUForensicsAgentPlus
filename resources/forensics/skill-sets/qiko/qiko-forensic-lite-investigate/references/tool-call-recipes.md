# Qiko tool-call recipes

Use **only tools visible in the current turn**. Never invent names. Prefer the JSON shapes below.
Chains are **guidance, not a fixed script** — pick the shortest path that yields citable rows.
**This file is the SSOT for tool JSON shapes.** Specialty skills point here; they must not re-copy full Chain A/B/C blocks.

## Solve rhythm (exam / shaped quiz — no stem keyword tables)

Use after hub prepare/open (and after Reading the matching specialty when the ask is exam-style):

1. **Lock primary evidence domain** — one `db_path` / card / app family implied by the stem (chat → that IM `.mfs`; OS product → system-info table; one file hash → that path). Do **not** open every sibling App store first.
2. **Schema only if needed** — `PRAGMA table_info` / `table_list` on the **locked** DB when the target table/columns are unknown. Never use schema walks as a substitute for locate.
3. **Targeted `SELECT`** — stem entities / time / required fields in `WHERE` / `LIKE`; prefer narrow columns over `SELECT *` dumps.
4. **Close on hit** — when rows cite the answer in the required format, stop and submit with provenance.
5. **Limited exclusion** — at most **1–2** secondary domains, and only after the primary chain misses or needs a negative check. No parallel shotgun of unrelated `.mfs`.

## Shortest path (table / DB locate)

1. **Hard keyword** + `fl_search` mounted → `fl_search(q)` → `fl_query_rows` on hit (`search=` / `rowId`). For huge/aggregate anchors also `Read` sibling `locate-then-deep.md`.
2. **Known nodeId** → `fl_query_rows` directly.
3. **Known `db_path` / card path** → `sqlite_query_cli` (then **Solve rhythm**).
4. **Unknown `.mfs` / table** + `search_forensic_result_map` present → map first, then CLI.
5. **Do not bash-walk `os/.../data`** (or recursive `find`/`ls`) to discover tables. Prefer CASE STATUS / Exhibit paths / map / `fl_search`.
6. **`PRAGMA table_list` / `sqlite_master`**: only after `db_path` is already locked and the table name is still unknown — **not** the default locate path and **not** something to run on every App `.mfs` in parallel.

## 0. Detect which surface you have

| Signal | Surface | Primary tools |
|--------|---------|-----------------|
| `forensic_task_manage` present | Cowork / case | `forensic_task_manage` → `sqlite_query_cli` (+ `list_dir`/`glob_find`) |
| `fl_search` / `fl_query_rows` present | Investigation / SmartQuiz FL sandbox | `fl_*` (+ often `sqlite_query_cli`) — default for Global Q&A |
| `search_forensic_result_map` present | SmartQuiz solve | map → `sqlite_query_cli` |
| MYOS MCP tools (`load_case`, `sqlite_query`, …) | Exam platform | MYOS first, then CLI |
| None of the above | Stop | `ask_user` / state gap — do **not** invent tools or fake `fl_*` / CLI actions |

---

## 1. `forensic_task_manage` — prepare / open case

### 1.1 List existing workspaces

```json
{ "action": "list_workspaces", "limit": 50 }
```

### 1.2 Open an already-parsed case (preferred)

```json
{ "action": "open_workspace", "workspaceId": "<id from list_workspaces>" }
```

If response says mount already OK: **do not** `submit_job` again. Proceed to query.

### 1.3 New exhibit path → workspace → import → submit

```json
{ "action": "ensure_workspace", "caseName": "<short name>", "caseDescription": "<optional>", "forensicDomain": "mobile" }
```

`forensicDomain`: `computer` | `mobile`.

```json
{ "action": "import_evidence", "sourcePath": "D:\\\\path\\\\to\\\\exhibit.e01", "forensicDomain": "computer" }
```

Use **returned** `evidencePath` / `evidenceId` for submit:

```json
{
  "action": "submit_job",
  "evidencePath": "<from import>",
  "evidenceId": "<from import>",
  "forensicDomain": "computer",
  "parseItemLabels": ["系统信息", "即时通讯", "浏览器"]
}
```

Poll:

```json
{ "action": "get_job_status", "jobId": "<from submit>" }
```

### 1.4 One-shot investigation prepare (Cowork)

When the tool guide / CASE STATUS points here:

```json
{ "action": "prepare_investigation" }
```

After success, case dir has `os/.../data/*.mfs` — query with `sqlite_query_cli`, not by unpacking images.

### 1.5 Interaction mid-job

```json
{
  "action": "submit_interaction",
  "jobId": "<job>",
  "interactionId": "<id>",
  "interactionResponse": "<user answer>"
}
```

### 1.6 Hard stops

- Never `7z`/`unzip` disk images or sparse VMDK.
- Never `open_wizard` with `openUi: true` unless user confirmed via `ask_user`.
- Never re-`submit_job` on an already `mountOk` workspace.

---

## 2. `search_forensic_result_map` — locate which `.mfs` / index (SmartQuiz)

Call **before** blind schema probing. Do **not** paste the full map back to the user.

```json
{ "query": "IntegrateForensics", "limit": 5 }
```

```json
{ "query": "MApps 微信", "limit": 5 }
```

```json
{ "query": "Platform", "limit": 5 }
```

Then open the hit’s `db_path` / dbDir card with `sqlite_query_cli`.

---

## 3. `sqlite_query_cli` — read-only query

`db_path` = **file**, not the folder. Supported (built-in keys; do **not** pass `no_key`):

| Path / suffix | Notes |
|---|---|
| `.mfs` / `.mfc` / `.db` / `.sqlite` | Result / index / plain SQLite |
| `.mf` / `.amf` / `.dmf` / `.cmf` / `.bm` | Case / app / device / cloud / mark satellite DBs |
| `CloudData_RECORD*.DB` | Cloud record DB (same CLI, built-in key) |

Directory → auto-pick `Platform.mfs` when present.

Resolve `db_path` from CASE STATUS / Exhibit paths / map / prior hits — **Do not bash-walk `os/.../data`**. Schema probes (`PRAGMA table_list` / `sqlite_master`) only after `db_path` is known.

Schema:

```json
{
  "db_path": "D:\\\\cases\\\\...\\\\data\\\\Platform.mfs",
  "sql": "PRAGMA table_list",
  "max_rows": 50
}
```

```json
{
  "db_path": "D:\\\\cases\\\\...\\\\data\\\\Platform.mfs",
  "sql": "PRAGMA table_info('YourTable')",
  "max_rows": 100
}
```

Data (SELECT / WITH only; no writes):

```json
{
  "db_path": "D:\\\\cases\\\\...\\\\data\\\\2-MApps.mfs",
  "sql": "SELECT * FROM SomeTable WHERE 1=1 LIMIT 20",
  "max_rows": 20
}
```

Plain SQLite (no forensics key):

```json
{
  "db_path": "D:\\\\workspace\\\\chat.db",
  "sql": "SELECT name FROM sqlite_master WHERE type='table'",
  "no_key": true,
  "max_rows": 50
}
```

---

## 4. ForensicLite `fl_*` (only when injected)

**Keyword clues on aggregate / huge trees:** `Read` sibling file `locate-then-deep.md` first — locate with `fl_search`, then deep `fl_query_rows(search=)` along the hit chain. Do not conclude from stratified samples alone.

**Chat media (image / voice / video / document):** copy the **full** `FILE_PATH` / `attachmentPath` from `fl_query_rows` → `fl_understand_chat_media(attachmentPath=…)`. Multimodal first: if it returns absolute paths, immediately `read` them (photo / keyframe JPEGs / wav / small mp4). Prefer row `语音转写=` when present. Video without native video modality uses keyframes (start/mid/end). Do **not** `fl_search` brand keywords; do **not** pass a folder as `attachmentPath`. Legacy `fl_describe_chat_attachment` / `fl_transcribe_chat_audio` remain aliases.

**Evidence-tree voice/video/image** (anchor already has abs path ending `.amr`/`.mp4`/`.jpg`, etc.): same — `fl_understand_chat_media(attachmentPath=…)` or built-in `read`. Never `pip install whisper`, never long bash `cd`/`ffmpeg` probe loops on the evidence path.

### 4.1 Keyword search (one hard term per call)

```json
{ "q": "13800138000", "limit": 20 }
```

### 4.2 List result-tree children

```json
{ "parentNodeId": "<nodeId>", "index": "2-MApps.idx" }
```

### 4.3 Query rows on a leaf / table node

```json
{
  "nodeId": "<nodeId>",
  "index": "2-MApps.idx",
  "search": "keyword",
  "page": 1,
  "pageSize": 20
}
```

Prefer `search` / `rowId` on large tables — do not page blindly.

### 4.4 Evidence files

```json
{ "q": "WhatsApp", "page": 1, "pageSize": 12 }
```

```json
{ "category": "document", "ext": "pdf", "page": 1, "pageSize": 12 }
```

Then:

```json
{ "entryId": "<id>" }
```

(`fl_entry_info` → `fl_entry_preview` with `mountPath` when present.)

### 4.5 Timeline (sandbox-bound)

```json
{ "page": 1, "pageSize": 30, "keywords": "login" }
```

```json
{ "timeFrom": "<iso>", "timeTo": "<iso>" }
```

(`fl_timeline_query` / `fl_timeline_aggregate` — only inside timeline sandbox.)

---

## 5. Specialty hand-off after hub

**Do not preload all skills.** `Read` only the one id that matches. Parsed chat/account/table asks stay on hub (`fl_*` / `sqlite_query_cli`).

| If… | Next skill (Read on demand) | First move there |
|-----|----------------------------|------------------|
| Phone backup · already-parsed IM/contacts | *(stay on hub)* | `sqlite_query_cli` / `fl_search` |
| Phone exam-style ask | `myos-exam-phone` | per that skill |
| iOS-specific path / Apple ID | `ios-mobile-forensics` | per that skill |
| Computer exam-style ask | `myos-exam-computer` | per that skill |
| Server CTF mount | `forensics-exam-server` | shell read-only |
| `.db` / `.sqlite` / WAL **deep recover** | `forensic-sqlite-exam` | `sqlite_query_cli` |
| Known `.mfs` table/row only | *(stay on hub)* | `sqlite_query_cli` |
| `.pcap` / `.pcapng` | `forensic-network-pcap-exam` | `tshark` if present |
| `.mem` / `.raw` / `.dmp` | `forensics-memory-exam` | Volatility via `run_command` |
| APK runtime / dynamic | `apk-dynamic-forensics` | `apk_*` MCP |
| APK static reverse | `apk-reverse` | per that skill (**never** bash/`zipfile` inflate `AndroidManifest.xml` — zip-bomb hang; jadx MCP only if already in tools) |

---

## 6. Evidence rule

Every closed answer cites: **tool name + path or nodeId/table + predicate**. Derived files only under session workspace; exhibit stays read-only.
