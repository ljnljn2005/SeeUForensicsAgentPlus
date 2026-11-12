---
name: thunder-app-analysis
description: 当用户要求分析 APK、XAPK、IPA、小程序包、iOS 隐私报告、URL 等移动应用证据，查询包名、权限、第三方 SDK、加固或源码时使用。也适用于查询当前连接的设备或其他可用设备，以及执行动态监控、网络抓包和 Frida/Hook 定向分析，包括观察加解密参数、Key/IV、明文与密文、哈希、数据库操作、Native/JNI 调用、TLS Pinning 等运行数据。该 skill 使用 thunder-app-cli 连接 Thunder-App-Analysis 后端，提供案件、证据、设备、静态分析和动态分析能力。
---

# Thunder App CLI

Use `thunder-app-cli.exe` to interact with a running `Thunder-App-Analysis` backend service.

## Executable Path Rule

Every command MUST start with the resolved `thunder-app-cli.exe` path wrapped in double quotes (`"`).

Resolve the executable path in this order:
1. Use the `thunder-app-cli.exe` in the same directory as this `SKILL.md` when available.
2. If `./thunder-app-cli.exe` exists in the current directory, use `"./thunder-app-cli.exe"`.
3. If none of these paths works, ask the user for the absolute path.

Verify the CLI by running the resolved `thunder-app-cli.exe` with the `--help` flag.

Default backend endpoint: `http://127.0.0.1:9112`.

## Requirements

- The master backend must already be running.
- Do not invent CLI results. Base every answer on the JSON returned by the command.

## Command Reference

Run the resolved CLI with `--help` to see all available commands and flags. Help output is the source of truth for supported commands:

```shell
"./thunder-app-cli.exe" --help
"./thunder-app-cli.exe" <command> --help
"./thunder-app-cli.exe" <command> <subcommand> --help
```

Use `--server` only when the backend is not on the default endpoint.

## Syntax

Flags use long options:

```shell
"./thunder-app-cli.exe" case detail --cid 1
```

Quote paths and values that contain spaces:

```shell
"./thunder-app-cli.exe" evidence add --cid 1 --file "D:\samples\test app.apk"
```

Durations use Go-style values:

```shell
"./thunder-app-cli.exe" --timeout 60s evidence add --cid 1 --file "D:\samples\test.apk"
```

## Targeting

- Cases are targeted by `cid`.
- Evidence apps are targeted by `cid` plus `aid`.
- Static analysis queries are targeted by `cid` plus `aid`.
- Unpack operations are targeted by `cid` plus `aid`.
- Source decompile is targeted by `cid` plus `aid`.
- Dynamic monitoring is targeted by `cid` plus `aid`; `tid` optionally selects one monitoring task.
- Network capture is targeted by `cid` plus `aid`; `tid` optionally selects one capture task.
- Frida operations are targeted by `cid` plus `aid`; `tid` identifies one Frida task and its runtime output.
- Most evidence and analysis operations require an opened case context in master. Run `case open --cid <cid>` before adding evidence or preparing later analysis tasks.
- `case open --cid <cid>` changes the current case inside master.
- `case open --case-path <case_db_path>` opens a known `.taac` case database path; prefer `--cid` when the case ID is known.
- `device select --id <device_id>` changes the current selected device inside master.
- `device disconnect` clears the current selected device inside master.
- `evidence add --file <path-or-url>` passes a local path or downloadable URL to master. Local paths must be accessible to the master process; this is not a file upload.
- APK unpacking requires a selected Android device that satisfies the backend unpacking requirements. IPA unpacking requires a selected iOS device that satisfies the backend unpacking requirements.
- Dynamic monitoring requires supported Android/iOS app evidence and a selected compatible device with ROOT or jailbreak privileges. A running analysis task may temporarily block startup.
- Network capture requires compatible evidence and a selected device. Android capture modes require ROOT; iOS proxy capture requires the user to configure the returned master proxy address and trust its certificate.
- Frida execution requires supported Android/iOS app evidence and a selected compatible device with ROOT or jailbreak privileges. It does not require completed static analysis, but another running analysis task may block startup.

## Output Handling

All commands return JSON with this shape:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

On failure:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Failure message",
    "suggestion": "Optional suggestion"
  }
}
```

Rules:

- Treat `success=true` as the only success signal.
- If `success=false`, report `error.code`, `error.message`, and `error.suggestion` when present.
- For paginated outputs, `page` is the current page, `pageSize` is the requested maximum page size, `count` is the number of items returned in the current page, and `total` is the total number of matching items. If `hasMore` is present, use it to decide whether another page is available.
- Do not parse human text from stderr/stdout when JSON fields are available.
- Summarize only fields returned in `data`; do not infer missing values.

## Quick Examples

These examples show command shape only. Use the decision workflow below to choose the correct command for the user's intent.

```shell
"./thunder-app-cli.exe" health
"./thunder-app-cli.exe" case current
"./thunder-app-cli.exe" evidence list --cid 1
"./thunder-app-cli.exe" evidence add --cid 1 --file "D:\samples\test.apk" --evidence-no "EV-001"
"./thunder-app-cli.exe" analysis basic --cid 1 --aid 2
"./thunder-app-cli.exe" analysis detail --cid 1 --aid 2
"./thunder-app-cli.exe" unpack start --cid 1 --aid 2
"./thunder-app-cli.exe" --timeout 5m source decompile --cid 1 --aid 2
"./thunder-app-cli.exe" dynamic overview --cid 1 --aid 2
"./thunder-app-cli.exe" capture overview --cid 1 --aid 2
"./thunder-app-cli.exe" device list --refresh
"./thunder-app-cli.exe" device info
```

## Decision Workflow

When the user asks whether Thunder is available:

1. Run `health`.
2. If it fails with a connection error, tell the user to start master and confirm port `9112`.

When the user asks to list or inspect cases:

1. Run `case list` or `case detail --cid <cid>`.
2. Report returned case IDs, case names, numbers, and paths.
3. Do not treat `case list` as an evidence/app list; use `evidence list --cid <cid>` for complete evidence apps.

When the user asks whether a case is already open:

1. Run `case current`.
2. Treat `data.opened=true` as the current opened case signal.
3. If `data.opened=false`, tell the user there is no opened case in master.

When creating a case:

1. `case create` requires `--name`, `--case-no`, and `--case-path`.
2. Use `--case-path` as the save root directory, not a `.taac` file path.
3. Use `--username`, `--investigator`, `--description`, or `--remark` only when the user provides those values.
4. The returned `casePath` is the generated backend database file path.

When the user provides supported app evidence and an existing case ID:

1. Run `case current`.
2. If `data.opened=true` and `data.cid` matches the target case ID, continue.
3. Otherwise run `case open --cid <cid>`.
4. Run `evidence add --cid <cid> --file "<path-or-url>"`.
5. Add `--name` or `--app-type` only when the user provided an evidence display name or app type.
6. Report `cid`, `aid`, app name, package name, platform, and analysis status if present.

When the user provides supported app evidence but no case:

1. Run `case current`.
2. If `data.opened=true`, use that case unless the user asked for a different one.
3. Otherwise run `case list` to find existing cases.
4. If there is no clear target case, ask the user for the case to use or the case name/number/path to create.
5. Do not add evidence until a case target is known.

When the user asks for one evidence record or full evidence metadata:

1. Identify the target `cid` and `aid`; use `evidence list --cid <cid>` when the app ID is unknown.
2. Run `evidence detail --cid <cid> --aid <aid>`.
3. Use `analysis basic --cid <cid> --aid <aid>` instead when the user asks for normalized app identity fields such as package name or app version.

When the user asks for package name, Application ID, app name, app version, evidence number, file size, or analysis status:

1. Identify the target `cid` and `aid`; use `evidence list --cid <cid>` when the app ID is unknown.
2. Run `analysis basic --cid <cid> --aid <aid>`.
3. For Android APKs, treat `data.basic.package_name` as the Application ID / package name.
4. Do not use `analysis detail` for package name or Application ID unless `analysis basic` is unavailable.

When the user asks for app static detail, hashes, signatures, Activity, hardening, dex, or so files:

1. Identify the target `cid` and `aid`; use `evidence list --cid <cid>` when the app ID is unknown.
2. Run `analysis detail --cid <cid> --aid <aid>`.
3. Answer from `data.detail` only.

When the user asks for static permissions:

1. Identify the target `cid` and `aid`.
2. Run `analysis permissions --cid <cid> --aid <aid>`.
3. Use `--level D` for dangerous permissions, `--level S` for signature permissions, or `--sensitive-only` for both.
4. Add `--keyword` to search permission names/descriptions and `--limit` to control returned item count.
5. Report `all_counts`, `filtered_counts`, `total`, and returned `items`.

When the user asks for third-party services, SDKs, packer/provider, suspected forensic values, or third-party clues:

1. Identify the target `cid` and `aid`.
2. Run `analysis third-party --cid <cid> --aid <aid>`.
3. Use `--category provider`, `--category sdk`, `--category suspected`, or `--category clue` when the user asks for a specific type.
4. Add `--keyword` to search returned provider/SDK/clue text and `--limit` to control returned item count.
5. Report results grouped by `provider`, `sdks`, `suspected_sdks`, and `clues`.

When the user asks to unpack, dump, or extract runtime APK/IPA code:

1. Identify the target `cid` and `aid`; use `evidence list --cid <cid>` when the app ID is unknown.
2. Check `device info` if the user has not confirmed a usable device.
3. Run `unpack start --cid <cid> --aid <aid>`.
4. If `data.started=true`, report returned `tid`, `status_name`, `platform`, `precheck`, and `next`.
5. If `data.skipped=true`, report `precheck.reason` and `precheck.suggestion`; do not retry `unpack start` unless the user explicitly asks to force it. If they do, add `--force`.
6. Use `unpack files --cid <cid> --aid <aid>` when the user asks for produced files or after the task is expected to have completed.
7. Use `unpack stop --tid <tid>` only when the user asks to stop a running unpack task.

When the user asks to decompile APK source or inspect code structure:

1. Identify the target `cid` and `aid`; use `evidence list --cid <cid>` when the app ID is unknown.
2. Run `source decompile --cid <cid> --aid <aid>`; use a larger global timeout such as `--timeout 5m` for large apps.
3. If `data.supported=false`, report `unsupported_reason` and do not fabricate source results.
4. If `data.decompiled=true`, report `tree_count`, `root`, `top_nodes`, `warnings`, and `next`.
5. Use the returned `root` and `top_nodes` with the agent's own file search/read tools to inspect decompiled source files.
6. Use `source stop --aid <aid>` only when the user asks to stop source decompilation.

When the user asks to dynamically monitor an app or analyze runtime behavior:

1. Identify the target `cid` and `aid`; import the evidence first if needed.
2. Use `dynamic overview --cid <cid> --aid <aid>` for readiness, current progress, or the latest monitoring summary. It does not start or stop a task.
3. Run `dynamic start --cid <cid> --aid <aid>` only when the user asks to perform or start dynamic monitoring.
4. If `data.started=false`, report `preflight.status`, failed checks, and `user_message`; do not repeatedly retry while the prerequisite or blocking task is unchanged.
5. Use `dynamic results --cid <cid> --aid <aid>` to read behavior records. Add `--tid` for a specific task, `--item-number` for precise server-side filtering, or `--category`/`--keyword` for exploratory analysis.
6. Treat `scan_limited=true` and `boundaries` as incomplete-result warnings. Prefer `--item-number` when exact pagination is required.
7. Use `dynamic stop --cid <cid> --aid <aid>` only when the user asks to stop monitoring. Do not attempt to stop a dynamic child task owned by automatic analysis.

When the user asks to capture or analyze app network traffic:

1. Identify the target `cid` and `aid`; import the evidence and select a compatible device first if needed.
2. Use `capture overview --cid <cid> --aid <aid>` for readiness, current progress, packet counts, and grouped summaries. It does not start or stop a task.
3. Run `capture start --cid <cid> --aid <aid>` only when the user asks to start capture. Use `--mode` only when the user requests a specific mode.
4. If `proxy_setup.status=proxy_ip_required`, ask the user to choose one returned candidate and retry with `--mode proxy --proxy-ip <ip>`.
5. If `proxy_setup.status=proxy_configuration_required`, report its IP and port. After the user explicitly confirms the iOS proxy and certificate setup, retry with `--mode proxy --proxy-ip <ip> --proxy-port <port> --proxy-ready`.
6. Use `capture results --cid <cid> --aid <aid>` to inspect packets. Add filters for focused analysis and `--include-content` only when request or response content is needed.
7. Treat `scan_limited=true` and `boundaries` as incomplete-result warnings.
8. Use `capture stop --cid <cid> --aid <aid>` only when the user asks to stop capture. Do not stop a capture child task owned by automatic analysis.

When the user asks to observe targeted runtime values or behavior with Frida/Hook:

1. Use Frida for specific runtime parameters, return values, call stacks, cryptographic data, database operations, Native/JNI calls, or runtime bypasses. Prefer `dynamic` for broad behavior observation and `capture` for ordinary network traffic.
2. Identify the target `cid` and `aid`, then run `frida catalog --cid <cid> --aid <aid> --goal "<the user's original goal>"` and select the smallest necessary set of returned stable capability IDs.
3. Do not guess script IDs. Treat `fallback_only=true`, behavior-changing hooks, keys, certificates, and plaintext capture as risk signals that must be explained before execution.
4. Use `frida start ... --dry-run` when the user asks for a plan or when risk needs confirmation. Run `frida start` without `--dry-run` only when the user explicitly requests execution.
5. For a custom script, register a local `.js` file with `frida add --file "<local-path>"`, then use the returned `custom:<id>` capability ID.
6. After startup, ask the user to perform the target app action. Use `frida results --tid <tid>` only when live output needs to be inspected; while the task is running, `eof=true` means only that the current end of the log has been reached.
7. When the user explicitly asks to stop, run `frida stop` immediately. Do not read output first unless the user explicitly asks to inspect live output before stopping. After the task is stopped, read and analyze the completed log when required by the current workflow, continuing from `next_offset` until `eof=true`.
8. `frida status` reports only a currently running task. Do not infer success merely from an empty log.

When the user asks to list available devices:

1. Run `device list --refresh`.
2. Report returned device IDs, names, OS, root status, and device type when present.
3. If the user wants to use one device, run `device select --id <device_id>`.

When the user asks about selected device state:

1. Run `device info`.
2. If the command fails with `NO_DEVICE_SELECTED`, run `device list --refresh` and ask the user which device ID to select if needed.
3. Use `device disconnect` only when the user asks to clear or disconnect the currently selected device.

When the user asks for a command group that is not shown by `--help`:

1. Run the relevant `--help` command if useful.
2. If the command is not available, say that the current CLI does not expose that command yet.
3. Do not fabricate a command.

## Response Rules

- Keep replies concise and action-oriented.
- Include the command outcome and the important returned identifiers.
- For successful case operations, mention `cid`, `caseNumber`, `name`, and `casePath` when present.
- For successful evidence operations, mention `cid`, `aid`, `appName`, `pkgName`, `appOs`, `fileFmt`, and `analysis` when present.
- For app basic information, mention `app_name`, `package_name`, `app_version`, `evidence_number`, `file_id`, and `analysis` when present.
- For static permission results, `D` means dangerous, `S` means signature, `N` means normal, and `O` means other.
- For unpack start results, mention `started`, `skipped`, `precheck.reason`, `precheck.hardening_name`, `tid`, `status_name`, `platform`, and `next` when present.
- For unpack file results, mention `count` and summarize returned file `type`, `name`, `path`, and `size_text`.
- For source decompile results, mention `supported`, `decompiled`, `tree_count`, `root`, `warnings`, and `next` when present.
- For dynamic monitoring, mention `started` or `stopped`, `tid`, `preflight.status`, `current_task.state`, `total_behaviors`, relevant categories, and result boundaries when present.
- For network capture, mention `started` or `stopped`, `tid`, `mode`, `preflight.status`, `proxy_setup`, packet counts, relevant groups, and result boundaries when present.
- For Frida, mention the selected capability IDs, plan warnings, `preflight.status`, `tid`, running/stopped state, and raw-log boundaries. Distinguish observed output, script errors, and no output.
- If `unsupported` or `boundaries` is returned, state it directly and do not infer missing analysis data.
- For failures, report the exact `error.code` and `error.message`.
- If the backend connection is refused, tell the user to start master and confirm the port is `9112`.

## 适用场景

本技能面向移动应用取证与逆向工程场景，核心是通过 `thunder-app-cli` 调用 Thunder-App-Analysis 后端，对 APK、XAPK、IPA、小程序包、iOS 隐私报告、URL 等移动应用证据进行可复现分析。当分析延伸到 native 库、PE/ELF/Mach-O、Go 二进制、容器/分区/数据库解锁、密钥还原时，应遵循只读取证与授权边界；若委托范围仅限移动应用证据，扩展到桌面或服务端二进制需标记待人工裁决。

### 典型对象
- 移动应用包：APK、XAPK、IPA、小程序包、应用备份、下载链接。
- 应用元数据：包名、版本、签名、哈希、权限、组件、SDK、加固、资源、配置文件。
- 运行行为：加解密参数、Key/IV、明文/密文、哈希、数据库操作、Native/JNI 调用、TLS Pinning、网络请求。
- 派生二进制：so、dex、jar、PE、ELF、Mach-O、Go 程序、脚本、配置文件。
- 解锁目标：加密容器、磁盘分区、数据库、备份包、压缩包，前提是有合法授权与只读副本。

### 适合执行的任务
1. 静态审查：检查包结构、权限、第三方 SDK、加固特征、签名与哈希、字符串、资源、配置、native 依赖。
2. 源码级分析：反编译 APK，查看类结构、方法调用、常量、配置文件、JNI 注册点和 native 方法。
3. 动态取证：在受控设备上启动监控，观察运行时行为、数据库访问、加密调用、网络通信和关键参数。
4. 密钥提取：从内存、导出函数、JNI、配置文件、native 常量中只读还原密码、Key、IV、salt、token。
5. 算法识别：确认 AES、SM4、DES/3DES、RSA、HMAC、SHA、MD5、Base64、Hex 等算法、模式、填充和参数来源。
6. 解锁验证：将还原出的密钥参数用于副本解密、分区挂载、数据库打开或容器解锁验证，不得直接改写原始证据。
7. 二进制辅助：对 PE 关注编译器、节区、入口点、导入表、字符串、资源与加密 API；对 Go 关注符号恢复、版本兼容与字符串提取限制。

### 常见陷阱与边界
- 仅凭字符串命中不能认定加密算法或密钥，必须结合调用栈、交叉引用、运行输出或解密验证。
- 加固、混淆、VMP、壳特征可能互相伪装，应结合权限、so、dex、签名、资源和动态行为交叉判断。
- 密钥可能只存在于内存、Keystore、TEE、Secure Enclave 或服务端，不能假设必然可提取。
- 动态 Hook、抓包、脱壳、调用导出函数可能改变程序状态，必须先做风险评估、备份和授权确认。
- 若后端不可用、设备不满足 ROOT/越狱要求、命令返回 unsupported 或 boundaries，应如实报告，不推断缺失数据。

## 使用步骤

### 0. 工作原则
- 先授权、再固定、后分析；所有操作以只读取证为默认。
- 先静态后动态，先低侵入后高侵入；动态调试、Frida、抓包、脱壳、gdb 调用函数前必须确认风险。
- 所有 `thunder-app-cli` 结果以 JSON 的 success、data、error 为准；出现 unsupported、boundaries、scan_limited 时明确说明。
- 密钥、密码、IV、salt、token 只记录来源与用途，不扩大传播；验证解密必须使用副本或镜像。

### 1. 环境准备与案件上下文
1. 检查后端：运行 `./thunder-app-cli.exe health`；失败时确认 master 已启动且默认端口为 9112。
2. 确认案件：运行 `case current`；未打开时用 `case list` 查找，再用 `case open --cid <cid>` 打开。
3. 新案件：仅在用户提供名称、案件编号、保存目录后执行 `case create`，并记录返回的 cid 与 casePath。
4. 设备准备：运行 `device list --refresh`、`device info`；Android 动态监控与抓包通常需要 ROOT，iOS 代理抓包需要配置代理并信任证书。
5. 工具选择：APK/IPA 优先使用 Thunder-App-Analysis 的静态、动态、抓包、Frida 能力；native、PE、Go 二进制再引入 IDA、Ghidra、BinaryNinja、strings、gdb 等外部工具。Go 程序需注意 IDA 版本兼容、BinaryNinja 替代方案和字符串恢复限制。

### 2. 证据导入与基线固定
1. 导入证据：运行 `evidence add --cid <cid> --file <path-or-url>`；必要时补充证据名称或应用类型。
2. 基线信息：运行 `analysis basic --cid <cid> --aid <aid>`，记录包名、版本、证据编号、文件 ID、分析状态。
3. 静态细节：运行 `analysis detail --cid <cid> --aid <aid>`，记录哈希、签名、Activity、dex、so、加固或异常结构。
4. 权限与第三方：运行 `analysis permissions` 与 `analysis third-party`，识别危险权限、签名权限、SDK、provider、suspected 与 clue。
5. 固定误判基线：不要把包名、版本号、SDK 命中直接等同于恶意或加密能力，需继续交叉验证。

### 3. APK 侧静态反编译与字符串提取
1. 反编译：运行 `source decompile --cid <cid> --aid <aid>`；大样本使用更长超时，并记录 root、tree_count、warnings。
2. 检查重点：包名与 Application ID、AndroidManifest、组件导出、配置文件、assets、resources、native 层、JNI 注册点。
3. 字符串提取：覆盖 dex、so、assets、resources、数据库、脚本、Base64/Hex/UTF-16 编码；对可疑字符串做交叉引用。
4. 脚本逆向：对 JavaScript、Lua、Python、Shell、小程序逻辑包，先定位入口、消息处理、存储调用、加密封装，再与 native 或后端接口对齐。
5. 加密线索：搜索 encrypt、decrypt、cipher、AES、SM4、DES、RSA、HMAC、MD5、SHA、getAeskey、getKey、initCipher、JNI_OnLoad、RegisterNatives。
6. 加固判断：结合壳特征、so 名称、dex 结构、资源异常、权限组合和动态结果，不因单一特征下结论。
7. 需要脱壳时：先 `device info` 检查设备，再 `unpack start --cid <cid> --aid <aid>`；返回 skipped 时报告 precheck 原因，不盲目重试。

### 4. PE 与通用二进制侧逆向路径
1. 范围确认：若当前案件仅限移动应用证据，而需要分析 PE、ELF、Mach-O、Go 服务端样本或容器镜像，先标记待人工裁决。
2. 基础识别：确认文件类型、架构、编译器、入口点、节区、时间戳、导入表、导出表、资源与版本信息。
3. 静态重点：字符串、加密常量、调试符号、配置文件、嵌入资源、脚本、URL、IP、域名、互斥量、注册表或文件路径。
4. 加密识别：定位 Crypt32、BCrypt、NCrypt、OpenSSL、Crypto++、WolfSSL、内置 AES/SM4 S-box、Base64 表、PEM/DER 结构。
5. Go 程序：不要只依赖 strings；结合符号表、模块信息、函数名恢复、IDA/BinaryNinja 支持版本和运行时结构进行判断。
6. 行为推断：结合导入函数、字符串、配置和动态结果还原功能；避免把导入加密 API 直接等同于实际使用。

### 5. 动态监控与网络抓包
1. 状态预检：运行 `dynamic overview --cid <cid> --aid <aid>` 与 `capture overview --cid <cid> --aid <aid>`，确认设备、权限、任务冲突和预检结果。
2. 启动监控：用户明确要求时运行 `dynamic start`；失败时报告 preflight 状态，不在前置条件未变化时反复重试。
3. 行为分析：运行 `dynamic results`，按类别、关键词、item-number 检索加解密、数据库、Native/JNI、文件、网络等记录。
4. 抓包分析：运行 `capture start`；Android 注意 ROOT 与证书信任，iOS 注意代理地址、端口和证书安装；需要内容时使用 `--include-content`。
5. TLS Pinning：出现握手失败、空流量或证书错误时，先记录现象，再评估是否使用 Frida 观察或经授权处理；不得默认绕过安全控制。
6. 边界说明：出现 scan_limited、boundaries、任务阻塞、设备断连时，如实说明结果不完整，不补造数据。

### 6. Frida/Hook 定向密钥提取
1. 目标选择：当需要具体 Key/IV、明文、密文、返回值、调用栈、JNI 参数或数据库参数时，优先使用 Frida 定向观察。
2. 能力检索：运行 `frida catalog --cid <cid> --aid <aid> --goal <用户原始目标>`，选择最小必要能力，不猜测脚本 ID。
3. 风险确认：对 fallback_only、行为修改、证书、密钥、明文捕获等风险项，先解释并可用 `--dry-run` 生成计划。
4. 启动与观察：用户确认后运行 `frida start`；提示用户在设备上触发目标行为；运行中可用 `frida results --tid <tid>` 查看增量输出。
5. 停止与复盘：用户要求停止时立即 `frida stop`；停止后继续读取日志直到 eof，再区分真实输出、脚本错误和无输出。
6. 证据化：记录能力 ID、tid、hook 点、参数、返回值、调用栈、时间戳和边界；密钥材料只写入受控报告或加密存储。

### 7. gdb 动态调试与导出函数调用
1. 适用条件：目标为 native 进程、so、ELF/PE 调试样本，且 CLI/Frida 无法稳定观察关键函数；必须获得授权并备份样本。
2. 只读优先：优先附加进程、查看映射、设置只读断点、检查寄存器和内存，不主动写内存、不修改进程状态。
3. 标准流程：附加进程，定位导出函数或符号，设置断点，观察参数与返回值；必要时调用 getAeskey、decrypt 等函数，但必须先评估副作用。
4. 调用函数要求：记录函数地址、参数类型、调用前后寄存器、返回值、内存缓冲区和 ASLR 基址；调用失败立即停止，避免反复触发反调试。
5. 密钥保存：将返回值或缓冲区保存为十六进制、Base64 或文本，同时记录编码、长度、来源函数和调用条件。
6. 复现验证：用提取的 key、iv、salt、mode、padding 在副本上复现解密或挂载命令；不得在原始证据上直接执行写入或解锁。

### 8. 密钥参数还原与后续解锁
1. 参数闭环：算法、模式、填充、Key、IV、salt、迭代次数、编码方式、输入来源、输出去向缺一不可。
2. 来源标注：标明密钥来自静态常量、配置文件、内存、Frida hook、gdb 返回值、Keystore 导出还是用户输入。
3. 解锁前准备：对容器、分区、数据库、压缩包先制作只读镜像或副本；记录原始哈希与镜像哈希。
4. 验证执行：优先使用离线工具验证；失败时检查编码、字节序、padding、salt、迭代次数、算法实现差异，不要盲目重试。
5. 风险控制：遇到自毁、锁定、密钥派生依赖硬件、服务端校验或多次失败锁定机制时，停止操作并报告。
6. 结果交付：输出可复现的参数、命令、日志摘录和证据链；敏感密钥按需脱敏或放入加密附件。

### 9. 结果固化与误判规避
1. 报告标识：记录 cid、aid、tid、设备、证据编号、包名、版本、哈希、任务状态和结果边界。
2. 交叉验证：静态字符串、反编译代码、动态日志、网络流量、Frida/gdb 输出必须互相印证。
3. 常见误判：字符串命中不等于实际调用；导入加密 API 不等于启用加密；抓包明文不等于无 TLS；hook 到一次调用不等于全量密钥。
4. 不完整处理：对 unsupported、boundaries、scan_limited、设备不满足、任务阻塞、日志截断逐项说明。
5. 合规收尾：确认未修改原始证据、未扩大密钥暴露面、未执行未授权绕过；高风险操作保留用户确认记录。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
