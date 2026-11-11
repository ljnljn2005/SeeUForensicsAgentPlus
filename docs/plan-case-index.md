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
