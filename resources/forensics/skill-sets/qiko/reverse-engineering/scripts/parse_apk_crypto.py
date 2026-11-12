#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_apk_crypto.py — locate crypto usage and key material in decompiled APK source.

Usage:
    python parse_apk_crypto.py <decompiled_dir>
"""
import sys
import os
import re
import shutil
import subprocess

PATTERNS = {
    'AES': r'\bAES\b|AES/CBC|AES/GCM|AES/ECB',
    'DES': r'\bDES\b|DESede|TripleDES',
    'RSA': r'\bRSA\b|RSAPrivateKey|RSAPublicKey',
    'MD5': r'\bMD5\b|MessageDigest\.getInstance\("MD5"',
    'SHA': r'\bSHA-?1\b|\bSHA-?256\b|\bSHA-?512\b',
    'HMAC': r'HmacSHA\d+|Mac\.getInstance',
    'PBKDF2': r'PBKDF2|SecretKeyFactory\.getInstance\("PBK',
    'Cipher': r'Cipher\.getInstance',
    'IvParameterSpec': r'IvParameterSpec|new\s+byte\[\s*16\s*\]',
    'SecretKeySpec': r'SecretKeySpec',
    'Base64': r'Base64\.|android\.util\.Base64',
    'HardcodedHex': r'"[0-9a-fA-F]{16,}"',
    'HardcodedB64': r'"[A-Za-z0-9+/]{20,}={0,2}"',
    'KeyDerivation': r'generatePwd|deriveKey|buildKey|getPassword|makeKey',
    'SecureRandom': r'SecureRandom',
    'KeyStore': r'KeyStore\.getInstance',
}

def search(src, pattern):
    rg = shutil.which('rg')
    if rg:
        cmd = [rg, '-n', '--no-heading', '-t', 'java', pattern, src]
    else:
        cmd = ['grep', '-rnE', '--include=*.java', pattern, src]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        return r.stdout.strip().split('\n') if r.stdout.strip() else []
    except Exception as e:
        return [f"[error: {e}]"]

def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    if not os.path.isdir(src):
        print(f"Not a directory: {src}")
        sys.exit(1)
    # find the sources/ subdir if user passed the jadx out root
    candidates = [os.path.join(src, 'sources'), src]
    src_dir = next((c for c in candidates if os.path.isdir(c)), src)

    print(f"=== Crypto scan: {src_dir} ===\n")
    for name, pat in PATTERNS.items():
        hits = search(src_dir, pat)
        if not hits:
            continue
        print(f"### {name} ({len(hits)} hits)")
        for line in hits[:12]:
            # trim long paths
            short = line.replace(src_dir, '.')
            if len(short) > 200:
                short = short[:200] + '...'
            print(f"  {short}")
        if len(hits) > 12:
            print(f"  ... ({len(hits)-12} more)")
        print()

    # Specifically flag likely key material: byte arrays initialized with hex/base64
    print("### Likely hardcoded keys/IVs (byte[] with literal)")
    key_hits = search(src_dir, r'new\s+byte\[\]\s*\{[^}]{8,}\}')
    for line in key_hits[:20]:
        short = line.replace(src_dir, '.')
        if len(short) > 200:
            short = short[:200] + '...'
        print(f"  {short}")

if __name__ == '__main__':
    main()
