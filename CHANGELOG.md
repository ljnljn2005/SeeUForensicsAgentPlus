# 更新日志

SeeUForensicsAgentPlus 的版本更新记录（新 → 旧）。每个版本的产物大小、验证结果与已知限制另见 `docs/packaging.md` 与对应的 GitHub Release。

## v0.3.32

- **内置 MCP 新增第 7 个工具 `read_table`**：读取一张结构化表的明细行（通话、短信、联系人、浏览/搜索记录、Exif、应用列表等），支持按检材（`eid`）、应用、时间范围过滤与 `limit/offset` 分页；每条结果带 `[id …]`，可直接再调 `read_record` 取正文与 `Goldeneyes://` 引用。
- 运行环境体检与文档同步为「7 个只读工具」；技能 `seeu-chain-check` 的用法补一条：先 `index_tables` 看表，再 `read_table` 取明细，单条原文用 `read_record`。

### 验证

- `npm test` 240/240（新增 `tests/mcp-server-tools.test.mjs`：7 个工具清单、`read_table` 必填 `table`、转发 `/table` 且结果带 id）。
- 真实 headless 会话实测：会话内共 82 个工具，`mcp__seeu__*` 七个齐全（含 `mcp__seeu__read_table`）。
- asar 自检：32,967 个条目、无缺失、0 项失败（新增 `readTableTool`）。
- 启动验证：目录版 33.8 秒、便携版 52.5 秒。
- 打包态：作业案件（45,237 记录）`m2-ui-check` → `m2ok:true`；`settings-check` → `ok:true`（环境体检 8 项）。

## v0.3.31

- **「继续扫描」改为从上次停下处续扫**：点【继续扫描 +2.5 秒】时会带上上次扫描停下的 `record.id`（`scanFromId`），只扫未扫过的区间，不再从库头重扫一遍；提示条显示「从第 N 行续扫，本轮扫 X 行」并累计「累计已扫 M 行」。扫到库尾后按钮自动禁用并提示「已扫到库尾」。
- 检索接口新增 `scanFromId` / `scanNextId` 两个字段，供面板与后续工具复用（MCP/脚本也可直接带游标续扫）。

### 验证

- `npm test` 238/238（新增续扫单测：游标只前进、续扫不返回游标之前的命中）。
- overlay 检查 OK、构建 OK。
- 2.6 GB 案件（842,198 记录）dev e2e：`m2ok:true`，`continueScan:"clicked"`、结果卡片刷新后出现续扫提示。

## v0.3.30

- **结果可能不全时可直接「继续扫描」**：检索与记录视图在短词（<3 字）扫描预算用尽、结果不完整时，显示黄色提示条与【继续扫描 +2.5 秒】按钮，点一次追加预算重跑（最多 30 秒），不需要回设置页改配置。
- **修复并发检索结果乱序**：慢的旧检索请求（大库上 2 字扫描要几秒，叠加「继续扫描」更久）不会再晚到并覆盖新关键词的结果。

### 验证

- `npm test` 237/237、`check:overlay` OK。
- asar 自检：32,967 个条目、`missing: []`、0 个 false（新增 `continueScanUi`）。
- 启动：目录版 `ok:true, elapsedMs:33150`；便携版 `ok:true, elapsedMs:48797`。
- 打包态：2.6 GB 案件 `m2-ui-check` → `m2ok:true`（含「继续扫描」点击）；`settings-check` → `ok:true`。

## v0.3.29

- **短词扫描预算可在面板调整**：面板建库行新增「短词 1.5 / 2.5 / 5 / 10 秒」下拉，保存到 `<DSH_HOME>/index-scan-budget.json`（环境变量 `SEEU_INDEX_SCAN_BUDGET` 可覆盖），同时作用于检索和记录视图；短词检索结果里会注明「已扫描 N/M 行」，便于判断结果完整度。
- 记录 CSV 导出单独使用 8 秒预算，整批导出不会被单次 2.5 秒的预算截断。
- 内置 MCP 的 `index_search` 输出补充「已扫描 N/M 行」。

### 验证

- `npm test` 235/235、`check:overlay` OK。
- asar 自检：32,967 个条目、`missing: []`、0 个 false（新增 `scanBudgetModule`、`scanBudgetRoute`、`scanBudgetPicker`、`scanBudgetMcp`）。
- 启动：目录版 `ok:true, elapsedMs:54761`；portable `ok:true, elapsedMs:92140`（首启受杀毒扫描影响）。
- 打包态：2.6 GB 案件 `m2-ui-check` → `m2ok:true`（842,198 记录、筛选 234,374、`scanBudgetOk:true`）；`settings-check` → `ok:true`（环境体检 8 项、工具路径 15 行、关于页 0.3.29）。

## v0.3.28

- **记录视图短关键词检索提速**：842,198 条记录案件上，2 字关键词从 50 秒降到约 2.5 秒。记录视图以前固定先跑全表 `count(*)`（约 9 秒）并按时间倒序取页，短词还要叠加全表逐行匹配；现在改为按 id 分块顺序读 + 时间预算（默认 2500 ms），命中窗口再按时间排序，关键词请求不再跑全表计数。
- 面板记录条数显示为「记录 **≥ N** 条」，并注明「已扫描 N 行，结果可能不全；用 ≥3 个字或加检材/应用/时间筛选更快」。

### 验证

- `npm test` 232/232、`check:overlay` OK。
- asar 自检：32,966 个条目、`missing: []`、0 个 false（新增 `recordsShortScan`、`recordsApproxLabel`）。
- 启动：目录版 `ok:true, elapsedMs:42642`；portable `ok:true, elapsedMs:69958`。
- 打包态：2.6 GB 案件 `m2-ui-check` → `m2ok:true`（842,198 记录、筛选 234,374）；`settings-check` → `ok:true`。

## v0.3.27

- **短关键词（<3 字）检索提速**：842,198 条记录案件上，2 字词检索从 45 秒降到约 3 秒。做法是按 rowid 分块顺序读 + 时间预算（默认 2500 ms，可用 `scanBudgetMs` 调整），到点即返回已找到的结果，并在面板/MCP 里注明「已扫描 N/M 行，结果可能不全；用 ≥3 字或加筛选更快」。
- **新增索引性能自检**：`npm run perf:index -- --case <案件目录>`（或 `--db <case-index.db>`）会逐项打印 `statsOf/tree/evidences/facets/records/entity/timeline/typedTables/search` 的耗时与索引规模，方便判断面板慢在哪一环。
- **大库自动化回归更稳**：`m2-ui-check` 支持千分位数字、慢渲染轮询与独立 `--user-data-dir`，2.6 GB 案件（842,198 记录 / 416,963 实体）与 45k 案件均 `m2ok:true`。

### 验证

- `npm test` 231/231、`check:overlay` OK。
- asar 自检：32,966 个条目、`missing: []`、0 个 false；启动验证目录版 10,263 ms、portable 63,178 ms。
- 打包态：2.6 GB 案件 `m2-ui-check` → `m2ok:true`；`settings-check` → `ok:true`（环境体检 8 项含内置 MCP）。

## v0.3.26（2026-11-18）

- 大库（2.6 GB / 842,198 记录）性能与稳定性收口：建库预聚合与快照、短词检索早退、挂载探测快失败、`m2-ui-check` 案件无关化；打包态用该案件回归 `m2ok:true`。

## v0.3.33

- **实体视图新增【导出 CSV】**：把当前筛选（实体类型 / 值关键词 / 检材）下的实体聚合清单整批落盘——列「类别、值、出现次数、涉及检材数、检材号」，UTF-8 BOM + CRLF，Excel 直接打开；默认最多 2 万行，超出提示截断。
- 后端新增 `GET /seeu-index/export/entities.csv`（参数 `kind/q/value/eid/max`，按 200 条一页翻到上限，支持唯一值下钻场景），响应头带 `x-seeu-rows/total/truncated`。
- `scripts/e2e/export-check.mjs` 增加实体 CSV 断言（BOM、表头、行数），并把表视图步骤改为「自动挑有数据的表」（优先联系人 → 图片 Exif → 消息 → 应用列表），案件没有 typed 表时按环境跳过而不是判失败。

### 验证

- `npm test` 241/241（新增 `entitiesCsv` 单测）。
- `export-check`（作业案件）：实体 CSV `4,597` 行 / 173,557 B / BOM true / 表头正确；表视图自动选中「图片 Exif（20537）」，表 CSV 20,000 行 / 1,304,995 B；记录 CSV 20,000 行；`ok:true`、`errors:[]`。

## v0.3.34

- **检索结果导出改为服务端一次取全**：原来在前端按页循环拉取（受页面 limit/扫描预算影响、慢且容易只导当前页）；新增只读接口 `GET /seeu-index/export/search.csv`（`q` + 检材/应用/账号/类别/时间筛选，`max` 默认 20000、上限 50000，服务端 100 条/页翻页并补齐检材名），响应头带 `x-seeu-rows/total/truncated/partial`；面板提示会区分「共 N 条，单次最多 2 万行」与「短词未扫完可先继续扫描再导出」。
- 新增 `searchCsv(rows)`（列：检材号/检材名称/应用/账号/类别/时间/行号/记录ID/摘要，摘要压成单行）。
- e2e 与具体案件解耦：`search-filter-check` 未指定 `SEEU_SEARCH_KEYWORD` 时自动从索引前 40 条记录里挑一个「能命中」的关键词；2 字关键词检索改为轮询等待（不再固定 sleep）；「导出全部」断言按 min(total, 200) 计；表视图自动挑有数据的表、没有 typed 表时按环境跳过。

### 验证

- `npm test` 243/243（新增 `searchCsv` 单测）。
- `search-filter-check`（作业案件，3 字自动关键词 `2022`）：`ok:true`、命中 1,057 条、导出 CSV 6 行（当前筛选）且文件 BOM/表头正确。
- `search-filter-check`（2 字关键词 `20`）：`ok:true`、服务端导出 **10,966 行**（`x-seeu-partial:1`）、等待 7.2 秒。

## 未发布

### 导出文件名带案件标签 + 最近导出显示来源（v0.3.42 待打包）

- 面板所有 CSV 导出文件名统一加案件目录标签与本地时间戳：`记录导出-作业_20261118081854I-20261123-044811.csv`、`表导出-图片 Exif-<案件>-<时间>.csv`、`检索导出-<案件>-<时间>.csv`、`实体导出-<案件>-<时间>.csv`，多案件导出后不会再混。
- 「最近导出」每行新增来源标签：`面板`（面板里点导出）或 `MCP`（模型用内置 MCP 导出，文件名以 `seeu-mcp-` 开头），并显示可读大小（B/KB/MB）。
- `tools/export-dir.mjs` 的 `listExports()` 返回值新增 `source` 与 `sizeText`；测试同步断言。
- 验证：`npm test` 248/248；dev `m2-ui-check` → `m2ok:true`、`exportsSources:{count:2,mcp:1,panel:1}`；`export-check` → 三个 CSV 文件名均含案件标签（记录 20,000 行 / 表 20,000 行 / 实体 588 行）。


### 最近导出支持打开与删除（v0.3.41 待打包）

- 面板「最近导出」每一行现在可点击：点文件名用系统默认程序打开（CSV 直接进 Excel），行尾「×」直接删掉这个导出文件（不再永久堆积）。
- 删除只允许导出目录内的单层文件、且扩展名限 CSV/JSON/MD/TXT（拒绝 `..` 路径与绝对路径），网页预览里不执行文件操作、只显示提示。
- 新增 IPC `seeu:exports:open-file` / `seeu:exports:remove` 与插件路由 `POST /seeu-index/exports/remove`；`tools/export-dir.mjs` 增加 `resolveExportFile()` / `removeExport()`。
- 测试：`tests/export-dir.test.mjs` 增 2 例（路径穿越/扩展名/不存在拒绝；删除成功与幂等失败）→ `npm test` 248/248；e2e `m2-ui-check` 增 `exportsRemoveOk`（预置探针文件 → 点 × → 磁盘上确认已删）。


- **内置 MCP 新增第 8 个工具 `export_records`**：把检索结果直接导出成 CSV（UTF-8 BOM、列与面板导出一致），返回文件路径与行数，方便模型把「命中清单」作为交付物给用户，或再用表格工具继续处理。
  - 参数：`q`（必填）、`caseNumber|db`、`eid`、`app`、`from`、`to`、`max`（默认 2 万、上限 5 万）。
  - 实测：作业案件 `q=2022`、`max=500` → 500 行 / 50,813 B，返回「已导出 500 行到 …seeu-exportsseeu-mcp-<时间戳>.csv / 命中（近似）1057 · 结果被截断」。
- **面板新增「最近导出」卡片**：索引面板里列出导出目录（默认 `下载/seeu-exports`，`SEEU_EXPORT_DIR` 可覆盖）最近 8 个 CSV/JSON/MD 文件（文件名、大小、时间），带【刷新】与【打开导出目录】；面板导出的 CSV 与模型用 MCP 导出的文件都会出现在同一目录（外壳启动时把该目录以 `SEEU_EXPORT_DIR` 下发给插件与 MCP）。
- **MCP 新增第 10 个工具 `export_timeline`**：把案件时间线按小时/天/月聚合导出成 CSV（日期、记录数、检材数、应用数），返回保存路径、行数与日期范围，适合交付「活动时间线」或看时间段分布。
  - 实测（作业案件，`bucket:'month'`）：40 行、范围 `2000-11 ~ 2022-05`、共 10,156 条记录。
- **MCP 新增第 9 个工具 `export_entities`**：把实体清单导出成 CSV（类别/值/出现次数/涉及检材数/检材号），返回保存路径与行数；支持 `kind`、`q`、`eid`、`max`（默认 2 万 / 上限 5 万），文件名 `seeu-mcp-entities-<时间戳>.csv`。
  - 实测（作业案件）：`{max:20}` → 20 行、实体总数 4,597（结果被截断）。
- **MCP `export_records` 支持按表导出**：新增可选参数 `table`（表名见 `index_tables`），导出该结构化表的明细 CSV（列随表，如 `web_visit` 的 url/search_term/ts），文件名 `seeu-mcp-table-<表名>-<时间戳>.csv`；不传 `table` 仍是检索结果导出。
  - 实测（作业案件）：`{table:'web_visit', max:100}` → 44 行 / 5,607 B；`{q:'apple', max:50}` → 50 行（命中 4,489，截断）。
  - 兼容：表导出接口的 `x-seeu-truncated` 是 `true/false`，检索接口是 `1/0`，统一判断。
- 修 MCP 服务端退出时的 libuv 断言：EOF 后不再 `process.exit(0)` 强杀，改为设置 `process.exitCode` 让事件循环自然结束（Windows 上强杀会在 stdout 关闭期间 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`）。

- **检索导出加「超时保护」**：`/seeu-index/export/search.csv` 新增 `maxMs`（默认 20000，可用 `SEEU_EXPORT_MAX_MS` 调，2–120 秒），超过预算就停并把已扫到的行返回，响应头 `x-seeu-timed-out:1`；面板提示「超时保护：还有更多，建议加检材/时间筛选或改用 ≥3 字关键词」。
  - 实测（作业案件、842k 同一批数据规模的 `20` 关键词）：`maxMs=3000` → 6,600 行 / 3.07 s / `timed-out=1`；`maxMs=20000` → 14,971 行 / 11.06 s / 完整（`truncated=0`）。
（文档整理）

- **结果可能不全时可直接「继续扫描」**：检索与记录视图在短词扫描预算用尽、结果不完整时，显示黄色提示条与【继续扫描 +2.5 秒】按钮，点一次追加预算重跑（最多 30 秒），不用回设置页改配置。
- **修复并发检索结果乱序**：慢的旧检索请求（大库 2 字扫描）不会再覆盖后来的新关键词结果。

- **短词扫描预算可在面板调整**：面板建库行新增「短词 1.5/2.5/5/10 秒」下拉，保存到 `<DSH_HOME>/index-scan-budget.json`（`SEEU_INDEX_SCAN_BUDGET` 环境变量可覆盖），同时作用于检索与记录视图；MCP `index_search` 输出里也会带「已扫描 N/M 行」。

- 记录视图短关键词（<3 字）同样改为分块预算扫描：842k 记录案件上从 50 秒降到 2.5 秒（此前 `order by ts` + 全表 LIKE 会扫完整张表）；条数显示为「记录 ≥ N 条」并提示已扫描行数。

### 未发布：大库短词检索与自检工具

- 短关键词（<3 字）在大库上改为「按 rowid 分块顺序读 + 时间预算」（每块 5000 行、默认 2500 ms、可用 `scanBudgetMs` 调整），命中够数或超预算即返回；结果带「已扫描 N/M 行」「结果可能不全」提示，实测 842k 记录案件 2 字词 45 s → 约 3 s。`npm test` 231/231。
- 新增索引性能自检：`npm run perf:index -- --case <案件目录>`（或 `--db <case-index.db>`）逐项打印 `statsOf/tree/evidences/facets/records/entity/timeline/typedTables/search` 耗时与规模。

- 短关键词检索优化：2 字词在大库上不再跑全表 `count(*)`，只取前 N 行并显示「≥ N 命中」+「用 ≥3 个字更快」提示（842k 记录实测 45 s → 0.5 s）。

- 大库性能：建库时预聚合面板常用统计 —— `meta.stats_json`（计数/实体类型/各检材记录数）、`timeline_bucket`（按天×检材×应用）、`facet_app/facet_category/facet_account`、`entity_group`（实体按 kind+value 聚合），并给 `record(ts/eid/app)`、`entity(kind,value_norm)` 建索引。实测 842,198 记录 / 2.6 GB 索引：`statsOf` 35.6 s → 0.18 s、`timeline` 31.8 s → 2 ms、`entity` 3.2 s → 27 ms、`facets` 2 ms；查询函数保留无预聚合表时的实时回退。

- 建库支持「个别叶子超时/坏掉」的处理：`--leaf-timeout <秒>`（默认 180，单叶读取超时）、`--allow-partial`（接受少量失败叶子，manifest 记 `coverageOk:false` 与失败清单）、`--finalize`（不重新抓取，直接校验既有 `case-index.db.building` 并原子替换，用于 99% 已完成、只剩个别叶子卡死的收尾）。CLI 实测：980 叶子中 1 个分区 5 文件系统日志 `data.csv` 读超时，用 `--finalize --allow-partial` 收尾成功（979 artifact / 842,198 记录 / 416,963 实体 / 2.65 GB）。修 `finalizeBuilding` 在 Windows 上先关闭数据库再 rename（否则 EBUSY）。

- 面板支持「继续上次建库」：当所选目录存在中断的半成品（`.seeu-index/case-index.db.building`）时，「建库 / 更新」旁出现【继续上次建库】（`data-build-resume`，显示半成品 MB），请求带 `rebuild:false` 从断点续跑、不重跑已完成叶子；普通建库仍默认 `rebuild:true`。m2 e2e 增加 `buildResumeHiddenOk` 断言（无半成品时不出现）。

- 建库中途火眼案件服务断开（用户关闭火眼/服务崩溃）时不再把剩余叶子全记成失败：连续 3 次连接类错误（`ConnectionError`/`case_backend_unreachable`/`WinError 10061`）立即 `E_BACKEND_LOST` 终止，保留已完成叶子在 building 库，重新打开案件后 `--resume` 继续。新增 `isBackendLostError()` 纯函数与 4 例单测。

- 面板「建库 / 更新」增加并发选择（3 / 6 / 8，默认 3，存 `localStorage.seeu.buildConcurrency`）：大案件（上千叶子）可用并发 6 提速；m2 e2e 增加 `buildConcurrencyOk` 断言。

- 建库断点续跑更安全：半成品里存在「不属于当前叶子集」的已完成叶子时（旧枚举，或案件仍在火眼解析导致叶子数变化），立即 `E_STALE_BUILDING` 提示改用 `--rebuild`，不再白跑 10 分钟到校验才失败；校验失败信息也区分「失败叶子」与「artifact 残留」两类。新增 `staleResumeLeaves()` 纯函数与 3 例单测。

- 「关于 SeeU」的纯整形逻辑抽到 `tools/app-info.mjs`（`buildAppInfo`/`formatAppInfoText`/`RELEASE_URL`），`src/app-info.ts` 只负责采集；新增 `tests/app-info.test.mjs` 3 例（默认值/文案/缺失 dsh），测试 220/220。

- 建库中断的案子不再「消失」：扫描/列表会显示「⚠ 上次建库未完成 · 半成品 X MB」（只存在 `case-index.db.building` 的目录），点该行会把目录填进输入框，点「建库 / 更新」会重新建（默认 rebuild，自动丢弃半成品）。

- 案件索引面板的链路体检支持【含镜像解析】：结果卡片里新增按钮，点击后带 `images=1` 重新体检，额外调用 LovelyCarve 解析案件内 E01/DD 镜像并显示「镜像解析 ✓/×」环节（默认仍是不解析，保持面板秒开）；e2e 增加 `idxChainDeepSteps`/`idxChainDeepOk` 断言。

- 更新日志从 `README.md` 迁出到本文件：README 只保留产品说明、快速开始与各功能章节，§2 末尾改为指向本文件；README 章节序号顺延为 14 链路体检 / 15 iOS 取证速查 / 16 题目实测答案 / 17 许可与来源。

## v0.3.25（2026-11-18）

- 设置页新增「关于 SeeU」卡片：版本/安装版标识、Electron·Chromium·Node 版本、dsh 版本、平台、程序目录、数据目录、发布页；支持【刷新】【复制信息】（反馈问题时直接粘贴）。
- 新增 IPC `seeu:app:info`（`src/app-info.ts` 纯函数 `buildAppInfo/formatAppInfoText`），dev 与打包态路径差异在模块内消化。
- 打包验证：NSIS 320,092,663 B / portable 270,622,742 B / app.asar 566,618,883 B（32,988 entries）；目录版启动 47,289 ms（首启杀软扫描）、portable 73,489 ms；打包态 `settings-check`（`aboutOk:true`、`aboutVersion:"0.3.25"`、`aboutCopyOk:true`）与 `m2-ui-check`（作业案件 45,237 条，`m2ok:true`、含镜像解析 4 行）全绿。

## v0.3.24（2026-11-18）

- 修复链路体检【含镜像解析】按钮点击报 `ReferenceError: ix is not defined`（结果卡片在 `indexes.map` 之外，改为从 `chain.caseNumber/dbPath` 取目标）。
- 面板 e2e（m2-ui-check）改为**案件无关**：动态选择检材下拉、通用检材文件名正则、长关键词允许 0 命中、来源筛选不依赖具体案件名；便于任意案件回归。
- 打包验证：NSIS 320,090,795 B / portable 270,605,967 B / app.asar 566,610,247 B（32,988 entries）；目录版启动 9394 ms、portable 79315 ms；打包态 m2（记录筛选 45237→20452、实体分页、时间线筛选、索引来源筛选、链路体检 3 行 + 含镜像解析 4 行）、settings、plugins、skills、hero、mount 全部 `ok:true`。

## v0.3.23

- 欢迎页新增「MCP：6 工具」chip：外壳 IPC `seeu:mcp:info` 返回 `mcpFacts()`（dev/打包两套路径、读 `server.mjs` 统计工具数），chip 绿点表示就绪、琥珀表示未就绪；点击打开设置窗口。
- `hero-check` 新增 `mcpText`/`mcpTools`/`mcpOk` 断言（实测「MCP：6 工具」）；`m2-ui-check` 回归通过。
- **打包与回归**：v0.3.23 打包（NSIS 320,029,815 B / portable 270,587,054 B / asar 566,492,194 B / 32,966 entries），asar 143 项全 true、`missing:[]`；目录版与 portable 启动均 `ok`；打包态 `hero-check`（`mcpOk:true`、`toolsOk:true`、入口 15/15）与 `m2-ui-check`（`idxChainSteps:3`）通过；`npm test` 214/214、`check:overlay` OK。

## v0.3.22

- 新增 `scripts/e2e/seeu-mcp-live-check.mjs`（`npm run test:e2e:mcp-live`）：真实 Electron → dsh 会话 → 内置 MCP（stdio）→ 索引插件 HTTP → 索引库的端到端验证。mock 网关首轮让模型调用 `mcp__seeu__evidence_list`，断言：工具列表里 5 个 `mcp__seeu__*` 都在、工具被执行、回传内容里出现真实检材（`CHAN_MH_mobile.zip`、`eid 1`、火眼挂载 route）。
- 实测：`ok:true`、`seeuToolCount:5`、工具结果 512 字符、`looksReal:true`、共 3 轮请求。
- MCP 新增第 6 个工具 `read_record`：按记录 id 取正文 + 证据路径/行号 + Goldeneyes 引用 + `ges read` 复核命令（插件新增 `GET /cite?id=`，`tests/cite.test.mjs` 3 例）。

- 运行环境体检新增第 8 项「内置 SeeU MCP」：服务端缺失判 fail（提示重装/重新解包），正常时显示「6 个只读工具已就绪（index_list / evidence_list / index_search / index_tables / read_record / chain_check）」；`src/env-report.ts` 的 `mcpFacts()` 会按 dev/打包路径读取 `tools/seeu-mcp/server.mjs` 统计工具数。
- `scripts/e2e/settings-check.mjs` 体检断言升到 8 项（dev 实测 7 正常 · 1 注意 · 0 不可用）。
- **打包与回归**：`npm test` 214/214、`check:overlay` OK；`release-0322` 打包后 asar 自检 0 false、`missing:[]`；目录版与 portable 均能启动（6176 ms / 52.8 s）；打包态 `m2-ui-check`（`idxChainSteps:3`）、`settings-check`（体检 8 项、`mcp` 正常）、`plugins-check`（175 包）、`skills-check`（10 随包）、`hero-check`（15/15）、`mount-check` 全部通过。

## v0.3.21

- **内置 MCP 扩展到 5 个工具**：除 `index_list`（列案件、拿 caseNumber）与 `chain_check`（链路体检），新增：
  - `evidence_list`：检材清单（eid / 名称 / 类型 / 入库vs火眼统计 / 原始文件 / 火眼只读挂载路径 / 备注首行）——回答「什么系统/型号/哪个镜像」先看备注；
  - `index_search`：索引检索（≥3 字 FTS5 trigram、短词 LIKE），返回摘要 + 来源（eid · 应用 · 时间）；
  - `index_tables`：结构化表清单（聊天、联系人、浏览器历史等）。
- **caseNumber 宽松解析**：MCP 侧先 `/list` 再按「完整编号 → 前缀 → 案件名」解析，`2919d298` 这样的前缀也能用（索引插件自身只做精确匹配）。
- 技能 `seeu-chain-check` 更新为「MCP 五工具 → HTTP 兜底」。
- headless 实测：会话工具含 `mcp__seeu__index_list`、`mcp__seeu__evidence_list`、`mcp__seeu__index_search`、`mcp__seeu__index_tables`、`mcp__seeu__chain_check` 五个，`evidence_list` 能读出「CHAN_MH 入库 1 / 火眼 3065 + 备注 iOS17.1.1 + 挂载 /evidence_mounts/eid-1/」。
- 打包与回归：NSIS 320,028,826 B（blockmap 332,580 B）、portable 270,596,906 B、`app.asar` 566,487,574 B（32,966 entries）、目录版总计 1,262,569,393 B；asar-0321 自检 0 false（新增 `seeuMcpTools`/`seeuMcpSkill`/`seeuMcpArgs`）；冷启动 7.3 s、便携版 52.6 s；打包态 m2（`idxChainSteps:3`）通过。

## v0.3.20

- **SeeU 内置 MCP**：外壳随会话启动一个 stdio MCP 服务（serverName `seeu`），把两个只读能力直接交给模型：`mcp__seeu__index_list`（列案件索引、拿 caseNumber）、`mcp__seeu__chain_check`（链路体检：索引/检索/火眼挂载/镜像，可读文本返回）。实现 `tools/seeu-mcp/server.mjs`（纯 JSON-RPC，转发到索引插件 HTTP，不直读文件）；外壳注入 `SEEU_MCP_NODE`（Electron 自带 node）+ `SEEU_MCP_SERVER`，打包后脚本放 `app.asar.unpacked/tools/seeu-mcp/`，`ELECTRON_RUN_AS_NODE=1` 运行，用户机器无需装 Node。
- headless 实测：会话工具 77 个，其中 `mcp__seeu__chain_check`、`mcp__seeu__index_list` 均已出现；打包版用 `SeeUForensicsAgentPlus.exe + ELECTRON_RUN_AS_NODE=1` 直接跑 unpacked server 验证通过。
- 技能 `seeu-chain-check` 更新：优先用 MCP 工具，HTTP `curl` 作为兜底。
- 打包与回归：NSIS 320,027,278 B（blockmap 332,907 B）、portable 270,578,413 B、`app.asar` 566,486,765 B（32,966 entries）、目录版总计 1,262,671,181 B；asar-0320 自检 0 false（含 `seeuMcpRow`/`seeuMcpServer`/`seeuMcpIpc`）；冷启动 6.4 s、便携版 54.0 s；打包态 m2（`idxChainSteps:3`）等回归全绿。

## v0.3.19

- **链路体检给 AI 用**：`GET /seeu-index/chain-check` 新增 `text=1` 纯文本输出，`curl -s "$SEEU_INDEX_API/chain-check?caseNumber=<编号>&text=1"` 直接得到「索引覆盖 / 检索链路 / 火眼挂载 / 镜像」四段可读报告；新增随包技能 `seeu-chain-check`（教会 AI 在深入取证前先自检，失败先修链路而不是全盘 grep）。
- 打包与回归：NSIS 320,022,835 B（blockmap 333,132 B）、portable 270,611,871 B、`app.asar` 566,485,135 B（32,964 entries）、目录版总计 1,262,663,454 B；asar-0319 自检 0 false；冷启动 6.3 s、便携版 52.6 s；打包态 m2（`idxChainSteps:3`）/settings/plugins/skills（10 随包）/hero/mount 全绿。

## v0.3.18

- **链路体检逐环节**：面板「体检」结果卡片不再只有一行摘要，而是拆成「索引 / 检索 / 火眼挂载 / 镜像解析」四行，每行带 ✓/× 与细节；e2e 断言 `data-chain-step` 数量与文案；打包态实测 `steps:3`、`「Investors」fts5-trigram · 11 命中`、`火眼挂载 4/4 可读`。
- 打包与回归：NSIS 320,080,738 B（blockmap 333,236 B）、portable 270,641,430 B、`app.asar` 566,597,933 B（32,984 entries）、目录版总计 1,262,776,252 B；asar-0318 自检 0 false；目录版冷启动 6246 ms、portable 54,630 ms；打包态 m2/settings/plugins/skills/hero/mount 全绿。

## v0.3.17

- **面板「链路体检」**：索引行新增「体检」按钮，一键检查「索引可打开 → 检索可用 → 火眼挂载可读 → 镜像可解析」，结果卡片显示「✅ 全部通过 / ❌ 有环节失败」+ 案件/规模/检索命中/挂载可读数，可【复制报告】。
- **编排器复用**：链路逻辑抽到 `tools/chain-check-run.mjs` 的 `runChainCheck()`（支持依赖注入，单测 5 例），CLI（`npm run chain:check`）与插件路由 `GET /seeu-index/chain-check` 共用；实测面板对 W 盘案件返回「22776 条记录 / 8191 个实体 · 检索 Investors 11 命中 · 火眼挂载 4/4 可读」。
- **修复打包白名单**：插件静态 import 的 `tools/chain-check-run.mjs`、`tools/image-mount.mjs` 必须进 asar，否则打包后插件整体加载失败——v0.3.17 已加入并验证（`chainCheckRoute`/`chainCheckPanel`/`chainCheckRunModule` 检查全 true）。
- 打包与回归：asar 自检 0 false、`missing:[]`；目录版 7547 ms / portable 52.9 s；打包态 `m2-ui-check`（含面板体检 `idxChainOk:true`）、`settings-check`、`plugins-check`、`skills-check`、`hero-check`、`mount-check` 全绿。

## v0.3.16

- **链路体检工具**：`npm run chain:check -- --caseNumber <案号>`（或 `--db <索引路径>`）一条命令检查「索引可打开 → 检索可用 → 火眼挂载可读 → 镜像可解析」，输出人类可读报告（`--json` 输出 JSON、`--out` 落盘）。
  - 实测 W 盘美亚杯案件：`22776 条记录 · 8191 个实体 · 360 个检材文件`；`Investors` → `fts5-trigram · 11 命中`；4 个火眼挂载可读（`CHAN_MH_mobile.tar` 等）；`AP3_LEUNG_YL_USB.E01` 解析 2 分区（177 ms）。
  - 通过 `describeIndexCoverage()` 标出「有解析内容」与「仅元数据」的检材，避免误以为索引丢了数据。
  - 退出码：0 全通 / 1 有失败环节 / 2 参数错误或找不到索引，可直接进 CI。
- **iOS 全量提取速查技能**：新增 `resources/forensics/skills/ios-full-extraction-quick`（`iDevice_info.txt` 一次回答系统版本/IMEI/ICCID/蓝牙 → WiFi 已知网络 plist → 已装应用包名 → Safari History.db → WhatsApp/微信库），并把美亚杯 7 道题做成可复现实测表（见 `docs/chain-check-2025美亚杯.md`）。

- **iOS 速查 CLI**：`npm run ios:quick -- summary <提取根目录>`（`tools/ios-quick.mjs` + `scripts/ios-quick.mjs`），子命令：device / accounts / photos / imports / order / safari / wa-sessions / wa-members / wa-calls / wa-locations / wechat / summary；`node:sqlite` 只读打开，单测 6 例（README §15）。
- **打包与打包态回归（v0.3.16）**：asar 自检 46 项（新增 `tools/chain-check.mjs`、`tools/ios-quick.mjs` 必需路径与 `chainCheckCli`/`iosQuickCli` 等检查）全 true、`missing:[]`；`verify-launch` 目录版 7252 ms、portable 52709 ms；打包态 `m2-ui-check`、`settings-check`（15 行工具路径 / 诊断五项 / 环境体检 / 一键复制与导出）、`plugins-check`、`skills-check`（随包 9 个技能，含 `ios-full-extraction-quick`、`usb-winpe-quick`）、`hero-check`（本机工具 15/15）、`mount-check`（含重新挂载）全绿。打包白名单里的 `tools/*.mjs` 会进 asar；`scripts/*.mjs` 是开发态 CLI，不进安装包。

## v0.3.15

- **修复检索接口 500**：`/seeu-index/search` 对 ≥3 字关键词报 `{"error":"ftsQuery is not defined"}`（`search()` 里调用了历史遗留的不存在函数）——现在短词（<3 字）走 LIKE、长词（≥3 字）走 FTS5 `record_fts match`，异常回退 LIKE；2 字关键词「加密」一直是正常的，所以旧 e2e 没暴露。
- 回归：新增 `tests/search-fts.test.mjs`（2 例）；`m2-ui-check` 增加长关键词「Investors」断言（`引擎 fts5-trigram · 11 命中`）。
- **真实链路实测记录**：见 [`docs/chain-check-2025美亚杯.md`](docs/chain-check-2025美亚杯.md)——W:\ 的 2025 美亚杯检材（5 份手机/USB/Android 镜像）上，火眼挂载、SeeU 索引、LovelyCarve 分区挂载（含 31.9 GB Android eMMC）逐环实测；本套题无流量/内存/可执行样本，LovelySpark/StarMem/VMware 动态分析未测。
- 打包：见下方 v0.3.15 产物表（v0.3.14 及更早的包检索 ≥3 字关键词会失败，建议升级）。

## v0.3.14

- **星睿 MCP 改为「按预设注入」**（此前是全局注册，会把 242 个工具塞进每个会话，约 9 万 tokens/请求）：
  - `preset-standard` → `xingrui-server`（13 工具）、`preset-mobile` → `xingrui-computer`（108）、`preset-apk` → `xingrui-apk`（33）、`preset-traffic` → `xingrui-traffic`（39）、`preset-data` → `xingrui-data`（7）、`preset-files` → `xingrui-files`（21）、`preset-iot` → `xingrui-iot`（21）；
  - `取证分析（本地模型精简）`/日志/内存/EXE/数据库 5 个预设**不挂**星睿连接器，保持轻量；
  - 连接器均为 `streamable-http`、`toolCallTimeoutMs: 300000`、`failOnStartupError: false`，星睿控制台没开时不阻塞会话。
- **校验**：`tests/mcp-config.test.mjs` 改为按预设断言（映射、无全局行、serverName 不重复、MYOS 仍全局 stdio）；`scripts/check-overlay.mjs` 逐预设段校验；`npm test` **194/194**。
- **打包与打包态回归（第 50 轮）**：`npx electron-builder --win --x64 -c.directories.output=release-0314` → NSIS **320,055,823 B**（blockmap 333,015 B）、portable **270,623,477 B**、`app.asar` **566,541,777 B（32,976 entries）**、目录版 **1,262,706,735 B**；`.probe/asar-0314-check.mjs` 全部检查 true、`missing:[]`（含 7 个 `serverName: xingrui-` 均在预设内、无全局 `seeu-mcp-xingrui` 行、`transport: streamable-http` 恰好 7 处）；目录版冷启动 9054 ms、portable 63.9 s；打包态 `m2-ui-check`（`m2ok:true`）、`settings-check`（`toolPathsRows:15`、`diagOk:true`、`envReportOk:true`、`thinkingSaved:true`）、`plugins-check`（`activationOk:true`、`packagesOk:true`）、`skills-check`（`leaked:[]`）、`hero-check`（`toolsOk:true`）、`mount-check`（`inspect.ok:true`、`remountHintOk:true`）全绿。

## v0.3.13

- **dsh 运行时升级到 0.2.2-rc.3（第 48 轮）**：`@deepseek-ai/dsh` 及全部 `@deepseek-ai/dsh-*` 依赖从 `0.2.2-rc.1` 升到 **`0.2.2-rc.3`**（`latest` tag 仍是 rc.1，rc.3 在 `next`）。rc.3 把 `dsh-error` / `dsh-http-proxy` 等拆成 peer 依赖，用 `--legacy-peer-deps` 安装后需补装 `@deepseek-ai/dsh-error@0.2.2-rc.3`、`@deepseek-ai/dsh-http-proxy@0.2.2-rc.3`，否则 `dsh-subprocess` 启动即 `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-error`。验证：`npm test` **194/194**、`check:overlay` OK、build OK、`plugins-check`（175 插件包、`activationFailures:[]`）、`settings-check`（15 行工具路径、`diagOk`、`envReportOk`）、`m2-ui-check`、`hero-check` 全绿；dev 预览重启正常（`/seeu-index/list` 200）。


- **APK/EXE 动态分析环境接入（第 47 轮）**：回答用户「apk 接雷电模拟器、exe 接虚拟机，这些你都配置了吗」——
  - 实测本机：雷电模拟器 = `D:\Games\leidian\LDPlayer14`（`ldconsole.exe`、`dnplayer.exe`、`adb.exe`，实例 1 个，当前未运行）；VMware Workstation 26.0.0 = `D:\Programs\VMware`（`vmrun.exe`，运行中 `E:/Win10Reverse/Win10CNBase.vmx`）；
  - `tools/tool-paths.mjs` 新增两项目录型路径：`ldplayer`（`SEEU_TOOL_LDPLAYER`）、`vmware`（`SEEU_TOOL_VMWARE`），设置页「外部取证工具路径」从 13 行变 **15 行**，保存后注入会话；
  - APK persona 追加「动态分析（雷电模拟器）」段：`ldconsole list2/launch` → `adb connect 127.0.0.1:5555` → `adb install -r -t` → `monkey` 启动 → `logcat`/`screencap` → frida attach；并明确「本机没有星睿的一键脱壳 MCP，不要承诺一键 dump dex」；
  - EXE persona 追加「动态分析（VMware）」段：`vmrun list`、运行前 `vmrun snapshot` 快照、样本只在虚拟机内运行（主机不执行未知 PE）、共享文件夹拷贝、回滚；
  - 缺口如实告诉用户：① PC 侧 frida 有、模拟器侧 frida-server 二进制未找到；② 星睿 `apk_unpack_all_in_one_v3` / `apk_mcp` 工具链本机未安装（搜过 C:/D:/E: 常见目录）；③ EXE 虚拟机是 VMware（不是 VirtualBox/Hyper-V），已按 VMware 接。
  - 校验：`npm test` **194/194**、`check:overlay` OK、build OK、`settings-check`（`toolPathsRows:15`）、`m2-ui-check`。


- **星睿本地模型提示词最终融合（第 46 轮）**：读取 `E:\取证桌面\星睿-*.txt` 9 份（APK/数据分析/文件目录/服务器/流量/物联网/电子数据取证竞赛知识库/计算机手机/逆向；每份 = 星睿通用 system + 专家 SOP），抽取专家段并按预设融合：
  - 取证分析 ← 星睿-计算机手机 + 星睿-服务器；流量 ← 星睿-流量；数据 ← 星睿-数据；APK ← 星睿-APK；EXE ← 星睿-逆向；手机 ← 星睿-计算机手机；
  - **新增两个预设**：物联网分析（IoT，order 11）、文件目录分析（Files，order 12）；
  - 每份 persona = 星睿专家 SOP + 「SeeU 运行环境（本机，优先级高于星睿 MCP 假设）」适配段（bash 优先/pwsh 降级、索引→火眼挂载→LovelyCarve→原始文件、`$SEEU_TOOL_*`、MYOS MCP、只读与 `$SEEU_WORKSPACE`、上下文 262144 不必过度缩写）+ 既有 SeeU 规则；
  - 新增随包技能 `forensics-competition-kb`（竞赛知识库检索：默认 `D:/forensics-kb`，`$SEEU_KB_DIR` 可覆盖；答案必须来自文件并标来源）；
  - **上下文窗口**：Spark 单机预设 `qwen3.8-flash-next` 的 `contextWindow` 从 131072 调到 **262144**（与双机一致），设置页说明同步；
  - 校验：`scripts/check-overlay.mjs` 的 `expertPresets` 加入 IoT/Files（名称、只读工具面、Qiko 技能组）；`tests/presets-config.test.mjs` 扩展到 11 个预设与 `forensics-competition-kb` 目录；`npm test` **194/194**、`check:overlay` OK、build OK；`settings-check` 通过（单机 262144）；`m2-ui-check`、`hero-check` 通过。

- **打包与打包态回归（第 49 轮）**：`npx electron-builder --win --x64 -c.directories.output=release-0313` → NSIS **320,055,103 B**（blockmap 332,917 B）、portable **270,609,007 B**、`app.asar` **566,538,202 B（32,976 entries）**、目录版 **1,262,703,160 B**；`.probe/asar-0313-check.mjs` **125 项全 true、`missing:[]`**（含 dsh rc.3 版本、`dsh-error`/`dsh-http-proxy` 包、IoT/Files 预设、竞赛知识库技能、动态分析环境、15 行工具路径）；冷启动 **7175 ms**、portable **61,634 ms**；打包态 `m2-ui-check`（`m2ok/activityOk/myosImportOk`）、`settings-check`（`toolPathsRows:15`、`diagOk`、`envReportOk`）、`plugins-check`（`activationOk:true`）、`skills-check`（`leaked:[]`）、`hero-check`（`toolsOk:true`）、`mount-check` 全绿。
- **体积说明**：dsh rc.3 增加 `dsh-error`/`dsh-http-proxy` 等包，asar 426.6 MB → **566.5 MB**（+140 MB），NSIS 281.9 MB → **320.1 MB**；启动时间 6.3 s → 7.2 s（仍在正常范围）。

## v0.3.12

- **打包与打包态回归（第 45 轮）**：v0.3.12 已出 NSIS `281,896,527 B`（blockmap `293,199 B`）、portable `236,577,274 B`、`app.asar` `426,586,748 B`（34,224 entries）、目录版总计 `1,110,937,976 B`；`.probe/asar-0312-check.mjs` **全部检查 true、`missing: []`**（新增活动按天/筛选/移除/文本筛选、挂载最近记录与重挂载、体检一键修复校验）；目录版冷启动 **6305 ms**、portable 55.0 s；打包态 `m2-ui-check`（`m2ok:true`、`activityOk:true`、`myosImportOk:true`）、`settings-check --exe`（`ok:true`：`envReportOk:true`、`envCopyOk:true`、`envFixOk:true`、13 行外部工具、五项自检）、`plugins-check --exe`（175 包、`packagesOk:true`、`activationOk:true`）、`skills-check --exe`（6 个随包技能 + Qiko 43 个、`leaked:[]`）、`hero-check --exe`（本机工具 13/13）、`mount-check --exe`（`lastMountReleasedOk:true`、`remountHintOk:true`）全部通过。

- **体检「一键修复可自动项」**（第 44 轮）：体检发现随包插件/技能缺失时，新增按钮【一键修复可自动项】可自动补齐（重跑 `installBundledPluginBundles` + `ensureBundledPluginPackages` + `installBundledSkills`），修复后自动重新体检；无可修复项时按钮置灰。接口 `seeu:env:fix` 返回 `{ok, repaired, targets, report, text, markdown}`，`envFixTargets(report)` 纯函数单测覆盖，`settings-check` 断言 API 可用与按钮状态。
- **最近活动文本筛选**（第 43 轮）：「最近活动」标题行新增筛选框（`data-activity-search`，按案件名/表名/类型），旁边显示「N 条匹配」；无匹配时列表位显示「没有匹配的活动」；与「点选某天」过滤叠加生效，清空恢复。`m2-ui-check` 断言筛选/空态/恢复（`activitySearchOk:true`）。
- **重新挂载最近镜像**（第 42 轮）：挂载窗口在存在 `lastMount` 时显示【重新挂载最近镜像】——点一下自动 `inspect` 原镜像 + 按上次分区/盘符重新挂载，并提示耗时；`mount-check` 断言卸载后按钮出现 → 点击 → 挂载恢复 1 条 → 提示「已重新挂载」→ 收尾卸载。
- **挂载窗口显示「最近一次挂载」**（第 41 轮）：`mounts.json` 现在持久化 `lastMount`（挂载点、镜像名、分区、挂载时间；卸载后补 `releasedAt`），`status()` 一并返回；挂载窗口顶部显示「最近一次挂载：X: ← disk.E01（分区 0） · 2026-11-13 06:25:55 · 运行中/已卸载」，重启外壳也能看到上次挂载。单测与 `mount-check` 均断言挂载中/已卸载两种文案。
- **活动可逐条移除**（第 40 轮）：每行右侧【移除】（`data-activity-remove`，`stopPropagation` 不会误触发打开）→ `POST /activity/remove {at,title}` 精确删一条并刷新统计/条形；`removeActivity()` 单测 +1（按 at+title、未命中不改文件）；`m2-ui-check` 断言移除后行数 2→1（`activityRemoveOk:true`）。
- **活动行打开失败有提示**（第 39 轮）：点活动行时先核对 `/list` 返回的索引（按 `dbFile` 或规范化 `caseDir` 匹配），找不到就在卡片底部显示「打不开该活动：索引已不存在（…），可能被删除或移动。」（琥珀色），不再静默失败；`m2-ui-check` 内置预置活动（今天/昨天各 1 条、指向不存在的目录），断言 `activityOpenNoteOk:true` 并纳入 `activityOk`。
- **体检报告可导出 .md**（第 38 轮）：`envReportMarkdown()` 生成标准 Markdown（标题 + 检查时间 + 合计 + 四列表格 + 备注），设置页「导出 .md」按钮走 `save-export` IPC 落盘（目录同 CSV 导出，`SEEU_EXPORT_DIR` 可指定），e2e 读回落盘文件断言含 `| 项目 | 状态 | 详情 | 提示 |` 与 `合计：**6 项正常`。
- **活动条形可点选当天**（第 37 轮）：点「最近活动」任一小条形即只看那一天（再点取消）；标题行显示「当天 1 条 · 共 2 条」，旁边出现「只看 2026-11-13 · 点条形取消」。`m2-ui-check` 预置「今天 1 条 / 昨天 1 条」后断言 `activityFilterText`、`activityHeaderText:"当天 1 条 · 共 2 条"`、`activityFilterCleared`、`activityDayFilterOk:true`。
- **最近活动按天分布**（第 36 轮）：`summarizeActivity()` 额外返回 `buckets`（最近 7 天、每天 `{date,builds,imports,total}`，本地时区，窗口外不计）；面板「最近活动」标题右侧画 7 根小条形（建库/导入/两者都有分别着色，hover 显示「日期：建库 N 次 · MYOS 导入 M 次」）。`tests/activity.test.mjs` +1 例（分桶边界与窗口外排除）→ `npm test` 191/191；`m2-ui-check` 新增 `activityBars:7` 并纳入 `activityOk`。

## v0.3.11

- **打包与打包态回归（第 35 轮）**：v0.3.11 已出 NSIS `281,893,366 B`（blockmap `293,297 B`）、portable `236,555,068 B`、`app.asar` `426,562,813 B`（34,224 entries）、目录版总计 `1,110,914,041 B`；`.probe/asar-0311-check.mjs` **110 项全 true、`missing: []`**（新增 `tools/env-report.mjs` 随包校验、`envReportModule`/`envReportIpc`/`envReportSettings`/`envCopyButton`/`activitySummary`/`version0311`）；打包态 `m2-ui-check`（`m2ok:true`、`activitySummaryPresent:1`、`activityOk:true`）、`settings-check --exe`（`ok:true`：`envReportOk:true`、`envCopyOk:true`（380 字符回读）、13 行工具路径、五项自检）、`plugins-check --exe`（175 包、`activationFailures:[]`）、`skills-check --exe`（6 个随包技能 + Qiko 43 个）、`hero-check --exe`（本机工具 13/13）、`mount-check --exe`（inspect 169 ms / mount 338 ms）、真实 MYOS 导入（`skipped:false`）全绿；目录版冷启动 **6107 ms**、portable 58.5 s。

- **面板最近活动统计（第 33 轮）**：`/seeu-index/activity` 在 `entries` 之外返回 `summary`（近 7 天建库次数、平均用时、MYOS 导入次数与累计条数、最近活动时间）与 `summaryText`（如「近 7 天：建库 2 次（平均 2 分 5 秒） · MYOS 导入 1 次，12,345 条」），面板「最近活动」标题右侧直接显示该摘要；实现 `tools/ges-index/activity.mjs` 的 `summarizeActivity`/`formatActivitySummary`/`formatActivityDuration`，单测 +2 例、`npm test` **189/189**，`m2-ui-check` 断言 `activitySummaryPresent:1`。

- **设置页「运行环境体检」（第 32 轮）**：一键汇总七项——随包 dsh 插件（6 bundle 是否都能解析）、取证技能（随包 6 个 + 技能组 4 组 + 已安装数）、外部工具路径（13 项 ready/total）、本机模型配置（是否启用 / 模型 id / 窗口）、镜像挂载 CLI（LovelyCarve 版本 / 活动挂载数）、MYOS MCP 服务端、案件索引目录；每项给 `ok/warn/fail` + 一句可操作提示，只读检查不启动会话。实现：`tools/env-report.mjs`（纯判定 + 文案，单测 4 例）+ `src/env-report.ts`（宿主收集事实，`collectEnvReport()`）+ IPC `seeu:env:report` + `window.seeu.env.report()`；设置页「运行环境体检」卡片，`tests/env-report.test.mjs` 4 例、`npm test` **187/187**；`settings-check` 实测 `envItemCount:7`、`envSummary:"体检结果：6 项正常 · 1 项注意 · 0 项不可用"`、`envReportOk:true`。第 34 轮补【复制结果】按钮：`/env:report` 同时返回纯文本版（`envReportText()`），点一下复制整份报告（含逐项详情与提示、合计行），实测 380 字符、`envCopyOk:true`。

## v0.3.10

- **打包与打包态回归（第 31 轮）**：v0.3.10 已出 NSIS `281,889,094 B`（blockmap `293,258 B`）、portable `236,564,870 B`、`app.asar` `426,537,645 B`（34,224 entries）、目录版总计 `1,110,888,873 B`；`.probe/asar-0310-check.mjs` 全部检查通过（新增 `tools/ges-index/activity.mjs`、`activityModule`/`activityRoutes`/`activityBuild`/`activityPanel`/`version0310`）；打包态 `m2-ui-check`（`m2ok:true`、`activityOk:true`）、`settings-check --exe`（13 行外部工具、五项自检、思考流保存）、`plugins-check --exe`（175 包、`activationFailures:[]`）、`skills-check --exe`（6 个随包技能 + Qiko 43 个）、`hero-check --exe`（本机工具 13/13）、`mount-check --exe`（inspect 267 ms / mount 332 ms）、真实 MYOS 导入（`test:e2e:myos`：`skipped:false`）全绿；目录版冷启动 **5123 ms**、portable 首次 58.5 s。

- **面板「最近活动」（第 30 轮）**：建库成功与 MYOS 导入（单表/批量）会写入 `<DSH_HOME>/index-activity.json`（最多 30 条），面板显示最近 6 条（建库/MYOS 标签、案件名、条数/表名/用时、时间），点一行直接扫描并切到对应索引，可一键清空；`/seeu-index/activity` 与 `/seeu-index/activity/clear` 提供同样能力，`tests/activity.test.mjs` 4 例、`npm test` 183/183。

- **本机网关基准脚本（第 29 轮）**：`npm run bench:gateway`（`scripts/bench/local-gateway-bench.mjs`）直接打 Spark 单机/双机网关，测非流式延迟、流式 TTFB/tok/s/思考流、工具调用，报告落地 `.dev/bench/*.json`；假网关单测 6 例（`tests/local-gateway-bench.test.mjs`）。用法见 [benchmarks](docs/benchmarks.md)。

## v0.3.9

- **打包与打包态回归（第 16 轮，v0.3.8）**：v0.3.8 已出 NSIS `281,879,944 B`、portable `236,575,720 B`、`app.asar` `426,495,680 B`（34,220 entries）；`.probe/asar-038-check.mjs` 全部检查通过（含 `tools/myos-index/**`、`plugins/seeu-case-index/myos.mjs`、`/myos/*` 路由与面板入口）；目录版冷启动 **6180 ms**、portable 48.8 s；打包态 `m2-ui-check`（`m2ok:true, myosImportOk:true`）、`settings-check`（13 行外部工具、五项自检、思考流保存）、`plugins-check`（175 包、`activationFailures:[]`）、`skills-check`（Qiko 43 个）、`hero-check`（本机工具 13/13、快捷入口齐全）、`mount-check`（inspect 154 ms）全绿。
- **面板「从 MYOS 导入」入口（第 14 轮）**：面板工具栏新增「从 MYOS 导入…」按钮，弹窗里列 MYOS 案件 → 检材 → 粘贴结果库（`.mfs`）→「列出表」→ 选表自动生成 SQL → 填输出案件目录/案件名/检材名 → 导入为 SeeU 索引；导入成功后可一键「完成并查看索引」刷新列表。宿主端新增 `plugins/seeu-case-index/myos.mjs` 与 `/seeu-index/myos/{cases,materials,tables,import}` 四个路由（MYOS 未启动时返回 503 与「先启动超级取证大师」提示），`tests/plugin-myos.test.mjs` 6 例、`npm test` 156/156；`m2-ui-check` 增加「MYOS 导入按钮存在且弹窗能打开」断言。选案件/检材后会调 `query_phone_forensics_results_overview` / `query_computer_forensics_results_overview` **自动发现结果库（`.mfs`）**并给出下拉（带「N 张表」提示），选中即填好表清单与 SQL；概览拿不到时仍可手填路径。
- **真实 MYOS 端到端验证（第 17 轮）**：本机启动「超级取证大师」后实测跑通——MCP 列出真实案件（`M盘` / `案件20261015145357` / …）、自动发现 `.mfs` 结果库、导入 `TBL_APPDATA_MANAGER` 10 条记录到本地索引并能在面板发现（`npm run test:e2e:myos`，MYOS 未运行时自动 skip）。真机还修了三个问题：① 概览里相对路径/模板串混杂 → 只收绝对路径并去重；② `sqlite_query` 返回数组行 → 统一转对象，否则正文为空；③ 表名提示从 `sqliteQueryHints[].sql` 与 `mfsStats.indexTable` 解析，`MApps.mfs` 直接提示 `TBL_APPDATA_MANAGER`。
- **MYOS 增量导入（第 18 轮）**：导入默认改成 **追加**——同一案件先导 `MApps` 再导浏览历史/其他检材表时，已有记录不丢；`importMyosRows({mode:'append'})` 自动分配下一个 `eid`、artifact 路径带 `#eid` 去重、manifest 累计 `counts/leaves/sources`；CLI 加 `--append`，面板弹窗加「写入方式：追加 / 整库重建」勾选。实测 5 条 + 2 条 = 7 条、2 个检材。
- **批量导入（第 18 轮）**：面板「从 MYOS 导入…」可勾选结果库里的多张表一次导入（每张表一个检材、eid 递增、默认追加）；后端新增 `POST /myos/import-batch`（逐表 `select * from "T" limit N`，跳过无数据表并回报原因）；实测 `MApps` + 浏览器历史 → 7 条记录 / 2 个检材 / 2 个实体。
- **批量导入进度与表名过滤（第 19 轮）**：批量导入改成后台任务——`POST /myos/import-batch` 返回 `202 {jobId}`，面板每 0.7 s 轮询 `GET /myos/import-batch`，显示「第 2/5 张表 · TBL_X · 已收集 N 条」；同时间重复提交返回 409。表列表新增按表名过滤（如 `TBL_PR_`）+「全选」只选当前过滤结果。
- **导入前预估条数（第 21 轮）**：批量区新增「预估条数」——对选中的表执行 `count(*)`（空表显示 0 行、表不存在显示「预估失败」），并显示「选中表合计 N 行（每张表最多导入 2000 行）」；「只选非空」一键选中预估 >0 的表。实测 `MApps` 5 行、浏览历史 2 行、下载表 0 行、不存在的表给出 `no such table` 提示。
- **AI 自己导入 MYOS（第 22 轮）**：新增随包技能 `myos-import` —— 会话里用 `curl "$SEEU_INDEX_API/myos/…"` 即可列案件/检材/结果库/表、预估行数、批量导入并轮询进度，导完再用 `/evidences`、`/search` 查统一索引。为避免中文路径经控制台/HTTP 转码成乱码，`/myos/tables?caseId=&materialId=&name=MApps.mfs` 与 `row-counts`/`import-batch` 的 `dbName` 支持只传库文件名，插件自己从 MCP 发现路径（根库 `MApps.mfs`/`FSData.mfs` 不在发现列表时从子库目录往上找）。真机验证：`dbName` 方式预估 `TBL_APPDATA_MANAGER` 5 行并导入成索引。
- **结果库下拉补根库（第 23 轮）**：MYOS 自动发现只给按 app 拆分的子库（`data/MApps/<App>{guid}.mfs`），根库 `MApps.mfs`/`FSData.mfs`/`FrAnalyze.mfs` 等不在列表里；现在 `/myos/dbs` 会从每个子库路径往上 3 层扫描同目录 `.mfs` 作为「根库」补进下拉，面板选项标注「根库」，真机实测 8 个子库 + 11 个根库；顺带修了面板取文件名只按正斜杠 split 的问题（Windows 反斜杠路径会把整条路径当名字）。
- **MYOS 导入目录自动记住（第 24 轮）**：MYOS 导入可以写到任意输出目录（`outDir`），以前只有「完成并查看索引」那一下能看到，重启后 `/list` 扫不到。现在导入成功会把输出目录记进 `<DSH_HOME>/index-extra-dirs.json`，`/list` 默认扫描时合并这些额外目录（最近 20 个、去重、目录不存在自动忽略）；面板下次启动仍能看到这份索引。实测：导入到 `.dev/myos-extra2` 后 `/list` 直接出现，重启后依然在。
- **外部目录可见可移除（第 25 轮）**：`/list` 给来源是「额外目录」的索引加 `extra:true`，面板索引行显示「外部目录」标记 + 【移除】——移除只从 `<DSH_HOME>/index-extra-dirs.json` 清单里删目录，不删索引文件；新增 `POST /seeu-index/extra-dirs/remove {dir}`（`forgetExtraDir`，大小写不敏感、目录不存在也不报错）。
- **索引来源标签（第 26 轮）**：`/list` 每个索引带 `source/sourceLabel`——「火眼建库」（`manifest.tool = ges-index`）、「MYOS 导入」（`seeu-myso-import`）、「外部目录」（不在默认扫描目录里）；面板索引行用青色标签区分，来源由 manifest 的 `tool` 判定，不靠猜。
- **索引来源筛选（第 27 轮）**：索引库标题下新增「全部 / 火眼建库 / MYOS 导入 / 外部目录」筛选 chip（带数量）；点某来源只显示该来源的索引，没有匹配时显示「没有来源为「X」的索引」，点「全部」恢复；`m2-ui-check` 断言 chip 数量、点击过滤与恢复。
- **MYOS 取证结果导入 SeeU 索引（第 13 轮）**：新增 `tools/myos-index/`（MCP 客户端 `mcp.mjs`、导入器 `import.mjs`、命令行 `cli.mjs`）与 `npm run myos:import`。经 MYOS MCP 的 `query_cases` / `query_materials` / `sqlite_query` 读取加密 `.mfs` 结果库，按 SeeU 表结构写入 `<案件目录>/.seeu-index/case-index.db`（record + `record_fts` + entity 抽取 + `manifest.json`），导入后面板与 `ges-case-index` 技能可直接检索；假 MCP 服务端 + `tests/myos-index.test.mjs` 9 例，`npm test` 150/150。用法见 §11「把 MYOS 取证结果导入 SeeU 索引」。

## v0.3.7

- **建库进度可读化（第 8 轮）**：新增 `tools/ges-index/progress.mjs`（`buildPhaseLabel` / `formatDuration` / `describeBuildProgress` 纯函数），服务端 `GET /seeu-index/build` 在原有 job 上附加 `progress` 字段：阶段中文名（探测案件 / 枚举检材 / 读取检材数据 / 校验与替换 / 完成 / 失败）、**实时已用时间**（运行中按 `startedAt` 现算，不再只在结束时才有 `elapsedMs`）、`已完成/总数 条 · 百分比`、按吞吐估算的**剩余时间**；运行超过 90 秒时给「可以先切到其他视图，任务会在后台继续」提示；完成后给出「建库完成：N 条记录 · M 个实体 · 用时 X · 索引 Y MiB」摘要，失败时给出错误码与原因。
- 面板进度卡（`plugins/seeu-case-index/client.js`）改为渲染上述中文进度：如「读取检材数据 · 79 / 360 条 · 21.9% · 已用 1 分 20 秒 · 剩余约 4 分 50 秒」，不再只有一行 `fetch 21.9%`。
- **防重复提交**：同一案件目录已有运行中的建库任务时，`POST /build` 直接返回该任务（`existing:true`），避免并发重建互相踩库（实测并发会让部分叶子失败、触发 `E_VALIDATION`）。
- 单测 `tests/progress.test.mjs` 6 例（阶段名回退、时长格式、运行中实时 elapsed、超 90 秒提示与 ETA、完成/失败摘要、同目录复用运行中任务）。
- **索引规模与新鲜度写进会话概览（第 9 轮）**：`findIndexes()` 现在带回 `manifest.json` 的 `counts/durationMs/leaves/coverageOk/integrityOk`；新增 `tools/ges-index/index-meta.mjs`（`formatBytes` / `formatBuiltAt` / `indexSummary` 纯函数）。会话概览的每个案件多一行「索引：22,776 条记录 · 8,191 个实体 · 360 个检材文件 · 建库 2026-11-12 23:55（用时 3 分 3 秒） · 库 63.0 MiB」，索引超过 7 天或上次建库有失败叶子时给出 ⚠ 提示（模型能据此判断「要不要先重建索引」）。
- 单测 `tests/index-meta.test.mjs` 5 例（体积/时间格式、manifest 缺失容错、超 7 天旧索引告警、失败叶子告警并存）。
- 实测：dev 预览重生成 `.dev/dsh-home/AGENTS.md`（2,728 字符）含上述摘要行。
- **面板索引列表显示规模与新鲜度（第 10 轮）**：`GET /seeu-index/list` 的每个索引附带 `meta`（与写入会话概览同一个 `indexSummary`），面板索引卡片改为两行：主行案件名/案号/体积/生成时间，副行「索引：22,776 条记录 · 8,191 个实体 · 360 个检材文件 · 建库 2026-11-12 23:55（用时 3 分 3 秒） · 库 63.0 MiB」；索引过期或上次建库有失败叶子时副行下再显示琥珀色 ⚠ 提示。面板与会话概览口径一致，避免「面板说 3 万条、AI 说 2 万条」。
- **建库可取消（第 11 轮）**：`buildIndex()` 支持 `AbortSignal`（探测后/枚举后/取数返回后检查），插件新增 `POST /seeu-index/build/cancel`（运行中任务返回 `{ok,jobId}`，已结束返回 409），状态新增 `cancelled`；半成品 `.seeu-index/case-index.db.building` 会被清理，**旧索引原样保留**。面板进度卡在运行时多一个「取消建库」按钮，取消后提示「已取消建库（用时 X），旧索引保持不变」。取消在下一个检查点生效（正在执行的 `ges` 单次调用结束后，通常几秒–20 秒）。

- 实测（dev 预览直连插件 API，真实案件 `W盘_2919…`，360 个叶子/22,777 条记录）：各阶段中文名、秒级已用时间、`已完成/总数` 与 `剩余约` 连续可见（运行中样例「读取检材数据 · 81 / 360 条 · 22.5% · 已用 1 分 15 秒 · 剩余约 4 分 16 秒」）；一次全量重建 **4 分 9 秒**，完成摘要「建库完成：22,776 条记录 · 8,191 个实体 · 用时 4 分 9 秒 · 索引 63.0 MiB」。
- **修复：跑久了首页 431 白屏（第 12 轮，重要）**：dsh 的登录 cookie（`dsh-auth-<hash>`，值里带 `authority:"127.0.0.1:<端口>"`）是**按域名存、不区分端口**的；外壳每次换端口启动就多一条，攒到约 70 条（Cookie 请求头 ≈16 KB）后，dsh 的 Node HTTP 服务直接回 `431 Request Header Fields Too Large`，首页只剩空白 —— 之前没人注意，因为要累积几十次启动才触发。
  - 修复：新增 `tools/auth-cookies.mjs`（`decodeAuthCookieAuthority` / `pickStaleAuthCookies` 纯函数）；外壳在 `loadURL` 前先 `session.defaultSession.cookies.get({domain:'127.0.0.1'})`，把 authority 不是当前 `host:port` 的旧条目删掉，再加载页面；日志 `auth cookies: 检查到 N 条，清理 M 个旧端口的 dsh-auth cookie（127.0.0.1 不区分端口，攒多了会让首页 431）`。
  - 单测 `tests/auth-cookies.test.mjs` 4 例；e2e `npm run test:e2e:auth-cookies` 在 loading 页阶段塞 80 条旧端口 cookie（≈18 KB，未修复必然 431）→ 断言日志「清理 80 个」且首页能渲染正文。
- **打包与打包态回归（v0.3.7）**：NSIS `281,815,681 B`（blockmap 293,228 B）、portable `236,553,590 B`、`app.asar` `426,333,279 B`（34,193 entries）、目录版总计 `1,110,684,507 B`；`.probe/asar-037-check.mjs` **89 项全 true**（含 `authCookiePrune`/`authCookieE2e`/`buildProgress`/`buildCancel`/`buildAbortSignal`/`indexMetaList`/`m2IndexMeta`/`version037`）；打包态 `m2-ui-check`（`m2ok:true`）、`settings-check --exe`（`ok:true`：五项自检 `diagItems` 全 ✓、`thinkingSaved:true`、外部工具路径 13 行）、`plugins-check --exe`（`ok:true`：175 插件包、`activationFailures:[]`）、`skills-check --exe`（`ok:true`：qiko 43 个、`leaked:[]`）、`hero-check --exe`（`ok:true`：本机工具 13/13，验证 431 修复后首页正常）、`mount-check --exe`（`ok:true`：解析 185 ms、挂载 361 ms、卸载 2 ms）；目录版冷启动 **5092 ms**、portable **46,641 ms**；`npm test` **141/141**、`npm run check:overlay` OK。
- e2e 顺带修了 hero 页匹配：dsh 页面加载后 URL 会从 `/?token=…` 变成 `/`（cookie 登录后前端 `replaceState`），旧正则只认带 token 的 URL 会误报「主页面没出现」→ 改为同时接受两种 URL。

## v0.3.6

- **打包与打包态回归（v0.3.6）**：NSIS `281,864,757 B`（blockmap 293,917 B）、portable `236,497,369 B`、`app.asar` `426,435,518 B`（34,213 entries）、目录版总计 `1,110,786,746 B`；`.probe/asar-036-check.mjs` **82 项全 true**（新增 `thinkingFormat`/`diagnoseStream`/`diagnoseItems`/`mountTiming`/`heroToolsChip`/`version036`，并修正流式检查对 esbuild 双引号字符串的匹配）；打包态 `m2-ui-check`（`m2ok:true`）、`settings-check --exe`（`ok:true`：五项自检 `diagItems` 全 ✓、`thinkingSaved:true`、外部工具路径 13 行）、`plugins-check --exe`（`ok:true`：175 插件包、`activationFailures:[]`）、`skills-check --exe`（`ok:true`、`leaked:[]`）、`hero-check --exe`（`ok:true`：本机工具 13/13）、`mount-check --exe`（`ok:true`：解析 164 ms、卸载正常）；目录版冷启动 **5088 ms**、portable **52,954 ms**；`npm test` **125/125**、`npm run check:overlay` OK。
- **能力自检扩展到五项（第 6 轮）**

- **真实工具基准（第 3 轮）**：新增 `scripts/e2e/real-tools-bench.mjs`（`npm run test:e2e:real-tools`）与 `docs/benchmarks.md`，在本机真实素材上实测三套工具：LovelyCarve 1.3.0 解析 `W:/AP3_LEUNG_YL_USB.E01`（776 MB EWF）**162 ms**、挂载 part 0 到 `X:` **266 ms**、卸载 **154 ms**（`X:\` 可见 `WEPE`、`Sunny.zip`、`vera_key` 等）；LovelySpark 0.3.20 首次冷启动 11.3 s、`analyze` 86 KB 的 `L1-6.pcapng` **9–13 s**（27 个模块，分析库落在检材同目录 `<pcap>.db.generations/`）、`investigate` 复用分析库 8.8 s；StarMem 0.2.2 `--json info` **525 ms**（本机唯一内存样本是流量工具自带的 raw 进程转储，`windows-info` 报「未找到 KDBG」、`pslist/netscan` 超时——采集类命令需用户提供完整内存镜像）。
- **修复 LovelyCarve 挂载链路（真实 CLI 才暴露的两个坑）**：① `--case` 只能作为进程启动参数，会话里再带会被 CLI 拒绝并让进程退出 → 改为「一次性 `cases create` 建案件 → 常驻 `lovelycarve-cli -q --case <dir> shell` → `images open` → `mounts create`」；② LovelyCarve 1.3.0 的 `mounts delete --force` **会卸载但不返回 JSON**，等响应会挂住 → 改为「写命令 + 轮询盘符是否消失（12 s）」，必要时兜底停进程释放挂载；③ 进程异常退出后残留在 `mounts.json` 的记录，会在下次 `status()` 按盘符存在性自动清理。
- **镜像挂载窗口可读性（第 3 轮 UI）**：`inspect`/`mount`/`unmount` 现在返回 `ms`，窗口顶部显示「CLI 版本 · 最近操作耗时」（如「解析 162 ms · 挂载 266 ms」），挂载成功提示里带耗时；失败时按错误类型给可操作提示（Dokan/管理员、案件锁、检材已打开、文件不存在、盘符占用），不再只给一行原始错误。
- **把实测数字写进技能**：`lovelycarve-forensics` 增加「SeeU 外壳里的挂载」附录（入口、耗时、`$SEEU_MOUNTS_FILE`、`--case`/`mounts delete` 两个坑）；`lovelyspark-cli`（流量/日志）注明 analyze 约 9–13 s、分析库落在检材同目录；`starmem-cli` 注明 `info` 约 0.5 s、采集类命令需要完整内存镜像。
- **欢迎页「本机工具」chip（第 4 轮 UI）**：读取外壳 `toolPaths.get()` 与 `mounts.get()`，显示「本机工具：13/13 就绪 · 镜像挂载 0」；有未找到的工具时圆点转琥珀色，点击打开设置；纯 web 预览（无 `window.seeu`）时自动隐藏。`hero-check` 断言 `data-seeu-tools`、`data-seeu-mounts` 与文案。
- 验证：`npm test` **125/125**（新增 `mountErrorHint` 与耗时断言）、`npm run check:overlay` OK、`node scripts/build.mjs` OK、`node scripts/e2e/mount-check.mjs` 通过（`timingWired:true`、`inspect.ms:217`、`mount.ms:588`、`unmountMs:1`、`timingWired/listVisible` 均 true）；`docs/benchmarks.md` 记录复现命令、版本与数字。

## v0.3.5

- **打包与打包态回归（v0.3.5）**：NSIS `281,858,620 B`（blockmap 293,867 B）、portable `236,534,010 B`、`app.asar` `426,401,524 B`（34,213 entries）、目录版总计 `1,110,752,752 B`；`.probe/asar-035-check.mjs` **76 项全 true**（新增 `presetSplit`/`qikoSkillSet`/`qikoTrimmed`/`skillPrune`/`starMemTool`/`starMemSkill`/`skillSetQikoEnv`/`version035`）；打包态 `m2-ui-check`（`m2ok:true`）、`settings-check --exe`（`ok:true`：外部工具路径 13 行含 StarMem、Ghidra 默认路径、12 项保存落盘）、`plugins-check --exe`（`ok:true`：175 个插件包、`activationFailures:[]`）、`skills-check --exe`（`ok:true`：Qiko 技能组 43 个、`leaked:[]`）；目录版冷启动 **6192 ms**、portable **50.8 s**；`npm test` **122/122**、`npm run check:overlay` OK。

- **融合 Qiko 专家（7 份提示词 + 75 个技能库）并进现有预设**（用户要求「并进现有预设、改成比赛式」）：
  - `preset-standard`（取证分析）← 火眼 + 弘连服务器 + **Qiko 服务器/计算机专家**（画像与题型分流、时间锚点法、可疑文件分级、Windows 痕迹矩阵、断网降级与加密恢复）；
  - `preset-apk` 保持独立并恢复为 **APK 分析** ← 原 APK 专家 + Qiko APK/逆向/恶意分析技能（样本静态/动态、签名、native/加壳、IOC），不碰整机与聊天记录；新增 **preset-mobile「手机取证（Mobile）」**（order 10）← Qiko 手机/微信专家（iOS/Android/鸿蒙 镜像与提取包、iTunes/厂商备份、微信 SQLCipher、资金链、撤回与删除恢复），两者分工明确；
  - `preset-traffic` ← + **Qiko 流量包专家**（预检分流、流量画像、协议分流与三级还原、帧号级定位）；
  - `preset-data` 改名 **数据分析与研判** ← 网钜资金 + **Qiko 案件研判/网络犯罪情报专家**（资金链、人物关系、涉赌诈骗账号、图片鉴伪/水印/隐写、URL 溯源）；
  - 日志/内存/EXE/数据库/精简预设保持领域不变，统一补「比武比赛模式」与「本机实测」段；
  - 技能：精选 43 个 Qiko 技能到 `resources/forensics/skill-sets/qiko/`（含 SeeU 适配头；从 49 个候选中裁掉报告模板、依赖 macOS/ForensicLite/数据库客户端及路由重复的 6 个），新增技能组 `SEEU_SKILL_SET_QIKO` 并注入 9 个预设（`customSkillDirs`）；技能组安装带 prune（随包删除/改名后，旧文件与空目录会在下次启动自动清掉）；
  - 校验：`check:overlay` 校验预设名称/技能根/只读工具面；`tests/presets-config.test.mjs` 断言 Qiko 注入、改名、比武措辞与 persona 关键词；`npm test` 122/122。
- **新增「数据库取证（Database）」预设**（来源：`E:\取证桌面\数据库取证专家.txt`，39.9 KB → 精简到约 7.6 KB）：顺序 9，按「受理与完整性 → 定位数据库文件（先火眼索引 `/tables` → 火眼只读挂载目录 → 无挂载才 LovelyCarve 镜像挂载 → 原始文件）→ 只读导出（SQLite 连 `-wal/-shm/-journal` 一起）→ 结构与表核验 → 只读 SQL 分页检索 → 删除恢复/备份解析（受限）→ 交叉验证 → 报告分层」作业；红线为原件只读、只读 SQL、不建服务、不猜密钥/口令、命中不等于事实；工具现状写明 python 3.13 + `sqlite3` 3.50.4、`sqlite3.exe` 与 7z 的绝对路径（`$SEEU_TOOL_*`），并保留 bash 优先、禁止全盘递归。

- **内存分析预设改用 StarMem 0.2.2**（`E:/CTFTools/Forensics/1-ComputerAnalysis/3-MemAnalysis/Lovelymem/starmem-v0.2.2-windows-x64-upx/starmem.exe`；用户指定：后续用 starmem，lovelymem 退为兜底）：
  - 新增随包技能 `resources/forensics/skill-sets/memory/starmem-cli/SKILL.md`（`starmem.exe [--json] <命令> <镜像文件>`、常用命令表、`collect` 落 SQLite、`--csv/--limit/--raw-objects`、符号参数与证据纪律）；
  - 内存 persona 改为「统一走 `starmem-cli`，`"$SEEU_TOOL_STARMEM" --json <命令> <镜像文件>`；`$SEEU_TOOL_STARMEM` 为空先按 PATH 试 `starmem`，仍不可用才退回 lovelymem-cli」；
  - `tools/tool-paths.mjs` 新增第 13 项 `starmem`（`SEEU_TOOL_STARMEM`、`command: starmem`、默认路径），设置页「外部取证工具路径」随之 13 行；`scripts/e2e/settings-check.mjs` 增加 StarMem 默认路径断言。
- **LovelyCarve CLI 默认路径改为 `D:/Programs/LovelyCarve/lovelycarve-cli.exe`**（用户指定）：只是 CLI 可执行文件的默认解析位置（`tools/lovely-tools.mjs` 的 `defaultPath`，设置页未指定时显示/使用该路径，清空后回落到它）——**不改变检材定位优先级：火眼已挂载的虚拟目录/本机 `C:/hlnet/…` 永远优先，LovelyCarve 只在检材没有火眼挂载入口时才用来挂镜像**。
- 验证：`npm test` **122/122**；`check:overlay` OK；`settings-check` `ok:true`（`toolPathsRows:13`、`toolPathsStarmem:"…starmem-v0.2.2…"`、`errors:[]`）；`skills-check` `ok:true`（`skill-sets/memory` 同时装 `starmem-cli` 与 `lovelymem-cli`，`leaked:[]`）；`starmem.exe build-info --json` 可执行（`version 0.2.2`）。

## v0.3.4

- **每个会话预设换成精简版专家 persona**（来源：`E:\取证桌面` 下 7 份弘连「取证桌面」专家提示词，约 33–37 KB/份 → 精简到 8.7–13.7 KB，删掉本机不存在的 `D:\Programs\Honglian\GoldenEyesV4\skills\…` 技能清单与「取证桌面」外壳指令，保留取证纪律、溯源红线与三分结论要求）：
  - 取证分析（Forensics）：火眼 + 服务器/主机取证合并稿（认环境 → 索引 → 火眼挂载目录 → 镜像挂载 → `ges read` 角标 → 三分强度 → 服务器 Windows/Linux 排查子段）；
  - 流量分析（Traffic）、内存分析（Memory）：分别写清 `lovelyspark-cli` / `starmem-cli` 的调用方式与证据链要求；
  - 日志分析（Log）：暂无对应专家文件，保持原 persona；
  - 新增三个预设：**数据分析（网钜资金）**（order 6，资金流水清洗/口径/可疑特征/账户网络）、**APK 分析**（order 7）、**EXE 逆向分析**（order 8），工具面与取证预设一致（`tool-fs` 只读，落盘用 `bash` 重定向到 `$SEEU_WORKSPACE`）。
- **提示词再加固「先挂载、后原始」**：概览规则 1/2 明确「设备/系统类问题先看备注 → `ges status --json` 的 `evidence_mounts` 与火眼只读挂载目录」，并**禁止在 `W:\` 上直接解压/整份读取原始 `.zip`/`.E01`/`.dd`**（确实没有挂载入口时才按需只读单条目，并在答复里说明「火眼未提供该检材挂载入口」）；`ges-case-index` 技能同步。
- **设置里可改外部工具路径**（用户要求「这些工具都支持在设置里修改路径」）：新增「外部取证工具路径」区，12 项可选可改，Ghidra 默认指向 `C:/Users/ASUS/.dsh/plugins/dsh-infinite-gen-5/third_party/sources/ghidra-12.1.4`；保存到 `<DSH_HOME>/tool-paths.json`，启动时注入 `SEEU_TOOL_<ID>` 环境变量；persona 同步成「以环境变量为准、未设置用默认实测值」，Ghidra 从「未装」改为默认路径 + `analyzeHeadless.bat`。新增 `tools/tool-paths.mjs`/`src/tool-paths.ts` 与 `tests/tool-paths.test.mjs` 6 例（含 PATH 优先）；`scripts/e2e/settings-check.mjs` 增加 12 行渲染、Ghidra 默认值、保存落盘断言。解析顺序按要求做成「**PATH 环境变量优先，找不到再退回默认路径**」，设置里显式改过的路径优先级最高。
- 校验：`npm test` **122/122**；`npm run check:overlay` 扩展为逐预设校验三个专项预设（存在、名称、`tool-fs` 只读）；`tests/presets-config.test.mjs` 增加专项预设、persona 关键词与外部工具路径断言；`npm run test:e2e:settings` 全绿（含外部工具路径 12 行/保存）。

- **打包与打包态回归（v0.3.4）**：NSIS `281,533,139 B`（blockmap 293,403 B）、portable `236,256,556 B`、`app.asar` `425,280,057 B`（34,095 entries）、目录版总计 `1,109,631,285 B`；`.probe/asar-034-check.mjs` 68 项全 true（在原 61 项上新增 `toolPathsModule`/`toolPathsPathPriority`/`toolPathsIpc`/`settingsToolPaths`/`personaToolPaths`/`devWebToolEnv`/`toolPathsE2e`/`expertPersonas`/`bashFirstPolicy`/`version034`）；打包态 `m2-ui-check`（`m2ok:true, errors:[]`）、`settings-check --exe`（`ok:true`：`toolPathsRows:12`、Ghidra 默认路径、12 项保存落盘、`toolsRows:3`）、`plugins-check --exe`（`ok:true`：profile 下 175 个插件包、`activationFailures:[]`）；目录版冷启动 **7343 ms**、portable **60.0 s**；`npm test` **122/122**、`npm run check:overlay` OK。

## v0.3.3

- **修复：随包 dsh 插件实际没加载**（v0.3.2 的严重缺陷）。v0.3.2 只在 profile 清单里写了 bundle 名字，没把插件包放进 `<profile>/node_modules`，dsh 导入时 `ERR_MODULE_NOT_FOUND`，启动日志是 `dsh: warning: 9 entries did not activate`，界面上看不到插件效果。现在 `tools/dsh-plugins.mjs` 新增 `ensurePluginPackages()`：启动时把 4 个插件及依赖闭包复制进 profile（硬依赖/软依赖分开统计，实测 175 个包；同版本靠 `.seeu-dsh-plugins.json` 指纹跳过，升级自动重抄），复制方式改为逐文件 read/write 以兼容 `app.asar` 源目录。
- `scripts/e2e/plugins-check.mjs` 增加三条真实断言（插件包存在、外壳日志「插件包 N 个」、dsh 子进程日志无导入失败）；v0.3.2 的旧断言只看页面文案，属误判。
- **案件概览新增「原始检材只读挂载」映射**：火眼（GES）会为检材挂出原始只读文件系统（`ges status --json` 的 `evidence_mounts[]`：虚拟路径 `/evidence_mounts/eid-N/` + 本机目录 `C:\hlnet\<eid>-<hash>`）。现在 `plugins/seeu-case-index` 的概览把「检材名 → 虚拟路径/本机目录」写进 `<DSH_HOME>/AGENTS.md`，`/evidences` 也返回 `mountRoute`/`mountPoint`/`mountEid`；`ges-case-index` 技能与取证定位规则同步改成「**先翻火眼已挂载目录，不要用 LovelyCarve 重复挂载**；只有火眼没给挂载时才自己挂镜像」。设备/系统类问题仍优先看检材备注。
- 新增 `tools/ges-index/mounts.mjs`（`parseEvidenceMounts` / `attachMounts` / `loadEvidenceMounts`，5 秒缓存、失败降级为空表）与 `tests/ges-mounts.test.mjs` 4 例。
- **索引接口支持 `caseNumber`**：中文案件路径经 shell → HTTP 传输时可能被按 GBK 转码，服务端收到的 `db` 路径与磁盘不一致 → 报「索引库不存在」。现在 `/evidences`、`/tree`、`/search`、`/records`、`/export/*` 等 GET 路由既接受 `db`，也接受 `caseNumber`（或 `case` / `caseDir`，取 `/list` 里的 `caseNumber` 最稳）；`/list` 与概览里也补了提示。新增 `resolveDbParam()` 与 `tests/db-param.test.mjs` 4 例（中文路径 + 临时案件库、未知案件号 404、缺参 400）。
- `npm test` 111/111（新增依赖闭包、包复制、挂载映射、caseNumber 解析用例）、`check:overlay` OK。

- **打包与打包态回归（v0.3.3）**：NSIS `281,470,879 B`（blockmap 293,467 B）、portable `236,209,035 B`、`app.asar` `425,056,883 B`（34,072 entries —— 比 0.3.2 少 22 条是删掉了旧技能目录）；`.probe/asar-033-check.mjs` 全项 true（新增 `pluginPackagesCopy` / `pluginsActivationAssert` / `version033`）；**打包态 `plugins-check --exe` 首次拿到 `ok:true`**：profile 下 175 个插件包、外壳日志「插件包 175 个（已复制 175 个…）」、dsh 子进程日志 `activationFailures:[]`（从 asar 逐文件复制可行）；打包态 `m2-ui-check`（`m2ok:true, errors:[]`）；目录版冷启动 **7128 ms**、portable **49.8 s**；`npm test` **106/106**、`npm run check:overlay` OK。

## v0.3.2

- **随包 dsh 插件（预打包，离线可用）**：安装包现在自带并默认启用 4 个 dsh 插件 —— `billion-context`（上下文压缩/ACP）、`dsh-context`（上下文洞察面板）、`dsh-better-sidebar`（侧栏/任务卡等界面增强）、`dsh-gitbash-shell`（Windows 上的 bash 工具：`bash`/`gitbash_native`/`gitbash_to_native_path`）。启动时外壳会把这些插件写进 `<DSH_HOME>/profiles/web/package.json` 的 `dsh.profile.bundles`（保留用户已有 bundle 与依赖，幂等；`SEEU_DISABLE_DSH_PLUGINS=1` 可跳过），插件代码随 `node_modules` 进 `app.asar`，不需要联网安装。
- **实现**：新增 `tools/dsh-plugins.mjs`（纯 JS：`BUNDLED_DSH_PLUGINS`、`mergePluginBundles`、`installBundledPluginBundles`，坏清单只报错不覆盖）与 `src/dsh-plugins.ts` 薄层；`src/main.ts` 在 `startHost()` 里写清单并记录日志 `dsh plugins: … → <manifestPath>`；`electron-builder.yml` 把 `node_modules/@dsh-ops/fastctx-win32-x64/**` 放进 `asarUnpack`（`bin/fastctx.exe` 需要真实路径）。
- **测试**：`npm test` **91/91**（新增 `tests/dsh-plugins.test.mjs` 7 例）；新增 `npm run test:e2e:plugins`（隔离 home：断言 profile bundles 含 6 项、页面出现「上下文洞察 / 插件」、外壳日志有 `dsh plugins:` 且无「缺少」，截图 `.probe/shots/plugins.png`）。
- **适配插件的 e2e**：`local-tools-e2e` 的「精简预设」断言改为按基础工具数（剔除 MCP 与插件工具后 ≤14，实测 12）而不是原始工具总数；标题请求改用 system 里的标题指令识别（插件会给标题调用也带上工具）；任务卡在插件侧栏里默认折叠，改为「任务 N 进行中」卡片或展开后条目文本都算 todo 已落库。
- **已知提示**：`billion-context` 对 dsh `0.2.2-rc.1` 只打警告（其最新适配版本是 `0.2.0-rc.2`），功能实测正常；`dsh-context`/`dsh-better-sidebar` 的 peer 依赖要求 `0.2.2-rc.2`，安装时用了 `--legacy-peer-deps`（运行时未发现异常）。
- **新增三套分析预设（按预设注入技能）**：会话预设新增「流量分析（Traffic）」「日志分析（Log）」「内存分析（Memory）」。前两个带 `lovelyspark-cli` 技能（抓包/网络/日志取证），内存分析带 `lovelymem-cli`（内存镜像、进程、服务、注册表等）；原「取证分析（Forensics）」与「获取分析（本地模型精简）」不再注入这两个 CLI 技能（`lovelycarve-forensics` 仍留在取证预设，供镜像挂载后的磁盘分析使用）。
- **实现**：随包技能拆成 `resources/forensics/skills/`（通用：案例索引、证据链、LovelyCarve 等）与 `resources/forensics/skill-sets/{traffic,log,memory}/`；新增 `tools/skill-sets.mjs` —— `installSkillSet()` 把整组复制到 `<DSH_HOME>/skill-sets/<id>`（写 `.seeu-skill-set.json` 指纹，幂等），`removeRetiredSkills()` 从旧的 `<DSH_HOME>/skills` 里清走 `lovelymem-cli`/`lovelyspark-cli`（升级迁移）；`src/skills.ts` 安装随包技能时一并安装三组并执行迁移；`src/host.ts` 注入 `SEEU_SKILL_SET_TRAFFIC` / `SEEU_SKILL_SET_LOG` / `SEEU_SKILL_SET_MEMORY`；三个预设在 overlay 里各用独立的 `skill-filesystem` 实例（`includeDefaultRoots: false` + `customSkillDirs` 指向对应环境变量），因此每个预设只看到自己那组技能。
- **打包与打包态回归（v0.3.2）**：NSIS `281,504,620 B`、portable `236,213,254 B`、`app.asar` `425,164,539 B`（34,094 entries —— 随包 4 个 dsh 插件让 asar 从 169MB 涨到 425MB，属于预期）；`.probe/asar-032-check.mjs` **58 项全 true**（新增 `bundledPlugins` / `pluginsWriteProfile` / `analysisPresets` / `skillSetInstall` / `hostSkillSetEnv` / `retiredSkills` / `fastctxUnpacked`）；打包态 `m2-ui-check`（`m2ok:true, errors:[]`）、`settings-check`（`ok:true`：工具路径 3 行 + 预热 + 浅色）、`plugins-check`（`ok:true`：profile bundles 6 项、页面「上下文洞察 / 插件」）、`skills-check`（`ok:true`：5 个通用技能、三组技能就位、`leaked:[]`）全绿；目录版冷启动 **6130 ms**、portable **49.6 s**；`npm test` **100/100**、`npm run check:overlay` OK。
- **测试**：`npm test` **100/100**（新增 `tests/skill-sets.test.mjs` 4 例、`tests/presets-config.test.mjs` 4 例：用 js-yaml 自定义 `!!js` 标量解析 overlay，断言三预设的 id/名称/顺序、技能根引用、取证预设不引用分组根、随包目录布局）；`check:overlay` 扩展为逐预设校验（名称、技能根、`customSkillDirs`、`tool-fs` 只读）；`skills-check` 断言 `skillsList` 只剩 5 个通用技能、三组技能各就位且没有泄漏进默认技能根。

## v0.3.1

- **设置入口进菜单**：新增一级菜单「设置」——本地模型与工具路径…（`Ctrl+,`）、镜像挂载…（`Ctrl+Shift+M`）、技能管理器…（`Ctrl+Shift+S`）、本地模型状态、重新探测网关、打开配置文件/日志目录；主窗口菜单栏改为**常显**（`autoHideMenuBar: false` + `setMenuBarVisibility(true)`），不用再按 Alt 或记快捷键。欢迎页快捷入口新增「镜像挂载」「技能管理器」两个按钮。
- **修「暴力搜盘」问题**：真实试用时模型查不到 CHAN_MH（`pf` 手机全量提取，索引只有 1 行元数据）就去 `Get-ChildItem -Recurse E:\` 全盘搜。根因是案件概览没告诉它原始文件在哪、也没有行为规则。现在会话概览（`<DSH_HOME>/AGENTS.md`）的检材表增加「类型 / 入库记录 / 火眼统计 / 原始文件（如 `W:\CHAN_MH_mobile.zip`）/ 备注」，对未解析检材标 ⚠ 并汇总；新增「取证定位规则」：设备信息先看备注（本例备注直接写着 `iPhone D331pAP/iOS17.1.1 全量提取`）→ 需要内容先查索引 → 索引没有就看检材盘/火眼解析 → 镜像用「设置 → 镜像挂载…」挂成只读盘符 → **禁止全盘递归搜索**（`Get-ChildItem -Recurse`、`dir /s`、`find /`）。
- `ges-case-index` 技能新增「索引里没有数据时（全量提取 / 镜像类检材）」小节；三个 preset persona 同步加入「先定位再取证、禁止全盘递归」。
- **接入超级取证大师（MYOS）MCP**：`resources/forensics/cordis.patch.yml` 新增 `seeu-mcp-myos` 行（`@deepseek-ai/dsh-mcp-client`，stdio，`serverName: myos-forensics`，命令 `D:/Programs/MYOS/Client/tools/mcp/myos_mcp_server.exe`），MYOS 自带 MCP 提供 **49 个取证工具**（案件/检材/取证任务/结果概览/只读 `sqlite_query`/导出等），在会话里以 `mcp__myos-forensics__…` 暴露；MYOS 未启动时 `failOnStartupError: false` 不影响外壳，启动后按 `reconnect` 自动重连。连接自检先用 `health_check_dbus`。
- 测试：`npm test` 84–85 全 pass、`check:overlay` OK；`hero-check` 快捷入口变为 `[index, model, workspace, mounts, skills]` 且 `ok:true`；`m2-ui-check` `m2ok:true`。
- **打包与回归（v0.3.1）**：NSIS `212,015,610 B`、portable `189,611,751 B`、`app.asar` `169,110,408 B`（19,686 entries，含 MYOS MCP 行）；`.probe/asar-031-check.mjs` 42 项全 true；打包态 `hero-check`（快捷入口含 mounts/skills、设置窗口可打开）、`settings-check`（工具路径 3 行 + 保存/清除）、`m2-ui-check`（`m2ok:true`）全绿；`npm test` **85/85**；目录版冷启动 6889 ms、portable 37.9 s。

## v0.3.0

> 以下改动已进入 v0.3.0 安装包（v0.2.9 `a112f49` 之后：Gitea `main` 的技能上传 `186eb84` + 镜像挂载 `f56aa57`），打包态回归见 `docs/packaging.md`。

- **镜像挂载（取证镜像 → 只读盘符）**：菜单「设置 → 镜像挂载…」（`Ctrl+Shift+M`，托盘同项）打开新窗口 —— 选镜像（E01 / RAW / VMDK / VHDX / QCOW2 / ISO…）→ 解析分区（`/part:N`、卷标、文件系统、大小）→ 选分区与盘符 → 挂载为只读盘。挂载点由 LovelyCarve CLI 的 `mounts` 命令组提供，**只在 SeeU 运行期间有效**，卸载或关闭外壳即释放；同一案件不能被桌面端与 CLI 同时打开，Dokan 挂载可能要求管理员权限；
- **接口实现**：新增 `tools/image-mount.mjs`（纯 Node）：`resolveLovelyCarveCli` 按「环境变量 → 设置窗口保存的 `lovely-cli.json` → 常见安装位置」找 CLI；`LovelyCarveHost` 起一个常驻 `lovelycarve-cli -q shell` 进程（stdin 写命令、stdout 逐行 JSON），因为挂载点是进程内资源；`createMountManager` 提供 `status / inspect / mount / unmount / dispose`，挂载清单写 `<DSH_HOME>/mounts.json` 并通过 `SEEU_MOUNTS_FILE` 下发给 dsh 会话，技能可直接读；测试用假 CLI（`tests/fixtures/fake-lovelycarve-cli.mjs`）不需要真装 LovelyCarve；
- **CLI 路径仍为手动指定**：设置窗口「本机取证工具路径」从两行扩为三行（LovelyMem V3 / LovelySpark / LovelyCarve CLI），同样写 `lovely-cli.json`、`SEEU_LOVELYCARVE_CLI` 仅供调试；未配置时挂载窗口直接提示去设置，不会自己猜路径；
- **技能上传 / 技能管理器（合并 Gitea `main` 的 `117b391`）**：「技能」菜单新增技能管理器、导入文件夹、导入 ZIP、打开技能目录 —— 自研最小 ZIP 解析（中央目录 + `inflateRaw`，拒绝 ZIP64/加密/分卷，逐段消毒防 `..` 穿越），校验 `SKILL.md` frontmatter，随包技能受保护不可覆盖；导入写 `<DSH_HOME>/skills/<name>`，dsh 技能目录 watch 自动重扫，新会话立即生效；
- **测试**：`npm test` **85/85**（新增 `tests/image-mount.test.mjs` 4 例；`npm run test:skill-upload` 22/22）；`scripts/e2e/` 下 20 个脚本，新增 `npm run test:e2e:mounts`（假 CLI：get → 解析 2 个分区 → 挂载 → 校验 `mounts.json` → 页面刷新显示 → 卸载清空）与 `npm run test:e2e:skills`（`window.seeu.skillsList()` 列出 7 个随包技能，含 `lovelycarve-forensics`）；`settings-check` 断言工具路径区三行；`check:overlay` OK。

## v0.2.9

> 以下改动已进入 v0.2.9 安装包（v0.2.8 `ce02349` 之后：真机技能链路、工具路径手动指定），打包态回归见 `docs/packaging.md`。

- **技能链路真机验证**：`npm run test:e2e:real-gateway` 新增可选第三轮（`SEEU_REAL_SKILL=1`）——模型按需加载 `lovelymem-cli` 技能后，用技能里写的命令 `& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelymem -- version` 调包装器，实测 51.8 s、2 次工具调用、答出 `Lovelymem / 3.1.11 / starmem、vol3`（`skillLoaded:true`、`wrapperUsed:true`）。headless 脚本同时补齐了技能安装（`resources/forensics/skills` → `<DSH_HOME>/skills`）与 `SEEU_CLI_NODE`/`SEEU_LOVELY_CLI`/`SEEU_LOVELYMEM_EXE` 注入 —— 之前只装外壳时才有这些，headless 直接跑会「技能不可用」；
- 这一步补上了 v0.2.8 遗留的最后一条「模型主动调技能未做真机会话」。

- **本机取证工具路径改为手动指定（不做自动发现）**：按你的要求，删掉了自动发现（PATH / 注册表 / 已运行进程 / 快捷方式 / 常见目录搜索，含 `tools/lovely-cli/discovery.mjs`）；设置窗口新增「本机取证工具路径」卡片：LovelyMem V3 / LovelySpark 两行，各自「选择…」选 exe、「清除」删配置，保存后写入 `<DSH_HOME>/lovely-cli.json`（`SEEU_LOVELY_CONFIG` 可覆盖），技能调用时每次重读、不用重启。未配置时包装器明确报「未配置 … 路径：打开外壳「设置 → 本机取证工具路径」选择 exe」，配置失效报「配置的 … 路径不存在」，不会再自己去找 exe；两个 SKILL.md 也改成「不要自己找，让用户去设置」；
- 新增 `tools/lovely-tools.mjs`（读/写/校验工具路径：绝对路径、文件存在、`.exe` 后缀；清空单项时只删该键）与 6 例单测；`settings-check` e2e 增加工具路径区断言（两行渲染、API 保存、真实点「保存工具路径」写盘、清空后配置删键）；
- **测试与打包**：`npm test` **79/79**（56 + 22 lovely CLI + host/config）、`npm run test:lovely` 22/22、`check:overlay` OK；v0.2.9 打包后 asar 19,654 条目、`missing:[]`，24 项内容检查全 true（含 `lovelyManualOnly`：asar 内不再有 discovery、`cli.mjs` 不再 import 它）；打包态 `m2-ui-check` / `settings-check`（工具路径区在 asar 内实测可用）/ `export-check` / `cross-case-check` 全绿；目录版冷启动 5249 ms、portable 37.4 s。

## v0.2.8

> 以下改动已进入 v0.2.8 安装包（v0.2.7 `c3f22e1` 之后：真机联调修复、检索 CSV、验收材料、LovelyMem/LovelySpark 集成），打包态回归见 `docs/packaging.md`。

- **检索结果【导出 CSV】**：检索视图把当前关键词 + 筛选（检材/应用/起止日期）命中的记录整批写成 CSV 落盘（`<下载>/seeu-exports`，`SEEU_EXPORT_DIR` 可覆盖），列：检材号/检材名称/应用/账号/类别/时间/行号/记录ID/摘要；UTF-8 BOM + CRLF，Excel 双击直接开；一次最多 20000 行，超过时提示「共 N 条」；
- **真机网关联调通过（首次接真实端点）**：`deepseek-flash`（`http://10.10.250.120:8080/v1`）实测 —— `/v1/models` 117 ms（只有 id，无窗口字段）；流式首字节 86 ms、纯文本 4.3 s / 105 分片约 17 tok/s；**推理模型**（delta 先 `reasoning_content` 再 `content`，dsh 会显示成思考块）；流式工具调用 1.8 s、并行 2 个工具调用 1.6 s；`include_usage` 有效（可开「流式 token 用量」）。headless 真机 e2e：案件概览注入后模型 **5/5 检材全部答对**（明确说「取自概览表格，未推断」），`pwsh node -v` 工具闭环返回 `v24.18.0`；首字 23.8 s、首步输入 9,145 tokens（精简预设 + 概览注入）。
- **网关不自报上下文窗口时给提示**：`deepseek-flash` 的 `/models` 只回 id，设置页拉取模型不会自动填窗口 → 探测结果新增 `noContextWindow` 标记，界面黄字提示「按表单里的 128k 使用；模型实际窗口更小会报 400，请按模型文档手填」；
- **记录数口径修复**：会话概览里「规模：记录 22777 条」与检材表各行相加对不上（表内取的是火眼 `evidence.record_count`，如 3065/13718）→ `evidences()` 改为按索引内 `record` 行数统计（`recordCount`，本案 1/1/8,443/1/14,331，合计 22,777），火眼原值保留在 `reportedRecordCount`；会话概览表格下方加注说明口径；
- **接入本机 LovelyMem V3 / LovelySpark CLI**（合并 Gitea 分支 `feat/local-lovely-cli`）：会话按需加载 `lovelymem-cli` / `lovelyspark-cli` 技能，通过现有 shell 调用，不新增工具 schema/服务/依赖；自动发现本机 CLI（环境变量 → 配置 → PATH → 注册表/已运行进程/快捷方式 → 常见目录；**v0.2.9 起已改为设置窗口手动指定**），完整 stdout/stderr 落盘 `<工作区>/lovely-runs/`、模型只收限长预览；打包版把 `tools/lovely-cli/*.mjs` 放进 `app.asar.unpacked` 供 shell 调用。本机实测：LovelyMem **3.1.11**（engines `starmem`/`vol3`）、LovelySpark **0.3.20** 均通过包装器成功执行；新增 `npm run test:lovely`（当时 23 例，含 dev/asar 两种模式下 host→dsh→shell 的环境隔离）；
- **测试**：`npm test` **80/80**（56 + 23 lovely CLI + host 集成）；新增 `npm run test:e2e:real-gateway`（`scripts/e2e/real-gateway-headless.mjs`，凭据走 `GW_BASE/GW_KEY/GW_MODEL` 环境变量，不落盘）。v0.2.8 打包后 asar 19,655 条目、打包态 `m2-ui-check` / `settings-check` / `export-check` / `cross-case-check` 全绿；`app.asar.unpacked` 里的 lovely CLI 实跑 `status` 能发现 LovelyMem 3.1.11 与 LovelySpark 0.3.20。

## v0.2.7

> 以下改动已进入 v0.2.7 安装包（v0.2.6 `44808cb` 之后的 2 个提交），打包态回归见 `docs/packaging.md`。

- **记录视图【导出 CSV】**：把当前筛选（检材/应用/类别/关键词/起止日期）命中的记录整批导出成 CSV 文件，Excel 双击打开不乱码（UTF-8 BOM + CRLF，逗号/引号/换行按 RFC 4180 转义）；默认导出前 20000 行（共 22,777 条时提示截断），文件落盘到 `<下载>/seeu-exports`（`SEEU_EXPORT_DIR` 可覆盖，e2e 用它读回断言）；web 预览（无 Electron 桥）自动回退为浏览器下载；
- **表视图【导出 CSV】**：把当前选中 typed 表（联系人/短信/账号/通话…）按当前筛选整张导出，列与表头一致（`id/record_id/eid/app/account/subcat/…`）；本案「联系人」表实测 745 行 → 143,621 B；
- **CSV 后端**：新增 `tools/ges-index/csv.mjs`（纯函数，5 个单测）与插件接口 `GET /seeu-index/export/records.csv`、`GET /seeu-index/export/table.csv`（响应头带 `x-seeu-rows/x-seeu-total/x-seeu-truncated`）；
- **测试**：`npm test` 现 **55/55**（新增 CSV 5 例）；`scripts/e2e/` 16 个脚本；打包态回归 `m2-ui-check` / `settings-check` / `export-check`（含两处 CSV 落盘校验）/ `cross-case-check` 全绿。

## v0.2.6

> 以下改动已进入 v0.2.6 安装包（累计 v0.2.5 之后的 8 个提交），打包态回归见 `docs/packaging.md`。

- **记录视图筛选**：检材改成下拉（选名称，不用记 eid）、加起止日期（驱动后端 `from/to`），结果行显示「检材名 · 应用」，筛选前后条数肉眼可对比；
- **表视图/检索的应用与类别下拉**：应用、类别不再是手输框，选项来自 `GET /facets`（`group by app/category` 带记录数，各取前 60 项，支持 `?eid=` 只看某个检材）；`npm test` 现 **50/50**（新增 facets 3 例、实体分页 2 例）；
- **实体视图筛选**：检材也改成下拉（选火眼里的检材名，不用记 eid），和检索/记录/时间线一致；
- **实体视图分页**：聚合列表显示「共 N 条聚合 · 当前 a-b」+【上一页】【下一页】（本案 3999 条聚合不再只能看前 30 条），`entity()` 后端支持 `offset/total/next`；
- **时间线筛选**：检材（下拉选名称）、应用（下拉选索引里出现过的应用，带记录数）与时间桶分段按钮并排，和检索/记录视图一致；
- **面板信息密度**：KPI 条多一项「时间范围」（如 `2016-12-11 ~ 2025-05-16`），树视图加本层过滤框（输入即筛，显示「显示 X/Y」与【清空】），案件概览导出带数据时间范围；
- **流式 token 用量**：设置页可选「流式响应带 token 用量」→ 写 `stream_options.include_usage`，会话里能看到真实 tokens（默认关，兼容不支持该字段的网关）；
- **外壳窗口跟随系统浅色**：加载页 / 启动失败页 / 本地模型设置窗口跟随系统深浅色（浅色下强调色 `#0E7490`、白卡片），dsh 主界面深浅色仍由 `ui-theme` 控制；
- **可关「会话标题生成」**：低并发网关（单卡/单进程）每开新会话会多一次标题请求，关掉后 `session-title-llm` 直接 disabled，首轮少一次排队；
- **跨案双案件回归**：新增 `npm run test:e2e:cross`，把真实案件库复制成两个不同案号/案名的夹具，同步进中央库后断言「2 案、30 条重合实体、复制清单含两个案号」；同步后重合 Top 立即刷新，清单里带各案案号；
- **测试**：`npm test` **50/50**（facets 3 例、实体分页 2 例）；`scripts/e2e/` **16 个**端到端脚本（新增 `test:e2e:cross`），打包态回归覆盖面板/设置/导出/跨案四条链路；

## v0.2.5

- **会话自动带上案件概览（本轮重点）**：每个新会话开始前，dsh 会把 `<DSH_HOME>/AGENTS.md` 里的 `seeu-case-brief` 区块读进上下文——里面有本机案件名、索引库、规模、数据时间范围、`eid｜检材｜名称｜平台｜记录数` 表和「用户说检材名时按表对应 eid，不要猜」的规则。本地小模型第一句话就知道分析哪个检材，不用再反复调用 `/evidences` 或猜 eid；
- **注入是合并式的**：只替换自己的标记区块，用户手写的 `AGENTS.md` 内容原样保留；连续重写字节数稳定；下次启动/扫描索引/建库成功后自动刷新；
- **只写用户级文件**：只在 `<DSH_HOME>/AGENTS.md` 写入，绝不往取证案件目录里写文件（`SEEU_WORKSPACE` 可能是只读的证据盘）；只有没有 `DSH_HOME` 时才退回工作区 `SEEU-CASE-BRIEF.md`；
- **面板可见可刷新**：索引面板 KPI 下方一行「● 会话语境：已注入 N 个案件概览（含本库/不含本库） · HH:MM:SS · 新会话会自动带上检材清单」，绿/黄/红点表示状态，旁边【刷新会话概览】立即重写（点完显示「已刷新」）；
- **接口**：`GET /seeu-index/brief?db=…` 返回最近一次注入状态与当前库是否在列表里，`POST /seeu-index/brief` 强制刷新；
- **测试**：`npm test` 43 个单测不变；`scripts/e2e/m2-ui-check.mjs` 新增 `briefVisible` / `briefRefreshOk` 并纳入 `m2ok`；`scripts/e2e/local-tools-e2e.mjs` 的 mock 网关检查请求 messages，断言 `briefSeen: true / briefChars: 475`（确认概览真的进了模型上下文）。
## v0.2.4

- **案件概览一键导出**：面板 KPI 下方【复制案件概览】，输出案件名/编号/目录/索引库/生成时间 + 检材清单表（名称、持有人、平台、记录数、备注），交接材料第一页直接可用；
- **检索分页**：结果显示「共 N 条 · 第 a–b 条」与【上一页】【下一页】；【导出全部 N 条】按页取满后逐条回查 Goldeneyes 句柄（上限 200 条）；
- **窗口超限提示**：配置的上下文窗口大于网关 `/v1/models` 自报能力时，设置页启动探测行黄字提示「配置窗口 131.1k 超过网关自报的 32.8k，超出部分请求会被拒」；
- **网关预热**：设置页【预热模型】，先付掉模型冷启动（几十秒到几分钟），会话第一句不再卡；
- **欢迎页「默认本地模型」chip**：配置了本地模型时，欢迎页显示「本地模型：<模型名> · <窗口> · 网关可用/不可用」（绿点/黄点），点它打开本地模型设置；
- **检材筛选/结果行用名称**：检索筛选的「检材」是下拉（选项直接是火眼里的检材名 + 平台），检索结果行也显示「LEUNG_YL_mobile.zip · WhatsApp」而不是只有 eid（悬停保留检材号）；
- **测试**：`npm test` 43 个纯函数单测（新增窗口超限判定）；`scripts/e2e/` 15 个端到端脚本（`hero` 内建 mock 网关断言模型 chip、`search` 覆盖下拉筛选/分页/导出全部、`export` 覆盖案件概览与时间线清单、`settings` 覆盖预热与窗口超限提示）。

## v0.2.3

- **命中高亮**：检索结果与记录视图里查询词用强调色底高亮（`<mark class="seeu-hl">`），跟随深浅主题；
- **深浅两套都验过**：`m2-ui-check` 默认暗色，设 `SEEU_E2E_THEME=light` 会去掉 `data-ds-dark-theme` 后断言面板底色/正文色（`rgb(245, 247, 250)` / `rgb(11, 18, 32)`）；
- **浅色主题验收**：会话区排版 e2e 支持 `--theme=light`，深浅两套都跑通（浅色强调色 `#0E7490`、底色 `rgb(245,247,250)`）；
- **位置记忆**：面板记住上次的标签页与索引库，下次打开直接回到上次视图；
- **欢迎页「最近案件」chip**：取索引里 `builtAt` 最新的一条，一键进面板；
- **时间线/跨案导出**：【复制时间线清单】【复制重合实体清单】；
- **本地模型精简预设**：新增「取证分析（本地模型精简）」，工具描述 27 → 12（26,687 → 10,229 字符），首个请求固定开销 45,099 → 26,946 字符（≈20.5k → 12.2k tokens，省约 8.2k）；
- **固定开销估算**：设置页实时显示「工具 + 系统提示 ≈ 多少 tokens、窗口还剩多少给对话」，32k 窗口下精简预设剩 80%、完整预设剩 55%；
- **网关失败中文提示**：`ECONNREFUSED` / `ERR_UNSAFE_PORT` / 超时 / 401 / 404 / 5xx / 缺 apiKey 各给一句可操作提示；
- **测试**：`npm test` 42 个纯函数单测；`scripts/e2e/` 14 个端到端脚本。

## v0.2.2

- **欢迎页快捷入口**：品牌块下方三枚按钮——打开「取证索引」面板 / 本地模型设置 / 打开取证工作区（纯 web 预览无 preload 桥时只显示第一个）；
- **检索筛选**：检材（下拉直接选火眼里的检材名称，不用记 eid）、应用（下拉选索引里出现过的应用，带记录数）、起止日期四个条件与关键词 AND 组合，条件存在时出现【清空筛选】，筛选会带到检索结果与导出清单的抬头里；
- **应用/类别下拉**：检索与记录视图的「应用」「类别」不再是手输框，选项来自新接口 `GET /facets`（对当前库的 `record` 做 `group by app/category`，带记录数，各取前 60 项），省得记应用名拼写；`/facets` 也支持 `?eid=` 只看某个检材（新增 3 个 facets 单测，`npm test` 现 **48/48**）；
- **命中高亮**：检索结果与记录视图里查询词用强调色底高亮（`<mark class="seeu-hl">`，跟随主题 token），一眼能看出为什么命中；
- **外壳窗口跟随系统浅色**：加载页 / 启动失败页 / 本地模型设置窗口原先只有深色盘，现在加了 `@media (prefers-color-scheme: light)` 覆盖（浅色下强调色换成 `#0E7490`，按钮文字随之改白），白天或投屏时不刺眼；dsh 主界面的深浅色仍由 `ui-theme` 控制；
- **引用清单导出**：检索结果【复制引用清单】、记录视图【复制本页引用清单】、表视图【复制本页引用清单】、实体视图【复制实体清单】，每条都回查 Goldeneyes 句柄，输出 Markdown（抬头含关键词/筛选/索引库/时间，正文带 `引用：` 与可直接执行的 `回查：ges read …`，无句柄行标注并在文末统计）；
- **时间线筛选**：检材（下拉选名称）、应用（下拉选索引里出现过的应用，带记录数）与时间桶分段按钮并排，和检索/记录视图一致，不再手输 eid/应用名；
- **时间线与跨案导出**：时间线视图【复制时间线清单】（分桶/筛选/时间段 → 条数 · 检材 · 应用），跨案视图【复制重合实体清单】（类型/值/案数/检材/提及次数 + 案件号）；
- **会话区排版**：用户气泡用强调色低透明度底、助手正文行高 1.78、代码块卡片化（长句柄/命令不折行）、输入框圆角 16px 且聚焦描青边；规则只依赖官方 `data-chat-flow-kind` / `data-composer-input` / `data-tool` 属性，`npm run test:e2e:theme-conv` 验证（深色默认，`--theme=light` 验浅色，两套都跑通）；工具卡片 `[data-tool]` 的圆角/边框由 `npm run test:e2e:tools` 在真实工具调用后采样断言（实测 12px / `rgba(148,163,184,0.18)`）；
- **本地模型增强**：从网关 `/v1/models` 自动读取上下文窗口（兼容 `max_model_len` / `context_length` / `n_ctx` 等自报字段）填入设置页；启动探测发现「配置的模型不在网关列表」时在设置页和日志里明确提示，避免抄错模型名后只看到会话请求失败；
- **欢迎页「最近案件」**：快捷按钮下方多一枚 chip——「最近案件：<案件名> · 库大小 · 生成时间 ›」，取本地索引 API 里 `builtAt` 最新的一条，点它直接进索引面板（没有索引库时整行隐藏，纯 web 预览同样可用）；
- **位置记忆**：面板记住上次的标签页与索引库（`localStorage` 的 `seeu.panelTab` / `seeu.panelDb`），下次打开直接回到上次所在视图；
- **测试**：`npm test` 38 个纯函数单测；`scripts/e2e/` 入仓 14 个端到端脚本（本地模型对话/工具调用/429 重试/能力自检/设置页/欢迎页/欢迎页快捷入口/加载页/空库引导/面板/检索筛选/会话区主题/引用清单导出）。

## v0.2.1

- **欢迎页**：品牌块 + 「证据链优先 · 只读取证 · 结论可回查」+ 三步上手（选案件目录建库 → 直接提问 → 看引用回查）；
- **本地模型可见性**：托盘 tooltip、`工具 → 本地模型状态…`、加载页状态行、错误页一键「禁用本地模型并重启」；
- **能力自检**：设置页一次跑「模型列表 / 基础对话 / 工具调用」，工具调用不过就明确提示该模型只能聊天、不能查库；
- **低并发/长上下文**：重试 3 次、标题生成 512 tokens、`compaction` 余量 32768 → 8192（32k 窗口也能用）、请求体不发 `store`/`stream_options`/developer 角色（兼容 vLLM/Ollama/LM Studio）；
- **设置页**：从网关拉取模型列表、**本机部署预设（Spark 单机 qwen3.8-flash-next / Spark 双机 dsv4.1-flash）**、窗口档位一键套用（32k/128k/256k）、配置健康度提示、超时/重试高级项、复制诊断信息；
- **索引面板**：首次使用三步引导、旧库 schema 不一致提示；
- **测试**：`npm test` 36 个纯函数单测；`scripts/e2e/` 9 个端到端脚本。


> **v0.2.0 改了什么**
>
> 1. **视觉层**：新增 `plugins/seeu-theme/`（宿主 `index.js` 把 `theme.css` 注入首屏 `<style>`，客户端 `client.js` 兜底 `<link>` + 改 `document.title`）——取证深色主题（深蓝底 + 青色强调）、中文字体栈、圆角/滚动条/选中态统一；官方 `ui-brand-official` 置为 disabled，改由主题插件提供侧栏品牌「SeeU 取证」与欢迎页大图标；`locale.preference: zh`。
> 2. **索引面板视觉重构**：`plugins/seeu-case-index/client.js` 全量 token 化，加 KPI 条（案件/检材/记录/实体/库大小/生成时间）、pill 标签 + 数量 badge、树行高与竖线指引、检材名加粗 + 平台/备注次级色、骨架屏/空态、表视图 sticky 表头。
> 3. **本地模型接入（OpenAI 兼容网关）**：见 §9。`tools/local-model.mjs` 生成 `llm-pi-ai` providers + `agent-default-model` + `session-title-llm` + `retryPolicy`，外壳启动时写成 `<userData>/local-model.patch.yml` 作为第二个 `--patch`。
> 4. **本地模型设置窗口**：菜单 `设置 → 本地模型与工具路径…`（`Ctrl+,`，托盘也有），支持连通性测试（主进程 `net` 请求 `/v1/models`）、实时预览生成的 patch、保存并重启。
> 5. **启动探测**：启动时 4 秒探测已配置的网关，结果写 `logs\shell.log`，失败只提示不阻塞；错误页新增【本地模型设置】按钮。
> 6. **长上下文/低并发调优**：`retryPolicy.maxRetries 3`、标题生成 512 tokens/20s、preset 内 `compaction-basic` 余量 `headroomTokens: 8192`（128k 窗口不再在 57k 就压缩，32k 小模型也能直接跑）。
> 7. 打包态验证：目录版 `{"ok":true,"elapsedMs":4095}`、portable `{"ok":true,"elapsedMs":36517}`、打包态面板 `m2ok:true`（七个标签、24 表、实体/时间线真实数据、`errors:[]`）、打包态设置窗口 `{"ok":true,…,"previewHasRetryPolicy":true,"badGatewayRejected":true}`（页面来自 asar 内的 `dist/renderer/local-model.html`）。

> **v0.1.7 改了什么**
>
> 1. **M5 跨案中央库**：新增 `tools/ges-index/cross.mjs` 与 `<dsh 工作目录>\indexes\crosscase.db`；每个案件库按"按案删了重写"幂等同步，汇总实体（kind+归一化值）、提及（每实体每案最多 5 条、带 `Goldeneyes://` 句柄）与镜像哈希。
> 2. **跨案查询**：`/seeu-index/cross/{list,sync,entity,top,files,stats}` 接口 + CLI `xcase sync/list/top/entity/files/stats`（`npm run index:xcase:*`）；建库完成后自动同步该案。
> 3. **面板第 7 个标签「跨案」**：统计概览、案件清单、【同步全部案件】（显示新增/更新案数）、重合实体 Top（minCases/kind 可调）、实体值查询按案件分组展示提及并可回查该案引用。
> 4. **技能升级**：`ges-case-index` SKILL.md 增加第 10 段跨案命令与"跨案命中属线索级、引用分别落各案句柄"的规则。
> 5. 双案夹具实测：`sharedEntities 3999`、Top 首行 `url … 2 案 508 次`、`phone 85254877240` 跨 2 案 12 次；打包态跨案面板 `m5ok: true`、`errors: []`。

> **v0.1.6 改了什么**
>
> 1. **M2 typed 结构化层**：按**真实表头签名**把全解析结果投影成 24 张表（联系人/账号/消息/通话/短信/浏览搜索/Exif/图片视频/应用/授权/SIM/Wi-Fi/蓝牙/流量/日历/小程序/朋友圈/收藏/设备/健康指标…），
>    本案 370 叶 / 22,777 记录里 21,123 条进入 typed 表（**92.7%**；CSV 记录 **99.7%**），并生成 22,772 条 `citation`（句柄+行号+可回查状态）。
> 2. **跨检材实体聚合**：手机号/邮箱/网址/IP/钱包/身份证/车牌/银行卡按值聚合，直接标出「跨 N 检材」；带关键词时唯一命中会返回提及明细（record/eid/app/时间/行号）。
> 3. **时间线**：按小时/天/月分桶，柱条可点，钻进该时段的记录。
> 4. **面板四视图**：树 / 检索之外新增 记录 / 实体 / 时间线 / 表 四个标签，全部带中文空态与翻页；引用仍一律回 `record.id` → `Goldeneyes://` 句柄。
> 5. **技能同步升级**：`ges-case-index` SKILL.md 补上 `/tables /table /entity /timeline /records` 用法，模型在会话里可直接做结构化查询与跨检材关联。
>
> 打包态实测：目录版 4100 ms / portable 44.5s 正常起 UI；asar 内插件与工具链齐全，打包态 UI 端到端（六个标签 + 记录/实体/时间线/表真实数据）`errors: []`。

> **v0.1.5 改了什么**
>
> 1. **会话里也能查库（M3）**：外壳启动前先用 `node:net` 探一个空闲端口，再 `--port <p>` 传给 dsh，
>    同时把 `SEEU_INDEX_API=http://127.0.0.1:<p>/seeu-index` 放进 dsh 子进程环境变量；
>    随包的 `ges-case-index` 技能教模型用 `curl -G "$SEEU_INDEX_API/..."` 查库（详见 §8.5）。
> 2. **技能自动安装**：启动时把 `resources/forensics/skills/**` 逐文件复制到 `dsh-home\skills\`
>    （dsh 的默认技能根，带 `version:文件名:大小` 指纹，内容没变就跳过）——**不需要 customSkillDirs，
>    也不需要外壳生成 runtime patch**。
> 3. **记住上次案件目录**：面板选过的案件目录写进 `dsh-home\index-state.json`，下次启动自动扫描，
>    重启后可直接看到上次的库。
> 4. **打包自检**：asar 内 19,637 entries，含客户端插件、`tools/ges-index/**`、overlay 与 4 个 SKILL.md；
>    overlay md5 与源文件一致（`64cd0e7721d17acea8fbba6fdae8f66b`）。

> **v0.1.4 改了什么**
>
> 1. **案件索引面板**：新增 dsh 客户端插件 `plugins/seeu-case-index/`，在 dsh Web UI 的
>    左侧栏（`sidebar.panellist`）与设置页（`settings.section`）各有一个「取证索引」入口：
>    填案件目录 → 【建库 / 更新】（带进度条）→ 树状导航 + 关键词检索 + 引用详情，
>    全流程不用开命令行（详见 §8）。
> 2. **宿主插件路由**：`/seeu-index/{list,build,tree,search,cite,stats,verify}` 跑在 dsh
>    自己的 webServer 上（仅 loopback，只允许读 `.seeu-index` 下的库文件）。
> 3. **注册方式**：`resources/forensics/cordis.patch.yml` 末尾一行 `- insert:` 指相对路径
>    `../../plugins/seeu-case-index/index.js`，开发态/打包态（asar 内）同一条路径都能解析，
>    不需要 pnpm 安装插件；`electron-builder.yml` 白名单补 `plugins/**` 与 `tools/ges-index/**`。

> **v0.1.3 改了什么**
>
> 1. **工具面再收窄两项**：从 `preset-standard.plugins` 整条删除 `tool-plugin-manager`
>    （`plugin_manager` 可联网安装/移除 npm 插件包，等于打开供应链与代码执行路径）与
>    `tool-plugin-market`（插件市场，官方默认本就 disabled）。当前 preset = 官方 22 项
>    减去 3 项 = **19 项**；`present`、子代理、工作流、后台作业、定时任务、目标、plan
>    等能力全部保留。
> 2. `npm run check:overlay` 增加断言：preset 内不得出现 `tool-web` /
>    `tool-plugin-manager` / `tool-plugin-market`。
>
> **v0.1.2 改了什么**
>
> 1. **取证工具面定稿**：`preset-standard` 保留官方 22 项里的 21 项（子代理 / 工作流 /
>    后台作业 / 定时任务 / 目标 / plan / todo 都可用），只去掉 `tool-web`（不联网），
>    `tool-fs` 收成只读；估算每轮请求省 ~1.5k token（估算值）。
> 2. **打包前 overlay 校验**：新增 `npm run check:overlay`，挂进 `prepackage:dir` /
>    `prepackage:win`。起因是本轮早先一次打包把被并发改写中的 overlay 半截内容打进
>    asar，产物启动即报 `failed to parse overlay ... YAMLException`；现在打包前
>    直接失败，不再产出坏包（详见 `docs/packaging.md` §5.2）。
> 3. 新增 `scripts/kill-app.mjs`：验证/打包前清理残留实例，避免单实例锁导致
>    新实例静默退出（`exit 0`）。
>
> 历史包袱：v0.1.0 缺 21 个 peer 包（启动即崩），v0.1.1 / v0.1.2 / v0.1.3 是索引面板
> 之前的版本，均已作废。**请统一使用 0.1.4 的产物。**
