# 本机 LovelyMem / LovelySpark CLI

复用现有 shell 工具与技能发现机制，只增加一个纯 Node 调用器和两个按需技能。
无新增 npm/Python 依赖、服务、端口或 MCP 工具 schema；不打包取证程序本体。
桌面版与 `npm run dev:web` 均自动提供调用器路径和 Node 运行时，无需用户另外安装 Node。
LovelyMem 必须是支持 `--cli` 的 V3，旧版 Lite/Luxe GUI 不能代替。

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
本机只找到 LovelyMem Lite/Luxe，未发现可验证的 V3 CLI；LovelyMem 的调用契约、partial、参数与产物目录目前由子进程夹具验证，仍需配置实际 V3 路径进行实机验证。
