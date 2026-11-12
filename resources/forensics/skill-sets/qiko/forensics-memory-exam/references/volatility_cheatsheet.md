# Volatility 2 & 3 命令速查表

> **路径变量说明**: 本文档中 `{MYOS_VOL3}` 为动态路径变量，由父 skill `forensics-memory-exam` 的第零步解析 MYOS 安装目录后替换为实际路径。执行命令前必须先完成第零步的路径解析。

## Volatility 3 命令全集

### 基础命令

```bash
# 查看镜像信息
{MYOS_VOL3} -f memory.mem windows.info
{MYOS_VOL3} -f memory.mem windows.info.Info

# 列出所有Windows插件
{MYOS_VOL3} -f memory.mem windows.  # Tab补全查看
```

### 进程分析

```bash
# 进程列表（活跃+部分终止）
{MYOS_VOL3} -f memory.mem windows.pslist
{MYOS_VOL3} -f memory.mem windows.pslist --pid 1234          # 指定PID
{MYOS_VOL3} -f memory.mem windows.pslist --dump              # 输出JSON

# 进程扫描（含隐藏/已终止进程）
{MYOS_VOL3} -f memory.mem windows.psscan

# 进程树
{MYOS_VOL3} -f memory.mem windows.pstree

# 进程命令行
{MYOS_VOL3} -f memory.mem windows.cmdline
{MYOS_VOL3} -f memory.mem windows.cmdline --pid 1234

# 进程参数差异（检测参数欺骗）
{MYOS_VOL3} -f memory.mem windows.cmdline --pid 1234
{MYOS_VOL3} -f memory.mem windows.modscan --pid 1234

# DLL列表
{MYOS_VOL3} -f memory.mem windows.dlllist --pid 1234

# 模块列表
{MYOS_VOL3} -f memory.mem windows.modules
{MYOS_VOL3} -f memory.mem windows.modscan

# 进程环境变量
{MYOS_VOL3} -f memory.mem windows.envars --pid 1234

# 进程Token
{MYOS_VOL3} -f memory.mem windows.token --pid 1234

# 进程Privilege
{MYOS_VOL3} -f memory.mem windows.privileges --pid 1234

# 服务扫描
{MYOS_VOL3} -f memory.mem windows.svcscan
{MYOS_VOL3} -f memory.mem windows.svcscan --svcname "ServiceName"

# 会话信息
{MYOS_VOL3} -f memory.mem windows.sessions

# 驱动模块
{MYOS_VOL3} -f memory.mem windows.driverscan

# VAD信息
{MYOS_VOL3} -f memory.mem windows.vadinfo --pid 1234

# VAD树
{MYOS_VOL3} -f memory.mem windows.vadtree --pid 1234

# 进程Handle
{MYOS_VOL3} -f memory.mem windows.handles --pid 1234

# 互斥体
{MYOS_VOL3} -f memory.mem windows.mutantscan

# 进程内存map/导出
{MYOS_VOL3} -f memory.mem windows.memmap --pid 1234 --dump
{MYOS_VOL3} -f memory.mem windows.memdump --pid 1234
```

### 网络分析

```bash
# 网络连接（TCP/UDP）
{MYOS_VOL3} -f memory.mem windows.netscan

# Netstat风格
{MYOS_VOL3} -f memory.mem windows.netstat
{MYOS_VOL3} -f memory.mem windows.netgraph

# ARP表
{MYOS_VOL3} -f memory.mem windows.arp

# 网络设备
{MYOS_VOL3} -f memory.mem windows.netsh.NetworkDevices
```

### 文件系统

```bash
# 文件扫描
{MYOS_VOL3} -f memory.mem windows.filescan

# 文件导出（使用虚拟地址）
{MYOS_VOL3} -f memory.mem windows.dumpfiles --virtaddr 0xXXXXXXXXXXXX

# MFT扫描
{MYOS_VOL3} -f memory.mem windows.mftscan
```

### 注册表

```bash
# 注册表Hive列表
{MYOS_VOL3} -f memory.mem windows.registry.hivelist

# 打印注册表键值
{MYOS_VOL3} -f memory.mem windows.registry.printkey --key "ControlSet001\Services"

# 递归打印
{MYOS_VOL3} -f memory.mem windows.registry.printkey --key "ControlSet001\Services" --recurse

# 特定Hive的键值
{MYOS_VOL3} -f memory.mem windows.registry.printkey --offset <HiveOffset> \
  --key "Software\Microsoft\Windows\CurrentVersion"

# 常用取证注册表路径：
# SAM\Domains\Account\Users                    — 用户账户
# SAM\Domains\Account\Users\Names              — 用户名列表
# Software\Microsoft\Windows\CurrentVersion\Run  — 自启动
# Software\Microsoft\Windows\CurrentVersion\RunOnce
# Software\Microsoft\Windows NT\CurrentVersion   — 系统版本
# System\CurrentControlSet\Services              — 服务
# System\CurrentControlSet\Control\ComputerName  — 计算机名
# System\CurrentControlSet\Control\TimeZoneInformation — 时区
# Software\Microsoft\Windows\CurrentVersion\Uninstall — 已安装程序
```

### 凭据与密钥

```bash
# NTLM哈希dump
{MYOS_VOL3} -f memory.mem windows.hashdump

# LSA凭据
{MYOS_VOL3} -f memory.mem windows.lsadump

# 缓存的域凭据
{MYOS_VOL3} -f memory.mem windows.cachedump

# 剪贴板
{MYOS_VOL3} -f memory.mem windows.clipboard

# AES密钥扫描
{MYOS_VOL3} -f memory.mem windows.aeskeyfind

# RSA密钥扫描
{MYOS_VOL3} -f memory.mem windows.rsakeyfind
```

### 恶意代码检测

```bash
# Malfind — VAD注入检测
{MYOS_VOL3} -f memory.mem windows.malfind
{MYOS_VOL3} -f memory.mem windows.malfind --pid 1234

# DLL隐藏检测（三视图对比）
{MYOS_VOL3} -f memory.mem windows.ldrmodules --pid 1234

# 钩子检测
{MYOS_VOL3} -f memory.mem windows.ssdt

# IDT表
{MYOS_VOL3} -f memory.mem windows.idt

# 回调
{MYOS_VOL3} -f memory.mem windows.callbacks

# 内核模块
{MYOS_VOL3} -f memory.mem windows.modules
{MYOS_VOL3} -f memory.mem windows.modscan

# TrueCrypt扫描
{MYOS_VOL3} -f memory.mem windows.truecrypt
```

### 取证分析

```bash
# 浏览器历史
{MYOS_VOL3} -f memory.mem windows.browserhist.BrowserHist

# Shellbags
{MYOS_VOL3} -f memory.mem windows.shellbags.ShellBags

# 跳转列表（最近文档）
{MYOS_VOL3} -f memory.mem windows.jumplists.JumpLists

# USB设备
{MYOS_VOL3} -f memory.mem windows.usbscan.UsbScan

# 防火墙规则
{MYOS_VOL3} -f memory.mem windows.netsh.FirewallRules

# 时间线
{MYOS_VOL3} -f memory.mem timeliner.Timeliner
{MYOS_VOL3} -f memory.mem windows.timeliner
```

---

## Volatility 2 命令全集

### 基础命令

```bash
# 确定Profile
vol.py -f memory.mem imageinfo
vol.py -f memory.mem kdbgscan

# 查看所有插件
vol.py --info | grep <keyword>
```

### 常用Profile

```
WinXPSP2x86, WinXPSP3x86
Win7SP0x86, Win7SP1x86, Win7SP1x64
Win8SP0x86, Win8SP1x64
Win10x64, Win10x64_15063, Win10x64_19041, Win10x64_19045
Win11x64, Win11x64_22621
```

### 进程分析

```bash
# 进程列表
vol.py -f memory.mem --profile=Win10x64 pslist
vol.py -f memory.mem --profile=Win10x64 psscan      # 含隐藏进程
vol.py -f memory.mem --profile=Win10x64 pstree
vol.py -f memory.mem --profile=Win10x64 psxview      # 多视图对比

# 进程命令行
vol.py -f memory.mem --profile=Win10x64 cmdline
vol.py -f memory.mem --profile=Win10x64 cmdline -p <PID>

# 控制台历史
vol.py -f memory.mem --profile=Win10x64 consoles

# DLL列表
vol.py -f memory.mem --profile=Win10x64 dlllist -p <PID>

# 进程环境变量
vol.py -f memory.mem --profile=Win10x64 envars -p <PID>

# 进程Token
vol.py -f memory.mem --profile=Win10x64 tokens -p <PID>

# 进程Privilege
vol.py -f memory.mem --profile=Win10x64 privs -p <PID>

# 进程Handle
vol.py -f memory.mem --profile=Win10x64 handles -p <PID>

# 服务扫描
vol.py -f memory.mem --profile=Win10x64 svcscan

# 会话
vol.py -f memory.mem --profile=Win10x64 sessions

# VAD信息
vol.py -f memory.mem --profile=Win10x64 vadinfo -p <PID>

# VAD树
vol.py -f memory.mem --profile=Win10x64 vadtree -p <PID>

# 驱动模块
vol.py -f memory.mem --profile=Win10x64 driverscan
vol.py -f memory.mem --profile=Win10x64 modules
vol.py -f memory.mem --profile=Win10x64 modscan

# 互斥体
vol.py -f memory.mem --profile=Win10x64 mutantscan

# 进程内存导出
vol.py -f memory.mem --profile=Win10x64 memdump -p <PID> -D ./output
```

### 网络分析

```bash
# 网络连接
vol.py -f memory.mem --profile=Win10x64 netscan
vol.py -f memory.mem --profile=Win10x64 connections      # XP/2003
vol.py -f memory.mem --profile=Win10x64 connscan         # TCP连接扫描
vol.py -f memory.mem --profile=Win10x64 sockets          # Socket扫描

# ARP表
vol.py -f memory.mem --profile=Win10x64 arp
```

### 文件系统

```bash
# 文件扫描
vol.py -f memory.mem --profile=Win10x64 filescan

# 文件导出（使用物理偏移）
vol.py -f memory.mem --profile=Win10x64 dumpfiles -Q <PhysicalOffset> -D ./output
vol.py -f memory.mem --profile=Win10x64 dumpfiles -r <正则匹配> -D ./output

# MFT扫描
vol.py -f memory.mem --profile=Win10x64 mftparser

# 注册表
vol.py -f memory.mem --profile=Win10x64 hivelist
vol.py -f memory.mem --profile=Win10x64 printkey -o <HiveOffset> -K "<KeyPath>"
vol.py -f memory.mem --profile=Win10x64 dumpregistry -D ./output
```

### 凭据与密钥

```bash
# NTLM哈希
vol.py -f memory.mem --profile=Win10x64 hashdump
vol.py -f memory.mem --profile=Win10x64 cachedump      # 域缓存凭据

# LSA凭据
vol.py -f memory.mem --profile=Win10x64 lsadump

# 剪贴板
vol.py -f memory.mem --profile=Win10x64 clipboard

# 密码扫描
vol.py -f memory.mem --profile=Win10x64 mimikatz        # 需要mimikatz插件
```

### 恶意代码检测

```bash
# Malfind
vol.py -f memory.mem --profile=Win10x64 malfind -p <PID>

# 隐藏模块检测
vol.py -f memory.mem --profile=Win10x64 ldrmodules -p <PID>

# API钩子
vol.py -f memory.mem --profile=Win10x64 apihooks

# SSDT钩子
vol.py -f memory.mem --profile=Win10x64 ssdt

# IDT
vol.py -f memory.mem --profile=Win10x64 idt

# GDT
vol.py -f memory.mem --profile=Win10x64 gdt

# 回调
vol.py -f memory.mem --profile=Win10x64 callbacks

# 定时器
vol.py -f memory.mem --profile=Win10x64 timers
```

### 取证分析

```bash
# Shellbags (资源管理器使用痕迹)
vol.py -f memory.mem --profile=Win10x64 shellbags

# 用户活动
vol.py -f memory.mem --profile=Win10x64 userassist

# Shim缓存 (程序执行历史)
vol.py -f memory.mem --profile=Win10x64 shimcache

# USB设备
vol.py -f memory.mem --profile=Win10x64 usbhistory

# IE历史
vol.py -f memory.mem --profile=Win10x64 iehistory

# 时间线
vol.py -f memory.mem --profile=Win10x64 timeliner

# 通知程序包
vol.py -f memory.mem --profile=Win10x64 notifiers
```

---

## Vol2 ↔ Vol3 命令对照速查

| 功能 | Volatility 2 | Volatility 3 |
|------|-------------|-------------|
| 镜像信息 | `imageinfo` / `kdbgscan` | `windows.info` |
| 进程列表 | `pslist` | `windows.pslist` |
| 扫描进程 | `psscan` | `windows.psscan` |
| 进程树 | `pstree` | `windows.pstree` |
| 命令行 | `cmdline -p <PID>` | `windows.cmdline --pid <PID>` |
| 控制台 | `consoles` | (无直接插件) |
| DLL列表 | `dlllist -p <PID>` | `windows.dlllist --pid <PID>` |
| 模块扫描 | `modscan` | `windows.modscan` |
| 驱动扫描 | `driverscan` | `windows.driverscan` |
| 服务 | `svcscan` | `windows.svcscan` |
| 网络连接 | `netscan` | `windows.netscan` |
| 文件扫描 | `filescan` | `windows.filescan` |
| 文件导出 | `dumpfiles -Q <off> -D <dir>` | `windows.dumpfiles --virtaddr <addr>` |
| 注册表 | `hivelist` + `printkey -o <off> -K <key>` | `windows.registry.hivelist` + `windows.registry.printkey --key <key>` |
| NTLM哈希 | `hashdump` | `windows.hashdump` |
| LSA | `lsadump` | `windows.lsadump` |
| 剪贴板 | `clipboard` | `windows.clipboard` |
| Malfind | `malfind -p <PID>` | `windows.malfind --pid <PID>` |
| 隐藏模块 | `ldrmodules -p <PID>` | `windows.ldrmodules --pid <PID>` |
| 环境变量 | `envars -p <PID>` | `windows.envars --pid <PID>` |
| 会话 | `sessions` | `windows.sessions` |
| 进程Memdump | `memdump -p <PID> -D <dir>` | `windows.memmap --pid <PID> --dump` |
| AES密钥 | (需社区插件) | `windows.aeskeyfind` |
| 时间线 | `timeliner` | `timeliner.Timeliner` |
| 互斥体 | `mutantscan` | `windows.mutantscan` |

---

## strings辅助命令

```bash
# 搜索IP地址
strings memory.mem | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}' | sort -u > ips.txt

# 搜索URL
strings memory.mem | grep -Eo 'https?://[^ \t\r\n<>"]+' | sort -u > urls.txt

# 搜索邮箱
strings memory.mem | grep -Eo '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | sort -u

# 搜索文件路径
strings memory.mem | grep -E '^[A-Z]:\\' | sort -u > filepaths.txt

# 搜索Base64编码
strings memory.mem | grep -E '^[A-Za-z0-9+/]{40,}={0,2}$' | head -50

# 搜索flag/密码
strings memory.mem | grep -iE 'flag|password|secret|key|token' | sort -u

# 搜索特定字符串
strings memory.mem | grep "keyword" | sort -u

# strings 编码参数
strings -e l memory.mem    # UTF-16 LE (Windows默认)
strings -e b memory.mem    # big-endian
strings -e L memory.mem    # UTF-32 LE
strings -n 6 memory.mem    # 最小长度6的字符串
```

---

## 输出处理技巧

```bash
# 保存输出到文件
{MYOS_VOL3} -f memory.mem windows.pslist > pslist.txt 2>&1

# JSON格式输出
{MYOS_VOL3} -f memory.mem windows.pslist --dump

# 生成CSV（Vol2支持）
vol.py -f memory.mem --profile=Win10x64 pslist --output=csv --output-file=pslist.csv

# 只提取特定列
{MYOS_VOL3} -f memory.mem windows.netscan | awk '{print $4, $5, $6, $7}'

# 排序
{MYOS_VOL3} -f memory.mem windows.pslist | sort -k3 -n  # 按第3列（PID）数字排序
```
