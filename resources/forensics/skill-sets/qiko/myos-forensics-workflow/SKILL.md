---
name: myos-forensics-workflow
description: >
  MYOS取证大师综合工作流。当用户使用 MYOS 取证大师 MCP 服务进行电子数据取证分析时使用，
  涵盖镜像挂载、文件系统浏览、SQLite数据库查询、文件提取、加密容器处理等全流程操作。
  触发词包括："MYOS"、"取证大师"、"myos-forensics"、"检材分析"、"镜像挂载"、
  "FSData.mfs"、"load_case"、"sqlite_query"、"quick_search"、"取证"。
agent_created: true
disable-model-invocation: false
---

# MYOS 取证大师综合工作流

## 目的

提供 MYOS 取证大师 MCP 服务的标准化操作流程，涵盖从案件加载到数据提取的全链路。
解决常见的沙箱限制、节点ID精度丢失、跨设备数据关联等问题。

## 前置条件

- MYOS 取证大师 MCP 服务已连接（`mcp__myos-forensics-mcp`）
- 案件已创建且检材已导入（SIM卡、手机备份、E01镜像、磁盘镜像等）

## 核心工具速查

| 工具名 | 用途 | 关键参数 |
|--------|------|---------|
| `query_cases` | 列出所有案件 | 无 |
| `open_case` / `load_case` | 加载案件到内存/挂载文件系统 | caseId, materialId |
| `query_materials` | 查看案件检材列表 | caseId |
| `query_device_info` | 获取设备信息和挂载路径(dokan_path) | dbPath, materialId |
| `sqlite_query` | 查询取证数据库(FSData.mfs等) | dbPath, sql, maxRows |
| `quick_search_files` | 关键词搜索文件 | deviceGuid, keyword |
| `quick_search_content` | 全文搜索文件内容 | deviceGuid, keyword |
| `query_computer_forensics_results_overview` | 查看电脑取证结果概览 | caseId |
| `query_phone_forensics_results_overview` | 查看手机取证结果概览 | caseId |

## 工作流

### 阶段 1：加载案件

```
1. query_cases → 获取 caseId（如 "6348063f-2934-46b3-92b1-78f55c2f4a90"）
2. query_materials(caseId) → 获取 materialId 列表
3. open_case(caseId) 或 load_case(caseId, materialId) → 加载检材
```

**load_case** 会将 E01 镜像挂载到本地文件系统，挂载路径格式：
`\\?\C:\osmap\{deviceGuid}_{timestamp}\Root\`

挂载后可直接用 Read/Bash 工具访问文件，**无需解密加密容器**。

### 阶段 2：浏览文件系统

```
方法A - 直接访问挂载路径:
  Read "C:\osmap\{deviceGuid}_{timestamp}\Root\Partition2[C]\Users\..."

方法B - SQL查询FSData.mfs:
  sqlite_query(dbPath="D:/MYOS/Case/{案件路径}/dev/computer.E01/data/FSData.mfs",
               sql="SELECT * FROM TBL_FS_ENTRY_{deviceGuid} WHERE filename LIKE '%关键词%'")

方法C - 快速搜索:
  quick_search_files(deviceGuid="{guid}", keyword="文件名关键词", searchMode="filename")
  quick_search_content(deviceGuid="{guid}", keyword="文件内容关键词")
```

### 阶段 3：查询特定数据

**手机检材常用查询：**

| 数据类型 | 数据库/文件 | 关键表 |
|---------|------------|--------|
| 联系人 | contacts2.db | raw_contacts, data |
| 通话记录 | contacts2.db | calls |
| 短信 | mmssms.db | sms |
| 微信 | EnMicroMsg.db | message, rcontact |
| QQ | QQ数据库 | 各表名不定 |
| 浏览器历史 | browser2.db | urls, visits |
| VoceChat | chat_msg表 | 自发送消息 |
| v2rayNG | mmkv/SUB | 订阅配置 |
| Amarok | SharedPreferences XML | 隐藏应用 |

**电脑检材常用查询：**

| 数据类型 | 路径模式 | 关键内容 |
|---------|---------|---------|
| 用户信息 | SAM注册表、`C:\Users\` | 用户名、SID |
| 浏览器历史 | `*\Edge\User Data\Default\History` | urls表 |
| 近期文件 | `*\Recent\` | .lnk快捷方式 |
| 命令行历史 | `ConsoleHost_history.txt` | PowerShell命令 |
| hosts文件 | `System32\drivers\etc\hosts` | DNS映射 |
| 压缩文件 | 搜索结果 | 7z/ZIP/RAR |
| 加密容器 | 搜索 `.hc` / `.tc` | VeraCrypt/TrueCrypt |

### 阶段 4：加密容器处理

当遇到加密容器（VeraCrypt .hc / TrueCrypt .tc）时：

```
优先级1: 通过 MYOS load_case 直接访问镜像文件系统 → 绕过容器
优先级2: 在 VMwareDnD 缓存目录搜索未加密的备份
优先级3: Python 头部解析验证密码正确性（不挂载）
优先级4: 在沙箱外手动挂载（最后手段）

注意：沙箱环境通常会阻止 .exe 的驱动加载权限
```

### 阶段 5：跨设备数据关联

当一条线索分散在手机和电脑两个检材中时：

```
示例：VeraCrypt 容器密码溯源
  1. 电脑检材 → 发现 工作资料.hc 加密容器
  2. 手机检材 → VoceChat chat_msg 表 → 搜索"容器密码" → 找到密码
  3. 验证：Python 解密 .hc 头部，确认 VERA 魔数
```

## 常见问题与解决

### 节点 ID 精度丢失

问题：SQL 返回的 id 如 `1514595575817896000`，在 JavaScript/Python 浮点数中精度丢失。

解决：
```python
# 转为十六进制传递
hex_id = hex(int(node_id))  # 如 "0x1504eca6cb010040"
# 或在 SQL 中直接用 CAST 转换
```

### 沙箱阻止 exe 执行

问题：`VeraCrypt-x64.exe /v ... /l X /p ...` 被 SysWOW64/wsplog 拦截。

解决：
- 优先使用 MYOS load_case 挂载镜像，直接读文件
- 在 VMwareDnD 目录下查找未加密的数据副本
- 如必须执行 exe，考虑用 `dangerouslyDisableSandbox=true`（需用户确认）

### SQL 查询超时

问题：FSData.mfs 文件较大（数GB），复杂查询可能超时。

解决：
```sql
-- 添加 LIMIT 限制
SELECT ... LIMIT 100

-- 使用精确的 WHERE 条件而非全表扫描
WHERE filename = 'xinsheng_full_backup.sql'  -- 好
WHERE filename LIKE '%backup%'  -- 可能较慢

-- 对大表先查看结构
PRAGMA table_info(TBL_FS_ENTRY_{deviceGuid})
```

## 专项取证场景速查

### 场景 A：邮件取证

| 目标 | 数据库 | 关键表 |
|------|--------|--------|
| 网易邮箱大师 | `Any_MailMaster.mfs` | `TBL_AF_MAIL_MAILMASTER_ACCOUNT`（账号）、`TBL_AF_MAIL_MAILMASTER_DETAIL`（邮件详情） |
| Outlook Express | `Win_OutlookExpress.mfs` | 各表 |
| Win10 邮件 | `Win_Win10Mail.mfs` | 各表 |

> 邮件原始数据在 `MailMasterData/{邮箱}/mail.db`（SQLite），邮件内容可能以 zlib 压缩存储。SMTP 协议会在 EHLO 阶段泄露本机主机名（DESKTOP-xxx），可通过 `Received:` 头或系统信息交叉验证。

### 场景 B：加密通讯取证

| 工具 | 数据路径 | 取证方法 |
|------|---------|---------|
| **Signal** | `AppData\Roaming\Signal\sql\db.sqlite` | `Win_SignalV7.mfs` → `TBL_AF_SIGNAL_IM_ACCOUNT`、`TBL_AF_SIGNAL_IM_FRIEND`、`TBL_AF_SIGNAL_IM_CHATMESSAGE` |
| **Tox (qTox)** | `AppData\Roaming\tox\MW.db` | `aliases`（联系人别名）、`chats`（聊天 UUID=公钥）、`text_messages`（消息内容）、`history`（时间戳） |
| **Telegram** | `Any_Telegram.mfs` | 各表 |

> **Tox ID 完整提取**：`chats.uuid` 仅为 32 字节公钥，完整 Tox ID（38 字节）需从 `MW.tox` 偏移 4130-4167 处提取，其中 NOSPAM（偏移 4162-4165）和 Checksum（偏移 4166-4167）默认为零，需通过 qTox 客户端界面获取真实值后修补。

### 场景 C：AI 客户端取证

| 目标 | 数据路径 | 取证方法 |
|------|---------|---------|
| 豆包浏览器 | `AppData\Local\Doubao\User Data\Default\` | IndexedDB: `chrome_doubao-chat_0.indexeddb.leveldb\*.log` |
| 浏览器 AI 访问 | Chrome/Edge History | 搜索 `doubao.com`、`chatgpt.com`、`gemini.google.com` 等 |

> 豆包浏览器对话数据存储在 IndexedDB（LevelDB）中，会话名称以 **UTF-16LE** 编码。解析方法：在 `000007.log` 中搜索 `conversation_id` 和 `namec` 字段，提取 `namec` 后的长度字节 + 名称字节，解码为 UTF-16LE。

### 场景 D：暗网/匿名工具取证

| 工具 | 数据路径 | 首次运行时间来源 |
|------|---------|----------------|
| Tor Browser | `Desktop\Tor Browser\Browser\TorBrowser\Data\Browser\profile.default\` | `times.json` → `firstUse`（毫秒时间戳） |
| Tor Browser 书签 | `places.sqlite` | 默认 `.onion` 书签创建时间 |

> `firstUse` 由 Firefox 内核在首次启动时写入，比 `created` 晚约 8 秒。可交叉验证 `compatibility.ini` 的 `LastPlatformAVersion` 和默认书签时间。

### 场景 E：隐藏文件发现

| 方法 | 命令/工具 |
|------|----------|
| 全盘文件头扫描 | `find` 遍历 + 检查 `MZ`/`\xFF\xD8`/`\x89PNG` 等魔数 |
| 系统保留目录 | 检查 `System Volume Information`、`$Recycle.Bin` 等 |
| 回收站取证 | 解析 `$I` 文件（8 字节版本 + 8 字节大小 + 8 字节 FILETIME + 4 字节路径长度 + Unicode 路径） |
| 文件伪装检测 | 检查扩展名与实际文件头是否一致（如 `.dat` 实际是 PNG） |

### 场景 F：加密程序逆向

| 步骤 | 方法 |
|------|------|
| 1. 识别格式 | WinHex 查看文件头魔数 |
| 2. 判断程序类型 | IDA 加载 → 检查是否为 .NET（`singlefilehost`） |
| 3. 提取 DLL | 从 Bundle 中提取托管 DLL |
| 4. 反编译 | dnSpy 反编译 C#（无混淆时等同于源码） |
| 5. 黑盒推导 | 构造全零文件 → 加密 → 对比密文位置 i 推导密钥周期 |

> **Z-Packer 加密算法**：`cipher[i] = ((plain[i] ^ key[i % 4]) + i) & 0xFF`，密钥 `[0x13, 0x37, 0xC0, 0xDE]`，周期 4。解密：`plain[i] = ((cipher[i] - i) & 0xFF) ^ key[i % 4]`。文件名和文件内容各自独立计数（i 从 0 开始）。

### 场景 G：EXIF 与 OCR 取证

| 目标 | 方法 |
|------|------|
| EXIF 提取 | Python PIL `Image.open().getexif()` |
| OCR 文字提取 | Tesseract.js（中英文 `chi_sim+eng`），对截图可用 `--psm 6` |
| 交易哈希 OCR | 使用 `tessedit_char_whitelist: '0123456789abcdefABCDEF'` 限制字符集 |

### 场景 H：跨设备关联分析

| 场景 | 关联方法 |
|------|---------|
| PC ↔ USB | 同一文件名、同一 EXIF 相机型号、时间线对比 |
| 聊天记录 ↔ 文件 | Tox/Signal 消息中的文件名 → 文件系统搜索 |
| 邮件 ↔ 简历 | 邮箱大师 `mail.db` 附件 → 简历文件交叉验证 |

## 输出规范

每次取证分析完成后，汇总输出应包含：
1. 数据来源（工具名 + 参数）
2. 查询 SQL（可复现）
3. 原始结果截取
4. 结论与答案
5. 交叉验证方法

## 适用场景

本技能适用于基于 MYOS 取证大师 MCP 的离线电子数据取证分析，前提是检材已完成导入、案件可加载，并且分析目标为只读恢复与关联解释。典型场景包括：

- **镜像与文件系统取证**：对 E01、DD、分区镜像或手机备份进行挂载浏览，定位文档、图片、压缩包、数据库、日志与系统痕迹。
- **SQLite 与应用数据取证**：查询联系人、短信、通话记录、浏览器历史、即时通讯、邮件客户端、AI 客户端等应用残留数据。
- **跨设备关联分析**：将手机聊天记录、邮件附件、浏览器下载、电脑文件系统、注册表痕迹、快捷方式、回收站与加密容器线索进行时间线和实体关联。
- **加密容器与隐藏内容处置**：识别 VeraCrypt/TrueCrypt 容器、隐藏文件、伪装扩展名、回收站残留与加密程序产物，并优先采用非挂载或低侵入方式验证线索。
- **隐蔽信道初筛**：当案件涉及可疑外传、网络流量包、抓包文件或镜像内网络日志时，可对 ICMP Echo Request/Reply 载荷进行提取、重组与规则拼接，判断是否存在利用 ICMP 载荷夹带数据的行为。

以下情形不建议直接依赖本技能单独完成结论：原始检材未完成哈希固定、需要在线采集、需要绕过未知强加密且无合法授权、需要驱动级挂载但沙箱权限不足，或需要出具司法鉴定意见。此类情形应转为人工复核或线下取证流程，并在报告中记录限制条件。


## 使用步骤

本节给出从案件加载到结果固定的标准操作顺序。与原文档工作流互补；如与案件 SOP 或现场要求冲突，应优先遵循案件要求并标记待人工裁决。

### 1. 检材确认与案件加载

1. 使用 `query_cases` 获取案件列表，记录 `caseId`、案件名称与创建时间。
2. 使用 `query_materials` 获取检材列表，确认手机、电脑、镜像、备份等 `materialId` 与检材类型。
3. 使用 `open_case` 或 `load_case` 加载目标检材。对 E01/DD 镜像，优先使用 `load_case` 完成文件系统挂载。
4. 使用 `query_device_info` 获取 `deviceGuid`、数据库路径与挂载路径。后续 SQL 查询、全文搜索和文件定位均应使用该设备标识，避免跨设备误查。

### 2. 文件系统定位与只读浏览

1. 优先通过挂载路径进行只读浏览，避免对检材路径执行写入、删除或重命名。
2. 对已知文件名、扩展名或路径特征，使用 `quick_search_files` 进行文件名搜索。
3. 对内容关键词，使用 `quick_search_content`；若命中过多，应缩小关键词长度、增加路径限制或改用 SQL 条件。
4. 对大规模文件系统镜像，使用 `sqlite_query` 查询 `FSData.mfs` 中的文件索引表。查询时先使用 `PRAGMA table_info` 确认字段，再添加 `LIMIT` 与精确 `WHERE`。

### 3. SQLite 与应用程序数据提取

1. 先确认目标数据库路径与表结构，再执行查询。对手机检材，重点关注联系人、短信、通话记录、微信、QQ、浏览器历史等数据库；对电脑检材，重点关注浏览器历史、注册表、最近文件、命令行历史、hosts、邮件与即时通讯数据库。
2. 对存在 `WAL`、`SHM` 的 SQLite 数据库，应关注未合并日志。若查询结果缺失，应确认是否需要合并 WAL 或使用取证工具解析日志页。
3. 对 LevelDB、IndexedDB、MMKV、XML 配置等非标准 SQLite 数据，不能仅依赖 SQL 查询，应结合文件提取、十六进制特征搜索与编码转换。
4. 对长整型节点 ID、文件 ID 或消息 ID，应避免浮点精度丢失。可在 SQL 中转换为十六进制或字符串，再在报告中保留原始值。

### 4. 加密容器与隐藏文件处置

1. 先搜索 `.hc`、`.tc`、`.vc`、加密容器备份、密码文本、聊天记录中的口令线索。
2. 优先通过 MYOS 挂载镜像后直接读取容器外部文件系统，寻找未加密副本、缓存文件或导出痕迹。
3. 不直接在沙箱内强行加载驱动或执行挂载程序。若必须验证口令，优先使用头部解析、魔数校验或离线校验方式。
4. 对隐藏文件，检查回收站、系统卷信息、快捷方式、文件头魔数、扩展名伪装和文件大小异常。

### 5. ICMP 隐蔽信道载荷提取流程

当怀疑存在通过 ICMP 外传数据时，按以下流程处理：

1. 在镜像或案件文件中定位抓包与网络证据，包括 `pcap`、`pcapng`、`cap`、流量日志、IDS 告警、代理日志或应用缓存。
2. 筛选 ICMP Echo Request 与 Echo Reply，即常见 type 8 与 type 0 报文。优先保留同一源目 IP、同一 Identifier、连续 Sequence 的报文组。
3. 导出 ICMP payload，不要仅记录包头。若存在分片，应先完成分片重组，再提取载荷，避免按单包误读。
4. 按时间、Sequence、Identifier 或会话键排序。对乱序报文，先重排再拼接，防止载荷错位。
5. 按可疑规则拼接载荷：可尝试每包取首字符、取固定偏移区间、按分隔符拼接、按 Base64/Hex 解码，或按已知自定义协议还原字符串。
6. 验证是否为外传数据：检查拼接结果是否出现可读文本、文件魔数、账号、密钥、压缩包内容、数据库片段，或与案件中已知文件、聊天记录、邮件附件形成内容对应。
7. 与正常 ping 基线对比：正常系统 ping 载荷通常为固定填充，若出现高熵、规律变化、固定长度、异常频率或与文件修改时间高度吻合，应记录为可疑隐蔽信道线索。
8. 将提取脚本、筛选条件、原始包路径、载荷样本和重组结果一并固定，确保可复现。

### 6. 跨设备关联与时间线构建

1. 以文件哈希、文件名、文件大小、主机名、账号、SID、邮箱、设备型号、EXIF、聊天记录关键词作为关联键。
2. 对手机与电脑时间戳，先统一时区与时间格式，再构建时间线。记录原始时区、转换规则和工具版本。
3. 对加密容器密码溯源，优先从聊天记录、邮件、备忘录、剪贴板、浏览器表单、命令行历史与文件中查找候选口令，再进行头部验证。

### 7. 结果固定与输出

1. 记录每个结论对应的工具名、参数、SQL、文件路径、哈希值与截图。
2. 对关键证据导出副本，计算导出文件哈希，避免直接引用临时路径。
3. 输出结论时区分事实、推断与待人工裁决事项，不将单点命中直接写成最终认定。


## 常见失败与处置

### 1. 案件加载与挂载失败

| 失败现象 | 可能原因 | 处置建议 |
|---|---|---|
| `query_cases` 无结果 | MCP 服务未连接、案件未创建或权限不足 | 检查服务连接、案件目录与账号权限，必要时重新导入案件 |
| `load_case` 失败 | 镜像损坏、分片缺失、路径含特殊字符、挂载组件异常 | 核对检材哈希与文件数量，重新导入或更换挂载方式；不要直接修改原始镜像 |
| 挂载路径不可读 | `deviceGuid` 错误、挂载未就绪、沙箱限制 | 使用 `query_device_info` 重新获取路径，等待挂载完成；若仍失败，转人工复核 |

### 2. 文件系统与搜索失败

| 失败现象 | 可能原因 | 处置建议 |
|---|---|---|
| 文件名搜索无结果 | 关键词过短、编码差异、文件已被删除或索引未覆盖 | 改用短词、扩展名、魔数、路径片段或文件头扫描；同时检查回收站与系统还原点 |
| 全文搜索命中异常少 | 内容压缩、加密、UTF-16LE 编码、LevelDB 或日志格式 | 先导出目标文件，再按编码或格式解析；对 LevelDB、IndexedDB 使用专用解析方法 |
| 搜索命中过多 | 关键词泛化、系统缓存干扰 | 增加路径、扩展名、时间范围或文件大小过滤；优先查看用户目录、下载目录、临时目录 |

### 3. SQLite 查询失败

| 失败现象 | 可能原因 | 处置建议 |
|---|---|---|
| 查询超时 | 数据库过大、全表扫描、复杂 LIKE | 添加 `LIMIT`，使用精确字段条件，先查表结构，再分批查询 |
| 查询结果为空 | 表名带设备标识、数据在 WAL、字段名不一致 | 使用 `PRAGMA table_info` 和表清单确认结构；关注 `WAL`、`SHM` 与附加表 |
| ID 值异常或无法回查 | 长整型被浮点化导致精度丢失 | 在 SQL 中转为字符串或十六进制，报告中保留原始 ID |

### 4. 加密容器与沙箱限制

| 失败现象 | 可能原因 | 处置建议 |
|---|---|---|
| 无法挂载 `.hc`、`.tc` 容器 | 沙箱拦截驱动、缺少密码、容器损坏 | 优先查找未加密副本、缓存、聊天记录或邮件中的密码线索；用头部魔数和密码验证替代驱动挂载 |
| 执行挂载程序被拦截 | 安全策略限制可执行文件 | 不强行绕过；如确有必要，说明风险并取得确认后转线下环境，标记待人工裁决 |
| 密码验证成功但内容仍不可读 | 容器头部损坏、隐藏卷、密钥派生参数异常 | 检查容器大小、备份文件、隐藏卷可能性；不要反复写入容器文件 |

### 5. ICMP 隐蔽信道分析失败与误判

| 失败现象 | 可能原因 | 处置建议 |
|---|---|---|
| 无法筛选 ICMP 报文 | 抓包文件损坏、文件被压缩、日志不含原始包 | 先解压并校验文件；若只有摘要日志，降低结论强度，标记为线索而非认定 |
| payload 拼接结果乱码 | 分片未重组、报文乱序、偏移规则错误 | 先按 IP、Identifier、Sequence 和时间排序，完成分片重组后再拼接 |
| 误判正常 ping 为隐蔽信道 | 正常探测工具也会发送固定载荷 | 建立基线：比较包长、频率、TTL、Identifier、载荷熵值与业务时段；只有可还原出案件相关内容时才提升置信度 |
| 外传内容无法确认 | 载荷加密、编码未知或仅传输片段 | 尝试常见编码与首字符规则；同时关联文件缺失时间、聊天记录、邮件附件和进程痕迹 |

### 6. 时间线与跨设备关联失败

| 失败现象 | 可能原因 | 处置建议 |
|---|---|---|
| 时间线矛盾 | 时区不一致、手机与电脑时钟偏移、Unix 毫秒误读 | 统一转换到案件约定时区，记录原始值和转换规则；对关键时间进行多源交叉验证 |
| 同名文件误关联 | 文件名常见、哈希缺失 | 必须结合文件大小、哈希、路径、创建时间、EXIF 或聊天上下文判断 |
| 账号或主机名误判 | 多设备共用账号、系统默认名相似 | 结合 SID、设备型号、IP、MAC、登录日志、应用账号令牌进行复合认定 |

### 7. 证据完整性与输出风险

| 失败现象 | 可能原因 | 处置建议 |
|---|---|---|
| 分析过程不可复现 | 未记录工具参数、SQL 或文件路径 | 每次查询后记录工具名、参数、SQL、返回摘要和证据路径 |
| 导出文件被质疑污染 | 导出目录不独立、未计算哈希 | 导出到独立证据目录，计算哈希并记录导出时间、工具与操作人 |
| 结论过度 | 单点证据未交叉验证 | 使用至少两类独立证据支撑关键结论；不足时写明限制条件并标记待人工裁决 |

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
