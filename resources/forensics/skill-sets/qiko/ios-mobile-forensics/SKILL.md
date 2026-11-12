---
name: iOS 手机取证
description: >-
  iPhone 提取包取证/答题：IMEI/ICCID/Apple ID、Wi-Fi、IM、AirDrop、Safari、相册 GPS
  等。整案未结构化时优先整检材技能。触发词：iPhone取证、美亚杯手机、iOS提取包。
metadata:
  clawdbot:
    emoji: 📱
    requires:
      anyBins:
        - python
        - exiftool
        - sqlite3
    os:
      - linux
      - darwin
      - win32
name_en: iOS Mobile Forensics
name_ru: Мобильная экспертиза iOS
description_en: >-
  iOS mobile forensics exam for iPhone extract packages: device IDs, Wi-Fi, IM, AirDrop, Safari,
  album GPS, etc. Prefer whole-exhibit triage if the case is still unparsed.
description_ru: >-
  Экспертиза извлечений iPhone: IMEI/ICCID/Apple ID, Wi‑Fi, IM, AirDrop, Safari, GPS альбома и др.
  Если дело ещё не разобрано — сначала triage всего носителя.
---

# iOS Mobile Electronic Data Forensics

## Default rhythm

```text
hub prepare / myos-exam-phone structured hit first when available
  → lock the stem’s primary module path → read that artifact only
  → format close-out.
Path map below is layer-2 (when platform miss). Do not script-run every module at open.
Tool shapes → ../qiko-forensic-lite-investigate/references/tool-call-recipes.md (Solve rhythm).
```

## Navigation

```text
qiko-forensic-lite-investigate (hub if needed)
  → myos-exam-phone (platform-first exam chain)
  → THIS SKILL (iOS path map / templates)
  → forensic-sqlite-exam (single DB deep dive)
```

Structured analysis for iPhone forensic images (filesystem-level extracts). Covers common electronic data forensics phone questions: device identity, wireless, IM, file transfer, photo media, browser, and AI chat records. Paths below are validated on real iOS extract packages (e.g. `CHAN_MH_mobile.zip` / `FUNG_CC_mobile.zip`).

## When to Use

- Analyze iPhone forensic images (`.zip` / `.tar` extracts with `var/`, `Manifest.plist`, etc.)
- Answer electronic data forensics individual or team competition questions
- Extract device identity: IMEI (possibly multiple), ICCID, Apple ID, Bluetooth address, serial, iOS version, hotspot name
- Reconstruct Wi-Fi history, SSID, first connection time, login key (password)
- Analyze IM: WhatsApp (account/groups/channels/communities/polls/admins), WeChat (WeChat ID / Channels), QQ
- Trace file transfer: AirDrop, Send Anywhere (`com.estmob.paprika`), SHAREit (`com.lenovo.anyshare`) — send/receive records, device IDs, direction
- Inspect photos: HEIC/MOV/JPG/GIF, screenshot counts, cross-app storage, GPS (WGS84), original filenames
- Extract Safari bookmarks, search keywords, downloads
- Prefer platform/Qiko structured results when hub/`myos-exam-phone` already parsed the exhibit; use this path map only for the modules the stem needs
- Reconstruct AI chat (e.g. POE): prompt text, bot, username, timestamps
- Batch generate or parse Meiya Cup question templates (9 columns)

## Exhibit structure (filesystem-level extract)

Typical top-level layout of an iOS forensic zip:

```
iDevice_info.txt                              # Device identity & baseband (fastest hit)
Manifest.plist / Manifest.db_DEC              # Backup manifest (app/file path map)
                                              # Encrypted BackupKeyBag password → itunes-backup-password-recover
var/
  preferences/                                # System plists (Wi-Fi, wireless, etc.)
    com.apple.wifi.known-networks.plist
    SystemConfiguration/com.apple.wifi.plist
  keychains/
    keychain-backup.plist                     # Keychain (passwords, tokens)
  mobile/
    Applications/<BundleID>/                  # Per-app sandboxes
      group.net.whatsapp.WhatsApp.shared/     # WhatsApp (ChatStorage.sqlite)
      com.tencent.xin/                        # WeChat
      com.estmob.paprika/                     # Send Anywhere
      com.lenovo.anyshare/                    # SHAREit
      systemgroup.com.apple.bluetooth/        # Bluetooth DB
    Library/
      AddressBook/                            # Contacts
      CallHistoryDB/CallHistory.storedata     # Call history
      Safari/Bookmarks.db, History.db         # Safari
      Preferences/com.apple.*.plist
    Media/PhotoData/Photos.sqlite            # Photos database
```

### Step 1: Always read `iDevice_info.txt` first

Device-identity questions (IMEI, ICCID, Bluetooth, iOS version, hotspot name) usually hit this file directly — no DB needed:

```bash
# After unpack, read device identity
python - <<'PY'
import re
txt = open("CHAN_MH_mobile/iDevice_info.txt", encoding="utf-8", errors="replace").read()
keys = ["HumanReadableProductVersionString","InternationalMobileEquipmentIdentity",
        "InternationalMobileEquipmentIdentity2","IntegratedCircuitCardIdentity",
        "BluetoothAddress","DeviceName","ModelNumber","MLBSerialNumber"]
for k in keys:
    m = re.search(rf"^{k}:\s*(.+)$", txt, re.M)
    if m:
        print(f"{k:42s} = {m.group(1).strip()}")
PY
```

Example output (maps to Q2–Q9 style questions):

```
HumanReadableProductVersionString = 17.1.1          # iOS version
InternationalMobileEquipmentIdentity  = 357328098205226   # IMEI group 1
InternationalMobileEquipmentIdentity2 = 357328099153748   # IMEI group 2 → 2 groups total
IntegratedCircuitCardIdentity         = 89852122206020998419  # ICCID
BluetoothAddress                      = f8:38:80:bb:f5:28    # Bluetooth address
DeviceName                            = iPhone                # Personal hotspot name
```

> Note: IMEI may appear in multiple fields (dual SIM / eSIM). Count all `InternationalMobileEquipmentIdentity*` fields for "how many IMEI groups".

## Module checklist

### 1. Device and identity

| Artifact | Source |
|---|---|
| iOS version | `iDevice_info.txt` → `HumanReadableProductVersionString` |
| IMEI (multiple) | `iDevice_info.txt` → `InternationalMobileEquipmentIdentity*` |
| ICCID | `iDevice_info.txt` → `IntegratedCircuitCardIdentity` |
| Bluetooth address | `iDevice_info.txt` → `BluetoothAddress` |
| Apple ID | Keychain `var/keychains/keychain-backup.plist` (search `@` email / `appleid`) |
| Personal hotspot name | `iDevice_info.txt` → `DeviceName`; or `com.apple.mobilehotspot.plist` |

```python
# Extract Apple ID candidates from keychain plist (pip install biplist or use plistlib)
import plistlib, re
data = plistlib.load(open("var/keychains/keychain-backup.plist","rb"))
blob = str(data).lower()
for m in set(re.findall(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", blob)):
    print("Possible Apple ID:", m)
```

### 2. Wireless (Wi-Fi / Bluetooth)

```bash
# Known Wi-Fi networks (SSID as top-level key: wifi.network.ssid.<SSID>)
python - <<'PY'
import plistlib
d = plistlib.load(open("var/preferences/com.apple.wifi.known-networks.plist","rb"))
ssids = [k.replace("wifi.network.ssid.","") for k in d if k.startswith("wifi.network.ssid.")]
print("Known SSIDs:", ssids)   # Option not in list = "never connected"
PY
```

- **Never-connected SSID**: infer from known-network list (questions often give options — pick the one absent).
- **First connection time / login key**: `com.apple.wifi.plist` or known-networks time/key fields; keychain after decrypt may show plaintext password.
- **Bluetooth paired / nearby devices**: SQLite under extract `Images/DB/` (or `var/mobile/Applications/systemgroup.com.apple.bluetooth/Library/Database/`):
  - `com.apple.MobileBluetooth.ledevices.paired.db` → table `PairedDevices` (`Uuid`, `Name`, `Address`, …) — often empty
  - `com.apple.MobileBluetooth.ledevices.other.db` → table `OtherDevices` — **device-name → UUID questions usually hit here**
  - Query: `SELECT Uuid, Name, Address FROM OtherDevices WHERE Name LIKE '%ELK-BLEDOM%';` (also try `PairedDevices`)
  - Do **not** look for these under os-case `MApps.mfs` / `Platform.mfs` first.

### 3. Instant messaging

#### 3.1 WhatsApp (`group.net.whatsapp.WhatsApp.shared`)

Core DB: `ChatStorage.sqlite`. **Schema varies by version** — iOS 17 verified below (older builds may use `ZWCHAT`/`ZWMESSAGE`/`ZWGROUPMEMBER`/`ZWCONTACT`; run `.tables` first):

```bash
sqlite3 "var/mobile/Applications/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite" ".tables"
```

**iOS 17 verified schema (real extract packages):**

| Artifact | Table / field |
|---|---|
| Sessions / group names | `ZWACHATSESSION`: `Z_PK`, `ZCONTACTJID` (group `@g.us` or contact), `ZPARTNERNAME` |
| Messages / direction / time | `ZWAMESSAGE`: `ZFROMJID`, `ZTOJID`, `ZISFROMME` (1=sent), `ZTEXT`, `ZMESSAGEDATE` (NSDate), `ZCHATSESSION` |
| Members / admins | `ZWAGROUPMEMBER`: `ZMEMBERJID`, `ZISADMIN` (1=admin), `ZCHATSESSION` |
| Group metadata / creator | `ZWAGROUPINFO`: `ZCHATSESSION`, `ZCREATIONDATE` (NSDate), `ZCREATORJID`, `ZOWNERJID` |
| Contact push names | `ZWAPROFILEPUSHNAME`: `ZJID`, `ZPUSHNAME` |
| Polls | Version-dependent (e.g. `ZWAPOLLITEM`); probe with `SELECT name FROM sqlite_master WHERE name LIKE '%POLL%'` |

```bash
# Admins of group "Investors" (ZISADMIN=1 = admin)
sqlite3 ChatStorage.sqlite \
  "SELECT m.ZMEMBERJID FROM ZWAGROUPMEMBER m
     JOIN ZWACHATSESSION s ON m.ZCHATSESSION=s.Z_PK
   WHERE s.ZPARTNERNAME LIKE '%Investors%' AND m.ZISADMIN=1;"
# Group JID and creation time (NSDate offset 978307200 -> Unix)
sqlite3 ChatStorage.sqlite \
  "SELECT s.ZCONTACTJID, datetime(i.ZCREATIONDATE+978307200,'unixepoch','+8 hours')
     FROM ZWAGROUPINFO i JOIN ZWACHATSESSION s ON i.ZCHATSESSION=s.Z_PK
   WHERE s.ZPARTNERNAME LIKE '%Investors%';"
```

- **WhatsApp ID format**: personal `xxxxxxxx@s.whatsapp.net`, group `xxxx@g.us`.
- **Self ID**: cross-check "You" contact `ZCONTACTJID` with top `ZCREATORJID`; recipient frequency alone is skewed by group traffic.
- **Community icon SHA256**: export icon file and `sha256sum` against options.
- **Left / inactive groups**: check `ZPARTNERNAME` and remaining members in `ZWACHATSESSION` / member tables.
- **iOS timestamp conversion** (NSDate from 2001-01-01 UTC):

```python
from datetime import datetime, timezone, timedelta
def nsdate_to_gmt8(ns):
    # ns: WhatsApp ZTIMESTAMP (seconds since 2001-01-01)
    base = datetime(2001,1,1,tzinfo=timezone.utc)
    return (base + timedelta(seconds=ns) + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S")
print(nsdate_to_gmt8(754388454))   # example
```

#### 3.2 WeChat (`com.tencent.xin`)

```bash
# Locate WeChat data dir (MD5 hash subdirs)
ls "var/mobile/Applications/com.tencent.xin/Documents/"   # e.g. a1c9cfc3.../
```

- **WeChat ID**: `wxid_xxxxxxxx` form, common in `MM.sqlite` / WCDB contact DBs.
- **Channels follow count**: subscription counts in WeChat DBs.
- WeChat DBs are usually SQLite (`.sqlite` / `.db`); inspect with `sqlite3`.

#### 3.3 QQ and others

QQ sandbox: `com.tencent.mqq`. Chat DBs are often encrypted SQLite — need matching key or decrypt tool.

### 4. File transfer (AirDrop / Send Anywhere / SHAREit)

| App | Bundle ID | Key locations |
|---|---|---|
| AirDrop | `com.apple.Sharing.AirDropUI` | System logs / `com.apple.sharingd` DB |
| Send Anywhere | `com.estmob.paprika` | `Library/com.estmob.sendanywhere.sdk.database.realm`, `Library/audio.realm` |
| SHAREit | `com.lenovo.anyshare` | `Documents/.shareit/*.db` (`adcs.db`, `beyla.db`) |

Exam-style points:
- **Did files send/receive**: transfer / history records in app DBs.
- **Attribute fidelity**: device **ID** and device **name** are different fields — submit only the attribute the stem asks for (never name when it asks for ID, or vice versa).
- **Send Anywhere (`paprika`)**: prefer `DeviceInfoEntity` / related transfer entities on the **stem-named exhibit**; read the named field (`deviceId`, `deviceName`, …) **verbatim** (case/spaces/symbols).
- **Local vs peer**: disambiguate with roles on that exhibit (e.g. `osType`, transfer side), not by picking a memorable display name.
- **Corroboration only**: another phone/image may expose alternate ID schemas (prefs / numeric ids, etc.) — use for cross-check; the fill answer must match the stem exhibit’s original field text unless the stem explicitly asks for the other schema.
- **Direction**: sender vs receiver.
- **Mode**: e.g. `SEND_DIRECTLY` / `SEND_BYCLOUD` / `SEND_BLUETOOTH`.
- **File type**: from extension (IMG_*.HEIC, *.zip, *.mov).

### 5. Photos and media (`Photos.sqlite`)

Path: `var/mobile/Media/PhotoData/Photos.sqlite` (may have `-wal`).

```bash
sqlite3 Photos.sqlite ".tables"        # ZASSET, ZADDITIONALASSET, ZGENERICALBUM, etc.
# Original filename + created time + GPS
sqlite3 Photos.sqlite "SELECT ZFILENAME, ZDATECREATED, ZLATITUDE, ZLONGITUDE FROM ZASSET LIMIT 20;"
```

Points:
- **Screenshot count**: `ZASSET` with `ZKIND` / `ZMEDIATYPE` marking screenshot.
- **GIF source app**: `ZADDITIONALASSET` → `ZORIGINATINGAPP` / source bundle.
- **Cross-app storage**: same media in Photos (`com.apple.mobileslideshow`) and Files (`com.apple.DocumentsApp`) — match filename (e.g. `IMG_0010.MOV`).
- **Original filename**: camera apps (e.g. Discreet) may keep name (`DiscreetCameraApp_1744790959352.png`) then rename to `IMG_0079.JPG`.
- **GPS (WGS84)**: `ZLATITUDE` / `ZLONGITUDE` or EXIF.

```bash
# GPS from media via exiftool (WGS84)
exiftool -GPSLatitude -GPSLongitude "var/mobile/Media/PhotoData/..." 2>/dev/null
```

### 6. Safari

```bash
sqlite3 "var/mobile/Library/Safari/Bookmarks.db" "SELECT COUNT(*) FROM bookmarks;"   # bookmark count
sqlite3 "var/mobile/Library/Safari/History.db" \
  "SELECT url FROM history_visits JOIN history_items ON ...;"                        # search/visit
```

- **Bookmark count**, **search keywords**, **download count** from `Bookmarks.db` / `History.db`.

### 7. AI chat (POE, etc.)

```bash
ls "var/mobile/Applications/" | grep -i poe     # locate bundle (e.g. com.quora.poe)
```

Extract: full prompt text, bot (e.g. `gpt4_1_mini`), username (e.g. `Duncan`), timestamp. Usually in sandbox `Documents/*.sqlite` or Realm; sort by time for earliest/relevant record.

## Question template format (Meiya Cup)

For batch generate/parse. Excel row 1 = instructions, row 2 = header, fixed 9 columns:

```
题目名称(必填) | 题目描述 | 题目分数(必填) | 题目类型(必填) | 题目难度(必填) |
题目选项(选项间用英文分号分隔) | 题目答案(部分类型必填) | 答题时间(分) | 题目序号
```

- **题目类型**: `单选` / `多选` / `判断` / `问答` / `填空` / `报告`
- **题目难度**: `初级` / `中级` / `高级`
- **题目类别**: `实操` / `理论`
- **实操环境**: `互联网` / `专网` / `互联网和专网`
- **Multi-select**: options separated by `;`; answers by `,` (e.g. `B,C,D`).
- **Date/time answers**: prefix with `【'】` (full-width quote brackets) to preserve text; **GMT+8**, format `yyyy-MM-dd HH:mm:ss`.
- **Fill-in-blank**: exact exhibit text — case, spaces, symbols matter.

### Read/validate template with Python

```python
import xlrd  # .xls only; use openpyxl for .xlsx
wb = xlrd.open_workbook("2025美亚杯个人赛赛题.xls")
ws = wb.sheet_by_name("试题模板")
header = [ws.cell(1,c).value for c in range(9)]   # row 2 = header
for r in range(2, ws.nrows):
    name, desc, score, qtype, diff, opts, ans, minutes, seq = [ws.cell(r,c).value for c in range(9)]
    if not name: 
        continue
    print(f"#{int(seq)} [{qtype}/{diff}] {name}")
    if qtype == "多选":
        print("   options:", opts.split(";"), "answer:", ans.split(","))
```

> When generating questions, fill the 9-column structure in reverse; keep row 1 instructions and row 2 header.

## Quick lookup: question → location

| Question phrasing | Check first |
|---|---|
| OS / iOS version | `iDevice_info.txt` → `HumanReadableProductVersionString` |
| IMEI count / correct IMEI | `iDevice_info.txt` → `InternationalMobileEquipmentIdentity*` |
| ICCID | `iDevice_info.txt` → `IntegratedCircuitCardIdentity` |
| Apple ID | Keychain `keychain-backup.plist` |
| Bluetooth address | `iDevice_info.txt` → `BluetoothAddress` |
| Personal hotspot name | `iDevice_info.txt` → `DeviceName` |
| Never-connected SSID | Infer from `com.apple.wifi.known-networks.plist` |
| First Wi-Fi connect time / key | `com.apple.wifi.plist` / known-networks / keychain |
| Installed IM / browser | Whether `Applications/<bundle>` exists |
| Safari bookmarks / search terms | `Library/Safari/Bookmarks.db`, `History.db` |
| iCloud photo count | `Photos.sqlite` iCloud flags |
| Screenshot count | `Photos.sqlite` screenshot type count |
| AirDrop transfers | `com.apple.sharingd` DB / Photos AirDrop records |
| Cross-app media | Match filenames in Photos vs Files sandboxes |
| Image GPS | `Photos.sqlite` lat/long or `exiftool` EXIF |
| WhatsApp ID / groups / polls | `ChatStorage.sqlite` |
| WeChat ID / Channels | `com.tencent.xin` sandbox SQLite |
| File transfer device/direction/mode | `com.estmob.paprika` / `com.lenovo.anyshare` DBs |
| POE prompt / bot | POE sandbox DB |

## Auto-answer script (`scripts/auto_answer.py`)

Companion script: input iOS filesystem extract (`.zip`), output JSON + Markdown for common question types. Schemas verified on real iOS 17 extracts; **stdlib only**; unpacks single files on demand (200MB+ friendly).

```bash
# Run (--out JSON, --md Markdown; both optional, defaults to stdout)
python scripts/auto_answer.py <exhibit.zip> --out answers.json --md report.md
```

Auto-covered modules (verified on real exams):

| Module | Auto output | Example questions |
|---|---|---|
| Device identity | iOS version, IMEI (incl. count), ICCID, Bluetooth, hotspot name | Q2–Q9 |
| Wi-Fi | Known SSID list (for "never connected" inference) | Q9 |
| Keychain | Apple ID candidates (plaintext email scan) | Q6 |
| Bluetooth | Paired device name/address/last connect | Q7 related |
| WhatsApp | Self ID (You contact + top creator cross-check), groups, JID, create time, creator, admins, poll count | Q50–Q62 |
| Photos | Media total, screenshots (`ZKINDSUBTYPE=2`), GPS samples | Q24–Q25, Q41 |
| Safari | Bookmark count (`type=0`), history search terms (URL decoded) | Q22–Q23 |

> **Design tradeoff**: script gives direct answers for single-value questions; for option-mapping multi-select (e.g. Q9 never-connected SSID, Q27 connected Wi-Fi), it outputs facts for the agent to map to options.
> **Known gaps**: Apple ID often encrypted in keychain (needs decrypt); WhatsApp self ID may disagree between "You" contact and top creator — human tie-break when they conflict.

## Tools and methods

```bash
# 1) Unpack forensic image
unzip -o CHAN_MH_mobile.zip -d CHAN_MH_mobile/

# 2) Parse plist (Python stdlib)
python -c "import plistlib; d=plistlib.load(open('x.plist','rb')); print(d)"

# 3) Query SQLite
sqlite3 ChatStorage.sqlite ".tables"

# 4) Media GPS
exiftool -GPSLatitude -GPSLongitude -n file.HEIC

# 5) Hash check (community icon SHA256)
sha256sum community_icon.png

# 6) iOS NSDate → GMT+8 (see §3.1 timestamp code)
```

**Time base**: iOS / WhatsApp use NSDate (since **2001-01-01 00:00:00 UTC**); add `978307200` for Unix; report in **GMT+8**.

## Tips

- **Preserve exact answers**: fill-in/short-answer must match exhibit text — case, spaces, symbols (e.g. `wxid_c9xyspglub7512`, `whoishogan@gmail.com`).
- **Read `iDevice_info.txt` first**: IMEI/ICCID/Bluetooth/version/hotspot hit ~90% of identity questions.
- **Multiple IMEI fields**: dual SIM/eSIM → count all `InternationalMobileEquipmentIdentity*`.
- **Multi-select delimiters**: options `;`, answers `,` (English punctuation).
- **Date prefix `【'】`**: stops Excel from parsing `yyyy-MM-dd HH:mm:ss` as numbers.
- **GMT+8 everywhere**: format `yyyy-MM-dd HH:mm:ss`.
- **NSDate offset 978307200**: core constant for WhatsApp/iOS timestamps.
- **SHA256 for hashes**: community icons, file integrity.
- **Cross-app same filename**: Photos vs Files for shared media.
- **Screenshots vs original names**: camera apps keep original name; after import → `IMG_xxxx`; trace via `ZADDITIONALASSETATTRIBUTES`.
- **Schema drift**: always `.schema` / `.tables` first; iOS 17 WhatsApp uses `ZWAMESSAGE`/`ZWACHATSESSION`/`ZWAGROUPMEMBER`; older builds differ.
- **WhatsApp self ID conflict**: prefer intersection of "You" contact and top creator; recipient frequency alone is misleading in groups.

## SeeU 环境适配（最高优先级，覆盖下文工具调用方式）

- 本技能来自 QikoAgent，已按 SeeU 环境替换工具链：`ssh-mcp` → 本机 `bash` 工具（Git Bash，POSIX 语法）；`ida-mcp` → `"$SEEU_TOOL_IDA"`；`jadx-mcp` → `"$SEEU_TOOL_JADX"`；Python → `"$SEEU_TOOL_PYTHON"`；7z → `"$SEEU_TOOL_SEVENZIP"`；sqlite3 → `"$SEEU_TOOL_SQLITE3"`；tshark → `"$SEEU_TOOL_TSHARK"`；adb → `"$SEEU_TOOL_ADB"`；apktool → `java -jar "$SEEU_TOOL_APKTOOL"`；StarMem → `"$SEEU_TOOL_STARMEM"`。
- MYOS「美亚超级取证大师」仍可用：MCP 工具名形如 `mcp__myos-forensics__*`（对应 `myos-forensics-mcp` 的 49 个工具）。
- 检材定位顺序（禁止全盘递归搜索）：① 火眼索引 `$SEEU_INDEX_API` 与案件概览 → ② 火眼只读挂载目录 `/evidence_mounts/eid-N/`（本机 `C:/hlnet/<eid>-…`，可用 `ges ls/glob/grep/copy`）→ ③ 只有没有火眼挂载入口才用「设置 → 镜像挂载…」（LovelyCarve）→ ④ 最后才按需只读原始文件。
- 输出按比武模式：极简「Q<n>｜答案｜思路」；缺检材/权限/工具写 `⏭️ Q<n>：跳过：缺 XXX`，不臆测。
