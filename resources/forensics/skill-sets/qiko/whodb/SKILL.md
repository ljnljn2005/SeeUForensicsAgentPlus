---
name: whodb
description: "Database operations including querying, schema exploration, and data analysis. Activates for tasks involving PostgreSQL, MySQL, MariaDB, SQLite, MongoDB, Redis, Elasticsearch, or ClickHouse databases."
version: 1.0.0
author: Local
compatibility: [prompthub]
---
---
name: whodb
description: Database operations including querying, schema exploration, and data analysis. Activates for tasks involving PostgreSQL, MySQL, MariaDB, SQLite, MongoDB, Redis, Elasticsearch, or ClickHouse databases.
---

# WhoDB Database Assistant

You have access to WhoDB for database operations. Use these tools and commands to help users with database tasks.

## MCP Tools (Preferred)

When the WhoDB MCP server is available, use these tools directly:

### whodb_connections
List all available database connections.
```
No parameters required.
Returns: List of connection names with type and source (env/saved).
```

### whodb_query
Execute SQL queries against a database.
```
Parameters:
- connection: Connection name (optional if only one connection exists)
- query: SQL query to execute

Example: whodb_query(connection="mydb", query="SELECT * FROM users LIMIT 10")
```

### whodb_schemas
List all schemas in a database.
```
Parameters:
- connection: Connection name (optional if only one connection exists)

Example: whodb_schemas(connection="mydb")
```

### whodb_tables
List all tables in a schema.
```
Parameters:
- connection: Connection name (optional if only one connection exists)
- schema: Schema name (optional, uses default if not specified)

Example: whodb_tables(connection="mydb", schema="public")
```

### whodb_columns
Describe columns in a table.
```
Parameters:
- connection: Connection name (optional if only one connection exists)
- table: Table name (required)
- schema: Schema name (optional)

Example: whodb_columns(connection="mydb", table="users")
```

## CLI Commands (Fallback)

If MCP tools are unavailable, use the CLI directly via Bash:

### Query Execution
```bash
whodb-cli query "SELECT * FROM users LIMIT 10" --connection mydb --format json
```

### Schema Discovery
```bash
# List schemas
whodb-cli schemas --connection mydb --format json

# List tables
whodb-cli tables --connection mydb --schema public --format json

# Describe columns
whodb-cli columns --connection mydb --table users --format json
```

### Connection Management
```bash
# List connections
whodb-cli connections list --format json

# Test connection
whodb-cli connections test mydb

# Add new connection (interactive)
whodb-cli connections add --name mydb --type Postgres --host localhost --database mydb
```

### Data Export
```bash
# Export to CSV
whodb-cli export --connection mydb --table users --output users.csv

# Export query results
whodb-cli export --connection mydb --query "SELECT * FROM orders" --output orders.xlsx
```

## Workflow Examples

### Explore a New Database
1. List connections: `whodb_connections`
2. List schemas: `whodb_schemas(connection="name")`
3. List tables: `whodb_tables(connection="name", schema="public")`
4. Describe table: `whodb_columns(connection="name", table="users")`
5. Sample data: `whodb_query(connection="name", query="SELECT * FROM users LIMIT 5")`

### Answer Data Questions
1. Understand the schema first - check table structure
2. Write targeted queries with appropriate filters
3. Always use LIMIT for exploratory queries
4. Present results in a clear, readable format

## Best Practices

- **Always explore schema first** before writing queries
- **Use LIMIT** for exploratory queries to avoid overwhelming output
- **Prefer specific columns** over SELECT * for clarity
- **Check foreign keys** via whodb_columns to understand relationships
- **Use JSON format** (--format json) when parsing output programmatically
- **Never expose credentials** - use connection names, not connection strings

## 适用场景

### 典型取证任务
- 服务器入侵、删库、勒索加密后的数据库状态固定与残留数据恢复。
- 网站后台、订单、支付、会员、日志类业务数据库的关联分析、金额统计、时间线重建。
- SQLite 聊天记录、APP 本地库、浏览器缓存、Cookie、下载历史等结构化证据提取。
- Redis 缓存、会话、验证码、队列、排行榜、临时令牌的易失性数据固定。
- MySQL、PostgreSQL、MariaDB 的库表结构、账号权限、关键表抽样、删除痕迹、备份文件和 binlog、WAL 关联验证。
- SQLCipher、加密备份、数据库连接配置、密钥或口令提取后的解密与只读分析。
- 结合 wtmp、Web 访问日志、应用日志做登录时间、异常 IP、管理操作与数据库写入的交叉印证。

### 适用输入
- 已制作完成的磁盘镜像、分区镜像、逻辑提取目录、数据库文件、备份文件、日志文件。
- 通过合法授权获得的只读数据库连接、维护窗口连接、从镜像中恢复的连接配置。
- 结构化导出物：CSV、JSON、话单、账单、住宿、订票、订单、用户、设备、聊天记录等。

### 不适用或需谨慎
- 直接对生产在线库执行大规模扫描、导出或 DDL、UPDATE、DELETE、TRUNCATE、ALTER 操作。
- 未完成证据固定、未计算哈希、未只读挂载即直接分析原始检材。
- 仅有内存碎片且无密钥时，直接推断加密数据库明文内容。
- 需要司法鉴真但未保留提取过程、命令、工具版本和哈希链的场景。

### 专家判断
- 优先使用 WhoDB MCP 工具做结构化探索；当 MCP 不可用、需要脚本化复核或批量导出时，退回 whodb-cli。
- 对加密库、缓存、二进制备份，先完成密钥定位与格式识别，再接入查询，避免误把密文当空库。
- 所有统计结论必须能回放到具体 SQL、表名、字段、时间范围和连接名。


## 使用步骤

### 1. 证据固定与只读接入
1. 对镜像或数据库文件先计算哈希并记录。
```bash
sha256sum /evidence/case01/db.img > /evidence/case01/db.img.sha256
```
2. 使用只读方式挂载或复制。
```bash
mount -o ro,noatime /evidence/case01/db.img /mnt/ro
```
3. 若必须在线连接，使用只读账号，禁止 UPDATE、DELETE、DROP、TRUNCATE、ALTER。

### 2. 定位连接配置与密钥
```bash
find /mnt/ro/etc /mnt/ro/opt /mnt/ro/var/www -maxdepth 4 -type f -name '*.env' -print
find /mnt/ro/etc /mnt/ro/opt /mnt/ro/var/www -maxdepth 4 -type f -name 'application*.yml' -print
find /mnt/ro/etc /mnt/ro/opt /mnt/ro/var/www -maxdepth 4 -type f -name 'settings.py' -print
find /mnt/ro/etc /mnt/ro/opt /mnt/ro/var/www -maxdepth 4 -type f -name 'wp-config.php' -print
find /mnt/ro/etc /mnt/ro/opt /mnt/ro/var/www -maxdepth 4 -type f -name '.my.cnf' -print
find /mnt/ro/etc /mnt/ro/opt /mnt/ro/var/www -maxdepth 4 -type f -name 'pg_hba.conf' -print
find /mnt/ro/etc /mnt/ro/opt /mnt/ro/var/www -maxdepth 4 -type f -name 'redis.conf' -print
find /mnt/ro -maxdepth 6 -type f -name '*.sqlite' -print
find /mnt/ro -maxdepth 6 -type f -name '*.db' -print
grep -RInE 'DB_|DATABASE_|MYSQL_|POSTGRES_|REDIS_|SQLCIPHER|PASSWORD|PASSPHRASE|SECRET_KEY' /mnt/ro/etc /mnt/ro/var/www /mnt/ro/opt
```
对 SQLCipher、应用加密字段、备份口令，记录密钥来源文件、路径、哈希和提取命令。

### 3. WhoDB 连接识别
```bash
whodb-cli connections list --format json
whodb-cli connections test case_mysql
whodb-cli connections test case_pg
whodb-cli connections test case_sqlite
whodb-cli connections test case_redis
```
若 MCP 可用，优先使用 whodb_connections、whodb_schemas、whodb_tables、whodb_columns；需要批量复核和导出时使用 whodb-cli。

### 4. MySQL 与 MariaDB 取证命令链
```bash
whodb-cli schemas --connection case_mysql --format json
whodb-cli tables --connection case_mysql --schema appdb --format json
whodb-cli columns --connection case_mysql --table users --schema appdb --format json
whodb-cli query 'SELECT user, host FROM mysql.user' --connection case_mysql --format json
whodb-cli query 'SELECT table_schema, table_name, table_rows, create_time, update_time FROM information_schema.tables' --connection case_mysql --format json
whodb-cli query 'SELECT COUNT(*) AS user_count FROM appdb.users' --connection case_mysql --format json
whodb-cli query 'SELECT DATE(created_at) AS d, COUNT(*) AS n, SUM(amount) AS amt FROM appdb.orders GROUP BY DATE(created_at) ORDER BY d' --connection case_mysql --format json
```
binlog 检查：
```bash
ls -lh /mnt/ro/var/lib/mysql | grep binlog
mysqlbinlog --base64-output=DECODE-ROWS -v /mnt/ro/var/lib/mysql/binlog.000001 | less
```
若 binlog 与库内时间不一致，记录时区、server_id、事件时间和事务边界，避免把 UTC 事件时间误判为本地业务时间。

### 5. PostgreSQL 取证命令链
```bash
whodb-cli schemas --connection case_pg --format json
whodb-cli tables --connection case_pg --schema public --format json
whodb-cli columns --connection case_pg --table orders --schema public --format json
whodb-cli query 'SELECT rolname, rolsuper, rolcanlogin FROM pg_roles' --connection case_pg --format json
whodb-cli query 'SELECT schemaname, tablename, tableowner FROM pg_tables' --connection case_pg --format json
whodb-cli query 'SELECT COUNT(*) AS n, created_at::date AS d FROM app.orders GROUP BY created_at::date ORDER BY d' --connection case_pg --format json
```
WAL 与备份：
```bash
ls -lh /mnt/ro/var/lib/postgresql/*/pg_wal
pg_waldump /mnt/ro/var/lib/postgresql/*/pg_wal/000000010000000000000001 | head
```

### 6. SQLite、SQLCipher 与聊天记录库
```bash
whodb-cli query 'SELECT name FROM sqlite_master' --connection case_sqlite --format json
whodb-cli query 'PRAGMA integrity_check' --connection case_sqlite --format json
whodb-cli query 'PRAGMA journal_mode' --connection case_sqlite --format json
whodb-cli query 'SELECT COUNT(*) FROM message' --connection case_sqlite --format json
whodb-cli query 'SELECT create_time, sender, content FROM message ORDER BY create_time LIMIT 200' --connection case_sqlite --format json
```
SQLCipher 处理：
- 先在应用配置、Keystore、内存镜像、Keychain、SharedPreferences 中定位 key。
- 使用只读副本解密导出，不在原始加密文件上执行写操作。
- 解密后重新计算哈希，并记录 cipher 版本、page size、KDF 参数。
- 若当前 WhoDB 连接不支持 SQLCipher 参数，先离线解密为只读 SQLite 再接入，并将该转换方案标记为待人工裁决。

### 7. Redis 与缓存取证
```bash
whodb-cli query 'INFO keyspace' --connection case_redis --format json
whodb-cli query 'SCAN 0 MATCH session:* COUNT 1000' --connection case_redis --format json
whodb-cli query 'TYPE session:admin' --connection case_redis --format json
whodb-cli query 'TTL session:admin' --connection case_redis --format json
```
RDB 与 AOF：
```bash
ls -lh /mnt/ro/var/lib/redis/dump.rdb /mnt/ro/var/lib/redis/appendonlydir
```
缓存证据要记录 TTL、过期策略、持久化方式，避免把已过期但未淘汰的键误判为案发时有效数据。

### 8. 日志与数据库交叉时间线
```bash
last -f /mnt/ro/var/log/wtmp | head
grep -E 'POST|login|admin|delete|update' /mnt/ro/var/log/nginx/access.log | head
whodb-cli query 'SELECT id, admin_id, action, ip, created_at FROM audit_log ORDER BY created_at DESC LIMIT 200' --connection case_mysql --format json
```
将 wtmp 登录、Web 请求、数据库审计表、订单或消息时间戳统一到 UTC 与本地时区双格式。对网站数据库、聊天记录数据库和缓存数据，优先筛选异常字段、非常用 IP、深夜操作、批量删除和高频导出行为。

### 9. 统计、导出与复核
```bash
whodb-cli export --connection case_mysql --table orders --output orders.csv
whodb-cli export --connection case_pg --table users --output users.csv
whodb-cli export --connection case_sqlite --table message --output message.csv
```
每类结果至少复核：
- SQL 是否可重复执行。
- 时间字段是否为时区敏感字段。
- 金额字段单位是否为分、元、USDT、积分。
- 是否存在软删除字段，如 deleted、is_del、status。
- 是否存在视图、分区表、归档表导致漏统计。
- 是否因连接错库、同义词、schema 默认值导致统计到错误数据库。


## 输入输出说明

### 输入
- 数据库文件：SQLite、SQLCipher、MySQL 表空间、PostgreSQL 数据目录、Redis RDB、AOF、备份文件。
- 连接信息：连接名、类型、主机、端口、库名、只读账号、密钥路径；报告中不得出现明文口令。
- 结构化数据：CSV、JSON、PDF 账单、话单、住宿、订票、订单、用户、设备、聊天记录等。
- 辅助证据：wtmp、auth.log、Web access、error、应用日志、binlog、WAL、审计表。

### 输出
- 查询依据：连接名、数据库版本、库名、表名、字段、SQL 或命令、执行时间、工具版本。
- 结构信息：库表结构、主外键、索引、关键表、分区、视图、触发器。
- 统计结果：用户数、订单数、管理员账号、金额合计、笔数、时间范围、去重账户、关联账户。
- 取证结果：哈希值、只读挂载说明、密钥来源、解密方式、导出文件哈希、证据链编号。
- 题目要求格式：如题目要求输出金额、时间、账号、订单号、手机号、身份证号，按题目字段名输出。

### 字段规范
- 时间：同时记录原始值、时区、UTC 转换值；对 Unix 秒、Unix 毫秒、数据库本地时间分别说明。
- 金额：明确单位，分转元需保留公式；加密货币记录币种和链上地址。
- 账户：区分注册用户、实名用户、管理员、测试账号、封禁账号。
- 状态：识别软删除、审核中、退款、作废、冻结，不得直接把物理行数作为最终业务数。
- 哈希：对原始文件、解密文件、导出文件分别计算 SHA256。

### 输出示例
```text
数据库版本：MySQL 8.0.36
连接名：case_mysql
关键表：appdb.users, appdb.orders, appdb.audit_log
用户数：18342
订单数：52119
金额合计：398215.50 元
时间范围：2026-01-01T00:00:00Z 至 2026-01-31T23:59:59Z
管理员账号：admin_ops、root_backup
SQL依据：SELECT COUNT(*) FROM appdb.users; SELECT SUM(amount) FROM appdb.orders WHERE status=1;
```

### 复核要求
- 每个统计数字至少由两条独立查询或备份、binlog、WAL 佐证。
- 对 NULL、0、负数、重复订单、测试账户建立排除规则。
- 输出必须包含未命中项，如未发现管理员账号、未发现加密密钥、未发现指定时间段数据。
- 若数据被截断、损坏、解密失败，明确说明影响范围，不得推断为不存在。
- 导出文件应命名包含案件号、连接名、表名、导出时间和哈希前缀。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
