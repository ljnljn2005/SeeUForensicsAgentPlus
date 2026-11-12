---
name: ges-case-index
description: 查询火眼（GoldenEyes/GES）案件全解析结果的本地索引库（检材清单与名称、案件树、关键词检索、结构化表、实体跨检材聚合、时间线、引用回查），不调用 ges.exe。用于摸清案件有哪些检材/应用/账号、查某个关键词或实体出现在哪里、按时间线看行为节奏、以及生成可核验的 Goldeneyes 句柄引用。
---

# 火眼案件索引查询

本技能查询的是**已经建好的本地索引库**（SQLite），不是火眼本体：

- 索引库由桌面版的「取证索引」面板（或 `npm run index:build`）从火眼全解析结果生成；
- 索引里只有**结构化摘要**（行内容、时间、账号、路径、溯源句柄），**没有原始文件二进制**；
- 库里 `citable=1` 的记录可以直接写成 `[[n]](Goldeneyes://<案件号>/<节点>#<行号>)` 引用；`citable=0`（实体分类、检材信息、关联分析等派生表）只能当线索，不能当证据引用。

## 环境

外壳已把两个环境变量传进会话的 bash：

- `$SEEU_INDEX_API`：索引服务基地址，形如 `http://127.0.0.1:<port>/seeu-index`
- `$SEEU_INDEX_SEARCH_DIRS`：默认扫描目录（`;` 分隔，通常含 dsh 工作目录与 `<DSH_HOME>/indexes`）
- `$SEEU_CROSS_DB`：跨案中央库路径（默认 `<工作目录>/indexes/crosscase.db`），跨案查询不需要 `db` 参数

先确认服务可用（没有输出就说明桌面版的索引插件没起来，直接告诉用户去开「取证索引」面板）：

```bash
curl -s "$SEEU_INDEX_API/list" | head -c 500
```

`/list` 返回 `indexes[]`，每项含 `caseDir`、`dbPath`、`caseNumber`、`caseName`、`builtAt`、`sizeBytes`。
**后续所有查询都带上 `db=<dbPath>`**（URL 编码交给 `--data-urlencode`/`-G` 即可）。

## 先认检材（用户说检材名时必查）

`eid` 只是序号，用户/题目说的是**检材名称**。开工前先拿检材清单，把名称和 `eid` 对上：

```bash
curl -s -G "$API/evidences" --data-urlencode "db=$DB"
# → evidences[]: {eid, name, holder, platform, type, remark, evidenceNumber, recordCount, sizeBytes, label,
#                 mountRoute, mountPoint, mountEid}
#   例：{eid:3, name:"LEUNG_YL_mobile.zip", platform:"ios", label:"LEUNG_YL_mobile.zip · ios"}
#   mountRoute 形如 "/evidence_mounts/eid-3/"，mountPoint 是火眼挂载出的本机只读目录（如 C:/hlnet/3-…）；
#   为 null 表示火眼没有为该检材提供挂载入口（格式不支持或未解析）。
```

`/tree root` 的 `children[]` 里也直接带 `eid/name/holder/platform/remark`，与 `/evidences` 等价。
**判断分析哪个检材时：用 name/holder/platform/备注 做子串匹配（不区分大小写），不要猜 eid。** 匹配不到时把 `evidences[]` 列给用户确认。

## 查询命令（全部 GET，返回紧凑 JSON）

```bash
DB="<dbPath>"
API="$SEEU_INDEX_API"

# 0) 检材清单（名称 → eid 映射；用户提检材名时先跑这个）
curl -s -G "$API/evidences" --data-urlencode "db=$DB"

# 1) 概览：检材数、文件数、记录数、时间范围；children[] 每个检材带 name/person/platform/remark
curl -s -G "$API/tree" --data-urlencode "db=$DB" --data-urlencode "node=root"

# 2) 逐层钻取：ev:<eid> → app:<eid>|<应用> → acc:<eid>|<应用>|<账号> → cat:<eid>|<应用>|<账号>|<类别> → art:<id>[:page]
curl -s -G "$API/tree" --data-urlencode "db=$DB" --data-urlencode "node=ev:3"
curl -s -G "$API/tree" --data-urlencode "db=$DB" --data-urlencode "node=cat:3|WhatsApp|+85260927726|群聊消息"

# 3) 关键词检索（≥3 字符走 FTS5；1–2 个汉字自动回退 LIKE）
curl -s -G "$API/search" --data-urlencode "db=$DB" --data-urlencode "q=陳民浩" --data-urlencode "limit=10"
curl -s -G "$API/search" --data-urlencode "db=$DB" --data-urlencode "q=85254877240"
#    可加过滤：--data-urlencode "eid=3" / "app=WhatsApp" / "category=好友消息" / "from=2025-04-01" / "to=2025-04-30"

# 4) 引用回查：拿到记录 id 后取 Goldeneyes 句柄与可复制的核验命令
curl -s -G "$API/cite" --data-urlencode "db=$DB" --data-urlencode "id=21697"

# 5) 统计与抽样校验
curl -s -G "$API/stats" --data-urlencode "db=$DB"
curl -s -G "$API/verify" --data-urlencode "db=$DB" --data-urlencode "sample=10"

# 6) 结构化表：先看有哪些表，再查某张表（联系人/通话/短信/浏览/Exif/应用/蓝牙/健康指标/消息…）
curl -s -G "$API/tables" --data-urlencode "db=$DB"
curl -s -G "$API/table" --data-urlencode "db=$DB" --data-urlencode "name=contact" --data-urlencode "q=陈" --data-urlencode "limit=20"
#    可加过滤：--data-urlencode "eid=3" / "app=WhatsApp" / "subcat=..."；分页用 offset（响应里的 next）

# 7) 实体跨检材聚合：phone/email/url/ip/wallet/身份证/车牌/银行卡…
curl -s -G "$API/entity" --data-urlencode "db=$DB" --data-urlencode "kind=phone" --data-urlencode "limit=20"
curl -s -G "$API/entity" --data-urlencode "db=$DB" --data-urlencode "q=85254877240"
#    返回 {returned, kinds, crossEvidence, rows:[{kind,value,count,evidences,eids}]}；
#    带 q 且唯一命中时 matched="mention"，mentions[] 给出 record/eid/app/cat/ts/line

# 8) 时间线：按 hour/day/month 分桶，看行为节奏或某时段集中活动
curl -s -G "$API/timeline" --data-urlencode "db=$DB" --data-urlencode "bucket=day" --data-urlencode "limit=60"
#    可加 eid/app/from/to；返回 {bucket, rows:[{bucket,n,eids,apps}]}

# 9) 记录列表（带关键词/筛选，用于对某一枝取证式浏览）
curl -s -G "$API/records" --data-urlencode "db=$DB" --data-urlencode "q=转账" --data-urlencode "limit=20"
#    返回 {query, engine:"fts5-trigram"|"like"|"none", returned,total,offset,next,rows[]}；行有 id → 用 /cite 取句柄
# 10) 跨案中央库（M5）：多个案件库汇总后的重合实体 / 镜像哈希
#   注意：跨案接口不需要 db 参数，走 $SEEU_INDEX_API/cross/*
curl -s "$SEEU_INDEX_API/cross/list"                       # 已同步案件、统计、lastSync
curl -s -X POST "$SEEU_INDEX_API/cross/sync"               # 扫描默认目录并同步全部案件
curl -s -G "$SEEU_INDEX_API/cross/top" --data-urlencode "minCases=2" --data-urlencode "limit=20"
#    → rows[] {kind,valueText,caseCount,evidenceCount,hits}：同一手机号/邮箱/网址在多个案件出现
curl -s -G "$SEEU_INDEX_API/cross/entity" --data-urlencode "value=85254877240"
#    → cases[] {caseNumber,caseName,eids,mentions[{recordId,eid,app,category,ts,baseHandle,citable,snippet}]}
curl -s -G "$SEEU_INDEX_API/cross/files" --data-urlencode "sha256=<64位十六进制>"
```

输出约定：`truncated: true` + `next` 表示还有下一页（把 `next` 作为下一次的 `node`/`offset` 继续）；
`citable: 0` 的记录不要写进证据引用。

## 索引里没有数据时（全量提取 / 镜像类检材）

`/evidences` 里每行有 `recordCount`（本索引实际入库行数）与 `reportedRecordCount`（火眼统计）。**`recordCount` 远小于 `reportedRecordCount`（例如 1 / 3065）说明索引里几乎只有元数据**——这类检材通常是 `type='pf'`（手机全量提取）或 `type='image'`（磁盘镜像），火眼没有导出 `data.csv` / `chat.txt` 叶子，索引必然查不到内容。这时：

1. **先看元数据**：`remark` 常直接写着机型/系统版本/解析方式（例：`iPhone D331pAP/iOS17.1.1 全量提取`），设备信息类问题（系统版本、机型、IMEI）先看 `evidences[].remark` 与 `table name=device_info` 一类的结构化表，**不要为了找设备信息去翻文件系统**；
2. **先翻火眼已经挂好的原始只读目录（优先，不用再挂载）**：火眼会为检材挂出原始只读文件系统，映射在 `/evidences` 的 `mountRoute` / `mountPoint`（也可用 `ges status --json` 的 `evidence_mounts[]` 查）：
   - 虚拟路径 `/evidence_mounts/eid-<n>/`：`ges ls /evidence_mounts/eid-<n>/`、`ges glob -p "**/*.db" --path /evidence_mounts/eid-<n>/`、`ges grep "关键词" --path /evidence_mounts/eid-<n>/`；
   - 本机目录（`mountPoint`，如 `C:/hlnet/1-1794226157`）：可以直接 `ls` / 读文件；需要本地工具处理时先 `ges copy <路径> --dest <目录>`；
   - `sourcePath` 是检材盘上的原始文件（如 `W:\CHAN_MH_mobile.zip`），只在挂载不可用时才考虑；
3. **只有火眼没给挂载时才自己挂镜像**：`mountRoute`/`mountPoint` 为 null 且检材是镜像（`.E01/.dd/.raw`）时，才让用户打开外壳「设置 → 镜像挂载…」（`Ctrl+Shift+M`）挂成只读盘符，挂载清单在 `$SEEU_MOUNTS_FILE`；**不要对已挂载的检材重复挂载**；
4. **禁止全盘递归搜索**：不要执行 `Get-ChildItem -Recurse C:\`、`dir /s E:\`、`find / -name …` —— 会卡死、污染现场，也违反取证规范。找不到就明确告诉用户"索引里没有该检材内容，需要挂载镜像/提供原始文件"，并给出下一步操作建议。

## 工作方式建议

1. 先跑 `/evidences`（或 `/tree root`）把**检材名称 ↔ eid** 对上；用户问"某检材"时按名称子串定位，再展开 `ev:<eid>` 看应用与记录。回答里提到检材时写名称（可附 eid），不要只写"检材 3"；
2. 找线索用 `/search` 或 `/records`，找到候选后再 `/cite` 拿句柄，最后用 `ges read`（火眼 `/case/` 路径）核对原文；
3. 跨检材关联（同一手机号/邮箱/网址出现在多个检材）优先用 `/entity`：`crossEvidence>1` 说明跨检材命中；
   需要原始文件时按 `/evidences` 的 `mountRoute` / `mountPoint` 直接翻，别一上来就挂镜像（火眼已挂好）；
4. 行为节奏/时间集中性用 `/timeline`，再用 `/records` 带 `from`/`to` 看具体内容；
5. 回答里引用时给双层方括号 + `Goldeneyes://` 句柄，并对 `citable=1` 的记录注明检材与时间；typed 表（contact/call_log/…）只是投影视图，引用一律回 `record.id` → `/cite`；
6. **不要**编造库里没有的记录；库里查不到就明确说"索引中未发现"，并说明索引的覆盖范围（哪些检材、哪些应用）；
7. 跨案件关联（"本案出现过的号码/邮箱是否也出现在别的案子"）用 `/cross/top` 与 `/cross/entity`；`caseCount>=2` 才是跨案命中，属线索级信息，引用时要分别落到各案 `mentions[].baseHandle`；
8. 索引库可能是旧版本（用户加了新检材但没点【建库 / 更新】）：遇到"应该存在却查不到"时，先看 `/list` 里的 `builtAt`，提醒用户更新索引。
