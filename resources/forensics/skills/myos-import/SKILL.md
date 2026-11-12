---
name: myos-import
description: 把「超级取证大师 MYOS」的取证结果导入 SeeU 索引（选案件/检材/结果库/表 → 预估行数 → 批量入库 → 校验），之后用统一索引（/evidences /search /records）查询与作答。用户说「把 MYOS 的数据入库/融合/一起查」时用本技能。
---

# 把 MYOS 取证结果导入 SeeU 索引

SeeU 面板的索引服务（`$SEEU_INDEX_API`）已经接好了 MYOS 的 MCP 桥：列案件、列检材、自动发现结果库（`.mfs`）、预估行数、批量把表写成 `case-index.db`（record + 全文索引 + 实体），之后面板和 AI 都只查这份索引。

## 前置条件

- **MYOS（超级取证大师）必须正在运行**。没启动时接口返回 `503`：`请先启动「超级取证大师」…`。
- 会话里能用：`bash`（Git Bash）、`curl`、`python`（`$SEEU_TOOL_PYTHON`，没有就用 `python`）。
- 本技能把 `$SEEU_INDEX_API` 当基地址，形如 `http://127.0.0.1:<port>/seeu-index`。

## 接口一览（都挂在 `$SEEU_INDEX_API` 下）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/myos/cases?keyword=` | 列 MYOS 案件（caseId/caseName/casePath） |
| GET | `/myos/materials?caseId=` | 列检材（materialId/name/状态/大小） |
| GET | `/myos/dbs?caseId=&materialId=` | 自动发现该检材的结果库（`.mfs` 绝对路径 + 表名提示） |
| GET | `/myos/tables?db=<结果库绝对路径>` | 列出该结果库的表（sqlite_master） |
| POST | `/myos/row-counts` | 预估每张表行数 `{caseId,db,tables:[…]}` |
| POST | `/myos/import-batch` | 批量导入 `{caseId,db,tables:[…],outDir,caseName,evidenceName,maxRows}` → `202 {jobId}` |
| GET | `/myos/import-batch` | 查批量任务进度 `{job:{status,index,total,table,records,totals,result}}` |
| POST | `/myos/import` | 单表导入（自定义 SQL 时用） `{caseId,db,sql,outDir,…}` |

## 标准流程

1. **确认用户想导哪个案件/检材**（拿不准就问，不要默认第一条）。

```bash
curl -s "$SEEU_INDEX_API/myos/cases" | python -c "import json,sys;d=json.load(sys.stdin);[print(c['caseId'],c.get('caseName'),c.get('casePath','')) for c in d['cases']]"
```

2. **列检材，选一个**：

```bash
curl -s "$SEEU_INDEX_API/myos/materials?caseId=<caseId>" | python -c "import json,sys;d=json.load(sys.stdin);[print(m['materialId'],m.get('name'),m.get('status','')) for m in d['materials']]"
```

3. **自动发现结果库**（`.mfs` 是加密的，**不要**用 sqlite/python 直接打开；只能走接口）：

```bash
curl -s "$SEEU_INDEX_API/myos/dbs?caseId=<caseId>&materialId=<materialId>" | python -m json.tool | head -40
```

> 注意：自动发现通常只列出「按 app 拆分的子库」（如 `data/MApps/微信{guid}.mfs`），根库 `data/MApps.mfs`、`data/FSData.mfs` 可能不在列表里——这时**用库文件名**（下面的 `name` / `dbName`），插件会自己从已发现路径往上找，别手打中文绝对路径（经控制台/HTTP 转码会变乱码）。

4. **列出要导入的表**（用「案件 + 检材 + 库文件名」，避免中文路径转码）：

```bash
curl -s -G "$SEEU_INDEX_API/myos/tables"   --data-urlencode "caseId=<caseId>" --data-urlencode "materialId=<materialId>"   --data-urlencode "name=MApps.mfs" | python -m json.tool
```

返回 `{dbPath, tables:[…]}`；也可以直接传 `?db=<绝对路径>`（不推荐，中文路径容易转码）。

5. **预估行数**，挑有数据的表（空表会显示 0 行；不存在的表显示预估失败）：

```bash
curl -s -X POST "$SEEU_INDEX_API/myos/row-counts" -H 'content-type: application/json' \
  -d '{"caseId":"<caseId>","materialId":"<materialId>","dbName":"MApps.mfs","tables":["TBL_A","TBL_B"]}' | python -m json.tool
```

6. **批量导入**（`outDir` 用案件目录；`caseName` 用案件名；`evidenceName` 用检材名；每张表各算一个检材，追加写入，不会覆盖已有索引）：

```bash
curl -s -X POST "$SEEU_INDEX_API/myos/import-batch" -H 'content-type: application/json' \
  -d '{"caseId":"<caseId>","materialId":"<materialId>","dbName":"MApps.mfs","tables":["TBL_A","TBL_B"],"outDir":"E:/forensics/<案件目录>","caseName":"<案件名>","evidenceName":"<检材名>","maxRows":2000}'
```

7. **轮询进度**（`status` 为 `done` 或 `failed` 才停；一般几秒到几分钟）：

```bash
for i in $(seq 1 120); do
  OUT=$(curl -s "$SEEU_INDEX_API/myos/import-batch")
  echo "$OUT" | python -c "import json,sys;j=json.load(sys.stdin)['job'] or {};print(j.get('status'),j.get('index'),'/',j.get('total'),j.get('table',''))"
  echo "$OUT" | python -c "import json,sys;j=json.load(sys.stdin)['job'] or {};sys.exit(0 if j.get('status')!='running' else 1)" && break
  sleep 3
done
```

8. **校验并报告**：`status=done` 后看 `job.result.tables`（每张表记录数/实体数）、`job.result.totals`（累计记录/检材）、`job.result.skipped`（跳过原因）。再用索引查询确认：

```bash
curl -s "$SEEU_INDEX_API/list" | python -m json.tool | head -20
curl -s "$SEEU_INDEX_API/evidences?caseNumber=<案号或 caseNumber>" | python -m json.tool
```

## 硬规则

- **不要直接读 `.mfs` 结果库**（专有加密格式，`node:sqlite`/python 打开会报 `file is not a database`）；只能通过上面的接口。
- **不改 MYOS 数据**：所有读取都是只读；导入只是把数据复制进 SeeU 的 `case-index.db`。
- 一次别选太多表：接口最多 200 张表、每张表最多 20000 行（默认 `maxRows:2000`）；大表先按 2000 行导，需要更多就调大 `maxRows` 或先用 SQL 收窄（`POST /myos/import` 支持自定义 SQL）。
- 同一案件重复导入是**追加**（eid 递增、不覆盖）；确实要重建再让用户确认后用 `mode:"rebuild"`（单表接口）。
- 导入完告诉用户：案件名、检材名、导了哪些表、共多少条记录/实体，以及后续可以在面板「检索/记录」里查。
- 比武作答保持极简（`Q<n>｜答案｜思路`），不要贴大段 JSON。
- 命令统一在 `bash` 里执行；bash 不可用才降级 `pwsh`（那时环境变量写 `$env:SEEU_INDEX_API`）。
