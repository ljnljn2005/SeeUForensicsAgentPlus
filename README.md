# SeeUForensicsAgentPlus

取证专用（DFIR）桌面版 —— 基于 [DeepSeek Harness](https://github.com/deepseek-ai)（`dsh`，MIT）官方运行时构建的 Electron 外壳，面向电子数据取证与事件响应场景：证据链优先、只读优先、默认关闭遥测。

本仓库只包含 **外壳 + 取证配置层**，不复制官方 monorepo；`dsh` 运行时来自 npm 已发布的 `@deepseek-ai/dsh@0.2.2-rc.1`，随应用一起打包，开机即用、无需另装 Node。

---

## 1. 它长什么样

```
┌─────────────────────────────────────────────────────────────┐
│  SeeUForensicsAgentPlus（Electron 44.7.0）                   │
│  ┌───────────────┐   spawn + 等就绪 URL   ┌───────────────┐  │
│  │ 主进程 main.ts│ ─────────────────────► │ dsh Web 服务  │  │
│  │ 窗口/托盘/菜单│ ◄──────────────────── ┌─┤ (web profile) │  │
│  └───────┬───────┘    http://127.0.0.1:N │ └───────┬───────┘  │
│          │ loadURL(带一次性 token)        │         │          │
│          ▼                                 │  --patch 取证 overlay│
│  ┌───────────────┐                         │  （resources/       │
│  │ 窗口内 = dsh  │◄────────────────────────┘   forensics/）     │
│  │ Web UI        │                                             │
│  └───────────────┘                                             │
└─────────────────────────────────────────────────────────────┘
```

- **外壳职责**：窗口、托盘、中文菜单、单实例、权限收紧（全部拒绝）、外链走系统浏览器、加载页/故障页、优雅退出。
- **运行时职责**：agent 循环、模型接入、工具（文件/搜索/shell/技能/session 等）、会话存储、Web UI。
- **视觉层**：`plugins/seeu-theme/` 是一个 dsh 客户端插件 + 宿主样式注入——取证深色主题（青蓝强调色、中文字体栈）、侧栏/欢迎页 SeeU 品牌、页面标题替换、欢迎页三步上手提示（选案件目录建库 → 直接提问 → 引用回查）；同时关闭官方 brand 插件避免双份。
- **取证职责**：`resources/forensics/cordis.patch.yml` 以 dsh 官方 patch-list 机制叠加在 `web` profile 之上——关闭遥测/产品分析行，注入中文取证 persona，并把会话 preset（`preset-standard`）改成**取证专用工具面**：保留官方 22 项里的 19 项（子代理 / 工作流 / 后台作业 / 定时任务 / 目标 / plan / todo 都可用），去掉 `tool-web`（取证会话不联网）、`tool-plugin-manager`（可联网安装/移除插件包）与 `tool-plugin-market`（插件市场），`tool-fs` 收成只读。详见 [docs/forensics-profile.md](docs/forensics-profile.md)。

## 2. 快速开始

```bash
npm install        # 已配 .npmrc（npmmirror + electron 镜像），D 盘约需 1.1G
npm start          # 构建 dist/ 并启动桌面版
```

首次启动会初始化 `%APPDATA%\SeeUForensicsAgentPlus\dsh-home`（与用户自己的 `~/.dsh` 完全隔离），随后窗口载入 dsh Web UI。

其它命令：

| 命令 | 说明 |
| --- | --- |
| `npm run build` | esbuild 打包 `src/main.ts`、`src/preload.ts` → `dist/`，复制 `renderer/` |
| `npm start` | build + `electron .` |
| `npm run verify` | 无人工点击的启动验证：拉 Electron，经 CDP 确认窗口真的加载了 dsh Web UI |
| `npm run check:overlay` | 离线校验取证 overlay（`--dump-config`），确认可解析、工具面符合设计；已挂到打包前置钩子 |
| `npm run package:dir` | 产出免安装目录版 `release/win-unpacked/`（用于快速验证） |
| `npm run package:win` | 产出 NSIS 安装包 + portable exe（需签名时另配证书） |

验证打包产物（把 `<exe>` 换成 `release/win-unpacked/SeeUForensicsAgentPlus.exe`）：

```bash
node scripts/verify-launch.mjs --exe <exe> --port 9333
```

通过时会打印 `{"ok": true, "url": "http://127.0.0.1:<port>/?token=...", "title": "SeeUForensicsAgentPlus"}`。

本轮已验证产物（**v0.2.0**，Windows x64、Electron 44.7.0、无签名）：

| 产物 | 大小 |
| --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版总计 769 MiB） |
| `release/win-unpacked/resources/app.asar` | 168,656,136 B（330/330 个 `@deepseek-ai` 包齐全，19,647 entries，含 `plugins/seeu-case-index/**`、`plugins/seeu-theme/**`、`tools/ges-index/**`） |
| `release/SeeUForensicsAgentPlus-0.2.0-x64.exe`（NSIS 安装包） | 211,911,443 B（blockmap 220,870 B） |
| `release/SeeUForensicsAgentPlus-0.2.0-x64-portable.exe` | 189,515,660 B |

实测冷启动到 dsh UI：目录版 4095 ms；portable 首次 36.5s（先要把 ~800MB 解包到 `%TEMP%`，属于预期）。更细的打包说明见 `docs/packaging.md`。

> 注：`release/` 里还留着 `SeeUForensicsAgentPlus-0.1.7-x64-portable.exe`，因为验收时它正在运行、文件被占用无法删除；新产物是 0.2.0 的那三个文件。

> **v0.2.0 改了什么**
>
> 1. **视觉层**：新增 `plugins/seeu-theme/`（宿主 `index.js` 把 `theme.css` 注入首屏 `<style>`，客户端 `client.js` 兜底 `<link>` + 改 `document.title`）——取证深色主题（深蓝底 + 青色强调）、中文字体栈、圆角/滚动条/选中态统一；官方 `ui-brand-official` 置为 disabled，改由主题插件提供侧栏品牌「SeeU 取证」与欢迎页大图标；`locale.preference: zh`。
> 2. **索引面板视觉重构**：`plugins/seeu-case-index/client.js` 全量 token 化，加 KPI 条（案件/检材/记录/实体/库大小/生成时间）、pill 标签 + 数量 badge、树行高与竖线指引、检材名加粗 + 平台/备注次级色、骨架屏/空态、表视图 sticky 表头。
> 3. **本地模型接入（OpenAI 兼容网关）**：见 §9。`tools/local-model.mjs` 生成 `llm-pi-ai` providers + `agent-default-model` + `session-title-llm` + `retryPolicy`，外壳启动时写成 `<userData>/local-model.patch.yml` 作为第二个 `--patch`。
> 4. **本地模型设置窗口**：菜单 `工具 → 本地模型设置…`（托盘也有），支持连通性测试（主进程 `net` 请求 `/v1/models`）、实时预览生成的 patch、保存并重启。
> 5. **启动探测**：启动时 4 秒探测已配置的网关，结果写 `logs\shell.log`，失败只提示不阻塞；错误页新增【本地模型设置】按钮。
> 6. **长上下文/低并发调优**：`retryPolicy.maxRetries 3`、标题生成 512 tokens/20s、preset 内 `compaction-basic` 余量 `headroomTokens: 32768`（128k 窗口不再在 57k 就压缩）。
> 7. 打包态验证：目录版 `{"ok":true,"elapsedMs":4095}`、portable `{"ok":true,"elapsedMs":36517}`、打包态面板 `m2ok:true`（七个标签、24 表、实体/时间线真实数据、`errors:[]`）、打包态设置窗口 `{"ok":true,…,"previewHasRetryPolicy":true,"badGatewayRejected":true}`（页面来自 asar 内的 `dist/renderer/local-model.html`）。

> **v0.1.7 改了什么**
>
> 1. **M5 跨案中央库**：新增 `tools/ges-index/cross.mjs` 与 `<dsh 工作目录>\indexes\crosscase.db`；每个案件库按"按案删了重写"幂等同步，汇总实体（kind+归一化值）、提及（每实体每案最多 5 条、带 `Goldeneyes://` 句柄）与镜像哈希。
> 2. **跨案查询**：`/seeu-index/cross/{list,sync,entity,top,files,stats}` 接口 + CLI `xcase sync/list/top/entity/files/stats`（`npm run index:xcase:*`）；建库完成后自动同步该案。
> 3. **面板第 7 个标签「跨案」**：统计概览、案件清单、【同步全部案件】（显示新增/更新案数）、重合实体 Top（minCases/kind 可调）、实体值查询按案件分组展示提及并可回查该案引用。
> 4. **技能升级**：`ges-case-index` SKILL.md 增加第 10 段跨案命令与"跨案命中属线索级、引用分别落各案句柄"的规则。
> 5. 双案夹具实测：`sharedEntities 3999`、Top 首行 `url … 2 案 508 次`、`phone 85254877240` 跨 2 案 12 次；打包态跨案面板 `m5ok: true`、`errors: []`。

> **v0.1.6 改了什么**
>
> 1. **M2 typed 结构化层**：按**真实表头签名**把全解析结果投影成 24 张表（联系人/账号/消息/通话/短信/浏览搜索/Exif/图片视频/应用/授权/SIM/Wi-Fi/蓝牙/流量/日历/小程序/朋友圈/收藏/设备/健康指标…），
>    本案 370 叶 / 22,777 记录里 21,123 条进入 typed 表（**92.7%**；CSV 记录 **99.7%**），并生成 22,772 条 `citation`（句柄+行号+可回查状态）。
> 2. **跨检材实体聚合**：手机号/邮箱/网址/IP/钱包/身份证/车牌/银行卡按值聚合，直接标出「跨 N 检材」；带关键词时唯一命中会返回提及明细（record/eid/app/时间/行号）。
> 3. **时间线**：按小时/天/月分桶，柱条可点，钻进该时段的记录。
> 4. **面板四视图**：树 / 检索之外新增 记录 / 实体 / 时间线 / 表 四个标签，全部带中文空态与翻页；引用仍一律回 `record.id` → `Goldeneyes://` 句柄。
> 5. **技能同步升级**：`ges-case-index` SKILL.md 补上 `/tables /table /entity /timeline /records` 用法，模型在会话里可直接做结构化查询与跨检材关联。
>
> 打包态实测：目录版 4100 ms / portable 44.5s 正常起 UI；asar 内插件与工具链齐全，打包态 UI 端到端（六个标签 + 记录/实体/时间线/表真实数据）`errors: []`。

> **v0.1.5 改了什么**
>
> 1. **会话里也能查库（M3）**：外壳启动前先用 `node:net` 探一个空闲端口，再 `--port <p>` 传给 dsh，
>    同时把 `SEEU_INDEX_API=http://127.0.0.1:<p>/seeu-index` 放进 dsh 子进程环境变量；
>    随包的 `ges-case-index` 技能教模型用 `curl -G "$SEEU_INDEX_API/..."` 查库（详见 §8.5）。
> 2. **技能自动安装**：启动时把 `resources/forensics/skills/**` 逐文件复制到 `dsh-home\skills\`
>    （dsh 的默认技能根，带 `version:文件名:大小` 指纹，内容没变就跳过）——**不需要 customSkillDirs，
>    也不需要外壳生成 runtime patch**。
> 3. **记住上次案件目录**：面板选过的案件目录写进 `dsh-home\index-state.json`，下次启动自动扫描，
>    重启后可直接看到上次的库。
> 4. **打包自检**：asar 内 19,637 entries，含客户端插件、`tools/ges-index/**`、overlay 与 4 个 SKILL.md；
>    overlay md5 与源文件一致（`64cd0e7721d17acea8fbba6fdae8f66b`）。

> **v0.1.4 改了什么**
>
> 1. **案件索引面板**：新增 dsh 客户端插件 `plugins/seeu-case-index/`，在 dsh Web UI 的
>    左侧栏（`sidebar.panellist`）与设置页（`settings.section`）各有一个「取证索引」入口：
>    填案件目录 → 【建库 / 更新】（带进度条）→ 树状导航 + 关键词检索 + 引用详情，
>    全流程不用开命令行（详见 §8）。
> 2. **宿主插件路由**：`/seeu-index/{list,build,tree,search,cite,stats,verify}` 跑在 dsh
>    自己的 webServer 上（仅 loopback，只允许读 `.seeu-index` 下的库文件）。
> 3. **注册方式**：`resources/forensics/cordis.patch.yml` 末尾一行 `- insert:` 指相对路径
>    `../../plugins/seeu-case-index/index.js`，开发态/打包态（asar 内）同一条路径都能解析，
>    不需要 pnpm 安装插件；`electron-builder.yml` 白名单补 `plugins/**` 与 `tools/ges-index/**`。

> **v0.1.3 改了什么**
>
> 1. **工具面再收窄两项**：从 `preset-standard.plugins` 整条删除 `tool-plugin-manager`
>    （`plugin_manager` 可联网安装/移除 npm 插件包，等于打开供应链与代码执行路径）与
>    `tool-plugin-market`（插件市场，官方默认本就 disabled）。当前 preset = 官方 22 项
>    减去 3 项 = **19 项**；`present`、子代理、工作流、后台作业、定时任务、目标、plan
>    等能力全部保留。
> 2. `npm run check:overlay` 增加断言：preset 内不得出现 `tool-web` /
>    `tool-plugin-manager` / `tool-plugin-market`。
>
> **v0.1.2 改了什么**
>
> 1. **取证工具面定稿**：`preset-standard` 保留官方 22 项里的 21 项（子代理 / 工作流 /
>    后台作业 / 定时任务 / 目标 / plan / todo 都可用），只去掉 `tool-web`（不联网），
>    `tool-fs` 收成只读；估算每轮请求省 ~1.5k token（估算值）。
> 2. **打包前 overlay 校验**：新增 `npm run check:overlay`，挂进 `prepackage:dir` /
>    `prepackage:win`。起因是本轮早先一次打包把被并发改写中的 overlay 半截内容打进
>    asar，产物启动即报 `failed to parse overlay ... YAMLException`；现在打包前
>    直接失败，不再产出坏包（详见 `docs/packaging.md` §5.2）。
> 3. 新增 `scripts/kill-app.mjs`：验证/打包前清理残留实例，避免单实例锁导致
>    新实例静默退出（`exit 0`）。
>
> 历史包袱：v0.1.0 缺 21 个 peer 包（启动即崩），v0.1.1 / v0.1.2 / v0.1.3 是索引面板
> 之前的版本，均已作废。**请统一使用 0.1.4 的产物。**

## 3. 目录结构

```
.
├─ src/
│  ├─ main.ts          # 主进程：窗口/托盘/菜单/权限/加载页与故障页/IPC/退出编排
│  ├─ host.ts          # dsh 子进程生命周期：spawn、解析就绪 URL、日志、停止、指纹回退
│  ├─ paths.ts         # 开发态/打包态统一路径（userData、工作区、日志、overlay、图标）
│  ├─ preload.ts       # contextBridge 暴露最小只读 API：window.seeu
│  └─ brand.ts         # 产品名、appId、配色、工作区目录名、桌面版标记环境变量
├─ renderer/
│  ├─ loading.html     # 品牌化加载页（运行时状态实时更新）
│  └─ error.html       # 故障页：错误摘要 + 诊断 + 重试/打开日志/打开工作区/退出
├─ resources/forensics/
│  ├─ cordis.patch.yml # 取证 overlay（核心配置产物）
│  ├─ README.md        # 逐行改动说明与账号链路取舍
│  └─ skills/          # 3 个取证技能包（默认未接入，见 docs）
├─ build/              # 图标（icon.ico / tray.ico / icon.png）与生成脚本
├─ scripts/
│  ├─ build.mjs        # esbuild 构建
│  ├─ check-overlay.mjs# 打包前 overlay 校验（--dump-config，防止把坏配置打进 asar）
│  ├─ verify-launch.mjs# CDP 启动验证（开发态 / 打包产物通用）
│  └─ kill-app.mjs     # 清理残留实例（打包/验证前先跑，避免单实例锁导致 exit 0）
├─ docs/
│  ├─ forensics-profile.md  # overlay 机制、验证命令与实测证据、扩展方式、局限
│  ├─ plan-case-index.md    # 火眼全解析结果入库 + dsh 只查库 的实施计划与实测
│  └─ packaging.md          # 打包说明
├─ tools/ges-index/    # 火眼案件「全解析结果」→ 本地 SQLite 索引（建库 + 树状查询）
├─ electron-builder.yml
└─ package.json
```

## 4. 运行时位置

| 内容 | 路径 |
| --- | --- |
| 用户数据 / dsh HOME | `%APPDATA%\SeeUForensicsAgentPlus\dsh-home`（`SEEU_DSH_HOME` 可覆盖） |
| 取证工作区（dsh 子进程 cwd） | `%USERPROFILE%\Documents\SeeUForensicsWorkspace`（`SEEU_WORKSPACE` 可覆盖） |
| 日志 | `%APPDATA%\SeeUForensicsAgentPlus\logs\shell.log`、`dsh-host-<日期>.log` |
| 取证 overlay | `<app>/resources/forensics/cordis.patch.yml`（`SEEU_FORENSICS_PATCH` 可覆盖） |

启动参数对排障有价值：`shell.log` 记录外壳事件与路径；`dsh-host-*.log` 是 dsh 子进程的完整 stdout/stderr（含拼装后的命令行、profile 解析告警、崩溃栈）。故障页上的「打开日志」直接打开该目录。

## 5. 设计要点与约束

1. **Electron 必须精确 44.7.0。** dsh 的 `node-addon-require-builtin` 只认有限几个 Electron 的 V8 运行时指纹（43.0.0 / 44.0.0 / 44.7.0 / 45.0.0-alpha.6）。用 44.11.0 会得到：
   `unsupported Electron runtime fingerprint: Node 24.22.2, V8 15.2.124.45-electron.0`。
   因此 `package.json` 里 `electron` 是**无 `^` 的精确版本**，请勿随手升级。
2. **子进程用 Electron 自带的 Node 模式跑 dsh**（`ELECTRON_RUN_AS_NODE=1` + `--expose-internals`），所以最终用户不需要另装 Node。`host.ts` 额外做了回退：若指纹不被支持，自动改用系统 `node`（`SEEU_NODE_BINARY` 可指定）重试一次。
3. **launcher 选项要配显式 `--profile`。** `dsh web ...` 这种缩写只在 argv[0] 不以 `-` 开头时才会被展开成 `--profile web`；因此带 `--patch` 时必须写
   `dsh --patch <overlay> --profile web --host 127.0.0.1 --port 0 --no-open`（`--host/--port/--no-open` 透传给 web app），否则会报 `error: --profile <name> is required`。
4. **端口与 token 由 dsh 自己决定**：`--port 0` 让 OS 选空闲端口，就绪行 `dsh web: http://127.0.0.1:<port>/?token=<token>` 从 stdout 解析；窗口只加载这个带 token 的 URL。不监听外网（`--host 127.0.0.1`）。
5. **外壳不注入业务代码**：窗口里就是官方 dsh Web UI。取证定制落在 overlay（prompt/preset/遥测开关）与外壳层（品牌、工作区、日志、权限），因此可以跟随官方运行时升级。
6. **peer 依赖必须显式写进 `dependencies`。** dsh 用 cordis DI，很多 `@deepseek-ai/dsh-*` 只以 `peerDependencies` 声明（如 `@deepseek-ai/cordis-plugin-group`）。electron-builder 只沿 `dependencies`/`optionalDependencies` 收集 node_modules，**忽略 peer**，所以开发态能跑、打包版却报
   `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis-plugin-group'`。本项目把 21 个 peer-only 包（精确版本）写进了根 `package.json`；升级 `@deepseek-ai/dsh` 后必须重跑 `docs/packaging.md` §5.1 的 `330/330` 自检，按缺失清单补齐。
7. **取证工具面只做最小改动。** 工具描述与参数 schema 每轮请求都进 system prompt，是固定开销，但精简不能拿能力换：`preset-standard.plugins` 保留官方 22 项里的 19 项（子代理 / 工作流 / 后台作业 / 定时任务 / 目标 / plan / todo 全部可用），去掉 `tool-web`（不联网）、`tool-plugin-manager`（联网装插件包）、`tool-plugin-market`（插件市场），并把 `tool-fs` 收成只读（`write/edit/applyPatch: false`，写文件走命令行留痕）。估算省下约 5–6k 字符 ≈ 1.5k token / 次请求（估算，非精确计量）。清单与逐项调整方法见 `docs/forensics-profile.md` §1.1。

## 6. 退出与容错

- 关闭窗口 = 隐藏到托盘；真正退出走托盘菜单 / 文件菜单 / `Alt+F4`（`before-quit` → `requestQuit()`）。
- 退出时先向 dsh 子进程发 SIGTERM，5s 内未退则 SIGKILL，保证不残留。
- dsh 未就绪或意外退出 → 故障页展示原因与诊断（`host.ts` 保留最近 64KB stderr），可一键「重试」或打开日志。
- 权限请求全部拒绝；`window.open`/导航到外部 origin 一律交给系统浏览器。

## 7. 已知限制 / 后续 TODO

- **账号登录**：沿用官方账号链路（未在 overlay 中关闭），首次使用需在 Web UI 内登录；离线/内网环境需另行配置模型接入。
- **技能包默认未接入**：`resources/forensics/skills/*` 因 dsh 要求绝对路径而未写入 overlay，接入方式见 `docs/forensics-profile.md` 第 4 节（推荐启动前复制到 `$DSH_HOME/skills/`）。
- **品牌文案**：官方 brand 插件（`ui-brand-official`）已在 overlay 里 `disabled: true`，改由 `plugins/seeu-theme/` 注册侧栏与欢迎页品牌（「SeeU 取证」+ 盾牌/放大镜图标），并在客户端加载后用 MutationObserver 把页面 `document.title` 改成「SeeU 取证智能体增强版」。仍不可控的只有：首屏 HTML 里的静态 `<title>`（客户端 bundle 加载前短暂显示）、favicon、以及官方会话/设置页内的文案（同 locale 二次注册会抛错，不能覆盖）。外层窗口/任务栏标题由 `page-title-updated` 拦截，始终是 SeeUForensicsAgentPlus。
- **打包体积**：asar 约 168MB（含完整 dsh 运行时与原生依赖）；后续可按需裁剪 test/example 文件与未用到的本地组件（libreoffice/sherpa 等）。
- **更新通道**：未接入，`electron-builder.yml` 里 `publish: null`；要接官方 nightly 通道需另配 feed 与签名（见 `docs/packaging.md`）。

## 8. 案件索引面板（dsh 客户端插件）

火眼（GoldenEyes/GES）本身会产出「全解析结果」（`/case/检材分析数据/**` 下的 `data.csv` / `chat.txt`）。
本工程把「建库 + 手工检索」做成了一个 **dsh 客户端插件**：在 dsh Web UI 里点按钮建库，再用树状导航 + 关键词检索翻库；
后续 dsh 会话也只查这个库，不再调用 `ges.exe`。

### 8.1 在哪里

启动桌面版后，dsh Web UI 里有两处入口（同一个面板）：

- **左侧栏底部的「取证索引」图标**（`sidebar.panellist`）——点开就是检索面板，可与会话并排；
- **设置页 →「取证索引」一节**（`settings.section`）。

### 8.2 怎么用

1. **建库 / 更新**：填案件目录（火眼案件目录，`case-index.db` 会写进其下的 `.seeu-index\`），点【建库 / 更新】。
   进度条实时显示 探测 → 枚举 → 抓取 i/N（百分比、已用时间、预计剩余）→ 校验 → 替换；可取消，失败不会破坏旧库。
   校验（`integrity_check` + 覆盖率 + 基址率）通过后才原子替换，并写 `manifest.json`（指纹/统计/耗时/失败清单）。
2. **扫描已有索引**：面板打开时自动扫描上次用的案件目录（`localStorage.seeu.indexDir`）以及 dsh 工作目录下的 `indexes/`；
   也可手填目录再点【扫描已有索引】。
3. **树状导航**：案件 → 检材 N（**带火眼里的检材名称 / 平台 / 备注**）→ 应用 → 账号 → 类别 → 文件 → 记录 → 引用，每层只显示摘要与计数，逐层点开。
   检材名称来自火眼案件配置 `<案件目录>\<案件名>.gec`（SQLite）的 `evidence` 表，因此界面上叫什么、面板和会话里就叫什么；
4. **关键词检索**：输入后回车（≥3 字符走 FTS5 trigram，1–2 字中文自动退回 `LIKE`），命中行显示 `检材·应用 / 时间 / 片段`；
   点结果可看引用详情（`Goldeneyes://…` 句柄 + 可复制的 `ges read` 核验命令）。
5. **记录 / 实体 / 时间线 / 表**（M2，v0.1.6 起）：
   - **记录**：按检材/应用/类别/关键词/时间过滤浏览原始行（行数、翻页、每条可回查引用）；
   - **实体**：手机号/邮箱/网址/IP/钱包/身份证/车牌/银行卡跨检材聚合（`跨 N 检材` 一目了然），点一行下钻到提及记录；
   - **时间线**：按小时/天/月分桶，看行为节奏；点柱条直接钻到该时段记录；
   - **表**：24 张 typed 投影表（联系人、账号、消息、通话、短信、浏览搜索、Exif、应用、授权、蓝牙、网络流量、健康指标…），横向滚动看全部列。
   引用一律回 `record.id` → `Goldeneyes://` 句柄，typed 表只是派生视图。

> **M2 typed 层（v0.1.6）**：把火眼全解析结果按**真实表头签名**投影成 24 张结构化表（不按 app/category 硬编码），
> 本案实测 370 叶 / 22,777 记录中 21,123 条进入 typed 表（92.7%；CSV 记录 99.7%），并生成 22,772 条 `citation`。
> 详情见 [docs/plan-case-index.md §17](docs/plan-case-index.md)。

### 8.3 它是怎么接进去的

- 插件源码：`plugins/seeu-case-index/`（宿主 `index.js` + 客户端 `client.js` + `package.json`），**不需要 pnpm 安装**。
- 宿主端 `ctx.inject(['webServer'], …)` + `webServer.register({ kind:'prefix', path:'/seeu-index' })` 暴露本地 HTTP 接口：
  `/list`（扫描已有索引）、`/build`（异步建库 + 轮询进度）、`/tree`、`/search`、`/cite`、`/stats`、`/verify`。
  路由只接受 `.seeu-index` 目录下的 `.db`（防任意路径读取），只监听 127.0.0.1。
- 客户端 `client.js` 用 `window.__ModuleLoader__.load({ id: '@seeu/case-index', factory })` 包装，只依赖白名单内的 `react`，
  注册 `settings.section` / `sidebar.panellist` / `main` 三处槽位。
- 注册方式：`resources/forensics/cordis.patch.yml` 末尾一行 `- insert: [{ id: seeu-case-index, name: ../../plugins/seeu-case-index/index.js }]`。
  相对路径以 overlay 文件为基准（`resources/forensics/` = 应用根）：开发态解析到仓库根，打包态解析到 `app.asar` 根，两态同形。
- 打包：`electron-builder.yml` 的 `files` 白名单含 `plugins/**` 与 `tools/ges-index/**`，二者都进 `app.asar`，可被 dsh 直接 ESM import。

### 8.4 命令行等价操作（`tools/ges-index`）

面板背后是同一套模块，命令行也能跑（便于批处理 / 排障）：

```bash
npm run index:build  -- --case-dir "E:\\forensics\\W盘_2919d298-…"   # 建库（本案 370 叶约 4–6 分钟，DB 约 53 MiB）
npm run index:list   -- "E:\\forensics"                             # 扫描某个父目录下所有案件索引
npm run index:tree   -- --db "<案件目录>\\.seeu-index\\case-index.db" "ev:3"
npm run index:search -- --db "…\\case-index.db" -q 加密
npm run index:verify -- --db "…\\case-index.db" --sample 20          # 随机回火眼核对正文与基址
```

- 检材清单：`node tools/ges-index/cli.mjs ev --db "…\case-index.db"` → `{evidences:[{eid,name,holder,platform,remark,...}]}`；
  同 `npm run index:ev -- --db "…"`（会话里对应 `GET $SEEU_INDEX_API/evidences`）。
- 只读火眼：仅调用 `case ls / case open / status / glob / read`；唯一写入是 `<案件目录>\.seeu-index\`。
- 本案实测：370/370 叶、22,777 条记录、1,594 条消息、8,185 个实体、0 失败、建库 242–329 s、引用回查 20/20 一致。
- 设计、schema、里程碑与实测明细见 `docs/plan-case-index.md`；工具用法见 `tools/ges-index/README.md`。
- 已知限制：建库需要本机有火眼（`ges.exe`，可用 `SEEU_GES_EXE` 指定）且案件已打开；会话内自动查库（M3 技能）尚未接入，当前先用面板检索。

### 8.5 会话内查库（M3，无需生成 runtime patch）

面板是给人用的；**会话里的模型也能直接查同一个库**，靠的是三件事：

1. **外壳先挑好端口再启动 dsh**：过去用 `--port 0` 让 dsh 自己选端口，外壳拿不到端口号，也就没法告诉后面启动的工具。
   现在外壳用 `node:net` 先探一个空闲端口，再 `--port <p>` 传给 dsh，同时把
   `SEEU_INDEX_API=http://127.0.0.1:<p>/seeu-index` 放进 dsh 子进程的环境变量（bash / pwsh 工具会继承）。
2. **技能装进 dsh 的默认技能根**：启动时外壳把随包的 `resources/forensics/skills/**` 复制到
   `%APPDATA%\SeeUForensicsAgentPlus\dsh-home\skills\`（带 `version:文件名:大小` 指纹，内容没变就跳过）。
   这个目录本来就是 dsh 的默认发现根（`user-dsh`，见 `dsh-skill-filesystem` 的 `roots()`），因此**不需要 customSkillDirs，也不需要外壳生成 runtime patch**。
3. **`ges-case-index` 技能**（约 90 行）教模型用 `curl -G "$SEEU_INDEX_API/tree|search|cite|stats|verify" --data-urlencode "db=$DB"` 查库，
   并约定：先树后搜、`truncated` 用 `next` 翻页、`citable=0` 的内容不得当证据引用、库太旧看 `builtAt` 提醒更新。

为什么不走「外壳生成带绝对路径的 patch」：`customSkillDirs` 里的相对路径是相对 **dsh 子进程的 cwd（工作区）** 解析的
（`dsh-skill-filesystem/lib/index.js:78` 的 `resolve(root)`），而绝对路径在「源码运行 / 安装目录 / 便携版 %TEMP% 解包」三种形态下都不同，
patch 又必须在启动前静态写好 —— 所以任何写死绝对路径的方案都会在另一种形态下失效。默认技能根 + 固定端口这条路没有这个耦合。

面板里选过的案件目录会写进 `dsh-home\index-state.json`，外壳下次启动自动把它拼进 `SEEU_INDEX_SEARCH_DIRS`，
所以**第二次开应用就能直接看到上次的库**，不用再选目录。

### 8.6 跨案碰撞（M5，v0.1.7 起）

面板第 7 个标签「跨案」，把多个案件的索引库汇总到一个**中央库**：

- 位置：`<dsh 工作目录>\indexes\crosscase.db`（外壳注入 `SEEU_CROSS_DB`，可用环境变量覆盖）；
- 同步：每建好一个案件库会自动同步该案；也可以点【同步全部案件】重新扫描 `SEEU_INDEX_SEARCH_DIRS` 下的所有库；
- 能看什么：跨案重合实体 Top（同一手机号 / 邮箱 / URL 出现在 ≥2 个案件）、按实体值查询各案的提及（含 `recordId`、`Goldeneyes://` 句柄、行号、所在检材与应用）；同哈希镜像（`sha256`）能查出现在哪些案件；
- 接口：`GET /seeu-index/cross/{list,entity,top,files,stats}`、`POST /seeu-index/cross/sync`（都不需要 `db` 参数）；CLI 等价命令：

```bash
npm run index:xcase:sync    # 扫描默认目录并同步
npm run index:xcase:stats   # 案件数 / 实体数 / 跨案重合数
npm run index:xcase:top     # 跨 >=2 案的重合实体
npm run index:xcase:list    # 已同步案件清单
node tools/ges-index/cli.mjs xcase entity --value 85254877240
```

注意：跨案结果是**线索级**信息，不是证据引用；写报告时要落到各案自己的 `base_handle`（面板里点提及行可直接取该案引用）。同步语义与排障见 `docs/plan-case-index.md` §18（按案删了重写、不自动清理已移除的案件、SQLITE_BUSY 等待 1–2 秒重试）。

## 9. 本地模型（OpenAI 兼容网关）接入

默认走官方 DeepSeek 账号链路；如果模型跑在本地/内网，只要网关兼容 **OpenAI**（`POST /v1/chat/completions` 支持 SSE 流式、`GET /v1/models`），改一个 JSON 就能接入——不用改代码、不用重打包。

### 9.1 配置

安装版：把 `resources/forensics/local-model.example.json` 复制到 `%APPDATA%\SeeUForensicsAgentPlus\local-model.json`，改 `baseURL` 与 `models[].id`：

```json
{
  "enabled": true,
  "route": "local-openai",
  "displayName": "本地模型（OpenAI 兼容网关）",
  "baseURL": "http://127.0.0.1:8000/v1",
  "apiKey": "local",
  "models": [{ "id": "qwen2.5-32b-instruct", "name": "Qwen2.5 32B（本地）" }],
  "contextWindow": 131072,
  "maxTokens": 8192,
  "useAsDefault": true
}
```

开发预览：`npm run dev:web -- --workspace "<案件目录>" --local-model resources/forensics/local-model.example.json`
临时覆盖：环境变量 `SEEU_LOCAL_MODEL_JSON='<同一段 JSON>'`（优先级最高，自动化测试用这个）。

**设置界面（推荐）**：菜单 `工具 → 本地模型设置…`（托盘菜单里也有）打开一个独立窗口，可以直接填网关地址、模型、上下文窗口，并且：

- 【测试连接与能力自检】由主进程直接请求网关（走 Electron `net`，不受页面 CORS 限制），一次跑三项并逐项给结果：① `GET <baseURL>/models`（地址/鉴权，列出模型 id）；② 一次非流式对话（`max_tokens: 16`，确认模型真能出字）；③ 一次带 `ping_tool` 函数定义的请求（确认网关/模型支持 OpenAI 工具调用——**这项不过，模型在本产品里只能聊天，不能查案件库、不能用技能**）。每项都带耗时；不支持工具的模型会明确提示「只能聊天」；
- 表单每次改动都会在下方实时预览「将要生成的 patch 文本」，保存前就能看到 `retryPolicy`、`session-title-llm` 这些行；
- 【保存并重启】写入 `<userData>\local-model.json` 后自动重启应用，重启后模型选择器里就能看到本地模型。

它写的就是上面那个 JSON 文件，两种方式等价；设置页存在的原因是 dsh 自己的设置页在同一服务行上会被 overlay 覆盖并硬拒。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | `false` 时忽略本配置，回到官方账号链路 |
| `route` | `local-openai` | 路由名，必须小写连字符（dsh 要求，否则 `UNSTORABLE_PROVIDER_ID`） |
| `displayName` | `本地模型（OpenAI 兼容网关）` | 显示在模型选择器里 |
| `baseURL` | `http://127.0.0.1:8000/v1` | 网关根地址（要带 `/v1`，不含 `/chat/completions`） |
| `apiKey` | `local` | 写进 `apiKeyEnv` 指定的环境变量（很多本地网关不校验，但不能为空） |
| `apiKeyEnv` | `SEEU_LOCAL_LLM_API_KEY` | 外壳负责注入，dsh 经 credentials seam 读取 |
| `model` / `models[]` | 必填 | `models` 可写 `{id,name,contextWindow,maxTokens}`；`contextWindow` 个人赛常用 131072（128k），团体赛 262144（256k） |
| `contextWindow` / `maxTokens` | `131072` / `8192` | 生成 patch 时的默认上下文与单次输出上限 |
| `useAsDefault` | `false` | 为 `true` 时覆盖 `agent-default-model`，新会话直接用它 |
| `timeoutMs` / `streamIdleTimeoutMs` | `600000` | 本地模型首 token 可能很慢，默认给 10 分钟 |
| `retryMaxRetries` | `3` | 低并发网关的失败重试次数（dsh 默认 5 次，排队时会放大成 5 次长超时） |
| `titleMaxOutputTokens` / `titleTimeoutMs` | `512` / `20000` | 会话标题生成的输出上限与超时（本地模型不值得给 4096 tokens） |

外壳启动时把它编译成 `<userData>\local-model.patch.yml`，作为**第二个 `--patch`** 传给 dsh（后层覆盖前层，优先级高于取证 overlay 与 profile），并注入 API key；启动日志（`%APPDATA%\SeeUForensicsAgentPlus\logs\shell.log`）会打印 `local-model: …` 摘要，`--dump-config` 能看到 `provider: local-openai`。

生成的行固定：

- `api: openai-completions`（OpenAI 兼容协议）；
- `compat: { supportsUsageInStreaming: false, maxTokensField: max_tokens, supportsStore: false, supportsDeveloperRole: false }`——不带 `stream_options.include_usage`（部分本地网关会 400），用 `max_tokens` 而不是 `max_completion_tokens`，不发 `store` 字段，系统提示走 `system` 角色而不是 OpenAI 新的 `developer` 角色（vLLM/Ollama/LM Studio 一类网关对这几个字段很敏感，最保守的请求体实测只有 `model,messages,stream,max_tokens,tools`）；需要时可在 `local-model.json` 的 `compat` 里逐项覆盖；
- 每个模型 `input: [text]`、`reasoningEfforts: false`（本地模型一般不支持思考档位）；
- `retryPolicy: { mode: normal, maxRetries: 3 }`（覆盖 dsh 默认的 5 次）；
- 顶层 `session-title-llm` 覆盖：`maxOutputTokens: 512, timeoutMs: 20000`（每次新会话多一次标题请求，本地模型要省）。

### 9.2 长上下文与低并发调优

本地模型的上下文窗口大、并发低，因此随包取证 preset 把 `compaction-basic` 的 `headroomTokens` 从官方默认 65536 调到 **32768**：

- 触发阈值 = `min(W × thresholdRatio, W − O − headroomTokens)`。128k 窗口 + 8192 输出时，默认值只能等到 ~57k tokens 才压缩（一半窗口没用上），改后是 ~90k；256k 窗口则按 `0.8 × W` 触发。
- 压缩本身要重算 prefill，本地模型这一步很慢，**压得越晚越省时**；但余量也不能太小，否则压缩时留给摘要输出的空间不够。
- ⚠️ 换用 **< 48k 窗口**的模型（如 32k 的 7B/14B）时，要把 `resources/forensics/cordis.patch.yml` 里 `preset-standard → compaction → compaction-basic` 的 `headroomTokens` 调回 65536 或更小（`W − O − B ≤ 0` 会让该插件报错）。这一行在 preset 内部，**不能用 local-model patch 覆盖**（overlay 只能改顶层行）。
- `tool-result-pruner` 保持官方 8192/4096/1024：本地模型同样吃 token，工具输出超长时截断比留全量更划算。

### 9.3 验证

三个端到端脚本各自起 mock OpenAI 网关 + 真 Electron，用 CDP 操作界面，不需要真实网关：

```bash
node scripts/e2e/local-model-e2e.mjs     # 基础连通：SSE 文本回复
node scripts/e2e/local-tools-e2e.mjs     # 工具调用：SSE 分片 tool_calls → 工具执行 → 回传 → 最终答复
node scripts/e2e/local-retry-e2e.mjs     # 低并发重试：前 2 次 429 → 重试后成功
node scripts/e2e/local-diagnose-check.mjs # 能力自检：支持工具的模型全绿，no-tool 模型工具项标红
```

- 基础连通：`REPORT {"ok":true,"chatCalls":2,"gotReply":true,...,"errors":[]}`
- 工具调用：`REPORT {"ok":true,"chatCalls":3,"gotReply":true,"toolResultSeen":true,"todoCard":true,"firstRequest":{"stream":true,"tools":27,"maxTokensField":"max_tokens","hasStreamOptions":false,"hasStore":false,"keys":"model,messages,stream,max_tokens,tools"},"errors":[]}` —— 27 个工具随请求下发，mock 用 OpenAI 流式规范分片返回 `todo_write` 调用，dsh 执行后把 `role:"tool"` 结果回传（第二轮请求 roles 末尾出现 `tool`），页面出现「任务 1 进行中」与最终答复。
- 低并发重试：`REPORT {"ok":true,"chatCalls":3,"failTimes":2,"retried":true,"gotReply":true,"errors":[]}` —— 429 由 `retryPolicy.maxRetries: 3` 吸收，用户只看到一次正常回复。
- 能力自检：`REPORT {"ok":true,"checks":{"firstOk":true,"toolsRowBad":true,"summaryMentionsChatOnly":true}...}` —— 支持工具的模型三项全绿（模型列表 / 基础对话 / 工具调用），`no-tool-model` 的工具项标红并提示「只能聊天，不能查案件库」。

脚本都会用 `taskkill` 清理 Electron，结束后不留进程。

### 9.4 注意

- **不要在同一行上用 settings 页改**：overlay 优先级更高时 dsh 会硬拒（`Configuration for "<id>" is overridden by a home patch or command-line overlay`）；换模型请改 `local-model.json` 后重启。
- 模型选择器里的「设为默认」在 overlay 场景下会静默失败，默认模型请用 `useAsDefault: true`。
- 网关必须支持流式 SSE；首 token 很慢的本地模型可把 `timeoutMs` 调到 900000。
- **启动会先探测一次网关**（4 秒超时，`GET <baseURL>/models`）：结果写进 `logs\shell.log`（`local model probe: … 可用/不可用`），失败只在加载页提示「本地模型网关暂未连通，先用官方模型启动」，不阻塞启动。启动失败的错误页上有【本地模型设置】按钮，可直接改配置后重试。
- **探测结果在界面上可见**：托盘 tooltip 显示当前模型（`SeeU 取证 · 本地模型 qwen2.5-32b-instruct` / `… · 官方模型`）；菜单 `工具 → 本地模型状态…` 打开对话框（配置路径、探测地址/时间/结果，可点「重新探测」）；设置窗口顶部有「启动探测」行，探测完成会由外壳推送刷新（不需要关窗口重开）；`工具 → 重新探测本地网关` 可手动触发一次。

## 10. 许可与来源

- 外壳代码：MIT。
- `dsh` 运行时：来自 npm `@deepseek-ai/dsh`（DeepSeek AI 开源，MIT）；本仓库不修改其源码，仅通过官方 profile/patch 机制扩展。
- Electron / Electron Builder：MIT。
