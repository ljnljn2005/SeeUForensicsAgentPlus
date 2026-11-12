---
name: wechat-people-relationship-explosion-map
description: Analyze lawfully obtained WeChat chat exports for a named target person, resolve identities, extract evidence-backed personal, family, social, work, company, group, fund, event, and resource relationships, and generate a portable offline interactive relationship explosion map in HTML. Use when Codex needs to turn WeChat conversations or normalized message records into an auditable person-centric relationship network, layered infinite-canvas report, role analysis, or evidence-linked graph artifact.
---

# Build WeChat Relationship Graph

Generate an auditable target-person relationship graph and a self-contained offline HTML report.

## Workflow

1. Inventory every supplied data source before analysis. Record file paths, formats, date ranges, message counts, attachment coverage, time zone, and known gaps.
2. Confirm the named target. Keep WeChat accounts separate from natural persons until identifiers or independent evidence support merging them.
3. Normalize messages into sender, recipient/conversation, timestamp, type, text, attachment, reply/quote, transaction, location, and source-record identifiers.
4. Extract candidate entities and relations. Read [references/inference-rules.md](references/inference-rules.md) before assigning relationship types or roles.
5. Build event-centered evidence chains. Distinguish direct statements, repeated behavioral support, model inference, external verification, and counterevidence. Include the selected message plus adjacent source messages in every evidence item's `context`; never synthesize missing context for real data.
6. Produce graph JSON following [references/graph-schema.md](references/graph-schema.md). Require every inferred relationship to include confidence, reasons, evidence IDs, and verification status.
7. Generate the report:

```powershell
python scripts/generate_report.py --data graph.json --output report.html
```

8. Open the HTML locally and verify node rendering, layer toggles, zoom/pan, search, evidence inspection, and PNG export. Click every layout mode and at least one `查看上下文` control with browser automation; assert that the canvas remains nonblank and the context contains traceable messages.
9. Deliver the HTML as the primary portable artifact. It must not depend on a server, CDN, external font, or network request.

## Analysis Rules

- Treat nicknames, remarks, avatars, phone numbers, payment names, and accounts as identity clues rather than automatic identity proof.
- Represent multiple simultaneous relations between the same people as separate typed edges.
- Use direct evidence for definitive labels. Otherwise use neutral labels such as `高亲密私人联系`, `疑似汇报关系`, or `关联企业线索`.
- Do not infer intimate, family, medical, political, religious, ethnic, or other sensitive attributes from stereotypes, isolated language, or weak behavioral correlation.
- Keep relationship inference separate from legal conclusions. Present it as a lead requiring investigator review.
- Preserve source message IDs and sufficient context so every visual edge is traceable.
- Show `查看上下文` only when adjacent source messages are present. For real reports, display an explicit unavailable state instead of invented filler text.
- Record contrary evidence and ambiguity. Do not hide lower confidence merely to simplify the graph.
- Default the canvas to the target plus strong one-hop relations. Aggregate or defer weak and deeper relations until expanded.

## Output Layers

Use these stable layer identifiers: `family`, `intimate`, `work`, `company`, `group`, `funds`, `event`, and `resource`.

Use nodes for persons, accounts, companies, groups, events, and places. Use directed edges for information, instruction, money, resources, referrals, and task flow. Use solid edges for direct evidence and dashed edges for inference.

## Quality Gate

Before delivery, verify:

- The target node exists and is uniquely identified.
- All edge endpoints exist.
- Confidence values are between 0 and 1.
- Every inferred edge contains reasons, evidence, and a verification status.
- Sensitive relationship labels have direct or independently corroborated evidence.
- The report opens from `file://` on a machine without network access.
- The graph remains readable at the default zoom and does not expose unrelated raw data.
- Force-directed layout runs on the currently visible subgraph, then resizes and fits visible elements after layout completion; it must never leave an empty canvas.
- Evidence context controls expand and collapse, contain the selected evidence message, and preserve source record IDs, senders, timestamps, and text.
- Browser console has no errors after switching layouts and expanding evidence context.
- Header statistics and timeline endpoints match the supplied graph `stats`; no fallback sample counts, names, or dates remain in a generated report.

## 适用场景

本技能用于手机取证案件中，对依法获取的微信聊天导出、微信原始数据库、手机镜像/备份中的应用数据、解密后的 MicroMsg/EnMicroMsg/WCDB 记录进行人物关系刻画。适用对象是已固定、已解密或已规范化导出的微信数据，目标是生成可审计、可离线查看、可追溯证据链的人物关系爆炸图。

### 典型案件类型
- 电信网络诈骗、网络赌博、传销、非法经营等涉众型案件，需要还原目标人与上下线、客户、资金对手、群组成员之间的关系。
- 职务侵占、商业贿赂、利益输送案件，需要从聊天、转账、群组、公司线索中刻画工作关系与资金关系。
- 团伙犯罪、黑灰产案件，需要从多账号、多群、多设备数据中识别账号控制人、马甲号、财务号、客服号、技术号。
- 需要向办案人员展示人员网络、事件链、资金链、资源链的离线交互式报告场景。

### 适用检材与数据形态
- 手机物理镜像、逻辑镜像、文件系统提取、iTunes 备份、Android 备份、鸿蒙备份、应用数据提取包。
- 微信相关数据库与配置：MicroMsg、EnMicroMsg、WCDB、MM 系列 SQLite、联系人库、群成员库、消息库、附件索引、支付/钱包相关库、朋友圈线索库。
- 自动化工具解析结果：聊天记录、联系人、群聊、转账、红包、收藏、朋友圈、账号信息、设备信息。
- 已经规范化为 sender、recipient/conversation、timestamp、type、text、attachment、transaction、location、source-record-id 的 CSV/JSON/SQLite 导出结果。
- 辅助证据：通讯录、短信、通话记录、浏览器历史、便签、下载记录、相册、支付应用、邮件、服务器后台、网站快照、域名与邮箱线索。

### 适用前提
- 检材来源合法，提取、固定、校验、保管链条完整。
- 目标人物至少有一个可区分的微信账号、微信号、手机号、备注、昵称或独立证据支撑。
- 微信加密数据库已经依法解密，或已有可读的导出记录；不得对无法解密的数据库直接臆测聊天内容。
- 需要保留原始消息 ID、会话 ID、时间戳、发送方向、消息类型、上下文消息，以便每条关系边可回溯。
- 报告必须能离线打开，不依赖服务器、CDN、外部字体或网络请求。

### 不适用或需谨慎使用
- 仅有聊天截图、打印件、口述内容，且无法关联原始数据库或合法导出记录时，不应生成高置信关系图。
- 仅凭昵称、头像、备注、群昵称进行身份合并，缺少手机号、实名、转账名、账号资料、外部证据时，不应直接认定自然人身份。
- 未解密的微信数据库、无法访问的备份、损坏的镜像，不应强行生成结论；应记录缺口并转入解密或恢复流程。
- 本技能输出的是侦查线索和取证分析结果，不等同于户籍、工商、银行、运营商等法定身份认定结论。

## 使用步骤

### 1. 检材固定与完整性校验
- 先区分检材类型：手机镜像、手机备份、应用数据、计算机镜像、服务器镜像、U盘/固件、流量包、内存镜像、邮件和互联网线索。
- 对镜像、备份包、数据库、APK、压缩包计算 SHA-256 或 SHA-1，登记检材编号、来源、提取人、时间、工具、哈希值。
- 使用只读挂载、写保护镜像或导出副本进行分析，避免直接修改原始检材。
- 对 iOS 备份、Android 备份、鸿蒙备份，先确认备份是否加密、备份密码是否可合法获取，并记录备份结构、Manifest、Domain 和缺口。

### 2. 自动工具初筛
- 使用本产品 / 智能取证结果或通用取证平台完成首次解析，提取设备信息、微信账号、联系人、群聊、聊天记录、转账、红包、收藏、朋友圈、备忘录、截图、浏览器历史、邮箱、系统配置等基础信息。
- 初筛结果只作为线索索引，不直接作为最终证据；记录工具名称、版本、解析范围、未解析项和可疑项。
- 对自动工具输出的账号、昵称、备注、群成员、交易金额、时间戳进行抽样回查，防止工具解析偏差、字段错位或时间转换错误。

### 3. 原始数据库与配置文件回查
- 对自动工具解析不足、字段缺失、记录被删除或结果可疑的部分，回查原始 SQLite、shared_prefs、plist、realm、XML、日志、属性文件和系统目录。
- Android 重点目录：/data/data/com.tencent.mm/MicroMsg/<账号哈希目录>/、EnMicroMsg.db、MicroMsg 相关库、Contact 表、UserInfo、ChatMsg、message、GroupContact、OpenIMContact、ImgMsg、voice、video、Sns、Wallet/Tenpay 相关线索、shared_prefs、auth_info_key_prefs.xml、deviceinfo、compatible_info、日志与属性文件。
- iOS/备份重点：微信沙盒或共享容器中的 MM/WCDB/message 系列数据库、Manifest.db、Manifest.plist、应用配置 plist、钥匙串线索、备份内照片、附件、传输记录、地图、浏览器和邮件数据。
- 回查时同时检查 SQLite WAL/SHM 文件、journal、deleted 标记、事务字段、缓存、缩略图、EXIF、残留文件和数据库碎片，避免只读取主库导致遗漏已删除或未提交记录。

### 4. 微信加密数据库密钥推导与解密
- 对微信加密数据库，优先收集 UIN、IMEI、手机号、微信账号、密码、密钥环、shared_prefs、auth_info_key_prefs.xml、DeviceInfo、compatibleInfo、备份元数据、钥匙串、内存镜像和日志线索。
- 对旧版 Android 微信 EnMicroMsg.db，可按业界常见规则验证 IMEI 与 UIN 组合派生密钥；对新版微信、iOS、鸿蒙或自定义加固库，不得机械套用旧规则，应结合密钥文件、内存、备份、应用配置和逆向结果推导。
- 使用 sqlcipher、SQLite 工具、CyberChef、hashcat、openssl、脚本或合法获取的密码进行解密验证；解密成功后必须核对表结构、消息数量、联系人数量、时间范围和样本消息。
- 若密钥无法合法推导或解密失败，应记录失败原因、已尝试线索和待补充材料，不得伪造聊天内容。

### 5. 数据归一化与消息状态验证
- 将消息统一为 sender、recipient/conversation、timestamp、type、text、attachment、reply/quote、transaction、location、source-record-id 字段。
- 统一时间戳与时区，明确 UTC、本地时间、设备时区、服务器时间、消息创建时间与展示时间的差异。
- 验证消息状态字段：发送/接收方向、是否撤回、是否删除、是否系统消息、是否群聊、是否转账/红包/卡片/位置/语音/图片/视频。
- 对群聊必须还原群成员变化、群名变更、入群退群记录、群公告和群管理线索，避免把临时群成员误认为长期关系。

### 6. 目标固定与身份解析
- 先固定目标微信账号、微信号、手机号、备注、昵称、头像、转账名、群昵称、设备账号和独立证据。
- 微信账号与自然人在证据不足时必须分开建节点；只有当手机号、实名、转账名、通讯录、短信、邮件、服务器后台、笔录或其他独立证据能够关联时，才合并或标注同一自然人。
- 对多账号、马甲号、工作号、财务号、客服号，依据登录设备、IP、联系人重叠、资金对手、话术风格、时间活动规律进行线索级关联，并保留置信度。

### 7. 实体与关系抽取
- 按 family、intimate、work、company、group、funds、event、resource 图层抽取实体。
- 人物节点包括自然人、微信账号、手机号、邮箱、银行卡线索；组织节点包括公司、店铺、群组、项目、平台；事件节点包括转账、见面、发货、登录、拉群、维权、案发节点。
- 关系边区分信息流、指令流、资金流、资源流、引荐流、任务流；同一对主体存在多种关系时分别建边，不合并为单一关系。
- 直接证据使用实线，推断证据使用虚线；每条推断边必须包含 confidence、reasons、evidence IDs、verification status。

### 8. 多源交叉验证
- 将微信关系与通讯录、短信、通话记录、浏览器历史、便签、下载记录、相册、支付应用、邮件、地图、服务器后台、网站快照、域名、邮箱、APK/HAP/APP 配置进行交叉验证。
- 对关键关系至少检查两类证据：聊天内容、转账/红包、群成员、共同联系人、附件、位置、登录设备、服务器订单或外部互联网线索。
- 对时间、位置、传输模式、群组关系、资金规模、活跃率进行时间戳转换、跨表关联、跨检材比对和统计汇总，避免单一字段误判。
- 对矛盾证据、反证、低置信线索必须保留，并在图中展示为待验证、冲突或低置信状态。

### 9. 生成图数据与离线报告
- 按 graph-schema 生成 graph.json，确保目标节点唯一、边端点存在、置信度在 0 到 1 之间、证据上下文包含原始消息及相邻消息。
- 执行报告生成命令：

```powershell
python scripts/generate_report.py --data graph.json --output report.html
```

- 生成后在本地 file:// 环境打开，验证节点渲染、图层切换、缩放平移、搜索、证据查看、PNG 导出、控制台无错误。
- 报告必须离线可用，不依赖服务器、CDN、外部字体或网络请求；默认展示目标人与强一跳关系，弱关系和深层关系按需展开。

### 10. 证据链封装与交付
- 交付物包括 report.html、graph.json、原始证据索引、工具清单、哈希记录、解析缺口说明、假设与待人工裁决事项。
- 对每条边至少能追溯到原始消息 ID、会话、发送者、时间戳、上下文消息或对应数据库记录。
- 对无法闭环的推断，明确标注为侦查线索，不得写成身份认定或法律结论。

## D2-04 输入输出与证据链说明

### 输入要求
- 原始检材：手机镜像、逻辑提取文件、iTunes/Android/鸿蒙备份、应用数据包、服务器镜像、流量包、内存镜像或互联网线索。输入必须包含来源、提取方式、提取时间、保管链条和哈希值。
- 微信数据：解密后的 MicroMsg/EnMicroMsg/WCDB/MM 系列数据库、合法导出的聊天记录、联系人、群成员、转账、红包、收藏、朋友圈、附件索引、账号配置和登录线索。
- 辅助数据：通讯录、短信、通话记录、浏览器历史、便签、下载记录、相册、支付应用、邮件、地图、服务器后台、域名、邮箱、APK/HAP/APP 配置。
- 案件参数：目标账号或目标人标识、时间范围、时区、已知身份、已知公司/群组、需要重点关注的资金或事件类型。
- 数据质量要求：消息记录必须保留 source-record-id、sender、conversation、timestamp、type、direction、raw text 或可解析内容；附件应保留路径、哈希、缩略图或提取失败说明。

### 输出要求
- graph.json：包含人物、账号、公司、群组、事件、地点、资源节点；包含带类型、方向、置信度、理由、证据 ID、验证状态的关系边；包含统计信息、时间范围、图层标识和数据缺口。
- report.html：单文件离线交互报告，支持 family、intimate、work、company、group、funds、event、resource 图层切换，支持搜索、缩放、布局切换、证据上下文查看和 PNG 导出。
- 证据索引：每个节点和关系边对应的原始消息、数据库表、字段、记录 ID、附件路径、哈希、截图或导出文件位置。
- 工作记录：工具名称与版本、自动解析结果、原始库回查清单、密钥推导过程、解密结果、无法解析项、冲突项、待人工裁决项。
- 交付说明：明确哪些关系是直接证据，哪些是模型或经验推断，哪些只有线索价值，哪些需要进一步取证验证。

### 证据链与可回溯性
- 每条关系边必须能回答：依据哪条消息、哪张表、哪个字段、哪个附件、哪个外部线索得出；该依据是否直接支持关系标签；是否存在反证。
- 证据上下文必须包含选中消息及其相邻来源消息；不得为了展示效果合成、补写或裁剪关键上下文。
- 对删除、撤回、损坏、解密失败、字段缺失的数据，应显示不可用状态或明确缺口，不得用推测文本填充。
- 对敏感关系标签，如亲密关系、家庭成员、医疗、政治、宗教、民族属性，必须有直接证据或独立佐证；不得基于语言习惯、孤立词汇或弱行为相关进行推断。

### 常见误判与规避
- 仅凭自动工具结果定案：必须回查原始 SQLite、shared_prefs、plist、realm、日志和属性文件，尤其是工具未解析或解析异常项。
- 昵称即身份：备注、昵称、头像、群昵称只能作为身份线索，需与手机号、实名、转账名、账号资料、外部证据交叉验证后再合并节点。
- 时间戳误读：必须区分 UTC、本地时间、设备时区、数据库存储时间和工具展示时间，避免跨时区案件出现关系时间错位。
- 加密库未解密即推断：未解密的 EnMicroMsg/WCDB/MM 库不能直接读取明文；应先收集密钥线索并验证解密结果。
- 忽略 WAL/SHM：SQLite 主库可能不包含最新事务或未合并日志，必须检查 WAL、SHM、journal 和数据库碎片。
- 群关系过度泛化：同群不等于强关系，应结合私聊、资金、共同事件、互动频率、群角色和历史成员变化判断。
- 资金关系误标：转账、红包、收款码、代付、群收款、商户支付字段不同，应区分资金方向、金额、对手账号和交易状态。
- 报告依赖网络：HTML 报告必须本地离线可用；任何 CDN、外部字体、远程 JS/CSS 都会破坏便携性和证据展示稳定性。

### 与原文档冲突处理
- 若本章节输入输出要求与原文档 Workflow、Analysis Rules 或 Quality Gate 发生冲突，优先保留原文档已明确的质量门槛，并将冲突点标记为「待人工裁决」。
- 若自动工具、原始数据库、解密结果、外部线索之间出现矛盾，不得自动覆盖任一来源；应在报告中保留多源证据，并标注冲突状态与复核建议。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
