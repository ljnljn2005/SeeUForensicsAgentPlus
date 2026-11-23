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
  `resources/forensics/skills/{evidence-chain-report,ges-case-index,lovelycarve-forensics,read-only-evidence-analysis,windows-artifact-triage}/SKILL.md`、
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


### 5.4 技能随包与启动时安装

`resources/forensics/skills/**` 进 asar；应用启动时由 `src/skills.ts` 逐文件复制到 `<userData>\dsh-home\skills\`（dsh 默认技能根，零 patch）。
因此**打包时技能文件不能被白名单/排除规则吃掉**（`!**/*.md` 会连带删 `SKILL.md`，见 §5.1 的教训），且读 asar 内的文件要用 `readFileSync` 而不是 `cpSync`。

验证：启动后看 `logs\shell.log` 的 `skills: N 个（…）→ …\dsh-home\skills` 行，以及该目录下的 `.seeu-skills.json` 指纹。

### 5.5 主题插件与本地模型配置（v0.2.0 起）

**主题插件** `plugins/seeu-theme/`（宿主 `index.js` + `theme.css` + 客户端 `client.js`）与案件索引插件走同一条路：

- `electron-builder.yml` 的 `files` 已含 `plugins/**`，`theme.css` 随之进 asar；
- 宿主 half 用 `readFileSync(new URL('./theme.css', import.meta.url))` 读同包 CSS——asar 兼容层覆盖 `fs.readFileSync`，所以打包态可读；**这也是必须钉 Electron 44.7.0 的又一个理由**（回退系统 node 时 asar 不可读，主题会静默失效）；
- overlay 末尾第二条 insert：`- id: seeu-theme` / `name: ../../plugins/seeu-theme/index.js`；同时 `- id: ui-brand-official` 置 `disabled: true`、`- id: locale` 设 `config.preference: zh`。

自检（打包后，确认主题资产在包里）：

```bash
node -e "const a=require('@electron/asar');const l=a.listPackage('release/win-unpacked/resources/app.asar').map(p=>p.replace(/\\/g,'/').replace(/^\/+/,''));console.log(['plugins/seeu-theme/index.js','plugins/seeu-theme/client.js','plugins/seeu-theme/theme.css'].filter(p=>!l.includes(p)))"
```

输出 `[]` 即齐全；再确认运行时注入成功：打开应用后 CDP 采样应为
`{"title":"SeeU 取证智能体增强版","dark":true,"bgBase":"#0A111E","accent":"#22D3EE","themeStyle":true}`（见 `.probe/shot.mjs`）。

**本地模型**：

- 生成逻辑 `tools/local-model.mjs` 被 `src/local-model.ts` 静态 import，esbuild 已把它内联进 `dist/main.cjs`（`files` 只放行 `dist/**`，所以**不需要**单独放行 `tools/local-model.mjs`）；自检：
  `grep -c "local-model.patch.yml" dist/main.cjs` 应为 `1`。
- 用户配置在 `<userData>\local-model.json`（asar 外，升级/重装后仍在），示例随包放在 `resources/forensics/local-model.example.json`（`resources/**` 白名单已覆盖）。
- 设置窗口 `renderer/local-model.html` 由 `scripts/build.mjs` 复制到 `dist/renderer/`，随 `dist/**` 进 asar；`src/main.ts` 用 `loadFile(join(rendererDir(),'local-model.html'))` 加载，asar 内 `loadFile` 正常。开发/自动化钩子：`SEEU_USER_DATA`（覆盖 userData 根）、`SEEU_OPEN_SETTINGS=1`（启动即打开设置窗口），两者都不影响打包产物默认行为。
- 运行时生成的 `local-model.patch.yml` 也写在 `<userData>`，作为第二个 `--patch` 传给 dsh——不写 asar、不需要重打包即可换网关。

## 6. 体积现状

以 2026-11-11 **v0.2.0** 轮（Electron 44.7.0，工具面 19 项 + 打包前 overlay 校验 + 案件索引插件 + M2 typed 层 + M5 跨案库 + 主题/品牌插件 + 本地模型接入）为准。
更早的 Electron 44.11.0 首轮产物已作废，不引用其数字。

`npm run package:dir` 产物：

| 产物 | 字节 | 约合 | 说明 |
| --- | --- | --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 | 234.9 MiB | Electron 主程序（含 rcedit 写入的图标/版本资源） |
| `release/win-unpacked/resources/app.asar` | 168,656,136 | 160.8 MiB | JS + 资源 + node_modules 生产依赖 + 索引/主题插件 + `tools/ges-index`（19,647 个 asar 条目，`@deepseek-ai` 330/330） |
| `release/win-unpacked/`（整个目录） | — | 769 MiB | 含 Electron 运行时、locales、`app.asar.unpacked` 原生模块（`du -sm`） |

`npm run package:win` 额外产出（同一轮）：

| 产物 | 字节 | 约合 | 说明 |
| --- | --- | --- | --- |
| `release/SeeUForensicsAgentPlus-0.2.0-x64.exe` | 211,911,443 | 202.1 MiB | NSIS 安装包（oneClick=false，可选安装目录） |
| `release/SeeUForensicsAgentPlus-0.2.0-x64.exe.blockmap` | 220,870 | 215.7 KiB | 差量更新用 blockmap（后续自动更新通道使用） |
| `release/SeeUForensicsAgentPlus-0.2.0-x64-portable.exe` | 189,515,660 | 180.7 MiB | 免安装单文件（自解压运行） |

即：安装包约 **202 MiB**、portable 约 **181 MiB**，解包目录约 **769 MiB**。

> v0.1.0（缺 21 个 peer 包，启动即崩）、v0.1.1（overlay 是定稿前的工具面）、v0.1.2
> （工具面还有 21 项，含插件管理/市场）、v0.1.3（无索引插件）、v0.1.4（无 M3 会话查库）、v0.1.5（无 M2 typed 层）、v0.1.6（无 M5 跨案）、v0.1.7（无主题/本地模型）均已作废，对外只发 v0.2.0；各版本 asar 体积差异
> 来自补包与取证预设内容。
>
> 另注：本轮打包时上一版 portable 仍在运行，`release/` 目录被其 exe 占用无法整体删除，
> 因此产物先出到 `release-020/` 再逐个移入 `release/`；`release/SeeUForensicsAgentPlus-0.1.7-x64-portable.exe`
> 是那次遗留（正在运行的进程），0.2.0 三个文件不受影响。

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

### v0.1.5 回归验证（M3：固定端口 + 技能安装）

目录版：

```json
{"ok": true, "elapsedMs": 4073, "url": "http://127.0.0.1:62048/", "title": "DeepSeek Harness"}
```

portable：

```json
{"ok": true, "elapsedMs": 36635, "url": "http://127.0.0.1:64964/", "title": "DeepSeek Harness"}
```

打包态 M3 API + 技能（`SEEU_M3_EXE=release/win-unpacked/... node .probe/m3-check.mjs`）：

```json
{"ok": true, "port": 53313, "apiStatus": 200, "apiIndexes": 1,
 "shellSkillsLine": "skills: 5 个（evidence-chain-report, ges-case-index, lovelycarve-forensics, read-only-evidence-analysis, windows-artifact-triage）→ …\\dsh-home\\skills",
 "marker": {"version": "0.1.5"}}
```

打包态 UI（`SEEU_UI_EXE=<abs> node .probe/ui-check.mjs`）：`sidebar/scanFoundCase/treeRoot/drilledApps/searchOk` 全 true，`errors: []`。

asar 自检：19,637 entries、330/330 `@deepseek-ai` 包、`plugins/seeu-case-index/{index,client}.js`、`tools/ges-index/{build,query}.mjs`、overlay 与 4 个 SKILL.md 齐全；overlay md5 `64cd0e7721d17acea8fbba6fdae8f66b` 与源一致。

### v0.1.6 回归验证（M2 typed 层 + 四视图面板，2026-11-11）

```json
{"ok": true, "elapsedMs": 4100, "url": "http://127.0.0.1:60691/", "title": "DeepSeek Harness"}
```

portable：`{"ok": true, "elapsedMs": 44452, "url": "http://127.0.0.1:49215/"}`（首次 44.5s，含 ~800MB 解包）。

asar 自检（19,638 entries）命中：`plugins/seeu-case-index/{index.js,client.js}`、`tools/ges-index/{typed,query,build}.mjs`、
`resources/forensics/skills/ges-case-index/SKILL.md`（5,803 B，含 `/entity`、`/timeline`），
`tools/ges-index/typed.mjs`（23,674 B，含 `health_metric`）。

打包态 UI 端到端（`SEEU_UI_EXE=release/win-unpacked/SeeUForensicsAgentPlus.exe node .probe/m2-ui-check.mjs`）：
六个标签（树/检索/记录/实体/时间线/表）均渲染真实数据，表视图列出 24 张表（联系人 745、健康指标 6200…），
`m2ok: true`、`errors: []`。

> 注意：MSYS Bash 里给 `SEEU_UI_EXE` 传 `$PWD/...` 会变成 `/d/...` 路径，Node `spawn` 会 ENOENT；
> 必须用带盘符的 Windows 路径（`D:\...\SeeUForensicsAgentPlus.exe`）。

### v0.1.7 回归验证（M5 跨案中央库，2026-11-11）

目录版：`{"ok": true, "elapsedMs": 4071, "url": "http://127.0.0.1:51801/", "title": "DeepSeek Harness"}`

portable：`{"ok": true, "elapsedMs": 42420, "url": "http://127.0.0.1:56068/"}`（首次 42.4s，含 ~800MB 解包）。

asar 自检（19,639 entries）命中：`plugins/seeu-case-index/{index.js,client.js}`、`tools/ges-index/{cross,typed,query,build}.mjs`、
`resources/forensics/skills/ges-case-index/SKILL.md`（7,023 B，含 `/cross/top`）。

面板接口（dev，双案夹具）：`cross/list` → cases 2 / sharedEntities 3999 / images 10；`POST cross/sync` → 200（2 案各 4,407 实体 / 6,526 提及 / 5 镜像）；`cross/top?minCases=2` → 首行 `url https://hk01.app.link/AFu7F8I2MO] 2 案 508 次`；`cross/entity?value=85254877240` → `caseCount 2, hits 12`。

打包态 UI 端到端（`SEEU_UI_EXE=release/win-unpacked/SeeUForensicsAgentPlus.exe node .probe/m5-ui-check.mjs`）：
七个标签（树/检索/记录/实体/时间线/表/跨案）均渲染，跨案页显示 案件 2 / 实体 8814 / 跨案重合实体 3999 / 镜像 10，
同步按钮回「同步完成：扫描索引 2 个，处理 2 案（新增 0、更新 2）」，实体查询显示 `phone 85254877240 跨 2 案 · 2 检材 · 提及 12 次` 与各案 `Goldeneyes://` 句柄；
`m5ok: true`、`errors: []`。

> 测试用的第二案是把真实库复制后改 `meta.case_number` 的夹具（`Documents\SeeUForensicsWorkspace\caseB-test`）；
> 验证完已删除夹具与 `indexes/crosscase.db`，交付版首次使用时重新同步即可。

### v0.2.1 回归验证

产物（Electron 44.7.0、无签名、x64）：

| 产物 | 大小 |
| --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B |
| `release/win-unpacked/resources/app.asar` | 168,708,872 B（19,647 entries） |
| `release/SeeUForensicsAgentPlus-0.2.1-x64.exe` | 211,919,582 B（blockmap 220,872 B） |
| `release/SeeUForensicsAgentPlus-0.2.1-x64-portable.exe` | 189,530,173 B |

asar 自检：14 个必需路径全部命中（`plugins/seeu-theme/*`、`plugins/seeu-case-index/*`、`tools/ges-index/{typed,cross,build}.mjs`、`dist/renderer/{local-model,loading,error}.html`、`resources/forensics/cordis.patch.yml`、`resources/forensics/skills/ges-case-index/SKILL.md`、`resources/forensics/local-model.example.json`）。

启动验证（`SEEU_DEV_MULTI=1` 绕过单实例锁；验收机上有用户正在运行的 0.1.7 portable，所以不能 kill）：

```json
// 目录版：node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9336
{"ok": true, "elapsedMs": 5123, "url": "http://127.0.0.1:60909/?token=…", "title": "SeeUForensicsAgentPlus"}

// portable：--exe release/SeeUForensicsAgentPlus-0.2.1-x64-portable.exe --port 9337
{"ok": true, "elapsedMs": 43481, "url": "http://127.0.0.1:51091/?token=…", "title": "SeeUForensicsAgentPlus"}
```

打包态 UI（`scripts/e2e/m2-ui-check.mjs`，`SEEU_UI_EXE` 指向 win-unpacked exe、`SEEU_NO_KILL=1`）：`m2ok: true`、`errors: []`，七个标签、KPI（W盘 / 5 检材 / 22777 记录 / 8191 实体 / 63.0 MiB）、检材名与备注、检索「加密」20 命中。

打包态设置页（`scripts/e2e/settings-check.mjs --exe <win-unpacked exe>`）：`ok: true`，页面来自 `app.asar/dist/renderer/local-model.html`，`presetApplied: true`（256k → 262144/8192）、`previewWarnings: ["output-window","retries"]`、`copiedDiagnostics: true`、`errors: []`。

> `release/` 里的 0.1.7 portable 删不掉是用户正在运行它（Windows 文件占用），与 0.2.1 产物无关。打包时先用 `-c.directories.output=release-021` 出包，再把文件搬进 `release/`。

### v0.2.2 回归验证

版本 **0.2.2**（`package.json` / `package-lock.json` 顶层与 `packages[""].version` 同步）。产物（无签名、Windows x64、Electron 44.7.0）：

| 产物 | 大小 |
| --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版 766 MiB） |
| `release/win-unpacked/resources/app.asar` | 168,731,959 B（19,647 entries） |
| `release/SeeUForensicsAgentPlus-0.2.2-x64.exe` | 211,923,744 B（blockmap 220,936 B） |
| `release/SeeUForensicsAgentPlus-0.2.2-x64-portable.exe` | 189,545,900 B |

asar 自检（`@electron/asar.listPackage`，14 个必需路径）：`{"entries":19647,"missing":[]}`；另用 `extractFile(asar, 'plugins\\seeu-case-index\\client.js')`（**注意路径要用反斜杠**，`listPackage` 的条目以 `\` 开头、`extractFile` 只认不带前导分隔符的反斜杠写法）读出 89,943 字节，确认含「复制实体清单」「citationListMarkdown」。

启动验证（`SEEU_DEV_MULTI=1`，规避用户正在运行的 0.1.7 实例单实例锁；不跑 `scripts/kill-app.mjs`）：

- 目录版 `node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9349` → `"ok": true, "elapsedMs": 4109`；
- portable `--exe release/SeeUForensicsAgentPlus-0.2.2-x64-portable.exe --port 9350 --timeout 180000` → `"ok": true, "elapsedMs": 39362`。

打包态 UI（`SEEU_UI_EXE` 指向 win-unpacked exe、`SEEU_NO_KILL=1`、独立 `SEEU_DSH_HOME` / `SEEU_USER_DATA`）：

- `scripts/e2e/m2-ui-check.mjs` → `evNames: true`、`evRemark: true`、`searchOk: true`、`m2ok: true`、`errors: []`（本轮修了探针自身：检索框按 placeholder 含「关键词」定位，原先按「最后一个 input」会命中外层筛选框 → 误报 `searchOk:false`）；
- `scripts/e2e/settings-check.mjs --exe <win-unpacked exe>` → `ok: true`，页面来自 `app.asar/dist/renderer/local-model.html`，`presetApplied / previewWarnings ["output-window","retries"] / copiedDiagnostics / 网关自报窗口 32768 / probeMissing ["ghost-7b"] / disableLocalModel 保留字段` 全绿；
- `scripts/e2e/export-check.mjs`（端口 9354）→ `ok: true`，记录清单 14,996 字符 / 实体清单 1,888 字符 / 表清单 7,025 字符，与开发态一致。

> 打包仍先用 `-c.directories.output=release-022` 出到旁路目录，再逐个 `mv` 进 `release/`：用户正在运行 0.1.7 portable，`rm -rf release` 会 `Device or resource busy`。0.2.1 的三个旧文件已删除，0.1.7 portable 保留。

### v0.2.3 回归验证

版本 **0.2.3**（`package.json` / `package-lock.json` 顶层与 `packages[""].version` 同步）。产物（无签名、Windows x64、Electron 44.7.0）：

| 产物 | 大小 |
| --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B |
| `release/win-unpacked/resources/app.asar` | 168,751,123 B（19,647 entries） |
| `release/SeeUForensicsAgentPlus-0.2.3-x64.exe` | 211,926,785 B（blockmap 220,685 B） |
| `release/SeeUForensicsAgentPlus-0.2.3-x64-portable.exe` | 189,518,082 B |
| `release/win-unpacked` 总计 | 803,583,838 B（≈766 MiB） |

打包命令与 0.2.2 相同：`npx electron-builder --win --x64 -c.directories.output=release-023`（用户机上 0.1.7 portable 在运行，不能先 `rm -rf release`），随后把 `win-unpacked`、两个 exe、blockmap 搬进 `release/`、删掉 0.2.2 的三个文件。

asar 自检（`@electron/asar.listPackage`）：19,647 entries，必需路径 14/14 命中（`plugins/seeu-theme/{index,client}.js + theme.css`、`plugins/seeu-case-index/{index,client}.js`、`tools/ges-index/{typed,cross,build}.mjs`、`dist/renderer/{local-model,loading,error}.html`、`resources/forensics/cordis.patch.yml`、`resources/forensics/local-model.example.json`）。**注意 `tools/local-model.mjs` 不在 asar 里是正常的**：它被 esbuild 打进 `dist/main.cjs`（`dist/main.cjs` 内含 `tools/local-model.mjs` 的分节注释），打包运行时不需要这个源文件。

启动验证（`SEEU_DEV_MULTI=1`，不跑 `scripts/kill-app.mjs`，避免杀掉用户正在用的实例）：

- 目录版 `verify-launch --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9355` → `"ok": true, "elapsedMs": 5102`；
- portable `--exe release/SeeUForensicsAgentPlus-0.2.3-x64-portable.exe --port 9356 --timeout 180000` → `"ok": true, "elapsedMs": 37572`。

打包态功能回归（全部用 `SEEU_UI_EXE` + 独立 `SEEU_DSH_HOME` / `SEEU_USER_DATA`）：

- 面板：`node scripts/e2e/m2-ui-check.mjs` → `m2ok:true`、`searchOk:true`、`evNames:true`、`errors:[]`；
- 设置页：`node scripts/e2e/settings-check.mjs --exe "<win-unpacked exe>"` → `ok:true`（页面来自 `app.asar/dist/renderer/local-model.html`，`presetApplied:true`、`budgetText`「固定开销估算：约 6.6k tokens…」、`copiedDiagnostics:true`、网关自报窗口 `32768`、`errors:[]`）；
- 导出：`SEEU_EXPORT_E2E_PORT=9357 node scripts/e2e/export-check.mjs` → `ok:true`（记录 14,996 / 实体 1,888 / 表 7,025 / 时间线 3,235 字符）。

**排障记录**：第一次跑打包态设置页 e2e 报 `preload 桥未暴露 window.seeu.localModel`，但同一 exe 用 CDP 手工探测时 `window.seeu` 的键齐全（`info/onStatus/retry/openLogs/openWorkspace/openLocalModelSettings/quit/writeClipboard/localModel`）。这是上一轮中断的 CDP 会话占着 9351 端口、脚本连到了旧页面导致的**偶发**问题；换干净进程重跑即通过。以后 e2e 失败先看 `/json/list` 里是否有多个 Chromium 残留，再确认不是代码问题。

### v0.2.4 回归验证

产物（`npx electron-builder --win --x64 -c.directories.output=release-024`，无证书跳过签名，产物再搬进 `release/`）：

| 产物 | 大小 |
| --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版总计 803,621,299 B ≈ 766 MiB） |
| `release/win-unpacked/resources/app.asar` | 168,768,410 B（19,647 entries） |
| `release/SeeUForensicsAgentPlus-0.2.4-x64.exe` | 211,929,804 B（blockmap 220,797 B） |
| `release/SeeUForensicsAgentPlus-0.2.4-x64-portable.exe` | 189,498,621 B |

asar 自检（`@electron/asar.listPackage` + `extractFile`，entries 带前导反斜杠要先归一化）：`{"entries":19647,"missing":[]}`，14 个必需路径齐全；`plugins\seeu-case-index\client.js` 107,182 B，含 `evLabel`（检索结果行检材名）与「复制案件概览」；`plugins\seeu-theme\client.js` 含 `data-seeu-local-model`（欢迎页模型 chip）与 `data-seeu-recent`（最近案件 chip）；`dist\renderer\local-model.html` 含 `btn-warmup`（预热）、`renderBudget`（固定开销估算）、`data-preset`（窗口档位）。

启动验证（`SEEU_DEV_MULTI=1`，不跑 `scripts/kill-app.mjs`）：

- 目录版 `verify-launch --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9361` → `"ok": true, "elapsedMs": 4091`；
- portable `--exe release/SeeUForensicsAgentPlus-0.2.4-x64-portable.exe --port 9362 --timeout 180000` → `"ok": true, "elapsedMs": 52547`（机器上同时有 0.1.7 实例在跑，解包更慢）。

打包态功能回归（`SEEU_UI_EXE` + 独立 `SEEU_DSH_HOME` / `SEEU_USER_DATA`）：

- 面板：`m2-ui-check` → `m2ok:true`、`searchOk:true`、`searchEvNames:true`、`evNames:true`、`errors:[]`；
- 设置页：`settings-check.mjs --exe "<win-unpacked exe>"` → `ok:true`（页面来自 `app.asar/dist/renderer/local-model.html`；`presetApplied:true`、`copiedDiagnostics:true`、`pulledContextWindow:"32768"`、`warmupApiOk:true`/`warmupOk:true`、`probeMissing:["ghost-7b"]`、`probeMismatch{configured:131072,gateway:32768}`、`disableLocalModel.enabled:false`、`errors:[]`）；
- 导出：`SEEU_EXPORT_E2E_PORT=9363 export-check.mjs` → `ok:true`（`overviewNote:"已复制案件概览（685 字符，含 5 个检材）"`、`timelineNote:"已复制 86 个时间段的清单（3235 字符）"`、`errors:[]`）。

**注意**：`release/` 里仍保留用户在跑的 `SeeUForensicsAgentPlus-0.1.7-x64-portable.exe`；打包时若 `release/win-unpacked` 被占用会报 `Device or resource busy`，用旁路输出目录（`-c.directories.output=release-024`）再搬。

### v0.2.5 回归验证

产物（`npx electron-builder --win --x64 -c.directories.output=release-025`，无证书跳过签名，产物再搬进 `release/`）：

| 产物 | 大小 |
| --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版总计 803,610,372 B ≈ 766 MiB） |
| `release/win-unpacked/resources/app.asar` | 168,777,657 B（19,647 entries） |
| `release/SeeUForensicsAgentPlus-0.2.5-x64.exe` | 211,931,937 B（blockmap 220,676 B） |
| `release/SeeUForensicsAgentPlus-0.2.5-x64-portable.exe` | 189,540,572 B |

asar 自检（`@electron/asar.listPackage` + `extractFile`）：`{"entries":19647,"missing":[]}`，15 个必需路径齐全；`plugins\seeu-case-index\index.js` 含 `briefState` 与 `/brief` 路由，`plugins\seeu-case-index\client.js` 含「会话语境」「刷新会话概览」「evLabel」；`plugins\seeu-theme\client.js` 含欢迎页两个 chip（`data-seeu-local-model` / `data-seeu-recent`）；`dist\renderer\local-model.html` 含 `btn-warmup`。

启动验证（`SEEU_DEV_MULTI=1`，不跑 `scripts/kill-app.mjs`）：

- 目录版：`node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9371` → `"ok": true, "elapsedMs": 4088`；
- portable：`--exe release/SeeUForensicsAgentPlus-0.2.5-x64-portable.exe --port 9372` → `"ok": true, "elapsedMs": 51586`。

打包态 e2e（`SEEU_UI_EXE` 指向 win-unpacked exe，独立 `SEEU_DSH_HOME`/`SEEU_USER_DATA`）：

- 面板：`node scripts/e2e/m2-ui-check.mjs` → `{"evNames":true,"briefVisible":true,"briefText":"会话语境：已注入 1 个案件概览（含本库） · 05:21:56 · 新会话会自动带上检材清单","briefRefreshOk":true,"searchOk":true,"searchEvNames":true,"m2ok":true,"errors":[]}`——**打包态也确认概览注入可见、可刷新**；
- 设置页：`node scripts/e2e/settings-check.mjs --exe "<win-unpacked exe>"` → `ok:true`（页面来自 `app.asar/dist/renderer/local-model.html`；`presetApplied`、`pulledContextWindow:"32768"`、`warmupOk:true`、`probeMismatch{configured:131072,gateway:32768}`、`probeMissing:["ghost-7b"]`、`disableLocalModel.enabled:false`、`errors:[]`）。

注：`release/` 里仍保留 `SeeUForensicsAgentPlus-0.1.7-x64-portable.exe`（用户机上有旧实例在跑、文件被占用）。

### v0.2.6 回归验证

产物（`npx electron-builder --win --x64 -c.directories.output=release-026`，无证书跳过签名，产物再搬进 `release/`）：

| 产物 | 大小 |
| --- | --- |
| `release/win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版总计 803,628,886 B ≈ 766 MiB） |
| `release/win-unpacked/resources/app.asar` | 168,796,171 B（19,647 entries） |
| `release/SeeUForensicsAgentPlus-0.2.6-x64.exe` | 211,934,094 B（blockmap 220,737 B） |
| `release/SeeUForensicsAgentPlus-0.2.6-x64-portable.exe` | 189,542,424 B |

asar 自检（`.probe/asar-026-check.mjs`：`@electron/asar.listPackage` 条目前导 `\` 归一化 + `extractFile` 用反斜杠）：`{"entries":19647,"missing":[]}`，15 个必需路径齐全；代码抽查全 true（`facets`、实体分页、跨案清单、时间线下拉、`/brief` 状态、树过滤、KPI 时间范围、欢迎页两个 chip、设置页 `btn-warmup`/`titleGen`/`usageInStreaming`）；`client.js` 109,770 B、`index.js` 16,231 B。

启动验证（`SEEU_DEV_MULTI=1`，不跑 `scripts/kill-app.mjs`）：

- 目录版：`node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9391` → `"ok": true, "elapsedMs": 4083`；
- portable：`--exe release/SeeUForensicsAgentPlus-0.2.6-x64-portable.exe --port 9392` → `"ok": true, "elapsedMs": 51560`。

打包态 e2e（`SEEU_UI_EXE` 指向 win-unpacked exe，独立 `SEEU_DSH_HOME`/`SEEU_USER_DATA`）：

- 面板：`m2-ui-check.mjs` → `m2ok:true, errors:[]`，其中 `recordsFilterOk:true`（22,777 → 8,443）、`recordsAppFilterOk:true`（→ 3,028）、`entityPagingOk:true`（共 3,999 条聚合）、`entityEvSelectOk:true`（6 个检材选项）、`timelineFiltersOk:true`（检材 6 / 应用 9 个选项）、`briefVisible:true`、`treeFilterOk:true`、`kpiRange:true`；
- 设置页：`settings-check.mjs --exe "<win-unpacked exe>"` → `ok:true`（页面来自 `app.asar/dist/renderer/local-model.html`；`titleGenDefault/titleGenOffPreview/titleGenSaved`、`usagePreview/usageSaved`、`warmupOk:true`、`pulledContextWindow:"32768"`、`probeMismatch{configured:131072,gateway:32768}`、`probeMissing:["ghost-7b"]`、`lightShell:true`、`errors:[]`）；
- 导出：`SEEU_EXPORT_E2E_PORT=9395 export-check.mjs` → `ok:true`（案件概览 718 字符且 `hasRange:true`、记录 14,996、实体 1,888、表 7,025、时间线 3,235 字符、`savedTab:"timeline"`）；
- 跨案：`SEEU_CROSS_E2E_PORT=9396 cross-case-check.mjs` → `ok:true`（`syncNote:"同步完成：扫描索引 2 个，处理 2 案（新增 0、更新 2）；现共 2 案。"`，两份夹具都在列表里，复制 30 条重合实体清单 2,675 字符、含两个案号与类别）。

排障记录：`SEEU_UI_EXE` 必须传 **Windows 路径**（`D:/.../SeeUForensicsAgentPlus.exe`）；传 MSYS 路径（`$PWD/...` → `/d/...`）会 `spawn ... ENOENT`。打包日志里的 `duplicate dependency references` 巨量列表属正常现象（electron-builder 的依赖去重提示）。

### v0.2.7 回归验证

- 打包：`npm version 0.2.7 --no-git-tag-version`；`node scripts/build.mjs`、`npm run check:overlay`、`npm test`（55/55）全绿；`npx electron-builder --win --x64 -c.directories.output=release-027`（约 14 分钟，无证书跳过签名），产物搬进 `release/` 并删 0.2.6 三件（保留 0.1.7 portable）。
- 产物：`release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B；`resources/app.asar` **168,807,728 B（19,648 entries）**；NSIS **211,936,354 B**（blockmap 220,843 B）；portable **189,590,954 B**；`release/win-unpacked` 总计 803,640,443 B。
- asar 自检（`.probe/asar-027-check.mjs`，`listPackage` 条目前导 `\` 归一化、`extractFile` 用反斜杠无前导分隔符）：条目 19,648、16 个必需路径（多了 `tools/ges-index/csv.mjs`）`missing:[]`；代码抽查 16 项全 true，新增 `csvRecordsRoute`/`csvTableRoute`/`csvSaveIpc`（`dist/preload.cjs` 含 `save-export`）/`recordsCsvButton`/`tableCsvButton`。
- 启动验证（`SEEU_DEV_MULTI=1`，不跑 `scripts/kill-app.mjs`）：目录版 `node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9421` → `"ok":true,"elapsedMs":4150`；portable `--port 9422 --timeout 240000` → `"ok":true,"elapsedMs":47614`。
- 打包态 e2e（都传 Windows 路径给 `SEEU_UI_EXE`，隔离 home/userData）：
  - `m2-ui-check`（端口默认）→ `{"m2ok":true,"searchOk":true,"searchEvNames":true,"recordsFilterOk":true,"entityPagingOk":true,"timelineFiltersOk":true,"briefVisible":true,"treeFilterOk":true,"kpiRange":true,"errors":[]}`；
  - `export-check`（`SEEU_EXPORT_E2E_PORT=9423`，`SEEU_EXPORT_DIR` 默认 `.dev/exports`）→ `{"ok":true,"csvNote":"已导出 20000 行（共 22777 条，单次最多 20000 行）…","csvFile":{"bytes":4608566,"bom":true,"hasHeader":true,"dataLines":20000,"hasTs":true},"csvTableNote":"已导出 745 行到 …","csvTableFile":{"bytes":143621,"bom":true,"hasHeader":true,"dataLines":745},"errors":[]}`（概览 718 / 记录 14,996 / 时间线 3,235 字符不变）；
  - `settings-check` → `{"ok":true,"presetApplied":true,"budgetText":"固定开销估算：约 6.6k tokens…","pulledContextWindow":"32768","warmupOk":true,"titleGenDefault":true,"usagePreview":true,"lightShell":true,"errors":[]}`；
  - `cross-case-check`（`SEEU_CROSS_E2E_PORT=9424`）→ `{"ok":true,"syncNote":"同步完成：扫描索引 2 个，处理 2 案（新增 0、更新 2）；现共 2 案。","copyNote":"已复制 30 条重合实体清单（2675 字符）","clipboard":{"hasTwoCases":true,"hasCaseNumbers":true,"hasKinds":true},"errors":[]}`。
- 预览仍在线（重启后 token 会变），等用户视觉验收 + 真实网关联调。

### v0.2.8 回归验证

- 打包：`npm version 0.2.8 --no-git-tag-version`；`node scripts/build.mjs`、`npm run check:overlay`、`npm test`（80/80）全绿；`npx electron-builder --win --x64 -c.directories.output=release-028`（约 12 分钟，无证书跳过签名），产物搬进 `release/` 并删 0.2.7 三件（保留 0.1.7 portable）。
- 产物：`release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B；`resources/app.asar` **168,818,135 B（19,655 entries）**；NSIS **211,947,042 B**（blockmap 220,668 B）；portable **189,582,714 B**；`release/win-unpacked` 总计 803,669,553 B。
- asar 自检（`.probe/asar-028-check.mjs`）：条目 19,655、必需路径（含 `tools/lovely-cli/cli.mjs`、`discovery.mjs`、两个 `SKILL.md`、`tools/ges-index/csv.mjs`）`missing:[]`；22 项代码抽查全 true，新增 `lovelyCli`/`lovelyDiscovery`/`lovelySkillMem`/`lovelySkillSpark`/`hostLovelyEnv`/`lovelyUnpacked`（`resources/app.asar.unpacked/tools/lovely-cli/*.mjs` 存在）、`reportedRecordCount`、`briefCountNote`、`searchCsvButton`。
- 打包版 lovely CLI 实跑：`node release/win-unpacked/resources/app.asar.unpacked/tools/lovely-cli/cli.mjs status` → `{"lovelymem":{"path":"E:\\CTFTools\\...lovelymem.v3.exe","found":true},"lovelyspark":{"path":"E:\\CTFTools\\...lovelyspark.exe","found":true}}`。
- 启动验证（`SEEU_DEV_MULTI=1`，不跑 `scripts/kill-app.mjs`）：目录版 `node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9441` → `"ok":true,"elapsedMs":5130`；portable `--port 9442 --timeout 240000` → `"ok":true,"elapsedMs":36459`。
- 打包态 e2e（都传 Windows 路径给 `SEEU_UI_EXE`，隔离 home/userData）：
  - `m2-ui-check` → `{"m2ok":true,"searchOk":true,"searchEvNames":true,"recordsFilterOk":true,"recordsAppFilterOk":true,"entityPagingOk":true,"entityEvSelectOk":true,"timelineFiltersOk":true,"briefVisible":true,"treeFilterOk":true,"kpiRange":true,"errors":[]}`；
  - `settings-check --exe "<win-unpacked exe>"` → `{"ok":true,"presetApplied":true,"pulledContextWindow":"32768","warmupOk":true,"titleGenDefault":true,"usagePreview":true,"probeNoContextWindow":false,"probeMismatch":{"configured":131072,"gateway":32768},"probeMissing":["ghost-7b"],"lightShell":true,"errors":[]}`；
  - `export-check`（`SEEU_EXPORT_E2E_PORT=9445`）→ `ok:true`（案件概览 713 字符且 `hasRange:true`、记录 CSV 20,000 行 4,608,566 B BOM true、表 CSV 745 行 143,621 B、记录 14,996 / 实体 1,888 / 时间线 3,235 字符、`savedTab:"timeline"`）；
  - `cross-case-check`（`SEEU_CROSS_E2E_PORT=9446`）→ `ok:true`（`syncNote:"同步完成：扫描索引 2 个，处理 2 案（新增 0、更新 2）；现共 2 案。"`，复制 30 条重合实体清单 2,675 字符、含两个案号与类别）。
- 排障：同 v0.2.7，`SEEU_UI_EXE` 必须 Windows 路径；`release-028` 中间目录在产物搬完后删除。
- 预览仍在线（重启后 token 会变），等用户视觉验收；真实网关（`deepseek-flash`）已联调通过。

### v0.2.9 回归验证

- 打包：`npm version 0.2.9 --no-git-tag-version`；`node scripts/build.mjs`、`npm test`（79/79）全绿；`npx electron-builder --win --x64 -c.directories.output=release-029`（约 12 分钟、无证书跳过签名），产物搬进 `release/` 并删 0.2.8 三件（保留 0.1.7 portable）。
- 产物：`release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B；`resources/app.asar` **168,835,443 B（19,654 entries）**；NSIS **211,947,119 B**（blockmap 220,827 B）；portable **189,553,401 B**；`release/win-unpacked` 总计 803,679,886 B。
- asar 自检（`.probe/asar-029-check.mjs`）：条目 19,654、`missing:[]`；24 项内容检查全 true —— 新增 `lovelyManualOnly`（asar 里没有 discovery、`cli.mjs` 不再 `import ./discovery.mjs`）、`lovelyToolsIpc`（`dist/main.cjs` 含 `seeu:lovely-tools:save`、preload 有 `lovelyTools`）、`settingsLovelyTools`（设置页含「本机取证工具路径」与 `btn-tools-save`）、`lovelyToolsModule`（`dist/main.cjs` 里有 `saveLovelyToolPaths`/`lovelyToolsView`——`tools/lovely-tools.mjs` 被 esbuild 打进主进程，不在 asar 里单列）、`lovelySkipHint`（SKILL.md 含「手动指定」）、`lovelyUnpacked`（unpacked 里有 `cli.mjs`、没有 `discovery.mjs`）。
- 启动验证（`SEEU_DEV_MULTI=1`，不跑 `scripts/kill-app.mjs`）：目录版 `node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9451` → `"ok":true,"elapsedMs":5249`；portable `--port 9452 --timeout 240000` → `"ok":true,"elapsedMs":37389`。
- 打包态 e2e（`SEEU_UI_EXE` 传 Windows 路径，隔离 home/userData）：
  - `m2-ui-check` → `{"m2ok":true,"searchOk":true,"searchEvNames":true,"recordsFilterOk":true,"entityPagingOk":true,"timelineFiltersOk":true,"briefVisible":true,"treeFilterOk":true,"kpiRange":true,"errors":[]}`；
  - `settings-check --exe "<win-unpacked exe>"` → `{"ok":true,"toolsConfigFile":"…\.dev\settings-home\lovely-cli.json","toolsRows":2,"toolsSectionVisible":true,"toolsApiSaved":true,"toolsUiSaved":true,"toolsFileOk":true,"toolsAfterClear":{"lovelyspark":"…fake-lovelyspark.exe"},"toolsClearOk":true,"pulledContextWindow":"32768","warmupOk":true,"titleGenDefault":true,"usagePreview":true,"probeNoContextWindow":false,"lightShell":true,"errors":[]}`；
  - `export-check`（`SEEU_EXPORT_E2E_PORT=9455`）→ `ok:true`（概览 713 字符且 `hasRange:true`、记录 CSV 20,000 行 4,608,566 B BOM true、表 CSV 745 行 143,621 B、记录 14,996 / 实体 1,888 / 时间线 3,235 字符、`savedTab:"timeline"`）；
  - `cross-case-check`（`SEEU_CROSS_E2E_PORT=9456`）→ `ok:true`（`syncNote:"同步完成：扫描索引 2 个，处理 2 案（新增 0、更新 2）；现共 2 案。"`，30 条重合实体清单 2,675 字符、含两个案号）。
- 尝试用 `real-gateway-ui.mjs` 直接跑打包版（临时给脚本加过 `SEEU_UI_EXE` 支持）：页面能起、但打包版首次启动会落在「选择工作区」页，composer 驱动不稳（`stage:"type-failed"`），脚本改动已回滚；真机联调仍以 dev Electron 版脚本（`SEEU_UI_TOOL=1`，`ok:true`）+ headless 版为准。
- 预览仍在线（重启后 token 会变），等用户视觉验收与手动工具路径设置。

### v0.3.1 回归验证

- 版本 0.3.1（`16fa05f` 设置菜单 + 提示词修复；MYOS MCP 行在打包前追加）。
- 产物：`release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B；`resources/app.asar` 169,110,408 B（19,686 entries）；NSIS 212,015,610 B（blockmap 221,605 B）；portable 189,611,751 B；win-unpacked 803,954,851 B。
- asar 自检 `.probe/asar-031-check.mjs`：`{"entries":19686,"missing":[],checks 全 true}`，新增 `settingsMenu`/`settingsMenuVisible`/`heroMountsSkills`/`briefPaths`/`briefNoBrute`/`queryPaths`/`skillCoverage`/`personaNoBrute`/`myosMcpRow`。
- 启动：目录版 `verify-launch --port 9503` → `ok:true, elapsedMs:6889`；portable `--port 9504` → `ok:true, elapsedMs:37851`。
- 打包态 e2e：`hero-check --exe` → `ok:true`，快捷入口 `["index","model","workspace","mounts","skills"]`、设置窗口打开成功；`settings-check --exe` → `ok:true`，`toolsRows:3`、`toolsApiSaved/toolsUiSaved/toolsFileOk/toolsClearOk` 全 true；`m2-ui-check`（`SEEU_UI_EXE`）→ `m2ok:true, errors:[]`。
- 坑：MYOS MCP 行是打包开始后才加的，第一次 0.3.1 产物（13:08 asar）已含该行但 portable 是更早的 13:04 产物；为一致性用 `rm -rf release-031/win-unpacked release-031/*.exe release-031/*.7z` 后整包重建（13:20 asar → 13:21 NSIS → 13:29 portable）。
- 说明：打包态的 MYOS MCP 只验证了「配置已进 asar + 启动不受影响」；真实工具调用在 dev headless 下验证（`toolsCount:75`、`mcpToolCount:49`）。

### v0.3.0 回归验证

- 打包：版本由 Gitea `main` 合并带入 **0.3.0**（`package-lock.json` 同步 0.3.0）；`node scripts/build.mjs`、`npm test`（85/85）、`npm run check:overlay` 全绿；`npx electron-builder --win --x64 -c.directories.output=release-030`（约 13 分钟、无证书跳过签名），产物搬进 `release/` 并删 0.2.9 的 NSIS/blockmap（0.2.9 portable 因正在运行被占用，保留）。
- 本批内容：Gitea `main` 的技能上传/管理器（`117b391`）+ 本仓库的镜像挂载接口（`f56aa57`）。
- 产物：`release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B；`resources/app.asar` **169,101,956 B（19,686 entries）**；NSIS **212,013,664 B**（blockmap 221,709 B）；portable **189,622,254 B**；`release/win-unpacked` 总计 803,946,399 B。
- asar 自检（`.probe/asar-030-check.mjs`）：条目 19,686、`missing:[]`；39 项内容检查全 true —— 新增 `lovelyCarveRow`（设置页第三行 LovelyCarve CLI）、`settingsToolsCount`（三行 `data-tool`）、`mountsHtml`（`dist/renderer/mounts.html` 含「镜像挂载」与 `btnMount`）、`mountsModule`（`dist/main.cjs` 含 `createMountManager`/`SEEU_MOUNTS_FILE`——`tools/image-mount.mjs` 同样被打进主进程）、`mountsIpc`（`seeu:mounts:mount` + preload `mounts`）、`mountsEnv`（`mountHostEnv`/`SEEU_OPEN_MOUNTS`）、`mountsMenu`（`openMountsWindow` + `Ctrl+Shift+M`；中文菜单项在产物里是 `\u` 转义，按函数/快捷键查）、`skillsUpload`、`skillsWindow`（`dist/renderer/skills.html`）。
- 启动验证（`SEEU_DEV_MULTI=1`，不跑 `scripts/kill-app.mjs`）：目录版 `node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9483` → `"ok":true,"elapsedMs":5118`；portable `--port 9484 --timeout 240000` → `"ok":true,"elapsedMs":50535`。
- 打包态 e2e（`SEEU_UI_EXE` 传 Windows 路径，隔离 home/userData）：
  - `m2-ui-check` → `m2ok:true`、`errors:[]`（检索/记录/实体分页/时间线/概览/树过滤/KPI 全绿）；
  - `settings-check --exe "<win-unpacked exe>"` → `ok:true`，页面来自 asar 内 `dist/renderer/local-model.html`，`toolsRows:3`、`toolsApiSaved/toolsUiSaved/toolsFileOk/toolsClearOk` 全 true，`pulledContextWindow:"32768"`、`warmupOk:true`、`titleGenDefault:true`、`usagePreview:true`、`probeNoContextWindow:false`、`probeMismatch":{"configured":131072,"gateway":32768}`、`lightShell:true`、`errors:[]`；
  - `export-check`（`SEEU_EXPORT_E2E_PORT=9495`）→ `ok:true`（概览 713 字符且 `hasRange:true`、记录 CSV 20,000 行 4,608,566 B BOM true、表 CSV 745 行 143,621 B、记录 14,996 / 实体 1,888 / 时间线 3,235 字符、`savedTab:"timeline"`）；
  - `cross-case-check`（`SEEU_CROSS_E2E_PORT=9496`）→ `ok:true`（两案同步、30 条重合实体清单 2,675 字符含两个案号）；
  - `mount-check --exe "<win-unpacked exe>"`（`SEEU_MOUNT_E2E_PORT=9497`，假 CLI）→ `ok:true`：窗口来自 `app.asar/dist/renderer/mounts.html`，`inspect` 2 个分区 → 挂 `X:` → `mounts.json` 1 条 → 页面刷新显示 → 卸载后 0；截图 `.dev/shots/mounts-030.png`；
  - `skills-check --exe "<win-unpacked exe>"`（`SEEU_SKILLS_E2E_PORT=9498`）→ `ok:true`：preload 7 个技能方法齐全，`skillsList()` 返回 7 个随包技能，含 `lovelycarve-forensics`（4 个文件）。
- 排障：打包过程中 `app.asar` 会被 electron-builder 重写，**在 NSIS/portable 阶段读 asar 可能抽到半成品**（`extractFile` 报 `was not found`；等 job 结束即正常）；`SEEU_UI_EXE` 必须 Windows 路径。
- 遗留：真实 LovelyCarve + 真实镜像未跑（本机没装，挂载用假 CLI 验协议层）；打包态真机 UI 回归仍建议用 dev Electron。

### v0.3.2 回归验证

- 版本：`0.3.2`（随包 4 个 dsh 插件 + 流量/日志/内存三预设）。
- 产物（Windows x64、无签名；`npx electron-builder --win --x64 -c.directories.output=release-032b`）：
  - `release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B；目录版总计 **1,109,515,767 B**（≈1.03 GiB）
  - `resources/app.asar` **425,164,539 B（34,094 entries）** —— 随包 billion-context / dsh-context / dsh-better-sidebar / dsh-gitbash-shell 让 asar 从 169MB 涨到 425MB
  - NSIS **281,504,620 B**（blockmap 292,860 B）；portable **236,213,254 B**
- asar 自检 `.probe/asar-032-check.mjs`：**58 项全 true、missing:[]**（含 bundledPlugins、pluginsWriteProfile、pluginsSkipSwitch、analysisPresets、skillSetInstall、hostSkillSetEnv、retiredSkills、fastctxUnpacked、skill-sets 三份 SKILL.md）。
- 启动验证（`SEEU_DEV_MULTI=1`）：目录版 `verify-launch --port 9503` → `ok:true, elapsedMs:6130`；portable `--port 9504` → `ok:true, elapsedMs:49649`。
- 打包态 e2e（`SEEU_UI_EXE` 用 Windows 路径、隔离 home/userData）：
  - `m2-ui-check` → `m2ok:true, errors:[]`
  - `settings-check --exe` → `ok:true`（`toolsRows:3`、`pulledContextWindow:"32768"`、`warmupOk:true`、`probeNoContextWindow:false`、`lightShell:true`、`errors:[]`）
  - `plugins-check --exe` → `ok:true`（bundles 6 项、界面「上下文洞察 / 插件」、日志 `dsh plugins: 已补 …`）
  - `skills-check --exe` → `ok:true`（5 个通用技能；`skill-sets/{traffic,log,memory}` 含 lovelyspark/lovelymem；`leaked:[]`）
- 坑（本轮首次打包后又重打了一次）：
  - overlay 三预设的 `customSkillDirs` 一开始误写成 `process.env.SEU_SKILL_SET_*`（少一个 E），而外壳注入的是 `SEEU_SKILL_SET_*`；旧 `check-overlay` 与 `tests/presets-config.test.mjs` 抄了同一个错名，所以两边都"通过"却运行时不生效。现三处统一为 `SEEU_SKILL_SET_*`（提交 `ffc7184`）。
  - `.probe/asar-032-check.mjs` 的 `briefCountNote` 检查原先匹配旧文案，实际 bundle 文案是「（「入库记录」是本索引实际解析入库的行数…）」，改为匹配「本索引实际解析入库的行数」。
  - 打包态读 asar 仍在 NSIS/portable 阶段失败（`was not found`），等 job 结束再验。
- 遗留：`release/` 里 0.3.1 portable 因正在运行无法删除（`Device or resource busy`）；三预设的技能注入目前只有配置层校验（`dump-config` 打印 `!!js` 表达式字符串），运行时求值依赖 dsh loader 的 `with (ctx) eval`（已读源码确认 `process` 可达），但没有 UI 级断言 —— headless profile 无 `agentPresets` 服务。

### v0.3.3 回归验证（2026-11-12）

背景：v0.3.2 的随包 dsh 插件实际没加载（profile 只有 bundle 清单、没有 `<profile>/node_modules` 里的包，dsh 导入报 `ERR_MODULE_NOT_FOUND`）。v0.3.3 加入插件包复制，并顺带把火眼已挂载的检材目录写进案件概览。

产物（`release/`）：

| 文件 | 大小 |
| --- | --- |
| `win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版总计 1,109,408,111 B） |
| `win-unpacked/resources/app.asar` | 425,056,883 B（34,072 entries） |
| `SeeUForensicsAgentPlus-0.3.3-x64.exe` | 281,470,879 B（blockmap 293,467 B） |
| `SeeUForensicsAgentPlus-0.3.3-x64-portable.exe` | 236,209,035 B |

验证：

- `.probe/asar-033-check.mjs`：全项 `true`、`missing: []`（含 `pluginPackagesCopy`、`pluginsActivationAssert`、`version033`）。
- `node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9503` → `ok:true, elapsedMs:7128`；portable `--port 9502` → `ok:true, elapsedMs:49787`。
- **打包态插件验证（本轮关键）**：`node scripts/e2e/plugins-check.mjs --exe "…release/win-unpacked/SeeUForensicsAgentPlus.exe"` → `ok:true`；`packagesOk:true`、`pluginLine`「插件包 175 个（已复制 175 个…）」、`activationFailures:[]`、`activationOk:true`。说明从 `app.asar` 逐文件复制插件包到 `%APPDATA%\SeeUForensicsAgentPlus\dsh-home\profiles\web\node_modules` 可行，dsh 子进程不再报 `9 entries did not activate`。
- 打包态 `m2-ui-check` → `m2ok:true, errors:[]`。
- 真实安装目录核对：`logs/shell.log` 08:20:56 / 08:21:58 有「插件包 175 个」与「已就绪」；`profiles/web/node_modules` 175 个包 + `.seeu-dsh-plugins.json`（version 0.3.3）；`logs/dsh-host-2026-11-12.log` 08:21/08:22 的启动不再出现 `did not activate`（只剩 `[gitbash-shell] … writer lock` / `terminalShell is not volatile` 这类无害告警）。

注意：

- 老版本（≤0.3.2）的实例不会自己补插件包；升级后必须**完全退出**（含托盘）再启动新版本，插件才会出现。
- 若用户目录里已有旧 profile，升级时按 `.seeu-dsh-plugins.json` 的 version 重新复制；`SEEU_DISABLE_DSH_PLUGINS=1` 可整体关闭随包插件。

### v0.3.4 回归验证（2026-11-12）

产物：

| 文件 | 大小 |
| --- | --- |
| `win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版总计 1,109,631,285 B） |
| `win-unpacked/resources/app.asar` | 425,280,057 B（34,095 entries） |
| `SeeUForensicsAgentPlus-0.3.4-x64.exe` | 281,533,139 B（blockmap 293,403 B） |
| `SeeUForensicsAgentPlus-0.3.4-x64-portable.exe` | 236,256,556 B |

验证：

- `.probe/asar-034-check.mjs`：68 项全 `true`、`missing: []`。新增检查：`toolPathsModule`、`toolPathsPathPriority`（`findOnPath`/`PATHEXT`/`SEEU_TOOL_`）、`toolPathsIpc`、`settingsToolPaths`、`personaToolPaths`（Ghidra 路径 + `analyzeHeadless.bat` + PATH 解析顺序）、`devWebToolEnv`、`toolPathsE2e`、`expertPersonas`（`preset-data`/`preset-apk`/`preset-exe`）、`bashFirstPolicy`、`version034`。
- 启动：`node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9501` → `ok:true, elapsedMs:7343`；portable `--port 9502` → `ok:true, elapsedMs:60014`。
- 打包态 `m2-ui-check` → `m2ok:true, errors:[]`。
- 打包态 `settings-check --exe` → `ok:true`：`toolPathsRows:12`、`toolPathsGhidra:"C:/Users/ASUS/.dsh/plugins/dsh-infinite-gen-5/third_party/sources/ghidra-12.1.4"`、`toolPathsSectionVisible/ApiSaved/UiSaved/FileOk` 全 `true`、`toolsRows:3`、`errors:[]`。
- 打包态 `plugins-check --exe` → `ok:true`：`bundlesOk:true`、`packagesOk:true`、`pluginLine`「插件包 175 个（已复制 175 个…）」、`activationFailures:[]`、`activationOk:true`。
- `npm test` → **122/122**；`npm run check:overlay` → OK。

注意：

- 外部工具路径解析顺序为「设置里显式指定 → PATH 命中的命令 → 默认实测路径」；打包态 `SEEU_TOOL_*` 由外壳注入，dev 预览由 `scripts/dev-web.mjs` 注入（日志「外部工具：12 个已注入」）。
- 0.3.3 的三件产物已在本次打包后删除；`release/` 只保留 0.3.4。

### v0.3.5 回归验证

产物（2026-11-12）：

| 文件 | 大小 |
| --- | --- |
| `win-unpacked/SeeUForensicsAgentPlus.exe` | 246,329,856 B（目录版总计 1,110,752,752 B） |
| `win-unpacked/resources/app.asar` | 426,401,524 B（34,213 entries） |
| `SeeUForensicsAgentPlus-0.3.5-x64.exe` | 281,858,620 B（blockmap 293,867 B） |
| `SeeUForensicsAgentPlus-0.3.5-x64-portable.exe` | 236,534,010 B |

验证：

- `.probe/asar-035-check.mjs`：**76 项全 `true`**、`missing: []`、`entries: 34213`。新增检查：`presetSplit`（`APK 分析` + `手机取证（Mobile）` + `preset-mobile`）、`qikoSkillSet`（Qiko 技能组含「SeeU 环境适配」、条目 ≥100、SKILL.md ≥40）、`qikoTrimmed`（不含 `forensic-report`/`whodb`）、`skillPrune`（`dist/main.cjs` 含 `pruned`/`wanted.has`）、`starMemTool`/`starMemSkill`、`skillSetQikoEnv`、`version035`。
- 启动：`node scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 9496` → `ok:true, elapsedMs:6192`；portable `--port 9497` → `ok:true, elapsedMs:50833`。
- 打包态 `m2-ui-check` → `m2ok:true`。
- 打包态 `settings-check --exe` → `ok:true`：`toolPathsRows:13`（含 `starmem`）、`toolPathsStarmem` 指向 `…/starmem-v0.2.2-windows-x64-upx/starmem.exe`、Ghidra 默认路径、`toolPathsFileOk:true`、`toolsRows:3`。
- 打包态 `plugins-check --exe` → `ok:true`：175 个插件包、`activationFailures:[]`。
- 打包态 `skills-check --exe` → `ok:true`：`qikoSet` 43 个技能、`leaked:[]`。
- `npm test` → **122/122**；`npm run check:overlay` → OK。

注意：

- StarMem 设为内存预设默认引擎（lovelymem / Volatility 兜底）；外部工具路径设置现有 13 行（Ghidra 为目录型，其余为可执行文件）。
- 0.3.4 的三件产物已在本次打包后删除；`release/` 只保留 0.3.5。

### v0.3.6 回归验证

- 产物：NSIS `SeeUForensicsAgentPlus-0.3.6-x64.exe` **281,864,757 B**（blockmap 293,917 B）、portable **236,497,369 B**、`resources/app.asar` **426,435,518 B（34,213 entries）**、`win-unpacked` 总计 1,110,786,746 B；electron-builder 26.18.0、Electron 44.7.0、无证书跳过签名（约 15 分钟）。
- asar 自检：`.probe/asar-036-check.mjs` **82 项全 true**、`missing:[]`。新增 `thinkingFormat`（main.cjs 含 thinkingFormat/chatTemplateKwargs、设置页含 kwargs 控件）、`diagnoseStream`（`probeStream` + `reasoning_content` + `key: "stream"`）、`mountTiming`（`mounts.html` 有 `noteTiming`、main.cjs 有 `mountErrorHint`）、`heroToolsChip`、`version036`。
- 启动：目录版 `verify-launch --port 9491` → `ok:true, elapsedMs:5088`；portable `--port 9492 --timeout 240000` → `ok:true, elapsedMs:52954`。
- 打包态 e2e（`SEEU_UI_EXE` 指 `release/win-unpacked/SeeUForensicsAgentPlus.exe`，用 Windows 路径）：`m2-ui-check` `m2ok:true/errors:[]`；`settings-check --exe` `ok:true`（`diagItems` 五项全 ✓、`thinkingSaved:true`、`toolPathsRows:13`、`probeNoContextWindow:false`）；`plugins-check --exe` `ok:true`（175 个插件包、`activationFailures:[]`、`activationOk:true`）；`skills-check --exe` `ok:true`（`leaked:[]`）；`hero-check --exe` `ok:true`（本机工具 13/13、镜像挂载 0）；`mount-check --exe` `ok:true`（inspect 164 ms、2 分区、mount/unmount 正常）。
- 坑：asar 检查里匹配 esbuild 产物要按压缩后的写法（`key: "stream"` 双引号；`mountErrorHint` 在主进程 bundle，不在 `mounts.html`），否则误报 false。

### v0.3.7 回归验证

- 产物：NSIS `SeeUForensicsAgentPlus-0.3.7-x64.exe` **281,815,681 B**（blockmap 293,228 B）、portable **236,553,590 B**、`resources/app.asar` **426,333,279 B（34,193 entries）**、`win-unpacked` 总计 1,110,684,507 B；electron-builder 26.18.0、Electron 44.7.0、无证书跳过签名（约 15 分钟）。
- 打包坑：第一次用 `nohup npx electron-builder … &` 把任务挂在被 shell 收走的进程组里，构建目录只留半成品；第二次直接重跑报 `ENOENT: rename … \win-unpacked\electron.exe → SeeUForensicsAgentPlus.exe`（旧 `win-unpacked` 残留）；`rm -rf release-037` 后第三次用后台 job 正常完成。**结论：打包先清干净输出目录，且用受管后台任务而不是 `nohup &`。**
- asar 自检：`.probe/asar-037-check.mjs` **89 项全 true**、`missing:[]`。新增 `buildProgress`/`buildCancel`/`buildAbortSignal`/`buildDedupe`/`indexMetaList`/`m2IndexMeta`、`authCookiePrune`/`authCookieE2e`、`version037`；修了两处检查写法：`authCookieE2e` 要读仓库 `package.json`（asar 内清单没有 `scripts`）。
- 启动：目录版 `verify-launch --port 5391` → `ok:true, elapsedMs:5092`；portable `--port 5392 --timeout 240000` → `ok:true, elapsedMs:46641`。
- 打包态 e2e（`SEEU_UI_EXE` 指 `release/win-unpacked/SeeUForensicsAgentPlus.exe`，用 Windows 路径）：`m2-ui-check` `m2ok:true/errors:[]`；`settings-check --exe` `ok:true`（`diagItems` 五项全 ✓、`thinkingSaved:true`、`toolPathsRows:13`）；`plugins-check --exe` `ok:true`（175 个插件包、`activationFailures:[]`、`activationOk:true`）；`skills-check --exe` `ok:true`（`qikoSet.count:43`、`leaked:[]`）；`hero-check --exe` `ok:true`（`actions` 五项、本机工具 13/13、最近案件 chip 正常，证明 431 修复后首页可渲染）；`mount-check --exe` `ok:true`（inspect 185 ms、mount 361 ms、unmount 2 ms、`timingWired:true`）；dev `auth-cookie-check` `{"ok":true,"seeded":80,"pruned":81,"rendered":true}`。
- 坑：dsh 页面加载完成后 URL 会从 `/?token=…` 变成 `/`（前端 `replaceState`），`hero-check` 旧正则只认带 token 的 URL 会误报「主页面没出现」；已改为同时接受两种 URL。

### v0.3.8 回归验证

- 打包：`npx electron-builder --win --x64 -c.directories.output=release-038`（exit 0，无证书跳过签名）；产物：NSIS `281,879,944 B`（blockmap `294,694 B`）、portable `236,575,720 B`、`app.asar` `426,495,680 B`（34,220 entries）、目录版 1,110,846,908 B。
- asar 自检 `.probe/asar-038-check.mjs`：`missing:[]`，全部检查 true（新增 `myosImporter` / `myosHostRoutes` / `myosPanelUi` / `myosE2e` / `version038`）。
- 启动：`verify-launch` 目录版 `ok:true, elapsedMs:6180`、portable `ok:true, elapsedMs:48782`。
- 打包态 e2e（`SEEU_UI_EXE` 传 Windows 正斜杠路径、隔离 home/userData）：`m2-ui-check`（`m2ok:true`、`myosImportOk:true`、`errors:[]`）、`settings-check --exe`（`ok:true`、`toolPathsRows:13`、`diagOk:true`、`thinkingSaved:true`）、`plugins-check --exe`（`ok:true`、175 包、`activationFailures:[]`）、`skills-check --exe`（`ok:true`、Qiko 43 个、`leaked:[]`）、`hero-check --exe`（`ok:true`、本机工具 13/13）、`mount-check --exe`（`ok:true`、inspect 154 ms）。


### v0.3.9 回归验证（第 28 轮）

- 产物（已搬进 `release/`，删 0.3.8 三件）：`release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B、`app.asar` **426,530,364 B（34,223 entries）**、NSIS **281,886,671 B**（blockmap 294,656 B）、portable **236,647,317 B**、`win-unpacked` 总计 1,110,881,592 B。
- `.probe/asar-039-check.mjs`（由 038 复制，`version039`；必需路径加 `tools/ges-index/extra-dirs.mjs` 与 `resources/forensics/skills/myos-import/SKILL.md`；新增 `myosBatchImport`/`myosDbName`/`myosImportSkill`/`extraDirs`/`indexSourceLabels`/`indexSourceFilter`/`myosRealE2e`/`mountTimingUi`）：**全部 true、`missing:[]`**。首次 `myosDbName` 为 false——`resolveDbByName` 在 `plugins/seeu-case-index/myos.mjs` 而不是 `index.js`，检查改读该文件。
- 启动：目录版 `verify-launch --port 5393` → `ok:true, elapsedMs:5076`；portable `--port 5394` → `ok:true, elapsedMs:58673`。
- 打包态 e2e（先 `Get-Process electron | Stop-Process -Force` 清残留；`SEEU_UI_EXE` 用 Windows 正斜杠路径、每个探针独立 `SEEU_DSH_HOME`/`SEEU_USER_DATA`）：
  - `m2-ui-check` → `m2ok:true, myosImportOk:true, errors:[]`（含索引来源筛选 `idxFilterOk`）；
  - `settings-check --exe` → `ok:true`（13 行外部工具路径、`diagItems` 五项全 ✓、`thinkingSaved:true`、`toolPathsRows:13`）；
  - `plugins-check --exe` → `ok:true`（175 个插件包、`activationFailures:[]`）；
  - `skills-check --exe` → `ok:true`（6 个随包技能含 `myos-import`、Qiko 43 个、`leaked:[]`）；
  - `hero-check --exe` → `ok:true`（5 个快捷入口、本机工具 13/13）；
  - `mount-check --exe` → `ok:true`（inspect 165 ms / mount 310 ms / unmount 1 ms）；
  - `myos-real-import`（真实 MYOS 运行中）→ `ok:true, skipped:false`，`MApps` 导入 10 行。

### v0.3.10 回归验证

- 版本：`0.3.10`（`npm version 0.3.10 --no-git-tag-version`），打包命令 `npx electron-builder --win --x64 -c.directories.output=release-0310`（无签名）。
- 产物（已搬进 `release/`）：`release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B、`app.asar` **426,537,645 B（34,224 entries）**、NSIS **281,889,094 B**（blockmap 293,258 B）、portable **236,564,870 B**、`win-unpacked` 总计 1,110,888,873 B。
- asar 自检：`.probe/asar-0310-check.mjs`（由 039 复制，新增 `tools/ges-index/activity.mjs` 必需路径与 `activityModule`/`activityRoutes`/`activityBuild`/`activityPanel`/`version0310`）全部 true、`missing: []`、`entries: 34,224`；`client.js` 139,849 B、`index.js` 31,897 B、`query.js` 28,866 B。
- 启动：`verify-launch` 目录版 `ok:true, elapsedMs:5123`、portable `ok:true, elapsedMs:58499`。
- 打包态 e2e（`SEEU_UI_EXE` 用 Windows 正斜杠路径、隔离 home；先清 stale electron）：
  - `m2-ui-check` → `m2ok:true`、`activityOk:true`、`myosImportOk:true`、`errors:[]`；
  - `settings-check --exe` → `ok:true`（13 行外部工具路径、`diagItems` 五项 ✓、`thinkingSaved:true`、单机/双机部署预设正确）；
  - `plugins-check --exe` → `ok:true`（`packagesOk:true`、`activationOk:true`、`activationFailures:[]`、175 包）；
  - `skills-check --exe` → `ok:true`（6 个随包技能含 `myos-import`、Qiko 43 个、`leaked:[]`）；
  - `hero-check --exe` → `ok:true`（快捷入口 5 个、本机工具 13/13、最近案件 chip）；
  - `mount-check --exe` → `ok:true`（inspect 267 ms、mount 332 ms、unmount 3 ms）；
  - 真实 MYOS 导入 `node scripts/e2e/myos-real-import.mjs` → `ok:true, skipped:false`。
- 说明：`scripts/bench/local-gateway-bench.mjs`（第 29 轮）是开发期基准工具，不随安装包分发（`electron-builder.yml` 未包含 `scripts/**`），源码在仓库根 `scripts/bench/` 下。

### v0.3.11 回归验证

- 版本：`0.3.11`（`npm version 0.3.11 --no-git-tag-version`）；打包命令 `npx electron-builder --win --x64 -c.directories.output=release-0311`（无签名，约 16 分钟）。
- 产物（已搬进 `release/`）：`release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B、`app.asar` **426,562,813 B（34,224 entries）**、NSIS **281,893,366 B**（blockmap 293,297 B）、portable **236,555,068 B**、`win-unpacked` 总计 1,110,914,041 B。
- asar 自检：`.probe/asar-0311-check.mjs`（由 0310 复制，新增 `envReportModule`/`envReportIpc`/`envReportSettings`/`envCopyButton`/`activitySummary`、`version0311`）→ `entries: 34,224`、`missing: []`、**110 项全 true**。
- 启动：`verify-launch` 目录版 `ok:true, elapsedMs:6107`（首次运行曾被杀毒扫描拖到 33.9 s，重跑即恢复）；portable `ok:true, elapsedMs:58,514`。
- 打包态 e2e（`SEEU_UI_EXE` 用 Windows 正斜杠、隔离 home；先清 stale electron）：
  - `m2-ui-check` → `m2ok:true`、`activitySummaryPresent:1`、`activityOk:true`、`myosImportOk:true`、`errors:[]`；
  - `settings-check --exe` → `ok:true`，`envReportOk:true`、`envSummary:"体检结果：6 项正常 · 1 项注意 · 0 项不可用"`、`envCopyOk:true`（剪贴板回读 380 字符）、`toolPathsRows:13`、`diagOk:true`、`errors:[]`；
  - `plugins-check --exe` → `ok:true`（`packagesOk:true`、`activationOk:true`）；
  - `skills-check --exe` → `ok:true`（6 个随包技能含 `myos-import`、Qiko 43 个、`leaked:[]`）；
  - `hero-check --exe` → `ok:true`（入口 5 个、本机工具 13/13）；
  - `mount-check --exe` → `ok:true`（inspect 169 ms、mount 338 ms、unmount 2 ms）；
  - `myos-real-import` → `ok:true, skipped:false`。
- 说明：`tools/env-report.mjs` 被 esbuild 打包进 `dist/main.cjs`（与 `tools/lovely-tools.mjs` 同），asar 里没有独立文件——自检脚本不要把它列进必需路径，改用 `mainJs.includes(...)` 校验。

### v0.3.12 回归验证

- 打包：`npm version 0.3.12 --no-git-tag-version` → `node scripts/build.mjs` → `npx electron-builder --win --x64 -c.directories.output=release-0312`（约 15 分钟；本次 harness 重启把首个 job 杀掉，NSIS 已完成、portable 未出，改用 `npx electron-builder --win portable --x64 -c.directories.output=release-0312` 单独补出便携包）。
- 产物：NSIS `281,896,527 B`（blockmap `293,199 B`）、portable `236,577,274 B`、`app.asar` `426,586,748 B`（34,224 entries）、目录版总计 `1,110,937,976 B`。
- `.probe/asar-0312-check.mjs`：全部检查 true、`missing: []`；新增 `activityBars`/`activityDayFilter`/`activityRemove`/`activitySearch`/`mountLastRecord`/`mountRemount`/`envFixModule`/`envFixUi`。
- `verify-launch`：目录版 `ok:true, elapsedMs:6305`；portable `ok:true, elapsedMs:54994`。
- 打包态 e2e：`m2-ui-check`（`m2ok:true`、`activityOk:true`、`myosImportOk:true`、`errors:[]`）；`settings-check --exe`（`ok:true`：`envReportOk/envCopyOk/envFixOk:true`、`toolPathsRows:13`、`diagOk:true`）；`mount-check --exe`（`ok:true`：`lastMountReleasedOk:true`、`remountHintOk:true`）；`hero-check --exe`（`ok:true`、`toolsOk:true`）；`plugins-check --exe`（`ok:true`、`packagesOk:true`、`activationOk:true`、175 包）；`skills-check --exe`（`ok:true`、`qikoSet.count:43`、`leaked:[]`）。
- 坑：① `tools/image-mount.mjs` 与 `tools/env-report.mjs` 被 esbuild 打进 `dist/main.cjs`，不在 asar 顶层单列，asar 自检要改查 `mainJs`；② `settings-check` 的 mock 网关默认端口 `18081` 会和 MYOS `PhoneForensics` 服务撞车（EADDRINUSE），已支持 `SEEU_SETTINGS_MOCK_PORT`/`SEEU_SETTINGS_CDP_PORT` 覆盖（默认值不变）；误杀 MYOS 服务后用 `Start-Process D:/Programs/MYOS/Client/bin/ForensicDesktop.exe -WindowStyle Minimized` 恢复；③ 打包中途 harness 重启会导致 job 被杀、产物不全，重跑或单 target 补打即可。

### v0.3.13 回归验证

- 版本：`0.3.13`，dsh 运行时 **0.2.2-rc.3**（Electron 44.7.0，Windows x64，无签名）。
- 打包：`npx electron-builder --win --x64 -c.directories.output=release-0313`（约 17 分钟）。
- 产物（已搬进 `release/`，删 0.3.12 三件；0.3.12 portable 因被运行占用保留）：
  - `release/win-unpacked/SeeUForensicsAgentPlus.exe` 246,329,856 B
  - `release/win-unpacked/resources/app.asar` **566,538,202 B（32,976 entries）**
  - NSIS **320,055,103 B**（blockmap 332,917 B）
  - portable **270,609,007 B**
  - `win-unpacked` 总计 **1,262,703,160 B**
- asar 自检：`.probe/asar-0313-check.mjs` **125 项全 true、`missing:[]`**（新增 `version0313`、`dshRc3`、`dshPeers`、`starRuiPresets`、`starRuiKb`、`dynamicEnv`、`toolPaths15`、`sparkContext256`）。
- 启动：`verify-launch` 目录版 `ok:true, elapsedMs:7175`；portable `ok:true, elapsedMs:61634`。
- 打包态 e2e（`SEEU_UI_EXE` 用 Windows 正斜杠路径 + 隔离 home）：
  - `m2-ui-check` → `m2ok:true, activityOk:true, myosImportOk:true, errors:[]`
  - `settings-check --exe` → `ok:true`（`toolPathsRows:15`、`diagOk:true`、`envReportOk:true`、`errors:[]`）
  - `plugins-check --exe` → `ok:true`（`bundlesOk/packagesOk/activationOk` 全 true）
  - `skills-check --exe` → `ok:true`（`leaked:[]`，含 `myos-import` 与 Qiko 43 个）
  - `hero-check --exe` → `ok:true`（`toolsOk:true`，本机工具 15 项中 13 个就绪）
  - `mount-check --exe` → `ok:true`
- 已知变化与坑：
  - dsh rc.3 体积上涨：asar 426.6 MB → 566.5 MB（+140 MB），NSIS 281.9 MB → 320.1 MB；冷启动 6.3 s → 7.2 s。
  - asar `entries` 从 34,224 降到 32,976（rc.3 依赖包的文件布局更集中，非丢文件；`missing:[]` 证明必需路径齐全）。
  - 打包态 `m2-ui-check` 首次失败是「活动记录为空」——脚本只在 `SEEU_DSH_HOME` 为绝对路径时才预置活动；打包态必须显式传 `SEEU_DSH_HOME` + `SEEU_USER_DATA`（隔离），否则命中用户真实 profile、断言不成立。

### v0.3.14 回归验证（第 50 轮：星睿 MCP 按预设注入）

- 打包命令：`npx electron-builder --win --x64 -c.directories.output=release-0314`（dsh 0.2.2-rc.3、Electron 44.7.0、无签名）。
- 产物：NSIS `320,055,823 B`（blockmap `333,015 B`）、portable `270,623,477 B`、`app.asar` `566,541,777 B`（`32,976` entries）、`win-unpacked` `1,262,706,735 B`。
- `.probe/asar-0314-check.mjs`：`missing: []`，全部检查 true；新增 `version0314`、`xingruiScoped`（7 个 `serverName: xingrui-*` 均在 overlay 内）、`xingruiPerPreset`（`- id: seeu-mcp-xingrui-` 恰好 7 条）、`xingruiNoGlobalRow`（0–3 空格缩进处不再出现该行）、`xingruiStreamable`（`transport: streamable-http` 恰好 7 处）。
- 启动：目录版 `verify-launch` → `"ok": true, "elapsedMs": 9054`（首跑受杀毒扫描影响）；portable → `"ok": true, "elapsedMs": 63882`。
- 打包态 e2e（`SEEU_UI_EXE` 指向 `release/win-unpacked/SeeUForensicsAgentPlus.exe`，隔离 `SEEU_DSH_HOME`/`SEEU_USER_DATA`）：
  - `m2-ui-check` → `ok:true, m2ok:true, errors:[]`；
  - `settings-check --exe` → `ok:true`（`toolPathsRows:15`、`diagOk:true`、`envReportOk:true`、`thinkingSaved:true`）——mock 网关端口用 `SEEU_SETTINGS_MOCK_PORT=28181`、CDP 用 `SEEU_SETTINGS_CDP_PORT=9353`，避开 MYOS 占用的 18081；
  - `plugins-check --exe` → `ok:true`（`packagesOk:true`、`activationOk:true`、`activationFailures:[]`）；
  - `skills-check --exe` → `ok:true`（`leaked:[]`）；
  - `hero-check --exe` → `ok:true`（`toolsOk:true`）；
  - `mount-check --exe` → `ok:true`（`inspect.ok:true`、`remountHintOk:true`）。
- 已知变化与坑：
  - 星睿连接器从「全局 1 处 × 7 行」改成「预设内 7 行」，缩进不同（`preset-standard` 顶层 6 空格、`- insert:` 内预设 10 空格）；用 `.probe/scope-mcp.py` 按 `plugins:` 第一个子行实际缩进计算，硬编码缩进会 `bad indentation of a mapping entry`。
  - asar 校验不能再用「全文无 `seeu-mcp-xingrui`」判断，因为预设内行 id 也含该前缀；改为统计 `- id: seeu-mcp-xingrui-` 恰好 7 条 + 断言 0–3 空格缩进处没有该行。
  - 打包态 `m2-ui-check` 需要隔离 `SEEU_DSH_HOME`（绝对路径）与 `SEEU_USER_DATA`，否则会读到用户真实 profile 的活动/索引状态。

### v0.3.15 回归验证（第 51 轮：检索 500 修复 + 美亚杯链路实测）

- 打包命令：`npx electron-builder --win --x64 -c.directories.output=release-0315`（dsh 0.2.2-rc.3、Electron 44.7.0、无签名）。
- 产物：NSIS `320,055,949 B`（blockmap `333,051 B`）、portable `270,591,032 B`、`app.asar` `566,541,732 B`（`32,976` entries）、`win-unpacked` `1,262,706,690 B`（0.3.14 portable 被占用保留在 `release/`）。
- `.probe/asar-0315-check.mjs`：`missing: []`、全部检查 true；新增 `version0315`、`searchFtsFix`（`tools/ges-index/query.mjs` 不含 `ftsQuery(`、含 `record_fts match` 与「短关键词」注释）。
- 启动：目录版 `verify-launch` → `"ok": true, "elapsedMs": 7348`；portable → `"ok": true, "elapsedMs": 53801`。
- 打包态 e2e（`SEEU_UI_EXE` 隔离 home/userData）：
  - `m2-ui-check` → `m2ok:true`、`searchOk:true`、`searchLongText:"引擎 fts5-trigram · 11 命中"`、`searchLongOk:true`、`errors:[]`（长关键词回归在打包态通过）；
  - `settings-check --exe` → `ok:true`（`toolPathsRows:15`、`diagOk`、`envReportOk`、`thinkingSaved`）；
  - `plugins-check --exe` → `ok:true`（175 包、`activationOk`、`activationFailures:[]`）；
  - `skills-check --exe` → `ok:true`（`leaked:[]`）；
  - `hero-check --exe` → `ok:true`（`toolsOk`）；
  - `mount-check --exe` → `ok:true`（E01 inspect 244 ms、`remountHintOk`）。
- 关联：`docs/chain-check-2025美亚杯.md` 记录 W:\ 检材逐环实测（火眼挂载/索引/LovelyCarve），本版即修复该实测中发现的 `/search` 500。


### v0.3.16 回归验证

- 版本与体积：NSIS 320,064,982 B（blockmap 332,754 B）、portable 270,624,840 B、`app.asar` 566,556,645 B（32,982 entries）、目录版 1,262,734,964 B。
- `node .probe/asar-0316-check.mjs`：`missing: []`、0 个 false（新增 `tools/chain-check.mjs`、`tools/ios-quick.mjs` 必需路径；`iosQuickPackageScript` 改读仓库 `package.json`，因为 asar 内清单的 `scripts` 会被 electron-builder 去掉）。
- 目录版冷启动 `verify-launch --port 5396` → 7252 ms；portable `--port 5397` → 52,709 ms。
- 打包态 e2e（隔离 `SEEU_DSH_HOME`/`SEEU_USER_DATA` 绝对路径；`settings-check` 用 `SEEU_SETTINGS_MOCK_PORT=28181`/`SEEU_SETTINGS_CDP_PORT=9353` 避开 MYOS 18081）：`m2-ui-check`、`settings-check`、`plugins-check`（175 包、`activationFailures:[]`）、`skills-check`（9 个随包技能、`leaked:[]`）、`hero-check`（15/15 工具）、`mount-check`（inspect 224 ms / mount 408 ms / 重新挂载 X:）全部 `ok:true`。
- 坑 1：`scripts/chain-check.mjs`、`scripts/ios-quick.mjs` 不会进 asar（白名单只对 `tools/**` 生效），自检不要把它们列为必需路径；打包后给用户的是 `tools` 模块，命令行入口仅开发态可用。
- 坑 2：打包态 `m2-ui-check` 必须传隔离的 `SEEU_DSH_HOME`（绝对路径），否则活动预置写不进去，会报「活动行打开失败时没有提示」。


### v0.3.17 回归验证

- 版本与体积：NSIS 320,080,340 B（blockmap 333,200 B）、portable 270,625,844 B、`app.asar` 566,595,818 B（32,984 entries）、目录版 1,262,774,137 B。
- `node .probe/asar-0317-check.mjs`：`missing: []`、0 false（必需路径新增 `tools/chain-check-run.mjs`、`tools/image-mount.mjs`；新增 `chainCheckRoute`/`chainCheckPanel`/`chainCheckRunModule`/`version0317`）。
- 启动：目录版 `verify-launch` 首次 27.4 s（杀毒扫描新 asar），复跑 7547 ms；portable 52,927 ms。
- 打包态 e2e：`m2-ui-check`（含「体检」按钮 → 结果卡片，`idxChainText` = ✅ 全部通过 / 火眼挂载 4/4 可读）、`settings-check`（15 行外部工具、诊断五项、体检复制/导出）、`plugins-check`（175 包、`activationFailures:[]`）、`skills-check`（9 个随包技能、`leaked:[]`）、`hero-check`（15/15 工具）、`mount-check`（含重新挂载）全部 `ok:true`。
- **坑（重要）**：插件在 asar 里被 dsh 以 ESM 加载，`plugins/seeu-case-index/index.js` 静态 import 的每个 `tools/**` 模块都必须在 `electron-builder.yml` 的 `files` 白名单里；漏掉会让打包版插件整体 import 失败（面板恢复为空壳）。v0.3.16 曾漏 `tools/chain-check-run.mjs`/`tools/image-mount.mjs`，v0.3.17 已补齐并验证。

### v0.3.18 回归验证

- 打包：`npm version 0.3.18` → `node scripts/build.mjs` → `npm test` 211/211 → `check:overlay` OK → `npx electron-builder --win --x64 -c.directories.output=release-0318`（约 12 分钟，无签名）。
- 产物：NSIS 320,080,738 B（blockmap 333,236 B）、portable 270,641,430 B、`app.asar` 566,597,933 B（32,984 entries）、目录版 1,262,776,252 B。
- asar 自检 `.probe/asar-0318-check.mjs`：`missing: []`、0 项 false（新增 `chainStepRow`、`version0318`）。
- 启动：目录版首次 29,156 ms（杀毒扫描新 asar）、复跑 6246 ms；portable 54,630 ms。
- 打包态 e2e：`m2-ui-check`（`idxChainSteps:3`、`idxChainStepText` 含索引/检索/火眼挂载）、`settings-check`、`plugins-check`、`skills-check`、`hero-check`、`mount-check` 全绿。
- 坑：面板卡片加高后会挤压同一 tab 下方文本，e2e 里 `tablesText` 的截取窗口要从 700 加宽到 1600；体检卡片断言要轮询到「案件：」再读文本。

### v0.3.19 回归验证

- 打包：`npm version 0.3.19` → build → `npm test` 211/211 → `check:overlay` OK → `npx electron-builder --win --x64 -c.directories.output=release-0319`。
- 产物：NSIS 320,022,835 B（blockmap 333,132 B）、portable 270,611,871 B、`app.asar` 566,485,135 B（32,964 entries）、目录版 1,262,663,454 B。
- asar 自检 `.probe/asar-0319-check.mjs`：`missing: []`、0 false（新增 `chainCheckText`、`chainCheckSkill`、`version0319`）。
- 启动：目录版首次 29,186 ms（杀毒扫描）、复跑 6,106 ms；portable 52,590 ms。
- 打包态 e2e：`m2-ui-check`（`idxChainSteps:3`、`idxChainOk:true`）、settings/plugins/skills（10 随包技能含 `seeu-chain-check`）/hero/mount 全绿。
- 验证 `text=1`：`curl -s "http://127.0.0.1:54053/seeu-index/chain-check?caseNumber=2919d298&text=1"` 输出四段报告（索引覆盖 / 检索链路 / 火眼挂载 / 镜像）。

### v0.3.20 回归验证

- 打包：`npm version 0.3.20` → build → `npm test` 211/211 → `check:overlay` OK → `npx electron-builder --win --x64 -c.directories.output=release-0320`。
- 产物：NSIS 320,027,278 B（blockmap 332,907 B）、portable 270,578,413 B、`app.asar` 566,486,765 B（32,966 entries）、目录版 1,262,671,181 B。
- asar 自检 `.probe/asar-0320-check.mjs`：`missing: []`、0 false；新增 `seeuMcpRow`（overlay 含 `seeu-mcp-tools`/`SEEU_MCP_SERVER`/`ELECTRON_RUN_AS_NODE`）、`seeuMcpServer`（`app.asar.unpacked/tools/seeu-mcp/server.mjs` 存在）、`seeuMcpIpc`（main.cjs 含两个 env 名）。
- 启动：目录版首次 28,803 ms（杀毒扫描）、复跑 6407 ms；portable 53,984 ms。
- 内置 MCP：`ELECTRON_RUN_AS_NODE=1 SeeUForensicsAgentPlus.exe <unpacked>/tools/seeu-mcp/server.mjs` 可完成 initialize/tools/list；headless 会话工具 77 个，含 `mcp__seeu__chain_check`、`mcp__seeu__index_list`。
- 打包态 e2e：`m2-ui-check`（`idxChainSteps:3`、`errors:[]`）通过。
- 坑：asarUnpack 条目必须写在 `asarUnpack:` 段（误加到 `files:` 会导致脚本留在 asar 内、`ELECTRON_RUN_AS_NODE` 读不到）；MCP server 不能在 stdin EOF 时立刻退出，要等挂起请求完成（否则 tools/call 无输出）。

### v0.3.21 回归验证

- 打包：`npm version 0.3.21` → build → `npm test` 211/211 → `check:overlay` OK → `npx electron-builder --win --x64 -c.directories.output=release-0321`。
- 产物：NSIS 320,028,826 B（blockmap 332,580 B）、portable 270,596,906 B、`app.asar` 566,487,574 B（32,966 entries）、目录版 1,262,569,393 B。
- asar 自检 `.probe/asar-0321-check.mjs`：`missing: []`、0 false；`seeuMcpServer` 现在读取 `app.asar.unpacked/tools/seeu-mcp/server.mjs` 并断言 5 个工具名 + `resolveCaseNumber`；`seeuMcpSkill` 断言技能提到 evidence_list/index_search/index_tables。
- 启动：目录版首次 29.2 s（杀毒扫描）、复跑 7269 ms；portable 52,643 ms。
- 内置 MCP 工具探测（headless，mock 网关）：`mcp__seeu__index_list` / `evidence_list` / `index_search` / `index_tables` / `chain_check` 均存在；`evidence_list` 输出含挂载 route 与备注。
- 打包态 e2e：`m2-ui-check`（`idxChainSteps:3`、`errors:[]`）通过。
- 坑：`/search` 返回数组字段是 `rows`（不是 hits），摘要字段 `snip`；`resolveDbParam` 只做精确匹配，前缀解析放在 MCP 层；卸载 `win-unpacked` 前要确认别删到只读/被占用文件（本次曾误删，用 `--dir` 重新生成）。

### v0.3.22 回归验证

- `npm test` 214/214、`check:overlay` OK、`node scripts/build.mjs` OK。
- 打包：`npx electron-builder --win --x64 -c.directories.output=release-0322`；NSIS 320,029,701 B（blockmap 332,509 B）、portable 270,565,325 B、`app.asar` 566,489,972 B（32,966 entries）、目录版 1,262,680,982 B。
- `.probe/asar-0322-check.mjs`：0 个 false、`missing:[]`（新增 `envMcpItem`：`dist/main.cjs` 含「内置 SeeU MCP」与 `mcpFacts`；`version0322`）。
- 启动：目录版 6176 ms；portable 52,755 ms（首启解包）。
- 打包态 e2e：`m2-ui-check`（`m2ok:true`、`idxChainSteps:3`、`errors:[]`）、`settings-check --exe`（`ok:true`、`envItemCount:8`、`toolPathsRows:15`、`diagOk:true`）、`plugins-check`（`ok:true`、175 包、`activationFailures:[]`）、`skills-check`（`ok:true`、10 随包、`leaked:[]`）、`hero-check`（`ok:true`、15/15）、`mount-check`（`ok:true`、inspect 204 ms、`remountHintOk:true`）。
- 注意：改 `src/env-report.ts` 后必须先 `node scripts/build.mjs` 再跑 settings-check，否则 e2e 用的是旧 `dist/main.cjs`（旧逻辑 7 项 → 等 8 项超时）。

### v0.3.23 回归验证

- `npm test` 214/214、`check:overlay` OK、build OK。
- 打包：NSIS 320,029,815 B（blockmap 332,612 B）、portable 270,587,054 B、`app.asar` 566,492,194 B（32,966 entries）、目录版 1,262,683,204 B。
- `.probe/asar-0323-check.mjs`：143 项全 true、`missing:[]`（新增 `mcpChip`：`dist/main.cjs` 含 `seeu:mcp:info`，`plugins/seeu-theme/client.js` 含 `data-seeu-mcp` 与「MCP：」）。
- 启动：目录版 20,756 ms（首启杀毒扫描）、portable 42,463 ms。
- 打包态：`hero-check --exe` → `ok:true`、`mcpOk:true`、`mcpText:"MCP：6 工具"`、`toolsOk:true`；`m2-ui-check` → `m2ok:true`、`idxChainSteps:3`、`errors:[]`。
- 坑：asar 自检脚本里 `fs.readFileSync` 未导入（脚本只 import 了具名 `readFileSync`），改为直接调用。

### v0.3.24 回归验证

- 产物：`SeeUForensicsAgentPlus-0.3.24-x64.exe` 320,090,795 B（blockmap 333,349 B）、`-portable.exe` 270,605,967 B、`resources/app.asar` 566,610,247 B（32,988 entries）。
- asar 自检：`.probe/asar-0324-check.mjs` `missing: []`、0 false（新增 `version0324`、`staleBuilding`（半成品可见）、`deepChain`（含镜像解析 + chain.caseNumber））。
- 启动：目录版 `verify-launch --port 5412` → `ok:true, elapsedMs:9394`；portable `--port 5414` → `ok:true, elapsedMs:79315`。
- 打包态 e2e（隔离 home，`SEEU_CASE_DIR=E:/forensics/honglian/作业_20261118081854I`，索引 45,237 条）：`m2-ui-check` `m2ok:true`（`recordsAfterCount:20452`、`entityPagingOk`、`timelineFiltersOk`、`idxChainSteps:3`、`idxChainDeepSteps:4`、`errors:[]`）；`settings-check`、`hero-check`、`plugins-check`、`skills-check`、`mount-check` 全部 `ok:true`。
- 说明：`scripts/e2e/**` 按仓库策略只保留在本地，不进安装包（`.probe` 同样 gitignore）。

### v0.3.25 回归验证

- 产物：`SeeUForensicsAgentPlus-0.3.25-x64.exe` 320,092,663 B、`-portable.exe` 270,622,742 B、`resources/app.asar` 566,618,883 B（32,988 entries）。
- asar 自检 `.probe/asar-0325-check.mjs`：`missing: []`、0 false（新增 `version0325`、`aboutCard`（设置页含「关于 SeeU」、main 含 `seeu:app:info`/`collectAppInfo`））。
- 启动：目录版 `verify-launch --port 5416` → `ok:true, elapsedMs:47289`（首启杀软扫描）；portable `--port 5418` → `ok:true, elapsedMs:73489`。
- 打包态 e2e（隔离 home、`SEEU_CASE_DIR=E:/forensics/honglian/作业_20261118081854I` 45,237 条索引）：`settings-check` `ok:true`（`aboutOk`/`aboutCopyOk`、体检 8 项、15 行外部工具）；`m2-ui-check` `m2ok:true`（`recordsAfterCount:20452`、`idxChainDeepSteps:4`、`errors:[]`）。
- 说明：`src/app-info.ts` 会随 esbuild 打进 `dist/main.cjs`，asar 不自带单文件，检查用 mainJs 符号断言。


### v0.3.26 回归验证（第 75 轮：大库性能与稳定性）

- 产物：`SeeUForensicsAgentPlus-0.3.26-x64.exe` 320,096,730 B（blockmap 333,337 B）、`-portable.exe` 270,632,199 B、`resources/app.asar` 566,636,793 B（32,988 entries）、`win-unpacked` 总计 1,262,827,933 B。
- `.probe/asar-0326-check.mjs`：`missing: []`、0 个 false（新增 `mountFastFail` / `shortQueryApprox` / `bigAggregates` / `staleResumeGuard` / `finalizePartial` / `version0326`）。
- 启动（`scripts/verify-launch.mjs --exe release/win-unpacked/SeeUForensicsAgentPlus.exe --port 5399`）：`ok:true, elapsedMs:13345`（首启被杀软扫描影响）。
- 打包态 e2e（`SEEU_UI_EXE` 指 `release/win-unpacked`，隔离 home/userData，用 2.6 GB `2026美亚团队` 索引）：
  - `m2-ui-check` → `m2ok:true, errors:[]`（`recordsBeforeCount:842198`、短词检索 `≥ 20 命中`、长词 FTS、来源筛选、链路体检含镜像解析、活动卡片；
  - `settings-check` → `ok:true`、`envItemCount:8`（含内置 MCP）、`toolPathsRows:15`、`aboutOk:true`、`toolPathsStarmem` 正确；仅 `probeNoContextWindow:false` 属预期（本机网关可能带 context_window）。
- 已知限制：`activityEmptyHint` 在预置活动数据的隔离 home 下为 false（预置了两条历史，本就不是空态），属 e2e 数据设计，不影响功能。

### v0.3.27 回归验证（第 77 轮：短词检索提速）

- 产物：NSIS 320,034,751 B（blockmap 332,658 B）、portable 270,542,942 B、`app.asar` 566,522,825 B（32,966 entries）。
- asar 自检 `.probe/asar-0327-check.mjs`：`missing: []`、0 false（新增 `shortScanChunked`、`perfScript`）。
- 启动：目录版 `verify-launch --port 5402` → `ok:true, elapsedMs:10263`；portable `--port 5403` → `ok:true, elapsedMs:63178`。
- 打包态：2.6 GB `2026美亚团队` 案件 `m2-ui-check` → `m2ok:true`（842,198 记录、短词 2 字检索走分块预算扫描）；`settings-check --exe` → `ok:true`（体检 8 项含内置 MCP）。
- 注意：跑打包态 e2e 前必须清掉残留 `SeeUForensicsAgentPlus.exe` / `electron.exe --remote-debugging-port=9345`，并隔离 `SEEU_DSH_HOME`/`SEEU_USER_DATA`。

### v0.3.28 回归验证（第 79 轮：记录视图短词提速）

- 产物：NSIS 320,035,211 B（blockmap 332,534 B）、portable 270,626,587 B、`app.asar` 566,526,445 B（32,966 entries）。
- asar 自检 `.probe/asar-0328-check.mjs`：`missing: []`、0 false（新增 `recordsShortScan`、`recordsApproxLabel`）。
- 启动：目录版 `verify-launch --port 5404` → `ok:true, elapsedMs:42642`；portable `--port 5405` → `ok:true, elapsedMs:69958`。
- 打包态：2.6 GB `2026美亚团队` 案件 `m2-ui-check` → `m2ok:true`；`settings-check --exe` → `ok:true`。

### v0.3.29 回归验证（第 81 轮：扫描预算可配置）

- 产物：NSIS 320,042,827 B（blockmap 332,427 B）、portable 270,605,129 B、`app.asar` 566,532,233 B（32,967 entries）。
- **打包白名单坑**：`tools/index-scan-budget.mjs` 被插件以相对路径 import，第一次打包漏了它 → asar 自检报「was not found in this archive」，补进 `electron-builder.yml` 的 `files` 后重新打包才通过（`asarUnpack` 不需要，纯 JS）。
- asar 自检 `.probe/asar-0329-check.mjs`：`missing: []`、0 false。
- 启动：目录版 `--port 5406` → `ok:true, elapsedMs:54761`；portable `--port 5407` → `ok:true, elapsedMs:92140`。
- 打包态：2.6 GB 案件 `m2-ui-check` → `m2ok:true`；`settings-check --exe` → `ok:true`。首次跑打包态 e2e 时曾出现「面板没渲染出来」与 `Get-Clipboard` 失败，均为本机瞬时问题（`profiles/web/package.json.lock` 争用、剪贴板被占用），清理进程后重跑即通过。

### v0.3.30 回归验证（第 84 轮：继续扫描 + 检索乱序修复）

- 产物：NSIS 320,043,066 B（blockmap 332,533 B）、portable 270,570,199 B、`app.asar` 566,534,527 B（32,967 entries）。
- asar 自检 `.probe/asar-0330-check.mjs`：`missing: []`、0 false（新增 `continueScanUi`：clientJs 含 `data-continue-scan`/`继续扫描`/`searchSeq`）。
- 启动：目录版 `verify-launch --port 5408` → `ok:true, elapsedMs:33150`；便携版 `--port 5409` → `ok:true, elapsedMs:48797`。
- 打包态：2.6 GB 案件 `m2-ui-check` → `m2ok:true`（`continueScan:"clicked"`；`idxChainDeepSteps:3` —— 本机当前没有可解析镜像，深检按环境跳过）；`settings-check --exe` → `ok:true`。
- 坑：`m2-ui-check` 的深检若返回「本案件没有可解析的镜像文件」（火眼未开、`C:\hlnet` 未挂载、W: 未挂载时），属环境状态，e2e 现在会带 `idxChainDeepNote` 通过而不是判失败。

### v0.3.31 回归验证（第 86 轮：短词检索续扫）

- 产物：NSIS 320,043,603 B、portable 270,607,335 B、`app.asar` 566,536,241 B（32,967 entries）。
- asar 自检 `.probe/asar-0331-check.mjs`：`missing: []`、0 false（新增 `scanResume`：queryJs 含 `scanFromId`/`scanNextId`、clientJs 含 `scanCursor`）。
- 启动：目录版 `verify-launch --port 5410` → `ok:true, elapsedMs:38309`；便携版 `--port 5411` → `ok:true, elapsedMs:49457`。
- 打包态：2.6 GB 案件 `m2-ui-check` → `m2ok:true`（`continueScan:"clicked"`、`continueScanResumeHint:true`）；`settings-check --exe` → `ok:true`（`envItemCount:8`、`toolPathsRows:15`、`aboutVersion:0.3.31`）。
- 坑：本机剪贴板被占用时 `Get-Clipboard` 抛 `ExternalException`（请求的文件操作失败），`settings-check` 的两个「复制」断言会失败；已给脚本加 `readClipboard()` 重试 3 次 + 失败时降级为「UI 出现已复制提示」（`envCopyFallback/aboutCopyFallback:true`）。另一个 m2 首跑因残留 `electron.exe` 需先清进程。

### v0.3.32 回归验证（第 87 轮：MCP read_table）

- 产物：NSIS 320,044,373 B、portable 270,561,059 B、`app.asar` 566,536,451 B（32,967 entries）。
- asar 自检 `.probe/asar-0332-check.mjs`：`missing: []`、0 false（新增 `readTableTool`：`app.asar.unpacked/tools/seeu-mcp/server.mjs` 含 `name: 'read_table'` 与 `/table?`）。
- 启动：目录版 `verify-launch --port 5412` → `ok:true, elapsedMs:33815`；便携版 `--port 5413` → `ok:true, elapsedMs:52450`。
- 打包态：作业案件 `m2-ui-check` → `m2ok:true`（`continueScan:"none"`，45k 记录 2 字词一轮扫完，属预期）；`settings-check --exe` → `ok:true`（`envItemCount:8`、`aboutVersion:0.3.32`）。
- 环境变化：原 2026 美亚团队（842k 记录 / 2.65 GB）案件目录已被清理，回归改用 `E:/forensics/honglian/作业_20261118081854I`；`SEEU_CASE_DIR` 与环境变量 `SEEU_SEARCH_WAIT_MS` 可调。

### v0.3.33 回归验证（第 89 轮：实体视图导出 CSV）

- 产物：NSIS 320,044,724 B、portable 270,591,202 B、blockmap 332,513 B、`app.asar` 566,540,000 B（32,967 entries）。
- asar 自检 `.probe/asar-0333-check.mjs`：`missing: []`、0 false（新增 `entityCsvRoute` / `entityCsvButton`）。
- 启动：目录版 `verify-launch --port 5414` → `ok:true, elapsedMs:45907`；便携版 `--port 5415` → `ok:true, elapsedMs:59748`。
- 打包态（作业案件）：`m2-ui-check` → `m2ok:true`；`export-check` → `ok:true`——实体 CSV **4,597 行**、表视图自动选中「图片 Exif（20537）」且表 CSV 20,000 行、记录 CSV 20,000 行，`errors:[]`；`settings-check` → `ok:true`（`envItemCount:8`、`aboutVersion:0.3.33`）。
- 环境：`SEEU_DSH_HOME/index-state.json` 指 `E:/forensics/honglian` 才能扫到作业案件；export-check 的表视图步骤现在按「（N）」自动挑有数据的表，无 typed 表时跳过。

### v0.3.34 回归验证（第 90 轮：检索导出服务端一次取全）

- 产物：NSIS `320,044,841 B`（blockmap 332,503 B）、portable `270,613,750 B`、`app.asar` `566,541,916 B`（32,967 entries）。
- asar 自检 `.probe/asar-0334-check.mjs`：`missing: []`、0 false（新增 `searchCsvRoute` / `searchCsvClient`）。
- 启动：目录版 `115,512 ms`、便携版 `134,027 ms`（首启杀软扫描新 asar，二次启动通常 30 秒内）。
- 打包态（作业案件 `E:/forensics/honglian/作业_20261118081854I`，隔离 `SEEU_DSH_HOME`/`SEEU_USER_DATA`）：
  - `m2-ui-check` → `m2ok:true`（45,237 条记录，`errors:[]`）；
  - `search-filter-check`（自动关键词 `2022`）→ `ok:true`（命中 1,057 条、导出 CSV 6 行）；
  - `settings-check` → `ok:true`（`aboutVersion:0.3.34`、`envItemCount:8`、`errors:[]`）。
- 新增验证点：检索结果导出走 `/seeu-index/export/search.csv`，短词时 `x-seeu-partial:1` 且提示「未扫完可先继续扫描」。

### v0.3.35 回归验证（第 91 轮：检索导出超时保护）

- 产物：NSIS `320,045,019 B`（blockmap 332,581 B）、portable `270,629,817 B`、`app.asar` `566,542,664 B`（32,967 entries）。
- asar 自检 `.probe/asar-0335-check.mjs`：`missing: []`、0 false（新增 `searchExportTimeout`）。
- 启动：目录版 `39,343 ms`、便携版 `55,580 ms`。
- 超时保护实测（dev 路由 curl，作业案件 `q=20`）：`maxMs=3000` → 6,600 行 / 3.07 s / `timed-out=1`；`maxMs=20000` → 14,971 行 / 11.06 s / 完整。
- 打包态三探针：`m2-ui-check` `m2ok:true`（45,237 条）、`search-filter-check` `ok:true`（1,057 命中、导出 6 行）、`settings-check` `ok:true`（0.3.35、体检 8 项）。

### v0.3.36 回归验证（第 92 轮：MCP export_records）

- 产物：NSIS `320,046,047 B`、portable `270,608,448 B`、`app.asar` `566,542,877 B`（32,967 entries）。
- asar 自检 `.probe/asar-0336-check.mjs`：`missing: []`、0 false（新增 `exportRecordsTool`）。
- 打包版 MCP 服务端（`ELECTRON_RUN_AS_NODE` 跑 `app.asar.unpacked/tools/seeu-mcp/server.mjs`）：`tools/list` 返回 **8 个**工具（含 `export_records`），退出码 0、stderr 空。
- 启动：目录版 `41,951 ms`、便携版 `59,815 ms`。
- 打包态：`m2-ui-check` `m2ok:true`（45,237 条）、`settings-check` `ok:true`（0.3.36、体检 8 项）。

### v0.3.37 回归验证（第 93 轮：MCP export_records 按表导出）

- 产物：NSIS `320,046,262 B`（blockmap 332,523）、portable `270,629,047 B`、`app.asar` 见 `release/win-unpacked/resources/app.asar`。
- asar 自检 `.probe/asar-0337-check.mjs`：32,967 entries、`missing: []`、0 false（新增 `exportTableTool`）。
- 打包版 MCP 服务端独立验证：`export_records {table:'web_visit',max:100}` → 44 行 / 5,607 B 落盘，退出码 0。
- 启动：目录版 `43,613 ms`、便携版 `60,654 ms`。
- 打包态：`m2-ui-check` `m2ok:true`（45,237 条）、`settings-check` `ok:true`（0.3.37、体检 8 项）。

### v0.3.38 回归验证（第 94 轮：MCP export_entities）

- 产物：NSIS `320,046,528 B`（blockmap 332,551）、portable `270,617,740 B`、`app.asar` `566,543,106 B`（32,967 entries）。
- asar 自检 `.probe/asar-0338-check.mjs`：`missing: []`、0 false（新增 `exportEntitiesTool`）。
- 打包版 MCP 服务端：`tools/list` 9 个工具；`export_entities {max:20}` → 20 行 / 实体总数 4,597（截断），exit 0。
- 启动：目录版 `49,225 ms`、便携版 `66,220 ms`。
- 打包态：`m2-ui-check` `m2ok:true`（45,237 条）、`settings-check` `ok:true`（0.3.38 / 体检 8 项）。

### v0.3.39 回归验证（第 95 轮：MCP export_timeline）

- 产物：NSIS `320,047,024 B`（blockmap 332,479）、portable `270,608,581 B`、`app.asar` `566,543,329 B`（32,967 entries）。
- asar 自检 `.probe/asar-0339-check.mjs`：`missing: []`、0 false（新增 `exportTimelineTool`）。
- 打包版 MCP 服务端：`tools/list` 10 个工具；`export_timeline {bucket:'month'}` → 40 行 / `2000-11 ~ 2022-05` / 10,156 条记录，exit 0。
- 启动：目录版 `41,081 ms`、便携版 `61,271 ms`。
- 打包态：`m2-ui-check` `m2ok:true`（45,237 条）、`settings-check` `ok:true`（0.3.39 / 体检 8 项）。

### v0.3.40 回归验证（第 96 轮：面板「最近导出」卡片）

- 产物：NSIS `320,036,804 B`（blockmap 332,465）、portable `270,629,485 B`、`app.asar` 见 `release/win-unpacked/resources/app.asar`（32,968 entries）。
- asar 自检 `.probe/asar-0340-check.mjs`：`missing: []`、0 false（新增 `exportsDirModule` / `exportsRoute` / `exportsCard` / `exportsIpc`）。
- 启动：目录版 `35,729 ms`、便携版 `60,712 ms`。
- 打包态：`m2-ui-check` 第一次（全新 home，冷启动）出现 `treeRoot/treeFilter*` 间歇失败，重跑即 `m2ok:true`（`exportsCard:true`、`exportsApi.dir` 指向 `.dev/pk-exp340`）；`settings-check` `ok:true`（0.3.40 / 体检 8 项）。
- 打包白名单坑（再次踩到）：`tools/export-dir.mjs` 被插件 import，必须同步加进 `electron-builder.yml` 的 `files`，否则打包版 `/exports` 路由 404。
- 磁盘坑：D: 盘只剩 432 MB 时 portable 压缩失败（`7za.exe process failed 2`），清掉 `release-0*` 旧目录后正常。

### v0.3.41 回归验证（第 97 轮：最近导出支持打开与删除）

- 产物：NSIS `320,038,109 B`（blockmap 332,072）、portable `270,575,774 B`、`app.asar` `566,555,540 B`（32,968 entries）。
- asar 自检 `.probe/asar-0341-check.mjs`：`missing: []`、0 false（新增 `exportsOpenRemove`：主进程含 `seeu:exports:open-file`/`seeu:exports:remove` 与 `removeExport`、插件含 `/exports/remove`、面板含 `data-export-open`/`data-export-remove`）。
- 启动：目录版 `7,225 ms`、便携版 `66,114 ms`。
- 打包态：`m2-ui-check`（作业案件 45,237 条，`SEEU_EXPORT_DIR` 指向探针目录）→ `m2ok:true`、`exportsCard:true`、`exportsRemoveOk:true`、`errors:[]`；`settings-check` → `ok:true`（`aboutVersion:0.3.41`、体检 8 项）。
- 坑：`src/main.ts` 首次没 import `export-dir.mjs`，IPC 里 `removeExport is not defined` 通过 `errors` 数组暴露（页面提示「Error invoking remote method」）；补 import 后通过。

### v0.3.42 回归验证（第 98 轮：导出文件名带案件标签 + 最近导出来源）

- 产物：NSIS `320,038,793 B`（blockmap 332,100）、portable `270,558,161 B`、`app.asar` `566,557,069 B`（32,968 entries）。
- asar 自检 `.probe/asar-0342-check.mjs`：`missing: []`、0 false（新增 `exportsCaseTag`；`searchCsvButton`/`entityCsvButton` 断言改查 `exportBase('检索导出'` / `exportBase('实体导出'`）。
- 启动：目录版 `39,418 ms`（首启杀软扫描）、便携版 `60,579 ms`。
- 打包态：`m2-ui-check` → `m2ok:true`（`exportsSources:{count:2,mcp:1,panel:1}`、`exportsRemoveOk:true`、`errors:[]`）；`settings-check` → `ok:true`（0.3.42 / 体检 8 项）；`export-check` → `ok:true`，文件名 `记录导出-作业_20261118081854I-20261123-051507.csv`（20,000 行）、`表导出-图片 Exif-作业_20261118081854I-…csv`（20,000 行）。
- 断言维护注意：客户端把文件名改成 `exportBase(...)` 拼接后，asar 自检里查旧字面量（`'检索导出-'`）会误报，需同步改成新写法。

### v0.3.43 回归验证（第 99 轮：MCP 导出文件名带案号 + 来源筛选）

- 产物：NSIS `320,039,178 B`（blockmap 332,002）、portable `270,590,329 B`、`app.asar` `566,558,028 B`（32,968 entries）。
- asar 自检 `.probe/asar-0343-check.mjs`：`missing: []`、0 false（新增 `exportsFilter`/`mcpExportCaseTag`；`exportTableTool`/`exportEntitiesTool`/`exportTimelineTool` 断言改为查 `exportBaseName(...)`）。
- 启动：目录版 `39,426 ms`（首启杀软扫描）、便携版 `59,051 ms`。
- 打包态：`m2-ui-check` → `m2ok:true`（`exportsFilterSources:{count:1,mcp:1,panel:0}`、`exportsFilterOk:true`、`exportsRemoveOk:true`、`errors:[]`）；`settings-check` → `ok:true`（0.3.43 / 体检 8 项）。
- 单测：`npm test` 250/250（新增 `tests/mcp-export-name.test.mjs`：假索引服务 + stdio 调 `export_records`，断言文件名 `seeu-mcp-records-20261118081854I-<戳>.csv` 与 BOM）。

### v0.3.44 回归验证（第 100 轮：同名导出自动加序号）

- 产物：NSIS `320,046,722 B`（blockmap 332,656）、portable `270,604,199 B`、`app.asar` `566,554,855 B`（32,968 entries）。
- asar 自检 `.probe/asar-0344-check.mjs`：`missing: []`、0 false（`uniqueExportNaming` 检查 `mainJs` 含 `uniqueExportPath` 且 `app.asar.unpacked/tools/export-dir.mjs` 存在）。
- **打包白名单 bug（第二次踩）**：MCP 服务端新增 `import { uniqueExportPath } from '../export-dir.mjs'`，但 `tools/export-dir.mjs` 只在 `files`、没进 `asarUnpack` → 打包版 `app.asar.unpacked/tools/export-dir.mjs` 不存在，MCP 启动即失败；`electron-builder.yml` 的 `files` 里还被我重复写了一行。修法：`files` 去重 + `asarUnpack` 加 `- tools/export-dir.mjs`；重新打包后实测打包版 MCP server（`ELECTRON_RUN_AS_NODE` + 假索引服务）可 `initialize`/`tools/list`，`export_records`/`export_entities`/`export_timeline` 齐全、stderr 为空。
- 启动：目录版 `38,504 ms`（首启杀软扫描）、便携版 `60,870 ms`。
- 打包态：`m2-ui-check` → `m2ok:true`（`exportsFilterOk:true`、`exportsRemoveOk:true`、`errors:[]`）；`settings-check` → `ok:true`（0.3.44 / 体检 8 项）。
- 单测：`npm test` 250/250（`tests/export-dir.test.mjs` 6 例含 `-2`/`-3` 序号；`tests/mcp-export-name.test.mjs` 断言文件名与 BOM）。

### v0.3.45 回归验证（第 101 轮：最近导出「只看本案件」）

- 产物：NSIS `320,047,023 B`（blockmap 332,661）、portable `270,587,673 B`、`app.asar` `566,556,172 B`（32,968 entries）。
- asar 自检 `.probe/asar-0345-check.mjs`：`missing: []`、0 false（新增 `exportsCaseFilter`；`exportsFilter` 断言随过滤表达式改动更新为查 `exportsFilter === 'all'`）。
- 启动：目录版 `38,099 ms`（首启杀软扫描）、便携版 `61,812 ms`。
- 打包态：`m2-ui-check` → `m2ok:true`（`exportsCaseFilter.count:1`、`exportsCaseOk:true`、`errors:[]`）；`settings-check` → `ok:true`（0.3.45 / 体检 8 项）。
- 单测：`npm test` 250/250。

### v0.3.46 回归验证（第 102 轮：MCP 检索短词续扫）

- 产物：NSIS `320,047,258 B`（blockmap 332,709）、portable `270,593,827 B`、`app.asar` `566,556,172 B`（32,968 entries）。
- asar 自检 `.probe/asar-0346-check.mjs`：`missing: []`、0 false（新增 `mcpSearchScanResume`，检查 unpacked 的 `server.mjs` 含 `scanFromId` schema、转发与「下一轮续扫起点」提示）。
- 启动：目录版 `38,775 ms`、便携版 `61,944 ms`。
- 打包态：`m2-ui-check` → `m2ok:true`（`exportsCaseOk:true`、`errors:[]`）；`settings-check` → `ok:true`（0.3.46 / 体检 8 项）。
- 单测：`npm test` 251/251（新增 `tests/mcp-search-scan.test.mjs`）。

### v0.3.47 回归验证（第 103 轮：「最近导出」合计体积）

- 产物：NSIS `320,047,559 B`（blockmap 332,645）、portable `270,620,347 B`、`app.asar` `566,556,718 B`（32,968 entries）。
- asar 自检 `.probe/asar-0347-check.mjs`：`missing: []`、0 false（新增 `exportsTotal`）。
- 启动：目录版 `37,182 ms`、便携版 `58,688 ms`。
- 打包态：`m2-ui-check` → `m2ok:true`（`exportsTotalText:"共 2 个 · 合计 16 B"`、`exportsTotalOk:true`）；`settings-check` → `ok:true`（0.3.47 / 体检 8 项）。
- 单测：`npm test` 252/252（export-dir 7 例含合计体积）。

