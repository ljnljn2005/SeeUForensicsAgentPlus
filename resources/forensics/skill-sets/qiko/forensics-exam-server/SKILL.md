---
name: 服务器取证答题
description: 服务器取证/靶场答题：Linux/Windows、Docker/K8s 离线证据，只读优先、答案须有溯源。整盘先过整检材技能；单包走网络技能；单库走 SQLite 技能。
version: 1.4.1
author: admin
license: MIT
metadata:
  hermes:
    tags:
      - server-forensics
      - exam
      - ctf
      - linux
      - windows-server
      - web
      - database
      - docker
      - kubernetes
      - middleware
      - logs
      - reverse-engineering
    related_skills:
      - myos-forensics-workflow
      - performing-sqlite-database-forensics
      - forensic-network-pcap-exam
name_en: Server Forensics Exam
name_ru: Экспертиза серверов (экзамен)
description_en: >-
  Server forensics/CTF exam playbook for Linux/Windows and offline Docker/K8s evidence. Read-only
  first; answers need provenance. Whole disk → investigate skill; single pcap/DB → specialized
  skills.
description_ru: >-
  Плейбук серверной форензики/CTF: Linux/Windows, офлайн Docker/K8s. Сначала только чтение; ответы с
  доказательствами. Целый диск — к навыку triage; один pcap/БД — к узким навыкам.
---

# Server Forensics Exam Playbook

## Default rhythm

```text
hub mount/triage if needed → identify server role → lock primary artifact family
  → targeted extract/query → format close-out.
Do not aimless full-disk walks. Whole-disk import/parse shapes → hub tool-call-recipes.md (SSOT).
```

## Navigation

```text
myos-forensics-workflow (optional hub if exhibit not mounted/triaged)
  → THIS SKILL (server/CTF filesystem playbook)
  → performing-sqlite-database-forensics / forensic-network-pcap-exam when scope shrinks to one DB or pcap
```

## Overview

Reusable playbook for **authorized server forensics / CTF range** answer extraction from read-only mounted images, exported VMs, offline Docker/K8s directories, NAS evidence, or live hosts. Prefer read-only mount and filesystem-level analysis when evidence is already local. **When the user gives live SSH credentials (IP + user + password), use MCP `qiko-forensics-server-mcp` (`register-server` → `execute-command`) first** — do not default to askpass/paramiko/ssh scripts; only fall back after MCP failure or user opt-out. Goal: identify server role → locate high-value artifacts → extract credentials/config → query DBs and logs → static-analyze suspicious binaries when needed → every answer backed by reproducible evidence.

Do **not** restate full cowork `ensure_workspace` / `import_evidence` / `submit_job` chains here — use hub + `../myos-forensics-workflow/references/tool-call-recipes.md` (**Solve rhythm**) when the exhibit still needs product ingest.

Default posture: **read-only first, evidence-driven, answer-oriented**.

- Prefer read-only image mount; copy key evidence to case dir before heavy re-analysis.
- Avoid changing service state unless required to answer; log any start/restart action.
- In reports, separate **evidence** (file/command/SQL/log excerpt), **reasoning** (why), and **answer** (final value).
- Typical user context is CTF/range: detailed write-up acceptable; final answers must be easy to copy.

## When to use

Use when the user clearly or implicitly asks for:

- Server / Linux / Windows Server / Web / Docker / K8s / database forensics / range / CTF solving.
- Authorized images, VMs, remote lab hosts, NAS/ESXi/PVE evidence, exported filesystems, or similar.
- Questions on OS version, install time, hostname/IP/gateway, login IP, failure counts, service ports, web root, front/back-end stack, DB type/host/db/user/password, SQL aggregates, deleted/modified data, webshells, admin paths, Docker port maps/env/volumes, K8s Secrets, etc.
- Suspicious binaries, PyInstaller apps, C2 config, AI/WebUI data, middleware config, logs, or DB files on the server.

**Do NOT use** for unauthorized systems, real-world attacks, persistence, privilege escalation, stealth ops, or bulk exfiltration beyond authorized scope.

## Workflow

### 0. Scope, preservation, and analysis ledger

Confirm evidence boundaries and open a short ledger before analysis. If authorization is unclear, ask once; if clearly CTF/range/image, proceed.

Evidence ledger template:

```markdown
| 项目 | 值 | 溯源 |
|---|---|---|
| 证据来源 | image/VM/remote host/path | user / mount path / remote (SSH optional only) |
| 时区假设 | UTC/local/unknown | 📄 `timedatectl` or log timezone clues |
| 分析模式 | read-only mount/live host/container started? | action log |
| 哈希 | SHA256/MD5 of original evidence or key files | 📄 `sha256sum ...` |
| 改变状态的动作 | none / docker start X at time Y | action log |
```

Done when: source, authorization context, timezone assumption, hashes/integrity, and any state-changing actions are recorded.

### 1. Seven baseline steps after gaining access

Execute in order. Do not dive into a single clue before system baseline is known.

#### 1.1 Hash / integrity (often 1-point questions)

- Image or raw disk: hash original evidence when accessible.
- Individual files: hash suspicious binaries, archives, DBs, and configs used in final answers.

```bash
sha256sum /path/to/evidence_or_file
md5sum /path/to/evidence_or_file
```

#### 1.2 OS version, hostname, install time, timezone

Linux:

```bash
hostname
uname -a
cat /etc/*-release 2>/dev/null | head -50
cat /etc/hostname 2>/dev/null
cat /etc/timezone 2>/dev/null || timedatectl 2>/dev/null
tune2fs -l /dev/<partition> 2>/dev/null | grep -i 'Filesystem created'
```

Windows Server evidence:

```text
systeminfo
Registry: HKLM\SYSTEM\CurrentControlSet\Control\TimeZoneInformation
IIS: %SystemRoot%\System32\inetsrv\config\applicationHost.config
```

Done when: OS version, kernel/build, hostname, timezone answerable; install time cross-checked from FS creation, logs, or Windows registry/events if asked.

#### 1.3 Network configuration

```bash
cat /etc/hosts 2>/dev/null
cat /etc/resolv.conf 2>/dev/null
cat /etc/sysconfig/network-scripts/ifcfg-* 2>/dev/null
cat /etc/netplan/*.yaml 2>/dev/null
ip addr 2>/dev/null || ifconfig 2>/dev/null
ip route 2>/dev/null
```

Extract: static IP, gateway, DNS, hostname mappings, exposed internal segments.

Done when: IP, gateway, DNS, name resolution, and key internal ranges recorded with source file/command.

#### 1.4 Users and login history

```bash
cat /etc/passwd | awk -F: '$7 ~ /(bash|zsh|sh)$/ {print}'
cat /etc/shadow 2>/dev/null
last -i 2>/dev/null | head -100
lastb -i 2>/dev/null | head -100
cat /var/log/secure 2>/dev/null | grep -Ei 'accepted|failed|invalid|session opened|sudo' | tail -300
cat /var/log/auth.log* 2>/dev/null | grep -Ei 'accepted|failed|invalid|session opened|sudo' | tail -300
```

High-frequency answers: ops/attacker IP, successful remote login IP, failed login count, user creation/privilege/sudo, login time windows.

Done when: system users, login-capable users, success/failure events, suspicious sources, and timeline extracted.

#### 1.5 Services, ports, processes

```bash
systemctl list-units --type=service --state=running 2>/dev/null | head -200
ss -tlnup 2>/dev/null || netstat -tlnp 2>/dev/null
ps auxww | egrep -i 'java|node|python|php|nginx|httpd|apache|tomcat|mysql|maria|postgres|mongo|redis|docker|containerd|kube|etcd|zookeeper|nacos|kafka|rabbit|elastic|clickhouse|iis|w3wp|ollama|webui|milvus|alist|jellyfin|cs|teamserver|metasploit|empire' | grep -v egrep
lsof -i :<port> 2>/dev/null
```

**Branch immediately:** Web service → locate docroot and DB config (§2). Docker/K8s/middleware → extract env/Secret/config credentials (§4–5).

Done when: running services, listening ports, key processes, and process↔port/app mapping recorded.

#### 1.6 Key logs and shell history

```bash
ls -lah /var/log 2>/dev/null
sed -n '1,220p' /root/.bash_history 2>/dev/null
find /home /root -name '.*history' -type f -maxdepth 3 -print 2>/dev/null
cat /etc/crontab 2>/dev/null
ls -lah /var/spool/cron /var/spool/cron/crontabs 2>/dev/null
```

Common log paths:

- CentOS/RHEL: `/var/log/messages`, `/var/log/secure`, `/var/log/cron`, `/var/log/maillog`
- Ubuntu/Debian: `/var/log/syslog`, `/var/log/auth.log`, `/var/log/mail.log`

Done when: availability and key paths for system/auth/cron/shell history/service logs recorded.

#### 1.7 Simulate or start only when necessary

Start image/container/service only if static analysis cannot answer. Before start: copy evidence or snapshot, isolate network (NAT/host-only), avoid IP conflicts, log the action.

Done when step 1 ends with clear system identity, network, users/logins, ports/services, logs, and likely evidence roots.

## 2. Web service and application evidence (highest frequency: DB connection config)

### 2.1 Locate docroot and reverse-proxy chain

Apache:

```bash
grep -RInE 'DocumentRoot|ServerName|VirtualHost|ErrorLog|CustomLog' /etc/httpd /etc/apache2 2>/dev/null
ls -lah /var/log/httpd /var/log/apache2 2>/dev/null
```

Nginx:

```bash
grep -RInE 'server_name|root |alias |proxy_pass|access_log|error_log|rewrite' /etc/nginx /www/server/nginx 2>/dev/null
ls -lah /var/log/nginx /www/wwwlogs 2>/dev/null
```

IIS / Windows Server:

```text
%SystemRoot%\System32\inetsrv\config\applicationHost.config  -> site physicalPath, bindings, application pools
C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log                    -> IIS logs
C:\inetpub\history\                                             -> IIS config backups
```

Reverse proxy / CDN / WAF clues: `proxy_pass`, `X-Forwarded-For`, HAProxy `backend`, Varnish `backend default`, ModSecurity/BaoTa WAF logs. For "real origin IP", trust config and historical DNS over external guessing.

Done when: docroot, domain/bindings, proxy targets, and web logs located.

### 2.2 Identify front/back-end stack

Use directory layout + dependency files + running processes — not filename alone.

```bash
find /var/www /www/wwwroot /opt /home /usr/local -maxdepth 5 -type f 2>/dev/null | \
  egrep -i 'wp-config.php|composer.json|artisan|think|database.php|common.inc.php|forum.php|manage.py|settings.py|app.py|requirements.txt|package.json|next.config|nest-cli|pom.xml|build.gradle|application.yml|application.properties|web.config|appsettings.json|Gemfile|go.mod|config.yaml|conf/app.conf' | head -500
```

Stack anchors:

| Stack | Strong signals | DB config target |
|---|---|---|
| ThinkPHP 3 | `Application/`, `Think.class.php` | `Application/Common/Conf/config.php` |
| ThinkPHP 5/6 | `application/`, `topthink`, `route.php` | `config/database.php`, `.env` |
| Laravel | `artisan`, `app/Http`, Blade | `.env`, `config/database.php` |
| DedeCMS | `/dede/`, `dede_` tables | `data/common.inc.php` |
| Discuz | `source/`, `uc_client/`, `forum.php` | `config/config_global.php` |
| WordPress | `wp-login.php`, `wp-content/` | `wp-config.php` |
| Spring Boot | jar, `BOOT-INF`, `application.yml` | jar内 `BOOT-INF/classes/application.*` |
| Spring MVC/SSM | `WEB-INF/web.xml`, mapper XML | `jdbc.properties`, `applicationContext.xml` |
| RuoYi/Jeecg | `application-druid.yml`, Druid | `application-*.yml` |
| Django | `manage.py`, `settings.py` | `settings.py` `DATABASES` |
| Flask/FastAPI | `app.py`, `main.py`, uvicorn | `config.py`, `.env`, `SQLALCHEMY_DATABASE_URI` |
| Node/Express/Nest/Next/Egg | `package.json`, `.env`, `config/` | `.env`, `config/database.js`, `ormconfig.json` |
| ASP.NET/IIS | `.aspx`, `bin/*.dll`, `web.config` | `web.config` `<connectionStrings>` |
| ASP.NET Core | `appsettings.json`, `Program.cs` | `appsettings*.json` |
| Go | single ELF + config | `config.yaml`, `.env`, `conf/app.conf`, `strings` |
| Rails | `Gemfile`, `config/routes.rb` | `config/database.yml` |

Done when: back-end language/framework, front-end if needed, and config paths identified.

### 2.3 Extract DB connection config before querying

Highest-frequency answer path. After locating the site, extract:

- DB type: MySQL/MariaDB, PostgreSQL, MongoDB, Redis, SQLite, SQL Server, Elasticsearch, ClickHouse, Oracle.
- DB host + port, database name, username, password, table prefix.
- Salt/key/API secrets needed for later password/token decryption.

Quick search:

```bash
grep -RInE 'DB_HOST|DB_DATABASE|DB_USERNAME|DB_PASSWORD|spring\.datasource|jdbc:mysql|mongodb://|redis\.|SQLALCHEMY_DATABASE_URI|connectionString|ConnectionStrings|password|passwd|dbpwd|DB_PWD|secret|salt|APP_KEY' /path/to/site 2>/dev/null | head -500
```

Framework quick map:

```text
WordPress         wp-config.php                  DB_HOST / DB_USER / DB_PASSWORD / DB_NAME
DedeCMS           data/common.inc.php            cfg_dbhost / cfg_dbname / cfg_dbuser / cfg_dbpwd / cfg_dbprefix
Discuz            config/config_global.php       dbhost / dbuser / dbpw / dbname
Laravel           .env                           DB_* / APP_KEY
ThinkPHP          config/database.php, .env      hostname / database / username / password
Django            settings.py                    DATABASES, SECRET_KEY
Flask             config.py/.env                 SQLALCHEMY_DATABASE_URI
Spring Boot       application.yml/properties     spring.datasource.*, redis.*, mongodb.uri
ASP.NET           web.config                     <connectionStrings>
ASP.NET Core      appsettings.json               ConnectionStrings:DefaultConnection
Node/Nest/Next    .env, ormconfig.json           DATABASE_URL / host / username / password
Rails             config/database.yml            adapter / database / username / password
Go                config.yaml or binary strings  mysql.host / password / DSN
BaoTa panel       /www/server/panel/data/default.db + site config
```

If password appears encrypted/encoded:

| Form | Clue | Next step |
|---|---|---|
| Base64 | `=`/`==`, base64 charset | Decode; verify readability/format |
| Druid/Jeecg AES/RSA | `publicKey`, `ConfigFilter`, Druid config | Find public key/decrypt logic; use Druid decrypt |
| Jasypt | `ENC(...)` | Locate `jasypt.encryptor.password` then decrypt |
| ASP.NET protected config | `configProtectedData` | Decrypt on original server via RSA key container / `aspnet_regiis -pdf` |
| WebLogic | `{AES}` / encrypted `boot.properties` | Domain `SerializedSystemIni` + decrypt logic |
| Go hardcoded | no config, single binary | `strings -a binary | grep -Ei 'mysql|postgres|redis|password|token|secret'` |

Alternate password sources when config missing: `~/.bash_history`, `.my.cnf`, `/etc/mysql/debian.cnf`, Docker env, `docker-compose.yml`, saved browser passwords, Xshell/FinalShell sessions, BaoTa `default.db`, hardcoded strings in jar/DLL.

Done when: all connection fields for follow-up queries recorded; mark missing fields as "未能验证/未发现" / not verified.

### 2.4 Web intrusion, admin panel, webshell evidence

Find admin paths, webshells, route maps, upload points, attack traces:

```bash
grep -RInE '@RequestMapping|@GetMapping|@PostMapping|route\(|Router|admin|login|dashboard|upload|eval\(|assert\(|gzinflate|base64_decode|system\(|shell_exec|Runtime\.getRuntime|ProcessBuilder|cmd\.exe|powershell' /path/to/site 2>/dev/null | head -500
find /path/to/site -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | sort | tail -200
```

Deobfuscation hints: PHP `eval` → replace with `echo` on copies only; .NET DLL → dnSpy/ILSpy; Java → CFR/procyon/jadx; PyInstaller/PYC → pyinstxtractor/pycdc/Pylingual; Go → GoReSym/strings/Ghidra.

Done when: admin routes, upload/webshell evidence, and vulnerability entry backed by source, logs, or reproducible steps.

## 3. Database forensics (fix field semantics before aggregates)

Principle: before SUM/COUNT/filter, confirm table/field/status meaning from source, templates, config, or enum constants.

### MySQL / MariaDB

```bash
find / -name ibdata1 -o -name '*.ibd' -o -name '*.frm' 2>/dev/null | head -200
grep -RInE 'general_log|log_bin|datadir|socket|port' /etc/mysql /etc/my.cnf* 2>/dev/null
mysql -uUSER -pPASS -hHOST -PPORT -N -B -D DB -e 'SHOW TABLES;'
```

High-value logs: general log (`UPDATE/DELETE/INSERT` audit), binlog (`mysqlbinlog`), app logs. For deleted/modified records, preserve binlog/general-log evidence and reconstruct with SQL.

### MongoDB / Redis / PostgreSQL / SQLite

```bash
# MongoDB
cat /etc/mongod.conf 2>/dev/null; ls /var/lib/mongodb /data/db 2>/dev/null
# Redis
cat /etc/redis/redis.conf 2>/dev/null; ls /var/lib/redis/dump.rdb /var/lib/redis/appendonly.aof 2>/dev/null
# PostgreSQL
cat /etc/postgresql/*/main/postgresql.conf /etc/postgresql/*/main/pg_hba.conf 2>/dev/null
# SQLite
find / -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' 2>/dev/null | head -200
sqlite3 file.db '.tables'
```

SQLite frequent cases: Open WebUI `webui.db` (`chat`, `user`), Jellyfin, Alist `data.db`, Uptime Kuma.

### Elasticsearch / ClickHouse / SQL Server / Oracle

```text
Elasticsearch: /etc/elasticsearch/elasticsearch.yml, /var/lib/elasticsearch/indices/, live curl /_cat/indices
ClickHouse:    /etc/clickhouse-server/{config.xml,users.xml}, /var/lib/clickhouse/, clickhouse-client
SQL Server:    C:\...\MSSQL\DATA\*.mdf/*.ldf, SSMS or fn_dblog(), IIS/.NET connection strings
Oracle:        ORACLE_HOME/ORACLE_SID, listener.ora, tnsnames.ora, oradata/<SID>/*.dbf, sqlplus / as sysdba
```

Done when: DB answers come from real query output with verified field semantics — not filename guessing.

## 4. Docker and container forensics (offline: still check config.v2.json)

Even stopped containers, Docker dirs often hold decisive credentials, port maps, and mounted data.

Online commands:

```bash
docker ps -a --no-trunc 2>/dev/null
docker images 2>/dev/null
docker inspect $(docker ps -aq) --format '{{.Name}} {{.Config.Image}} {{.State.Status}} {{json .Config.Env}} {{json .HostConfig.Binds}} {{json .Mounts}} {{json .HostConfig.PortBindings}}' 2>/dev/null
```

Offline paths:

```text
/var/lib/docker/containers/<id>/config.v2.json     -> name, image, env, command, GraphDriver paths
/var/lib/docker/containers/<id>/hostconfig.json    -> ports, binds, privileged, restart policy
/var/lib/docker/containers/<id>/<id>-json.log      -> stdout/stderr logs
/var/lib/docker/overlay2/<layer>/diff              -> image/container layer files
/var/lib/docker/volumes/                           -> mounted database/app data
```

Offline extraction script:

```bash
for d in /var/lib/docker/containers/*/; do
  echo "=== $(basename "$d") ==="
  python - <<'PY' "$d/config.v2.json" "$d/hostconfig.json"
import json, sys, pathlib
for p in sys.argv[1:]:
    if pathlib.Path(p).exists():
        obj=json.load(open(p, encoding='utf-8', errors='ignore'))
        print('FILE', p)
        print('Name/Image:', obj.get('Name'), obj.get('Config',{}).get('Image'))
        print('Env:', obj.get('Config',{}).get('Env'))
        print('Ports:', obj.get('HostConfig',{}).get('PortBindings'))
        print('Binds:', obj.get('HostConfig',{}).get('Binds'))
        print('Mounts:', obj.get('Mounts'))
        print('Graph:', obj.get('GraphDriver',{}).get('Data'))
PY
done
```

Also search `docker-compose.yml/.yaml` for `services`, `ports`, `volumes`, `environment`, `depends_on`, `networks`.

Done when: container name/image, port maps, env credentials, volumes, logs, compose topology, UpperDir changes covered.

## 5. Kubernetes and distributed middleware (Secrets / config center first)

### 5.1 K8s node role and key files

Master node signals:

```bash
ls /etc/kubernetes/manifests/ 2>/dev/null
systemctl status kubelet 2>/dev/null | head -50
kubectl get nodes -o wide 2>/dev/null
kubectl get pods,svc,deploy,sts,ds -A 2>/dev/null
```

Key paths:

```text
/etc/kubernetes/admin.conf            -> cluster-admin kubeconfig
/etc/kubernetes/manifests/            -> apiserver/etcd/scheduler/controller static pods
/etc/kubernetes/pki/                  -> CA/component certs and keys
/var/lib/etcd/                        -> etcd data, K8s source of truth
/var/lib/kubelet/pods/<uid>/volumes/  -> mounted Secret/ConfigMap/PV data
/var/log/containers/, /var/log/pods/   -> container logs
/var/log/kubernetes/audit/            -> API audit logs if enabled
~/.kube/config                        -> user kubeconfig
```

### 5.2 etcd extraction

If K8s present, etcd is often highest-value.

```bash
ls /var/lib/etcd/member/snap /var/lib/etcd/member/wal 2>/dev/null
ETCDCTL_API=3 etcdctl --endpoints=http://127.0.0.1:2379 get / --prefix --keys-only 2>/dev/null | head
ETCDCTL_API=3 etcdctl --endpoints=http://127.0.0.1:2379 get /registry/secrets --prefix 2>/dev/null
```

Offline: copy `/var/lib/etcd`, snapshot/restore with `etcdctl`, start temp local etcd, dump key prefixes.

High-value prefixes:

```text
/registry/secrets/          K8s Secret: data needs base64 decode
/registry/configmaps/       app config
/registry/pods/             images/env/volumes
/registry/services/         exposed ports/ClusterIP
/registry/serviceaccounts/  tokens
/registry/events/           scheduling/error events
```

### 5.3 Middleware / config center

| Service | Port | Config/data | Extract focus |
|---|---:|---|---|
| etcd | 2379/2380 | `/var/lib/etcd` | K8s objects, Secrets, cluster members |
| ZooKeeper | 2181 | `zoo.cfg`, `/var/lib/zookeeper/version-2` | Dubbo providers, Kafka brokers/topics, cluster nodes |
| Consul | 8500 | `consul.hcl`, `/opt/consul/data/raft` | KV config, services, members; base64 values |
| Nacos | 8848 | `application.properties`, `/home/nacos/data`, Derby/MySQL | `config_info`, `his_config_info`, users, microservice DB passwords |
| Kafka | 9092 | `server.properties`, `log.dirs` | topics, message content, consumer offsets |
| RabbitMQ | 5672 | `/etc/rabbitmq`, `/var/lib/rabbitmq/mnesia` | users, queues, recoverable messages |
| Elasticsearch | 9200 | `elasticsearch.yml`, `indices/` | cluster, index names, docs, credentials |
| ClickHouse | 8123/9000 | config/users XML, `/var/lib/clickhouse` | tables, analytics records |

Done when: service topology, config credentials, and question-relevant Secret/ConfigMap/KV values extracted.

## 6. Specialized server types

### Virtualization / NAS / storage

- ESXi: `/vmfs/volumes/`, `.vmx`, `.vmdk`, VMFS datastores, ISO files, install logs.
- PVE/VCSA/vSAN/Ceph/ZFS/Unraid: cluster name, version, storage pools, resource pools, disk groups, encryption key files.
- NAS: RAID layout, share dirs, SMB/NFS/FTP config, recycle bin, NAS login/delete logs, eCryptFS/LUKS/VeraCrypt keys.

### File, mail, DNS, remote access

```text
FTP/vsftpd: /etc/vsftpd*.conf, /var/log/vsftpd.log, xferlog
Samba:      /etc/samba/smb.conf, pdbedit -L, /var/log/samba/
Postfix:    /etc/postfix/main.cf, /var/spool/postfix/, /var/log/maillog or mail.log
DNS:        zone files / Windows DNS records; dig A/MX/TXT/NS/CNAME/ANY @server domain
SSH:        /etc/ssh/sshd_config, ~/.ssh/{authorized_keys,known_hosts,config}, auth logs
Remote tools: Xshell/FinalShell/SecureCRT sessions, sunlogin logs, TeamViewer logs, RustDesk2.toml, OpenVPN logs
C2:         Cobalt Strike teamserver logs/downloads/.beacon_keys, Empire/Metasploit logs, proxy configs (Trojan/Sing-box/ngrok)
```

### AI / LLM servers

Focus on Docker Compose stacks and SQLite/Redis/vector stores:

```text
Open WebUI: webui.db -> chat/user tables, JSON messages, usage.total_tokens, profile_image_url base64
Ollama:     model files/manifests, model names and sizes
Dify/Flowise/Claude Relay: compose env, API keys, Redis/Postgres/SQLite configs
Milvus:     pymilvus/collections, vector DB records, knowledge-base payloads
```

Done when: if present, category-specific config, logs, and data stores checked.

## 7. Suspicious binaries and reverse-engineering aids

Static first. Do not run unknown programs on evidence host unless explicitly required in a controlled range.

```bash
file suspicious
sha256sum suspicious
strings -a -n 5 suspicious | egrep -i 'https?://|mysql|redis|mongodb|token|secret|license|auth|expire|key|api|admin|password|cmd|powershell|beacon|teamserver' | head -500
```

PyInstaller:

```bash
pyi-archive_viewer suspicious
pyinstxtractor.py suspicious
```

Python bytecode inspection:

```python
import marshal, dis, types, pathlib
b = pathlib.Path('extracted_main').read_bytes()
co = marshal.loads(b)  # try b[16:] only if .pyc header exists

def walk(code):
    print('CODE', code.co_name, code.co_filename, code.co_firstlineno, code.co_names)
    for c in code.co_consts:
        if isinstance(c, str) and any(k in c.lower() for k in ['http','mysql','redis','token','license','secret','password','api']): print('CONST', repr(c))
        elif isinstance(c, types.CodeType): walk(c)
walk(co); dis.dis(co)
```

Other patterns: .NET → dnSpy/ILSpy/de4dot; Java → jadx/CFR/procyon; Go/ELF → Ghidra/IDA/GoReSym; UPX unpack first; Cobalt Strike config → 1768.py; PYC → pycdc/Pylingual.

Done when: binary answers from reproducible strings, disasm, decompile, or decrypt — not execution guesses.

## 8. Answer extraction patterns

### SQL / aggregate questions

1. Find DB config from web/app/container.
2. Connect read-only or copy DB files to analysis env.
3. Enumerate tables and schema.
4. Confirm status/field semantics from source/templates/config.
5. Run precise SQL; save output.

```sql
SHOW TABLES;
DESCRIBE table_name;
SELECT status, COUNT(*), SUM(amount) FROM orders GROUP BY status;
SELECT * FROM users WHERE username='admin';
```

### Login IP questions

- SSH login: auth logs / `last -i` first.
- Web admin login: app logs, container logs, reverse-proxy logs, IIS logs; bind IP to successful login flow (e.g. `POST /login` 302 then dashboard 200) — not arbitrary requests.
- With proxy/CDN, consider `X-Forwarded-For`.

### Hash / attachment / file questions

Extract exact file specified; hash with required algorithm; record path + command.

### Report format

**⚠️ Mandatory provenance rule (v1.3+):**

**All data tables MUST include a `溯源` column** marking source file or command for each value. No sourceless rows.

Provenance format:

- Source file: `📄 /path/to/file` or `📄 cat /etc/os-release`
- SQL: `📄 SELECT ... FROM ...`
- Command: `📄 hostname`, `📄 ss -tlnp`

Correct example:

| 项目 | 值 | 溯源 |
|---|---|---|
| 主机名 | `centos7` | 📄 `hostname` |
| 管理员 | `darkadmin` | 📄 `SELECT * FROM sys_user` |
| 总金额 | ¥21,495,000 | 📄 `SELECT SUM(loan_amount) FROM loan_records` |
| 端口 13306 | docker-proxy→loan_mysql | 📄 `ss -tlnp` |
| Flask 路由 | `/login` GET/POST | 📄 `cat /home/app/app.py` lines 25–40 |

Wrong example (forbidden):

| 项目 | 值 |
|---|---|
| 主机名 | centos7 | ← missing 溯源 column |

CTF answer table:

```markdown
| 题号 | 答案 | 溯源 |
|---|---|---|
| 1 | `Ubuntu 22.04` | 📄 `/etc/os-release` |
| 2 | `10.0.0.5` | 📄 `/etc/netplan/00-installer-config.yaml` |
| 3 | `root:***@mysql:3306/appdb` | 📄 `/var/www/app/.env` |
```

Detailed Chinese report structure (when full write-up requested):

```markdown
## 结论
## 取证环境与证据保全
## 分析过程
### 系统与网络
### 服务与端口
### Web 与数据库配置
### 容器/K8s/中间件
### 日志与时间线
## 答案表
## 遗留疑点/无法验证项
```

Done when: every final answer points in `溯源` to path, command/query, log line, or reproducible calculation.

## High-frequency exam priority

When time is limited, proceed in this order. For integrating a larger server forensics manual, see `references/source-manual-integration.md` (compressed patterns and Darwin-style validation).

1. Web DB connection config (user/password/db/host)
2. SQL count/sum/user/transaction queries
3. Web admin path and framework/version
4. OS version, hostname, install time, timezone
5. Login logs: success/failure/IP/time
6. Docker: env, port maps, volumes, logs
7. Web back-end/front-end language and version
8. Deleted/modified DB data via binlog/general log
9. SSH/Xshell/remote-control source IP
10. Webshell/vulnerability/deobfuscation evidence
11. Druid/Jasypt/MD5 salt/ASP.NET protected config password decrypt
12. K8s etcd Secret/ConfigMap extraction
13. Nacos/ZooKeeper/Consul/Kafka config and credentials
14. Real origin IP behind CDN/reverse proxy
15. IIS/.NET config and DLL reverse engineering
16. AI servers: Open WebUI/Ollama/Dify/Redis/Milvus records

## Common pitfalls

1. **Skip DB config extraction.** Most web/DB questions need site config first.
2. **Confuse SSH login IP with web admin login IP.** Match the service the question asks about.
3. **Assume status field meaning.** Confirm from source/templates/constants before SQL aggregates.
4. **Ignore offline Docker files.** `config.v2.json`, `hostconfig.json`, logs, env, volumes still matter when Docker is down.
5. **Miss K8s Secrets.** Secret `data` is usually base64, not encryption — decode and verify.
6. **Trust single timestamp.** Normalize timezone; cross-check FS, logs, DB, app logs.
7. **Run unknown tools/malware.** Prefer static extraction and controlled offline analysis.
8. **Whole-disk random search.** Start `/root`, `/home`, `/opt`, `/var/www`, `/www`, `/var/lib/docker`, `/var/log` then expand.
9. **Report guesses.** Write "未能验证" when evidence missing — do not fabricate.
10. **Leak unnecessary PII.** Report only fields required by the authorized task.
11. **Missing 溯源 column.** All data tables must use `| 项目 | 值 | 溯源 |`; `| 项目 | 值 |` alone is invalid.

## Verification checklist

- [ ] Authorization/range context clear enough to proceed.
- [ ] Evidence source, hashes, timezone, and state-changing actions logged.
- [ ] OS, hostname, network, users, logins, services, ports baselined.
- [ ] If Web present: docroot, framework/CMS, admin path, logs located.
- [ ] DB connection config extracted before DB queries.
- [ ] Encrypted/encoded passwords handled with reproducible method.
- [ ] If Docker present: containers/images/env/ports/volumes/logs checked.
- [ ] If K8s present: admin.conf, manifests, etcd, Secrets, ConfigMaps, pod volumes/logs checked.
- [ ] If middleware/config center (etcd/ZooKeeper/Consul/Nacos/Kafka, etc.): config and data checked.
- [ ] DB answers from real query output with verified field semantics.
- [ ] Login IP answers tied to correct service and successful event.
- [ ] Binary answers from hash, strings, disasm, decompile, or reproducible decrypt.
- [ ] Final report separates evidence, reasoning, answers, and open items.
- [ ] **All report tables include 溯源 column**: `| 字段 | 值 | 溯源 |`; missing 溯源 = fail.

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
