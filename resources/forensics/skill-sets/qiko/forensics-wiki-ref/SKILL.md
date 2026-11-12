---
name: forensics-wiki-ref
description: "Quick reference skill for Chinese public security electronic data forensics competitions (公安电子数据取证比武), based on Forensics-Wiki knowledge consolidation. Provides detailed command templates, registry path references, time conversion tables, Volatility profile lists, encryption/decryption workflows, Linux server取证 techniques (宝塔面板/MySQL/WebShell/CDN), and tool cheatsheets (X-Ways/Passware/Volatility). Use when solving competition forensics questions involving Windows disk images, memory dumps, Linux servers, mobile backups, encrypted containers, or network artifacts. Complements existing forensic-competition and forensics-contest-assistant skills with additional detail from Forensics-Wiki."
---
# Forensics-Wiki Quick Reference (电子数据取证比武速查)

> 基于 Forensics-Wiki (https://www.forensics-wiki.com/) 内容整理
> 与 forensic-competition / forensics-contest-assistant 技能配合使用

## 1. Windows 注册表取证速查

### 1.1 关键取证路径

| 取证项 | 注册表路径 | 值名称 |
|--------|------------|--------|
| 系统安装时间 | HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion | InstallDate |
| 关机时间 | HKLM\SYSTEM\ControlSet001\Control\Windows | ShutdownTime |
| 计算机名称 | HKLM\SYSTEM\ControlSet001\Control\ComputerName\ComputerName | ComputerName |
| 本地用户列表 | HKLM\SAM\SAM\Domains\Account\Users\Names | (子键名) |
| 最后登录用户 | HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI | (子键) |
| 当前登录用户 | HKLM\SOFTWARE\...\LogonUI\SessionData\1 | (子键) |
| U盘序列号 | HKLM\SYSTEM\ControlSet001\Enum\USBSTOR | (子键名=序列号) |
| USB 卷标 | HKLM\SOFTWARE\Microsoft\Windows Portable Devices\Devices | (子键) |
| 已安装程序路径 | HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths | (默认值) |
| 卸载程序列表 | HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall | DisplayName |
| 最近运行命令 | HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU | MRUList |
| 最近使用文件 | HKCU\Software\...\Explorer\ComDlg32\OpenSavePidlMRU | (子键) |
| 网络连接历史 | HKLM\SYSTEM\ControlSet001\Services\Tcpip\Parameters\Interfaces | DhcpIPAddress |
| WiFi 密码 | HKLM\SOFTWARE\Microsoft\WlanSvc\Interfaces | |

### 1.2 注册表配置单元文件

```
SYSTEM   → HKLM\SYSTEM          → C:\Windows\System32\config\SYSTEM
SAM      → HKLM\SAM             → C:\Windows\System32\config\SAM
SECURITY → HKLM\SECURITY        → C:\Windows\System32\config\SECURITY
SOFTWARE → HKLM\SOFTWARE        → C:\Windows\System32\config\SOFTWARE
NTUSER   → HKCU                 → C:\Users\<用户名>\NTUSER.DAT
```

### 1.3 注册表访问命令

```powershell
# 加载离线注册表配置单元
reg load HKLM\OFFLINE_SOFTWARE F:\Windows\System32\config\SOFTWARE
reg load HKLM\OFFLINE_SYSTEM F:\Windows\System32\config\SYSTEM
reg load HKLM\OFFLINE_SAM F:\Windows\System32\config\SAM

# 查询系统安装时间
reg query "HKLM\OFFLINE_SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v InstallDate

# 查询 USB 设备历史
reg query HKLM\OFFLINE_SYSTEM\ControlSet001\Enum\USBSTOR /s

# 查询计算机名
reg query "HKLM\OFFLINE_SYSTEM\ControlSet001\Control\ComputerName\ComputerName" /v ComputerName

# 卸载注册表配置单元
reg unload HKLM\OFFLINE_SOFTWARE
reg unload HKLM\OFFLINE_SYSTEM
reg unload HKLM\OFFLINE_SAM
```

### 1.4 USB 设备解析

USBSTOR 路径格式：
```
HKLM\...\USBSTOR\Disk&Ven_<厂商>&Prod_<产品型号>&Rev_<版本>\<序列号>&0
```
- `Ven_WD` = 西部数据, `Ven_Kingston` = 金士顿, `Ven_SanDisk` = 闪迪
- 序列号 = 子键名称中 `&0` 前面的部分

---

## 2. 时间戳转换速查

| 时间戳类型 | 长度 | 转换方法 |
|-----------|------|----------|
| Unix 秒级 | 10位 | `datetime.fromtimestamp(ts)` |
| Unix 毫秒级 | 13位 | `datetime.fromtimestamp(ts/1000)` |
| Chrome/WebKit 微秒级 | 17位 | `(ts / 1000000) - 11644473600` → Unix 秒 |
| HFS+/Mac 绝对时间 | 31位/18位 | 取前9位 + 978307200 → Unix 秒 |
| Windows FILETIME | 18位 | `datetime(1601,1,1) + timedelta(microseconds=ts//10)` |
| OLE 自动化日期 | 浮点数 | `datetime(1899,12,30) + timedelta(days=ts)` |

```python
# Chrome 时间戳 (17位微秒) → 北京时间
chrome_ts = 13372730729123456
utc_sec = chrome_ts / 1000000 - 11644473600
from datetime import datetime, timezone, timedelta
bj_time = datetime.fromtimestamp(utc_sec, tz=timezone(timedelta(hours=8)))
print(bj_time.strftime("%Y-%m-%d %H:%M:%S"))

# Windows FILETIME (1601-01-01 起 100纳秒) → 北京时间
filetime_100ns = 13372730729123456
utc_sec = filetime_100ns / 10000000 - 11644473600
print(datetime.fromtimestamp(utc_sec, tz=timezone(timedelta(hours=8))))
```

---

## 3. Volatility 内存取证速查

### 3.1 Profile 选择

```bash
# Step 1: 确定镜像类型
python vol.py -f mem.raw imageinfo
# Step 2: 查看所有 Profile
python vol.py -f mem.raw --info | grep Profile
# Step 3: 使用 kdbgscan 验证
python vol.py -f mem.raw kdbgscan
```

### 3.2 Profile 列表 (Windows 10/11)

| 版本 | 构建号 | Profile 名称 |
|------|--------|-------------|
| Win 10 1507 | 10240 | Win10x64_10240 |
| Win 10 1511 | 10586 | Win10x64_10586 |
| Win 10 1607 | 14393 | Win10x64_14393 |
| Win 10 1703 | 15063 | Win10x64_15063 |
| Win 10 1709 | 16299 | Win10x64_16299 |
| Win 10 1803 | 17134 | Win10x64_17134 |
| Win 10 1809 | 17763 | Win10x64_17763 |
| Win 10 1903 | 18362 | Win10x64_18362 |
| Win 10 1909 | 18363 | Win10x64_18363 |
| Win 10 2004 | 19041 | Win10x64_19041 |
| Win 10 20H2 | 19042 | Win10x64_19042 |
| Win 10 21H1 | 19043 | Win10x64_19043 |
| Win 10 21H2 | 19044 | Win10x64_19044 |
| Win 11 21H2 | 22000 | Win11x64_22000 |
| Win 11 22H2 | 22621 | Win11x64_22621 |
| Win 11 23H2 | 22631 | Win11x64_22631 |

### 3.3 常用 Volatility 插件

```bash
# 进程信息
python vol.py -f mem.raw --profile=<Profile> pslist
python vol.py -f mem.raw --profile=<Profile> psscan
python vol.py -f mem.raw --profile=<Profile> pstree

# 网络连接
python vol.py -f mem.raw --profile=<Profile> netscan
python vol.py -f mem.raw --profile=<Profile> connscan

# 命令行历史
python vol.py -f mem.raw --profile=<Profile> cmdline
python vol.py -f mem.raw --profile=<Profile> cmdscan
python vol.py -f mem.raw --profile=<Profile> consoles

# 文件/模块
python vol.py -f mem.raw --profile=<Profile> filescan
python vol.py -f mem.raw --profile=<Profile> dlllist
python vol.py -f mem.raw --profile=<Profile> modscan
python vol.py -f mem.raw --profile=<Profile> handles

# 注册表
python vol.py -f mem.raw --profile=<Profile> hivelist
python vol.py -f mem.raw --profile=<Profile> printkey

# 转储
python vol.py -f mem.raw --profile=<Profile> memdump -p <PID> -D dumpdir/
python vol.py -f mem.raw --profile=<Profile> procdump -p <PID> -D dumpdir/

# 剪贴板
python vol.py -f mem.raw --profile=<Profile> clipboard

# 其他
python vol.py -f mem.raw --profile=<Profile> malfind
python vol.py -f mem.raw --profile=<Profile> svcscan
python vol.py -f mem.raw --profile=<Profile> timeliner
```

### 3.4 Profile 错误诊断

| 症状 | 原因 | 解决 |
|------|------|------|
| pslist 进程名乱码 | Profile 版本不匹配 | 查找准确构建号 |
| psscan 找不到进程 | Profile 过旧 | 检查是否打了补丁 |
| filescan 无结果 | Profile 完全不匹配 | 用 kdbgscan 获取建议 |
| hivelist 无结果 | Profile 差异过大 | 从低版本逐个测试 |
| vadinfo 输出混乱 | Profile 数据结构偏移错误 | 确认操作系统版本 |

---

## 4. Windows 加密取证

### 4.1 EFS 加密文件

EFS 使用用户证书加密，重装系统前必须导出证书：
```powershell
# 打开证书管理器
certmgr.msc
# 导出：个人 → 证书 → 找到"加密文件系统" → 右键导出 → 保存为 .cer
# 导入：双击 .cer 文件 → 安装证书 → 个人存储
```

### 4.2 BitLocker 恢复

BitLocker 恢复密钥可能的位置：
1. Microsoft 账户 (onedrive.live.com/recoverykey)
2. AD 活动目录
3. 打印/保存的恢复密钥文件 (.txt, .pdf)
4. 内存镜像 (Volatility: `bitlocker` 插件)
5. Passware Kit Forensic 可直接破解

BitLocker 恢复密钥格式：`XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX`

### 4.3 VeraCrypt 取证

VeraCrypt 加密卷特征：
- 文件扩展名通常为 `.hc` / `.tc` / 或无扩展名
- 文件头无魔数，看起来像随机数据
- 加密方式：AES / Serpent / Twofish 等

破解除使用 Passware Kit Forensic 外，也可以在内存镜像中搜索密钥：
```bash
# Volatility 中搜索 VeraCrypt 密钥
python vol.py -f mem.raw --profile=<Profile> veraCrypt
```

---

## 5. Linux 服务器取证速查

### 5.1 宝塔面板取证

```
默认端口: 8888
面板配置文件: /www/server/panel/data/userInfo.json
面板命令: bt
```

```bash
# 查看面板登录信息
cat /www/server/panel/data/userInfo.json

# 关闭安全登录
bt       # 然后选择对应序号

# 查看网站配置
ls /www/server/panel/vhost/nginx/
ls /www/server/panel/vhost/apache/

# MySQL 配置文件
cat /www/server/mysql/my.cnf
```

### 5.2 MySQL 恢复 (.frm + .ibd)

```sql
-- Step 1: 创建同名数据库
CREATE DATABASE target_db;

-- Step 2: 使用原 .frm 建表（注意字段定义一致）
-- Step 3: 卸载表空间
ALTER TABLE target_table DISCARD TABLESPACE;

-- Step 4: 复制 .ibd 文件到数据库目录
-- Step 5: 导入表空间
ALTER TABLE target_table IMPORT TABLESPACE;
```

### 5.3 CDN 绕过方法

识别 CDN 并查找真实 IP：
1. 历史 DNS 解析记录 (securitytrails.com, viewdns.info)
2. 子域名枚举 (fofa, shodan, zoomeye)
3. SSL 证书透明度日志 (crt.sh)
4. 邮件头分析（SMTP 日志中的源 IP）
5. 网站漏洞检测（SSRF 等）
6. 搜索引擎缓存

### 5.4 常见 WebShell 流量特征

| WebShell 工具 | 特征 |
|--------------|------|
| 蚁剑 (AntSword) | `?xxx=` 参数，Base64 编码，`@ini_set` 等 |
| 冰蝎 (Behinder) | AES 加密 payload，`Accept: application/octet-stream` |
| 哥斯拉 (Godzilla) | 自定义加密，`Cookie` 中携带密钥 |
| 菜刀 (Cknife) | 明文特征，`&z0=` 等参数 |

---

## 6. 取证工具速查

### 6.1 X-Ways Forensics 工作流

```
1. New Case → 案件名/编号/取证人员
2. Add Evidence → 添加检材 (E01/DD/文件夹)
3. Refine Disk Snapshot → 精炼快照 (可选)
4. File Filter → 按类型/大小/日期过滤
5. Search → 关键词搜索 (同步搜索)
6. Registry Report → 注册表解析
7. Event List (v16.9+) → 事件列表自动整理
8. Export → 导出证据
```

### 6.2 Passware Kit Forensic 密码破解

支持的文件类型：
- **全盘加密**: BitLocker, VeraCrypt, TrueCrypt, LUKS, Apple DMG, FileVault 2
- **压缩包**: RAR, 7z, ZIP
- **办公文档**: Office 2019/2016/2013/2007, PDF, WPS
- **系统密码**: Windows 本地/macOS/Linux

```python
# 生成字典脚本 (已知密码部分信息)
# 例如密码格式: Pgs0000d3j - Pgs9999d3j
with open("dict.txt", "w") as f:
    for i in range(10000):
        f.write(f"Pgs{i:04d}d3j\n")
```

破解流程：
1. 拖入加密文件 → 选择加密类型
2. 选择攻击模式（预定义/向导/自定义）
3. 配置字典/字符集/长度范围
4. GPU 加速暴力破解

### 6.3 时间戳批量解析脚本

```python
import json, sqlite3, os, struct, datetime
from pathlib import Path

# Chrome WebKit 时间戳 → datetime
def webkit_to_dt(webkit_ts):
    if webkit_ts == 0: return None
    # Chrome 时间戳单位是微秒，从 1601-01-01 开始
    return datetime.datetime(1601, 1, 1) + datetime.timedelta(microseconds=webkit_ts)

# Windows FILETIME → datetime
def filetime_to_dt(ft):
    # FILETIME 单位是 100 纳秒，从 1601-01-01 开始
    return datetime.datetime(1601, 1, 1) + datetime.timedelta(microseconds=ft // 10)

# Unix 时间戳 → datetime
def unix_to_dt(ts):
    return datetime.datetime.fromtimestamp(ts)

# OLE 日期 → datetime
def ole_to_dt(ole):
    return datetime.datetime(1899, 12, 30) + datetime.timedelta(days=ole)

# 示例：解析 Chrome History
def parse_chrome_history(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 20")
    for url, title, ts in cur.fetchall():
        dt = webkit_to_dt(ts)
        print(f"{dt} | {title} | {url}")
    conn.close()
```

---

## 7. 比武常见问题与解答模板

### 7.1 Windows 镜像常见问题

| 问题类型 | 数据来源 | 提取方法 |
|---------|---------|----------|
| 操作系统版本 | SOFTWARE 注册表 | `ProductName`, `CurrentBuild`, `InstallDate` |
| 系统安装时间 | SOFTWARE\...\CurrentVersion\InstallDate | Unix 时间戳转换 |
| 最后关机时间 | SYSTEM\...\Control\Windows\ShutdownTime | FILETIME 转换 |
| 计算机名 | SYSTEM\...\ComputerName\ComputerName | reg query |
| 用户名列表 | SAM\...\Users\Names | reg query 或 ls Users/ |
| 用户 SID | SAM\...\Users\Names\<用户名> | 注册表值 |
| 已连接 USB | SYSTEM\...\Enum\USBSTOR | USB 序列号/厂商 |
| 浏览器历史 | Chrome Default/History | SQLite + WebKit 时间转换 |
| 下载文件记录 | Chrome Default/History downloads | SQLite |
| 最近运行命令 | NTUSER.DAT RunMRU | 注册表查询 |
| 最近打开文件 | NTUSER.DAT ComDlg32\OpenSavePidlMRU | 注册表查询 |
| WiFi 密码 | SOFTWARE\Microsoft\WlanSvc | 注册表或 netsh |
| 程序执行痕迹 | Prefetch\*.pf | 解析 Prefetch 文件 |
| 回收站文件 | $Recycle.Bin\<SID>\ | 读取 $I 和 $R 文件 |
| 密码哈希 | SAM + SYSTEM 注册表 | 导出并离线破解 |
| EFS 加密文件 | NTFS 文件属性 | 检查 Advanced 属性 |

### 7.2 内存镜像常见问题

| 问题类型 | Volatility 插件 |
|---------|----------------|
| 进程列表 | pslist, psscan, pstree |
| 网络连接 | netscan, connscan, sockets |
| 命令行参数 | cmdline, cmdscan, consoles |
| 动态链接库 | dlllist, modscan, ldrmodules |
| 隐藏进程/注入 | malfind, hollowfind |
| 注册表快照 | hivelist, printkey, dumpregistry |
| 文件对象 | filescan, handles |
| 剪贴板内容 | clipboard |
| 用户密码/哈希 | hashdump, cachedump, lsadump |
| 时间线 | timeliner, mftparser |

### 7.3 服务器常见问题

| 问题类型 | 数据来源 |
|---------|---------|
| 宝塔面板账号 | /www/server/panel/data/userInfo.json |
| 网站域名/IP | Nginx/Apache 配置, 日志文件 |
| 数据库连接信息 | config.php, .env, web.config |
| SSH 登录记录 | /var/log/auth.log, /var/log/secure |
| Web 日志分析 | /var/log/nginx/access.log, /var/log/httpd/ |
| Docker 容器 | docker ps -a, docker images |
| 计划任务/后门 | crontab -l, /etc/cron*, systemctl |
| CDN 真实 IP | 历史 DNS, SSL 证书, 邮件头 |

### 7.4 手机备份常见问题

| 问题类型 | 华为 | 小米 |
|---------|------|------|
| 手机型号 | backupinfo.ini → protuct_model | MIbackupend.json → Protuct_model |
| IMEI | - | MIbackupend.json → IMEI 数组 |
| 备份版本 | info.xml → backupVersionName | MIbackupend.json → BackSoftVer |
| 联系人 | contact.db (hvRC 解密后 SQLite) | - |
| 照片 GPS | - | DCIM 照片 EXIF |
| 加密密码 | backupinfo.ini → pwdtip 提示 | 无加密 |
| 短信/通话 | 对应加密数据库 | 系统备份 |

---

## 8. 快速搜索命令模板

```powershell
# NTFS 磁盘镜像中搜索敏感文件
Get-ChildItem -Path "F:\" -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -match '\.(txt|db|kdbx|pf|evtx|log|xlsx|pdf|docx|enc|hc|tc)$' } |
    Select-Object FullName, Length, LastWriteTime

# 搜索密码/key/flag
Get-ChildItem -Path "F:\Users" -Recurse -File -ErrorAction SilentlyContinue |
    Select-String -Pattern "password|pwd|pass|flag|key|secret|token|bitlocker|recovery" -SimpleMatch |
    Select-Object Path, LineNumber, Line

# 搜索 Chrome 历史关键字
$historyDb = "F:\Users\*\AppData\Local\Google\Chrome\User Data\Default\History"
Get-ChildItem $historyDb -ErrorAction SilentlyContinue | ForEach-Object {
    sqlite3 $_.FullName "SELECT url, title, last_visit_time FROM urls WHERE title LIKE '%密码%' OR title LIKE '%账号%'"
}

# Prefetch 文件分析
Get-ChildItem "F:\Windows\Prefetch" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object Name, LastWriteTime

# 事件日志查询
wevtutil epl "F:\Windows\System32\winevt\Logs\Security.evtx" "$env:TEMP\sec.evtx"
wevtutil gp "$env:TEMP\sec.evtx" /q:"*[System[EventID=4624]]" /e:"$env:TEMP\sec.xml"
```

---

## 9. Python 取证通用脚本

```python
# Windows FILETIME 转 datetime
def filetime_to_dt(ft_bytes):
    """Windows FILETIME (8字节) → datetime"""
    import struct, datetime
    ft = struct.unpack("<Q", ft_bytes)[0]
    us = ft // 10  # 100ns → microseconds
    return datetime.datetime(1601, 1, 1) + datetime.timedelta(microseconds=us)

# Chrome 历史解析
def read_chrome_history(db_path, keyword=""):
    import sqlite3, datetime
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    sql = "SELECT url, title, last_visit_time FROM urls"
    if keyword:
        sql += f" WHERE title LIKE '%{keyword}%' OR url LIKE '%{keyword}%'"
    cur.execute(sql + " ORDER BY last_visit_time DESC LIMIT 100")
    for url, title, ts in cur.fetchall():
        if ts > 0:
            dt = datetime.datetime(1601,1,1) + datetime.timedelta(microseconds=ts)
            print(f"{dt} | {title} | {url}")
    conn.close()

# 搜索二进制文件中的字符串
def search_strings(data, min_len=4):
    import re
    result = []
    # ASCII
    for m in re.finditer(rb"[\x20-\x7e]{" + str(min_len).encode() + rb",}", data):
        result.append(m.group().decode("ascii", errors="replace"))
    # Unicode
    for m in re.finditer(rb"(?:[\x20-\x7e]\x00){" + str(min_len).encode() + rb",}", data):
        result.append(m.group().decode("utf-16-le", errors="replace"))
    return result

# 从挂载镜像读取 SQLite
def read_sqlite_from_image(img_path, db_rel_path):
    import tempfile, os, sqlite3
    with open(img_path, "rb") as f:
        data = f.read()
    # 实际需要先挂载镜像，此处为简化
    tf = tempfile.NamedTemporaryFile(delete=False)
    tf.write(data)
    tf.close()
    conn = sqlite3.connect(tf.name)
    return conn
```

---

## 10. 镜像仿真快速指南

### FTK Imager 挂载 E01
```
FTK Imager → File → Image Mounting → 选择 E01 → 挂载为物理/逻辑驱动器
```

### qemu-img 格式转换
```bash
# RAW/DD → VHD
qemu-img convert -f raw -O vhd source.dd output.vhd

# E01 → RAW (需 ewftools)
ewfexport source.E01

# qcow2 → VMDK
qemu-img convert -f qcow2 -O vmdk source.qcow2 output.vmdk
```

### VMware 手工仿真 (E01 → RAW → VMDK)
```bash
# 1. 挂载 E01 为 raw
ewfmount source.E01 /mnt/ewf/

# 2. 创建 vmdk 描述文件 (指向 raw 文件)
# 编辑 output.vmdk:
#   RW 62914560 FLAT "/mnt/ewf/ewf1" 0

# 3. 创建 vmx 配置文件

# 4. VMware Workstation → Open VM
```

### 规避 "物理磁盘已被使用"
当 VMware 报错"物理磁盘已被使用"时，使用上述 ewfmount + vmdk 描述文件方式，而非直接挂载物理磁盘。
## 适用场景

用于电子数据取证比武与实战研判快速参考；限时对多类检材做只读分析、线索定位、证据固定、答案闭环。

### 1. 典型业务场景

- 公安电子数据取证比武、CTF 取证、现场快速研判。
- Windows 磁盘：注册表、用户行为、USB、程序执行、浏览器历史、回收站、事件日志。
- 内存镜像：进程、网络、命令行、注入、剪贴板、密钥、文件对象。
- Linux 服务器：宝塔、Nginx/Apache、SSH、计划任务、WebShell、MySQL。
- 加密检材：BitLocker、VeraCrypt、加密压缩包、办公文档、数据库备份。
- 流量与隐蔽信道：ICMP、DNS、HTTP 外传数据识别与载荷还原。
- 跨检材关联：磁盘、内存、服务器、数据库、流量、手机备份中的账号、密钥、时间戳、文件哈希关联。

### 2. 适用检材与输入

| 检材类型 | 常见形态 | 适合本技能的工作 |
|---|---|---|
| Windows 磁盘 | E01、DD、VHD、VMDK | 注册表、时间线、用户痕迹、加密文件定位 |
| 内存镜像 | raw、lim、elf | Profile 判定、进程/网络/命令行/密钥提取 |
| Linux 服务器 | 磁盘镜像、压缩包、现场导出 | 宝塔、日志、WebShell、数据库、计划任务 |
| 数据库 | .frm、.ibd、.db、SQL 备份 | 表空间恢复、账号与业务数据关联 |
| 流量 | pcap、pcapng | 协议过滤、隐蔽信道还原、攻击链验证 |
| 手机备份 | 华为、小米备份包 | 备份信息、联系人、短信、照片 EXIF 线索 |

### 3. 不适用或需谨慎的场景

- 未只读固定、未计算哈希、未授权审批的在线操作。
- 需直接修改原始检材才能获取数据。
- 仅凭单一日志或单一字符串下结论，缺少交叉验证。
- 云端数据、远程活体系统需结合调证、镜像、审计日志处理。
- 加密容器无合法授权或密钥线索时，不得仅以暴力破解作为唯一结论。

### 4. 触发本技能的信号

- 要求给出可复核证据链，而非单纯答案。
- 需统一时间戳、时区、哈希、账号、文件路径。
- 出现 ICMP、DNS、WebShell、宝塔、MySQL、BitLocker、VeraCrypt、Volatility Profile 等关键词。
- 多检材需通过账号、密码、密钥、IP、域名、时间线闭环。

## 使用步骤

### 1. 检材登记与只读固定

1. 登记检材名称、来源、格式、大小、接收时间，生成唯一证据编号。
2. 原始镜像计算 MD5 与 SHA256；已有哈希先校验。
3. 只读挂载或导出，禁止写回原始检材。
4. 建立目录：`00_admin`、`01_disk`、`02_memory`、`03_network`、`04_export`、`05_report`。

### 2. 建立统一关联表

分析前建立证据表：检材ID、证据类型、文件路径、哈希、时间戳、账号、命令输出、结论、置信度；所有答案回写。

### 3. Windows 磁盘分诊顺序

1. 查看系统版本、安装时间、时区、语言。
2. 解析 SOFTWARE、SYSTEM、SAM、NTUSER：计算机名、用户、最后登录、USB、RunMRU、OpenSavePidlMRU。
3. 检查浏览器历史、下载、Cookie、缓存；Chrome/WebKit 时间戳需转换。
4. 检查 Prefetch、事件日志、回收站、计划任务、服务。
5. 全局搜索：password、pwd、key、secret、token、flag、bitlocker、recovery。

### 4. 内存镜像分析顺序

1. 用 `imageinfo`、`kdbgscan` 判定 Profile，不可只信单一结果。
2. 用 `pslist`、`psscan`、`pstree` 交叉确认进程，防隐藏进程漏检。
3. 用 `netscan`/`connscan` 查网络连接，结合 `cmdline` 判断行为。
4. 可疑进程执行 `procdump` 或 `memdump`，再做字符串、规则、YARA 或手工审查。
5. 补充验证剪贴板、命令行历史、注册表快照、文件对象。

### 5. 加密与密钥处理顺序

1. 先找恢复密钥、证书、密码提示、配置文件、内存密钥，再考虑爆破。
2. BitLocker 优先检查微软账户、AD、文本恢复密钥、内存插件、Passware。
3. VeraCrypt/TrueCrypt 优先检查内存密钥、密码提示、容器文件、挂载痕迹。
4. 解密后记录密钥来源、解密后哈希、挂载路径、解密文件清单。

### 6. Linux 服务器取证顺序

1. 宝塔：检查 `userInfo.json`、面板端口、站点配置、数据库配置。
2. Web：按 Nginx/Apache 配置定位站点目录；检查 access/error 日志、WebShell、上传目录。
3. 系统：检查 SSH、auth/secure、crontab、systemd、异常账号、authorized_keys。
4. MySQL：仅 `.frm` 与 `.ibd` 时，按同库同表结构恢复表空间，再导出关键表。
5. CDN：通过历史 DNS、证书透明度、邮件头、子域名、流量源 IP 多源验证。

### 7. ICMP 隐蔽信道提取流程

1. 筛选 ICMP Echo Request/Reply；关注异常长度、固定节奏、非常规 payload。
2. 导出 ICMP payload，按会话、IP、ICMP sequence、时间排序。
3. 按题目或样本规则拼接 payload 首字符、首字节、ASCII、Hex/Base64 片段。
4. 验证是否为外传数据：flag、密钥、文件哈希、账号、数据库字段、可读业务数据。
5. 结果不稳定时更换提取偏移、序列号分组、Request/Reply 方向，并记录每次规则。

### 8. 时间线与跨检材关联

1. 时间统一为北京时间或题目指定时区，并保留原始时间戳。
2. 将注册表、文件、日志、数据库、流量时间纳入同一时间线表。
3. 用账号、密码、密钥、IP、域名、文件哈希、数据库主键、聊天记录建立关联。
4. 同一事实至少两个独立来源支撑；单源时降低置信度并标注风险。

### 9. 闭环复核与提交

1. 每个答案必须能回答：来自哪个检材、哪个文件、哪条命令、哪段输出、如何转换、如何验证。
2. 重要结论用另一工具或命令复核，如注册表解析工具、SQLite 查询、Volatility 插件。
3. 输出证据清单、时间线表、关联表、命令输出、截图、哈希，形成可复核证据链。

## 输入输出说明

### 1. 输入说明

| 输入类别 | 内容要求 | 取证注意事项 |
|---|---|---|
| 检材镜像 | E01、DD、qcow2、VMDK、VHD | 校验哈希，只读挂载，禁止修改 |
| 内存镜像 | raw、lim、elf | 记录系统版本、构建号、Profile 依据 |
| 文件系统 | 注册表、日志、浏览器、数据库、备份 | 保留原始路径，导出记录哈希 |
| 网络流量 | pcap、pcapng、日志 | 记录过滤条件与协议范围 |
| 密钥材料 | 恢复密钥、证书、字典、密码提示 | 记录来源、格式、命中位置 |
| 题目/案件信息 | 时区、答案格式、检材编号 | 时间转换必须保留原始值 |

### 2. 标准输出物

1. 证据清单：证据编号、检材名称、文件路径、MD5/SHA256、提取时间、提取人、工具。
2. 统一证据表：检材来源、文件路径、数据库表、字段值、时间戳、哈希、验证方式、关联账号、结论、置信度。
3. 时间线表：原始时间戳、时间格式、转换公式、UTC 时间、北京时间、事件、来源文件。
4. 跨检材关联表：检材ID、证据类型、文件路径、哈希、时间戳、账号、密码/密钥复用、聊天内容、数据库记录、流量命中、结论。
5. 隐蔽信道输出：协议、源地址、目的地址、会话、序列号、payload 提取规则、解码结果、验证依据。
6. 答案提交包：最终答案、证据闭环表、关键截图、命令输出、导出文件、哈希清单。

### 3. 证据闭环模板

| 字段 | 必填内容 |
|---|---|
| 问题/结论 | 题目问题与最终答案 |
| 来源文件 | 检材ID、文件路径、数据库表或流量包 |
| 哈希 | 原始检材与关键导出文件的 MD5/SHA256 |
| 命令/工具 | 工具、版本、命令或插件 |
| 关键输出 | 能直接支撑结论的片段或截图编号 |
| 时间转换 | 原始时间戳、格式、时区、转换方式 |
| 多源验证 | 至少一个独立佐证来源；无佐证标注低置信度 |
| 复核记录 | 复核人、复核命令、是否一致 |

### 4. 答案格式约定

- 按题目要求提交，不额外添加空格、引号、换行或说明。
- 时间类答案明确题目时区；未说明时默认北京时间并备注原始时区。
- 哈希类答案明确 MD5、SHA1 或 SHA256，并保留计算命令。
- 账号、密码、密钥类答案注明来源文件与上下文，避免同名混淆。
- 隐蔽信道类答案附提取规则：ICMP sequence 拼接、取首字符、Hex 解码、Base64 解码等。

### 5. 冲突与人工裁决

不同检材、工具或时间来源冲突时不得自动覆盖；保留两套结果，记录差异、可能原因、置信度，标记待人工裁决。常见冲突：文件修改时间与日志时间不一致、注册表解析与二进制查看不一致、内存 Profile 推断不一致、数据库时间与系统时区不一致。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
