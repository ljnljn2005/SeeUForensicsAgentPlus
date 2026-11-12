---
name: mobile-people-relationship-explosion-map
description: Analyze lawfully obtained mobile-forensic data for a named target person, including WeChat and other app chats, SMS/MMS, call logs, contacts, accounts, device identifiers, locations, payments, media metadata, browser activity, files, notes, calendars, notifications, and app records. Resolve identities across sources, extract evidence-backed personal, family, social, work, company, group, fund, event, and resource relationships, and generate a portable offline interactive relationship explosion map in HTML. Use when Codex needs to turn a phone extraction, forensic export, chat archive, or normalized mobile artifact collection into an auditable person-centric relationship network, layered report, role analysis, or evidence-linked graph artifact.
---

# Build Mobile Forensic Relationship Graph

Generate an auditable target-person relationship graph from full mobile-forensic evidence and a self-contained offline HTML report.

## Workflow

1. Inventory every supplied data source before analysis. Read [references/mobile-forensics-sources.md](references/mobile-forensics-sources.md) and [references/analysis-quality-gates.md](references/analysis-quality-gates.md), enumerate the original archive or extraction directory, then record extraction path, source app/table/file, device and account identifiers, format, raw/parsed/excluded/duplicate/analyzed counts, date ranges, time zone, deleted/recovered state, attachment coverage, integrity metadata, and known gaps.
2. Confirm the named target. Keep devices, SIMs, phone numbers, app accounts, contact-book entries, payment accounts, and natural persons separate until identifiers or independent evidence support merging them.
3. Normalize all artifacts into a common record ledger with source type, participants, direction, original and normalized timestamps, duration, parsed content payload, attachment, transaction, location, device/account identifiers, deleted/recovered state, and stable source-record identifiers. Preserve raw values alongside normalized values and create one `coverage.sourceReviews` entry for every inventory source, including sources that yield no relationship.
4. Deduplicate repeated extraction rows without deleting provenance. Preserve every contributing source ID and distinguish exact duplicates, synchronized copies, recovered/live copies, forwarded or quoted content, and genuinely repeated activity. Never count synchronized copies as independent corroboration.
5. Exhaustively extract candidate entities, events, resources, and relations from structured fields, parsed payloads, message context, attachments, metadata, and cross-source identifiers. Read [references/inference-rules.md](references/inference-rules.md) before assigning relationship types or roles. Preserve unclassified leads and exclusions with reasons; do not equate high frequency with relationship meaning.
6. Classify relationships from evidence semantics, not source type or frequency. A chat, call, contact, or account record is evidence material, not a relationship layer. Assign `event` only when records identify a bounded shared event or a proposal-assignment-execution-confirmation chain. Keep unclassified high-frequency contacts in the inventory or a review queue instead of forcing them into `event`, `intimate`, or another layer.
7. Build event-centered cross-source evidence chains after clock normalization. Record correlation windows, clock corrections, matched and unmatched attempts, independent source classes, alternative explanations, and contradictions. Distinguish direct statements, repeated behavioral support, synchronized copies, model inference, and external verification. For chats and SMS, include the selected record plus available adjacent records in `context`; for other artifacts, include available same-source neighboring or linked records and never synthesize missing context.
8. Write the bounded claim for every edge, then record its inference method, rule, supporting evidence IDs, counterevidence IDs, assumptions, alternatives, limitations, corroboration status, and independent source count. Audit each layer and every zero layer. Reject bulk semantic assignment based on artifact type, keyword frequency, or temporal proximity alone.
9. Produce graph JSON following [references/graph-schema.md](references/graph-schema.md). Require every inferred relationship to include confidence, reasons, counterevidence, evidence IDs, source types, and verification status.
10. Run the strict machine audit against the original supplied archive or extraction directory. Fix every error before formal report generation:

```powershell
python scripts/audit_graph.py --data graph.json --source extraction.zip --output audit.json
```

11. Generate the report. The generator repeats the strict audit and fails closed; use `--draft` only for clearly marked work-in-progress output that will not be delivered as a conclusion:

```powershell
python scripts/generate_report.py --data graph.json --source extraction.zip --audit-output audit.json --output report.html
```

12. Open the HTML locally and verify node rendering, collision-free explosion and matrix layouts, layer toggles, zoom/pan, search, evidence inspection, and PNG export. Click every layout mode and at least one context control with browser automation; assert that the canvas remains nonblank and every displayed record remains traceable to its original source.
13. Deliver the HTML, graph JSON, and passing audit JSON together. The HTML is the primary portable artifact and must not depend on a server, CDN, external font, or network request.

## Analysis Rules

- Treat nicknames, remarks, avatars, phone numbers, SIM records, device ownership fields, payment names, account names, face clusters, and contact-book entries as identity clues rather than automatic identity proof.
- Represent multiple simultaneous relations between the same people as separate typed edges.
- Use direct evidence for definitive labels. Otherwise use neutral labels such as `高亲密私人联系`, `疑似汇报关系`, or `关联企业线索`.
- Do not infer intimate, family, medical, political, religious, ethnic, or other sensitive attributes from stereotypes, isolated language, or weak behavioral correlation.
- Keep relationship inference separate from legal conclusions. Present it as a lead requiring investigator review.
- Preserve source record IDs, source types, device/account identifiers, original timestamps, deleted/recovered state, and sufficient context so every visual edge is traceable.
- Show a context control only when source context is present. For real reports, display an explicit unavailable state instead of invented filler text.
- Record contrary evidence and ambiguity. Do not hide lower confidence merely to simplify the graph.
- Default the canvas to the target plus strong one-hop relations. Aggregate or defer weak and deeper relations until expanded.
- Treat keyword hits as retrieval candidates, never as sufficient relationship evidence. Review the original payload and context, parse structured transfer/location/file cards, and record false-positive exclusions.
- Search every source for direct, indirect, and cross-source chains. A source that produces no graph edge still requires a completed coverage review and gap statement.
- Separate factual artifact assertions from relationship leads and verified relationships. State what would confirm or falsify each important inference.

## Output Layers

Use these stable layer identifiers: `family`, `intimate`, `work`, `company`, `group`, `funds`, `event`, and `resource`.

Do not map artifact classes directly to layers. In particular, do not map all chats or calls to `event`, all payments to `funds`, all contacts to `intimate`, or all group messages to `group`. The layer describes the supported relationship meaning; the artifact class describes provenance. When evidence does not support a semantic layer, omit that edge from the default graph and report it as an unclassified lead.

Use nodes for persons, accounts, phone numbers, devices, companies, groups, events, places, vehicles, and resources. Use directed edges for communication, information, instruction, money, resources, referrals, co-occurrence, and task flow. Use solid edges for direct evidence and dashed edges for inference.

## Quality Gate

Before delivery, verify:

- `audit_graph.py` passes in strict mode against the original source path; do not deliver a formal report produced with `--draft`.
- The supplied archive/directory file manifest reconciles exactly with the inventory, and every evidence `sourceFile` exists in that manifest.
- Every inventory source reconciles raw, parsed, excluded, duplicate, and analyzed counts; every source has a coverage review even when it yields zero candidates.
- `identityResolutions`, `correlations`, `coverage`, `layerAudit`, `unclassifiedLeads`, and complete `inventory` sections exist and reconcile.
- Every edge has an `inference` audit object and a `corroboration` audit object. Supporting evidence IDs must refer to the selected evidence; assumptions, alternatives, limitations, and counterevidence must be explicit.
- Verified identity merges are reversible and use at least two independent identifier classes. Synchronized duplicates do not count as independent support.
- Cross-source correlations state source classes, clock normalization, tolerance window, rationale, unmatched attempts, contradictions, and alternative explanations.
- The target node exists and is uniquely identified.
- All edge endpoints exist.
- Confidence values are between 0 and 1.
- Every edge uses one of the eight stable layer identifiers, and the layer is supported by the edge's reasons and selected evidence rather than by source type alone.
- Layer totals are computed from relationship edges, not node primary-layer labels, so simultaneous relations between the same entities are counted separately.
- A graph with eight or more relationships must not place every non-group relationship into one layer without an explicit documented override and evidence review. Generic labels such as `通信记录`, `聊天记录`, or `通话记录` are not valid reasons for assigning `event`.
- Zero-count layers are allowed only when the source inventory or analyzed evidence genuinely provides no support. Do not fabricate relations to eliminate zeros; record the evidence or extraction gap instead.
- Every inferred edge contains reasons, evidence, and a verification status.
- Sensitive relationship labels have direct or independently corroborated evidence.
- The report opens from `file://` on a machine without network access.
- Every ingested mobile source appears in the inventory with record count, time range, time zone, extraction location, and known gaps; totals reconcile with normalized records and deduplication counts.
- Every evidence item identifies its source type, original record ID, source table/file or app, device/account when available, original timestamp, and deleted/recovered state.
- Identity merges remain reversible and record the identifiers and independent evidence used. Device, account, phone number, contact entry, and natural person are not silently collapsed.
- Cross-source correlations document clock normalization and tolerance windows. Calls prove communication metadata, locations prove recorded device presence, and payments prove transfers; none alone proves conversation content, physical meeting, beneficial ownership, or relationship type.
- The graph remains readable at the default zoom and does not expose unrelated raw data.
- Matrix layout arranges the currently visible cards in a stable rectangular row-and-column grid, then resizes and fits the visible elements; it must never leave an empty canvas.
- Evidence context controls expand and collapse, contain the selected evidence record, and preserve source type, original record ID, actor/sender, timestamp, readable content, and available provenance fields.
- Browser console has no errors after switching layouts and expanding evidence context.
- Header statistics and timeline endpoints match the supplied graph `stats`; no fallback sample counts, names, or dates remain in a generated report.
- Render every graph node as a stable information card. Put the layer label at the card's upper-left, and use the same color for the card layer tag and its relationship layer.
- Keep a selected node's or edge's complete direct relationship chain persistently highlighted until the user clicks the blank canvas or selects another object.
- Animate the selected relationship chain in its direction of flow without moving node positions or obscuring direct-versus-inferred evidence styling.
- Provide a master all-layers switch in addition to the eight individual layer controls, and keep filtering state consistent after layout changes.
- Append the stable total relationship-edge count to the master switch using full-width parentheses, for example `全部图层（42）`. Keep it equal to the sum of the eight layer totals and to `stats.relations`; do not change it when filters toggle.
- Append each layer's total relationship-card count to its label using full-width parentheses, for example `家庭亲属（2）`. Count source cards assigned to that layer, exclude the persistent `kind: target` core card, include zero-count layers, and keep totals stable when filters or layer visibility change.
- Use a practical mouse-wheel zoom sensitivity and verify at least one ordinary wheel step produces a clearly visible zoom change without jumping past the graph.
- Render communication evidence as traceable chat bubbles with distinct incoming/outgoing alignment. Render non-communication artifacts as neutral evidence records. Preserve actor/sender, timestamp, source type, original record ID, readable content, provenance, and current-evidence emphasis.
- Provide straight and orthogonal edge controls independent of layout. Default to straight edges and preserve the selected chain's directional animation after every line-style change. Do not expose a curved-edge mode.
- Serialize layout transitions: stop the active layout and element animations before starting another, disable layout controls while switching, operate only on visible elements, and resize plus fit after `layoutstop`. Alternate explosion and matrix layouts repeatedly during browser verification and reject any blank result.
- Generate a detailed analytical summary for both nodes and edges. Include relationship structure, direct-versus-inferred counts, message volume, evidence time span, confidence, principal reasons, counterevidence, and an explicit verification boundary when the fields are available.
- Apply a restrained Apple-inspired operational UI: system typography, translucent hierarchy, 4/8/16/24 spacing rhythm, visible focus states, smooth feedback, strong contrast, and reduced-motion support. Preserve dense graph scanning and the established multi-layer colors.
- Set and verify wheel zoom through a measurable zoom ratio. One ordinary wheel notch must create an obvious controlled change while retaining the graph under the pointer.
- Make layer filtering non-cascading and independent of node iteration order. Identify the core target by `kind: target` or the configured target ID, compute visible edge endpoints before hiding nodes, and keep the target visible even when every relationship layer is off.
- Toggle each layer off and on, then isolate each layer from the all-off state during browser verification. Assert that disabling one layer cannot hide unrelated layers or leave the canvas blank, and disable layer controls while a layout transition is active.
- Show concise relationship labels on every visible edge without requiring selection. Keep labels aligned to straight and orthogonal edges, use restrained opaque backgrounds for legibility, visually soften inferred-edge labels, and strengthen the same label when the edge or relationship chain is selected.
- Make the Apple visual language immediately recognizable without reducing forensic density: use 44px toolbar targets, Apple-blue selected states, frosted translucent bars, neutral card borders, layer-colored top accents, system-font hierarchy, soft depth, and hover elevation that does not resize or move graph cards. Verify at 1280px and 1600px widths.
- Keep the core object at the exact visual center after explosion layout and layer filtering. Identify it by `kind: target`, not a hard-coded node ID, and place visible related cards on collision-free deterministic rings around it. Do not expose a manual target/core locator control. Use Apple blue for the master layer switch, confidence slider, inference checkbox, and active layer indicators.

## 适用场景

本技能用于对已依法固定、提取或镜像的手机检材进行以目标人员为中心的关系爆炸图分析，重点解决人、账号、设备、组织、资金、事件、资源之间的可证据化关联。典型场景包括：

- 刑事案件中的通联关系、团伙架构、上下线、资金链路、共同事件和落脚点分析。
- 电信网络诈骗、跨境赌博、非法支付、跑分洗钱案件中的手机号、IM 账号、银行卡、支付账户、群组和 App 代理关系梳理。
- 经济犯罪、职务侵占、商业贿赂、内幕交易中的联系人、公司、群聊、日程、邮件、便签、文件和转账记录关联分析。
- 网络犯罪、黑客攻击、远控木马、刷单平台、涉诈 App 案件中的人机账号关联、设备指纹、应用私有数据和回传线索分析。
- 民事、行政或合规调查中，对经授权提取的手机备份、应用数据、聊天记录、短信、通话、通讯录、浏览器、下载、相册、位置、支付记录进行关系还原。

适用检材类型包括：手机物理镜像、文件系统提取、Android、iOS、鸿蒙备份、iTunes 备份、应用数据目录、SQLite 数据库、plist、realm、shared_prefs、XML、LevelDB、日志文件、属性文件、APK、HAP、APP 安装包、浏览器数据库、短信数据库、通话记录数据库、通讯录数据库、媒体元数据、压缩包、二维码、图片、音频、文档和互联网线索。

本技能特别适合在自动取证工具初筛后，需要回查原始数据库、配置文件、加密聊天库、删除标记、缓存、缩略图、日志和属性文件，并将多源线索归一化为可审计关系图的场景。

以下情形不应直接生成结论性关系图：检材来源或授权不清；哈希未固定或存在未解释差异；仅有关键词命中而无原始记录上下文；仅凭昵称、备注、头像、群成员名、转账备注进行身份合并；云端数据未依法固定；自动化工具解析结果未回查原始证据；加密数据库未解密或解密过程不可复现；同步副本被误当作独立证据。


## 使用步骤

本节补充手机取证实操步骤，与既有 Workflow 配合；如与原文档冲突，不覆盖原文，并将差异标记为待人工裁决。

### 1. 证据固定与入口识别

- 先固定检材：对镜像、备份包、APK、数据库、压缩包计算 SHA256 或 MD5，记录提取路径、设备型号、系统版本、提取方式、只读状态。
- 区分入口：手机镜像、手机备份、应用数据、计算机镜像、服务器镜像、U盘、固件、流量包、内存镜像、邮件、互联网线索。
- 建立检材清单：记录每个入口的文件数、大小、哈希、时间范围、时区、解析状态和已知缺口。

### 2. 自动工具初筛

- 使用本产品 / 智能取证结果或通用取证平台完成初步解析，提取设备信息、应用列表、聊天记录、短信、通话、联系人、备忘录、截图、浏览器历史、邮箱、系统配置。
- 初筛结果只作为线索，不直接作为最终关系依据；对每个自动解析项保留工具名、版本、解析库、解析失败项和人工复核状态。

### 3. 原始数据库回查

- 对自动工具解析不足、结果为空、删除恢复、加密或可疑的记录，回查原始 SQLite、shared_prefs、plist、realm、XML、日志、属性文件和系统目录。
- Android 回查清单：系统配置、通信数据、应用私有目录、常见应用数据库、浏览器、便签、下载、相册和外部存储残留。
- 重点文件包括 settings_global.xml、settings_secure.xml、build.prop、getprop 输出、WifiConfigStore.xml、softap.conf、accounts.db、packages.list、contacts2.db、raw_contacts、data、mmssms.db、telephony.db、downloads.db、History、Bookmarks、notes、calendar、media.db、external.db。
- 应用私有目录重点检查 /data/data/<package>/databases、shared_prefs、files、cache、code_cache、app_webview 和外部存储导出目录。
- iOS 与鸿蒙回查清单包括 Manifest.db、Manifest.plist、应用 AppGroup、ChatStorage.sqlite、sms.db、CallHistory.storedata、AddressBook.sqlitedb、Photos.sqlite、WhatsApp、微信、地图、新闻、文件传输应用和备份域文件。
- 回查时同时检查 WAL、journal、shm、freelist、deleted 标记、事务字段、缓存、缩略图和残留文件。

### 4. 应用枚举与数据目录梳理

- 按包名、应用显示名、进程名、权限、签名、安装时间、最近使用时间、数据大小建立应用枚举表。
- 对每个重点应用梳理数据库、配置文件、日志、缓存、下载文件、导出目录、共享目录和外部存储残留。
- 对疑似远控、刷单、聊天、支付、代理、加密通信类应用单独建立分析队列，并记录其网络请求、文件落点和持久化数据。

### 5. 系统配置与设备身份验证

- 提取 IMEI、MEID、序列号、Android ID、UIN、账号、SIM ICCID、手机号、设备型号、系统版本、内核版本、root 框架、KernelSU、LSPosed、Magisk 痕迹。
- 用日志、属性文件、系统服务输出、应用账号信息交叉验证可能被篡改的设备信息。
- 不把单一设备字段当作身份结论；设备、账号、手机号、联系人条目和自然人必须分开，直到有可审计证据支持合并。

### 6. 聊天数据库与加密库处理

- 对微信等加密数据库，先收集 UIN、IMEI、密码、密钥环、shared_prefs、auth_info_key_prefs.xml、CompatibleInfo、密钥派生参数，再按已知规则推导或恢复数据库密钥。
- 对 SQLCipher、realm、自定义加密库，记录页大小、KDF 迭代次数、HMAC 算法、盐值、密钥来源、解密验证结果和失败尝试。
- 解密后回查 message、rcontact、rchat、UserInfo、ImgInfo、VoiceInfo、VideoInfo、fts 索引、删除标记和 WAL 残留。
- 对无法解密的库，记录失败原因、已尝试密钥来源、可见元数据、可验证范围和后续补充条件。

### 7. 标准化检索清单

- 系统配置文件：settings_global.xml、WifiConfigStore.xml、softap.conf、build.prop、accounts.db、packages.list。
- 应用私有目录：databases、shared_prefs、files、cache、app_webview、code_cache。
- 聊天数据库：EnMicroMsg、MicroMsg、ChatStorage、msgstore、message、mmssms、Telegram、QQ。
- 浏览器、便签、下载记录：History、Bookmarks、downloads、browser.db、notes、calendar、clipboard、剪贴板、相册元数据。
- 对每个清单项目记录命中、未命中、解析失败、加密、删除恢复和证据缺口。

### 8. 删除数据与残留恢复

- 对联系人、短信、聊天记录、文件、图片、缩略图，检查 raw_contacts.deleted、data 表、deleted_messages、WAL、journal、缓存、EXIF、缩略图、文件系统残留。
- 恢复结果必须标注恢复方法、置信度、是否可复现、是否可能被同步覆盖，并保留原始字段和恢复后字段。

### 9. APK、HAP、APP 分析子流程

- 对安装包执行包名识别、解压、反编译、AndroidManifest 检查、权限和组件分析、字符串和关键字定位。
- 检查 SharedPreferences、数据库密码、硬编码密钥、盐值、回传 URL、加密算法、签名证书、APPID、后台地址。
- 在受控环境进行模拟器或真机运行、动态 Hook、Frida 检测、抓包验证；记录行为、网络请求、文件落点和持久化数据。
- 将 APK 静态结果与手机数据、服务器线索、流量包、日志交叉验证，避免仅凭权限或字符串下结论。

### 10. 多源交叉验证与时间线归一化

- 将聊天、通话、短信、支付、位置、照片、下载、浏览器、邮件、群组、好友关系、设备账号统一到同一时间基准。
- 记录原始时间、归一化时间、时区、时钟偏移、容差窗口、匹配和未匹配尝试、矛盾点和替代解释。
- 通联记录只证明通信元数据；位置记录只证明设备在场；支付记录只证明资金流转；聊天内容需结合上下文和账号身份验证。

### 11. 关系抽取与答案归一化

- 按人员、账号、设备、公司、群组、事件、资金、资源抽取候选实体和边。
- 对每个候选关系写入证据边界、推理方法、支持证据、反证、假设、替代解释和置信度。
- 将未验证线索放入 unclassifiedLeads，不强行归入 family、intimate、work、company、group、funds、event、resource。

### 12. 审计与报告生成

- 生成 graph.json 后运行严格审计，确保证据 ID、源文件、清单、覆盖统计、层级审计和身份合并可追溯。
- 审计通过后生成离线 HTML 报告，验证节点卡片、关系边、证据上下文、层级过滤、布局切换和 PNG 导出。
- 最终交付 HTML、graph JSON、audit JSON 和检材清单，确保每一步可复现、可验证、可审计。


## D3-02

本节补充 D3-02 评分所需的证据溯源、交叉验证和审计闭环。

- 每条关系边必须绑定至少一个证据 ID；每个证据必须包含 sourceType、sourceFile、sourceTable 或 app、recordId、originalTimestamp、normalizedTimestamp、timezone、device/account、deleted/recovered、extractionPath、hash 或完整性说明。
- 对推断边必须记录 inference method、rule、assumptions、alternatives、limitations、counterevidence、confidence、verificationStatus。
- 对身份合并必须记录 identifierClasses，例如手机号、账号、设备标识、支付账户、联系人备注、群昵称、邮箱、签名、人脸聚类；至少两个独立标识或独立证据才可合并。
- 同步副本、备份还原、云端同步、转发引用、同一数据库镜像不能计为独立证据。
- 对跨源关联必须说明时钟校正、容差窗口、匹配字段、未匹配尝试、冲突解释和替代解释。
- 对零结果层必须说明证据缺口、提取缺口或解析失败原因，不得伪造关系。
- 对敏感层如 family、intimate、funds、event 必须有直接证据或独立佐证；仅关键词、备注、头像、群成员名、单次通话或单笔转账不得单独定层。
- 对自动工具结果必须回查原始记录；若原始记录不可得，必须记录工具解析路径、限制和置信度降级。
- 审计输出必须包含 coverage、layerAudit、identityResolutions、correlations、unclassifiedLeads、inventory，并与 graph.json 和原始检材清单一致。
- 如本节与原文档 Quality Gate 或 Workflow 存在不一致，保留原文档优先，并将差异标记为待人工裁决。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
