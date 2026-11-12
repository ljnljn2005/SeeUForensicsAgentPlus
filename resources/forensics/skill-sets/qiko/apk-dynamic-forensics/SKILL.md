---
name: APK 动态取证
description: 在已启动的雷电实例上分析 Android APK（Android 9+，开启 ROOT 和 ADB）；自动交互、抓包、研判通信并输出证据报告。依赖 apk-dynamic-mcp 0.4.0，工具随包提供。触发词：APK动态分析、模拟器抓包、APP动态取证。
name_en: APK Dynamic Forensics
description_en: Analyze APK runtime behavior in an existing running LDPlayer instance (Android 9+, ROOT and ADB enabled). Automate UI, capture traffic and report evidence using bundled tools. Requires apk-dynamic-mcp 0.4.0.
name_ru: Динамическая экспертиза APK
description_ru: Анализ APK в запущенном LDPlayer (Android 9+, ROOT и ADB). Автоматизация интерфейса, захват трафика и отчёт по доказательствам. Инструменты включены в apk-dynamic-mcp 0.4.0.
agent_created: true
disable: false
---

# APK dynamic forensics

## Default rhythm

```text
hub locate/export ONE APK if needed → apk_env_check → begin → install → capture/interact → analyze → report → end.
Stay on this APK/runtime task; do not fan out into whole-phone exam tables from this skill.
```

Use the user's **already installed and running LDPlayer**. Require Android SDK 28+ (Android 9+), x86-64, ROOT and ADB debugging. Require LDPlayer 9.0.73.6 or newer (including later LDPlayer 9 and LDPlayer 14), official website https://www.ldmnq.com/.

Never download, install, launch, reset, close or remove an emulator. There is no managed environment panel or download-source configuration. ADB is supplied by the selected LDPlayer installation. tcpdump, tshark and the pinned UiAutomator2 control JAR are bundled with the MCP. Never fetch a latest control component or ask the user to find the analysis binaries manually.

Write all user-visible explanations, questions and the report in the current UI locale, following Qiko's LLM output-language policy. Keep raw evidence values unchanged.

## Workflow

1. **Check:** call `apk_env_check`. Missing emulator: give the official download link. Installed but stopped: ask the user to start it. Unsupported LDPlayer or Android: require LDPlayer 9.0.73.6 or newer and Android 9+ (SDK 28+), x86-64. Missing ROOT/ADB: explain the setting. Missing bundled tools: ask the user to update the MCP. Stop until the reported condition is resolved; never claim a partial environment is ready.
2. **Select:** if `INSTANCE_SELECTION_REQUIRED`, show the returned instance names and ask the user to choose. Use its exact `instanceId` in the next check and begin calls. Never choose arbitrarily or operate a phone. A single instance is selected automatically.
3. **Begin:** call `apk_analysis_begin` with the chosen `instanceId` when required. This binds one boot identity and acquires a whole-task lease, prepares its control connection and checks real screenshot/UI, capture and parser capabilities. Only begin success permits sample installation.
4. **Install:** call `apk_install { apkPath }`. `APP_ALREADY_INSTALLED` means pause and ask whether to replace or use another instance. `replaceExisting: true` requests a real Qiko user-confirmation dialog; it does not approve replacement itself. Never uninstall, clear data or fabricate consent. To switch instances, end the current task first, then check/begin the chosen instance.
5. **Capture and interact:** call `apk_capture_start`, retain its `captureId`. Read `apk_device_control { action: 'screen_state' }` before acting. Use `list_tools` to inspect exact `android_*` schemas. Walk the app flow, record test accounts and important UI responses, save `screenshot` evidence. Respect user intervention. Frida and TLS pinning bypass are not bundled capabilities.
6. **Fix evidence and analyze:** call `apk_capture_stop { captureId }`. Retain its path and SHA256. Pull failure keeps the same capture ID for recovery. Call `apk_analyze_pcap { pcapPath }`, read its saved JSON and assess TCP/UDP peers, DNS, HTTP parameters, TLS SNI and protocol statistics. Parser failure is not evidence of zero communication.
7. **Report and end:** save `apk-dynamic-report.md` in the task workspace, then call `apk_analysis_end`. On cancellation or failure, preserve partial findings and explicitly end when the original device is reachable. Keep the emulator and all app data; clean only this analysis's capture/control resources.

## Interruption and evidence

- One analysis at a time. `ANALYSIS_BUSY` requires the other task to end; never switch devices to work around it.
- Disconnection or changed boot identity means interruption. Preserve existing files and recovery records; do not retry writes or restart the app automatically. Reconnect the original instance, preserve available evidence and end the old task before a new analysis.
- Do not restart/update the MCP during an active capture. Qiko can reconnect only to explicitly recover/end the recorded task.
- Original APK is read-only. Conclusions require artifact paths, timestamps and SHA256. A runtime experiment does not replace static exhibit examination.
- An existing instance may contain previous app data. Record that initial condition and any user-approved replacement; never describe it as a clean baseline.

## Report contents

Include sample filename/hash/package/version; LDPlayer instance, Android SDK, ABI, ROOT and tool versions; initial app-data condition; timeline with screenshot evidence; observed peers/DNS/HTTP/TLS and C2 reasoning; crashes/anti-emulator behavior; conclusions with uncertainty; and a path/time/SHA256 evidence manifest. Use the current UI language for headings and narrative. Match artifact paths exactly to saved files.

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
