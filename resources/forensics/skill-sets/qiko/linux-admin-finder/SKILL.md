---
name: linux-admin-finder
version: "1.1.0"
description: |
  Linux网站后台管理页面探测分析。针对Linux服务器环境，自动分析查找网站后台管理页面地址。
  触发词：查找网站后台、admin后台探测、后台管理页面、分析nginx/apache站点、找admin登录页、linux-admin-finder。
  适用场景：用户需要在Linux服务器上定位网站真实可用的后台管理入口（运维、接管服务器、忘记后台地址等）。
author: WorkBuddy Custom
tags: ["linux", "web", "admin后台", "站点探测", "nginx", "apache", "运维分析"]
---

# Linux 网站后台管理页面探测分析

目标：找出 Linux 服务器上网站真实可用的后台管理页面地址。

## 输入变量

- `shell_context`（可选）：服务器 shell 执行返回的原始文本，可传入多段命令输出；为空时返回待执行 bash 命令清单
- `web_root_hint`（可选）：已知网站根目录，例 `/var/www/html`，缩小扫描范围
- `web_server_type`（可选，枚举）：`nginx` / `apache` / `auto`（默认 auto 自动识别）

## 执行流程规则

1. 如果 `shell_context` 为空：**不编造结果**，输出 `raw_suggest_commands`，交由 WorkBuddy 调用 shell 执行获取服务器输出。
2. 获取 `shell_context` 原始输出后执行解析逻辑：
   - 解析 Nginx/Apache 虚拟主机配置，提取域名、站点根目录、监听端口。
   - 扫描站点目录，匹配后台特征文件名；
   - 解析 access 日志，提取命中后台特征的 URI；
   - 使用增强后台字典生成候选路径；
   - **过滤规则强制执行**：文件名/路径包含 install、setup、uninstall、temp、tmp、demo、test、sample、example、backup、old，直接移入 `filter_hit_items`，禁止加入 `candidate_admin_pages`。
   - 区分：磁盘真实存在文件、日志命中、仅字典猜测三类来源。
3. 置信度打分规则：
   - 0.80-1.00：磁盘真实存在后台脚本文件，非过滤名单内
   - 0.50-0.79：访问日志中真实出现该 URI 访问记录，但磁盘未找到对应文件
   - 0.20-0.49：仅字典路径猜测，无文件、无日志佐证
4. 脚本后缀优先识别：php、jsp、jspx、asp、aspx；忽略 js/css/png/jpg/gif/svg/html 等静态文件。
5. 找不到候选后台：`candidate_admin_pages` 返回空数组，`warning` 写明原因；被过滤的脚本全部存入 `filter_hit_items` 留作参考。
6. **输出严格只返回 JSON**，禁止额外自然语言解释。

## 增强后台字典（内置，解析阶段使用）

admin, admin/, admin/index.php, admin/login.php, admin.php, admin_login.php, administrator, administrator/, administrator/index.php, backend, backend/, backend.php, manage, manage/, manage.php, manager, manager/, manager.php, system, system/, system.php, admincp, admincp/, admincp.php, admin_area, admin_area/, login, login.php, admin_home.php, main.php, console, console/, console.php, dashboard, dashboard/, dashboard.php, member, member/, member.php, user, user/, user.php, control, control/, control.php, cms, cms/, cms.php, admin_main.php, root, root/, root.php, superadmin, superadmin/, superadmin.php, webadmin, webadmin/, webadmin.php, admin_panel, admin_panel/, admin_panel.php, api/admin, api/admin/, backend_admin, backend_admin/, manage_admin, manage_admin/, admin_area.php, adm, adm/, adm.php, admin_console, admin_console/, sysadmin, sysadmin/, sysadmin.php

## raw_suggest_commands 执行命令集合

shell_context 为空时返回以下命令，由 WorkBuddy 批量执行，stdout + stderr 回传本 skill：

```bash
systemctl status nginx apache2 httpd 2>/dev/null
find /etc/nginx -name "*.conf" -type f 2>/dev/null | xargs cat
find /etc/apache2 /etc/httpd -name "*.conf" -type f 2>/dev/null | xargs cat
ls -ld /var/www/* /usr/share/nginx/html /home/*/public_html /html /web /www 2>/dev/null
find ${web_root_hint:-/var/www /usr/share/nginx/html /home/*/public_html /html /web /www} -type f \( -iname "*admin*.php" -o -iname "*manage*.php" -o -iname "*login*.php" -o -iname "*backend*.php" -o -iname "*system*.php" -o -iname "*adm*.php" -o -iname "*console*.php" -o -iname "*dashboard*.php" -o -iname "*manager*.php" -o -iname "*cms*.php" -o -iname "*sysadmin*.php" -o -iname "*webadmin*.php" -o -iname "*superadmin*.php" -o -iname "*control*.php" \) 2>/dev/null
find /var/log /var/log/nginx /var/log/apache2 /var/log/httpd -name "*access*.log" -o -name "*access*.log.*" 2>/dev/null
grep -E '(admin|login|manage|backend|system|adm|console|dashboard|manager|cms|sysadmin|webadmin)' /var/log/*access*.log* /var/log/nginx/*access*.log* /var/log/apache2/*access*.log* 2>/dev/null | awk '{print $7}' | sort | uniq
```

## 输出 JSON Schema

```json
{
  "server_info": {
    "web_server": "nginx|apache|httpd|unknown",
    "vhost_list": [
      { "domain": "", "root_path": "", "listen_port": "" }
    ]
  },
  "candidate_admin_pages": [
    {
      "url": "拼接生成完整候选url",
      "local_file_path": "服务器本地文件路径",
      "confidence": 0.0,
      "source": "配置解析|目录扫描|日志提取|字典匹配",
      "remark": ""
    }
  ],
  "raw_suggest_commands": ["shell_context为空时返回"],
  "warning": ["无候选时写明原因"],
  "filter_hit_items": [
    { "file_path": "", "filter_reason": "install/setup/demo/temp/test/sample等" }
  ]
}
```

`candidate_admin_pages` 按置信度降序排列，已过滤 install/setup/demo/temp/test/sample 等非生产脚本。

## 安全约束

- 仅在用户拥有或被明确授权管理的服务器上使用。
- 所有命令均为只读操作，不得修改、删除任何服务器文件。

## 适用场景

本技能用于 Linux 服务器取证中的网站后台管理入口定位，不是一次性黑盒扫描，而是在可控检材或授权环境中完成后台入口重建。典型场景包括：
1. 服务器镜像/磁盘/快照取证：对 qcow2、vmdk、raw、dd、VHD、LVM、LUKS（有密钥/密码）、ext4/xfs/btrfs 等检材做只读挂载或仿真后，查找 Web 后台。
2. 运维接管与业务恢复：管理员失联、离职、文档缺失，需要找到真实可用的 /admin、/manage、/login、面板入口或反向代理入口。
3. 案件还原：需要确认后台地址、登录入口、管理员账户、验证码机制、会话机制、后台访问日志，并与数据库、缓存、容器、移动端证据关联。
4. 复杂托管环境：宝塔、1Panel、Nginx、Apache、Tomcat、Node.js、PHP-FPM、Docker、LXC、PVE、OpenWrt、Kubernetes、Ingress、反向代理、多站点、多端口、多域名共存。
5. 移动端/终端联动：App、小程序、H5、PC 客户端请求的服务器后台需要定位管理页面、API 网关、鉴权入口，用于业务数据关联。
6. 容器与云原生取证：后台入口可能不在宿主机目录，而在容器镜像、overlay2、ConfigMap、Ingress、Service、NodePort、HostPath 挂载卷或镜像层中。

边界与限制：
- 不适用于未授权外部扫描、渗透攻击、绕过生产环境安全控制。
- 对生产环境应优先只读采集；任何启动、修复、登录验证都应在取证副本或隔离仿真环境中进行。
- 若发现疑似入侵、Webshell、恶意任务、异常账户，应先固定证据，再决定是否继续后台探测。

## 使用步骤

### 1. 检材固定与可信边界建立
1. 对服务器镜像、磁盘、快照、容器导出文件先计算哈希（MD5/SHA256），建立检材编号、来源、时间、保管链。
2. 优先使用只读方式接入：`losetup -r`、`mount -o ro`、`qemu-nbd -r`、写保护设备、只读快照、导出镜像副本。
3. 若必须仿真，先复制一份工作副本；禁止直接对原始检材执行启动、修复、安装、删除、重启数据库等操作。
4. 记录基础环境：镜像格式、磁盘分区、文件系统、操作系统、网卡、启动参数、内核文件、登录日志、服务配置，避免把仿真临时状态误认为原始配置。

### 2. 基础信息采集
在只读挂载或仿真副本中采集：
- 主机名、`/etc/hosts`、`/etc/resolv.conf`、`/etc/network`、`/etc/sysconfig/network-scripts`、`/etc/netplan`。
- 端口与进程：`ss -antp`、`netstat -antp`、`lsof -i`（仿真态）。
- 服务与自启动：`systemctl list-unit-files --state=enabled`、`/etc/systemd/system`、`/usr/lib/systemd/system`、`/etc/init.d`、`crontab`、`/etc/cron.d`。
- 账户与登录：`/etc/passwd`、`/etc/shadow`、`~/.ssh/authorized_keys`、`/var/log/secure`、`/var/log/auth.log`、`wtmp`、`last`。
- Web 相关目录：`/var/www`、`/www`、`/home/*/public_html`、`/usr/share/nginx/html`、`/www/wwwroot`（宝塔）、`/opt`、`/data`。
- 容器痕迹：`/var/lib/docker`、`overlay2`、`containers`、`image`、`volumes`、`/var/lib/lxc`、`/etc/pve`（PVE）。

### 3. 服务与站点恢复顺序
按“宿主 → 网络 → 存储 → 运行时 → 应用 → 数据库/缓存 → 后台验证”的顺序恢复，避免先启动应用导致依赖缺失或状态污染：
1. 宿主/虚拟化层：PVE 虚拟机、LXC 容器、OpenWrt 网络、Kubernetes 节点、Docker 守护进程。
2. 网络层：`/etc/hosts` 映射、DNS、端口转发、NAT、防火墙、安全组、容器网络、Ingress/Service。
3. 存储层：数据盘、NFS、LVM、LUKS、Docker volume、Bind mount、数据库数据目录。
4. 运行时：PHP-FPM、Node.js、Java/Tomcat、Python、Go 服务、Redis、MySQL/MariaDB/PostgreSQL。
5. Web 层：Nginx、Apache、OpenResty、宝塔面板、反向代理、WAF、负载均衡。
6. 应用层：网站目录、后台入口、API 网关、管理面板、容器内业务服务。
7. 验证层：后台登录、数据库连接、缓存读取、日志回看、业务数据抽样验证。

### 4. Web 配置审计
1. 识别 Web 服务类型：`nginx`、`apache2/httpd`、`openresty`、`caddy`、`tomcat`、`node`、宝塔面板、容器内服务。
2. 解析 Nginx/Apache 虚拟主机：
   - Nginx：`/etc/nginx/nginx.conf`、`/etc/nginx/conf.d/*.conf`、`/etc/nginx/sites-enabled/*`、`/www/server/panel/vhost/nginx/*.conf`。
   - Apache：`/etc/apache2/sites-enabled/*.conf`、`/etc/httpd/conf.d/*.conf`。
   - 重点提取：`server_name`、`listen`、`root`、`alias`、`location`、`proxy_pass`、`rewrite`、`access_log`、`error_log`、`DirectoryIndex`、`DocumentRoot`、`ProxyPass`。
3. 对反向代理入口建立映射：外部域名/端口 → `proxy_pass` → 容器、Node.js、Java、PHP-FPM、上游服务。
4. 对宝塔环境额外检查：`/www/server/panel`、`/www/wwwroot`、`/www/server/panel/vhost`、`/www/server/panel/data/default.db`、面板端口、面板用户配置。
5. 对 Docker/LXC/Kubernetes 环境检查：`docker ps -a`、`docker inspect`、`docker volume ls`、`/var/lib/docker/overlay2`、`/var/lib/lxc/*/config`、K8s YAML、Deployment、Service、Ingress、ConfigMap、Secret。

### 5. 后台入口候选发现
1. 使用本 Skill 的 `raw_suggest_commands` 获取配置、目录、日志输出。
2. 从三类证据生成候选：
   - 磁盘真实文件：`*admin*.php`、`*manage*.php`、`*login*.php`、`*backend*.php`、`*console*.php` 等。
   - 访问日志命中：access log 中出现 `admin`、`login`、`manage`、`backend`、`system`、`dashboard` 等 URI。
   - 字典推测：仅作为低置信度补充，不得单独作为结论。
3. 强制过滤 `install`、`setup`、`uninstall`、`temp`、`tmp`、`demo`、`test`、`sample`、`example`、`backup`、`old` 等非生产入口；过滤项保留到 `filter_hit_items`。
4. 对每个候选标注来源：配置解析、目录扫描、日志提取、字典匹配，并给出置信度。
5. 对多站点、多端口、多域名环境，必须输出完整 URL，包括协议、域名/IP、端口、路径。

### 6. 数据库与缓存连接恢复
1. 查找数据库连接配置：`.env`、`config.php`、`wp-config.php`、`database.php`、`application.yml`、`application.properties`、`settings.py`、`config.json`、宝塔站点配置。
2. 恢复 MySQL/MariaDB/PostgreSQL：
   - 确认 socket、port、datadir、`my.cnf`、`debian.cnf`、`root` 密码、业务账号。
   - 使用 `mysql -u user -p -h host` 或本地 socket 登录。
   - 查询管理员表、用户表、角色权限表、登录日志表、验证码/令牌表。
3. 恢复 Redis：
   - 检查 `redis.conf`、`requirepass`、`bind`、`port`、`dir`、`dbfilename`。
   - 使用 `redis-cli` 检查 session、token、captcha、cache、queue。
4. 对加密字段、哈希密码、API Key、手机号/身份证加密字段，结合源码解密算法、密钥文件、hashcat、CyberChef、数据库函数进行还原；所有还原命令必须可复现。
5. 若数据库无法直接启动，从备份文件、binlog、慢日志、错误日志、SQL dump、容器数据卷中恢复线索。

### 7. 后台登录重构与验证
1. 先做访问可达性验证：`curl -I`、`curl -k -L`、`wget --spider`，记录状态码、跳转、Set-Cookie、响应头。
2. 对域名依赖，在仿真环境写入 `/etc/hosts` 映射；不要污染原始检材。
3. 对端口受限场景，使用 SSH 端口转发、NAT 端口映射、容器端口发布或临时防火墙规则；所有变更必须记录。
4. 对验证码、二次认证、Token：
   - 优先从源码、数据库、Redis、日志中复现验证码逻辑。
   - 如需临时关闭或固定验证码，只能在仿真副本中进行，并记录审批、变更内容、影响范围。
5. 对后台登录验证：
   - 使用恢复出的管理员账号、密码哈希还原结果、默认口令、源码内置口令进行验证。
   - 记录登录成功后的后台标题、菜单、用户、日志、会话 Cookie、请求路径。
6. 对疑似后台但无法登录的候选，保留为候选并降低置信度，不得直接认定为真实管理入口。

### 8. 容器与云原生专项
1. 区分宿主机层、镜像层、容器层、数据卷层证据。
2. 对 Docker：
   - 检查 `overlay2`、容器配置、镜像层、`config.v2.json`、`hostconfig.json`、挂载卷。
   - 对已停止容器使用 `docker export/import` 或镜像导出导入恢复。
   - 对动态容器状态与静态容器层进行交叉复核，容器 ID、时间戳、哈希应回到静态层验证。
3. 对 Kubernetes：
   - 收集 YAML、Deployment、Pod、Service、Ingress、ConfigMap、Secret、PersistentVolumeClaim。
   - 对缺失对象使用 `kubectl apply` 在隔离集群复现；禁止直接操作生产集群。
   - 检查 NFS 挂载失败、镜像拉取失败、端口暴露、Service ClusterIP/NodePort。
4. 对 LXC/PVE：
   - 检查容器配置文件、根文件系统挂载点、网络桥接、存储池。
   - 优先导出/快照后再启动。

### 9. 证据闭环与输出
1. 对每个后台候选记录：完整 URL、本地文件路径、配置来源、日志来源、数据库依据、验证命令、响应状态、置信度。
2. 对关键结论建立静态证据与动态证据交叉验证：
   - 静态：配置文件、源码、日志、数据库文件、镜像层、备份文件。
   - 动态：仿真访问、API 返回、后台页面、数据库查询、缓存读取。
3. 输出 `candidate_admin_pages` 时按置信度降序排列；无候选时在 `warning` 写明原因。
4. 对需要人工确认的事项标记为待人工裁决，尤其是生产变更、密码重置、验证码绕过、防火墙开放、数据库写入。

## 常见失败与处置

### 1. 命令输出为空或不完整
- 现象：`shell_context` 为空，或只有部分命令结果。
- 处置：不要编造后台地址；返回 `raw_suggest_commands`，分批执行，优先执行服务状态、配置读取、目录扫描、日志提取命令。
- 取证注意：记录命令执行时间、执行账户、主机名、工作目录，避免多主机输出混淆。

### 2. 无法识别 Web 服务
- 现象：`systemctl status nginx apache2 httpd` 无结果，但业务疑似存在。
- 处置：检查 `ss -antp`、`ps -ef`、`docker ps -a`、`lxc-ls`、`crictl ps`、宝塔面板、OpenResty、Tomcat、Node.js、Java 进程。
- 误判规避：不要把临时启动的仿真服务误认为原始默认服务；以原始配置文件、自启动项、日志为准。

### 3. 配置文件存在但站点目录缺失
- 现象：Nginx/Apache 配置指向 `/www/wwwroot/site`，但目录不存在。
- 处置：检查是否位于数据盘、LVM、LUKS、Docker volume、Bind mount、LXC 根文件系统、备份目录；使用 `find / -xdev -type d -name '*wwwroot*'` 限定文件系统避免噪声。
- 取证注意：不要直接创建空目录冒充原始站点；应记录缺失并查找备份或容器层。

### 4. 后台候选被安装页、测试页污染
- 现象：大量 `install.php`、`setup`、`demo`、`test`、`sample`、`backup` 命中。
- 处置：强制移入 `filter_hit_items`，不得进入 `candidate_admin_pages`；再通过 access log 查找真实访问过的生产路径。
- 误判规避：安装页可能包含数据库配置，但不是管理后台结论。

### 5. 日志缺失、轮转或被清理
- 现象：access log 为空，或被 `logrotate` 压缩、删除。
- 处置：检查 `*.log.*`、`*.gz`、`journalctl`、容器 stdout/stderr、`/var/lib/docker/containers/*/*-json.log`、WAF 日志、数据库日志、应用日志。
- 证据闭环：日志缺失本身应写入 `warning`，不能因为无日志就否定后台存在。

### 6. 端口访问失败
- 现象：候选 URL 返回连接超时、拒绝连接、404、502。
- 处置：
  - 检查监听地址是否为 `127.0.0.1`、`::1`、内网 IP。
  - 检查防火墙、iptables、nftables、firewalld、安全组、容器端口发布、K8s Service/Ingress。
  - 使用 `/etc/hosts` 映射域名，使用 SSH `-L` 或仿真网络端口转发。
- 取证注意：开放端口或关闭防火墙只能在仿真副本中执行，并记录变更前后的规则。

### 7. 宝塔面板无法登录或入口不明
- 现象：宝塔服务存在，但面板端口、用户名、密码未知。
- 处置：检查 `/www/server/panel`、面板端口配置、`/www/server/panel/data`、面板数据库、面板日志、站点配置；必要时在副本中重置面板密码并记录原值哈希。
- 误判规避：宝塔面板入口不等同于业务后台；应同时输出面板入口和业务后台候选。

### 8. MySQL/Redis 连接失败
- 现象：配置中找到数据库账号，但连接失败。
- 处置：
  - MySQL：确认 socket、port、`bind-address`、`skip-grant-tables` 风险、数据目录权限、`debian.cnf`、容器网络、密码来源。
  - Redis：确认 `requirepass`、`bind`、`protected-mode`、AOF/RDB 路径、容器网络。
- 取证注意：不要直接在生产检材上执行 `DROP`、`DELETE`、`UPDATE`；如需修复，仅可在副本中进行，并导出原始值。

### 9. Docker/Kubernetes 环境无法启动
- 现象：容器退出、镜像缺失、NFS 挂载失败、YAML 缺失、`kubectl apply` 失败。
- 处置：
  - Docker：检查 `overlay2`、镜像层、`docker export/import`、volume、网络、启动命令。
  - Kubernetes：补齐 Deployment、Service、Ingress、ConfigMap、Secret、PVC；在隔离集群 `kubectl apply`。
  - NFS：检查挂载点、防火墙、导出规则、版本兼容；必要时使用本地目录替代并记录差异。
- 误判规避：动态容器状态可能变化，容器 ID、启动时间、临时文件必须回到镜像层、日志层、静态配置复核。

### 10. 验证码、二次认证或 Token 阻断登录
- 现象：找到后台地址，但无法完成登录验证。
- 处置：优先从源码、数据库、Redis、日志中恢复验证码生成逻辑、固定测试值、会话 Token；如需临时关闭验证码，必须满足授权、审批、仿真副本、可回滚四个条件。
- 红线：不得在原始检材或生产环境绕过安全机制。

### 11. 反向代理导致路径误判
- 现象：Nginx 路径存在，但实际请求转发到容器、Node.js、Java 服务。
- 处置：解析 `proxy_pass`、`upstream`、`rewrite`、`X-Forwarded`、Ingress annotations，建立外部路径到内部服务映射。
- 误判规避：不能只根据磁盘文件判断后台可用；必须结合监听端口、代理关系、上游服务状态。

### 12. 动态验证结果与静态证据不一致
- 现象：仿真页面显示一个配置，但原始文件、数据库、镜像层显示另一个值。
- 处置：以静态原始证据为优先；记录动态结果来源、运行时间、容器 ID、命令输出。
- 证据闭环：对容器、数据库、缓存等易变对象，必须同时保存静态路径、哈希、查询语句、运行时截图或响应包。

### 13. 证据污染或结论不可复现
- 现象：后台地址找到了，但无法说明来自哪个文件、哪条日志、哪条 SQL。
- 处置：为每个结论建立命令链：文件路径、配置段、日志行、数据库查询、API 请求、响应状态、时间戳。
- 输出要求：所有无法闭环的候选只能标记低置信度或写入 `warning`，不得作为最终结论。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
