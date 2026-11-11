# 火眼「全解析结果」入库 · dsh 只查库 —— 实施计划 v4

> 状态：待评审（v4，2026-11-11）
> 前置共识（v3 起沿用）：**我们不训练、不运行分析模型**。分析者是火眼；dsh 侧只做"查询派生数据库"。
> v4 相对 v3 的唯一变化：**入库对象从「AI 研判报告」改为「火眼对检材的全解析结果」**（`/case/检材分析数据/**`），AI 研判目录（案件画像 / 检材画像 / 人物画像 / 线索挖掘）不再入库。

---

## 0. TL;DR

1. **把火眼已经解析出来的全部结构化数据抓进一个案子一个的 SQLite**：`<案件目录>\.seeu-index\case-index.db`。
   - 来源：`/case/检材分析数据/**` 下所有叶子（CSV / chat.txt / 二进制元数据），加 `/case/关联分析/**` 的派生表。
   - 实测本案（W盘）共 **370 个叶子**：337 个 `data.csv` + 33 个 `chat.txt`；有解析数据的检材是 eid3 / eid5。
2. **每条记录都带溯源基址 + 行号**：`Goldeneyes://<case_number>/<node_id>#<line>`，可直接出现在报告角标里；不可引用的一律标 `citable=0`。
3. **dsh 会话只挂一个约 50 行的小技能** `ges-case-index`，它调 `ges-index query …`；**不给 dsh 任何 `ges.exe` 权限，数据库只读打开**。
4. 建库是**一次性离线动作**：桌面版点【更新索引】→ 进度条 → 完成。重新点就**整库覆盖**（先建临时库、校验、留一份旧版备份、原子替换），符合你说的"有更新就重新覆盖"。
5. 关键词检索用 SQLite FTS5（trigram）+ `LIKE` 回退（实测 trigram 对 2 字中文查询无效，必须回退），不依赖火眼的向量索引（本案 `ges search` 当前不可用：缺 `res/vector_search/tree.pkl`）。

---

## 1. 需求与已定决策

| # | 你的决策（v3 已确认） | 本计划的落实 |
|---|---|---|
| 1 | "只分析一次"的产出由**火眼**给；dsh 不跑模型 | 只做 ingest；无 LLM 调用、无联网 |
| 2 | 数据库**跟着案件目录** | `<案件目录>\.seeu-index\case-index.db`（新建派生目录，不动火眼任何文件） |
| 3 | 跨案检索"按一般取证比赛思路来" | 中央库 `<workspace>\indexes\crosscase.db`：跨案同号/同账号/同钱包/同文件哈希 |
| 4 | 语义检索**先试关键词** | FTS5 + LIKE；向量检索只留扩展位，不做 |
| 5 | 会话侧 **DB 只读 + 完全不给 ges.exe** | 查询进程 `--readonly` 打开；dsh 侧无 `ges` 二进制、无 shell 网络插件 |
| 6 | 4 个官方 skill **不放进我们的安装位置** | 不随包；我们的新 skill 是自研的 `ges-case-index`（行为契约在 §7） |
| 7（v4 新） | 要**全解析结果**，不要 AI 研判结论 | 入库范围 = `检材分析数据/**` + `关联分析/**`；`AI研判/**` 不入 |

---

## 2. 实测现状（本案：W盘 / `2919d298-f083-4a81-9c12-bd4ca393bcc5`）

### 2.1 案件与检材

- `cid=1`，`ges_url=http://127.0.0.1:8174`，`display_timezone=Asia/Shanghai`，案件目录 `E:\forensics\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5`。
- 检材 5 个（eid 1–5）：CHAN_MH_mobile.zip / IQ_Coin_Type_Transactions.zip / LEUNG_YL_mobile.zip / AP3_LEUNG_YL_USB.E01 / FUNG_CC_mobile.zip。
- **解析数据分布**：eid3（8 个应用/类别）、eid5（9 个）有实质解析结果；eid1/eid2/eid4 目前只有 `实体分类/` + `检材信息/`。

### 2.2 `检材分析数据/未指定持有人/<eid>/` 结构（实测）

```
3/
├── 微信/<账号昵称>(<wxid>)/            # 好友消息/群聊消息/通讯录/朋友圈/公众号消息/小程序/视频号/消息碎片/验证消息/账户信息/node_*
├── WhatsApp/<昵称>(<手机号@s.whatsapp.net>)/
├── Safari/                          # 书签记录/历史记录/搜索历史/标签页记录/未关闭的标签页
├── Instagram/
├── 苹果健康/未设置/
├── 图片Exif信息/data.csv            # 615 行
├── 基本信息/                        # 16 个子类：SIM卡记录/Wi-Fi连接记录/个人热点/图片/应用列表/
│                                    #   应用授权日志/日历/短信/网络使用详情/蓝牙/视频/设备信息/
│                                    #   设备容量记录/账号信息/通讯录/通话记录
├── 实体分类/                        # 9 类：IP地址/快递单号/手机号/网址/虚拟钱包/身份证/车牌号/邮箱/银行卡，
│                                    #   每类一个 data.csv
└── 检材信息/data.csv                # 26 列元数据（含 MD5/SHA1/SHA256/SHA512/SM3/CRC64、时区、大小）
```

### 2.3 叶子形态（决定解析器怎么写）

| 形态 | 实测样例 | 解析方式 |
|---|---|---|
| `data.csv` | 通讯录：`头像,名称,号码,归属地,分组,创建时间,邮箱,…`（5 行）<br>账号信息：`用户ID,账户名,密码,登录url,来源`（25 行）<br>Exif：`名称,拍摄时间,修改时间,软件,纬度(度分秒表示法),经度(度分秒表示法)`（615 行） | 首行**基址** + 第 1 行中文表头 + 数据行；按表头做列映射，行号 = read 返回的行号列 |
| `chat.txt` | 第 1 行 `[摘要] 时间: 2025-04-08 ~ 2025-04-09 \| 消息: 12条（本机发送8条）`，第 2 行起 `2025-04-08 11:27:38 \`陳民浩\` 说：…`、`… \`💕~Ling~💕🎶\`[本机] 说：…` | 解析成 `msg`：ts / speaker / 本机标记 / 内容；摘要行单独存 `chat_meta` |
| 二进制（图片/视频） | `基本信息/图片/`、`基本信息/视频/` | 只取**元数据/文件名/来源路径**，不入二进制内容；不做 OCR、不做视觉分析 |
| 派生 CSV | `/case/关联分析/*/data.csv`（检材持有人、共同群组、共同联系人、持有人之间联系） | 入库但 **`citable=0`**（文件自带横幅明确说没有溯源句柄） |

### 2.4 溯源能力（关键实测定论）

- `ges read` 对 `/case/` 下的 CSV 与 chat.txt 都会在首行输出
  `〔本文件溯源基址 Goldeneyes://2919d298-f083-4a81-9c12-bd4ca393bcc5/<node_id>〕`（实测：通讯录 `…/187000004`、账号信息 `…/187000074`、Exif `…/162000000001`、chat `…/229000000201`）。
- 因此 **CSV 行和聊天消息都能生成合法角标**：`[[N]](Goldeneyes://<case>/<node>#<行号>)`；表头行、`[摘要]` 行**不可引**（沿用官方 skill 规则）。
- 案件目录侧的 `citable=0` 数据（关联分析、线索 CSV 类派生表）只做导航，不生成角标。

### 2.5 两处必须提前知道的限制

1. `ges search`（向量语义搜索）当前报错：`res/vector_search/tree.pkl` 不存在，需要在 GES 里"完成案件向量入库"。→ 我们的检索不依赖它。
2. `/case/关联分析/` 的部分表带"禁止根据本页行号生成角标"横幅 → 入库时逐文件读横幅/首行判定 `citable`，不要靠目录名猜。

---

## 3. 目标 / 非目标

**目标**
- 一次建库把"火眼解析出来的案件数据"变成可 SQL 查询、可全文检索、可溯源的本地产物。
- dsh 每个会话只加载 ~50 行技能说明，单次查询输出 ≤ 2 KB，token 成本从"现场读几十个 CSV"降到"一条命令"。
- 建库可重复、可覆盖、可审计（指纹 + 计数 + 失败清单）。

**非目标**
- 不做 AI 研判/画像/线索结论（用户已明确不要）。
- 不做图片 OCR、音视频理解、语义向量检索（留扩展位）。
- 不替代火眼：需要"原始文件字节 / 未解析的挂载目录"时仍回火眼操作（dsh 侧不给 ges.exe，见 §7）。
- 不修改案件目录里火眼的任何文件；只写 `.seeu-index\`。

---

## 4. 总体架构

```
[火眼 GoldenEyes]                        [我们的建库器 ges-index build]              [dsh 会话]
 解析完成的案件                             （桌面版【更新索引】，离线跑一次）           ges-case-index skill
   ├ /case/检材分析数据/**  ──ges read──►  ① 探测案件/检材/叶子全集                     （50 行说明 + 5 个命令）
   ├ /case/关联分析/**      ──ges read──►  ② 逐叶分页抓取 + 解析（CSV/chat）      ──►   ges-index query …（只读 DB）
   └ /case/检材信息            ────────►   ③ 投影到 typed 表 + 实体抽取                  │
                                          ④ 校验（叶数/行数/基址覆盖率）                 ▼
                                          ⑤ 临时库→integrity_check→备份→原子替换   <case_dir>\.seeu-index\case-index.db
                                                                                     + 中央库 indexes\crosscase.db
```

- 建库器 = 随桌面版分发的 Node CLI（`resources/case-index/ges-index.cjs`，打包进 asar），运行时由 Electron 以 Node 模式 spawn，**不进入 dsh 的对话进程**。
- 查询器 = 同一个可执行文件的 `query` 子命令，由 dsh 的 skill 通过一个小包装脚本调用（白名单参数、只读打开）。
- 数据流单向：火眼 → DB。DB 永远是派生品，删掉可重建。

---

## 5. 数据库设计（SQLite，单文件）

```sql
-- 元信息
create table case_info(
  case_number text primary key, name text, cid integer, ges_url text,
  timezone text, case_dir text, schema_version integer, built_at text,
  source_fingerprint text, tool_version text, counts_json text
);
create table evidence(
  eid integer primary key, name text, holder text, platform text, ev_type text,
  timezone text, size_bytes integer, md5 text, sha1 text, sha256 text, sm3 text,
  imported_at text, updated_at text, raw_json text
);

-- 叶子文件（一个 data.csv / chat.txt / 二进制目录 = 一行）
create table artifact(
  id integer primary key,
  eid integer references evidence(eid),
  app text,            -- 微信 / WhatsApp / Safari / 基本信息 / 实体分类 / 图片Exif信息 …
  category text,       -- 通讯录 / 通话记录 / 好友消息 / 历史记录 / 手机号 …
  subcat text,         -- 账号昵称、联系人、群名等中间层级（原样保留）
  virtual_path text unique not null,
  kind text,           -- csv | chat | binary | other
  base_handle text,    -- Goldeneyes://<case>/<node>   （读不到则为空）
  node_id text,
  line_count integer,  -- read 报的总行数
  citable integer,     -- 1 = 可生成角标
  citable_reason text,
  content_sha256 text, -- 归一化后文本的哈希（增量判定用）
  ingested_at text
);

-- 通用行表：所有 CSV 行、chat 摘要行、bin 目录条目都先落这里（未知类别也不会丢）
create table record(
  id integer primary key,
  artifact_id integer references artifact(id),
  eid integer, app text, category text,
  row_no integer,          -- CSV 数据行序号（表头不计）
  line_no integer,         -- read 返回的行号（生成角标用）
  ts text,                 -- ISO 本地时间（可空）
  actor text, target text,
  text text,               -- 可检索正文（chat 内容 / CSV 行拼接）
  fields_json text,        -- {"列名":"值", …} 原样列名，抗列漂移
  citable integer, base_handle text
);
create virtual table record_fts using fts5(
  text, fields_text, content='', tokenize='trigram'
);

-- 聊天会话元信息（chat.txt 的 [摘要] 行）
create table chat_meta(id integer primary key, artifact_id integer, app text,
  account text, peer text, is_group integer, msg_count integer, sent_count integer,
  time_from text, time_to text, summary_line text);

-- 实体：火眼「实体分类」直接入，另从 record 自动抽
create table entity(id integer primary key, kind text, value_raw text, value_norm text,
  eid integer, hits integer, first_ts text, last_ts text,
  unique(kind, value_norm, eid));
create table entity_mention(id integer primary key, entity_id integer, record_id integer,
  artifact_id integer, confidence text default 'exact');

-- typed 投影（由 column-map 配置生成；查不到的类别只留在 record）
create table msg(id integer primary key, record_id integer, eid integer, app text,
  account text, peer text, is_group integer, ts text, speaker text, is_local integer,
  body text, citable integer, base_handle text, line_no integer);
create table contact(id integer primary key, record_id integer, eid integer, app text,
  account text, name text, number text, number_norm text, group_name text, created_at text,
  fields_json text);
create table call_log(...);        -- 通话记录：号码/方向/时长/时间/来源应用
create table sms(...);             -- 短信：号码/联系人/方向/内容/时间
create table txn(...);             -- 交易/资金：金额/币种/方向/对手/时间/摘要（eid2/eid5 若有）
create table web_visit(...);       -- Safari 历史/搜索/书签
create table exif(...);            -- 图片 Exif：名称/拍摄时间/经纬度/软件
create table account_info(...);    -- 账号信息：用户ID/账户名/登录URL/来源
create table app_install(...);     -- 应用列表/应用授权日志
create table device_info(...);     -- 设备信息/设备容量/SIM/Wi-Fi/蓝牙/热点/网络使用/日历/健康
create table file_meta(...);       -- 图片/视频目录条目（无二进制）

-- 溯源与审计
create table citation(id integer primary key, record_id integer, base_handle text,
  node_id text, line_no integer, citable integer, status text, -- ok | derived | missing
  verified_at text, method text);   -- read | csv | chat | manual
create table ingest_round(id text primary key, kind text, -- rebuild | update
  source_fingerprint text, started_at text, finished_at text, status text,
  artifacts integer, records integer, citations integer, errors_json text);
create table ingest_error(id integer primary key, round_id text, virtual_path text,
  stage text, message text, retried integer);
create table column_map(app text, category text, kind text, column text,
  target_table text, target_field text, transform text, updated_at text);
create index record_fts_idx on record_fts(text);
create index record_lookup on record(artifact_id, row_no);
create index record_ts on record(ts);
create index entity_lookup on entity(kind, value_norm);
```

**设计要点**

1. **通用 `record` 是兜底**：火眼版本升级、新应用、新类别只会让 `column_map` 缺映射，数据本身不会丢；映射补上后再重投影即可，不用重新抓。
2. **`fields_json` 保留原始中文列名**，查询时 `json_extract(fields_json,'$.号码')` 也能取；typed 表只是性能和可读性的加速层。
3. **`citable` 由内容判定，不由目录名猜**：写库时检查首行是否 `〔本文件溯源基址 …〕`，有 → 1；关联分析横幅 → 0 并记 `citable_reason='derived-no-handle'`。
4. **行号即引用**：`record.line_no` 存 read 输出的行号（CSV 数据行 = 表头+1 起，chat 消息行 = 原样），与官方角标格式一一对应。
5. **中文检索**：FTS5 `trigram` 对 ≥3 字符有效（英文、数字、姓名、手机号），1–2 字查询（如"转账"）自动回退 `LIKE '%…%'`（本案数据量下 <100 ms）。
6. 全库约 370 个 artifact，预估 record 数 3–15 万，DB 预计 **< 120 MB**（实测后回填）。

---

## 6. 建库器：`ges-index build`

```
ges-index build --case <case_number|--case-dir <dir>> [--scope all|parsed|related]
                [--rebuild|--update] [--concurrency 3] [--json]
```

步骤：

1. **探测**（约 1 秒）
   - `ges case ls --json` 找案 → `ges case open <case_number>` 拿 `cid`（整数）；
   - `ges status --json` 拿 `routes`、`skills_dir`、`evidence_mounts`；
   - 逐检材读 `检材分析数据/未指定持有人/<eid>/检材信息/data.csv` 得元数据（哈希、时区、大小）。
2. **叶子全集枚举**
   - `ges glob` 多模式：`**/data.csv`、`**/chat.txt`、`**/*` 中的二进制目录单独枚举；
   - 与 `ls` 递归交叉校验（**覆盖率验收：artifact 数 == 枚举数**）；
   - 只枚举 `/case/检材分析数据/**`（+ 可选 `/case/关联分析/**`），**不碰 `/case/AI研判/**`**。
3. **逐叶抓取 + 解析**
   - `ges read <path> --offset N --limit 200` 分页直到 `next_offset == null`；
   - 解析首行基址 → `artifact.base_handle/node_id`；CSV 表头 → 列名；chat `[摘要]` → `chat_meta`；
   - 每 1 叶完成即写 `artifact` + `record` 批次（事务提交），失败记 `ingest_error` 并继续（单叶重试 2 次，退避 0.5/1.5s）；
   - 并发 2–4（同一个 ges 后台，实测读接口稳定，压测在 M1 定时）。
4. **投影 + 实体**
   - `column_map` 命中 → typed 表；未命中 → 只留 `record`；
   - 实体抽取：火眼 9 类实体 CSV 直接入库；另对 record 做正则抽取（手机号/邮箱/URL/钱包地址/银行卡/身份证/车牌/IP），标注 `confidence='auto'`。
5. **校验**
   - `pragma integrity_check`、`foreign_key_check`；
   - 叶覆盖率 100%、基址覆盖率 ≥ 95%（CSV+chat）、每叶行数与 `read` 报的 total 一致；
   - 抽 20 条随机引用回查：`ges read base_handle 的路径 --offset line-1 --limit 1`，内容与 DB 一致 → **验收 20/20**。
6. **原子替换**
   - 写 `<case_dir>\.seeu-index\tmp\case-index.db` → 成功后 `case-index.db.bak`（保留 1 份）→ `fs.renameSync` 替换；
   - 落 `manifest.json`：指纹（检材集合 + 各 `检材信息.更新时间` + 叶子数）、统计、耗时、工具版本、失败清单。

**性能目标**：本案 370 叶 / 约 5 万行 → **≤ 6 分钟**（含读 337 个 CSV + 33 个 chat.txt）；增量（`--update`，按 artifact 指纹比对）≤ 60 秒。

---

## 7. 查询面：`ges-index query` + dsh 技能契约

### 7.1 命令（全部 JSON 输出，只读连接）

| 命令 | 作用 | 典型用途 |
|---|---|---|
| `query overview` | 案件/检材/应用/类别/计数 | 开场先看有什么数据 |
| `query search -q <kw> [--eid] [--app] [--category] [--from] [--to] [--limit 20]` | 关键词检索（FTS + LIKE 回退） | "谁提到 转账"、"8525* 出现在哪" |
| `query records --artifact <id> [--offset 0] [--limit 20]` | 看某叶子原始行 | 定位后看上下文 |
| `query get <record_id>` | 单条记录全字段 | 精读 |
| `query cite <record_id>...` | 生成角标（含 `citable`/`status`） | 写给报告的引用 |
| `query entity <kind> <value>` | 实体命中记录（跨检材） | 同一手机号/钱包的所有出现 |
| `query timeline --from --to [--eid] [--app]` | 时间线（合并所有带 ts 的表） | 案发时间窗 |
| `query stats` | DB 版本/指纹/建库耗时 | 判断是否需要重建 |

输出上限：**单次 ≤ 2 KB / ≤ 60 行**，超出给 `{"truncated":true,"next_cursor":"…"}`；每条结果必须含 `record_id` 与 `cite` 提示，不返回整表。

### 7.2 随包技能 `resources/forensics/skills/ges-case-index/SKILL.md`（约 50 行）

要点：
- **何时用**：当前工作目录是已建库的案件目录（`<case_dir>\.seeu-index\case-index.db` 存在）。
- **怎么用**：只允许 6 个 `ges-index query` 命令，输入输出都是 JSON；先 `overview` 再 `search`，不要凭猜测写路径。
- **引用铁律**：只有 `cite` 返回 `citable=1` 才能写角标；`citable=0`（关联分析等派生数据）只能作为线索描述，并注明"派生数据，无溯源句柄"；禁止编造 `Goldeneyes://` 基址。
- **边界**：DB 是火眼解析结果的快照，不含 AI 结论、不含原始文件字节；需要原始文件或深度分析时明确告诉用户"需要回火眼操作"。
- **禁止**：不执行 `ges`、不改 DB、不联网。

### 7.3 token 账

| 场景 | 上下文成本 |
|---|---|
| 旧方式：会话里去读 4 个官方 skill + 现场 `ges read` 几十个 CSV | 约 20k token（4 个 skill 全量 72 KB）+ 每次读文件 1–5k |
| 新方式：`ges-case-index` skill 常驻 | 约 800 token |
| 每次查询 | 约 300–600 token（≤2 KB JSON） |

---

## 8. 桌面版集成（SeeUForensicsAgentPlus 侧）

1. **设置案件目录**：文件菜单 → 选择案件目录（默认取 dsh 工作目录 `Documents\SeeUForensicsWorkspace` 或用户选）；写进 `%APPDATA%\SeeUForensicsAgentPlus\case-dirs.json`。
2. **【更新索引】按钮**（窗口右上 + 菜单）：
   - 前置检查：案件目录存在、`ges case ls` 能找到对应案（或用户手动指定 `case_number`）、`ges` 可用（仅建库时用；dsh 会话里不给）；
   - 进度：`探测 → 枚举 N 叶 → 抓取 i/N（当前路径）→ 投影 → 校验 → 替换`，可取消；
   - 失败：弹错误页 + 打开日志；DB 保持旧版不变（原子替换保证）。
3. **DB 位置与权限**：`<case_dir>\.seeu-index\`；dsh 查询进程以只读打开；`.seeu-index` 在文件系统里对 dsh 沙箱只读（若沙箱不允许，则退化为"通过 `ges-index` 子进程查询"）。
4. **不污染案件目录**：只创建 `.seeu-index\` 一个隐藏目录，内含 `case-index.db`、`case-index.db.bak`、`manifest.json`、`logs/`；不写火眼其它目录。
5. **无火眼时降级**：`ges` 不可用 → 按钮置灰 + 提示"未检测到火眼客户端"；已有 DB 仍可查询。

---

## 9. 跨案（比赛思路）

`<workspace>\indexes\crosscase.db`（各案建库成功后增量同步）：

```sql
create table case_ref(case_number text primary key, name text, case_dir text,
  db_path text, built_at text, fingerprint text);
create table cross_entity(id integer primary key, kind text, value_norm text,
  case_number text, eid integer, hits integer, unique(kind,value_norm,case_number,eid));
create table cross_mention(id integer primary key, cross_entity_id integer, case_number text,
  record_id integer, base_handle text, line_no integer, ts text, snippet text);
create table cross_file(id integer primary key, sha256 text, case_number text, eid integer,
  virtual_path text);  -- 同文件在不同案件复用
```

查询：`ges-index xcase search -q 85254877240` → 哪些案子/检材/持有人出现过同一号码；输出同样带"案号 + base_handle"以便分别引用。

---

## 10. 里程碑与验收

| 里程碑 | 内容 | 人天 | 验收标准 |
|---|---|---|---|
| **M0 可行性 spike** | 抓 1 个检材（eid3 全部叶子）→ 落 SQLite；测 read 分页吞吐、基址覆盖率、chat/CSV 解析正确性 | 0.5 | 抽 20 条引用回查 20/20 一致；eid3 叶覆盖 100% |
| **M1 建库器骨架** | 探测/枚举/抓取/`record`+`artifact`+`ingest_log`；`--rebuild` 原子替换 | 1.5 | 本案全量建库 ≤ 6 min；DB ≤ 120 MB；失败清单为空 |
| **M2 投影 + 实体 + 引用** | `column_map` 首批映射（通讯录/账号/Exif/通话/短信/微信/WhatsApp/Safari/基本信息 16 类）；`entity` 抽取；`citation` | 2 | typed 表覆盖 ≥ 90% 记录；实体命中可跨检材查询 |
| **M3 查询 CLI + 技能** | 8 个 query 子命令 + `ges-case-index` SKILL.md + token 预算测试 | 1 | 单查询 P50 < 100 ms；输出 ≤ 2 KB；技能说明 ≤ 60 行 |
| **M4 桌面集成** | 【更新索引】按钮、进度、设置案件目录、只读查询进程 | 1 | 从 0 到可查询全程 GUI 完成；取消/失败不损坏旧库 |
| **M5 跨案 + 文档** | `crosscase.db` 同步与查询；文档（本计划转正式文档 + 用户手册）；回归用例 | 1 | 两案间同号/同哈希可查；文档含排障 |

合计约 **7 人天**（不含火眼侧配合）。建议做完 M0 再决定是否继续（M0 能提前暴露行号对齐/吞吐问题）。

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 火眼版本升级导致目录/列名变化 | 映射失效 | 通用 `record`+`fields_json` 兜底；`column_map` 配置化；建库时记 `tool_version` |
| `read` 行号与 `copy` 文件行号不一致 | 引用错位 | **只用 `read` 建引用**；copy 只作性能加速候选，且必须先做对齐实验（M0） |
| 大 CSV / 大 chat 分页慢 | 建库超时 | 并发 2–4、页 200 行、失败重试、可断点续跑 |
| 基址缺失（个别叶子无句柄） | 不可引用 | `citable=0` + `citable_reason`，报告里明确标注 |
| 关联分析自带横幅"禁止角标" | 误引用 | 逐文件判横幅 → `citable=0`；skill 里写死规则 |
| 中文/emoji 路径（`U+1F495~Ling~…`） | 编码错乱 | 全程 UTF-8、路径原样存库，不做 URL 编码变换 |
| ges 端口漂移 / 后台重启 | 建库中断 | 每阶段重新 `ges status` 校验；失败可重跑 |
| 写案件目录引发争议 | 证据完整性 | 只写 `.seeu-index\` 派生目录；DB 只读；可一键删除重建 |
| 单写者锁（SQLite WAL 跨进程） | 查询被锁 | 查询用只读连接 + `busy_timeout`；建库期间禁止查询（UI 锁） |
| 隐私/外发 | 合规 | 100% 本地；无网络调用；不接向量服务 |

---

## 12. 待你确认（4 条）

1. **入库范围**：默认 = `检材分析数据/**` + `关联分析/**`（citable=0）。`标记数据/`（人工标记）与 `笔记数据/`（火眼笔记）要不要也入库？我倾向"入，但只作导航表"。
2. **图片/视频**：只入元数据（文件名/时间/来源路径），不做 OCR/缩略图，可接受吗？
3. **DB 位置**：`<案件目录>\.seeu-index\` 已按你的决策；如果某些比赛机器案件目录只读，是否允许回退到 `%APPDATA%\SeeUForensicsAgentPlus\indexes\<case_number>\`？
4. **跨案库**：`<workspace>\indexes\crosscase.db` 是否就放在 dsh 工作目录下？还是你希望放到桌面版数据目录（`%APPDATA%`）？

---

## 附：关键命令实测记录

```text
ges case ls --json            → 1 案：2919d298-f083-4a81-9c12-bd4ca393bcc5 / W盘 / http://127.0.0.1:8174
ges case open 2919d298-…      → Case already open；cid=1；display_timezone=Asia/Shanghai
ges status --json             → routes=["/case/","/evidence_mounts/"]；cid=1
ges ls /case/ --json          → 5 个顶层：AI研判/ 关联分析/ 标记数据/ 检材分析数据/ 笔记数据/
ges ls /case/检材分析数据/未指定持有人/3/ → 8 类（Safari/WhatsApp/图片Exif信息/基本信息/实体分类/微信/检材信息/苹果健康）
ges glob "**/data.csv" --path /case/检材分析数据/ → total 337
ges glob "**/chat.txt" --path /case/检材分析数据/ → total 33
ges read …/基本信息/通讯录/data.csv → 首行基址 Goldeneyes://…/187000004；5 行
ges read …/基本信息/账号信息/data.csv → 基址 …/187000074；25 行
ges read …/图片Exif信息/data.csv → 基址 …/162000000001；615 行
ges read …/好友消息/陳民浩(85254877240@s.whatsapp.net)/chat.txt → 基址 …/229000000201；[摘要]+消息行
ges search "…" → ERROR：res/vector_search/tree.pkl 不存在（未做向量入库）
```
