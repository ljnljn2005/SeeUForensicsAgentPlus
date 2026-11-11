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

本轮已验证产物（**v0.1.5**，Windows x64、Electron 44.7.0、无签名）：

| 产物 | 大小 |
| --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版总计 769 MiB） |
| `release/win-unpacked/resources/app.asar` | 168,454,873 B（330/330 个 `@deepseek-ai` 包齐全，含 `plugins/seeu-case-index/**`） |
| `release/SeeUForensicsAgentPlus-0.1.4-x64.exe`（NSIS 安装包） | 211,873,901 B |
| `release/SeeUForensicsAgentPlus-0.1.4-x64-portable.exe` | 189,550,148 B |

实测冷启动到 dsh UI：目录版 4073 ms；portable 首次 36.6s（先要把 ~800MB 解包到 `%TEMP%`，属于预期）。更细的打包说明见 `docs/packaging.md`。

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
- **品牌文案**：Web UI 内的产品名/图标来自官方客户端包（`ui-brand-official` 行无 config），overlay 改不到，需在渲染层做替换。外壳侧已用 `page-title-updated` 拦截，让**窗口/任务栏标题**始终是 SeeUForensicsAgentPlus；但页面 `document.title`（CDP 可见）仍是官方的 `DeepSeek Harness`，且客户端加载后会去掉 URL 中的 `?token=`。
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
3. **树状导航**：案件 → 检材 N → 应用 → 账号 → 类别 → 文件 → 记录 → 引用，每层只显示摘要与计数，逐层点开。
4. **关键词检索**：输入后回车（≥3 字符走 FTS5 trigram，1–2 字中文自动退回 `LIKE`），命中行显示 `检材·应用 / 时间 / 片段`；
   点结果可看引用详情（`Goldeneyes://…` 句柄 + 可复制的 `ges read` 核验命令）。

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

## 9. 许可与来源

- 外壳代码：MIT。
- `dsh` 运行时：来自 npm `@deepseek-ai/dsh`（DeepSeek AI 开源，MIT）；本仓库不修改其源码，仅通过官方 profile/patch 机制扩展。
- Electron / Electron Builder：MIT。
