#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SeeUForensicsAgentPlus brand icon generator.

Produces:
  build/icon.ico   16/24/32/48/64/128/256 multi-size Windows icon
  build/icon.png   512x512 PNG (mac/linux)
  build/tray.ico   16/32 tray icon

Design: dark forensic-tech tile (#0B1220) with a cyan (#22D3EE) magnifier
ring + handle and a light shield inside the lens. No text. Geometry is
drawn independently at every target size (supersampled 8x) so small sizes
stay crisp instead of being downscaled from 256.

Reproduce:  <python> build/make-icons.py
Requires:  Pillow
"""

from __future__ import annotations

import io
import os
import struct
import sys

from PIL import Image, ImageDraw

BUILD_DIR = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- palette
BG_TOP = (11, 18, 32)        # #0B1220
BG_BOTTOM = (14, 27, 46)     # #0E1B2E
RING = (34, 211, 238)        # #22D3EE
RING_INNER = (8, 145, 178)   # #0891B2 (subtle inner shade on ring)
SHIELD = (224, 253, 255)     # #E0FDFF
SHIELD_EDGE = (165, 243, 252)  # #A5F3FC
SHIELD_MARK = (11, 18, 32)   # shield notch
GLOW = (34, 211, 238)
TRAY_BG = (8, 13, 24)


def _rounded_tile(size: int, radius_ratio: float, bg_top, bg_bottom) -> Image.Image:
    """Rounded square tile with a vertical gradient."""
    ss = 8
    S = size * ss
    grad = Image.new("RGB", (1, S), bg_top)
    px = grad.load()
    for y in range(S):
        t = y / max(1, S - 1)
        px[0, y] = (
            int(bg_top[0] + (bg_bottom[0] - bg_top[0]) * t),
            int(bg_top[1] + (bg_bottom[1] - bg_top[1]) * t),
            int(bg_top[2] + (bg_bottom[2] - bg_bottom[2]) * t),
        )
    tile = grad.resize((S, S), Image.Resampling.BILINEAR)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, S - 1, S - 1), radius=int(S * radius_ratio), fill=255
    )
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(tile, (0, 0), mask)
    return out


def _shield_points(cx: float, cy: float, w: float, h: float):
    """Classic shield polygon in supersampled pixel coordinates."""
    hw, hh = w / 2.0, h / 2.0
    top = cy - hh
    bottom = cy + hh
    left = cx - hw
    right = cx + hw
    shoulder = top + h * 0.30          # where the sides start tapering
    return [
        (left, top + h * 0.10),
        (cx, top),                      # slightly pointed top
        (right, top + h * 0.10),
        (right, shoulder),
        (right - w * 0.10, shoulder + h * 0.26),
        (cx, bottom),
        (left + w * 0.10, shoulder + h * 0.26),
        (left, shoulder),
    ]


def render_mark(size: int, *, tile: bool = True, radius_ratio: float = 0.22) -> Image.Image:
    """Render the full app mark at `size` px (supersampled internally)."""
    ss = 8
    S = size * ss
    if tile:
        img = _rounded_tile(size, radius_ratio, BG_TOP, BG_BOTTOM)
    else:
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    d = ImageDraw.Draw(img)

    # Lens geometry (normalized -> pixels). Ring is deliberately thick so the
    # magnifier silhouette still reads at 16px.
    cx, cy = 0.430 * S, 0.400 * S
    r = 0.255 * S
    stroke = 0.098 * S
    handle_len = 0.235 * S
    handle_w = 0.112 * S
    tiny = size < 32
    if tiny:
        # 16px: drop decorative detail, thicken the ring, shrink the shield
        stroke = 0.125 * S
        handle_w = 0.125 * S
        r = 0.245 * S

    # soft cyan glow behind the lens (skipped at 16px, it only muddies)
    if not tiny:
        glow_r = r + stroke
        d.ellipse(
            (cx - glow_r, cy - glow_r, cx + glow_r, cy + glow_r),
            outline=(GLOW[0], GLOW[1], GLOW[2], 60),
            width=int(0.030 * S),
        )

    # magnifier handle: from ~45deg on the ring to bottom-right
    import math

    ang = math.radians(45)
    hx = cx + math.cos(ang) * (r + stroke * 0.15)
    hy = cy + math.sin(ang) * (r + stroke * 0.15)
    ex = hx + math.cos(ang) * handle_len
    ey = hy + math.sin(ang) * handle_len
    d.line([(hx, hy), (ex, ey)], fill=RING, width=int(handle_w))
    # rounded cap
    cap = handle_w / 2.0
    d.ellipse((ex - cap, ey - cap, ex + cap, ey + cap), fill=RING)
    # darker under-edge on the handle for depth
    d.line(
        [(hx, hy + handle_w * 0.10), (ex, ey + handle_w * 0.10)],
        fill=RING_INNER,
        width=int(handle_w * 0.28),
    )

    # lens ring
    d.ellipse(
        (cx - r, cy - r, cx + r, cy + r),
        outline=RING,
        width=int(stroke),
    )
    # inner subtle ring (helps at 128/256, disappears at 16 without hurting)
    if size >= 48:
        d.ellipse(
            (cx - r + stroke * 0.80, cy - r + stroke * 0.80,
             cx + r - stroke * 0.80, cy + r - stroke * 0.80),
            outline=RING_INNER,
            width=max(1, int(stroke * 0.18)),
        )

    # shield inside the lens — kept clear of the ring so both shapes read
    sw, sh = (r * 0.72, r * 0.90) if tiny else (r * 0.84, r * 1.04)
    pts = _shield_points(cx, cy, sw, sh)
    d.polygon(pts, fill=SHIELD, outline=SHIELD_EDGE, width=max(1, int(0.010 * S)))
    # dark keyhole (circle + stem) only where there is room for it
    if size >= 64:
        bw = sw * 0.16
        d.rounded_rectangle(
            (cx - bw / 2, cy - sh * 0.16, cx + bw / 2, cy + sh * 0.12),
            radius=bw * 0.45,
            fill=SHIELD_MARK,
        )
        d.ellipse(
            (cx - bw * 1.25, cy - sh * 0.36, cx + bw * 1.25, cy - sh * 0.04),
            fill=SHIELD_MARK,
        )

    return img.resize((size, size), Image.Resampling.LANCZOS)


def render_tray(size: int) -> Image.Image:
    """Tray mark: dark tile, simplified high-contrast lens (no shield notch)."""
    ss = 8
    S = size * ss
    img = _rounded_tile(size, 0.25, TRAY_BG, (14, 27, 46))
    d = ImageDraw.Draw(img)

    cx, cy = 0.44 * S, 0.42 * S
    r = 0.30 * S
    stroke = 0.115 * S
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=RING, width=int(stroke))

    import math

    ang = math.radians(45)
    hx = cx + math.cos(ang) * (r + stroke * 0.10)
    hy = cy + math.sin(ang) * (r + stroke * 0.10)
    ex = hx + math.cos(ang) * 0.20 * S
    ey = hy + math.sin(ang) * 0.20 * S
    hw = int(0.15 * S)
    d.line([(hx, hy), (ex, ey)], fill=RING, width=hw)
    cap = hw / 2.0
    d.ellipse((ex - cap, ey - cap, ex + cap, ey + cap), fill=RING)

    # light dot inside the lens, reads at 16px
    cr = 0.10 * S
    d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), fill=SHIELD)

    return img.resize((size, size), Image.Resampling.LANCZOS)


def _single_ico(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="ICO", sizes=[im.size])
    return buf.getvalue()


def save_ico(images, path: str) -> None:
    """Build one multi-size ICO from independently rendered per-size images.

    Pillow's ``sizes=`` save resizes a single source image, which blurs 16/24px.
    Instead each size is encoded as its own single-entry ICO (BMP DIB for small
    sizes, PNG for 256x256 as Windows expects) and the entries are merged into a
    canonical ICONDIR — every size keeps its own crisp render.
    """
    entries = []  # (width, height, planes, bitcount, payload)
    for im in images:
        data = _single_ico(im)
        _reserved, _type, _count = struct.unpack_from("<HHH", data, 0)
        w, h, _cc, _res, planes, bpp, nbytes, offset = struct.unpack_from(
            "<BBBBHHII", data, 6
        )
        entries.append((w, h, planes, bpp, data[offset: offset + nbytes]))

    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory = b""
    body = b""
    for w, h, planes, bpp, payload in entries:
        directory += struct.pack(
            "<BBBBHHII", w, h, 0, 0, planes, bpp, len(payload), offset
        )
        offset += len(payload)
        body += payload
    with open(path, "wb") as fh:
        fh.write(header + directory + body)


def main() -> int:
    os.makedirs(BUILD_DIR, exist_ok=True)

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    app_images = [render_mark(s) for s in ico_sizes]
    icon_ico = os.path.join(BUILD_DIR, "icon.ico")
    save_ico(app_images, icon_ico)

    png512 = render_mark(512, radius_ratio=0.22)
    icon_png = os.path.join(BUILD_DIR, "icon.png")
    png512.save(icon_png, format="PNG")

    tray_images = [render_tray(s) for s in (16, 32)]
    tray_ico = os.path.join(BUILD_DIR, "tray.ico")
    save_ico(tray_images, tray_ico)

    # ---- verification (fails loudly rather than shipping a bad icon) ----
    with Image.open(icon_ico) as im:
        got = sorted(im.info.get("sizes", set()))
        want = [(s, s) for s in ico_sizes]
        print(f"icon.ico sizes: {got}")
        if got != want:
            print(f"ERROR: icon.ico sizes mismatch, want {want}", file=sys.stderr)
            return 1
    with Image.open(icon_png) as im:
        print(f"icon.png: {im.size}")
        if im.size != (512, 512):
            print("ERROR: icon.png must be 512x512", file=sys.stderr)
            return 1
    with Image.open(tray_ico) as im:
        print(f"tray.ico sizes: {sorted(im.info.get('sizes', set()))}")

    for p in (icon_ico, icon_png, tray_ico):
        print(f"{os.path.basename(p):10s} {os.path.getsize(p):7d} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
