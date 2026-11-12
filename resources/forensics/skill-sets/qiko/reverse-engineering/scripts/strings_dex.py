#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
strings_dex.py — extract strings from DEX/APK files with optional filtering.

Usage:
    python strings_dex.py <apk_or_dex> [--min N] [--filter REGEX]
"""
import sys
import re
import struct

def read_dex_strings(data):
    """Extract string constants from a DEX file."""
    if data[:4] != b'dex\n':
        return []
    # DEX header: string_ids_size at offset 0x38, string_ids_off at 0x3c
    if len(data) < 0x40:
        return []
    str_count = struct.unpack('<I', data[0x38:0x3c])[0]
    str_off = struct.unpack('<I', data[0x3c:0x40])[0]
    strings = []
    for i in range(str_count):
        sid_off = str_off + i * 4
        if sid_off + 4 > len(data):
            break
        str_data_off = struct.unpack('<I', data[sid_off:sid_off+4])[0]
        if str_data_off >= len(data):
            continue
        # ULEB128 length, then MUTF-8 bytes
        p = str_data_off
        if p >= len(data):
            continue
        # skip ULEB128 size
        while p < len(data) and data[p] & 0x80:
            p += 1
        p += 1
        # read null-terminated MUTF-8
        end = data.find(b'\x00', p)
        if end == -1:
            end = len(data)
        try:
            s = data[p:end].decode('utf-8', errors='replace')
            strings.append(s)
        except Exception:
            pass
    return strings

def extract_strings_from_apk(apk_path):
    """Extract strings from all classes*.dex inside the APK."""
    import zipfile
    out = []
    with zipfile.ZipFile(apk_path) as zf:
        for name in zf.namelist():
            if name.endswith('.dex'):
                data = zf.read(name)
                out.extend(read_dex_strings(data))
    return out

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    min_len = 4
    filt = None
    for i, a in enumerate(sys.argv[2:], 2):
        if a == '--min' and i+1 < len(sys.argv):
            min_len = int(sys.argv[i+1])
        elif a == '--filter' and i+1 < len(sys.argv):
            filt = re.compile(sys.argv[i+1])
    if path.endswith('.apk'):
        strings = extract_strings_from_apk(path)
    else:
        with open(path, 'rb') as f:
            strings = read_dex_strings(f.read())
    seen = set()
    for s in strings:
        if len(s) < min_len:
            continue
        if s in seen:
            continue
        seen.add(s)
        if filt and not filt.search(s):
            continue
        print(s)

if __name__ == '__main__':
    main()
