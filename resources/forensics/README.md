# 取证 profile overlay（resources/forensics）

本目录是 SeeUForensicsAgentPlus 桌面版的**取证 profile 产物**：Electron 外壳启动 dsh 时通过
`--patch <本目录>/cordis.patch.yml` 叠加到官方 `web` profile 上，得到「取证分析」形态的
DeepSeek Harness 运行时。

```
resources/forensics/
├── cordis.patch.yml           # 唯一必需产物：dsh patch-list overlay
├── skills/                    # 取证技能包（3 个 SKILL.md，默认不接入，见下文）
│   ├── evidence-chain-report/SKILL.md
│   ├── windows-artifact-triage/SKILL.md
│   └── read-only-evidence-analysis/SKILL.md
└── README.md
```

## 1. overlay 做了什么

dsh 0.2.2-rc.1 的 patch-list 语义：文件是一个 entry 列表，`- id: <行id>` 定位**已存在**的行并
整行覆盖其字段（`config` 整体替换、不是深合并）；`disabled: true` 关闭一行；未匹配到目标行会在
stderr 报 `patch: entry ... not found`。因此本 overlay **不新增行 id**（零 unknown row），只覆盖
官方 bundle patch 里真实存在的 6 个行：

| 行 id | 来源 bundle | 改动 | 原因 |
|-------|-------------|------|------|
| `otel` | `@deepseek-ai/dsh-base` | `disabled: true` | 共享 OTel 服务；只被下面两个 telemetry 驱动注入，两者都关闭后一并移除出口 |
| `session-telemetry-otel` | `@deepseek-ai/dsh-base` | `disabled: true` | 会话遥测（会话记录/反馈 → OTLP）导出，取证场景不得外发 |
| `desktop-product-telemetry` | `@deepseek-ai/dsh-web-app` | `disabled: true` | 桌面版产品遥测，桌面模式默认开启 |
| `product-analytics` | `@deepseek-ai/dsh-web-app` | `disabled: true` | Web 客户端产品分析事件 |
| `system-prompt` | `@deepseek-ai/dsh-base`（被 web-app 覆盖 persona） | 重写 `config.personaPrefix` 为取证顾问设定 | 任务要求的 host 层 persona；原行 config 只有 `personaPrefix` 一个 key，已原样重写 |
| `preset-standard` | `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` | 整行重写 `config`（`plugins` 列表与官方逐项一致），改 `persona` 文本、`name`、`description` | **真正生效**的会话 persona 在 preset 里；patch 无法定位嵌套子行 id，只能整行替换 |

### 为什么必须同时改 `system-prompt` 和 `preset-standard`

web profile 的每个会话都挂一个 agent preset（`agent-preset-registry` 的 `default: standard`），
agent 层工具行（`tool-fs`、`tool-bash`、`tool-skill` 等）在 web bundle 里被 disabled 后移入
preset。会话的 system prompt 由 preset 内的 `persona` 子行生成。只改 host 的 `system-prompt`
行**不会改变会话行为**，所以本 overlay 两处都改，且文本一致。

### 为什么没有「启用工具行」

`tool-fs`、`tool-fs-search`、`tool-bash`、`tool-pwsh`、`tool-jobs`、`tool-schedule`、
`skill-filesystem`、`tool-skill`、`tool-web`、`present`、subagent/delegation 系列在 web profile
里都是在 **preset-standard 的 `plugins` 列表里挂载**的，host 层的同名行被 web bundle disabled
是预期架构。若在 overlay 里重新启用 host 行，会与 preset 内的同名插件重复挂载（同一服务/工具
注册两次），属于错误做法。取证需要的工具已经全部在 preset 内可用：

- `tool-fs`：`applyPatch: false`（官方默认，去掉整体改写文件的能力，降低误操作面）
- `tool-fs-search`：`sampleOverCapGlobResults: false`
- `tool-bash` / `tool-pwsh`：按平台互斥启用（Windows 下启用 pwsh）
- `tool-skill` + `skill-filesystem`：技能加载
- `present`：报告/产物交付
- `tool-web`（fetch + search）、`tool-jobs`、`tool-schedule`、delegation 系列保持官方默认

### 账号/登录相关行为什么保留

`llm-deepseek-account`、`deepseek-account`、`credentials`、`account-controller`、
`ui-settings-account`、`settings-controller` 等行**没有关闭**：

- `llm-deepseek-account` 负责 `deepseek-official` 模型提供方的账号鉴权、模型目录与准入；
- `deepseek-account` 负责登录态/凭据读取，`account-controller`/`ui-settings-account` 是设置页
  面的登录入口。

关闭它们会导致无法登录、默认模型不可用或设置页异常，违背「可用优先」的目标。取舍是：
**不使用遥测/分析出口，但保留登录链路**。遥测关闭后，反馈按钮触发的会话遥测也不会外发
（`session-telemetry-otel` 已 disabled），可在 `docs/forensics-profile.md` 的「已知局限」中查看。
若部署环境完全离线、只需要 API Key 模式，可再按该文档的扩展方法关闭账号 UI 行，但需自行验证登录。

## 2. 验证

```bash
cd .probe/dsh-runtime
DSH_HOME="$(cygpath -w "$PWD/home-profile")" \
  node node_modules/@deepseek-ai/dsh/lib/bin.js --profile web \
  --patch "D:/Coding/SeeUForensicsAgentPlus/SeeUForensicsAgentPlus-main/resources/forensics/cordis.patch.yml" \
  --dump-config > /tmp/fp/overlay.yml 2>/tmp/fp/overlay.err
echo "exit=$?"            # 0
cat /tmp/fp/overlay.err   # 空（无 unmatched target）
wc -l /tmp/fp/overlay.yml # 1305 行（默认 web 组合为 1243 行）
```

实测结果（dsh 0.2.2-rc.1，2026-11-11）：退出码 0、stderr 为空、无 unknown row；dump 注释中
`patched by ...resources/forensics/cordis.patch.yml` 标记覆盖了 `otel`、
`session-telemetry-otel`、`desktop-product-telemetry`、`product-analytics`、`system-prompt`、
`preset-standard` 六行。详细证据与片段见 `docs/forensics-profile.md`。

## 3. 取证技能包（默认未接入）

`skills/` 下 3 个技能使用 dsh 的 filesystem 技能格式（目录式 `<root>/<name>/SKILL.md`，
frontmatter 必填 `name`（kebab-case）与 `description`，可选 `whenToUse`）。当前版本**没有**在
overlay 里设置技能目录，原因：overlay 里不能写本机绝对路径（桌面版 `--patch` 指向打包后的
asar 内文件，路径因机器/安装位置而异），而 dsh 的 `customSkillDirs` 需要真实路径。

后续接入方式（任选其一，详见 `docs/forensics-profile.md`「如何接入技能包」）：

1. 外壳在启动 dsh 前把 `resources/forensics/skills/*` 复制到 `$DSH_HOME/skills/`（dsh 默认
   skill root，优先级 400，无需改 overlay）；
2. 或把技能目录放到用户工作区的 `<projectRoot>/.dsh/skills/` 或 `.agents/skills/`；
3. 或在有稳定安装路径的前提下，在 `preset-standard` 的 `skill-filesystem` 行加
   `config.customSkillDirs: [<绝对路径>]`（不推荐，见上面的路径可移植性问题）。

## 4. 维护

- 行 id 以运行时安装的 `node_modules/@deepseek-ai/dsh-base/cordis.patch.yml` 与
  `@deepseek-ai/dsh-web-app/cordis.patch.yml`（含 `presets/standard.patch.yml`）为准；
  升级 dsh 后先跑 `--dump-default-config` 重新核对行 id 与行的完整 config。
- 覆盖某行 config 时**必须重写该行全部 key**（config 整体替换，不是深合并）。
- 只改 `preset-standard` 时，`plugins` 列表要与官方 `presets/standard.patch.yml` 保持同步，
  避免升级后丢失新插件。
- overlay 语法错误或行 id 不存在会让 stderr 出现 `patch: entry ... not found`，应在打包前
  用 `--dump-config` 卡住。
