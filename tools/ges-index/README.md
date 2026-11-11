# ges-index — 火眼案件「全解析结果」本地索引

把火眼（GoldenEyes / GES）对案件检材的**全量解析结果**（`/case/检材分析数据/**` 下的
`data.csv` 与 `chat.txt`）抓下来，写成一个本地 SQLite 库，供 dsh 会话**只查库**、
按树状渐进式披露逐层钻取，并输出可回火眼核验的 `Goldeneyes://` 引用。

设计说明见 `docs/plan-case-index.md`（v4.1）。本目录是 M1 的实现（建库器 + 查询面）。

## 前置条件

- Windows + Node **≥ 24**（用到内置 `node:sqlite`，无需 npm 依赖）。
- 火眼本机客户端已安装并**打开目标案件**（`ges status` 能通）。
- 能定位 `ges.exe`：默认探测
  `D:\Programs\Honglian\GoldenEyesV4\skills\ges-case-analysis\bin\ges.exe`
  与 `...\ges-case-management\bin\ges.exe`，也可用环境变量 `SEEU_GES_EXE` 指定。

本工具**只读**火眼数据：仅调用 `ges case ls / case open / status / glob / read`，
不写案件、不写检材；唯一写入的是 `<案件目录>\.seeu-index\`（或 `--out` 指定目录）。

## 建库

```bash
# 只装一个案件时可以省略 --case
node tools/ges-index/cli.mjs build --case 2919d298-f083-4a81-9c12-bd4ca393bcc5

# 用案件目录（等价于 dsh 里把工作目录设成案件目录）
node tools/ges-index/cli.mjs build --case-dir "E:\forensics\W盘_2919d298-f083-4a81-9c12-bd4ca393bcc5"

# 输出到别处 / 调并发 / 断点续跑 / 只抓前 N 个叶子做冒烟
node tools/ges-index/cli.mjs build --case <num> --out .probe/m1 --concurrency 4
node tools/ges-index/cli.mjs build --case <num> --resume
node tools/ges-index/cli.mjs build --case <num> --out .probe/smoke --limit-leaves 6 --rebuild
```

产物（与案件目录同级）：

| 文件 | 说明 |
| --- | --- |
| `.seeu-index/case-index.db` | 索引库（SQLite，含 FTS5 trigram） |
| `.seeu-index/case-index.db.bak` | 上一次成功建库的备份（自动保留） |
| `.seeu-index/manifest.json` | 指纹、统计、耗时、叶子数、失败清单、校验结果 |
| `.seeu-index/case-index.db.building` | 建库中间态；**只有校验通过才会原子替换** |

建库流程：探测案件 → 可写性探测 → 枚举叶子（`**/data.csv` + `**/chat.txt`，分页）→
并发抓取并解析 → 投影与实体 → `pragma integrity_check` → 覆盖率校验（叶子数 == artifact 数
且 0 失败）→ 备份旧库 → `rename` 原子替换 → 写 `manifest.json`。
校验不通过时保留 `.building` 不替换，退出码 1；案件目录不可写时退出码 3 并输出
`{"ok":false,"code":"E_CASE_DIR_READONLY"}`（桌面版据此提示用户，不静默改存）。

节点 id 一律用 `|` 分隔参数、`encodeURIComponent` 编码（中文/emoji/括号账号名都安全）。

## 查询：树状渐进式披露（主入口）

每层只返回下一层的目录摘要（几百字节到 2KB），需要细节再展开下一层。

```bash
# 0. 案件概览 + 检材列表
node tools/ges-index/cli.mjs tree

# 1. 检材 → 应用
node tools/ges-index/cli.mjs tree "ev:3"

# 2. 应用 → 账号（社交 App）或类别（其它）
node tools/ges-index/cli.mjs tree "app:3|WhatsApp"

# 3. 账号 → 类别
node tools/ges-index/cli.mjs tree "acc:3|WhatsApp|<账号目录名>"

# 4. 类别 → 文件
node tools/ges-index/cli.mjs tree "cat:3|WhatsApp|<账号>|群聊消息"

# 5. 文件 → 前 10 条记录（art:<id>:<page> 翻页）
node tools/ges-index/cli.mjs tree "art:343"

# 6. 记录 → 引用（Goldeneyes://... #行号 + 回查命令）
node tools/ges-index/cli.mjs tree "cite:21697"
```

节点形状：`root` → `ev:<eid>` → `app:<eid>|<app>` → `acc:<eid>|<app>|<account>`（仅社交 App）
→ `cat:<eid>|<app>|<account>|<category>` → `art:<id>[:page]` → `cite:<recordId>`；
每层都带 `totals`，`art` 层带 `records.total` 与 `records.next`。
树里的 id 可直接回填下一层命令，**不需要记住任何路径**。

## 查询：搜索与引用

```bash
node tools/ges-index/cli.mjs search -q "陳民浩"          # ≥3 字符走 FTS5 trigram
node tools/ges-index/cli.mjs search -q "加密"            # <3 字符自动回退 LIKE
node tools/ges-index/cli.mjs search -q "85254877240" --eid 3 --app WhatsApp --limit 5
node tools/ges-index/cli.mjs search -q "转账" --from "2025-04-01" --to "2025-04-30"
node tools/ges-index/cli.mjs cite 21697                  # 单条记录的完整引用信息
node tools/ges-index/cli.mjs stats                       # 库统计、各 App 分布、无句柄清单
node tools/ges-index/cli.mjs verify --sample 20          # 随机回火眼核对正文与基址
```

- `cite` 输出里的 `citation` 形如 `[[1]](Goldeneyes://<案号>/<nodeId>#<行号>)`，
  可直接写进报告角标；`verifyCmd` 是回火眼复核该行的命令。
- `verify` 会真的去 `ges read` 抽查：行内容必须逐字相等、基址必须一致，全过才 `pass:true`。
- 无溯源句柄的行（`citable:false`，如 `实体分类/*/data.csv`）不产生 citation，
  只能作为导航线索。

## 库位置与只读约定

查询命令默认按 `--db` → `--case-dir` → 当前目录下的 `.seeu-index/case-index.db` 顺序解析。
dsh 会话侧只以**只读连接**打开该库，不执行写操作、也不调用 `ges.exe`。

## 已知限制

- 只索引 `/case/检材分析数据/**`；`关联分析/**`、`标记数据/**`、`笔记数据/**` 尚未接入（M2）。
- 二进制（图片/视频/音频）只入元数据，不做 OCR（M6，可延后）。
- 火眼改版可能改列名：原始行已整行保存（`record.text` + `fields_json`），列漂移不会丢数据。
- 2 字中文关键词走 `LIKE`，大库上比 FTS 慢（本案 2.3 万条实测 1ms 量级，可接受）。
- 单案 370 叶实测约 4 分钟（并发 3），DB 约 53 MiB；更大案件按叶子数线性增长。
