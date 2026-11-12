# 本机 LovelyMem / LovelySpark CLI

复用现有 shell 工具与技能发现机制，只增加一个纯 Node 调用器和两个按需技能。
无新增 npm/Python 依赖、服务、端口或 MCP 工具 schema；不打包取证程序本体。
桌面版与 `npm run dev:web` 均自动提供调用器路径和 Node 运行时，无需用户另外安装 Node。
本接入使用 LovelyMem V3 的 `--cli` 协议。本机 Luxe 2.5.0 实测该参数会启动 GUI，
未返回 CLI 结果，不能直接配置为本协议的替代程序；这不代表其付费授权或桌面分析功能失效。

## 设置与调用

项目目录里运行：

```powershell
npm run lovely -- status
npm run lovely -- configure lovelymem 'D:\Tools\LovelyMem\lovelymem.v3.exe'
npm run lovely -- configure lovelyspark 'D:\Programs\LovelySpark\lovelyspark.exe'
npm run lovely -- lovelymem -- doctor
npm run lovely -- lovelyspark -- --version
```

会话里的 PowerShell 使用应用注入的环境变量（桌面打包版同样适用）：

```powershell
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI status
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI configure lovelymem 'D:\Tools\LovelyMem\lovelymem.v3.exe'
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelymem -- run --engine starmem --image 'D:\case\memory.mem' --plugin pslist
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelyspark -- analyze 'D:\case\capture.pcapng'
```

可执行文件解析顺序：`SEEU_LOVELYMEM_EXE` / `SEEU_LOVELYSPARK_EXE` 环境变量 →
`<DSH_HOME>/lovely-cli.json` → PATH → 少数常见安装目录。
环境变量或配置指定了失效路径时明确报错，不静默换用别的版本。配置每次调用重读，无需重启。
可用 `SEEU_LOVELY_CONFIG` 指定配置文件。
独立命令行未设置 DSH_HOME 时使用 `~/.dsh/lovely-cli.json`；要与桌面共享设置，先把 DSH_HOME
设为 `%APPDATA%\SeeUForensicsAgentPlus\dsh-home`（开发预览默认是项目 `.dev/dsh-home`）。

参数 `--` 前属于调用器：`--timeout <秒>`（Mem 默认 1800，Spark 600，上限 86400）、
`--max-chars <字符>`（stdout 默认 2000，上限 8000，stderr 至多 500）。后面逐项透传原生 argv，
不用 shell 拼接命令。LovelyMem 自动补 `--cli`；run/native 未指定 output-dir 时写入独立产物目录。
超时或 Ctrl+C 会终止这次调用的进程树，并返回状态；需要更长执行时间时同时检查原生 CLI 自己的 timeout 参数。

## 上下文与结果

启动时只发现两个简短技能描述；具体用法与单个工具 schema 在需要时读取。
不改系统 persona，也不把整个插件目录常驻模型上下文。
`<工作区>/lovely-runs/<工具>-<唯一ID>/` 保存 request.json、stdout.txt、stderr.txt、result.json。
进程直接向文件写输出，不把海量取证结果缓存在内存。
返回 JSON 包括退出码、耗时、运行状态、原始输出路径、字节数、限长头尾预览和截断标记。
小 JSON 信封（≤1 MiB）会提取 `db_path` / `run_dir`；更大信封按原始文件路径局部检索。
`runDir` 是调用记录目录，`run_dir` 是 LovelyMem 返回的产物目录，两者不可混用。
LovelyMem 的 partial / exit 5 保留为部分结果；显式 ok=false / success=false / error/failed 状态不会标为成功。
不把预览当作完整结果：后续缩小原生查询、分页或局部读取文件。日志包含原始输出，应按案件数据保管。

## 验证

`npm run test:lovely` 使用真实子进程夹具覆盖参数透传、中文/空格路径、输出截断、完整落盘、
超时与取消、缺失程序、失败信封和 partial。`npm run build` 与 `npm run check:overlay` 验证应用接入。
CLI 脚本通过 `asarUnpack` 使用真实路径，可用随包 Electron Node 模式或回退的系统 Node 执行。
真实取证需要目标程序版本、有效许可证和检材；发现程序路径不等于许可证/分析已验证。

2026-11-11 开发验证：15 项自动测试通过（含开发/asar 路径与 dsh 子进程环境过滤），构建、overlay 检查、开发态与打包目录版的桌面启动检查通过。
已确认 CLI 与两份技能进入打包产物；随包 Electron Node 模式成功调用本机 LovelySpark。
本机 LovelySpark 0.3.20 已通过版本、单工具 schema、合成 ARP 抓包 analyze → 复用 db_path 调用 module_list；
17,200 / 24,314 字节原始结果均完整落盘，预览按设置截断。

2026-11-12 补充实机验证：核对 C/D/E/F 盘、Everything 索引及现有程序的版本信息后，
原有安装仅确认到 Lite/Luxe 2.5.0；旧项目记录中的 `E:\CTFTools\…\lovelymem.v3.exe` 当前不存在。
根据 LovelyMem 官方仓库 README 提供的 V3 下载地址，另行保存 V3 3.1.11 到
`D:\Programs\Lovelymem\V3\lovelymem.v3.exe`，原有 Lite/Luxe 保持原样。

本机独立命令行、开发预览和桌面版的 `lovely-cli.json` 均已配置：

| 工具 | 本机程序 |
| --- | --- |
| LovelyMem 3.1.11 | `D:\Programs\Lovelymem\V3\lovelymem.v3.exe` |
| LovelySpark 0.3.20 | `D:\Programs\LovelySpark\lovelyspark.exe` |

LovelyMem 的 `version` 和 `help` 已经由真实程序成功返回，原生参数契约与接入层一致；
随包 Electron Node 模式也已成功调用 LovelyMem 并验证版本返回值。
`doctor` 确认 StarMem 内置可用，并找到本机 Python/Volatility3 配置；
但授权检查返回退出码 3：`授权中心尚未收录当前授权，请在桌面端完成账号认领`。
`plugins` / `describe` 同样返回 `license_rejected`；调用器保留原始原因及退出码并正确标记失败。
以上为 CLI 返回的原文，并不能据此认定用户没有授权，或保证重新认领一定能修复。
进一步检查发现，V3 桌面端能够识别原有许可证，而 CLI 的授权中心检查仍然拒绝。
对真实 2 GiB Windows VMware 快照执行 `run --engine starmem --plugin pslist` 也返回同一错误，
尚未进入分析。因此本机 V3 原生 CLI 的实际内存分析仍未通过，不能把 `version` 成功当作分析成功。

同日补充对比实测：

| 检查 | 结果 | 能证明的范围 |
| --- | --- | --- |
| 原 Luxe 2.5.0 的 `--cli version`、`--help` | 均启动 GUI；等待 12 秒仍未自行退出，标准输出和错误输出均为 0 字节 | 不响应本接入所用 CLI 协议；未据此排除其他未公开参数 |
| V3 手动工作台 | StarMem 147 项、Volatility 3 92 项，目录加载成功 | 可见插件目录更丰富；没有逐项验证插件分析成功 |
| 原安装内的 MemProcFS Python API | 同一快照列出 99 个进程，API 内部计时约 3.5 秒 | 原工具链可实际分析该检材；这是直接引擎调用，不是 Luxe 可执行文件的 CLI |
| 原安装内的 Volatility 3 | 同一快照运行进程列表，180 秒无结果后停止 | 此限时测试未通过；没有授权拒绝信息，不能推断许可证失效 |

引擎测试未接入自动回退，也不会将 MemProcFS 的成功标记为 LovelyMem 原生 CLI 成功。
快照文件大小与修改时间在直接引擎测试前后保持一致；未做全文件哈希比对。
