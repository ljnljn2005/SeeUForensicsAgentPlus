---
name: phishing-url-tracing
description: >
  钓鱼网站 URL 多源交叉验证。当需要确定涉诈URL在不同设备/浏览器中的分布、 区分涉诈主站与钓鱼子页面时使用。触发词包括："钓鱼网址"、"涉诈网站"、
  "伪造页面"、"浏览器历史"、"browser2.db"、"浏览记录"、"history"、
  "Edge历史"、"Chrome历史"、"URL溯源"、"诈骗网站地址"。
agent_created: true
disable-model-invocation: false
---

# 钓鱼网站 URL 多源交叉验证

## 目的

在电子取证中，涉诈/钓鱼 URL 散布在多个设备和浏览器的历史记录中。
同一个诈骗团伙可能有主站域名和多个钓鱼子页面（如伪造微信零钱页面）。
本技能提供标准化的多源交叉验证流程，确保定位到正确的 URL。

## 触发条件

- 需要查找涉诈/钓鱼网站 URL
- 手机和电脑浏览器都可能有相关记录，需要区分
- 题目要求的是特定页面 URL（如 "伪造微信零钱页面"）而非主站

## 工作流

### 步骤 1：明确 URL 归类

先确定题目要求的 URL 类型：

| URL 类型 | 示例 | 典型存储位置 |
|---------|------|------------|
| 涉诈主站 | `xinnongcunfazhanjijin.com` | 电脑 Edge/Chrome History |
| 钓鱼子页面 | `imgml.com/wechat-balance.html` | **手机浏览器** browser2.db |
| 支付钓鱼页 | `xxx.com/pay.html` | 手机浏览器 / 聊天记录链接 |
| CDN/API 域名 | `api.xxx.com` | APK 硬编码、JS 源码 |

### 步骤 2：手机端搜索

**vivo/OPPO 自带浏览器：**
```sql
-- browser2.db（vivo浏览器数据库）
SELECT url, title, date(visit_time/1000000, 'unixepoch') 
FROM visits v JOIN urls u ON v.url_id = u.id
WHERE url LIKE '%imgml%' OR url LIKE '%wechat%' OR url LIKE '%balance%'
ORDER BY visit_time DESC
```

**Chrome Mobile：**
```sql
-- /data/data/com.android.chrome/app_chrome/Default/History
SELECT url, title, last_visit_time 
FROM urls 
WHERE url LIKE '%钓鱼关键词%'
ORDER BY last_visit_time DESC
```

### 步骤 3：电脑端搜索

**Edge 浏览器：**
```sql
-- C:\Users\*\AppData\Local\Microsoft\Edge\User Data\Default\History
SELECT url, title, datetime(last_visit_time/1000000-11644473600,'unixepoch') 
FROM urls 
WHERE url LIKE '%xinnong%' OR url LIKE '%imgml%'
```

**Chrome 浏览器：**
```sql
-- C:\Users\*\AppData\Local\Google\Chrome\User Data\Default\History
SELECT url, title, last_visit_time FROM urls WHERE url LIKE '%诈骗关键词%'
```

**PowerShell 历史记录：**
```
-- ConsoleHost_history.txt
-- 可能包含脚本批量生成的浏览器历史，标注涉诈域名
```

### 步骤 4：聊天记录中的链接

```sql
-- 微信/QQ/VoceChat 聊天记录
SELECT content FROM messages 
WHERE content LIKE '%http%' AND (content LIKE '%投资%' OR content LIKE '%理财%')
```

### 步骤 5：交叉比对与确认

将第 2-4 步的结果汇总为表格：

| 数据源 | URL | 类型 |
|--------|-----|------|
| 电脑 Edge History | `xinnongcunfazhanjijin.com` | 涉诈主站 |
| 手机 browser2.db | `imgml.com/wechat-balance.html` | 伪造微信零钱页面 |
| VoceChat 聊天 | `xxx.com/login` | 投资平台登录页 |

根据题目要求选择对应的 URL。**关键原则：不同数据源存储不同粒度的 URL。**

## 输出格式

```
钓鱼URL溯源报告
├── 涉诈主站：xinnongcunfazhanjijin.com
│   └── 来源：电脑 Edge 浏览器历史 + PowerShell 脚本标注
├── 伪造微信零钱页面：imgml.com/wechat-balance.html
│   └── 来源：手机 vivo 浏览器 browser2.db
└── 投资平台登录页：[URL]
    └── 来源：[数据源]
```

## 错误处理

| 错误现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| 从电脑 Edge 找到 URL 但答案错误 | 那是涉诈主站，不是题目要求的子页面 | 回到步骤1确认URL类型，从手机浏览器搜子页面 |
| browser2.db 表结构不同 | 不同手机厂商浏览器数据库结构差异 | 先用 `PRAGMA table_info()` 查看表结构 |
| 搜不到任何记录 | URL 可能在下载记录而非浏览历史 | 同时搜索 downloads 表 |
| 多个相似 URL | 同一页面不同参数版本 | 优先选取不含查询参数的根路径版本 |

## 适用场景

### 典型任务
- 涉诈/钓鱼 URL 定位：需要从流量包、浏览器历史、聊天记录、镜像文件中确认最终访问的钓鱼页面。
- 主站与子页面区分：题目要求可能是涉诈主站，也可能是伪造微信零钱、支付、登录等子页面。
- 多设备交叉验证：手机浏览器、电脑 Edge/Chrome、APP 内置 WebView、聊天记录可能保存不同粒度 URL。
- 加密或混淆流量溯源：HTTPS/TLS 只能看到 SNI，或载荷经 Base64、URL、Hex、XOR 编码，需要结合密钥与解码规则还原。
- 隐蔽信道外传关联：ICMP、DNS、异常 TCP 载荷可能携带 URL、Token、账号、验证码等线索。

### 适合提交给本技能处理的情况
| 情况 | 判断依据 | 推荐入口 |
|---|---|---|
| 已知流量包和多个浏览器数据库 | 需要确认哪个 URL 是题目要求的钓鱼页面 | 流量协议分层 + 浏览器历史交叉 |
| 只有浏览器历史但答案不稳定 | 可能命中主站、CDN、跳转前地址 | 补充流量侧验证最终请求与响应 |
| 题目强调伪造页面 | 页面路径通常包含 wechat、balance、pay、login 等 | 优先搜索手机浏览器、流量 HTTP URI |
| 题目强调涉诈主站 | 通常出现在 DNS 查询、TLS SNI、Edge/Chrome 历史 | 优先聚合域名层证据 |

### 不适用或需谨慎的情况
- 仅有内存镜像且无网络痕迹时，应先转入内存取证与进程网络关系分析。
- 流量被全量加密且无 key.log、私钥、主密钥、EDU 密钥线索时，不能直接断言载荷内容，只能输出 SNI、证书、时序与字节特征。
- 多个钓鱼页面同名或参数不同时，需保留完整 URL 与时间戳，避免只给根域名。

## 使用步骤

> 本节为流量分析侧补充步骤，与原文档浏览器历史工作流互补，不覆盖原步骤。

### 0. 证据固定与目标拆解
1. 对流量包、镜像、日志、数据库先计算哈希并记录来源，避免后续导出文件污染原始证据。
2. 明确目标 URL 类型：涉诈主站、钓鱼子页面、支付页、登录页、CDN/API 域名。
3. 建立关键词表：域名、品牌词、路径词、参数词、编码后特征。关键词应同时覆盖明文与常见编码形态。

### 1. 先协议分层，再流追踪，再载荷解码
1. 打开流量包后先看协议层级，确认 DNS、HTTP、TLS、FTP、Telnet、ICMP、TCP 异常端口占比。
2. 按协议过滤缩小范围：优先 DNS、HTTP、TLS、FTP、Telnet、ICMP。
3. 对可疑会话执行 Follow TCP/HTTP/TLS Stream，先还原完整请求与响应，再决定是否解码。
4. 对隐蔽信道或自定义协议，先固定字节范围，再编写解析器或脚本，禁止直接猜测明文。

### 2. DNS 解析流程
1. 提取所有 `dns.qry.name`，按访问频次、TTL、解析 IP 聚合。
2. 重点查看涉诈关键词、短 TTL、多个 A 记录、CNAME 跳转、疑似 DGA 域名。
3. 将 DNS 查询时间与主机/手机浏览器访问时间对齐，确认域名是否为钓鱼入口。
4. 若 DNS 回答指向 CDN，继续追踪 HTTP Host、TLS SNI 与 URI，避免把 CDN 域名误判为最终钓鱼页。

### 3. HTTP 明文追踪流程
1. 按 `http.host`、`http.request.uri`、`http.user_agent`、`http.referer` 过滤可疑请求。
2. 使用 Follow HTTP Stream 还原请求行、请求头、响应头与响应体。
3. 重点检查：
   - 请求方法：GET 用于页面访问，POST 常见于登录、支付、上传、命令执行。
   - 状态码：200 表示成功，301/302 表示跳转，403/404 可用于排除无效路径。
   - 响应头：Server、Location、Set-Cookie 可辅助识别后台、跳转目标和会话建立。
   - 请求头：User-Agent 异常、Referer 异常、Cookie 异常可提示自动化访问或钓鱼跳转。
4. 对跳转链必须记录完整路径：初始 URL、Location 中间跳、最终 200 页面。
5. 对 POST 表单、JSON、上传字段进行载荷解码，提取用户名、手机号、验证码、银行卡、支付页路径。

### 4. HTTPS/TLS 流量追踪流程
1. 先通过 `tls.handshake.extensions_server_name` 提取 SNI，确认疑似钓鱼域名。
2. 检查证书 Subject、Issuer、有效期、自签名特征与异常颁发链。
3. 若检材提供 key.log、主密钥、私钥、EDU 密钥或应用层密钥线索，在 Wireshark/tshark 中配置 TLS 解密密钥。
4. 解密成功后按 HTTP 明文流程继续分析；解密失败时不得将加密字节直接解释为明文。
5. 无密钥时，输出范围应限定为 SNI、证书、连接时间、字节长度、JA3/JA4 类指纹和关联流量行为。

### 5. FTP、Telnet 等明文协议追踪流程
1. FTP 关注命令、参数、响应码与数据通道，重点提取下载/上传文件名、路径、账号。
2. Telnet 关注登录、命令执行、回显内容，可能包含跳转 URL、脚本下载命令、凭据。
3. 对被动模式 FTP，需同时关联控制连接与数据连接，避免只看到 227 响应而漏掉文件内容。
4. 对明文协议中出现的 URL，需回查 DNS 与 HTTP/TLS 流量，确认是否实际访问。

### 6. ICMP 与隐蔽信道处理流程
1. 过滤 ICMP Echo Request/Reply，观察 payload 长度是否异常、是否固定重复、是否包含可见字符。
2. 对异常载荷按字节导出，再按题目线索尝试首字符拼接、连续可见字符串拼接、Base64、Hex、XOR。
3. 若载荷呈现 Base64 特征，先解码；若为 Hex，先转字节；若疑似 XOR，优先寻找密钥、EDU、常量、配置文件。
4. 还原内容后，必须与流量时间戳、源目 IP、浏览器历史或聊天记录进行二次印证。

### 7. 编码与加密还原判定规则
1. Base64：连续字母数字加 `/` 或 `+`，末尾常见 `=`，解码后若出现 http、html、login、pay 等词即可作为高价值线索。
2. URL 编码：出现 `%2F`、`%3D`、`%3A` 等，先解码再匹配关键词。
3. Hex：连续 0-9a-f 或 0-9A-F，且长度为偶数，尝试转字节后查看可读字符串。
4. XOR：若明文已知或格式可预测，可用已知头部、Cookie 字段、HTML 标签进行密钥推断；题目给出 EDU、key、secret 时优先作为候选密钥。
5. 压缩与封装：gzip、zip、伪加密压缩包需先识别文件头，再解压或修复；不要直接对压缩字节做文本搜索。
6. 所有解码结果都要保留输入偏移、原始载荷、解码方法、解码后文本，便于复核。

### 8. 文件导出与离线验证
1. 从 HTTP/FTP 会话导出文件、图片、脚本、压缩包，并记录来源流编号。
2. 对导出文件做哈希、文件头检查、大小检查，识别伪加密、隐藏流、附加数据。
3. 对图片做字符串提取与隐写检查；对脚本提取 URL、域名、密钥、解码函数。
4. 若文件内再次出现 URL，回到流量和浏览器历史确认访问链路。

### 9. 多源交叉比对
1. 将流量侧结果与手机 browser2.db、Chrome Mobile、Edge、Chrome、聊天记录、PowerShell 历史汇总。
2. 建立比对表：数据源、时间、设备、域名、完整 URL、路径、参数、响应状态、题目要求匹配度。
3. 时间戳统一后再排序；注意浏览器本地时间、流量包 UTC、手机时区差异。
4. 判定规则：
   - 题目要主站：优先选择域名层证据最充分、跨设备出现最多的根域名。
   - 题目要伪造页面：优先选择包含具体路径且响应成功的子页面 URL。
   - 题目要支付/登录页：优先选择 POST 提交凭据或页面标题命中品牌词的最终 200 页面。
   - 题目要 API/CDN：需区分资源域名与业务入口，不能把静态资源域名当作钓鱼页面。

### 10. 输出与复核
1. 输出最终 URL 时，同时给出证据链：DNS 查询、HTTP/TLS 请求、浏览器历史、聊天记录、文件导出。
2. 对无法完全解密的流量，明确写出只能确认到 SNI/域名/连接行为，不得过度推断。
3. 复核是否存在同名参数版本；若多个版本并存，优先选择题目语义对应的路径，必要时保留候选集。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
