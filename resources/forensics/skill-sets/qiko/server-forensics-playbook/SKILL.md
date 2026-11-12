---
name: server-forensics-playbook
description: >
  多节点服务器取证的完整解题方法论。核心能力：环境侦察、云服务商识别、宝塔面板分析、
  Docker容器取证、Trojan代理分析、Webshell检测、RDP扫描分析、AI助手日志分析、
  Telegram bot分析、加密文件解密（GPG/SQLCipher/Argon2id/vaultwarden）、数据库恢复与SQL聚合、
  Redis数据取证、WASM恶意代码分析、宝塔WAF配置分析、llama.cpp AI模型取证、
  自定义加密算法解密（XOR+reverse+base64）、多工作表Excel批量统计、PostgreSQL取证。
  Use when 用户需要服务器取证、应急响应、恢复被删除/加密的数据库备份、宝塔面板分析、
  Docker容器取证、AI助手日志分析、加密文件解密、或提及"取证"、"服务器调查"、"应急响应"。
metadata:
  tags: "forensics,server,取证,服务器,ssh,docker,encryption,sqlcipher,argon2,wasm,redis,baota,trojan,webshell,btwaf,llama-cpp,xor,excel,postgresql"
  category: "forensics"
---

# 服务器取证分析手册 (Server Forensics Playbook)

多节点服务器取证的完整解题方法论。核心能力：环境侦察、云服务商识别、宝塔面板分析、Docker容器取证、Trojan代理分析、Webshell检测、RDP扫描分析、AI助手日志分析、Telegram bot分析、加密文件解密（GPG/SQLCipher/Argon2id/vaultwarden）、数据库恢复与SQL聚合、Redis数据取证、WASM恶意代码分析、宝塔WAF配置分析、llama.cpp AI模型取证、自定义加密算法解密（XOR+reverse+base64）、多工作表Excel批量统计、PostgreSQL取证。

## 一、触发条件

- 多节点服务器取证（E01 镜像或 SSH 存活机器）
- 服务器安全调查 / 应急响应
- 需恢复被删除/加密的数据库备份
- 宝塔面板网站重构与分析
- Docker容器化应用源码提取与配置分析
- AI助手（openclaw等）会话日志与密码管理器分析
- Telegram bot配置与数据库分析
- 加密文件（GPG/SQLCipher/AES/Argon2id）解密
- Trojan代理服务配置分析
- Webshell检测与攻击溯源
- RDP/端口扫描结果分析
- WASM恶意代码分析与黑盒测试
- Redis缓存数据取证

## 二、输入要求

- SSH 连接信息（IP、端口、账号、密码）
- 或 E01 镜像文件路径
- 题目列表（明确需要回答的取证问题）

## 三、输出标准

- 每道题给出：答案 + 证据来源（命令/文件路径/数据记录）
- 关键密码标注完整链路：来源 → 中间步骤 → 最终解密结果
- 加密解密操作需保存中间产物路径（解密后的文件路径）
- SQL 查询需记录完整 SQL 语句和结果

## 四、快速流程（9步）

```
1. SSH连接 → 2. 环境侦察 → 3. 云服务商识别 → 4. Docker/容器分析
 5. 宝塔/网站分析 → 6. AI助手分析 → 7. Telegram bot分析
 8. 加密解密 → 9. 数据库恢复与SQL聚合
```

**密码链路追踪**（贯穿全流程）：
```
AI助手会话日志 → 主密码 → password-manager → 各条目密码
（数据库密码、服务器密码、GPG密码、SQLCipher密码等）
```

## 五、核心方法论：路径灵活性原则

> **本手册所有路径均为"常见位置"而非"固定位置"。取证环境千变万化，永远先动态发现再使用。**

| 原则 | 做法 | 示例 |
|------|------|------|
| 不写死路径 | 用 `find`、`which`、`readlink -f` 动态定位 | `OC=$(find /root /home -maxdepth 3 -name 'openclaw.json' | head -1 \| xargs dirname)` |
| 不写死版本 | 用通配符 `*` 或动态查找 | `export PATH="$(ls -d /root/.nvm/versions/node/*/bin 2>/dev/null \| head -1):$PATH"` |
| 不写死用户目录 | 搜索 `/root/` 和 `/home/*/` | `find /root /home -maxdepth 3 -name 'config.toml'` |
| 用变量传递 | 先设默认值再用 find 覆盖 | `OC=${OPENCLAW_HOME:-/root/.openclaw}` |
| 方法论 > 具体值 | 记录"怎么找"而非"在哪里" | — |

## 六、SSH 连接方法

**优先使用 MCP `qiko-forensics-server-mcp`**（`register-server` → `execute-command`；连接复用、持久化、文件传输）。用户给出 IP/账号/密码时默认走此路径，**禁止**先写 askpass/paramiko/ssh 脚本。详见 `references/ssh-commands.md`。

```text
# 工具名形如 qiko-forensics-server-mcp__register-server / __execute-command
register-server: { host, port, username, password, name }
execute-command: { server, command }   # e.g. uname -r
```

**降级方案（仅 MCP 不可用或调用失败后）**：向用户说明 / `ask_user`；最后才考虑 Python paramiko 或本地 ssh 脚本。

## 七、各环节要点速查

> 详细命令见 `references/` 对应文件。以下为各环节关键判断和陷阱。

### 7.1 环境侦察（详见 ssh-commands.md）
- 系统信息、登录用户、Web站点、Docker容器、数据库配置、定时任务、历史命令
- **陷阱**：非系统用户计数不能仅用 UID>=1000，需对比 CentOS 7 默认用户列表

### 7.2 云服务商识别（详见 cloud-identification.md）
- 通过 `cloud-init` 元数据（`obj.pkl`）判断：阿里云=`DataSourceAliYun2Local`，腾讯云=`DataSourceConfigDrive`
- 关键字段：`image-id`、`instance-id`、`region`
- **陷阱**：pickle 文件需 python3 解析，不能直接 cat

### 7.3 Docker 容器取证（详见 docker-forensics.md）
- 容器无法启动时从 `overlay2` 层提取源码：`find /var/lib/docker/overlay2 -path '*/diff/*'`
- 框架识别：`cat package.json | grep -E 'next|react|vue|nuxt'`
- **Docker 镜像当工具箱**：断网时用已有镜像运行工具（node、python、sqlcipher等），详见 §八
- **陷阱**：containerd 快照在 docker 不可用时要走 `ctr` 命令

### 7.4 宝塔面板分析（详见 baota-analysis.md）
- 动态定位：`BT_DIR` 和 `WWWROOT` 通过 `find` 发现，不假设 `/www/`
- MySQL root密码在 `default.db` 的 `config` 表 `mysql_root` 字段
- **陷阱**：用 `mysql -h127.0.0.1` 绕过 socket 匿名用户匹配

### 7.5 AI 助手分析（详见 openclaw-analysis.md）
- **第一步必做**：动态定位 `OPENCLAW_HOME`
- 会话日志（`.jsonl`）是最容易忽略的密码来源
- **password-manager 提取密码**：主密码从会话日志获取，然后 `node password-manager.mjs list/get`
- **Docker 降级**：主机无 node 时，用 `docker run --rm -v ... --entrypoint node node:20-alpine` 运行 password-manager
- **陷阱**：node 路径不固定，需动态发现 nvm 路径；无 node 时用 Docker 降级

### 7.6 Telegram Bot 分析（详见 telegram-bot.md）
- 配置文件可能是 TOML/JSON/.env，路径不固定，需全盘搜索
- 数据库通常为 SQLite，可能未加密
- **陷阱**：Telegram 用户名可能用 HTML 实体编码（`&#122;` → `z`）

### 7.7 加密解密（详见 encryption-decryption.md）
- GPG 对称加密：`gpg --batch --passphrase '<pw>' -d`
- SQLCipher：多工具链降级解密（Python cryptography → C+libsqlcipher → Docker sqlcipher → 手动 PBKDF2），详见 §九
- vaultwarden：PBKDF2 + HKDF-Expand + AES-256-CBC
- **Argon2id 密码哈希**：`$argon2id$` 前缀识别，Python `argon2-cffi` 多进程爆破（详见 §九·六）
- **陷阱**：SQLCipher 第1页 salt 替换了 SQLite 魔数，解密后需补回；Argon2id 的 `verify_secret` 需匹配 `Type.ID/I/D`

### 7.8 数据库恢复与SQL聚合（详见 database-recovery.md）
- 查找备份：`find / -name '*.sql*' 2>/dev/null | grep -v overlay2`
- PostgreSQL 还原：`docker exec -i psql psql -U <user> -d <db> < decrypted.sql`
- **通用SQL聚合框架**：先自动发现表结构 → 再按题型构造查询，详见 §十
- **Redis 数据取证**：`keys '*'` → `type <key>` → 对应命令查询；常存 API Key、管理员凭据、使用量统计、Webhook 配置（详见 database-recovery.md §八）
- **陷阱**：PostgreSQL 保留大小写，查询需用双引号 `"actualPrice"`；Redis 各数据类型命令不同，先看 type

### 7.9 Trojan 服务配置分析（详见 trojan-analysis.md）
- 全局搜索：`find / -name 'config.json' -path '*trojan*'`，可能存在多个配置文件
- **多配置文件**：逐个打开看内容，不要假设哪个是"实际运行"哪个是"混淆"——用 `systemctl`/`ps` 确认实际加载路径
- **混淆流量域名**：看被混淆配置的 `remote_addr`，不是 `ssl.cert` 路径中的域名
- `run_type` 可能被混淆，需对比 `examples/` 目录四种模式**逐字段匹配**
- **remote_addr 作用因模式而异**：server→本地Web，其他→外部，先确定模式再判断作用

### 7.10 Webshell 检测与攻击溯源（详见 webshell-detection.md）
- 日志分析：重点 POST + 200 + 可疑文件名（.php）
- 内容检测：`grep -rlE 'eval\s*\(|assert\s*\(' /www/wwwroot/ --include='*.php'`
- **陷阱**：Webshell 可能伪装成正常文件名（如 config.php、db.php）

### 7.11 RDP 扫描结果分析（详见 rdp-scan-analysis.md）
- 查找扫描工具：`find / -name 'fscan*' -o -name 'hydra*' 2>/dev/null`
- 检查历史命令：`grep -iE 'fscan|hydra|3389' /root/.bash_history`
- 结果文件通常在 `/root/result.txt`

### 7.12 WASM 恶意代码分析（详见 wasm-malware-analysis.md）
- **发现**：`find / -name '*.wasm' 2>/dev/null`；`grep -rl 'WebAssembly\|\.wasm' src/`
- **反编译**：`wasm2wat module.wasm -o module.wat`；`strings module.wasm | grep -iE 'exe|shell|nc|powershell'`
- **黑盒测试**：编写 Node.js 脚本调用 WASM 导出函数，控制变量探测行为
- **三重条件触发**：UA 过滤 + IP 时间窗口（`Date.now()`）+ 概率（`Math.random()`）
- **关键线索**：WASM 导入 `__wbg_now_`=时间逻辑，`__wbg_random_`=概率逻辑
- **陷阱**：时间窗口探测必须用全新IP批次，先统一记录时间戳再统一检测

## 八、断网环境工具利用策略

> 取证服务器常为离线环境，无法 `apt install`。以下为工具降级链路。

### 8.1 工具可用性检查（先查后做）

```bash
# 一次性检查所有常用工具
for tool in python3 sqlite3 mysql psql gpg openssl docker node npm; do
  printf "%-10s: " "$tool"; which $tool 2>/dev/null || echo "NOT FOUND"
done
```

### 8.2 Docker 镜像当工具箱（核心降级方案）

服务器上已有的 Docker 镜像可作为工具来源，无需联网安装：

```bash
# 查看已有镜像（离线环境唯一工具来源）
docker images

# 用 node 镜像运行 JS 脚本（如 password-manager）
docker run --rm -v /path/to/scripts:/work -w /work \
  -e PASSWORD_MANAGER_MASTER_PASSWORD='<master_pw>' \
  --entrypoint node node:20-alpine /work/password-manager.mjs list

# 用 python 镜像运行 Python 脚本（如解密脚本）
docker run --rm -v /path/to/scripts:/work -w /work \
  python:3.11-slim python3 /work/decrypt.py

# 用 postgres 镜像恢复数据库
docker run -d -p 5432:5432 --name psql \
  -e POSTGRES_USER=<user> -e POSTGRES_PASSWORD=<pw> \
  -e POSTGRES_DB=<db> postgres:16

# 用 mysql 镜像恢复数据库
docker run -d -p 3306:3306 --name mysql \
  -e MYSQL_ROOT_PASSWORD=<pw> mysql:8
```

### 8.3 从 Docker 镜像提取动态库

当需要特定 `.so` 库（如 `libsqlcipher.so`）但服务器上版本不兼容时：

```bash
# 从镜像中提取库文件
docker run --rm --entrypoint cat <image_name> /path/to/libxxx.so > /tmp/libxxx.so

# 编译 C 程序链接提取的库
gcc -o /tmp/tool /tmp/tool.c /tmp/libxxx.so
LD_LIBRARY_PATH=/tmp /tmp/tool
```

### 8.4 Python ctypes 调用动态库（无需编译 C）

```python
import ctypes
lib = ctypes.CDLL('/tmp/libsqlcipher.so.0')
# 直接调用库函数，无需 gcc
```

### 8.5 工具降级决策树

```
需要工具 X？
├─ 服务器已安装 → 直接用
├─ 未安装但有 Docker 镜像 → docker run --rm 用镜像跑
├─ 未安装且无镜像 → 检查是否有 .so 库 → ctypes/C 程序调用
├─ 需要特定版本库 → 从 Docker 镜像提取 .so → 编译链接
└─ 以上都不行 → 用 Python 标准库手写（hashlib/hmac/aes）
```

## 九、数据库解密决策树

> 遇到无法直接打开的数据库文件时，按此决策树逐步排查。详见 `references/encryption-decryption.md`。

### 9.1 第一步：识别文件类型

```bash
# 检查文件头魔数
xxd -l 64 <db_file>
file <db_file>

# 判断依据：
# "SQLite format 3" → 普通SQLite，直接 sqlite3 打开
# 非 SQLite 魔数 + 文件较大 → 可能是 SQLCipher 加密
# "Salted__" → OpenSSL 加密
# GPG 头部 → GPG 加密
```

### 9.2 第二步：密码发现（按优先级）

```
密码来源优先级（从高到低）：
1. AI助手 password-manager → node password-manager.mjs get --name '<entry>' --show-password
2. AI助手会话日志 → grep -i 'password\|passphrase\|密码' sessions/*.jsonl
3. 应用配置文件 → .env / config.toml / database.php 中的 DATABASE_URL/PASSWORD
4. Docker inspect 环境变量 → docker inspect <container> | grep -A20 '"Env"'
5. 历史命令 → .bash_history / .mysql_history 中的密码
6. 备份脚本 → find / -name '*.sh' | xargs grep -i 'password'
7. Redis 数据 → redis-cli -a '<pw>' keys '*credential*' / hgetall session:admin_credentials
```

### 9.3 第三步：多工具解密降级链

```
SQLCipher 数据库解密（依次尝试，从快到慢）：
1. sqlcipher CLI（如已安装）→ sqlcipher <db> "PRAGMA key='<pw>';"
2. 本地 Windows 工具 DLL → 下载 db.db 到本地 → ctypes 加载 sqlcipher.dll（详见 §9.5）
3. Python ctypes → 直接调用服务器上的 libsqlcipher.so 函数
4. Docker 容器内运行 → docker run --rm -v <db>:/data --entrypoint sqlcipher <image>
5. Python cryptography 库 → 手动 PBKDF2+AES 脚本（详见 encryption-decryption.md）
6. Python 标准库 + openssl → 零依赖手写解密（详见 encryption-decryption.md）

Argon2id 密码哈希破解（详见 encryption-decryption.md §六）：
1. 已知密码格式 → 枚举所有组合，Python argon2-cffi 多进程并行（★推荐）
2. 有字典 → 逐条验证，hashcat 或 Python 脚本
3. 服务器有 node + argon2 npm 包 → 直接在服务器跑
4. 下载哈希到本地 → Python argon2-cffi 多核爆破

★ 推荐优先尝试方法2：本地 Windows 工具自带的 sqlcipher.dll 版本较新，
  兼容 SQLCipher v4 默认参数，通常无需设置 cipher_compatibility 即可成功。
  当服务器端所有方法都报"file is encrypted or is not a database"时，此方法往往是最终突破口。
```

### 9.4 第四步：版本兼容性处理

```
解密报 "file is encrypted or is not a database"？
├─ 检查 SQLCipher 版本：ldd <binary> | grep sqlcipher（静态链接则无输出）
├─ 静态链接的 Go/Rust 二进制 → 内置 SQLCipher 版本可能更新，系统库不兼容
│   └─ ★ 此时优先用 §9.5 本地 Windows 工具 DLL 方案（内置新版 SQLCipher）
├─ 尝试不同 cipher_compatibility：PRAGMA cipher_compatibility = 3; / = 4;
├─ 尝试不同 KDF 迭代次数：64000(v1) / 256000(v4) / 自定义
├─ 尝试不同页大小：1024 / 4096
└─ 最终方案：用 Python 标准库手写 PBKDF2+AES（不依赖外部库版本）
```

### 9.5 本地 Windows 工具 DLL 解密（强烈推荐）

> 当服务器端 SQLCipher 库版本不兼容（尤其是 Go/Rust 静态链接二进制创建的数据库）时，
> **下载 db.db 到本地 Windows**，用本地 SQLCipher 工具的 DLL 解密。这是最可靠的降级方案。
> **路径灵活性**：以下代码动态发现 DLL 路径，不写死任何固定路径。

**第一步：动态发现本地的 sqlcipher.dll**

```python
import os, glob, ctypes

# 方式1：用户指定路径（最高优先级）
# 环境变量 SQLCIPHER_DLL_PATH 可由用户提前设置
dll_path = os.environ.get('SQLCIPHER_DLL_PATH', '')

# 方式2：常见安装位置通配搜索
if not dll_path or not os.path.isfile(dll_path):
    search_patterns = [
        os.path.join(os.environ.get('ProgramFiles', 'C:\\Program Files'), '**', 'sqlcipher.dll'),
        os.path.join(os.environ.get('ProgramFiles(x86)', 'C:\\Program Files (x86)'), '**', 'sqlcipher.dll'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), '**', 'sqlcipher.dll'),
        # DB Browser for SQLCipher 常见位置
        os.path.join(os.environ.get('USERPROFILE', '~'), '**', 'DB Browser*', 'sqlcipher.dll'),
        # D 盘等常见数据盘
        'D:\\**\\sqlcipher.dll',
        'E:\\**\\sqlcipher.dll',
    ]
    for pattern in search_patterns:
        matches = glob.glob(pattern, recursive=True)
        if matches:
            dll_path = matches[0]
            break

if not dll_path or not os.path.isfile(dll_path):
    print('未找到 sqlcipher.dll，请设置环境变量 SQLCIPHER_DLL_PATH 或安装 DB Browser for SQLCipher')
    exit(1)

print(f'Found sqlcipher.dll: {dll_path}')
```

**第二步：下载 db.db 到本地（从远程服务器）**

```python
# 通过 SSH-MCP 下载（已在 §六 中建立连接）
# mcp_ssh-mcp downloadFile({ connectionId, remotePath: '/path/to/db.db', localPath: './db.db' })
# 或用 scp / sftp 命令行
```

**第三步：解密并查询**

```python
# 加载 DLL（注意中文路径需 encode 为 utf-8）
dll_dir = os.path.dirname(dll_path)
os.add_dll_directory(dll_dir)  # 让 Windows 能找到依赖的 DLL
lib = ctypes.CDLL(dll_path)

# 设置函数签名
lib.sqlite3_open.restype = ctypes.c_int
lib.sqlite3_open.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
lib.sqlite3_exec.restype = ctypes.c_int
lib.sqlite3_exec.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_char_p)]
lib.sqlite3_close.restype = ctypes.c_int
lib.sqlite3_close.argtypes = [ctypes.c_void_p]
lib.sqlite3_errmsg.restype = ctypes.c_char_p
lib.sqlite3_errmsg.argtypes = [ctypes.c_void_p]

# 回调函数用于接收查询结果
CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_int,
                      ctypes.POINTER(ctypes.c_char_p), ctypes.POINTER(ctypes.c_char_p))
rows = []
def cb(userdata, n_cols, vals, names):
    row = [vals[i].decode('utf-8', errors='replace') if vals[i] else 'NULL' for i in range(n_cols)]
    rows.append(row)
    return 0
callback = CB(cb)

# 注意：本地 Windows 工具的 sqlcipher.dll 通常内置较新版本 SQLCipher，
# 默认参数即为 v4（SHA512/256000/4096），通常无需设置 cipher_compatibility
db_path_local = os.path.abspath('db.db').encode('utf-8')  # 处理中文路径
password = '<password>'  # 从密钥发现决策树获取

db = ctypes.c_void_p()
lib.sqlite3_open(db_path_local, ctypes.byref(db))
err = ctypes.c_char_p()
lib.sqlite3_exec(db, f'PRAGMA key = "{password}";'.encode(), None, None, ctypes.byref(err))

# 如果默认参数失败，再尝试兼容模式
for compat in [None, 4, 3, 2, 1]:
    if compat is not None:
        lib.sqlite3_exec(db, f'PRAGMA cipher_compatibility = {compat};'.encode(), None, None, ctypes.byref(err))
    rows.clear()
    rc = lib.sqlite3_exec(db, b"SELECT name FROM sqlite_master WHERE type='table';", callback, None, ctypes.byref(err))
    if rc == 0 and rows:
        print(f'SUCCESS (compat={compat})')
        for r in rows: print(r)
        break
    if compat is None:
        print(f'Default failed: {lib.sqlite3_errmsg(db)}')
lib.sqlite3_close(db)
```

**为什么这个方法有效**：
- DB Browser for SQLCipher 等 Windows 工具的 dll 包含完整的 SQLCipher v4 实现
- Go 二进制（如 go-sqlcipher）静态链接的 SQLCipher 版本可能与服务器上的旧 libsqlcipher 不兼容
- Windows 工具的 dll 版本通常较新，默认参数即可匹配 v4 格式
- **不需要在服务器上安装任何东西**，只需下载 db.db 文件

**本地 SQLCipher 工具发现清单**：

| 工具 | 可能的 DLL 名称 | 发现方法 |
|------|----------------|----------|
| DB Browser for SQLCipher | `sqlcipher.dll` | `glob('**/DB Browser*/sqlcipher.dll')` |
| DB Browser for SQLite (with cipher) | `sqlcipher.dll` | 同上 |
| SQLiteStudio | `sqlcipher.dll` | `glob('**/SQLiteStudio*/sqlcipher.dll')` |
| Navicat | `sqlcipher3.dll` 或 `sqlcipher.dll` | `glob('**/Navicat*/sqlcipher*.dll')` |

## 十、通用 SQL 聚合框架

> 不写死表名和字段名，先自动发现结构再构造查询。详见 `references/database-recovery.md`。

### 10.1 第一步：识别数据库类型

```
文件头 / 扩展名 → 数据库类型：
├─ "SQLite format 3" → SQLite（可能加密，见 §九）
├─ .sql 文件 → 看头部：-- PostgreSQL / -- MySQL / SET
├─ Docker 容器 → docker inspect | grep Image → postgres/mysql/mongo/redis
├─ 端口判断 → 5432=PG, 3306=MySQL, 27017=Mongo, 6379=Redis
└─ 配置文件 → .env / config 中的 DATABASE_URL scheme
```

### 10.2 第二步：自动发现表结构（不假设表名）

```bash
# SQLite / SQLCipher（解密后）
sqlite3 <db> '.tables'
sqlite3 <db> '.schema <table>'

# PostgreSQL
psql -U <user> -d <db> -c '\dt'
psql -U <user> -d <db> -c '\d <table>'

# MySQL
mysql -u <user> -p<pw> -h127.0.0.1 -e 'SHOW TABLES;' <db>
mysql -u <user> -p<pw> -h127.0.0.1 -e 'DESCRIBE <table>;' <db>

# MongoDB
mongosh <db> --eval 'db.getCollectionNames()'
mongosh <db> --eval 'db.<collection>.findOne()'

# 无数据库时：从 SQL 备份文件解析表结构
grep -oP 'INSERT INTO `?\w+`?' backup.sql | sort -u
grep -oP 'CREATE TABLE `?\w+`?' backup.sql | sort -u
```

### 10.3 第三步：通用查询模式（按题型分类）

| 题型 | 通用查询模式 | 注意事项 |
|------|-------------|----------|
| 统计数量 | `SELECT COUNT(*) FROM <table> WHERE <condition>;` | 确认"多少个"=COUNT不是列表 |
| 求和/总额 | `SELECT SUM(<amount_col>) FROM <table> WHERE <status_col> = <completed_value>;` | 确认"已完成"状态值 |
| 间隔最短 | `SELECT <id_col>, MIN(<time_col>) - <reg_time_col> AS diff FROM ... ORDER BY diff ASC LIMIT 1;` | 返回单个值不是多行 |
| 时间范围 | `SELECT * FROM <table> WHERE <time_col> BETWEEN <start> AND <end>;` | 确认时间戳是UNIX还是DATETIME |
| 分组统计 | `SELECT <group_col>, COUNT(*) FROM <table> GROUP BY <group_col> ORDER BY COUNT(*) DESC;` | — |
| 关联查询 | `SELECT ... FROM <a> JOIN <b> ON <a>.<fk> = <b>.<pk> WHERE ...;` | 确认关联字段 |

### 10.4 第四步：无数据库时的 SQL 解析（纯文本聚合）

当数据库无法启动/恢复时，直接从 `.sql` 备份文件解析：

```python
import re
content = open('backup.sql', encoding='utf-8', errors='replace').read()

# 自动发现所有表名和 INSERT 语句
tables = set(re.findall(r'INSERT INTO [`"]?(\w+)[`"]?', content))
for t in tables:
    rows = re.findall(rf"INSERT INTO [`\"]?{re.escape(t)}[`\"]? VALUES \((.*?)\);", content, re.DOTALL)
    print(f'{t}: {len(rows)} rows')
    if rows:
        # 解析第一行看字段结构
        first = re.findall(r"'[^']*'|\d+\.\d+|\d+", rows[0])
        print(f'  字段数: {len(first)}, 示例: {first[:5]}...')
```

### 10.5 SQL 题意理解陷阱

| 题目表述 | 正确理解 | 错误理解 |
|----------|----------|----------|
| "找出间隔最短的用户id" | 返回单个值 | 返回多行 |
| "统计总共有多少个" | 返回 COUNT | 返回列表 |
| "连续三天内下单" | 间隔 <= 3天 | 连续3个日历日 |
| "已成功交易" | status=已完成 | status=已支付 |

## 十一、关键数据定位速查

| 数据 | 常见位置 | 说明 |
|------|----------|------|
| 网站数据库配置 | `application/database.php`、`.env` | 库名、账号、密码 |
| 密码保险箱 | vaultwarden `db.sqlite3`、openclaw password-manager | 存关键密码 |
| 聊天记录 | MongoDB（fiora）`db.messages.find({})` | 常含作案过程 |
| AI助手会话日志 | `~/.openclaw/agents/*/sessions/*.jsonl*` | 密码、操作记录 |
| 加密备份 | `/data/bakup/`、`/srv/backup/`、`/www/backup/` | GPG/SQLCipher/AES |
| Telegram bot配置 | `find / -name 'config.toml'` | Bot Token |
| 宝塔网站配置 | `/www/server/panel/vhost/` | Nginx站点配置 |
| Docker源码 | `/var/lib/docker/overlay2/*/diff/` | 容器层文件 |
| cloud-init元数据 | `/var/lib/cloud/instances/*/obj.pkl` | 云服务商 |
| 应用环境配置 | `.env` 或容器内 `/app/.env` | DATABASE_URL、API_KEY |
| Docker环境变量 | `docker inspect <container>` 的 Env 段 | 数据库密码、API密钥 |
| Trojan配置 | `find / -name 'config.json' -path '*trojan*'` | 代理服务配置 |
| Webshell痕迹 | `/www/wwwlogs/*.log` + `/www/wwwroot/*.php` | 攻击溯源 |
| 扫描结果 | `/root/result.txt` 等 | fscan/hydra输出 |
| **Redis数据** | `redis-cli -a '<pw>' keys '*<keyword>*'` | 应用运行时数据：凭据、API Key、统计、配置 |
| **WASM恶意模块** | `find / -name '*.wasm'` | 隐蔽投毒载体，通过反编译或黑盒测试分析 |
| **Argon2哈希** | `$argon2id$`/`$argon2i$`/`$argon2d$` 前缀 | 密码哈希，多进程爆破 |
| **node路径** | `find / -name node -type f \| grep -v node_modules` | nvm/fnm/系统安装，路径不固定 |

## 十二、经验教训（精要版）

1. **多节点题先画拓扑图**：明确每台角色，数据流向就是解题线索
2. **AI助手会话日志是最容易忽略的密码来源**：涉案人员常在AI对话中直接发密码
3. **密码链路要完整追踪**：会话日志 → 主密码 → password-manager → 数据库/服务器密码
4. **SQLCipher解密多工具降级**：sqlcipher CLI → 本地Windows工具DLL（★推荐） → Python ctypes → Docker → Python cryptography，不要只用一种方法
5. **SQLCipher版本兼容性**：Go/Rust二进制可能静态链接新版SQLCipher，服务器旧库不兼容 → **最终方案：下载db.db到本地Windows，用本地工具的sqlcipher.dll解密（§9.5）**
6. **Docker overlay2**：容器无法启动时直接从层提取源码
7. **`set +o history`是销毁痕迹信号**：往前翻 `.bash_history`、`.mysql_history`、`.viminfo`
8. **宝塔MySQL匿名用户陷阱**：用 TCP 连接 `-h127.0.0.1` 绕过 socket
9. **断网环境用Docker镜像当工具箱**：无法apt安装时，已有镜像可运行node/python/sqlcipher等
10. **openclaw node路径不固定**：动态发现 nvm 路径；无node时用Docker降级运行password-manager
11. **PostgreSQL保留大小写**：查询用双引号 `"actualPrice"`
12. **时间戳时区**：服务器通常UTC，需转东八区（UTC+8）
13. **SQL题意理解**："间隔最短"=单个值；"多少个"=COUNT；"连续三天内"=间隔<=3天
14. **加密密码搜索优先级**：AI助手password-manager > 会话日志 > 聊天记录 > 配置文件 > 历史命令 > 备份脚本
15. **通用SQL聚合不写死表名**：先 `.tables`/`\dt`/`SHOW TABLES` 发现结构，再构造查询
16. **Docker inspect 是信息宝库**：Env段含密码、Mounts段含配置路径、Image段含框架信息
17. **Trojan多配置文件**：可能存在多个配置文件，逐个打开看内容，`run_type`可能被混淆
18. **Trojan混淆流量域名**：看被混淆配置的`remote_addr`，不是`ssl.cert`路径域名
19. **Trojan remote_addr作用因模式而异**：server→本地Web，其他→外部，先确定模式再判断作用
20. **Webshell伪装**：可能用正常文件名（config.php、db.php），需内容检测+日志分析双管齐下
21. **非系统用户计数**：不能仅用 UID>=1000，需对比 CentOS 7 默认用户列表
22. **TPShop多订单表**：有多张订单相关表，时间字段不同，一张表结果不合理就换另一张试
23. **SQLCipher最终突破口：本地Windows工具DLL**：当服务器端所有解密方法都失败时，下载db.db到本地Windows，用DB Browser for SQLCipher等工具自带的sqlcipher.dll通过ctypes加载解密。DLL路径用glob动态发现或环境变量指定，不写死路径（§9.5）
24. **数据库备份可能在另一台服务器上**：多节点取证时，web1的数据库备份可能在web2上（如 `/data/bakup/`），不要只在一台服务器上搜索
25. **GPG加密的SQL备份可直接grep解析**：不需要恢复到数据库，解密后的SQL dump可直接用grep/awk提取数据（COMPLETED订单、面值等）
26. **HTML实体编码隐藏数据**：技术支持用户名等敏感信息可能用HTML实体编码（`&#122;` → `z`），需解码后查看
27. **Argon2密码爆破**：`$argon2id$`/`$argon2i$`/`$argon2d$` 前缀识别，Python `argon2-cffi` 的 `verify_secret` 多进程并行。根据哈希前缀自动选择 Type 参数（Type.ID/I/D），不硬编码类型
28. **WASM是隐蔽投毒载体**：Node.js/Python应用中的 `.wasm` 文件可能含恶意逻辑。通用分析方法：`find`发现 → `grep`分析JS绑定 → `wasm2wat`反编译 → 编写脚本黑盒测试。从WASM导入函数推断内部逻辑（`__wbg_now_`=时间逻辑，`__wbg_random_`=概率逻辑）
29. **多条件触发函数探测法**：当函数返回bool且依赖多个条件时，用控制变量法逐一隔离——先固定其他条件测试单个条件是否通过，再逐步组合。关键：每次用全新标识符（IP/ID），先统一记录再统一检测，样本量≥200消除概率干扰
30. **Redis取证不只有SQL**：应用数据常存Redis，`keys '*<keyword>*'` 通配发现 → `type <key>` 确认类型 → 对应命令查询。复杂配置常以JSON字符串存为string类型，`get`后需解析
31. **node路径动态发现**：可能是nvm、fnm或系统安装，用 `find / -name node -type f | grep -v node_modules` 动态发现，不假设特定路径
32. **配置数据可能藏在非配置文件中**：Webhook配置、超时设置等可能存在Redis的string类型key中（JSON字符串），而非传统配置文件。`keys '*config*'`/`keys '*webhook*'` 发现后 `get` 获取并解析JSON
33. **宝塔mysql_root字段可能存旧密码**：宝塔`default.db`的mysql_root字段可能存旧密码（如"admin"），实际密码已被修改。正确获取：宝塔面板界面→数据库→root密码，或用`mysql -uroot -p'<密码>' -h127.0.0.1`直接验证，不信任default.db的值
34. **宝塔polkit漏洞修复**：动态定位`find /www /root /opt -name 'polkit_upgrade.py'`（常见但不固定），实际CVE编号查`rpm -q --changelog polkit`，通过INSTALLTIME时间戳对比判断"之前存在的漏洞"
35. **llama.cpp server API获取模型参数**：`curl http://127.0.0.1:<port>/v1/models`的meta字段含n_params（参数量）、n_ctx（上下文长度）；`curl /props`也可获取n_ctx（端口从docker inspect或ss -tlnp动态发现）。**注意：未传--ctx-size参数时n_ctx随内存变化**（4G=117760, 8G=262144），竞赛以标准仿真环境为准
36. **Docker restart策略匹配**：`always`=停止后马上重启，`no`=不重启，通过`docker inspect`的`HostConfig.RestartPolicy.Name`获取
37. **XOR+reverse+base64自定义加密**：ThinkPHP网站可能用CryptoHelper类，解密为`base64_decode → reverse → XOR(key)`，密钥和算法在`CryptoHelper.php`中（用`find . -name 'CryptoHelper.php'`定位，不写死密钥）
38. **多工作表Excel统计陷阱**：取证"料子"文件可能含数十个工作表，必须遍历`wb.sheetnames`全部统计，不能只查第一个
39. **openEuler PostgreSQL连接**：动态定位psql路径`find / -name 'psql' -type f`（常见`/www/server/pgsql/bin/psql`但不固定），连接方式`su - postgres -c "<psql_path> -d <db> -c '<query>'"`（本地socket认证免密）
40. **宝塔WAF配置位置**：动态定位`find /www -maxdepth 3 -name 'btwaf' -type d`（常见`/www/server/btwaf/`但不固定），全局配置在`<btwaf_dir>/config.json`，检查`open:true`判断规则启用状态
41. **SQL"购买份数"查shares不查amount**：合约表中amount=投资金额，shares=购买份数，题目问"多少份"必须查shares字段，先`\d <table>`理解字段语义再构造查询
42. **Docker容器初始化密码从日志获取不爆破**：`docker logs <container> 2>&1 | grep -i password` 或宿主机`find / -name '*init*.log'`直接获取明文密码，不爆破bcrypt哈希

> 详细的47条经验教训见 `references/experience-lessons.md`

## 十三、参考文件索引

| 参考文件 | 内容 | 何时查阅 |
|----------|------|----------|
| `references/ssh-commands.md` | SSH连接方法、环境侦察命令、非系统用户计数 | 需要SSH巡检命令时 |
| `references/cloud-identification.md` | cloud-init解析、云服务商识别方法 | 需识别云服务商时 |
| `references/docker-forensics.md` | 容器分析、overlay2提取、Docker当工具箱、库提取 | 遇到Docker容器时 |
| `references/baota-analysis.md` | 宝塔面板定位、网站配置、密码加密逻辑 | 遇到宝塔面板时 |
| `references/openclaw-analysis.md` | openclaw定位、配置、会话日志、password-manager、Docker降级 | 遇到AI助手时 |
| `references/telegram-bot.md` | Bot配置定位、数据库分析 | 遇到Telegram bot时 |
| `references/encryption-decryption.md` | GPG/SQLCipher多工具链/vaultwarden/APK解密、密钥发现决策树 | 遇到加密文件时 |
| `references/database-recovery.md` | 通用SQL聚合框架、多数据库类型覆盖、SQL解析、Redis取证 | 需数据库分析时 |
| `references/trojan-analysis.md` | Trojan配置定位、run_type识别、流量混淆 | 遇到代理服务时 |
| `references/webshell-detection.md` | Web日志分析、木马检测、攻击溯源 | 遇到Webshell攻击时 |
| `references/rdp-scan-analysis.md` | fscan/hydra扫描结果定位与分析 | 遇到扫描痕迹时 |
| `references/wasm-malware-analysis.md` | WASM模块发现、反编译、黑盒测试、三重条件触发探测 | 遇到WASM恶意代码时 |
| `references/experience-lessons.md` | 完整经验教训 | 遇到问题时查阅 |

## 十四、常用工具清单

- **SSH连接**：`qiko-forensics-server-mcp`（首选：register-server → execute-command）；Python paramiko / 本地 ssh 脚本仅 MCP 失败后降级
- **断网工具箱**：Docker 镜像（node:20-alpine、python:3.11-slim、postgres:16、mysql:8）
- **APK逆向**：androguard、jadx、apktool
- **密码保险箱**：Python `hashlib` + `cryptography`、openclaw password-manager
- **SQLCipher解密**：sqlcipher CLI → **本地Windows工具DLL（★推荐）** → Python ctypes → Docker容器 → Python `hashlib`+`hmac`+`cryptography` → Python 标准库+openssl
- **Argon2id破解**：Python `argon2-cffi`（`verify_secret` + `multiprocessing.Pool`）→ hashcat GPU → Node.js argon2 npm 包
- **数据库**：sqlite3、mongosh、mysql、psql、**redis-cli**（均可用Docker镜像降级）
- **WASM分析**：`wasm2wat`（反编译）、`strings`（提取硬编码字符串）、Node.js 黑盒测试脚本
- **加密解密**：openssl、gpg、Python `cryptography`、Python 标准库（hashlib/hmac/aes）
- **库提取**：`docker run --rm --entrypoint cat <image> /path/to/lib.so > /tmp/lib.so`
- **取证镜像**：pyewf（E01）、pytsk3
- **流量分析**：tshark
- **宝塔面板**：`bt` 命令、`/www/server/panel/`
- **Docker**：docker CLI、overlay2文件提取、Docker镜像当工具箱
- **本地Windows SQLCipher工具**：DB Browser for SQLCipher（`sqlcipher.dll`，通过 `glob` 或 `SQLCIPHER_DLL_PATH` 环境变量动态发现）

## 适用场景

本手册适用于以服务器、虚拟化、容器和网站业务系统为对象的取证调查、镜像仿真、服务恢复、证据固定与量化统计。重点覆盖从磁盘镜像到业务后台的完整链路，并强调静态原始证据优先、动态仿真结果需复核。

### 1. 适用检材
- 服务器磁盘镜像：E01、dd、raw、qcow2、vmdk、vdi。
- 虚拟化检材：PVE 虚拟机、LXC 容器、KVM 磁盘、OpenWrt 网关镜像。
- 在线检材：SSH 可登录服务器、容器宿主机、Kubernetes 节点、宝塔面板服务器。
- 业务对象：Docker、containerd、Kubernetes、overlay2、镜像、YAML、NFS、Nginx、Node.js、PHP、Java、Python。
- 数据对象：MySQL、MariaDB、PostgreSQL、Redis、MongoDB、SQLCipher、数据库备份、binlog、WAL、RDB/AOF。

### 2. 适用任务
- 服务器基础事实认定：系统版本、主机名、网卡、账号、登录日志、端口、服务、计划任务。
- 网站后台重构：宝塔、Nginx、站点目录、数据库连接、验证码绕过、管理员登录验证。
- 数据库恢复与统计：恢复删除备份、解密数据库、还原 SQL、按题目进行 COUNT、SUM、GROUP、JOIN 统计。
- 容器与云原生取证：Docker 容器层提取、镜像导出导入、Kubernetes YAML 恢复、容器 ID 与时间戳静态复核。
- 攻击溯源：SSH、RDP、Web 日志、Webshell、代理、扫描工具、异常进程、恶意脚本、WASM 模块。
- 移动端联动：将 APP、小程序、终端证据与服务器面板配置、数据库、容器、WAF、源码和业务日志关联。

### 3. 典型环境
- 宝塔 + Nginx + MySQL + Redis 的中小网站。
- Docker Compose 或 Kubernetes 承载的 Node.js、Java、Python 业务。
- PVE 或 OpenWrt 组成的虚拟化与网关环境。
- 多节点案件：Web、DB、缓存、代理、AI 助手、密码管理器、备份节点分离部署。

### 4. 启动前置条件
- 已有检材哈希或可固定原始镜像；在线取证需记录时间、账号、命令和变更。
- 已明确题目或调查目标，避免无边界全盘仿真。
- 具备 SSH 凭据、镜像读取工具、数据库客户端、解密工具或可用 Docker 镜像。
- 对生产环境必须优先只读、快照、导出配置，不直接修改业务数据。

### 5. 不适用或需谨慎场景
- 仅有内存镜像或仅有流量包：本手册可作为关联方法，但需结合内存取证或流量分析专项。
- 无法获得密钥的全盘加密卷：先解决密钥来源，否则不能直接仿真。
- 高可用生产集群：禁止直接启动、重启、清理或覆盖，需变更审批和镜像副本。
- 仅依赖动态页面截图：必须回到静态文件、数据库、日志或配置复核。

### 6. 证据优先级
1. 原始镜像与哈希。
2. 静态文件：配置、日志、数据库文件、备份、容器层。
3. 服务配置：Nginx、Docker、Kubernetes、宝塔、数据库、Redis。
4. 运行态验证：后台登录、API 返回、数据库查询。
5. 统计结论：SQL、脚本、Excel 汇总和命令链。

## 使用步骤

> 本节为完整使用步骤，与上文快速流程互补，不替换原有章节。

### 0. 总体原则
- 先固定原始证据，再做仿真；先静态后动态；先底座后业务；先入口后数据。
- 每一步记录命令、路径、时间、输出和结论；动态结果必须能回到静态证据复核。
- 对容器、Kubernetes、宝塔、数据库等对象，不假设固定路径，使用 find、which、readlink、docker inspect、systemctl 动态定位。

### 1. 检材接收与基础环境确认
1. 校验镜像哈希，确认 E01、dd、qcow2、vmdk、raw 格式。
2. 识别分区、文件系统、操作系统、内核、启动参数、网卡和时区。
3. 检查登录日志、服务配置、历史命令、计划任务，建立可信对象边界。
4. 对 PVE、OpenWrt、Docker、LXC、Kubernetes 环境，先记录宿主机、存储池、网络桥接和容器运行时版本。

常用命令：`uname -a`、`cat /etc/os-release`、`lsblk -f`、`ip a`、`ss -lntup`、`systemctl list-units --type=service`。

### 2. 镜像仿真与只读挂载
- 优先只读挂载或快照副本；对 qcow2、vmdk 使用 qemu-nbd 或取证工具挂载。
- 对 E01 先导出或只读映射，不直接写回原始镜像。
- 对虚拟机仿真，先补齐网卡、hosts、DNS、启动项，再启动业务。
- 对容器检材，优先静态解析 overlay2、镜像层、配置文件；确需启动时先复制层或导出镜像。

### 3. 基础信息采集
采集：主机名、账号、非系统用户、SSH 密钥、sudoers、crontab、systemd service、hosts、resolv.conf、iptables、nftables、firewalld、历史命令、登录日志。
重点文件：`/etc/passwd`、`/etc/shadow`、`/root/.ssh`、`/home/*/.ssh`、`/root/.bash_history`、`/var/log/secure`、`/var/log/auth.log`、`/var/log/wtmp`。

### 4. 服务端口识别
- 使用 `ss -lntup`、`netstat -lntup`、`lsof -i` 识别监听端口。
- 常见端口：22 SSH、80/443 HTTP、8888 宝塔、3306 MySQL、5432 PostgreSQL、6379 Redis、2375/2376 Docker、6443 Kubernetes、10250 kubelet。
- 对 Docker 使用 `docker ps -a`、`docker inspect`、`docker port`；对 Kubernetes 使用 `kubectl get svc -A`、`kubectl get pods -A`。
- 无法直接访问时，通过 SSH 端口转发或修改本地 hosts 映射到仿真环境。

### 5. 网络可达性重构
1. hosts 映射：将站点域名、数据库主机名、Redis 主机名写入 `/etc/hosts` 或本地 hosts，避免 DNS 依赖。
2. 端口转发：`ssh -L 8080:127.0.0.1:80`、`ssh -L 8888:127.0.0.1:8888`、`ssh -L 3306:127.0.0.1:3306`。
3. 防火墙：记录原始规则；仿真阶段可临时放行取证网段或关闭冲突策略，但必须记录变更并保留快照。
4. OpenWrt：检查 DHCP、DNS、port forward、firewall zones、`/etc/hosts`。
5. Nginx：检查 server_name、proxy_pass、upstream、root、rewrite，确认入口到后端应用的路径。

### 6. 业务恢复推荐顺序
按以下顺序恢复，避免依赖倒置：
1. PVE 或宿主机：确认 VM、LXC 配置、存储、桥接、快照。
2. OpenWrt 或网关：恢复 hosts、DNS、端口转发、防火墙，确保内外访问路径可用。
3. Docker 或 LXC：先恢复镜像和容器配置，再启动必要容器。
4. Kubernetes：恢复 YAML、Secret、ConfigMap、PV、PVC；必要时执行 `kubectl apply`。
5. 宝塔：恢复面板服务、站点配置、数据库配置、计划任务。
6. Nginx：恢复站点、证书、反向代理、伪静态。
7. MySQL 或 PostgreSQL：恢复数据库实例、账号、权限和备份。
8. Redis：恢复 RDB、AOF、密码和关键 key。
9. Node.js 或应用：恢复环境变量、依赖、进程管理。
10. 后台登录：完成账号、验证码、会话和权限验证。

### 7. 宝塔、Nginx 与后台登录重构
- 宝塔：定位面板目录、端口、用户名、密码、站点列表、数据库列表、计划任务；检查面板日志和站点配置。
- Nginx：从 vhost 找站点根目录、日志路径、反向代理目标；结合 access、error log 定位 URL 和状态码。
- 后台登录验证：优先使用配置、数据库、缓存中找到的账号；登录后记录 Cookie、Session、Token、数据库用户表和日志。
- 验证码绕过：
  1. 查源码是否有固定验证码、测试模式、万能码。
  2. 查缓存或 Redis 是否存储验证码明文。
  3. 查日志是否打印验证码。
  4. 查配置是否允许关闭验证码或跳过校验。
  5. 如需修改配置，先复制原文件并记录差异，避免污染原始证据。

### 8. 数据库连接恢复
- 先找连接配置：`.env`、`config.php`、`application.yml`、`docker inspect` Env、Kubernetes ConfigMap、Secret、宝塔数据库配置。
- MySQL：优先 `mysql -h127.0.0.1 -uroot -p`；检查用户表、权限表、binlog、慢日志、备份 SQL。
- PostgreSQL：定位 psql，检查 `pg_hba.conf`、WAL、备份；注意大小写敏感字段需双引号。
- Redis：使用 `redis-cli`，先 `keys '*keyword*'`，再 `type`，按 string、hash、list、set、zset 查询。
- SQLCipher 或加密数据库：按密码来源优先级恢复，解密后必须校验表结构和关键记录。
- 数据库无法启动时：解析 SQL 备份、binlog、WAL、RDB、AOF 或从应用日志提取数据。

### 9. 云原生与容器专项
- Docker：
  1. 使用 `docker ps -a`、`docker images`、`docker inspect`。
  2. 容器无法启动时，从 `/var/lib/docker/overlay2` 提取静态层文件。
  3. 使用 `docker save` 导出镜像，`docker load` 导入到可用环境。
  4. 对容器 ID、创建时间、镜像 ID、挂载路径进行静态复核，不以一次运行结果为准。
- Kubernetes：
  1. 查找 YAML、kubeconfig、etcd、manifests、Secret、ConfigMap。
  2. 缺失配置时补齐 YAML 后 `kubectl apply`；若 API 不可用，转向静态文件分析。
  3. NFS 挂载失败时，检查防火墙、挂载选项、服务端导出、网络可达性；必要时改用本地目录仿真。
- 动态与静态区分：容器运行状态、进程列表、实时日志属于动态证据；镜像层、overlay2、YAML、数据库文件属于静态证据。动态结论必须回到静态层复核。

### 10. 日志与时间线
- 系统日志：`/var/log/secure`、`auth.log`、`wtmp`、`syslog`、`messages`。
- 服务日志：Nginx access、error、MySQL error、binlog、PostgreSQL log、Redis log、Docker logs、kubelet、宝塔面板日志。
- 行为日志：cron.d、systemd timer、history、yum、apt、dnf、page_log。
- 建立时间线：登录、改密、安装、下载、启动、删除、备份、数据库变更、Web 请求、后台登录。

### 11. 加密与凭据恢复
密码来源优先级：密码管理器、AI 助手会话日志、应用配置、容器环境变量、Kubernetes Secret、历史命令、备份脚本、数据库配置、Redis 缓存。
- 对 GPG、SQLCipher、AES、Argon2id、vaultwarden 等，先识别文件头和哈希格式。
- 对弱口令或已知格式，使用脚本批量验证；对哈希爆破记录候选词、命令和命中结果。
- 解密后的文件必须计算哈希并保存路径，避免二次污染。

### 12. 移动端联动取证
按以下链路关联：
1. 面板配置：宝塔、Nginx、Docker、Kubernetes 中找域名、端口、站点和代理。
2. 数据库查询：用移动端账号、手机号、订单号、设备号反查服务器数据库。
3. Docker 容器：确认 APP 后端 API、消息服务、文件服务所在容器。
4. WAF 与日志：比对移动端请求时间、IP、UA 与 WAF、Nginx、应用日志。
5. Web 源码审计：定位接口、签名、加密、验证码、权限逻辑。
6. 业务关联：把终端截图、聊天记录、交易记录与服务器数据库、日志、缓存形成闭环。

### 13. SQL 统计与量化输出
- 先发现表结构，再写 SQL；不假设表名字段名。
- 题目问数量用 COUNT，问金额用 SUM，问份数查业务字段，不混用金额字段。
- 对时间字段先确认 UNIX 时间、DATETIME、时区；服务器常见 UTC，需按题目要求转换。
- 复杂统计可用 SQL、Python、polars、Excel；保留查询语句、输入文件和输出结果。

### 14. 证据闭环与命令链
每个结论至少记录：
- 原始文件路径或镜像偏移。
- 使用的命令、脚本、SQL 和解密步骤。
- 中间产物路径、哈希和截图。
- 动态验证结果与静态证据的对应关系。
- 若存在冲突，标记待人工裁决，不覆盖原始证据。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
