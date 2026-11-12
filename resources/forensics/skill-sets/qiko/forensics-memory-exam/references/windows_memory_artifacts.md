# Windows 内存取证制品速查

## 进程相关制品

### 进程结构关键字段

| 结构 | 关键字段 | 取证意义 |
|------|---------|---------|
| _EPROCESS | ImageFileName | 进程名（最多15字符） |
| _EPROCESS | UniqueProcessId | PID |
| _EPROCESS | InheritedFromUniqueProcessId | 父进程PID |
| _EPROCESS | CreateTime | 进程创建时间 |
| _EPROCESS | ExitTime | 进程退出时间 |
| _EPROCESS | ActiveProcessLinks | 进程链表（被DKOM攻击目标） |
| _EPROCESS | Peb | 指向PEB的指针 |
| _EPROCESS | VADRoot | VAD树根节点 |
| _EPROCESS | Token | 访问令牌 |
| _PEB | ImageBaseAddress | 可执行文件加载基址 |
| _PEB | Ldr | PEB_LDR_DATA — 模块列表 |
| _PEB | ProcessParameters | 命令行、当前目录、环境变量 |

### 可疑进程判定清单

```
☐ 进程名包含随机字符（如 x7ab9c.exe）
☐ 进程名伪装系统进程（如 svch0st.exe, 1sass.exe）
☐ 进程路径不在System32但名称与系统进程相同
☐ 父进程异常（cmd.exe的父进程不是explorer.exe）
☐ psscan有但pslist没有的进程
☐ 无数字签名
☐ 异常启动时间（系统刚启动就启动的非系统进程）
☐ VAD中存在PAGE_EXECUTE_READWRITE权限区域
☐ 进程有网络连接到非标准端口
☐ 进程的命令行包含base64编码或下载命令
```

---

## 网络连接制品

### TCP连接状态

| 状态 | 含义 | 取证意义 |
|------|------|---------|
| ESTABLISHED | 当前活跃连接 | 最有价值的取证线索 |
| LISTENING | 等待连接 | 后门/服务识别 |
| CLOSE_WAIT | 远端关闭，本地等待关闭 | 最近活跃过的连接 |
| TIME_WAIT | 连接刚关闭 | 短时间内仍有价值 |
| SYN_SENT | 正在尝试连接 | 恶意软件连接尝试 |
| CLOSED | 已关闭 | 价值较低 |

### 可疑网络连接特征

```
☐ 外网IP + 非标准端口（非80/443/22/3389等）
☐ 连接到已知恶意IP/域名
☐ 高频重复连接同一IP（心跳/C2 beacon）
☐ 常见C2端口：4444, 5555, 6666, 7777, 8080, 8443, 31337
☐ DNS请求异常（长域名、DGA生成域名）
☐ 非系统进程的LISTENING端口
```

---

## 注册表制品

### 核心取证注册表路径

```text
# === 系统信息 ===
Microsoft\Windows NT\CurrentVersion
  ├── ProductName          → 产品名 (Windows 10 Pro)
  ├── CurrentBuild         → 版本号 (19045)
  ├── ReleaseId            → 版本代号 (22H2)
  ├── InstallDate          → 安装时间戳
  ├── RegisteredOwner      → 注册用户
  └── RegisteredOrganization → 注册组织

# === 自启动项 ===
Microsoft\Windows\CurrentVersion\Run
Microsoft\Windows\CurrentVersion\RunOnce
Microsoft\Windows\CurrentVersion\RunServices
Microsoft\Windows\CurrentVersion\Policies\Explorer\Run

# === 计算机名 ===
ControlSet001\Control\ComputerName\ComputerName → ComputerName

# === 时区 ===
ControlSet001\Control\TimeZoneInformation
  ├── TimeZoneKeyName      → "China Standard Time"
  ├── ActiveTimeBias       → 时区偏移（分钟）
  └── DaylightName         → 夏令时名称

# === 用户账户 ===
SAM\Domains\Account\Users
SAM\Domains\Account\Users\Names     → 用户名列表

# === 网络配置 ===
ControlSet001\Services\Tcpip\Parameters\Interfaces
  └── {GUID}\DhcpIPAddress   → DHCP分配的IP

# === 最近访问 ===
Software\Microsoft\Windows\CurrentVersion\Explorer\RecentDocs
NTUSER.DAT\Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU

# === USB设备 ===
ControlSet001\Enum\USB
ControlSet001\Enum\USBSTOR

# === 服务 ===
ControlSet001\Services\<ServiceName>
  ├── ImagePath    → 服务可执行文件路径
  ├── Start        → 启动类型 (2=自动, 3=手动, 4=禁用)
  └── Type         → 服务类型

# === 已安装软件 ===
Software\Microsoft\Windows\CurrentVersion\Uninstall
  └── {GUID}\DisplayName → 软件显示名称

# === 用户Shell文件夹 ===
Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders
  ├── Desktop       → 桌面路径
  ├── Personal      → 文档路径
  └── AppData       → AppData路径

# === 默认浏览器 ===
Software\Clients\StartMenuInternet     → 默认浏览器
Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice

# === 启动/关机 ===
ControlSet001\Control\Windows\ShutdownTime    → 最后关机时间
```

---

## Hive文件对照

| Hive文件 | 挂载路径 | 内容 |
|---------|---------|------|
| SYSTEM | `\REGISTRY\MACHINE\SYSTEM` | 系统配置、服务、硬件 |
| SOFTWARE | `\REGISTRY\MACHINE\SOFTWARE` | 已安装软件 |
| SAM | `\REGISTRY\MACHINE\SAM` | 安全账户管理器 |
| SECURITY | `\REGISTRY\MACHINE\SECURITY` | 安全策略、LSA |
| NTUSER.DAT | `\REGISTRY\USER\<SID>` | 用户配置（每个用户一个） |
| USRCLASS.DAT | `\REGISTRY\USER\<SID>_Classes` | 用户COM类注册 |
| DEFAULT | `\REGISTRY\USER\.DEFAULT` | 默认用户配置 |
| Amcache.hve | `\REGISTRY\MACHINE\AMCACHE` | 程序执行记录（Win8+） |
| BBI | `\REGISTRY\MACHINE\BBI` | 启动配置数据(BCD) |

---

## 内存中的文件类型魔数

快速通过魔数搜索识别内存中的文件：

| 文件类型 | 魔数（十六进制） |
|---------|-----------------|
| EXE/DLL | `4D 5A` (MZ) |
| PE | `4D 5A ... 50 45 00 00` (MZ...PE) |
| ZIP | `50 4B 03 04` (PK) |
| RAR | `52 61 72 21 1A 07 00` (Rar!) |
| 7z | `37 7A BC AF 27 1C` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| JPEG | `FF D8 FF E0` / `FF D8 FF E1` |
| GIF | `47 49 46 38` (GIF8) |
| BMP | `42 4D` (BM) |
| PDF | `25 50 44 46` (%PDF) |
| OLE2(doc/xls) | `D0 CF 11 E0 A1 B1 1A E1` |
| OOXML(docx) | `50 4B 03 04` (同ZIP) |
| SQLite3 | `53 51 4C 69 74 65 20 66` (SQLite format) |
| ELF(Linux) | `7F 45 4C 46` |
| Mach-O(macOS) | `FE ED FA CE` / `CF FA ED FE` |

---

## 进程注入技术特征

| 注入技术 | 内存特征 | Volatility检测插件 |
|---------|---------|-------------------|
| DLL注入 | PEB的LDR列表比VAD多 | `ldrmodules` |
| Process Hollowing | ImageBase不匹配 | `vadinfo` + `dlllist` |
| Reflective DLL | 无文件映射的MZ头 | `malfind` |
| APC注入 | 可疑线程StartAddress | `threads` |
| Atom Bombing | GlobalAtomTable异常 | `atoms` / `atomsacan` |
| Process Doppelganging | 事务NTFS特征 | `filescan` |
| Shellcode注入 | PAGE_EXECUTE_READWRITE + MZ | `malfind` |

---

## 常见考题取证线索速查

| 待查内容 | 第一优先级命令 | 第二优先级命令 |
|---------|---------------|---------------|
| 可疑进程 | `pslist` → `psscan` | `malfind` |
| C2通信 | `netscan` | `cmdline` |
| 恶意文件 | `filescan` → `dumpfiles` | `memmap` |
| 密码/密钥 | `hashdump` / `aeskeyfind` | `clipboard` / `envars` |
| 用户信息 | `hashdump` | `registry.printkey SAM` |
| 系统版本 | `windows.info` | `registry.printkey CurrentVersion` |
| 自启动项 | `registry.printkey Run` | `svcscan` |
| 进程隐藏 | `psscan vs pslist` | `ldrmodules` |
| 攻击时间线 | `timeliner` | `pslist` + `netscan` |
| 浏览器痕迹 | `browserhist.BrowserHist` | `filescan` → dump |
