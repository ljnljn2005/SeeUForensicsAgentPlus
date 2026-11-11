# Plan v3：火眼 AI 研判结果 → 案件库 → dsh 只查库

> 状态：**待评审**（尚未实现）
> v3 变更：按你 6 条答复定稿架构 —— ①分析者=火眼内置 AI研判（我们绝不跑模型）②DB 跟案件目录走 ③按取证比赛思路支持跨案并案 ④先只做关键词检索 ⑤会话只读 DB、不给 `ges.exe` ⑥4 个官方 skill 不进我们的安装包。

---

## 0. 定稿后的工作流（就是你要的那个体验）

```text
① 火眼客户端：导入检材 → 解析 → 你手动开启并跑「AI研判」
        ↓  成果落在 /case/AI研判/（案件画像 / 人物画像 / 检材画像 / 线索挖掘）
② 我们的桌面版：设置里选一次「案件目录」和「AI 研判目录」→ 点【拉取/更新索引】
        ↓  建库器离线解析 → <案件目录>\.seeu-index\case-index.db（覆盖式更新，旧版留备份）
③ dsh 会话：只挂一个 ~40 行的 skill，调 ges-index 查询，单次 ≤2KB
        ↓  不读案卷、不调 ges.exe、不跑任何模型
```

「后续有更新，点一下覆盖之前的数据库」= ②里的【更新索引】按钮：先建到临时库 → 校验 → 原子替换 → 上一版进 `backup\`，坏库不覆盖好库。

---

## 1. 你已定的 6 条（本 plan 据此展开）

| # | 决策 | 落地方式 |
| --- | --- | --- |
| 1 | 分析者 = **火眼内置 AI研判** | 我们只 ingest，不跑本地模型、不做 embedding |
| 2 | DB **跟案件目录走** | `<case_dir>\.seeu-index\case-index.db`（dsh 工作目录 = 案件目录） |
| 3 | 跨案库**按一般取证比赛思路** | 案件库为源 + 中央并案库（同实体跨案碰撞），见 §4.3 |
| 4 | 先**关键词**检索 | SQLite FTS5（`unicode61`），不做向量 |
| 5 | 会话**只读 DB、不给 `ges.exe`** | DB 以只读 URI 打开；会话侧不暴露 ges 路径 |
| 6 | 4 个官方 skill **不进我们的包** | 只随包新增 `ges-case-index` 一个 skill；4 个 skill 留火眼目录做参考/人工深挖 |

---

## 2. 现状实测（2026-11-11，本案真实数据）

| 检查项 | 实测 |
| --- | --- |
| 案件 | `case_number=2919d298-f083-4a81-9c12-bd4ca393bcc5`，`name=W盘`，`location=E:\forensics\W盘_2919…`，`cid=1`，`ges_url=http://127.0.0.1:8174`，5 检材（eid 1–5） |
| `/case/AI研判/案件画像/` | **空**（报告未生成；使用说明：「本机案件报告目录尚不存在或未配置」） |
| `/case/AI研判/检材画像/`、`人物画像/` | **空** |
| `/case/AI研判/线索挖掘/` | 有 `好友线索.csv`、`群组线索.csv` |
| `master.db case.analyze_status` | **0**（未分析） |
| `E:\forensics` 下 `report.json`/`digests.json` | 未找到 |
| `/case/` 规模 | `**/chat.txt` **33** 个、`**/*.csv` **343** 个 |
| `ges search` | 不可用（`res\vector_search\tree.pkl` 不存在，火眼没做向量入库） |

→ **结论：建库器必须先做 preflight**。现在点【拉取索引】应当明确报「AI 研判未完成（0/9 阶段、report 缺失）」，而不是建出一个空库。你要先在火眼客户端把 AI研判跑完。

---

## 3. 火眼 AI 研判产物契约（建库器输入，来自实测 `使用说明.md`）

### 3.1 案件画像 `案件画像/`

`report.json`（旧版 `report.md`）：`overview` / `organization` / `relationNetwork` / `eventAndFunding` / `recommendations` / `evidences`。

`checkpoints/` 九个文件（业务内容在 `data`；外层 `cid`/`snapshotKey`/`stage`）：

| 文件 | 关键字段 |
| --- | --- |
| `digests.json` | `channelCount`；`items[]`：通道摘要、`holder_name`、`target_name`、`chat_summary`、`clues`、`key_roles`、`involved_score`、`worth_attention`、`source_handles` |
| `fund_traces.json` | `contextCount`；`items[]`：金额、方向、时间、对手、`context_text`、`suspicion_score`、`review_reason`、`settled`、`alternative_explanation`、**`eid`/`pid`/`line`** |
| `geo_findings.json` | `inputCount`；`items[]`：地点、地址、人员、次数、时间范围、`place_nature`、`summary`、`sources` |
| `organization.json` | 成员、关系、群组中间结果 |
| `organization_report.json` | 组织/关系章节草稿（overview/organization/relationNetwork） |
| `fund_chapter.json` | `timeline`、`fundAnalysis` |
| `suggestion_chapter.json` | `data.personnelPlans[]`：已知事实、核查方向、取证建议 |
| `holder_insights.json` | 持有人、`eid_list`、`roles`、`summary` |
| `final.json` | `data.content` = 正式报告 JSON 字符串；`evidenceIds`、`holderInsights` |

- 只对**相同 `snapshotKey`** 的阶段作同轮解读；重跑期间旧报告可能与新中间材料并存。
- `evidences[].displayNo` 对应正文引用编号，`traceUrl` 定位原始记录；`source_handles`、`eid/pid/line`、`sources` 用于回查证据。

### 3.2 人物画像 / 检材画像

- 按姓名 / 检材 ID 分组；优先 `正式报告.json|md`，再 `基本信息.md`、`分析材料/*.md`。
- 含 `画像说明.md` = 生成后持有人信息已变更 → 当前映射**历史名称**，建库打 `stale=1`。

### 3.3 线索挖掘

- `群组线索.csv`、`好友线索.csv`；**200 行/页**（表头计行），各自按 `score` 降序。
- 列：名称、账号、所属账号、线索摘要、涉案标签、可疑度、溯源目录、聊天时间范围。
- **无原文记录 ID**，序号不能引用；时间范围是**分析分片范围**，非精确消息时间。

### 3.4 引用铁律（决定 schema）

- JSON 文件自身行号**不是**原文行号；`displayNo` 是引用编号不是行号。
- 要引用必须「先读来源记录，再用同一路径 + ID 调 `get_context`，只用成功返回的真实坐标」。
- → 库里 `ai_*` 表一律 `citable=0`；引文**只能**由「回查原文」生成的 `citation` 表提供。

---

## 4. 数据库设计

### 4.1 位置与生命周期（决策 2）

```text
<case_dir>\.seeu-index\
├── case-index.db          ← 当前库（WAL）
├── case-index.db-wal/-shm
├── backup\case-index-<yyyymmdd-hhmmss>.db   ← 覆盖更新前自备份
└── build.log              ← 建库日志（含 preflight 结论、耗时、行数）
```

- dsh 工作目录 = 案件目录，所以会话天然靠近库；路径可由工作目录推导，无需配置。
- **合规处理**：`.seeu-index/` 是**派生数据目录**，与 `.gec`/`data`/`filesystem` 分开；建库器只读原始文件、只写这个目录；目录可整体删除不影响案件。文档里写明「不是证据，可删可重建」。

### 4.2 表结构（SQLite + FTS5）

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE case_info (
  case_number TEXT PRIMARY KEY, name TEXT, location TEXT, cid INTEGER,
  ges_url TEXT, display_timezone TEXT, ai_report_dir TEXT,
  built_at TEXT, builder_version TEXT
);

CREATE TABLE analysis_round (             -- 一轮 AI 研判
  round_id INTEGER PRIMARY KEY, case_number TEXT,
  snapshot_key TEXT, stage_set TEXT, complete INTEGER,
  report_state TEXT,                      -- ok|missing|md_only
  first_seen TEXT, last_seen TEXT, is_current INTEGER
);

CREATE TABLE ai_report (
  id INTEGER PRIMARY KEY, round_id INTEGER,
  section TEXT,                           -- overview|organization|relationNetwork|eventAndFunding|recommendations|evidences
  title TEXT, body_json TEXT, body_text TEXT,
  display_no TEXT, trace_url TEXT
);

CREATE TABLE ai_finding (                 -- checkpoints 统一表
  id INTEGER PRIMARY KEY, round_id INTEGER,
  kind TEXT,                              -- digest|fund_trace|geo|organization|org_report|fund_chapter|suggestion|holder_insight
  title TEXT, summary TEXT, detail_json TEXT,
  score REAL, score_kind TEXT,            -- involved_score|suspicion_score（严禁混算）
  worth_attention INTEGER, settled INTEGER,
  eid INTEGER, pid INTEGER, line INTEGER, handles_json TEXT,
  ref_path TEXT, citable INTEGER DEFAULT 0
);
CREATE VIRTUAL TABLE ai_fts USING fts5(title, summary, detail_json, content='ai_finding', content_rowid='id', tokenize='unicode61');

CREATE TABLE ai_clue (
  id INTEGER PRIMARY KEY, round_id INTEGER, source_file TEXT,
  name TEXT, account TEXT, owner_account TEXT, summary TEXT, tags TEXT,
  score REAL, trace_dir TEXT, time_range TEXT,
  citable INTEGER NOT NULL DEFAULT 0,
  why_not_citable TEXT DEFAULT '线索 CSV 无原文记录 ID，序号不可用于引用'
);

CREATE TABLE ai_profile (
  id INTEGER PRIMARY KEY, round_id INTEGER,
  kind TEXT,                              -- person | evidence
  subject TEXT, eid_list TEXT, stale INTEGER DEFAULT 0,
  summary TEXT, detail_json TEXT, ref_path TEXT
);

-- 检材/持有人/实体（决策 3 顺带入库：让结论落到人）
CREATE TABLE evidence (
  eid INTEGER PRIMARY KEY, name TEXT, type TEXT, vendor TEXT, model TEXT, imei TEXT,
  holder TEXT, platform TEXT, timezone TEXT,
  md5 TEXT, sha1 TEXT, sha256 TEXT, sha512 TEXT, sm3 TEXT, crc64 TEXT,
  source_path TEXT, size_bytes INTEGER, updated_at TEXT
);
CREATE TABLE account_holder (
  id INTEGER PRIMARY KEY, eid INTEGER, holder TEXT, app TEXT,
  nickname TEXT, account_id TEXT, ref_path TEXT,
  citable INTEGER NOT NULL DEFAULT 0      -- 火眼明示：关联分析导航数据无句柄
);
CREATE TABLE entity (
  id INTEGER PRIMARY KEY, eid INTEGER, type TEXT, value TEXT,
  attrs_json TEXT, occurrences INTEGER
);
CREATE UNIQUE INDEX ux_entity ON entity(eid, type, value);

-- 引用（唯一合法来源）
CREATE TABLE citation (
  id INTEGER PRIMARY KEY, round_id INTEGER,
  owner_table TEXT, owner_id INTEGER,
  case_number TEXT, base_handle TEXT, line_no INTEGER,
  evidence_path TEXT, snippet TEXT, resolved_at TEXT,
  status TEXT                             -- ok|no_handle|no_record|out_of_range|mismatch
);

CREATE TABLE ingest_log (
  id INTEGER PRIMARY KEY, phase TEXT, ref_path TEXT,
  status TEXT, rows INTEGER, started_at TEXT, finished_at TEXT, error TEXT
);
CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT);
```

**设计约束**

1. 推断层（`ai_*`）与事实/导航层（`evidence`/`entity`/`account_holder`）分表；前者不可引用。
2. 引文只能来自 `citation.status='ok'`；查询端拼角标只经 `ges-index citations`。
3. `score_kind` 把聊天相关度与资金可疑度分开；默认查询不跨 kind 排序。
4. 所有业务表挂 `round_id`；默认只查 `is_current=1`（完整轮）。
5. 中文分词用 `unicode61`；如需二元切分再评估 `trigram`（M3 实测后定）。

### 4.3 跨案并案库（决策 3：按取证比赛思路）

比赛里常见的是「同一案件多检材并案」+「多案件串并（同一手机号/钱包/账号在不同案出现）」。做法：

```text
每案：<case_dir>\.seeu-index\case-index.db      ← 源（含原文引用坐标）
     ↓  import-case（只导出实体与引用骨架，不含正文）
中央：<workspace>\indexes\crosscase.db          ← 并案库
      表：case_ref(case_number, name, location, built_at)
          cross_entity(entity_type, value, case_number, eid, hits, first_seen, last_seen)
          cross_citation(entity_type, value, case_number, citation_id, base_handle, line_no)
```

查询：`ges-index cross --entity 手机号:85260927726` → 返回「哪几个案件/检材命中同一实体 + 可回查的原文引用」。默认**不自动并案**，只给命中事实，结论由分析员写。

---

## 5. 建库器 `ges-index`（离线，Node 24 内置 `node:sqlite`，零新增原生依赖）

```bash
# 前置检查
ges-index preflight --case-dir "E:\forensics\W盘_2919…" --ai-dir "E:\forensics\W盘_2919…\AI研判"

# 建库 / 覆盖更新（桌面版按钮背后就是这条）
ges-index build --case-dir <dir> --ai-dir <dir> [--phases report,checkpoints,clues,profiles,evidence,handles]
#   → 建到 .seeu-index\tmp-<ts>.db → 校验 → 备份旧库 → 原子替换

# 验收与体检
ges-index verify  --case-dir <dir> --sample 50     # 抽样用 ges read 复核 citation
ges-index status  --case-dir <dir>

# 并案导入/查询
ges-index import-case --case-dir <dir> --cross <workspace>\indexes\crosscase.db
ges-index cross --cross <db> --entity "手机号:85260927726"
```

**阶段与降级**

| 阶段 | 输入 | 产出 | 缺失/失败 |
| --- | --- | --- | --- |
| `preflight` | `ls /case/AI研判/`、读 `使用说明.md`、`case.analyze_status` | 清单+警告（report 有/无、checkpoints n/9、snapshotKey） | **report 缺失且 checkpoints 0/9 → 拒绝建库**，仅提示 |
| `report` | `案件画像/report.json|md` | `ai_report` | 缺 → `report_state=missing`，其余照跑 |
| `checkpoints` | `checkpoints/*.json` | `ai_finding`+`ai_fts` | 单文件解析失败记 `ingest_log.error` |
| `clues` | `线索挖掘/*.csv`（200 行/页翻完） | `ai_clue` | 空 → 0 行正常 |
| `profiles` | 人物/检材画像的 `正式报告.*`、`基本信息.md`、`画像说明.md` | `ai_profile`（`stale`） | 缺正式报告 → 存已有 md |
| `evidence` | `检材信息/data.csv`（26 列含 hash）、`实体分类/*.csv`、`关联分析/检材持有人/data.csv` | `evidence`/`entity`/`account_holder` | 无文件 → 跳过 |
| `handles` | `eid/pid/line`、`source_handles`、`traceUrl` | `citation` | 无法确证 → `status≠ok` |
| `verify` | 抽样 citation | 一致率 | <100% → 该轮不进 `is_current`；用备份回滚 |

**引用回查怎么落地（最关键的实现细节）**

1. `eid/pid/line`：从 `/case/` 目录树建 eid→chat.txt 路径映射（`glob **/chat.txt` + 路径里的 eid 段），`ges read` 读到该行，用 `context_text` 做包含/重叠校验 → 通过才 `status=ok`。
2. `source_handles`（形如 `Goldeneyes://…/node`）：`ges read` 读该节点首行，校验基址一致 → 取 `base_handle`。
3. `traceUrl`：同上，另从 URL 取行号。
4. 线索 CSV：只有 `溯源目录 + 时间范围` → **默认不生成 citation**，只存 `trace_dir`/`time_range`，标 `citable=0`。
5. 任何一步没确证 → `status` 记具体原因，查询返回 `cite: null` + `why_not_citable`。

---

## 6. 查询端（dsh 只看到这些）

### 6.1 命令面

```bash
ges-index overview   --case-dir <dir>                 # 库规模、轮次、覆盖度、report 状态
ges-index report     --case-dir <dir> [--section …]
ges-index findings   --case-dir <dir> [--kind fund_trace|digest|geo] [--min-score N] [--eid N] [--limit 8]
ges-index clues      --case-dir <dir> [--file 群组线索|好友线索] [--min-score N]
ges-index profiles   --case-dir <dir> [--kind person|evidence] [--subject …]
ges-index search     --case-dir <dir> --q "换汇" [--scope findings|clues|reports]
ges-index get        --id <id>
ges-index citations  --ids a,b,c                       # 唯一合法拼引用入口
ges-index cross      --entity "手机号:852…" [--cross <central.db>]
```

输出（≤2 KB，超限截断+`next_cursor`）：

```json
{
  "round": { "id": 3, "snapshot_key": "2919d298:1730…", "complete": true },
  "coverage": { "report": "missing", "checkpoints": "9/9", "clues": 2, "profiles": 0, "evidence": 5 },
  "hits": [
    { "id": 41, "kind": "fund_trace", "score": 0.87, "score_kind": "suspicion_score",
      "title": "2025-05-02 转出 HK$52,000 → 对手 852…",
      "cite": "[[1]](Goldeneyes://2919d298-…/229000000201#37)", "citable": true },
    { "id": 88, "kind": "clue", "score": 82, "score_kind": "clue_score",
      "title": "群组「IQCOIN💰💰💰💰」涉案讨论",
      "cite": null,
      "why_not_citable": "线索 CSV 无原文记录 ID；可按溯源目录+时间范围回查" }
  ],
  "truncated": true, "next_cursor": "…"
}
```

### 6.2 随包 skill（`resources/forensics/skills/ges-case-index/SKILL.md`，约 40 行）

```markdown
---
name: ges-case-index
description: 查询火眼 AI 研判成果库（案件画像/人物画像/检材画像/线索挖掘）。案件问题优先用它，不要直接读案卷。
---
# 火眼 AI 研判库查询

数据来源：火眼客户端跑完的 AI 研判，已离线入库。不要 `ges read` 案卷、不要自己算分、不要调 ges.exe。

## 命令（JSON，单次 ≤2KB）
- `ges-index overview --case-dir .` — 先调：轮次/覆盖度/report 是否可用
- `ges-index report --case-dir . [--section …]`
- `ges-index findings --case-dir . [--kind fund_trace|digest|geo] [--min-score N]`
- `ges-index clues --case-dir . [--file 群组线索|好友线索]`
- `ges-index profiles --case-dir . [--kind person|evidence]`
- `ges-index search --case-dir . --q "<关键词>"`
- `ges-index get --id <id>`
- `ges-index citations --ids a,b,c` — 生成引用只能用这个
- `ges-index cross --entity "手机号:852…"` — 跨案串并（并案时）

## 铁律
1. `cite` 为 null 的内容只能作为线索/方向叙述，禁止打角标；如实转述 `why_not_citable`。
2. 引用原样复制 `cite`；禁止自拼 `Goldeneyes://`、禁止改行号。
3. `involved_score`（聊天相关度）与 `suspicion_score`（资金可疑度）分开表述，不相加、不混排。
4. 报告/画像是**推断**：写「火眼 AI 研判认为…」；要下事实判断必须有 `citable=true` 的原文引用。
5. 线索的聊天时间范围是**分片范围**，不是精确证据时间。
6. `coverage.report=missing` 时明说「案件画像未生成」，不要臆测；`round.complete=false` 时提示「研判未完成，结论可能不完整」。
```

### 6.3 桌面版设置与「更新索引」按钮（决策 1 的交互落地）

设置页（Electron 内新增一个轻量设置面板，或复用现有设置能力）：

| 项 | 说明 |
| --- | --- |
| 案件目录 | 默认 = dsh 当前工作目录；可改（支持多案件切换） |
| AI 研判目录 | 指向火眼报告输出目录；默认按 `案件目录` 推 `AI研判`，可手选 |
| ges.exe 路径 | 建库器回查引用用；仅建库时用，会话不可见 |
| 中央并案库 | 可选，默认 `<workspace>\indexes\crosscase.db` |

按钮流：`preflight` → 显示「report 状态 / checkpoints n/9 / 预计耗时」→ 用户确认 → `build`（后台任务 + 进度）→ 成功后显示「库已更新：轮次 3，9/9，引用 412 条」→ 失败保留旧库并给日志路径。

---

## 7. 里程碑（合计 4–5 人天）

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M0**（0.5d）preflight + 链路 spike | 先在火眼跑完 AI 研判；`preflight` 正确判断完整/不完整；用线索 CSV 跑通「解析→入库→查询→JSON」 | `preflight` 报 `report/checkpoints` 实况；线索可查、按 score 排序 |
| **M1**（1d）案件画像 | `report.json|md` + 9 个 checkpoints → `ai_report`/`ai_finding`/FTS；轮次隔离 | 9/9 入库；两轮混存时只采纳完整轮 |
| **M2**（1d）引用回查 | eid/pid/line、source_handles、traceUrl → `citation`；`verify` 抽样 | 抽样 50 条 **一致率 100%**；不确定一律 `status≠ok` |
| **M3**（0.5d）画像+实体+查询端 | 人物/检材画像（`stale`）、`检材信息`/`实体分类`/`检材持有人` 入库、7 命令 + ≤2KB 预算 | 单次 ≤2KB；P50 ≤200ms；伪造引用用例全拦 |
| **M4**（1d）桌面设置+一键更新 | 设置面板、`build` 进度、备份/原子替换、跨案导入 | 打包版里点【更新索引】成功；坏库自动回滚 |
| **M5**（0.5d）文档 + 回归 | `docs/case-index.md` 操作手册、本案实测数字、随包 skill 验证 | 打包版 `skill` 能加载 `ges-case-index`；未建库给出明确提示 |

---

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| **写案件目录**（合规/完整性） | 只写 `.seeu-index\` 派生目录；文档声明「非证据、可删可重建」；绝不碰 `.gec`/`data`/`filesystem`；建库器只读原始 |
| AI 研判未跑/报告目录未配（当前状态） | `preflight` 拦截 + 指引；只有线索时允许建「部分库」，`coverage` 如实标 |
| 重跑期间新旧材料混存 | `snapshotKey`+`stage` 分轮；不齐套的轮不设 `is_current`，界面提示「研判未完成，已保留上一版」 |
| 覆盖更新时 dsh 正在读旧库 | 建临时库 → 校验 → 备份旧库 → `rename` 原子替换；只读连接重开（Electron 侧先关连接再替换） |
| 中间结论被当成事实 | `ai_*` 全 `citable=0`；引文只能来自 `citation`；skill 铁律 |
| JSON 行号/displayNo 误用 | 库里不给 `ai_*` 存行号字段作为引文；行号只在 `citation` 里且由回查产生 |
| 线索无记录 ID、时间范围是分片 | `citable=0` + `why_not_citable`；不自动角标 |
| 两种分数混算 | `score_kind` + skill 铁律 + 默认不跨 kind 排序 |
| 画像 `画像说明.md`（历史名称） | `stale=1`，输出标注「历史映射」 |
| 中文/emoji/空格路径 | 全走参数数组 + `--json`；不拼 shell；NFC 归一 |
| 端口漂移 | 建库时从 `ges status --json` 读 `ges_url`，不硬编码 |
| 中央并案库多写冲突 | 单写者锁；导入幂等（按 `case_number+built_at` 覆盖该案数据） |

---

## 9. 还需你确认 2 件事

1. **`.seeu-index\` 落在案件目录里可以吗？**（你的第 2 条选择是「跟案件目录」，我按合规方式收敛成子目录而不是直接写案件根；若比赛要求「不动案件目录一个字节」，我改成默认放 workspace、可配置回案件目录。）
2. **跨案并案库的位置**：默认 `<workspace>\indexes\crosscase.db`（所有案件汇总），还是每个案件本地的 `crosscase` 也留一份？

其余（分析者=火眼 AI、关键词检索、只读+不给 ges、4 skill 不随包）已按你的答复定稿，不再问。

---

## 10. 附：本次实测证据

```bash
G=D:\Programs\Honglian\GoldenEyesV4\skills\ges-case-analysis\bin\ges.exe
$G ls "/case/AI研判" --json          # 人物画像/ 使用说明.md 案件画像/ 检材画像/ 线索挖掘/
$G ls "/case/AI研判/案件画像" --json  # entries: []          ← 报告未生成
$G ls "/case/AI研判/线索挖掘" --json  # 好友线索.csv 群组线索.csv
$G read "/case/AI研判/使用说明.md"     # 9 个 checkpoint 字段契约 + 引用规则（§3）
$G glob -p "**/chat.txt" --path /case/ --json --compact   # total 33
$G glob -p "**/*.csv"   --path /case/ --json --compact    # total 343
node -e "…master.db…"                 # case.analyze_status = 0（未分析）
```
