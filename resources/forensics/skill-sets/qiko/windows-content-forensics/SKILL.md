---
name: windows-content-forensics
description: "Windows 内容取证分析。解析注册表 Hive（SAM/SYSTEM/SOFTWARE/NTUSER.DAT/USRCLASS.DAT）、Event Log (.evtx)、Prefetch、Amcache、USN Journal 等 Windows 核心取证 artifact，产出结构化时间线与分析报告。与 windows-loader 配合使用：windows-loader 负责挂载和文件提取，本 skill 负责提取后的深度内容解析。"
agent_created: true
---

# Windows 内容取证分析 Skill

## 定位

本 Skill 用于对 Windows 磁盘镜像或已挂载目录中的 Windows 特有 artifact 进行深度内容级解析，产出结构化数据、时间线和分析结论。**不负责**挂载/提取文件（那是 windows-loader 的职责），而是在已获取的文件上进行内容分析。

## 触发条件

满足以下任一条件时触发本 Skill：

- 用户提供 Windows 注册表 Hive 文件路径（SAM、SYSTEM、SOFTWARE、NTUSER.DAT、USRCLASS.DAT 等）
- 用户提供 .evtx 事件日志文件路径
- 用户提供 Prefetch 文件路径（.pf 文件）
- 用户提供 Amcache.hve 文件路径
- 用户提供 USN Journal 文件路径（$UsnJrnl、$J 等）
- 用户要求"分析 Windows 痕迹"、"查看注册表"、"解析日志"、"检查启动项"等
- 用户将 windows-loader 产出的文件目录传递给本 skill

## 前置条件

- Python 3.8+ 环境
- 以下 Python 包按需安装（脚本会自动检测并提示安装）：
  - `python-registry` — 注册表解析
  - `python-evtx` — 事件日志解析
  - `construct` — 二进制数据结构解析（Prefetch 等）
  - `lxml` — XML 处理

## 工作流程

### 阶段一：证据收集清单

在分析前，先确认用户提供了哪些 artifact 类型。典型 Windows 内容取证 artifact 清单：

| artifact | 典型路径 | 依赖包 |
|---|---|---|
| SAM Hive | `Windows\System32\config\SAM` | python-registry |
| SYSTEM Hive | `Windows\System32\config\SYSTEM` | python-registry |
| SOFTWARE Hive | `Windows\System32\config\SOFTWARE` | python-registry |
| NTUSER.DAT | `Users\<user>\NTUSER.DAT` | python-registry |
| USRCLASS.DAT | `Users\<user>\AppData\Local\Microsoft\Windows\UsrClass.dat` | python-registry |
| Security Hive | `Windows\System32\config\SECURITY` | python-registry |
| Application.evtx | `Windows\System32\winevt\Logs\Application.evtx` | python-evtx |
| System.evtx | `Windows\System32\winevt\Logs\System.evtx` | python-evtx |
| Security.evtx | `Windows\System32\winevt\Logs\Security.evtx` | python-evtx |
| PowerShell.evtx | `Windows\System32\winevt\Logs\Microsoft-Windows-PowerShell%4Operational.evtx` | python-evtx |
| Prefetch 文件 | `Windows\Prefetch\*.pf` | construct |
| Amcache.hve | `Windows\AppCompat\Programs\Amcache.hve` | python-registry |
| USN Journal | `$Extend\$UsnJrnl:$J` | — |

### 阶段二：执行分析

运行 `scripts/windows_content_forensics.py` 脚本，传入待分析的文件或目录路径：

```bash
python scripts/windows_content_forensics.py --input <path> --output <output_dir>
```

脚本会自动识别 artifact 类型并执行对应解析：

- `--input`：单个文件或包含多个文件的目录（递归扫描）
- `--output`：输出目录，默认在当前目录下创建 `forensics_output`
- `--type`：可选，指定只分析特定类型（registry/evtx/prefetch/amcache/usn/all）
- `--timeline`：可选，输出统一时间线文件（CSV 格式）
- `--report`：可选，生成 HTML 交互式报告

### 阶段三：深入分析要点

#### 注册表分析要点

- **SAM Hive**：本地用户账户列表、SID、RID、最后登录时间、密码哈希（LM/NT）
- **SYSTEM Hive**：
  - `Select\Current` → 当前 ControlSet
  - `ControlSet001\Control\ComputerName\ComputerName` → 主机名
  - `ControlSet001\Services` → 服务列表（重点关注非 Microsoft 服务）
  - `ControlSet001\Control\TimeZoneInformation` → 时区
  - `MountedDevices` → 挂载过的设备
- **SOFTWARE Hive**：
  - `Microsoft\Windows\CurrentVersion\Run` → 启动项
  - `Microsoft\Windows\CurrentVersion\Uninstall` → 已安装程序
  - `Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles` → 网络连接历史
  - `Microsoft\Windows\CurrentVersion\Explorer\RecentDocs` → 最近文档
- **NTUSER.DAT**：
  - `Software\Microsoft\Windows\CurrentVersion\Explorer\RecentDocs` → 最近文档
  - `Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU` → 运行历史
  - `Software\Microsoft\Windows\CurrentVersion\Explorer\TypedPaths` → 地址栏输入历史
  - `Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Persisted` → 程序兼容性记录
  - `Software\Microsoft\Internet Explorer\TypedURLs` → IE 地址栏输入
  - `Software\Microsoft\Windows\CurrentVersion\Run` → 用户级启动项

#### 事件日志分析要点

- **Security.evtx (4624/4625)**：登录成功/失败事件 → 暴力破解检测
- **Security.evtx (4688)**：进程创建 → 恶意进程执行
- **Security.evtx (4648)**：显式凭据使用 → 横向移动
- **Security.evtx (4720/4722/4726)**：账户创建/启用/禁用
- **System.evtx (7045)**：服务安装 → 后门/持久化
- **PowerShell 日志 (4103/4104)**：PowerShell 脚本块 → 无文件攻击
- **Task Scheduler (106/200/201)**：计划任务创建 → 持久化

#### Prefetch 分析要点

- 程序执行时间戳（首次执行、最后执行、执行次数）
- 运行文件的完整路径
- 缺失的 Prefetch 文件（可能被清除）
- 检测异常执行路径（如从临时目录、下载目录运行）

#### Amcache 分析要点

- 系统上运行过的程序列表
- 程序的 SHA1 哈希值（用于威胁情报匹配）
- 程序的安装路径和文件大小
- 程序首次运行时间戳

#### USN Journal 分析要点

- 文件创建/修改/删除/重命名事件
- 按时间戳排序的完整文件变更历史
- 检测文件删除操作（用户删除/工具清除）
- 检测文件重命名操作（恶意文件更名）

### 阶段四：报告生成

脚本执行后产出以下内容：

1. **解析结果文件**：每个 artifact 类型的结构化数据（JSONL 格式）
2. **统一时间线**：跨 artifact 类型的时间线 CSV（按时间排序）
3. **分析摘要**：高价值发现摘要（可疑账户、异常启动项、后门服务等）
4. **HTML 交互式报告**：可视化呈现关键发现

## 输出规范

所有输出文件统一使用以下格式：

- **JSONL 文件**：UTF-8 编码，每行一个 JSON 对象
- **CSV 文件**：UTF-8 BOM 编码（兼容 Excel 直接打开），包含时间戳字段
- **时间线 CSV**：统一包含列：`Timestamp,Source,ArtifactType,EventType,Description,Detail,Severity`
- **报告文件**：Markdown 格式，包含摘要、关键发现、详细数据和结论

## 与 windows-loader 的配合

使用 windows-loader 提取文件后，将提取目录传递给本 skill：

1. 运行 windows-loader 挂载镜像并提取文件
2. 将提取目录路径传递给本 skill 的 `--input` 参数
3. 本 skill 自动扫描目录中的 Windows artifact 并执行深度解析
4. 输出合并分析报告，包含 windows-loader 的目录结构信息 + 本 skill 的内容分析结果

## 注意事项

- 始终在只读模式下工作，不修改任何证据文件
- 解析失败时记录错误并继续处理其他文件（不中断）
- 大文件（>1GB 的 EVTX 日志）提示用户预计处理时间
- 关键发现（可疑账户、异常启动项、后门服务）以高亮标记
- 对于加密/损坏的 Hive 文件，记录错误并尝试部分恢复

## 适用场景

本 Skill 适用于已完成镜像挂载、文件系统提取或离线文件固定后的 Windows 内容级取证分析，重点回答「系统发生过什么、谁做过、何时做、如何持久化、是否有外传或反取证迹象」。

### 典型实战场景

1. 入侵事件响应与溯源
   - 排查暴力破解、远程登录、横向移动：结合 `Security.evtx` 的 4624/4625/4648/4688，以及 `SYSTEM`、`SOFTWARE` 中的网络配置与服务痕迹。
   - 定位恶意程序执行：结合 `Prefetch`、`Amcache.hve`、`PowerShell` 日志、`Run` 启动项与计划任务痕迹。
   - 重建攻击时间线：将登录、进程创建、服务安装、文件创建/删除/重命名统一到同一时间轴。

2. 持久化与后门排查
   - 检查注册表启动项、服务、计划任务、兼容性标记、最近运行记录。
   - 关注非系统路径服务、临时目录执行、异常服务名称、罕见命令行。
   - 对 `Amcache` 中的 SHA1 与外部威胁情报碰撞，确认是否为已知工具或恶意样本。

3. 数据外传与隐蔽信道线索关联
   - 当本地痕迹显示存在可疑压缩、加密、远程工具、PowerShell 网络脚本或异常命令时，可将本 Skill 的时间线与网络证据交叉验证。
   - 若案件涉及 ICMP 隧道嫌疑，应在网络流量或导出的网络日志中补充 ICMP Echo Request/Reply 载荷提取，并将外传内容片段与本机文件、剪贴板内容、凭据文件或脚本输出进行比对。

4. 反取证与痕迹清理识别
   - 通过 `USN Journal` 识别批量删除、重命名、清理工具写入。
   - 通过 `Prefetch` 缺失、日志截断、EVTX 损坏、Hive 事务日志异常判断人为清理。
   - 通过时间线断点识别日志覆盖、系统时间篡改或证据提取不完整。

5. 与 windows-loader 衔接的离线分析
   - windows-loader 完成挂载和文件提取后，本 Skill 接收提取目录，进行深度解析。
   - 适用于无网络、无法在线取证、需要可复现分析、需要出具鉴定/报告材料的案件。

### 不适用或需谨慎使用的场景

- 未完成只读固定、未计算哈希、证据链不完整的紧急现场，应先完成证据固定。
- 需要内存取证、实时进程、网络连接状态、磁盘未分配空间雕刻时，应搭配内存取证、镜像解析或专用工具。
- 目标为 Linux、macOS、移动终端或非 Windows 文件系统时，不适用本 Skill。
- 仅有网络包而无 Windows 本地 artifact 时，应优先使用网络取证技能；本 Skill 仅能做本地痕迹关联。

## 使用步骤

### 1. 证据接收与前置校验

- 确认输入来自只读镜像、只读挂载或 windows-loader 提取目录；记录案件编号、证据编号、原始哈希、提取时间、提取工具。
- 检查关键文件是否齐备：`SAM`、`SYSTEM`、`SOFTWARE`、`SECURITY`、`NTUSER.DAT`、`USRCLASS.DAT`、`*.evtx`、`Prefetch`、`Amcache.hve`、`$UsnJrnl:$J`。
- 检查 Hive 是否带有 `*.LOG1`、`*.LOG2`；若主 Hive 处于脏状态，优先使用事务日志恢复或记录解析异常。
- 记录系统时区与 UTC 偏移，避免时间线误判；后续报告统一注明时间基准。

### 2. 确定分析优先级

按实战分诊顺序处理：

1. `Security.evtx`：登录、进程创建、账户变更、权限使用。
2. `System.evtx`：服务安装、驱动加载、系统启动/关机。
3. `SYSTEM` 与 `SOFTWARE`：主机名、时区、服务、启动项、网络历史。
4. `SAM`：本地账户、最后登录、密码策略异常。
5. `NTUSER.DAT` / `USRCLASS.DAT`：用户执行痕迹、Run 键、RecentDocs、RunMRU、TypedPaths。
6. `Prefetch` / `Amcache.hve`：程序执行路径、执行次数、SHA1、首次/最后运行时间。
7. `USN Journal`：文件创建、删除、重命名、清理工具活动。

### 3. 运行解析命令

- 分析单个提取目录：

```bash
python scripts/windows_content_forensics.py --input /mnt/evidence/extracted --output ./case_output --timeline --report
```

- 仅分析注册表与日志：

```bash
python scripts/windows_content_forensics.py --input /mnt/evidence/extracted --type registry --output ./case_output
python scripts/windows_content_forensics.py --input /mnt/evidence/extracted --type evtx --output ./case_output
```

- 输出目录建议按案件号命名，并将 `forensics_output`、时间线、报告分别归档。

### 4. 注册表深度检查

- 从 `SYSTEM` 的 `Select\Current` 确定当前 ControlSet，不要直接假定 `ControlSet001`。
- 核对主机名、时区、LastWrite 时间、`MountedDevices`、USB 设备痕迹与服务安装。
- 在 `SOFTWARE` 中检查：
  - `Microsoft\Windows\CurrentVersion\Run`
  - `Microsoft\Windows\CurrentVersion\RunOnce`
  - `Microsoft\Windows\CurrentVersion\Uninstall`
  - `Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles`
- 在 `NTUSER.DAT` 中按用户逐一检查：
  - `Run`、`RunMRU`、`TypedPaths`、`RecentDocs`、`TypedURLs`
  - 用户级 `AppCompatFlags` 与兼容性助手记录
- 注意 32/64 位注册表重定向：可疑启动项可能位于 `Wow6432Node` 对应路径。
- 对 `SAM` 中的账户，重点看隐藏账户、异常描述、最后登录时间、密码年龄与 RID 异常。

### 5. 事件日志深度检查

- `Security.evtx`：
  - 4624：登录类型 2、3、10 分别对应交互、网络、远程桌面。
  - 4625：失败登录的时间密度、来源地址、账户枚举特征。
  - 4648：显式凭据使用，关注目标服务器与异常账户。
  - 4688：进程创建，若启用命令行审计，重点匹配 `cmd`、`powershell`、`rundll32`、`regsvr32`、`mshta`、`certutil`。
  - 4720/4722/4726：账户创建、启用、删除。
- `System.evtx`：
  - 7045：服务安装，关注二进制路径、服务名、启动类型。
  - 6005/6006/6008/1074：开关机与异常关机。
- `PowerShell` 日志：
  - 4103/4104：模块日志与脚本块日志，重点查找编码命令、下载命令、内存加载、凭据读取、网络回连。
- 对损坏或截断的 `.evtx`，记录错误、尝试解析可恢复记录，并在报告中说明证据完整性影响。

### 6. 执行痕迹与文件活动分析

- `Prefetch`：
  - 关注程序完整路径、执行次数、最后执行时间。
  - 重点识别 `Temp`、`Downloads`、`AppData`、`ProgramData`、回收站路径下的可执行文件。
- `Amcache.hve`：
  - 提取程序路径、文件大小、SHA1、时间戳。
  - 将 SHA1 与威胁情报、已知恶意工具库、案件内样本库碰撞。
- `USN Journal`：
  - 按时间窗口过滤攻击发生前后文件变化。
  - 关注批量删除、重命名、加密后缀、压缩包生成、清理工具写入。
- 注意：Prefetch 可能被禁用或清理，USN 可能轮转，不能因单一 artifact 缺失就排除执行。

### 7. 时间线重建与假设验证

- 使用 `--timeline` 生成统一时间线，按「登录—执行—持久化—文件操作—外传准备—清理」路径验证攻击假设。
- 将账户、进程、服务、文件、网络痕迹绑定到同一时间窗口，避免孤立指标误判。
- 对关键事件保留原始证据字段：事件 ID、Record ID、Hive 路径、键路径、文件路径、时间戳来源。
- 若发现时间跳变、日志断档、USN 空洞，应作为反取证线索单独记录。

### 8. 可选扩展：ICMP 隐蔽信道外传验证

当案件同时具备网络流量、流量日志或导出的网络证据，且本地痕迹提示数据外传嫌疑时，补充以下流程：

1. 筛选 ICMP Echo Request/Reply，即 ICMP Type 8 与 Type 0 报文，优先关注同一会话 ID、同一源目 IP 对、固定包长或异常高频流量。
2. 导出 ICMP payload，剥离 IP/ICMP 头部，保留数据区；若存在自定义头部，先记录头部长度与编码规则。
3. 按规则拼接载荷：可尝试提取每包首字符、固定偏移字符串、连续 ASCII、Base64/Hex 片段，或按会话序号重组完整文件。
4. 验证是否为外传数据：将重组结果与本机可疑文件、凭据导出、压缩归档、脚本输出、剪贴板内容或数据库导出片段进行哈希/关键字比对。
5. 与本地时间线关联：核对 ICMP 会话时间与 `Security.evtx` 4688 进程创建、PowerShell 4104 脚本执行、`Prefetch`/`Amcache` 工具运行时间是否一致。
6. 误判规避：正常诊断、探测、网络设备心跳也可能携带 ICMP 数据；必须结合目的地址、频率、包长熵、进程来源、时间窗口与基线流量综合判断，不能仅凭 payload 非空定性。

### 9. 报告输出与证据归档

- 输出至少包括：结构化 JSONL、统一时间线 CSV、HTML/Markdown 报告、关键发现摘要。
- 报告应写明：证据来源、解析工具、解析范围、失败文件、时间基准、置信度、误判可能。
- 对高危发现分级：确认级、疑似级、线索级；对无法复现或损坏的证据标注限制。
- 将输出文件计算哈希并归档，确保分析结果可复核、可移交。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
