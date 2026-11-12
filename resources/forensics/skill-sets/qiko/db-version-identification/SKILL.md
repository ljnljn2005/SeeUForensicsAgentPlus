---
name: db-version-identification
description: >
  数据库版本鉴别（生产库 vs 测试库）。当同一个 SQL 备份文件存在多个版本时， 需要区分哪个是生产环境数据库、哪个是测试环境数据库。触发词包括：
  "数据库版本"、"生产库"、"测试库"、"记录数不对"、"AUTO_INCREMENT"、
  "备份文件"、"多个版本"、"哪个是正确的"、"VMwareDnD"、"sql dump"。
agent_created: true
disable-model-invocation: true
---

# 数据库版本鉴别（生产库 vs 测试库）

## 目的

在电子取证中，同一个数据库备份文件（如 `xxx_full_backup.sql`）可能因 VMware 拖放缓存
或多次操作而存在多个副本。这些副本可能指向不同环境（生产/测试），记录数和数据完整性
差异巨大。本技能提供标准化的版本鉴别方法。

## 触发条件

- 发现多个同名 SQL 备份文件
- SQL 查询返回的记录数与预期不符
- 文件位于 VMwareDnD 等缓存目录
- AUTO_INCREMENT 值异常（为 1 或非常大）

## 工作流

### 步骤 1：发现所有同名文件

通过 MYOS 取证大师查询所有 SQL 备份文件：

```sql
-- 在 FSData.mfs 中搜索
SELECT id, filename, filesize, filepath, dataunit 
FROM TBL_FS_ENTRY_7B0CB1DF4A034192BD071507D833B347 
WHERE filename LIKE '%backup%' OR filename LIKE '%.sql'
ORDER BY filesize DESC
```

### 步骤 2：比较关键指标

| 指标 | 测试库特征 | 生产库特征 | 判断方法 |
|------|-----------|-----------|---------|
| 文件大小 | < 1MB | > 5MB | `filesize` 字段 |
| AUTO_INCREMENT | 接近 0 或 1 | 远大于 1（如 20242） | `grep "AUTO_INCREMENT"` |
| INSERT 行数 | 数十条 | 数千~数万条 | Python 统计 `('` 行数 |
| 创建/修改时间 | 较新 | 较早 | `last_write_time` |
| 目录路径 | 可能含 `test` / `dev` | 通常为数字ID命名 | 目录名特征 |

### 步骤 3：验证数据完整性

对候选文件执行完整性检查：

```python
import re

def count_records(sql_file_path, table_name):
    """统计 SQL dump 文件中指定表的 INSERT 记录数"""
    with open(sql_file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 查找所有 INSERT INTO `table_name` 语句块
    blocks = re.findall(rf"INSERT INTO `{table_name}`[^;]+;", content, re.DOTALL)
    
    total = 0
    for block in blocks:
        # 统计以 '(' 开头的数据行
        for line in block.split('\n'):
            if line.strip().startswith('('):
                total += 1
    
    return total, len(blocks)

# 同时提取 AUTO_INCREMENT
ai = re.search(r'AUTO_INCREMENT=(\d+)', content)
```

### 步骤 4：选择正确版本

**决策规则：**
1. 选文件最大的版本
2. 选 `AUTO_INCREMENT` 最大的版本
3. 选记录数最多的版本
4. 排除明显是新建/重置的测试库（`AUTO_INCREMENT=1`）

## 输出格式

```
数据库版本对比
├── 版本 A (36854bbe): 10.4MB, AUTO_INCREMENT=20242, 19857条 → ✅ 生产库
├── 版本 B (bf2ed335): 10.4MB, [需验证]
└── 版本 C (原分析): <1MB, AUTO_INCREMENT=1, 40条 → ❌ 测试库
```

## 错误处理

| 错误现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| 查到了40条但答案要求19857 | 分析的是测试库版本 | 用 filesize 排序找最大的版本 |
| 两个版本大小相近 | 可能为同一库不同时间的备份 | 比较 AUTO_INCREMENT 和最大 id 值 |
| 找不到大文件版本 | 文件在 VeraCrypt 容器内 | 先用 MYOS load_case 挂载镜像再搜索 |
| MySQL dump 格式不标准 | 使用了 `--extended-insert` 或非标准导出 | 检查 VALUES 子句格式后再统计 |

## 适用场景

本技能用于数据库取证中「同一业务数据存在多个备份副本」时的数据源裁决，核心目标是区分生产库与测试库、重置库、开发库、缓存拖放副本，并选出可作为后续分析基线的版本。

### 典型案件场景
- 取证镜像中发现多个同名或近名备份文件，例如 backup.sql、xxx_full_backup.sql、dump.sql、db.sql，且文件大小、哈希、修改时间不一致。
- 委托方或案情材料给出的记录数与检验结果明显不符，例如应统计 19857 条业务记录，但当前 SQL 只能统计到 40 条。
- 文件出现在 VMwareDnD、Temp、Downloads、Recycle Bin、共享目录、剪贴板拖拽缓存等非数据库常规备份目录，需要判断其是否为有效生产数据。
- 多个数据库文件同时存在，包含 MySQL/MariaDB 逻辑备份、PostgreSQL dump、SQLite 业务库、Redis RDB/AOF、SQLCipher 加密库或应用内嵌数据库。
- 需要通过 AUTO_INCREMENT、序列值、主键最大值、业务表行数、时间跨度、日志连续性等指标，判断哪个版本更接近生产环境。
- 需要为后续数据库与日志分析、时间线重建、聊天记录/业务记录统计提供正确的数据基线。

### 适用对象与前置条件
- 输入可以是磁盘镜像、E01/DD 镜像、挂载文件系统、MYOS/取证大师提取的文件系统表、单独导出的备份文件。
- 适用于逻辑备份、数据库文件、缓存副本、连接配置、数据库日志（如 binlog、WAL、AOF）之间的交叉判断。
- 若备份文件位于 VeraCrypt、BitLocker、LUKS、加密容器或压缩包中，应先完成解密、挂载或解包，再进入版本鉴别。
- 若数据库为在线运行状态，应先通过只读快照、文件系统冻结或合法导出方式固定数据，不应直接以本技能替代在线取证。

### 不适用或需谨慎的场景
- 仅有文件名、修改时间或目录名，缺乏内容指纹时，不应直接下结论，应标记为待人工裁决。
- 增量备份、日志备份、分卷备份不能单独作为完整生产库依据，需要结合全量备份和日志重建。
- 生产库本身可能因归档、软删除、分库分表、冷热数据分离而记录数较少，不能机械地以记录数最大作为唯一标准。
- 测试库可能导入过生产脱敏数据，文件大小和表结构接近生产库，需要结合环境配置、连接串、日志时间线进一步判断。

## 使用步骤

以下步骤作为既有「工作流」的补充 SOP。若与已批准的现场取证方案冲突，保留原方案并标记冲突点为待人工裁决；本技能不覆盖、不删除原始证据。

### 1. 只读固定与候选清单建立
1. 将镜像或目录以只读方式挂载，禁止直接写入原始证据。
2. 对每个候选数据库文件计算哈希并登记证据编号：
```bash
find /mnt/evidence -type f -name '*.sql' -exec stat -c '%Y %s %n' {} + | sort -k2 -nr
sha256sum /path/to/candidate > candidate.sha256
```
3. 建立候选表，至少包含：证据编号、文件路径、文件大小、修改时间、哈希、来源目录、初步类型。

### 2. 定位数据库连接配置与运行痕迹
1. 搜索应用配置，确认生产库连接目标与测试库连接目标：
```bash
grep -RInE 'DB_HOST|DB_NAME|DB_USER|DB_PASSWORD|DATABASE_URL|jdbc:|redis://|sqlcipher|sqlite' /mnt/evidence
```
2. 重点检查 .env、application.yml、wp-config.php、config.php、database.yml、appsettings.json、my.cnf、postgresql.conf、redis.conf。
3. 对 MySQL/PostgreSQL/Redis/SQLCipher，分别提取：
   - 数据库主机、端口、库名、用户名。
   - 备份脚本、定时任务、日志目录。
   - 密钥、口令、keyfile、token 的存在位置；SQLCipher 未解密前不得强行统计明文行数。

### 3. 识别备份类型与环境指纹
1. 使用 file、head、strings 判断文件类型：
```bash
file candidate.sql candidate.db candidate.rdb candidate.aof
head -n 50 candidate.sql
strings -n 8 candidate.rdb | head -n 80
```
2. 按类型提取指纹：
   - MySQL/MariaDB dump：检查 -- MySQL dump、CREATE TABLE、AUTO_INCREMENT、INSERT INTO。
   - PostgreSQL：plain SQL 检查 COPY，custom 格式使用 pg_restore -l 查看 TOC。
   - SQLite：检查 SQLite format 3 头、sqlite_master、sqlite_sequence、WAL/SHM。
   - Redis：RDB 检查 REDIS 魔数与 redis-ver，AOF 检查命令追加痕迹。
   - SQLCipher：通常为加密页，需先定位密钥或应用配置，再解密到只读副本。

### 4. 统计可比指标
对每个候选版本统计同一组指标，避免只比较文件大小：
```bash
grep -n 'AUTO_INCREMENT=' candidate.sql | head
grep -c 'INSERT INTO' candidate.sql
grep -c 'COPY ' candidate.sql
```
对 MySQL dump 使用脚本统计扩展插入中的值行数；对 SQLite 使用只读查询统计业务表行数与序列值：
```bash
sqlite3 candidate.db '.tables'
sqlite3 candidate.db 'SELECT * FROM sqlite_sequence;'
```
重点指标包括：
- 文件大小与哈希。
- 关键业务表记录数。
- AUTO_INCREMENT、序列值、最大主键 id。
- 最早/最新业务时间、日志时间跨度。
- 是否包含生产环境配置、真实用户数据、订单/支付/日志等高风险表。
- 是否存在 test、dev、demo、sample、localhost、127.0.0.1 等测试环境标识。

### 5. 用日志与增量文件交叉验证
1. 若存在 binlog，使用 mysqlbinlog 查看时间戳、server_id、GTID 和行事件密度：
```bash
mysqlbinlog --base64-output=decode-rows -vv binlog.000001 | head -n 200
```
2. 若存在 PostgreSQL WAL 或 Redis AOF，优先用于验证候选备份截止时间与写入连续性。
3. 将数据库记录与网站日志、wtmp 登录日志、应用日志、聊天记录数据库进行时间线比对；生产库通常能覆盖更完整的业务时间段。
4. 对记录数异常少的候选，检查是否仅包含初始化数据、测试账号、演示数据或最近重置后的空表。

### 6. 形成裁决规则
按以下优先级综合判断：
1. 证据完整性与可验证性：哈希一致、文件可解析、备份结构完整。
2. 业务数据规模：关键表记录数、主键最大值、序列值显著高于测试库。
3. 时间连续性：业务时间、日志时间、备份时间能形成连续生产时间线。
4. 环境指向：配置、路径、账号、主机名指向生产环境。
5. 文件体积：仅作辅助指标，不作为唯一依据。

出现以下情况时，应标记为待人工裁决：
- 两个候选文件大小、记录数、AUTO_INCREMENT 均接近。
- 候选文件可能来自同一生产库的不同时间点。
- 存在加密、压缩、分卷、损坏或 WAL 未合并。
- 记录数最大但业务字段明显为脱敏/测试数据。

### 7. 输出与复核
1. 输出候选版本对比表，标明推荐版本、理由、置信度和限制条件。
2. 保留所有统计命令、脚本、哈希记录和截图，确保结论可复现。
3. 复核时至少重新验证一次关键指标：文件大小、哈希、记录数、AUTO_INCREMENT/序列值、最新业务时间。

## D2-04

### 证据固定与结果复核

#### 证据固定要求
- 原始镜像、备份文件、配置文件、日志文件均应只读访问；任何解密、转换、统计都应在证据工作副本上进行。
- 每个候选版本必须记录证据编号、路径、文件大小、修改时间、SHA-256 哈希、提取工具和提取命令。
- 对 VMwareDnD、Temp、回收站等缓存目录中的文件，应额外记录来源目录和关联进程痕迹，防止将拖拽缓存误判为原始生产库。

#### 复核指标矩阵
| 复核项 | 方法 | 通过标准 |
|---|---|---|
| 文件同一性 | 比较路径、大小、哈希 | 哈希一致，或差异可解释 |
| 备份可解析性 | 按类型解析 SQL/dump/SQLite/RDB | 无致命结构错误 |
| 数据规模 | 统计关键表行数、最大主键、序列值 | 与生产业务规模匹配 |
| 时间线 | 对比业务时间、binlog/WAL/AOF、Web日志、wtmp | 能形成连续时间线 |
| 环境属性 | 检查配置、主机名、库名、账号、路径 | 指向生产而非测试 |
| 结论可复现 | 重跑统计命令 | 结果一致或差异可解释 |

#### 常见陷阱与规避
- 只看文件大小：压缩、TOC 格式、扩展插入、空行和注释都会影响体积，必须结合记录数和序列值。
- 只看记录数：测试库可能导入脱敏生产数据，生产库可能因归档、分表、软删除导致记录数不占优。
- 忽略 AUTO_INCREMENT 重置：测试库重置后可能为 1，生产库通常显著大于 1，但也可能被人工重置。
- 忽略扩展插入：一条 INSERT 可能包含多行 VALUES，直接按行统计会低估记录数。
- 忽略 WAL/SHM：SQLite 的 WAL 未合并时，主库文件可能不是最新状态。
- 忽略加密库：SQLCipher 或容器加密未解密时，不能以文件头不可读判定无效。
- 忽略同名不同哈希：同名文件可能来自不同设备、不同时间点或拖拽缓存，必须逐件哈希。

#### 冲突裁决与人工介入
出现下列情形时，不应自动给出唯一结论，应输出「待人工裁决」并保留所有候选：
- 两个以上候选均具备生产特征，且差异不足以区分时间点或环境。
- 关键表记录数与委托方预期不一致，但无法通过日志解释。
- 文件损坏、备份截断、密钥缺失、数据库页加密或日志缺失。
- 结论将直接影响案件关键事实认定。

#### 输出物
- 候选版本清单：路径、大小、哈希、来源、初步类型。
- 指标对比表：记录数、AUTO_INCREMENT/序列值、最大主键、时间范围、环境标识。
- 推荐版本及置信度：明确是生产库、测试库、重置库还是待人工裁决。
- 复核留痕：命令日志、脚本、截图、哈希清单和复核人记录。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
