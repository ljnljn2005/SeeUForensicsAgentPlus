---
name: seeu-chain-check
description: SeeU 自带链路体检：一键检查「索引可打开 / 检索可用 / 火眼挂载可读 / 镜像可解析」。在开始深入取证、给用户结论前，先跑一次，确认数据入口是通的；缺索引或挂载不通时先修链路，不要硬猜。
---

# SeeU 链路体检（chain-check）

用途：回答「现在这台机器上，这个案件的取证链路到底通不通」。它只读，不改检材、不改索引。

## 什么时候用

- 会话开始时，不确定索引库/火眼挂载/镜像解析是否就绪。
- 用户问「为什么查不到数据」「是不是索引坏了」。
- 准备做全量搜索、相册/聊天解析、E01 解析之前，先确认入口。

## 怎么调用（bash 工具）

```bash
# 1) 先看有哪些案件索引，拿 caseNumber
curl -s "$SEEU_INDEX_API/list" | head -c 2000

# 2) 跑体检（text=1 直接输出可读文本）
curl -s "$SEEU_INDEX_API/chain-check?caseNumber=2919d298-f083-4a81-9c12-bd4ca393bcc5&text=1"

# 3) 需要顺带解析镜像（E01/DD），加 images=1（会慢几秒~几十秒）
curl -s "$SEEU_INDEX_API/chain-check?caseNumber=<编号>&images=1&text=1"
```

已知索引库路径时也可以直接指定：

```bash
curl -s "$SEEU_INDEX_API/chain-check?db=E:/forensics/<案件目录>/.seeu-index/case-index.db&text=1"
```

## 输出怎么读

文本大致包含：

- `索引：... 条记录 · ... 个实体` —— 能打开、能统计即正常；`ERROR` 时看后面原因（库损坏 / 路径不存在 / 正在建库）。
- `检索：「<关键词>」<引擎> · N 命中` —— `0 命中` 不一定坏，先换 `probe` 词再判断。
- `火眼挂载：N/M 可读` —— `0/M` 说明火眼案件没打开、或检材未解析完；先让用户在火眼里打开案件 / 等待解析，再回来。
- `镜像：...` —— 仅 `images=1` 时出现；`不可解析` 时看 `hint`（LovelyCarve 未配置、文件被占用等）。

JSON 版本（去掉 `text=1`）字段：`ok`、`exitCode`（0 全通 / 1 有环节失败 / 2 找不到索引）、`summary`、`report`（逐环节明细）。

## 硬规则

- 体检失败先修链路（打开火眼案件、重新建索引、配置 LovelyCarve），**不要**用全盘 `grep`/`find` 代替。
- 体检通过 ≠ 检材里有答案；下一步仍然按「索引 → 火眼挂载 → 镜像 → 原始文件」的顺序定位。
- 体检只读，可以随时重复跑；`images=1` 会调用 LovelyCarve CLI，注意别和正在进行的挂载冲突。
