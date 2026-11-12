---
name: server-forensics-analysis
description: >
  实战化多服务器数字取证分析技能。通过SSH MCP连接多台嫌疑服务器，执行系统化的取证命令，
  提取犯罪证据（被盗Token、凭证文件、支付配置、容器镜像、数据库记录等），分析服务器间关系，
  生成HTML格式的完整取证分析报告。覆盖：Docker容器取证、应用源码分析、数据库取证、
  网络配置分析、历史命令取证、凭证文件提取、支付链路追踪、域名/SSL证书分析。
  Use when 用户需要对多台服务器进行取证分析、犯罪调查、数字取证、证据提取、
  服务器关系分析、生成取证报告，或提及"取证"、"犯罪证据"、"服务器分析"、
  "嫌疑虚拟机"、"数字取证"、"forensics"、"证据收集"。
version: 1.0.0
author: WorkBuddy
agent_created: true
---

# 实战化服务器取证分析 (Server Forensics Analysis)

通过 SSH MCP 对多台嫌疑服务器执行系统化数字取证，提取犯罪证据，分析机器间关系，生成完整取证报告。

## 一、触发条件

- 多台嫌疑服务器需要SSH远程取证分析
- 犯罪调查场景下的数字证据提取
- 需要分析多台服务器之间的关系和角色分工
- 需要生成面向执法/审计的取证分析报告
- Docker容器化环境下的应用取证
- API倒卖/Token盗用/支付欺诈等网络犯罪调查

## 二、前提条件

- 目标服务器的SSH连接信息（IP、端口、账号、密码）
- SSH MCP工具已可用（通过 ToolSearch 加载）
- 多台服务器的IP对应关系（外网IP ↔ 内网IP）

## 三、标准工作流程

### 阶段1：工具加载与连接（并行）

```
1. ToolSearch 加载所有 mcp__ssh-mcp__* 工具
2. 并行连接所有目标服务器（使用 DeferExecuteTool 调用 mcp__ssh-mcp__connect）
3. 记录每台服务器的 connectionId
```

**连接参数模板：**
```
host: <内网IP>
port: <SSH端口>
username: root
password: <密码>
name: vm<编号>-<外网IP>
tags: ["forensics", "vm<编号>"]
```

**关键：** 所有连接在同一轮并行发起，不串行等待。

### 阶段2：第一轮取证 — 基础信息采集（并行）

对每台服务器同时执行以下综合取证命令。命令设计为单条长命令，减少SSH往返：

```bash
echo '===OS INFO==='; cat /etc/os-release 2>/dev/null
echo '===KERNEL==='; uname -a
echo '===UPTIME==='; uptime
echo '===HOSTNAME==='; hostname
echo '===IP ADDR==='; ip addr 2>/dev/null || ifconfig 2>/dev/null
echo '===NETSTAT==='; netstat -tlnp 2>/dev/null || ss -tlnp 2>/dev/null
echo '===ESTABLISHED==='; netstat -tnp 2>/dev/null || ss -tnp 2>/dev/null
echo '===PROCESSES==='; ps aux
echo '===USERS==='; cat /etc/passwd | grep -v nologin | grep -v false
echo '===WHO==='; who; w
echo '===LAST LOGIN==='; last -20 2>/dev/null
echo '===CRONTAB==='; crontab -l 2>/dev/null
echo '===CRON.D==='; ls -la /etc/cron.d/ 2>/dev/null; cat /etc/cron.d/* 2>/dev/null
echo '===HISTORY==='; cat ~/.bash_history 2>/dev/null | tail -100
echo '===AUTH LOG==='; tail -50 /var/log/auth.log 2>/dev/null
echo '===SYSLOG==='; tail -30 /var/log/syslog 2>/dev/null
```

**注意事项：**
- 输出可能被截断（超长时MCP会省略中间内容），这是正常的
- 如果某台服务器超时，降低timeout重试，或拆分为更短的命令
- 第一轮重在快速获取全貌，不追求完整

### 阶段3：第二轮取证 — 深入证据提取（并行）

根据第一轮发现的线索，针对性深入提取。以下为常见取证方向：

#### 3.1 Docker容器取证

```bash
echo '===DOCKER PS==='; docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null
echo '===DOCKER IMAGES==='; docker images --format '{{.Repository}}:{{.Tag}}|{{.Size}}' 2>/dev/null
echo '===DOCKER NETWORK==='; docker network ls 2>/dev/null
echo '===COMPOSE FILES==='; find / -name 'docker-compose*' -o -name 'compose.y*ml' 2>/dev/null | head -20
echo '===COMPOSE CONTENT==='; cat /opt/<service>/docker-compose.yml 2>/dev/null
```

**Docker镜像Tag是关键线索：** Tag中的关键词（如 `chinese-sms-log`、`hide-purchase-strip`、`strengthened`）直接暴露功能迭代历史和犯罪意图。

#### 3.2 应用配置与凭证文件

```bash
# .env 文件（含数据库密码、API密钥等）
find /opt -name '.env' -exec cat {} \; 2>/dev/null
# config.json / config.yaml
find /opt -name 'config.json' -exec cat {} \; 2>/dev/null
find /opt -name 'config.yaml' -exec cat {} \; 2>/dev/null
# Nginx配置（域名、反代、前端注入）
cat /etc/nginx/sites-enabled/* 2>/dev/null
cat /etc/nginx/conf.d/*.conf 2>/dev/null
# Caddy配置
cat /opt/*/caddy/Caddyfile 2>/dev/null
# SSH密钥
cat /root/.ssh/authorized_keys 2>/dev/null
```

#### 3.3 数据库取证

```bash
# PostgreSQL（Docker内）
docker exec <postgres-container> psql -U <user> -d <db> -c 'SELECT id, username, email, role, status, quota FROM users LIMIT 30;' 2>/dev/null
docker exec <postgres-container> psql -U <user> -d <db> -c 'SELECT id, name, type, status, balance FROM channels LIMIT 20;' 2>/dev/null
docker exec <postgres-container> psql -U <user> -d <db> -c 'SELECT id, user_id, model_name, quota, created_at FROM logs ORDER BY created_at DESC LIMIT 15;' 2>/dev/null
# 列出所有表
docker exec <postgres-container> psql -U <user> -d <db> -c '\dt' 2>/dev/null
```

**注意：** 容器可能处于重启循环（Restarting），导致数据库查询失败。此时从文件系统直接取证（如`/opt/<service>/data/`目录下的JSON/SQLite文件）。

#### 3.4 Token/凭证数据文件

```bash
# 数据目录列表
ls -la /opt/<service>/data/ 2>/dev/null
# JSON数据文件内容
cat /opt/<service>/data/tokens/*.json 2>/dev/null | head -30
cat /opt/<service>/data/codes.json 2>/dev/null | head -80
cat /opt/<service>/data/clients.json 2>/dev/null | head -80
# SQLite数据库
ls -la /opt/<service>/data/*.db 2>/dev/null
```

#### 3.5 历史命令深度分析

```bash
cat ~/.bash_history 2>/dev/null
# 如果文件很大（>50KB），用 wc -l 先看行数，再分段读取
wc -l ~/.bash_history 2>/dev/null
head -100 ~/.bash_history 2>/dev/null
tail -100 ~/.bash_history 2>/dev/null
```

#### 3.6 网络与DNS配置

```bash
cat /etc/netplan/*.yaml 2>/dev/null
cat /etc/resolv.conf 2>/dev/null
resolvectl status 2>/dev/null
# DNS变更记录（操作者通常会留下diff文件）
find /root -name '*.diff' -exec cat {} \; 2>/dev/null
find /root -name '*dns*' -exec cat {} \; 2>/dev/null
```

#### 3.7 支付配置取证

```bash
# 搜索支付相关配置
find /opt -name 'secret.env' -exec cat {} \; 2>/dev/null
grep -r 'xorpay\|epay\|alipay\|wechat\|payment' /opt/*/docker-compose.yml 2>/dev/null
grep -r 'xorpay\|epay\|alipay\|wechat\|payment' /opt/*/.env 2>/dev/null
# 支付适配器源码
find /opt -name '*xorpay*' -o -name '*payment*' -o -name '*pay*' 2>/dev/null | head -20
```

#### 3.8 安全绕过/篡改取证

```bash
# 操作者常在 /root 下留下变更管理目录
ls -la /root/*/ 2>/dev/null | grep -E 'disable|turnstile|bypass|patch|brand|migration'
# 查看变更记录
find /root -name 'changes.patch' -exec ls -la {} \; 2>/dev/null
find /root -name 'rollback*.sh' -exec cat {} \; 2>/dev/null
find /root -name 'verification*.txt' -exec cat {} \; 2>/dev/null
```

### 阶段4：关系分析

横向对比所有服务器的取证数据，识别以下关系：

1. **统一密码/密钥：** 搜索相同的密码、Session Secret、API Key出现在多台机器上
2. **数据流转链：** Token从A机器导出 → 上传到B机器 → 通过C机器对外服务
3. **支付链路：** D机器的支付前端 → C机器的API后端 → 第三方支付平台
4. **DNS/网络关联：** 多台机器指向同一个内部DNS或代理服务器
5. **代码同源：** 相同的Docker镜像、相同的compose配置结构
6. **SSH互连：** 历史命令中的SSH连接记录揭示未列入的关联服务器
7. **代理链路：** 多台机器使用相同的socks5代理

### 阶段5：报告生成

生成HTML格式的取证分析报告，结构如下：

```
1. 案件概述（外网IP对应关系表）
2. 五台虚拟机关系架构（ASCII架构图 + 关系证据表）
3-N. 逐台详细分析
  - 主机信息表
  - 运行容器表
  - 核心犯罪证据（critical块）
  - 证据文件（evidence块，含文件路径和关键内容摘要）
  - 历史命令分析
N+1. 犯罪活动总结（犯罪模式 + 涉嫌犯罪行为表）
N+2. 关键证据文件清单（编号表）
N+3. 关联IP和外部服务清单
N+4. 取证结论 + 进一步侦查建议
```

**报告HTML设计要点：**
- 深色主题（`--bg:#1a1a2e`），适合长时间阅读
- `critical` 块用红色边框高亮核心犯罪证据
- `evidence` 块用半透明红色背景标注证据文件
- ASCII架构图展示服务器间关系
- 所有外网IP用高亮色标注
- 每台机器一个 `vm-card` 卡片
- 表格交替行背景色
- 报告必须包含外网IP（用户明确要求）

## 四、取证命令设计原则

1. **单条长命令：** 用 `echo '==='` 分隔各段，一条命令采集多类信息，减少SSH往返
2. **并行执行：** 多台服务器的相同轮次命令在同一轮并行发起
3. **超时控制：** 默认 timeout=30000ms，超时后降到15000ms重试，再不行拆分命令
4. **错误容忍：** 所有命令加 `2>/dev/null` 抑制错误输出，`2>&1` 捕获stderr
5. **格式化输出：** Docker命令用 `--format` 参数输出结构化文本
6. **路径优先：** 已知路径直接读取，不盲目 `find /` 全盘搜索（太慢）

## 五、常见取证场景与关键证据类型

### 5.1 AI API倒卖

| 证据类型 | 典型路径/关键词 | 取证命令 |
|---------|----------------|---------|
| 被盗Token | `/opt/*/data/tokens/*.json` | `cat` 读取JSON |
| 接码平台配置 | `config.json` 中的 `smsbower` | `grep -i smsbower` |
| OAuth配置 | `config.json` 中的 `oauth` 字段 | `grep -i oauth` |
| 兑换码系统 | `codes.json`, `clients.json` | 直接 `cat` |
| API Key | `client_api_keys.json`, `config.yaml` | 直接 `cat` |
| 凭证池 | `credentials.json` | 直接 `cat` |

### 5.2 支付欺诈

| 证据类型 | 典型路径 | 取证要点 |
|---------|---------|---------|
| 支付密钥 | `secret.env`, `*.env` | App ID + App Secret |
| 支付适配器 | `*xorpay*.py` | 读取源码，关注二维码生成逻辑 |
| 支付回调 | docker-compose中的notify URL | 确认回调链路 |
| 充值记录 | 数据库 logs 表 | SQL查询 |

### 5.3 安全绕过/篡改

| 证据类型 | 典型路径 | 取证要点 |
|---------|---------|---------|
| 验证码绕过 | `/root/*turnstile*` | 查看SQL补丁和截图 |
| 前端注入 | Nginx `sub_filter` 配置 | 确认注入的CSS/JS |
| 前端篡改 | `/root/*brand*` 目录 | 查看changes.patch |
| DNS篡改 | `*.diff`, `*dns*` 文件 | 对比变更前后配置 |

### 5.4 Docker容器取证

| 证据类型 | 取证命令 | 分析要点 |
|---------|---------|---------|
| 容器列表 | `docker ps -a --format` | 容器名、镜像、状态、端口映射 |
| 镜像历史 | `docker images --format` | Tag关键词暴露功能迭代 |
| 网络拓扑 | `docker network ls` | 容器间网络隔离关系 |
| Compose配置 | `cat docker-compose.yml` | 环境变量含密码/密钥 |
| 容器数据 | `ls -la /opt/*/data/` | 持久化数据卷 |

## 六、超时处理策略

MCP SSH命令默认30秒超时。遇到超时时的降级策略：

```
30s 超时 → 15s 重试 → 拆分为多条短命令 → 跳过该命令
```

常见超时原因：
- 服务器负载过高（`uptime` 检查load average）
- Docker容器在重启循环（`docker ps` 状态为 Restarting）
- `find /` 全盘搜索（改为搜索特定目录）
- `ps aux` 在容器异常时输出极慢

## 七、报告输出路径

报告默认生成到工作目录下：
```
<workspace>/取证分析报告.html
```

HTML文件会通过 `present_files` 工具自动在浏览器中预览。

## 八、证据保全要求

- 所有证据必须标注来源服务器（外网IP）和文件路径
- 数据库查询记录完整SQL语句
- 加密文件标注加密算法（如Fernet、bcrypt、AES）
- 关联IP和外部服务单独列表
- SHA256校验文件说明数据完整性验证
- 报告中不得省略外网IP（用户明确要求写入报告）

## 九、典型时间线

从5台服务器的取证分析实战经验来看：

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 工具加载+连接 | 1分钟 | 5台并行连接 |
| 第一轮基础取证 | 2-3分钟 | 5台并行，每台一条综合命令 |
| 第二轮深入取证 | 5-10分钟 | 多轮针对性命令，部分可能超时重试 |
| 关系分析 | 1-2分钟 | 横向对比数据 |
| 报告生成 | 2-3分钟 | HTML撰写 |
| **总计** | **约15-20分钟** | 5台服务器完整取证 |

## 十、注意事项

1. **容器重启循环：** 数据库容器可能持续重启（PostgreSQL/Redis），导致 `docker exec` 查询失败。此时从宿主机文件系统直接读取数据文件。

2. **历史命令大小：** `.bash_history` 可能极大（实战中遇到107KB），需用 `wc -l` 先评估，再分段读取。

3. **Docker镜像Tag分析：** 镜像Tag中的关键词是最有价值的犯罪意图证据（如 `hide-purchase-strip` = 隐藏购买栏 = 伪装意图）。

4. **密码统一性：** 如果多台服务器使用相同的数据库密码或管理员密码，这是"同一人/同一团队管理"的关键证据。

5. **变更管理目录：** 有经验的操作者会在 `/root` 下留下 `*-20260819T0741CST/` 格式的变更目录，含补丁、截图、SHA256校验和回滚脚本。这些目录是高价值证据。

6. **代理配置：** socks5代理配置中的用户名和IP是追查关联服务器的重要线索。

7. **SSH测速痕迹：** 历史命令中 `ssh ... root@IP 'dd if=/dev/zero'` 格式的命令揭示未列入的关联服务器。
---

## 适用场景

用于服务器侧可复现取证，支持 SSH 活体远程取证与离线镜像、快照、容器层、云原生静态恢复/交叉验证。优先判断检材边界：原始磁盘层、虚拟机层、容器层、应用层、数据库层证据不同；仿真临时状态不得等同原始事实。

### 典型适用对象
- Linux 物理机/虚拟机/云服务器/PVE 宿主/LXC/Docker/Kubernetes 节点；网站服务器/反向代理/API 网关/支付回调/接码平台/Token 池/管理后台/宝塔面板。
- MySQL、PostgreSQL、Redis、SQLite、MongoDB 等数据库与缓存。
- Nginx、Caddy、Apache、OpenWrt、防火墙、端口转发、hosts 映射、SSL 证书、WAF/验证码组件。
- 与移动端、PC 端、聊天记录、终端镜像联动的后端业务系统。

### 典型案件类型
- API Key/Token/OAuth 凭证/Session Secret 被盗用或倒卖。
- 支付欺诈/第四方支付/跑分平台/充值订单/回调链路/商户密钥取证。
- 网站后台/管理面板/代理后台/会员数据/订单数据/卡密/兑换码/投注或涉诈业务数据。
- Docker 镜像/compose 配置/Kubernetes YAML/容器日志/overlay2 删除或篡改痕迹。
- 验证码绕过/前端注入/WAF 绕过/DNS 篡改/hosts 劫持/Nginx sub_filter 篡改。
- App/H5/小程序后端与终端证据关联：设备 ID、手机号、订单号、登录态、IP、UA、时间戳。

### 推荐触发信号
- 多台服务器 SSH：分析角色分工、数据流转、犯罪证据。
- 提供 qcow2/raw/vmdk/tar/备份目录/Docker 数据目录/K8s 配置：恢复后台或数据库。
- 已有域名/IP/后台地址/数据库账号/面板入口：验证后台登录、数据库连接、业务数据。
- 需从日志/数据库/缓存/源码/容器配置形成可复现证据链与量化统计。

### 慎用或不适用场景
- 仅需单文件哈希或文档查看。
- 未只读保护/未哈希/未快照且无合法授权：不做高风险写操作。
- 内存/固件/移动终端取证为独立专项；本技能仅后端关联，不替代终端取证。
- 生产活体取证需评估业务影响；优先只读、低负载、审批流程。

### 证据边界要求
- 动态运行态证据须回静态层复核：容器 ID、镜像 Tag、数据库记录、日志时间戳、配置文件哈希。
- 仿真恢复仅呈现业务状态，不改原始检材；修复记录命令、路径、时间、原因。
- 加密/哈希/编码/密钥/口令/验证码绕过补丁保留原始值与还原算法，不只记最终明文。

## 使用步骤

> 与原文档“标准工作流程”细节冲突时不自动覆盖，标记人工裁决；证据固定、只读优先、可复现优先。

### 0. 标准主线
按：镜像仿真/检材接入→基础信息采集→服务端口识别→Web 配置审计→数据库连接恢复→后台登录重构→SQL 统计→动态静态交叉验证→报告闭环。容器、K8s、宝塔、移动端联动叠加专项步骤。

### 1. 检材分级与保全
1. 区分类型：SSH 活体、磁盘镜像、虚拟机快照、PVE/LXC 备份、Docker 数据目录、Kubernetes YAML、数据库备份、网站源码包。
2. 离线镜像先哈希，再只读挂载/仿真；活体先采集易失数据，再执行低影响命令。
3. 建立案件目录：原始输出、提取文件、恢复配置、SQL 查询、截图、报告草稿、命令索引。
4. 记录外网/内网 IP、SSH 端口、主机名、OS、内核、磁盘分区、文件系统、网卡、启动参数。

### 2. 基础信息采集
1. 系统：发行版、内核、主机名、运行时长、时区、时间同步状态。
2. 账户与登录：/etc/passwd、/etc/shadow 可读性、sudoers、authorized_keys、last、wtmp、auth.log、secure。
3. 网络：ip addr、路由、DNS、hosts、netplan、resolv.conf、端口监听、ESTABLISHED 连接、iptables/nftables/firewalld。
4. 服务与计划任务：systemd unit、cron.d、crontab、at、systemd timer、yum/apt 安装日志。
5. 应用目录：/opt、/srv、/www、/home、/root、/var/www、/data、/backup；重点 .env、config、compose、nginx、panel、docker、k8s。

### 3. 服务器与虚拟化环境恢复顺序
按依赖恢复，避免数据库/缓存/网络未就绪：
1. 宿主网络与基础服务：hosts、DNS、路由、SSH、防火墙基线；内网访问用 SSH 端口转发或临时 hosts。
2. PVE/LXC：/etc/pve、storage.cfg、network interfaces、VM/LXC 配置；无法启动导出 rootfs、磁盘文件、配置作静态证据。
3. OpenWrt/网关：/etc/config/network、firewall、dhcp、hosts、portforward；确认 WAN/LAN、DNAT、端口映射、旁路由、DNS 劫持。
4. Docker：daemon 配置、镜像仓库缓存、volumes、compose、.env；按数据库、缓存、消息队列、应用、网关启动。
5. Kubernetes：kubeconfig、YAML、ConfigMap、Secret、PV/PVC、etcd 备份；kubectl apply 前 dry-run，记录命名空间。
6. 宝塔/面板：端口、入口、管理员、站点、数据库、计划任务；不可登录时读面板数据目录、站点配置、Nginx vhost。
7. Web：Nginx、Caddy、Apache、Node.js、PHP-FPM、Tomcat；核对 server_name、proxy_pass、upstream、SSL 证书、root/alias、sub_filter。
8. 数据库与缓存：MySQL、PostgreSQL、Redis、MongoDB、SQLite；先确认连接串、端口、socket、密码、数据目录，再启动。
9. 业务后台：管理后台、API、支付回调、验证码、WAF、机器人任务；验证登录、接口、订单、用户、日志可复现。

### 4. 网络可达性与访问路径重构
1. 用 hosts 将涉案域名指向仿真/内网 IP，避免污染线上环境。
2. 用 SSH 本地转发/代理访问内网面板、数据库、Redis、K8s API；记录转发端口与原始目标。
3. 防火墙/security group 仅放行取证必要端口，阻断外联回传，防远程擦除。
4. 逐层验证端口转发、反代、CDN、WAF、OpenWrt DNAT，确认最终服务端口与真实后端。
5. HTTPS 提取证书、私钥、SNI、域名、过期时间；必要时本地 hosts+自签证书复现后台。

### 5. 服务端口识别与 Web 配置审计
1. 用 ss、netstat、lsof、docker port、kubectl get svc、iptables -t nat 识别监听/转发。
2. 标记端口服务：SSH、面板、API、数据库、Redis、K8s、Node.js、Nginx、支付回调、接码服务。
3. 审计 Nginx/Caddy/Apache：站点域名、路径、反代、鉴权、IP 白名单、sub_filter、rewrite、日志路径。
4. 审计 Docker compose/K8s YAML：环境变量、Secret、ConfigMap、端口、卷挂载、健康检查、镜像 Tag。
5. 审计 WAF、验证码、登录限制、JWT、Session、OAuth、API Key、回调地址、白名单 IP。

### 6. 数据库连接恢复与后台登录重构
1. 从 .env、config.yaml、config.json、docker-compose.yml、K8s Secret、宝塔面板、源码常量提取连接信息。
2. 验证：类型、主机、端口、socket、用户名、密码、库名、字符集、SSL 参数。
3. MySQL：my.cnf、datadir、binlog、slow log、error log；无法启动复制 datadir、ibdata、frm、ibd、SQL dump。
4. PostgreSQL：pg_hba.conf、postgresql.conf、WAL、dump；Redis：redis.conf、RDB、AOF、requirepass。
5. 后台登录：管理员表、用户表、角色表、密码哈希、登录日志、验证码配置、JWT secret、Session secret。
6. 验证码绕过/turnstile/图形/短信：提取补丁、配置开关、测试账号、日志截图；不得伪造业务数据。
7. 验证后记录登录路径、账号、Hash、Token、Cookie、User-Agent、IP、时间戳，并与静态配置交叉验证。

### 7. 移动端与服务器联动取证
1. 面板配置：站点、域名、API、App 下载页、H5 入口、小程序、公众号/支付配置。
2. 数据库查询：用户、设备、订单、充值、提现、卡密、邀请关系、登录日志、API 调用日志。
3. Docker/K8s：确认 App 后端、推送、签名、网关、风控、WAF 容器与镜像。
4. WAF/访问控制：IP 白名单、设备指纹、签名算法、请求频率、风控规则、封禁记录。
5. 源码/接口：登录、注册、支付、回调、上传、下载、代理、统计。
6. 关联终端证据：设备 ID、手机号、IMEI/OAID、订单号、支付流水、IP、UA、时间戳、地理位置。

### 8. 云原生与容器专项步骤
1. 区分宿主机层、镜像层、容器层；固定宿主配置、镜像 manifest、overlay2 lowerdir/upperdir、容器日志、运行时状态。
2. Docker：docker ps、images、inspect、logs、volume ls、network ls；复核 /var/lib/docker/overlay2。
3. Kubernetes：kubectl get pods、svc、deploy、configmap、secret、events；导出 YAML 并记录 resourceVersion。
4. 镜像：docker save/load 或镜像仓库导出导入；损坏时从备份、registry、节点缓存恢复。
5. NFS/Ceph/本地卷挂载失败：先查防火墙、mount 参数、权限、SELinux/AppArmor，再决定是否临时放行。
6. 静态复核容器 ID、镜像 ID、Pod UID、时间戳、日志轮转文件；不以重启后新状态为唯一依据。

### 9. 日志、时间线与行为还原
1. /var/log/secure、auth.log、wtmp、btmp、lastlog：登录、失败尝试、改密、提权。
2. syslog、messages、journalctl、dmesg：服务异常、挂载、网络变化、内核告警。
3. yum.log、apt history、dnf history：安装工具、可疑软件包。
4. cron.d、systemd timer、at、shell history：定时任务、清理脚本、代理、隧道、下载。
5. 统一时间线：系统日志、应用日志、MySQL binlog、Redis AOF、Nginx access/error、容器日志。

### 10. 加密、凭据与隐藏数据恢复
1. Hash 爆破：hashcat、john、字典规则；记录掩码、字典、规则、命中率。
2. 编码/加密：CyberChef、openssl、源码解密函数、密钥文件、环境变量。
3. 数据库字段加密：先找密钥、IV、算法、盐值；抽样解密并保留原密文。
4. 凭据清单：API Key、Token、助记词、支付密钥、SSH 私钥、面板密码，标注来源路径。
5. 删除/隐藏文件：结合文件系统时间戳、备份、overlay2、日志、数据库事务恢复。

### 11. 动态运行态与静态证据交叉验证
1. 后台、API、容器运行时仅作验证入口；最终证据落回文件、数据库、日志、镜像层。
2. Token 消耗、余额、订单量、用户数、API Key 创建时间：同时记录 SQL 与 API 返回。
3. 运行时变化记录采集前后差异，说明容器重启、服务重载、缓存刷新影响。
4. 关键结论至少两类证据印证：配置文件+数据库、日志+源码、镜像层+容器日志、后台截图+SQL 统计。

### 12. 量化统计与证据索引
1. 用 SQL、脚本、polars、Excel 做计数、去重、分组、时间聚合、金额统计。
2. 建立口径：状态、时间范围、用户角色、订单类型、支付通道、设备来源。
3. 每个结论建立证据索引：服务器、路径、命令、SQL、日志行、文件哈希、截图、报告段落。
4. 输出可复现命令链，避免仅依赖一次仿真或临时数据库会话。

### 13. 常见陷阱与规避
- 容器 Restarting：勿反复 docker exec；读卷目录、overlay2、日志、备份。
- MySQL 单库 SQL：可能丢全局账号、权限、binlog；记录 datadir 与配置。
- Redis 未持久化：运行时 keys 非唯一证据；保存 RDB/AOF、配置、快照。
- K8s 资源缺失：勿直接 apply 改变现场；先在隔离集群/命名空间复现。
- NFS 挂载失败：先记录规则、端口、mount 参数、失败日志，再考虑关防火墙。
- 宝塔端口变更：入口可能非 8888；检查 panel 配置、nginx 反代、防火墙。
- hosts 误判：本地 hosts 仅仿真访问；不得写回原始检材或误认线上真实解析。
- 验证码绕过补丁：保留原始文件、补丁、差异、验证过程，防认定篡改。
- 镜像 Tag：可能暴露迭代意图，需结合源码、配置、数据库、日志闭环。

---

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
