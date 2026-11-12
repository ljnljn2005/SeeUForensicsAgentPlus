# 真实工具基准（本机实测）

这份文档记录 **真实工具链在本机的实测数字**，用来回答两件事：

1. 取证会话里说的「本机实测」到底测出了什么（版本、路径、可用性）；
2. 前端/后端的体验目标（首字延迟、挂载耗时、分析耗时）是否现实。

复现命令：

```bash
node scripts/e2e/real-tools-bench.mjs
# 可选覆盖：CARVE_IMAGE=W:/xxx.E01 BENCH_PCAP=E:/.../L1-6.pcapng BENCH_MEM=E:/.../image.raw
# 工具路径：SEEU_LOVELYCARVE_CLI / SEEU_LOVELYSPARK_EXE / SEEU_TOOL_STARMEM
```

脚本优先用环境变量指定的路径，否则用开发机默认路径；某个工具或样本不在就标 `skipped`，不会假装跑过。

## 机器与版本（2026-11-12）

| 项目 | 值 |
| --- | --- |
| 系统 | Windows x64（10.0.26340） |
| Node / Python | Node 24.18.0 / Python 3.13.14（`D:/Programming/Python31314/python.exe`） |
| LovelyCarve CLI | 1.3.0（`D:/Programs/LovelyCarve/lovelycarve-cli.exe`） |
| LovelySpark | 0.3.20（`E:/CTFTools/Misc/综合工具箱/lovelyspark.exe`） |
| StarMem | 0.2.2（`E:/CTFTools/Forensics/1-ComputerAnalysis/3-MemAnalysis/Lovelymem/starmem-v0.2.2-windows-x64-upx/starmem.exe`） |

## 结果

### LovelyCarve：镜像挂载（真实 E01）

样本：`W:/AP3_LEUNG_YL_USB.E01`（776,733,201 B，EWF）。

| 步骤 | 耗时 | 结果 |
| --- | --- | --- |
| `inspect`（分区表） | **162 ms** | 2 个分区（part 0 exfat / part 1） |
| `mount`（part 0 → `X:`） | **266 ms** | 只读盘挂载成功 |
| 列 `X:\` | — | `System Volume Information`、`WEPE`、`Sunny.zip`、`vera_key` |
| `unmount` | **154 ms** | 盘符释放 |

要点（也是这次修掉的坑）：

- `--case` 只能作为 **启动参数**；会话里再带会被 CLI 拒绝并让进程退出。正确流程是：一次性 `cases create <dir>` 建案件 → 常驻 `lovelycarve-cli -q --case <dir> shell` → `images open <path>` → `mounts create /part:N --mount-point X:`。
- LovelyCarve 1.3.0 的 `mounts delete --force` **会真的卸载，但不返回任何 JSON**（等 JSON 会一直挂住）。外壳改成「写命令 + 轮询盘符消失」，必要时兜底停掉常驻进程（进程退出 = 系统释放挂载）。

### LovelySpark：流量分析（真实 PCAP）

样本：`E:/CTFTools/Forensics/8-流量分析/题目/L1-6.pcapng`（86,507 B）。

| 步骤 | 耗时 | 结果 |
| --- | --- | --- |
| `--version` | 11.3 s（首次冷启动） | `lovelyspark 0.3.20` |
| `analyze` | **9.0–13.3 s** | 生成分析库（27 个模块） |
| `investigate --focus overview --limit 5` | **8.8 s** | 复用同一分析库 |

要点：

- 分析库落在 **检材同目录**：`L1-6.pcapng.db.generations/4c8021e6….db`。技能文档里必须说明这一点（不是写到工作区）；对只读介质需要先把 pcap 复制到可写目录。
- 技能里的调用路径 `"$SEEU_CLI_NODE" "$SEEU_LOVELY_CLI" lovelyspark -- analyze <pcap>` 与本次实测一致；`SEEU_LOVELYSPARK_EXE` 可临时覆盖设置里的路径。

### StarMem：内存分析

样本：`E:/CTFTools/Forensics/8-流量分析/w3流量分析工具/Examples/CS流量/cs4内存解密流量/pid.6492.dmp`（472,240,128 B，`info` 识别为 `raw`）。

| 步骤 | 耗时 | 结果 |
| --- | --- | --- |
| `--json info` | **525 ms** | `engine_identity.version = 0.2.2`、`source_identity.format = raw` |
| `windows-info` | 15.9 s | 失败：`Windows bootstrap 失败：… no decoded physical KDBG was found` |
| `pslist --limit 8` / `netscan --limit 5` | > 180 s | 超时未返回 |

结论：**本机没有可用的完整内存镜像**（这个样本是流量分析工具自带的进程转储，只能验证 `info`/参数解析链路）。要验证 `pslist`/`malfind`/`collect` 这类采集命令，需要用户提供完整内存镜像（`.raw`/`.mem`/`.vmem`/`.dmp` 全内存转储）。

## 对产品的直接影响

- 挂载与卸载都在 **亚秒级**（160–270 ms / 154 ms），可以在会话里放心「挂载 → 浏览 → 卸载」，不必一次挂一整天；
- LovelySpark 的单次分析是 **10 秒级**，前端/技能的提示词里要提前说明「分析需要等待」，不要把它当毫秒级工具；
- 内存分析预设目前只能承诺「命令链路可用」，采集结果依赖用户提供完整镜像；这一点在 README 与 persona 里都写明了。
