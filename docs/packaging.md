# SeeUForensicsAgentPlus 打包说明

> 维护者：品牌与打包（brand-pack）。本文覆盖 Windows x64 打包命令、产物结构、
> asar 解包策略、签名/公证/更新通道待办与体积现状。

## 1. 前置环境

| 项 | 要求 | 现状 |
| --- | --- | --- |
| Node.js | `>= 24.9.0`（package.json `engines`），工程为 ESM | v24.18.0 |
| 包管理器 | npm（使用仓库内 `package-lock.json`） | npm 随 Node |
| Electron | `electron ^44.7.0`（devDependency） | 44.x |
| electron-builder | `^26.17.0`（devDependency） | 26.18.0 |
| 图标生成 | Python 3 + Pillow（仅重新生成图标时需要） | 3.13 / Pillow 12.3 |

```bash
npm install        # 只装一次；原生模块全部有预编译产物
```

### 1.1 国内镜像与打包期下载

工程根 `.npmrc` 已配置三个镜像：

```ini
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

- **Electron 二进制**：`npm install` 会经 `electron_mirror` 下载。若安装脚本被
  `--ignore-scripts` 跳过或中断导致 `node_modules/electron/dist/` 为空，需手工补：
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`
  （直接 `node install.js` 时 npm 不会把 `.npmrc` 里的 `electron_mirror` 注入环境，
  必须显式带 env）。装完用 `node_modules/electron/dist/version` 校验版本号。
- **electron-builder 辅助二进制**（只 `package:win` 需要）：`winCodeSign-2.6.0`、
  `nsis-3.0.4.1`、`nsis-resources-3.4.1`，缓存在
  `%LOCALAPPDATA%\electron-builder\Cache\`。镜像可直接访问（302 到
  `cdn.npmmirror.com`，均 200）：winCodeSign 5,635,384B / nsis 1,287,512B /
  nsis-resources 730,800B。缓存已在则不会重复下载。
- **不需要为此关闭的功能**：`win.signAndEditExecutable` 保持默认 `true`
  （否则 exe 的图标/版本资源写不进去）；无证书时 electron-builder 只会打印
  `no code signing certificate configured, signing is skipped`，不会中断。

## 2. 打包命令

```bash
# 构建 dist/（esbuild 打 CJS）+ 生成免安装目录版 release/win-unpacked
npm run package:dir

# 构建 + NSIS 安装包 + portable 单文件
npm run package:win

# 仅构建 dist/（不打包）
npm run build

# 开发态启动（构建后用系统 Electron 直接跑工程目录）
npm start
```

产物命名：`SeeUForensicsAgentPlus-0.1.0-x64.exe`（NSIS）、
`SeeUForensicsAgentPlus-0.1.0-x64-portable.exe`（portable）。

## 3. 品牌图标

图标由 `build/make-icons.py` 用 Pillow 生成，每个尺寸独立渲染（8× 超采样后
LANCZOS 缩放，16/24px 单独加粗描边），不是从 256 缩下来的，避免小尺寸糊成一团。
手工合并成标准 ICONDIR（小尺寸 BMP DIB，256×256 为 PNG）——Pillow 的
`sizes=` 只能缩放单图，会牺牲小尺寸锐度。

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `build/icon.ico` | 16/24/32/48/64/128/256 | 窗口图标、exe 图标、安装包图标 |
| `build/icon.png` | 512×512 | mac/linux 打包（后续平台） |
| `build/tray.ico` | 16/32 | 系统托盘 |

重新生成：

```bash
python build/make-icons.py   # 需要 Pillow；无参，输出到 build/
```

设计：`#0B1220` 深蓝底 + 青色 `#22D3EE` 放大镜环与手柄，镜片内浅色盾牌，
居中留白、无文字。

打包时 `build/` 只有这三个图标被放行（见 `electron-builder.yml` 的 `files`）：
`src/paths.ts` 的 `windowIconPath()` / `trayIconPath()` 读取
`appRoot()/build/icon.ico`、`appRoot()/build/tray.ico`，因此它们在 asar 内必须存在；
`make-icons.py` 与预览图不进包。

## 4. 产物结构（`npm run package:dir`）

`release/` 为 `directories.output`，`--dir` 只产免安装目录版；`package:win` 会额外产出
NSIS 安装包与 portable 单文件。

```text
release/
├─ win-unpacked/                        # 免安装目录版（可直接运行/分发绿色版）
│  ├─ SeeUForensicsAgentPlus.exe        # 主程序（Electron 44.7.0 外壳）
│  ├─ LICENSE.electron.txt
│  ├─ LICENSES.chromium.html
│  ├─ chrome_100_percent.pak
│  ├─ chrome_200_percent.pak
│  ├─ d3dcompiler_47.dll
│  ├─ dxcompiler.dll
│  ├─ dxil.dll
│  ├─ ffmpeg.dll
│  ├─ icudtl.dat
│  ├─ resources.pak
│  ├─ snapshot_blob.bin
│  ├─ v8_context_snapshot.bin
│  ├─ vk_swiftshader.dll
│  ├─ vk_swiftshader_icd.json
│  ├─ vulkan-1.dll
│  ├─ locales/                          # 55 个 Chromium 语言包（*.pak）
│  └─ resources/
│     ├─ app.asar                       # 应用代码与资源（见 §5）
│     └─ app.asar.unpacked/             # 原生模块 + 随包可执行文件（见 §5）
│        └─ node_modules/
│           ├─ @deepseek-ai/            # libreoffice-kit-win32-x64、dsh-session-query-sqlite
│           ├─ @img/                    # sharp-win32-x64
│           ├─ @koromix/                # koffi 平台包
│           ├─ @vscode/                 # ripgrep-win32-x64（rg.exe）
│           ├─ koffi/
│           ├─ node-addon-require-builtin-win32-x64-msvc/
│           ├─ node-pty/                # conpty.node + OpenConsole.exe + conpty.dll
│           └─ sherpa-onnx-win-x64/     # sherpa-onnx.node + onnxruntime*.dll
└─ （package:win 时）SeeUForensicsAgentPlus-0.1.0-x64.exe            # NSIS 安装包
   （package:win 时）SeeUForensicsAgentPlus-0.1.0-x64-portable.exe   # portable 单文件
```

`resources/app.asar` 内（打包白名单实际放行）：

```text
/app.asar
├─ dist/main.cjs、dist/preload.cjs、dist/renderer/{loading,error}.html
├─ build/icon.ico、build/tray.ico、build/icon.png     # src/paths.ts 以 appRoot()/build/ 读取
├─ resources/forensics/cordis.patch.yml               # 取证 profile overlay
├─ resources/forensics/skills/**/SKILL.md             # 取证技能（必须随包）
├─ renderer/**、package.json
└─ node_modules/**（生产依赖；`!node_modules/**/*.md` 只剔除说明文档）
```

asar 内容实测（2026-11-11，Electron 44.7.0 轮，`@electron/asar listPackage`）：

- 命中：`resources/forensics/cordis.patch.yml`、`resources/forensics/README.md`、
  `resources/forensics/skills/{evidence-chain-report,read-only-evidence-analysis,windows-artifact-triage}/SKILL.md`、
  `build/icon.ico`、`build/icon.png`、`build/tray.ico`；
- 未命中（符合预期）：`.probe/`、顶层 `src/`、`scripts/`、`docs/`、
  `build/make-icons.py`。asar 里出现的 `src/|scripts/|docs/` 路径全部位于
  `node_modules/` 内部（第三方包自带），属正常。

`.probe/`、`src/`、`scripts/`、`docs/`、`release/`、`build/make-icons.py`、
`build/*-preview.png` 均不进包（`files` 白名单之外的路径本来就打不进，`!` 是双保险）。
注意 **exclusion 优先于白名单**：不要把排除写成 `!**/*.md`，否则
`resources/forensics/**/SKILL.md` 会被一起剔除，打包版技能会全部失效；因此排除限定为
`!node_modules/**/*.md`。

## 5. asar 与原生模块解包策略

`asar: true`：JS 全部打进 `resources/app.asar`，减少文件数、提升启动 IO。

但 asar 是只读虚拟文件系统，以下两类必须解包到
`resources/app.asar.unpacked/`（`electron-builder.yml` 的 `asarUnpack`）：

1. **`.node` 原生模块**：Node 的 `process.dlopen` 只接受真实文件路径。
   - `**/*.node` 通配兜底；
   - `node-pty`（终端 PTY：`conpty.node`，外加 `prebuilds/win32-x64/conpty/` 下的
     `OpenConsole.exe` / `conpty.dll`，这些东西 `spawn` 时必须真实存在）；
   - `koffi` 及其平台包 `@koromix/koffi-win32-x64`（FFI，调用系统 API）；
   - `sherpa-onnx-win-x64`（语音识别，`.node` + `onnxruntime.dll` 等 4 个 DLL）；
   - `node-addon-require-builtin-win32-x64-msvc`（内置模块加载器）；
   - `@img/sharp-win32-x64`（图像处理，sharp 的 .node）。
2. **随包可执行文件/资源**：
   - `@vscode/ripgrep-win32-x64`（`bin/rg.exe`，全文检索由 dsh 子进程 spawn，
     asar 虚拟路径 `spawn()` 会 ENOENT）；
   - `@deepseek-ai/libreoffice-kit-win32-x64`（`program/` 下的 soffice 及 DLL，
     Office→PDF 转换用 `spawn` 调用，绝对路径不能在 asar 里）；
   - `@deepseek-ai/dsh-session-query-sqlite`（SQLite 会话检索后端，按需解包）。

**为什么必须解包**：Electron 的 asar 兼容层只覆盖 `fs`/`require` 等读取路径；
`child_process.spawn()`、`process.dlopen()` 最终交给操作系统，只认真实文件路径。
因此凡是「被 spawn 的 exe」「.node 原生模块」必须出现在
`resources/app.asar.unpacked/` 下；若代码里用 `__dirname` 拼路径，需要在运行时把
`app.asar` 替换成 `app.asar.unpacked`（或统一走 `process.resourcesPath`）。
打包产物启动验证时若看到 `ENOENT ... app.asar/node_modules/...`，即为此问题，
按缺失包补进 `asarUnpack`。

`npmRebuild: false`：所有原生模块都是 N-API / 预编译产物，打包机不需要
VS Build Tools；若将来引入必须针对 Electron ABI 重编译的模块，改回 `true`。

### 5.1 必须显式声明进 `dependencies` 的 peer 包（打包启动失败的头号原因）

`@deepseek-ai/*` 运行时大量使用 cordis 的 DI：**服务接口包只被声明为
`peerDependencies`**（例如 `@deepseek-ai/dsh-app-boot` 的
`peerDependencies: { "@deepseek-ai/cordis-plugin-group": "~1.1.0" }`）。
npm 7+ 会把 peer 装进 `node_modules`，所以开发态（`electron .` 读完整
`node_modules`）完全正常；但 **electron-builder 只沿
`dependencies`/`optionalDependencies` 收集 node_modules，忽略
`peerDependencies`**，于是这些包不会进 asar，打包后启动直接崩：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/cordis-plugin-group'
  imported from ...\resources\app.asar\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js
```

本仓库因此把 21 个 peer-only 包显式写进根 `package.json` 的 `dependencies`
（版本与 dsh 0.2.2-rc.1 对齐，`cordis-plugin-group` 为 1.1.0）：`cordis-plugin-group`、
`dsh-anonymous-user-id`、`dsh-attachment`、`dsh-bash-local`、`dsh-compaction`、
`dsh-deepseek-account`、`dsh-fs`、`dsh-jobs`、`dsh-llm-deepseek`、`dsh-ptc-runtime`、
`dsh-sandbox`、`dsh-scope`、`dsh-sdk-protocol`、`dsh-session-persistence`、
`dsh-session-query`、`dsh-session-telemetry`、`dsh-session-title-llm`、`dsh-shell`、
`dsh-spill`、`dsh-util-workspace-path`、`dsh-workflow`。

自检方法（应为 `local 330 / asar 330`，差值 0）：

```bash
node -e "const fs=require('node:fs'),a=require('@electron/asar').listPackage('release/win-unpacked/resources/app.asar');
const inAsar=new Set(a.map(p=>p.replace(/\\\\/g,'/')).filter(p=>/^\/node_modules\/@deepseek-ai\/[^\/]+$/.test(p)).map(p=>p.split('/')[3]));
const local=fs.readdirSync('node_modules/@deepseek-ai').filter(n=>fs.existsSync('node_modules/@deepseek-ai/'+n+'/package.json'));
console.log(local.length,inAsar.size,'missing:',local.filter(n=>!inAsar.has(n)).join(','))"
```

注意：在 `files` 里加 `node_modules/@deepseek-ai/*/**` 之类的 glob **无效** ——
electron-builder 会先用依赖图过滤 node_modules，glob 只在过滤结果内生效
（本项目实测仍是 309/330）。升级 `@deepseek-ai/dsh` 后必须重跑上面的自检，
按缺失列表补齐 `dependencies`。

### 5.2 打包前 overlay 校验（`npm run check:overlay`）

`resources/forensics/cordis.patch.yml` 是**运行时才解析**的：YAML 写坏、行 id 写错，
构建阶段不会报错，只会在打包产物的 dsh 子进程里炸成
`failed to parse overlay ... YAMLException` / `patch: entry ... not found`，
外壳只能显示错误页。v0.1.2 就踩过这个坑：打包进程读 overlay 的同时，另一处写入还在改
该文件，结果进了 `app.asar` 的是**半截内容**（asar 里 overlay 字节数相同但 md5 不同，
首行从句子中间开始），启动立刻失败。

现在 `scripts/check-overlay.mjs` 在打包前做一次离线组合校验：

```bash
npm run check:overlay        # 也可单独跑
```

它用随包的 dsh 跑 `--patch <overlay> --profile web --dump-config`（隔离的临时
`DSH_HOME`），校验：退出码 0、stderr 为空、无解析失败/未命中行、dump 行数正常、
preset 里保留必需的 19 行工具、不含 `tool-web`、`tool-fs` 为只读。
已挂到 `prepackage:dir` / `prepackage:win` 钩子，**打包前直接失败，不再产出坏包**。

排查同类问题的两条快查命令：

```bash
# 1) 源文件能否组合
dsh --patch resources/forensics/cordis.patch.yml --profile web --dump-config >/dev/null
# 2) asar 里的副本是否与源文件一致（md5 必须相同）
node -e "require('@electron/asar').extractAll('release/win-unpacked/resources/app.asar','.probe/asar-check')"
md5sum resources/forensics/cordis.patch.yml .probe/asar-check/resources/forensics/cordis.patch.yml
```

另外，**打包期间不要改被 `files` 白名单收进去的文件**（`src/`、`resources/`、`build/`、
`renderer/`、`package.json`）；改 `docs/`、根 README 这类不进包的文件是安全的。

### 5.3 dsh 插件与 `tools/` 白名单（v0.1.4 起）

案件索引面板是**两个 dsh 插件半**（宿主 `plugins/seeu-case-index/index.js` + 客户端 `client.js`），
它们不是从 npm 安装的，而是随包进 asar、由 overlay 的一行 `insert` 直接加载：

```yaml
# resources/forensics/cordis.patch.yml 末尾
- insert:
    - id: seeu-case-index
      name: ../../plugins/seeu-case-index/index.js   # 相对 overlay 文件（= 应用根）
```

因此打包必须满足三件事：

1. **白名单放行**：`electron-builder.yml` 的 `files` 含 `plugins/**` 与 `tools/ges-index/**`
   （插件宿主端 `import '../../tools/ges-index/build.mjs'`，即 `app.asar/tools/...`）。
2. **路径两态同形**：overlay 在开发态是 `<仓库>/resources/forensics/cordis.patch.yml`，
   打包态是 `app.asar/resources/forensics/cordis.patch.yml`；`../../` 都指向应用根，
   所以 `name` 不用改、也不用 pnpm 安装。
3. **不能写目录**：`insert.name` 必须是入口文件。Node ESM 对目录导入报
   `ERR_UNSUPPORTED_DIR_IMPORT`（dsh 只会把路径转成 `pathToFileURL`，不会帮你找 `index.js`）。

自检（打完 `package:dir` 后一行命令确认插件确实在包里）：

```bash
node -e "const a=require('@electron/asar');const l=a.listPackage('release/win-unpacked/resources/app.asar').map(p=>p.replace(/\\\\/g,'/').replace(/^\\/+/,''));console.log(['plugins/seeu-case-index/index.js','plugins/seeu-case-index/client.js','tools/ges-index/build.mjs','tools/ges-index/query.mjs','resources/forensics/cordis.patch.yml'].filter(p=>!l.includes(p)))"
```

输出 `[]` 即齐全（注意 `listPackage()` 返回的路径以反斜杠开头，比较前要先归一化）。

打包态还得验「插件真的被 dsh 加载」：用 CDP 端到端脚本
`.probe/ui-check.mjs`（`SEEU_UI_EXE=<打包 exe>` 切到打包态），
它会断言侧栏出现「取证索引」、面板自动扫描到案件、树能钻到「检材 3」、检索能出结果。
只验进程起来（`verify-launch.mjs`）是不够的——插件加载失败不影响窗口起 UI。


## 6. 体积现状

以 2026-11-11 **v0.1.4** 轮（Electron 44.7.0，工具面 19 项 + 打包前 overlay 校验 + 案件索引插件）为准。
更早的 Electron 44.11.0 首轮产物已作废，不引用其数字。

`npm run package:dir` 产物：

| 产物 | 字节 | 约合 | 说明 |
| --- | --- | --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 | 234.9 MiB | Electron 主程序（含 rcedit 写入的图标/版本资源） |
| `release/win-unpacked/resources/app.asar` | 168,454,873 | 160.7 MiB | JS + 资源 + node_modules 生产依赖 + 索引插件（19,635 个 asar 条目，`@deepseek-ai` 330/330） |
| `release/win-unpacked/`（整个目录） | — | 769 MiB | 含 Electron 运行时、locales、`app.asar.unpacked` 原生模块（`du -sm`） |

`npm run package:win` 额外产出（同一轮）：

| 产物 | 字节 | 约合 | 说明 |
| --- | --- | --- | --- |
| `release/SeeUForensicsAgentPlus-0.1.4-x64.exe` | 211,873,901 | 202.1 MiB | NSIS 安装包（oneClick=false，可选安装目录） |
| `release/SeeUForensicsAgentPlus-0.1.3-x64.exe.blockmap` | 220,782 | 215.6 KiB | 差量更新用 blockmap（后续自动更新通道使用） |
| `release/SeeUForensicsAgentPlus-0.1.4-x64-portable.exe` | 189,550,148 | 180.7 MiB | 免安装单文件（自解压运行） |

即：安装包约 **202 MiB**、portable 约 **181 MiB**，解包目录约 **769 MiB**。

> v0.1.0（缺 21 个 peer 包，启动即崩）、v0.1.1（overlay 是定稿前的工具面）与 v0.1.2
> （工具面还有 21 项，含插件管理/市场）以及 v0.1.3（无索引插件）均已作废，对外只发 v0.1.4；各版本 asar 体积差异
> 来自补包与取证预设内容。

体积构成大头：Electron 运行时本体（exe + DLL/pak/icudtl）、`app.asar` 中
`@deepseek-ai/*` 与 office/语音/终端相关依赖、`app.asar.unpacked` 中
`libreoffice-kit-win32-x64` 等原生/随包二进制。

后续可做的瘦身（尚未实施，避免影响 dsh 运行时探测）：

1. `electronLanguages: [zh-CN, en-US]` 裁掉 53 个 `locales/*.pak`（约省 10 MiB）；
2. 继续收紧 `!node_modules/**` 排除：`test/`、`__tests__/`、`examples/`、
   `*.d.ts`、`docs/`、多平台二进制（`@electron-internal/extract-zip` 等）；
3. `libreoffice-kit` 改为按需下载/可选组件（它是单包最大项）；
4. `asar` 已是未压缩归档，若追求启动 IO 可评估 `compression: maximum`（对
   NSIS 打包时间有影响，对 asar 无影响）。

## 7. 签名 / 公证 / 更新通道（待办）

1. **代码签名（Windows）**：当前无证书，`win.signAndEditExecutable` 保持默认
   `true`（写图标/版本资源），未配置 `certificateFile`/`CSC_LINK` 时不执行签名，
   不会因此中断。发布前需购买 OV/EV 证书或使用 Azure Trusted Signing，
   在 CI 里注入 `CSC_LINK` + `CSC_KEY_PASSWORD`，并开启时间戳
   （`win.signingHashAlgorithms`，或 electron-builder 默认 RFC3161）。
2. **SmartScreen 信誉**：签名后仍需累积下载量；EV 证书可即时通过。
3. **macOS 公证**（后续平台）：`hardenedRuntime` + `entitlements.mac.plist` +
   notarytool，需要 Apple Developer ID。
4. **自动更新**：当前 `publish: null`。建议接入 `electron-updater` +
   generic/GitHub provider，NSIS 差分更新；需要先固定更新源域名与签名校验。
5. **安装包体验**：`oneClick: false`、可选安装目录、`perMachine: false`
   （按用户安装，免 UAC），快捷方式名 `SeeUForensicsAgentPlus`。
6. **打包后的 host 回退路径（重要）**：`src/host.ts` 在 Electron 运行时指纹不被
   `node-addon-require-builtin` 支持时，会用系统 `node` 重试一次。系统 node 不读
   asar，`app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js` 会
   `ERR_MODULE_NOT_FOUND`。对策：固定 Electron 在支持列表内
   （43.0.0 / 44.0.0 / 44.7.0 / 45.0.0-alpha.6，本项目用 44.7.0），回退仅作兜底；
   若要保留回退，回退分支应改指 `app.asar.unpacked` 中的 dsh 副本，或给系统 node
   准备独立的 `node_modules`。
7. **用户配置隔离**：主进程用 `DSH_HOME=%APPDATA%\SeeUForensicsAgentPlus\dsh-home`
   启动 dsh 子进程，不读写用户全局 `~/.dsh`；卸载默认保留该目录
   （`deleteAppDataOnUninstall: false`），便于取证会话留档，清理需手工或后续提供
   卸载选项。

## 8. 启动验证（打包产物自检）

推荐用仓库脚本（清掉 `ELECTRON_RUN_AS_NODE`、通过 CDP 等页面 ready 再退出）：

```bash
# 开发态：构建后由脚本拉起系统 Electron
node scripts/verify-launch.mjs --timeout 180000

# 打包产物：直接拉起 win-unpacked 里的 exe
node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9333
```

通过标准：输出 JSON 含 `"ok": true`，`pages[0].url` 为
`http://127.0.0.1:<port>/?token=...`，`title` 为 `SeeUForensicsAgentPlus`。

记录（2026-11-11，开发态，Electron 44.7.0）：

```json
{ "ok": true, "elapsedMs": 8126, "title": "SeeUForensicsAgentPlus",
  "url": "http://127.0.0.1:53804/?token=WTGLQ-yl6n1OLbputQ8ixuX1znNKlP-hbO-jYGEKzAk" }
```

### 打包产物（`--dir` 版，Electron 44.7.0）

三轮冷启动记录：`4074 / 4164 / 4101 ms`，即**约 4.1s 冷启动到 UI 可达**（含 dsh 子进程就绪）。

最早两轮（页面刚加载时抓取，`title` 仍是窗口标题）：

```json
{ "ok": true, "elapsedMs": 4164,
  "url": "http://127.0.0.1:63130/?token=...",
  "title": "SeeUForensicsAgentPlus" }
```

最终轮（UI 完全稳定后抓取，`?token=` 已被客户端去掉）：

```json
{ "ok": true, "elapsedMs": 4074,
  "url": "http://127.0.0.1:49806/",
  "title": "DeepSeek Harness" }
```

asar 内已确认 overlay 与取证技能随包（见 §4 实测清单）。

### v0.1.3 回归验证（工具面 19 项：再去插件管理/市场，2026-11-11）

从 `preset-standard.plugins` 整条删除 `tool-plugin-manager` / `tool-plugin-market` 后重新打包，
两条记录（跑之前都先 `node scripts/kill-app.mjs`，避免单实例锁把新实例顶成 `exit 0`）：

```json
// --dir 产物（port 9333）
{ "ok": true, "elapsedMs": 3638, "title": "127.0.0.1:50456",
  "url": "http://127.0.0.1:50456/" }
```

```json
// portable（port 9334；44.4s 含首次解包到 %TEMP% 的时间）
{ "ok": true, "elapsedMs": 44376, "title": "SeeUForensicsAgentPlus",
  "url": "http://127.0.0.1:59924/?token=..." }
```

asar 内 overlay 与源文件 `md5` 一致（`6e251bc208536de44994d67a33cb1d0e`，15,291 B），
19,621 个条目、`@deepseek-ai` 330/330，3 个 `SKILL.md`、`build/tray.ico`、`build/icon.ico` 均在包内。

### v0.1.2 回归验证（工具面定稿 + overlay 校验上线，2026-11-11）

工具面改成「官方 22 项保留 21 项、只去 `tool-web`、`tool-fs` 只读」后重新打包的两条记录：

```json
// --dir 产物（port 9333）
{ "ok": true, "elapsedMs": 4144, "title": "SeeUForensicsAgentPlus",
  "url": "http://127.0.0.1:63461/?token=..." }
```

```json
// portable（port 9334；55.7s 含首次把 ~800MB 解包到 %TEMP% 的时间）
{ "ok": true, "elapsedMs": 55651, "title": "DeepSeek Harness",
  "url": "http://127.0.0.1:63847/" }
```

两条都进入了 dsh UI；`title` 差异只取决于抓取时机（页面刚加载 = 窗口标题，UI 稳定后
= 官方客户端 `document.title`），不是崩溃信号。本轮之前那两条超时（180s / 240s）的根因
是 asar 里 overlay 被并发写入截断，详见 §5.2。

### v0.1.1 回归验证（补齐 peer 包之后，2026-11-11）

```json
// --dir 产物（release/win-unpacked/SeeUForensicsAgentPlus.exe，port 9341）
{ "ok": true, "elapsedMs": 3056, "title": "SeeUForensicsAgentPlus",
  "url": "http://127.0.0.1:49687/?token=..." }
```

```json
// portable 单文件（release/SeeUForensicsAgentPlus-0.1.1-x64-portable.exe，port 9343）
{ "ok": true, "elapsedMs": 42489, "title": "SeeUForensicsAgentPlus",
  "url": "http://127.0.0.1:63754/?token=..." }
```

portable 首次 42.5s 属预期：它要先把约 800MB 负载解压到 `%TEMP%\<随机名>`
（目录版 3s 是直接跑已解包目录）。两者都能在 UI 稳定后正常进入 dsh Web UI。

**排障提示（单实例锁）**：若 `verify-launch.mjs` 报
`应用提前退出（exit 0）`，几乎总是因为已有实例在跑（Electron 单实例锁让新进程
直接 quit）。先 `tasklist | grep -i seeu` 清理残留，再重试；脚本现已改为先
`taskkill /PID <pid> /T /F` 再等退出，并在 exit 0 时直接给出该提示。

**已知品牌局限（发布前需知晓）**：上面两条 JSON 恰好体现同一件事——`?token=` 与
`document.title` 在 UI 稳定后都会变：客户端会去掉 URL 里的 token（变为
`http://127.0.0.1:<port>/`），且 `document.title` 实为官方客户端包携带的
`DeepSeek Harness`。`src/main.ts` 已加
`win.on('page-title-updated', e => { e.preventDefault(); win.setTitle(PRODUCT_NAME) })`
锁住 **OS 窗口/任务栏标题**（verify 在页面刚加载时读到的 `title` 就是它）；
但该锁不影响 CDP 里的 `document.title`，界面内部文案与 favicon 仍来自官方客户端包，
`cordis.patch.yml` overlay 改不到 —— 现状是「仅窗口标题可控」，**不是**标题已完全品牌化；
界面内品牌文案要等上游支持或客户端注入方案。打包产物与 dev 态行为一致。

手工等价命令（脚本不可用时）：

```bash
release/win-unpacked/SeeUForensicsAgentPlus.exe --remote-debugging-port=9333 &
sleep 20
curl -s http://127.0.0.1:9333/json/list
taskkill //IM SeeUForensicsAgentPlus.exe //F
```

启动失败时看两处日志：

- `%APPDATA%\SeeUForensicsAgentPlus\logs\shell.log`（主进程外壳日志）
- `%APPDATA%\SeeUForensicsAgentPlus\logs\dsh-host-YYYY-MM-DD.log`（dsh 子进程 stdout/stderr）

### v0.1.4 回归验证（案件索引插件进包，2026-11-11）

与 v0.1.3 相比新增 `plugins/**` 与 `tools/ges-index/**` 进 asar（19,621 → 19,635 条目），并验证插件能在 asar 内被 dsh 加载。

```json
// release/win-unpacked/SeeUForensicsAgentPlus.exe
{ "ok": true, "elapsedMs": 4072, "url": "http://127.0.0.1:50568/", "title": "DeepSeek Harness" }
// release/SeeUForensicsAgentPlus-0.1.4-x64-portable.exe（首次含 ~800MB 解包）
{ "ok": true, "elapsedMs": 43943, "url": "http://127.0.0.1:59037/", "title": "DeepSeek Harness" }
```

面板端到端（打包态，`SEEU_UI_EXE=<exe> node .probe/ui-check.mjs`，CDP 驱动真实 UI）：

```json
{ "sidebar": true, "scanFoundCase": true, "treeRoot": true,
  "drilledApps": true, "searchOk": true, "errors": [] }
```

即：侧栏出现「取证索引」→ 点开自动扫到 `W盘 / 2919d298-…`（52.8 MiB）→ 树根 370 文件 / 22,777 记录 →
钻到「检材 3」拿到 8 个应用 → 检索「加密」走 `LIKE` 回退出 20 条命中。开发态同一脚本结果相同。
