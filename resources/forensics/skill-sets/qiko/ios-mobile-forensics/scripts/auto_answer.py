#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
iOS 手机取证镜像「自动检材作答」脚本
====================================
配合 ios-mobile-forensics Skill 使用。输入一个 iOS 文件系统级提取包（.zip），
自动抽取美亚杯 / 电子数据取证个人赛常见题型所需的关键证据，输出结构化报告。

用法:
    python auto_answer.py <检材.zip> [--out answers.json] [--md report.md]

依赖: Python 3.8+ 标准库（zipfile / sqlite3 / plistlib / re / json），无需第三方包。
      GPS 经纬度如需从媒体文件本身读取，可额外安装 exiftool（脚本会自动降级）。

设计原则:
    - 只解包「需要的单个文件」到临时目录，不展开整个镜像（对 200MB+ 包友好）。
    - 对「单值确定性」题目（IMEI/ICCID/蓝牙/版本/热点/书签数/截图数/群组ID）直接给出答案；
      对「需比对选项」的多选题，输出证据事实由分析者/智能体映射到选项。
    - 时间戳统一转换为 GMT+8（yyyy-MM-dd HH:mm:ss）。
    - 所有库 schema 已在真实 iOS 17 提取包上验证（WhatsApp 新版 ZWAMESSAGE 体系）。
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import tempfile
import zipfile
import plistlib
from urllib.parse import unquote
from datetime import datetime, timezone, timedelta

# ---------------------------------------------------------------------------
# iOS 时间基准：NSDate = 自 2001-01-01 00:00:00 UTC 起的秒数
# ---------------------------------------------------------------------------
NSDATE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
UNIX_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
NSDATE_OFFSET = (NSDATE_EPOCH - UNIX_EPOCH).total_seconds()  # = 978307200


def nsdate_to_gmt8(ns):
    """iOS/WhatsApp NSDate（秒，可能带小数）-> GMT+8 字符串。"""
    if ns is None:
        return None
    try:
        dt = NSDATE_EPOCH + timedelta(seconds=float(ns))
    except Exception:
        return None
    return (dt + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S")


class Evidence:
    """汇总所有取证结果。"""

    def __init__(self):
        self.device = {}
        self.wifi = {}
        self.bluetooth = {}
        self.whatsapp = {}
        self.photos = {}
        self.safari = {}
        self.keychain = {}
        self.notes = []  # 人工/智能体需确认的提示

    def add_note(self, text):
        self.notes.append(text)


def open_member(z, name, tmpdir):
    """从 zip 抽取单个成员到临时目录并返回本地路径；找不到返回 None。"""
    try:
        data = z.read(name)
    except KeyError:
        return None
    path = os.path.join(tmpdir, name.replace("/", "_").replace(" ", "_"))
    with open(path, "wb") as f:
        f.write(data)
    return path


# ---------------------------------------------------------------------------
# 1) 设备身份：iDevice_info.txt
# ---------------------------------------------------------------------------
def parse_device_info(z, tmp, ev):
    try:
        raw = z.read("iDevice_info.txt").decode("utf-8", "replace")
    except KeyError:
        ev.add_note("未找到 iDevice_info.txt（非标准提取包或路径不同）")
        return
    d = {}
    for line in raw.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            d[k.strip()] = v.strip()
    ev.device = {
        "iOS_version": d.get("HumanReadableProductVersionString"),
        "ProductVersion(Build)": d.get("BuildVersion"),
        "DeviceName": d.get("DeviceName"),  # 个人热点名称通常等于设备名
        "DeviceClass": d.get("DeviceClass"),
        "ModelNumber": d.get("ModelNumber"),
        "MLBSerialNumber": d.get("MLBSerialNumber"),
        "BluetoothAddress": d.get("BluetoothAddress"),
        "ICCID": d.get("IntegratedCircuitCardIdentity"),
        "IMSI": d.get("InternationalMobileSubscriberIdentity"),
    }
    # IMEI 可能多组（双卡 / eSIM）
    imeis = [v for k, v in d.items() if k.startswith("InternationalMobileEquipmentIdentity")]
    ev.device["IMEI_list"] = imeis
    ev.device["IMEI_count"] = len(imeis)
    # 基带/其他
    ev.device["BasebandVersion"] = d.get("BasebandVersion")


# ---------------------------------------------------------------------------
# 2) Wi-Fi：known-networks.plist（key 形如 wifi.network.ssid.<SSID>）
# ---------------------------------------------------------------------------
def parse_wifi(z, tmp, ev):
    p = open_member(z, "var/preferences/com.apple.wifi.known-networks.plist", tmp)
    ssids = []
    if p:
        try:
            d = plistlib.load(open(p, "rb"))
            for k in d.keys():
                if k.startswith("wifi.network.ssid."):
                    ssids.append(k.replace("wifi.network.ssid.", ""))
        except Exception as e:
            ev.add_note(f"解析 known-networks.plist 失败: {e}")
    ev.wifi["known_ssids"] = ssids
    ev.wifi["known_ssid_count"] = len(ssids)
    # 连接时间戳可能存在于其他 plist（如 com.apple.wifi.plist），此处仅列出已知网络。
    # 需比对「未连接过的 SSID」类多选时，把选项与上述列表求差集即可。


# ---------------------------------------------------------------------------
# 2b) 钥匙串：扫描可能存在的 Apple ID（明文邮箱）
# ---------------------------------------------------------------------------
def parse_keychain(z, tmp, ev):
    p = open_member(z, "var/keychains/keychain-backup.plist", tmp)
    if not p:
        ev.add_note("未找到 keychain-backup.plist")
        return
    emails = set()
    try:
        # 钥匙串多为加密 blob，但 Apple ID 邮箱常以明文形式残留在序列化内容中
        raw = open(p, "rb").read().decode("latin-1", "ignore")
        for m in re.findall(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", raw):
            emails.add(m)
    except Exception as e:
        ev.add_note(f"钥匙串扫描失败: {e}")
    ev.keychain["apple_id_candidates"] = sorted(emails)


# ---------------------------------------------------------------------------
# 3) 蓝牙配对设备
# ---------------------------------------------------------------------------
def parse_bluetooth(z, tmp, ev):
    p = open_member(
        z,
        "var/mobile/Applications/systemgroup.com.apple.bluetooth/Library/Database/com.apple.MobileBluetooth.ledevices.paired.db",
        tmp,
    )
    if not p:
        ev.add_note("未找到蓝牙配对库")
        return
    con = sqlite3.connect(p)
    rows = []
    try:
        for r in con.execute("SELECT Name, Address, LastConnectionTime FROM PairedDevices"):
            rows.append({"name": r[0], "address": r[1], "last_connect_gmt8": nsdate_to_gmt8(r[2])})
    except Exception as e:
        ev.add_note(f"读取 PairedDevices 失败: {e}")
    con.close()
    ev.bluetooth["paired_devices"] = rows


# ---------------------------------------------------------------------------
# 4) WhatsApp（新版 schema：ZWAMESSAGE / ZWACHATSESSION / ZWAGROUPMEMBER / ZWAGROUPINFO）
# ---------------------------------------------------------------------------
def parse_whatsapp(z, tmp, ev):
    base = "var/mobile/Applications/group.net.whatsapp.WhatsApp.shared"
    p = open_member(z, f"{base}/ChatStorage.sqlite", tmp)
    if not p:
        ev.add_note("未找到 WhatsApp ChatStorage.sqlite")
        return
    con = sqlite3.connect(p)
    wa = ev.whatsapp

    # 本人 WhatsApp ID：多个信号交叉验证
    #   信号1：收到的 1:1 消息里最常见的收件人（排除群号 @g.us）
    #   信号2：通讯录中名为 "You"/"你" 的会话（WhatsApp 把本号存为 You）
    #   信号3：建群最多的人（ZCREATORJID）
    try:
        rows = con.execute(
            "SELECT ZTOJID, COUNT(*) c FROM ZWAMESSAGE "
            "WHERE ZISFROMME=0 AND ZTOJID IS NOT NULL AND ZTOJID NOT LIKE '%@g.us' "
            "GROUP BY ZTOJID ORDER BY c DESC LIMIT 5"
        ).fetchall()
        wa["own_jid_candidates"] = [r[0] for r in rows]
    except Exception as e:
        wa["own_jid_candidates"] = []
        ev.add_note(f"WhatsApp 本人ID推断失败: {e}")
    try:
        you = con.execute(
            "SELECT ZCONTACTJID FROM ZWACHATSESSION "
            "WHERE ZPARTNERNAME IN ('You','you','你') AND ZCONTACTJID IS NOT NULL LIMIT 3"
        ).fetchall()
        wa["you_contact_jid"] = [r[0] for r in you]
    except Exception:
        wa["you_contact_jid"] = []
    try:
        creator = con.execute(
            "SELECT ZCREATORJID, COUNT(*) c FROM ZWAGROUPINFO "
            "WHERE ZCREATORJID IS NOT NULL GROUP BY ZCREATORJID ORDER BY c DESC LIMIT 3"
        ).fetchall()
        wa["top_group_creator"] = [r[0] for r in creator]
    except Exception:
        wa["top_group_creator"] = []

    # 群组数据：群名 / 群号 / 创建时间 / 创建者 / 管理员
    try:
        groups = []
        for sid, partner, jid in con.execute(
            "SELECT Z_PK, ZPARTNERNAME, ZCONTACTJID FROM ZWACHATSESSION"
        ):
            if not (partner or (jid or "").endswith("@g.us")):
                continue
            g = {"session_pk": sid, "name": partner, "jid": jid}
            info = con.execute(
                "SELECT ZCREATIONDATE, ZCREATORJID, ZOWNERJID FROM ZWAGROUPINFO WHERE ZCHATSESSION=?",
                (sid,),
            ).fetchone()
            if info:
                g["created_gmt8"] = nsdate_to_gmt8(info[0])
                g["creator_jid"] = info[1] or info[2]
            admins = con.execute(
                "SELECT ZMEMBERJID FROM ZWAGROUPMEMBER WHERE ZCHATSESSION=? AND ZISADMIN=1",
                (sid,),
            ).fetchall()
            g["admin_jids"] = [a[0] for a in admins]
            groups.append(g)
        wa["groups"] = groups
    except Exception as e:
        ev.add_note(f"WhatsApp 群组解析失败: {e}")

    # 投票活动计数（表名随版本变化，先探测）
    try:
        tables = [t for (t,) in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%POLL%'")]
        if tables:
            t = tables[0]
            cnt = con.execute(f"SELECT COUNT(*) FROM '{t}'").fetchone()[0]
            wa["poll_table"] = t
            wa["poll_count"] = cnt
        else:
            wa["poll_count"] = None
    except Exception:
        wa["poll_count"] = None

    con.close()


# ---------------------------------------------------------------------------
# 5) 相册与多媒体：Photos.sqlite（ZASSET / ZADDITIONALASSETATTRIBUTES）
# ---------------------------------------------------------------------------
def parse_photos(z, tmp, ev):
    p = open_member(z, "var/mobile/Media/PhotoData/Photos.sqlite", tmp)
    if not p:
        ev.add_note("未找到 Photos.sqlite")
        return
    con = sqlite3.connect(p)
    ph = ev.photos
    # 总数 / 视频数
    try:
        ph["asset_total"] = con.execute("SELECT COUNT(*) FROM ZASSET").fetchone()[0]
        ph["video_count"] = con.execute("SELECT COUNT(*) FROM ZASSET WHERE ZKIND=1").fetchone()[0]
    except Exception as e:
        ev.add_note(f"相册计数失败: {e}")
    # 截图数：iOS 17 中 ZKINDSUBTYPE=2 通常表示屏幕截图（按具体版本验证）
    try:
        ph["screenshot_count"] = con.execute(
            "SELECT COUNT(*) FROM ZASSET WHERE ZKINDSUBTYPE=2").fetchone()[0]
    except Exception as e:
        ph["screenshot_count"] = None
        ev.add_note(f"截图计数失败（ZKINDSUBTYPE 可能不适用此版本）: {e}")
    # GPS 样本：附带经纬度的媒体
    try:
        rows = con.execute(
            "SELECT ZFILENAME, ZLATITUDE, ZLONGITUDE, ZDATECREATED FROM ZASSET "
            "WHERE ZLATITUDE IS NOT NULL AND ZLONGITUDE IS NOT NULL "
            "AND ZLATITUDE <> -180 AND ZLONGITUDE <> -180 LIMIT 10"
        ).fetchall()
        ph["geo_samples"] = [
            {"filename": r[0], "lat": r[1], "lon": r[2], "created_gmt8": nsdate_to_gmt8(r[3])}
            for r in rows
        ]
    except Exception as e:
        ev.add_note(f"GPS 样本读取失败: {e}")
    con.close()


# ---------------------------------------------------------------------------
# 6) Safari 浏览器：书签数（type=0）+ 历史搜索词
# ---------------------------------------------------------------------------
def parse_safari(z, tmp, ev):
    pb = open_member(z, "var/mobile/Library/Safari/Bookmarks.db", tmp)
    if pb:
        con = sqlite3.connect(pb)
        try:
            # type=0 为真实书签（文件夹为 type=1）
            ev.safari["bookmark_count"] = con.execute(
                "SELECT COUNT(*) FROM bookmarks WHERE type=0").fetchone()[0]
        except Exception as e:
            ev.add_note(f"Safari 书签计数失败: {e}")
        con.close()
    else:
        ev.add_note("未找到 Safari Bookmarks.db")

    ph = open_member(z, "var/mobile/Library/Safari/History.db", tmp)
    if ph:
        con = sqlite3.connect(ph)
        try:
            # 从 history_items 的 URL 中抽取搜索关键词（google/bing/baidu 等 q= 参数）
            kw = set()
            for (url,) in con.execute("SELECT url FROM history_items WHERE url LIKE '%q=%'"):
                m = re.search(r"[?&]q=([^&]+)", url)
                if m:
                    kw.add(unquote(m.group(1)))
            ev.safari["search_keywords"] = sorted(kw)
        except Exception as e:
            ev.add_note(f"Safari 搜索词提取失败: {e}")
        con.close()


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------
def to_markdown(ev):
    L = []
    L.append("# iOS 取证自动作答报告\n")
    L.append("## 1. 设备与身份")
    for k, v in ev.device.items():
        L.append(f"- **{k}**: {v}")
    L.append(f"\n> IMEI 组数 = {ev.device.get('IMEI_count')}（双卡/eSIM 会多于 1 组）")
    L.append("\n## 2. Wi-Fi 已知网络")
    L.append(f"- 已知 SSID 数: {ev.wifi.get('known_ssid_count')}")
    L.append(f"- SSID 列表: {ev.wifi.get('known_ssids')}")
    L.append("\n## 3. 蓝牙配对设备")
    for d in ev.bluetooth.get("paired_devices", []):
        L.append(f"- {d['name']} | {d['address']} | 最后连接 {d['last_connect_gmt8']}")
    L.append("\n## 4. WhatsApp")
    wa = ev.whatsapp
    L.append(f"- 本人 ID 候选(收件人频率): {wa.get('own_jid_candidates')}")
    L.append(f"- 本人 ID 候选(You 联系人): {wa.get('you_contact_jid')}")
    L.append(f"- 建群最多者: {wa.get('top_group_creator')}")
    L.append(f"- 投票活动数: {wa.get('poll_count')}（表: {wa.get('poll_table')}）")
    L.append(f"\n> 确定本号 WhatsApp ID：优先取 'You 联系人' 与 '建群最多者' 的交集；"
             f"'收件人频率' 可能因群消息干扰而偏。")
    L.append(f"\n## 4b. 钥匙串")
    L.append(f"- Apple ID 候选: {ev.keychain.get('apple_id_candidates')}")
    if wa.get("groups"):
        L.append("- 群组:")
        for g in wa["groups"]:
            L.append(f"  - 名称={g.get('name')} | 群号={g.get('jid')} | "
                     f"创建={g.get('created_gmt8')} | 创建者={g.get('creator_jid')} | "
                     f"管理员={g.get('admin_jids')}")
    L.append("\n## 5. 相册与多媒体")
    ph = ev.photos
    L.append(f"- 媒体总数: {ph.get('asset_total')}（视频 {ph.get('video_count')}）")
    L.append(f"- 截图数( heuristic ZKINDSUBTYPE=2 ): {ph.get('screenshot_count')}")
    if ph.get("geo_samples"):
        L.append("- 带 GPS 的媒体样本:")
        for s in ph["geo_samples"]:
            L.append(f"  - {s['filename']} | ({s['lat']}, {s['lon']}) | {s['created_gmt8']}")
    L.append("\n## 6. Safari")
    L.append(f"- 书签数(type=0): {ev.safari.get('bookmark_count')}")
    L.append(f"- 搜索关键词: {ev.safari.get('search_keywords')}")
    if ev.notes:
        L.append("\n## ⚠️ 需人工/智能体确认的提示")
        for n in ev.notes:
            L.append(f"- {n}")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="iOS 取证镜像自动作答脚本")
    ap.add_argument("zip_path", help="iOS 提取包 .zip 路径")
    ap.add_argument("--out", help="输出 JSON 路径")
    ap.add_argument("--md", help="输出 Markdown 报告路径")
    args = ap.parse_args()

    if not os.path.exists(args.zip_path):
        print(f"错误: 文件不存在 {args.zip_path}", file=sys.stderr)
        sys.exit(1)

    z = zipfile.ZipFile(args.zip_path)
    tmp = tempfile.mkdtemp(prefix="foren_")
    ev = Evidence()

    parse_device_info(z, tmp, ev)
    parse_wifi(z, tmp, ev)
    parse_keychain(z, tmp, ev)
    parse_bluetooth(z, tmp, ev)
    parse_whatsapp(z, tmp, ev)
    parse_photos(z, tmp, ev)
    parse_safari(z, tmp, ev)

    report = {k: getattr(ev, k) for k in ["device", "wifi", "keychain", "bluetooth", "whatsapp", "photos", "safari", "notes"]}
    md = to_markdown(ev)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"[+] JSON 已写入 {args.out}")
    if args.md:
        with open(args.md, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"[+] Markdown 已写入 {args.md}")
    # 始终打印到 stdout
    print(md)


if __name__ == "__main__":
    main()
