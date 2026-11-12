---
name: lovelyspark-cli
description: 用本机 LovelySpark CLI 分析 PCAP/PCAPNG 流量、查询分析库并导出证据。
---

通过现有 PowerShell 工具调用。LovelySpark 原生参数不加 `--cli`。本机实测（2026-11-12 开发机）：**流量/日志分析优先用本技能**；tshark 3.4.0 / capinfos / editcap / mergecap 已装但不在 PATH（`E:/CTFTools/Forensics/4-其他工具/【15】网络分析/Wireshark/`），只在本技能覆盖不到时用绝对路径调用做补充或交叉复核；nfdump、zeek 未装；python 3.13 已装（scapy、dpkt、pyshark）。

工具路径**只能由用户在桌面端设置窗口手动指定**（设置 → 本机取证工具路径），不做自动发现。

```bash
"$SEEU_CLI_NODE" "$SEEU_LOVELY_CLI" lovelyspark -- --version
"$SEEU_CLI_NODE" "$SEEU_LOVELY_CLI" lovelyspark -- analyze 'D:/case/capture.pcapng'
"$SEEU_CLI_NODE" "$SEEU_LOVELY_CLI" lovelyspark -- tools schema module_summary
"$SEEU_CLI_NODE" "$SEEU_LOVELY_CLI" lovelyspark -- call --db '<db_path>' module_summary --args-file 'D:/case/query.json'
```

先 analyze，保存返回的 `db_path`，后续 call 复用该库。只需概览可用 `investigate '<pcap>' --focus overview --limit 10`。
只按需查单个 `tools schema <name>`，未知工具才查 `tools list`；不要把整个工具目录或 schema 填进上下文。
JSON 参数优先用 `--args-file` 避免 Windows 引号转义；路径使用绝对路径。
查询参数按实际 schema 设置 limit/page_size/offset/fields，不猜字段。

默认最长 600 秒；长分析用 shell 后台作业/等待机制，勿重复建库。可在分隔符 `--` **之前**加 `--timeout 1800 --max-chars 2000`；原生参数放后面。
完整 stdout/stderr 与命令记录保存在工作区 `lovely-runs/`，默认仅返回 2000 字符 stdout 和 500 字符 stderr 预览。
`truncated: true` 不是完整结果，按返回路径检索/局部读取或缩小查询；不要整文件回灌。`ok: false` / 超时须说明，保留退出码和错误定位。

路径只来自用户手动指定（桌面端「设置 → 本机取证工具路径」写入 `<DSH_HOME>/lovely-cli.json`），**不要自己去找 exe**。`status` 的 `found:false` 表示未配置：请用户去设置窗口指定路径，不要尝试自动发现或 `configure auto`。脚本里临时指定用 `configure lovelyspark '<exe绝对路径>'`，`configure lovelyspark clear` 清除。
使用现有许可证；不默认导入授权或执行网络回放。结论引用源抓包、db_path 与具体记录位置。
