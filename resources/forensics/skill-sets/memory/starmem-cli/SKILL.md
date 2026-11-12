---
name: starmem-cli
description: 用本机 StarMem 内存取证引擎分析内存镜像（进程/网络/注入/注册表/凭据/时间线），输出 JSON/CSV。
---

命令统一在 `bash` 工具（Git Bash）里执行；bash 不可用（工具缺失或执行报错）时才降级 `pwsh`，那时环境变量写成 `$env:SEEU_TOOL_STARMEM`。

工具路径解析顺序：用户在「设置 → 外部取证工具路径」显式指定 → `PATH` 里的 `starmem` → 默认实测路径。会话里优先用环境变量：

```bash
"$SEEU_TOOL_STARMEM" --json info 'D:/case/memory.raw'
```

`$SEEU_TOOL_STARMEM` 为空时先试 `starmem --version`（PATH）；两个都不可用就告诉用户去设置窗口指定 `starmem.exe`，**不要全盘搜索、不要自行下载、不要拿 lovelymem/volatility 硬顶**（lovelymem 只在用户明确同意时作兜底）。

## 基本用法

```
starmem.exe [全局选项] <命令> [命令选项] <镜像文件>
```

- 命令与镜像路径都用绝对路径（Windows 路径在 bash 里写 `'D:/case/memory.raw'`）。
- 不确定命令名/参数时：`"$SEEU_TOOL_STARMEM" --help`、`"$SEEU_TOOL_STARMEM" help <命令>`；中文字段看不懂加 `--help-en`。
- 先 `info`（容器/格式/物理布局）再 `windows-info`（内核启动上下文），确认镜像能被正确解析后再跑深度插件。
- 大结果写文件再局部读取：`... --json <命令> <镜像> > "$SEEU_WORKSPACE/starmem/<命令>.json"`；用 `--limit` 控制条数，`--csv '路径'` 出 Excel 兼容表。
- `--raw-objects <file.jsonl>` 可导出可复核的原始对象证据；`--force` 覆盖已有输出。
- 符号：默认自动解析；需要精确布局时用 `--pdb`、`--profile`、`--symbol-path <目录>`、`--cache <目录>`，Linux 可加 `--system-map`。
- `collect` 会跑全部无需额外输入的只读插件，把结构化结果汇总到 SQLite：`"$SEEU_TOOL_STARMEM" collect <镜像>`，之后用 python 的 `sqlite3` 模块按表查询（不要整库回灌上下文）。

## 常用命令（Windows）

| 目的 | 命令 |
| --- | --- |
| 镜像/系统概览 | `info`、`windows-info`、`system-info`、`statistics`、`acquisition-info` |
| 进程 | `pslist`、`psscan`、`pstree`、`psxview`、`check-pslist`、`cmdline`、`envars` |
| 线程/模块 | `threads`、`thrdscan`、`dlllist`、`ldrmodules`、`iat`、`pedump` |
| 网络 | `netscan`、`netstat`、`packetscan`（可导 PCAPNG） |
| 注入/隐藏 | `malfind`、`injected-regions`、`hollowprocesses`、`processghosting`、`pebmasquerade`、`direct-system-calls`、`etwpatch`、`cobaltstrikescan` |
| 凭据 | `hashdump`、`cachedump`、`lsadump`、`token-anomalies`、`getsids`、`privileges` |
| 注册表/服务/启动项 | `hivelist`、`hivescan`、`registry-printkey`、`svcscan`、`svclist`、`autoruns`、`scheduled-tasks`、`userassist`、`amcache`、`shimcachemem` |
| 文件/痕迹 | `filescan`、`mftscan`、`dumpfile`、`prefetchscan`、`usb-history`、`recent-files`、`terminal-history`、`clipboardscan` |
| 时间线/执行证据 | `event-timeline`、`windows.timeline`、`windows.execution`、`windows.interaction` |
| 浏览器/IM | `browser-session`、`browser-history`、`browser-pages`、`cookiescan`、`dnsscan`、`wechatscan`、`wechat-chat`、`qqscan`、`ai-chat` |
| 字符串/扫描 | `strings`、`windows.process-string`、`scan`、`vadregexscan`、`vadyarascan` |
| Linux 镜像 | `linux.info`、`linux.ir`、`linux.psaux`、`linux.cmdline`、`linux.envars`、`linux.bash`、`linux.lsof`、`linux.sockstat`、`linux.pstree`、`linux.lsmod`、`linux.kallsyms`、`linux.kmsg` |

## 证据纪律

- 只读分析：不修改镜像；产物写 `$SEEU_WORKSPACE/starmem/`，报告里写清命令、镜像哈希、输出路径。
- 每个结论对应具体命令与字段；`--json` 里 `partial`/缺页/警告要保留，不能当成完整结果。
- 进程差异（`pslist` vs `psscan`）、网络端点、注入区必须回查原始对象，命中只是线索。
- 采不到（缺页、符号不匹配）就写「采不到」，不要用推断填空。
