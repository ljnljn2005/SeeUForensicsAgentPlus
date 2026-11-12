#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
zip_crack.py — encrypted ZIP inspection, password testing, and extraction.

Supports both ZipCrypto (stdlib zipfile) and AES-256 (pyzipper/zip4j).

Usage:
    python zip_crack.py inspect <zip>
    python zip_crack.py test    <zip> <password>
    python zip_crack.py brute   <zip> <wordlist>
    python zip_crack.py extract <zip> <password> <out_dir>
"""
import sys
import os
import zipfile

def is_aes(zip_path):
    """Detect AES encryption (WinZip/zip4j) by compress_type==99 or AES extra field."""
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                if info.flag_bits & 0x0001:
                    if info.compress_type == 99:
                        return True
                    # check AES extra field 0x9901
                    if info.extra:
                        for tag in (0x9901,):
                            if tag.to_bytes(2, 'little') in info.extra:
                                return True
    except Exception:
        pass
    return False

def open_zip(zip_path, pwd=None):
    """Open zip with the right backend based on encryption type."""
    if is_aes(zip_path):
        import pyzipper
        zf = pyzipper.AESZipFile(zip_path, 'r')
        if pwd is not None:
            zf.setpassword(pwd.encode() if isinstance(pwd, str) else pwd)
        return zf
    zf = zipfile.ZipFile(zip_path, 'r')
    if pwd is not None:
        # stdlib uses pwd per read; we'll pass it through
        zf._pwd = pwd.encode() if isinstance(pwd, str) else pwd
    return zf

def cmd_inspect(zip_path):
    print(f"=== Inspect {os.path.basename(zip_path)} ===")
    print(f"Size: {os.path.getsize(zip_path)} bytes")
    aes = is_aes(zip_path)
    print(f"Encryption: {'AES-256 (use pyzipper)' if aes else 'ZipCrypto (stdlib ok)'}")
    with zipfile.ZipFile(zip_path) as zf:
        print(f"Comment: {zf.comment!r}")
        infos = zf.infolist()
        print(f"Entries: {len(infos)}")
        for i, info in enumerate(infos[:8]):
            enc = bool(info.flag_bits & 0x0001)
            print(f"  [{i}] {info.filename!r} size={info.file_size} "
                  f"compress_type={info.compress_type} encrypted={enc}")
        if len(infos) > 8:
            print(f"  ... ({len(infos)-8} more)")

def cmd_test(zip_path, pwd):
    aes = is_aes(zip_path)
    backend = "pyzipper" if aes else "zipfile"
    try:
        if aes:
            import pyzipper
            with pyzipper.AESZipFile(zip_path, 'r') as zf:
                zf.setpassword(pwd.encode())
                for info in zf.infolist():
                    if info.file_size > 0:
                        data = zf.read(info.filename)
                        print(f"OK [{backend}]: {info.filename} -> {len(data)} bytes")
                        return True
        else:
            with zipfile.ZipFile(zip_path) as zf:
                for info in zf.infolist():
                    if info.file_size > 0:
                        data = zf.read(info.filename, pwd=pwd.encode())
                        print(f"OK [{backend}]: {info.filename} -> {len(data)} bytes")
                        return True
    except RuntimeError as e:
        print(f"FAIL [{backend}]: {e}")
        return False
    except Exception as e:
        print(f"FAIL [{backend}]: {type(e).__name__}: {e}")
        return False
    return False

def cmd_brute(zip_path, wordlist):
    if not os.path.exists(wordlist):
        print(f"Wordlist not found: {wordlist}")
        return
    with open(wordlist, 'r', encoding='utf-8', errors='ignore') as f:
        candidates = [line.rstrip('\n') for line in f]
    print(f"Trying {len(candidates)} candidates against {os.path.basename(zip_path)}")
    for i, pwd in enumerate(candidates):
        if not pwd:
            continue
        # reuse cmd_test logic quietly
        try:
            if is_aes(zip_path):
                import pyzipper
                with pyzipper.AESZipFile(zip_path, 'r') as zf:
                    zf.setpassword(pwd.encode())
                    for info in zf.infolist():
                        if info.file_size > 0:
                            zf.read(info.filename)
                            print(f"\n*** FOUND: {pwd!r} (tried {i+1}) ***")
                            return pwd
            else:
                with zipfile.ZipFile(zip_path) as zf:
                    for info in zf.infolist():
                        if info.file_size > 0:
                            zf.read(info.filename, pwd=pwd.encode())
                            print(f"\n*** FOUND: {pwd!r} (tried {i+1}) ***")
                            return pwd
        except Exception:
            continue
        if (i+1) % 100 == 0:
            print(f"  ... {i+1} tried", end='\r')
    print("No password found.")
    return None

def cmd_extract(zip_path, pwd, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    ok = fail = 0
    if is_aes(zip_path):
        import pyzipper
        with pyzipper.AESZipFile(zip_path, 'r') as zf:
            zf.setpassword(pwd.encode())
            for info in zf.infolist():
                if info.is_dir() or info.file_size == 0:
                    continue
                try:
                    data = zf.read(info.filename)
                    out_path = os.path.join(out_dir, info.filename.replace('/', os.sep))
                    os.makedirs(os.path.dirname(out_path), exist_ok=True)
                    with open(out_path, 'wb') as f:
                        f.write(data)
                    ok += 1
                except Exception as e:
                    fail += 1
                    print(f"  FAIL {info.filename}: {e}")
    else:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                if info.is_dir() or info.file_size == 0:
                    continue
                try:
                    data = zf.read(info.filename, pwd=pwd.encode())
                    out_path = os.path.join(out_dir, info.filename.replace('/', os.sep))
                    os.makedirs(os.path.dirname(out_path), exist_ok=True)
                    with open(out_path, 'wb') as f:
                        f.write(data)
                    ok += 1
                except Exception as e:
                    fail += 1
                    print(f"  FAIL {info.filename}: {e}")
    print(f"Extracted: ok={ok} fail={fail} -> {out_dir}")

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == 'inspect' and len(sys.argv) == 3:
        cmd_inspect(sys.argv[2])
    elif cmd == 'test' and len(sys.argv) == 4:
        cmd_test(sys.argv[2], sys.argv[3])
    elif cmd == 'brute' and len(sys.argv) == 4:
        cmd_brute(sys.argv[2], sys.argv[3])
    elif cmd == 'extract' and len(sys.argv) == 5:
        cmd_extract(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(__doc__)
        sys.exit(1)

if __name__ == '__main__':
    main()
