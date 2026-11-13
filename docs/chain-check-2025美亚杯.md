# 链路实测：2025 美亚杯个人赛（W:\ 检材）

- 时间：2026-11-13
- 素材：`W:\` 下 5 份检材 + 题目复现文档 `D:\知识库\取证\比赛WriteUp\2025\2025美亚杯个人赛复现.md`（约 90 题）
- 目标：不是答题，而是**验证从检材到 AI 取证链路的每一环能否打通**（火眼解析/挂载、SeeU 索引、镜像挂载、Android/Windows 分区读取）。

## 检材

| 文件 | 大小 | 类型 |
|---|---|---|
| `W:\CHAN_MH_mobile.zip` | 249,278,021 B | iPhone 全量提取（iOS 17.1.1） |
| `W:\FUNG_CC_mobile.zip` | 1,169,150,778 B | iPhone 备份 |
| `W:\LEUNG_YL_mobile.zip` | 425,908,392 B | iPhone 备份 |
| `W:\IQ_Coin_Type_Transactions.zip` | 762,298 B | 交易记录 |
| `W:\AP3_LEUNG_YL_USB.E01` | 776,733,201 B | U 盘镜像（E01） |
| `W:\blk0_sda.bin` | 31,981,568,000 B | Android 手机 eMMC 原始镜像（题目第 18 题接收装置） |

## 链路结果

| 链路 | 结果 | 证据 |
|---|---|---|
| 火眼案件服务（`ges`） | ✅ | 冷启动时 `ges status --json` 返回 `case_backend_unreachable`（案件未打开）；案件打开后返回 `cid:1`、`ges_url: http://127.0.0.1:8621`、`routes: ["/case/","/evidence_mounts/"]`、4 个 `evidence_mounts` |
| 火眼只读挂载（`C:\hlnet\*`） | ✅ | `CHAN_MH` 挂载目录可直接读 `iDevice_info.txt`（`BuildVersion: 21B91` → iOS 17.1.1），`var/` 下有 `Manifest.db_DEC`、`Info.plist`、`keychains` 等 |
| SeeU 索引 API（`/list` `/evidences` `/search`） | ✅（修 bug 后） | `/evidences` 返回 5 条（`recordCount` 1/8443/14331/1/1，`reportedRecordCount` 3065/13718/25669/68/3）；`/search?q=Investors` → `fts5-trigram·11 命中`，`q=IMG_0021` → 2 命中，`q=85254974406` → 200 命中 |
| SeeU 面板（树/检索/记录/实体/时间线/表） | ✅ | 打包态 `m2-ui-check`：树过滤、记录筛选（22,776→X）、实体分页、时间线筛选、来源筛选、活动、MYOS 弹窗全部通过 |
| LovelyCarve：U 盘 E01 | ✅ | `inspect` 276 ms（2 分区）；挂载 `X:` 687–701 ms；根目录 `System Volume Information`/`WEPE`/`Sunny.zip`/`vera_key`；卸载 163 ms |
| LovelyCarve：Android eMMC（`blk0_sda.bin`） | ✅ | `inspect` 244 ms，18 个分区（`BOTA0`/`BOTA1`/`EFS`/`PARAM`/`BOOT`/`RECOVERY`/`OTA`/`RADIO`/…/`SYSTEM`/`CACHE`/`USERDATA`）；挂载 `USERDATA`（17）838–1,001 ms，`/data` 下可见 `com.whatsapp`/`com.instagram.android`/`com.facebook.katana`；`SYSTEM`（13）501 ms 可读 `app`/`framework`/`priv-app`；卸载均成功 |
| 手机 zip → 文件级分析 | ✅（经火眼挂载） | 移动端 zip 在火眼挂载下已是展开目录（`iDevice_info.txt` + `var/`），可直接 `grep/find` 读备份数据 |
| LovelySpark（流量分析） | ⚠️ 未测 | 本套检材**没有 pcap/流量包**；工具链此前已用 `L1-6.pcapng` 验证（analyze ≈ 11 s） |
| StarMem（内存分析） | ⚠️ 未测 | 本套检材**没有内存镜像**；此前仅用 `pid.6492.dmp` 验证 `info` 可用（该 dmp 非完整镜像，`windows-info` 失败） |
| VMware 动态分析 | ⚠️ 未测 | 本套题目**没有可执行样本**；需用户确认快照 + 样本后再测 |

## 本轮发现并修复的问题

1. **`/seeu-index/search` 对 ≥3 字关键词直接 500**：`tools/ges-index/query.mjs` 的 `search()` 里调用了不存在的 `ftsQuery()`（历史重构遗留），而 `q.length >= 3` 走 FTS 分支必触发 `ReferenceError: ftsQuery is not defined`；只有 2 字关键词走 LIKE 才正常，所以此前 e2e 一直用「加密」（2 字）没暴露。
   - 修复：删除重复的 FTS 前置过滤，短词（<3 字）走 LIKE，长词（≥3 字）走 `record_fts match ?`，异常时回退 LIKE。
   - 回归：新增 `tests/search-fts.test.mjs`（2 例）；`m2-ui-check` 增加长关键词「Investors」断言（`引擎 fts5-trigram · 11 命中`）。
   - 已随 **v0.3.15** 打包；v0.3.14 及更早的包检索 ≥3 字关键词会失败，建议升级。

## 结论

- 「火眼解析/挂载 → SeeU 索引/面板 → LovelyCarve 镜像挂载」这条主链路在本套真实检材上**已打通**（含 31.9 GB Android eMMC 与 E01 U 盘）。
- 火眼对 `pf`（全量提取）与 `E01` 类检材只提供「元数据 + 只读挂载」，索引里几乎没有记录 → AI 侧必须按「索引 → 挂载目录 → LovelyCarve → 原始文件」顺序工作（提示词已按此加固）。
- 火眼 E01 挂载是「分区节点视图」（`$FAT1`/`$MBR`/`未使用空间`），不适合直接翻文件；U 盘 E01 建议走 LovelyCarve 分区挂载。
- 流量/内存/动态分析三类检材本套题未提供，链路仍按此前单点验证，等有对应样本再补。
