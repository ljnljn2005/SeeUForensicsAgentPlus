---
name: rev-u3d-dump
description: "Dump Unity IL2CPP symbols from iOS/Android builds. Extract method names, addresses, and type info from IL2CPP binaries and global-metadata.dat, then generate IDA/Ghidra import scripts."
version: 1.0.0
author: Local
compatibility: [prompthub]
---
---
name: rev-u3d-dump
description: Dump Unity IL2CPP symbols from iOS/Android builds. Extract method names, addresses, and type info from IL2CPP binaries and global-metadata.dat, then generate IDA/Ghidra import scripts.
---

# rev-u3d-dump - Unity IL2CPP Symbol Dumper

Extract C# method names, addresses, and type definitions from Unity IL2CPP builds for IDA/Ghidra analysis.

---

## Overview

Unity IL2CPP compiles C# to native code. The original class/method names are stripped from the binary but preserved in `global-metadata.dat`. This skill recovers the mapping between native function addresses and their original C# names.

### Key Files in Unity Build

| File | Location | Purpose |
|------|----------|---------|
| Native binary | iOS: `Frameworks/UnityFramework.framework/UnityFramework`<br>Android: `lib/{arch}/libil2cpp.so` | Compiled C# code (Mach-O / ELF) |
| Metadata | `Data/Managed/Metadata/global-metadata.dat` | All type/method/string info |

---

## Tool Selection

### Il2CppDumper (recommended for metadata v39+)

Use the **v39 fork** for Unity 6+ builds:

- Repo: `https://github.com/roytu/Il2CppDumper` (branch: `v39`)
- Supports metadata v24–v39
- Outputs `script.json` with function addresses — ready for IDA/Ghidra import

The original Il2CppDumper (`https://github.com/Perfare/Il2CppDumper`) only supports up to v29.

### Cpp2IL (alternative)

- Repo: `https://github.com/SamboyCoding/Cpp2IL`
- Supports metadata v39, but dummy DLLs lack `[Address]` attributes
- Useful for C# source reconstruction, not ideal for IDA import

---

## Step-by-Step Workflow

### Step 1: Locate IL2CPP Files

**iOS (IPA):**
```bash
# Unzip IPA
unzip -o app.ipa -d .

# Binary
BINARY="Payload/<AppName>.app/Frameworks/UnityFramework.framework/UnityFramework"

# Metadata
METADATA="Payload/<AppName>.app/Data/Managed/Metadata/global-metadata.dat"
```

**Android (APK):**
```bash
# Unzip APK
unzip -o app.apk -d .

# Binary (pick target arch)
BINARY="lib/arm64-v8a/libil2cpp.so"

# Metadata
METADATA="assets/bin/Data/Managed/Metadata/global-metadata.dat"
```

### Step 2: Check Metadata Version

```bash
# First 8 bytes: magic (4) + version (4), little-endian
xxd -l 8 "$METADATA"
# Expected: af1b b1fa 2700 0000  → magic OK, version = 0x27 = 39
```

| Version | Unity | Tool |
|---------|-------|------|
| ≤ 29 | Unity 2021 and earlier | Original Il2CppDumper |
| 31 | Unity 2022 | Original Il2CppDumper (partial) |
| 39 | Unity 6 (6000.x) | **roytu/Il2CppDumper v39 fork** |

### Step 3: Build & Run Il2CppDumper (v39 fork)

```bash
# Clone v39 fork
git clone -b v39 https://github.com/roytu/Il2CppDumper.git

# Build
cd Il2CppDumper
DOTNET_ROLL_FORWARD=LatestMajor dotnet build -c Release

# Run (use net8.0 framework)
DOTNET_ROLL_FORWARD=LatestMajor dotnet run \
  --project Il2CppDumper/Il2CppDumper.csproj \
  -c Release --framework net8.0 \
  -- "$BINARY" "$METADATA" output_dir
```

**Notes:**
- `DOTNET_ROLL_FORWARD=LatestMajor` allows running on .NET 9/10 even though the project targets .NET 6/8
- Exit code 134 is normal in non-interactive mode (caused by `Console.ReadKey()` at the end)
- On macOS, if the binary gets SIGKILL'd, ad-hoc sign it: `codesign -s - <binary>`

### Step 4: Verify Output

Successful run produces these files in the output directory:

| File | Size (typical) | Purpose |
|------|----------------|---------|
| `script.json` | 50–100 MB | Function addresses + names + signatures (IDA/Ghidra import) |
| `dump.cs` | 10–30 MB | C# class dump with RVA/VA addresses |
| `il2cpp.h` | 50–100 MB | C struct definitions for type import |
| `ida_py3.py` | ~2 KB | IDA Python import script |

Check `script.json` format:
```json
{
  "ScriptMethod": [
    {
      "Address": 40865744,
      "Name": "ClassName$$MethodName",
      "Signature": "ReturnType ClassName__MethodName (args...);",
      "TypeSignature": "viii"
    }
  ]
}
```

Check `dump.cs` format:
```csharp
// RVA: 0x1A2B3C4 Offset: 0x1A2B3C4 VA: 0x1A2B3C4
public void MethodName() { }
```

### Step 5: Import into IDA

1. Open the native binary in IDA (UnityFramework / libil2cpp.so)
2. Place `script.json` and `ida_py3.py` in the same directory
3. `File → Script file...` → select `ida_py3.py`
4. The script reads `script.json` and renames all functions automatically
5. Optional: `File → Load file → Parse C header file...` → select `il2cpp.h` for struct types

### Step 5 (alt): Import into Ghidra

1. Open the binary in Ghidra
2. Use the `ghidra.py` or `ghidra_with_struct.py` script from Il2CppDumper
3. `Window → Script Manager → Run` with `script.json` in the same directory

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `not a supported version[39]` | Using original Il2CppDumper | Switch to roytu/Il2CppDumper v39 fork |
| Exit code 137 (SIGKILL) | macOS unsigned binary | `codesign -s - <binary>` |
| `Cannot read keys` (exit 134) | Non-interactive console | Ignore — dump completed successfully |
| `DOTNET_ROLL_FORWARD` error | .NET version mismatch | Set `DOTNET_ROLL_FORWARD=LatestMajor` |
| Empty output | Wrong binary/metadata pair | Verify both files are from the same build |

---

## Output Usage Tips

- `dump.cs` is the quickest reference — search for class/method names with RVA addresses
- `script.json` Address values are decimal — convert to hex for IDA: `hex(40865744)` → `0x26F8FD0`
- Field offsets in `dump.cs` (e.g., `// 0x20`) are relative to object base, useful for memory inspection with Frida

## 适用场景（D2-01）

### 典型任务
- 对 iOS/Android Unity IL2CPP 包进行符号恢复，将 `libil2cpp.so` 或 `UnityFramework` 中的匿名函数恢复为 C# 类名、方法名、签名与 RVA/VA。
- 在 IDA/Ghidra 中建立可阅读的分析基线：函数重命名、结构体导入、类型字段偏移、字符串与类方法交叉引用。
- 用于安全审计、漏洞定位、反外挂分析、协议还原、支付/登录/授权逻辑审查、隐私合规检查与恶意 Unity 样本分析。

### 适合输入
- 已取得未加密或已脱壳的 IPA/APK/AAB/XAPK，并能同时定位 native binary 与 `global-metadata.dat`。
- 目标为 IL2CPP 构建，而不是 Mono 构建；若 `Managed/Metadata` 下存在 `global-metadata.dat`，通常可尝试本技能。
- 需要批量恢复函数名和类型信息，而非仅查看少量字符串或资源。

### 不适合或需谨慎
- 目标仅包含 AssetBundle、Lua、HybridCLR、热更新 DLL 或 Mono 程序集；此时应优先分析热更层，而不是直接 dump IL2CPP。
- `global-metadata.dat` 被自定义加密、XOR、压缩、拆分或迁移到内存中；需要先完成解包、解密或运行时 dump。
- iOS FairPlay 未脱壳、Android 加固/壳保护、SO 加壳、反调试保护未处理；直接静态 dump 可能失败或输出错误映射。
- 需要完整 C# 源码级还原时，本技能只能恢复符号与结构，不能还原方法体、局部变量、控制流和注释；可结合 Cpp2IL、dnSpy、ILSpy 等做辅助判断。

### 实操顺序建议
1. 先固定证据：记录包哈希、解包目录、架构、metadata 版本、binary 类型与大小。
2. 再校验配对：确认 `global-metadata.dat` 与 native binary 来自同一次构建，避免版本错配导致地址错位。
3. 先产出 `dump.cs` 与 `script.json`，再导入 IDA/Ghidra；不要在没有符号映射前盲目重命名或打补丁。
4. 导入后先抽查高频类：`MonoBehaviour`、`GameObject`、`NetworkManager`、`PlayerPrefs`、支付/登录相关类，确认地址和签名合理。
5. 对关键函数建立快照、注释与交叉引用，再进行协议、加密、反作弊或漏洞分析。

### 领域判断
- 若 `dump.cs` 中大量方法 RVA 为 0 或地址超出二进制范围，优先怀疑 metadata 与 binary 不匹配、架构选错或 metadata 被加密。
- 若 Android 包存在多个 `lib/{arch}`，应选择与设备或分析目标一致的架构；不同架构的地址不可混用。
- 若 iOS 包存在多架构 fat binary，先用 `lipo` 拆分目标 slice，再导入符号，避免 IDA/Ghidra 基址与符号错位。

## D2-04 工具选择与环境准备

> 本节为对现有 Tool Selection 的补充；如与原文已有推荐发生冲突，保留原文优先并标记为待人工裁决。

### 按目标类型选择反编译/符号恢复工具
| 目标类型 | 首选工具 | 备选工具 | 实战要点 |
|---|---|---|---|
| Unity IL2CPP C# native | roytu/Il2CppDumper v39 fork；旧 metadata 用原版 Il2CppDumper | Cpp2IL、Il2CppInspector | 先确认 metadata version，再决定分支；Unity 6 优先 v39 fork |
| C/C++ native plugin | IDA Pro + Hex-Rays | Ghidra、Binary Ninja | 关注 C++ RTTI、虚表、stripped symbols 与调用约定 |
| Go backend/native service | 较新版 IDA Pro + GoReSym/Go loader | Binary Ninja + Go plugins、Ghidra + Golang extensions | Go 1.18+ pclntab/模块数据变化较快；旧版 IDA 或旧插件可能无法正确恢复函数边界与字符串 |
| Objective-C/Swift | IDA ObjC/Swift support、class-dump、swift-demangle | Ghidra、Hopper | 注意 Swift metadata 与 Objective-C runtime 符号差异 |
| Java/Kotlin + JNI | jadx/JEB + IDA/Ghidra 分析 JNI SO | apktool、Ghidra | DEX 层与 native 层要分别建立映射，避免符号混淆 |

### Go 二进制的特别限制
- 不要把 Go 二进制当作普通 C/C++ 程序处理；Go 的函数边界、调用约定、字符串结构和运行时符号都有专门格式。
- 若 IDA 版本过旧或 Go 插件未更新，可能无法解析新版 Go 的 pclntab、moduledata 或 build info，导致函数名缺失、地址错位和交叉引用断裂。
- 字符串恢复不能只依赖通用 strings 工具；Go 字符串通常不是 C 风格 null-terminated，而是带长度字段的结构体，需要借助 Go 类型恢复、GoReSym 或专用脚本。
- 当 IDA 环境受限时，可用 Binary Ninja 作为替代方案，尤其是批量脚本化提取函数名、字符串引用和交叉引用；但仍需验证 Go 版本兼容性。

### 环境准备清单
- .NET SDK：建议 8+；运行 Il2CppDumper v39 fork 时设置 `DOTNET_ROLL_FORWARD=LatestMajor`，兼容更高版本运行时。
- Python：IDA 导入脚本需匹配 IDA 的 IDA Python 版本；Ghidra 脚本需匹配 Ghidra 版本。
- 解包工具：`unzip`、`apktool`、`lipo`、`file`、`xxd`；iOS 包需关注 `Payload` 路径，Android 包需关注 `lib` 与 `assets` 路径。
- 校验工具：`sha256sum`、`xxd`、`readelf`/`objdump`/`rabin2`；用于确认文件来源、架构、节区和 metadata 版本。
- 平台修复：macOS 下若二进制被 SIGKILL，先执行 `codesign -s - <binary>`；非交互终端下 exit 134 通常可忽略。

### 工具选择原则
- 本技能的核心是 IL2CPP metadata 到 native 地址的映射；只要目标是 Unity IL2CPP，应优先完成 metadata dump，再进入通用反编译。
- 若目标包中同时包含 Go、C++、Objective-C、Java/Kotlin 组件，应为每类二进制建立独立符号表，不要把 IL2CPP 符号强行套用到非 IL2CPP 库。
- 若工具输出明显异常，先回到输入校验：架构是否一致、metadata 是否加密、文件是否同包、版本是否匹配；不要反复重跑工具掩盖根因。
- 若本节与原文 Tool Selection 中已有推荐存在不一致，本节仅作为扩展参考，冲突项应标记为待人工裁决。

## D2-05 输入输出说明

### 输入
| 输入 | 必填 | 说明 |
|---|---|---|
| IPA/APK/AAB/XAPK 或已解包目录 | 是 | 需要能读取 `Payload`、`lib`、`assets` 或等价目录 |
| native binary | 是 | iOS 为 `UnityFramework`，Android 为 `libil2cpp.so`；必须与 metadata 来自同一构建 |
| `global-metadata.dat` | 是 | 通常以 `AF 1B B1 FA` 开头；版本字段决定工具分支 |
| 目标架构 | 是 | 如 `arm64-v8a`、`armeabi-v7a`、`x86_64`；不同架构输出不可混用 |
| 运行环境 | 是 | .NET SDK、Python、IDA/Ghidra；缺少环境会导致构建或导入失败 |
| 基址/ASLR 信息 | 否 | 手动导入或核对地址时用于校正 RVA/VA |

### 输出
| 输出 | 用途 | 验收点 |
|---|---|---|
| `script.json` | IDA/Ghidra 函数重命名 | 非空，ScriptMethod 数量与包规模匹配，Address 位于可执行段范围 |
| `dump.cs` | 人工检索类、方法、字段 | 含 RVA/Offset/VA，类名与方法名可搜索 |
| `il2cpp.h` | 导入结构体、枚举、类型定义 | 结构体数量非零，导入后字段偏移可用于数据恢复 |
| `ida_py3.py` / Ghidra scripts | 自动化导入 | 在目标二进制上运行无致命异常 |
| 运行日志/错误码 | 排障与复盘 | exit 134 可接受；137 需处理签名；其他错误需定位 |

### 关键字段解释
- `Address`：十进制地址，导入前可转十六进制；手动核对时需确认其为 RVA、VA 或文件偏移。
- `Name`：通常为 `ClassName$$MethodName`；`$$` 是 IL2CPP 方法符号的常见分隔形式。
- `Signature` / `TypeSignature`：用于辅助识别参数和返回类型，但不能完全替代反编译器的类型推断。
- `dump.cs` 中的 RVA/Offset/VA 可能因平台、加载基址和工具版本而表现不同；以导入脚本的解释结果为准。

### 质量验收步骤
1. 检查 metadata magic 与 version，确认不是 0、空文件或异常截断文件。
2. 检查 binary 与 metadata 的哈希、路径和包来源，确认来自同一次构建。
3. 检查输出文件大小；`script.json`、`dump.cs`、`il2cpp.h` 过小通常代表 dump 失败或输入异常。
4. 在 IDA/Ghidra 中抽查入口函数、导出函数、Unity 生命周期函数，例如 `Awake`、`Start`、`Update`。
5. 检查是否存在大量同名函数、地址为 0、地址超出 `.text`/`__text` 范围或导入后函数名未变化。
6. 对关键业务类做交叉引用验证：URL、API path、加密常量、支付参数、设备标识字段。

### 边界与限制
- 若 `global-metadata.dat` 被加密、压缩、拆分或自定义版本化，直接 dump 可能失败；需要先完成解密或运行时提取。
- 若 IL2CPP 进行了代码裁剪，部分 C# 方法只会保留声明，不会对应真实函数体。
- 若目标使用定制保护、metadata 混淆或反 dump，可能需要逆向 metadata 解析流程或从内存中恢复。
- 本技能不保证恢复所有字符串；IL2CPP 字符串可能以 UTF-16、常量表、加密表或运行时构造形式存在。
- 大量符号导入会显著增加 IDA/Ghidra 数据库体积；建议先备份工程，必要时按模块分批导入。

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
