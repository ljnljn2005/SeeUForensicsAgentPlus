---
name: windows-artifact-triage
description: 以只读方式对 Windows 主机的常见取证工件（事件日志、注册表、Prefetch、Amcache、计划任务、服务、最近访问记录）做初步排查与时间线整理。
whenToUse: 用户给出 Windows 主机/系统盘/镜像，要求排查入侵、恶意程序、持久化、账号活动或整理时间线时。
---

# Windows 工件初步排查（windows-artifact-triage）

## 前置：证据完整性

1. 先确认对象是**镜像/副本**还是**正在运行的原始主机**；对原始主机只做只读读取。
2. 对关键文件先计算 SHA-256 并记录，再解析；解析输出写到独立工作目录，不覆盖原始文件。
3. 记录系统时间与 UTC 偏移；Windows 事件日志时间默认 UTC，文件系统时间受时区影响，报告需统一标注。

## 常用只读工件与要点

| 工件 | 默认位置 | 用途 | 注意 |
|------|----------|------|------|
| 安全/系统/应用日志 | `%SystemRoot%\System32\winevt\Logs\*.evtx` | 登录、服务安装、清除日志 | 先看日志是否被清空/时间断层 |
| Security 4624/4625/4672/4688 | 同上 | 登录类型、失败爆破、特权登录、进程创建 | 4624 类型 3/10 与来源 IP 关联 |
| Sysmon | `...\Logs\Microsoft-Windows-Sysmon%4Operational.evtx` | 进程/网络/注册表事件 | 事件 ID 1/3/11/12/13 |
| 注册表配置单元 | `%SystemRoot%\System32\config\{SYSTEM,SOFTWARE,SAM,SECURITY}` | 服务、启动项、USB、账号 | 解析副本，勿直接写回 |
| NTUSER.DAT / UsrClass.dat | `\Users\<user>\` | Run 键、MRU、Shellbags | 每用户分别采集 |
| Prefetch | `%SystemRoot%\Prefetch\*.pf` | 程序执行痕迹 | 依赖系统版本，Win10+ 可能关闭 |
| Amcache | `%SystemRoot%\AppCompat\Programs\Amcache.hve` | 执行过的程序路径与哈希 | 与 Prefetch 交叉验证 |
| 计划任务 | `%SystemRoot%\System32\Tasks\**` + 注册表 TaskCache | 持久化 | 比对创建时间与文件时间 |
| 服务 | SYSTEM 配置单元 `CurrentControlSet\Services` | 持久化 | 关注 ImagePath 指向临时目录 |
| 最近访问 | `\Users\<user>\AppData\Roaming\Microsoft\Windows\Recent\` | 文件打开痕迹 | 与 LNK 目标交叉验证 |

## 执行方式

- 优先使用系统自带只读工具：`wevtutil epl`（导出 evtx）、`reg export`（导出配置单元键）、`Get-WinEvent`（筛选读取）。
- 需要解析器时，输出到 `<workdir>/derived/`，并在报告里写明「派生文件 ↔ 原始证据」对应关系与哈希。
- 不要运行样本、不要删除证书/日志、不要 `wevtutil cl`。

## 输出

按 `evidence-chain-report` 的结构输出：结论 → 证据（路径 + SHA-256 + 定位）→ 方法 → 置信度 → 局限；时间线单独成节，统一标注时区。

## 常见误区

- 把 `LastWriteTime` 当成「最后访问时间」。
- 把 Prefetch 缺失直接当成「未执行」。
- 把单一日志条目当作结论，未与文件系统/注册表交叉验证。
- 在原始主机上做「清理」或「修复」操作，破坏证据。
