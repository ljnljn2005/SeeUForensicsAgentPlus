# 逆向分析案例

## 案例 1：BYD 车机加密日志（AES-256 + 算法逆向）

**产物**：两个 AES-256 加密 ZIP（各 117 文件）+ 同目录 `BydLogTool.apk`。

### 侦查
文件名 `All2025-03-06-21-37-59+0800_713639_2025030621_1.zip`：
- 时间戳 `2025-03-06 21:37:59 +0800`
- IMEI6 = `713639`（IMEI 末 6 位）
- 内部时间 `2025030621`（yyyyMMddHH）
- `_1` 后缀 = 旧工具版本

zip 检查：`flag_bits & 0x0001` 置位，`compress_type == 99` → AES。标准库 `zipfile` 无法解 → 用 `pyzipper`。

### 反编译
```bash
jadx -d out/ BydLogTool.apk
rg -n "generatePwd|Cipher|AES" out/sources/com/byd/bydlogtool/
```
定位到 `utils/CipherManager.java` 的 `generatePwdByIMEI(imei, mCreateCipherTime)`。

### 算法还原
关键发现：
- IV 硬编码 `1995020213467928`
- AES 密钥 = `imei6 + MMddyyyyHH`
- 明文 = `yyyyddMMHH + imei6`（**日在月前**，故意的）
- 末步：XOR 两段 base64 子串，再 base64

```python
from gen_pwd import gen_pwd_by_imei
pwd = gen_pwd_by_imei("713639", "2025060321")  # yyyyddMMHH
# → 'ADMAfS8B'
```

### 验证
```bash
python scripts/zip_crack.py test <zip> ADMAfS8B
# → OK: extracted first entry (1511 bytes)
python scripts/zip_crack.py extract <zip> ADMAfS8B extracted/
# → 117/117 OK
```

### 教训
`_1` 后缀 + 空注释 = 旧 zip4j 弱密钥派生（AES + 固定 IV + IMEI 派生密钥）。新版（`_2+`）可能用 PBKDF2，需不同思路。

---

## 案例 2：ZipCrypto 弱加密暴力破解

针对非 AES 的弱 ZipCrypto 压缩包：

```bash
python scripts/zip_crack.py brute target.zip wordlist.txt
```

候选词表优先尝试（从文件名/元数据派生）：
- 设备号、时间戳、日期变体
- 应用名大小写 + 数字
- 通用弱口令：`123456`、`admin`、`password`、`<appname>123`

---

## 案例 3：定位 APK 硬编码 API key

```bash
jadx -d out/ app.apk
rg -n "api[_-]?key|secret|token|Bearer |sk_live_|pk_live_" out/sources/
rg -n "api[_-]?key|secret" out/resources/
```

密钥常藏在 `res/values/strings.xml` 或 `BuildConfig.java`。用 `scripts/parse_apk_crypto.py` 自动扫描所有加密用法和硬编码密钥。

---

## 案例 4：解析未知日志格式

1. 采样 50 行：`head -50 log.txt`
2. 识别重复结构：时间戳、事件名、键值对
3. 按事件类型建正则，锚定最独特字符串
4. 全文件测试，统计匹配数，合理性检查
5. 输出 JSON：`{ts, key, value, label, file}`
6. 多监听器记录同一事件时按 `(ts, key, value)` 去重

---

## 案例 5：原生 so 库字符串提取

```bash
strings -n 8 libnative.so | rg "AES|key|secret|http|JNI_"
python scripts/strings_dex.py app.apk --min 8 --filter "key|secret"
```

定位 JNI 入口后用 IDA/Ghidra 反编译对应 Java native 方法。

---

## 案例 6：GPS 轨迹可视化 + 坐标纠偏

原始 Android GPS 是 WGS-84，画在 GCJ-02 高德瓦片上会偏移约 400 米。

```bash
python scripts/wgs2gcj.py conv 30.66 104.06
# 输出 GCJ-02 坐标和偏移量

python scripts/wgs2gcj.py batch input.json output.json
# 批量转换 [{lat, lon, ...}, ...]
```

可视化时务必：
1. 转换坐标
2. 提供切换开关（纠偏 / 原始）让用户验证对齐
3. 速度渐变着色轨迹
4. 朝向旋转的车标图标
5. 事件脉冲动画

详见 `reference.md` §viz 的可视化模板。
