# 服务器取证手册整合笔记

本文档记录将大型服务器取证考试手册整合进 `forensics-exam-server` skill 时形成的长期经验。

## 来源类型

当用户提供的是服务器取证竞赛、CTF 靶场或授权取证实验室使用的宽泛 checklist/manual 时，使用本整合模式。不要为某一份手册单独创建一次性 skill；应把可复用的工作流压缩进类级别的服务器取证 skill，把具体来源、会话细节或扩展材料放在 `references/` 中。

## 整合方法

1. 保留原 skill 的答案提取优势：只读优先、CTF 答案表、PyInstaller/二进制分析、Docker 日志、SQL 证据链。
2. 只有在会改变未来执行行为时，才加入宽泛排查项：哈希、OS、网络、用户、登录、服务、日志；完成基线后立即分支到 Web 数据库配置、Docker、K8s 或中间件凭据。
3. 优先覆盖最高频考试路径：定位 Web 根目录 -> 识别框架 -> 提取数据库配置 -> 验证密码编码/加密方式 -> 查询数据库，并从源码/模板/配置中确认 status 等字段语义。
4. 将大型百科式材料压缩成速查表、命令和完成标准。避免把上游手册原样搬进 `SKILL.md`，导致 skill 变成无边界百科。
5. 测试用例应覆盖代表性类别，而不是当天具体题目：Web+DB 统计、K8s/etcd Secrets、Docker 离线日志/env 提取等。
6. 重写后可用 Darwin-style dry-run rubric 做一次自评并报告分数；除非真的有独立子代理分别在加载/不加载 skill 的情况下执行对照实验，否则必须标记为 `dry_run`。

## 应保留在类级 skill 中的主题

- 初始 7 步服务器基线排查。
- Web 框架/CMS 识别与数据库配置查找。
- Docker 离线路径：`config.v2.json`、`hostconfig.json`、container logs、volumes、overlay/UpperDir。
- K8s：`/etc/kubernetes`、`/var/lib/etcd`、Secrets/ConfigMaps、Pod volumes/logs。
- 分布式中间件/配置中心：etcd、ZooKeeper、Consul、Nacos、Kafka、RabbitMQ。
- 专门服务器类型只作为路由 checklist：虚拟化、NAS、邮件、DNS、文件服务器、远程访问工具、C2、AI 服务器。

## 保持在 references/ 中的内容

- 某份来源手册的原始目录、题型备注、一次性案例或来源特有术语。
- 大段背景解释、低频工具说明或不适合每次加载的百科材料。
- 用于未来扩展的测试提示词、评分 rubric、整合记录。

## 经验教训

不要让内容丰富的外部手册把 skill 膨胀成没有边界的百科全书。好的 skill 应该是执行 playbook：有足够广度来路由调查，有足够命令让 Agent 立即行动，并有足够完成标准防止过早给出答案。
