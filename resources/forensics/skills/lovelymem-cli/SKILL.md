---
name: lovelymem-cli
description: 用本机 LovelyMem V3 CLI 分析内存镜像，查询进程、网络与插件产物。
---

通过现有 PowerShell 工具调用；运行器自动添加 `--cli`，不启动 GUI。

```powershell
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelymem -- doctor
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelymem -- plugins --engine starmem --query ps
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelymem -- describe --engine starmem --plugin pslist
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelymem -- run --engine starmem --image 'D:\case\memory.mem' --plugin pslist
```

先检查 doctor，再按关键词查插件，仅按需 describe 单个插件；不把整份插件清单或帮助放进对话。
路径使用绝对路径。默认最长 1800 秒；长分析用 shell 的后台作业/等待机制，勿重复启动。
可在分隔符 `--` **之前**加 `--timeout 3600 --max-chars 2000`，原生参数放后面。

完整 stdout/stderr 与命令记录保存于工作区 `lovely-runs/`，默认只返回 2000 字符 stdout 和 500 字符 stderr 预览。
`runDir` 是调用记录目录；`run_dir` 才是 LovelyMem 产物目录。缺省 `--output-dir` 会指向独立产物目录。
后续用 `artifacts --run-dir <run_dir>`，再用 `read/query/sql` 的局部读取与分页参数；参数不确定时才调用 `help`。
预览有 `truncated: true` 时不是完整结果；按输出路径搜索/局部读取，禁止把完整大文件回灌上下文。
`status: partial` 表示可用的部分结果，保留警告；`ok: false` 或超时不得当作成功。

找不到 CLI 时调用 `status`，用 `configure lovelymem '<V3 exe绝对路径>'` 或 `SEEU_LOVELYMEM_EXE` 设置；不把 Lite/Luxe GUI 当作 V3。
分析使用已有证据副本，产物独立落盘，结论引用源镜像、插件和产物位置。
