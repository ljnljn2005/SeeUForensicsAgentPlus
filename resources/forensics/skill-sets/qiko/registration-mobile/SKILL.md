---
name: registration-mobile
description: 注册手机号与验证码分析 Skill。当题目涉及注册流程、手机号、验证码、短信验证或嫌疑人姓名时使用。
license: MIT
metadata:
  author: wiremcp
  version: "1.2"
---

# 注册手机号与验证码分析

## 适用场景

当题目中出现以下关键词时，Agent 应使用此 Skill：
- 手机号 / 手机号码 / mobile / phone
- 注册 / register / signup
- 验证码 / verify code / verification code / SMS
- 嫌疑人姓名（中文姓名）
- 贷款 / loan / approved_amount / 审批金额

---

## 1. 核心流程

### Step 1：搜索嫌疑人姓名 — 强制三步编码变体搜索

中文姓名在 HTTP 流量中可能以多种编码形式出现。Agent **MUST** 使用以下三种编码变体同时搜索，**不得遗漏任何一种**：

**方法 A：search_pcap_text 统一搜索（首选，一次覆盖三种编码）**
- 使用 `search_pcap_text` 搜索原始中文姓名（如 `秦贵天`）
- **必须**设置 `searchUnicodeVariants=true` — 自动生成并搜索以下三种编码变体：
  1. UTF-8 十六进制字节（`frame contains`）
  2. URL 编码（`http contains "%E7%A7%A6..."`）
  3. **Unicode 转义**（`http.file_data contains` 搜索 `\uXXXX` 的 hex 字节）
- 设置 `traceStreams=true` 获取所有命中的 tcp.stream 列表

**方法 B：手动 Unicode 转义搜索（备用）**
- 如果 `search_pcap_text` 未命中但怀疑 JSON 编码，手动搜索：
  - `run_display_filter` 使用 `http.file_data contains "5c:75:37:39:65:36:5c:75:38:64:33:35:5c:75:35:39:32:39"`
  - 这是 `秦贵天`（秦贵天）的 UTF-8 十六进制字节序列

**方法 C：注册 URI 组合筛选**
- 搜索 `register`、`signup`、`reg` 等注册关键词
- 使用 `http.request.uri contains "register" || http.request.uri contains "signup" || http.request.uri contains "reg"`
- 在结果中再筛选包含嫌疑人姓名或手机号的流量

**关键原则**：**MUST** 使用 `search_pcap_text` + `searchUnicodeVariants=true` 作为首选方法，它一次搜索覆盖全部三种编码。在 HTTPS 解密场景中，JSON 请求体中的中文姓名几乎总是以 `\uXXXX` 形式存在，这是最常见的编码形式。

### Step 2：检查命中流的内容

对 Step 1 中发现的每个 stream，使用 `trace_http_stream` 检查：
- 设置 `tcpStream=<命中流>`
- 设置 `parseJsonPayload=true`, `decodeUnicode=true`
- 检查 HTTP 响应体/请求体中是否包含 mobile、phone、tel、code、verify 等字段
- 同时检查 `token`、`access_token`、`user_token` 等 Token 字段

### Step 3：检查相邻流与关联流（关键步骤 — 强制执行）

**如果当前 stream 仅包含嫌疑人姓名，没有手机号或验证码**，则 Agent **MUST** 执行多维度关联搜索。**在约 90% 的注册题型中，验证码和手机号位于姓名命中流的相邻流（N+1 或 N-1）中**。

**3a. 相邻流检查**（`tcp.stream` 邻近）— **最高优先级，成功率最高**
- 检查 `tcp.stream==N+1` 和 `tcp.stream==N-1`
- 使用 `trace_http_stream` 追踪这些流，设置 `decodeUnicode=true`
- 在相邻流中搜索 mobile、phone、tel、code、verify 等字段
- **典型场景**：tcp.stream 208 包含注册请求（姓名），tcp.stream 209 包含短信验证码响应

**3b. 同客户端 IP 关联**
- 获取姓名命中流中的 `ip.src`（客户端 IP）
- 搜索同一客户端 IP 的所有 HTTP 请求：
  - `ip.src==<客户端IP> && http`
- 提取这些流中的手机号、验证码、Token 等字段

**3c. 同 HTTP Host 时间邻近关联**
- 获取姓名命中流中的 HTTP Host
- 搜索相同 Host、时间邻近（±5秒内）的流量：
  - `http.host contains "<Host>" && frame.time_relative > <t-5> && frame.time_relative < <t+5>`
- 在 SMS 平台 Host 的流量中查找手机号和验证码

### Step 4：短信平台 Host 到 IP 归因

当需要回答"接码平台 IP"或"短信平台 IP"问题时：

1. 识别短信平台 Host（如 `sms.com`、`sms-api.example.com` 等）
2. 使用 `trace_http_stream` 追踪短信平台的 HTTP 流
3. 从 HTTP 会话端点确定 IP：
   - 优先使用 `ip.dst`（客户端请求时）或 `ip.src`（服务器响应时）
   - 即实际承载短信业务流量的 HTTP endpoint IP
4. 如果 DNS 解析与 HTTP endpoint IP 不同：
   - 以 HTTP endpoint IP 为准（实际通信 IP）
   - 列出 DNS 候选 IP 作为低置信度证据

### Step 5：Raw TCP Payload Fallback

**如果 HTTP 层完全没有手机号字段**（`trace_http_stream` 未返回包含 mobile/phone 的数据），则使用 `scan_raw_tcp_payloads` 进行降级搜索：
- `keywords` 参数：`mobile, phone, tel, code, verify` 以及嫌疑人姓名
- `decodeUnicode=true`
- `parseJsonPayload=true`
- `includePayload=true`

此步骤可捕获 HTTP 解析失败、自定义协议或非标准编码场景下的注册数据。

---

## 2. 中文姓名搜索变体

搜索中文姓名时，Agent 必须了解以下编码变体。**`search_pcap_text` 的 `searchUnicodeVariants=true` 参数会自动覆盖全部三种**：

| 编码方式 | 示例（姓名：秦贵天） | 自动覆盖? |
|---|---|---|
| 原始中文 UTF-8 hex | `e7:a7:a6:e8:b4:b5:e5:a4:a9` | ✅ `frame contains` |
| Unicode 转义 | `秦贵天` | ✅ `http.file_data contains` hex |
| URL 编码 (UTF-8) | `%E7%A7%A6%E8%B4%B5%E5%A4%A9` | ✅ `http contains` |

**Agent 无需手动构造编码**。只需调用 `search_pcap_text(keywords="秦贵天", searchUnicodeVariants=true, traceStreams=true)` 即可完成全部搜索。

### 2a. 手动 Unicode 编码生成（备用）

如果 Agent 需要手动构造 Unicode 转义（例如在 `run_display_filter` 中使用）：

```javascript
// Node.js 示例
const name = '秦贵天';
const unicode = [...name].map(c =>
  '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
).join('');
// => 秦贵天

const urlEncoded = encodeURIComponent(name);
// => %E7%A7%A6%E8%B4%B5%E5%A4%A9
```

---

## 3. 注册 Token 提取

当题目要求注册 Token 时：
- 在登录/注册成功响应中搜索 `token`、`access_token`、`user_token`、`auth_token`
- Token 通常位于 JSON 响应体或 Set-Cookie 中
- 输出完整 Token 值和前 N 位前缀（按题目要求）
- 证据包含 frame、tcp.stream、字段名、原始值

---

## 4. 答题证据要求

Agent 回答手机号、验证码、接码平台 IP、Token 问题时，必须包含以下证据：
- 目标值（手机号 / 验证码 / IP / Token）
- 命中字段名（如 mobile、phone、verification_code、token）
- 所属 tcp.stream 编号
- 命中 frame 编号
- 源/目标 IP（用于 IP 归因问题）
- HTTP Host（用于 SMS 平台识别）
- payload 片段（前 200 字符）
- 说明使用的工具和方法（如 "从 tcp.stream 7 的相邻流 8 中提取"、"通过同客户端 IP 10.0.0.1 关联"）

---

## 5. 常见误判与注意事项

- **不要在第一个命中流中停止**：嫌疑人姓名所在的 stream 可能只是身份信息提交，注册数据通常在下一个 stream 或同一客户端的其他 stream
- **不要只搜索 mobile**：实际字段名可能是 phone、tel、telephone、userMobile 等
- **不要忽略编码**：中文姓名的 Unicode 和 URL 编码在 PCAP 中很常见，**MUST 使用 `searchUnicodeVariants=true`**
- **不要跳过 raw TCP fallback**：HTTP 层字段可能缺失或截断，raw payload 是最终兜底手段
- **不要忽略同客户端流量关联**：注册请求可能分布在同一个客户端 IP 的多个 stream 中
- **接码平台 IP 优先使用 HTTP endpoint IP**：DNS 解析可能有多个 IP，但实际通信的 HTTP endpoint IP 才是承载短信流量的 IP
- **相邻流是最高优先级**：如果当前流只有姓名，**90% 的情况**手机号/验证码在相邻流（N+1 或 N-1）中，必须先检查相邻流再尝试其他关联方法

## 使用步骤

> 本章节为手机取证场景下的标准作业流程；若与既有核心流程在工具调用顺序上存在差异，保留原章节并标记待人工裁决。

### 1. 检材入口识别与证据固定
1. 先识别检材类型：手机物理镜像、文件系统提取、Android/iOS/鸿蒙备份、应用私有数据、APK/HAP/APP、流量包、内存镜像、日志、云端快照。
2. 对所有原始检材计算 SHA1/SHA256，生成取证工作副本；原始件只读封存。
3. 使用本产品取证能力、OSFMount、Autopsy、MobSF、DB Browser for SQLite 等通用工具挂载或导出。
4. 建立案件目录：原始件、工作副本、导出数据库、解密结果、逆向产物、报告。

### 2. 自动工具初筛
1. 用自动取证平台解析设备信息、账户、短信、联系人、通话、浏览器、便签、下载、相册、截图、通知、剪贴板、应用列表。
2. 围绕注册手机号与验证码建立关键词组：姓名、mobile、phone、tel、telephone、code、verify、verification、sms、register、signup、reg、token、captcha。
3. 对中文姓名执行三种编码变体搜索：原始 UTF-8、URL 编码、Unicode 转义；优先使用 search_pcap_text 的 searchUnicodeVariants=true。
4. 初筛结果只作为线索，不直接作为最终结论，必须回查原始数据。

### 3. 原始数据库与配置文件回查
按以下清单逐项回查：
- Android 系统配置：settings_global.xml、WifiConfigStore.xml、softap.conf、build.prop、属性文件、日志目录。
- Android 短信与通信：mmssms.db、contacts2.db、telephony.db、calllog.db、HbpcdLookup。
- Android 应用私有目录：/data/data/<pkg>/databases、shared_prefs、files、cache、no_backup，以及多开分身路径 /data/user/999/<pkg>。
- iOS 备份与应用域：Manifest.db、Manifest.plist、AppDomain-<bundle>、Library/Preferences、Library/Caches、Documents、sms.db、AddressBook.sqlitedb。
- 常见应用数据：微信 EnMicroMsg/MicroMsg、QQ、Telegram、WhatsApp、浏览器 history、downloads、cookies、WebView Local Storage、IndexedDB、leveldb、realm。
- 日志与残留：logcat、crash log、tombstone、通知缓存、剪贴板缓存、缩略图、EXIF、临时文件。

### 4. 注册手机号与验证码专项检索
1. 先定位姓名命中记录，再向相邻记录扩展：同数据库相邻 rowid、同应用时间邻近记录、流量中相邻 tcp.stream、同客户端 IP、同 Host。
2. 字段名不只看 mobile，需覆盖 phone、tel、mobileNumber、userMobile、phoneNumber、loginName、account、smsCode、verifyCode、captcha。
3. 对短信库重点检查 address、body、date、type、read、seen、deleted 标记；对应用库检查 user、account、auth、token、session、code 表。
4. 对验证码做上下文确认：必须同时出现手机号、注册接口、短信发送方、时间戳或业务状态；避免把订单号、快递单号、随机数字误判为验证码。
5. 对手机号做归一化：去除空格、横线、括号；识别 +86、86、0086、虚拟号、分机号；保留原始值与规范值。

### 5. 密钥、密码与加密数据库处理
1. 对加密 SQLite、SQLCipher、Realm、备份包、压缩包，先收集密钥线索：UIN、IMEI、Android ID、序列号、备份密码、密钥环、shared_prefs、auth_info_key_prefs.xml、Keychain、盐值、派生参数。
2. 按已知规则推导密钥；无法推导时使用 hashcat、john、openssl、SQLCipher、CyberChef 进行字典、规则或掩码破解。
3. 解密后必须验证库结构、表名、字段、记录状态，防止错误密钥产生伪明文。
4. 对 APK/HAP/APP/so 进行反编译与动态分析：apktool、jadx、Ghidra、Frida、Objection；提取包名、权限、接口、硬编码密钥、AES/RC4/SM4 参数、签名校验逻辑。

### 6. 多源交叉验证
1. 将短信数据库、应用私有库、流量包、日志、截图、通知、剪贴板、浏览器记录进行比对。
2. 使用时间线对齐：统一时区、Unix 毫秒/秒、iOS 时间基准；确认注册请求、短信接收、验证码提交、注册成功响应先后顺序。
3. 对删除或篡改风险，检查 WAL、journal、freelist、deleted 标记、事务字段、缓存残留。
4. 结论必须由至少两个独立来源支撑；单源结果降级为中低置信度，并标注待人工复核。

### 7. 答案归一化与证据固定
1. 按题目要求输出手机号、验证码、注册 Token、接码平台 IP、嫌疑人姓名、注册时间。
2. 每项答案绑定证据：文件路径、数据库表、字段、记录 ID、frame、tcp.stream、源/目标 IP、Host、payload 片段、哈希。
3. 对冲突值不自动覆盖，输出冲突清单并标记待人工裁决。
4. 生成可复现命令、工具版本、检材哈希和结果哈希。

## 输入输出说明

### 输入
1. 检材输入
- 手机镜像：dd、img、ufdr、tar、zip、aff4 等。
- 逻辑备份：iTunes 备份、Android backup、鸿蒙备份、应用备份目录。
- 应用数据：data/data 提取、AppDomain、沙盒、数据库、shared_prefs、plist。
- 流量与日志：pcap、pcapng、logcat、syslog、crash、tombstone、netlog。
- 可执行与安装包：APK、HAP、APP、so、dex、ipa。
2. 线索输入
- 嫌疑人姓名、别名、拼音、Unicode 变体。
- 候选手机号、区号、国际前缀、时间范围、目标应用包名、域名、Host、IP。
- 备份密码、数据库密码、密钥文件、盐值、UIN、IMEI 等解密线索。
3. 环境输入
- 只读挂载或工作副本。
- 原始检材 SHA1/SHA256。
- 案件时区、时间基准、工具版本。

### 输出
1. 核心结果字段
- mobile：原始手机号与归一化手机号。
- verification_code：验证码及长度、来源。
- suspect_name：命中姓名及编码形式。
- register_time：注册、短信发送、验证码提交、注册成功时间。
- token：注册或登录 Token。
- sms_platform：接码平台 Host、IP、URL、端口。
- app_or_site：应用包名、域名、网站标识。
2. 证据字段
- evidence_path：文件路径、数据库表、字段、记录 ID。
- network_evidence：frame、tcp.stream、ip.src、ip.dst、http.host、request.uri。
- payload_excerpt：前 200 字符或最小必要片段。
- hash：检材哈希、导出文件哈希。
- tool_method：工具、参数、搜索关键词、编码变体。
3. 置信度分级
- 高置信：原始数据库、解密数据库、流量原始载荷、多源一致。
- 中置信：自动工具解析、缓存、日志、通知、单源但字段完整。
- 低置信：模糊搜索、残留片段、删除恢复未验证、仅 DNS 或仅关键词命中。
4. 异常与裁决
- 无法确定：说明缺失环节、已排查路径、下一步建议。
- 冲突值：列出不同来源的值、时间、置信度，并标记待人工裁决。
- 加密未解：说明加密类型、密钥缺口、爆破结果与风险。

### 交付要求
- 报告应包含结论、证据链、工具链、哈希、时间线、误判排查。
- 结构化结果建议输出 JSON、CSV、Markdown 三种形式。
- 所有删除、解密、逆向、推断操作必须可复现。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
