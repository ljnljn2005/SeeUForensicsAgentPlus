#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apk_decompile.py — jadx wrapper and crypto locator.

Usage:
    python apk_decompile.py decompile <apk> <out_dir>
    python apk_decompile.py find_crypto <out_dir>
"""
import sys
import os
import shutil
import subprocess

def find_jadx():
    """Locate jadx on PATH or via JADX_HOME."""
    p = shutil.which('jadx')
    if p:
        return p
    home = os.environ.get('JADX_HOME')
    if home:
        for cand in ('jadx', 'jadx.bat', 'bin/jadx', 'bin/jadx.bat'):
            full = os.path.join(home, cand)
            if os.path.exists(full):
                return full
    return None

def cmd_decompile(apk, out_dir):
    jadx = find_jadx()
    if not jadx:
        print("jadx not found. Install from https://github.com/skylot/jadx/releases")
        print("  or set JADX_HOME env var.")
        sys.exit(1)
    os.makedirs(out_dir, exist_ok=True)
    print(f"Decompiling {apk} -> {out_dir}")
    cmd = [jadx, '-d', out_dir, '--no-res', apk]
    r = subprocess.run(cmd)
    if r.returncode != 0:
        print("jadx failed, retrying with --show-bad-code")
        subprocess.run([jadx, '-d', out_dir, '--show-bad-code', '--no-imports', apk])
    print("Done.")

CRYPTO_PATTERNS = [
    r'AES',
    r'Cipher\.getInstance',
    r'SecretKeySpec',
    r'IvParameterSpec',
    r'MessageDigest',
    r'Mac\.getInstance',
    r'KeyGenerator',
    r'generatePwd',
    r'deriveKey',
    r'getPassword',
    r'buildCipher',
    r'encrypt',
    r'decrypt',
    r'PBKDF2',
    r'HmacSHA',
]

def cmd_find_crypto(out_dir):
    try:
        import ripgrep  # noqa
    except ImportError:
        pass
    # Use rg if available, else grep
    rg = shutil.which('rg')
    src = os.path.join(out_dir, 'sources')
    if not os.path.isdir(src):
        src = out_dir
    print(f"Searching {src} for crypto patterns...")
    for pat in CRYPTO_PATTERNS:
        if rg:
            cmd = [rg, '-n', '--no-heading', '-t', 'java', pat, src]
        else:
            cmd = ['grep', '-rn', '--include=*.java', pat, src]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if r.stdout.strip():
                lines = r.stdout.strip().split('\n')
                print(f"\n=== {pat} ({len(lines)} hits) ===")
                for line in lines[:15]:
                    print(f"  {line}")
                if len(lines) > 15:
                    print(f"  ... ({len(lines)-15} more)")
        except Exception as e:
            print(f"  [search error for {pat}: {e}]")

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == 'decompile' and len(sys.argv) == 4:
        cmd_decompile(sys.argv[2], sys.argv[3])
    elif cmd == 'find_crypto' and len(sys.argv) == 3:
        cmd_find_crypto(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)

if __name__ == '__main__':
    main()
