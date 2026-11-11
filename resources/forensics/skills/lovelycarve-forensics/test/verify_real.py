#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LovelyCarve 技能 · 真实检材验证集（纯标准库，只读检材）

核对 SKILL.md「实测基线」「实测坑」里的每条结论。需要两份真实检材：
  XP_IMAGE   任意 Windows E01（NTFS、双分区）
  LNX_IMAGE  任意 Linux E01（XFS + LVM）

用法:
    python test/verify_real.py
    XP_IMAGE=E:/case/disk.E01 LNX_IMAGE=E:/case/web.E01 python test/verify_real.py

约定: 主机路径写 Windows 形式（E:/…）；Git Bash 的 /e/… 会被 Windows 程序解析成 <盘>:\\e\\…
退出码: 0 全部通过 / 1 有失败 / 2 环境缺失（找不到 CLI 或检材）
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys

LC = os.environ.get("LC", "E:/LovelyCarve/cli/lovelycarve-cli.exe")
XP = os.environ.get("XP_IMAGE", "E:/作业/李自勇泄密案/disk.E01")
LNX = os.environ.get("LNX_IMAGE", "E:/作业/web.E01")
CASE = os.environ.get("CASE_DIR", "E:/SeeU/testcases/verify-real")
OUT = os.environ.get("OUT_DIR", "E:/SeeU/out/verify-real")
TMPD = os.environ.get("TMPD", "E:/SeeU/tmp")

ENV = dict(os.environ, LOVELYCARVE_AGENT="1", TMP="E:\\SeeU\\tmp", TEMP="E:\\SeeU\\tmp")

PASS = [0]
FAIL = [0]


def run(*args, image=None, case=None):
    """跑一条 CLI 命令，返回 (退出码, 解析后的 JSON 或 None, stderr 文本)。"""
    cmd = [LC, "-q"]
    if case:
        cmd += ["--case", case]
    if image:
        cmd += ["--image", image]
    cmd += list(args)
    p = subprocess.run(cmd, capture_output=True, text=True, env=ENV, encoding="utf-8",
                       errors="replace")
    data = None
    out = (p.stdout or "").strip()
    if out:
        try:
            data = json.loads(out)
        except ValueError:
            data = None
    if data is None:
        # 代理模式下错误与警告写在 stderr 的单行 JSON 里
        for line in (p.stderr or "").splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    data = json.loads(line)
                    break
                except ValueError:
                    continue
    return p.returncode, data, (p.stderr or "")


def run_jsonl(lines, case):
    """把请求行喂给 JSONL session，返回 {id: 响应行}。"""
    payload = "\n".join(json.dumps(x, ensure_ascii=False) for x in lines) + "\n"
    p = subprocess.run([LC, "-q", "--case", case, "session"], input=payload,
                       capture_output=True, text=True, env=ENV, encoding="utf-8",
                       errors="replace")
    got = {}
    for line in (p.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        got[str(d.get("id"))] = d
    return got


def check(name, expect, actual):
    ok = str(expect) == str(actual)
    if ok:
        PASS[0] += 1
        print("PASS  %-42s %s" % (name, actual))
    else:
        FAIL[0] += 1
        print("FAIL  %-42s 期望=%s 实际=%s" % (name, expect, actual))


def main():
    for path in (LC, XP, LNX):
        if not os.path.exists(path):
            print("环境缺失: %s" % path)
            return 2
    shutil.rmtree(OUT, ignore_errors=True)
    run("cases", "create", CASE, "--name", "verify-real")
    P = dict(image=XP, case=CASE)
    L = dict(image=LNX, case=CASE)
    run("images", "open", XP, **{"case": CASE})
    run("images", "open", LNX, **{"case": CASE})

    # ---- 1 打开与识别 ----
    _, info, _ = run("images", "get", **P)
    check("分区 0 识别为 ntfs", "ntfs", info["partitions"][0]["kind"])
    _, osd, _ = run("images", "os", "detect", **P)
    fam = (osd["partitions"][0]["detections"] or [{}])[0].get("family", "")
    check("os detect 认出 windows 家族", "windows", fam)
    stored = (info.get("ewf") or {}).get("storedMd5", "")
    check("E01 采集记录含 32 位 MD5", 32, len(stored))

    # ---- 2 索引与通配检索 ----
    run("tasks", "wait", **P)
    _, idx, _ = run("indexes", "list", **P)
    total = sum(i["entryCount"] for i in idx)
    check("元数据索引 > 5000 条", True, total > 5000)
    _, hit, _ = run("indexes", "files", "list", "--volume-key", "part:0",
                    "--filter", '{"nameGlob":"*.pf","limit":5,"offset":0}', **P)
    check("nameGlob 命中且带 nid", True, bool(hit) and hit[0]["nid"].startswith("ntfs:"))

    # ---- 3 路径与出处 ----
    _, _, _ = run("files", "get", "--path", "/WINDOWS", **P)
    code, err, _ = (lambda r: (r[0], r[1], r[2]))(run("files", "get", "--path", "/WINDOWS", **P))
    check("缺卷段的绝对路径 = notFound", "notFound",
          (err or {}).get("error", {}).get("code"))
    code, env, _ = run("files", "get", "--path", "/part:0/WINDOWS", "--with-source", **P)
    check("--with-source 放命令后可用", True,
          bool(env) and "result" in env and env.get("source", {}).get("imageId") != "")
    code, env2, _ = run("--with-source", "files", "get", "--path", "/part:0/WINDOWS", **P)
    check("--with-source 放命令前 = usage", "usage", (env2 or {}).get("error", {}).get("code"))

    # ---- 4 整盘哈希对账 ----
    _, h, _ = run("images", "hash", "--algorithms", "md5", **P)
    check("重算 MD5 = storedMd5", stored, h["md5"])

    # ---- 5 删除记录恢复 → 导出 → 报告自证 ----
    got = run_jsonl([
        {"id": "img", "command": "images open", "args": {"path": XP.replace("\\", "/")}},
        {"id": "scan", "command": "carve scans create",
         "args": {"options": {"scope": "partition", "partition_id": 0,
                              "filesystems": {"ntfs": True}, "signatures": False}}},
        {"id": "done", "command": "tasks wait"},
        {"id": "files", "command": "carve files list",
         "args": {"scanId": {"$ref": "scan#/scanId"}}},
        {"id": "exp", "command": "carve scans export",
         "args": {"scanId": {"$ref": "scan#/scanId"},
                  "options": {"artifact_ids": [], "file_ids": ["0"],
                              "destination": OUT + "/rec", "task_id": "vr1"}}},
    ], CASE)
    cands = (got.get("files", {}).get("result") or {}).get("candidates") or []
    check("恢复候选 > 1000", True, len(cands) > 1000)
    exp = (got.get("exp", {}).get("result") or {})
    check("顶层 recovered=0 而 files.recovered=1", "1/0",
          "%s/%s" % (exp.get("files", {}).get("recovered"), exp.get("recovered")))
    match = "no-report"
    for rep in glob.glob(os.path.join(OUT, "rec", "*", "recovery-report.jsonl")):
        for line in open(rep, encoding="utf-8"):
            d = json.loads(line)
            if "candidate" in d:
                with open(d["output"], "rb") as fh:
                    match = "match" if hashlib.sha256(fh.read()).hexdigest() == d["sha256"] else "mismatch"
                break
        if match != "no-report":
            break
    check("报告 sha256 = 落盘文件", "match", match)

    # ---- 6 签名雕刻 ----
    got = run_jsonl([
        {"id": "img", "command": "images open", "args": {"path": XP.replace("\\", "/")}},
        {"id": "scan", "command": "carve scans create",
         "args": {"options": {"scope": "range", "start_sector": 4000000,
                              "sector_count": 400000,
                              "format_ids": ["jpg", "png", "pdf"], "signatures": True}}},
        {"id": "done", "command": "tasks wait"},
        {"id": "art", "command": "carve artifacts list",
         "args": {"scanId": {"$ref": "scan#/scanId"}, "limit": 5}},
    ], CASE)
    total_art = (got.get("art", {}).get("result") or {}).get("total") or 0
    check("签名雕刻产出 > 0", True, total_art > 0)

    # ---- 7 时间线 ----
    _, tb, _ = run("timeline", "build", **P)
    check("timeline build = success", "success", tb["status"])
    _, ev, _ = run("timeline", "events", "list", "--query",
                   '{"time_zone_hours":0,"time_unit":"day","from_apps":[],'
                   '"data_types":[],"pairs":[],"show_delete":false}',
                   "--skip", "0", "--limit", "1", **P)
    check("时间线事件 > 1000", True, ev["total"] > 1000)

    # ---- 8 Linux（LVM + XFS） ----
    _, lv, _ = run("files", "list", "--path", "/part:1", "--fields", "name", **L)
    names = [i["name"] for i in lv["items"]]
    check("LVM 下列出 root 与 swap", True, "root" in names and "swap" in names)
    _, rel, _ = run("files", "text", "get", "--path", "/part:1/root/etc/os-release",
                    "--max-bytes", "200", **L)
    check("LV 内读出 /etc/os-release", True, "Linux" in rel["text"] or "CentOS" in rel["text"])
    _, lt, _ = run("files", "get", "--path", "/part:1/root/etc/localtime", **L)
    check("localtime 为符号链接且可读目标", True,
          lt["kind"] == "symlink" and bool(lt.get("linkTarget")))
    _, tz, _ = run("timezones", "get", **L)
    check("LVM Linux 时区回退 UTC（实测）", "UTC/fallback",
          "%s/%s" % (tz["effective"]["zone"], tz["effective"]["source"]))
    _, ps, _ = run("plugins", "systems", "list", **L)
    check("该 Linux plugins systems = 空", 0, len(ps))

    run("cases", "delete", CASE, "--force")
    print("-----")
    print("PASS=%d FAIL=%d" % (PASS[0], FAIL[0]))
    return 0 if FAIL[0] == 0 else 1


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    sys.exit(main())
