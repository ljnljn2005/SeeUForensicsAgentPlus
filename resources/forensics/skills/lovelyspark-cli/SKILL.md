---
name: lovelyspark-cli
description: 用本机 LovelySpark CLI 分析 PCAP/PCAPNG 流量、查询分析库并导出证据。
---

通过现有 PowerShell 工具调用，自动寻找本机 CLI。LovelySpark 原生参数不加 `--cli`。

```powershell
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelyspark -- --version
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelyspark -- analyze 'D:\case\capture.pcapng'
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelyspark -- tools schema module_summary
& $env:SEEU_CLI_NODE $env:SEEU_LOVELY_CLI lovelyspark -- call --db '<db_path>' module_summary --args-file 'D:\case\query.json'
```

先 analyze，保存返回的 `db_path`，后续 call 复用该库。只需概览可用 `investigate '<pcap>' --focus overview --limit 10`。
只按需查单个 `tools schema <name>`，未知工具才查 `tools list`；不要把整个工具目录或 schema 填进上下文。
JSON 参数优先用 `--args-file` 避免 Windows 引号转义；路径使用绝对路径。
查询参数按实际 schema 设置 limit/page_size/offset/fields，不猜字段。

默认最长 600 秒；长分析用 shell 后台作业/等待机制，勿重复建库。可在分隔符 `--` **之前**加 `--timeout 1800 --max-chars 2000`；原生参数放后面。
完整 stdout/stderr 与命令记录保存在工作区 `lovely-runs/`，默认仅返回 2000 字符 stdout 和 500 字符 stderr 预览。
`truncated: true` 不是完整结果，按返回路径检索/局部读取或缩小查询；不要整文件回灌。`ok: false` / 超时须说明，保留退出码和错误定位。

默认无需配置路径；`status` 查看自动发现结果。仅发现失败时用 `configure lovelyspark '<exe绝对路径>'` 指定，`configure lovelyspark auto` 恢复自动寻找。
使用现有许可证；不默认导入授权或执行网络回放。结论引用源抓包、db_path 与具体记录位置。
