---
name: apk-reverse
description: 在 CLI 环境下做 Android APK 逆向时使用。适用于 APK 解包、Java 反编译、smali 修改、重打包、Frida 动态 Hook，以及按需切换到 so/native 分析。优先使用本机已安装的 jadx、apktool、frida、adb、ida-reverse、radare2。
---

## ACTION REQUIRED（读完后立刻执行）

> 本仓库交付的 `apk-reverse` **只有本 SKILL.md**（无 `scripts/`、无 bootstrap）。缺 CLI 时不要空转猜路径。

1. `NOW`: 确认任务是授权范围内的 APK 静态/动态分析
2. `NOW`: 在本轮 **tools** 中查找 `mcp__jadx_headless_mcp__*`（用户已挂载 / 设置页已启用且本轮已投影时才会出现）
3. `ACT`: 仅当 tools 已列出上述名字时，立刻调用 `mcp__jadx_headless_mcp__load_apk`，再用 `search_in_code` / `get_class_source` / `get_android_manifest` 等定点分析
4. `FALLBACK`: 若 tools 中无 jadx MCP：**禁止臆造** `mcp__*` 调用。仅当本轮 tools 含 `mcp_manage` 时才可 `mcp_manage(action=test, server_id=jadx-headless-mcp)`；否则引导用户在协作区挂载该连接器或「设置 → 连接器」启用，然后用本机 `jadx`/`apktool` CLI（若 PATH 有）或安全的 dex/字符串扫描——**禁止** curl `http://127.0.0.1:*/mcp`，**禁止** bash/`zipfile` inflate `AndroidManifest.xml`
5. `PATH`: bash 路径一律正斜杠（`E:/work/app.apk`）；Windows 反斜杠会被 Git Bash 吃掉
6. `CLI`: 本机若无 `jadx`/`apktool`/`strings` 在 PATH 中属正常；有 MCP 工具面则优先 MCP，否则 CLI / 安全扫描

# APK 逆向 CLI 作业规范

## 适用范围

当任务属于以下场景时优先使用本 skill：

- 分析 APK 的 Java 业务逻辑
- 定位登录、签名、风控、证书校验、root 检测
- 查看与修改 `AndroidManifest.xml`
- 查看与修改 smali
- 重打包 APK
- 用 Frida 做 Java/native 动态 Hook
- APK 内含 `.so` 时切到 native 分析

## QikoClaw 无头 JADX MCP（首选路径）

交互式 APK 静态分析：当本轮 **tools** 已投影 `mcp__jadx_headless_mcp__*` 时优先用它。主机进程托管 Streamable HTTP（含内置 JRE）；**禁止**用 bash/python 去 curl/探测 `http://127.0.0.1:<port>/mcp`——即使某处测连成功也不等于端口可裸访问，且**不得**在未挂载时臆造工具名。

Agent 工具名（连字符→下划线）：

1. `mcp__jadx_headless_mcp__load_apk` — 加载用户明确提供的 APK 路径（正斜杠）。
2. `mcp__jadx_headless_mcp__current_apk` / `mcp__jadx_headless_mcp__index_status` — 确认样本与索引。
3. `mcp__jadx_headless_mcp__get_android_manifest`、`get_main_activity`、`get_package_tree`、`get_class_source`、`get_smali_of_class`、`search_in_code`、`get_xrefs_*` 等定点分析。

`jadx-headless-mcp` 是第三方 MCP 适配器，不是 JADX 官方发行物；官方项目为 `skylot/jadx`。每个服务实例只有一个当前 APK，切换样本前必须完成当前任务并记录证据路径。

## 官方 JADX CLI（可选开发工具）

官方 CLI 仍用于完整源码/资源落盘、CI 回归、与 apktool 配合的重打包流程以及 headless MCP 故障排查；它不是生产 MCP 的第二运行时。典型命令：

```powershell
jadx -d jadx_out app.apk
```

## 当前机器已验证可用的 CLI 工具

- `jadx` `1.5.5`
- `apktool` `3.0.2`
- `frida-ps` `17.9.6`
- `adb`
- `java`

## 无本地 scripts/ 时的替代

本 skill 目录**不包含** `scripts/*.ps1`。需要脚本时改用：

- DEX 字符串：`reverse-engineering/scripts/strings_dex.py`（参数：`<apk_or_dex> [--min N]`，路径用正斜杠）
- 加密线索：`reverse-engineering/scripts/parse_apk_crypto.py`
- 反编译落盘：仅当本机 PATH 已有 `jadx`/`apktool` 时再 CLI；否则继续用 JADX MCP

如果要分析 `.so`、`lib/arm64-v8a/*.so`、`lib/armeabi-v7a/*.so`，再结合：

- `ida-reverse`
- `radare2`
- 或 Python 提取 so 字符串（勿依赖 GNU `strings`，Git Bash 常无此命令）

## 工具分工

### `jadx`

用于：

- Java 反编译阅读
- 包名、类名、方法名搜索
- 先从高层逻辑理解 APK

常用命令：

```bash
jadx -d jadx_out app.apk
jadx --single-class com.example.LoginActivity -d jadx_out app.apk
jadx --deobf -d jadx_out app.apk
```

### `JEB Pro`（可选商业工具）

用于：

- Android DEX / APK / ARM 的交叉验证与深度反编译
- 在 JADX 输出不完整或混淆较重时补充静态分析
- 对同一目标的类、方法与调用关系进行第二工具链校验

边界：

- JEB Pro 是商业软件，必须由用户自行取得并安装有效许可证；本包不会下载、破解或规避许可。
- 仅在 `tool-index` 已确认本机 JEB 可用时调用；否则继续使用 `jadx`、`apktool`、Ghidra、IDA 或 radare2。
- 第三方 JEB MCP bridge 不是本包依赖。安装前必须按 `../ops/skill-supply-chain.md` 审阅源码、权限、网络行为和版本，再由用户明确确认注册。

### `apktool`

用于：

- 解包 APK
- 查看和修改 `AndroidManifest.xml`
- 查看和修改 smali
- 重建 APK

常用命令：

```bash
apktool d app.apk -o apktool_out
apktool b apktool_out -o rebuilt.apk
```

### `frida`

用于：

- 动态观察 Java 方法调用
- Hook native 导出函数
- 绕过 root 检测、证书校验、调试检测

常用命令：

```bash
frida-ps -U
frida -U -f com.example.app -l hook.js
frida-trace -U -f com.example.app -j '*!*certificate*'
```

### `adb`

用于：

- 设备连接
- 安装 APK
- 查看日志
- 拉取文件

常用命令：

```bash
adb devices
adb install -r app.apk
adb shell pm list packages
adb logcat
adb pull /data/local/tmp/file .
```

## 推荐工作流

### 1. Triage

先确定 APK 大致构成，不急着改包或 Hook。

建议动作：

1. 用 `jadx -d jadx_out app.apk` 导出 Java 代码
2. 用 `apktool d app.apk -o apktool_out` 导出 smali 和资源
3. 先看：
   - `AndroidManifest.xml`
   - 主 `package`
   - `application`、`activity`、`service`、`receiver`
   - `lib/` 目录里是否有 `.so`

### 2. Java 逻辑观察

优先从 `jadx_out` 读：

- `MainActivity`
- `Application`
- 登录、网络、加密、风控相关类
- 第三方 SDK 初始化类

常见关键词：

- `login`
- `sign`
- `encrypt`
- `cipher`
- `token`
- `root`
- `certificate`
- `trust`
- `okhttp`
- `retrofit`
- `webview`

如果 Java 代码可读，先在这里定位业务逻辑。

### 3. Smali 与资源层确认

当 `jadx` 结果不完整、混淆重、或需要实际 patch 时，切到 `apktool_out`：

- 看 `smali*/`
- 看 `res/values/strings.xml`
- 看 `AndroidManifest.xml`

优先 patch：

- `android:exported`
- 调试标记
- root 检测返回值
- 登录验证逻辑
- 证书校验分支

### 4. 重建与安装

修改后：

```bash
apktool b apktool_out -o rebuilt.apk
```

或者直接用脚本闭环：

```powershell
pwsh -File "<skill-root>\apk-reverse\scripts\rebuild-sign-install.ps1" -ProjectDir "apktool_out" -Install -Reinstall -DeviceSerial "127.0.0.1:7555"
```

说明：

- 本 skill 只保证 `apktool` 重建链路
- 若后续需要正式安装到设备，通常还需要签名流程
- 如果任务进入签名/对齐，补充 `apksigner` / `zipalign`

### 5. 动态 Hook

静态分析不足时，用 Frida：

- Hook 登录函数
- Hook `OkHttp` / `Retrofit` / `WebView` 关键点
- Hook `javax.crypto`、`MessageDigest`
- Hook root 检测函数
- Hook SSL pinning 逻辑

原则：

- 先 Hook Java 层，再看是否需要 native Hook
- 先打印参数与返回值，再决定是否主动修改返回值

建议：

- 简单一次性命令直接用 `frida-*`
- 需要稳定复用的注入流程优先走 `scripts/frida-run.ps1`

### 6. Native `.so` 分流

如果 APK 中包含关键 `.so`：

- 用 `apktool` 或 `jadx` 找到 `lib/**/*.so`
- 若只是导出符号、字符串、快速 triage，可用 `radare2`
- 若要长期深入分析、反编译、改名、类型恢复，用 `ida-reverse`

遇到这些信号要尽快切 native：

- Java 层只是 JNI 包装
- 核心签名逻辑不在 Java
- `System.loadLibrary()` 后关键逻辑消失
- 证书校验/风控在 `.so` 中

## 输出要求

最终至少说明：

- 入口组件与关键类
- 关键逻辑在 Java、smali 还是 `.so`
- 已确认的敏感点：登录、签名、root、SSL、WebView、JNI
- 如果做了 patch，说明改了什么
- 如果做了 Hook，说明 Hook 了哪个类/方法/导出函数

## 禁止事项

- 不要一开始就盲目改 smali
- 不要在没看 manifest 和主入口前就写 Hook
- 不要把 Java 反编译不完整直接等同于“逻辑不可分析”
- 不要在 `.so` 明显承载核心逻辑时继续死磕 Java 层

## 快速命令备忘

```bash
# 反编译 Java
jadx -d jadx_out app.apk

# 解包 APK
apktool d app.apk -o apktool_out

# 重建 APK
apktool b apktool_out -o rebuilt.apk

# 设备与进程
adb devices
frida-ps -U

# 启动并注入
frida -U -f com.example.app -l hook.js
```

---

## 路由上下文

**上游入口**: `skills/SKILL.md`（总控）、`routing.md`
**下游出口**:
- 核心逻辑在 `.so` → `ida-reverse/` 或 `radare2/`
- 需动态 Hook/验证 → `reverse-engineering/tools-dynamic.md`（Frida 章节）
- 通用逆向方法论 → `reverse-engineering/SKILL.md`

**同级关联模块**: `reverse-engineering/`（.so 分析和 Frida 进阶用法）

---

## 工具缺失时

本 skill **无** bootstrap 脚本。优先级：

1. 启用并使用 `jadx-headless-mcp`（市场包自带 JRE）
2. 用户本机已装 CLI 时直接调用 `jadx` / `apktool` / `adb` / `frida-ps`
3. 否则明确告知缺工具，引导「设置 → 连接器」安装/启用 jadx MCP；不要空转探测端口


## 任务完成自检（声称完成前 MUST 通过）

- [ ] 我是否执行了工作流中的每一步（而不是只阅读）？
- [ ] 我是否基于 `tool-index` 使用了真实工具路径？
- [ ] 我是否产出了可复现证据（命令/脚本/截图/报告）？
- [ ] 我是否完成并回写了 RULES 要求的 Checklist 项？

## 适用场景

> 本章与既有“适用范围”互补，不覆盖原内容；若两者表述不一致，以授权范围与任务工单为准，并标记待人工裁决。

### 命中本技能的典型任务
- 输入物是 `*.apk`、`*.aab`、`*.dex`、`classes*.zip`、`*.jar`，或从授权设备提取的已安装包。
- 需要确认包名、版本、权限、组件、入口 Activity、主 Application、第三方 SDK、网络域名/URL、签名算法、加密算法、风控/反调试/Root 检测位置。
- 需要对 Java/Kotlin 层做静态阅读、交叉引用、字符串定位、调用链还原。
- 需要在授权设备上做 Frida spawn/attach，观察或修改运行时参数、返回值、异常分支。
- 需要判断关键逻辑是否下沉到 `lib/**/*.so`，并决定是否切到 `ida-reverse`、`radare2`、Ghidra。
- 需要小步 patch：修改 smali、Manifest、资源、配置，重打包、签名、安装并验证行为变化。
- 需要提取密钥、IV、salt、token、证书指纹、常量密码，用于后续解密配置、数据库、资源包、容器镜像或分区镜像；提取过程必须只读、留痕、脱敏。

### 优先使用的信号
- `AndroidManifest.xml` 中出现可疑权限、导出组件、备份标记、调试标记。
- Java 层出现 `SecretKeySpec`、`Cipher`、`MessageDigest`、`Mac`、`KeyStore`、`X509TrustManager`、`HostnameVerifier`。
- 字符串或方法名包含 `login`、`sign`、`encrypt`、`decrypt`、`aes`、`des`、`rsa`、`hmac`、`token`、`certificate`、`ssl`、`pinning`、`root`、`su`、`frida`、`xposed`。
- `System.loadLibrary`、`RegisterNatives`、JNI 导出函数、`.so` 中出现 `Java_` 前缀符号。
- assets/raw/resources 中存在加密文件、二进制配置、protobuf、SQLite、zip/7z/luks/img 等后续容器或分区线索。

### 不建议单独使用本技能的场景
- 目标是独立 PE/ELF/Mach-O、固件、内核模块、驱动、bootloader：应切到通用二进制逆向或固件技能。
- 目标是服务端协议 fuzz、流量中间人、证书安装：需配合网络分析技能。
- 目标要求物理提取、芯片级取证、eMMC/UFS 镜像：需使用取证与硬件技能。
- 无授权、无范围、无法确认设备归属或数据来源：停止执行并升级审批。

## 使用步骤

> 本章为评分补全章节；与既有“推荐工作流”冲突时，以授权、证据保全和任务目标为最高优先级，并标记待人工裁决。

### 0. 前置授权与证据固定
- 确认工单、设备归属、数据范围、是否允许动态修改与重打包。
- 对原始 APK 计算 SHA256，复制为 `case/<id>/input/app.apk`，后续只在副本上操作。
- 动态分析默认只读取证；如需主动调用函数、写文件、改返回值，必须单独批准。

### 1. 目标分流：APK 与 PE
- 输入为 APK/DEX/JAR：继续本技能。
- 输入为 PE：记录编译器、节区、入口点、导入表、字符串、资源、签名信息，并切到 PE 逆向技能。
- APK 内嵌 PE/ELF/固件镜像：先提取再分流，不要直接改包。

```bash
file app.apk
unzip -l app.apk
jadx -d out/jadx app.apk
apktool d app.apk -o out/apktool
```

PE 初查：

```bash
file target.exe
strings -n 8 target.exe > strings.txt
```

### 2. 静态反编译与包结构阅读
- 先看 `AndroidManifest.xml`：package、version、permissions、exported、backup、debuggable、main activity。
- 多 dex 场景不要只看第一个 `classes.dex`，应覆盖 `classes*.dex`。
- 用 jadx 读高层逻辑，用 apktool 保留 smali 与资源，便于后续 patch。
- Kotlin 项目关注 `Metadata`、`$Companion`、coroutine、inline class 等编译器产物。
- 检查 `assets/`、`res/raw/`、`lib/`、`META-INF/`，判断是否存在加密配置、证书、native 库或签名块。

```bash
jadx -d out/jadx --deobf app.apk
apktool d app.apk -o out/apktool
```

### 3. 字符串提取与常量定位
- 优先搜索 URL、域名、路径、密钥别名、盐值、迭代次数、证书指纹、调试开关。
- 对 smali 中的 `const-string`、native 中的 `.rodata`、资源中的 `strings.xml` 做交叉比对。
- 如果字符串稀少或明显加密，不要误判为无价值；应转向动态 Hook 或解密函数定位。

```bash
grep -RInE 'aes|cipher|sign|token|secret|key|iv|salt|login|pinning|root' out/jadx
grep -RIn 'const-string' out/apktool/smali*
strings lib/arm64-v8a/libcore.so > libcore.strings
```

### 4. 加密算法识别
- Java 层重点：`Cipher.getInstance`、`SecretKeySpec`、`IvParameterSpec`、`MessageDigest`、`Mac`、`KeyGenerator`。
- Native 层重点：`Java_` 导出、`JNI_OnLoad`、`getAesKey`、`decrypt`、`encrypt`、`HMAC`、AES S-Box 常量。
- 记录算法、模式、填充、密钥来源、IV 来源、输入输出编码；不要只写“发现加密”。
- 密钥与密码在报告中必须脱敏，只保留长度、哈希、来源偏移或掩码。

```js
Java.perform(() => {
  const Cipher = Java.use('javax.crypto.Cipher');
  Cipher.getInstance.overload('java.lang.String').implementation = function (transformation) {
    console.log('Cipher.getInstance:', transformation);
    return this.getInstance(transformation);
  };
});
```

### 5. 脚本逆向与运行时参数还原
- 使用 `scripts/frida-run.ps1` 统一设备、进程、spawn/attach 入口，避免参数误用。
- 先 Hook Java 层：打印参数、返回值、调用栈；确认稳定后再考虑修改返回值。
- 对重载方法必须显式选择 `overload`，不要假设唯一签名。
- 对动态加载、反射调用、JNI RegisterNatives，需要结合类加载器和导出符号双向定位。

```js
Java.perform(() => {
  const cls = Java.use('com.example.crypto.AesUtil');
  cls.decrypt.overload('java.lang.String', 'java.lang.String').implementation = function (key, data) {
    console.log('key:', key, 'data:', data);
    const ret = this.decrypt(key, data);
    console.log('ret:', ret);
    return ret;
  };
});
```

### 6. gdb 动态调试与密钥提取
- 适用条件：Frida 无法稳定观察 native 状态、需要断点级检查寄存器/内存，或需要复现 `.so` 内部函数。
- 前置要求：授权设备或模拟器、匹配架构的 gdbserver、可读进程、尽量保留符号表；生产证据必须只读。

标准流程：

1. 找到目标进程：

```bash
adb shell ps -A | grep com.example.app
```

2. 附加进程：

```bash
adb shell /data/local/tmp/gdbserver :1234 --attach <pid>
adb forward tcp:1234 tcp:1234
```

3. 在 gdb 中加载符号与共享库路径：

```text
set sysroot ./device_sysroot
set solib-search-path ./libs/arm64
info sharedlibrary
```

4. 定位导出函数并下断：

```text
info functions getAesKey
info functions decrypt
b getAesKey
b decrypt
```

5. 命中后读取参数与返回值：

```text
info registers
x/32xb $x0
x/s $x1
p/x $x0
```

6. 仅在快照或测试进程上，且获得批准时，可主动调用函数：

```text
call (int)getAesKey()
call (void)decrypt(0x7fff1000, 16)
```

7. 保存密钥或缓冲区：

```text
dump binary memory key.bin 0xADDR 0xADDR+32
```

风险与边界：
- attach 会改变时序，可能触发反调试、崩溃或状态漂移。
- 主动 call 可能写入全局状态、破坏证据或触发网络行为；默认禁止。
- 所有密钥、内存 dump、解密产物必须按敏感证据管理，不得写入普通报告。

### 7. 密钥/密码用于后续容器或分区解锁
- 若常量或密码用于解密 assets、配置、数据库、zip/7z、LUKS、ext4 镜像，必须先在副本上验证。
- 记录完整推导链：来源类/函数、编码方式、派生算法、迭代次数、最终用途。
- 对容器/分区解锁优先只读挂载，避免写入原始镜像。

```bash
openssl enc -d -aes-256-cbc -K <hex_key> -iv <hex_iv> -in config.enc -out config.dec
7z x -p'***' archive.7z
cryptsetup open --readonly container.img evidence --key-file key.bin
```

### 8. Smali patch 与重打包验证
- 只做最小 patch：日志、返回值、分支跳转、导出标记、调试标记。
- 修改前保留原始 smali 片段，修改后记录文件、行号、改动原因与验证结果。
- 重建后必须对齐、签名、安装，并用日志或 Frida 验证行为是否变化。

```bash
apktool b out/apktool -o rebuilt.apk
zipalign -p 4 rebuilt.apk aligned.apk
apksigner sign --ks debug.keystore aligned.apk
adb install -r aligned.apk
```

### 9. PE 侧补充路径
- 若任务分流到 PE：先识别编译器与运行时，再看节区、入口点、导入表、资源、字符串。
- .NET 使用 dnSpy/ILSpy；Go 使用 IDA/BinaryNinja 及 Go 插件；PyInstaller 先解包 pyc。
- 功能行为要从导入表反推：网络、加密、文件、注册表、服务、反调试。

### 10. 输出与留痕
- 输出至少包括：目标哈希、入口组件、关键类/函数、逻辑位置、Hook 点、patch 点、密钥来源掩码、验证命令、遗留风险。
- 所有脚本、Frida JS、gdb 记录、重打包产物必须归档到任务目录，保证可复现。

## D2-05

> 本章为 D2-05 补全章节，主题是工具选择与环境准备；与既有“工具分工”互补，不覆盖原内容。若本机版本与下述建议冲突，以 `tool-index` 和授权环境为准，必要时标记待人工裁决。

### 环境准备基线
- Java 11+：apktool、jadx 依赖。
- Python 3.10+：frida-tools、脚本依赖。
- Android platform-tools：adb、fastboot。
- Android Build-Tools：zipalign、apksigner。
- Frida server 必须与设备 ABI、frida-tools 版本匹配；版本不一致会出现连接失败、注入崩溃或符号解析异常。
- 动态分析设备优先使用可控模拟器、工程机或已授权测试机；避免在用户生产设备上直接实验。

### 工具选择矩阵
| 目标类型 | 首选工具 | 备选工具 | 实战说明 |
| --- | --- | --- | --- |
| APK/DEX | jadx、apktool | JEB Pro、Ghidra | jadx 读逻辑，apktool 改 smali 与资源 |
| Android Manifest/资源 | apktool | aapt2、apkanalyzer | 关注权限、导出组件、debuggable、backup |
| native .so | Ghidra、IDA、radare2 | BinaryNinja | 快速 triage 用 radare2，深度分析用 Ghidra/IDA |
| C/C++ ELF | IDA、Ghidra | radare2、BinaryNinja | 优先恢复函数名、类型、交叉引用 |
| Go 二进制 | IDA 8.x 或较新 7.6+ | BinaryNinja、Ghidra + Go 插件 | 旧版 IDA 可能无法正确恢复 pclntab、moduledata 和字符串边界 |
| .NET PE | dnSpy、ILSpy | dotPeek | 优先还原 IL、资源、配置和混淆器类型 |
| PyInstaller | pyinstxtractor | uncompyle/decompyle | 先解包 pyc，再判断 Python 版本与字节码 |
| Rust 二进制 | IDA、Ghidra | BinaryNinja | 先 demangle，再处理 monomorphization 带来的重复函数 |

### Go 程序专项注意
- 不要只依赖 `strings`：Go 字符串常以指针+长度形式存在，且运行时字符串不一定以 C 风格结尾。
- 旧 IDA 可能把 Go 函数识别为碎片或错误签名；应使用支持 Go 的 loader/plugin，或改用 BinaryNinja/Ghidra 的 Go 分析器。
- 若符号被裁剪，优先恢复 `pclntab`、`moduledata`、`runtime` 结构和接口表，再进入业务函数。
- Go 的 TLS、HTTP、crypto 调用经常被静态链接，不能仅凭导入表判断；要通过字符串、结构体和调用图交叉确认。

### 版本与兼容陷阱
- jadx 遇到多 dex、混淆或 OOM 时，可拆分、降线程、关闭资源解析，再用第二工具交叉验证。
- apktool 重建失败常见于资源版本、framework-res 不匹配、smali 语法错误；不要盲目重复构建。
- Frida Hook native 时，若目标使用 linker namespace、anti-frida、seccomp 或 ptrace 保护，应先用 spawn、延迟注入、只读观察，再考虑绕过。
- IDA/Ghidra 分析 ARM64 时注意 PAC、BTI、thumb/arm 切换、JNI 调用约定；错误调用约定会导致参数误判。
- BinaryNinja 适合作为 Go/ELF 的替代方案，但插件版本必须与二进制架构匹配。

### 只读取证要求
- 原始 APK、镜像、内存 dump 必须先哈希，再复制到工作目录。
- 对分区/容器解锁优先 `--readonly`、loop 只读挂载或快照；禁止直接写入原始证据。
- 密钥、密码、证书私钥、内存敏感区必须脱敏存储；报告中只写来源、长度、掩码和验证结果。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
