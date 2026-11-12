# 逆向分析参考

加密算法、通用正则目录、坐标数学、可视化模式的详细参考。

## 加密

### AES/CBC 密钥派生（通用模板）

许多应用用「设备号 + 时间戳」派生 AES 密钥。通用 Python 复现模板：

```python
import base64
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

# 固定 IV、盐、常量 —— 从反编译源码原样照抄，不要重新生成
IV = b"<16-byte-IV-from-source>"
DEFAULT_PASSWORD = "<fallback-password>"  # 派生失败时的兜底

def derive_key(device_id, timestamp, fmt="yyyyMMddHH"):
    """通用密钥派生模板，按目标算法调整拼接顺序和格式。"""
    # 1. 解析时间戳（注意目标代码的字段顺序，可能是 yyyyddMM 而非 yyyyMMdd）
    # 2. 拼接 AES 密钥（常见：device_id + formatted_time）
    # 3. 拼接明文（常见：formatted_time + device_id）
    # 4. AES/CBC 加密
    # 5. 后处理（XOR、Base64、截取等）
    raise NotImplementedError("按目标算法逐行翻译")
```

**关键原则**：
- 看似 bug 的逻辑常是故意的（如 `yyyyddMM` 日在月前），不要"修正"
- 固定 IV / 盐 / 常量原样照抄
- 第一次失败先尝试交换参数顺序

### 识别加密类型

```python
import zipfile
with zipfile.ZipFile(f) as zf:
    info = zf.infolist()[0]
    encrypted = bool(info.flag_bits & 0x0001)
    aes = info.compress_type == 99   # WinZip AES
```

- `compress_type == 99` → AES（需 `pyzipper`）
- `compress_type in (8,9,12,14)` 且 encrypted → ZipCrypto（标准库可暴力）
- 扩展字段含 `0x9901` → AES-256（zip4j 变体）

### Java 加密签名（grep 关键词）

```
Cipher.getInstance("AES/CBC/PKCS5Padding")
Cipher.getInstance("AES/GCM/NoPadding")
SecretKeySpec(key, "AES")
IvParameterSpec(iv)
MessageDigest.getInstance("MD5"|"SHA-1"|"SHA-256")
Mac.getInstance("HmacSHA256")
KeyGenerator.getInstance("AES")
SecureRandom
PBKDF2WithHmacSHA1
```

### 常见混淆模式

| 模式 | 破解方法 |
|------|---------|
| Base64(XOR(s1, s2)) | 复现 s1/s2 索引，XOR 后 base64 解码 |
| 两步：AES 后 XOR 子串 | 反序：先 XOR 再 AES 解密（同密钥） |
| 硬编码 16 字节 IV | 原样复制，无熵 |
| 密钥 = 设备号 + 时间戳 | 复现派生，无需暴力 |
| 白盒 AES | 查表还原，需动态分析辅助 |

## 正则

### 通用日志解析正则

所有模式锚定时间戳前缀 `(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})`（按目标格式调整）。

**通用键值对**：
```python
# key=value 形式
r"(\w+)=(\S+)"
# key: value 形式
r"(\w+):\s*(\S+)"
# JSON 字段
r'"(\w+)":\s*"([^"]*)"'
r'"(\w+)":\s*(\d+(?:\.\d+)?)'
```

**状态变更**：
```python
# onXxxChanged area=N state=M
r"on(\w+)Changed.*?area\s*[=:]\s*(\d+).*?state\s*[=:]\s*(\d+)"
# onXxxChanged value=N
r"on(\w+)Changed.*?value\s*[=:]\s*([\-\d.]+)"
```

**事件类型 + 值**：
```python
r"postEvent.*?event_type\s*=\s*([0-9a-fA-F]+).*?value\s*=\s*([\-\d.]+)"
```

### 通用 GPS / 定位模式

| 来源 | 正则 | 坐标系 |
|------|------|--------|
| 标准日志 | `lat=([-\d.]+)&lon=([-\d.]+)` | 通常 WGS-84 |
| JSON | `"latitude":\s*([-\d.]+),\s*"longitude":\s*([-\d.]+)` | 视来源 |
| NMEA | `\$GPGGA,\d+,[\d.]+,[NS],[\d.]+,[EW]` | WGS-84 |
| 显式声明 | `locationSystem=(\w+)` | 按 token 解释 |

**默认假设**：无显式声明时，原始 GPS = WGS-84。

## 坐标数学

### WGS-84 → GCJ-02（中国偏移）

国测局标准算法。每个 GPS 点画到高德/Google 中国瓦片前必须转换。

```python
import math
PI = 3.1415926535897932384626
A = 6378245.0
EE = 0.00669342162296594323

def out_of_china(lng, lat):
    return lng < 72.004 or lng > 137.8347 or lat < 0.8293 or lat > 55.8271

def _transform_lat(x, y):
    r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 2*math.sqrt(abs(x))
    r += (20*math.sin(6*x*PI) + 20*math.sin(2*x*PI)) * 2/3
    r += (20*math.sin(y*PI) + 40*math.sin(y/3*PI)) * 2/3
    r += (160*math.sin(y/12*PI) + 320*math.sin(y*PI/30)) * 2/3
    return r

def _transform_lng(x, y):
    r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*math.sqrt(abs(x))
    r += (20*math.sin(6*x*PI) + 20*math.sin(2*x*PI)) * 2/3
    r += (20*math.sin(x*PI) + 40*math.sin(x/3*PI)) * 2/3
    r += (150*math.sin(x/12*PI) + 300*math.sin(x/30*PI)) * 2/3
    return r

def wgs2gcj(lng, lat):
    if out_of_china(lng, lat):
        return lng, lat
    d_lat = _transform_lat(lng - 105, lat - 35)
    d_lng = _transform_lng(lng - 105, lat - 35)
    rad_lat = lat * PI / 180
    magic = math.sin(rad_lat)
    magic = 1 - EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    d_lat = (d_lat * 180) / ((A * (1 - EE)) / (magic * sqrt_magic) * PI)
    d_lng = (d_lng * 180) / (A / sqrt_magic * math.cos(rad_lat) * PI)
    return lng + d_lng, lat + d_lat
```

**JS 版本**（浏览器内转换）：运行 `python scripts/wgs2gcj.py js` 输出。

### GCJ-02 → BD-09（百度）

```python
def gcj2bd(lng, lat):
    x_pi = 3.14159265358979324 * 3000.0 / 180.0
    z = math.sqrt(lng*lng + lat*lat) + 0.00002 * math.sin(lat * x_pi)
    theta = math.atan2(lat, lng) + 0.000003 * math.cos(lng * x_pi)
    bd_lng = z * math.cos(theta) + 0.0065
    bd_lat = z * math.sin(theta) + 0.006
    return bd_lng, bd_lat
```

### 两点间方位角

```python
import math
def heading(lat1, lon1, lat2, lon2):
    """从点 1 到点 2 的方位角，0-360 度。"""
    phi1, phi2 = map(math.radians, (lat1, lat2))
    d_lambda = math.radians(lon2 - lon1)
    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1)*math.sin(phi2) - math.sin(phi1)*math.cos(phi2)*math.cos(d_lambda)
    return (math.degrees(math.atan2(y, x)) + 360) % 360
```

## 可视化模式

### 速度渐变色

```javascript
function speedColor(s, max=80) {
  const t = Math.min(1, s/max);
  const r = Math.round(34 + (239-34)*t);   // 34 -> 239
  const g = Math.round(197 + (19-197)*t);  // 197 -> 19
  const b = Math.round(94 + (68-94)*t);    // 94 -> 68
  return `rgb(${r},${g},${b})`;
}
```

### SVG 仪表盘（3/4 圆，0..max）

```html
<svg viewBox="0 0 120 120" style="transform:rotate(135deg)">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#22c55e"/>
    <stop offset="0.5" stop-color="#eab308"/>
    <stop offset="1" stop-color="#ef4444"/>
  </linearGradient></defs>
  <circle cx="60" cy="60" r="50" fill="none" stroke="#334155" stroke-width="10"
          stroke-dasharray="236 314"/>
  <circle id="gaugeFg" cx="60" cy="60" r="50" fill="none"
          stroke="url(#g)" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="0 314"/>
</svg>
```

更新：`gaugeFg.setAttribute('stroke-dasharray', (frac*236)+' 314')`，`frac = value/max`。

### 朝向旋转的图标

```html
<svg width="30" height="30" viewBox="0 0 30 30">
  <g id="arrowG" transform="rotate(0 15 15)">
    <path d="M15 2 L8 22 L15 18 L22 22 Z" fill="#4363d8" stroke="#fff" stroke-width="1.5"/>
  </g>
</svg>
```

更新：`arrowG.setAttribute('transform', 'rotate(' + heading + ' 15 15)')`。

### 事件脉冲动画

```css
.ev-marker.pulse { animation: evpulse .8s; }
@keyframes evpulse {
  0% { transform: scale(1); }
  50% { transform: scale(2.5); }
  100% { transform: scale(1); }
}
```

## 工具安装

```bash
# Python 依赖
pip install pycryptodome pyzipper

# jadx（APK 反编译）—— https://github.com/skylot/jadx/releases
# 加入 PATH 或设 JADX_HOME 环境变量

# apktool（smali 兜底）—— https://ibotpeaches.github.io/Apktool/

# ripgrep 快速搜索
winget install BurntSushi.ripgrep.MS

# 原生库分析
# IDA / Ghidra / radare2（任选其一）
```
