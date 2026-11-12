# 火眼「全解析结果」入库 · dsh 只查库 —— 实施计划 v4.2（M0 已实测通过）

> 状态：待评审（v4.1，2026-11-11；已并入你对 4 个问题的确认：标记/笔记入库、OCR 开关、只读只提示、跨案库放 dsh 工作目录）
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
6. `标记数据/`、`笔记数据/` 一并入库，但只作**导航表**（`citable=0`，保留火眼的 `原文记录ID`）；图片/视频默认只入元数据，**OCR 是开关**（默认关）。

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
| 8（v4.1 确认） | `标记数据/`、`笔记数据/` **要入** | 入导航表，`citable=0`，保留 `原文记录ID`（见 §5、§6.2） |
| 9（v4.1 确认） | 图片/视频：元数据默认，**OCR 做成开关** | 默认只入元数据；`--ocr=off\|auto\|force`（默认 off），需要时再跑（见 §7.4） |
| 10（v4.1 确认） | 案件目录只读 → **提示用户** | 建库前探测写权限；不可写弹提示，不静默回退（见 §8.2） |
| 11（v4.1 确认） | 跨案库放 **dsh 工作目录** | `<dsh 工作目录>\indexes\crosscase.db`（默认 `Documents\SeeUForensicsWorkspace\indexes\`） |

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

/case/标记数据/<标记名称>/…          # 如 嫌疑/可疑；其下沿用 持有人/检材/应用/会话 目录，chat.txt / data.csv
/case/笔记数据/<笔记名称_ID>/        # 笔记.md（标题/备注/检材/关联记录数）+ chat.txt（选中的聊天）+ data.csv（其他记录）
```

**图片/视频**：`基本信息/图片/{屏幕快照,应用,相机胶卷}/data.csv`、`基本信息/视频/…` 都只有元数据 CSV，二进制不在 `/case/` 导出，因此"只入元数据"与"OCR 开关"互不影响：OCR 需要时另行从 `/evidence_mounts/` 或 `ges copy` 取原图。

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
3. **标记/笔记的引用坐标不在 CLI 里**：使用说明要求用 GES 工具 `get_context(path, 原文记录ID)` 取"经过校验的 节点ID#原文件行号"；`ges` CLI 没有 `get_context`（`ges context` 只是 `status` 的别名，见 `ges help`）。→ 这两类数据入库后 `citable=0`，保留 `origin_record_id`，将来对接 GES 工具服务后再补校验。
4. 标记/笔记文件的**行号、搜索结果序号不是原文行号**（说明原文），严禁据此拼 `Goldeneyes://` URI；我们只把它们当导航。
5. 标记/笔记在**本案为空**（`/case/标记数据/`、`/case/笔记数据/` 各只有一个 `使用说明.md`），入库器必须容忍"只有说明文件"的情况（跳过 `使用说明.md`，记 0 条）。

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

-- 标记数据（导航表，citable=0；本案为空）
create table mark_category(id integer primary key, name text,      -- 嫌疑 / 可疑 …
  record_count integer, updated_at text);
create table mark_record(id integer primary key, mark_category_id integer, 
  virtual_path text, eid integer, app text, holder text, account text, peer text,
  origin_record_id text,      -- 火眼「原文记录ID」；引用需 get_context 校验
  ts text, actor text, body text, fields_json text, record_id integer);

-- 笔记数据（导航表，citable=0；本案为空）
create table note(id integer primary key, note_dir text unique, note_name text, note_id text,
  title text, remark text, evidence_refs text, related_count integer, updated_at text);
create table note_record(id integer primary key, note_id integer, virtual_path text,
  origin_record_id text, ts text, actor text, body text, fields_json text, record_id integer);

-- OCR（可选开关，默认 off；见 §7.4）
create table ocr_result(id integer primary key, image_artifact_id integer, eid integer,
  image_virtual_path text, engine text, lang text, confidence real,
  text text, ts text, base_handle text, line_no integer, citable integer default 0,
  created_at text, error text);
create virtual table ocr_fts using fts5(text, content='', tokenize='trigram');

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
ges-index build --case <case_number|--case-dir <dir>> [--scope all|parsed|related|marks|notes]
                [--rebuild|--update] [--concurrency 3] [--ocr off|auto|force] [--json]
```

步骤：

1. **探测**（约 1 秒）
   - `ges case ls --json` 找案 → `ges case open <case_number>` 拿 `cid`（整数）；
   - `ges status --json` 拿 `routes`、`skills_dir`、`evidence_mounts`；
   - 逐检材读 `检材分析数据/未指定持有人/<eid>/检材信息/data.csv` 得元数据（哈希、时区、大小）。
   - **可写性探测**：试写 `<case_dir>\.seeu-index\.probe`；不可写 → 返回 `E_CASE_DIR_READONLY`，由桌面版弹提示（§8.2），**不静默回退**。
2. **叶子全集枚举**
   - `ges glob` 多模式：`**/data.csv`、`**/chat.txt`、`**/*` 中的二进制目录单独枚举；
   - 与 `ls` 递归交叉校验（**覆盖率验收：artifact 数 == 枚举数**）；
   - 只枚举 `/case/检材分析数据/**`（+ 可选 `/case/关联分析/**`、`/case/标记数据/**`、`/case/笔记数据/**`），**不碰 `/case/AI研判/**`**；
   - 标记/笔记：跳过 `使用说明.md`，其余按 `chat.txt`/`data.csv` 解析；这两类 `citable=0`，`origin_record_id` 原样保留（聊天行前缀 `〔原文记录ID：数字〕` 或 CSV 的 `原文记录ID` 列）。
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
   - 抽 20 条随机引用回查：`ges read base_handle 的路径 --offset line-1 --limit 1`，内容与 DB 一致 → **验收 20/20**；
   - 标记/笔记为空（本案）时记 0 条且不报错；`--ocr off` 时 `ocr_result` 必须为 0 行。
6. **原子替换**
   - 写 `<case_dir>\.seeu-index\tmp\case-index.db` → 成功后 `case-index.db.bak`（保留 1 份）→ `fs.renameSync` 替换；
   - 落 `manifest.json`：指纹（检材集合 + 各 `检材信息.更新时间` + 叶子数）、统计、耗时、工具版本、失败清单。

**性能目标**：本案 370 叶 / 约 5 万行 → **≤ 6 分钟**（含读 337 个 CSV + 33 个 chat.txt）；增量（`--update`，按 artifact 指纹比对）≤ 60 秒。

### 6.1 M1 实现状态（as-built，2026-11-11）

实现落在 `tools/ges-index/`（随仓库提交，不进 electron-builder 打包白名单）：

| 文件 | 作用 |
|---|---|
| `ges.mjs` | `ges.exe` 定位（`SEEU_GES_EXE` → skill 目录 → PATH）、执行、JSON 解析、`glob` 分页、`read` 分页（解析基址行与 `N  正文` 行号） |
| `parse.mjs` | 路径分类（holder/eid/app/account/category/subcat）、CSV 行解析、chat.txt 解析（摘要行/空发言人/`〔原文记录ID〕`）、实体正则、DDL |
| `cli.mjs` | `build` + 查询命令（`tree`/`search`/`cite`/`stats`/`verify`）+ `manifest.json` |
| `README.md` | 使用说明 |

与 §5/§6 规格的差异（有意为之，M2 再补）：

1. **只建通用层**：`meta/case_info/evidence/artifact/record/record_fts/msg/chat_meta/entity/ingest_log`。`column_map` 与 typed 投影表（contact/txn/exif/…）**推迟到 M2**——`record.text` 已整行保存，`fields_json` 存原始中文列，重投影不需要重新抓取。
2. **命令面收敛为 5 个**：`tree`（主入口）、`search`（≥3 字符 FTS5 trigram，否则 LIKE 回退）、`cite`、`stats`、`verify`；`records` 由 `tree "art:<id>"` 承担，`overview` = `tree root`，`timeline`/`entity`/`marks`/`notes`/`ocr` 推迟（M2/M3/M6）。
3. `--scope`/`--update`/`--ocr` 未实现；当前只有全量 `--rebuild`（默认）与 `--resume`（断点续跑）、`--out`、`--concurrency`、`--limit-leaves`（冒烟）。
4. 库路径：`<case_dir>\.seeu-index\case-index.db`（`--out`/`--db` 可覆盖）；建库目录不可写 → 退出码 3 + `{"ok":false,"code":"E_CASE_DIR_READONLY"}`。
5. npm 脚本：`npm run index:build` / `index:tree` / `index:stats` / `index:verify`。

---

## 7. 查询面：`ges-index query` + dsh 技能契约

### 7.1 命令（全部 JSON 输出，只读连接）

| 命令 | 作用 | 典型用途 |
|---|---|---|
| `query tree <node>` | **树状导航（渐进式披露，主入口）**：一次只展开一层 | 从案件概览逐层钻到某条消息 |
| `query overview` | 案件/检材/应用/类别/计数（= `tree root`） | 开场先看有什么数据 |
| `query search -q <kw> [--eid] [--app] [--category] [--from] [--to] [--limit 20]` | 关键词检索（FTS + LIKE 回退） | "谁提到 转账"、"8525* 出现在哪" |
| `query records --artifact <id> [--offset 0] [--limit 20]` | 看某叶子原始行 | 定位后看上下文 |
| `query get <record_id>` | 单条记录全字段 | 精读 |
| `query cite <record_id>...` | 生成角标（含 `citable`/`status`） | 写给报告的引用 |
| `query entity <kind> <value>` | 实体命中记录（跨检材） | 同一手机号/钱包的所有出现 |
| `query timeline --from --to [--eid] [--app]` | 时间线（合并所有带 ts 的表） | 案发时间窗 |
| `query stats` | DB 版本/指纹/建库耗时 | 判断是否需要重建 |
| `query marks [-q <kw>]` | 标记记录（`citable=0`，含 `origin_record_id`） | "有没有被标为可疑的记录" |
| `query notes [--id <note_id>]` | 笔记表与笔记选中记录（`citable=0`） | 看侦查员自己的整理 |
| `query ocr -q <kw> [--min-confidence 0.6]` | OCR 文本检索（仅在开启 OCR 后有数据） | 截图/照片里的文字 |

输出上限：**单次 ≤ 2 KB / ≤ 60 行**，超出给 `{"truncated":true,"next_cursor":"…"}`；每条结果必须含 `record_id` 与 `cite` 提示，不返回整表。

### 7.2 随包技能 `resources/forensics/skills/ges-case-index/SKILL.md`（约 50 行）

要点：
- **何时用**：当前工作目录是已建库的案件目录（`<case_dir>\.seeu-index\case-index.db` 存在）。
- **怎么用**：只允许 9 个 `ges-index query` 命令（见 §7.1），输入输出都是 JSON；先 `overview` 再 `search`，不要凭猜测写路径。
- **引用铁律**：只有 `cite` 返回 `citable=1` 才能写角标；`citable=0`（关联分析等派生数据）只能作为线索描述，并注明"派生数据，无溯源句柄"；禁止编造 `Goldeneyes://` 基址。
- **边界**：DB 是火眼解析结果的快照，不含 AI 结论、不含原始文件字节；需要原始文件或深度分析时明确告诉用户"需要回火眼操作"。`query marks` / `query notes` 返回的是导航数据（`citable=0`），只能用于引导用户回火眼核对，**不得当作可引用原文**。
- **禁止**：不执行 `ges`、不改 DB、不联网。

### 7.5 树状渐进式披露（`query tree <node>`，M0 已验证原型）

树（**每层一次调用、只回下一层**，默认 ≤ 1.5 KB）：

```text
root                         案件概览 + 检材列表
 └─ ev:<eid>                 检材下的应用/类别计数
     └─ app:<eid>/<app>      该应用下的分类（WhatsApp/微信 下先分账号）
         └─ cat:<eid>/<app>/<账号>/<类别>   该类别下的会话/群组/文件夹（= 文件列表）
             └─ art:<id>[:page]            文件元信息 + 每页 10 条记录
                 └─ cite:<recordId>        单条记录 + 可校验的引用链接
```

M0 实测每层输出（紧凑 JSON）：`root` 309 B / `ev:3` 767 B / `app:3/WhatsApp` 581 B / `cat:…/群聊消息` 979 B / `art:45`（10 条记录）2,088 B / `cite:1` 364 B。
一次"根 → 某群聊 → 某条消息 → 引用"合计约 **5 KB ≈ 1.4k token**，且完全按需展开（不看的应用/会话永不进入上下文）。

原则：

1. **默认只展开一层**；`--depth 2` 才多回一层；叶子强分页（`PAGE=10`，超预算降到 8 / 每行 120 字符）。
2. **节点 id 短且可复用**（`ev:` / `app:` / `cat:` / `art:` / `cite:`），模型直接把返回值当下一步参数，不需要重新拼路径。
3. 每个节点返回 `totals`（文件数/行数/`citable` 比例）+ `children`，让模型自己判断"够不够、要不要继续钻"。
4. **搜索不是唯一入口**：先 `tree root` 看规模 → 按应用/账号/类别钻 → `art:` 翻页 → `cite:` 取引用；`search` 只用于跨树的关键词跳转（命中后同样给 `id`，再用 `cite`）。
5. **桌面 UI 复用同一棵树**（左侧懒加载目录树），CLI 与 UI 共享同一份 JSON schema——树上点选和模型调用看到的是同一套节点。

> M2 需要在 `artifact` 里补 `account` 列，让 WhatsApp/微信 的"账号目录"成为独立一层（M0 里它暂时被归到 `category`）。

### 7.6 token 账

| 场景 | 上下文成本 |
|---|---|
| 旧方式：会话里去读 4 个官方 skill + 现场 `ges read` 几十个 CSV | 约 20k token（4 个 skill 全量 72 KB）+ 每次读文件 1–5k |
| 新方式：`ges-case-index` skill 常驻 | 约 800 token |
| 每次查询 | 约 300–600 token（≤2 KB JSON） |
| 树状导航单层（M0 实测） | 约 90–300 token/层；一条完整钻取链 ≈ 1.4k token |
| 标记/笔记/OCR 额外能力 | 仍走同一 skill，命令数 6→9，常驻约 +150 token |

### 7.7 OCR 开关（默认关闭）

- **开关位置**：桌面版设置页「索引 → 图片文字识别（OCR）」；CLI `--ocr off|auto|force`，默认 `off`。
- **`off`**：只入图片/视频元数据（`file_meta`），0 耗时。
- **`auto`**：只对"元数据里带文字线索的图片"跑（如截图/相机胶卷/应用图片），单案限 2,000 张、单张 ≤ 30 s、总预算 20 分钟，超预算停止并记 `ingest_log`。
- **`force`**：不设上限，用户明确知道耗时。
- **取图路径**：`/case/` 只有元数据 CSV，二进制要走 `/evidence_mounts/eid-N/…` 或 `ges copy`；copy 到临时目录后 OCR，临时文件用完即删（不入库、不留副本）。
- **引擎**：优先 Windows 内置 OCR（`Windows.Media.Ocr`，中文需系统语言包），回退 Tesseract（随包放 `resources/ocr/tesseract.exe`，体积约 40 MB，按需可选安装包）。引擎名与语言写入 `ocr_result.engine/lang`。
- **引用**：OCR 文本是**派生内容**，`citable=0`；如需引用，引用原图（`base_handle` + 行号）并注明"文字由 OCR 识别，需人工核对"。skill 里禁止把 OCR 文本当原文直接角标。
- **验收**：`auto` 模式下本案截图样本 OCR 字符准确率抽检 ≥ 90%（人工 20 张）；`off` 模式建库时间不增加。

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
6. **案件目录只读时的提示**（按你的选择：提示，不静默回退）：建库前试写 `.seeu-index\.probe`，失败弹对话框——「案件目录不可写：`E:\…`。请选择：① 处理只读/权限后重试；② 手动改用 `%APPDATA%\SeeUForensicsAgentPlus\indexes\<案号>\`」。只有用户选②才回退，并记进 `case-dirs.json`，该案后续沿用。
7. **OCR 开关**：设置页 checkbox（默认关）+ 建库前可临时切换；对应 `--ocr off|auto|force`（§7.4）。
8. **跨案库**：`<dsh 工作目录>\indexes\crosscase.db`（按你的选择），建库成功后自动增量同步；`ges-index xcase sync` 可手动补跑。

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
| **M0 可行性 spike** ✅ 已完成 | 抓 1 个检材（eid3 全部叶子）→ 落 SQLite；测 read 分页吞吐、基址覆盖率、chat/CSV 解析正确性 | 0.5（实耗 ~2 h） | ✅ 139/139 叶、8,443 记录、0 失败、20/20 引用回查一致（详见 §13） |
| **M1 建库器骨架** ✅ 已完成（2026-11-11） | 探测/枚举/抓取/`record`+`artifact`+`ingest_log`；`--rebuild` 原子替换；并发抓取 2–4 | 1.5（实耗 ~4 h） | ✅ 本案全量 370 叶、22,777 记录、0 失败、DB 52.8 MiB、242–329 s、`verify` 20/20（详见 §14） |
| **M2 投影 + 实体 + 引用** ✅ | `column_map` 严格按真实表头签名映射（24 张 typed 表）；`entity` 抽取与跨检材聚合；`citation` 每行一条 | ✅ 完成 | **22,123/22,777 = 92.7%**（CSV 记录 99.7%）；实体跨检材查询通过（见 §17） |
| **M3 查询 CLI + 技能** ✅ | **会话经本地 API 查库 + 技能自动安装**（放弃 runtime patch 方案，见 §16） | 1 | ✅ 开发态端到端通过（API 200、技能落在默认根、离线查询 P50 ≤ 25 ms） |
| **M4 桌面集成** ✅ | **改为 dsh 客户端插件**（侧栏/设置页面板 + 检索 + 树导航 + 建库进度），宿主插件暴露  本地路由 | 1 | ✅ 开发态与打包态 GUI 全程建库+检索（CDP 断言通过，见 §15） |
| **M5 跨案 + 文档** ✅ | `crosscase.db` 同步与查询；文档（本计划转正式文档 + 用户手册）；回归用例 | 1 | 两案间同号/同哈希可查；文档含排障（见 §18） |
| **M6 OCR 开关（可选）** | `--ocr off\|auto\|force`、取图→识别→`ocr_result`、设置页开关、准确率抽检 | 1 | `off` 不增加建库耗时；`auto` 抽检 20 张准确率 ≥ 90%；OCR 文本一律 `citable=0` |

合计约 **8 人天**（M6 可延后；不含 OCR 引擎随包体积与火眼侧配合）。建议做完 M0 再决定是否继续（M0 能提前暴露行号对齐/吞吐问题）。

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

## 12. 决策确认（v4.1）与剩余小问题

**已确认，按此实现：**

1. `标记数据/`、`笔记数据/` **入库**（导航表，`citable=0`，保留 `原文记录ID`；本案这两目录为空，只有 `使用说明.md`）。
2. 图片/视频**默认只入元数据**；**OCR 做成开关**（默认关，`off|auto|force`），需要时再跑。
3. 案件目录只读 → **弹提示**（不静默回退）。
4. 跨案库放 **dsh 工作目录**：`<dsh 工作目录>\indexes\crosscase.db`。

**还剩两个实现细节（不阻塞 M0–M2，可边做边定）：**

1. OCR 引擎：先试 Windows 内置 OCR（无需安装，但中文要系统语言包）；若比赛机器普遍缺语言包，是否允许安装包体积 +40 MB 随包带 Tesseract？
2. 只读提示的按钮：就按「①处理权限后重试 ②手动改到 `%APPDATA%\…`」两条给，还是只提示一句"目录不可写，请处理后重试"（不给回退按钮）？

---

## 13. M0 可行性 spike 实测结果（2026-11-11，已通过）

> 代码在 `.probe/m0/`：`ingest.mjs`（建库）、`query.mjs`（查询原型）、`report.mjs`（延迟/引用校验）。DB：`.probe/m0/case-index.db`。全部用 `node:sqlite`，零第三方依赖，本机 Node 24.18 直接跑。

### 13.1 规模与耗时（检材 eid3 `LEUNG_YL_mobile.zip`）

| 指标 | 实测 |
|---|---|
| 叶子 | **139**（126 个 `data.csv` + 13 个 `chat.txt`） |
| 记录 | **8,443**（CSV 行 7,664 + 聊天消息 779） |
| 会话（chat_meta） | 13 |
| 消息 | 779 |
| 实体提及 | 87 |
| DB 体积 | **18.19 MiB** |
| 建库耗时 | **234.6 s**（≈1.7 s/叶，单线程串行） |
| 失败 | **0** |

外推：本案 5 检材共 370 叶，单线程约 10–11 min；并发 3 → 4 min 级。§10 的 M1「≤12 min」有裕量。

### 13.2 查询延迟（10 次采样 P50）

| 查询 | 引擎 | 延迟 | 结果 |
|---|---|---|---|
| 手机号 `85254877240` | FTS5 `trigram` | **0.2 ms**（max 0.4） | 命中 3 条 |
| 2 字中文「加密」 | trigram **0 命中** → `LIKE` 回退 | 1.0 ms（max 1.2） | 命中 10 条 |
| 会话「陳民浩」 | `msg.peer LIKE` | 0.1 ms | 125 条消息 |
| 时间线 2025-04-08~10 | 按小时分桶 | 0.1 ms | 16 桶 |

→ M3 的「P50 < 100 ms」有 100 倍以上裕量；真实瓶颈会是进程启动与 JSON 序列化，不是 SQL。

### 13.3 引用回查（核心验收项）

随机抽 20 条 `citable=1` 记录，逐条 `ges read "<path>" --offset <line-1> --limit 1`：

- 行内容完全一致：**20/20**
- 首行基址完全一致（`〔本文件溯源基址 Goldeneyes://…/node〕`）：**20/20**

结论：`base_handle + line_no` 引用模型成立，可直接生成 `[[n]](Goldeneyes://<case>/<node>#<line>)`。

### 13.4 基址覆盖

- 129/139 叶有基址；**10 叶无基址**，且全部是 `实体分类/*/data.csv`（9 个）+ `检材信息/data.csv`（1 个）。
- 这些文件本质是派生摘要，按设计 `citable=0`：值可查可用，但不能打角标（与 §2.4 的横幅规则一致）。

### 13.5 M0 暴露、必须写进实现的 5 个问题

1. **chat 摘要行有两种形态**：私聊 `… | 消息: 12条（本机发送8条）`，群聊只有 `… | 消息: 12条`。正则里"本机发送"段必须可选，否则取到 `undefined` 绑定 SQLite 参数会直接整叶失败（首跑 5 个 WhatsApp 群聊全挂）。
2. **群系统消息发言人为空**（形如 `` 2023-06-30 23:12:48 `` 说：…），发言人正则必须允许空串，否则这些行丢失。
3. **基址行以 `〕` 结尾**，用 `[^\]]+` 会把 `〕` 吃进 `base_handle`，生成的引用链接失效 → 必须 `[^\s〕]+`。
4. **FTS5 `trigram` 对 <3 字符查询命中 0**："加密""转账"这类 2 字中文必须走 `LIKE` 回退；`search` 命令按查询长度自动选引擎（≥3 字符 FTS、<3 字符 LIKE）。
5. **输出体积**：每行都回完整 `virtual_path` 时 10 行 ≈ 4.6 KB（WhatsApp 的 emoji 账号目录极长）→ 查询面只回 `id/app/cat/ts/line/snippet`，完整路径与引用链用 `cite <id>` 二次取（实测 search 10 行 3.0 KB、`cite` 单条 0.47 KB）。M3 的"≤2 KB"用 limit 8 + 紧凑 JSON 即可达成。

### 13.6 据此对计划的修正

- **M1**：加并发抓取 2–4（单线程 1.7 s/叶）；断点续跑按"叶"粒度；若 `ges` 有常驻/批处理接口（`daemon`/`job`）再压一次进程启动成本。
- **M2**：`实体分类/*/data.csv`、`检材信息/data.csv` 自动判"无基址行" → 强制 `citable=0`，不进引用面。
- **M3**：`search` 自适应引擎；输出改为 `id + snippet`；新增 `cite <id>` 命令产出验证命令与 `[[n]](…)` 链接；按 §7.5 实现 `tree <node>` 并作为技能里的**主入口**（先树后搜）。
- **M2 追加**：`artifact.account` 列 + 树里增加"账号"层（WhatsApp/微信 多账号场景必须）。
- **M0 已额外验证**：`.probe/m0/tree.mjs` 实现了 §7.5 的 6 级树（root/ev/app/cat/art/cite），实测每层 309–2,088 B、单层 P50 < 1 ms（仅 SQLite + 进程启动）。
- **M6 OCR**：继续延后，不影响 M1–M3。

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

---

## 14. M1 建库器实测（2026-11-11，已通过）

工具：`tools/ges-index`（Node 24 + 内置 `node:sqlite`，零依赖）；案件 `2919d298-…`（5 检材）。

### 14.1 全量建库（`build --case-dir <案件目录>`）

| 指标 | 实测 |
|---|---|
| 叶子 | **370/370**（337 `data.csv` + 33 `chat.txt`），5 个检材 |
| artifact / record | 370 / **22,777** |
| 消息 / 会话 | **1,594** 条 / **33** 个 chat.txt |
| 实体 | 8,185（火眼 9 类实体 CSV + 正则抽取） |
| citable | **320** 有基址 / **50** 无基址（全部 `实体分类/*`、`检材信息` 等无句柄叶子） |
| 失败 | **0** |
| DB 体积 | **52.79 MiB** |
| 耗时 | **242 s**（输出到工作区） / **329 s**（输出到 `E:` 案件目录，慢在磁盘写） |
| 完整性 | `pragma integrity_check` ok；覆盖率校验通过（artifact==leaves 且 0 失败） |
| 产物 | `E:\forensics\W盘_2919d298-…\.seeu-index\case-index.db` + `manifest.json` |

对照计划目标：≤12 min ✅、DB ≤120 MB ✅、失败清单空 ✅。

### 14.2 查询实测

| 查询 | 结果 |
|---|---|
| `tree`（root） | 309 B 级；5 检材、370 artifacts、时间范围 **2016-12-11 ~ 2025-05-16**（已剔除 ISO 入库时间列） |
| `tree "ev:3"` | 8 个应用；WhatsApp 66 artifacts / 基本信息 27 / 微信 18 / 苹果健康 12 / 实体分类 9 / Safari 5 / Exif 1 |
| `tree "app:3|WhatsApp"` | 账号层 `U+1F495~Ling~U+1F495U+1F3B6(85260927726@s.whatsapp.net)` |
| `tree "acc:…"` | 16 个类别（群聊消息 8 文件 / 336 行、好友消息 3 / 435 行…） |
| `tree "cat:…群聊消息"` | 8 个 chat 文件，含行数与 citable |
| `tree "art:343"` | 10/195 条记录，`next:"art:343:1"` 可翻页；群系统消息空发言人正常入库 |
| `tree "cite:21697"` | `[[1]](Goldeneyes://…/229000000926#2)` + 回查命令 |
| `search -q "陳民浩"` | FTS5 trigram，10+ 命中，含 `«…»` 高亮 |
| `search -q "加密"` | 2 字 → LIKE 回退，10 命中（含「是否加密,是」） |
| `search -q "85254877240"` | FTS5，命中 WhatsApp 联系人/手机联系人/短信 |
| `verify --sample 20` | **20/20** 行内容逐字一致、**20/20** 基址一致 |

### 14.3 M1 期间修掉的问题（已写回代码）

1. `ges glob` 必须用 `--pattern`（不是位置参数）。
2. 群聊 `[摘要]` 行没有「（本机发送N条）」，本机段必须可选。
3. 群系统消息发言人为空（`` `` ``），发言人正则必须允许空。
4. 基址正则把结尾 `〕` 吃进 `base_handle` → 引用比对失败；改为 `/Goldeneyes:\/\/[^\s〕]+/`。
5. **时间列必须只取事件时间**：`创建时间/更新时间/修改时间` 是入库 ISO 时间，混进 `record.ts` 会让时间线跨到 2026 年；已从 `TS_COLS` 移除。
6. `-q` 这类单横线短选项此前被当成位置参数（查询词变成 `-q`），已统一解析 `-x`/`--x`。
7. 应用层 `accounts` 统计把空账号也算 1 个 → 改为只统计非空账号。

### 14.4 M1 遗留 → M2/M3

- typed 投影表 + `column_map` + `citation` 表（M2）。
- `timeline` / `entity` / `marks` / `notes` / `ocr` 查询与 `关联分析/标记数据/笔记数据` 入库（M2）。
- `--update` 增量（按 artifact 指纹）：当前重建一次 ~5 分钟，比赛场景可接受，增量优先级降低。
- dsh 技能 `resources/forensics/skills/ges-case-index/SKILL.md`（M3，约 50 行、常驻 ~800 token）。
- 桌面【更新索引】按钮与进度条（M4）。


## 15. M4 实测（桌面插件形态，2026-11-11）

M4 的规格原本写的是「外壳内加【更新索引】按钮」。实现时改成 **dsh 客户端插件**：面板直接长在 dsh Web UI 里，
外壳（Electron）只负责把插件和模块打进包、把 dsh 起来，不再自己画索引界面。这样开发/打包两态一致，也不破坏 dsh 的界面结构。

### 15.1 交付形态

| 位置 | 内容 |
| --- | --- |
| `plugins/seeu-case-index/index.js` | 宿主半：`webServer.register({kind:'prefix', path:'/seeu-index'})`，提供 `/list` `/build` `/tree` `/search` `/cite` `/stats` `/verify`；`/build` 异步任务 + 轮询进度；`safeDb()` 限 `.seeu-index/*.db` |
| `plugins/seeu-case-index/client.js` | 客户端半：`window.__ModuleLoader__.load({id:'@seeu/case-index'})`，React 面板（建库/更新、进度条、扫描、树导航、检索、引用详情），注册 `settings.section` + `sidebar.panellist` + `main` 三槽 |
| `resources/forensics/cordis.patch.yml` | 末尾 `- insert: [{ id: seeu-case-index, name: ../../plugins/seeu-case-index/index.js }]`（相对 overlay 文件 → 开发=仓库根、打包=asar 根） |
| `electron-builder.yml` | `files` 白名单加 `plugins/**` 与 `tools/ges-index/**`，插件与模块随包进 asar |
| `tools/ges-index/{build,query}.mjs` | 建库/查询库（宿主端直接 `import`，不经子进程，也不需要 pnpm 安装插件） |

### 15.2 关键决策与坑

1. **不做 profile 安装**（最初的 `ensureProfile()` 方案已删除）：cpSync 从 asar 读文件风险大，且多一层可漂移状态；overlay 相对路径 insert 在开发/打包两态同形，零安装。
2. **`insert.name` 不能写目录**：Node ESM 对目录导入报 `ERR_UNSUPPORTED_DIR_IMPORT`，必须指到入口文件（`dsh-app-boot/lib/index.js:4717-4726` 会把它转成 `pathToFileURL`）。
3. **客户端 bundle 必须自带 ModuleLoader 包装**，`id` 必须等于包名，否则白屏；可用 `require` 只有白名单（react 等），样式只能注入 `<style>`。
4. **不要注册 `sidebar`/`rightbar` 顶层槽**（单占位会被替换掉整列），用 `sidebar.panellist` + `main` 两条注册。
5. **自建路由无鉴权**：`webServer.register` 的路由不走 `admit()`，只靠 loopback；因此 `safeDb()` 只允许 `.seeu-index` 下的库文件，避免变成任意文件读取口。
6. **dsh 客户端会剥 URL token**：首屏 `?token=` 换成签名 cookie 后就 302 到无 token 地址；自检脚本必须自己接 `set-cookie`，不能跟随重定向。
7. **“启动崩溃”是假象**：`dist/` 陈旧 + 在旧产物上复现，重建后正常；但记住本机 shell 自带 `ELECTRON_RUN_AS_NODE=1`，跑 Electron 前必须 `unset`。

### 15.3 验证（Windows x64 / Electron 44.7.0）

- 开发态与打包态（`release/win-unpacked`，asar 内）各跑一次 CDP 端到端脚本 `.probe/ui-check.mjs`
  （`SEEU_UI_EXE=<exe>` 切打包态），断言：侧栏出现「取证索引」→ 点开面板 → 自动扫描出案件 → 树根统计
  （370 文件 / 22,777 记录 / 1,594 消息 / 8,185 实体）→ 钻到「检材 3」（139 文件 / 8,582 行，应用层 8 项）→
  检索「加密」（2 字中文走 LIKE 回退，20 命中）。两态 `errors: []`。
- asar 自检：19,635 entries，`plugins/seeu-case-index/{index,client}.js`、`tools/ges-index/*.mjs`、overlay 都在包内。
- 面板自动扫描的目录来自 `SEEU_INDEX_SEARCH_DIRS`（`<dsh 工作目录>` 与 `<DSH_HOME>/indexes`，`;` 分隔）。

### 15.4 M4 之后

- **M3（会话内查库）** 仍未做：`resources/forensics/skills/ges-case-index/SKILL.md` 需要 `skill-filesystem` 的 `customSkillDirs` 指向真实绝对路径，
  而 overlay 是静态文件、开发/打包两态路径不同 → 计划由外壳在启动时生成一份 runtime patch（`%APPDATA%\SeeUForensicsAgentPlus\runtime\skills.patch.yml`）拼进 `--patch`。
- 面板检索当前 limit 20；跨案库（M5）尚未接面板。

## 16. M3 实测（会话内查库，2026-11-11）

### 16.1 为什么最终没有「外壳生成 runtime patch」

原计划（§7.7 遗留、§15.4）是外壳启动时生成一份带**绝对** `customSkillDirs` 的 patch。实测与读码后否决：

| 方案 | 结论 |
| --- | --- |
| overlay 里写相对路径 `customSkillDirs: ["../../resources/forensics/skills"]` | ❌ 相对的是 **dsh 子进程 cwd（工作区）**（`dsh-skill-filesystem/lib/index.js:78` 的 `resolve(root)`），不是 overlay 文件位置 |
| overlay / 安装目录里写绝对路径 | ❌ 「源码运行 / 安装目录 / 便携版 %TEMP% 解包目录」三态路径都不同，静态文件写不出来；用户提出的"放安装目录"同样不成立（每台机器安装路径不同） |
| 外壳启动时生成 patch 再 `--patch` | 🟡 可行但要管一份动态文件的清理与冲突，且 dev/打包两态仍要各自算路径 |
| **技能复制到 `<DSH_HOME>/skills`** | ✅ dsh 默认发现根（`roots()` 里 `join(this.dshHome, "skills")`，source `user-dsh`，rank 400，`skipSystem: true`），零 patch、零配置 |

### 16.2 端口问题与解决

`dsh web --port 0` 由 dsh 自己选端口，外壳从 stdout 拿到 URL 时子进程已启动，**没法再把端口回注进去**。
改为外壳用 `node:net` 先 listen(0) 探空闲端口 → `--port <p>` → 同一次 spawn 的 env 里带 `SEEU_INDEX_API=http://127.0.0.1:<p>/seeu-index`（bash/pwsh 工具继承 env，技能直接读）。

### 16.3 交付物

| 项目 | 内容 |
| --- | --- |
| `src/skills.ts` | `installBundledSkills(version)`：递归列出 `resources/forensics/skills/**`，按 `version:文件名:大小` 算指纹写 `.seeu-skills.json`，未变则跳过；`readFileSync/writeFileSync` 逐文件复制以兼容 asar；失败只记日志不阻塞启动 |
| `src/host.ts` | `pickFreePort()`；`--port <p>`；env 增 `SEEU_INDEX_API`/`SEEU_SKILLS_DIR`/`SEEU_INDEX_STATE_FILE`；`SEEU_INDEX_SEARCH_DIRS` = 上次面板用过的目录 + 工作区 + `dsh-home/indexes` |
| `plugins/seeu-case-index/index.js` | `/list`、`/build` 后把案件目录写进 `index-state.json`（最多 10 条），外壳下次启动自动扫描 |
| `resources/forensics/skills/ges-case-index/SKILL.md` | 3.9 KB，教模型 `curl -G "$SEEU_INDEX_API/{tree,search,cite,stats,verify}"`、树优先、`next` 翻页、`citable=0` 不作证据、旧库提示更新 |

### 16.4 验证（Windows 实测）

- 启动后 `shell.log`：`skills: 4 个（evidence-chain-report, ges-case-index, read-only-evidence-analysis, windows-artifact-triage）→ …\dsh-home\skills`；marker 指纹记录 4 个文件大小。
- `GET http://127.0.0.1:<p>/seeu-index/list` → 200；`--seed` 写入 `E:\forensics` 后重启，`/list` 自动返回 1 个索引（`W盘 / 2919d298-… / 52.8 MiB / builtAt 2026-11-11T08:05:24Z`）。
- 端口来自页面 URL（`http://127.0.0.1:<p>/?token=…`），与 `SEEU_INDEX_API` 一致 ⇒ 模型侧可拿到同一地址。

### 16.5 诚实边界

「技能已被会话加载」目前只有**静态证据**：文件在默认根 + `roots()` 源码确认 `<dshHome>/skills` 在列。
没有做"新建会话 → 看系统提示里有没有该技能"的运行时断言（需要模型调用一次），作为 M3 的遗留验证项。

## 17. M2 实测（typed 投影 + 实体 + 引用，2026-11-11 已通过）

命令：`node tools/ges-index/cli.mjs build --case-dir "E:\forensics\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5" --rebuild`

### 17.1 建库结果（schemaVersion 3）

| 指标 | 数值 |
| --- | --- |
| 叶子 | 370（csv 337 / chat 33），failed 0 |
| 记录 | 22,777（其中消息 1,594 走 `msg`，CSV 21,183） |
| typed 投影 | **21,123** 行，24 张表 |
| typed 覆盖 | **92.7%**（以全部记录为分母）；**99.72%**（以 CSV 记录为分母） |
| 未投影 | 60 行：`检材信息` 5（按设计只进 `evidence`）、`实体分类` 空表 0 行、其余零星表头变体 |
| citation | **22,772** 行（每个有基址的 record 一条，`method='ingest'`，`status='ok'`） |
| column_map | 表头→typed 字段映射（严格按真实表头采集） |
| 库大小 / 耗时 | **63.0 MiB** / **254 s**（并发 3） |

typed 表行数（实测）：`health_metric` 6,200、`exif` 4,518、`msg_csv` 4,308、`bt_device` 2,005、`net_usage` 1,329、`contact` 745、`app_usage` 706、`app_install` 345、`app_permission` 219、`calendar_event` 191、`web_visit` 171、`file_meta` 116、`account_info` 52、`chat_group` 51、`device_info` 52、`sms` 39、`call_log` 33、`moment` 17、`device_storage` 8、`wifi_record` 6、`sim_card` 5、`mini_program` 5、`favorite` 2、`entity_row` 0。

### 17.2 关键发现与修复

1. **不能按 (app, category) 映射**：同一 category 在不同检材上表头不同（例：`苹果健康|未设置` 既有"指标序列"表头 `开始时间,结束时间,<指标>,来源名称,设备信息`，也有"数据来源"表头 `来源名称,创建时间,修改时间,删除时间,设备型号`）→ 改为**按表头签名**判断类型，24 张表按签名顺序匹配。
2. **`苹果健康` 指标序列是最大未覆盖块**（6,200 行 ≈ 27% 记录）。首版漏掉，表现为覆盖率卡在 65.5%；补 `health_metric`（metric/value_text/start_ts/end_ts/source_name/device_text）后覆盖率升到 92.7%。
3. **`column_map` 一直为空**：`mapping` 元组顺序是 `[targetField, sourceColumn]`，build 里按 `[column, targetField]` 解构 → `hasOwnProperty(fields, undefined)` 恒 false，静默不写。已修，现在映射可审计。
4. **iOS 通讯录**表头是 `头像,名称,号码,归属地,分组,…`（不是 WhatsApp 那套 7 列），补签名分支 → `contact`。
5. **`records()` 缺关键词过滤**：已补 `q`（≥3 字符 FTS5 trigram，1–2 字 LIKE 回退），返回 `engine` 字段。

### 17.3 查询实测

| 查询 | 结果 |
| --- | --- |
| `entity --q 85254877240` | 聚合 3 条：phone 6 次/跨 2 检材（eid 3,5）、email 4 次/跨 2 检材 |
| `entity --kind phone` | 类别计数 url 5,690 / email 1,271 / phone 1,226；跨检材 15 条 |
| `timeline --bucket day` | 86 个时间段；2025-05-15 287 条/2 检材/3 应用 |
| `records --q 陳民浩` | engine `fts5-trigram`，250 条 |
| `tables` | 24 张 typed 表（中文标签 + 行数） |

### 17.4 UI 端到端（CDP，Electron 44.7.0 实测）

面板新增四个标签页（树 / 检索 / 记录 / 实体 / 时间线 / 表）：记录视图「记录 22777 条 · 当前 1-30」、实体视图「实体类别 url 5690 / email 1271 / phone 1226，返回 30 条聚合 · 跨检材 15 条」、时间线「按天分桶 · 86 个时间段」、表视图 24 张表下拉 + 横向滚动表格；`errors: []`。

### 17.5 遗留 → M3/M6

- `entity_row` 仍为 0：`实体分类/*` 叶子在本案多为空表；等有实际命中数据再验。
- `检材信息` 5 行按设计不投影（写 `evidence` 表）。
- typed 表暂无独立时间索引（只有 `msg_csv.ts`、`contact.phone`、`entity_row(kind,value)`）；大库再加。
- 面板「检索」视图行为未变；记录视图关键词已生效。

## 18. M5 实测（跨案中央库，2026-11-11 已通过）

### 18.1 交付物

| 文件 | 作用 |
| --- | --- |
| `tools/ges-index/cross.mjs` | 中央库 schema（`schema_meta/case_ref/cross_entity/cross_mention/cross_image`）、`syncCase`/`syncAll`、`listCases`/`findEntity`/`topShared`/`findImage`/`crossStats` |
| `tools/ges-index/cli.mjs` | 新增 `xcase sync/list/top/entity/files/stats` 子命令（`npm run index:xcase:*`） |
| `plugins/seeu-case-index/index.js` | 路由 `/seeu-index/cross/{list,sync,entity,top,files,stats}`；建库完成后自动 `syncOneCase`（`job.cross` 字段回报结果） |
| `plugins/seeu-case-index/client.js` | 面板第 7 个标签「跨案」（统计 / 案件清单 / 同步全部 / 重合实体 Top / 实体查询） |
| `src/host.ts` | 向 dsh 子进程注入 `SEEU_WORKSPACE`、`SEEU_CROSS_DB`，bash 里的技能与 CLI 都能直接找到中央库 |
| `resources/forensics/skills/ges-case-index/SKILL.md` | 第 10 段跨案命令 + 工作方式第 7 条（跨案命中属线索级，引用分别落各案句柄） |

中央库位置：`<dsh 工作目录>/indexes/crosscase.db`（`SEEU_CROSS_DB` 可覆盖，`xcase --out` 可临时改）。
本案实测：`C:\Users\ASUS\Documents\SeeUForensicsWorkspace\indexes\crosscase.db`。

### 18.2 同步语义

- 一次同步 = 找到所有「已建库案件」（`findIndexes`，目录自身 + 向下两层）→ 逐个在**同一事务**里删除该案旧行、再写入：实体按 `(kind, value_norm, eid)` 聚合进 `cross_entity`（`hits` 次数）；每个聚合最多留 **5 条** `cross_mention`（`snippet` ≤ 200 字）；`evidence.sha256/md5` 写入 `cross_image`；最后 upsert `case_ref`（案号/案名/库路径/记录数/typed 覆盖率/同步时间）。
- 幂等：重复同步同一案结果一致（先删后写），可以随时点【同步全部案件】。
- **不会**自动清理「已删除的案件」——`case_ref` 与派生行会残留，需要手动删 `crosscase.db` 重新同步（见 18.4 排障）。
- 建库路径（面板【建库 / 更新】）成功后会**自动**同步该案，不需要再点一次【同步全部案件】。

### 18.3 验证（Windows x64 / Electron 44.7.0）

双案夹具：真实案件库 + 复制并把 `meta.case_number` 改为 `TEST-B-0001`、`case_name` 改为「测试案B」的副本（`.probe/xcase/caseA|caseB`）：

| 命令 / 接口 | 结果 |
| --- | --- |
| `xcase sync`（CLI） | 2 案各 entities 4,407 / mentions 6,526 / images 5 |
| `xcase stats` | `{cases:2, entities:8814, sharedEntities:3999, images:10, kinds:[url 3031, phone 509, email 459]}` |
| `xcase top --min-cases 2` | url `https://hk01.app.link/AFu7F8I2MO]` 508 次跨 2 案；phone `85254974406` 424 次；email `85254974406@s.whatsapp.net` 406 次 |
| `xcase entity --value 85254877240` | `caseCount 2`、`hits 12`，按案件分组返回提及（含 `recordId`、`Goldeneyes://…` 句柄、`citable`） |
| 面板接口（dev，2 案） | `GET /seeu-index/cross/list` → cases 2 / sharedEntities 3999；`POST /cross/sync` → 200 且回 2 案统计；`GET /cross/top?minCases=2` → 3 行 caseCount 2；`GET /cross/entity?value=85254877240` → caseCount 2 |
| 面板接口（dev，仅真实案） | `cross/list` → cases 1 / entities 4407 / images 5；`cross/sync` 200，自动发现 `index-state.json` 里的 `E:\forensics\W盘_…` |

### 18.4 排障

1. **面板显示「尚未同步」/ cases 0**：先确认目标案件库存在（`<案件目录>\.seeu-index\case-index.db`），再点【同步全部案件】；接口里 `GET /seeu-index/list` 能列出索引说明发现路径没问题。
2. **中央库位置不对**：面板顶部会显示 `crossPath`；默认 `<dsh 工作目录>/indexes/crosscase.db`。可用环境变量 `SEEU_CROSS_DB` 固定到别处（外壳会注入，CLI 也认）。
3. **同一案重复出现 / 旧案残留**：同步是"按案删了重写"，但不会删案件本身；要清干净就关掉应用、删除 `crosscase.db`，再点【同步全部案件】。
4. **数据库被占用（SQLITE_BUSY）**：中央库开了 WAL + `busy_timeout 5000`；若刚点过同步，等 1–2 秒重试。
5. **镜像（sha256）查不到**：只有 `evidence` 表里有哈希的检材才会进 `cross_image`；火眼没算哈希的检材查不到属正常。

### 18.5 遗留

- 跨案只做"实体 + 镜像哈希"，没有跨案时间线、没有语义相似度（按用户此前决策先做关键词/实体）。
- `cross_image` 目前按 `(case_number, eid)` 去重，同一镜像在一案里多次出现只记一行（符合"同一镜像在哪几案出现"的用法）。
- 案件删除不自动同步清理（见 18.2/18.4）。

## 19. 检材元数据（v0.1.8，M2.5）

**问题**：`/tree root` 的 `children[]` 只有 `{id:'ev:3', artifacts, lines}`，面板显示「检材 N」，会话里的模型完全不知道哪个 eid 对应哪个检材 —— 用户发题目时它无法判断「分析哪个检材」（用户 2026-11-11 反馈）。`evidence.name` 在库里其实有值（`CHAN_MH_mobile.zip` 等），只是从来没暴露到树/检索/引用里。

**检材名称的真实来源**：火眼案件配置文件 `<案件目录>/<案件名>.gec` 是 SQLite，`evidence` 表列含 `id,name,person_name,remark,platform,type,record_count,evidence_number`。
- 「检材信息」CSV 里的「检材名称」常常是存储名（`CHAN_MH_mobile.tar`/zip 内部名），火眼界面上显示的名字应以 `.gec` 为准；
- `remark` 只有个别检材有（本案 eid1：「伤人案(冯子康头部受伤)手机检材:iPhone D331pAP/iOS17.1.1 全量提取」），对判断检材用途很有价值；
- `person_name` 本案全空，`platform` 为 `ios`/空。

**实现**：
- `tools/ges-index/ges.mjs` 新增 `readCaseConfig(caseDir)`：只读打开 `*.gec`，读 `evidence` 表，失败返回空表（老版本/无 `.gec` 不影响建库）。
- `tools/ges-index/build.mjs`：`evidence` 表新增 `person_name/remark/evidence_number/record_count` 四列（`SCHEMA_VERSION` 3 → **4**）；建库末尾用 `.gec` 覆盖 `name/platform/type`，补齐「检材信息」CSV 失败时缺失的检材行。
- `tools/ges-index/query.mjs`：新增 `evidences(db)`（eid/name/holder/platform/type/remark/evidenceNumber/recordCount/label）；`tree('root')` 的 children 带 `name/person/platform/remark`；`tree('ev:<eid>')` 的 evidence 带全字段；`cite()` 与 `records()` 行带检材名；`statsOf()` 带 `evidences[]`。
- 插件路由 `/seeu-index/evidences`；CLI `ev`/`evidences` 子命令 + `npm run index:ev`。
- 面板树：`检材 3 · LEUNG_YL_mobile.zip · ios`，有备注的检材在名称后跟「备注：…」。
- 技能 `ges-case-index` SKILL.md：新增「先认检材」段 —— 先 `/evidences` 拿 `name ↔ eid`，用户说检材名时按名称子串匹配，不要猜 eid；回答里写检材名称。

**验证**（2026-11-11，真实案件 W盘）：
- 重建：370 叶 / 22,777 记录 / 63.04 MiB / 224 s，schemaVersion 4；`ev` 输出 5 个检材，含名称、`recordCount`（3065/3/13718/68/25669）、`evidenceNumber`、eid1 的 remark。
- `tree root`：`children[]` 每个检材带 `name/person/platform/remark`。
- Electron 端到端（`.probe/m2-ui-check.mjs`）：`evNames: true`、`evRemark: true`、树根文本「检材 1 · CHAN_MH_mobile.zip 备注：伤人案(…)」…「检材 5 · FUNG_CC_mobile.zip · ios」，检索 `加密` 20 命中，七标签全绿，`errors: []`。
- 开发态预览：`npm run dev:web -- --workspace <案件目录>` 直接起 dsh web（技能复制到 `.dev/dsh-home/skills`、固定端口注入 `SEEU_INDEX_API`），`/seeu-index/evidences` 与 `/tree` 均返回带名称的结果。

**遗留**：`size_bytes`/`sha256` 仍为空（取自「检材信息」CSV，需按实际表头再核对）；`.gec` 结构若随火眼版本变化，`readCaseConfig` 会静默降级为空表（建库不受影响，但名称退回 CSV 值）。

## 20. 前端主题/品牌与本地模型接入（v0.2.0 起）

### 20.1 前端主题与品牌

**问题**：官方 `dsh-brand` 只是 `brandString/brandNumber` 的 nominal typing 工具，不含产品品牌配置；产品名/图标硬编码在 `dsh-web-frontend/dist/index.html` 与 `dsh-client-ui-brand-official`，overlay 改不到。

**实现**（`plugins/seeu-theme/`，一个包两种 half）：

- 宿主 half `index.js`：`readFileSync(new URL('./theme.css', import.meta.url))` 读同包 CSS，`ctx.on('webserver/index-inject', table => table.push({ kind: 'html', placement: 'head', html }), { prepend: true })` 注入首屏 `<style>`；同时 `ctx.inject(['webServer'], …)` 注册 `GET /seeu-theme/theme.css` 兜底。
- 客户端 half `client.js`：`window.__ModuleLoader__.load({ id: '@seeu/theme', … })`，`inject: ['slots']`，注册 `sidebar.brand.mark`（盾牌+放大镜 SVG）、`sidebar.brand.name`（「SeeU 取证」）、`conversation.hero.brand.mark`；`takeTitle()` 用 MutationObserver 把 `document.title` 改成「SeeU 取证智能体增强版」（官方客户端会反复写回，观察 15s 后断开）。
- 主题 token：`theme.css` 覆盖 `--dsw-alias-bg-*` / `label-*` / `border-*` / brand / interactive / state / 字体 / 滚动条，暗色取证蓝（bg-base `#0A111E`、accent `#22D3EE`），浅色对应（`#F5F7FA`、accent `#0E7490`）。**必须 `!important`**：官方 ThemePresenter 会把 token 逐条写成 body 内联样式（`dsh-client-ui-layout/lib/client.js:614-635`）。
- overlay：末尾 `- insert: [{ id: seeu-theme, name: ../../plugins/seeu-theme/index.js }]`；并新增 `- id: ui-brand-official` + `disabled: true`（避免与 seeu-theme 同槽叠两份品牌）、`- id: locale` + `config: { preference: zh }`。

**验证**：`.probe/shot.mjs`（dev，`SEEU_DEV_MULTI=1` + 独立 `SEEU_DSH_HOME`）暗色 `{"ok":true,"title":"SeeU 取证智能体增强版","dark":true,"bgBase":"#0A111E","accent":"#22D3EE","themeStyle":true}`；浅色 `{"ok":true,"dark":false,"bgBase":"#F5F7FA","accent":"#0E7490"}`。截图存 `.probe/shots/theme-dark.png`、`theme-light.png`。

### 20.2 本地模型（OpenAI 兼容网关）

**路径**：overlay 里 `- id: llm-pi-ai` 的 `config.providers` 声明路由（该行默认挂载但零路由休眠，supplying providers 是唯一开关，见 `dsh-base/cordis.patch.yml:128-136` 注释）+ 覆盖 `- id: agent-default-model`。**不要用 settings 页写同一行**：overlay 优先时 `dsh-config-editor/lib/index.js:121` 会硬拒。

**实现**：

- 启动探测（v0.2.0 第三轮）：`src/main.ts:probeLocalModelGateway()` 在 `startHost()` 里 fire-and-forget 调用 `probeableLocalModel()` + `testLocalGateway({timeoutMs:4000})`，成功/失败都写 `shell.log`（`local model probe: <baseURL> 可用（模型 id）/ 不可用 → 原因`）；失败时若仍在 `starting` 状态则把加载页文案改为「本地模型网关暂未连通，先用官方模型启动…」，不阻塞。错误页新增【本地模型设置】按钮（IPC `seeu:open-settings` → `openLocalModelSettings()`）。
- 设置界面（v0.2.0 第二轮）：`renderer/local-model.html` + 菜单 `工具 → 本地模型设置…`。
- 顺带修：`src/paths.ts:logDir()` 原用 `app.getPath('userData')`，`SEEU_USER_DATA` 覆盖不生效（验收日志会写到真实 `%APPDATA%`）；已改为 `join(userDataDir(),'logs')`，与 `local-model.json` 的位置保持一致。验证：坏网关 → `local model probe: http://127.0.0.1:19999/v1 不可用 → net::ERR_CONNECTION_REFUSED`；mock 网关 → `local model probe: http://127.0.0.1:18082/v1 可用（qwen2.5-32b-instruct）`。
- 为什么不用 dsh 设置页：同一服务行的 settings 写入会被 overlay 覆盖并硬拒（`Configuration for "<id>" is overridden by a home patch or command-line overlay`）。窗口能力：读配置、实时预览生成的 patch、`GET <baseURL>/models` 连通性测试（主进程 `net.fetch`，绕开渲染进程 CORS）、保存并重启。IPC：`seeu:local-model:get|save|preview|test|restart|open-file`；`src/local-model.ts` 新增 `describeLocalModelConfig/writeLocalModelConfig/previewLocalModelPatch/testLocalGateway`。开发钩子：`SEEU_USER_DATA`（独立 userData，供自动化验收）、`SEEU_OPEN_SETTINGS=1`（启动即打开设置窗口）。
- `tools/local-model.mjs`（纯 JS，外壳与 dev-web 共用）：`normalizeLocalModel()` 归一化配置（兼容 `model: 'id'` 与 `models: [...]`）、`localModelPatch()` 生成 YAML、`localModelEnv()` 生成 `{ [apiKeyEnv]: apiKey }`。
- `src/local-model.ts`：读 `<userData>/local-model.json`（`SEEU_LOCAL_MODEL_JSON` 优先）→ 写 `<userData>/local-model.patch.yml`；配置错误只记摘要、不阻塞启动。
- `src/host.ts`：取证 overlay 之后追加第二个 `--patch <local-model.patch.yml>`，合并 env。
- 生成行固定：`api: openai-completions`、`compat: { supportsUsageInStreaming: false, maxTokensField: max_tokens }`、每模型 `input: [text]`、`reasoningEfforts: false`；默认 `contextWindow: 131072`（个人赛 128k）、`maxTokens: 8192`、`timeoutMs: 600000`；`useAsDefault: true` 时写 `agent-default-model`。
- 低并发/长上下文调优（v0.2.0 第二轮）：
  - provider 加 `retryPolicy: { mode: normal, maxRetries: 3 }`（dsh 默认 5 次；低并发网关排队时会把一次失败放大成 5 次长超时）；
  - 同一 patch 覆盖顶层 `- id: session-title-llm`：`maxOutputTokens: 512, timeoutMs: 20000`（每次新会话多一次标题请求）；
  - 随包 preset 的 `compaction-basic` 从默认 `headroomTokens: 65536` 改为 **8192**（+ `thresholdRatio: 0.8`、`retainRatio: 0.16`）。触发阈值 `min(W×0.8, W−O−B)`，O≈5k：128k 窗口 ~102k（0.8×W 生效）、256k 按 0.8×W、32k 约 19k（`W−O−B>0`，小模型也能跑）。取 8192 = 随包输出上限；第一版曾用 32768，但 32k 模型会 `W−O−B≤0` 报错，故第 9 轮调回 8192。**注意该行嵌在 preset-standard 内部，overlay 无法就地改**（实验：写顶层 `- id: compaction-basic` 只会在 dump 里新增一条 `disabled: true` 的行，preset 内的四份副本不变），只能随 preset 整块重写。
- 示例配置：`resources/forensics/local-model.example.json`；dev-web 支持 `--local-model`。

**验证**：`--dump-config` 1336 行、exit 0、`provider: local-openai`/`model: mock-14b`/`baseURL: http://127.0.0.1:18080/v1` 均在；`.probe/local-model-e2e.mjs`（mock OpenAI 网关 + 真 Electron + CDP）通过：`REPORT {"ok":true,"chatCalls":2,"gotReply":true,"errors":[]}`，页面出现「MOCK-OK：本地网关已连通，模型是 mock-14b」，模型 chip 显示「Mock 14B (本地)」，预设显示「取证分析（Forensics）」。

**e2e 踩坑（CDP 驱动 composer）**：① 首屏有「预览版说明」提示卡，会挡住 composer，必须先点文本为「继续」的按钮；② composer 是 Lexical 的 `contenteditable` DIV（`textareas: 0`），直接改 `textContent` 无效，要 `Input.dispatchMouseEvent` 点击聚焦 + `Input.insertText` + `Input.dispatchKeyEvent` Enter；③ 判断是否真的输入成功：读 `document.activeElement.innerText`。

**设置窗口验收**（`.probe/settings-check.mjs`，独立 userData + `SEEU_OPEN_SETTINGS=1` + CDP）：`REPORT {"ok":true,...,"previewHasRetryPolicy":true,"previewHasTitleRow":true,"gatewayModels":["qwen2.5-32b-instruct","mock-14b"],"badGatewayRejected":true}`。步骤：preload 桥存在 → `get()` 指向独立 userData → 填表 → `preview()` 生成 1014 字符 patch（含 `retryPolicy`/`session-title-llm`）→ `test()` 打 mock `GET /v1/models` 得 HTTP 200 与两个模型 → `save()` 落盘 → 重新读取一致 → 错误端口 `test()` 按预期失败 → 截图 `.probe/shots/local-model-settings.png`。

### 20.3 遗留

- 面板视觉改造已完成（v0.2.0）：`plugins/seeu-case-index/client.js` 1186 行——主题 token 化 `<style id="seeu-case-index-style">`、顶部 KPI 概览条（案件/检材/记录/实体/库大小/生成时间）、pill 标签栏 + 数量 badge、树行「检材 N · 名称 · 平台/人员 · 备注」+ 竖线 guide、统一 `seeu-row`/`Skeleton`/`LoadingLine`/`EmptyState`、表视图吸顶表头。验收 `.probe/m2-ui-check.mjs`：`m2ok: true`、`errors: []`（六标签真实数据，KPI 与 badge 正确）；`.probe/shot.mjs` 暗/浅两态截图正常。
- 真实本地网关未联调（用户自备端点）；mock 已证明协议层与 UI 链路可用。
- 模型选择器「设为默认」在 overlay 场景下静默失败，默认模型只能靠 `useAsDefault`。
- `compaction-basic` 的 `headroomTokens` 已随 preset 调到 8192（128k → ~102k、256k → 0.8×W、32k → ~19k）；32k 小模型不再需要手工调 preset，该遗留关闭。
- 调优后的回归：`--dump-config` exit 0、1317 行，`retryPolicy.maxRetries: 3`、`session-title-llm` 顶层覆盖（`maxOutputTokens: 512`）、preset 内 `compaction-basic.headroomTokens: 8192` 均在（dump 里 `headroomTokens` 只出现一次，就是 preset 内这一份）；`.probe/local-model-e2e.mjs` 复跑通过 `REPORT {"ok":true,"chatCalls":2,"gotReply":true,"errors":[]}`（真 Electron + mock 网关 + CDP）。

### 20.4 第 5 轮：欢迎页品牌块 + 模型状态可见性（2026-11-11）

**背景**：前几轮把主题/品牌/面板/本地模型接入做完了，但两件事用户看不见——① 欢迎页只有 logo，没有「这个软件怎么用」的第一屏引导；② 本地模型探测结果只写进日志，界面上没有「我现在用的是哪个模型 / 网关通不通」的常驻提示位。

**前端（欢迎页）**：`plugins/seeu-theme/client.js` 把 `conversation.hero.brand.mark`（single/root 槽，官方 brand 已 disabled）从单个 `HeroMark` 换成 `HeroBrand` 复合块：

- logo（保留 56px 圆角光晕）+ 定位句「证据链优先 · 只读取证 · 结论可回查」；
- 三步上手：`1. 侧栏「取证索引」选案件目录 → 建库（只写 .seeu-index，不动原始证据）`、`2. 直接提问：哪个检材、某个号码/账号、某段时间发生了什么`、`3. 看引用回查：每条结论都带原文件行号，可点到原始记录`。
- 尺寸/颜色只用现有 token 与 `currentColor` opacity，不写死主题色，浅色/深色都成立。

**本地模型状态可见性**（外壳层，`src/main.ts`）：

- 新增 `LocalModelProbeState` 与模块级缓存 `localModelProbeState`；`probeLocalModelGateway(reason: 'startup' | 'manual')` 探测后写入缓存，`modelStatusLabel()` 产出「本地模型 <id>」/「本地网关未连通（当前用官方模型）」/「官方模型」。
- 托盘 tooltip 从固定产品名改为 `<产品名> · <模型状态>`；`工具 → 本地模型状态…` 弹 `dialog`（配置路径、配置错误、探测可用性/地址/时间、模型列表；有配置时按钮为【重新探测】【关闭】，点重新探测会再弹一次最新结果）；`工具 → 重新探测本地网关` 手动触发；`帮助 → 关于` 增加「本地模型」一行。
- 顺带修掉托盘菜单里重复的「本地模型设置…」项。
- 设置窗口：`seeu:local-model:get` 现在返回 `{...describeLocalModelConfig(), probe}`；新增 `seeu:local-model:probe`（手动探测）与广播通道 `seeu:local-model:probe`（探测完成推给所有窗口，因为 `SEEU_OPEN_SETTINGS=1` 时设置窗口可能早于探测结果打开）；`renderer/local-model.html` 新增 `#probe` 行（可用=绿、不可用=黄并标明「仍可用官方模型」、未完成=灰）+【重新探测网关】按钮；preload 增 `localModel.probe()` / `localModel.onProbe(cb)`。

**验证**（`.probe/welcome-check.mjs`，开发态：mock 网关 `:18083` + `SEEU_DEV_MULTI=1` + 独立 `SEEU_DSH_HOME`/`SEEU_USER_DATA` + `SEEU_OPEN_SETTINGS=1` + CDP 两个 page 同时断言）：

```
{"ok":true,"title":"SeeU 取证智能体增强版","heroTagline":true,"heroSteps":true,"themeApplied":true,
 "probeLine":"启动探测：可用 · qwen2.5-32b-instruct · http://127.0.0.1:18083/v1 · 2026-11-11 15:23:01",
 "probeOkShown":true,"manualProbe":"ok:qwen2.5-32b-instruct","errors":[]}
```

回归：`.probe/local-model-e2e.mjs` → `{"ok":true,"chatCalls":2,"gotReply":true,"errors":[]}`；`.probe/settings-check.mjs` → `{"ok":true,...,"badGatewayRejected":true}`；`.probe/m2-ui-check.mjs`（面板）→ `errors: []`。

**遗留**：欢迎页三步提示是静态文本，没有和实际索引状态联动（例如「还没建库」时无法高亮第一步）；模型状态只有 tooltip/对话框/设置页，主界面会话区内仍看不到当前模型（dsh 自带模型 chip 已显示，未重复造）。

### 20.5 第 6 轮：本地模型工具调用与重试的端到端验证（2026-11-11）

**背景**：前几轮只验证了「本地网关能回一句话」。取证场景真正依赖的是**工具调用**（`todo_write` / `ges-index` 技能里的 `curl` 查库 / `present` 等），以及低并发网关下的 429 重试——这两条不通过就不能算「本地模型可用」。

**新增脚本（均只依赖 Node 内置模块 + 已安装 Electron）**

| 脚本 | mock 行为 | 断言 |
| --- | --- | --- |
| `scripts/e2e/local-tools-e2e.mjs` | 首轮按 OpenAI 流式规范分片返回 `tool_calls`（`todo_write`，arguments 分 4 段）；请求里出现 `role:"tool"` 后改回最终文本 | 请求带 `tools`（27 个）、`stream:true`、`max_tokens` 字段、**无** `stream_options`/`store`、工具执行成功（页面出现「任务 1 进行中」）、最终答复可见、无 JS 异常 |
| `scripts/e2e/local-retry-e2e.mjs` | 前 2 次 `POST /v1/chat/completions` 返回 429（`Retry-After: 0`），第 3 次正常 SSE | `chatCalls === 3`（2 次失败被吸收）、页面只出现一次正常回复 |

**实测 JSON**

```
tools: {"ok":true,"chatCalls":3,"rounds":3,"gotReply":true,"toolResultSeen":true,"todoCard":true,
        "firstRequest":{"stream":true,"tools":27,"toolChoice":null,"maxTokensField":"max_tokens",
        "hasStreamOptions":false,"hasStore":false,
        "keys":"model,messages,stream,max_tokens,tools"},"errors":[]}
retry: {"ok":true,"chatCalls":3,"failTimes":2,"retried":true,"gotReply":true,"errors":[]}
```

**compat 加固**：`tools/local-model.mjs` 的 `localModelPatch()` 现在默认写 `supportsStore: false` 与 `supportsDeveloperRole: false`（原来只有 `supportsUsageInStreaming: false` + `maxTokensField: max_tokens`），用户的 `compat` 仍可逐项覆盖。实测请求体精简到 `model,messages,stream,max_tokens,tools`——vLLM/Ollama/LM Studio 一类网关对多余字段（`store`、`stream_options`、`temperature`）经常直接 400，减到最保守形态最稳。

**踩坑**：dsh 的 composer 是 Lexical `contenteditable`，`Input.insertText` 后必须读 `document.activeElement.innerText` 才能确认输入真的进了编辑器；首屏「预览版说明」卡会挡住 composer，需先点文本为「继续」的按钮（同一 profile 第二次启动不再出现，脚本要容忍 `dismiss: null`）。

**遗留**：手工声明的 pi-ai 路由拿不到原生「系统/工具增量更新」（`dsh-llm-pi-ai/README.zh.md:268`），每轮会以 user 角色重申系统提示并重发完整工具列表——token 消耗比官方模型高，属于协议限制，暂不处理；真实网关（用户提供地址后）仍需一次人工联调。

### 20.6 第 7 轮：网关能力自检（模型列表 / 基础对话 / 工具调用）

**背景**：前三轮只证明「mock 网关能回话、能工具调用」。但用户接的是真实网关，常见失败形态是：`/models` 通、普通对话通，**工具调用不支持**——这种模型在取证会话里等于废的（查库、`present`、技能全靠工具）。用户无法从「能聊天」推断出这一点，所以把「能不能干活」做成设置页的一键自检。

**实现**

- `src/local-model.ts` 新增 `diagnoseLocalGateway({baseURL, apiKey, model, timeoutMs=20000})`：依次 ① `GET /models`；② `POST /chat/completions`（`stream:false`、`max_tokens:16`）；③ 再发一次带 `ping_tool` 函数定义的请求，看是否回 `tool_calls`。每项返回 `{key,label,ok,detail,ms}`，整体 `ok = 三项全过`。响应解析同时兼容 JSON 与「即使 `stream:false` 也回 SSE」的网关（逐行拼 `data:` chunk）。
- IPC `seeu:local-model:diagnose`；preload 增 `localModel.diagnose()` 与 `LocalModelDiagnosis` 类型。
- `renderer/local-model.html`：按钮改为【测试连接与能力自检】，结果区 `#diag` 逐行显示 `✓/✗ 标签 详情 耗时`，末行为结论；工具项失败时明确写「网关能对话，但工具调用不可用 —— 该模型在本产品里只能聊天，不能查案件库、不能用技能」。

**验证**（`scripts/e2e/local-diagnose-check.mjs`：mock 网关 `:18087`，`mock-32b` 支持工具、`no-tool-model` 只回文本；在设置窗口里真实点按钮）：

```
{"ok":true,"chatCalls":4,
 "supportedModel":{"status":"自检通过。","rows":[
   {"ok":true,"text":"✓ 模型列表 2 个模型：mock-32b, no-tool-model 1499 ms"},
   {"ok":true,"text":"✓ 基础对话 回复「ok」 9 ms"},
   {"ok":true,"text":"✓ 工具调用 返回 ping_tool({\"value\":1}) 7 ms"},
   {"ok":null,"text":"自检通过：网关可用于取证会话（含工具调用）。模型：mock-32b"}]},
 "noToolModel":{"status":"自检发现问题，见下方逐项结果。","rows":[
   {"ok":true,"text":"✓ 模型列表 2 个模型：mock-32b, no-tool-model 4 ms"},
   {"ok":true,"text":"✓ 基础对话 回复「ok」 6 ms"},
   {"ok":false,"text":"✗ 工具调用 未返回 tool_calls（该模型/网关可能不支持函数调用，会话里只能聊天、不能查库） 3 ms"},
   {"ok":null,"text":"网关能对话，但工具调用不可用 —— 该模型在本产品里只能聊天，不能查案件库、不能用技能。"}]},
 "checks":{"firstOk":true,"toolsRowBad":true,"summaryMentionsChatOnly":true},"errors":[]}
```

注意：`npm run test:e2e:diagnose` 需先 `npm run build`（改的是 `src/`/`renderer/`，esbuild 打 `dist/`）；e2e 里 `taskkill /F /IM electron.exe` 会清掉本机其它 Electron 开发实例，仅测试机使用。

**遗留**：自检只测「非流式 + tool_choice 缺省」这一种形态；部分网关只在流式下支持工具调用（dsh 实际走流式），若真实网关出现「自检失败但会话可用」的情况，再加一项流式探测。

### 20.7 第 9 轮：压缩余量定为 8192（同时支持 32k 小模型与 128k/256k）

**问题**：v0.2.0 把 `compaction-basic.headroomTokens` 从官方 65536 调到 32768（128k 窗口阈值 ~90k），但该值对 **32k 窗口**模型会让 `W − O − B ≤ 0`（32768 − 5120 − 32768 < 0），compaction 插件直接报错——而实际比赛里 32k 的 7B/14B 很常见，文档里只能写「请手工改 preset」。

**分析**（触发阈值 = `min(W×0.8, W−O−headroom)`，O = 系统提示 + 工具描述 ≈ 5k，由官方默认值反解得到：128k−5120−65536 = 57344，与 README 里官方「~57k 才压缩」一致）：

| W | headroom 32768 | headroom 8192 |
|---|---|---|
| 32k | 32768−5120−32768 = **≤0，报错** | min(25600, 19456) = **19456** ✔ |
| 128k | min(102400, 90112) = 90112 | min(102400, 114688) = **102400（0.8×W 生效）** ✔ |
| 256k | min(209715, 217088) = 209715 | 209715 ✔ |

**决定**：`headroomTokens: 8192`——正好等于随包配置的输出上限 `maxTokens: 8192`（再小会让长输出触发溢出重试；dsh 还有 `maxOverflowRetries: 1` 兜底）。这样**一份 preset 同时适配 32k / 128k / 256k**，换模型不需要改配置也不需要重打包。

**改动**：`resources/forensics/cordis.patch.yml` 的 `preset-standard → compaction → compaction-basic.config.headroomTokens` 32768 → 8192，并把注释改成公式 + 三档窗口的实际阈值，同时注明「输出上限若调大需同步调大余量」；`renderer/local-model.html` 页脚删掉「<48k 需要调小余量」的告警，改为「32k 及以上都能直接用」；README §2/§9.2、`docs/forensics-profile.md`、本文件 §20.2/§20.3 同步口径。

**验证**：

- `npm run check:overlay` → OK；
- `--dump-config`（隔离 DSH_HOME）→ exit 0、**1317 行**，`headroomTokens` 在 dump 里只出现一次且就是 preset 内那份：`thresholdRatio: 0.8 / headroomTokens: 8192 / retainRatio: 0.16`；
- `node scripts/e2e/local-model-e2e.mjs`（mock OpenAI 网关 + 真 Electron + CDP）→ `REPORT {"ok":true,"chatCalls":2,"gotReply":true,"errors":[]}`，页面出现 `MOCK-OK`；
- `node scripts/e2e/settings-check.mjs`（重建 dist 后）→ 设置页仍全绿：`{"ok":true,…,"previewHasRetryPolicy":true,"previewHasTitleRow":true,"badGatewayRejected":true,"errors":[]}`。同时修掉一个搬家遗留 bug：该脚本用 `new URL('..', import.meta.url)` 推仓库根，脚本从 `.probe/` 搬到 `scripts/e2e/` 后根目录少退一层，会去 spawn `scripts/node_modules/electron/...` 并 ENOENT；改为 `new URL('../..', import.meta.url)`。其它 e2e 脚本用 `process.cwd()`，需从仓库根运行（npm scripts 已保证）。

**遗留**：余量是静态值，无法按「当前模型上下文」动态算（compaction-basic 嵌在 preset 内部，overlay 与 local-model patch 都改不到）；若将来引入 >8192 的输出上限，需同步改该值并重打包。

### 20.8 第 10 轮：设置页「从网关拉取模型列表」

**问题**：本地网关的模型 id 必须和 `/v1/models` 返回的完全一致才不会被网关拒绝（`model not found`），但用户通常只知道自己「加载了 qwen2.5-32b」，而实际 id 可能是 `qwen2.5-32b-instruct-awq`、`qwen2.5-coder:32b` 之类。之前只能手抄，抄错后表现为会话里模型请求报错，排查成本高。

**实现**（纯渲染进程，复用已有 `testLocalGateway`，**不需要新 IPC**）：

- `renderer/local-model.html` 操作区加【从网关拉取模型列表】（`#btn-models`）：读表单里的 `baseURL`/`apiKey` → `window.seeu.localModel.test()`（主进程 `net.fetch`，8s 超时）→ 把返回的 `models[].id` 逐行写入 `#models` 文本域；**已存在的「id | 显示名」显示名会按 id 合并保留**，避免覆盖用户自定义中文名；随后自动刷新 patch 预览并提示「记得点保存」。
- 失败分支区分：网关没起/端口错/需要 apiKey（`ok !== true`）、返回 200 但列表为空、异常；三种都有独立文案。
- 「模型列表」下方的 hint 加了一句「不确定就点下方【从网关拉取模型列表】自动填」。

**验证**（`scripts/e2e/settings-check.mjs` 扩展一步真实点击，mock 网关 `:18081` 返回 `qwen2.5-32b-instruct` 与 `mock-14b`）：

```
"steps": [..., "拉取模型: qwen2.5-32b-instruct | Qwen2.5 32B（本地） / mock-14b", "错误网关: 按预期失败", ...],
"pulledModels": ["qwen2.5-32b-instruct | Qwen2.5 32B（本地）", "mock-14b"],
"ok": true, "errors": []
```

断言三点：textarea 里出现网关返回的两个 id、已填的显示名 `Qwen2.5 32B（本地）` 仍保留、后续「错误网关」分步仍按预期失败。`npm run test:e2e:settings` 可复跑（需先 `npm run build`）。

**遗留**：拉取只用于填表，不会自动保存；如果网关 `/models` 需要鉴权但只在 `chat/completions` 用别的 header，仍需在 JSON 里手工写 `headers`（设置页暂未暴露 headers 字段）。

### 20.9 第 11 轮：启动期可见性 + 启动失败兜底

**问题**：本地模型的失败大多发生在「启动之后、第一次请求时」，用户在加载页只看到「正在启动取证运行时…」，不知道自己的网关根本没连上；更糟的是网关配错导致启动失败时，错误页只有【本地模型设置】，用户得先看懂配置才能救回来。

**实现**

- `renderer/loading.html` 新增状态行 `#model`：订阅 `window.seeu.localModel.get()` 的 `probe` 与 `onProbe` 推送，显示「本地模型：<第一个模型> · <baseURL>」或「本地模型网关不可用（仍可用官方模型）：<错误>」（黄色 `--warn`）。探测由外壳启动时发起，4 秒超时，不阻塞启动。
- `src/local-model.ts` 新增 `disableLocalModel(configFile)`：读现有 JSON → 把 `enabled` 置 `false`、**其余字段原样保留** → 写回；文件不存在时写 `{enabled:false}`，文件损坏时直接覆盖兜底。
- IPC：`seeu:local-model:disable`（只改文件）与 `seeu:local-model:disable-restart`（改文件 + 250ms 后 `app.relaunch()`）；preload 暴露 `localModel.disable()` / `disableAndRestart()`。
- `renderer/error.html` 新增【禁用本地模型并重启】按钮（在【本地模型设置】旁）：点击后提示「正在禁用本地模型并重启…」，失败会把错误写回 `#message`。

**验证**

- `scripts/e2e/loading-check.mjs`（新增，`npm run test:e2e:loading`）：用必然连不上的网关 `http://127.0.0.1:19999/v1` 启动真 Electron，在壳子还停在 loading 页时用 CDP 读 `#model`：

```
[loading-check] 页面: file:///…/dist/renderer/loading.html
[loading-check] 状态行: 本地模型网关不可用（仍可用官方模型）：net::ERR_CONNECTION_REFUSED
REPORT {"ok":true,"modelLine":"本地模型网关不可用（仍可用官方模型）：net::ERR_CONNECTION_REFUSED","errors":[]}
```

- `scripts/e2e/settings-check.mjs` 增加禁用步骤（走真实 preload 桥）：

```
"禁用本地模型: enabled=false，其余字段保留（models=qwen2.5-32b-instruct）",
"disableLocalModel": {"enabled": false, "keptModel": "qwen2.5-32b-instruct", "keptContext": 131072},
"ok": true, "errors": []
```

**遗留**：错误页的【禁用本地模型并重启】会重启整个应用（不可避免，dsh 只在启动时读 patch）；若失败原因其实不是本地模型，用户可能白重启一次——按钮文案已写明「禁用本地模型并重启」，不会让人误以为能修好其它问题。

### 20.10 第 11 轮：取证索引面板「首次使用引导」

**问题**：面板在没有索引库时只有一句「还没有索引库」，新用户（尤其比赛现场）不知道要先在火眼跑解释、更不知道要填哪个目录；而写库位置、耗时、只读边界这些最容易误解的点也没有地方讲。

**实现**

- `plugins/seeu-case-index/client.js` 新增 `onboarding` 卡片，渲染条件 `!db && indexes.length === 0`（没有打开的库且没扫描到任何索引）：
  - 标题「三步开始」，`<ol>` 三步：① 在火眼（GoldenEyes）里跑完检材解析，记下案件目录（含 `.gec` 与「检材分析数据」的文件夹）；② 粘进输入框点【建库 / 更新】（首次约 3–5 分钟；只写 `.seeu-index`，不动原始证据）；③ 用 树 / 检索 / 记录 / 实体 / 时间线 / 表 查，每条结论都能用「引用」回查 Goldeneyes 句柄。
  - 脚注：已有索引库时点【扫描已有索引】（向下找两层，并自动发现上次选过的案件目录）。
  - 样式只复用面板已有的 `S.card / S.muted / C_FG / C_FG2` token，不新增主题色。
- 卡片位置在索引列表 panel 之后、错误提示之前，不遮挡已有库的操作路径（有库时该卡片根本不渲染）。

**验证**

- 新增 `scripts/e2e/panel-empty-check.mjs`（`npm run test:e2e:panel-empty`）：`SEEU_INDEX_SEARCH_DIRS` 指向空目录、`SEEU_INDEX_STATE_FILE` 指到空 home、mock 网关提供模型，启动真 Electron → CDP 点侧栏「取证索引」→ 断言引导文案与【建库 / 更新】按钮。

```
REPORT {"ok":true,"clicked":true,"hasSteps":true,"hasStep1":true,"hasStep3":true,"hasBuildButton":true,"noIndexText":true,"errors":[]}
```

- 回归 `npm run test:e2e:ui`（面板七标签真实数据）仍 `m2ok: true`、`errors: []`。

**遗留**：引导卡只看「有没有库」，不区分「有库但库是旧版本 schema」；后者要靠 `manifest.json` 的 `schemaVersion` 提示（已在 `/stats` 暴露，面板暂未展示）。

### 20.11 第 12 轮：旧库 schema 提示 + 设置页高级超时参数

**问题**

1. 索引库是派生数据，schema 会随版本升级（当前 `SCHEMA_VERSION = 4`）。用户升级应用后打开旧库时，面板照常显示 KPI 与树，但缺失的列/表会被静默当成空值——比报错更危险（取证场景）。
2. 本地网关的超时/重试在 `local-model.json` 里可配，但设置页没有入口，用户只能手改 JSON。

**实现**

- `tools/ges-index/query.mjs`：`tree(db,'root')` 增加 `schemaVersion`（读 `meta.schema_version`）、`currentSchemaVersion`（来自 `parse.mjs` 的 `SCHEMA_VERSION`）、`needsRebuild`（两者不一致且有 meta 值）。
- `plugins/seeu-case-index/client.js`：KPI 下方新增 `S.noticeWarn` 黄色提示条，仅 `view.needsRebuild` 时渲染：「索引库 schema vX 与当前工具 vY 不一致：建议点「建库 / 更新」重建，旧库可能缺字段或查不到新类别。」
- `renderer/local-model.html`：新增 `<details class="adv">`「高级：超时与重试（低并发本地网关）」折叠区，四个字段 `timeoutSec`（秒→`timeoutMs`）、`streamIdleSec`（→`streamIdleTimeoutMs`）、`retryMaxRetries`、`titleMaxOutputTokens`；`readForm()` 用 `secToMs()`/`numOrUndef()` 把空值转 `undefined`（交给 `normalizeLocalModel` 填默认），`fillForm()` 回填现有值（默认 600/600/3/512）。

**验证**

- 预览 API：`/tree?db=…&node=root` → `{"schemaVersion":"4","current":4,"needsRebuild":false,"records":22777,"evidences":5}`（真案件库，schema 一致）。
- `npm run test:e2e:settings` 仍全绿：`{"ok":true,…,"preview: patch 1086 字符，含 retryPolicy=true","测试连接: HTTP 200…","保存/重新读取: 一致","拉取模型: …","错误网关: 按预期失败","errors":[]}`。
- `node --check plugins/seeu-case-index/client.js` → SYNTAX-OK。

**遗留**：面板只提示不一致，不提供「一键重建」（建库 3–5 分钟，需用户确认案件目录可写）；`/stats` 已带 `meta.schema_version`，CLI 侧可用 `index:stats` 查看。

### 20.12 第 13 轮：纯函数单元测试（校准 KNOWN_CATS）

**动机**：这十几轮的改动大多靠「起 Electron + CDP」验证，慢且脆；而最容易悄悄错的其实是纯函数——本地模型 patch 生成、路径分类、CSV/chat 解析、typed 表头投影。一旦回归，表现出来是「模型连上了但工具跑不动」「某类数据没入库」，排查成本高。

**实现**

- 新增 `tests/`（`node --test`，零依赖）：`local-model.test.mjs`（13 例）、`parse.test.mjs`（12 例）、`typed.test.mjs`（6 例），`npm test` → `node --test tests/*.test.mjs`。
- 覆盖点：默认值与自定义值（超时/重试/标题/上下文）、单模型写法、非法路由名回退、缺 baseURL/非 http(s)/缺模型三类报错、未启用时无 patch/env、patch 用 YAML 解析后校验行与字段、`useAsDefault` 追加 `agent-default-model`、headers 转义、`localModelEnv` 占位 key；路径分类（账号层、chat.txt、非检材根）、CSV 引号/缺列、chat 摘要两种写法与空发言人、原文记录ID、实体抽取与超长跳过；typed 表头签名 24 张表的代表签名、不识别表头返回 `null`、mapping 是 `[targetField, sourceColumn]`、DDL 覆盖所有表与列。
- 顺带修一个真实缺陷：`parse.mjs` 的 `KNOWN_CATS` 缺 `图片消息/视频消息/语音消息/文件传输记录/手机联系人/群组列表/群组成员/社群列表/社群成员/频道列表/频道消息/其他消息/App使用详情/会话状态/分组标签/收藏/数据来源/健康数据描述` 等类别——这些目录出现在路径第二段时会被误判成「账号」，进而把类别塞进 `account` 列。补齐后单测锁定行为。

**验证**

```
ℹ tests 31
ℹ pass 31
ℹ fail 0
```

- 补齐 `KNOWN_CATS` 后全案重建（370 叶、266 s）：`records 22777`、`typedRecords 21123`、`coverage 0.927`、`misses 60`、`fingerprint 30e13fe6…` **与改动前完全一致** ⇒ 本案件里没有路径因这次补齐而改分类（只是把潜在的误判风险关掉）。

**遗留**：`query.mjs`（tree/search/cite）与 `build.mjs` 仍靠 e2e 覆盖，未做单测——它们依赖 sqlite 与真实库，更值得做的是「用小型夹具库跑查询快照」，留待后续。

### 20.13 第 13 轮：设置页「复制诊断信息」

- **动机**：真实联调时用户往往只能描述「连不上」，缺少配置路径、探测结果、自检逐项结果，来回问很慢。
- **实现**：`ipcMain.handle("seeu:clipboard:write")`（`clipboard.writeText`）→ `preload.writeClipboard()` → 设置页 `diagnosticsText()` 拼「时间 / 配置文件路径 / enabled / 网关 / apiKey 是否设置（不输出原文）/ 模型 / 上下文与输出 / 超时与重试 / 启动探测 / 能力自检逐项」→ 按钮 `#btn-copy`。
- **坑**：`main.ts` 里同一 IPC 通道被注册两次（一次在 `registerIpc()` 顶部、一次在本地模型区）→ Electron 抛 `Attempted to register a second handler`，`whenReady` 里的注册整体中断，设置窗口不再打开（表现是 e2e 报「设置页没出现」）。一个通道名只能对应一个 `handle`。
- **验证**：`npm run test:e2e:settings` → `copiedDiagnostics: true`，状态行「已复制诊断信息（248 字符）」，`errors: []`。

### 20.14 第 14 轮：窗口档位预设 + 配置健康度检查

- **动机**：用户口径是「128k 个人赛 / 256k 团体赛、并发较少」，而窗口/输出上限/重试/超时四个值互相牵制（输出上限接近窗口会让压缩失效、重试过多会把排队放大成多次长超时、超时过短会让 32B 长上下文首 token 被中断），手填容易踩坑。
- **实现**：`tools/local-model.mjs` 导出 `CONTEXT_PRESETS`（32k/128k/256k）与 `localModelWarnings(cfg)`（不抛异常，返回 `{level: err|warn|info, key, message}`）；`src/local-model.ts` 的 `previewLocalModelPatch()` 返回 `warnings`；设置页加 `#presets` 三个按钮（只改表单，仍需点保存）与 `#warnings` 提示区，随输入实时刷新。
- **规则**：输出上限 ≥ 窗口 → err；超过窗口 1/4 → warn；窗口 < 32k → warn；重试 > 5 → warn；超时 < 60s → warn；流式空闲 > 总超时 → info；窗口不在档位 → info（提示最近档位）。
- **验证**：`npm test` 36 项全绿（新增 5 项：档位形状、默认无警告、输出上限警告分级、窗口/重试/超时组合、非档位提示 + 未启用无警告）；`npm run test:e2e:settings` 全绿（`presetApplied:true`「256k → 窗口 262144 / 输出 8192」、`previewWarnings:["output-window","retries"]`、`copiedDiagnostics:true`）；`npm run test:e2e:local` 仍 `chatCalls 2 / gotReply true`；`npm run check:overlay` OK。
- **遗留**：预设只覆盖窗口/输出两个字段，重试/超时仍留给高级区手动调（机器差异大，不做「一键最优」）；警告只提示、不阻止保存。

### 20.15 第 15 轮：v0.2.1 打包与打包态回归

- 版本 0.2.0 → **0.2.1**（package.json / package-lock.json），`npm run check:overlay` OK 后出包。
- 出包技巧：用户机上 `release/SeeUForensicsAgentPlus-0.1.7-x64-portable.exe` 正在运行（文件占用 → 目录不可删），因此 `npx electron-builder --win --x64 -c.directories.output=release-021` 先出到旁路目录，再逐个搬进 `release/`，不做 `rm -rf release`。
- 产物：win-unpacked exe 246,329,856 B；app.asar 168,708,872 B（19,647 entries，14 个必需路径全命中）；NSIS 211,919,582 B（blockmap 220,872 B）；portable 189,530,173 B。
- 验证：目录版 `{"ok":true,"elapsedMs":5123}`、portable `{"ok":true,"elapsedMs":43481}`；打包态面板 `m2ok:true/errors:[]`（七标签、KPI、检材名+备注、检索 20 命中）；打包态设置页 `ok:true`（asar 内页面、`presetApplied`、`previewWarnings`、`copiedDiagnostics`）。
- 注意：验收机上有用户正在用的实例时**不要**跑 `scripts/kill-app.mjs`（按镜像名前缀匹配会杀掉用户的进程），一律用 `SEEU_DEV_MULTI=1` 并行启动做验证。

## 20.16 第 16 轮：网关自报上下文窗口 + 配置模型缺失检测

动机：真实 OpenAI 兼容网关大多在 `GET /v1/models` 里自报上下文长度（vLLM `max_model_len`、llama.cpp/LM Studio `n_ctx`/`context_length`/`context_window`），让用户手填既容易填错也没必要；另外「配置里写了某个模型，网关没有」这种错在会话里只表现为请求失败，排查成本高。

实现：
- `tools/local-model.mjs` 新增 `CONTEXT_FIELDS`（`max_model_len/context_length/context_window/max_context_length/n_ctx/max_input_tokens`）、`modelContextWindow(entry)`（同时看条目本身与 `meta/metadata/config`，值需为数字且 ≥2048——小于这个数多半是 `max_tokens` 而不是窗口）、`normalizeGatewayModels(data)` → `[{id,name,contextWindow?}]`。
- `src/local-model.ts`：`testLocalGateway()` 的 `models` 改为 `GatewayModel[]`；`probeableLocalModel()` 额外返回配置里的 `models: string[]`。
- `src/main.ts`：`LocalModelProbeState` 增 `missing?: string[]`，启动/手动探测时用「配置的模型 − 网关模型」得出，写 shell 日志 `local model probe: 配置的模型 X 不在网关列表里（网关有：…）`。
- `renderer/local-model.html`：探测行 `missing` 非空时黄色提示；拉取模型列表时若网关自报窗口取值唯一则填 `#contextWindow`，不一致只提示；「复制诊断信息」增「配置缺失模型」行。

验证（`npm run test:e2e:settings`）：
```json
{"ok":true,"pulledContextWindow":"32768","probeMissing":["ghost-7b"],"gatewayModels":["qwen2.5-32b-instruct","mock-14b"],"errors":[]}
```
单测补 `modelContextWindow` / `normalizeGatewayModels` 两组用例（`npm test` 38/38 通过）。

遗留：只读 `/models`，不调用网关的 `/props` 等私有端点；个别网关把窗口写在 `/models` 之外的配置接口，仍需手填。

## 20.17 第 17 轮：欢迎页快捷入口

动机：欢迎页虽然有品牌与三步提示，但「接下来点哪里」还得用户自己在侧栏/菜单里找；第一次上手时「案件索引在哪」「本地模型在哪配」是最常见的两个卡点。把入口做成欢迎页按钮，比再加说明文字有效。

实现：
- `plugins/seeu-theme/client.js`：新增 `HeroActions` 组件，注册到 `conversation.hero.options`（list 槽、scope session）。按钮用 `data-seeu-action` 标记（`index` / `model` / `workspace`）：打开取证索引走 `ctx.layout.selectPanel('seeu-case-index')`；本地模型设置与工作区目录走 preload 桥 `window.seeu.openLocalModelSettings()` / `openWorkspace()`。桥不存在时（纯浏览器 dev 环境）自动隐藏后两个按钮。
- `src/main.ts` / `src/preload.ts`：复用已有 IPC `seeu:open-settings`（`ipcMain.on` → `openLocalModelSettings()`；preload 暴露 `openLocalModelSettings()`，走 `ipcRenderer.send`）。
- 插件 inject 从 `['slots']` 改为 `['slots', 'layout']`（`layout` 由 `dsh-client-ui-layout` 通过 `ctx.reflect.provide("layout", layout)` 提供）。

验证（新增 `npm run test:e2e:hero`）：真 Electron + CDP，先点「本地模型设置」再点「打开取证索引」——顺序不能反：切面板后欢迎页 hero 被面板替换，按钮就不在 DOM 里了。

```json
{"ok":true,"actions":["index","model","workspace"],"settingsOpened":true,"panelOpened":true,"errors":[]}
```

遗留：hero 只在新会话（无消息）出现；「帮助」入口未做，产品说明仍以 README 为准。

## 20.18 第 18 轮：检索筛选 + 引用清单导出

动机：关键词检索此前只有「关键词」一个条件，真实案件里最常问的是「这个关键词在这一起检材里出现了几次」「某段时间有没有相关记录」；另外写报告时要把命中逐条抄成 `Goldeneyes://` 句柄，手工复制十几条容易漏行、漏行号。

实现（只改 `plugins/seeu-case-index/client.js`，后端 `tools/ges-index/query.mjs:244 search()` 原本就支持 `eid/app/account/category/from/to`，不需要改索引或重建）：
- 检索视图加第二行筛选：`检材号 eid` / `应用 app（精确）` / `起始 2025-04-01` / `结束 2025-04-30`，回车与【按筛选检索】等价；有任一条件时出现【清空筛选】。筛选值在 `doSearch()` 里拼进 `/search` 请求（空值不传），与关键词同时生效（AND）。
- 结果区【复制引用清单】：按当前结果逐条 `GET /seeu-index/cite?id=` 回查真实句柄，导出 Markdown：

  ```markdown
  # SeeU 取证索引 · 检索引用清单
  关键词：加密
  引擎：like · 12 条（导出 12 条）
  筛选：检材 3
  索引库：E:\forensics\<案件>\.seeu-index\case-index.db
  导出时间：2026/11/12 01:34:52

  1. CHAN_MH_mobile.zip · WhatsApp · 2025-04-02 10:11:12 · 第 120 行
     引用：Goldeneyes://2919d298-…/229000000016#120
     回查：ges read "…" --offset 119 --limit 1
     摘要：…
  ```

  无句柄的行写「（该行无溯源句柄，只能作为导航线索）」并在文末统计条数，避免报告里混入不可回查的引用。
- 复制走 `window.seeu.writeClipboard`（Electron preload 桥）；纯浏览器 dev 预览自动退回 `navigator.clipboard.writeText`。
- 引用详情面板也加了【复制引用】（单条：句柄 + 回查命令），复制结果在面板里回显「已复制 N 字符」。
- `resetFilters()` 与「清空筛选」按钮让筛选条件可一键复位；`copyNote` 在重新检索时清空，避免旧提示误导。

验证（新增 `npm run test:e2e:search`，真 Electron + CDP + 真实案件库）：

```json
{"ok":true,"keyword":"加密","errors":[],"panelOpened":true,"dirFilled":true,"scanned":true,"tabOpened":true,"queryFilled":true,"searched":true,"baseRows":20,"filterEid":3,"eidFilled":true,"filterApplied":true,"filteredRows":12,"filteredAllMatch":true,"filterNarrowed":true,"copyClicked":true,"copyNote":"已复制 12 条引用清单","clipboard":{"len":4596,"hasHeader":true,"hasCite":true,"hasRecheck":true,"head":"# SeeU 取证索引 · 检索引用清单 | 关键词：加密 | 引擎：like · 12 条（导出 12 条）"},"cleared":true,"afterClear":""}
```

要点：先不带筛选检索 20 条，取首行的 `检材号` 作为筛选值再检索 → 12 条且**全部**落在该检材；复制后从系统剪贴板（`powershell Get-Clipboard -Raw`）读回 4596 字符，含清单头、`引用：Goldeneyes://` 与 `回查：`；清空筛选后输入框为空。渲染进程 `navigator.clipboard.readText()` 会被 Chromium 拒绝（Read permission denied），所以剪贴板断言必须从系统剪贴板侧读。

回归：`npm run test:e2e:ui`（面板主流程 `m2ok:true`、`errors:[]`）、`npm test` 38/38、`npm run check:overlay` OK。

遗留：应用筛选是**精确匹配**（与后端一致），不支持下拉补全与模糊匹配；日期只按 `record.ts` 字符串比较（格式 `YYYY-MM-DD HH:MM:SS`，跨时区仍以检材原始时间串为准）；一次最多导出当前页 20 条，分页导出待做。

## 20.19 第 19 轮：会话区排版（气泡 / 正文 / 代码块 / 输入框）

动机：会话界面是研判时看得最久的区域，官方默认偏英文排版；主题插件此前只改色板与字体，正文行高、用户气泡、代码块、输入框聚焦态仍是默认值。中文长报告+长句柄（`Goldeneyes://…`）在默认排版下容易糊成一片、句柄被折成两三行。

约束：组件 class 是 CSS Modules 哈希（`<hash>_<name>_<hash>`），升级 dsh 会变；不能依赖。可用只有两类稳定事实：
- 官方渲染器输出的语义属性：`data-chat-flow-kind`（`user` / `assistant-step` / `turn-tail` / `turn-process`）、`data-conversation-scroll`、`data-composer-input`、`data-conversation-region`、`data-tool`、`data-lexical-editor`；
- 哈希字符串里保留的 name 片段（`_bubble_` / `_markdown_`），用 `[class*="_bubble_"]` 这类选择器匹配（比整串哈希稳，但仍属"软契约"）。

实现（`plugins/seeu-theme/theme.css` 末尾「会话区」段，全部 `!important` 以压过 ThemePresenter 的内联 token）：
- `[data-chat-flow-kind]` 统一 `margin-block: 2px`；
- 用户气泡 `[data-chat-flow-kind="user"] [class*="_bubble_"]`：强调色 12% 透明底 + 26% 边框、圆角 16px、`padding 10px 14px`、行高 1.7；
- 助手正文 `[data-chat-flow-kind="assistant-step"] [class*="_markdown_"]`：14px / 行高 1.78，段距 0.55em、列表项 0.2em；
- 代码块 `pre`：layer-2 底 + 细边 + 圆角 12px + 12.5px 字号，`overflow-x` 由官方容器负责（长句柄不折行）；
- 行内代码：强调色文字 + 10% 淡底 + 5px 圆角；
- 回合尾部按钮弱化到 11.5px（用量/操作不抢正文）；
- 输入框 `[data-composer-input]`：圆角 16px，`:focus-within` 描青边 + 3px 柔光环；
- 工具卡 `[data-tool]`：圆角 12px、边框统一到 border-l2；消息内链接强调色 + 悬停下划线。

验证（新增 `npm run test:e2e:theme-conv`，mock 网关 + 真 Electron + CDP，发一条消息后采样 computed style）：

```json
{"ok":true,"gotReply":true,"checks":{"bubbleBg":true,"bubbleRadius":true,"bubbleLine":true,"markdownLine":true,"composerRadius":true,"flowItems":true},
 "styles":{"bubble":{"bg":"color(srgb 0.133333 0.827451 0.933333 / 0.12)","radius":16,"pad":"10px 14px","line":23.8},
           "markdown":{"size":14,"line":24.92},
           "composer":{"radius":16,"border":"color(srgb 0.133333 0.827451 0.933333 / 0.55)"},
           "flowItems":4},
 "screenshot":".dev/shots/conv-theme.png","errors":[]}
```

采样点：`[data-chat-flow-kind="user"] [class*="_bubble_"]`、`[data-chat-flow-kind="assistant-step"] [class*="_markdown_"]`、`[data-composer-input]`，断言背景 alpha > 0、圆角 ≥12px、正文行高 ≥24px、输入框圆角 ≥10px。坑：`color-mix()` 的 `backgroundColor` 在 Chromium 里读出来是 `color(srgb r g b / a)`，不是 `rgba()`，断言 alpha 要两种格式都解析；CDP 的 `send()` 返回整条消息，截图数据在 `result.data` 不在 `data`。

遗留：`[data-tool]` 的样式在没有工具调用的 mock 对话里无法验证（`toolCards: 0`），只在真机工具调用时才可见；dsh 若改 `data-*` 名称或去掉 name 片段，此段需回归；浅色主题沿用同一套 token，未单独出验收脚本（采样值随 `body[data-ds-dark-theme]` 切换）。

## 20.20 第 20 轮：各视图复制清单（记录 / 表 / 实体）

动机：检索视图上一轮已有【复制引用清单】，但研判时更常用的入口是「记录」翻页后挑一页、或「表」里看联系人/账号这类结构化行；实体聚合结果也需要能贴进报告。三处都要能直接产出可回查的 Markdown，否则用户还得逐条点开引用再手抄。

实现（`plugins/seeu-case-index/client.js`）：
- 抽出模块级三个辅助：`clipboardWrite(text)`（Electron preload 桥优先，web 预览退回 `navigator.clipboard`）、`describeFilters(obj, labels)`（把 eid/app/category/q/from/to 拼成一行中文）、`citationListMarkdown({ db, title, items, metaLines })`（逐条 `/cite` 回查，输出「序号. 检材 · 应用 · 时间 · 第 N 行 / 引用：<句柄> / 回查：<ges read …> / 摘要：…」，统计无句柄行并在文末标注）。
- 记录视图（`RecordsView`）：头部右侧【复制本页引用清单】，导出当前页 30 条；抬头写筛选条件与「共 N 条，导出当前页 M 条」，成功提示「已复制 30 条记录引用清单（14996 字符）」。
- 表视图（`TablesView`）：头部右侧【复制本页引用清单】，只导出 `record_id` 非空的行（表里由汇总统计派生的行没有原文，不能引用）；若整页都不可引用，提示「当前页没有可引用的行…」而不是报错。
- 实体视图（`EntityView`）：工具栏右侧【复制实体清单】，导出 `[kind] 值 — N 次 · M 检材` + `检材：3, 5` 明细；聚合行没有 record_id，所以不拼引用而拼检材号。

验证（新增 `npm run test:e2e:export`，真 Electron + 真案件库 + 系统剪贴板读回）：

```json
{"ok":true,"errors":[],"panelOpened":true,"dirFilled":true,"scanned":true,
 "tabRecords":true,"recordsCopied":true,"recordsNote":"已复制 30 条记录引用清单（14996 字符）",
 "recordsClipboard":{"len":14998,"hasHeader":true,"hasCite":true,"hasRecheck":true},
 "tabEntity":true,"entityCopied":true,"entityNote":"已复制 30 条实体清单（1888 字符）",
 "entityClipboard":{"len":1890,"hasHeader":true,"hasKind":true},
 "tabTables":true,"tablePicked":"联系人（745）","tableCopied":true,
 "tableNote":"已复制 20 行表记录引用清单（7025 字符）",
 "tableClipboard":{"len":7027,"hasHeader":true,"hasCite":true}}
```

脚本要点：标签页按钮文字里带数量 badge（`记录22777`），不能用「文字完全相等」点击，改为 `[role="tab"]` 里比 `firstChild.textContent`；表视图的下拉用 `HTMLSelectElement.prototype.value` setter + `change` 事件切换；剪贴板读回仍走 `powershell Get-Clipboard -Raw`（渲染进程读剪贴板被 Chromium 权限拒绝）。

回归：`m2-ui-check` 仍 `m2ok: true / errors: []`；`npm test` 38/38；`npm run check:overlay` OK。

遗留：导出的是「当前页」而不是全部命中（避免 20+ 次 `/cite` 串行拖慢界面，需要全量时用检索视图的清单或翻页导出）；表视图的导出条数以 typed 行为准，与记录视图可能重叠（同一原文在两个视图各出现一次）。

### 20.21 v0.2.2 发布：欢迎页入口、检索筛选与清单导出、会话区排版、网关自报窗口

本轮把 0.2.1 之后累积的四批改动打包发布：

1. **欢迎页快捷入口**（`ee1d515`、`ff3f6e5`）：`plugins/seeu-theme/client.js` 注册 `conversation.hero.options`（list 槽），三枚按钮 `index` / `model` / `workspace`，分别 `ctx.layout.selectPanel('seeu-case-index')`、`window.seeu.openLocalModelSettings()`、`window.seeu.openWorkspace()`；没有 preload 桥时只渲染第一个。`scripts/e2e/hero-check.mjs` 验证（注意步骤顺序：先点设置、再点索引，切面板后 hero 会被替换）。
2. **检索筛选 + 引用清单导出**（`431d6fd`）：检索视图四条件（`eid` / `app` 精确 / `from` / `to`，日期按字符串比较），`search()` 后端本就支持；结果行加【复制引用清单】，逐条 `/cite` 回查句柄，输出 Markdown（`关键词/引擎/筛选/索引库/导出时间` + 每条 `引用：` 与 `回查：ges read …`）。
3. **记录/表/实体视图导出**（`b849c81`）：抽出模块级 `clipboardWrite` / `describeFilters` / `citationListMarkdown`；记录与表视图先批量 `/cite` 再导出（表视图只导出 `record_id` 非空行），实体视图导出聚合清单（无 record_id，拼检材号）。`scripts/e2e/export-check.mjs` 用系统剪贴板读回（`powershell Get-Clipboard -Raw`，渲染进程读剪贴板被 Chromium 拒）。
4. **会话区排版**（`c5854e8`）：`plugins/seeu-theme/theme.css` 追加 13 条规则，只依赖官方语义属性 `data-chat-flow-kind` / `data-composer-input` / `data-tool` 与保留的 class 片段 `_bubble_` / `_markdown_`（CSS Modules 哈希不可用）；`scripts/e2e/theme-conv-check.mjs` 采样 computed style（`color-mix()` 读出来是 `color(srgb … / a)`，不是 `rgba()`）。
5. **本地模型**（`6b8e5fb`）：`normalizeGatewayModels()` 从 `/v1/models` 自报字段（`max_model_len` / `context_length` / `n_ctx` 等，≥2048 才采信）读窗口；`probeableLocalModel().models` 与探测状态 `missing` 让「配置了网关没有的模型」在设置页与 `logs\shell.log` 可见。

打包与回归：见 `docs/packaging.md`「v0.2.2 回归验证」。要点：

- 旁路输出目录 `release-022` 再搬进 `release/`（用户机上 0.1.7 portable 在运行，`rm -rf release` 会 `Device or resource busy`）；0.2.1 三个旧产物已删、0.1.7 portable 保留；
- asar `extractFile` 的路径写法：条目以 `\` 开头，但 `extractFile` 要传不带前导分隔符的反斜杠路径（`plugins\\seeu-case-index\\client.js`），传 `plugins/seeu-case-index/client.js` 会报 not found；
- `verify-launch.mjs` 输出是 pretty-print JSON，别用 `grep -o '{"ok".*}'` 抓；
- 修了 `m2-ui-check.mjs` 探针：检索框改按 placeholder（含「关键词」）定位，避免新增筛选框后 `last input` 命中筛选框导致 `searchOk:false` 误报。

遗留：检索筛选的 `app` 是精确匹配、日期按字符串比较（跨时区/非 ISO 时间可能不精确）；导出只覆盖当前页（20/30 行）；`[data-tool]` 工具体验在 mock 对话（无工具调用）里没被 theme-conv 覆盖。

### 20.22 命中词高亮 + 浅色会话区回归

1. **命中词高亮**（`plugins/seeu-case-index/client.js`）：新增模块级 `escapeRe` / `highlight(text, query)`，把片段按查询词切成 `<mark class="seeu-hl">`；检索结果用后端回传的 `result.query`，记录视图用 `applied.q`（含 `actor：` 前缀也在高亮范围内）。样式走注入的 `CSS_TEXT`：`background: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 26%, transparent)`，深浅主题自动跟随。
2. **浅色会话区**：`scripts/e2e/theme-conv-check.mjs` 支持 `--theme=dark|light`（或 `SEEU_E2E_THEME`），浅色时把 `body` / `documentElement` 的 `data-ds-dark-theme` 摘掉再采样；新增断言 `themeApplied`（暗色必须带属性，浅色不能带且 `body` 底色是 `rgb(245, 247, 250)`），截图分 `conv-theme-dark.png` / `conv-theme-light.png`。

验证：

- `npm run test:e2e:theme-conv` → 暗色 `{"theme":"dark","ok":true,…,"themeApplied":true,"errors":[]}`（气泡 `color(srgb 0.133 0.827 0.933 / 0.12)`、圆角 16、行高 23.8；正文 14px/24.92；composer 圆角 16）；
- `--theme=light` → `{"theme":"light","ok":true,…,"themeApplied":true,"styles":{"bodyBg":"rgb(245, 247, 250)","darkAttr":false,…}}`，气泡强调色换成浅色盘 `#0E7490`（`color(srgb 0.055 0.455 0.565 / 0.12)`）；
- `npm run test:e2e:search` → 新增 `highlights:{"count":10,"sample":["加密","加密","加密"]}`、`highlightOk:true`（其余断言不变：base 20 条 → 筛选 eid 3 → 12 条全匹配 → 清单 4,596 字符）；
- `node scripts/e2e/m2-ui-check.mjs` → `m2ok:true / errors:[]`；`npm test` 38/38；`npm run check:overlay` OK。

遗留：高亮只覆盖检索/记录两个视图（树与表视图是短标签/表格单元，暂不高亮）；`<mark>` 依赖 Chromium 默认语义，若官方样式表给 `mark` 加了底色仍会被我们的 class 覆盖。

### 20.23 面板位置记忆 + 时间线/跨案清单导出

1. **位置记忆**（`plugins/seeu-case-index/client.js`）：`tab` 初值从 `localStorage.getItem('seeu.panelTab')` 恢复（只认 `TABS` 里的键，防脏值）；`tab` / `db` 变化时分别写回 `seeu.panelTab` / `seeu.panelDb`；扫描后自动选库改为「上次用过的库优先，否则第一个」。
2. **时间线导出**：`TimelineView` 新增 `copying` / `note` 与【复制时间线清单】，抬头写分桶、筛选、时间段数、合计记录、索引库、导出时间，正文每个时间段一行 `桶 — N 条 · M 检材 · K 应用`。
3. **跨案导出**：`CrossCaseView` 新增【复制重合实体清单】（有行才显示），抬头写 minCases / 类型 / 条数 / 跨案库，正文 `[kind] value — 案数 · 检材 · 提及次数` + 案件号行。

验证：

- `npm run test:e2e:export` → `ok:true`，新增 `timelineNote:"已复制 86 个时间段的清单（3235 字符）"`、`timelineClipboard:{len:3237,hasHeader:true,hasBucket:true}`、`savedTab:"timeline"`（点击时间线标签后 localStorage 记下），原有记录 14,996 / 实体 1,888 / 表 7,025 字符不变；
- `node scripts/e2e/m2-ui-check.mjs` → `m2ok:true / errors:[]`（独立 `SEEU_DSH_HOME` / `SEEU_USER_DATA`，避免位置记忆被旧本地存储干扰）；`npm test` 38/38；`check:overlay` OK。

遗留：跨案【复制重合实体清单】尚未在双案夹具下跑 e2e（单案时 minCases=2 无行、按钮不显示；代码与实体清单共用 `clipboardWrite` 路径），下次做双案联调时补一条断言。

### 20.24 第 22 轮：欢迎页「最近案件」chip + 工具卡片样式入 e2e

问题：欢迎页只有三枚入口按钮，研判者每次都要先进面板才知道上次建过库的案件；另外 §20.19 遗留的 `[data-tool]` 卡片样式一直没被任何 e2e 覆盖（会话区只验了气泡/正文/输入框）。

实现（`plugins/seeu-theme/client.js` 的 `HeroActions`）：

- 新增 `recent` 状态：`fetch('/seeu-index/list')` → `body.indexes` 按 `builtAt` 字符串倒序取第一条；`alive` 标记防止卸载后 setState；接口不可用（纯 web 预览没起插件）时静默隐藏；
- 抽出 `openIndex()`（`ctx.layout.selectPanel('seeu-case-index')`），原「打开取证索引」按钮复用同一个函数；
- 外层改成列布局 `seeu-hero-wrap`，按钮行下方渲染 chip：`data-seeu-recent={dbPath}`、`title={dbPath}`、点击 = `openIndex`，文案「最近案件：<案件名> · <MiB> · <生成时间> ›」，样式用强调色 10% 底 / 32% 边 / 圆角 999px（跟随主题 token）；
- 案件名取 `caseName`，缺失时用 `caseDir` 末段；时间用 `toLocaleString('zh-CN',{hour12:false})`。

验证：

- `node scripts/e2e/hero-check.mjs` → `ok:true`、`recentOk:true`，`recentText:"最近案件：\nW盘\n63.0 MiB · 2026/11/11 21:13:00\n打开 ›"`，`recentDb:"E:\\forensics\\W盘_2919d298-…\\.seeu-index\\case-index.db"`，三枚按钮与设置窗口/面板断言不变；
- **踩到的坑**：外壳启动时会用 `readIndexStateDirs(<DSH_HOME>/index-state.json)` 覆盖 `SEEU_INDEX_SEARCH_DIRS`（`src/host.ts:204-208`），所以 e2e 里给 electron 传 `SEEU_INDEX_SEARCH_DIRS` 不生效（`/seeu-index/list` 一直回 `{"indexes":[]}`）；正确做法是往隔离 `DSH_HOME` 写 `index-state.json`：`{"dirs":[<真实案件目录>]}`，这也正是面板「记住上次案件目录」的生产路径。探测脚本里用 `fetch('/seeu-index/list')`（页面同源、无鉴权）确认状态。
- `node scripts/e2e/local-tools-e2e.mjs` 末尾新增工具卡片采样：`document.querySelector('[data-tool]')` 的 `borderTopLeftRadius` / `borderTopColor`；结果 `toolCardStyle:{"count":1,"radius":12,"border":"rgba(148,163,184,0.18)"}`、`toolCardStyleOk:true`，同时保持原有断言（`chatCalls:3`、`tools:27`、`maxTokensField:"max_tokens"`、`hasStreamOptions:false`、`hasStore:false`）。
- 回归：`npm test` 38/38；`SEEU_DEV_MULTI=1 … node scripts/e2e/m2-ui-check.mjs` → `m2ok:true / errors:[]`（KPI、检材名+备注、检索 20 命中、`复制引用清单` 按钮都在）。

遗留：chip 只显示一个（最近那条）；如果要列最近 3 个需要在欢迎页加一块列表，等用户确认视觉后再做。

### 20.25 第 23 轮：本地模型「精简工具集」预设（固定开销省 ~8k tokens）

问题：本地模型接入只调了 provider/超时/重试/压缩阈值，**工具描述压缩**一直没动。goal 明确要求这一项；而且它可能比压缩阈值更影响小窗口模型——工具描述是每次请求的固定开销，压缩只能减少历史消息。

实测（`scripts/e2e/local-tools-e2e.mjs` 的 mock 网关把请求体记进 `shapes`，新增 `toolsChars / systemChars / toolsByName / requestChars`）：

| preset | 工具数 | 工具描述 | 系统提示 | 首个带工具请求 | 估算 tokens |
| --- | --- | --- | --- | --- | --- |
| standard | 27 | 26,687 字符 | 6,061 字符 | 45,099 字符 | ≈20.5k |
| seeu-lite | 12 | 10,229 字符 | 4,379 字符 | 26,946 字符 | ≈12.2k |

工具开销 Top：`pwsh` 3,526 / `workflow` 3,420 / `schedule_create` 2,621 / `subagent` 1,629 / `schedule_edit` 1,472 / `ask_user_question` 1,450 / `subagent_fork` 1,299 / `present` 1,037 / `update_goal` 1,015。也就是说**编排类工具（workflow/subagent/schedule/goal/present/团队通信）占了近一半固定开销**，而单机取证分析很少用它们。

调研：dsh 没有工具描述覆盖/过滤配置位（`dsh-tools`、`dsh-agent` 都没有 `maxDescription` / `allowedTools` / `maxTools` 之类）；唯一可控点是 **preset 的 `plugins` 列表**——工具由 preset 挂载，`@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 里每个预设就是一个 `- insert: [{name: '@deepseek-ai/dsh-agent-preset', config: {plugins: [...]}}]` 行。

实现：

- `resources/forensics/cordis.patch.yml` 末尾新增 `- insert:` 的 `preset-seeu-lite`（`name: '@deepseek-ai/dsh-agent-preset'`，`config.id: seeu-lite`、`order: 2`、`name: 取证分析（本地模型精简）`）：插件列表 = 精简 persona（6 条取证准则）+ `agent-instructions` + `time-context` + `tool-bash`/`tool-pwsh` + `tool-fs`（只读）+ `tool-fs-search` + `tool-jobs` + `skill-filesystem` + `tool-skill` + `tool-ask-user` + `tool-todo`（`allowParallelInProgress: false`）+ `compaction` 组（与 standard 相同的 0.8 / 8192 / 0.16）；
- `tools/local-model.mjs`：`DEFAULTS.litePreset = true`，`normalizeLocalModel()` 返回 `litePreset: input.litePreset !== false`，`localModelPatch()` 在末尾追加 `- id: agent-preset-registry` / `config: { default: seeu-lite }`（关掉则不写这一行）；
- `renderer/local-model.html`：新增复选框 `#litePreset`（默认勾选，文案「精简工具集（推荐，省约 2 万字符固定上下文）」），`readForm()` / `fillForm()` 同步；
- 为什么改 registry 的 `default` 而不是覆盖 `preset-standard`：这样完整取证预设原样保留，用户在会话里可以随时切回去；覆盖 `preset-standard` 会把子代理/工作流彻底拿掉且无法按会话切回。

验证：

- `npm test` **40/40**（新增两条：默认开 → patch 含 `agent-preset-registry`/`seeu-lite`；关 → 无 registry 但仍有 `session-title-llm`；同时修了 2 条被新增行顺序打乱的旧断言：ids 列表加 registry、`agent-default-model` 改成按 id 查找而非 `rows.at(-1)`）；
- `--dump-config`（取证 overlay + `.probe/local-test.yml`）：`agent-preset-registry.config.default: seeu-lite`（dump 707-710 行）、`- id: preset-seeu-lite`（1349 行）；
- `node scripts/e2e/local-tools-e2e.mjs` → `ok:true`，`litePresetActive:true`、`litePresetTools:12`、`budget:{toolsCount:12,toolsChars:10229,systemChars:4379,requestChars:26946,approxTokens:12248}`；
- `node scripts/e2e/settings-check.mjs` → `ok:true`，`previewHasLitePreset:true`、`litePresetOptional:true`（`litePreset:false` 时 preview 无 registry 行）、`litePresetSaved:true`，其余设置页断言（档位/健康度/诊断复制/自报窗口/缺模型/禁用兜底）不变；
- `node scripts/e2e/m2-ui-check.mjs` → `m2ok:true / errors:[]`（面板不受预设改动影响）。

遗留：精简预设只影响**新会话**（`agent-preset-registry.default` 在会话创建时读取），已有会话仍是创建时的预设；`agent-preset-registry` 目前只有 `default` 一个字段，dsh 改 registry 结构时要回看这一行。

### 20.26 第 24 轮：设置页固定开销估算 + 网关失败的可操作提示

问题：上一轮把工具描述实测出来了，但数字只写在文档里，用户看不到；另外网关连不上时设置页只显示 `net::ERR_CONNECTION_REFUSED` 这类原始错误，非开发者无法判断是没启动还是端口错。

实现：

- `tools/local-model.mjs` 新增 `CONTEXT_BUDGET`（实测常量：full = 27 工具 / 26,687 字符 + 系统提示 6,061；lite = 12 工具 / 10,229 + 4,379）、`estimateContextBudget(cfg)`（按 2.2 字符/token 估算 `fixedTokens / remainingTokens / conversationShare`）、`explainGatewayError(text)`（映射 ECONNREFUSED / ERR_UNSAFE_PORT / ENOTFOUND / 超时 / 401 / 403 / 404 / 5xx / MISSING_CREDENTIAL / 缺 baseURL，各给一句中文可操作提示）；
- `src/local-model.ts`：`previewLocalModelPatch()` 返回 `budget`（`ContextBudget`）；`testLocalGateway` 失败分支统一返回 `{ ok:false, error, hint }`；
- `src/preload.ts`：`LocalModelProbeResult.hint` 与 preview 的 `budget` 类型；
- `renderer/local-model.html`：新增 `#budget` 行（「固定开销估算：约 6.6k tokens（工具 12 个 + 系统提示，共 14,608 字符）｜窗口 262.1k → 约 255.5k tokens 留给对话（97%）」，占比 <50% 变黄）；拉取模型失败时把 `hint` 拼进状态行。

验证：

- `npm test` **42/42**（新增 2 条：`estimateContextBudget` 精简/完整对比、`explainGatewayError` 五种错误映射）；
- `node scripts/e2e/settings-check.mjs` → `ok:true`，`budgetText:"固定开销估算：约 6.6k tokens（工具 12 个 + 系统提示，共 14,608 字符）｜窗口 262.1k → 约 255.5k tokens 留给对话（97%）"`、`badGatewayHint:"连不上：网关没启动、端口不对，或被防火墙拦了。…"`；
- **踩坑**：e2e 原来用 `http://127.0.0.1:1/v1` 测失败分支，Chromium 直接报 `net::ERR_UNSAFE_PORT`（1 是禁用端口）而不是连接拒绝，hint 落到兜底文案；改为 19999，并给 `ERR_UNSAFE_PORT` 补了专门提示；
- `node scripts/e2e/m2-ui-check.mjs` → `m2ok:true / searchOk:true / errors:[]`（面板不受影响）。

遗留：`CONTEXT_BUDGET` 是随包实测常量，官方工具描述变化或精简预设增删工具后要重新跑 `npm run test:e2e:tools` 更新（脚本已输出 `budget.toolsChars / systemChars`）。

### 20.27 第 25 轮：v0.2.3 打包与打包态回归

本轮把 0.2.2 之后累积的五批前台/本地模型改动（`227527b` 命中高亮与浅色验证、`ab9f39a` 位置记忆与时间线/跨案导出、`2ab21f9` 最近案件 chip、`1f55615` 精简预设、`2ad11fc` 固定开销估算与网关错误提示）打成一个可交付版本。

- 版本 0.2.3；`node scripts/build.mjs` + `npm run check:overlay` + `npm test`（42/42）通过。
- 打包：`npx electron-builder --win --x64 -c.directories.output=release-023`（用户 0.1.7 portable 在运行，不能先删 `release/`），产物 211,926,785 B（NSIS）/ 189,518,082 B（portable）/ asar 168,751,123 B（19,647 entries），搬入 `release/` 并清掉 0.2.2 三件。
- 打包态回归：目录版 5102 ms、portable 37572 ms；`m2-ui-check` `m2ok/searchOk/evNames` 全 true；`settings-check` 全绿（含 `budgetText`、网关自报窗口 32768）；`export-check` 四种清单字符数与 dev 一致。
- 顺带在 `scripts/e2e/local-tools-e2e.mjs` 的 mock 里记录 \`strictTrue/strictAny\` 并投影进 `firstRequest`，实测当前请求 `strictAny: 0`（dsh/pi-ai 没有给本地路由加 `strict` schema，无需 `supportsStrictMode: false`）。
- 踩坑：打包态设置页 e2e 第一次报「preload 桥未暴露」，实为上一轮中断的 CDP 会话占 9351 端口连到旧页面；手工 CDP 探测确认 `window.seeu` 键齐全，换干净进程重跑即过——以后 e2e 先排 CDP 残留。
- 遗留：`tools/local-model.mjs` 不进 asar（已被 esbuild 打进 `dist/main.cjs`），文档里已注明；仍未拿到用户真实网关地址，真机联调未做；视觉验收仍待用户确认。

### 20.28 第 26 轮：案件概览一键导出（检材清单 Markdown）

动机：研判报告和交接材料的第一页永远是「这个案子有几个检材、各自是什么」。以前要人工从面板抄，或者让模型自己调 `/evidences`；KPI 条只显示数字，没有「谁是谁」。

实现（只改 `plugins/seeu-case-index/client.js`）：

- Panel 新增 `overviewNote` 状态与 `copyOverview()`：取 `/evidences?db=` 的检材列表，拼 Markdown：
  - 抬头：案件名、案件编号、案件目录、索引库路径、生成时间（含 schema 版本）、规模（检材数 / 记录数 / 实体数 / 库大小）；
  - 正文：`| 检材 | 名称 | 持有人 | 平台 | 记录数 | 备注 |` 表；备注里的 `|` 转义成 `\|`；
  - 脚注：说明由 SeeU 取证索引生成、细节用检索/记录视图导出引用清单。
- KPI 条下方渲染【复制案件概览】按钮 + 说明 + 复制结果（`已复制案件概览（685 字符，含 5 个检材）`）。
- 走已有 `clipboardWrite`（Electron `writeClipboard` 优先、web 预览回退 `navigator.clipboard`）。

验证：

- `node scripts/e2e/export-check.mjs` 新增步骤 0：点【复制案件概览】→ `powershell Get-Clipboard` 读回；
  `{"ok":true,"overviewCopied":true,"overviewNote":"已复制案件概览（685 字符，含 5 个检材）","overviewClipboard":{"len":687,"hasHeader":true,"hasEvidence":true,"hasTable":true,"hasScale":true},"errors":[]}`；
- 其余导出步骤（记录 14,996 / 实体 1,888 / 表 7,025 / 时间线 3,235 字符）与标签页记忆不受影响；
- `m2-ui-check` → `m2ok:true, searchOk:true, errors:[]`；`npm test` 42/42；`check:overlay` OK。

遗留：概览不带跨案信息（跨案视图有独立的重合实体清单）；检材表按 `/evidences` 顺序（eid 升序）。

### 20.29 第 27 轮：配置窗口 vs 网关自报窗口的一致性检查

问题：网关通常用 `max_model_len` 自报能力上限，但用户可能手填/套档位成更大的窗口（如 131072），超出部分的请求会被网关拒绝，表现为「聊几轮突然报错」，而界面上一切正常。

实现：

- `tools/local-model.mjs` 新增并导出 `contextWindowMismatch(contextWindow, modelIds, gatewayModels)`：只看配置里出现过、且网关自报 `contextWindow >= 2048` 的模型，取最小值；配置更大才返回 `{ configured, gateway }`，否则 `null`；
- `src/local-model.ts`：`probeableLocalModel()` 返回里补 `contextWindow`（来自归一化配置），并再导出该 helper；
- `src/main.ts`：`LocalModelProbeState` 加 `mismatch?: { configured, gateway }`；探测成功时计算并随状态广播，日志写「配置的上下文窗口 X 超过网关自报的 Y，超出部分请求会被拒」；
- `src/preload.ts`：类型同步；
- `renderer/local-model.html` 的 `renderProbe()`：把 missing 与 mismatch 合并成黄字提示（`配置的模型 … 不在网关列表；配置窗口 131.1k 超过网关自报的 32.8k，超出部分请求会被拒`）。

验证：

- `tests/local-model.test.mjs` 新增 1 例（超过才报 / 相等与更小不报 / 未知模型不报 / 网关没自报窗口不报）→ `npm test` **43/43**；
- `node scripts/e2e/settings-check.mjs`（mock 网关两个模型都自报 `max_model_len: 32768`，随后写一份 `contextWindow: 131072` + 含 `ghost-7b` 的配置并调 `probe()`）→ `{"ok":true,"probeMismatch":{"configured":131072,"gateway":32768},"probeText":"启动探测：可用 · qwen2.5-32b-instruct, mock-14b · http://127.0.0.1:18081/v1 · …｜配置的模型 ghost-7b 不在网关列表；配置窗口 131.1k 超过网关自报的 32.8k，超出部分请求会被拒","errors":[]}`。

遗留：只在启动探测/手动探测时检查，不拦截保存（用户可能故意配大窗口配代理层）；网关完全不报窗口时无法判断。

### 20.30 第 28 轮：检索结果分页

问题：`search()` 最多 `limit` 100，面板只请求 20 条且没有翻页，命中几十上百条时后面大部分看不到。

实现：

- `tools/ges-index/query.mjs` 的 `search()`：新增 `offset`（`Math.max(0, Number(opts.offset) || 0)`），两条 SQL 都加 `limit ? offset ?`；新增 `total`（同 where 条件的 `count(*)`，FTS 与 LIKE 各一份）与 `next`（`offset + rows.length < total ? offset + rows.length : null`），返回体多 `total/offset/limit/next`；
- 插件 `plugins/seeu-case-index/index.js` 的 `/search` 路由透传 `offset`；
- 面板 `plugins/seeu-case-index/client.js`：`doSearch(nextOffset)`（点击事件对象经 `Number.isFinite(Number(x))` 过滤后按第 0 页处理），结果头部在「引擎 … · N 命中」后加「共 N 条 · 第 a–b 条」与【上一页】【下一页】（`result.next == null` 不显示下一页）。

验证：

- API 直测（dev 预览，关键词「加密」走 LIKE）：`total=41`，第 1 页 20 条 `first=2415`、`next=20`，第 2 页 `offset=20` `first=21916`、`next=40`，两页 id 无重叠；
- `npm run test:e2e:search` 新增分页断言 → `{"ok":true,"pageTotal":41,"page2Rows":20,"page2Different":true,"pagePrevShown":true,"pageBackSame":true,"baseRows":20,"filteredRows":12,"errors":[]}`；
- 回归 `m2-ui-check` → `{"m2ok":true,"searchOk":true,"evNames":true,"errors":[]}`、`npm test` 43/43。

遗留：每页固定 20 条（未做成可调）；「复制引用清单」仍只导出当前页；`total` 用 `count(*)` 全量统计，超大库（百万行）会慢，必要时可加「估算」模式。

### 20.31 第 29 轮：导出全部命中的引用清单

问题：分页之后能看到全部结果了，但【复制引用清单】仍只导出当前页 20 条；写报告时想要整批命中还要手工翻页复制。

实现（只改 `plugins/seeu-case-index/client.js`）：

- `exportCitations(all)`：`all === true` 且 `total > 当前页条数` 时，先按 `offset` 循环调 `/search`（每页 100）把结果取满（上限 200 条，取不满就按已取到的导出），再逐条 `/cite` 回查；
- 清单抬头「引擎 … · N 条（导出 X 条，总计 N 条，最多导出 200 条）」；
- 结果区在「复制引用清单」旁多一个【导出全部 N 条】按钮（`(result.total ?? 0) > rows.length` 才显示）；
- 注意 `onClick` 会把事件对象传进来，所以判断写成 `all === true`，否则点「复制引用清单」会误触发全量导出。

验证：

- `npm run test:e2e:search` 新增步骤：检索「加密」得到 41 条命中 → 点【导出全部 41 条】→ 提示「已复制 41 条引用清单」→ 用 `Get-Clipboard -Raw` 读回，`^\d+\. ` 行数 41、总长 17,413 字符；
- 结果：`{"ok":true,"pageTotal":41,"exportAllClicked":true,"exportAllCount":41,"exportAllClipboard":{"len":17413,"items":41},"baseRows":20,"filteredRows":12,"errors":[]}`。

遗留：上限 200 条（每条要回查一次句柄，再多会明显变慢）；无进度条，只有按钮文字「复制中…」。

### 20.32 第 30 轮：面板浅色主题回归

背景：面板样式早就 token 化（`--dsw-alias-*` + 深色兜底），但 e2e 一直只在暗色下跑；§20.19/§20.22 把「浅色未单独出脚本」列为遗留。

实现（只改 `scripts/e2e/m2-ui-check.mjs`）：新增 `SEEU_E2E_THEME=light` 分支，在既有断言跑完后执行：

- `document.body.removeAttribute('data-ds-dark-theme')` 与 `documentElement` 同样处理，等 1.5s 让 token 重算；
- 采样 `getComputedStyle`：`body` 背景、首个 `.seeu-row.is-clickable` 的 `color`，按 `0.2126r+0.7152g+0.0722b` 换算亮度；
- 断言 `bodyLum > 0.75` 且 `rowLum < 0.45`（浅底深字），结果写进 REPORT 的 `lightOk`。

验证：

- `SEEU_E2E_THEME=light SEEU_DEV_MULTI=1 SEEU_NO_KILL=1 … node scripts/e2e/m2-ui-check.mjs` → `{"m2ok":true,"searchOk":true,"lightRemoved":true,"lightStyles":{"bodyBg":"rgb(245, 247, 250)","rowColor":"rgb(11, 18, 32)","bodyLum":0.968,"rowLum":0.069},"lightOk":true,"errors":[]}`；
- 不设该变量（暗色）复跑 → `{"m2ok":true,"searchOk":true,"errors":[]}`（不受影响）。

结论：面板颜色全部来自 `--dsw-alias-*` / `--dsw-static-*` token，没有硬编码暗色，浅色下无需改样式；唯一需要留意的是 `.seeu-btn.is-primary` 用 `bg-base` 作文字色（浅色下是近白配深青，对比度正常）。

### 20.33 第 31 轮：欢迎页「默认本地模型」chip

问题：本地模型配置藏在菜单/托盘里，欢迎页看不出「现在到底跑哪个模型、网关通不通」；`v0.2.3` 的模型信息只能进设置窗口才看得到。

实现（只改 `plugins/seeu-theme/client.js` 的 `HeroActions`）：

- `shell.localModel.get()` 读 `{ config, probe }`；`config.enabled === false` 或没有配置时整枚 chip 隐藏（不影响纯 web 预览）；
- 文案「本地模型：<模型名> · <窗口>k · 网关可用/网关不可用」，模型名取 `config.model` 或 `models[0].name`/`id`；
- 左侧 6px 圆点：绿 `#34D399`（探测 ok）、黄 `#FBBF24`（探测失败）、灰（尚未探测）；
- 点击调用 `shell.openLocalModelSettings()` 打开设置窗口；`title` 带网关 `baseURL`；
- `src/main.ts` 的 `seeu:local-model:get` 顺带修了一个真实缺口：过去只回 `describeLocalModelConfig()`（只读文件），用 `SEEU_LOCAL_MODEL_JSON` 注入生效配置时 `config` 为空，chip 看不到；现在文件不存在时回落到 `readLocalModelConfig()`。

验证（`node scripts/e2e/hero-check.mjs`）：脚本内起 mock 网关 `:18084`（`/v1/models` 回 `mock-14b` + `max_model_len:131072`）并注入 `SEEU_LOCAL_MODEL_JSON`，断言 chip 文本含 `Mock 14B` 与「网关可用」→ `REPORT {"ok":true,…,`localModelText":"本地模型：\nMock 14B\n128k · 网关可用","localModelChip":"Mock 14B","localModelOk":true,"recentOk":true,"settingsOpened":true,"panelOpened":true,"errors":[]}`。

回归：`npm test` 43/43；`node scripts/e2e/settings-check.mjs` `ok:true`（`get` 仍回 `exists:false` + `probe:null`，未破坏设置页首屏）；`node scripts/build.mjs` 通过。

遗留：chip 展示的是「配置文件里的默认模型」，会话内用模型选择器临时切换不会同步；未配置本地模型时不显示任何提示（有意避免噪声）。

### 20.34 第 32 轮：网关预热（把模型冷启动时间提前付掉）

问题：vLLM / llama.cpp / LM Studio 在第一次 chat 请求时才加载权重，14B~32B 冷启动几十秒到几分钟；用户开新会话问第一句时只能看着界面不动，容易以为程序卡死。

实现：

- `src/local-model.ts` 新增 `warmupLocalGateway({ baseURL, apiKey, model, timeoutMs })`：复用内部 `postCompletion()`，发 `POST <baseURL>/chat/completions`，body `{ model, messages:[{role:user,content:ping}], stream:false, max_tokens:1 }`，默认超时 **300000ms**；返回 `{ ok, elapsedMs, reply?, error?, hint? }`（失败走 `explainGatewayError()` 中文提示）；
- `src/main.ts` IPC `seeu:local-model:warmup`：传了 `baseURL` 就按表单试；没传就用 `probeableLocalModel()` 的已保存配置（`models[0]`）；
- `src/preload.ts` 暴露 `localModel.warmup(probe)` + `LocalModelWarmupResult` 类型；
- `renderer/local-model.html` 新增【预热模型（加载进显存）】：读表单 → 取第一个模型 id → 按钮置灰、状态行「正在预热 …（冷启动可能要几十秒到几分钟，窗口别关）」→ 成功「预热完成：<模型> 已加载（首次响应 N ms/s）」/ 失败带 `hint`。

验证：`scripts/e2e/settings-check.mjs` 的 mock 网关新增 `POST /v1/chat/completions`（回 `pong`），断言 API 直调与真实按钮点击两条路径：

`REPORT` 关键字段：`"warmupApiOk":true,"warmupElapsedMs":4,"warmupOk":true,"warmupText":"预热完成：qwen2.5-32b-instruct 已加载（首次响应 4 ms），回复「pong」；现在开新会话就不用等加载了。"`；`npm test` 43/43；`node scripts/build.mjs` 通过。

遗留：预热只发一次，网关若按最短空闲时间卸载模型（部分 vLLM 配置）会重新变冷；超时固定 5 分钟，超大模型（70B+ 磁盘冷读）可能不够，后续可做成可配置。

### 20.35 第 33 轮：检索筛选的检材改为下拉

**问题**：检索筛选的「检材号 eid」是手输框。研判者看到的是「检材 3 · LEUNG_YL_mobile.zip」，手输时要自己记 eid↔名称的对应，输错就筛出空结果且没有提示。

**实现**（只改 `plugins/seeu-case-index/client.js`）：

- `Panel` 新增 `evList` 状态与 `useEffect`：`db` 变化时调 `/evidences?db=`，取 `body.evidences`（字段 `eid/name/holder/platform/type/recordCount/label`），失败置空，`alive` 标记防卸载后 setState；
- 检索筛选行把 `narrowInput(filters.eid, …)` 换成 `h('select')`：首项「全部检材」，其余每项文案 `检材 <eid> · <name> · <platform>`（缺名称/平台时自动省略），`onChange` 写 `filters.eid`，回车触发检索，未选库时 disabled；`title` 提示「下拉里就是火眼的检材名称，不用记 eid」；
- `scripts/e2e/search-filter-check.mjs`：改按 `option.value === String(eid)` 找 select、设值后 `dispatchEvent(new Event('change',{bubbles:true}))`；`afterClear` 读含「全部检材」选项的 select 的 value。

**验证**：

`node scripts/e2e/search-filter-check.mjs` → `"ok": true`、`"eidFilled": true`、`"filterApplied": true`、`"filteredRows": 12`、`"filteredAllMatch": true`、`"copyNote":"已复制 12 条引用清单"`、`"pageTotal": 41`、`"exportAllCount": 41`、`"errors": []`；`npm test` 43/43；`m2-ui-check`（`SEEU_DEV_MULTI=1`）→ `"errors": []`。

遗留：检材下拉的数据来自 `/evidences`，索引库 schema < 4 时 `name/platform` 为空，下拉只剩「检材 N」（建议按旧库提示重建）；下拉只在检索视图，记录/表视图的筛选仍是手输。

### 20.36 第 34 轮：检索结果行显示检材名

**问题**：检索结果行标签是「3·WhatsApp」（eid·应用），研判时要回头翻检材清单才知道 3 是哪个手机；检材下拉已经有名称数据，结果行却没用上。

**实现**（只改 plugins/seeu-case-index/client.js）：新增 evLabel(eid)（在 evList 里按 eid 找 name，找不到退回「检材 N」），结果行标签改成「检材名 · 应用」并给标签加 title=「检材 N」保留检材号。

**e2e**：scripts/e2e/search-filter-check.mjs 的 readSearchRows() 原本从标签文本里正则抓 eid，改标签后抠不到 → 改为读标签的 title 属性（匹配「检材 数字」）拿 eid、取「 · 」后半段当 app；scripts/e2e/m2-ui-check.mjs 新增 searchEvNames 断言（检索结果文本里应出现案件检材文件名）。

**验证**：search-filter-check → ok:true、baseRows:20、filteredRows:12、pageTotal:41、errors:[]；m2-ui-check（SEEU_DEV_MULTI=1）→ searchOk:true、searchEvNames:true、errors:[]；npm test 43/43。

遗留：结果行标签只用于检索视图，记录/表/时间线视图仍按各自表格结构显示检材号或名称；检材名过长时靠标签的省略号截断，完整名要开引用详情。

### 20.37 第 35 轮：v0.2.4 打包与打包态回归

**版本**：0.2.3 → 0.2.4（`npm version 0.2.4 --no-git-tag-version`），`node scripts/build.mjs` 与 `npm run check:overlay` 通过。

**打包**：`npx electron-builder --win --x64 -c.directories.output=release-024`（后台作业约 12 分钟；用户机上 0.1.7 portable 在运行，不能先删 `release/`），产物搬进 `release/` 并删掉 0.2.3 三件。

**产物**：win-unpacked exe 246,329,856 B；app.asar 168,768,410 B（19,647 entries）；NSIS 211,929,804 B（blockmap 220,797）；portable 189,498,621 B；win-unpacked 总计 803,621,299 B（≈766 MiB）。

**asar 校验**：14 个必需路径 `missing:[]`；case-index client.js 107,182 B（含 `evLabel`、案件概览）；theme client.js 含欢迎页模型 chip / 最近案件 chip；设置页含预热、固定开销估算、窗口档位。

**验证**：目录版 4091 ms、portable 52,547 ms 启动 OK；打包态 `m2-ui-check`（`m2ok/searchOk/searchEvNames/evNames` 全 true）、`settings-check`（预热、窗口自报、缺模型、超限提示、禁用兜底全绿）、`export-check`（案件概览 685 字符、时间线 3,235 字符）均通过。

**这一包相对 0.2.3 的累积改动**：案件概览导出、检索分页、导出全部命中、浅色主题回归、欢迎页最近案件 chip、窗口超限提示、网关预热、欢迎页默认本地模型 chip、检索筛选检材下拉、检索结果行显示检材名。

遗留：打包过程中后台作业占用执行器，期间其它 bash 调用会报 `EXECUTOR_UNAVAILABLE`；下次打包尽量单独跑、不要在等待时并行起命令。

### 20.38 会话自动注入「案件概览」（v0.2.4 之后）

**问题**：本地小模型首轮不知道分析哪个检材；`ges-case-index` 技能虽然教了模型先查 `/evidences`，但小模型常常跳过这步直接猜 eid，或把上下文花在反复调工具上。

**关键事实（排障过程）**：

- dsh Web 的会话工作区**不是**外壳进程的 cwd：默认是 `C:\Users\<用户>\Documents\deepseek-harness\default-workspace`（会话目录名 `--C-Users-...-deepseek-harness-default-workspace--`），所以只写 `<SEEU_WORKSPACE>/AGENTS.md` 不会被读到（`src/host.ts` 的 `spawn(..., { cwd: this.workspace })` 只影响子进程 cwd，不影响 dsh 的 Workspace 默认值）。
- `agent-instructions` 除了项目/工作区候选文件，还会读**用户级** `<DSH_HOME>/AGENTS.md`（`dsh-agent-instructions/lib/index.js:168,731`，`USER_GLOBAL_DIRECTORIES` 含 dsh home），这条与会话工作区无关，是可靠的注入点。
- `tree(db, 'root')` 的规模数字在 `root.totals`（`records/entities/artifacts/evidences/messages/chats`），没有顶层 `records` 字段。

**实现**：

- `plugins/seeu-case-index/index.js` 新增 `writeCaseBrief(indexes?)`：`findIndexes(briefDirs())`（状态文件 + `SEEU_INDEX_SEARCH_DIRS`）→ 取 `tree(root)` 的 `totals/timeRange` 与 `evidences(db)` → 生成带 `<!-- seeu-case-brief ... -->` / `<!-- /seeu-case-brief -->` 标记的 Markdown 区块（案件名、索引库路径、规模、时间范围、`eid|检材|名称|平台|记录数` 表、`$SEEU_INDEX_API` 入口与「不要猜 eid」规则；最多 5 案 × 50 检材）；写入 `<DSH_HOME>/AGENTS.md`（合并式：只替换自己的标记区块，保留用户内容；无标记则追加）；没有 `DSH_HOME` 时退回 `<SEEU_WORKSPACE>/SEEU-CASE-BRIEF.md`；模块级 `briefSig` 去重。
- 触发点：`apply()` 启动时一次、`GET /list` 扫描后（`refreshBrief(indexes)`）、`POST /build` 成功回调（`job.brief = refreshBrief()`）。失败只 `console.warn`，不影响查库。
- `resources/forensics/cordis.patch.yml`：两个 preset 的 `agent-instructions.config` 都加 `instructionFileCandidates: ["AGENTS.md", "CLAUDE.md", "SEEU-CASE-BRIEF.md"]`。

**验证**：

- 真实案件直跑：`DSH_HOME=.dev/brieftest SEEU_WORKSPACE=.dev/brieftest-ws SEEU_INDEX_SEARCH_DIRS=E:/forensics/W盘_... node --input-type=module -e "import plugins/seeu-case-index/index.js → writeCaseBrief()"` → `{"ok":true,"cases":1,"chars":721}`，`AGENTS.md` 内含 `检材 5 个 · 记录 22777 条 · 实体 8191 个`、`数据时间范围：2016-12-11 16:31:16 → 2025-05-16 14:23:50`、5 行检材表（`CHAN_MH_mobile.zip`…）。
- 合并安全性：预置用户手写内容后运行 → 用户内容保留、区块追加；连续重写 3 次文件稳定 936 字节（无增长）。
- e2e：`scripts/e2e/local-tools-e2e.mjs` 的 mock 网关记录每个请求的 messages，新增 `briefSeen/briefChars` 并纳入 `ok` → `{"ok":true,"briefSeen":true,"briefChars":475,...}`（无索引库时的提示区块）；`npm test` 43/43、`check:overlay` OK。

**遗留**：只取前 5 个案件、每案前 50 个检材；`AGENTS.md` 每次启动会重写一次（内容相同）；如果用户自己也有同标记文本会被当成 SeeU 区块替换（标记前缀已足够独特）。

## 20.39 面板显示「会话概览注入状态」（v0.2.5 起）

- 问题：AGENTS.md 注入是全自动的，用户看不到；如果注入失败（DSH_HOME 不可写、索引被删）只会表现为「模型又开始瞎猜 eid」。
- 实现：`plugins/seeu-case-index/index.js` 增加模块级 `briefState = { at, ok, path, cases, chars, error }`，`writeCaseBrief` 成功/失败都更新；新增 `GET /brief`（附 `db` 时多返回 `current.included`）与 `POST /brief`（立即 `refreshBrief()`）。`plugins/seeu-case-index/client.js` 在 KPI 下方渲染状态行（绿/黄/红点 + 文案 + 【刷新会话概览】），文案写清「含本库/不含本库」。
- 验证：`m2-ui-check` 新增 `briefVisible`（正文含「会话语境」「已注入」）与 `briefRefreshOk`（点按钮后出现「已刷新」）并纳入 `m2ok`：

```json
{"briefVisible":true,"briefText":"会话语境：已注入 1 个案件概览（含本库） · 05:00:56 · 新会话会自动带上检材清单","briefRefreshText":"已刷新","briefRefreshOk":true,"m2ok":true,"errors":[]}
```

- 回归：`local-tools-e2e` 仍 `briefSeen:true / briefChars:475`；`npm test` 43/43；`npm run check:overlay` OK。
- 遗留：`briefState` 只在进程内保存，重启后到第一次写入前显示「尚未注入」；多案件时只显示总数，不列案件名单。

## 20.40 v0.2.5：会话上下文注入随包交付

- 版本 0.2.4 → 0.2.5；本包相对 0.2.4 的新增内容：`de2650d`/`620978f`（会话自动注入案件概览，写 `<DSH_HOME>/AGENTS.md` 合并区块）、`52d23c7`/`64bc6de`（面板显示注入状态 + 【刷新会话概览】）。
- 打包：`npx electron-builder --win --x64 -c.directories.output=release-025`（后台作业，约 12 分钟）；产物 NSIS 211,931,937 B / portable 189,540,572 B / app.asar 168,777,657 B（19,647 entries）；asar 自检 15 路径 `missing: []`。
- 打包态验证：目录版 4088 ms、portable 51586 ms；面板 e2e `m2ok:true` 且 `briefVisible/briefRefreshOk:true`（打包态注入状态与刷新按钮都真实可用）；设置页 e2e `ok:true`（精简预设、预热、窗口超限、缺模型提示全绿）。
- 遗留：`briefState` 进程内保存；打包态面板 e2e 会顺带写一次真实的 `<DSH_HOME>/AGENTS.md`（用的是隔离 home，无副作用）。

## 20.41 记录视图筛选：检材下拉 + 起止日期（v0.2.6 起）

- 问题：检索视图早就有「检材下拉 + 应用 + 起止日期」，但记录视图仍然是 4 个手输框（检材号 eid 要自己记），而且日期只能从时间线钻取带入，不能直接输入。
- 实现（只改 `plugins/seeu-case-index/client.js` 的 `RecordsView`）：`useEffect` 拉 `/evidences` 得到 `evList`，检索 eid 输入框换成 `<select>`（选项「检材 N · 名称 · 平台」+「全部检材」）；新增「起 2025-04-01」「止 2025-04-30」两个输入框直接驱动后端 `from/to`（后端 `records()` 早已支持 `eid/app/category/q/from/to`，无需改 SQL）；结果行标签由 `eid·app` 改为「检材名 · 应用」（`title` 保留 `检材 N`）。
- 验证（`m2-ui-check` 新增断言，真实案件库）：未筛选 `记录 22777 条` → 检材下拉选 `检材 3 · LEUNG_YL_mobile.zip` → 点【查询】 → `记录 8443 条`，结果行含 `LEUNG_YL_mobile.zip`，`recordsFilterOk: true`，`m2ok: true`、`errors: []`；`export-check` 回归 `ok:true`（记录清单 14,996 字符等不变）；`npm test` 43/43。
- 遗留：应用/类别仍是手输（可考虑改下拉，数据量大时按需加载）；日期按字符串比较，跨时区记录需自己换算。

## 20.42 流式 token 用量（usageInStreaming，v0.2.6 起）

- 问题：本地网关默认不带 `stream_options.include_usage`（保守兼容），代价是会话里 token 用量/上下文占比恒为 `0 tok`，用户看不出「还剩多少窗口」。
- 实现：`tools/local-model.mjs` 增 `DEFAULTS.usageInStreaming=false`，`normalizeLocalModel()` 传 `usageInStreaming: input.usageInStreaming === true`，`localModelPatch()` 的 compat 由 `supportsUsageInStreaming: false` 改为 `supportsUsageInStreaming: c.usageInStreaming`（用户 `compat` 显式覆盖仍优先）；`renderer/local-model.html` 加复选框「流式响应带 token 用量（stream_options.include_usage）」，`readForm()`/`fillForm()` 接上；`resources/forensics/local-model.example.json` 补 `litePreset`/`usageInStreaming`。
- 验证：`tests/local-model.test.mjs` 新增 1 例（默认 false、打开后 patch 里 true、`compat` 显式 false 仍优先）→ `npm test` **44/44**；`scripts/e2e/local-tools-e2e.mjs` 配置打开 `usageInStreaming`，mock 记录 `body.stream_options` → `"usageRequested":true,"streamOptions":{"include_usage":true}`；`scripts/e2e/local-model-e2e.mjs` 的 mock 按 `include_usage` 回流 usage 分片，页面出现 `用量 22 tok` → `REPORT {"ok":true,"chatCalls":2,"usageAsked":2,"usageText":"用量 22 tok","usageShown":true,…}`；`scripts/e2e/settings-check.mjs` 勾复选框后页面 preview 变 `supportsUsageInStreaming: true`（`usagePreview:true`），保存 JSON `usageInStreaming:true`（`usageSaved:true`）。
- 遗留：不同网关对 usage 分片的字段/时机不一致（有的只在非流式回）；只影响「显示」，不影响对话。

## 20.43 外壳窗口跟随系统浅色主题（v0.2.6 起）

- 问题：dsh 主界面有深浅两套 token，但外壳自己的三个页面（`renderer/loading.html`、`renderer/error.html`、`renderer/local-model.html`）只有深色盘，系统浅色时点开设置窗口是黑的、白天投屏刺眼。
- 实现：三个页面各追加 `@media (prefers-color-scheme: light)` 覆盖块：`:root { color-scheme: light }` + 变量换浅色（设置页 `--bg #F5F7FA / --surface #FFFFFF / --surface-2 #EEF3F8 / --accent #0E7490 / --text #0B1220` 等）；错误页与加载页额外覆盖 `body` 的径向渐变、card 的玻璃背景与阴影、`pre`/`button` 底色；设置页把 `button.primary` 的文字改成白色（浅色下强调色变深）并去掉 logo 的青色光晕。深色仍是默认（`prefers-color-scheme` 不匹配时不受影响）。
- 验证：`scripts/e2e/settings-check.mjs` 用 CDP `Emulation.setEmulatedMedia` 模拟 `prefers-color-scheme: light` → `"lightShell":true,"lightShellStyles":{"bg":"rgb(245, 247, 250)","text":"rgb(11, 18, 32)","lum":0.968}`；`scripts/e2e/loading-check.mjs` 同法 → `"lightOk":true,"lightStyles":{"bg":"#F5F7FA","lum":0.968,"scheme":"light"}`（加载页底色是渐变，`backgroundColor` 透明，要读 `--bg` 变量）；`npm test` 44/44。
- 遗留：错误页只在启动失败时出现，浅色样式靠静态检查 + 与另外两页共用变量，未单独跑 e2e。

## 20.44 本地模型可关「会话标题生成」（低并发少一次请求，v0.2.6 起）

- 问题：dsh 每开新会话都会调一次 `session-title-llm` 起标题（`targetWords 5 / maxOutputTokens 512`）。本地网关（vLLM 单卡、llama.cpp 单进程）一次只能处理一个请求时，这次小请求会排在首轮对话前面，用户感觉「第一句话发出去半天没反应」。
- 实现：`tools/local-model.mjs` 的 `DEFAULTS.titleGeneration = true`；`normalizeLocalModel()` 接受 `false` / `'false'`；`localModelPatch()` 在 `titleGeneration === false` 时输出 `- id: session-title-llm` + `disabled: true`（不再输出 config 块），否则维持原来的小输出配置。设置页新增复选框「用本地模型生成会话标题」（默认勾选），`readForm()`/`fillForm()` 同步该字段。
- 验证：`tests/local-model.test.mjs` 新增 1 例（默认带 config；关掉整行 disabled 且无 `targetWords`；`'false'` 字符串也归一成 false）→ `npm test` 45/45。`scripts/e2e/local-tools-e2e.mjs` 统计不带 tools 的标题请求并支持 `SEEU_TOOLS_E2E_NO_TITLE=1`：默认 `"titleGeneration":"on","titleRequests":1,"ok":true`；关掉后 `"titleGeneration":"off","titleRequests":0,"ok":true`（带工具请求仍是 12 个工具的精简预设）。`scripts/e2e/settings-check.mjs` 断言 `titleGenDefault:true`、`titleGenOffPreview:true`（取消勾选后 preview 里 `session-title-llm` 变 `disabled: true` 且无 `targetWords`）、`titleGenSaved:true`。
- 遗留：标题回退到「首句截断」是 dsh 自身行为，未在本仓库定制；如果网关支持并发（vLLM `--max-num-seqs > 1`），建议保持开启。

## 20.45 面板：KPI 数据时间范围、树视图本层过滤、概览带时间范围（v0.2.6 起）

- KPI 增加「时间范围」：`view.timeRange` 存在时显示 `YYYY-MM-DD ~ YYYY-MM-DD`（真实案件实测 `2016-12-11 ~ 2025-05-16`），避免研判时为了看时间跨度去翻树根标题或跑 `timeline`。
- 树视图本层过滤：`Panel` 新增 `treeFilter` 状态，`drill`/`goCrumb` 切换节点时清空；`children.length > 1` 时在节点列表上方渲染输入框（`data-seeu-tree-filter` 供 e2e 定位），按 `labelOf(c)` 做大小写无关子串过滤，右侧显示「显示 X/Y」或「本层 N 项」，过滤后为空渲染「本层没有匹配的节点」，有过滤条件时给【清空】。
- 案件概览导出加 `- 数据时间范围：…` 一行（`export-check` 新增 `hasRange` 断言并纳入 `ok`）。
- 验证：`m2-ui-check` 新增 `kpiRange`（KPI 文本含「时间范围」+ `\d{4}-\d{2}-\d{2} ~ …`）、`treeFilterVisible`/`treeFilterEmpty`/`treeFilterOk`（检材 3 下 8 个应用节点，输入 `zzzz-no-match` 出现空匹配文案，清空后行数恢复 8）→ 实测 `kpiRange:true, treeFilterVisible:true, treeFilterOk:true, treeRowsBefore/After:8/8, m2ok:true, errors:[]`；`export-check` 覆盖 `hasRange`；`npm test` 45/45。
- 遗留：树过滤只作用于已加载的当前层，跨层搜索仍用「检索」标签；过滤不做拼音/模糊匹配。

## 20.46 应用/类别下拉（/facets）——检索与记录视图不再手输应用名（v0.2.6 起）

- 问题：检索与记录视图的「应用」「类别」是手输框，用户得记住索引里的应用拼写（WhatsApp / 微信 / 苹果健康…），本地小模型也常拼错；而索引里 `record.app/category` 是现成的枚举。
- 实现：`tools/ges-index/query.mjs` 新增 `facets(db, opts)` → `{eid, apps:[{app,n}], categories:[{category,n}], accounts:[{account,n}]}`（`group by` + 记录数倒序，各取 60/60/40 条，空值过滤；`eid` 可选缩小到单个检材）；插件新增 `GET /facets?db=&eid=`；面板 `Panel` 与 `RecordsView` 各自 `useEffect` 取 facets，检索「应用」、记录「应用」「类别」改成 `<select>`（选项文案 `应用（记录数）`，首个选项「全部应用/全部类别」）。
- 验证：`m2-ui-check` 新增 `searchAppOptions`（检索视图应用下拉选项数，实测 **9**）、`searchAppSelect`、`recordsAppPick`/`recordsAppCount`/`recordsAppFilterOk`（记录视图选「苹果健康」→ 记录从 22,777 → **3,028**，仍 >0）→ `{"searchAppOptions":9,"searchAppSelect":true,"recordsAppPick":"苹果健康","recordsAppCount":3028,"recordsAppFilterOk":true,"m2ok":true,"errors":[]}`；`npm test` 48/48（新增 `tests/facets.test.mjs` 3 例：分组计数/首项最大/eid 过滤/空库）；`check:overlay` OK。
- 遗留：facets 只列 top N（60/60/40），极少数低频应用不在下拉里；需要时仍可用 CLI/API 传精确值。（时间线视图的筛选已在 §20.47 改为下拉。）

## 20.47 时间线视图筛选也改下拉（v0.2.6 起）

- 上一轮把检索/记录的应用、类别改成下拉后，时间线视图还留着「检材号 eid」「应用 app」两个手输框，同一件事两套交互。
- 实现：`TimelineView` 自己拉 `/evidences` 与 `/facets`（`useEffect` 依赖 `db`，卸载标记 alive），两个 `narrowInput` 换成 `<select>`：检材选项「检材 N · 名称」、应用选项「应用（记录数）」，保留 Enter 触发、`disabled: !db`。**坑**：`TimelineView` 是独立组件（不在 `Panel` 作用域里），直接引用 `Panel` 的 `evList` / `facets` 会抛 `ReferenceError: evList is not defined`，运行时表现为「slot entry crashed in main」，必须组件内自取。
- e2e：`m2-ui-check` 在切到时间线后采样 `timelineFilterOptions`（找含检材名选项的 select 与含「（数字）」选项的 select）→ 实测 `{"ev":6,"app":9}`、`timelineFiltersOk:true`，并纳入 `m2ok`。
- 验证：`m2ok:true`、`errors:[]`；`npm test` 48/48；`check:overlay` OK；`node scripts/build.mjs` 通过。

## 20.48 实体视图分页（v0.2.6 起）

- 问题：实体视图只显示聚合 top 30（本案 3999 条聚合、8191 个实体），后面的实体在界面上完全看不到，`复制实体清单` 也只能复制前 30 条。
- 后端：`tools/ges-index/query.mjs` 的 `entity()` 在无关键词的聚合分支加 `offset`（`limit ? offset ?`）、`total`（`select count(*) c from (select 1 from entity${where} group by kind, value_norm)`）与 `next`；带 `q` 的下钻/唯一命中分支不变。
- 前端：`EntityView` 加 `offset` 状态（`apply`/`clear`/`drill`/`pickKind` 都重置为 0），`useLoad` 依赖 `[db, applied, offset]`；聚合行下方显示「共 N 条聚合 · 当前 a-b」+【上一页】【下一页】+「第 K 页 · 点类别可下钻」。
- e2e：`m2-ui-check` 在实体标签页读「共 N 条聚合 · 当前 a-b」，点【下一页】后比较正文变化 → 实测 `{"entityPager":["共 3999 条聚合 · 当前 1-30","3999","1","30"],"entityTotal":3999,"entityNextClick":true,"entityPagingOk":true,"m2ok":true,"errors":[]}`，`entityPagingOk` 纳入 `m2ok`。
- 单测：新增 `tests/entity-paging.test.mjs` 2 例（12 个值按 limit 5 翻三页，`total/offset/next` 正确且页间不重叠；`kind` 过滤后 `total` 只算该类别）→ `npm test` 50/50。

## 20.49 实体视图检材筛选改下拉（v0.2.6 起）

- 实体视图的「检材号 eid」原本还是手输框（kind 有类别 chip、关键词可搜），补成下拉后面板里四个视图（检索/记录/时间线/实体）的检材筛选全部是「选名称」而不是「记 eid」。
- 实现：`EntityView` 内加 `evList` 状态 + `useEffect`（依赖 `db`，`api('/evidences', { db })`，失败置空），`narrowInput` 换成 `<select>`（「全部检材」+「检材 N · 名称」）；选项变化时同时重置 `offset` 并立即 `setApplied`，不用再点【查询】。
- e2e：`m2-ui-check` 在实体页采样含检材名选项的 select → `"entityEvOptions":6`、`"entityEvSelectOk":true`，并入 `m2ok`；完整结果 `{"entityEvOptions":6,"entityEvSelectOk":true,"entityPagingOk":true,"m2ok":true,"errors":[]}`。
- 回归：`npm test` 50/50、`check:overlay` OK、`node scripts/build.mjs` 通过。

## 20.50 跨案视图双案件端到端（v0.2.6 起）

- 遗留问题：§20.23 起就写着「跨案导出未在双案夹具下跑 e2e」，而外壳 / 跨案中央库、`/cross/sync`、重合实体导出这几块一直是手工点过、没有回归保护。
- 夹具做法：把真实案件库（`E:\forensics\W盘_2919d298-…\.seeu-index\case-index.db`）复制到 `.dev/cross/案件甲_2919` 与 `.dev/cross/案件乙_77aa`，用 `node:sqlite` 改 `meta`/`case_info` 的 `case_number`（`cross-fixture-a` / `cross-fixture-b`）与 `case_name`（跨案夹具A/B）——`syncCase()` 以 `case_number` 为幂等键，同案号会被覆盖，必须改成两个案号才会出现「2 案」。
- 目录注入：`src/host.ts:204-208` 会用 `<DSH_HOME>/index-state.json` 的 `dirs` 拼 `SEEU_INDEX_SEARCH_DIRS`，所以 e2e 把两个夹具目录写进隔离 home 的 `index-state.json`，不依赖面板手工输入；跨案库路径由 `SEEU_WORKSPACE` 决定（`<workspace>/indexes/crosscase.db`），夹具根目录同时作为 workspace。
- 新脚本 `scripts/e2e/cross-case-check.mjs`（`npm run test:e2e:cross`，端口 `SEEU_CROSS_E2E_PORT` 默认 9384）：扫描 → 切「跨案」→【同步全部案件】→ 等「同步完成：…」→ 断言两案在案件清单里、Top 有 30 条 →【复制重合实体清单】→ `powershell Get-Clipboard -Raw` 读回校验抬头/`2 案`/两个案号/实体类型。实测 `{"ok":true,"syncNote":"同步完成：扫描索引 2 个，处理 2 案（新增 0、更新 2）；现共 2 案。","copyNote":"已复制 30 条重合实体清单（2675 字符）","clipboard":{"len":2677,"hasHeader":true,"hasTwoCases":true,"hasCaseNumbers":true,"hasKinds":true},"errors":[]}`。
- 顺带修两个真问题：① `doSync()` 成功后只 `list.reload()`，重合实体 Top 不重拉，用户同步完看到的还是同步前的空列表（e2e 第一次就是 `copyClicked:false` 暴露的）；现在同步后一并 `top.reload()`，已查过的实体也重拉。② `topShared()` 的行里没有案件号，导出清单的「案件：」行永远不出现；SQL 加 `group_concat(distinct case_number) caseNumbers`，导出时按 `r.cases`（旧结构）或 `r.caseNumbers`（新结构）回退。
- 回归：`npm test` 50/50、`m2-ui-check` `m2ok:true / errors:[]`、`check:overlay` OK、`node scripts/build.mjs` 通过。

## 20.51 v0.2.6 打包与打包态回归（v0.2.6）

- 背景：v0.2.5（`00b8496`）之后累积了 8 个提交（记录筛选 `c0e1303`、流式用量 `d099fb0`、外壳浅色 `f0e442c`、标题生成开关 `14eaa26`、KPI/树过滤/概览时间范围 `8289b73`、应用/类别下拉 `143a190`、时间线下拉 `9af9afd`、实体分页与检材下拉 `9d4ee9c`+`aaa4ff0`、跨案双案件 e2e `9b3a509`），决定直接打 0.2.6，不再等用户逐项确认。
- 打包：`npm version 0.2.6 --no-git-tag-version`；`node scripts/build.mjs`、`check:overlay`、`npm test`(50/50) 全绿；`npx electron-builder --win --x64 -c.directories.output=release-026`（后台 job，约 12 分钟，无证书跳过签名），产物再搬进 `release/` 并删 0.2.5 三件（保留 0.1.7 portable）。
- 产物：exe 246,329,856 B；`app.asar` 168,796,171 B（19,647 entries）；NSIS 211,934,094 B（blockmap 220,737）；portable 189,542,424 B；`release/win-unpacked` 总计 803,628,886 B。
- asar 自检（`.probe/asar-026-check.mjs`）：条目 19,647、15 个必需路径 `missing:[]`；代码抽查 `facets`/实体分页/跨案清单/时间线下拉/`/brief`/树过滤/KPI 时间范围/欢迎页两 chip/设置页 `btn-warmup`+`titleGen`+`usageInStreaming` 全 true。
- 启动：目录版 4,083 ms、portable 51,560 ms（`SEEU_DEV_MULTI=1`，不跑 `scripts/kill-app.mjs`）。
- 打包态 e2e 全绿：面板 `m2-ui-check`（`recordsFilterOk`/`recordsAppFilterOk`/`entityPagingOk`/`entityEvSelectOk`/`timelineFiltersOk`/`briefVisible`/`treeFilterOk`/`kpiRange`，`m2ok:true`）；设置页 `settings-check`（`titleGen*`、`usage*`、`warmupOk`、`pulledContextWindow:32768`、`probeMismatch`、`lightShell`）；导出 `export-check`（概览 718 且 `hasRange`、记录 14,996/实体 1,888/表 7,025/时间线 3,235 字符）；跨案 `cross-case-check`（2 案、30 条重合实体、清单 2,675 字符含两案号）。
- 坑：`SEEU_UI_EXE` 必须传 Windows 路径（`D:/...`），MSYS 的 `$PWD`（`/d/...`）会让 `spawn` 报 ENOENT；打包日志里 `duplicate dependency references` 巨量列表是 electron-builder 正常输出。
- 文档：README §2 产物表换 0.2.6 + 「### v0.2.6 改了什么」收尾（50 单测 / 16 个 e2e）；`docs/packaging.md` 追加「### v0.2.6 回归验证」；本节即打包记录。预览仍在线，等用户视觉验收 + 真实网关联调。

## 20.52 记录视图导出 CSV（v0.2.7 起，未打包）

- 动机：面板里「复制引用清单」给的是 Markdown（适合粘报告），但研判时经常要在 Excel 里排序、透视、按检材分表；此前只能整库拿去 SQLite 里查。
- 后端：
  - 新文件 `tools/ges-index/csv.mjs`：`RECORD_CSV_HEADER`（检材号/检材名称/应用/账号/类别/子类/时间/行号/记录ID/摘要）、`csvCell()`（逗号/引号/换行按 RFC 4180 加引号并双写引号，null → 空）、`csvLine()`、`recordsCsv(rows,{bom,header})`（默认 UTF-8 BOM + CRLF，Excel 双击打开不乱码）；
  - `tests/csv.test.mjs` 4 例（转义规则、行映射、BOM 开关、空表只有表头）；
  - 插件新增 `GET /seeu-index/export/records.csv`：参数与 `/records` 一致（`eid/app/account/category/artifact/from/to/q`，另加 `max`），内部按 100 行/页循环取满（默认与上限 20000），响应 `text/csv; charset=utf-8` + `content-disposition` + `x-seeu-rows`/`x-seeu-total`/`x-seeu-truncated`。
- 外壳：`src/main.ts` 新增 IPC `seeu:file:save-export`（`{name,text}` → 落盘到 `SEEU_EXPORT_DIR` 或 `<下载>/seeu-exports`，文件名去掉 `\/:*?"<>|` 并截 120 字符，返回 `{ok,path,bytes}`）；`src/preload.ts` 暴露 `window.seeu.saveExport(name,text)`。
- 面板：`RecordsView` 头部多【导出 CSV】：按当前 `applied` 筛选拼 query → `fetch` 取 CSV → 有 Electron 桥就落盘并在下方显示「已导出 N 行（共 M 条，单次最多 20000 行）到 <路径>」，web 预览（无桥）回退成 `Blob` + `<a download>`。
- 坑：**`fetch` 的 `Response.text()` 会吃掉 BOM**（`TextDecoder` 默认忽略 BOM），第一版实测 `csvFile.bom:false`、Excel 打开中文可能乱码；在客户端保存前补回 `'\uFEFF'` 前缀即修复（实测 4,608,566 B、`bom:true`、20,000 行）。
- 验证：`npm test` **54/54**；`export-check`（`.dev/exports` 隔离目录，`SEEU_EXPORT_E2E_PORT=9412`）`{"ok":true,"csvClicked":true,"csvNote":"已导出 20000 行（共 22777 条，单次最多 20000 行）…","csvFile":{"bytes":4608566,"bom":true,"hasHeader":true,"dataLines":20000,"hasTs":true},"errors":[]}`，其余导出步骤（概览 718 / 记录 14,996 / 实体 1,888 / 表 7,025 / 时间线 3,235 字符）不变；`m2-ui-check` `m2ok:true / errors:[]`。
- 遗留：CSV 覆盖记录视图与 typed 表（时间线/跨案仍是 Markdown 清单）；20000 行是硬上限（22,777 条会被截断并提示，需要全量可调 `max` 或改 SQLite 直查）；时间列按索引里的字符串原样输出，不换算时区。

## 20.53 表视图导出 CSV（v0.2.7 起，未打包）

- 动机：typed 表（联系人/短信/通话/账号…）是研判最常用的结构化数据，之前只能一页 20 行看、复制当前页引用清单；要拿全表只能去 SQLite。
- `tools/ges-index/csv.mjs` 加 `genericCsv(columns, rows)`：按给定列做表头、按列名取值（缺列写空），同样 BOM+CRLF；`tests/csv.test.mjs` +1 例 → **55/55**。
- 插件新增 `GET /seeu-index/export/table.csv`：`db/name` 必填（name 未知时 `table()` 抛 `E_BAD_TABLE`），支持 `eid/app/account/subcat/from/to/q/max`，内部按 200 行/页循环（`table()` 的 limit 上限就是 200），响应头与记录 CSV 一致。
- 面板：`TablesView` 头部多【导出 CSV】（与「复制本页引用清单」并排），走模块级 `saveCsvText()`（Electron 桥落盘 / web 下载），文件名 `表导出-<表名>-<时间戳>.csv`，下方提示「已导出 N 行…」。
- 验证：`export-check` 新增步骤（`SEEU_EXPORT_E2E_PORT=9413`）→ `{"ok":true,"csvTableClicked":true,"csvTableNote":"已导出 745 行到 …","csvTableFile":{"bytes":143621,"bom":true,"hasHeader":true,"dataLines":745},"errors":[]}`；记录 CSV 与其余导出断言不变。
- 遗留：表 CSV 只导当前表（不做多表合一个文件）；`record_id` 为空的汇总行也照样导出（Excel 里自己筛）。

## 20.54 v0.2.7 打包与打包态回归（v0.2.7）

- 背景：v0.2.6（`44808cb`）之后两个提交（`e0677b5` 记录 CSV、`7d513ff` 表 CSV），这次直接打 0.2.7。
- 打包：`npm version 0.2.7 --no-git-tag-version`；`node scripts/build.mjs`、`check:overlay`、`npm test`(55/55) 全绿；`npx electron-builder --win --x64 -c.directories.output=release-027`（后台 job `bash-56e8ea2697e24c47`，约 14 分钟），产物搬进 `release/` 并删 0.2.6 三件。
- 产物：exe 246,329,856 B；`app.asar` 168,807,728 B（19,648 entries，多了 `tools/ges-index/csv.mjs`）；NSIS 211,936,354 B（blockmap 220,843）；portable 189,590,954 B；`release/win-unpacked` 803,640,443 B。
- asar 自检 `.probe/asar-027-check.mjs`：16 个必需路径 `missing:[]`，16 项代码抽查全 true（新增两个 CSV 路由、preload 的 `save-export`、两个导出按钮）。
- 启动：目录版 4,150 ms、portable 47,614 ms（`SEEU_DEV_MULTI=1`）。
- 打包态 e2e 全绿：面板 `m2-ui-check`（`m2ok:true`，筛选/分页/时间线/会话语境/树过滤/KPI 全 true）；导出 `export-check`（记录 CSV 20,000 行 4,608,566 B BOM 正常、表 CSV 745 行 143,621 B；概览/记录/时间线清单不变）；设置页 `settings-check`（精简预设、开销估算、网关自报窗口、预热、标题开关、浅色）；跨案 `cross-case-check`（2 案、30 条重合实体）。
- 坑与上轮相同：`SEEU_UI_EXE` 必须 Windows 路径；`SEEU_DEV_MULTI=1` 不能漏（否则被用户实例的单实例锁挡住、拿不到页面）。
- 文档：README §2 产物表换 0.2.7 + 「### v0.2.7 改了什么」；`docs/packaging.md` 追加本节对应内容；预览重启后 token 变化，等用户视觉验收 + 真实网关。

---

## 20.55 检索结果导出 CSV（v0.2.8，未打包）

- 动机：检索视图此前只能【复制引用清单】（Markdown，逐条回查句柄）与【导出全部 N 条】，要把命中丢进表格排序/统计还得自己粘；记录/表视图在 v0.2.7 已有 CSV，检索视图缺一条。
- 实现（只改 `plugins/seeu-case-index/client.js`，复用 v0.2.7 的 `saveCsvText`）：
  - `Panel` 内新增 `exportSearchCsv()`：以当前 `result.query` + `filters`（`eid/app/from/to`）为条件，从已返回的首页结果起按 `limit:200` 翻页取满，上限 20000 行；
  - 列与记录 CSV 同构：`检材号,检材名称,应用,账号,类别,时间,行号,记录ID,摘要`（检材名用 `evLabel()` 换成火眼里的名字，摘要压掉换行）；
  - 客户端按 RFC 4180 转义（逗号/引号/换行加引号并双写），文本前补 `\uFEFF`、行尾 CRLF（`fetch().text()` 会吃 BOM，必须在客户端补）；文件名 `检索导出-<UTC时间戳>.csv`；
  - 成功后提示「已导出 N 行（共 M 条，单次最多 20000 行）：<路径>」；web 预览（无 Electron 桥）回退浏览器下载；
  - 结果头部按钮：`复制引用清单` / `导出全部 N 条` / `导出 CSV`。
- 验证：`npm run test:e2e:search`（真实案件库，关键词「加密」→ 筛检材 3 得 12 条 → 点【导出 CSV】→ 用 `readdirSync/readFileSync` 读回落盘文件）→ `"csvClicked":true,"csvNote":"已导出 12 行","csvRows":12,"csvFile":{"bytes":2961,"bom":true,"hasHeader":true,"dataLines":12,"hasTs":true}`，`ok:true`；`m2-ui-check` `m2ok:true / errors:[]`；`npm test` 55/55；`check:overlay` OK。
- 遗留：CSV 从 `result.query` 取关键词，若用户改了输入框但没点检索，导出仍是上次检索的条件（与复制清单一致）；20000 行上限写死，未做成配置项。

---

## 20.56 验收清单与界面截图（v0.2.8 起）

- 动机：目标里的「dev 预览验收」一直卡在用户侧（多轮未回），与其继续堆功能，不如把「该看什么、怎么试、发现问题怎么说」写成 10 分钟能走完的清单，并附真实案件库的界面截图。
- 新增 `scripts/e2e/acceptance-shots.mjs`（`npm run test:e2e:shots`）：拉起 Electron 外壳（开发态或 `SEEU_UI_EXE` 打包态）→ 载入真实案件库（`localStorage.seeu.indexDir` 种入后 reload）→ 依次截欢迎页、面板树、检索（输「加密」回车）、记录、时间线、浅色面板，存 `docs/screenshots/`；设置页截图由 `settings-check.mjs --out docs/screenshots/07-settings.png` 生成；会话区深浅色两张复用 `theme-conv-check` 的产物。
- 实测：`REPORT {"ok":true,"shots":[6 张],"errors":[],"panelText":true,"searchTyped":"typed-enter","searchRows":"共 41 条","searchHit":"20 命中","rowCount":21,"lightBodyBg":"rgb(245, 247, 250)"}`；`settings-check` 同时产出 `07-settings.png` 且全绿。
- `docs/acceptance.md`：截图表（每张写明该看什么）+ 六步动手验收（启动/欢迎页/面板/导出 CSV/设置页/深浅色）+ 真机联调需要用户提供的信息（baseURL、模型 id、apiKey、并发/窗口）+ 已自动验证项 + 已知限制。
- README §2 加验收清单链接；`package.json` 加 `test:e2e:shots`（e2e 脚本 16 → 17 个）。
- 遗留：截图是 1280×800 窗口的整屏图，不含缩放比例差异；浅色面板截图靠去 `data-ds-dark-theme` 模拟，与 Windows 系统切换的下次重启路径等价。

---

## 20.57 真机网关联调（deepseek-flash）+ 记录数口径修复

- 背景：目标里的「本地模型真机联调」多轮缺少输入；用户 m09759 给出 `http://10.10.250.120:8080/v1`、模型 `deepseek-flash`、apiKey（只走环境变量 `SEEU_LOCAL_LLM_API_KEY`，不落仓库）。恢复 goal 后先做协议探针，再做端到端。
- 协议探针（`.probe/real-gw-probe.mjs`、`.probe/real-gw-probe2.mjs`，gitignored）：
  - `/v1/models` 200 / 117 ms，ids `deepseek-flash` / `qwen3.8-flash-next`，条目只有 id 类字段 → `modelContextWindow()` 取不到窗口；
  - 非流式 2.6 s / usage `{37,4,41}`；流式首字节 86 ms、纯文本 4.3 s / 105 分片 / ≈17 tok/s、usage `{47,247,294}`；
  - **推理模型**：delta 先 `reasoning_content`（镜像 `reasoning`）再 `content`；`max_tokens` 太小时正文为空；
  - 流式工具调用 1.75 s（`case_evidences {"eid":3}`）、并行工具调用 1.61 s（2 个 call）；`include_usage` 有效。
- 桌面 UI 驱动该网关两次失败（脚本已删，教训保留）：① 用「页面文本含 检材」当回复信号 → 命中静态文案，43 ms 假成功；② `[data-composer-input]` 偶发查不到（DOM 里连 `textarea/contenteditable` 都没有），随后 `Runtime.evaluate` 永挂。结论：真机联调用 headless + 与外壳相同的 overlay，不再赌 CDP 的输入时序。
- 真机 headless e2e：新增 `scripts/e2e/real-gateway-headless.mjs`（`npm run test:e2e:real-gateway`，凭据 `GW_BASE/GW_KEY/GW_MODEL`），用 `dsh --profile headless --patch ` + 取证 overlay + `.dev/real-ud/local-model.patch.yml`，解析 JSON 事件流；`cwd` 用 `tmpdir()/seeu-real-work`（**工作区放仓库里会触发沙箱 `SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\\Coding\\...)`**，命令执行前就失败）。
- 实测 `REPORT {"ok":true,...}`：
  - 问题轮：`elapsedMs:24004, firstTextMs:23803, thinkingSeen:true, firstStepInputTokens:9145, totalTokens:9607`，`briefUsed` 5 个检材名全中，回答声明「取自概览表格，未做推断」；
  - 工具轮：`pwsh node -v` → `resultStatus:"completed"`、`answer:"v24.18.0"`，30,779 ms。
- 顺带修两处：
  - **网关不自报窗口**：`tools/local-model.mjs` 加 `gatewayContextReported()`；`src/main.ts` 探测状态加 `noContextWindow`（`probe.ok && ids.length>0 && !gatewayContextReported(probe.models)`）并写 shell log；`renderer/local-model.html` 黄字提示「按表单里的 128k 使用；模型实际窗口更小会报 400，请按模型文档手填」。单测 +1（56/56），`settings-check` 断言「自报窗口的网关不得标记」。
  - **记录数口径**：会话概览「规模：记录 22777 条」与表内各行相加不一致（模型当场指出）。根因是 `evidences()` 取火眼 `evidence.record_count`（3065/3/13718/68/25669）。改为按索引内 `record` 行数统计（1/1/8443/1/14331，合计 22,777），火眼原值保留为 `reportedRecordCount`；`briefText()` 表格下加注「记录数按本索引实际解析入库的行数统计…各检材之和等于记录总数」。
- 验证：`npm test` 56/56、`node scripts/build.mjs` OK、`settings-check`（dev mock）`ok:true`（`probeNoContextWindow:false`、`probeMismatch{131072,32768}`、`warmupOk` 等全绿）。
- 遗留：真机只有 `deepseek-flash` 一个模型跑过（`qwen3.8-flash-next` 未测）；推理模型的首字 23.8 s 主要是模型侧推理，外壳只能靠「精简预设 + 概览注入 + 可关标题生成」压输入；`noContextWindow` 目前只在设置页提示，未按模型 id 预置窗口表。

---

## 20.58 集成本机 LovelyMem / LovelySpark CLI（合并 Gitea 分支 `feat/local-lovely-cli`）

- 来源：Gitea 上他人分支 `feat/local-lovely-cli`（4 个提交：`820d402` 接入、`6c499f0` 原生验证文档、`b1f6b9d` Luxe/V3 兼容说明、`0b331a0` 自动发现），与 main 无冲突合并（`git merge origin/feat/local-lovely-cli`，main 侧 `e822eb5`… 后续全部提交保留）。
- 功能：新增 `tools/lovely-cli/cli.mjs`（纯 Node 薄层：原生 argv、`--cli` 前缀、磁盘输出、有界预览）与 `discovery.mjs`（环境变量 → 配置 → PATH → 本机缓存 → 注册表/运行进程/快捷方式 → 常见目录，最多 5 层 3000 目录 2 秒）；两个新技能 `resources/forensics/skills/lovelymem-cli/SKILL.md`、`lovelyspark-cli/SKILL.md`（按需加载，不增加工具 schema）；`src/host.ts` 注入 `SEEU_LOVELY_CLI` / `SEEU_CLI_NODE` / `SEEU_LOVELY_CONFIG`，`src/paths.ts` 的 `lovelyCliEntry()` 兼容 `app.asar.unpacked`；`electron-builder.yml` 把两个 `.mjs` 同时放入 `files` 与 `asarUnpack`；`scripts/dev-web.mjs` 提供同样的开发态环境；`.gitignore` 加 `lovely-runs/`。
- 本机真实验证：
  - `npm run lovely -- status` 通过快捷方式发现 `E:\CTFTools\Forensics\...\Lovelymem\lovelymem.v3.exe` 与 `E:\CTFTools\Misc\综合工具箱\lovelyspark.exe`；
  - 包装器实跑：`lovelymem -- version` → `{"ok":true,"status":"completed","application":"Lovelymem","version":"3.1.11","engines":["starmem","vol3"]}`（10.0 s）；`lovelyspark -- --version` → `lovelyspark 0.3.20`（12.5 s）；产物落 `<工作区>/lovely-runs/<tool>-<uuid>/`（request.json/stdout.txt/stderr.txt/result.json）。
  - 坑：MSYS 下传 `SEEU_WORKSPACE="$PWD/..."` 会得到 `D:\d\Coding\...`（`$PWD` 是 `/d/...`），本机验证时用 Windows 路径；应用内由 `src/host.ts` 直接传 Windows 路径，不受影响。
- 回归：`npm run test:lovely` **23/23**（含 `host → dsh 环境过滤 → shell → CLI` 的 dev/asar 两种模式）；`npm test` **80/80**；`node scripts/build.mjs` OK；`npm run check:overlay` OK。
- 文档：`docs/lovely-cli.md`（分支自带，含发现顺序/缓存/失败处理）；README §2 顶部加接入说明、v0.2.8 段加本项与测试数。
- 遗留：本机未做真实内存镜像分析（`doctor`/`plugins` 会拉起 V3 进程，耗时与授权取决于本机），只验证到 `version`；Luxe 2.5.0 的 `--cli` 会启动 GUI，不视为 V3 兼容；模型侧「按技能主动调用」只验证了技能文件落盘与 shell 环境，未跑真实模型会话（留给下次真机联调）。

---

## 20.59 v0.2.8 打包与打包态回归

- 版本：`npm version 0.2.8 --no-git-tag-version`（`package.json`、`package-lock.json` 顶层与 `packages[""].version`）；`node scripts/build.mjs`、`npm run check:overlay`、`npm test`（80/80）全绿后打包。
- 打包：`npx electron-builder --win --x64 -c.directories.output=release-028`（后台 job `bash-17ec5ffd47244c84`，exit 0，约 12 分钟，无证书跳过签名）；产物搬进 `release/` 并删 0.2.7 三件（保留用户可能在跑的 0.1.7 portable），`release-028` 删除。
- 产物：`release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B；`resources/app.asar` **168,818,135 B（19,655 entries）**；NSIS **211,947,042 B**（blockmap 220,668 B）；portable **189,582,714 B**；`release/win-unpacked` 总计 803,669,553 B。
- asar 自检脚本 `.probe/asar-028-check.mjs`（在 027 版基础上加 lovely 路径与检查、`reportedRecordCount`、`briefCountNote`、`searchCsvButton`）：`{"entries":19655,"missing":[],"checks":{22 项全 true}}`；`client.js` 117,405 B、`index.js` 19,011 B、`query.js` 28,331 B。
- 打包版 lovely CLI 实跑：`node release/win-unpacked/resources/app.asar.unpacked/tools/lovely-cli/cli.mjs status` 通过缓存发现 `lovelymem.v3.exe` 与 `lovelyspark.exe`（`found:true`），说明 `asarUnpack` 与 `src/paths.ts` 的 `lovelyCliEntry()` 在打包态成立。
- 启动验证（`SEEU_DEV_MULTI=1`、不跑 `scripts/kill-app.mjs`）：目录版 `--port 9441` → `"ok":true,"elapsedMs":5130`；portable `--port 9442 --timeout 240000` → `"ok":true,"elapsedMs":36459`。
- 打包态 e2e：`m2-ui-check` `m2ok:true / errors:[]`（检索/记录/实体/时间线/会话概览/树过滤/KPI 全绿）；`settings-check` `ok:true`（`probeNoContextWindow:false`、`warmupOk`、`titleGenDefault/usagePreview/lightShell` 全 true）；`export-check` `ok:true`（概览 713 字符含时间范围、记录 CSV 20,000 行、表 CSV 745 行、时间线 3,235 字符）；`cross-case-check` `ok:true`（双案同步、30 条重合实体清单 2,675 字符）。
- 文档：README §2 产物表换 v0.2.8 + 「### v0.2.8 改了什么」；`docs/packaging.md` 追加「### v0.2.8 回归验证」；本节。
- 遗留：真机仍只有 `deepseek-flash` 一个模型跑过（`qwen3.8-flash-next` 未测）；推理模型首字约 21–24 s 属模型侧思考；Lovely 未做真实镜像分析会话（只验证到 `version`/发现）；等用户视觉验收。

---

## 20.60 真机网关桌面 UI 联调（CDP 驱动 + 截图）

- 目标：v0.2.8 只做了 headless 真机验证；补一条「真 Electron 窗口 + 真网关」的端到端，证明思考块/正文在桌面 UI 里正常渲染，而不是只在 JSON 事件里。
- 新增 `scripts/e2e/real-gateway-ui.mjs`（`npm run test:e2e:real-gateway-ui`，凭据 `GW_BASE/GW_KEY/GW_MODEL` 只走环境变量）：
  - 写 `<SEEU_DSH_HOME>/index-state.json` = `{"dirs":[CASE_DIR]}`，让案件概览注入 `AGENTS.md`；
  - `SEEU_LOCAL_MODEL_JSON` 注入真实配置（`contextWindow` 默认 131072、`maxTokens` 8192、`litePreset`、`usageInStreaming`、`titleGeneration:false`、`timeoutSec` 300、`streamIdleSec` 120）；
  - 沿用 `theme-conv-check` 的 composer 驱动：关「继续」提示卡 → `[contenteditable]` 聚焦 + `Input.insertText` + Enter；问题为「不要调用任何工具，直接根据系统提示里已有的「案件概览」回答…」；
  - 轮询 body 文本：记录思考块出现时间、首段正文时间、5 个检材名是否齐全；`Page.captureScreenshot` 写 `docs/screenshots/10-real-gateway-chat.png`。
- 实测 `REPORT {"ok":true,"thinkingSeen":true,"firstSignalMs":10123,"firstTextMs":12168,"totalMs":13173,"names":[5 个检材名],"namesOk":true}`：思考块 10.1 s、正文 12.2 s、13.2 s 全部收齐；界面出现「思考」折叠块与「深度求索中，用时 12 秒」。
- 踩坑：第一版把 `GW_BASE`（`…/v1`）再拼一次 `/v1` → 网关 `404 page not found`，UI 显示「处理失败 · PI_AI_ERROR」；已在脚本里 `replace(/\/v1$/i,'').replace(/\/+$/,'') + '/v1'` 归一化。另：类型断言用 `innerText.slice(0,40)` 会截掉关键字导致误判失败，已放宽到 120 字符。
- 遗留：桌面 UI 这条只测「问答」不测工具轮（工具链路由 headless e2e 覆盖）；仍只有一个模型（`deepseek-flash`）跑过真机。

---

## 20.61 技能链路真机验证（headless 第三轮）

- 目标：补 20.58 遗留的最后一条——「模型按技能主动调用本机 CLI」只验证过技能文件落盘与 shell 环境，没跑过真实模型会话。
- 做法：给 `scripts/e2e/real-gateway-headless.mjs` 加可选第三轮（`SEEU_REAL_SKILL=1`）：提示「使用 lovelymem-cli 技能，执行它的 version 子命令…」，断言 `skillLoaded`（出现 `skill` 工具调用且参数为 `lovelymem-cli`）、`wrapperUsed`（pwsh 命令里含 `lovely-cli` 或 `SEEU_LOVELY_CLI`）、`versionSeen`（回答含 `3.1.11` 或 `Lovelymem`），并纳入 `report.ok`。
- 第一次跑直接失败：模型说「技能 `lovelymem-cli` 在本会话不可用」，转而自己去 `E:\CTFTools\...` 里翻 exe。根因是 headless 与外壳的环境差异：外壳启动前 `installBundledSkills()` 会把 `resources/forensics/skills/**` 复制到 `<DSH_HOME>/skills`，并向 dsh 子进程注入 `SEEU_CLI_NODE`/`SEEU_LOVELY_CLI`；headless 脚本两件事都没做，所以技能根为空、技能内的 `& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI …` 也没有变量。
- 修复：脚本启动时 `cpSync(join(root,'resources','forensics','skills'), join(home,'skills'), {recursive:true,force:true})`；spawn env 补 `SEEU_CLI_NODE: process.execPath`、`SEEU_LOVELY_CLI: join(root,'tools','lovely-cli','cli.mjs')`、`SEEU_LOVELY_CONFIG: join(home,'lovely-cli.json')`。
- 第二次跑：技能加载成功、命令也对，但包装器报「找不到 lovelymem CLI」，`status` 里 `found:false`。原因：headless 子进程里 `discovery.mjs` 的 PowerShell 探测（注册表/卸载项/进程/快捷方式，6 s 超时）在高负载下超时返回空；随后常见目录搜索限 5 层/1 s，够不到 `E:\CTFTools\Forensics\1-ComputerAnalysis\3-MemAnalysis\Lovelymem\`。这个目录本就在自动发现覆盖范围内，只是这一轮没算完。
- 修复：脚本支持 `GW_LOVELYMEM_EXE='E:\...\lovelymem.v3.exe'`，非空时注入 `SEEU_LOVELYMEM_EXE`（`cli.mjs` 的显式覆盖优先级最高）。重新跑：`skill.elapsedMs:51755`、`skillLoaded:true`、`wrapperUsed:true`、`lovelyExe` 已回显，回答 `Lovelymem / 3.1.11 / starmem、vol3`，只有 2 次工具调用（`skill` + 1 次 `pwsh`），没有再去翻盘。
- 顺带修：`wrapperUsed` 原先只匹配 `lovely-cli` 字面量，而模型用的是 `$env:SEEU_LOVELY_CLI`，会误报 false；改成两条都认。
- 回归：`npm test` 80/80、`npm run check:overlay` OK；本轮只动 e2e 脚本与文档，未改产品代码，无需重新打包。
- 遗留：真实内存镜像分析（`doctor`/`plugins`/`run`）仍未跑，取决于本机 V3 授权与耗时；`qwen3.8-flash-next` 仍未做真机会话；`GW_LOVELYMEM_EXE` 属机器相关参数，换机器要么靠自动发现、要么显式给路径。

---

## 20.62 本机取证工具路径改为手动指定（删除自动发现）

- 用户要求（本轮指令）：「手动在 dsh 界面里指定两款工具路径就行，别做自动发现」。原实现（20.58 合并的 `feat/local-lovely-cli`）依赖 `discovery.mjs` 在 PATH / 注册表 / 已运行进程 / 快捷方式 / 常见目录里找 exe，机器换了或安装位置特殊时行为不可预期，也不符合「用户自己说了算」。
- 删除：`tools/lovely-cli/discovery.mjs` 与其 8 个单测；`electron-builder.yml` 的 `files` / `asarUnpack` 里的 discovery 条目；`host.test.mjs` 复制 discovery 的那行。
- 新增 `tools/lovely-tools.mjs`（主进程/命令行共用，纯 Node）：
  - `LOVELY_TOOL_SPECS`（`lovelymem` / `lovelyspark`，含 label、env 名、选择提示）；
  - `lovelyConfigFile(env)`：`SEEU_LOVELY_CONFIG` → `SEEU_DSH_HOME`（外壳注入）→ `DSH_HOME` → `~/.dsh`，文件名 `lovely-cli.json`；
  - `readLovelyConfig`（去 BOM、空文件 `{}`、非对象抛错）、`toolState`、`lovelyToolsView`（坏 JSON 只放在 `error` 字段，界面可显示）；
  - `saveLovelyToolPaths(input, env)`：只处理传入的 id，空串→删键，校验绝对路径 / 文件存在 / `.exe` 后缀，写缩进 JSON 并返回最新视图。
- `tools/lovely-cli/cli.mjs`：删 `import … from './discovery.mjs'`（内联 `isFile`）；`resolveExecutable` 只读 env → config，返回 `{path, source:'env'|'config'|'unconfigured', configured, found, envVar?, staleConfigPath?}`；未配置报「未配置 X 路径：打开外壳「设置 → 本机取证工具路径」选择 exe（或设置 `SEEU_*_EXE` 环境变量）」，配置失效报「配置的 X 路径不存在：<path>；请重新选择」；`configure` 只接受绝对路径或 `clear`（拒绝 `auto`），`status`/`--help` 都带 `note: 路径请在外壳「设置 → 本机取证工具路径」里指定；不做自动发现。`
- `src/lovely-tools.ts` 包装并 re-export 类型；`src/main.ts` 新增 IPC `seeu:lovely-tools:get` / `:pick`（`dialog.showOpenDialog` 只选 `.exe`）/ `:save`（catch → `{ok:false,error}`）；`src/preload.ts` 暴露 `window.seeu.lovelyTools.{get,pick,save}` 与类型。
- `renderer/local-model.html` 新增「本机取证工具路径（手动指定，不做自动发现）」卡片：两行（状态点 + 名称 + 只读路径 + 选择… + 清除）、说明、`#btn-tools-save`、`#tools-status`、`#tools-config`（显示配置文件路径）；启动时 `loadTools()`，工具路径输入框不触发模型预览。
- 两个 SKILL.md 去掉「自动寻找 / `configure auto` / 默认无需配置」，改成「路径只能由用户在设置窗口指定，`found:false` 就让用户去设置，不要自己找 exe」；`docs/lovely-cli.md` 的发现/缓存段落整体改写为手动配置。
- 验证：`npm run test:lovely` **22/22**（新增 `config.test.mjs` 6 例：视图/保存/清除/三类校验失败不动原配置/env 优先/坏 JSON；`cli.test.mjs` 新增「未配置时提示去设置窗口指定，不做自动发现」）；`npm test` **79/79**；`node scripts/build.mjs` OK。
- `settings-check` e2e 新增：`toolsRows:2`、`toolsSectionVisible:true`、`toolsApiSaved:true`、真实点「保存工具路径」→ `toolsFile` 两项都在、`toolsFileOk:true`、清空 LovelyMem 后 `toolsAfterClear` 只剩 LovelySpark、`toolsClearOk:true`，`ok:true`、`errors:[]`。
- 踩坑：① `saveLovelyToolPaths` 里 `.exe` 判断误写成 `/\\\\.exe$/i`（正则里是「反斜杠 + .exe」），所有 exe 都报「需要选择 .exe 文件」；② 配置默认路径先只认 `DSH_HOME`，而外壳用 `SEEU_DSH_HOME`，e2e 里写到了 `C:\Users\ASUS\.dsh` 导致读不到 → 改成三个变量按序回退；③ e2e 先用 API 只保存 LovelyMem，页面输入框不会自动刷新，接着点 UI 保存会把 LovelyMem 清掉（UI 是整个表单的真相）→ 断言前把两行输入都填好。
- 顺带提交：`scripts/e2e/real-gateway-ui.mjs` 的工具轮补丁（`ask()` 复用、`SEEU_UI_TOOL=1` 第二轮 `pwsh node -v`、`[data-tool]` 卡片断言、截图 `11-real-gateway-tool.png`）。
- 遗留：手动路径只存在用户机器上，打包/换机不会带；真实镜像分析（`doctor`/`plugins`/`run`）仍未跑；等用户视觉验收后再打 v0.2.9。

## 20.63 v0.2.9 打包（2026-11-12）

- 版本 0.2.8 → 0.2.9（`package.json` + `package-lock.json` 顶层与 `packages[""].version`）；`node scripts/build.mjs`、`npm test` 79/79 通过。
- `npx electron-builder --win --x64 -c.directories.output=release-029`（约 12 分钟，无证书跳过签名）。产物：exe 246,329,856 B；app.asar 168,835,443 B（19,654 entries）；NSIS 211,947,119 B（blockmap 220,827）；portable 189,553,401 B；win-unpacked 803,679,886 B。
- 本批内容：真机技能链路（`caf616f`）、工具路径手动指定 + 删除自动发现（`d1474ee`）。
- asar 自检 `.probe/asar-029-check.mjs`：24 项全 true，其中 `lovelyToolsModule` 因 `tools/lovely-tools.mjs` 被 esbuild 打进 `dist/main.cjs`，改为检查主进程产物而不是 asar 文件；`lovelyUnpacked` 断言 `app.asar.unpacked/tools/lovely-cli/cli.mjs` 存在、`discovery.mjs` 不存在。
- 打包态回归：`verify-launch` 目录版 5249 ms / portable 37389 ms；`m2-ui-check`、`settings-check`（含工具路径区：两行、API 保存、真实点保存写盘、清空删键）、`export-check`、`cross-case-check` 全绿。
- 尝试让 `real-gateway-ui.mjs` 支持 `SEEU_UI_EXE` 跑打包版：能起页面但停在「选择工作区」，composer 定位失败（`type-failed`），改动已用 `git checkout` 回滚，避免留下未验证路径。真机 UI 验证仍用 dev Electron。
- 遗留：手动工具路径只存本机；打包版首启的「选择工作区」页对 CDP 脚本不友好，后续若要打包态真机 UI 回归，需先写默认工作区或用 `--user-data-dir` 预置 workspace。

## 20.64 镜像挂载接口（取证镜像 → 只读盘符）

- 用户指令（本轮）：「拉取一下最新仓库，看lovelycarve进来没，接下来提供接口供镜像的挂载」。先 `git pull --no-rebase origin main` 到 `186eb84`（fast-forward，含 upstream 的技能上传 `117b391`），确认 `resources/forensics/skills/lovelycarve-forensics/` 已在仓库里（SKILL.md 200 行 + commands/pitfalls/recipes 三份参考 + `test/verify_real.py`）。
- 读 `references/commands.md` / `recipes.md` 得到硬约束：挂载命令是 `mounts create <path> --mount-point <X:>`、`mounts list`、`mounts delete <id> [--force]`；**挂载点只在 CLI 进程存活期间有效**，必须在 `sessions`/`shell`/`session` 常驻模式里用；Dokan 挂载需要管理员；同一案件不能同时被桌面端与 CLI 打开。
- 新增 `tools/image-mount.mjs`（纯 Node，主进程/e2e 共用）：
  - `mountsFile(env)`（`SEEU_MOUNTS_FILE` 或 `<DSH_HOME>/mounts.json`）、`mountCaseDir(env)`（`<DSH_HOME>/mount-case`）、`defaultMountPoint(env, taken)`（`X:` 起跳过占用）、`resolveLovelyCarveCli(env)`（环境变量 → `lovely-cli.json` 的 `lovelycarve` 键 → 常见安装位置，返回 `{path, source, error?}`）；
  - `LovelyCarveHost`：spawn `lovelycarve-cli -q shell`，stdin 逐行写命令、stdout 逐行 JSON 与请求配对（超时 180 s），stderr 只保留末 4 KB；`LOVELY_CARVE_AGENT=1` / `NO_COLOR=1` 保证机器可读；
  - `createMountManager({env,log})`：`status()`（CLI 状态 + 挂载清单 + 默认盘符）、`inspect(imagePath)`（一次性 CLI 发 `images get`，返回分区表）、`mount({imagePath,partition,mountPoint})`（校验绝对路径/盘符占用 → `cases create` → `images open` → `mounts create /part:N --mount-point X:` → 存记录）、`unmount(id)`（`mounts delete --force` + 删记录）、`dispose()`；
  - 挂载清单 `<DSH_HOME>/mounts.json`：`{updatedAt, note, mounts:[{id,imagePath,imageName,partition,mountPoint,mountedAt,caseDir}]}`；`hostEnv()` 返回 `{SEEU_MOUNTS_FILE}`；
  - 测试缝：CLI 路径是 `.mjs/.cjs/.js` 时用 `SEEU_MOUNT_NODE`（或 process.execPath）执行，单测/e2e 注入假 CLI，不需要真装 LovelyCarve 或 Dokan。
- `tools/lovely-tools.mjs` 的 `LOVELY_TOOL_SPECS` 增加第三项 `lovelycarve`（`SEEU_LOVELYCARVE_CLI`，提示选 `lovelycarve-cli.exe` 不是 GUI）；`renderer/local-model.html` 工具卡片由两行变三行，`saveTools()`/事件绑定循环同步；`scripts/e2e/settings-check.mjs` 的 `toolsRows` 断言 2 → 3。
- 新增 `src/mounts.ts`：re-export `createMountManager` 与类型，进程级单例 `mountManager`（日志经 `setMountLogger` 转发到 `logShell`），`mountHostEnv()`。`src/main.ts`：`new DshHost({ env: mountHostEnv() })`；`openMountsWindow()` 载 `renderer/mounts.html`；菜单「工具 → 镜像挂载…」（`Ctrl+Shift+M`）+ 托盘项；`SEEU_OPEN_MOUNTS=1` 启动即开；`requestQuit()` 先 `await mountManager.dispose()` 再停 dsh；IPC `seeu:mounts:get|pick-image|inspect|mount|unmount|open`。`src/preload.ts` 暴露 `window.seeu.mounts.{get,pickImage,inspect,mount,unmount,open}` 与类型。
- 新增 `renderer/mounts.html`：CLI 状态卡（未配置红字提示 + 【去设置路径…】）、选择镜像 → 解析分区表格（radio 选分区）、挂载点输入 + 挂载按钮、当前挂载卡片（打开盘符 / 卸载）、说明「挂载点只在 SeeU 运行期间有效，关闭外壳释放」、挂载清单文件路径。
- 测试：`tests/image-mount.test.mjs` 4 例（路径/CLI 解析/默认盘符/完整 inspect→mount→清单→unmount→dispose，用 `tests/fixtures/fake-lovelycarve-cli.mjs`）→ `npm test` **85/85**；`npm run test:e2e:mounts`（`scripts/e2e/mount-check.mjs`，端口 9461，假 CLI 复制到隔离 HOME）→ `{"ok":true,"inspect":{"partitions":2},"mount":{"mountPoint":"X:"},"state":{"count":1},"listVisible":true,"unmount":true,"stateAfter":0}`，截图 `.dev/shots/mounts.png`；`settings-check` `toolsRows:3` 全绿；`m2-ui-check` `m2ok:true`。
- 踩坑：① `mount()` 里对已占用盘符依赖 `existsSync('X:\\')`，e2e 机器上 `X:` 未占用所以能过；真实机器要先选空盘符；② 挂载 id 优先取 `mounts create` 返回值，没有则从 `mounts list` 按盘符匹配，再兜底生成（不同 CLI 版本返回结构可能略有差异）；③ 窗口脚本的 `#mountRow` 用 `display:flex` 切换，初始 `display:none` 要一起改。
- 遗留：未在真实 LovelyCarve + 真实镜像上跑（本机没装）；挂载清单里的 `exists` 只按 `X:\\` 是否存在判断，盘符被手动卸载后不会自动清理；会话侧技能还没有「读 mounts.json」的专门提示（下一步可在 SKILL.md / brief 里加一句）；等用户验收后再打 v0.2.10。

## 20.65 v0.3.0 打包（2026-11-12，含 Gitea main 技能上传 + 镜像挂载）

- 版本：合并 Gitea `main`（`186eb84`）后 `package.json` 已是 0.3.0，`package-lock.json` 仍是 0.2.9 → 手动同步（`npm version 0.3.0 --no-git-tag-version` 因「版本未变化」拒绝，改为 node 脚本改 lock 顶层与 `packages[""].version`）。
- 本批内容：`117b391` 技能上传/管理器（菜单 + 管理器页面 + ZIP/文件夹导入 + 6 个 IPC + `scripts/test-skill-upload.mjs` 22 断言）、`f56aa57` 镜像挂载（`tools/image-mount.mjs`、`renderer/mounts.html`、`src/mounts.ts`、IPC/菜单/托盘、`SEEU_MOUNTS_FILE` 下发、假 CLI + mount e2e）。
- 新增 `scripts/e2e/skills-check.mjs`（`npm run test:e2e:skills`）：起真 Electron/打包版 → 等页面 → 检查 preload 7 个技能方法 → `skillsList()` 必须 7 个随包技能且含 `lovelycarve-forensics`/`lovelymem-cli`/`lovelyspark-cli`；dev 与打包态均 `ok:true`。
- 打包：`npx electron-builder --win --x64 -c.directories.output=release-030`（约 13 分钟，无证书跳过签名）；产物搬进 `release/`（删除 0.2.9 NSIS/blockmap；0.2.9 portable 正被用户运行、无法删）。
- 产物：exe 246,329,856 B；app.asar 169,101,956 B（19,686 entries）；NSIS 212,013,664 B（blockmap 221,709）；portable 189,622,254 B；win-unpacked 803,946,399 B。
- asar 自检 `.probe/asar-030-check.mjs`：39 项全 true（新增 mounts/skills 相关 9 项）。坑：① 中文菜单项在 `dist/main.cjs` 里被 esbuild 转成 `\u955C\u50CF…`，不能用中文字面量查，改查 `openMountsWindow`/`Ctrl+Shift+M`；② 打包进行中 asar 会被重写，读取可能报 `was not found`，要等 job 结束再抽。
- 打包态回归：`verify-launch` 目录版 5118 ms / portable 50535 ms；`m2-ui-check`、`settings-check`（toolsRows 3）、`export-check`、`cross-case-check`、`mount-check`、`skills-check` 全部 `ok:true`。
- 文档：README §2 产物表换 v0.3.0 +「### v0.3.0 改了什么」（技能上传、镜像挂载、测试 85/85、e2e 20 个脚本）、`docs/packaging.md`「### v0.3.0 回归验证」。
- 遗留：真实 LovelyCarve/真实镜像未验证（本机未安装；假 CLI 覆盖协议与状态机）、挂载清单 `exists` 仍只按盘符存在判断、0.2.9 portable 占用文件未能删除。

## 20.66 提示词修复「暴力搜盘」+ 设置入口进菜单（v0.3.1）

- 用户真实试用暴露两个问题：① 问「CHAN_MH 手机是什么操作系统」时，模型查完索引（eid1 只有 1 行）后执行 `Get-ChildItem -Path 'E:\' -Recurse -Filter 'CHAN_MH*'`，被用户中止并质问「为什么暴力搜索 E 盘，明明火眼分析结果里检材有这个名字」；② 用户反馈「设置界面做到菜单里，难得记忆快捷键」。
- 根因：`pf`（手机全量提取）/`image`（磁盘镜像）类检材在火眼里没有 `data.csv` / `chat.txt` 叶子（实测 `ges glob --path '检材分析数据/未指定持有人/1'` 为空），索引只有元数据；而案件概览只列 `eid/名称/平台/记录数`，没有原始文件路径、类型、备注，也没有「先查索引→再看检材盘→需要镜像就挂载」「禁止全盘递归」的行为规则 → 模型自己去找文件。
- `tools/ges-index/query.mjs`：`evidences()` 的 select 增加 `source_path, storage_path`，返回 `sourcePath` / `storagePath`。
- `plugins/seeu-case-index/index.js` 的 `briefText()`：检材表改为 `eid | 名称 | 类型 | 平台 | 入库记录 | 火眼统计 | 原始文件 | 备注`；`入库记录` 远小于 `火眼统计`（且火眼 ≥20）标 ⚠，表下汇总「⚠ 索引覆盖不足：…」；新增「## 取证定位规则（必须遵守）」四条：① 设备信息（系统版本/机型/IMEI）先看备注和设备信息表；② 索引没数据时按「检材盘原始文件 → 火眼解析 → 镜像挂载（工具 → 镜像挂载…，`$SEEU_MOUNTS_FILE`）→ 让用户拷原始文件」；③ **禁止 `Get-ChildItem -Recurse C:\` / `dir /s E:\` / `find / -name` 全盘递归**；④ 检材文件 GB 级，不要整份复制/解压。
- `resources/forensics/skills/ges-case-index/SKILL.md`：新增「索引里没有数据时（全量提取 / 镜像类检材）」小节（recordCount vs reportedRecordCount、`pf`/`image` 类型、原始路径、挂载、禁止全盘搜索），并在「工作方式建议」之外单独强调。
- `resources/forensics/cordis.patch.yml`：host `system-prompt.personaPrefix`、`preset-standard` 的 persona、`preset-seeu-lite` 的 persona 三处都加「先定位再取证：索引 → 火眼解析 → 检材盘/镜像挂载；禁止全盘递归搜索」。
- 生成真机 `C:\Users\ASUS\AppData\Roaming\SeeUForensicsAgentPlus\dsh-home\AGENTS.md`（1740 字符）：表格带出 `W:\CHAN_MH_mobile.zip` 与 `remark=iPhone D331pAP/iOS17.1.1 全量提取`（答案 A 直接可见），⚠ 覆盖不足列出 CHAN_MH（1/3065）与 AP3_LEUNG_YL_USB.E01（1/68）；同步把更新后的 SKILL.md 拷进该 dsh-home 的技能目录（运行中的外壳也能读到）。
- 设置入口：`src/main.ts` 新增一级菜单「设置」（本地模型与工具路径… `Ctrl+,` / 镜像挂载… `Ctrl+Shift+M` / 技能管理器… `Ctrl+Shift+S` / 本地模型状态 / 重新探测 / 配置文件目录 / 日志目录）；主窗口显式 `autoHideMenuBar: false` + `setMenuBarVisibility(true)`；新增 IPC `seeu:open-mounts` / `seeu:open-skills` 与 preload `openMountsWindow()` / `openSkillsWindow()`；`plugins/seeu-theme/client.js` 欢迎页快捷入口新增「镜像挂载」「技能管理器」两个 chip。
- 验证：`node scripts/build.mjs`、`check:overlay`、`npm test`（84–85 全 pass，0 fail）;`hero-check` 快捷入口变为 `["index","model","workspace","mounts","skills"]`、`ok:true`；`m2-ui-check` `m2ok:true/errors:[]`（菜单/JSP 改动不影响启动）。
- 遗留：真实 `pf` 检材内容仍未解析（需挂载/解包原始 tar 后按需分析）；模型是否会遵守新规则需真机会话复测（用同一道题看是否直接答 `iOS 17.1.1` 且不再递归扫盘）。

## 20.67 接入超级取证大师（MYOS）MCP，规划「一次入库、AI 快速读取」（v0.3.1）

- 用户要求：把本机「超级取证大师」（MYOS）作为 MCP 服务器接入 —— 名称 `myos-forensics`、stdio、命令 `D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe`，使用前先启动 MYOS，连接失败先 `health_check_dbus`；随后要求「这个同样只做一次入库处理，不要直接读数据目录（应该用 ges CLI 获取数据），两个软件融合到一起，最后数据入库、AI 能快速读取」。
- 环境事实：MYOS 安装目录下有 `myos_mcp_server.exe`（4,799,944 B）与 `mcp.json`（`id: myos-forensics-mcp`、`cmdType: stdio`、`version 1.1.4`）；超级取证大师正在运行（`ForensicDesktop` + `MYAIForensicsService`/`MYPhoneForensicsService`/`MYCommonForensicsService`/`MYAppCloudForensicService`）。MYOS 现有 4 个案件：`案件20261015145357`、`案件20261012160440`、`李自勇`、`案件20260923163545`（`D:\Programs\MYOS\Case`），当前没有打开中的案件（`query_open_cases` → `{count:0}`）。
- 协议探测（`.probe/myos-mcp-probe.mjs`，JSON-RPC 行协议）：`initialize` → `serverInfo {"name":"evidence-mcp","version":"1.1.4.71"}`、`protocolVersion 2024-11-05`；`tools/list` → **49 个工具**；`tools/call health_check_dbus` → `DBus 服务健康：OK`，structured `ready/forensicDesktopRunning/dbusDaemonRunning/caseManagerAvailable/taskManagerAvailable/phoneForensicsAvailable` 全 true。
- 49 工具：案件（`query_cases`/`query_open_cases`/`open_case`/`close_case`/`create_case_and_open`/`query_case_types`/`query_case_settings`/`query_materials`）、检材与取证（`add_image_material`/`add_disk_material`/`add_file_collection_material`/`submit_computer_forensic_task`/`load_case`/`restart_computer_forensics`/`start_computer_image_emulation_task`/`start_auto_mobile_forensics`/`start_phone_file_forensics_task`/`start_phone_folder_forensics_task`/`start_phone_direct_forensics_task`/`reply_phone_forensics_message`/`reply_phone_detection_message`/`reset_phone_detection`/`query_phone_direct_devices`/`query_phone_forensic_items`）、结果与检索（`query_computer_forensics_results_overview`/`query_phone_forensics_results_overview`/`query_phone_file_forensics_result_summary`/`sqlite_query`（只读 SELECT，含加密 `.mfs`）/`quick_search_files`/`quick_search_content`/`global_search_content`/`raw_data_content_search`/`create_file_index_task`/`query_device_info`/`query_device_mount_path`/`query_current_node_data`）、任务与解密（`query_task_status`/`wait_task_completion`/`query_case_running_tasks`/`stop_task`/`stop_phone_forensics_task`/`query_encrypt_types`/`decrypt_partition`/`query_decrypt_task_status`）、导出/其它（`export_case`/`export_bcp`/`open_mftool`/`query_local_disks`/`health_check_dbus`）。
- 注册：`resources/forensics/cordis.patch.yml` 末尾新增 `- insert:` → `id: seeu-mcp-myos`、`name: '@deepseek-ai/dsh-mcp-client'`、config `{transport: stdio, serverName: myos-forensics, command: D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe, args: [], toolCallTimeoutMs: 120000, failOnStartupError: false, reconnect:{enabled:true, initialDelayMs:3000, maxDelayMs:60000, maxAttempts:50}}`。`failOnStartupError: false` 保证 MYOS 没开时外壳照常启动。
- 验证：`DSH_HOME=.dev/dump-home dsh --profile web --patch resources/forensics/cordis.patch.yml --dump-config` 输出含 `- id: seeu-mcp-myos`；`.probe/mcp-headless-check.mjs`（本地 mock 网关 18185 + headless dsh + 本地模型 patch）→ `exitCode:0`、`toolsCount:75`、`mcpToolCount:49`，工具名形如 `mcp__myos-forensics__myos-forensics_add_disk_materi_<hash>`（dsh 对过长名截断加哈希）；`npm test` 85/85、`check:overlay` OK。
- 融合方案（下一步实施）：**不读 MYOS 数据目录，也不让模型每次现查**。
  1. 取数：MYOS MCP `query_cases`/`query_materials`/`query_*_overview`/`sqlite_query` 取案件、检材、结果表；
  2. 入库：归一化写入与火眼同一套 `case-index.db`（`evidence`/`record`/`entity` + FTS5），一条记录行 = 时间/应用/账号/类别/摘要/来源；MYOS 侧另存 `source='myos'`；
  3. 读取：面板与 `ges-case-index` 技能只查索引（`/seeu-index/search|records|evidences`），模型用 `$SEEU_INDEX_API` 快速检索，不再逐个工具调用；
  4. 火眼侧继续走 `ges` CLI（`tools/ges-index/build.mjs`），MYOS 侧走 MCP，两条流水线共用同一份索引 schema；同一案件只做一次入库（幂等，按 caseId/materialId 去重）。
- 遗留：接入只完成「连接 + 工具可用」，还没有 MYOS → 索引的入库器；需要用户指定先索引哪个 MYOS 案件（4 个候选），以及确认 MYOS 手机/计算机结果库的表结构（先 `query_*_forensics_results_overview` 拿 hints 再写映射）。
