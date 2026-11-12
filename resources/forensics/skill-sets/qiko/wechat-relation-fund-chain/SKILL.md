---
name: 全案关键线索研判
slug: wechat-relation-fund-chain
version: 1.3.8
description: 产出全案关键线索研判报告（覆盖全部挂载检材）：深抽即时通讯与系统日志、案型加权检索、跨检材碰撞；证据链须有硬动作。触发词：研判分析、证据链、资金链路、人物画像。
agent_created: true
disable: false
name_en: Full-Case Key Clue Analysis
name_ru: Ключевые улики по всему делу
description_en: >-
  Produce a full-case key-clue report across all mounted exhibits: deep IM/system-log extraction,
  case-type weighted search, cross-exhibit collision; evidence chains need hard actions. Triggers:
  judgment analysis, evidence chain, fund trail.
description_ru: >-
  Отчёт по ключевым уликам всего дела: глубокое извлечение IM и системных логов, межносительные
  коллизии, цепочки доказательств с жёсткими действиями.
---

# Full-Case Key Clue Analysis

Goal: After JSON rendering, deliver a **full-case key-clue overview** (accounts / relationships / funds / entry points / provenance across **all** mounted exhibits) — not an exhibit catalog, not "N records total", and not a narrow topical slice of a few people or Apps. Keep the first screen fast: only verified important facts; leave detail for follow-up rewrite.

## High-Value First (Do Not Write Noise)

Only accept material useful to the investigation. Ban treating counts, filenames, or generic App names as analysis:

1. **Contact remarks / friend tables** = ledger: brands, account sales, service names, IPs, phone numbers often live in remark text. SMS/address-book display names (apple/WeChat) are not an org chart.
2. **Must drill into IM message text**: transfers, passwords, USDT, top-up addresses in group/private chats; "People Nearby" is weak identity only — not an evidence chain. Without original text, write follow-up investigation — do not treat counts as KPI.
3. **Deep-extract system logs**: power on/off, unlock, app usage — pin presence and high-risk App windows. Ban writing only "system logs exist".
4. **Cross-exhibit collision**: Same email / number / IP on multiple exhibits must be written as a "collision" lead and enter evidence-chain items — ban single-device retelling only.
5. **Cross-App identity contrast**: Chengxin × QQ × WeChat etc. on the same device — write as separate rows; do not merge into one natural person without cross evidence.
6. **Assets with provenance**: Server IPs, URLs, account credentials, payment wording; each item needs app / time / source.
7. **If there is an account/email, there must be an evidence chain**: person → account → source. Ban empty tables saying "cannot build yet". Without chat text / credentials / IP·URL / fund actions, ban promoting "People Nearby" or "only found a group name" into a core chain.
8. **Role tags**: Profile tags may use "suspected entry ops / fund desk / tech / core cadre" only when supported by clue-pack provenance — ban inventing from nicknames.
9. **Timeline = actions only**: chat / transfer / credentials / IP change / account backup / unlock. Ban padding with Cookie, YouTube, Xiaohongshu shopping searches, mailbox registration confirmations.
10. **Empty DB / needs deeper dig**: App with no original text extracted → followUp / appendix; do not pretend it was reviewed.

## Exhibit Typing (Do This First)

Distinguish by `evidences[].domain` / exhibit name. Ban mixing one writing style across types.

### Mobile Exhibits

Mandatory drill-down (if present, must enter cover / evidence chain / profiles — ban "N records total" only):

- **IM**: accounts, **contact remarks / friend tables**, **chat original text** (time / direction / peer / transfer talk / red packets / passwords / renewals / IP changes)
- **Browser**: history, search terms, bookmarks, downloads (activity and intent)
- **System logs**: power on/off, unlock, app usage (routine and presence)
- **Email**: senders/recipients, subjects, attachment wording
- **Passwords/credentials**: saved account credentials, login pages
- **Phone info**: local number, IMEI/IMSI, owner (person–device–number)

### Computer Exhibits

1. Use case facts + exhibit name to judge **holder role**, then decide what to examine.
2. **Basic info** is only a person–machine anchor (hostname / logged-in user) — do not turn USB/hardware inventories into analysis.
3. Role focus:
   - **Finance**: ledgers, spreadsheets, expense claims, fund wording, invoices, finance software
   - **Tech**: scripts/source, remote/VPN, configs, system account credentials, operation traces
   - **Business**: customers, contracts, email, IM, quotes
   - **Unknown**: account credentials + email + document leads; do not invent a job title

## Division of Labor vs Intrusion Exhibit Analysis

- **Intrusion / malware / Prefetch·remote-control traces / intrusion timeline / executable tagging** → use `intrusion-case-forensics`; this skill consumes its outputs (IPs, program names, remote sessions, hashes, etc.) as anchors for collision and org charts.
- **Full-case relationships, funds, IM original text, org charts, person profiles** → this skill; do not write a conflicting adjudication narrative inside the intrusion skill.

## Tools (caseAnalysis Pi)

When this skill runs on the case-analysis channel: use `read` / `write` / `bash` / `edit` / `sqlite_query_cli` only. Prefer host clue digest and listed DB paths.

## Hard Principles

1. **Core clues first**: accounts, relationships, fund wording, entry points, talk scripts, provenance. Ban filename lists, pure counts, registration-info parroting.
2. **Business identity ≠ natural person**: without cross evidence, do not merge nicknames / customer-service accounts / server accounts.
3. **Amount tiering**: chat claims ≠ verified loss; mark confidence and supplemental evidence needs.
4. **Every item has provenance**: `src` / app name / hub path / search hit.
5. **If the index has it, use it**: `evidenceLens`, `cluePack`, `coreClueHints`, `forensicsSignals`, `searchHitLines`, case brief; **IP / URL / remarked accounts** in the clue pack must be digested into cover KPIs, org chart, or evidence chain.
6. **No fabrication**: do not invent specific numbers/amounts/URLs absent from the index.
7. **Do not reuse external real case names**.
8. **First-screen restraint**: cover / evidenceChain only the hardest 2–3 chains; leave full account/IP tables for follow-up — do not dump tables on the first screen.

## Report Tone

- Title is **full-case analysis**: `×× Case Judgment Report` (use case name / case type). Ban "someone's device + IM/Xiaohongshu + topical slice"
- Subtitle summarizes hard clues across **all exhibits**, not one App
- Cover label: `CASE EVIDENCE REPORT · keywords`
- meta / KPI need concrete values (e.g. "verified IP count", "sold-account wording"), not empty case-nature words
- Org-chart nodes carry **Evidence: …**
- Evidence-chain steps are **clue actions** (pass password / change IP / renew), not "open exhibit"; when multiple exhibits have material, chains must cross exhibits — do not shrink into a single-App skit

## Chapter Playbook (SmartQuiz JSON)

### cover

`title` (`×× Case Judgment Report`) / `subtitle` (one-line full-case hard clues) / `docLabel` / 6-cell `metas` / `riskTags` / business-oriented `kpis` (IP/account/counterparty counts OK).

### evidenceChain

- `chains` 2–3 items; `tone`: core chain / trade chain / ops chain
- `items`: short excerpts of IP/URL/credentials with provenance (write when present; render under the chain)
- Ban: fixed exhibit → parsed count → identify review domain

### basic

Cross-App identity contrast as kv rows (account / nickname / signature / bound phone / login locale); local number as anchor.

### org

`root` upstream (service / card-secret party) → `mid` local ops identity → `down` clustered by brand or line; nodes must carry `src`.

### profiles / timeline / lossRisk / followUp / appendix

- Profiles: 1–2 hard cards; multi-App as separate rows
- Timeline: only hard actions with timestamps
- Funds: renewal/top-up tiering + supplemental-evidence table
- Follow-up: empty-DB Apps and exhibits needing deeper dig first
- Appendix: exhibit × App coverage (has data / empty / needs deeper dig)

If clues are thin, write sparsely or empty arrays; fill on follow-up. Put uncertainty in the appendix.

## Compliance

Lawfully authorized exhibits only; AI assistance requires human verification; quantitative conclusions mark supplemental-evidence boundaries.

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
