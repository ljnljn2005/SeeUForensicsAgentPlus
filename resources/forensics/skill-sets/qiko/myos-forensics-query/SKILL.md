---
name: myos-forensics-query
description: "MYOS 取证大师 MCP 工具操作指引。在需要查询取证案件数据库、检索手机取证结果、执行 SQLite 查询、搜索证据内容时激活。"
---

# MYOS 取证大师 MCP 查询技能

本技能提供 MYOS 取证大师 MCP 工具的结构化操作指引，用于在手机取证时序重构分析中高效查询取证数据库与证据内容。

## 可用工具概览

MYOS 取证大师 MCP 提供以下工具（均为 deferred tools，使用前需通过 ToolSearch 加载 schema）：

### 案件管理类
| 工具 | 用途 |
|------|------|
| `myos-forensics.query_cases` | 列出所有取证案件 |
| `myos-forensics.open_case` | 打开案件（需传 caseId） |
| `myos-forensics.close_case` | 关闭案件 |
| `myos-forensics.load_case` | 加载案件 |
| `myos-forensics.create_case_and_open` | 创建并打开案件 |

### 手机取证类
| 工具 | 用途 |
|------|------|
| `myos-forensics.query_phone_forensics_results_overview` | 查询手机取证结果总览（需 caseMaterialId） |
| `myos-forensics.query_phone_file_forensics_result_summary` | 查询手机文件取证结果摘要（需 caseMaterialId） |
| `myos-forensics.start_auto_mobile_forensics` | 启动自动手机取证 |
| `myos-forensics.start_phone_file_forensics_task` | 启动手机文件取证任务 |
| `myos-forensics.start_phone_folder_forensics_task` | 启动手机文件夹取证任务 |
| `myos-forensics.stop_phone_forensics_task` | 停止手机取证任务 |

### 数据查询类
| 工具 | 用途 |
|------|------|
| `myos-forensics.sqlite_query` | 执行 SQLite 查询（核心工具） |
| `myos-forensics.quick_search_content` | 快速搜索证据内容 |
| `myos-forensics.quick_search_files` | 快速搜索文件 |
| `myos-forensics.global_search_content` | 全局搜索内容 |
| `myos-forensics.raw_data_content_search` | 原始数据内容搜索 |

### 任务与设备管理类
| 工具 | 用途 |
|------|------|
| `myos-forensics.query_task_status` / `query_case_running_tasks` | 查询任务状态 |
| `myos-forensics.wait_task_completion` | 等待任务完成 |
| `myos-forensics.query_device_info` | 查询设备信息（需 dbPath + materialId） |
| `myos-forensics.query_device_mount_path` | 查询设备挂载路径 |
| `myos-forensics.query_materials` | 查询案件材料（获取 materialId / caseMaterialId） |
| `myos-forensics.query_current_node_data` | 查询当前节点数据 |
| `myos-forensics.query_case_settings` | 查询案件设置 |
| `myos-forensics.query_local_disks` | 查询本地磁盘 |

### 导出类
| 工具 | 用途 |
|------|------|
| `myos-forensics.export_bcp` | 导出 BCP 格式 |
| `myos-forensics.export_case` | 导出案件 |

---

## 标准查询流程（六步法）

### 步骤 1：加载工具 schema

所有 MCP 工具均为 deferred tools，每次使用前必须先通过 ToolSearch 加载：

```
ToolSearch: tool_names = ["myos-forensics.query_cases", "myos-forensics.open_case", "myos-forensics.query_materials", "myos-forensics.sqlite_query", "myos-forensics.query_phone_forensics_results_overview", "myos-forensics.query_device_info"]
```

### 步骤 2：打开案件

```
DeferExecuteTool: myos-forensics.query_cases  →  获取案件列表
找到目标案件 → DeferExecuteTool: myos-forensics.open_case (传 caseId)
```

> **注意**：`open_case` 的参数是 `caseId`（案件 UUID），不是案件路径。从 `query_cases` 返回结果中获取。

### 步骤 3：获取材料 ID（必需前置步骤）

```
DeferExecuteTool: myos-forensics.query_materials (传 caseId)
```

从返回结果中获取 `materialId` / `caseMaterialId`，后续多个查询依赖此 ID。

### 步骤 4：查询取证结果总览

```
DeferExecuteTool: myos-forensics.query_phone_forensics_results_overview (传 caseMaterialId)
```

获取手机取证分类总览（通讯录、短信、通话、应用、文件等分类及数量）。

### 步骤 5：发现并定位取证数据库（.mfs 文件）

MYOS 提取的数据存储在案件目录下的 `.mfs` 文件中（SQLite 格式封装）。关键数据库：

| .mfs 文件 | 位置 | 内容 | 命名规则 |
|-----------|------|------|----------|
| `Platform.mfs` | `data/` | 系统级数据（通话、短信、GPS、WiFi、屏幕锁、应用使用等） | 固定名称 |
| `FSData.mfs` | `data/` | 文件系统元数据 | 固定名称 |
| `Wechat{GUID}.mfs` | `data/MApps/` | 微信数据（私聊、群聊、联系人、支付等） | `Wechat{GUID}.mfs` |
| `DingDing{GUID}.mfs` | `data/MApps/` | 钉钉数据 | `DingDing{GUID}.mfs` |
| `QQ{GUID}.mfs` | `data/MApps/` | QQ 数据 | `QQ{GUID}.mfs` |
| 其他 App | `data/MApps/` | 各 App 取证数据 | `{AppName}{GUID}.mfs` |

> **发现方法**：`find "<案件路径>/dev/" -name "*.mfs" -type f` 列出所有 .mfs 文件

### 步骤 6：执行 SQLite 查询（核心）

```
DeferExecuteTool: myos-forensics.sqlite_query
  参数:
    dbPath: "D:\\MYOS\\Case\\<案件名>\\dev\\<设备目录>\\data\\Platform.mfs"
    sql: "SELECT ... FROM TBL_PR_BCP_DIALOG_INFO WHERE ..."
    maxRows: 1000
```

> **参数命名**：使用 `dbPath`（camelCase），不是 `db_path`（snake_case）。
> **路径转义**：Windows 路径使用双反斜杠 `\\`。

---

## MYOS BCP 表结构速查

### 系统平台表（Platform.mfs）

| 表名 | 内容 | 时间字段 | 格式 |
|------|------|----------|------|
| `TBL_PR_BCP_DIALOG_INFO` | 通话记录 | `START_TIME` | `YYYY-MM-DD HH:MM:SS` |
| `TBL_PR_BCP_SMS_INFO` | 短信 | `MAIL_SEND_TIME` | `YYYY-MM-DD HH:MM:SS` |
| `TBL_PR_BCP_WIFI_INFO` | WiFi 信息 | `VISIT_TIME` | `YYYY-MM-DD HH:MM:SS` |
| `TBL_PR_WIFI_LINK_NET_INFO` | WiFi 连接 | `strJoinTime` | ` MM-DD HH:MM:SS.SSS `（无年份，含前后空格） |
| `TBL_PR_GPS_INFO` | GPS 定位 | `strTime` | `YYYY-MM-DD HH:MM:SS` |
| `TBL_PR_SCREENLOCKRECORD_INFO` | 屏幕锁记录 | `strTime` | `YYYY-MM-DD HH:MM:SS` |
| `TBL_PR_APP_USED_LOG_INFO` | 应用使用日志 | `strLastRunTime` | 可能为空（取证未提取时间） |
| `TBL_PR_BCP_CONTACT_INFO` | 通讯录 | — | — |

### 微信表（Wechat{GUID}.mfs）

| 表名 | 内容 | 时间字段 | 格式 |
|------|------|----------|------|
| `TBL_PR_WEIXIN_IM_CONTACTMSG` | 微信私聊消息 | `MAIL_SEND_TIME` | `YYYY-MM-DD HH:MM:SS` |
| `TBL_PR_WEIXIN_IM_GROUPMSG` | 微信群聊消息 | `MAIL_SEND_TIME` | `YYYY-MM-DD HH:MM:SS` |
| `TBL_PR_WEIXIN_ECOM_DEAL` | 微信支付 | `MAIL_SEND_TIME` | `YYYY-MM-DD HH:MM:SS` |
| `TBL_PR_WEIXIN_CONTACT` | 微信联系人 | — | — |

### 钉钉表（DingDing{GUID}.mfs）

| 表名 | 内容 | 时间字段 | 格式 |
|------|------|----------|------|
| `TBL_PR_DINGDING_IM_CONTACTMSG` | 钉钉私聊 | `MAIL_SEND_TIME` | `YYYY-MM-DD HH:MM:SS` |
| `TBL_PR_DINGDING_IM_GROUPMSG` | 钉钉群聊 | `MAIL_SEND_TIME` | `YYYY-MM-DD HH:MM:SS` |

### 文件系统表（FSData.mfs）

| 表名 | 内容 | 时间字段 | 格式 |
|------|------|----------|------|
| `TBL_FS_ENTRY_{HASH}` | 文件系统条目 | `createtime` / `updatetime` / `accesstime` | Unix 时间戳（秒），可能全部为 0（镜像时间戳未保留） |

> **表名中的 HASH**：文件系统表名包含设备哈希，需先查 `sqlite_master` 获取实际表名。
> **⚠️ 时间戳可能全为 0**：部分镜像提取时文件系统元数据时间戳未保留，先执行 `SELECT COUNT(*) FROM TBL_FS_ENTRY_{HASH} WHERE updatetime > 0` 确认是否有有效时间戳。

---

## 关键列名速查

### 通话记录 (TBL_PR_BCP_DIALOG_INFO)
- `START_TIME` — 通话开始时间
- `END_TIME` — 通话结束时间
- `RELATIONSHIP_ACCOUNT` — 对方号码
- `RELATIONSHIP_NAME` — 联系人名称
- `DUAL_TIME` — 通话时长（秒）
- `CALL_STATUS` — 通话状态
- `LOCAL_ACTION` — 本地操作（0=呼入/1=呼出/3=未接）

### 短信 (TBL_PR_BCP_SMS_INFO)
- `MAIL_SEND_TIME` — 发送/接收时间
- `RELATIONSHIP_ACCOUNT` — 对方号码
- `RELATIONSHIP_NAME` — 联系人名称
- `CONTENT` — 短信内容
- `LOCAL_ACTION` — 操作类型（01=接收/02=发送）

### 微信私聊 (TBL_PR_WEIXIN_IM_CONTACTMSG)
- `MAIL_SEND_TIME` — 消息时间
- `LOCAL_ACTION` — 本地操作类型
- `FRIEND_NICKNAME` — 对方昵称
- `FRIEND_REMARK` — 对方备注名
- `ACCOUNT` — 对方账号
- `CONTENT` — 消息内容
- `MEDIA_TYPE` — 媒体类型
- `FILE_PATH` — 文件路径
- `DELETE_STATUS` — 删除状态

### 微信群聊 (TBL_PR_WEIXIN_IM_GROUPMSG)
- `MAIL_SEND_TIME` — 消息时间
- `LOCAL_ACTION` — 本地操作类型
- `FRIEND_NICKNAME` — 发送者昵称
- `GROUP_NAME` — 群名称
- `CONTENT` — 消息内容
- `MEDIA_TYPE` — 媒体类型
- `DELETE_STATUS` — 删除状态

### GPS (TBL_PR_GPS_INFO)
- `strTime` — 定位时间
- `strLongtitude` / `strLatitude` — 经纬度（注意拼写是 Longtitude 不是 Longitude）
- `strType` — 定位类型
- `strSource` — 定位来源

### 屏幕锁 (TBL_PR_SCREENLOCKRECORD_INFO)
- `strTime` — 锁屏/解锁时间
- `strState` — 状态（锁屏/解锁）

### 应用使用 (TBL_PR_APP_USED_LOG_INFO)
- `strPackage` — 包名
- `strLastRunTime` — 最后运行时间
- `strInstallTime` — 安装时间
- `strIsDeleted` — 是否已删除

---

## 常用 SQL 查询模板

### 按日期范围查询（BCP 表，字符串时间格式）

```sql
-- 通话记录（注意列名是 RELATIONSHIP_ACCOUNT/RELATIONSHIP_NAME/DUAL_TIME，不是 PHONE_NUMBER/CONTACT_NAME/DURATION）
SELECT START_TIME, END_TIME, RELATIONSHIP_ACCOUNT, RELATIONSHIP_NAME, DUAL_TIME, CALL_STATUS, LOCAL_ACTION
FROM TBL_PR_BCP_DIALOG_INFO
WHERE START_TIME >= '2026-08-02' AND START_TIME < '2026-08-03'
ORDER BY START_TIME;

-- 短信（注意列名是 RELATIONSHIP_ACCOUNT/RELATIONSHIP_NAME，不是 PHONE_NUMBER/CONTACT_NAME）
SELECT MAIL_SEND_TIME, RELATIONSHIP_ACCOUNT, RELATIONSHIP_NAME, CONTENT, LOCAL_ACTION
FROM TBL_PR_BCP_SMS_INFO
WHERE MAIL_SEND_TIME >= '2026-08-02' AND MAIL_SEND_TIME < '2026-08-03'
ORDER BY MAIL_SEND_TIME;

-- 微信私聊
SELECT MAIL_SEND_TIME, LOCAL_ACTION, FRIEND_NICKNAME, FRIEND_REMARK,
       ACCOUNT, CONTENT, MEDIA_TYPE, FILE_PATH, DELETE_STATUS
FROM TBL_PR_WEIXIN_IM_CONTACTMSG
WHERE MAIL_SEND_TIME >= '2026-08-02' AND MAIL_SEND_TIME < '2026-08-03'
ORDER BY MAIL_SEND_TIME;

-- 微信群聊（内容预览，避免返回过大）
SELECT MAIL_SEND_TIME, LOCAL_ACTION, FRIEND_NICKNAME, GROUP_NAME,
       substr(CONTENT, 1, 80) AS CONTENT_PREVIEW, MEDIA_TYPE, DELETE_STATUS
FROM TBL_PR_WEIXIN_IM_GROUPMSG
WHERE MAIL_SEND_TIME >= '2026-08-02' AND MAIL_SEND_TIME < '2026-08-03'
ORDER BY MAIL_SEND_TIME;

-- GPS 定位（注意列名是 strLongtitude 不是 strLongitude）
SELECT strTime, strLongtitude, strLatitude, strType, strSource
FROM TBL_PR_GPS_INFO
WHERE strTime >= '2026-08-02' AND strTime < '2026-08-03'
ORDER BY strTime;

-- 屏幕锁
SELECT strTime, strState
FROM TBL_PR_SCREENLOCKRECORD_INFO
WHERE strTime >= '2026-08-02' AND strTime < '2026-08-03'
ORDER BY strTime;

-- 应用使用
SELECT strPackage, strLastRunTime, strInstallTime, strIsDeleted
FROM TBL_PR_APP_USED_LOG_INFO
WHERE strLastRunTime >= '2026-08-02' AND strLastRunTime < '2026-08-03'
ORDER BY strLastRunTime;

-- WiFi 连接（⚠️ strJoinTime 格式为 " MM-DD HH:MM:SS.SSS "，前后空格、无年份，须用 LIKE）
SELECT strJoinTime, strName, strMAC, strIpAddress, strEncAlgorithm, strLinkType
FROM TBL_PR_WIFI_LINK_NET_INFO
WHERE strJoinTime LIKE '%08-02%'
ORDER BY strJoinTime;
```

### 查看所有表名

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

### 探测表列名（PRAGMA 被禁用时的替代方案）

```sql
-- ⚠️ PRAGMA table_info() 在 MYOS MCP 中被禁用，使用以下替代方案：
SELECT * FROM <表名> LIMIT 1;
-- 从返回的列名推断结构
```

### 文件系统元数据（FSData.mfs，Unix 时间戳）

```sql
-- 先获取实际表名（表名包含设备哈希）
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'TBL_FS_ENTRY_%';

-- 查询（createtime/updatetime 为 Unix 秒级时间戳）
SELECT filename, extendname, createtime, updatetime, accesstime, filesize, isdelete, dokanname
FROM TBL_FS_ENTRY_{HASH}
WHERE (createtime >= 1785600000 AND createtime < 1785686400)
   OR (updatetime >= 1785600000 AND updatetime < 1785686400)
ORDER BY createtime DESC
LIMIT 200;
```

> **时间戳计算**：使用 Python 或 `date` 命令计算 Unix 时间戳，不要手动计算。
> ```python
> import datetime
> dt = datetime.datetime(2026, 8, 2, 0, 0, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
> print(int(dt.timestamp()))  # Unix 秒
> ```

---

## 全局内容搜索

```
DeferExecuteTool: myos-forensics.global_search_content
  参数: keyword, case_path (可选)
  跨所有数据源搜索关键词，快速定位证据
```

```
DeferExecuteTool: myos-forensics.quick_search_files
  参数: filename_pattern, case_path (可选)
  按文件名模式搜索取证结果中的文件
```

---

## 排障指南

### MYOS 取证软件未运行

如果 `query_cases` 返回连接错误或超时：

1. **提示用户启动 MYOS 取证大师**：MCP 工具依赖 MYOS 软件运行，软件未启动时所有查询不可用
2. **等待用户确认后重试**：用户启动 MYOS 后，重新执行 `query_cases`
3. **直接访问文件系统**（降级方案）：如果用户只需要原始数据且 MYOS 无法启动，可直接通过文件系统访问案件目录中的 .mfs 文件（需 MYOS 软件将 .mfs 挂载为可读 SQLite）

### sqlite_query 返回 PRAGMA 错误

MYOS MCP 禁止执行 `PRAGMA` 语句。改用 `SELECT * FROM <表名> LIMIT 1` 从返回结果推断列名。

### sqlite_query 返回 "no such table"

1. 确认 `dbPath` 指向正确的 .mfs 文件
2. 先执行 `SELECT name FROM sqlite_master WHERE type='table'` 确认表名
3. 文件系统表名含设备哈希后缀，需动态获取

### 查询返回 0 条但预期有数据

1. 检查时间字段名称是否正确（不同表用不同字段名）
2. 检查时间格式是否匹配：
   - BCP 表（TBL_PR_*）用 `YYYY-MM-DD HH:MM:SS` 字符串
   - WiFi 表（TBL_PR_WIFI_LINK_NET_INFO）用 ` MM-DD HH:MM:SS.SSS `（无年份，含前后空格），须用 LIKE
   - FSData 用 Unix 秒级时间戳，但可能全部为 0（镜像时间戳未保留）
   - 应用使用日志（TBL_PR_APP_USED_LOG_INFO）`strLastRunTime` 可能全部为空
3. 检查时间范围是否正确（注意时区差异）

---

## 注意事项

1. **参数命名**：sqlite_query 使用 `dbPath`（camelCase），不是 `db_path`
2. **路径转义**：dbPath 中 Windows 路径使用双反斜杠 `\\`
3. **PRAGMA 禁用**：MYOS MCP 禁止 `PRAGMA table_info()`，用 `SELECT * LIMIT 1` 替代
4. **时间格式**：BCP 表（TBL_PR_*）使用 `YYYY-MM-DD HH:MM:SS` 字符串格式，可直接用字符串比较过滤；FSData 表使用 Unix 秒级时间戳
5. **工具加载**：所有 MCP 工具均为 deferred tools，每次使用前必须先通过 ToolSearch 加载 schema
6. **大数据量**：群聊等表数据量可能很大（单日 200+ 条），建议用 `substr(CONTENT, 1, 80)` 截取内容预览，设置 `maxRows` 限制返回行数
7. **交叉验证**：SQLite 查询结果须与日志、文件元数据等其他数据源交叉验证，单一数据源不作为定性依据
8. **案件路径**：当前案件路径 `D:/MYOS/Case/mate 40 pro`，机主苏步发（微信ID: su_netlord）

## 适用场景

本技能适用于已将手机或移动终端数据导入 MYOS 取证大师并形成 `.mfs` 取证数据库后的查询、关联、复核与结果输出场景。重点不是替代物理提取或镜像解析，而是在已有取证成果上进行结构化查询、时序重构、证据闭环和报告输出。

### 典型适用场景
1. 手机取证结果检索：通讯录、短信、通话、微信、钉钉、QQ、文件、GPS、WiFi、屏幕锁、应用使用记录。
2. 时序重构：按日期或时段聚合通信、聊天、位置、解锁、应用使用，形成行为时间线。
3. 跨应用与跨检材关联：用手机号、账号、昵称、备注、文件路径、哈希、时间戳、聊天内容建立关联表。
4. 竞赛与实战答案支撑：对每个结论记录来源表、SQL、字段、时间转换方式、复核依据，形成可复核证据链。
5. 隐蔽信道线索核验：当另有流量或日志证据时，可从手机取证库中查找可疑文件、聊天指令、外联时间、账号关系，辅助验证 ICMP Echo Request/Reply payload 是否承载外传数据；本技能不直接解析 pcap，但可为隐蔽信道分析提供检材侧证据闭环。
6. 证据固定与输出：将查询结果固化为证据清单、时间线表、跨检材关联表、答案格式和攻击链路图。

### 前置条件
- MYOS 取证大师已运行，MCP 可连接。
- 案件已导入并可打开，能获取 caseId。
- 已获取 materialId 或 caseMaterialId。
- `.mfs` 数据库路径可读，且明确检材来源、材料编号、哈希或封存状态。
- 明确查询目标、时间范围、时区、关键词和输出模板。

### 不适用或需谨慎场景
- 未制作或未加载取证镜像，直接在线查询可能改变原始数据时，不应使用本技能作为唯一取证手段。
- 需要芯片级提取、破解锁屏密码、解密加密分区、恢复已覆盖数据时，本技能只能作为后续查询层。
- 单一 SQL 结果无法直接定性；涉及删除恢复、时间戳异常、应用私有格式时，必须交叉验证。
- 时间字段为空、Unix 时间戳为 0、WiFi 时间无年份等异常情况下，不能机械输出结论。

## 使用步骤

本节为端到端实操步骤，与已有标准查询流程互补，不覆盖原文档已明确的工具调用顺序。若发现工具参数差异，保留原文档并标记待人工裁决。

### 1. 受理与只读准备
1. 登记检材编号、案件名、设备型号、镜像或提取文件路径、MD5/SHA256、封存状态。
2. 建立工作底稿目录：`01_原始清单`、`02_查询SQL`、`03_导出结果`、`04_时间线`、`05_关联表`、`06_报告`。
3. 确认只读原则：不修改原始 `.mfs`，不直接编辑原始证据文件；所有导出结果写入独立输出目录。
4. 明确时区与时间基准：MYOS BCP 表多为本地字符串时间，FSData 可能为 Unix 秒；先记录转换规则，避免 UTC 与本地时间混用。

### 2. 加载工具并建立案件上下文
1. 使用 ToolSearch 加载必要工具 schema：`query_cases`、`open_case`、`query_materials`、`query_phone_forensics_results_overview`、`sqlite_query`、`global_search_content`、`quick_search_files`。
2. 查询案件列表，确认目标案件 caseId。
3. 打开案件并立即查询材料，记录 materialId、caseMaterialId、设备名、检材路径。
4. 查询手机取证结果总览与文件取证摘要，形成数据覆盖清单：哪些应用已解析、哪些分类为空、哪些表可能缺失。

### 3. 将问题拆解为可查询证据项
把任务拆成五类：
- 通信类：通话、短信、通讯录。
- 即时通讯类：微信、钉钉、QQ 私聊/群聊、联系人、支付。
- 行为类：GPS、WiFi、屏幕锁、应用使用。
- 文件类：文件名、扩展名、路径、大小、时间戳、删除状态。
- 网络或外传类：可疑文件名、聊天中的链接、密钥、口令、账号、时间窗口。

每个证据项至少记录：目标表、时间字段、过滤条件、返回列、最大行数、预期异常。

### 4. 定位数据库并探测结构
1. 根据案件路径和设备目录列出 `.mfs` 文件，重点确认 Platform.mfs、FSData.mfs、Wechat*.mfs、DingDing*.mfs、QQ*.mfs。
2. 对每个目标 `.mfs` 先查 sqlite_master，确认表是否存在、文件系统表是否带哈希后缀。
3. 不使用 PRAGMA；用 `SELECT * FROM 表名 LIMIT 1` 探测列名。
4. 对时间字段先做有效性检查：
   - 字符串时间是否为空；
   - Unix 时间戳是否大量为 0；
   - WiFi 连接时间是否无年份且含前后空格；
   - 应用日志时间是否缺失。

### 5. 构造并执行查询
1. 先计数再取数：`SELECT COUNT(*)` 判断规模，避免大表打爆上下文。
2. 对群聊、短信、文件列表使用 `maxRows` 和内容截断，例如 `substr(CONTENT, 1, 80)`。
3. 时间过滤遵循表格式：
   - BCP 表使用 `YYYY-MM-DD HH:MM:SS` 字符串比较；
   - WiFi 连接表使用 LIKE 匹配月日和时分秒片段；
   - FSData 使用 Unix 秒级范围，并先用 Python 或可信工具换算。
4. 关键查询必须保存完整 SQL、dbPath、maxRows、返回行数、执行时间。
5. 对删除状态、媒体类型、本地操作等枚举字段，先抽样确认含义，再写入结论。

### 6. 隐蔽信道线索核验（如存在流量或网络证据）
当题目或案件提示 ICMP、DNS、心跳包、异常外联时，按以下流程与手机取证结果联动：
1. 从流量侧筛选 ICMP Echo Request/Reply；如无流量工具输入，则在 MYOS 中先查找可疑聊天指令、文件路径、外传时间和账号。
2. 导出 ICMP payload，按规则拼接首字符或字符串，观察是否形成可读文本、Base64、十六进制或文件头特征。
3. 将 payload 解码结果与手机取证中的聊天内容、文件名、压缩文件、密钥、账号进行比对。
4. 检查时间窗口是否吻合：ICMP 发送时间、聊天发送时间、文件创建或更新时间、应用使用时间应能形成连续或重叠区间。
5. 记录验证结论：是否为外传数据、是否为测试噪声、是否存在多源命中；不能仅凭 payload 像文本就定性。

### 7. 交叉验证与证据闭环
1. 每个关键结论至少用两类以上数据源验证：聊天加文件、通话加位置、短信加应用使用、数据库记录加文件元数据。
2. 对时间线进行排序，检查是否存在时间倒挂、时区偏移、重复记录、批量伪造特征。
3. 对关键文件记录文件路径、文件名、扩展名、大小、文件 MD5/SHA256、来源表和查询 SQL。
4. 对账号关系记录手机号、微信号、昵称、备注、群名、对方账号、联系人表命中情况。
5. 形成证据闭环：问题、查询表、字段值、时间转换、导出结果、复核依据、结论置信度。

### 8. 结果固定与输出
1. 输出证据清单：检材来源、文件路径、数据库表、字段值、时间戳、文件 MD5/SHA256、验证方式、关联账号、结论、置信度。
2. 输出时间线表：统一时间字段、原始时间、转换后时间、来源表、事件类型、账号、内容摘要。
3. 输出跨检材关联表：检材ID、证据类型、文件路径、哈希、时间戳、账号、密码或密钥复用、聊天内容、数据库记录、流量命中、结论。
4. 对竞赛答案或报告结论使用固定格式：答案值、来源文件、来源表、SQL、哈希、命令输出、时间转换方式、多源验证依据。
5. 如需攻击链路图，按入口、权限或账号、数据获取、暂存、外传、清理绘制，并标注每个节点证据。

### 9. 复核与归档
1. 抽查至少 10% 关键记录，重新执行 SQL 或更换过滤条件验证一致性。
2. 检查所有导出文件是否命名规范，是否包含生成时间、操作人或工具、案件编号。
3. 将 SQL、导出 CSV/JSON、证据清单、关联表、时间线、报告一并归档。
4. 对无法闭环的线索标注线索不足或待人工裁决，不得写成确定结论。

## 输入输出说明

### 输入说明
| 输入项 | 是否必需 | 说明 | 取证注意事项 |
|---|---|---|---|
| 案件上下文 | 必需 | 包括案件名称、caseId、检材编号、设备名称、案件路径 | 先确认案件与检材唯一对应，避免跨案件混查 |
| 材料标识 | 必需 | materialId、caseMaterialId | 多个手机或多次提取时必须逐个核对材料 ID |
| 数据库路径 | 必需 | dbPath，指向具体 `.mfs` 文件 | 只读访问；路径错误会返回 no such table 或空结果 |
| SQL 语句 | 必需 | 仅使用 SELECT 类查询，避免 DDL、DML、PRAGMA | 先计数、再取样、再全量导出 |
| 查询限制 | 建议 | maxRows、内容截断、分页偏移 | 防止群聊、大文件表、文件系统表返回过量数据 |
| 时间范围 | 按需 | 开始时间、结束时间、时区、时间字段类型 | 区分字符串时间、Unix 秒、无年份 WiFi 时间 |
| 关键词 | 按需 | 账号、手机号、昵称、文件名、内容关键词 | 全局搜索命中后必须回到来源表复核 |
| 外部证据 | 可选 | 流量包、日志、ICMP 载荷、镜像哈希、勘验笔录 | 用于与手机取证结果交叉验证，不作为孤立输入 |

### 输出说明
1. 查询结果输出：每次关键查询应输出来源库、表名、SQL、返回行数、最大行数、是否截断、执行时间。
2. 证据清单输出：包括检材来源、文件路径、数据库表、字段值、时间戳、文件 MD5/SHA256、验证方式、关联账号、结论、置信度。
3. 时间线表输出：统一时间字段、原始时间、转换后时间、来源表、事件类型、账号、内容摘要、备注。
4. 跨检材关联表输出：包括检材ID、证据类型、文件路径、哈希、时间戳、账号、密码或密钥复用、聊天内容、数据库记录、流量命中、结论。
5. 证据闭环输出：每个答案记录来源文件、命令输出、哈希值、挂载或解密结果、时间转换方式、多源验证依据，避免仅凭表面数据作答。
6. 答案格式输出：竞赛或报告建议固定为答案值、来源文件、来源表、SQL、哈希、命令输出、时间转换方式、复核人或工具、置信度。
7. 攻击链路图输出：适用于存在入侵、外传、隐蔽通信的案件，按入口、权限、数据获取、暂存、外传、清理节点标注证据。

### 输出质量要求
- 可复核：任何结论都能通过 SQL、dbPath、材料 ID、导出文件重新复现。
- 可关联：同一账号、文件、时间窗口应能在多个表或多个检材中互相印证。
- 可解释：时间转换、枚举字段、删除状态、媒体类型必须说明判断依据。
- 可提交：导出结果应命名规范，附证据清单和文件 MD5/SHA256，便于竞赛提交或实战报告复用。
- 保守结论：只有单源命中且无法复核时，应标注线索不足或待人工裁决。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
