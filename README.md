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

本轮已验证产物（**v0.1.3**，Windows x64、Electron 44.7.0、无签名）：

| 产物 | 大小 |
| --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版总计 769 MiB） |
| `release/win-unpacked/resources/app.asar` | 168,376,348 B（330/330 个 `@deepseek-ai` 包齐全） |
| `release/SeeUForensicsAgentPlus-0.1.3-x64.exe`（NSIS 安装包） | 211,854,228 B |
| `release/SeeUForensicsAgentPlus-0.1.3-x64-portable.exe` | 189,442,160 B |

实测冷启动到 dsh UI：目录版 3638 ms；portable 首次 44.4s（先要把 ~800MB 解包到 `%TEMP%`，属于预期）。更细的打包说明见 `docs/packaging.md`。

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
> 历史包袱：v0.1.0 缺 21 个 peer 包（启动即崩），v0.1.1 / v0.1.2 是工具面收窄前的版本，
> 均已作废。**请统一使用 0.1.3 的产物。**

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
│  └─ packaging.md          # 打包说明
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

## 8. 许可与来源

- 外壳代码：MIT。
- `dsh` 运行时：来自 npm `@deepseek-ai/dsh`（DeepSeek AI 开源，MIT）；本仓库不修改其源码，仅通过官方 profile/patch 机制扩展。
- Electron / Electron Builder：MIT。
