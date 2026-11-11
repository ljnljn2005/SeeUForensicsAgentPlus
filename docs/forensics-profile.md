# 取证 profile（Forensics Profile）说明与验证

本文档说明 SeeUForensicsAgentPlus 桌面版如何通过 dsh patch-list overlay 把官方 `web` profile
改造成取证分析形态，并给出可复现的验证命令、实测证据、扩展方法与已知限制。

产物位置：

- `resources/forensics/cordis.patch.yml` — overlay 本体（唯一必需）
- `resources/forensics/skills/` — 3 个取证技能（默认未接入，见第 5 节）
- `resources/forensics/README.md` — 逐行改动说明

运行时基线：`@deepseek-ai/dsh@0.2.2-rc.1`，profile 由 `@deepseek-ai/dsh-base` +
`@deepseek-ai/dsh-web-app` 两个 bundle 叠加而成。

## 1. 工作原理（为什么这样写）

dsh 的组合树由空根依次叠加：bundle patches → profile 自身 `cordis.patch.yml` →
`$DSH_HOME/cordis.patch.yml` → argv 上的每个 `--patch`。后层按**行 id** 覆盖前层：

- `- id: <行id>`：定位已存在的行，覆盖给出的字段；**`config` 是整体替换，不是深合并**，
  所以覆盖某行 config 时必须重写该行的全部 key。
- `disabled: true`：关闭该行。
- `- insert: [...]`：新增行（本 overlay 不使用，保持零 unknown row）。
- 目标行不存在时在 stderr 报 `patch: entry ... not found`，视为配置错误。

两个关键架构事实（决定了本 overlay 的写法）：

1. **web profile 的会话 persona 来自 preset，不是 host 的 `system-prompt` 行。**
   `dsh-web-app` 在 patch 后半段把 agent 层行（`tool-fs`、`tool-bash`、`tool-skill` 等）
   disabled 掉，并新增 `agent-preset-registry`（`default: standard`）与 4 个 preset 行。
   每个会话挂 `preset-standard`，会话 system prompt 由 preset 内的 `persona` 子行生成。
   因此只改 host 的 `system-prompt` 行不会改变会话行为；本 overlay 同时整行覆盖
   `preset-standard` 的 config（`plugins` 列表与官方
   `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 逐项一致，只改 persona 文本、
   `name`、`description`，保留 `id: standard` 与 `order: 1`）。
2. **不能按 id 定位 preset 内的嵌套子行。** patch 的 include-local id 不被推断，所以改
   preset 内的 `persona`/`skill-filesystem` 只能整行替换 `preset-standard` 的 config。

overlay 修改的 6 行：

| 行 id | 改动 | 原因 |
|-------|------|------|
| `otel` | disabled | 共享 OTel 服务，只被两个 telemetry 驱动注入，一并移除出口 |
| `session-telemetry-otel` | disabled | 会话遥测 → OTLP 导出 |
| `desktop-product-telemetry` | disabled | 桌面版产品遥测（desktop 模式默认开启） |
| `product-analytics` | disabled | 客户端产品分析事件 |
| `system-prompt` | 重写 `config.personaPrefix` | 取证 persona（host 层，任务要求） |
| `preset-standard` | 整行重写 `config` | 取证 persona / preset 显示名（会话实际生效处） |

保留未动的账号链路：`llm-deepseek-account`、`deepseek-account`、`credentials`、
`account-controller`、`ui-settings-account`、`settings-controller`。原因：`llm-deepseek-account`
负责 `deepseek-official` 的鉴权、模型目录与准入，`deepseek-account` 负责登录态读取；关闭会
导致无法登录/默认模型不可用。取舍 = 关闭遥测出口、保留登录能力。

工具行没有「重新启用 host 行」：取证需要的 `tool-fs`（`applyPatch: false`）、`tool-fs-search`、
`tool-bash`/`tool-pwsh`（按平台互斥）、`tool-jobs`、`tool-schedule`、`tool-skill` +
`skill-filesystem`、`tool-web`、`present`、delegation 系列都已由 preset 挂载。再启用 host 行会
造成同名插件重复挂载。

## 2. 验证命令

在仓库根目录执行（用探针运行时 + 隔离 `DSH_HOME`，不要用默认 home）：

```bash
cd .probe/dsh-runtime

# 2.1 官方 web 组合基线（行 id / 完整 config 的权威来源；不带 --patch）
DSH_HOME="$(cygpath -w "$PWD/home-profile")" \
  node node_modules/@deepseek-ai/dsh/lib/bin.js --profile web \
  --dump-default-config > /tmp/fp/default.yml 2>/tmp/fp/default.err

# 2.2 叠加取证 overlay 后组合（本次验收命令）
DSH_HOME="$(cygpath -w "$PWD/home-profile")" \
  node node_modules/@deepseek-ai/dsh/lib/bin.js --profile web \
  --patch "D:/Coding/SeeUForensicsAgentPlus/SeeUForensicsAgentPlus-main/resources/forensics/cordis.patch.yml" \
  --dump-config > /tmp/fp/overlay.yml 2>/tmp/fp/overlay.err
echo "exit=$?"
```

桌面版等价命令（外壳负责拼装，路径指向打包后的 overlay）：

```bash
dsh --patch <install-dir>/resources/forensics/cordis.patch.yml --profile web --no-open --port 0
```

> `dsh web ...` 这种缩写只在 argv[0] 不以 `-` 开头时才会被展开成 `--profile web`；
> 带 launcher 选项（`--patch`）时必须显式写 `--profile web`，否则报
> `error: --profile <name> is required`。

注意：

- `--dump-config` 不能与 app 参数（`web --no-open --port 0` 之后的参数）同用；
  `--dump-default-config` 不接受 `--patch`；一次可重复 `--patch` 叠多层。
- dump 里的 `!!js` 表达式**不求值**，按源码文本打印；`--dump-config-schema` 可输出
  overlay 的 JSON Schema（`$defs.patchList`），用于校验语法。

### 2.3 验收检查脚本

```bash
ERR=/tmp/fp/overlay.err; OUT=/tmp/fp/overlay.yml
grep -c "not found" "$ERR"          # 期望 0（unmatched target = 0）
wc -l < "$OUT"                      # 期望 1305（默认为 1243）
grep -c "patched by .*resources.forensics" "$OUT"   # 期望 4 个注释块，覆盖 6 行
grep -A2 "^- id: otel$" "$OUT"                       # 期望 disabled: true
grep -A2 "^- id: desktop-product-telemetry$" "$OUT"  # 期望 disabled: true
sed -n "/^- id: system-prompt$/,+4p" "$OUT"          # 期望 personaPrefix: 你是 SeeUForensicsAgentPlus...
sed -n "/^- id: preset-standard$/,+8p" "$OUT"        # 期望 name: 取证分析（Forensics）
```

## 3. 实测证据（dsh 0.2.2-rc.1，2026-11-11）

**基线**：`--dump-default-config` → 退出码 0、stderr 空、1243 行（196 个顶层 `- id:`）。

**叠加 overlay**：`--dump-config` → 退出码 0、stderr 为空（无 unmatched target / unknown row）、
1305 行（+62 行来自多行 persona 与 preset 的 `name`/`description`）。

dump 注释标注被 overlay 覆盖的行（4 个注释块，覆盖 6 行）：

```
# == @deepseek-ai/dsh-base, patched by D:\...\resources\forensics\cordis.patch.yml     -> otel
# == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app, D:\...\cordis.patch.yml -> system-prompt
# == @deepseek-ai/dsh-web-app, patched by D:\...\resources\forensics\cordis.patch.yml   -> desktop-product-telemetry / product-analytics
# == @deepseek-ai/dsh-web-app, patched by D:\...\resources\forensics\cordis.patch.yml   -> preset-standard
```

关键行片段（`/tmp/fp/overlay.yml`）：

```yaml
# 遥测/分析：4 行全部 disabled
- id: otel
  name: '@deepseek-ai/dsh-otel'
  disabled: true

- id: session-telemetry-otel
  name: '@deepseek-ai/dsh-session-telemetry-otel'
  config: { ... 原 config 保留 ... }
  disabled: true          # dump 中位于 config 之后

- id: desktop-product-telemetry
  name: '@deepseek-ai/dsh-host-product-telemetry-otel'
  disabled: true

- id: product-analytics
  name: '@deepseek-ai/dsh-client-product-analytics'
  disabled: true

# host 层 persona（行 396 起）
- id: system-prompt
  name: '@deepseek-ai/dsh-system-prompt'
  config:
    personaPrefix: >
      你是 SeeUForensicsAgentPlus
      的取证分析助手，服务于电子数据取证与事件响应（DFIR）场景。……

# 会话实际生效的 preset（行 673 起）
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
    name: 取证分析（Forensics）
    description: 只读取证优先、结论必须可追溯到证据与哈希的分析预设；已关闭遥测与产品分析。
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config:
          prefix: >
            你是 SeeUForensicsAgentPlus
            的取证分析助手，……
```

说明：dump 会把多行块标量重新序列化为折叠标量 `>` 并做换行包装，这是 dump 的美化输出；
运行时挂载用的是解析后的 config 值，不是这段文本，prompt 内容不受影响。dump 中的
`agent-preset-registry` 仍是 `default: standard`（未改动，取证形态即默认形态）。

## 4. 如何扩展

1. **加/改一行前先 dump 基线**：在 `--dump-default-config` 输出里 `grep "^- id: <目标>"`，
   确认行 id 存在，并抄全该行的 config（`config` 是整体替换）。
2. **只覆盖必要的字段**：`disabled: true` 最安全；改 config 时把原行所有 key 写全，
   `!!js` 表达式原样保留（否则会丢运行时读取，例如 port、endpoint）。
3. **改工具面**：优先改 `preset-standard.plugins` 里对应子项（如把 `tool-bash` 的 `disabled`
   固定为 false/true），但注意 `plugins` 要与官方 `presets/standard.patch.yml` 同步升级。
   例如要禁用插件市场：把 `tool-plugin-market` 子项的 `disabled: true` 保留（官方已 true），
   要禁用子代理：把 `delegation` group 整组去掉（会改变工具面，需评估）。
4. **改 persona**：同时改 `system-prompt.personaPrefix` 与 `preset-standard` 内 `persona.prefix`
   两处并保持一致（前者是 host 默认，后者是会话实际生效值）。
5. **新增行**（如自定义 preset）必须用官方存在的包名：`- insert: [{ id, name, config }]`；
   未在官方配置出现的行 id / 包名不要编造，否则启动时插件解析失败。
6. **验证**：每次改完重跑第 2 节命令，检查退出码 0、stderr 空、覆盖行数符合预期。
7. **升级 dsh 后回归**：行 id、preset 的 plugins 列表可能随版本变化，先 `--dump-default-config`
   对比差异，再更新 overlay。

## 5. 如何接入技能包

`resources/forensics/skills/` 的 3 个技能（`evidence-chain-report`、
`windows-artifact-triage`、`read-only-evidence-analysis`）是标准目录式技能：
`<root>/<name>/SKILL.md`，frontmatter 必填 `name`（kebab-case）+ `description`，可选
`whenToUse`；`@deepseek-ai/dsh-skill-filesystem` 只扫描 root 下一层，嵌套目录不会自动发现。

**本版本未在 overlay 中接入**，原因：`customSkillDirs` 需要真实绝对路径，而 overlay 在打包后
位于 asar 内，其路径因安装位置而异；把本机绝对路径写进 overlay 会在其他机器上失效，也会让
`--dump-config` 输出不可移植。接入方式（任选其一）：

1. **推荐**：Electron 外壳启动 dsh 前，把 `resources/forensics/skills/*` 复制到
   `$DSH_HOME/skills/`（dsh 默认 skill root，优先级 400，无需改 overlay）。之后每个会话
   都能看到这些技能（`skill-filesystem` 已在 preset 内挂载）。
2. 把技能目录放到用户工作区的 `<projectRoot>/.dsh/skills/` 或 `.agents/skills/`
   （`projectRoot` = 最近含 `.git` 的祖先目录，否则为 cwd）。
3. 有稳定安装路径时，在 `preset-standard` 的 `skill-filesystem` 子项加
   `config.customSkillDirs: [<path>]`，并保留 `includeDefaultRoots` 默认 true。

技能与 preset 的关系：`@deepseek-ai/dsh-skill` 的 registry 分层，host 行与 preset 行都会
贡献 provider；同名技能最近层胜出，所以设备级技能包与用户级技能可以并存。

## 6. 已知局限 / 注意事项

- **登录链路保留**：为了可用性，账号/凭据行未关闭；遥测出口已全部关闭。完全离线部署若只用
  API Key，可按第 4 节关闭账号 UI 行，但必须实测登录与默认模型。
- **品牌展示**：overlay 只能改 preset 的显示名（已改为「取证分析（Forensics）」）；
  `ui-brand-official` 行没有 config，官方品牌的展示文案在客户端包里，需要渲染层/打包层处理，
  不是 overlay 能力。
- **dump ≠ 启动**：`--dump-config` 只验证组合树与 patch 匹配，不加载插件、不求值 `!!js`。
  最终启动由 Electron 外壳做端到端验证；若出现插件解析错误，优先检查 preset 里的包名。
- **覆盖即替换**：`config` 不深合并。漏写 key 会丢默认行为（例如 `system-prompt` 的
  `includeRuntimeContext`），新增 key 前先查包 README 的 config schema。
- **unmatched 不致命**：dump 只在 stderr 警告并继续，退出码仍为 0；所以验收必须显式检查
  stderr 为空，不能只看退出码。
- **`--dump-default-config` 不接受 `--patch`**，且 dump 系列不能与 app 参数同用。
- **执行器环境**：本轮验证在 Windows + MSYS bash + 隔离 `DSH_HOME` 下完成；仓库内没有提交
  dump 产物（属临时文件），复现命令见第 2 节。

## 7. 后续 TODO

1. 外壳启动时同步 `resources/forensics/skills/*` → `$DSH_HOME/skills/`（第 5 节方案 1）。
2. 按需要细粒度裁剪工具面（如关闭插件市场、限定子代理数量/模型），并同步官方 preset 升级。
3. 在渲染层/打包层实现产品品牌文案（overlay 之外）。
4. 如需完全离线模式，评估关闭账号 UI 行并补充登录路径实测。
5. 增加一个「overlay 语法 + 行 id 存在性」的打包前自检脚本（`--dump-config` + stderr 断言）。
