---
name: lovelymem-cli
description: 用本机 LovelyMem V3 CLI 分析内存镜像，查询进程、网络与插件产物。
---

命令统一在 `bash` 工具（Git Bash）里执行；bash 不可用（工具缺失或执行报错）时才降级用 `pwsh`，那时环境变量写成 `$env:SEEU_CLI_NODE` / `$env:SEEU_LOVELY_CLI`。自动添加 `--cli`，不启动 GUI。工具路径**只能由用户在桌面端设置窗口手动指定**（设置 → 本机取证工具路径），不做自动发现。

```bash
"$SEEU_CLI_NODE" "$SEEU_LOVELY_CLI" lovelymem -- doctor
"$SEEU_CLI_NODE" "$SEEU_LOVELY_CLI" lovelymem -- plugins --engine starmem --query ps
"$SEEU_CLI_NODE" "$SEEU_LOVELY_CLI" lovelymem -- describe --engine starmem --plugin pslist
"$SEEU_CLI_NODE" "$SEEU_LOVELY_CLI" lovelymem -- run --engine starmem --image 'D:/case/memory.mem' --plugin pslist
```

先检查 doctor，再按关键词查插件，仅按需 describe 单个插件；不把整份插件清单或帮助放进对话。
若退出码为 3 且提示账号认领/授权失败，转告原始原因并停止重试，待用户在 LovelyMem 桌面端完成授权。
路径使用绝对路径。默认最长 1800 秒；长分析用 shell 的后台作业/等待机制，勿重复启动。
可在分隔符 `--` **之前**加 `--timeout 3600 --max-chars 2000`，原生参数放后面。

完整 stdout/stderr 与命令记录保存于工作区 `lovely-runs/`，默认只返回 2000 字符 stdout 和 500 字符 stderr 预览。
`runDir` 是调用记录目录；`run_dir` 才是 LovelyMem 产物目录。缺省 `--output-dir` 会指向独立产物目录。
后续用 `artifacts --run-dir <run_dir>`，再用 `read/query/sql` 的局部读取与分页参数；参数不确定时才调用 `help`。
预览有 `truncated: true` 时不是完整结果；按输出路径搜索/局部读取，禁止把完整大文件回灌上下文。
`status: partial` 表示可用的部分结果，保留警告；`ok: false` 或超时不得当作成功。

路径只来自用户手动指定（桌面端「设置 → 本机取证工具路径」写入 `<DSH_HOME>/lovely-cli.json`），**不要自己去找 exe、不要遍历目录/注册表/PATH**。用 `status` 看是否已配置：`found:false` 时告诉用户「请在设置窗口里指定 LovelyMem V3 的 exe」，不要尝试 `configure` 或其它回退。需要脚本里临时指定时用 `configure lovelymem '<V3 exe绝对路径>'`（仍要求用户给出路径），`configure lovelymem clear` 清除；不把 Lite/Luxe GUI 当作 V3。
分析使用已有证据副本，产物独立落盘，结论引用源镜像、插件和产物位置。
