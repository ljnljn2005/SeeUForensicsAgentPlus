---
name: windows-loader
description: Use when mounting, inspecting, triaging, or extracting targeted forensic evidence from a Windows guest disk image (raw/dd/img, single or split E01, VHD, or VHDX) from the current Windows, Linux, or WSL terminal without writing to original evidence.
---

# Windows Loader v1

Handle Windows **guest** evidence only. Keep original evidence read-only; do not execute guest binaries, services, scripts, installers, or document macros. Produce an interactive case summary, not a formal report.

## Declare the task

1. Record the absolute evidence path, detected format, segment set, current terminal, case-state path, and requested mode.
2. Require one hash policy: `now`, `later`, or `skip`. Record available hash algorithms and preserve the policy in case state; never silently hash or skip.
3. Accept only `raw`, `dd`, `img`, `E01`, split `E01`, `VHD`, and `VHDX`.
4. Set exactly one mode: `mount-only`, `fast-path`, or `mount-and-analyze`.

SUPPORTED_FORMATS: raw, dd, img, E01, split E01, VHD, VHDX
EWF_SEGMENT_SEQUENCE: E01-E99, EAA-EZZ, FAA-FZZ, ... , ZAA-ZZZ
EWF_SEGMENT_INPUT: CANONICALIZE_TO_E01; REJECT_MISSING_OR_AMBIGUOUS_CONTINUATIONS
MODES: mount-only, fast-path, mount-and-analyze
HASH_POLICY: now, later, skip
AVAILABLE_HASH_ALGORITHMS: RECORD_IN_INSPECT_AND_CASE_STATE_WITHOUT_IMPLICIT_HASHING
NO_FORMAL_REPORT

## Route the current terminal

Inspect the current terminal once, then select exactly one independent reference. Do not adapt, blend, emulate, auto-switch, or invoke a different environment.

CURRENT_TERMINAL_REFERENCE: SELECT_EXACTLY_ONE_OF_WINDOWS_LINUX_WSL
REFERENCE_ADAPTERS: PROHIBITED
TERMINAL_AUTO_SWITCH: PROHIBITED

- Native Windows terminal: read [mount-windows.md](./references/mount-windows.md).
- Native Linux terminal: read [mount-linux.md](./references/mount-linux.md).
- WSL terminal: read [mount-wsl.md](./references/mount-wsl.md).

If the selected environment cannot safely meet a prerequisite, stop and ask the user for the stated next action. In WSL, only ask the user to restart in Windows; never restart, invoke, or switch it yourself.

## Work in the selected mode

- `mount-only`: perform preflight, mount read-only, verify the mount, inventory only the Windows guest layout, retain a successful mount, and give cleanup commands.
- `fast-path`: perform the same safe preflight and mount, then run the two-stage bounded search for the user-named artifact or product.
- `mount-and-analyze`: perform `mount-only`, then request a narrowly scoped analysis target before reading artifacts.

Use bundled scripts only for deterministic local inspection and bounded output:

```text
python scripts/inspect_evidence.py --help
python scripts/inspect_windows_tree.py --help
python scripts/find_windows_paths.py --help
python scripts/analyze_artifact.py --help
python scripts/case_state.py --help
python scripts/case_state.py init --case-dir ./tmp/windows-loader/<case-id> --image <evidence> --hash <now|later|skip> --mode <mount-only|fast-path|mount-and-analyze>
```

SEARCH: TWO_STAGE_BOUNDED

Stage 1 searches the high-value catalogued paths before expanded discovery. Stage 2 runs only after explicit `--expand` authorization and remains inside the catalog's enumerated roots; it never scans the unrestricted mounted root. Default to depth 4 and limit 50; do not follow reparse points. Record ACL-denied paths as errors, never as absence. Read [windows-path-catalog.md](./references/windows-path-catalog.md) and [schema.md](./references/schema.md) before presenting results.

HOST_ENUMERATION_ORDER_LIMITATION: bounded scans consume the host filesystem's enumeration order. Results are not guaranteed to be deterministic when the entry budget truncates a directory; deterministic sorting would first require unbounded enumeration. Report this limitation in scan metadata and never describe a truncated scan as exhaustive.

## Create case state automatically

Create case state before the first mount or installation proposal, before a long scan, when a task becomes multi-turn, before handling a large artifact, or when imminent context compression could lose operational facts. Use `./tmp/windows-loader/<case-id>/` by default and keep it outside original evidence. Do not wait for a user reminder.

The case directory contains exactly these persistent case artifacts: `session.json`, `notes.md`, `commands.jsonl`, `findings.jsonl`, `secrets.jsonl`, `inspect.json`, `mounts.json`, and `raw/`. Treat optional CLI output fields as extensions; never use them to replace required case-schema fields.

## Gate every state-changing or sensitive step

Read [install-authorization.md](./references/install-authorization.md) before proposing any installation, package action, driver, service, reboot, or download. An approval authorizes only its immutable exact plan ID.

Read [safety-gates.md](./references/safety-gates.md) before presenting route fallbacks, writing anything to original evidence, accessing BitLocker/VSS/DPAPI material, or recording plaintext secrets. Do not change ACLs or add encryption as a side effect.

Never put a secret value on the command line. After the plaintext-risk acknowledgement, use bounded `record-secret --stdin`; do not echo the value or include it in operational command logs.

SECRET_INPUT: BOUNDED_STDIN
COMMAND_LINE_SECRET_VALUE: PROHIBITED

## Finish each turn

Persist case state outside original evidence. End every turn with absolute paths, whether plaintext secrets were written, mount state, exact cleanup status/commands, current hash status, and any confirmation still required. Keep successful mounts until the user asks for cleanup; clean partial failures immediately.

## 适用场景

本技能用于对 Windows 客户机磁盘镜像进行只读挂载、快速分诊、定向证据提取与证据固定，适合在取证实验室、应急响应现场、CTF/取证竞赛初检阶段使用。适用对象包括 raw、dd、img、单段或多段 E01、VHD、VHDX 等离线镜像；不适用于对原始检材写入、执行客户机内程序、绕过未知加密或生成正式鉴定报告的场景。

### 推荐使用场景
- 需要对 Windows 镜像做只读挂载，验证分区、卷、文件系统与关键目录可见性。
- 需要快速定位用户目录、注册表 hive、浏览器数据、邮件客户端、即时通讯、计划任务、服务、Prefetch、事件日志、回收站、快捷方式、下载缓存等落盘痕迹。
- 需要在不执行客户机二进制、脚本、安装器、文档宏的前提下提取指定文件并计算哈希。
- 需要将单个 Windows 镜像纳入多检材证据链，先完成证据固定、路径映射、时间戳记录与跨检材关联表。
- 需要在 WSL、Linux 或 Windows 终端中选择一个稳定环境完成挂载，并避免环境混用导致工具链差异。
- 当任务还涉及网络流量或日志时，可在证据关联阶段扩展核对 ICMP 隐蔽信道等外传痕迹，但原始 Windows 镜像本身仍保持只读。

### 典型触发条件
- 已有明确检材路径、检材格式、分段集合与只读访问条件。
- 已确定哈希策略为 now、later 或 skip，并记录可用哈希算法。
- 已选择 mount-only、fast-path 或 mount-and-analyze 之一。
- 需要建立案例状态目录，保存会话、命令、发现、密钥元数据与导出证据。

### 不适用或需先人工裁决
- 原始镜像未只读、未哈希且无法补正。
- E01 分段缺失、命名歧义或无法规范化为连续段。
- VHD/VHDX 依赖未知父盘、差分盘或快照链不完整。
- 需要访问 BitLocker、VSS、DPAPI、密码库或明文秘密但未完成安全门授权。
- 需要将交互式案情摘要升级为正式报告；该动作需显式人工裁决，默认不覆盖原文 NO_FORMAL_REPORT 约束。

### 实战陷阱与规避
- 分段 E01 命名不连续：先校验 E01-E99、EAA-EZZ 等序列，缺失或歧义立即停止。
- 动态 VHD/VHDX 缺少父盘：不要猜测父盘路径，要求提供完整磁盘链。
- ACL 拒绝访问：记录为权限错误，不能推定为文件不存在。
- 扫描预算截断：深度和条数受限的扫描不是穷尽扫描，必须在元数据中标注。
- 时间戳混用：区分文件系统时间、注册表时间、日志时间与导出时间，统一记录时区。
- 挂载后误写：所有导出、临时文件、案例状态均写入案例目录，禁止写入原镜像或挂载卷。

## 使用步骤

以下步骤按「先固定、后挂载、再提取、最后闭环」的顺序执行。每一步都应将命令与结果写入案例状态，避免仅凭记忆或截图作答。

### 1. 接案与证据固定
1. 记录检材编号、绝对路径、格式、分段集合、终端类型、任务模式与请求目标。
2. 校验原始证据只读条件：文件权限、写保护设备、镜像挂载选项或宿主文件系统只读属性。
3. 选择哈希策略：
   - now：立即计算并记录 SHA256，必要时补充 MD5 用于重复识别。
   - later：记录延迟原因、责任人与预计补算时间。
   - skip：记录明确授权与风险说明。
4. 使用案例状态初始化命令建立工作目录：
   ```text
   python scripts/case_state.py init --case-dir ./tmp/windows-loader/<case-id> --image <evidence> --hash <now|later|skip> --mode <mount-only|fast-path|mount-and-analyze>
   ```
5. 将检材元数据、哈希策略、可用算法、分段校验结果写入 session 与 inspect 输出。

### 2. 终端路由与环境预检
1. 仅识别当前终端一次，并从 Windows、Linux、WSL 中选择一个参考路径，不自动切换、不混用适配器。
2. 若当前环境缺少必要驱动、权限或工具，停止并提出明确的人工处理请求。
3. 在 WSL 中如遇无法安全挂载的情况，只提示用户切换到 Windows 终端，不代为重启或切换。

### 3. 镜像预检与分段规范化
1. 对 raw、dd、img、E01、split E01、VHD、VHDX 进行头部与格式识别。
2. 对 split E01 按 E01-E99、EAA-EZZ、FAA-FZZ 等规则校验连续性，并规范化为首段入口。
3. 发现缺失段、歧义段或哈希不一致时停止，并将异常记录到 findings。
4. 对 VHD/VHDX 检查是否动态盘、差分盘或快照链；缺少父盘时不得继续猜测。

### 4. 只读挂载与挂载验证
1. 按所选终端的挂载参考执行只读挂载，禁止使用可写挂载或自动修复文件系统。
2. 挂载后验证：
   - 挂载点路径与卷标识。
   - 文件系统类型、卷大小、可用分区与系统盘符。
   - 只读状态与关键目录可读性。
3. 将挂载结果写入 mounts 状态；成功挂载应保持到用户要求清理，部分失败立即清理。

### 5. 有界枚举与高价值路径扫描
1. 先运行高价值目录清单扫描，再决定是否扩展扫描。
2. 默认深度 4、条数上限 50，不跟踪 reparse point，避免被符号链接、junction、挂载点引入不可控路径。
3. 对 ACL 拒绝路径记录错误；对预算截断的扫描标注非穷尽。
4. 优先检查：
   - C:/Windows/System32/config 下的 SAM、SECURITY、SOFTWARE、SYSTEM。
   - C:/Users/<user>/NTUSER.DAT、AppData、Downloads、Desktop、Documents。
   - 浏览器缓存与历史、邮件客户端、即时通讯目录、计划任务、服务、Prefetch、事件日志、回收站。
5. 如需扩展，必须获得显式 --expand 授权，并仍限制在目录清单根内。

### 6. 定向提取与证据固定
1. 仅提取任务指定或用户确认的目标文件，避免无差别全量导出。
2. 导出文件统一放入案例目录 raw/，保留来源路径映射与提取时间。
3. 对每个导出文件计算 SHA256，必要时计算 MD5；记录来源镜像、来源路径、导出路径、哈希、命令与操作者。
4. 对注册表、日志、数据库等复合证据，记录解析方式、时间转换方式与字段来源。
5. 不得在命令行中传递密码、恢复密钥、令牌等秘密；确需记录时使用标准输入方式并只保留元数据。

### 7. 多源证据关联与闭环验证
1. 建立统一证据表，至少包含检材来源、文件路径、数据库表、字段值、时间戳、哈希、验证方式、关联账号、结论、置信度。
2. 对每个结论记录来源文件、命令输出、哈希值、挂载或解密结果、时间转换方式与多源验证依据。
3. 对跨检材场景建立关联表，覆盖检材 ID、证据类型、文件路径、哈希、时间戳、账号、密码或密钥复用、聊天内容、数据库记录、流量命中与结论。
4. 对可疑外传或隐蔽信道线索，如另有流量或日志检材，执行扩展核验：
   - 筛选 ICMP Echo Request 与 Echo Reply。
   - 导出 payload，并按任务规则拼接首字符、固定偏移字段或完整字符串。
   - 验证拼接结果是否为可识别文本、凭据、文件片段或外传数据。
   - 将命中时间、源目地址、载荷哈希、拼接规则与对应磁盘证据写入关联表。

### 8. 安全门与敏感操作
1. 任何安装、驱动、服务、重启、下载或包管理动作必须先提交不可变计划并取得批准。
2. 访问 BitLocker、VSS、DPAPI、密码库或明文秘密前必须完成安全门确认。
3. 不改变 ACL，不向原证据添加加密、标记或附属文件。
4. 如需要解密或恢复密钥，先记录密钥来源、授权方式与输入方式，再执行只读解析。

### 9. 收尾与清理
1. 保存案例状态到原证据之外。
2. 输出绝对路径、挂载状态、清理命令、哈希状态、秘密写入标志与仍需确认事项。
3. 成功挂载保留至用户要求清理；失败或部分失败立即卸载并清理临时挂载点。
4. 将最终发现写入 findings，并标注是否已完成证据闭环。

## 输入输出说明

### 输入说明
#### 必填输入
- 证据路径：原始镜像在当前终端中的绝对路径。
- 证据格式：raw、dd、img、E01、split E01、VHD、VHDX 之一。
- 分段集合：split E01 必须提供可连续规范化的段列表。
- 当前终端：Windows、Linux 或 WSL，且只选择一个参考环境。
- 工作模式：mount-only、fast-path 或 mount-and-analyze。
- 哈希策略：now、later 或 skip，并记录理由与授权。
- 案例标识：用于生成 ./tmp/windows-loader/<case-id>/。
- 任务目标：挂载验证、快速查找、定向提取或关联分析。

#### 可选输入
- 扩展搜索授权：用于启用 --expand，且仍受高价值目录清单限制。
- 时区约定：用于统一显示与记录时间戳。
- 辅助检材：流量包、日志、内存镜像、服务器数据库等，用于跨检材关联。
- 解密材料：BitLocker 恢复密钥、密码、密钥文件等，仅在安全门通过后使用。
- 输出模板需求：证据清单、时间线表、关联表、攻击链路图等。

#### 输入约束
- 原始证据必须保持只读；任何写操作必须落在案例目录。
- 不得执行客户机内二进制、脚本、服务、安装器或宏。
- 不得在命令行参数中传递秘密值。
- 不得将 ACL 拒绝、扫描截断或解析失败解释为证据不存在。
- 不得把可选 CLI 字段替代案例状态必需字段。

### 输出说明
#### 每轮必须输出
- 案例目录绝对路径。
- 当前挂载状态、挂载点与清理命令。
- 哈希状态：已完成、延迟、跳过、算法与结果位置。
- 是否写入秘密元数据，以及是否完成明文风险确认。
- 仍需用户确认的事项与下一步建议。

#### 证据固定输出
- 原始镜像哈希：优先 SHA256，可补充 MD5。
- 导出文件哈希：每个导出文件均应有 SHA256。
- 证据清单：包含检材编号、文件路径、证据类型、提取时间、导出路径、哈希、提取命令、操作者。
- 命令记录：包含关键预检、挂载、扫描、提取、卸载与清理命令。
- 异常记录：缺失分段、哈希不一致、权限拒绝、挂载失败、扫描截断、解密失败等。

#### 统一证据表字段
建议至少包含：
- 检材来源。
- 证据类型。
- 文件路径或数据库表。
- 字段值或摘要。
- 时间戳。
- 哈希值。
- 验证方式。
- 关联账号。
- 结论。
- 置信度。

#### 跨检材关联表字段
建议至少包含：
- 检材 ID。
- 证据类型。
- 文件路径。
- 哈希。
- 时间戳。
- 账号。
- 密码或密钥复用情况。
- 聊天内容摘要。
- 数据库记录。
- 流量命中。
- 结论。

#### 答案闭环模板
每个关键结论应记录：
- 来源文件、镜像或数据库。
- 命令输出或解析结果。
- 哈希值与证据编号。
- 挂载、解密或格式转换结果。
- 时间转换方式与时区。
- 多源验证依据。
- 反证或无法验证项。

#### 扩展可视化输出
- 时间线表：按 UTC 与本地时区双轨记录关键事件。
- 攻击链路图：将落盘文件、账号、计划任务、服务、网络命中与外传痕迹串联。
- 隐蔽信道核验表：记录 ICMP 载荷筛选规则、payload 导出路径、拼接规则、命中结果与对应磁盘证据。

### 输出边界
- 默认输出为交互式案情摘要与结构化证据包，不等同于正式鉴定报告。
- 如需生成正式报告、对外提交模板或竞赛答卷，应显式说明并获得人工裁决；不得自动覆盖原文中不生成正式报告的约束。
- 所有导出文件、表格、日志与临时文件必须位于案例目录，不得写回原始镜像或挂载卷。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
