---
name: 手机取证答题
description: 手机取证/比武答题：Android/iOS 镜像与备份、应用沙箱、SQLite/Plist/LevelDB 等。优先平台结构化结果，不足再回源原始证据，禁止凭旧键猜测。
name_en: Phone Forensics Exam
name_ru: Мобильная экспертиза (экзамен)
description_en: >-
  Phone forensics exam playbook for Android/iOS images, backups, and app sandboxes. Prefer
  structured platform results; if incomplete, return to raw evidence with real tools — never guess
  from stale keys.
description_ru: >-
  Плейбук телефонной форензики: образы/бэкапы Android/iOS, песочницы приложений,
  SQLite/Plist/LevelDB. Сначала структурированные результаты платформы; иначе — сырые
  доказательства, без догадок по старым ключам.
---

# Phone Forensics Exam Quick Answer Playbook

## Default rhythm

```text
hub prepare (if needed) → lock primary evidence domain
  → targeted query → format close-out.
Do not shotgun unrelated App stores. Tool shapes → hub tool-call-recipes.md (SSOT).
```

## Navigation

```text
qiko-forensic-lite-investigate (hub, if exhibit not yet structured)
  → THIS SKILL (phone exam chain)
  → forensic-sqlite-exam (single DB / WAL deep dive)
  → ios-mobile-forensics (iOS path map / templates)
  → apk-dynamic-forensics (runtime APK only)
```

Goal: answer phone forensics exam questions quickly with verifiable evidence. **You must call tools to collect evidence**; never submit from memory.

Default workflow:

```text
Parse questions & build index → platform/Qiko structured hit on PRIMARY domain
  → Gates → source-verify if needed → answer in required format → pre-submit review
```

Shared call recipes (JSON shapes, Chain A/B/C): `../qiko-forensic-lite-investigate/references/tool-call-recipes.md` — follow **Solve rhythm** there. **Do not** re-embed full recipe JSON in this skill.

## Tool Call Entry Points (per exposed tools this turn)

### MYOS MCP visible

Prefer: `load_case` / phone forensics task / `sqlite_query` (match actual MCP schema). Then apply **Default rhythm** + gates below.

### SmartQuiz / Qiko visible (required when MYOS is absent or insufficient)

**Order — do not bash-ls the whole `os/` tree; do not PRAGMA every App `.mfs`.**

1. Material DB card / known `.mfs` for the **stem’s primary app/domain** → `sqlite_query_cli` (recipes §2–§3 / Solve rhythm).
2. Path unclear → `search_forensic_result_map` with a **focused** query (one app / leaf family); do not quote the full map to the user.
3. Stem mentions enum codes → `search_forensic_field_enum` then filter.
4. `fl_search` available → **one hard token per question**, then `fl_query_rows` on hits.
5. **Platform / MApps miss for an app the stem names:** do **not** invent that app’s tables on `Platform.mfs`. Locate the app’s own `.mfs` or native DB from the exhibit, then CLI / `forensic-sqlite-exam`.
6. Single-DB deep dive → `forensic-sqlite-exam`; iOS path templates → `ios-mobile-forensics`.

Do not treat this skill as an answer bank. Old exam write-ups are reference only for approach—not evidence for the current questions.

## Reference Map

| Reference | Read when | Purpose | Skip when |
| --- | --- | --- | --- |
| `../qiko-forensic-lite-investigate/references/tool-call-recipes.md` | Need concrete Qiko/FL/CLI parameters | Executable tool calls | This turn has only MYOS and already closed |
| `references/question-routing.md` | Platform has no answer, unfamiliar question type, specialty item | Choose high-probability evidence paths | Low-risk platform hit and gates pass |
| `references/app-artifacts.md` | Specific app, system structure, raw sandbox involved | Locate DB, table, field, file | Platform answer alone is enough |
| `references/pitfalls.md` | Time, statistics, multi-select, deletion, conflict, close options | Error-prevention review | Ordinary low-risk item |

## 1. Three-Layer Answer Priority

Work in this order. This skill is platform-neutral, but when the current agent environment exposes MYOS MCP, MYOS is the preferred platform workflow; without MYOS, use whatever other forensics platform, structured results, exported databases, or raw exhibit access is available.

1. **Forensics platform / structured results first; MYOS first when available**  
   Start with whatever forensics platform, structured parse output, or evidence database the environment provides. When MYOS MCP is available, call MYOS first to run platform parsing or load already-parsed results. If a MYOS case, parsed exhibit, result DB, other platform export, or structured database already exists, load/query it—do not re-run forensics. Prefer answers from platform-parsed device info, app list, accounts, chat, SMS, email, browser, photos, location, wallet, deleted records, and statistics.

2. **Source-verify raw evidence pointed to by platform results**  
   When platform hits but the item is high-value, easily confused, requires exact format, or the platform only gives a clue, return to sqlite hints, raw databases, config files, media EXIF, wallet state, file paths, and time fields for verification.

3. **Limited expansion after primary-domain miss (not a full-device sweep)**  
   When the primary domain (stem app / Platform leaf locked in Default rhythm) has no answer, do **not** stop at "pending" and do **not** open every App `.mfs` in parallel. Expand in order: (a) Read `references/question-routing.md` for the question type’s next high-probability path; (b) `references/app-artifacts.md` for that app’s tables/files; (c) at most **1–2** secondary domains for exclusion or alternate store; (d) specialty tools actually mounted this turn when the type needs them (OCR, sqlite deep dive, iOS path map). Prefer high-probability routes from phone-forensics knowledge; **forbid** blind full-disk / all-App schema walks. Only after those bounded paths fail, output `unconfirmed/needs review` with paths checked. Never answer from common sense, old keys, or similar nicknames alone.  
   For conflict / stats / time / multi-select / deletion, also Read `references/pitfalls.md`. If `question-routing.md` is missing, use Section 3 evidence routing + `app-artifacts.md`.

When platform tools are unavailable, start at layer 2 on raw evidence and note in remarks that platform parsing was not used. When MYOS is unavailable but other platform exports exist, do not skip the platform layer—use those structured results as leads first.

## 1.1 Lightweight Capability Closure When Platform Has No Answer

When platform output is empty, incomplete, clue-only, or fails gates, do not reply "no answer/pending" immediately. Judge whether the question type needs specialty capability, and run only lightweight capability confirmation.

Confirm capability from what is **actually visible and callable** this runtime: exposed tools/connectors, loaded skill docs, directly accessible files/databases, runnable local programs, platform exports, or explicit system notes. Do not assume a tool exists; do not invent tool names. If capability is insufficient, the type truly needs specialty tools, and user authorization or platform rules allow it, you may search online, install, or invoke trusted tools—prefer lightweight, common, verifiable sources; record tool name, source, version/command, and purpose. Downloaded or installed tools may only touch working copies, export copies, or temp dirs—never modify the original exhibit.

Common triggers:
- Images, screenshots, receipts, bills, chat screenshots, wallet screenshots: if OCR, image text recognition, or vision capability exists, call it; otherwise check media library, filenames, EXIF, thumbnails, cache paths, and contextual records.
- APK, Manifest, smali, code logic: if jadx, apktool, aapt, or decompile capability exists, call it; otherwise check package name, Manifest, strings, file structure, and platform app info.
- SQLite, Plist, JSON, XML, LevelDB, WAL/SHM: prefer available DB or structured-file parsers; otherwise degrade to file search, field names, keywords, and raw content analysis.

When a capability directly relevant to the stem is callable, invoke it and record the source; when none matches, continue with raw exhibit, app sandbox, system libraries, cache, logs, exports, and phone-forensics knowledge; search/install trusted tools only when necessary and permitted. Only after primary paths, available capabilities, and necessary degraded paths are checked with no closure, state missing capability, paths checked, and why unconfirmed.

Closure loop:

```text
Classify question type -> Reuse known capability inventory -> Call matching existing capability -> Search/install trusted tools if needed and allowed -> Record tool source and evidence source -> Answer or explain why not closed
```

## 1.2 Platform Candidate Answer Gates

Platform output speeds work but is not automatically the final answer. First write MYOS or other platform output as **candidate answer + location clue**, then run gates, routing, and source-verify:

```text
Platform candidacy -> Gate validation -> Risk routing -> Evidence source-verify -> Closed submit
```

Three gates:

1. **Stem-match gate**: Candidate must match stem-limited field, object, time range, statistical scope, and option mapping. Different field names, similar-but-not-same objects, or unconfirmed option value/letter → do not submit directly.
2. **Evidence gate**: Every final answer must trace to a concrete source—database, table, field, file, record ID, EXIF, Plist, config key, or raw path. Platform summary alone without source field or location → do not submit; high-risk items must close on raw DB, raw file, or raw field.
3. **Risk gate**: Statistics, time, multi-select, amounts, EXIF/GPS, deletion, wallet, app version, device identifiers, file paths, named objects, same-name objects, app multi-account/historical login, cloud sync/import data, notification/OCR/screenshot content, container/App Group confusion, WAL/SHM conflict, platform field name differs from stem field, candidate close to multiple options, etc.—default to source-verify review.

Gate results must use fixed format—do not write only "pass":

```text
stem_match=pass/suspect/fail; evidence=pass/suspect/fail; risk=low/high; verdict=direct-submit/source-verify/defer
```

Low-risk platform hits default to one-line closure—do not expand full candidate table:

```text
Question # | Answer | Source location | verdict=direct-submit
```

Source location is satisfied by any traceable: platform structured record ID/detail page, source table field, database, file, raw path, record ID. Platform natural-language summary, category tag, or display value alone does not count. Expand candidate table and answer-evidence table only for high-risk, conflict, gate failure, or when user asks for process.

When platform candidate, stem options, and raw fields cannot close, do not submit because it is "closest to an option"; mark `defer` and explain conflicting sources.

Evidence trust hierarchy:

```text
Raw file / raw DB field > DB+WAL/SHM joint result > Platform structured table > Platform summary / NL classification > Old write-ups / memory
```

When platform answer conflicts on field mapping, timezone, statistical scope, deletion classification, cache treated as real record, export path treated as raw path, etc., downgrade to clue and source-verify to close.

Routing rules:

| Verdict | Condition | Action |
| --- | --- | --- |
| direct-submit | Low-risk; platform hit; unique stem object; same field name or explicit mapping; no time/stat/multi-select/deletion/path/version/device-ID/same-name risk; platform locates source record or field | Record platform location and minimal rationale; submit |
| source-verify | High-risk; any gate fail/uncertain; platform summary only | Shortest evidence chain by type; submit after closure |
| defer | Primary paths checked; still conflict, missing source field, or cannot close | Mark paths checked, conflict points, next step |

Source-verify validates only the shortest chain that decides the answer—not aimless full deep dives. Stop when stem field, stem object, traceable source, and option/format distinction are satisfied.

Candidate answer table template. `Gate result` and `Verdict` must use the fixed format and enum values above:

```text
Question # | Type | Stem object | Platform candidate | Platform location | Risk tags | Gate result | Source-verify action | Final answer | Verdict
```

## 1.3 Portability / Compatibility

This skill does not depend on a fixed agent or fixed tool names. Whenever the environment provides file, database, forensics platform, or raw exhibit access, execute by capability match: load case, parse exhibit, query overview, run SQLite, search files, read metadata, parse image EXIF.

- **MYOS MCP available**: Prefer MYOS—the fastest path for this skill in a MYOS environment.
- **Other forensics platform or exports**: Query platform results, exported CSV/JSON/SQLite, structured evidence DB, and parse reports first; then source-verify.
- **No platform tools**: Analyze raw exhibit directly—SQLite, Plist, JSON, LevelDB, XML, EXIF, WAL/SHM, file paths, media metadata, app sandbox, iOS/Android backup, keyword hits.
- **Platform has no answer**: Do not stop; continue by question-type routing and app artifact analysis on raw evidence. Mark `unconfirmed/needs review` only after primary paths are exhausted.
- **Cross-platform output**: Do not rely on Codex-specific terms; record which platform/tool/file/field was used so answers are auditable.

## 2. Fast Batch Workflow

### 2.0 High-Efficiency Fast Answer Mode

Full exam papers default to speed-first but evidence-closed pacing:

```text
Build index -> Group by exhibit/app -> Platform candidates -> Gate validation -> Risk routing -> High-risk source-verify / no-answer push -> Final review
```

Do not hop question-by-question by number. Convert all items to a `Question index table`, then batch by exhibit and by app/question type. Same app, same database, same evidence class—query once; avoid reopening data sources and re-deriving field meaning.

Three question channels:

- **Fast answer**: Platform direct hit, simple format, low risk, all three gates pass. Record platform location and minimal rationale; submit first—device info, ordinary accounts, contacts, clear SMS, simple calls, etc.
- **Review queue**: Time, statistics, multi-select, amounts, deletion, EXIF/GPS, wallet, app version, device identifiers, file paths, named contacts, or platform result not fully closed with stem/options. Batch return to raw DB, files, EXIF, WAL/SHM, or metadata; for statistics record filter conditions; for time record raw time, converted time, and timezone; for multi-select verify each option.
- **Push queue**: Platform has no answer, structured result empty, platform summary only without source field, or platform candidate failed/uncertain at gates. Enter push queue; LLM continues actual exhibit analysis. On entry run lightweight capability closure once; reuse capability state already confirmed for this case/exhibit; only re-confirm when a new specialty need appears. If a directly relevant callable capability exists, prefer calling it; if not called, record why. Read `references/question-routing.md` for high-probability paths; if missing, use Section 3 routing and generic source-verify routes in `references/app-artifacts.md`; then locate app/system traces as needed—prefer app sub-DBs, system libraries, config, screenshots, cache, notifications, WAL/SHM, old DBs, keyword hits, image remnants. Push items try highest-probability path first; one degraded path after failure. A "hop" here is one high-probability evidence-path closure attempt—e.g. query named app main DB and filter by stem field; a single filename search, directory listing, or scattered keyword search alone is not a hop. After two hops with no closure, mark `defer/needs review`, record paths and gaps, continue next item, recycle hard items at end. Before paper finish, rescan `Push/pending table`; decide final `unconfirmed` from three checks—unused real capabilities, unused highest-probability path, cache-table cross-check possible—not by leaving defer unchanged.

Maintain an evidence cache table for the full paper. After opening any app, database, platform result, or media directory, capture reusable info:

```text
Data source | Answerable Q#s | Key fields | Time scope | Person/account mapping | Verified risk points
```

Later items reuse cache—do not reopen the same DB or re-derive the same field meaning.

Worksheet templates:

```text
Question index: Question # | Exhibit | Person/device | App | Type | Answer format | Keywords | Risk level | Status
Candidate table: Question # | Type | Stem object | Platform candidate | Platform location | Risk tags | Gate result | Source-verify action | Final answer | Verdict
Evidence cache: Data source | Answerable Q#s | Key fields | Time scope | Person/account mapping | Verified risk points
Push/pending: Question # | Type | Required capability | Confirmed capability/degraded path | Evidence checked | Status
Answer-evidence: Question # | Answer | Evidence source | Key fields | Confidence | Notes
```

### 2.1 Parse Questions Into Index

Organize items into a table before searching:

```text
Question # | Exhibit | OS | Person/account | App | Time range | Type | Answer format | Evidence target | Status
```

For batch papers, group by exhibit first, then by app. Multi-person, multi-exhibit papers—guard against question-number mismatch, exhibit mismatch, same-name contact confusion.

### 2.2 Platform Parse Chain (MYOS preferred when available)

When MYOS MCP is available, prefer:

```text
Existing parse: load_case / open_case -> query result overview -> sqlite_query
New exhibit: health_check_dbus -> create_case_and_open / open_case -> add/start phone forensics -> wait/query task -> result summary -> result overview -> sqlite_query
```

Match tool names to current MCP schema; semantic function first; environments may use `myos_forensics_` prefix, compressed suffix, or localized aliases.

If current agent has no MCP or these function names, seek equivalent semantics: load case, import exhibit, query result overview, run SQLite, view raw files, read media metadata, search file content.

Without MYOS MCP but with other platform, export report, or evidence DB, same semantics:

```text
Load existing result/report/DB -> App and statistics overview -> Query structured fields by type -> Source-verify SQLite/file/EXIF/logs when needed
```

Key constraints:
- Do not output final answers before task reaches terminal state.
- When `messageNeeded` or password interaction exists, handle interaction first; do not re-launch the same forensics task.
- App statistics, `sqliteQueryHints`, `MApps.mfs`, app sub-DBs from result overview are fast location entry points.
- When platform summary answers directly, record summary fields; when summary is clue-only, continue to raw DB or file.

### 2.3 Platform Result Quick Search Checklist

Search platform parse results first for candidates and location clues:

```text
Device info, SIM/IMEI/ICCID, app version, accounts, contacts, calls, SMS, WeChat, WhatsApp, email, browser, photos/video, location, Wi-Fi/hotspot, wallet, deleted records, statistics
```

If not found, run raw evidence follow-up—do not skip platform parse and guess wholesale. After hit, run three gates; failed/uncertain candidates go to review/push—not direct submit.

### 2.4 Tiered Review

- **Low-risk**: Platform direct hit, simple stem format, unique stem object, same field name or explicit mapping, no statistics/time/multi-select/deletion/wallet/EXIF/version/identifier/path/named-object/same-name elements, and stem-match, evidence, and risk gates all pass—fast answer OK, still record platform field source.
- **High-risk**: High-value items, time, statistics, multi-select, deletion, wallet, EXIF/GPS, app version, device identifiers, file paths, named objects, same-name contacts, platform result close to but not matching options—must source-verify on raw DB, files, or metadata.

## 3. Evidence Routing

| Type | Platform-first entry | Raw evidence review entry | Pitfalls |
| --- | --- | --- | --- |
| OS version/model/build | Device info | System property DB, Contents.db | Do not confuse model code vs display model |
| IMEI/ICCID/SIM | Device/SIM info | telephony/subscriber/system profile | Output digits-only or full string per stem |
| App version | App list | package metadata, Info.plist | Distinguish versionName vs versionCode |
| Account/ID | Account parse result; for health/fitness owner ID prefer platform tree `运动健康` / `*运动` / `机主账号` (then `fl_search`) | preferences, MMKV via `getMMKV*`, login records; sideline apps only for cross-check | Distinguish current vs historical vs last-login; do not treat wallpaper/launcher sideline hits as sole source when platform owner-account node exists |
| Contacts | Address book parse | contacts/people tables | Same-name contacts—cross-check phone/email |
| Call count | Call log parse | call log | Clarify direction, contact, time range, dedup |
| SMS verification code | SMS parse | SMS/MMS/Contents.db | Verify sender, app name, receive time |
| WeChat/WhatsApp | App message parse | message/session/attachment tables, media dirs | Verify parties, direction, time, type |
| Email | Mail parse | mail database/header | Clarify folder, direction, date boundary |
| Browser | Browse history parse | Safari/Chrome History | Do not mix title and URL |
| Photo count | Media parse | Photos.sqlite, MediaStore | Capture time vs import time vs file time differ |
| EXIF/GPS | Media metadata parse | Raw image EXIF | Coordinate order, decimal places, timezone |
| Screenshot | Media category/path | Screenshots path, MediaStore | Screenshots usually lack real capture EXIF |
| Database filename | App parse path | App directory structure, raw DB | Output case per stem |
| Wallet account/transaction | Wallet parse result | MetaMask persist-root, state, transaction | Account dedup, address, token, time, status |
| Deleted records | Delete/recovery parse | WAL, freelist, delete flags, remnant files | Distinguish deleted message vs cache vs recovery remnant |

## 4. App Quick-Lookup Rules

### WeChat

- Start with platform-parsed WeChat accounts, contacts, sessions, messages, attachments.
- Raw review often uses `EnMicroMsg.db`, `MM.sqlite`, preferences, message tables, contact tables, attachment dirs.
- Confirm chat parties via wxid, phone, remark, session id, or message fields—not nickname alone.
- Image-count items: distinguish sent, received, attachment cache, album-saved copies.
- Deletion items: state delete flag, recovery source, message type.

### WhatsApp

- Start with platform-parsed accounts, contacts, messages, media.
- Raw review often uses `msgstore.db`, `wa.db`, Media directory.
- Account often phone number; version items distinguish versionName vs versionCode.
- Message type via message_type, media_wa_type, mime_type, or platform mapping.

### Browser

- Page title items: platform-parsed title first, then History.
- Search terms from URL query, keyword_search_terms, history title.
- When counting site-related records, fix scope first: URL row count, visit count, unique domain, or stem option.

### Media & EXIF

- Start with platform-parsed photos, video, GPS, capture time, device model.
- Raw review prefer EXIF DateTimeOriginal, Make, Model, LensModel, GPS.
- Same-photo judgment: compare hash, dimensions, EXIF, asset id, thumbnail relation.
- Live Photo needs main image and companion video together.

### Wallet

- Start with platform or app parse for accounts, transactions, tokens, errors.
- Raw review often MetaMask `persist-root`, Redux state, account list, transaction state.
- Account count by unique account address—do not count tokens as accounts.
- Failed transaction reason from status/error text first—e.g. insufficient funds/gas.

## 5. Uncertainty & Conflict Handling

- Insufficient evidence → output `unconfirmed` or `needs review`; do not guess hard.
- Low-confidence items must state reason and next follow-up path.
- Platform summary vs SQLite vs raw file metadata conflict → raw evidence field wins; note conflict source in Notes.
- Time conflict: list raw time, converted time, and timezone assumption together.
- Statistics conflict: recheck filters—date boundary, direction, contact, include deleted/cache/dup records or not.
- Stem, options, platform, and raw evidence do not close → do not pick closest option. Use conflict record format:

```text
Evidence answer | Submittable option | Conflict reason | Raw field | Platform field | Stem/option concern
```

If a submittable answer is required, prefer the option best supported by raw evidence and mark conflict.

## 6. Output Format

When user only wants answers, give compact list first for fast entry:

```text
1. <answer>
2. <answer>
3. ...
```

When review needed or large paper, add evidence table:

```text
| Question # | Answer | Evidence source | Confidence | Notes |
| --- | --- | --- | --- | --- |
| 1 | <answer> | <platform result/DB/file/field> | high/medium/low | <format, timezone, or conflict note> |
```

Single-item output:

```text
Question #:
Answer:
Evidence source:
Key fields:
Verification:
Confidence:
Needs review:
```

## 7. Pre-Submit Review

Quick checks before submit:

- One-line low-risk closures: quick check question #, answer format, source location; full checklist for high-risk, conflict, push items.
- Question numbers not misaligned.
- Exhibit, person name, account not mixed.
- Answer format matches stem.
- Multi-select: each option verified.
- Time items: UTC vs local confirmed.
- Statistics items: filter conditions recorded.
- Media items: original vs thumbnail vs cache vs export copy distinguished.
- Wallet items: account, address, token, time, status verified.
- Deletion items: deleted record vs cache vs recovery remnant distinguished.
- Low-confidence items not hard-guessed; pending review path written.
- Platform no-answer, incomplete result, or push items: specialty capability or degraded path recorded; if obviously relevant capability exists but was not called, do not mark simple "pending"—state why not called.

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
