---
name: ges-case-index
description: 查询火眼（GoldenEyes/GES）案件全解析结果的本地索引库（案件树、关键词检索、引用回查），不调用 ges.exe。用于快速摸清案件有哪些检材/应用/账号、找某个关键词出现在哪里、以及生成可核验的 Goldeneyes 句柄引用。
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

先确认服务可用（没有输出就说明桌面版的索引插件没起来，直接告诉用户去开「取证索引」面板）：

```bash
curl -s "$SEEU_INDEX_API/list" | head -c 500
```

`/list` 返回 `indexes[]`，每项含 `caseDir`、`dbPath`、`caseNumber`、`caseName`、`builtAt`、`sizeBytes`。
**后续所有查询都带上 `db=<dbPath>`**（URL 编码交给 `--data-urlencode`/`-G` 即可）。

## 查询命令（全部 GET，返回紧凑 JSON）

```bash
DB="<dbPath>"
API="$SEEU_INDEX_API"

# 1) 概览：检材数、文件数、记录数、时间范围、每个检材的应用分布
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
```

输出约定：`truncated: true` + `next` 表示还有下一页（把 `next` 作为下一次的 `node`/`offset` 继续）；
`citable: 0` 的记录不要写进证据引用。

## 工作方式建议

1. 先用 `/tree root` 看清案件全貌（几个检材、各有哪些应用、多少记录），再决定钻哪一枝；
2. 找线索用 `/search`，找到候选后再 `/cite` 拿句柄，最后用 `/read`（火眼 `/case/` 路径）核对原文；
3. 回答里引用时给双层方括号 + `Goldeneyes://` 句柄，并对 `citable=1` 的记录注明检材与时间；
4. **不要**编造库里没有的记录；库里查不到就明确说"索引中未发现"，并说明索引的覆盖范围（哪些检材、哪些应用）；
5. 索引库可能是旧版本（用户加了新检材但没点【建库 / 更新】）：遇到"应该存在却查不到"时，先看 `/list` 里的 `builtAt`，提醒用户更新索引。
