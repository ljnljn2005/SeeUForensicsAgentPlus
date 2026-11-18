# 架构与开发说明（architecture）

本文件面向开发者：说明 SeeU 取证智能体增强版（SeeUForensicsAgentPlus）是怎么搭起来的、有哪些硬约束、怎么构建与验证。**使用说明见 [README.md](../README.md)**；打包与发布见 [packaging.md](packaging.md)；逐版本变更见 [CHANGELOG.md](../CHANGELOG.md)。

---

## 1. 总体结构

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

- **外壳职责**：窗口、托盘、中文菜单、单实例、权限收紧（全部拒绝）、外链走系统浏览器、加载页/故障页、优雅退出；另外负责索引 API 的端口分配、环境变量注入、插件包/技能安装、MCP 装配。
- **运行时职责**：agent 循环、模型接入、工具（文件/搜索/shell/技能/session 等）、会话存储、Web UI。
- **视觉层**：`plugins/seeu-theme/` 是 dsh 客户端插件 + 宿主样式注入——取证深色主题（青蓝强调色、中文字体栈）、侧栏/欢迎页品牌、页面标题替换、欢迎页快捷入口与状态芯片；同时关闭官方 brand 插件避免双份。
- **取证职责**：`resources/forensics/cordis.patch.yml` 以 dsh 官方 patch-list 机制叠加在 `web` profile 之上——关闭遥测/产品分析行，注入专家 persona 与会话预设，收紧工具面（见 §5）。详见 [forensics-profile.md](forensics-profile.md)。

## 2. 目录结构

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
│  ├─ error.html       # 故障页：错误摘要 + 诊断 + 重试/打开日志/打开工作区/退出
│  ├─ local-model.html # 设置窗口：本地模型 / 外部工具路径 / 运行环境体检
│  ├─ mounts.html      # 镜像挂载窗口
│  └─ skills.html      # 技能管理器
├─ resources/forensics/
│  ├─ cordis.patch.yml # 取证 overlay（核心配置产物）
│  ├─ local-model.example.json
│  ├─ skills/          # 通用随包技能
│  └─ skill-sets/      # 按预设分组的技能（traffic / log / memory / qiko）
├─ plugins/
│  ├─ seeu-theme/      # 品牌/主题/欢迎页 dsh 客户端插件
│  └─ seeu-case-index/ # 案件索引面板（宿主路由 + 客户端 UI + MYOS 导入）
├─ tools/
│  ├─ ges-index/       # 火眼全解析结果 → SQLite 索引（建库/查询/CSV/跨案/体检/活动）
│  ├─ myos-index/      # MYOS MCP 客户端 + 结果导入器
│  ├─ seeu-mcp/        # 内置只读 MCP 服务端（stdio）
│  ├─ image-mount.mjs  # LovelyCarve 镜像挂载
│  ├─ tool-paths.mjs   # 外部工具路径解析（设置 → PATH → 默认）
│  ├─ dsh-plugins.mjs  # 随包 dsh 插件 bundles/包复制
│  ├─ skill-sets.mjs   # 分组技能安装与裁剪
│  └─ env-report.mjs   # 运行环境体检
├─ scripts/            # 构建、验证、e2e、基准
├─ build/              # 图标与生成脚本
├─ docs/               # 开发与验收文档
├─ electron-builder.yml
└─ package.json
```

## 3. 运行时位置与排障

| 内容 | 路径 |
| --- | --- |
| 用户数据 / dsh HOME | `%APPDATA%\SeeUForensicsAgentPlus\dsh-home`（`SEEU_DSH_HOME` 可覆盖） |
| 取证工作区（dsh 子进程 cwd） | `%USERPROFILE%\Documents\SeeUForensicsWorkspace`（`SEEU_WORKSPACE` 可覆盖） |
| 日志 | `%APPDATA%\SeeUForensicsAgentPlus\logs\shell.log`、`dsh-host-<日期>.log` |
| 取证 overlay | `<app>/resources/forensics/cordis.patch.yml`（`SEEU_FORENSICS_PATCH` 可覆盖） |

`shell.log` 记录外壳事件与路径；`dsh-host-*.log` 是 dsh 子进程的完整 stdout/stderr（含拼装后的命令行、profile 解析告警、崩溃栈）。故障页上的「打开日志」直接打开该目录。

## 4. 硬约束（改代码前必读）

1. **Electron 必须精确 44.7.0。** dsh 的 `node-addon-require-builtin` 只认有限几个 Electron 的 V8 运行时指纹（43.0.0 / 44.0.0 / 44.7.0 / 45.0.0-alpha.6）。用 44.11.0 会得到：
   `unsupported Electron runtime fingerprint: Node 24.22.2, V8 15.2.124.45-electron.0`。
   因此 `package.json` 里 `electron` 是**无 `^` 的精确版本**，请勿随手升级。
2. **子进程用 Electron 自带的 Node 模式跑 dsh**（`ELECTRON_RUN_AS_NODE=1` + `--expose-internals`），所以最终用户不需要另装 Node。`host.ts` 额外做了回退：若指纹不被支持，自动改用系统 `node`（`SEEU_NODE_BINARY` 可指定）重试一次。
3. **launcher 选项要配显式 `--profile`。** `dsh web ...` 这种缩写只在 argv[0] 不以 `-` 开头时才会被展开成 `--profile web`；带 `--patch` 时必须写
   `dsh --patch <overlay> --profile web --host 127.0.0.1 --port 0 --no-open`，否则报 `error: --profile <name> is required`。
4. **端口与 token 由外壳接管**：外壳先用 `node:net` 探空闲端口，再 `--port <p>` 传给 dsh；就绪行 `dsh web: http://127.0.0.1:<port>/?token=<token>` 从 stdout 解析；窗口只加载带 token 的 URL，不监听外网。
5. **外壳不注入业务代码**：窗口里就是官方 dsh Web UI，取证定制落在 overlay 与外壳层，因此可以跟随官方运行时升级。
6. **peer 依赖必须显式写进 `dependencies`。** dsh 很多 `@deepseek-ai/dsh-*` 只以 `peerDependencies` 声明；electron-builder 只沿 `dependencies`/`optionalDependencies` 收集 node_modules，**忽略 peer**，导致开发态能跑、打包版 `ERR_MODULE_NOT_FOUND`。本项目把 21 个 peer-only 包（精确版本）写进根 `package.json`；升级 dsh 后必须重跑 `docs/packaging.md` §5.1 的自检。
7. **随包 dsh 插件**：`resolveBundleDir()` 只用 bundles 定位 patch；插件行由 loader 以 profile 目录为 baseUrl 做 ESM 导入，所以插件包还必须在 `<profile>/node_modules` 里，否则 `ERR_MODULE_NOT_FOUND`、整批插件不激活。`tools/dsh-plugins.mjs` 负责补 bundles + 复制依赖闭包（逐文件 read/write，因为打包态源在 `app.asar`）。
8. **打包白名单**：插件静态 import 的 `tools/**` 模块、`tools/seeu-mcp/**` 必须在 `electron-builder.yml` 的 `files` 与 `asarUnpack` 两处都声明，否则打包后 ESM 解析失败。
9. **脚本目录不进包**：`scripts/**` 不随包；需要随包的脚本放 `tools/**`。

## 5. 取证工具面

`preset-standard.plugins` 保留官方 22 项里的 19 项（子代理 / 工作流 / 后台作业 / 定时任务 / 目标 / plan / todo 全部可用），去掉 `tool-web`（不联网）、`tool-plugin-manager`（联网装插件包）、`tool-plugin-market`（插件市场），`tool-fs` 收成只读（`write/edit/applyPatch: false`，写文件走命令行留痕）。估算省下约 5–6k 字符 ≈ 1.5k token / 次请求（估算值）。清单与逐项调整方法见 `docs/forensics-profile.md` §1.1。

## 6. 退出与容错

- 关闭窗口 = 隐藏到托盘；真正退出走托盘菜单 / 文件菜单 / `Alt+F4`（`before-quit` → `requestQuit()`）。
- 退出时先向 dsh 子进程发 SIGTERM，5 s 内未退则 SIGKILL，保证不残留。
- dsh 未就绪或意外退出 → 故障页展示原因与诊断（`host.ts` 保留最近 64KB stderr），可一键「重试」或打开日志。
- 权限请求全部拒绝；`window.open` / 导航到外部 origin 一律交给系统浏览器。
- 启动时清理历史 `dsh-auth` cookie（127.0.0.1 不区分端口，攒到 ~70 条会让首页 431）。

## 7. 案件索引面板的实现

- 插件源码：`plugins/seeu-case-index/`（宿主 `index.js` + 客户端 `client.js` + `myos.mjs` + `package.json`），**不需要 pnpm 安装**。
- 宿主端 `ctx.inject(['webServer'], …)` + `webServer.register({ kind:'prefix', path:'/seeu-index' })` 暴露本地 HTTP 接口：
  `/list`、`/build`（异步建库 + 轮询进度）、`/build/cancel`、`/tree`、`/search`、`/cite`、`/stats`、`/verify`、`/activity`、`/chain-check`、`/myos/*` 等；路由只接受 `.seeu-index` 目录下的 `.db`（防任意路径读取），只监听 127.0.0.1。
- 客户端 `client.js` 用 `window.__ModuleLoader__.load({ id: '@seeu/case-index', factory })` 包装，只依赖白名单内的 `react`，注册 `settings.section` / `sidebar.panellist` / `main` 三处槽位。
- 注册方式：`resources/forensics/cordis.patch.yml` 末尾一行 `- insert: [{ id: seeu-case-index, name: ../../plugins/seeu-case-index/index.js }]`。相对路径以 overlay 文件为基准，开发态解析到仓库根、打包态解析到 `app.asar` 根，两态同形。
- 会话内查库：外壳把 `SEEU_INDEX_API=http://127.0.0.1:<p>/seeu-index` 放进 dsh 子进程环境；随包技能 `ges-case-index` 教模型用 `curl` 查库。技能根用 dsh 默认的 `<DSH_HOME>/skills`（启动时复制），不需要 customSkillDirs、也不需要生成 runtime patch。
- 内置 MCP：`tools/seeu-mcp/server.mjs`（stdio JSON-RPC）把同一套 HTTP 接口包成 6 个只读工具（`index_list` / `evidence_list` / `index_search` / `index_tables` / `read_record` / `chain_check`），由 overlay 的全局 `seeu-mcp-tools` 行装配；服务端不读索引文件，只转发 `$SEEU_INDEX_API`。
- 建库（`tools/ges-index/build.mjs`）：先 `ges glob` 枚举 `**/data.csv` 与 `**/chat.txt` 叶子，再逐叶 `ges read` 解析入库；半成品写 `<dir>/.seeu-index/case-index.db.building`，校验通过才原子改名成正式库，旧库留 `.bak`。**并发**：`concurrency` 可配（面板 3/6/8，默认 3，1–8 夹紧）；**断点续跑**：面板在存在 `.building` 时提供【继续上次建库】（`rebuild:false`），命令行对应 `--resume`；**断点续跑守卫**：`--resume` 时若 `ingest_log` 里有不属于当前叶子集的已完成叶子（旧枚举，或案件仍在火眼解析导致叶子数变化）→ 立即 `E_STALE_BUILDING` 并提示 `--rebuild`，避免白跑到校验才失败；校验失败信息区分「失败叶子」与「artifact 残留」。
- 案件概况注入：`plugins/seeu-case-index/index.js` 的 `briefText()` 生成 `<DSH_HOME>/AGENTS.md` 的标记区块（合并式写入，绝不覆盖用户内容）。

## 8. 本地模型的实现

- 配置文件 `%APPDATA%\SeeUForensicsAgentPlus\local-model.json` 由设置页写入（`SEEU_LOCAL_MODEL_JSON` 可临时覆盖）。
- 外壳启动时把它编译成 `<userData>\local-model.patch.yml`，作为**第二个 `--patch`** 传给 dsh（后层覆盖前层，优先级高于取证 overlay 与 profile），并注入 API key。
- 生成的行固定：`api: openai-completions`；`compat: { supportsUsageInStreaming, maxTokensField: max_tokens, supportsStore: false, supportsDeveloperRole: false }`（最保守请求体实测只有 `model,messages,stream,max_tokens,tools`）；每模型 `input:[text]`、`reasoningEfforts:false`；`retryPolicy:{mode:normal,maxRetries}`；顶层 `session-title-llm`；`litePreset` 时追加 `agent-preset-registry` 指向 `seeu-lite`。
- 思考流：provider `compat.thinkingFormat` 与 `compat.chatTemplateKwargs`（`auto` 不写）。
- 长上下文调优：随包 preset 把 `compaction-basic.headroomTokens` 从官方默认 65536 调到 **8192**（=输出上限），使 128k/256k 在 `0.8×W` 触发、32k 也能直接跑；该行嵌在 preset 内部，不能用 local-model patch 覆盖。
- 探测：启动时请求一次 `GET <baseURL>/models`（4 s 超时），记录延迟、按模型 id 推断部署类型（`qwen3.8-flash-next`→Spark 单机、`dsv4.1-flash`/`deepseek-flash`→Spark 双机），失败不阻塞启动。

### 8.1 工具面与固定开销（实测）

| 预设 | 工具数 | 工具描述 | 系统提示 | 首个带工具请求 | 估算 tokens |
| --- | --- | --- | --- | --- | --- |
| 取证分析（Forensics） | 27 | 26,687 字符 | 6,061 字符 | 45,099 字符 | ≈ 20.5k |
| 取证分析（本地模型精简） | 12 | 10,229 字符 | 4,379 字符 | 26,946 字符 | ≈ 12.2k |

换算：32k 窗口用精简预设还剩约 26k tokens 给对话（80%），用完整预设只剩约 18k（55%）。

## 9. 随包 dsh 插件

| 插件 | 作用 | 版本 |
| --- | --- | --- |
| `billion-context` | 长上下文压缩 / `compress`、`decompress`、`search_context`、`acp_status` 等工具 | 0.1.213 |
| `dsh-context` | 会话「上下文洞察」面板 | 0.83.1 |
| `dsh-better-sidebar` | 侧栏、任务卡、插件面板等界面增强 | 0.30.1 |
| `dsh-gitbash-shell` | Windows 上的 `bash` / `gitbash_native` / `gitbash_to_native_path` 工具 | 0.54.0 |

- **写入位置**：`<DSH_HOME>/profiles/web/package.json` 的 `dsh.profile.bundles`。外壳每次 `startHost()` 前补齐缺失项，保留用户自己加的 bundle 与 `dependencies`；清单损坏只报错、不覆盖。`SEEU_DISABLE_DSH_PLUGINS=1` 可跳过。
- **插件包复制**：`ensurePluginPackages()` 把 4 个插件及其非 `@deepseek-ai/*` 依赖闭包复制到 `<DSH_HOME>/profiles/web/node_modules`（实测 175 个包、约 120 MB）；指纹文件 `.seeu-dsh-plugins.json` 记录版本与包名，同版本不重复复制、升级自动重抄并清理旧包。
- **额外解包**：`node_modules/@dsh-ops/fastctx-win32-x64/**` 进 `app.asar.unpacked`（`bin/fastctx.exe` 需要真实路径才能 spawn）。
- **验收**：`npm run test:e2e:plugins` 断言四件事：profile bundles、`<profile>/node_modules` 下四个插件包、页面插件 UI、dsh 子进程日志不得出现 `did not activate` / `failed to import` / `ERR_MODULE_NOT_FOUND`。

## 10. 预设与技能组

- 预设定义在 `resources/forensics/cordis.patch.yml`（12 个，order 1–12）；`preset-standard` 顶层覆盖官方 standard，其余在 `- insert:` 块内。
- 技能目录：通用技能 `resources/forensics/skills/`；分组技能 `resources/forensics/skill-sets/<traffic|log|memory|qiko>/`。外壳启动时复制到 `<DSH_HOME>/skill-sets/<id>`，并把旧的 `lovelymem-cli` / `lovelyspark-cli` 从 `<DSH_HOME>/skills` 移走；`installSkillSet` 会 prune 随包已删除的技能。
- 预设隔离：分析预设各有一个 `skill-filesystem` 实例（`includeDefaultRoots: false`），`customSkillDirs` 指向 `SEEU_SKILL_SET_*`；星睿连接器按预设注入（不是全局）。
- 校验：`npm run check:overlay`（逐预设检查名称/技能根/`customSkillDirs`/`tool-fs` 只读）、`tests/presets-config.test.mjs`、`tests/mcp-config.test.mjs`。

## 11. 外部工具路径

`tools/tool-paths.mjs`：15 项（Ghidra 目录、IDA、tshark/capinfos/editcap、python、jadx、apktool.jar、adb、7-Zip、sqlite3、StarMem、Volatility 目录、雷电模拟器目录、VMware 目录等），每项带 `command`、默认实测路径与 `SEEU_TOOL_<ID>` 环境变量。解析顺序：**设置里显式指定 → PATH 命中 → 本机默认路径**；会话通过 `toolPathsEnv()` 注入实际存在的项。

## 12. 构建与开发命令

```bash
npm install        # 已配 .npmrc（npmmirror + electron 镜像），D 盘约需 1.1G
npm start          # 构建 dist/ 并启动桌面版
```

| 命令 | 说明 |
| --- | --- |
| `npm run build` | esbuild 打包 `src/*.ts` → `dist/`，复制 `renderer/` |
| `npm start` | build + `electron .` |
| `npm test` | 单元测试（`node --test`，本地模型/解析/索引/挂载/MCP 等） |
| `npm run check:overlay` | 离线校验取证 overlay（`--dump-config`），已挂打包前置钩子 |
| `npm run verify` / `verify-launch.mjs` | CDP 启动验证（开发态与打包产物通用） |
| `npm run dev:web` | 开发态 Web 预览（带 mock/真实网关选项） |
| `npm run package:dir` / `package:win` | 目录版 / NSIS + portable |
| `npm run test:e2e:*` | 面板、设置、导出、跨案、挂载、技能、插件、MCP、基准等 e2e（见 `package.json`） |

## 13. 验证与真机联调记录

纯函数用 `node --test` 覆盖；端到端脚本各自起 mock OpenAI 网关 + 真 Electron，用 CDP 操作界面，不需要真实网关：

```bash
node scripts/e2e/local-model-e2e.mjs     # 基础连通：SSE 文本回复
node scripts/e2e/local-tools-e2e.mjs     # 工具调用：SSE 分片 tool_calls → 工具执行 → 回传
node scripts/e2e/local-retry-e2e.mjs     # 低并发重试：前 2 次 429 → 重试后成功
node scripts/e2e/local-diagnose-check.mjs # 能力自检：支持工具的模型全绿
```

接真实网关（凭据只走环境变量，不写进仓库）：

```bash
GW_BASE=http://127.0.0.1:8080/v1 GW_KEY=sk-... GW_MODEL=deepseek-flash \
  npm run test:e2e:real-gateway
```

真机联调结论（`deepseek-flash`，2026-11）：

| 项目 | 实测 | 结论 |
| --- | --- | --- |
| `GET /v1/models` | 200 / 117 ms，返回 2 个模型，无上下文窗口字段 | 拉取列表可用，窗口需手填 |
| 非流式对话 | 200 / 2.6 s | 协议正常 |
| 流式对话 | 首字节 86 ms、约 17 tok/s | SSE 正常，用量字段有效 |
| 推理内容 | 先 `reasoning_content` 后 `content` | 显示为思考块，不是错误 |
| 工具调用 | 流式 1.75 s，支持并行 tool_calls | 可用 |
| 首字延迟 | 桌面 UI 思考块 10.1 s、正文 12.2 s | 主要是模型推理耗时 |

联调还修过一处口径：会话概览「规模」按索引内 `record` 行数统计，火眼原值保留在 `reportedRecordCount`。

## 14. 打包与发布

打包流程、asar 白名单、自检脚本、打包态回归清单见 [packaging.md](packaging.md)；发版与 Release 上传见该文档「发布」一节。
