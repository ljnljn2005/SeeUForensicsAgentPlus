---
name: 通用逆向分析
description: 通用逆向分析技能。覆盖 Android APK 反编译、二进制静态分析、加密文件密码破解、私有日志/数据格式解析、协议还原、可视化呈现。当用户提到 逆向、反编译、破解密码、加密 zip/rar、APK 分析、so 库、抓包、协议还原、日志解析、数据恢复、字符串提取、加解密算法定位 时使用。
version: 1.0.0
name_en: Reverse Engineering
description_en: General reverse-engineering skill for Android APK decompilation, binary static analysis, encrypted archive cracking, private log/format parsing, protocol recovery, and visualization. Use when the user mentions reverse engineering, decompilation, password cracking, encrypted zip/rar, APK analysis, native libs, protocol recovery, log parsing, data recovery, string extraction, or crypto algorithm location.
---

# 通用逆向分析

一套与具体业务无关的逆向工程方法论，覆盖 **侦查 → 静态分析 → 算法还原 → 解密 → 数据解析 → 可视化** 全链路。

## 适用场景

触发本 skill 的典型请求：
- 反编译 / 分析 Android APK、Java/Kotlin 字节码、smali
- 分析原生 so 库（ELF）、PE、Mach-O 二进制
- 破解加密压缩包（ZIP / RAR / 7z），含 AES 强加密
- 还原私有协议、私有数据格式、未知日志结构
- 定位加解密算法、密钥派生逻辑、硬编码密钥
- 从二进制/字节流中提取字符串、常量、配置
- 将恢复的结构化数据可视化（图表、地图、时序）

## 核心工作流（六阶段）

每阶段附 checklist，复制并跟踪进度。

### 阶段一 · 侦查 (Recon)

```
侦查 checklist：
- [ ] 识别产物类型（APK / DEX / ELF / ZIP / RAR / 自定义二进制 / 数据库 / 日志）
- [ ] 收集元数据：文件名、大小、时间戳、序列号/设备号线索
- [ ] 检查 zip 注释、文件标志位、加密头
- [ ] 列出候选工具（jadx / apktool / pyzipper / strings / file / binwalk / 010 Editor）
```

**文件名取证** —— 动手前先榨干文件名信息：
- 时间戳、时区、设备号、版本号、内部编码常藏在文件名里
- 后缀 `_1` / `v1` / `old` 常暗示旧版本（弱算法、可破解）
- 命名规律 = 业务逻辑线索，记录下来供后续阶段交叉验证

**加密包识别** —— 运行 `python scripts/zip_crack.py inspect <file>`：
- `flag_bits & 0x0001` → 加密
- `compress_type == 99` 或含 `0x9901` 扩展字段 → AES（必须用 `pyzipper`，标准库无效）
- 空注释 + 旧版本后缀 → 常见弱密钥派生（zip4j 风格）

### 阶段二 · 静态分析 (Static Analysis)

```
静态分析 checklist：
- [ ] APK：jadx 出 Java；失败回退 apktool 出 smali
- [ ] ELF/so：IDA / Ghidra / radare2；先 strings 看 API 名
- [ ] grep 加密原语：AES、Cipher、SecretKey、MessageDigest、HMAC
- [ ] grep 密钥派生：generatePwd、deriveKey、getPassword、buildCipher
- [ ] 定位算法 + 输入（设备号、时间戳、盐、固定 IV）
```

**APK 反编译**（首选 jadx，输出可读 Java）：
```bash
jadx -d out/ app.apk
# 出错时降级：
jadx --show-bad-code --no-imports -d out/ app.apk
apktool d app.apk -o smali_out/        # smali 兜底
```

**原生库分析**：
```bash
strings -n 8 libxxx.so | rg "AES|key|secret|http"
r2 -A libxxx.so            # radare2 自动分析
# 需要 IDA Hex-Rays 批量导出给 AI：使用内置技能 qiko-ida-export
#   powershell -File ../qiko-ida-export/scripts/ida_batch_export.ps1 -Binary libxxx.so -Workspace <工作区根>
```

**定位加密代码**：
```bash
rg -n "AES|Cipher\.getInstance|SecretKeySpec|MessageDigest|IvParameterSpec" out/
rg -n "generatePwd|deriveKey|getPassword|buildCipher|encrypt|decrypt" out/
```

**常见模式识别**：
- `AES/CBC/PKCS5Padding` + 固定 IV → 确定性加密，知道密钥即可复现
- 密钥由设备号 + 时间戳派生 → **用 Python 复现派生逻辑**（见 reference.md §crypto）
- Base64(XOR(s1, s2)) → 经典混淆，可逆
- `generate*By*` 命名约定 → 搜同类方法

### 阶段三 · 算法还原 (Algorithm Recovery)

```
算法还原 checklist：
- [ ] 将目标方法逐行翻译为 Python（用 pycryptodome 做 AES）
- [ ] 从文件名/上下文识别输入参数
- [ ] 注意日期/字节序/编码怪癖（日月在月前、大小端、GBK/UTF-8）
- [ ] 生成密码/密钥，先验证单文件
- [ ] 批量执行，报告 ok/fail 计数
```

**翻译要点**：
1. 把 Java 方法**逐字**复制到 Python，不要"修正"看似 bug 的逻辑——常是故意的
2. 固定 IV、盐、常量**原样照抄**，不要重新生成
3. 字符串编码、字节序、补位方式必须一致
4. 第一次失败时，尝试**交换参数顺序**（如 `yyyyddMM` ↔ `yyyyMMdd`）

**始终先验证再下结论** —— 端到端解出至少 1 个文件并报告字节数，再宣布成功。

### 阶段四 · 解密 (Decryption)

```
解密 checklist：
- [ ] 分类加密：ZipCrypto（弱）vs AES（强）vs 自定义
- [ ] ZipCrypto：可用脚本+候选词表暴力
- [ ] AES：必须还原算法，暴力不可行
- [ ] 自定义：定位加解密函数，复现后批量处理
```

**决策树**：
- ZipCrypto（标准库可测）→ `python scripts/zip_crack.py brute <zip> <wordlist>`
- AES-256（zip4j/pyzipper）→ **必须逆向算法**，暴力在算力上不可行
- 未知 → `python scripts/zip_crack.py inspect <zip>` 先看类型

**候选密码来源**（按优先级）：
1. 文件名解析出的设备号、时间戳、版本号及其组合
2. APK 中硬编码常量（`scripts/parse_apk_crypto.py`）
3. 应用名 + 数字变体（`appname123`、`APPNAME2025`）
4. 通用弱口令表

### 阶段五 · 数据解析 (Data Parsing)

```
解析 checklist：
- [ ] 每类日志/数据采样 50+ 行
- [ ] 识别时间戳格式（常缺年份，从文件名推断）
- [ ] 按事件类型建正则集
- [ ] 跨冗余监听器去重（同一事件多源记录）
- [ ] 输出结构化 JSON：{ts, key, value, label, file}
```

**时间戳推断** —— 设备日志常省略年份：
- `MM-DD HH:MM:SS.mmm` → 从文件名或崩溃日志上下文补全年份
- 跨年数据（如崩溃日志 `09-25`）可能属于上一年，需结合设备运行时长或构建日期判断

**正则策略**：
- 锚定最独特的字符串（类名、事件名、关键字段）
- 数值用 `([\-\d.]+)` 兼容负数和小数
- 状态变更同时捕获多字段：`area=(\d+)state=(\d+)`
- 通用信号正则目录见 `reference.md` §regex

**去重** —— 多监听器常在同一毫秒记录同一事件，按 `(ts, key, value)` 去重。

### 阶段六 · 可视化 (Visualization)

```
可视化 checklist：
- [ ] 选图：轨迹用地图、时序用折线、状态用仪表盘、分布用柱状/饼图
- [ ] 中国地图：Leaflet + 高德瓦片（GCJ-02 对齐）
- [ ] 原始 GPS 是 WGS-84，必须转 GCJ-02（scripts/wgs2gcj.py）
- [ ] 提供坐标系切换开关，让用户验证对齐
- [ ] 生成独立 HTML（无服务端依赖），可直接打开
```

**地图瓦片**（GCJ-02 数据无偏移）：
```
https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}
subdomains: 1234
```

**关键提醒**：原始 Android GPS = WGS-84。直接画在 GCJ-02 瓦片上 → 偏移约 300–500 米（轨迹飞越建筑物）。务必转换 + 提供切换开关。

**可视化模板** —— 仪表盘、车速渐变轨迹、朝向旋转车标、事件脉冲等模式见 `reference.md` §viz。

## 工具速查

| 任务 | 工具 |
|------|------|
| APK → Java | `jadx`（首选）、`apktool`（smali 兜底） |
| AES ZIP | `pyzipper`（非标准库 `zipfile`） |
| 加密 | `pycryptodome`（`from Crypto.Cipher import AES`） |
| 地图 | Leaflet 1.9.4 + 高德瓦片 |
| 图表 | Chart.js（时序）、纯 SVG（仪表盘） |
| 二进制 | `strings`、`file`、`binwalk`、IDA、Ghidra、radare2 |
| 搜索 | `rg`（ripgrep）遍历反编译树 |

## 输出标准

- **先验证再宣告**：密码/解析结论必须端到端跑通后再报告
- **报计数**：「117/117 文件解压成功」「192 个 GPS 点跨 3 个日期」
- **给证据**：引用产生密码的精确方法名、行号、输入参数
- **可视化**：产出独立 HTML，用户可直接打开

## 参考

- 加密算法细节、通用正则目录、坐标数学、可视化模式见 [reference.md](reference.md)
- 完整实战案例（BYD 车机日志、ZipCrypto 暴力、API key 定位、未知日志解析）见 [examples.md](examples.md)

## 脚本

所有脚本在 `scripts/`，运行 `python scripts/<name>.py`：

- **zip_crack.py** — `inspect <zip>` | `brute <zip> <wordlist>` | `test <zip> <pwd>` | `extract <zip> <pwd> <out>`
- **apk_decompile.py** — `decompile <apk> <out>`（jadx 包装）| `find_crypto <out>`（grep 加密原语）
- **wgs2gcj.py** — `conv <lat> <lon>` | `batch <in.json> <out.json>` | `js`（输出 JS 实现）
- **strings_dex.py** — 从 DEX/APK 提取字符串，支持 `--min`、`--filter`
- **parse_apk_crypto.py** — 扫描反编译源码中的加密用法和硬编码密钥

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
