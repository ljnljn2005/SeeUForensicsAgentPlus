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

## 20.68 随包 dsh 插件预打包（v0.3.2）

- 用户要求：「billion-context、dsh-gitbash-shell、dsh-better-sidebar、dsh-context 这几个插件…我没说安装到现在会话环境里，是这个取证项目里预打包」——不是给当前开发者会话装，而是让 **SeeU 安装包自带**、离线可用。
- dsh 机制（`node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`）：`resolveBundleDir()` 先在自己安装目录的 `node_modules`（打包后在 `app.asar/node_modules/@deepseek-ai/dsh`）里找 bundle，找不到再看 profile 目录；`loadProfile()` 读 `<DSH_HOME>/profiles/<name>/package.json` 的 `dsh.profile.bundles`，profile 不存在才用模板。⇒ 只要插件写进 profile bundles、包又在安装目录 node_modules 里，就不必执行 profile 级 `pnpm install`。
- 依赖：`npm i --save-exact billion-context@0.1.213 dsh-context@0.83.1 dsh-better-sidebar@0.30.1 dsh-gitbash-shell@0.54.0`。普通安装因 peer 冲突失败（`dsh-context` 要 `@deepseek-ai/dsh-session >=0.2.2-rc.2`，工程 pin rc.1；rc.2 又要求 `dsh-scope` rc.2），改用 `--legacy-peer-deps` 成功；`@dsh-ops/fastctx-win32-x64`（48M，`bin/fastctx.exe`）随 `dsh-gitbash-shell` 装上，必须 `asarUnpack` 才能 spawn。
- 新增 `tools/dsh-plugins.mjs`（纯 JS，主进程与单测共用）：`BUNDLED_DSH_PLUGINS`、`PROFILE_BASE_BUNDLES`、`SHELL_PROFILE_NAME='web'`、`mergePluginBundles(manifest, pluginBundles)`（只追加缺项、保持顺序、不动 `dependencies`、`dsh` 非对象抛错）、`pluginPackagePresent(name, root)`、`installBundledPluginBundles({homeDir, pluginsDir, pluginBundles?, baseBundles?})`（缺清单则建，写 2 空格 JSON；返回 `{profileDir, manifestPath, added, missing, changed, error?}`，错误只返回不抛）；`src/dsh-plugins.ts` 薄层用 `dshHome()`/`appRoot()` 调用。
- `src/main.ts`：`startHost()` 里 `installBundledPluginBundles()`（`SEEU_DISABLE_DSH_PLUGINS=1` 跳过），日志 `dsh plugins: 已补 … / 已就绪 … → <manifestPath>`；`electron-builder.yml` 的 `asarUnpack` 增加 `node_modules/@dsh-ops/fastctx-win32-x64/**`。
- 测试：`tests/dsh-plugins.test.mjs` 7 例（追加/建字段/首次建清单/保留用户 bundles 与 deps/幂等/坏清单不覆盖/常量）→ `npm test` **91/91**；新增 `scripts/e2e/plugins-check.mjs`（`npm run test:e2e:plugins`，端口 `SEEU_PLUGINS_E2E_PORT` 默认 9357，`--exe` 支持打包版）：隔离 home + mock 网关，断言 profile bundles 含 6 项、页面文本含「上下文洞察」「插件」、`shell.log` 有 `dsh plugins:` 且无「缺少」，截图 `.probe/shots/plugins.png` → `ok:true`。
- 插件带来的界面/工具变化：侧栏出现「插件」「自动化任务」「上下文洞察」；工具表从 ~14 增到 72（49 个 MYOS MCP + 6 个 billion-context 上下文工具 + 3 个 gitbash-shell 工具 + 基础 12 个），`bash` 工具 5,327 字符、另有 `gitbash_native`/`gitbash_to_native_path`。
- 适配 `scripts/e2e/local-tools-e2e.mjs` 三处（原断言在插件下必假）：
  1. 「精简预设」改为剔除 MCP 与插件工具后数基础工具（实测 12 ≤14），不再用总工具数；
  2. 标题请求改为按 system 里的 `Create a concise title…` / `Generate the session title…` 识别（插件会给标题调用也带上工具，旧逻辑「tools=0 即标题」失效）；`first` 也改为取第一条带工具的请求（标题请求可能先到）；
  3. `todoVisible`：插件把任务卡折叠成「任务 N 进行中」，改为 deep query（含 shadowRoot）+ 点开折叠容器，再退化为「任务卡存在」作为 todo 落库证据（`todoPersisted`）。
- 验证：`plugins-check` `ok:true`（bundles 6 项、`hasContext/hasPlugins` true、日志行无「缺少」）；`m2-ui-check` `m2ok:true/errors:[]`；`hero-check` `ok:true`；`local-tools-e2e` `ok:true`（`litePresetTools:12`、`titleOk:true`、`todoPersisted:true`）；`node scripts/build.mjs`、`check:overlay` OK。
- 坑：① `billion-context` 对 dsh `0.2.2-rc.1` 只打警告（其最新适配 `0.2.0-rc.2`），功能正常；② 手工 boot 时曾见 `[gitbash-shell] better-sidebar shell adoption unavailable: atomic-write: timed out waiting for the writer lock …profiles\web\package.json.lock`（外壳写清单与插件写侧栏状态并发），后续 dev e2e 未复现；③ 插件注入工具后提示词体积上涨（`toolsChars` 5,245、`systemChars` 12,761），本地模型首字延迟需真机复测。
- 遗留：打包体积预计 +约 123MB（asar 从 169MB 到 ~292MB），需确认 portable/NSIS 压缩耗时与体积可接受；真实用户是否希望默认全开（可用 `SEEU_DISABLE_DSH_PLUGINS=1` 关）待反馈。

## 20.69 新增流量/日志/内存三预设，按预设注入 Lovely 技能（v0.3.2，未打包）

- 需求（用户 m11721 原文）：「现在多加几个profile，lovelyspark注入到流量分析profile和日志分析profile，lovelymem注入到内存分析profile，之前的取证profile就不注入这三个工具」。确认 LovelyCarve 归属时用户选择「留在取证分析预设」，所以只把 `lovelymem-cli` / `lovelyspark-cli` 移出取证预设。
- **技能目录改造**：`resources/forensics/skills/lovelymem-cli` → `resources/forensics/skill-sets/memory/lovelymem-cli`；`lovelyspark-cli` → `resources/forensics/skill-sets/traffic/lovelyspark-cli`，并复制一份到 `skill-sets/log/lovelyspark-cli`（流量/日志共用同一套技能内容，但各自独立目录，便于以后分化）。`resources/forensics/skills/` 现在只剩通用技能：`evidence-chain-report`、`ges-case-index`、`lovelycarve-forensics`、`read-only-evidence-analysis`、`windows-artifact-triage`。
- **新增 `tools/skill-sets.mjs`**（纯 JS，主进程与单测共用）：`SKILL_SET_IDS = ['traffic','log','memory']`、`RETIRED_SKILL_DIRS = ['lovelymem-cli','lovelyspark-cli']`、`skillSetsHomeDir(homeDir)`、`skillSetHomeDir(homeDir,id)`、`installSkillSet({sourceDir,homeDir,id,version})`（整组复制到 `<DSH_HOME>/skill-sets/<id>`，写 `.seeu-skill-set.json` 指纹（version/id/installedAt），幂等，源缺失返回空结果）、`removeRetiredSkills(homeDir)`（从 `<DSH_HOME>/skills` 删掉两个退役目录，做升级迁移）。
- **外壳**：`src/skills.ts` 的 `installBundledSkills(version)` 现在先装三组、再清理退役技能，结果新增 `sets`/`retired`；`src/host.ts` 注入 `SEEU_SKILL_SET_TRAFFIC`/`SEEU_SKILL_SET_LOG`/`SEEU_SKILL_SET_MEMORY` = `<DSH_HOME>/skill-sets/<id>`。
- **overlay 三预设**（`resources/forensics/cordis.patch.yml`，插在 `preset-seeu-lite` 之后、MYOS MCP 之前）：`preset-traffic`（order 3，名称「流量分析（Traffic）」）、`preset-log`（order 4，「日志分析（Log）」）、`preset-memory`（order 5，「内存分析（Memory）」）。每个都复制精简预设的工具面，persona 写明用 `lovelyspark-cli` / `lovelymem-cli` 技能与 `node "$env:SEEU_CLI_NODE" "$env:SEEU_LOVELY_CLI" <tool> -- <子命令>` 的调用方式；`skill-filesystem` 用 `includeDefaultRoots: false` + `customSkillDirs` 指向自己的环境变量，实现「预设之间技能隔离」。
- **YAML 坑**：`!!js` 只接受**带引号的标量**。写成 flow sequence（`!!js [process.env.X]`）报 `YAMLException: unknown tag !<tag:yaml.org,2002:js>`；不加引号的括号表达式（`!!js (process.env.X ? [..] : [])`）报 `bad indentation of a mapping entry`（冒号被解析成 mapping）。最终写成 `customSkillDirs: !!js "(process.env.SEU_SKILL_SET_TRAFFIC ? [process.env.SEU_SKILL_SET_TRAFFIC] : [])"`。
- **测试**：新增 `tests/skill-sets.test.mjs` 4 例（安装/指纹/幂等/缺源）、`tests/presets-config.test.mjs` 4 例（js-yaml 自定义 `tag:yaml.org,2002:js` 标量类型解析 overlay；断言三预设 id/名称/顺序、`customSkillDirs` 引用正确环境变量、取证预设不引用 `SEU_SKILL_SET_`、随包目录布局）→ `npm test` **99/99**；`check:overlay` 扩展为逐预设校验（名称、技能根、`customSkillDirs`、`tool-fs` 只读、取证预设不得引用分组根）；`skills-check` 改为断言 `skillsList` 只剩 5 个通用技能、`skill-sets/{traffic,log,memory}` 各就位、`leaked: []`。
- **验证**：`node scripts/build.mjs` OK；`npm test` 99/99；`check:overlay` OK；`node scripts/e2e/skills-check.mjs` `ok:true`（三组技能目录与 `.seeu-skill-set.json` 均在，默认技能根无 lovelymem/lovelyspark）。
- **坑与放弃的验证**：① headless profile 没有 `agentPresets` 服务，三预设都停在 `pending (waiting for service: agentPresets)`，所以删掉了 `scripts/e2e/presets-check.mjs`，改用「配置层测试 + check:overlay」；② Electron UI 探针（`.probe/ui-preset-probe.mjs`）在首次启动的「选择工作区」页停住（没有会话就没有预设选择器），且 `!` 需要约 27 s，放弃 UI 级验证；③ `check-overlay` 里截 preset 段的函数原本写死 `preset-standard`，扩展时漏改签名，导致三个新预设全部误报，已改为 `presetSection(dump, id)`。
- 遗留：预设选择器只在「新建会话」时出现，打包后需要人工点一遍确认三个新预设可见可用；真实 LovelySpark/LovelyMem CLI 仍需用户手动指定路径。

## 20.70 v0.3.2 打包：随包 4 插件 + 三分析预设（已交付）

- 版本 `0.3.2`；提交 `e252569`（预设+插件）与 `ffc7184`（环境变量名修复）。
- 打包两次：第一次产物 overlay 里技能根环境变量名是 `SEU_SKILL_SET_*`（少一个 E），与 `src/host.ts` 注入的 `SEEU_SKILL_SET_*` 不一致（旧 `check-overlay` 与 `tests/presets-config.test.mjs` 抄了同一个错名所以都通过），修正后重新打 `release-032b`。
- 最终产物：目录版总计 1,109,515,767 B；`app.asar` 425,164,539 B / **34,094 entries**（169MB → 425MB，插件依赖闭包所致）；NSIS 281,504,620 B（blockmap 292,860 B）；portable 236,213,254 B。
- 自检：`.probe/asar-032-check.mjs` 58 项全 true；启动 6130 ms / portable 49,649 ms。
- 打包态 e2e：`m2-ui-check` `m2ok:true`；`settings-check` `ok:true`（toolsRows 3）；`plugins-check` `ok:true`（bundles 6、上下文洞察/插件 UI、日志 `dsh plugins:`）；`skills-check` `ok:true`（5 通用技能 + 三组技能 + `leaked:[]`）。
- `npm test` 100/100、`check:overlay` OK。
- 遗留：三预设技能注入只有配置层校验（`dump-config` 不展开 `!!js`；headless 无 `agentPresets`），运行时求值依赖 dsh loader 的 `with (ctx) eval`；真实 LovelyCarve/LovelySpark/LovelyMem 未跑真机分析；0.3.1 portable 被占用暂留 `release/`。

## §20.71 v0.3.3：修复随包插件未实际加载

- 现象（用户实测 0.3.2）：安装后界面没有插件效果；`logs/dsh-host-*.log` 每次启动都有
  `dsh: warning: 9 entries did not activate` 与
  `bili-native (billion-context): failed to import: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'billion-context' imported from <DSH_HOME>/profiles/web/`。
- 根因：`@deepseek-ai/dsh-app-boot` 的 `resolveBundleDir()` 只用 bundles 清单定位插件 patch；插件行本身由 loader 以 **profile 目录为 baseUrl** 做 ESM 导入。v0.3.2 只写了 `<DSH_HOME>/profiles/web/package.json` 的 `dsh.profile.bundles`，没有把包放进 `<profile>/node_modules`，于是全部导入失败。
- 修复：`tools/dsh-plugins.mjs` 新增
  - `resolveDependencyDir(name, fromDir)`：从包目录向上找 hoisted 依赖；
  - `collectPluginClosure(pluginNames, pluginsDir)`：两轮 BFS，`dependencies` 缺失记 `missing`（硬），`peerDependencies`/`optionalDependencies` 缺失记 `optionalMissing`（软，运行时由宿主提供）；
  - `ensurePluginPackages({ homeDir, pluginsDir, pluginNames, version })`：把闭包复制到 `<home>/profiles/web/node_modules`，写 `.seeu-dsh-plugins.json` 指纹（version + packages），同版本且包齐全直接返回；升级时删除指纹里已不再需要的旧包；
  - `copyDirectoryTree()`：逐文件 read/write（`fs.cpSync` 的底层 `copyFile` 读不了 `app.asar`）。
- 接线：`src/dsh-plugins.ts` 加 `ensureBundledPluginPackages(version)`；`src/main.ts` 的 `startHost()` 在补 bundles 之后调用并写日志
  `dsh plugins: 插件包 N 个（已复制 M 个；可选缺包 K 个（运行时由宿主提供））→ <profile>/node_modules`；`SEEU_DISABLE_DSH_PLUGINS=1` 一并跳过。
- e2e：`scripts/e2e/plugins-check.mjs` 新增 `REQUIRED_PACKAGES` 断言（四个插件包存在于 profile node_modules）、`packagesLine`（外壳日志）、`activationFailures`/`activationOk`（dsh-host 日志不得含 `did not activate` / `failed to import` / `ERR_MODULE_NOT_FOUND`）。
- 验证：`node --test tests/dsh-plugins.test.mjs` 10/10；`npm test` 102/102；`check:overlay` OK；dev `plugins-check` → `packagesOk:true`、`logOk:true`、`activationFailures:[]`、`activationOk:true`、页面仍显示「上下文洞察」「插件」。
- 坑：① v0.3.2 的 `plugins-check` 只看页面文案（「上下文洞察」「插件」在 web app 基础 UI 里本来就有），所以假绿；② `fs.cpSync` 从 asar 源复制会失败，必须逐文件；③ 依赖闭包里 `react`/`react-dom`/`@huanlin/dsh-plugin-better-locale`/`bufferutil`/`utf-8-validate` 是 peer/optional，不能当硬缺包。
- 遗留：真实安装包仍需再验一轮（打包态 `plugins-check --exe`）；插件升级（dsh 本体版本变化）时指纹只按外壳版本判断，足够用但如果插件包内容变化而版本号不变不会重抄。

## §20.72 把火眼已挂载的原始检材目录写进案件概览

- 用户需求：火眼（GES）已有检材的「模拟映射目录」，直接把映射目录告诉 AI 让它翻，就不用 LovelyCarve 每次挂载镜像。
- 调研（`ges status --json` / `ges context --json`）：返回 `evidence_mounts[]`
  `{eid, name, route:"/evidence_mounts/eid-N/", access_mode:"local", mount_point:"C:\hlnet\<eid>-<hash>", root_env, real_root_env}`；
  `/evidence_mounts/` 是原始只读文件系统入口，`ges ls/glob/grep/copy` 都支持；`/case/` 才是解析后的结构化虚拟视图。
  本机实测：eid1 → `C:\hlnet\1-1794226157`、eid3 → `C:\hlnet\3-1794227527`、eid4 → `C:\hlnet\4-1794227733`、eid5 → `C:\hlnet\5-1794227771`；eid2（IQ_Coin zip）没有挂载记录（`ges evidence ls` 也只列 4 个检材）。
- 实现：
  - 新增 `tools/ges-index/mounts.mjs`：`evidenceMountRoute(eid)`、`parseEvidenceMounts(context)`（容错归一 + 收集 `skipped_evidence_mounts`）、`attachMounts(list, mounts)`（**先按检材名匹配，再退回 eid**——索引 eid 与火眼 eid 不一定一致）、`loadEvidenceMounts()`（`ges status --json`，20s 超时、5s 缓存、失败返回空表）。
  - `plugins/seeu-case-index/index.js`：`/evidences` 返回每行 `mountRoute/mountPoint/mountEid`；`briefText(indexes, mounts)` 在检材表后新增「原始检材只读挂载（火眼已挂好，直接翻，不要再用 LovelyCarve 重复挂载）」段（按名称匹配每案检材）；`writeCaseBrief` 改 async 并在生成前取挂载表（`/list`、`/brief` POST、建库完成回调均 await，`apply()` 用 `void ... .catch()`）。
  - `resources/forensics/skills/ges-case-index/SKILL.md`：`/evidences` 字段说明加 `mountRoute/mountPoint`；「索引里没有数据时」第 2 步改为「先翻 `/evidence_mounts/eid-N/` 或本机目录」，第 3 步才用镜像挂载；工作方式建议补充「别一上来就挂镜像」。
  - 规则文案：取证定位规则第 2 条改为「① 火眼已挂载目录 → ② 没有挂载才自己挂镜像 → ③ 才考虑拷原始文件」。
- 验证：`node --test tests/ges-mounts.test.mjs` 4/4；`npm test` 106/106；真实案件重生成概览 → 2400 字符（原 1740），含四行挂载映射（eid2 无映射、不出现）；`check:overlay` OK。
- 坑：① 索引 eid 与火眼 eid 可能错位（索引残留已删检材），匹配必须以**名称**为主；② `ges status --json` 不含案件目录，无法强校验「当前案件=索引案件」，只能按名称匹配，匹配不上就不写；③ `briefText` 原本同步、`writeCaseBrief` 被 4 处同步调用，改 async 时注意 `apply()` 不能 await。
- 遗留：真实 LovelyCarve 挂载仍未验证（本机未装）；火眼挂载目录生命周期由 GES 管理（关闭火眼案件即失效），概览里的路径可能过期，用户重开案件后刷新概览即可。

## §20.73 索引接口支持 caseNumber（绕开中文路径乱码）

- 用户现场：会话里 `curl -G /evidences --data-urlencode "db=E:/forensics/W盘_…/.seeu-index/case-index.db"` 返回「索引库不存在」；同一路径在 python 里 `existsSync` 为 true。
- 根因：`safeDb()` 只看 `resolve(param)` + `existsSync`，逻辑没问题；问题在**传输编码**——中文路径经 shell（GBK 控制台）→ curl → HTTP 服务端（UTF-8 解码）后字节不一致，服务端拿到的是坏路径。`/list` 不受影响是因为它不接收 `db` 参数。
- 实现：`plugins/seeu-case-index/index.js` 新增 `resolveDbParam(query)`：`db` 优先走原 `safeDb`；否则接受 `caseNumber` / `case` / `caseDir`，用 `findIndexes(briefDirs())` 反查（匹配 caseNumber、caseName、caseDir、dbPath），命中后仍走 `safeDb` 做 `.seeu-index` 与存在性校验；未命中 404「找不到案件索引：…（用 /list 查看 caseNumber）」，完全缺参 400。所有 GET 路由统一改用 `resolveDbParam(url.searchParams)`（原来只有 `/brief` GET 与统一入口两处）；`/brief` GET 也支持 caseNumber。
- 文案：案件概览（briefText）在「查询入口」下加一行「db 含中文被转码就改用 caseNumber」；`ges-case-index` 技能的「后续查询都带 db」段落补 `caseNumber` 用法。
- 测试：`tests/db-param.test.mjs` 4 例（临时中文目录 + node:sqlite 造 meta：db 直传、caseNumber、case/caseDir/案件名、未知 404/缺参 400）——4/4；`npm test` 111/111。
- 坑：插件里 `resolve(ix.caseDir ?? '\u0000')` 这种兜底字符串若写成真实 NUL 会让源文件二进制化（git 显示 binary），要写转义文本。
- 遗留：面板仍传完整 `db`（浏览器 fetch 是 UTF-8，没问题）；脚本/模型建议走 caseNumber。


### 20.74 专家 persona 改造：每个会话预设变成对应领域的精简专家提示词

- 需求来源：用户要求把 `E:\取证桌面` 下 7 份弘连「取证桌面」专家提示词（火眼 36,600 B、服务器 33,804 B、流量 32,903 B、内存 33,336 B、网钜资金 35,955 B、APK 37,162 B、EXE 33,809 B）「简单修改后作为各 profile 的提示词」。
- 映射（用户确认）：火眼 + 服务器 → 取证分析（standard）；流量 → 流量分析；内存 → 内存分析；网钜 → 新增数据分析（order 6）；APK → 新增 APK 分析（order 7）；EXE → 新增 EXE 逆向分析（order 8）；日志分析暂无对应文件，保持原 persona（工具面仍带 `lovelyspark-cli`）。
- 精简原则：删掉「取证桌面」外壳段落、`Active expert:` 行、末尾 user 会话尾巴、`D:\Programs\Honglian\GoldenEyesV4\skills\…` 等本机不存在的技能清单；保留角色定位、能力范围、工作流程、取证红线、输出规范；并把工具入口改成 SeeU 实际可用的（`$SEEU_INDEX_API` + `caseNumber`、`ges` CLI、`/evidence_mounts/eid-N/`、`$SEEU_MOUNTS_FILE`、`$SEEU_CLI_NODE` + `$SEEU_LOVELY_CLI`、`$SEEU_WORKSPACE`）。成品 8.7–13.7 KB/份。
- 实现：`.probe/apply-personas.py`（仅脚本，不入库）按 `- id: preset-X` 找 `prefix: |` 并按缩进替换正文；`preset-data`/`preset-apk`/`preset-exe` 三块以 `NEW_TEMPLATE` 整块插入（工具面复制 seeu-lite：tool-fs 只读、tool-todo、compaction 等，`skill-filesystem` 不设 `customSkillDirs`）。
- 提示词再加固（回答用户「为什么直接读 W:\ 原始 zip 而不是先看火眼虚拟目录」）：`plugins/seeu-case-index/index.js` 的概览规则 1 增「备注没有时先 `ges status --json` 查 `evidence_mounts` 并翻挂载目录，不要解压 W:\ 原始压缩包」；规则 2 增「禁止在 `W:\` 上直接解压/整份读取原始 `.zip`/`.E01`/`.dd`，确实没有挂载入口时才按需只读单条目并说明」；规则 4 增「读原始文件前先确认已查过挂载且不可用」；`ges-case-index` 技能同步同一句硬规则。
- 校验：`npm test` 112/112（`tests/presets-config.test.mjs` 增至 6 例：三预设顺序/名称/只读工具面、6 份 persona 长度与关键词）；`npm run check:overlay` 扩展逐预设校验 `preset-data`/`preset-apk`/`preset-exe`（存在、名称、tool-fs 只读）；`node scripts/build.mjs` OK。
- 坑：① overlay 里现有分析预设的 `customSkillDirs` 必须写成带引号的 `!!js` 标量，否则 js-yaml 报 unknown tag / bad indentation；② 计划文档里写 `'\u0000'` 时若写成真实 NUL，会让整个 md 变 binary（本次已修复为转义文本）；③ persona 文本较长（单份 13.7 KB），替换脚本必须按缩进边界截断，不能按空行。
- 遗留：日志分析预设尚无专家 persona（用户未提供对应文件）；真实观看效果需重启 dev 预览/重新打包，打包前先 `npm run check:overlay`。

### 20.75 外部工具路径改为设置里可改（Ghidra/IDA/tshark/jadx/python/7z/sqlite3…）

- 需求来源（用户）：「先指向这里吧：`C:\Users\ASUS\.dsh\plugins\dsh-infinite-gen-5\third_party\sources\ghidra-12.1.4`，然后这些工具都支持在设置里修改路径」——① Ghidra 不再标「未装」；② persona 里提到的外部工具路径都能在设置窗口改。
- Ghidra 事实：该目录是源码树（`Ghidra/`、`GhidraBuild/`、`build.gradle`、`gradlew.bat`），Windows 入口在 `Ghidra/RuntimeScripts/Windows/ghidraRun.bat` 与 `.../support/analyzeHeadless.bat`（`support/` 下还有 bsim/ghidraClean/launch 等），所以设置项按「目录」类型校验。
- 新增 `tools/tool-paths.mjs`（纯 Node，主进程与单测共用）：`TOOL_PATH_SPECS` 12 项（ghidra/ida/tshark/capinfos/editcap/python/jadx/apktool/adb/sevenzip/sqlite3/volatility，各带 `kind:'file'|'dir'`、`env:'SEEU_TOOL_<ID>'`、开发机实测 `defaultPath`、提示文案）；`toolPathsFile()` = `<DSH_HOME>/tool-paths.json`（`SEEU_TOOL_PATHS_CONFIG` 可覆盖）；`toolPathsView()`（每项给 defaultPath/configured/source/path/exists/found）；`saveToolPaths(input)`（只处理已知 id，空串＝清除回默认，校验绝对路径/存在/类型，写 2 空格 JSON）；`toolPathsEnv()`（只注入 found 的项，供 dsh 子进程）。
- `src/tool-paths.ts` 薄层 re-export + 类型；`src/main.ts`：`new DshHost({ env: { ...mountHostEnv(), ...toolPathsEnv(process.env) } })`，并在启动时 `logShell('tool paths: 向会话注入 N 个外部工具路径…')`；新增 IPC `seeu:tool-paths:get|pick|save`（pick 按 kind 用 `openDirectory`/`openFile`，文件过滤 exe/bat/cmd/jar）；`src/preload.ts` 暴露 `window.seeu.toolPaths.{get,pick,save}`。
- 设置页 `renderer/local-model.html`：在「本机取证工具路径」下新增「外部取证工具路径（可选，可改；留空用默认实测值）」区，JS 动态渲染 12 行（状态点 + 名称 + 只读输入 + 选择… + 重置），保存按钮 `#btn-tool-paths-save`，提示「会话里以 `$SEEU_TOOL_<工具>` 为准」。
- persona 同步（`resources/forensics/cordis.patch.yml` 6 段「本机实测」+ exe 工具边界段）：Ghidra 由「未找到」改为默认源码树路径与 `analyzeHeadless.bat`；把「IDA Pro/Ghidra/…可能并不存在，必须先探测」改成「以环境变量与本机实测默认值为准」；每段末尾补「这些工具路径可以在『设置 → 本地模型与工具路径 → 外部取证工具路径』里逐项修改；会话里以 `$SEEU_TOOL_<工具>` 为准（未设置时用上面的默认值）」。
- 解析顺序（用户要求「优先使用环境变量（Path），失败再退回默认路径」）：新增 `findOnPath(command, env)`（按 `PATH` 分割 + `PATHEXT` 补全扩展名）与 `resolveToolPath()`——**设置里显式指定 → PATH 里能找到的命令 → 默认实测路径**；`toolPathsView()` 的 `source` 增加 `'path'`，`toolPathsEnv()` 注入解析后的最终路径（PATH 命中就注入 PATH 路径）；`TOOL_PATH_SPECS` 每项加 `command`（tshark/capinfos/editcap/python/jadx/adb/7z/sqlite3/idat）。设置页说明与 6 段 persona 同步改成「设置指定 → PATH 优先 → 默认路径」（先 `command -v <命令>` 或直接调命令名，PATH 找不到再用 `$SEEU_TOOL_<工具>`）。
- 测试：`tests/tool-paths.test.mjs` 6 例（默认视图/保存重读/清除回默认与类型校验/坏 JSON 不覆盖/只注入存在的项/PATH 优先且设置压过 PATH）；`tests/presets-config.test.mjs` 新增「persona 指向 Ghidra 默认路径 + 7 个预设都提 `SEEU_TOOL_`」；`scripts/e2e/settings-check.mjs` 新增 `toolPathsRows/toolPathsGhidra/toolPathsSectionVisible/toolPathsApiSaved/toolPathsUiSaved/toolPathsFileOk`（12 行、Ghidra 默认值、UI 保存落盘 `<DSH_HOME>/tool-paths.json`）。实测 `npm test` 122/122、`check:overlay` OK、settings-check `ok:true`。
- 坑：① 新增行的 class 复用 `.tool` 后，旧断言 `.tools .tool` 数到 15 行导致 `toolsSectionVisible:false`——断言改为 `.tools .tool[data-tool]`；② `kind:'dir'` 的 Ghidra 必须用目录选择对话框，不能沿用 exe 过滤；③ 路径注入只对「存在且类型对」的项生效，避免把坏路径写进会话环境变量。
- 遗留：改路径只影响新会话（dsh 启动时读环境变量）；打包版需重新打包才带上 `tool-paths` 模块与 persona 改动。


## 20.76 v0.3.4 打包交付：专家 persona + bash 优先 + 外部工具路径设置/PATH 优先

- 版本 `0.3.4`（`npm version --no-git-tag-version`）；`node scripts/build.mjs`、`npm test` **122/122**、`npm run check:overlay` OK。
- 打包：`npx electron-builder --win --x64 -c.directories.output=release-034`（日志 `.probe/pack-034.log`，无证书跳过签名）。产物搬进 `release/`（删除 0.3.3 三件）：exe `281,533,139 B`、blockmap `293,403 B`、portable `236,256,556 B`、`app.asar` `425,280,057 B`（34,095 entries）、目录版总计 `1,109,631,285 B`。
- 自检：`.probe/asar-034-check.mjs`（由 asar-033 复制并新增 10 项：`toolPathsModule`、`toolPathsPathPriority`、`toolPathsIpc`、`settingsToolPaths`、`personaToolPaths`、`devWebToolEnv`、`toolPathsE2e`、`expertPersonas`、`bashFirstPolicy`、`version034`）→ 68 项全 true、`missing:[]`。
- 启动验证：目录版 `--port 9501` → `ok:true, elapsedMs:7343`；portable `--port 9502` → `ok:true, elapsedMs:60014`。
- 打包态 e2e：`m2-ui-check` → `m2ok:true, errors:[]`；`settings-check --exe` → `ok:true`（`toolPathsRows:12`、Ghidra 默认路径、12 项保存落盘、`toolsRows:3`、`errors:[]`）；`plugins-check --exe` → `ok:true`（`bundlesOk`/`packagesOk` 真、175 个插件包、`activationFailures:[]`、`activationOk:true`）。
- 坑：① 打包态 `plugins-check` 用 grep 过滤时一度「无输出」，实际是输出走 stderr/尾部被截断，重跑看完整 JSON 即 `ok:true`，不是失败；② `docs/plan-case-index.md` 里又混进一个真实 NUL 字节使 `grep` 判定 binary，已替换为 `\u0000` 文本；③ 0.3.3 的 portable 这次能删（未被占用），`release/` 只留 0.3.4。
- 遗留：外部工具路径只影响新会话；真实 LovelyCarve/LovelySpark/LovelyMem 与镜像挂载仍未实机验证（本机未装 LovelyCarve）；MYOS → case-index.db 统一入库器仍未做（等用户指定案件）。

## 20.77 内存预设改用 StarMem 0.2.2，LovelyCarve CLI 默认路径落到 D:\Programs\LovelyCarve

- 用户指令（m13259 原文）：「现在用的是lovelymem的话后续改成starmem，这个更新：E:\CTFTools\Forensics\1-ComputerAnalysis\3-MemAnalysis\Lovelymem\starmem-v0.2.2-windows-x64-upx，lovelycarve在"D:\Programs\LovelyCarve\lovelycarve-cli.exe"」。
- 实测：`starmem.exe` 为 StarMem 0.2.2（Rust CLI，UPX 打包，11,501,568 B），用法 `starmem.exe [全局选项] <命令> [命令选项] <镜像文件>`，全局选项含 `--json/--csv/--threads/--no-progress/--show-warnings/--force/--raw-objects/--metadata/--qevm-*`；`help <命令>` 有中文说明，`--help-en` 英文。`build-info --json` 实测 `engine_identity.version: 0.2.2`。命令面 150+（`info`/`windows-info`/`system-info`/`collect`/`pslist`/`psscan`/`cmdline`/`netscan`/`malfind`/`hashdump`/`hivelist`/`filescan`/`windows.timeline`/`wechatscan`/`browser-session`/`linux.*` 等）。`lovelymem.v3.exe` 仍在本机（3.1.11）。
- 实现：`tools/tool-paths.mjs` 增加第 13 项 `starmem`（`kind:'file'`、`env:'SEEU_TOOL_STARMEM'`、`command:'starmem'`、`defaultPath` 指向该 exe）；`resources/forensics/skill-sets/memory/starmem-cli/SKILL.md` 新增（52 行：调用方式、常用命令表、collect→SQLite、符号参数、证据纪律）；overlay `preset-memory` 的 `description` 与两段 persona 改为「统一走 starmem-cli，`"$SEEU_TOOL_STARMEM" --json <命令> <镜像文件>`，PATH 兜底，lovelymem-cli 仅作最后兜底」。
- LovelyCarve：`tools/image-mount.mjs` 的 `CLI_CANDIDATES` 首位加入 `D:/Programs/LovelyCarve/lovelycarve-cli.exe`（实测 1.3.0、48,433,152 B）；`tools/lovely-tools.mjs` 的 `lovelycarve` 项新增 `defaultPath`，`toolState()` 支持 `source:'default'`（env → config → 默认）。
- 测试与校验：`tests/presets-config.test.mjs` 改为断言 memory persona 含 `starmem-cli`（并保留 `lovelymem-cli` 兜底）、技能目录同时含 `starmem-cli` 与 `lovelymem-cli`；`tests/image-mount.test.mjs` 与 `tools/lovely-cli/test/config.test.mjs` 适配「本机已装 → 走 auto/default 来源」；`scripts/e2e/settings-check.mjs` 的 `toolPathsRows` 12→13 并新增 `toolPathsStarmem` 断言；`scripts/e2e/skills-check.mjs` 的 memory 组同时断言 `starmem-cli`/`lovelymem-cli`。实测：`npm test` **122/122**、`check:overlay` OK、`build` OK、`settings-check` `ok:true`（`toolPathsRows:13`、`toolPathsStarmem` 正确）、`skills-check` `ok:true`、`starmem.exe build-info --json` 通过。
- 坑：① `starmem.exe` 是 UPX 打包，Git Bash 直接执行可能 `Permission denied`，用 `pwsh -Command "& '...starmem.exe' --help"` 或 node `execFileSync` 正常；② 旧的 `tests/image-mount` 断言「无配置 → unset」在本机会因内置候选命中而失败，已改为按来源分支断言；③ `tools/lovely-tools.mjs` 增加 `defaultPath` 后，设置页「未配置」语义从「空路径」变成「显示默认路径」，测试与文案同步。
- 遗留：真实内存镜像分析尚未跑（本机 `E:\forensics` 下未找到可用内存镜像）；`starmem` 的符号下载需要联网，离线环境只能靠自动解析/本地 PDB；v0.3.5 未打包。

### 20.78 新增「数据库取证（Database）」会话预设（0.3.5，未打包）

- 需求（用户 2026-11-12）：「接下来加入数据库取证专家，位置在相同位置」——`E:\取证桌面` 新增 `数据库取证专家.txt`（39,887 B，19:35 落盘），与前 7 份同源（弘连「取证桌面」SOP + 技能清单）。
- 来源结构：SOP 角色=数据库数字取证分析师（DatabaseRecovery 工具体系：`database-view-data` / `database-search` / `database-rebuild` / `database-export` / `sqlite-view-data` / `database-forensics-report`）；流程=受理与完整性 → 识别/目录读取 → 查看/检索/完整重构/SQLite 独立解析 → 导出与报告；红线=原件只读、不写库、不建服务、不猜密钥、命中≠事实、动态分析与删除恢复互斥。
- SeeU 适配（`resources/forensics/cordis.patch.yml` 新增 `- insert:` 块 `preset-db`，order 9，名称「数据库取证（Database）」，工具面复制 `preset-exe` 结构=persona + agent-instructions + time-context + tool-bash(win 禁用)/tool-pwsh + tool-fs 只读 + tool-fs-search + tool-jobs + skill-filesystem（不注入分组技能根）+ tool-skill + tool-ask-user + tool-todo + compaction，persona 约 7.6 KB：
  - 定位顺序改为 SeeU 实际：① 火眼索引 `/tables` 等已解析表 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/` / `mountPoint`（`ges ls/glob/grep`）→ ③ 无挂载才 LovelyCarve 镜像挂载 → ④ 原始文件按需只读；禁止全盘递归。
  - 只读复制：SQLite 连同 `-wal/-shm/-journal` 复制到 `$SEEU_WORKSPACE/db/<检材>/` 再分析；连接用 `file:…?mode=ro&immutable=1`；只读 SQL（仅 SELECT、分页、固定表/字段/时间范围）。
  - 恢复：`.recover`、freelist/overflow 页、WAL/journal 回放；MySQL InnoDB 无解析器时只对派生副本按页解析或 strings，标「部分恢复/未覆盖」，不启动数据库服务。
  - 工具现状（本机实测 2026-11-12）：python 3.13.14 + sqlite3 3.50.4；`sqlite3.exe` = `E:/CTFTools/Forensics/7-物联网取证/SQLite/sqlite3.exe`；7z 绝对路径；`strings/xxd/file` 在 PATH；路径解析 设置 → PATH → 默认，`$SEEU_TOOL_SQLITE3/PYTHON/SEVENZIP`；bash 优先、pwsh 降级。
- 校验与测试适配：`scripts/check-overlay.mjs` 的 `expertPresets` 增加 `['preset-db','数据库取证（Database）']`（名称 + tool-fs 只读）；`tests/presets-config.test.mjs` 的专项预设循环加 order 9、persona 关键词（`数据库`/`sqlite_master`/`evidence_mounts`）、bash/本机实测/`SEEU_TOOL_` 断言集合都加入 `preset-db`。
- README：§13 标题与表格加「数据库取证（Database）」行；「### v0.3.5 待发布」段加本预设说明。
- 验证：`check:overlay` OK、`npm test` 122/122。

### 20.79 融合 Qiko 专家（7 份提示词 + 75 个技能库）并进现有预设（0.3.5，未打包）

- 需求（用户 2026-11-12）：「qiko开头的是我从另一款软件里弄出来的，融合一下，skill都放在了D:\Programs\UniversalPlatform\QikoAgent\resources\skills，你帮我看看」；追加要求：「并进现有预设，不新增」+ custom「我就是为了比武比赛的，所以尽量改成比赛式」。
- 来源解析：`E:\取证桌面` 新增 7 份 qiko 提示词（微信 172.5 KB / 手机 134.8 KB / 服务器 130.5 KB / 案件研判 73.1 KB / 流量包 68.0 KB / 网络犯罪情报 56.8 KB / 计算机 133.5 KB，19:42–19:50 落盘）。格式=Qiko 通用 system 段落 + `{"model":"fake-model","messages":[...]}` 请求体；从 `{"model"` 处 JSON 解析后 `messages[0]`=system（24,029–36,072 字符），再按 `## 当前专家模式` 切出专家段（18,771–30,814 字符）。提取物在 `.probe/qiko/<专家>-system.md` / `-expert.md`。
- Qiko 技能库：75 个目录、37 MB；大头 `myos-plugin-computer` 16.5 MB、`myos-plugin-mobile` 16.1 MB、`json-report-analysis` 2.1 MB（未导入）。共 49 个取证技能复制到 `resources/forensics/skill-sets/qiko/`（1,162 KB）；随后按「保留 43、删除 6」裁剪（删 `forensic-report`、`utm-forensic-cli`、`qiko-forensic-lite-investigate`、`reverse-skill-router`、`whodb`、`forensic-sqlite-exam`，理由=长报告重复/依赖 macOS 与 ForensicLite/需 DB 客户端/路由重复/与 sqlite 深度技能重叠），技能内交叉引用改指 `myos-forensics-workflow` 与 `performing-sqlite-database-forensics`，每个 `SKILL.md` 末尾追加「SeeU 环境适配」段（`ssh-mcp`→`bash`、`ida-mcp`/`jadx-mcp`→`$SEEU_TOOL_IDA`/`$SEEU_TOOL_JADX`、Python→`$SEEU_TOOL_PYTHON`、7z/sqlite3/tshark/adb/apktool/StarMem 路径、检材定位四步、比武输出极简）。
- 映射（并进现有 9 个预设，不新增）：`preset-standard` ← 火眼+弘连服务器+Qiko 服务器/计算机；`preset-apk` 改名「手机取证（Mobile）」← APK+Qiko 手机/微信；`preset-traffic` ← +Qiko 流量包；`preset-data` 改名「数据分析与研判」← 网钜资金+Qiko 案件研判/网络犯罪情报；log/memory/exe/db/seeu-lite 保持领域，统一追加「比武比赛模式」与「本机实测」段。
- 实现：`tools/skill-sets.mjs` 的 `SKILL_SET_IDS` 加 `qiko`；`src/host.ts` 注入 `SEEU_SKILL_SET_QIKO`；overlay 给 standard/traffic/log/memory/data/apk/exe/db 加 `customSkillDirs: !!js "[…].filter(Boolean)"`（流量/日志/内存为专用组+QIKO 并集，其余仅 QIKO，`preset-seeu-lite` 不加）；`preset-data`/`preset-apk` 改名与 description 同步；4 份合并 persona（`.probe/persona-standard-v2.txt` 10,499 B、`persona-mobile-v2.txt` 8,159 B、`persona-traffic-v2.txt` 6,130 B、`persona-data-v2.txt` 7,127 B）由 4 个 subagent 起草，`.probe/apply-personas-v2.py` 按 `- id:`→`prefix: |` 区段替换并自动缩进。
- 校验：`scripts/check-overlay.mjs` 改名与 QIKO 断言；`tests/presets-config.test.mjs` 改 standard 仅注入 QIKO、专项预设名称、skill-sets 目录含 qiko 技能；`tests/skill-sets.test.mjs` 常量改 4 项；`npm test` 122/122；`check:overlay` OK；`node scripts/build.mjs` OK；`--dump-config` 确认 9 个预设与 `customSkillDirs` 表达式（standard `[QIKO]`、traffic `[TRAFFIC, QIKO]`、log `[LOG, QIKO]`、memory `[MEMORY, QIKO]`、其余 `[QIKO]`）。
- persona 体量（字符）：standard 5,668 / seeu-lite 1,416 / traffic 2,782 / log 1,208 / memory 4,074 / data 3,504 / mobile 5,144 / exe 5,586 / db 3,753；全部含 `Q<n>｜答案` 与「本机实测（2026-11-12）」。
- 坑：① 应用脚本第一版在 block 内遇到 `- id:` 就 break，把 persona 插件行当成区段结尾 → 改为「缩进 ≤ 预设行缩进且以 `- id: ` 开头」才 break；② 旧测试断言写死「禁止全盘递归搜索」「先 lovelyspark-cli」，与新 persona 措辞不一致 → 放宽为标准预设 `/(禁止|不许).{0,4}全盘递归/`、流量 `先 load \`lovelyspark-cli\``；③ Qiko 通用段落里的工具名（ssh-mcp/ida-mcp/jadx-mcp、`C:\Users\HP\.workbuddy\...`）必须整体删除，否则模型会去找不存在的 MCP。
- 遗留：Qiko 图片鉴伪/隐写、URL 溯源技能需要联网或额外模型时只能出「本地痕迹结论」；`myos-plugin-*` 两个大插件未导入（体积）；v0.3.5 未打包。

- 追加（同日）：用户要求「apk分析不能放手机取证啊，要隔开」⇒ 拆成两个独立预设：`preset-apk`（7）恢复为「APK 分析」（原弘连 APK 专家 persona + Qiko `apk-reverse`/`apk-dynamic-forensics`/`android-malware-analysis`，只处理样本本身），新增 `preset-mobile`（10）「手机取证（Mobile）」（Qiko 手机/微信 persona，iOS/Android/鸿蒙、提取包、备份、微信/IM 与应用数据，APK 深挖指引切换预设）；两者都用 `customSkillDirs: [SEEU_SKILL_SET_QIKO]`；`check-overlay` 的 `expertPresets` 与 `tests/presets-config.test.mjs`（专项预设 4→5、mobile persona 关键词、本机实测段）同步；`npm test` 122/122。

- 追加（同日，持续改善）：`tools/skill-sets.mjs` 的 `installSkillSet` 增加 prune —— 复制完成后列出目标目录文件，删掉不在随包清单里的旧文件并清理空目录，返回 `pruned` 计数；这样随包技能删减/改名后，已安装的 `<DSH_HOME>/skill-sets/*` 不会残留旧技能（此前只增不删，9 个预设仍会看到已裁掉的技能）。`tests/skill-sets.test.mjs` 新增「随包删除技能后重新安装会 prune 旧技能」用例（5/5）。`npm test` 122/122。
- v0.3.5 打包（提交见 release commit）：`npx electron-builder --win --x64 -c.directories.output=release-035`；产物 NSIS `281,858,620 B`（blockmap 293,867 B）、portable `236,534,010 B`、`app.asar` `426,401,524 B`（34,213 entries）、目录版总计 `1,110,752,752 B`；`.probe/asar-035-check.mjs` 76 项全 true；打包态 `m2-ui-check`/`settings-check`（13 行工具路径含 starmem，日志文案由 12 改 13）/`plugins-check`/`skills-check`（Qiko 43）全绿；`verify-launch` 6192 ms / portable 50833 ms；README 产物表与 `docs/packaging.md`「v0.3.5 回归验证」同步。

- v0.3.6 目标：面向「Spark 单机 qwen3.8-flash-next / Spark 双机 dsv4.1-flash」两种本机部署的适配。设置页新增「本机部署」两个预设按钮（一键填模型/窗口/输出/超时/空闲超时/重试/精简工具集/流式用量/标题生成），先生成 `local-model.json` 再落到 `local-model.patch.yml`；启动探测行识别网关模型并标注「Spark 单机/双机部署」。`scripts/e2e/settings-check.mjs` 新增 `deploySingle`/`deployDual` 断言（单机 131072+lite、双机 262144+完整工具集），dev 实测 `ok:true, errors:[]`；`npm test` 122/122、build OK。

- v0.3.6 持续优化（第 2 轮）：探测结果新增 `latencyMs`（`/v1/models` 往返毫秒）与 `deploy`（`detectLocalDeploy()` 按模型 id 推断 `spark-single`/`spark-dual`，放 `tools/local-model.mjs` 并 re-export）；设置页探测行与欢迎页「本地模型」chip 显示部署类型 + 延迟（`data-seeu-local-model-deploy` 属性便于 e2e）；`tests/local-model.test.mjs` 增加 7 组断言（123/123）；`settings-check` 新增 `probeLatencyMs>0` 断言（dev 实测 8 ms），`hero-check` 实测 chip 文本「128k · 网关可用 · 694 ms」。坑：模板字符串里手写反引号时多打了一个单引号，esbuild 报「Expected ")" but found "local"」——看报错列号对到模板起点的字符能快速定位。

### 20.80 真实工具基准（第 3 轮）：LovelyCarve 真机挂载修复 + LovelySpark/StarMem 实测

- 素材：`W:\` 下 5 个真实检材（`AP3_LEUNG_YL_USB.E01` 776,733,201 B、`CHAN_MH_mobile.zip` 249,278,021 B、`FUNG_CC_mobile.zip`、`IQ_Coin_Type_Transactions.zip`、`LEUNG_YL_mobile.zip`、`blk0_sda.bin`）；pcap 在 `E:/CTFTools/Forensics/8-流量分析/题目/`（`L1-6.pcapng` 86,507 B 最小）；内存工具在 `E:/CTFTools/Forensics/1-ComputerAnalysis/3-MemAnalysis/`，唯一可当镜像的样本是 `E:/CTFTools/Forensics/8-流量分析/w3流量分析工具/Examples/CS流量/cs4内存解密流量/pid.6492.dmp`（472,240,128 B，StarMem 识别为 raw）。
- 新增 `scripts/e2e/real-tools-bench.mjs`（`npm run test:e2e:real-tools`）：可在本机真实样本上跑 LovelyCarve（inspect → mount → 列目录 → unmount）、LovelySpark（`tools/lovely-cli/cli.mjs lovelyspark -- analyze <pcap>`）、StarMem（`--json info <镜像>`）；工具/样本不存在就标 `skipped`，不假装跑过；路径优先环境变量（`SEEU_LOVELYCARVE_CLI`/`SEEU_LOVELYSPARK_EXE`/`SEEU_TOOL_STARMEM`），否则用开发机默认路径。
- 实测结果：LovelyCarve 1.3.0：inspect **162 ms**（2 个分区）、mount part 0 → `X:` **266 ms**、`X:\` 可见 `System Volume Information`/`WEPE`/`Sunny.zip`/`vera_key`、unmount **154 ms**。LovelySpark 0.3.20：首次冷启动 11.3 s、`analyze` 86 KB pcap **9.0–13.3 s**（27 个模块，分析库写在检材同目录 `<pcap>.db.generations/`）、`investigate` 复用分析库 8.8 s。StarMem 0.2.2：`info` **525 ms**（`engine_identity.version=0.2.2`、`format=raw`）；`windows-info` 15.9 s 失败（`no decoded physical KDBG was found`），`pslist`/`netscan` >180 s 未返回 ⇒ 该样本不是完整内存镜像，采集类命令需用户提供全内存镜像。
- 修复 LovelyCarve 真实挂载链路的两个坑（bug 只在真 CLI 上暴露，假 CLI e2e 一直绿）：
  1. `--case` 只能作为进程启动参数；会话里再带 → `{"error":{"code":"invalidInput","message":"--case 只能在启动时使用；会话中请用 cases open"}}`，且 `shell` 模式下任何错误都会让 CLI 退出（code=1），后续命令全废。改为：`ensureCaseFolder()` 用 `spawnSync` 一次性 `cases create <dir> --name "SeeU 镜像挂载"`（已有 `case.db` 则复用，并清掉上次异常退出留下的空 `case.lock`）→ 常驻 `lovelycarve-cli -q --case <dir> shell`（`LovelyCarveHost` 新增 `startArgs`）→ `images open`（用 `openedImages` 记录，避免重复 open 触发退出）→ `mounts create /part:N --mount-point X:`。
  2. LovelyCarve 1.3.0 的 `mounts delete <id> --force` **会真的卸载，但不返回任何 JSON**；按原实现等响应会一直挂到 180 s 超时。改为 `LovelyCarveHost.write()` 只写命令，然后轮询盘符是否存在（12 s，150 ms/次），必要时兜底 `host.stop()`（进程退出 = 系统释放挂载），卸载实测 **154 ms**。
  3. 附带：进程异常退出后 `mounts.json` 里残留的记录，会在 `status()` 时按盘符存在性自动清理（`host` 未运行时）。
- 文档：新增 `docs/benchmarks.md`（机器/版本、三条结果表、复现命令、对产品的直接影响：挂载亚秒级、LovelySpark 10 秒级、内存采集依赖完整镜像）；README 新增「### v0.3.6 待发布（未打包）」段并在 §10「镜像挂载」补「真机验证（2026-11-12）」与实现细节；`package.json` 加 `test:e2e:real-tools`。
- 验证：`node scripts/e2e/real-tools-bench.mjs` → `ok:true`（lovelycarve/lovelyspark/starmem 三段均 ok）；`npm test` 全绿（image-mount 4/4 假 CLI 全链路）；`node scripts/build.mjs` OK。
- 遗留：StarMem 采集类命令待完整内存镜像；LovelySpark 分析库写在检材目录（只读介质需先复制 pcap）；真实挂载依赖 Dokan（本机可用，普通用户权限下已验证）。

### 20.81 挂载窗口可读性 + 实测数字写进技能（第 3 轮继续）

- 背景：第 3 轮真实基准发现「挂载能成功但窗口只给一行原始错误、也看不到耗时」，且技能里没有真实耗时概念，模型容易重复 analyze/反复挂载。
- 后端 `tools/image-mount.mjs`：`inspect`/`mount`/`unmount` 返回值加 `ms`（`Date.now()` 差值，失败也返回）；新增导出 `mountErrorHint(message)`（Dokan/管理员 → 提权提示；案件锁/already contains a case → 关桌面端；检材已打开 → 直接挂/刷新；ENOENT/不存在 → 重选镜像；盘符占用 → 换盘符；其余 undefined）；`status()` 的 `cli` 增加 `version`（`cliVersionOf` 用 `spawnSync --version` 取一次并按 CLI 路径缓存，失败不影响主流程）。
- 界面 `renderer/mounts.html`：CLI 卡片显示「已找到 · 1.3.0」；新增 `#timing` 行显示「最近操作：解析 162 ms · 挂载 266 ms」（`fmtMs`/`noteTiming`，超过 1 s 用秒）；解析/挂载失败时把 `hint` 拼在错误后面；卸载成功 toast 带耗时。
- 技能（让模型知道真实节奏）：`lovelycarve-forensics` 加「附录 · SeeU 外壳里的挂载」（入口、真机耗时 160/270/150 ms、`$SEEU_MOUNTS_FILE` 先看已挂载、`--case` 与 `mounts delete --force` 两个坑）；`skill-sets/{traffic,log}/lovelyspark-cli` 加「耗时实测」段（冷启动 ~11 s、analyze 约 9–13 s、分析库在检材同目录、`investigate` 复用 8–9 s、别重复 analyze）；`skill-sets/memory/starmem-cli` 加「耗时实测」段（`info` ~0.5 s、采集类命令需完整内存镜像、raw 进程转储会报 no decoded physical KDBG）。
- 测试/回归：`tests/image-mount.test.mjs` 增 `mountErrorHint` 用例并断言 inspect/mount/unmount 的 `ms`（5/5）；`scripts/e2e/mount-check.mjs` 断言 `inspect.ms`/`mount.ms`/`unmountMs` 且页面接线存在（`timingWired`，UI 直接调用 API 时不会触发 `noteTiming`，所以断言元素与 `noteTiming` 逻辑而非文案）；`npm test` **125/125**、`check:overlay` OK、`build` OK、`mount-check` 全绿（inspect 217 ms / mount 588 ms / unmount 1 ms）。
- 坑：inspect 的「文件不存在」早返回原来不带 `hint`，导致单测拿不到提示 —— 三个早返回统一补 `hint`/`ms`。

### 20.82 欢迎页「本机工具」chip（第 4 轮）

- 需求：把「外部工具就绪度 + 当前挂载数」放到欢迎页，一眼看出环境是否齐、有没有挂载中的镜像；避免每次都要打开设置核对。
- 实现 `plugins/seeu-theme/client.js` 的 `HeroActions`：新增 `tools` 状态（`shell.toolPaths.get()` → `ready/total`，`shell.mounts.get()` → `mounts.length`），只在外壳 API 存在时渲染；`data-seeu-tools="13/13"`、`data-seeu-mounts="0"`，文案「本机工具：13/13 就绪 · 镜像挂载 0」，全部就绪绿点、否则琥珀点，点击打开设置窗口。
- e2e `scripts/e2e/hero-check.mjs` 新增 `toolsText/toolsChip/toolsOk` 断言；实测 `toolsOk:true`、文本「本机工具：13/13 就绪 · 镜像挂载 0」，其余 chip/入口/窗口/面板断言不变。
- 验证：`node scripts/build.mjs` OK、`hero-check` `ok:true`、`npm test` 125/125；未改后端，无打包影响。

### 20.83 思考流（reasoning）格式可配：Spark 单机 Qwen enable_thinking / 双机 dsv4.1 reasoning_content（第 5 轮）

- 问题：两种本机部署的思考流暴露方式不同 —— qwen3.8-flash-next 需要 `chat_template_kwargs.enable_thinking=true` 才吐思考；dsv4.1-flash 走流式 `reasoning_content`。之前统一 `auto`，Qwen 系「看不到思考」、推理模型的长思考也可能被当成普通文本。
- `tools/local-model.mjs`：新增 `THINKING_FORMAT_OPTIONS`（auto / deepseek / qwen-chat-template / qwen / chat-template / string-thinking）；`normalizeLocalModel` 增加 `thinkingFormat`（非法值回 auto）与 `chatTemplateKwargs`（只接受普通对象）；`localModelPatch` 在 `compat` 里写 `thinkingFormat`（auto 不写）与嵌套 `chatTemplateKwargs`。
- 设置页 `renderer/local-model.html`：高级区新增「思考流格式」下拉与「chat_template_kwargs（JSON，可选）」文本框；保存/回填/预览联动，JSON 非法时静默按空处理；Spark 单机预设自动 `qwen-chat-template` + `{"enable_thinking":true}`，双机预设 `deepseek`。
- 测试：`tests/local-model.test.mjs` 新增「思考流格式」用例（auto 不写、deepseek/qwen-chat-template 写进 provider compat、kwargs 键值透传、非法值回 auto、数组 kwargs 被忽略）；`scripts/e2e/settings-check.mjs` 的 `deploySingle/deployDual` 断言格式与 kwargs、保存后 `written.thinkingFormat === 'deepseek'`。
- 坑：`str()` 对 undefined 返回 undefined → `(str(...) || 'auto').toLowerCase()`；把 patch 文本 `YAML.parse` 得到的是数组，取 `rows[0].config.providers[route]` 才能看到 compat。
- 验证：`npm test` 126/126、`check:overlay` OK、`build` OK、`settings-check` 全绿（含 `thinkingSaved:true`、单机 `qwen-chat-template` / 双机 `deepseek`）。

### 20.84 能力自检扩展到流式与思考流（第 6 轮）

- 动机：本机部署最容易出问题的三处——流式（不返回 `stream:true` 会白屏/卡住）、思考流（Qwen 看不到思考）、工具调用（不能查库）。之前自检只覆盖模型列表/对话/工具，流式与思考只能靠会话试。
- `src/local-model.ts`：`DiagnosisItem.key` 扩展 `'stream' | 'reasoning'`；新增 `probeStream()`（`stream:true` 逐块读 SSE，统计首字延迟、正文字符数、`reasoning_content`/`reasoning` 字符数；按 `GatewayProbeInput.thinkingFormat` 带 `chat_template_kwargs.enable_thinking` 或 `reasoning_effort:'low'`）；自检顺序改为 模型列表 → 基础对话 → 流式输出 → 思考流 → 工具调用；`auto` 模式下思考流未返回不算失败（非推理模型正常），显式格式下未返回则标红并提示检查模型/开关。
- 设置页：`api.diagnose({ baseURL, apiKey, model, thinkingFormat })` 传当前思考流格式；汇总行区分「流式不可用」「未看到思考流」两类提示。
- e2e：`scripts/e2e/settings-check.mjs` 的 mock 网关支持 `stream:true`（先回两段 `reasoning_content` 再回正文与 `[DONE]`）与 `tools`（回 `ping_tool` 调用）；新增 `diag` 断言五项全 ✓、`report.diagItems/diagOk`。
- 坑：用 python heredoc 往 TS/HTML 里写 `'
'`、`/
?
/` 会被吃掉一层反斜杠 → 生成真实换行，`esbuild` 报 `Unterminated string literal`、设置页脚本静默失败（表现为「勾选流式用量后 preview 未更新」）。这类改写后要 `node --check` 提取出的脚本，并优先用 `String.fromCharCode(10)` 代替转义。
- 验证：`npm test` 125/125、`check:overlay` OK、`build` OK、`settings-check` 全绿（`diagItems` 五项 ✓、`thinkingSaved:true`）。

### 20.85 v0.3.6 打包与打包态回归（第 7 轮）

- 目的：把 Qiko 融合、StarMem、检材优先级、挂载链路修复、思考流格式、五项自检、caseNumber 查询等累积改动打成一个可交付版本，并按老流程做打包态回归。
- 版本：`npm version 0.3.6 --no-git-tag-version`；build、`npm test` 125/125、`check:overlay` OK；`npx electron-builder --win --x64 -c.directories.output=release-036`（exit 0，约 15 分钟）。
- 产物：NSIS **281,864,757 B**（blockmap 293,917）、portable **236,497,369 B**、`app.asar` **426,435,518 B（34,213 entries）**、目录版 1,110,786,746 B；已搬进 `release/`（0.3.5 三件删除）。
- asar 自检 `.probe/asar-036-check.mjs`（由 035 复制）：新增 `thinkingFormat`/`diagnoseStream`/`diagnoseItems`/`mountTiming`/`heroToolsChip`/`version036`，最终 **82 项全 true**。两处误报修复：`key: 'stream'` 在 esbuild 产物里是双引号；`mountErrorHint` 编译进 `dist/main.cjs` 而非 `mounts.html`。
- 打包态验证：目录版冷启动 5088 ms、portable 52,954 ms；`m2-ui-check`/`settings-check`（五项自检全 ✓、thinkingSaved）/`plugins-check`（175 包、0 激活失败）/`skills-check`/`hero-check`（工具 chip 13/13）/`mount-check`（解析 164 ms）全绿。
- 沟通口径：本轮为「打包 + 回归」，无新功能；待用户验收安装包，并继续等待真实网关与完整内存镜像做真机基准。

### 20.86 建库进度可读化（第 8 轮）

**需求**：面板建库时只有 `fetch 21.9%` 这种原始字段，看不出阶段含义、已用时间、还要多久。

**实现**
- 新增 `tools/ges-index/progress.mjs`：`BUILD_PHASE_LABELS`（probe/enumerate/fetch/finalize/done/failed）、`buildPhaseLabel`、`formatDuration`、`describeBuildProgress(job, now)` → `{status,running,phaseLabel,elapsedMs,elapsedText,detail,etaText,percent,hint,summary}`。
- `plugins/seeu-case-index/index.js`：`GET /build` 返回 `{...job, progress: describeBuildProgress(job)}`；`onProgress` 透传 `etaMs`（否则面板拿不到剩余时间）。
- `plugins/seeu-case-index/client.js`：进度卡渲染 `phaseLabel`、`detail`、`已用 …`、`剩余约 …`、`hint`（>90 秒）、`summary`（完成/失败）。
- `tools/ges-index/progress.mjs` 另加 `findRunningBuild(jobs, dir)`；`startBuild` 检测到同目录已有运行中任务时直接返回 `{jobId, existing:true}`（实测两次 POST 返回同一 jobId）。
- 单测 `tests/progress.test.mjs` 6 例。

**坑**
1. 实际 phase 是 `probe/enumerate/fetch/finalize`，不是最初以为的 `evidences/records/entities`；标签表必须按 `build.mjs` 里的 `progress({ phase })` 实际值写。
2. 同一案件**并发两次 build 会互相踩 `building` 库**（实测 17 个叶子失败 → `E_VALIDATION`）；面板/接口要避免重复提交，e2e 也要串行。
3. 运行中 job 的 `elapsedMs` 只在结束时写入，必须由 `describeBuildProgress` 用 `startedAt` 现算，否则面板「用时」一直是 0。
4. `formatDuration(34_500)` 走四舍五入 → 35 秒，单测断言要按同样规则写。

**验证**：dev 预览直连 `POST /seeu-index/build` + 轮询 `GET /build`：阶段中文名/实时已用/百分比/ETA 连续可见；真实案件全量重建约 4–5 分钟；单测 6/6、`npm test` **132/132**、build OK。

**遗留**：完成后摘要仅在面板进度卡显示，未写入案件概览；`rebuild` 期间的取消能力尚未提供。

### 20.87 索引规模/新鲜度写进会话概览（第 9 轮）

**需求**：AI 会话只看到检材表，不知道索引规模、建库时间、是否完整；用户问「数据齐不齐」时模型无法判断。

**实现**
- `tools/ges-index/query.mjs` 的 `findIndexes()` 额外读取 `manifest.json`，带回 `durationMs/counts/leaves/coverageOk/integrityOk`（manifest 缺失时全为 null）。
- 新增 `tools/ges-index/index-meta.mjs`：`formatBytes`、`formatBuiltAt`（本地时区 `YYYY-MM-DD HH:mm`）、`indexSummary(index, now, staleDays=7)` → `{text, warn, stale, ageDays}`。
- `plugins/seeu-case-index/index.js` 的 `briefText()` 在「规模」行后插入 `- 索引：…`，有告警时再插一行 `⚠ …`。
- 单测 `tests/index-meta.test.mjs` 5 例。

**坑**
1. `formatBytes` 对 2 KiB 这类小值不能用 `toFixed(1)` 直接拼（会显示 `0.0 MiB`）→ 小于 0.1 MiB 直接写 `0 MiB`，单测按此断言。
2. 概览里 `builtAt` 原本只有 ISO 字符串，直接给模型 2026-11-12T15:55:xxZ 不如本地时间直观 → 统一 `formatBuiltAt` 转本地时区。
3. `durationMs` 在 manifest 里是毫秒、可能缺省 → 小于 1 分钟四舍五入到「N 秒」，至少 1 秒，避免 `0 秒`。

**验证**：dev 预览 `POST /seeu-index/brief` 后 `.dev/dsh-home/AGENTS.md`（2,728 字符）出现「索引：22,776 条记录 · 8,191 个实体 · 360 个检材文件 · 建库 2026-11-12 23:55（用时 3 分 3 秒） · 库 63.0 MiB」；`npm test` **136/136**。

**遗留**：概览只列前 5 个案件（既有逻辑）；「索引过旧」阈值暂固定 7 天，未做设置项。

### 20.88 面板索引列表显示规模/新鲜度（第 10 轮）

**需求**：上一轮把索引规模/建库时间写进了会话概览，但面板列表仍只有「案子名 + 体积 + 时间」，用户看不出记录/实体数与「是否需要重建」。

**实现**
- `plugins/seeu-case-index/index.js` 的 `GET /list`：`indexes.map((ix) => ({ ...ix, meta: indexSummary(ix) }))`（与写入 AGENTS.md 的摘要同源）。
- `plugins/seeu-case-index/client.js`：索引卡片从单行改为两行——主行（案件名/案号/体积/生成时间），副行 `meta.text`（title 悬停显示全文）；`meta.warn` 存在时再显示 `⚠ …`（琥珀色 `#F5A524`）。
- `scripts/e2e/m2-ui-check.mjs`：新增 `indexMeta`（文本含「条记录」「个实体」「建库 YYYY-MM-DD HH:mm」）与 `indexMetaText` 记录，纳入 `m2ok`。

**坑**
1. 面板卡片原来 `alignItems:'baseline'` 的单行结构，直接塞长文本会挤掉时间 → 改成 `flexDirection:'column'` 两行，主行内部再 `flex`。
2. `meta` 字段必须由服务端算：客户端重复实现会出现「概览与面板不同口径」，且未来改阈值要改两处。

**验证**：`m2-ui-check`（dev，隔离 home）→ `indexMeta:true`、`indexMetaText:"索引：22,776 条记录 · 8,191 个实体 · 360 个检材文件 · 建库 2026-11-12 23:55（用时 3 分 3 秒） · 库 63.0 MiB"`、`m2ok:true`、`errors:[]`。

**遗留**：卡片未提供「重建」快捷按钮（目前要先选中库再点建库）；过期阈值未做成设置项。

### 20.89 建库可取消（第 11 轮）

**需求**：真实案件全量重建 3–5 分钟，误点/等不及只能干等或杀进程。

**实现**
- `tools/ges-index/build.mjs`：`buildIndex({ ..., signal })`，内部 `assertNotAborted()`（探测后、枚举后、worker 每轮开头、抓取 Promise.all 之后）；取消时 `db.close()` + `rmSync(buildingPath)` + 抛 `IndexBuildError('E_CANCELLED')`（旧 `case-index.db` 不动）。
- `plugins/seeu-case-index/index.js`：job 持 `AbortController`，`signal` 传入；新增 `POST /build/cancel`（404 无任务 / 409 已结束 / 200 已请求取消）；catch 里 `E_CANCELLED` → `status:'cancelled'`，`GET /build` 不再序列化 `abort`。
- `plugins/seeu-case-index/client.js`：进度卡运行时显示「取消建库」（琥珀色），仍按 700 ms 轮询；`cancelled` 清空 busy 不报错。
- `tools/ges-index/progress.mjs`：`BUILD_PHASE_LABELS.cancelled='已取消'`、`cancellable=running`、摘要「已取消建库（用时 X），旧索引保持不变」。
- 单测 `tests/progress.test.mjs` +1 例（共 7 例）。

**坑**
1. `GET /build` 直接 `{...job}` 会把 `AbortController` 也塞进响应（序列化成 `{}`）→ 解构剔掉 `abort`。
2. 取消不是抢占式：只有走到检查点才生效，若正卡在一次 `ges` 调用上，要等它返回（实测 25 秒才变成 `cancelled`）。
3. 取消发生在建库中期时要清理 `.building`，否则下次「重跑」会 resume 到半成品；清理后旧库仍可查询。

**验证**（dev 预览直连插件 API）：
- `POST /build` → 9 秒后 `POST /build/cancel` → 轮询到 `status:"cancelled"`、`summary:"已取消建库（用时 25 秒），旧索引保持不变"`；
- `.seeu-index/` 下无 `building` 文件；`case-index.db` 的 mtime/大小不变（1794498935 / 66,080,768 B）；
- `npm test` 137/137。

**遗留**：取消后没有「保留半成品以续跑」入口；取消按钮只在建库进度卡出现。

### 20.90 修复 dsh-auth cookie 累积导致首页 431（第 12 轮）

**现象**：0.3.7 打包态 `hero-check --exe` 失败，`actions:[]`、`bodyHead:""`；不只打包版，0.3.6 及更早同样会中招 —— 只是需要累积几十次启动。

**定位过程**
1. 先把 hero 等待从 30 s 提到 120 s 仍失败，加 `bodyHead` 诊断确认页面正文为空（不是「加载慢」）。
2. CDP 探针（`.probe/hero-probe2/4/6.mjs`）：`Page.navigate` 到 `http://127.0.0.1:<port>/?token=…` 时 `Network.responseReceived` 只有 `{"Connection":"close"}`，`Log.entryAdded` 报 `431 (Request Header Fields Too Large)` —— Node `clientError` 的 HPE_HEADER_OVERFLOW 特征。
3. `requestWillBeSent` 的头只有 210 字节，但 `requestWillBeSentExtraInfo` 显示 **Cookie 头 15,958 字节**（总 16,550 > Node 默认 16 KB）。
4. `Storage.getCookies`：127.0.0.1 下有几十条 `dsh-auth-<hash>`，每条 ~225 B，值为 `v1.<base64url JSON>`，JSON 里 `authority:"127.0.0.1:<端口>"` —— **cookie 按域名存，不区分端口**，外壳每次换端口（dev 预览/打包版/每次重启端口不同）就多一条。
5. 外壳 `src/main.ts` 用 `app.setPath('userData', …\SeeUForensicsAgentPlus)`，所以用户机器上的 jar 会真正累积，不是测试环境特有。

**实现**
- `tools/auth-cookies.mjs`：`decodeAuthCookieAuthority(value)`（去 `v1.` → base64url → JSON.authority，坏值返回 `''`）、`pickStaleAuthCookies(cookies, origin)`（`dsh-auth-` 开头且 authority ≠ `host:port`，解不开的也算旧）。
- `src/auth-cookies.ts`：薄层 re-export（主进程用）。
- `src/main.ts`：`pruneStaleAuthCookies(url)` → `cookies.get({domain: hostname})` → `pickStaleAuthCookies` → 逐个 `cookies.remove('http://<hostname>/', name)`，日志带「检查到 N 条、清理 M 个」；host ready 回调里 `void pruneStaleAuthCookies(state.url).finally(() => target.loadURL(state.url))`，**先清理再加载**。
- e2e `scripts/e2e/auth-cookie-check.mjs`（`npm run test:e2e:auth-cookies`）：在 loading.html（`file://`）阶段通过 CDP `Storage.setCookies` 塞 80 条旧端口 cookie（`expires` 次日，约 18 KB），然后等外壳页渲染；断言日志「清理 80 个」、页面正文非空、剩余 `dsh-auth` cookie ≤2。

**坑**
1. 第一版 e2e 想「两次启动共享 userData」自然累积，失败：dsh-auth 是**会话 cookie**，进程被 kill 后不落盘，第二次启动「检查到 0 条」——必须显式播种。
2. 播种时机要在 `loading.html` 阶段（host 还没 ready、清理还没跑）；等外壳页出现再播种就晚了。
3. 不能只等「页面有文字」：loading 页本身有文字，会假通过；要等 `http://127.0.0.1` 的外壳页。
4. 日志改「检查到 N 条，清理 M 个」常量化，e2e 才能断言到具体数量（只打「清理 M 个」且 M=0 时无法区分「没跑」和「跑干净了」）。

**验证**
- 单测 `tests/auth-cookies.test.mjs` 4/4；`npm test`（含）141/141；`check:overlay` OK；build OK。
- e2e：`{"ok":true,"seeded":80,"pruned":80,"rendered":true,"authCookies":1,"pruneLine":"auth cookies: 检查到 80 条，清理 80 个旧端口的 dsh-auth cookie…"}`。

**遗留**：只在 127.0.0.1 上清理；若将来支持远程 dsh 地址，需要按真实 host 处理。

## §20.91 v0.3.7 打包与回归（第 12 轮）

**背景**：第 12 轮修复「跑久了首页 431 白屏」（见 §20.90）后需要重新出包，把第 8~12 轮的建库进度/取消、索引元数据、cookie 清理一起发布。

**产物**（无签名，约 15 分钟）：NSIS `281,815,681 B`（blockmap 293,228 B）、portable `236,553,590 B`、`app.asar` `426,333,279 B`（34,193 entries）、目录版 1,110,684,507 B。

**验证**：`.probe/asar-037-check.mjs` 89 项全 true、`missing:[]`；目录版冷启动 5,092 ms、portable 46,641 ms；打包态 `m2-ui-check` / `settings-check --exe`（diag 五项、13 行工具路径）/ `plugins-check --exe`（175 包、`activationFailures:[]`）/ `skills-check --exe`（qiko 43 个）/ `hero-check --exe`（首页正常，431 修复生效）/ `mount-check --exe`（挂载 361 ms）全绿；dev `auth-cookie-check` 播种 80 条旧 cookie → 清理 81 条、页面正常渲染；`npm test` 141/141、`check:overlay` OK。

**坑**
1. `nohup node_modules/.bin/electron-builder … &` 挂在被 shell 收回的进程组里，构建目录只剩半成品日志也没有；应该用受管后台任务。
2. 半成品 `release-037/win-unpacked` 残留导致第二次构建 `ENOENT rename electron.exe`；打包前必须清输出目录。
3. asar 内的 `package.json` 不含 `scripts`，检查 `test:e2e:*` 脚本是否存在要读仓库 `package.json`。
4. hero e2e 匹配 URL 要同时接受 `/?token=…` 与 `/`（页面加载后前端 replaceState 会去掉 token）。

### 20.92 MYOS 取证结果 → SeeU 索引库导入器（第 13 轮）

**需求**：用户早前要求「超级取证大师（MYOS）与火眼两个软件融合，最后数据入库，AI 能快速读取」；MYOS 的结果库是加密 `.mfs`，只能经 MCP 的 `sqlite_query` 读，因此需要一个导入器把行写进 SeeU 统一的 `case-index.db`。

**实现**：新增 `tools/myos-index/`：
- `mcp.mjs`：`MyosMcpClient`（stdio 行 JSON-RPC、`initialize`/`tools/list`/`tools/call`、`isError` 抛错、`withMyosClient`），服务端默认 `D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe`（`SEEU_MYOS_MCP` 覆盖）；`.mjs` 服务端用 `SEEU_MYOS_NODE`/node 跑，作为测试缝。
- `import.mjs`：`listMyosCases`/`listMyosMaterials`/`readMyosRows`（经 `myos-forensics.query_cases|query_materials|sqlite_query`），`mapMyosRow` 按列名猜 app/account/time/正文，`importMyosRows` 复用 `tools/ges-index/parse.mjs` 的 `DDL`/`SCHEMA_VERSION`/`extractEntities` 整库重建写 `case-index.db` + `manifest.json`（meta 记 `tool=seeu-myso-import`、`source_db`、`source_sql`；evidence `type=myos`；artifact `virtual_path=myos://<案件>/<表>`）。
- `cli.mjs`：`cases` / `materials` / `tables` / `import`，`package.json` 加 `myos:import`。

**验证**：`tests/fixtures/fake-myos-mcp.mjs` 假服务端 + `tests/myos-index.test.mjs` **9/9**（握手、错误、案件/检材归一、行读取、字段映射、建库+FTS+实体、`findIndexes` 能发现导入的索引、参数解析）；`npm test` **150/150**。

**坑**：① MYOS 未启动时所有工具返回「请先运行 MYOS 取证软件」，真机端到端要用户先开软件；② `.mfs` 用 `node:sqlite` 直接打开报 `file is not a database`，必须走 MCP；③ `extractEntities` 的 kind 是英文（email/url/ip/phone/wallet），不要再用中文 `ENTITY_TYPES` 过滤；④ manifest 不写则面板只能显示库大小、没有规模/建库时间。

**遗留**：面板里的「从 MYOS 导入」入口（选案件/检材/表可视化）与真机导入端到端尚未做；下一步可在 `plugins/seeu-case-index` 增加 `/myos/*` 路由与面板按钮。

### 20.93 面板「从 MYOS 导入」入口（第 14 轮）

**实现**：
- 宿主端新增 `plugins/seeu-case-index/myos.mjs`：`myosCases` / `myosMaterials` / `myosTables` / `myosImport`，统一把 MCP 错误归一为可操作提示（未启动 → 503「先启动超级取证大师」；找不到服务端 → 503 提示 `SEEU_MYOS_MCP`；其它 → 502）。
- `plugins/seeu-case-index/index.js` 新增 `/seeu-index/myos/{cases,materials,tables,import}`（POST import 用 `readBody`，最大 64 KB；outDir 由面板选择，导入后写 `<outDir>/.seeu-index/case-index.db`）。
- `plugins/seeu-case-index/client.js` 新增 `MyosDialog`（案件/检材下拉、结果库路径、列出表、SQL、输出目录、案件名/检材名、导入结果），面板工具栏加「从 MYOS 导入…」按钮；导入成功回调里 `scan()` 并切换到新库。
- `electron-builder.yml` 的 `files` 增加 `tools/myos-index/**`（插件运行时动态 import，必须原样进 asar）。

**验证**：`tests/plugin-myos.test.mjs` 6/6（列案件/检材/表、导入建库、缺参 400、服务端缺失 503）；`npm test` **156/156**；`check:overlay` OK、build OK；`m2-ui-check` 新增 `myosImportOk`（按钮 + 弹窗文案）→ `m2ok:true, myosImportOk:true, errors:[]`。

**坑**：① `MyosDialog` 用了不存在的颜色常量 `C_BG`，导致 slot entry crash（`ReferenceError: C_BG is not defined`），改用 `C_BG1`；② 对话框在 `useEffect` 里调用后声明的 `pickCase`，靠 React 副作用执行时机（渲染后）避免 TDZ，后续若改成同步调用要提前声明；③ MYOS 未启动时弹窗仍可打开，只是案件列表显示 503 提示（不要把「打不开」当成 UI bug）。

**遗留**：真实 MYOS 端到端导入（需用户启动软件并选结果库）；结果库路径仍要手工粘贴，可在 `query_phone_forensics_results_overview` 返回里自动取 `mfs` 路径。

### 20.93 补：自动发现 MYOS 结果库（第 15 轮）

- `tools/myos-index/import.mjs` 新增 `collectMfsPaths(payload)`（深度遍历结果概览 JSON，收集 `.mfs` 路径 + `sqliteQueryHints` 的表名提示）与 `listMyosResultDbs(client,{caseId,materialId})`（手机走 `query_phone_forensics_results_overview`，计算机走 `query_computer_forensics_results_overview`，单个失败忽略）。
- 宿主 `myosResultDbs` + 路由 `GET /seeu-index/myos/dbs`；面板弹窗选案件/检材后自动加载下拉（`结果库 · N 张表 · 路径`），选中即填 `dbPath`/表清单/SQL，仍保留手填。
- 测试：`tests/myos-index.test.mjs` 增 2 例、`tests/plugin-myos.test.mjs` 增 2 例 → `npm test` **160/160**；`m2-ui-check` `m2ok:true, myosImportOk:true, errors:[]`。
- 坑：`collectMfsPaths` 起初只递归对象/数组，漏掉「数组里的字符串路径」（概览里 `dbs: ['…FSData.mfs']`），补了「字符串节点直接判 `.mfs`」分支。

### 20.94 v0.3.8 打包与打包态回归（第 16 轮）

- 版本 0.3.8（含 Qiko 融合、StarMem、检材优先级、431 cookie 修复、MYOS 导入器与面板入口、外部工具路径设置等）。
- 产物：NSIS 281,879,944 B、portable 236,575,720 B、app.asar 426,495,680 B（34,220 entries）、目录版 1,110,846,908 B；asar-038 自检 `missing:[]` 全 true；目录版冷启动 6180 ms、portable 48,782 ms。
- 打包态 e2e：m2（`myosImportOk:true`）、settings（13 行工具路径、五项自检、思考流）、plugins（175 包、无激活失败）、skills（Qiko 43）、hero（13/13 工具）、mount（154 ms）全绿。
- 待用户验收；真实 MYOS 端到端与真实网关 Spark 单机/双机联调仍需用户环境。

### 20.95 真实 MYOS 端到端（第 17 轮）

- 启动 `D:/Programs/MYOS/Client/bin/ForensicDesktop.exe -WindowStyle Minimized` 后 `health_check_dbus` 返回 `ready:true`；`npm run myos:import -- cases` 列出真实 4 案（`M盘`、`案件20261015145357`、`案件20261012160440`、`李自勇`、`案件20260923163545`）。
- 真机暴露并修复三个问题：
  1. 结果概览同时返回绝对路径（`D:\…\x.mfs`）、相对路径（`\data\…`）与模板串（`{插件名}.mfs`）→ `collectMfsPaths` 只收绝对路径（盘符/UNC）并按 `replace(/\/g,'/').toLowerCase()` 去重；
  2. `myos-forensics.sqlite_query` 返回「按 `columns` 顺序的数组行」而不是对象 → `readMyosRows` 统一转对象，否则 `mapMyosRow` 取不到列、导入正文为空；
  3. 表名提示之前没被解析 → 新增 `walkHints`：从 `sqliteQueryHints[{dbPath,sql}]` 的 SQL（`from/join` 后的表名）与 `mfsStats.{mappsDbPath,indexTable}` 建立「库 → 表」提示，`MApps.mfs` 现在能直接提示 `TBL_APPDATA_MANAGER`。
- 真实导入：`MApps.mfs` 的 `TBL_APPDATA_MANAGER` → 5 条；`AndroidBrowser{…}.mfs` 的 `TBL_PR_ANDROIDBROWSER_BROWSE_HISTORY` → 2 条、2 个实体（`URL` 被识别为 url）；`findIndexes` 能发现 `.dev/myos-real*`。`M盘` 案件 `LEUNG_YL_mobile.zip` 的 MApps 导入 10 条。
- 新增 `scripts/e2e/myos-real-import.mjs`（`npm run test:e2e:myos`）：自动选案件/检材/结果库/表 → 导入 → 断言记录数与 `findIndexes` 发现；MYOS 未运行时 `skipped:true` 且 ok（不阻断回归）。
- `npm test` **162/162**、`check:overlay` OK、build OK。

### 20.96 MYOS 增量导入（第 18 轮）

- 需求：同一案件往往有多个检材/多张结果表，之前每次导入整库重建，后一次会覆盖前一次。
- `tools/myos-index/import.mjs`：`importMyosRows({ mode:'append' })`——已有库时不删除，`eid = max(eid)+1`，artifact 的 `virtual_path` 带 `#eid` 避免 unique 冲突，ingest_log 的 leaf 用 `<sourceDb>#<eid>`，meta/case_info 保留原 `case_number`/`case_name`（除非显式传新值），manifest 累计 `counts/leaves/sources` 并记 `mode`；返回新增 `eid` 与 `totals`。
- CLI：`--append`；面板弹窗新增「写入方式：追加 / 整库重建」勾选（默认追加），导入结果提示「索引现有 N 条记录 / M 个检材」。
- 测试：新增「append 模式：同一案件追加第二个检材/表不覆盖已有记录」→ `tests/myos-index.test.mjs` 13/13、`npm test` 162/162（含数组行/真实路径等前序用例）。
- 真实 MYOS 复跑：`.dev/myos-merge` 先导 `MApps` 5 条（eid 1），再 `--append` 导 `TBL_PR_ANDROIDBROWSER_BROWSE_HISTORY` 2 条（eid 2）→ `records 7 / entities 2 / artifacts 2 / evidences 2`，manifest 同步。
- 坑：`ingest_log.leaf` 是主键，追加时必须带 eid 前缀；`artifact.virtual_path` 是 unique，追加时必须区分检材。

### 20.97 MYOS 批量导入（第 18 轮）

- 需求：MYOS 一个检材的结果分散在十几张表里，逐表导入点太多次。
- `plugins/seeu-case-index/myos.mjs`：新增 `myosImportBatch({caseId, db, tables, outDir, caseName, evidenceName, app, maxRows})`——打开案件一次，逐表 `select * from "表" limit N`，`importMyosRows({mode:'append'})` 追加；每张表一个检材（eid 递增、`evidenceName = <检材名> · <表名>`）；空表/查询失败记入 `skipped`；返回 `{tables:[{table,records,entities,eid,truncated}], skipped, totals, dbFile}`。
- 路由 `POST /myos/import-batch`（`plugins/seeu-case-index/index.js:235`）。
- 面板 `MyosDialog`：表列表多选（全选/清空/勾选），按钮「批量导入选中 N 张表」，结果显示每张表记录数、跳过原因、索引现有总数。
- 测试：`tests/plugin-myos.test.mjs` 增至 10/10（两表批量 → eid 1/2、2 个检材、totals 累计、缺 tables 400）。
- 真机：`MApps` 1 张表 5 条（eid1）；`AndroidBrowser` 2 张表 → 浏览历史 2 条（eid2）、下载表因「没有数据」跳过；合计 7 条 / 2 检材 / 2 实体。
- 坑：JSX 结果区两个相邻三元表达式嵌套导致 `Uncaught SyntaxError: Unexpected token ')'`（插件入口 import failed，整块面板不显示）→ 改为在 `return` 前定义 `resultNode` 单一表达式；改完用 esbuild `transformSync(loader:'jsx')` + `m2-ui-check` 双验证。

### 20.98 MYOS 批量导入进度与表名过滤（第 19 轮）

- 需求：一个检材的 `.mfs` 往往十几到几十张表，批量导入要几十秒，面板只有一个「批量导入中…」，不知道跑到哪、也不知道会不会重复点。
- `plugins/seeu-case-index/myos.mjs`：`myosImportBatch({ onProgress })` 回调 `{phase:'start'|'table'|'imported'|'done', index, total, table, records, entities, totals}`。
- `plugins/seeu-case-index/index.js`：`myosBatchJob` 单任务状态（`id/status/phase/index/total/table/records/entities/totals/startedAt/finishedAt/error/result`）；`POST /myos/import-batch` 立即返回 `202 {jobId}`（已有 running 任务返回 409，缺参数 400），后台跑完写 `done/failed`；`GET /myos/import-batch` 返回 `{job}`。
- 面板：轮询 `GET /myos/import-batch`，进度行「批量导入：第 2/5 张表 · TBL_X · 已收集 N 条记录」；新增表名过滤输入（大小写不敏感）、「全选」只勾当前过滤结果。
- 测试：`tests/plugin-myos.test.mjs` 增至 11/11（`onProgress` 事件序列 `start→table→imported→table→imported→done`、index 递增、done 汇总）。
- 坑：批量任务状态不能只存在 React 里（弹窗关闭就丢），必须放插件进程；`POST` 改异步后客户端必须轮询，否则 `await post` 拿不到结果。

### 20.99 导入前预估条数（第 21 轮）

- 需求：MYOS 一个 `.mfs` 里几十张表，其中不少是空的；批量导入前应先看每张表多少行，避免白等。
- `plugins/seeu-case-index/myos.mjs`：`myosTableCounts({caseId, db, tables, maxTables})`——逐表 `select count(*) as n from "T"`（`maxRows:1`），返回 `{tables:[{table,count}], total}`；单表失败记 `{count:null,error}` 不中断。
- 路由 `POST /myos/row-counts`。
- 面板批量区：新增「预估条数」「只选非空」按钮；勾选列表每行显示 `42 行`（0 行琥珀色、失败显示「预估失败」）；下方显示「预估：选中表合计 N 行（每张表最多导入 2000 行；空表会自动跳过）」。
- 测试：`tests/plugin-myos.test.mjs` 13/13（含预估两表 → `42 / 0`、缺 tables 400）；`npm test` 167/167；`m2-ui-check` `m2ok:true`。
- 真机：`MApps.mfs` → `TBL_APPDATA_MANAGER 5 行`；`AndroidBrowser…mfs` → 浏览历史 2 行、下载表 0 行；不存在的表返回 `no such table`（界面显示「预估失败」）。
- 坑：`count(*)` 在真实 MYOS 里同样受 `maxRows` 限制，但只返回 1 行；不可把空表当失败——空表是「0 行」，表不存在才是失败。

### 20.100 AI 自助导入 MYOS（第 22 轮）

- 需求：让会话里的 AI 也能把 MYOS 结果入库，而不是只有面板按钮；用户问「把 MYOS 里那个案件导进来」时直接执行。
- 新技能 `resources/forensics/skills/myos-import/SKILL.md`：给出完整 bash 流程（`/myos/cases → materials → dbs → tables → row-counts → import-batch → 轮询 → /list + /evidences 校验`），要求先确认案件/检材、不要直读 `.mfs`、不改 MYOS 数据、导入后报告条数。
- 接口增强（中文路径转码坑）：
  - `/myos/tables` 支持 `?caseId=&materialId=&name=<库文件名>`，返回 `{dbPath, tables}`；
  - `row-counts` / `import-batch` 支持 `dbName` + `caseId`/`materialId`，内部 `resolveDbByName()` 先从 `/myos/dbs` 精确匹配 basename，找不到再从每个已发现路径往上 3 层拼 `<name>` 并用 `existsSync` 验证（根库 `MApps.mfs` 常不在发现列表里）。
  - 原因：Git Bash/控制台把中文路径按 GBK 传，服务端 UTF-8 解码后乱码 → MYOS 报 `dbPath not found`；用 `name` 绕开。
- 验证：`skills-check` 技能列表 6 个（新增 `myos-import`）；真机 `row-counts`（`dbName`）→ `TBL_APPDATA_MANAGER 5 行`；`import-batch`（`dbName`）→ job done，`tables:[{records:5}]`，`.dev/myos-skill/.seeu-index/case-index.db` 118,784 B，`findIndexes` 能发现。
- 测试：`tests/plugin-myos.test.mjs` 13/13（`myosTables` 新返回结构 + `name` 发现 + 批量/预估 `dbName` 路径）；`npm test` 168/168。
- 坑：`resolveDbByName` 第一版用 `replace(/\/g,'/')` 被 python heredoc 吃掉反斜杠写成 `/\/g` 导致 `SyntaxError: missing )`，改为 `split(/[\/]/)`（用 edit 工具写，别用 shell heredoc 传正则）。

### 20.101 MYOS 结果库下拉补根库（第 23 轮）

- 问题：`query_phone_forensics_results_overview` 的自动发现只返回「按 app 拆分的子库」（`data/MApps/<App>{guid}.mfs`），根库 `data/MApps.mfs`（应用清单）、`FSData.mfs`（文件系统）、`FrAnalyze.mfs`（解析汇总）等都不在列表里；用户只能手动把绝对路径粘进输入框，而中文路径经控制台/HTTP 一转码就乱。
- `plugins/seeu-case-index/myos.mjs`：新增 `collectRootDbs(dbs, {maxDepth:3})`——从每个已发现路径的目录往上 3 层，`readdirSync` 收集同目录 `.mfs` 文件（跳过已发现路径），返回 `{path,name,tables:[],source:'root'}`；`myosResultDbs()` 返回 `[...dbs, ...collectRootDbs(dbs)]`。
- 面板：结果库下拉选项形如 `MApps.mfs · 根库 · 5 张表 · <完整路径>`；修了 `item.path.split(/[\/]/).pop()`（只按正斜杠拆，Windows 反斜杠导致整条路径被当名字）→ `split(/[\/]/)`。
- 测试：`tests/plugin-myos.test.mjs` 14/14（新增 `collectRootDbs`：临时目录 `data/MApps.mfs` + `data/FSData.mfs` + 子库 → 补 2 个根库、去重、不重复已发现项）；`npm test` 168/168、`m2-ui-check` `m2ok:true`。
- 真机：`案件20261015145357`/手机-data.D01 → `/myos/dbs` 返回 19 个（8 子库 + 11 根库，根库含 `MApps.mfs`/`FSData.mfs`/`FSDataIndex.mfs`/`FrAnalyze.mfs`/`apklist.mfs`/`Platform.mfs`）；面板用 JS `encodeURIComponent` 传中文路径可正常 `tables`。
- 坑：面板请求路径没问题（浏览器/JS 发 UTF-8），乱码只出现在「Git Bash 里手写 curl」的场景，所以技能里仍推荐 `dbName`。

### 20.102 记住 MYOS 导入输出目录（第 24 轮）

- 问题：面板「从 MYOS 导入」可以把索引写到任意 `outDir`，导入完成回调里 `scan(caseDir)` + `setDb(dbFile)` 能立刻看到；但下次启动 `/list` 只扫外壳下发的 `SEEU_INDEX_SEARCH_DIRS`，输出目录不在其中就「消失」了。
- 新增 `tools/ges-index/extra-dirs.mjs`：
  - `extraDirsFile(env)` = `SEEU_INDEX_EXTRA_DIRS` 或 `<DSH_HOME>/index-extra-dirs.json`（`SEEU_DSH_HOME`/`DSH_HOME` 回退；都没有则返回空，不写盘）；
  - `readExtraDirs(env)`：读 `{dirs:[...]}`，过滤非绝对路径/不存在的目录、按小写去重；
  - `rememberExtraDir(dir, env)`：只接受已存在的绝对路径，最近优先、最多 20 个，写 2 空格 JSON（`updatedAt`）。
  - 故意用独立文件名，避免与外壳 `src/host.ts` 维护的 `index-state.json` 双写冲突。
- `plugins/seeu-case-index/index.js`：`defaultDirs()` 合并 `readExtraDirs()`；`POST /myos/import` 成功后 `rememberExtraDir(body.outDir)`；`POST /myos/import-batch` 在任务 **成功** 的 `.then` 里记录（失败/取消不记）。
- 测试 `tests/extra-dirs.test.mjs` 4 例：路径解析（默认/覆盖/无 home）、记录-去重-最近优先、忽略相对路径与不存在目录、坏 JSON 不抛错且读时过滤。
- 真机验证：`dbName` 批量导入到 `.dev/myos-extra2` → `index-extra-dirs.json` 出现该目录；`/list`（不带 dir）返回 `W盘` + 该 MYOS 索引；用 python 以 UTF-8 发请求，`case_name` 正确存为「额外目录验证2」（用 Git Bash `curl -d` 发中文会 GBK 乱码，属控制台问题，面板 JS 是 UTF-8 不受影响）。
- 坑：最初在 `POST /myos/import-batch` **启动前** 调 `rememberExtraDir(outDir)`，此时输出目录还不存在 → 直接被忽略；改为任务成功后记录。

### 20.103 外部索引目录可见可移除（第 25 轮）

- `/list` 每个索引新增 `extra` 布尔（`caseDir` 是否在 `readExtraDirs()` 里，`resolve` 后小写比较），面板索引行显示「外部目录」标记。
- 新增 `forgetExtraDir(dir, env)`（`tools/ges-index/extra-dirs.mjs`）+ `POST /extra-dirs/remove {dir}`：只从清单移除、不动磁盘上的索引；无效/不存在路径直接返回当前清单。
- 面板：外部目录行多一个【移除】（`stopPropagation`，避免触发行点击切库），移除后 `scan()` 刷新。
- 测试：`tests/extra-dirs.test.mjs` 5/5（新增 forget：大小写不敏感、只删指定项、不存在不报错）；`npm test` 173/173；`m2-ui-check` `m2ok:true`。
- 真机：拷贝一份索引到 `.dev/myos-ui` 并加入额外目录 → `/list` 显示 `extra:true`；`POST /extra-dirs/remove` → `{ok:true,dirs:[]}`，再 `/list` 恢复单条。
- 坑：① `POST` 路由最初插在 `path.startsWith('/myos/')` 分支内部，`/extra-dirs/remove` 根本进不去 → 报 405「method not allowed」；移到 `/brief` 之后、MYOS 分支之前。② python 里写 `'\u0000'` 转义时被解释成真实 NUL，把 `index.js` 变成二进制文件（`grep` 报 Binary file）→ 用字节替换回 `\u0000` 文本。

### 20.104 索引来源标签（第 26 轮）

- `tools/ges-index/query.mjs` 的 `findIndexes()` 从 `manifest.json` 带回 `tool`（`ges-index` / `seeu-myso-import`）。
- `plugins/seeu-case-index/index.js` 的 `/list` 每项新增 `source` 与 `sourceLabel`：
  - `tool === 'seeu-myso-import'` → `myos` /「MYOS 导入」；
  - 在额外目录清单里且不是 MYOS → `external` /「外部目录」；
  - 其余 → `ges` /「火眼建库」。
- 面板索引行用 `sourceLabel` 取代原来硬编码的「外部目录」标记（火眼建库用灰色、其余青色；`title` 显示 manifest 里的 `tool`），【移除】只对 `extra` 出现。
- 测试：`tests/myos-index.test.mjs` 增加「`findIndexes` 能读到 `manifest.tool`」断言；`npm test` 173/173、`m2-ui-check` `m2ok:true`。
- 真机：`W盘` → `ges:火眼建库`；MYOS 导入索引 → `myos:MYOS 导入`（用 node `fetch` 读 UTF-8 验证，避免控制台码页干扰）。
- 坑：① 比较字符串把 `seeu-myso-import` 写成 `seeu-myos-import`（myso/myos 调换）→ 标签永远落到 external；这种拼写错误不会报错，只能靠真机对照 `tool` 字段发现。② 用 python 管道解析 `curl` 输出时，Windows 控制台按 GBK 解码 UTF-8，`sourceLabel` 会显示成乱码 —— 那是诊断链路的编码问题，不是接口问题；用 node `fetch` 或写文件再读可避免。

### 20.105 面板索引来源筛选（第 27 轮）

- `plugins/seeu-case-index/client.js`：`Panel` 新增 `srcFilter` 状态（`all|ges|myos|external`），索引库卡片标题下加一行筛选 chip（`data-index-src`，带各来源数量），列表按 `source` 过滤；无匹配时显示「没有来源为「X」的索引」。
- `m2-ui-check` 新增断言：`idxFilterChips===4`、chip 文案（`全部 1|火眼建库 1|MYOS 导入 0|外部目录 0`）、点「MYOS 导入」出现空提示、点「全部」恢复出 `W盘`，汇总为 `idxFilterOk`。
- 验证：`m2-ui-check` → `idxFilterOk:true, m2ok:true, errors:[]`；`npm test` 173/173、`check:overlay` OK。
- 坑：手写这段 JSX 时先插入 chip 又保留旧的 `indexes.map(...)` 收尾，导致括号/三元结构错位；`esbuild.transformSync(loader:'jsx')` 只报 `Unterminated` 之类的模糊错误，最后用「重写整个 return 数组」的方式一次收干净，再用 transform 校验。

### 20.106 v0.3.9 打包（第 28 轮）

- 累积改动进包：MYOS 导入链路（面板/自动发现/真实端到端/追加/批量/进度/预估/`myos-import` 技能/根库补齐）、额外目录持久化与移除、索引来源标签与筛选、建库进度/取消/索引元数据、思考流格式、五项能力自检、dsh-auth cookie 清理。
- `npm version 0.3.9`；build、`npm test` 173/173、`check:overlay` 通过；`electron-builder --win --x64 -c.directories.output=release-039`（后台 job，约 16 分钟，无签名）。
- 产物：NSIS 281,886,671 B、portable 236,647,317 B、`app.asar` 426,530,364 B（34,223 entries）、win-unpacked 1,110,881,592 B；asar-039 全 true；冷启动 5076 ms、portable 58.7 s；打包态 m2/settings/plugins/skills/hero/mount/真实 MYOS 导入全绿。
- 坑：asar-039 首次 `myosDbName:false`——`resolveDbByName` 位于 `myos.mjs`，检查脚本误读 `index.js`；打包期间 portable 仍分两段 7z 压缩（约 10 分钟），不要提前搬产物。

### 20.107 本机模型网关基准脚本（第 29 轮）

- 新增 `scripts/bench/local-gateway-bench.mjs`：`GW_BASE/GW_KEY/GW_MODELS` 环境变量；每个模型跑「非流式对话 / 流式（`stream_options.include_usage`）/ 工具调用」三项，输出 TTFB、总耗时、chunk、输出 token、tok/s、`reasoning_content` 字符数、`tool_calls` 名称与 `finish_reason`；报告写 `.dev/bench/gateway-<ts>.json`。
- 导出可测函数：`normalizeBaseURL`、`tokensPerSecond`、`readSSE`、`benchModel`、`runBench`、`formatReport`；网关不可用返回 `errors` 而不是抛异常，模型不在 `/models` 里也仍尝试调用并标记。
- 测试 `tests/local-gateway-bench.test.mjs` 6 例（本地 `node:http` 假网关：SSE 思考流解析、非流式/工具调用、两模型遍历、网关不可用降级）→ 6/6；`npm test` 179/179。
- `package.json` 加 `bench:gateway`；`docs/benchmarks.md` 增加「本机模型网关基准」章节（指标表 + 待填真实数据）；README 增加「v0.3.10 待发布」条目。
- 遗留：真实 Spark 单机/双机数据要等用户给网关凭据后跑一次（脚本已就绪，避免凭据落盘）。

- 坑：假网关极快时 `TTFB` 与总耗时可能落在同一毫秒，`tokensPerSecond(completion, ms - ttfb)` 会除以 0 得 `null`（单测在完整套件并发时暴露）→ 改成 `Math.max(1, ms - ttfb)`；另用 `.probe/mock-gw.mjs` 跑了一遍 CLI 全链路（输出结构见 `docs/benchmarks.md` 自检段）。

### 20.109 面板「最近活动」（第 30 轮）

- 新增 `tools/ges-index/activity.mjs`：`activityFile(env)`（`<DSH_HOME>/index-activity.json`，`SEEU_INDEX_ACTIVITY` 可覆盖）、`readActivity`（坏文件/空文件返回 `[]`）、`recordActivity`（最新在前、最多 30 条、写 `updatedAt`）、`clearActivity`。
- 插件 `plugins/seeu-case-index/index.js`：新增 `GET /activity` 与 `POST /activity/clear`；建库成功、单表 MYOS 导入成功、批量导入成功时各记一条（`kind: build|myos-import`、`title` 案件目录名、`detail` 条数/表名/用时、`caseDir`、`dbFile`、`rows`），失败/取消不记。
- 面板：索引库卡片下方新增「最近活动」（最近 6 条，建库/MYOS 彩色标签 + 时间；点一行 `scan(caseDir)` 并切到该索引；【清空】）。
- 测试：`tests/activity.test.mjs` 4 例（路径解析/覆写、最多 30 条最新在前、清空与坏 JSON、不存在文件不建目录）；`m2-ui-check` 新增 `activityVisible/activityRows/activityEmptyHint/activityOk`（新 home 无历史 → 空提示，`activityOk:true`）。
- 真机验证：对运行中的 dev 预览调 `/myos/import`（`MApps.mfs` 3 行）→ `/activity` 出现「3 条 · TBL_APPDATA_MANAGER」；再跑一次 5 张表批量 → 「8 条 · 3 张表 · 追加」（2 张空表进 `skipped`）；批量失败时不会写入活动。
- 坑：单表 `/myos/import` 只接受 `db` 绝对路径（`dbName` 只有批量接口支持），验证脚本要用 `/myos/tables?caseId&materialId&name=` 先解析真实路径；`curl`/Git Bash 传中文目录名会 GBK 乱码，JS `fetch` 走 UTF-8 不受影响。

### 20.110 v0.3.10 打包与回归（第 31 轮）

- 打包内容：第 29 轮本机网关基准脚本（`scripts/bench/local-gateway-bench.mjs`，不随包）+ 第 30 轮面板「最近活动」（`tools/ges-index/activity.mjs`、`/activity` 路由、面板卡片）。
- 版本 `0.3.10`；`npm test` 183/183、`check:overlay` OK；`release-0310` 打包约 17 分钟（portable 压缩阶段占大头）。
- 产物：NSIS 281,889,094 B（blockmap 293,258 B）、portable 236,564,870 B、`app.asar` 426,537,645 B（34,224 entries）、目录版 1,110,888,873 B。
- `.probe/asar-0310-check.mjs`：在 039 的基础上加 `tools/ges-index/activity.mjs` 与 `activityModule`/`activityRoutes`/`activityBuild`/`activityPanel`/`version0310`，全部 true、`missing: []`。
- 打包态：`m2-ui-check`（`activityOk:true`）、`settings-check`、`plugins-check`、`skills-check`、`hero-check`、`mount-check`、`myos-real-import` 全绿；目录版冷启动 5123 ms、portable 58.5 s。
- 坑：打包等待期间只应轮询 `release-0310/` 是否出现 `-portable.exe`，不要在 `win-unpacked.tmp` 阶段读 asar（会读不到文件）；portable 首次启动仍需 50–60 s 解包，属预期。

### 20.111 设置页「运行环境体检」（第 32 轮）

- 背景：多轮加功能后，用户排障时很难判断「到底缺什么」——插件没加载、工具路径没配、MYOS 没起、模型没配，表现都像「AI 变笨」。本轮把七项能力状态汇总成一张只读清单。
- 新增 `tools/env-report.mjs`（纯函数模块，不碰文件系统）：
  - `buildEnvReport(facts, now)` → `{ok, version:1, checkedAt, summary:{total,ok,warn,fail,worst}, items}`；
  - 七项判定：`plugins`（bundles 数 + 缺包→fail，带「重装 SeeU」提示）、`skills`（随包 6 个 + 技能组 4 组 + 已安装数，未安装→warn）、`tools`（ready/total，少量缺→warn、多数缺→fail）、`localModel`（未配置/禁用/无模型 id→warn，配置读坏→fail）、`mounts`（LovelyCarve CLI 未配置→warn + 去设置选 exe）、`myos`（MCP 服务端文件缺失→warn + `SEEU_MYOS_MCP`）、`indexDirs`（登记目录可访问比例，缺目录→warn）；
  - `worstStatus()`（有 fail 即 fail）、`formatEnvReport()`（纯文本版，含 `[OK]/[!]/[X]` 与提示）。
- 新增 `src/env-report.ts`：`collectEnvReport()` 收集事实（`toolPathsView`、profile bundle 解析（profile node_modules → appRoot → `require.resolve`）、`countSkillDirs`/`skillSetIds`、`mountManager.status()`、`resolveMyosMcp`、`describeLocalModelConfig`、`index-state.json` 目录）；`appRoot()`/`dshHome()` 来自 `src/paths.ts`。
- 接线：`src/main.ts` import + IPC `seeu:env:report`（日志 `env report: X 正常 / Y 注意 / Z 不可用`）；`src/preload.ts` 新增 `EnvReport/EnvReportItem/EnvStatus` 类型与 `window.seeu.env.report()`。
- 设置页：`renderer/local-model.html` 在「外部取证工具路径」下加「运行环境体检」卡片（`#btn-env-check`、`#env-summary`、`#env-items`），逐项渲染 `data-env-key`/`data-env-status`（✓/!/× 着色）+ 详情与提示；`runEnvCheck()` 处理缺桥/异常。
- 测试：`tests/env-report.test.mjs` 4 例（齐全全 ok；工具缺一半 fail、少量缺 warn；插件缺包 fail + 提示、挂载/模型未配置 warn；空事实不抛异常 + worstStatus/formatEnvReport）→ 4/4；`npm test` **187/187**、`check:overlay` OK、build OK。
- `scripts/e2e/settings-check.mjs` 加环境体检断言（点按钮 → 等 `[data-env-key]` ≥7 → 读 summary/statuses）→ `envItemCount:7`、`envKeys` 七项、`envStatuses` 6 ok + 1 warn（隔离 home 未登记索引目录）、`envSummary:"体检结果：6 项正常 · 1 项注意 · 0 项不可用"`、`envReportOk:true`、`ok:true`。
- 坑：设置页脚本由内联 `<script>` 直接跑，改完必须用 `esbuild transformSync(loader:'js')` 校验（本轮一次通过）；`env-check` 按钮在 `window.seeu.env` 缺失时要走失败提示而不是静默。

### 20.112 最近活动统计（第 33 轮）

- 背景：活动记录已有（第 30 轮），但只能逐条看，看不出「最近建库慢不慢、导入多不多」。
- `tools/ges-index/activity.mjs` 新增：`ACTIVITY_SUMMARY_DAYS=7`、`formatActivityDuration(ms)`（秒/分/小时）、`summarizeActivity(entries, now, days)`（窗口内统计 `builds`/`imports`/`avgBuildMs`/`rows`/`lastAt`/`total`；坏时间戳计入次数但不参与平均）、`formatActivitySummary(summary)`（无活动返回空串，面板据此隐藏/留空）。
- `plugins/seeu-case-index/index.js` 的 `GET /activity` 返回 `{file, entries, summary, summaryText}`；`client.js` 增加 `activitySummary` state，标题行渲染 `[data-activity-summary]` 文本，清空时一并清空。
- 测试：`tests/activity.test.mjs` +2 例（窗口过滤与平均值、空输入/时长格式）→ 6/6；`npm test` **189/189**；`m2-ui-check` 加 `activitySummaryPresent`/`activitySummaryText`（新 home 无历史 → 元素存在、文本空），实测 `activitySummaryPresent:1`、`activityOk:true`、`m2ok:true`、`errors:[]`。
- 坑：`client.js` 是普通 JS（不是 JSX），改完用 `node --check` 校验即可；`m2-ui-check` 里 `ev()` 返回的是 `document.querySelectorAll(...).length` 数值，断言要按数值比较。

### 20.113 环境体检「复制结果」（第 34 轮）

- 动机：体检结果只在设置页里，要让用户把它贴给支持人员/留档，需要能一键复制。
- `src/main.ts` 的 `seeu:env:report` 在 `report` 之外返回 `text: envReportText(report)`（`formatEnvReport()` 纯文本版：逐项 `[OK]/[!]/[X]` + 详情 + 非 ok 项的 `→` 提示 + 合计行）。
- `src/preload.ts` 类型加 `text?`；`renderer/local-model.html` 体检卡片加【复制结果】按钮（无报告时 disabled）与 `#env-copy-status` 状态行，走已有的 `window.seeu.writeClipboard()`。
- e2e：`settings-check` 在体检断言后点【复制结果】，用 PowerShell `Get-Clipboard -Raw` 读回，断言含「SeeU 环境体检」「合计：」「外部工具路径」→ `envClipboardChars:380`、`envCopyOk:true`、`ok:true`。
- 坑：页面里 `renderEnvReport()` 只吃 `report` 对象，复制文本要单独经 `res.text` 传进来（不要从 DOM 反解析，条目里的提示文案会丢）。

### 20.114 v0.3.11 打包与回归（第 35 轮）

- 打包内容：第 32 轮「运行环境体检」+ 第 33 轮「最近活动统计」+ 第 34 轮「复制体检结果」。
- 版本 `0.3.11`；`npm test` 189/189、`check:overlay` OK；`release-0311` 打包约 16 分钟。
- 产物：NSIS 281,893,366 B（blockmap 293,297 B）、portable 236,555,068 B、`app.asar` 426,562,813 B（34,224 entries）、目录版 1,110,914,041 B。
- `.probe/asar-0311-check.mjs`（由 0310 复制）：新增 `envReportModule`/`envReportIpc`/`envReportSettings`/`envCopyButton`/`activitySummary`、`version0311` → 110 项全 true、`missing: []`。
- 打包态：`m2-ui-check`（activity summary）、`settings-check`（体检 + 复制剪贴板回读 380 字符）、`plugins-check`、`skills-check`、`hero-check`、`mount-check`、`myos-real-import` 全绿；目录版冷启动 6107 ms（首跑 33.9 s 是杀毒扫描）、portable 58.5 s。
- 坑：① `tools/env-report.mjs` 被 esbuild 内联进 `dist/main.cjs`，asar 中没有独立文件，自检要求改为查 mainJs 符号；② `version0311` 的断言值在复制脚本时残留成 `0.3.10`，导致唯一 false —— 版本号这类断言复制后必须逐条改值。

### 20.115 最近活动按天分布（第 36 轮）

- 动机：活动摘要只有「近 7 天共 X 次」，看不出哪天集中。
- `tools/ges-index/activity.mjs` 的 `summarizeActivity()` 增加 `buckets`：从今天往前 7 天（本地时区），每天 `{date:'YYYY-MM-DD', builds, imports, total}`；条目按 `Date.parse(at)` 落到今天零点算出的桶，窗口外不计入任何桶；坏时间戳仍不影响主统计。
- `plugins/seeu-case-index/client.js`：新增 `activityBuckets` state（加载 `/activity` 时读 `body.summary.buckets`，清空活动时清空）；标题行右侧渲染 `[data-activity-bars]`，7 根 5px 宽小条形，高度按当天总数归一（峰值 16px），建库/导入/两者分别用 `C_ACC`/`C_WARN`/`C_OK`，空桶 35% 透明度；每根 `title` 为「日期：建库 N 次 · MYOS 导入 M 次」。
- 测试：`tests/activity.test.mjs` +1 例（7 桶、最后一天是今天、昨天/前天对齐、窗口外排除、总数 3、builds 2）→ `npm test` **191/191**；`m2-ui-check` 加 `report.activityBars`（`[data-activity-bars] > div` 数量必须 7）并纳入 `activityOk` → `m2ok:true`。
- 坑：颜色常量实际叫 `C_ACC`/`C_OK`/`C_WARN`/`C_L2`，不是 `C_ACCENT`/`C_BLUE`/`C_BORDER`（写错不报错，只是 `undefined` 颜色条不可见）；`esbuild transformSync(loader:'jsx')` 只能校验语法，颜色这类运行期错误要靠 e2e 兜。

### 20.116 活动条形点选当天（第 37 轮）

- 动机：条形只表示分布，用户想「只看周五那几次」。
- `plugins/seeu-case-index/client.js`：新增 `activityDay` state；每根条形加 `data-activity-day`、`role=button`、`onClick` 切换（再点同一根取消）、选中态描边 `C_ACC`；标题行计数 span 加 `data-activity-count`，筛选时显示「当天 N 条 · 共 M 条」；出现「只看 YYYY-MM-DD · 点条形取消」提示；列表按本地日期过滤（`Date.parse(at)` → 年-月-日 与 `activityDay` 比较），最多仍显示 6 条。
- e2e：`m2-ui-check` 现在预置活动（paho home 的 `index-activity.json` 写今天 1 条 + 昨天 1 条）→ `activityBars:7`、点最后一根 → `activityFilterText:"只看 2026-11-13 · 点条形取消"`、`activityHeaderText:"当天 1 条 · 共 2 条"`、`activityFilterCleared:true`、`activityDayFilterOk:true`；纳入 `activityOk`。
- 坑：`SEEU_DSH_HOME` 传**相对路径**时插件侧 `activityFile()` 会按 dsh 进程 cwd 解析、读不到 e2e 预置文件（表现为「还没有活动记录」）；e2e 必须传绝对路径（`D:/.../.dev/ui-home37`）。

### 20.117 体检报告导出 .md（第 38 轮）

- 动机：纯文本适合贴聊天，但不适合留档/进工单；体检结果应该有可导出的结构化文件。
- `tools/env-report.mjs` 新增 `envReportMarkdown(report)`：一级标题「# SeeU 运行环境体检」、检查时间、合计加粗、四列表格（项目/状态/详情/提示），单元格转义 `|` 与换行，末尾一句来源说明；`src/env-report.ts` re-export；`src/main.ts` 的 `seeu:env:report` 额外返回 `markdown`；`src/preload.ts` 类型加 `markdown?`。
- 设置页：新增「导出 .md」按钮（无报告时 disabled），走已有的 `window.seeu.saveExport(name, text)` IPC（`SEEU_EXPORT_DIR` 可覆盖落盘目录），文件名 `SeeU-环境体检-<UTC 时间戳>.md`；成功在状态行显示完整路径与字节数。
- 测试：`tests/env-report.test.mjs` +1 例（标题、表头、合计、表格行数 = items 数、提示为空）；坑：统计行时要把 Markdown 分隔行 `| --- |` 排除，否则比 items 多 1。
- e2e：`settings-check` 设置 `SEEU_EXPORT_DIR=.dev/settings-exports`，体检后点【导出 .md】，读最新 .md 断言首行、表头、合计 → `envExportOk:true`，文件名 `SeeU-环境体检-2026-11-12-22-02-32.md`。
- 坑：`runEnvCheck()` 里 `renderEnvReport({ ...res.report, text: res.text })` 漏传 `markdown` → 按钮始终 disabled、e2e 无文件；必须把 `res.markdown` 一起并进对象。

### 20.118 活动行打开失败提示（第 39 轮）

- 问题：活动记录只是 JSON 快照；目录被删/索引被移走后，点行调用 `scan(caseDir)` 会按默认目录兜底，看起来「什么都没发生」。
- `plugins/seeu-case-index/client.js`：活动行点击不再盲目 `scan`，而是先 `GET /list`（不带 dir，避免 `/list?dir=` 合并默认目录导致误判），按 `item.dbFile` 或规范化后的 `item.caseDir`（`split('\').join('/').toLowerCase()`）在返回索引里查找；找不到 → 新增 `activityNote`（muted 卡片底部、`data-activity-note`、琥珀色）「打不开该活动：索引已不存在（…），可能被删除或移动。」；找到 → 只把 `list` 设为索引列表并打开目标库/节点。
- e2e 自包含：`m2-ui-check` 启动前若 `SEEU_DSH_HOME` 是绝对路径，就写入 `index-activity.json`（今天 build + 昨天 myos-import，`caseDir` 指向不存在的 `E:/seeu-missing-*`）；断言点击第一行后 `activityOpenNote` 含「打不开该活动」、`activityOpenNoteOk:true`。
- 坑：① `replace(/\/g,'/')` 经 python heredoc 两次转义变成 `/\/g`（非法正则），整块插件面板 import 失败、`errors` 里只有 `Uncaught SyntaxError: missing ) after argument list`——改用 `split('\').join('/')`；② m2 脚本里 `log()` 不存在（那是别的脚本的 helper），用 `console.log`；③ e2e 自己写活动文件比外部 bash 预置更稳（外部预置会被前一次运行的清空/覆盖弄丢）。

### 20.119 活动可逐条移除（第 40 轮）

- 动机：活动是 JSON 追加记录，误操作（失败建库、测试导入）留下的行只能「清空全部」，粒度太粗。
- `tools/ges-index/activity.mjs`：新增 `removeActivity({ at, title }, env)`——按 `at` + `title` 精确定位删除一条，未命中不改文件与原样返回；写盘结构同 `recordActivity`。
- 插件：`POST /activity/remove {at,title}` → 返回 `{ok, entries, summary, summaryText}`（与 `/activity` 同口径）。
- 面板：活动行右侧加【移除】小按钮（`data-activity-remove`、`stopPropagation`），成功后同步 `activity/activitySummary/activityBuckets` 并清空提示。
- 测试：`tests/activity.test.mjs` +1 例（删除命中/未命中不改文件）→ 8/8；`m2-ui-check` 断言 `activityRowsBeforeRemove:2` → 点击移除 → `activityRowsAfterRemove:1`、`activityRemoveOk:true` 并纳入 `activityOk`。

### 20.120 挂载窗口「最近一次挂载」（第 41 轮）

- 动机：挂载窗口只在挂载期间有列表；卸载或重启后就想不起上次挂的哪个镜像、哪个盘符。
- `tools/image-mount.mjs`：`readMountState()` 读取并返回 `lastMount`（保留对象，缺失为 null）；`mount()` 成功时 `writeMountState(..., { lastMount: record })`；`unmount()` 成功时写 `{ ...previous, releasedAt }`（`previous` 优先取 `state.lastMount`，否则用当前记录）；`status()` 返回 `lastMount`，且异常退出清理列表时**保留** `lastMount`（此前会丢）。
- `renderer/mounts.html`：CLI 状态卡新增 `[data-last-mount]` 行，`lastMountText()` 渲染「最近一次挂载：X: ← disk.E01（分区 0） · 本地时间 · 运行中/已卸载」。
- 测试：`tests/image-mount.test.mjs` 增加挂载后 `lastMount.releasedAt` 为空、卸载后 `releasedAt` 为字符串、`status().lastMount` 仍在 → 5/5；`mount-check` 新增 `lastMountOk`（挂载中含镜像名 + 运行中）与 `lastMountReleasedOk`（刷新后含已卸载）。

### 20.121 挂载窗口「重新挂载最近镜像」（第 42 轮）

- 动机：卸载后想再挂同一个镜像，得重新「选择镜像 → 解析 → 选分区 → 挂载」四步。
- `renderer/mounts.html`：CLI 状态卡新增 `#remountRow`（`#btnRemount` + `#remountHint`），`renderStatus()` 缓存 `lastView`，仅当 `lastMount.imagePath` 存在时显示；`remount()` 依次 `api.inspect(原镜像)` → `api.mount({imagePath, partition: last.partition||0, mountPoint: last.mountPoint})` → 提示「✓ 已重新挂载到 X:（耗时）」→ `refresh()`；失败给可操作文案（镜像不可用/挂载失败+hint）。
- `scripts/e2e/mount-check.mjs`：卸载/已卸载摘要断言之后，断言 `#remountRow` 可见 → 点【重新挂载】轮询 `window.seeu.mounts.get()` 至 1 条（最多 16 s）→ 校验 `remountedPoint`、提示含「已重新挂载」→ 再卸载收尾，全部纳入 `report`。
- 坑：e2e 里判断元素可见性时把表达式包了 `String(...)`，返回字符串 `"true"` 与 `!== true` 比较恒失败 → 直接返回布尔表达式。

### 20.122 最近活动文本筛选（第 43 轮）

- 动机：活动多了以后（尤其批量导入留下多行），想按案件名/表名找一条只能肉眼扫。
- `plugins/seeu-case-index/client.js`：新增 `activityQuery` state 与 `matchesActivity(item)`（title/detail/kind 小写包含），`activityShown` = 当天过滤（`activityDay`）后再按文本过滤，列表与「当天 N 条 · 共 M 条」都用它；标题行加筛选框（`data-activity-search`，placeholder「筛选活动（案件名 / 表名 / 类型）」）与 `[data-activity-search-count]`（`N 条匹配` / `没有匹配的活动`）；列表空时渲染 `[data-activity-empty]`（有筛选词显示「没有匹配的活动」，否则保留原引导文案）。
- e2e：`m2-ui-check` 在移除单条后（剩「昨日导入样例」）→ 筛选「昨日」断言 1 行 + 「1 条匹配」→ 筛选「不存在」断言空态文案 → 清空恢复 1 行 → `activitySearchOk:true` 纳入 `activityOk`。
- 坑：初版预期筛「今日」，但前一步刚移除「今日建库样例」，行数必然为 0——e2e 断言要跟数据顺序一致。

### 20.123 体检「一键修复可自动项」（第 44 轮）

- 动机：体检能报出「随包插件没复制到 profile」「技能没装到 DSH_HOME」，但用户只能重启/重装。
- `tools/env-report.mjs`：`FIXABLE_ENV_KEYS = ['plugins','skills']` + `envFixTargets(report)`（只取可自动修且状态非 ok 的项）；`src/env-report.ts` re-export。
- `src/main.ts`：IPC `seeu:env:fix` —— 取 targets；`plugins` → `installBundledPluginBundles()` + `ensureBundledPluginPackages(app.getVersion())`（`SEEU_DISABLE_DSH_PLUGINS=1` 跳过）；`skills` → `installBundledSkills(app.getVersion())`；修复后重新 `collectEnvReport()`，返回 `{ok, repaired, targets, report, text, markdown}` 并写日志 `env fix: …`。
- `src/preload.ts`：`window.seeu.env.fix()`。
- 设置页：体检操作行新增【一键修复可自动项】`#btn-env-fix`（`renderEnvReport()` 里按 plugins/skills 是否非 ok 启用），点击后重渲染报告并在 `#env-copy-status` 显示「已自动修复：插件包、技能」/「没有需要自动修复的项」。
- 测试：`tests/env-report.test.mjs` +1（可修复项筛选、全 ok 返回空）→ 6/6；`settings-check` 断言 `envFixApiOk:true`（直接调用返回 ok+repaired+report）与隔离 home 下按钮置灰 `envFixButtonDisabled:true`。
- 坑：① `src/main.ts` 的 env-report import 是 `{ collectEnvReport, envReportMarkdown, envReportText }`（顺序与预期不同），替换未命中导致 `envFixTargets is not defined`——靠 e2e 捕获 IPC 返回 error 才看到；② `skillsItem` 判定是 `installed > 0` 即 ok，单测里造「技能缺」要 `installed: 0`，不能只给 `sets`。

### 20.124 v0.3.12 打包与打包态回归（第 45 轮）

- 版本：0.3.12（含第 36~44 轮：活动按天条形/点选过滤/逐条移除/文本筛选、挂载最近记录与一键重挂载、体检一键修复、活动统计、体检复制与导出 .md）。
- 打包：`rm -rf release-0312` → `npx electron-builder --win --x64 -c.directories.output=release-0312`。首个 job 因 harness 重启被 kill（只剩 win-unpacked 与 NSIS 半成品），改用 `npx electron-builder --win portable --x64` 单独补 portable 成功。
- 产物：NSIS `281,896,527 B`（blockmap `293,199 B`）、portable `236,577,274 B`、`app.asar` `426,586,748 B`（34,224 entries）、目录版 `1,110,937,976 B`。
- asar 自检：`.probe/asar-0312-check.mjs` 由 0311 扩展，新增 `activityBars`/`activityDayFilter`/`activityRemove`/`activitySearch`/`mountLastRecord`/`mountRemount`/`envFixModule`/`envFixUi`；修了两处读取来源（image-mount/env-report 被 esbuild 打进 main.cjs）与 `mountsHtml` 变量。
- 验证：`verify-launch` 目录版 6305 ms / portable 54,994 ms；打包态 m2（`activityOk`/`myosImportOk`）、settings（`envReportOk`/`envCopyOk`/`envFixOk`、13 行工具路径、五项自检）、mount（`lastMountReleasedOk`/`remountHintOk`）、hero（`toolsOk`）、plugins（175 包、`activationOk`）、skills（Qiko 43、`leaked:[]`）全部通过。
- 坑：① `settings-check` 的 mock 网关默认端口 18081 与 MYOS `PhoneForensics` 服务冲突，已支持 `SEEU_SETTINGS_MOCK_PORT`/`SEEU_SETTINGS_CDP_PORT` 覆盖，本次用 28181/9353；② 为腾端口误杀 MYOS `PhoneForensics`，处理后重启 `ForensicDesktop` 恢复；③ 长任务（打包/portable 压缩）不要与 harness 重启交叠，必要时分 target 补打。

### 20.125 星睿本地模型提示词最终融合（第 46 轮）

- 来源：`E:\取证桌面\星睿-*.txt` 9 份（APK/数据分析/文件目录/服务器/流量/物联网/电子数据取证竞赛知识库/计算机手机/逆向）。每份是「星睿通用 system（38,397 字符，含记忆分层/技能/环境事实）+ user 里的专家 SOP」。专家段用 `# 星睿-…专家` 起收，长度 1.3K~19.7K 字符。
- 融合策略：专家 SOP 保留为正文；追加「## SeeU 运行环境（本机，优先级高于上文的星睿/QZOS 工具假设）」适配段（bash 优先 / pwsh 降级、索引→火眼挂载→LovelyCarve→原始文件、`$SEEU_TOOL_*`、MYOS MCP、只读与 `$SEEU_WORKSPACE`、上下文 262144）；再接既有 SeeU 规则，保证环境与输出约束不丢。
- 映射：standard ← 计算机手机 + 服务器；traffic ← 流量；data ← 数据；apk ← APK；exe ← 逆向；mobile ← 计算机手机；新增 `preset-iot`（物联网，order 11）、`preset-files`（文件目录，order 12）。
- 新技能：`resources/forensics/skills/forensics-competition-kb/SKILL.md`（默认知识库 `D:/forensics-kb`，`$SEEU_KB_DIR` 覆盖；先 glob 找目录、再 grep 关键词、命中后 read 全文；答案标来源；查不到写「知识库未收录」）。
- 上下文：Spark 单机预设 `contextWindow` 131072 → **262144**（与双机一致），设置页 note 同步说明「模型实际更小会报 400，按网关自报窗口改」。
- 校验：`check-overlay` 的 `expertPresets` 加 IoT/Files（名称、只读、Qiko 组）；`tests/presets-config.test.mjs` 预设列表 11 个、persona 关键词与 `forensics-competition-kb` 目录断言；`npm test` 194/194、`check:overlay` OK、build OK；`settings-check`（单机 262144、`deploySingle` 断言更新）、`m2-ui-check`、`hero-check` 通过。
- 坑：① 注入脚本里 `node - <<EOF` 的模板字符串含反引号/反斜杠会被 shell 与 JS 双重转义搞坏 → 改成写入 `.probe/fuse-xingrui.mjs` 再运行；② overlay 的 `preset-standard` 是顶层 `- id:`（无缩进），其余预设是 4 空格缩进，块查找必须按实际缩进泛化；③ `m2-ui-check` 的「活动行点开失败提示」偶发超时，等待从 1200 ms 提到 2600 ms 后稳定。

### 20.126 APK/EXE 动态分析环境接入（第 47 轮）

- 用户问（m17540）：「这里面，apk接雷电模拟器，exe接虚拟机，这些你都配置了吗，之前我都安装好了」。
- 实测本机：雷电模拟器 `D:\Games\leidian\LDPlayer14`（`ldconsole.exe` / `dnplayer.exe` / `adb.exe`；`ldconsole list2` → 1 个实例，state 0 未运行；`adb devices` 为空）；PC 侧 `frida` 17.17.0 在 PATH；**未找到 frida-server 二进制**（LDPlayer 目录、桌面、D:\Programs 深度 3 搜索）；**未找到** `apk_unpack_all_in_one_v3` / `apk_mcp` 工具链（C:/D:/E: 深度 2 搜索）。VMware Workstation 26.0.0 `D:\Programs\VMware`（`vmrun.exe`；`vmrun list` → `E:\Win10Reverse\Win10CNBase.vmx` 运行中；`vmware-vmx` 进程在跑）。
- 代码：`tools/tool-paths.mjs` 的 `TOOL_PATH_SPECS` 追加两项目录型：`ldplayer`（`SEEU_TOOL_LDPLAYER`，默认 `D:/Games/leidian/LDPlayer14`）、`vmware`（`SEEU_TOOL_VMWARE`，默认 `D:/Programs/VMware`）；`scripts/e2e/settings-check.mjs` 的 `toolPathsRows` 断言 13 → 15。
- persona（`resources/forensics/cordis.patch.yml`）：`preset-apk` 顶部插入「## 动态分析（雷电模拟器，可选）」段（`ldconsole list2`/`launch --index 0`、`adb connect 127.0.0.1:5555`、`adb install -r -t`、`monkey` 启动、`logcat -d`、`screencap`、frida attach、frida-server 缺失提示、明确「没有星睿一键脱壳 MCP，不要承诺一键 dump dex」）；`preset-exe` 顶部插入「## 动态分析（VMware 虚拟机）」段（`vmrun list`、`vmrun snapshot` 先快照、样本只在虚拟机内跑、主机不执行未知 PE、共享文件夹拷样本、回滚）。
- 校验：`npm test` 194/194、`check:overlay` OK、build OK、`settings-check`（`toolPathsRows:15`、`envReportOk`）、`m2-ui-check` 通过。
- 坑：① 往 YAML block scalar 里插文本必须插在 `prefix: |` 之后、且缩进等于正文缩进——第一次按「块末尾」插，落到了 `compaction` 插件行之间，YAML 报 `bad indentation of a sequence entry (1850:17)`、`--dump-config` 行数异常；改为**插在 prefix 之后第一行**即稳定；② 用 `node -e` 内联双反斜杠正则容易被多层转义吃掉（`'^\s*'` 变 `^s*`），改为 `.probe/*.py` 脚本 + `re.escape`。

### 20.127 dsh 运行时升级到 0.2.2-rc.3（第 48 轮）

- 用户要求（m17636）：「然后把dsh更新到最新版」。npm 上 `@deepseek-ai/dsh` 的 `latest` 仍是 `0.2.2-rc.1`（当前版本），`next` 是 `0.2.2-rc.3`。
- 升级：把 `package.json` 里 21 个 `@deepseek-ai/dsh*` 依赖统一装到 `0.2.2-rc.3`（`npm install --save-exact --legacy-peer-deps …`）。
- 坑：rc.3 中 `@deepseek-ai/dsh-subprocess` 把 `@deepseek-ai/dsh-error`、`@deepseek-ai/dsh-http-proxy` 声明为 **peerDependencies**，`--legacy-peer-deps` 不会自动装 → dsh host 启动即 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-error' imported from …/dsh-subprocess/lib/index.js`（`tools/lovely-cli/test/host.test.mjs` 2 例失败暴露）。补装 `dsh-error@0.2.2-rc.3`、`dsh-http-proxy@0.2.2-rc.3` 后恢复。
- 兼容性：dsh-app-boot 的 profile/bundle 解析路径未变（`tools/dsh-plugins.mjs` 的 `installBundledPluginBundles` 逻辑仍有效）；overlay 与 12 个预设解析正常；`plugins-check` 证明 175 个插件包从 asar/profile 注入后全部激活（`activationFailures:[]`）。
- 验证：`npm test` 194/194、`check:overlay` OK、build OK、`plugins-check`（`activationOk:true`）、`settings-check`（`toolPathsRows:15`、`diagOk:true`、`envReportOk:true`）、`m2-ui-check`、`hero-check` 全绿；dev 预览重启后 `/seeu-index/list` 200（首次重启因旧进程占 54053 出现一次 `EACCES`，重试即正常）。

### 20.128 v0.3.13 打包交付（第 49 轮）

- `npm version 0.3.13`；build OK、`npm test` 193/193、`check:overlay` OK；`npx electron-builder --win --x64 -c.directories.output=release-0313`（后台 job `bash-fa1965eefa304297`，exit 0，约 17 分钟）。
- 产物：`win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B、`app.asar` **566,538,202 B（32,976 entries）**、NSIS **320,055,103 B**（blockmap 332,917 B）、portable **270,609,007 B**、目录版 **1,262,703,160 B**；0.3.12 三件删除（portable 因占用保留）。
- asar 自检 `.probe/asar-0313-check.mjs`：**125 项全 true、`missing:[]`**。排障两处：① 从 0312 复制时 `version0311` 检查残留、与 0.3.13 冲突 → 删除并加 `version0313`；② `toolPaths15` 原先断言 `mainJs.includes("id: 'ldplayer'")` 失败（esbuild 输出用双引号/合并写法）→ 改为 `mainJs.includes('ldplayer') && mainJs.includes('vmware') && mainJs.includes('LDPlayer')`。
- 启动验证：目录版 7175 ms、portable 61,634 ms。
- 打包态 e2e：`m2-ui-check`（`m2ok/activityOk/myosImportOk`）、`settings-check`（15 行工具路径、`diagOk`、`envReportOk`）、`plugins-check`（`activationOk:true`）、`skills-check`（`leaked:[]`）、`hero-check`（`toolsOk:true`）、`mount-check` 全绿。
- 坑：打包态 m2 首次失败（活动行为 0）——m2 脚本只在 `SEEU_DSH_HOME` 为**绝对路径**时预置活动；打包态要同时传 `SEEU_DSH_HOME` + `SEEU_USER_DATA` 隔离，否则读用户真实 profile。
- 文档：README §2 产物表换 v0.3.13（含体积上涨说明）、`### v0.3.13 改了什么` 加打包与回归条；`docs/packaging.md`「v0.3.13 回归验证」。
- 提交：本地 `git commit`（Gitea `172.30.211.91:3000` 仍不可达，push 失败，待网络恢复补推）；`present` portable + NSIS。

### 20.129 APK 动态分析接雷电模拟器的实测校正（第 49 轮）

- 实测（本机 LDPlayer14, `D:/Games/leidian/LDPlayer14`）：`ldconsole launch --index 0` 后 `list2` 第 5 列变 `2`（约 20–25 s）；`ldconsole adb --index 0 --command "shell ..."` 可用，返回 `x86_64`、Android 14、型号 `25102RKBEC`、96 个已装包；`/data/local/tmp/fs9283` 是 114 MB frida-server。
- 校正点：**不要用 `adb.exe connect 127.0.0.1:5555`**（实测 `failed to connect` / `adb devices` 显示 offline、`adb -s ... shell` 报 `device not found`），统一走 `ldconsole adb`；persona 同步写明 frida-server 路径与 `ps -A | grep`/`su -c` 启动方式。
- 验证：`check:overlay` OK、`npm test` 194/194、build OK。

### 20.130 接入星睿取证连接器（7 个 streamable-http MCP，第 49 轮）

- 起因：用户问「他的 mcp 和 skill 是怎么配置的」，查 `C:/Users/ASUS/.workbuddy/.mcp.json` 发现星睿用 8 个本机 streamable-http 连接器（30188 computer / 30190 server / 30191 data / 30193 files / 30196 iot / 30195 apk / 3008 traffic / 30192 文件上传）。
- 实现：overlay 追加 `seeu-mcp-xingrui-*` 七行（`transport: streamable-http`、`url`、`toolCallTimeoutMs: 300000`、`failOnStartupError: false`、`reconnect`），`--dump-config` 可见 7 行；`tests/mcp-config.test.mjs` 断言 serverName/url/transport/超时/重连与 MYOS stdio 行；`scripts/check-overlay.mjs` 追加 7 个连接器的存在与 streamable-http 校验。
- 实测：7 个连接器全部连上，星睿工具 **242 个**（MYOS 49），会话工具总数 **317**；`npm test` 195/195、`check:overlay` OK、build OK。
- 坑：`--dump-config` 只证明配置被接受，真正的工具发现要走 headless 会话（`.probe/mcp-headless-check.mjs` 抓 `toolsCount` 与 `mcp__` 前缀）；30195 必须带尾斜杠、3008 的路径是 `/mcp/streamable`。

## 20.131 星睿 MCP 改为「按预设注入」

- 背景：上一版把星睿 7 个 streamable-http 连接器全量注册（全局 `insert` 行），headless 实测会话工具数 317（星睿 242 + MYOS 49 + 基础工具），工具 schema 360,182 B ≈ 9 万 tokens/请求；对本地模型既贵又容易选错工具。用户决定「保留星睿 MCP，但按预设分类」。
- 实现：`resources/forensics/cordis.patch.yml` 删除全局 `seeu-mcp-xingrui-*` 行，改为在各预设的 `plugins:` 列表内注入 1 个 `@deepseek-ai/dsh-mcp-client` 行（`transport: streamable-http`、`serverName`、`url`、`toolCallTimeoutMs: 300000`、`failOnStartupError: false`、20 次重连）：
  - `preset-standard` → `xingrui-server`（13 工具）
  - `preset-mobile` → `xingrui-computer`（108）
  - `preset-apk` → `xingrui-apk`（33）
  - `preset-traffic` → `xingrui-traffic`（39）
  - `preset-data` → `xingrui-data`（7）
  - `preset-files` → `xingrui-files`（21）
  - `preset-iot` → `xingrui-iot`（21）
  - `preset-seeu-lite` / `preset-log` / `preset-memory` / `preset-exe` / `preset-db` 不挂（轻量或本地工具已足够）。
- 校验：`tests/mcp-config.test.mjs` 重写为「每个预设恰好 1 个星睿连接器 + 指定 serverName/transport/failOnStartupError + 轻量预设 0 个 + 无全局行 + serverName 不重复 + MYOS 仍全局 stdio」；`scripts/check-overlay.mjs` 按预设断言（dump 中 preset 段内含对应 serverName、lite/log/memory/exe/db 段内不得出现 `serverName: xingrui-`）；`npm test` 194/194、`check:overlay` OK、build OK。
- 坑：① `preset-standard` 是顶层行（缩进 0）、其余预设在 `- insert:` 内（缩进 4），插件子行缩进分别是 6/10 —— 固定缩进注入会写出 `bad indentation of a mapping entry`，脚本需按 `plugins:` 下第一个子行的实际缩进计算；② 生成器脚本把 `reconnect` 写成 flow mapping 时必须保留 `{ enabled: true, ... }` 空格格式，否则 yaml 报错；③ 删除全局块时要从注释行回退到空行，避免把文件最后一个换行吃掉。
- 验证方式说明：`dsh --help` 没有 `--preset` 参数（预设由 Web UI 选择），headless 无法直接选预设；因此用 overlay 静态校验 + dump-config 段校验确认映射，运行时由预设加载各自 `plugins:` 列表。
- 遗留：星睿未启动时各连接器只告警（`failOnStartupError: false` + 重连）；启动星睿后自动连上；真实会话里 108 工具在本地模型上的选择质量仍待观察。

### 20.132 v0.3.14 打包与回归

- 前半节（§20.131）完成星睿 MCP 按预设注入：7 个预设各挂 1 个连接器（server 13 / computer 108 / apk 33 / traffic 39 / data 7 / files 21 / iot 21），lite/log/memory/exe/db 不挂；tests/mcp-config.test.mjs 重写、check-overlay 逐预设断言、README §11 表格更新。
- `npm version 0.3.14`；`node scripts/build.mjs`；`npm test` 194/194；`check:overlay` OK；`rm -rf release-0314` 后 `npx electron-builder --win --x64 -c.directories.output=release-0314`（job `bash-99d05a6c5aa54b4f`，exit 0）。
- 产物：NSIS 320,055,823 B（blockmap 333,015 B）、portable 270,623,477 B、app.asar 566,541,777 B（32,976 entries）、win-unpacked 1,262,706,735 B。
- `.probe/asar-0314-check.mjs`：首次 `xingruiNotGlobal` 误报（预设内行 id 也含 `seeu-mcp-xingrui-`）→ 改为 `xingruiPerPreset`（恰好 7 条）+ `xingruiNoGlobalRow`（0–3 空格缩进处不存在）；修后 `missing: []`、全部检查 true。
- 启动：目录版 9054 ms（首跑杀毒扫描，通常 5–7 s）、portable 63,882 ms。
- 打包态 e2e：m2（`m2ok:true`）、settings（`toolPathsRows:15`、`diagOk`、`envReportOk`、`thinkingSaved`；mock 端口 28181/CDP 9353 避开 MYOS 18081）、plugins（175 包、`activationOk`）、skills（`leaked:[]`）、hero（`toolsOk`）、mount（`remountHintOk`）全绿。
- 文档：README §2 产物表换 0.3.14 +「### v0.3.14 改了什么」；`docs/packaging.md`「### v0.3.14 回归验证」。
- 坑：① 缩进按 `plugins:` 首个子行计算，不能硬编码；② asar 全文正则判断全局行在「预设内行同前缀」时失效；③ 打包态 e2e 必须隔离 home/userData。
- 遗留：Gitea（`172.30.211.91:3000`）不可达，多个提交仅本地；Spark 真实网关基准需用户提供 baseURL/模型 id/apiKey；VMware 动态分析需用户确认快照与样本。

### 20.133 真实链路实测：2025 美亚杯个人赛（v0.3.15 修复检索 500）

- 目标：用户要求「W:\ 检材 + 2025美亚杯个人赛复现.md，实测链路能不能打通」。写 `docs/chain-check-2025美亚杯.md` 记录逐环结果。
- 链路结果：
  - 火眼：未打开案件时 `ges status --json` → `case_backend_unreachable`；案件打开后 `cid:1`、`ges_url: http://127.0.0.1:8621`、4 个 `evidence_mounts`；`C:\hlnet\*` 可直接读 `iDevice_info.txt`（`BuildVersion 21B91` → iOS 17.1.1）。
  - SeeU 索引：`/evidences` 5 条（recordCount 1/8443/14331/1/1 vs reported 3065/13718/25669/68/3）；`/search` 最初对 `Investors` 返回 `{"error":"ftsQuery is not defined"}`。
  - LovelyCarve：E01 inspect 276 ms、挂 `X:` 687–701 ms（`WEPE`/`Sunny.zip`/`vera_key`）、卸载 163 ms；`blk0_sda.bin` inspect 244 ms、18 个分区（`BOTA0…USERDATA`）、`USERDATA` 挂 `Y:` 838–1001 ms（`/data` 下 `com.whatsapp`/`com.instagram.android`/`com.facebook.katana`）、`SYSTEM` 501 ms、卸载均成功。
- Bug 修复：`tools/ges-index/query.mjs` 的 `search()` 里 `ftsQuery(kw)` 调用不存在（重构遗留），≥3 字关键词走 FTS 分支必 500；2 字关键词走 LIKE 所以旧 e2e（「加密」）一直绿。修复：短词 LIKE、长词单路径 FTS5（删重复过滤），异常回退 LIKE。
- 回归：`tests/search-fts.test.mjs` 2 例（FTS/ LIKE / E_NO_QUERY）；`scripts/e2e/m2-ui-check.mjs` 增加长关键词 `Investors` 断言（`引擎 fts5-trigram · 11 命中`，且引擎标签允许 `fts5-` 前缀）；`npm test` 196–197 全绿、`check:overlay` OK、build OK。
- 版本：`npm version 0.3.15`；提交 **`400e3d3`**（fix + 测试）；随后打包 v0.3.15（v0.3.14 及更早的包检索 ≥3 字会失败）。
- 遗留：本套题无 pcap/内存镜像/可执行样本 → LovelySpark、StarMem、VMware 动态分析未实测（等样本）；E01 的「火眼挂载」是分区节点视图，翻文件应走 LovelyCarve。
