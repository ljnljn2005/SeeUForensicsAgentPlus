# 内存取证常见考题模式

> **路径变量说明**: 本文档中 `{MYOS_VOL3}`、`{MYOS_BITLOCKER}`、`{MYOS_TRUECRYPT}`、`{MYOS_TOOLS}` 为动态路径变量，由父 skill `forensics-memory-exam` 的第零步解析 MYOS 安装目录后替换为实际路径。执行命令前必须先完成第零步的路径解析。

## A — 进程分析类

### A1：查找指定进程的PID

**典型题目**：`请写出 notepad.exe 的进程PID`

**解法**：
```bash
# Vol3
{MYOS_VOL3} -f memory.mem windows.pslist | grep -i "notepad"
{MYOS_VOL3} -f memory.mem windows.pstree | grep -i "notepad"

# Vol2
vol.py -f memory.mem --profile=Win10x64 pslist | grep -i "notepad"
```

**常见陷阱**：
- 进程名可能大小写混合（notepad.exe / NOTEPAD.EXE）
- 若有多个同名进程，需结合父进程或启动时间区分
- 系统进程可能伪装（如 svch0st.exe vs svchost.exe）

**答案格式**：`PID: 1234`

---

### A2：查找进程的父进程PID

**典型题目**：`cmd.exe 的父进程PID是什么？`

**解法**：
```bash
# Vol3 — 直接查看进程树
{MYOS_VOL3} -f memory.mem windows.pstree

# Vol3 — 精确查询
{MYOS_VOL3} -f memory.mem windows.pslist --pid <PID>

# Vol2
vol.py -f memory.mem --profile=Win10x64 pstree
```

**判断技巧**：
- 正常cmd.exe父进程 → explorer.exe (用户双击启动)
- 可疑cmd.exe父进程 → 其他非系统进程（可能是恶意软件注入）
- 正常svchost.exe父进程 → services.exe
- 可疑svchost.exe父进程 → 非services.exe

**答案格式**：`PPID: 5678`

---

### A3：查看进程完整命令行

**典型题目**：`PID为1234的进程启动命令行是什么？`

**解法**：
```bash
# Vol3
{MYOS_VOL3} -f memory.mem windows.cmdline --pid 1234

# Vol2
vol.py -f memory.mem --profile=Win10x64 cmdline -p 1234
vol.py -f memory.mem --profile=Win10x64 consoles  # 更完整控制台历史
```

**关注点**：
- 异常参数（如 -enc <base64> → PowerShell编码执行）
- 下载命令（certutil -urlcache, bitsadmin, powershell Invoke-WebRequest）
- 反弹shell（nc -e, bash -i, /dev/tcp）

**答案格式**：`C:\Windows\System32\cmd.exe /c ping 192.168.1.100`

---

### A4：进程启动时间

**典型题目**：`explorer.exe 是什么时候启动的？（UTC+8）`

**解法**：
```bash
# Vol3 — pslist 输出包含 Start Time
{MYOS_VOL3} -f memory.mem windows.pslist | grep -i explorer

# 时区转换：Vol默认UTC，需按题目要求转换
```

**常见陷阱**：
- Volatility输出默认UTC+0
- 国内比赛通常要求UTC+8（北京时间）
- 美亚杯等国际赛通常用UTC+0

**答案格式**：`2024-06-15 08:30:15`（注明时区）

---

### A5：识别可疑/隐藏进程

**典型题目**：`哪个进程最可疑？请写出进程名和PID`

**判定标准**（优先级从高到低）：

| 可疑特征 | 示例 |
|---------|------|
| 随机字符进程名 | `x79ab3c.exe`, `dGhpcyBpcyBh.exe` |
| 伪装系统进程名 | `svch0st.exe`, `1sass.exe`, `csrss .exe` |
| 不在System32但同名系统进程 | `C:\Users\xxx\svchost.exe` |
| 异常父进程关系 | explorer.exe作为cmd.exe的子进程 |
| psscan有但pslist没有 | 被DKOM隐藏的进程 |
| 无数字签名的系统进程 | 系统进程必有微软数字签名 |

**解法**：
```bash
# 对比pslist和psscan找隐藏进程
{MYOS_VOL3} -f memory.mem windows.pslist > pslist.txt
{MYOS_VOL3} -f memory.mem windows.psscan > psscan.txt
diff pslist.txt psscan.txt

# 检查进程路径
{MYOS_VOL3} -f memory.mem windows.cmdline
{MYOS_VOL3} -f memory.mem windows.dlllist --pid <PID>  # 看加载路径
```

---

## B — 网络连接类

### B1：查找指定进程的网络连接

**典型题目**：`PID为1234的进程连接了哪个IP和端口？`

**解法**：
```bash
# Vol3
{MYOS_VOL3} -f memory.mem windows.netscan | grep "1234"

# Vol2
vol.py -f memory.mem --profile=Win10x64 netscan | grep "1234"
```

**输出理解**：
```
Offset          Proto  LocalAddr           ForeignAddr         State      PID
0x8e00a520      TCPv4  192.168.1.10:49152  10.0.0.100:443      ESTABLISHED 1234
```

- **LocalAddr** — 本机IP:端口
- **ForeignAddr** — 远程IP:端口
- **State** — 连接状态（ESTABLISHED=活跃连接, LISTENING=等待连接, CLOSED=已关闭）
- 区分内网IP（192.168./10./172.16-31.）和外网IP

**答案格式**：`IP: 10.0.0.100, 端口: 443`

---

### B2：识别C2通信

**典型题目**：`攻击者的C2服务器IP是什么？`

**分析思路**：
1. 找出所有外网ESTABLISHED连接
2. 交叉对比连接的进程
3. 关注非标准端口（非80/443/22/3389等）
4. 关注高频连接或心跳包特征

**解法**：
```bash
# 提取所有外网连接
{MYOS_VOL3} -f memory.mem windows.netscan | grep ESTABLISHED | \
  grep -v "192.168." | grep -v "10\." | grep -v "172\.1[6-9]" | grep -v "172\.2"

# 关键过滤
{MYOS_VOL3} -f memory.mem windows.netscan | grep ESTABLISHED | grep -v ":443 " | grep -v ":80 "
```

**答案格式**：`C2 IP: 45.xxx.xxx.xxx`

---

### B3：网络连接时间

**典型题目**：`最早建立的网络连接是什么时候？`

**解法**：
```bash
# Vol3 — netscan 包含 Created 时间
{MYOS_VOL3} -f memory.mem windows.netscan

# 注意：不是所有连接都有创建时间，部分协议可能没有
```

---

## C — 文件提取类

### C1：搜索内存中的特定文件

**典型题目**：`在内存中找到 flag.txt 并提交其内容`

**解法**：
```bash
# 1. 搜索文件
{MYOS_VOL3} -f memory.mem windows.filescan | grep -i "flag"

# 2. 提取文件（两种方式）
# 方式A：虚拟地址提取（推荐）
{MYOS_VOL3} -f memory.mem windows.dumpfiles --virtaddr 0xXXXXXXXXXXXX

# 方式B：物理偏移提取（Vol2）
vol.py -f memory.mem --profile=Win10x64 dumpfiles -Q 0xXXXXXXXX -D ./output

# 3. 查看提取文件内容
cat ./output/file.xxx.xxx.dat
strings ./output/file.xxx.xxx.dat
```

**常见文件搜索关键词**：
- `flag` / `flag.txt` / `flag{`
- `password` / `passwd` / `pwd`
- `secret` / `key` / `token`
- `Desktop` / `Documents` / `Downloads`
- `.txt` / `.zip` / `.rar` / `.png` / `.jpg`
- `.exe` / `.dll` / `.bat` / `.ps1`

---

### C2：提取恶意文件样本

**典型题目**：`提取PID为5678的恶意进程的可执行文件`

**解法**：
```bash
# 1. 从filescan找到exe文件的虚拟地址
{MYOS_VOL3} -f memory.mem windows.filescan | grep <进程名>

# 2. 导出文件
{MYOS_VOL3} -f memory.mem windows.dumpfiles --virtaddr 0xXXXXXXXXXXXX

# 3. 或直接dump进程内存
{MYOS_VOL3} -f memory.mem windows.memmap --pid 5678 --dump

# 4. 计算哈希
sha256sum output/file.xxx.dat
```

---

## D — 注册表分析类

### D1：查看自启动项

**典型题目**：`有哪些程序设置了开机自启动？`

**解法**：
```bash
# 常用自启动位置
{MYOS_VOL3} -f memory.mem windows.registry.printkey \
  --key "Microsoft\Windows\CurrentVersion\Run"

{MYOS_VOL3} -f memory.mem windows.registry.printkey \
  --key "Microsoft\Windows\CurrentVersion\RunOnce"

{MYOS_VOL3} -f memory.mem windows.registry.printkey \
  --key "Microsoft\Windows\CurrentVersion\RunServices"
```

**关注点**：
- 异常路径（用户目录下的exe设为自启动）
- 可疑脚本（.bat/.ps1/.vbs）
- base64编码的命令行参数

---

### D2：系统版本信息

**典型题目**：`写出操作系统的具体版本`

**解法**：
```bash
# Vol3 — 最直接
{MYOS_VOL3} -f memory.mem windows.info

# 注册表提取
{MYOS_VOL3} -f memory.mem windows.registry.printkey \
  --key "Microsoft\Windows NT\CurrentVersion"
```

**输出关键字段**：
- ProductName → 如 "Windows 10 Pro"
- CurrentBuild → 如 "19045"
- ReleaseId → 如 "22H2"
- InstallDate → Unix时间戳，需转换

**答案格式**：`Windows 10 Pro 22H2 (Build 19045)`

---

### D3：用户账户信息

**典型题目**：`系统中有哪些用户账户？`

**解法**：
```bash
# 查看SAM注册表
{MYOS_VOL3} -f memory.mem windows.registry.printkey --key "SAM\Domains\Account\Users\Names"

# 或直接hashdump
{MYOS_VOL3} -f memory.mem windows.hashdump
```

---

### D4：系统时区

**典型题目**：`系统的时区设置是什么？`

**解法**：
```bash
{MYOS_VOL3} -f memory.mem windows.registry.printkey \
  --key "ControlSet001\Control\TimeZoneInformation"
```

**常见输出**：
- TimeZoneKeyName → "China Standard Time" (UTC+8)
- ActiveTimeBias → 时区偏移（分钟）

---

## E — 凭据提取类

### E1：NTLM密码哈希

**典型题目**：`提取Administrator用户的NTLM哈希`

**解法**：
```bash
# Vol3
{MYOS_VOL3} -f memory.mem windows.hashdump

# Vol2
vol.py -f memory.mem --profile=Win10x64 hashdump
```

**输出格式**：`Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::`

格式说明：`用户名:RID:LM哈希:NTLM哈希:::`

---

### E2：AES密钥提取

**典型题目**：`从内存中提取AES加密密钥`

**解法**：
```bash
# Vol3 — 扫描AES密钥特征
{MYOS_VOL3} -f memory.mem windows.aeskeyfind

# strings辅助
strings memory.mem | grep -E '^[A-Fa-f0-9]{32}$' | head -20
strings memory.mem | grep -E '^[A-Fa-f0-9]{64}$' | head -20
```

**常见场景**：
- BitLocker密钥（FVE_KEY标识附近）
- VPN客户端加密密钥
- 数据库连接加密密钥

---

### E3：剪贴板内容

**典型题目**：`从内存中提取剪贴板中的内容`

**解法**：
```bash
# Vol3
{MYOS_VOL3} -f memory.mem windows.clipboard

# Vol2
vol.py -f memory.mem --profile=Win10x64 clipboard
```

**注意**：剪贴板在内存中持续时间有限

---

### E4：环境变量中的敏感信息

**典型题目**：`环境变量中是否包含敏感信息？`

**解法**：
```bash
{MYOS_VOL3} -f memory.mem windows.envars
```

**关注**：
- API_KEY, TOKEN, SECRET等变量名
- 数据库连接字符串
- 云服务凭证

---

### E5：内存加密密钥搜索（BitLocker / TrueCrypt / VeraCrypt）

**典型题目**：`从内存镜像中提取 BitLocker 加密密钥` / `找出 TrueCrypt/VeraCrypt 的加密密钥`

**专用工具**（位于 `{MYOS_TOOLS}`，优先使用，比 Volatility 更精准）：

```bash
# BitLocker 密钥搜索
{MYOS_BITLOCKER}  memory.raw  .\output_keys

# TrueCrypt / VeraCrypt 密钥搜索
{MYOS_TRUECRYPT}  memory.raw  .\output_keys
```

**通用格式**：`<工具路径> <内存镜像> <导出目录>`

**工具选择规则**：

| 加密类型 | 工具 | 内存中特征 |
|---------|------|-----------|
| BitLocker | `BitlockerKeySearch.exe` | FVE_KEY 标识、BitLocker 驱动程序残留 |
| TrueCrypt | `TrueCryptKeySearch.exe` | TC 驱动残留、密钥调度表 |
| VeraCrypt | `TrueCryptKeySearch.exe` | VC 驱动残留、密钥调度表 |

**备用方案**（Volatility 3，当专用工具不可用时）：
```bash
# AES 密钥扫描 — 通用方法，但误报较多
{MYOS_VOL3} -f memory.mem windows.aeskeyfind
```

**strings 辅助搜索**：
```bash
# 搜索 BitLocker 相关标识
strings memory.raw | grep -i "FVE_KEY"
strings memory.raw | grep -i "BitLocker"

# 搜索 TrueCrypt/VeraCrypt 相关标识
strings memory.raw | grep -i "TrueCrypt"
strings memory.raw | grep -i "VeraCrypt"
```

**输出说明**：
- 工具会在导出目录生成包含密钥信息的文件
- BitLocker 密钥通常以特定结构存储，可能是完整密钥或恢复密钥
- TrueCrypt/VeraCrypt 密钥通常是加密卷头部的密钥数据

**常见陷阱**：
- 内存采集时间需在系统**解锁加密卷之后**，否则密钥不在内存中
- 系统休眠/睡眠状态的内存镜像更可能包含密钥
- 如果系统已重启，加密密钥将从内存中清除

**答案格式**：`<密钥文件的路径或密钥内容>`

---

## F — 恶意代码检测类

### F1：Malfind注入检测

**典型题目**：`哪个进程被注入了恶意代码？请写出PID`

**解法**：
```bash
{MYOS_VOL3} -f memory.mem windows.malfind
```

**判定标准**：
- 出现 `PAGE_EXECUTE_READWRITE` 权限的VAD区域
- VAD区域开头有MZ头（0x4D 0x5A）
- 进程不应该有可执行+可写的私有内存区域

**常见误报**：
- JIT编译引擎（如.NET CLR, JavaScript引擎）
- 某些正常反作弊软件
- 需要结合进程行为综合判断

**答案格式**：`PID: 4321`

---

### F2：隐藏模块检测

**典型题目**：`找出加载了隐藏DLL的进程`

**解法**：
```bash
# 对比三种模块视图
{MYOS_VOL3} -f memory.mem windows.dlllist --pid <PID>     # VAD视图
{MYOS_VOL3} -f memory.mem windows.modules                  # 驱动模块
{MYOS_VOL3} -f memory.mem windows.ldrmodules --pid <PID>   # 三视图对比

# LDR Modules 对比 PEB/DLL列表/VAD — 不一致则有隐藏
```

---

### F3：进程空洞检测

**典型题目**：`哪个进程存在进程空洞（Hollowing）？`

**解法**：
```bash
# 检查进程VAD和PEB的ImageBase是否一致
# VAD中ImageBase与PEB不同 → 可能被Hollowing

{MYOS_VOL3} -f memory.mem windows.vadinfo --pid <PID>
{MYOS_VOL3} -f memory.mem windows.dlllist --pid <PID>
```

**特征**：
- VAD ImageBase ≠ PEB ImageBaseAddress
- 进程VAD保护权限异常

---

## G — 系统信息类

### G1：操作系统信息汇总

**典型题目**：`写出操作系统的版本、安装时间和计算机名`

**解法**：
```bash
# 基本信息
{MYOS_VOL3} -f memory.mem windows.info

# 计算机名
{MYOS_VOL3} -f memory.mem windows.registry.printkey \
  --key "ControlSet001\Control\ComputerName\ComputerName"

# 安装时间 — 注册表
{MYOS_VOL3} -f memory.mem windows.registry.printkey \
  --key "Microsoft\Windows NT\CurrentVersion" | grep InstallDate
```

---

### G2：已安装的补丁/更新

**典型题目**：`系统安装了哪些安全补丁？`

**解法**：
```bash
# Vol3 — 没有直接插件，查注册表
{MYOS_VOL3} -f memory.mem windows.registry.printkey \
  --key "Microsoft\Windows\CurrentVersion\Component Based Servicing\Packages"

# strings搜索
strings memory.mem | grep "KB[0-9]" | sort -u
```

---

## H — 综合场景类

### H1：攻击链重构

**典型题目**：`还原攻击者的完整攻击链`

**分析步骤**（按时间线）：

```bash
# 1. 进程全景
{MYOS_VOL3} -f memory.mem windows.pstree
{MYOS_VOL3} -f memory.mem windows.pslist

# 2. 网络连接
{MYOS_VOL3} -f memory.mem windows.netscan

# 3. 命令行历史
{MYOS_VOL3} -f memory.mem windows.cmdline

# 4. 恶意代码检测
{MYOS_VOL3} -f memory.mem windows.malfind

# 5. 文件提取
{MYOS_VOL3} -f memory.mem windows.filescan | grep -iE "\.exe|\.bat|\.ps1|\.vbs"

# 6. 服务/自启动
{MYOS_VOL3} -f memory.mem windows.svcscan | grep -i <可疑服务>

# 7. 时间线
{MYOS_VOL3} -f memory.mem timeliner.Timeliner
```

**攻击链标准输出格式**：
```
1. 初始入侵：通过XXX方式（如钓鱼邮件附件xxx.doc）
2. 执行Payload：PID xxx 执行 cmd.exe /c powershell -enc ...
3. 建立C2：连接 45.xxx.xxx.xxx:4444
4. 提权/持久化：创建服务 xxx 或 注册表Run键 xxx
5. 横向移动/数据窃取：...
```

---

### H2：内存中的完整取证画像

**典型题目**：`基于内存镜像，对系统做完整的数字取证画像`

**综合命令集**：
```bash
# 系统信息
{MYOS_VOL3} -f memory.mem windows.info

# 所有用户
{MYOS_VOL3} -f memory.mem windows.hashdump

# 所有进程+命令行
{MYOS_VOL3} -f memory.mem windows.pslist
{MYOS_VOL3} -f memory.mem windows.cmdline

# 所有网络连接
{MYOS_VOL3} -f memory.mem windows.netscan

# 文件系统
{MYOS_VOL3} -f memory.mem windows.filescan

# 恶意代码
{MYOS_VOL3} -f memory.mem windows.malfind

# 凭据
{MYOS_VOL3} -f memory.mem windows.clipboard
{MYOS_VOL3} -f memory.mem windows.envars

# 时间线
{MYOS_VOL3} -f memory.mem timeliner.Timeliner
```

---

## 答案快速输出模板

各题型答案格式统一标准：

| 题型 | 答案格式示例 |
|------|------------|
| PID查询 | `1144`（纯数字，不写PID:前缀） |
| IP地址 | `192.168.1.100` |
| 端口号 | `443` |
| 进程名 | `cmd.exe` / `notepad.exe` |
| 命令行 | `完整命令行字符串` |
| 文件路径 | `C:\Users\xxx\Desktop\flag.txt` |
| NTLM哈希 | `31d6cfe0d16ae931b73c59d7e0c089c0` |
| 注册表键值 | `键值的字符串内容` |
| 时间 | `2024-06-15 08:30:15 UTC+8` |
| 系统版本 | `Windows 10 Pro 22H2 Build 19045` |
| 判断类 | `是` / `否` / `-`（无） |
| 计数类 | `3` / `12`（纯数字） |
