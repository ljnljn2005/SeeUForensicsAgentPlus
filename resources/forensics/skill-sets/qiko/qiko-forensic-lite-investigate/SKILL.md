---
name: 整检材通查分析
description: 整检材/整卷优先通查分析：调用 ForensicLite 与相关工具做第一遍分流，并按检材类型指引 Read 专项技能（不预挂全部技能）。聊天/账户等已解析结果在本技能内用 fl_* / sqlite 直接答。
version: 1.4.4
name_en: Whole-Exhibit Lookup Analysis
name_ru: Сквозной анализ носителя
description_en: >-
  First-pass lookup analysis for a whole forensic exhibit via Qiko tools. Routes by exhibit type to
  specialty skills (Read on demand — do not preload all). Answer chat/account questions from parsed
  results here.
description_ru: >-
  Сквозной анализ целого носителя через инструменты Qiko. Маршрутизация к узким навыкам по типу
  носителя (Read по необходимости — не премонтировать все). Чаты/учётки — из уже разобранных результатов.
---

# Analyzing Exhibits as Structured Cases (Qiko Hub)

Most whole-exhibit questions are answered fastest by **calling** Qiko structured tools (ForensicLite `fl_*`, `forensic_task_manage`, `sqlite_query_cli`, result map), not by walking the raw image in the shell. This skill is the **first pass**. Load recipes from `references/tool-call-recipes.md` (path next to this SKILL.md).

When `forensic_task_manage` / `sqlite_query_cli` are mounted, prefer those built-in surfaces over shell exploration or hand-unzipping; still choose tools yourself from what this turn exposes.

**You must invoke tools.** Reading this file alone is not analysis.

**Do not preload every builtin skill.** The mount block names `BUILTIN SKILLS ROOT` once. When a row below says Read a specialty id, open `{BUILTIN SKILLS ROOT}/{skillId}/SKILL.md` — do not invent home/claude skill paths, and do not inject every skill body.

## When to use this (and when not)

**Use FIRST when** evidence is a whole device exhibit / mounted case / exam set about its contents.

**Stay on this hub** when the ask is answered from already-parsed case results (chats, contacts, accounts, app tables via `fl_*` / `sqlite_query_cli`).

## Skill routing (分流 · Read on demand)

Classify the exhibit / ask, then either stay or `Read` **one** matching specialty:

| If the exhibit / ask looks like… | Stay on hub? | Read this skill |
|----------------------------------|--------------|----------------|
| Phone backup · **plain** chat/account ask (no exam-style ask) | **Yes** — `fl_*` / `sqlite_query_cli` | — |
| Phone + **exam-style ask** (scored question, required answer format, multiple-choice) | Hub prepare/open first | **Then Read** `myos-exam-phone` before final answer |
| iPhone / iPad / iTunes / `var/mobile` / Apple ID path map | Hub locate first | **Read** `ios-mobile-forensics` |
| Computer · plain parsed ask (no exam-style ask) | **Yes** | — |
| Computer + exam-style ask | Hub prepare first | **Then Read** `myos-exam-computer` |
| Server CTF / Linux service exhibit | Prefer hub files first | **Read** `forensics-exam-server` |
| One exported **APK** runtime / dynamic | After locate/export | **Read** `apk-dynamic-forensics` (never bash-inflate `AndroidManifest.xml`) |
| APK static reverse (no whole-case need) | After locate/export | **Read** `apk-reverse`; jadx MCP only if already in tools (never DIY Manifest / invent mcp__) |
| One `.pcap` / `.pcapng` | After locate/export | **Read** `forensic-network-pcap-exam` |
| Memory dump (`.mem` / `.raw` / `.dmp`) | After locate/export | **Read** `forensics-memory-exam` |
| One DB / WAL **deep recover** (freelist/WAL carve) | After locate | **Read** `forensic-sqlite-exam` |
| Plain table/row on known `.mfs` (no exam-style ask) | **Yes** — `sqlite_query_cli` | — |

**Exam-style rule:** when the ask looks like a scored exam/contest question (required answer shape, options, or explicit “solve this exhibit question”), **do not** finish on hub alone — after hub prepare/open, **immediately** Read **ONE** matching specialty (`myos-exam-phone` / `myos-exam-computer` / `forensics-exam-server` / `ios-mobile-forensics` / …) via `{BUILTIN SKILLS ROOT}/{id}/SKILL.md`, then follow **that** skill’s shortest chain to close-out. Hub must not submit the final answer sheet.

**Anti-shotgun (all surfaces):** do **not** open every App `.mfs` with parallel `PRAGMA` / `TBL_DATA_INDEX` walks. Lock a primary evidence domain first (stem app / Platform / known card). Unrelated stores are for **limited** exclusion only after the primary chain misses. Specialty skills must **not** re-embed full Chain A/B/C JSON — tool shapes live only in `references/tool-call-recipes.md`.

More hand-off shapes: `references/tool-call-recipes.md` §5. Also follow **Solve rhythm** in that file.

## Navigation

```text
THIS HUB — call Qiko tools (parsed results)
  → stay here for chat / account / table questions
  → Read ONE domain/specialty skill from the routing table when needed
  → never inject the full skill catalog
```

## Mandatory: load recipes then call

1. `Read` this skill directory’s `references/tool-call-recipes.md`.
2. Pick surface from §0 of that file (what tools the turn actually exposes).
3. **Global Q&A / Investigation with `fl_search` / `fl_query_rows`:** prefer **Chain C** as the default reference (still guidance, not a fixed script).
4. **Keyword clues on aggregate / huge trees** (group names, accounts, phones buried in deep chat/log leaves): also `Read` `references/locate-then-deep.md` and follow it — **locate with search first, then deep `fl_query_rows`; do not rely on stratified samples alone**.
5. **Choose tools yourself** from the recipes — chains below are guidance, not a fixed script. Prefer the shortest path that yields citable rows.

## Chain A — Cowork / case (`forensic_task_manage` present)

Typical order (skip steps already satisfied by CASE STATUS):

1. `forensic_task_manage` → `list_workspaces` (or use CASE STATUS workspace id).
2. If case exists: `open_workspace` with `workspaceId`. If mountOk → **stop submitting jobs**.
3. If new path: `ensure_workspace` → `import_evidence` → `submit_job` → poll `get_job_status` until done.
4. Or `prepare_investigation` when that is the documented Cowork entry.
5. Locate `.mfs` via CASE STATUS / Exhibit paths / known dbDir cards first — not by bash-walking `os/.../data`. One-level `ls`/`read` only if paths are missing.
6. If the ask is exam-style: **Read ONE** specialty now (routing table) before broad querying.
7. `sqlite_query_cli` with absolute `db_path`; use `PRAGMA table_list` only after `db_path` is known. Prefer targeted `SELECT` (see recipes **Solve rhythm**).
8. Answer from CLI rows with 溯源; if one file artifact remains, hand off (Navigation table). Plain (non-exam) asks may close on hub; exam-style closes only after specialty.

Example start:

```json
{ "action": "list_workspaces", "limit": 50 }
```

## Chain B — SmartQuiz / map (`search_forensic_result_map` present)

Typical path (reorder/skip when you already have a `.mfs` / card path):

1. `search_forensic_result_map` with a focused `query` (app / IntegrateForensics / Platform / leaf name). **Do not** dump the map to the user.
2. `sqlite_query_cli` on the hit `db_path` / card path.
3. If `fl_search` is also present, use Chain C for keyword hits; prefer map+CLI when db path is known.
4. Close with ```smart-quiz-result``` when that contest format applies; else cite table/path.

Example:

```json
{ "query": "MApps", "limit": 5 }
```

```json
{
  "db_path": "<absolute .mfs from hit or card>",
  "sql": "PRAGMA table_list",
  "max_rows": 50
}
```

## Chain C — FL sandbox (`fl_search` / `fl_query_rows` present)

Typical path (pick the fewest tools that yield citable rows):

1. **If the user gave a hard keyword / entity** on a large or aggregate anchor: `Read` `locate-then-deep.md` (same `references/` folder) and follow **locate → lock chain → deep query**. Do not answer from stratified prefetch alone.
2. `fl_search` with a hard keyword (`q`).
3. On hit buckets: `fl_query_rows` with `nodeId` + optional `search` / `rowId` (no blind paging). Folders deep-drill with a budget toward leaves that have rows.
4. Files: `fl_list_files` → `fl_entry_info` → `fl_entry_preview`. **Evidence voice/video/image** (`.amr`/`.mp4`/`.jpg` abs path on the anchor): `fl_understand_chat_media(attachmentPath=…)` or built-in `read` — never install whisper / long bash transcode loops.
5. **Chat media (image / voice / video / document):** copy full `FILE_PATH` / `attachmentPath` → `fl_understand_chat_media`. Prefer multimodal: if it returns paths, **read** them (images/frames/audio/video). Voice may also show `语音转写=`; video fallback is keyframes. Never pass a directory; never `fl_search` product-brand keywords for visual Q. Legacy `fl_describe_chat_attachment` / `fl_transcribe_chat_audio` still work.
6. Time questions: `fl_timeline_query` / `fl_timeline_aggregate` only inside timeline sandbox.
7. If you need SQL on a known `.mfs`, still call `sqlite_query_cli`.

Example:

```json
{ "q": "微信", "limit": 20 }
```

```json
{
  "nodeId": "<from search hit>",
  "index": "2-MApps.idx",
  "search": "微信",
  "page": 1,
  "pageSize": 20
}
```

## Chain D — MYOS MCP present (exam)

Follow `myos-exam-computer` / `myos-exam-phone` for MYOS calls (`health_check_dbus`, `load_case`, `sqlite_query`, …).  
If MYOS result is incomplete and `sqlite_query_cli` / `fl_*` are also exposed, continue with Chain A/B/C — do not invent MYOS tools that are not listed.

## Hard stops

- No archive unpack of disk / VMDK images.
- Call **only** tools listed this turn; never invent tool names or fake `fl_*` / CLI actions.
- Exhibit read-only; derived files only in workspace.
- No answer from old contest memory without a tool result this turn.

## Output

- Cite **tool + path/nodeId/table + predicate**.
- State hand-off skill id when leaving the hub.

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
