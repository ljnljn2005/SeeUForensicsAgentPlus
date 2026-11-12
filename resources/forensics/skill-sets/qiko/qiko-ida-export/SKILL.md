---
name: IDA程序静态逆向
display_name: IDA程序静态逆向
name_en: IDA Static Program Reverse
description: >-
  使用 IDA Pro 命令行批量导出二进制反编译数据供 AI 做纯静态逆向。覆盖 PE/ELF/so、恶意样本、取证检材、协议/算法还原。
  严禁在本机直接运行/调试被分析程序，防止中毒。触发词：IDA导出、反编译分析、逆向 exe/dll/so、shellcode、漏洞挖掘、export-for-ai。
description_en: >-
  Batch-export IDA Pro decompilation (strings/imports/exports/pointers/memory/decompile)
  for AI static reverse engineering only. Never execute or debug the target binary on the host.
  Use for PE/ELF/.so analysis, malware, forensics, protocol or crypto recovery.
  Triggers: IDA export, decompile, reverse exe/dll/so, shellcode, vuln hunting, export-for-ai.
version: 3.0.2
---

# IDA Pro 命令行导出 + AI 静态逆向

用本机 **IDA Pro ≥ 9.0（含 Hex-Rays）** 对二进制做**无头静态**分析，导出 `export-for-ai/`，再由 Agent 读产物做结论。优先跑本 skill 自带脚本，禁止猜 IDA 路径。过程文件落在工作区 `work/`，**不要**写到检材旁。

## 安全红线（硬性，不可例外）

本 skill **只做静态分析**。被分析对象（exe / dll / sys / elf / so / shellcode / 脚本包装体等）一律视为**潜在恶意样本**。

| MUST | MUST NOT |
|------|----------|
| 仅用 IDA 无头批处理（`-A` + `INP.py`）加载并导出 | **禁止**在宿主机直接运行样本：`Start-Process`、`&`、双击、`cmd /c`、`Invoke-Item` 等 |
| 只读检材；导出/日志/IDB 写到 `work/` | **禁止**用调试器/加载器**启动**样本（x64dbg、WinDbg 附加后 Continue 跑起来、`CreateProcess` 等） |
| 行为结论只来自 strings / imports / 反编译 / 交叉引用 | **禁止**「先跑一下看看」、沙箱外动态验证、把样本当正常软件安装 |
| 用户要求运行样本时：拒绝，并说明本 skill 仅静态；改走隔离沙箱需人工另开流程 | **禁止**把样本拷到 `%TEMP%` / `Desktop` 后执行；禁止管道喂给 `powershell`/`wscript`/`mshta` 等 |

**允许的例外（不算“运行样本”）**：启动本机已安装的 **IDA / 本 skill 脚本 / 文本编辑器** 去读文件；`file`/`strings`/`sha256sum` 等只读探测。IDA 加载二进制做反汇编 ≠ 在 OS 里执行该程序。

若任务必须动态执行，**停止本 skill 流程**，明确告知风险，不要代为执行。

## ACTION REQUIRED（读完立刻执行）

1. `NOW`：确认样本路径、授权范围（仅授权检材/隔离样本）与当前工作区根；**再次确认：全程不运行样本**
2. `NOW`：`scripts/ida_batch_export.ps1 -Binary <样本> -Workspace <工作区根>`（自动找 IDA + `INP.py`；导出/日志/IDB 进 `work/<样本名>/`）
3. `NEXT`：读 `work/<样本名>/ida_batch.log`，确认 `Export completed!`
4. `ACT`：按下方「分析顺序」读 `work/<样本名>/export-for-ai/`，结论写工作区根并 `present`
5. 结束：给出 3–6 项下一步菜单（继续静态深挖 / 换静态工具 / 写报告 / 暂停）；**菜单中不得建议“本机运行样本”**

## 何时用 / 不用

| 用 | 不用 |
|----|------|
| 需要 Hex-Rays 级反编译 + 批量导出给 AI | 仅 strings/初筛 → `malware-triage` |
| PE/ELF/sys/dll/so（含 APK 内 native）**静态**分析 | 纯 Java/Kotlin APK → `apk-reverse` |
| 登录/加密/协议/C2 逻辑还原（读反编译，不跑样本） | 无 IDA 9+ → 说明限制；可改 Ghidra/radare2（`reverse-engineering`） |
| — | 需要本机/沙箱**执行**样本验证行为 → **本 skill 拒绝**；转人工隔离动态分析 |

## 前置

- IDA Pro **≥ 9.0** + Hex-Rays
- 本目录 `INP.py`（export-for-ai 导出脚本）
- Windows 优先 PowerShell；路径一律绝对路径

## 一键导出（推荐）

```powershell
# -Workspace = 当前 QikoAgent 会话工作区根（检材只读时必传）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ida_batch_export.ps1 `
  -Binary "D:\case\evidence\sample.exe" `
  -Workspace "D:\case\workspace"

# 可选
# -IdaPath "C:\Program Files\IDA Professional 9.1\ida.exe"
# -InpPath "C:\path\to\INP.py"
# -ExportDir / -LogPath / -IdbPath   # 默认均在 work\<样本名>\ 下
# -SkipIfExists
# -AllowBesideBinary   # 仅调试；正式取证禁止
```

脚本会：探测 IDA≥9 → 定位 `INP.py` → 在 `work/<样本名>/` 落 `export-for-ai/`、`ida_batch.log`、`.i64`（`-o`，避免污染检材）→ `-S INP.py <ExportDir>` → 检查成功标志。

未传 `-Workspace` 时默认用当前目录或环境变量 `QIKO_WORKSPACE`；仍会创建 `work/<样本名>/`，**拒绝**把导出写到样本同目录（除非 `-AllowBesideBinary`）。

### 手动命令（脚本不可用时）

```text
"<IDA>\ida.exe" -A "-o<工作区>\work\<样本名>\<样本>.i64" "-S<INP.py> <工作区>\work\<样本名>\export-for-ai" "-L<工作区>\work\<样本名>\ida_batch.log" "<样本>"
```

- 导出目录：环境变量 `QIKO_IDA_EXPORT_DIR`（推荐，中文/空格安全）或 `-S<path\to\INP.py> <ExportDir>`（`ARGV[1]`）
- 中文路径：用包装脚本，避免碎裂引号
- 分析可能数分钟；**以日志成功标志为准**

### INP.py 搜索顺序

1. 本 skill 目录 `INP.py`
2. `<IDA安装目录>/plugins/INP.py`
3. 用户显式指定的路径

## 日志判定（必做）

读 `work/<样本名>/ida_batch.log`：

| 标志 | 含义 |
|------|------|
| `Export completed!` / `Output directory: ...` | 导出完成 |
| `Decompilation Summary:` + Total/Exported/Failed | 反编译统计 |
| `Hex-Rays Decompiler plugin has been loaded` | 反编译器可用 |
| `LoadLibrary... error` / `No module named 'yara'` / `Could not find PDB` | 可忽略 |
| 无 `Export completed!` | 检查 `-S` 与 `ARGV[1]` 导出路径后重跑 |
| 无 Hex-Rays 加载行 | IDA 版本/许可不含反编译器 |
| 日志突然中断 | 加壳/损坏/崩溃 → 建议 GUI 打开确认 |

`Failed: N>0` 时可继续分析，并注明失败函数数。

## 产物结构

默认：`<工作区>/work/<样本名>/export-for-ai/`

| 文件/目录 | 用途 |
|-----------|------|
| `strings.txt` | 字符串（地址/类型） |
| `imports.txt` / `exports.txt` | 导入/导出 |
| `pointers.txt` | 指针与目标分类 |
| `decompile/*.c` | 反编译（头含 callers/callees） |
| `function_index.txt` | 函数索引与调用关系 |
| `memory/*.txt` | 段 hexdump（1MB 分片） |
| `decompile_failed.txt` / `decompile_skipped.txt` | 失败/跳过 |
| `.export_progress` | 断点续导 |

同级还有 `ida_batch.log`、`<样本>.i64`（分析库，非交付物）。

## 分析顺序

1. **strings.txt** — 密钥/URL/错误提示/协议关键字 → 记地址  
2. **imports.txt** — CryptoAPI/WinInet/socket/注册表等 API  
3. **function_index.txt** + 字符串 xref — 定位关键函数 `.c`  
4. **decompile/*.c** — 还原算法/登录/C2；交叉核对 callers  
5. **pointers.txt / memory/** — 全局标志、表、硬编码块（偏移 = VA − ImageBase；x64 PE 常 `0x140000000`，x86 常 `0x400000`）

详细检查清单与输出模板见 [reference.md](reference.md)。

## 产物落盘规范（QikoAgent）

与宿主系统提示一致，路径相对**当前会话工作区根**：

| 类型 | 落盘位置 |
|------|----------|
| 交付物（结论、报告、答案） | 工作区根，语义化文件名（如 `逆向分析.md`） |
| 过程文件（IDA 导出、日志、IDB、临时脚本） | `work/<样本名>/` |
| 最终产物登记 | 写好后调用 `present`；只在回复里写路径不会进入「最终产物」 |

- **检材只读**：禁止在检材子目录新建/修改/删除/移动；禁止把 `export-for-ai` / `.i64` / 日志写到样本同目录。
- **禁止写入** `.qikoagent/`（会话状态）以及残留的 `.qikoclaw/`。
- 智能答题案件：正式报告优先案件 `output/`；`os/` 只读，勿写 `import/`。
- 用户指定路径时以用户为准。

## Pitfalls

1. **绝不运行样本**（含“用户说可以跑”）：本机执行 = 中毒风险；只静态读导出物  
2. 必须读 `ida_batch.log`，不能仅凭目录存在判成功  
3. `-S` 须带导出目录参数；中文路径用包装脚本  
4. 编码：GBK/UTF-8 混用时显式指定 encoding  
5. 断点续导依赖 `.export_progress`；完整重导可删 `work/<样本名>/export-for-ai`  
6. 批处理模式 `INP.py` 不应弹 GUI（本 skill 已禁 `info` 弹窗）  
7. 加壳样本：用静态脱壳/初筛（`malware-triage` 等），**不要**靠运行样本“自动脱壳”  
8. 勿用 `-AllowBesideBinary` 处理挂载检材  
9. 不要把 IDA Debugger / remote debugger 配成“运行到入口再观察”；本 skill 不走动态调试链路  

## 关联技能

- 样本初筛：`malware-triage`
- 通用方法论：`reverse-engineering`
- APK Java 层：`apk-reverse`（native `.so` 再回到本 skill）

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
