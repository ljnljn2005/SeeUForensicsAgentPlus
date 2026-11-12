# IDA export-for-ai 分析参考

## 场景速查

| 场景 | 优先读 | 关注点 |
|------|--------|--------|
| 逆向题 / 登录校验 | strings → 含提示串的 `.c` | 比较分支、硬编码密钥、变换表 |
| 恶意软件 | imports → strings(URL/IP) → 网络/加密函数 | C2、持久化、注入、反沙箱 |
| 漏洞挖掘 | imports(危险 API) → 调用方 `.c` | strcpy/sprintf/memcpy 长度约束 |
| 协议/算法还原 | 收发包函数 → crypto API / 自定义循环 | 字段偏移、endian、KDF |
| APK native | JNI_OnLoad / Java_* 导出 → 加密函数 | 与 Java 层参数对应 |
| 补丁对比 | 两份 export 的关键函数 diff | 条件分支与边界检查变化 |

## 字符串线索正则（示例）

在 `strings.txt` 中优先搜：

```text
password|passwd|login|flag|key|secret|token|AES|RSA|http|https|\.onion|cmd\.exe|powershell
```

命中后用地址在 `pointers.txt` / `decompile` 里反查引用函数。

## 反编译文件头格式

```c
/*
 * func-name: sub_140001000
 * func-address: 0x140001000
 * callers: 0x140002000, 0x140003000
 * callees: 0x140004000
 */
```

分析时先画 1–2 层调用图，再深入叶子算法函数。

## 结论输出模板

交付物写**工作区根**（如 `逆向分析.md`），写完后 `present`。过程证据路径用 `work/<样本名>/export-for-ai/...`。

```markdown
# <样本名> 逆向结论

## 样本
- 路径 / SHA256 / 架构 / 编译器猜测

## 关键发现
1. …（引用：`decompile/XXXX.c` 函数名 + 行为）
2. …

## 证据链
| 结论 | 证据路径 | 地址/符号 |
|------|----------|-----------|
| … | work/<样本名>/export-for-ai/... | 0x... |

## 未决 / 失败
- 反编译 Failed: N；加壳嫌疑；缺符号 …

## 建议下一步
1. …
```

## 授权与安全

- 仅分析授权检材或隔离实验室样本
- **禁止在本机运行或动态调试被分析程序**（防中毒）；结论只来自 IDA 静态导出与只读探测
- 用户要求“跑一下 / 沙箱验证”时：拒绝代为执行，说明本 skill 仅静态；动态分析须另开隔离环境并由人工操作
- 密钥/口令写入报告时按案件脱敏策略处理
- 导出/IDB/日志只进 `work/`，不写检材目录与 `.qikoagent/`
