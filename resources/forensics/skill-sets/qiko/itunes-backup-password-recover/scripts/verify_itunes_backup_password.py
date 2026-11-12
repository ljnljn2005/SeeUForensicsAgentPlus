#!/usr/bin/env python3
"""Verify / brute short PINs against iTunes/Finder backup BackupKeyBag.

Algorithm aligned with iphone_backup_decrypt / iOSbackup:
  - iOS >= 10.2: PBKDF2-SHA256(pw, DPSL, DPIC) -> PBKDF2-SHA1(temp, SALT, ITER)
  - older: PBKDF2-SHA1(pw, SALT, ITER) only
  - AES key unwrap (RFC 3394) of each class WPKY where WRAP & 2

Do NOT hand-roll a different KeyBag checker in the agent session.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import plistlib
import struct
import sys
from typing import Any, Dict, Iterable, List, Optional, Tuple

CLASSKEY_TAGS = {b"CLAS", b"WRAP", b"WPKY", b"KTYP", b"PBKY"}
WRAP_PASSCODE = 2
AES_IV_MAGIC = 0xA6A6A6A6A6A6A6A6


# --- AES-128/256 ECB (stdlib-only fallback; prefer Cryptodome if present) ---

def _get_aes_ecb(key: bytes):
    try:
        from Cryptodome.Cipher import AES  # type: ignore

        return AES.new(key, AES.MODE_ECB)
    except Exception:
        pass
    try:
        from Crypto.Cipher import AES  # type: ignore

        return AES.new(key, AES.MODE_ECB)
    except Exception:
        pass
    return _PureAesEcb(key)


# Minimal AES (public-domain style tables) for ECB encrypt/decrypt of 16-byte blocks.
_SBOX = bytes(
    [
        0x63, 0x7C, 0x77, 0x7B, 0xF2, 0x6B, 0x6F, 0xC5, 0x30, 0x01, 0x67, 0x2B, 0xFE, 0xD7, 0xAB, 0x76,
        0xCA, 0x82, 0xC9, 0x7D, 0xFA, 0x59, 0x47, 0xF0, 0xAD, 0xD4, 0xA2, 0xAF, 0x9C, 0xA4, 0x72, 0xC0,
        0xB7, 0xFD, 0x93, 0x26, 0x36, 0x3F, 0xF7, 0xCC, 0x34, 0xA5, 0xE5, 0xF1, 0x71, 0xD8, 0x31, 0x15,
        0x04, 0xC7, 0x23, 0xC3, 0x18, 0x96, 0x05, 0x9A, 0x07, 0x12, 0x80, 0xE2, 0xEB, 0x27, 0xB2, 0x75,
        0x09, 0x83, 0x2C, 0x1A, 0x1B, 0x6E, 0x5A, 0xA0, 0x52, 0x3B, 0xD6, 0xB3, 0x29, 0xE3, 0x2F, 0x84,
        0x53, 0xD1, 0x00, 0xED, 0x20, 0xFC, 0xB1, 0x5B, 0x6A, 0xCB, 0xBE, 0x39, 0x4A, 0x4C, 0x58, 0xCF,
        0xD0, 0xEF, 0xAA, 0xFB, 0x43, 0x4D, 0x33, 0x85, 0x45, 0xF9, 0x02, 0x7F, 0x50, 0x3C, 0x9F, 0xA8,
        0x51, 0xA3, 0x40, 0x8F, 0x92, 0x9D, 0x38, 0xF5, 0xBC, 0xB6, 0xDA, 0x21, 0x10, 0xFF, 0xF3, 0xD2,
        0xCD, 0x0C, 0x13, 0xEC, 0x5F, 0x97, 0x44, 0x17, 0xC4, 0xA7, 0x7E, 0x3D, 0x64, 0x5D, 0x19, 0x73,
        0x60, 0x81, 0x4F, 0xDC, 0x22, 0x2A, 0x90, 0x88, 0x46, 0xEE, 0xB8, 0x14, 0xDE, 0x5E, 0x0B, 0xDB,
        0xE0, 0x32, 0x3A, 0x0A, 0x49, 0x06, 0x24, 0x5C, 0xC2, 0xD3, 0xAC, 0x62, 0x91, 0x95, 0xE4, 0x79,
        0xE7, 0xC8, 0x37, 0x6D, 0x8D, 0xD5, 0x4E, 0xA9, 0x6C, 0x56, 0xF4, 0xEA, 0x65, 0x7A, 0xAE, 0x08,
        0xBA, 0x78, 0x25, 0x2E, 0x1C, 0xA6, 0xB4, 0xC6, 0xE8, 0xDD, 0x74, 0x1F, 0x4B, 0xBD, 0x8B, 0x8A,
        0x70, 0x3E, 0xB5, 0x66, 0x48, 0x03, 0xF6, 0x0E, 0x61, 0x35, 0x57, 0xB9, 0x86, 0xC1, 0x1D, 0x9E,
        0xE1, 0xF8, 0x98, 0x11, 0x69, 0xD9, 0x8E, 0x94, 0x9B, 0x1E, 0x87, 0xE9, 0xCE, 0x55, 0x28, 0xDF,
        0x8C, 0xA1, 0x89, 0x0D, 0xBF, 0xE6, 0x42, 0x68, 0x41, 0x99, 0x2D, 0x0F, 0xB0, 0x54, 0xBB, 0x16,
    ]
)
_INV_SBOX = bytes([_SBOX.index(i) for i in range(256)])
_RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36]


def _xtime(a: int) -> int:
    return (((a << 1) ^ 0x1B) & 0xFF) if (a & 0x80) else ((a << 1) & 0xFF)


def _mul(a: int, b: int) -> int:
    r = 0
    for _ in range(8):
        if b & 1:
            r ^= a
        a = _xtime(a)
        b >>= 1
    return r & 0xFF


class _PureAesEcb:
    def __init__(self, key: bytes):
        if len(key) not in (16, 24, 32):
            raise ValueError("AES key must be 16/24/32 bytes")
        self._nk = len(key) // 4
        self._nr = {4: 10, 6: 12, 8: 14}[self._nk]
        self._w = self._key_expansion(key)

    def _key_expansion(self, key: bytes) -> List[int]:
        w = list(struct.unpack(f">{self._nk}I", key[: self._nk * 4]))
        i = self._nk
        while len(w) < 4 * (self._nr + 1):
            t = w[-1]
            if i % self._nk == 0:
                t = self._sub_word(self._rot_word(t)) ^ (_RCON[i // self._nk] << 24)
            elif self._nk > 6 and i % self._nk == 4:
                t = self._sub_word(t)
            w.append(w[-self._nk] ^ t)
            i += 1
        return w

    @staticmethod
    def _rot_word(w: int) -> int:
        return ((w << 8) & 0xFFFFFFFF) | (w >> 24)

    @staticmethod
    def _sub_word(w: int) -> int:
        return (
            (_SBOX[(w >> 24) & 0xFF] << 24)
            | (_SBOX[(w >> 16) & 0xFF] << 16)
            | (_SBOX[(w >> 8) & 0xFF] << 8)
            | _SBOX[w & 0xFF]
        )

    def _add_round_key(self, s: List[List[int]], rnd: int) -> None:
        for c in range(4):
            k = self._w[rnd * 4 + c]
            s[0][c] ^= (k >> 24) & 0xFF
            s[1][c] ^= (k >> 16) & 0xFF
            s[2][c] ^= (k >> 8) & 0xFF
            s[3][c] ^= k & 0xFF

    def encrypt(self, block: bytes) -> bytes:
        if len(block) != 16:
            raise ValueError("AES block must be 16 bytes")
        s = [[block[r + 4 * c] for c in range(4)] for r in range(4)]
        self._add_round_key(s, 0)
        for rnd in range(1, self._nr):
            for r in range(4):
                for c in range(4):
                    s[r][c] = _SBOX[s[r][c]]
            s[1] = s[1][1:] + s[1][:1]
            s[2] = s[2][2:] + s[2][:2]
            s[3] = s[3][3:] + s[3][:3]
            for c in range(4):
                a0, a1, a2, a3 = s[0][c], s[1][c], s[2][c], s[3][c]
                s[0][c] = _mul(a0, 2) ^ _mul(a1, 3) ^ a2 ^ a3
                s[1][c] = a0 ^ _mul(a1, 2) ^ _mul(a2, 3) ^ a3
                s[2][c] = a0 ^ a1 ^ _mul(a2, 2) ^ _mul(a3, 3)
                s[3][c] = _mul(a0, 3) ^ a1 ^ a2 ^ _mul(a3, 2)
            self._add_round_key(s, rnd)
        for r in range(4):
            for c in range(4):
                s[r][c] = _SBOX[s[r][c]]
        s[1] = s[1][1:] + s[1][:1]
        s[2] = s[2][2:] + s[2][:2]
        s[3] = s[3][3:] + s[3][:3]
        self._add_round_key(s, self._nr)
        return bytes(s[r][c] for c in range(4) for r in range(4))

    def decrypt(self, block: bytes) -> bytes:
        if len(block) != 16:
            raise ValueError("AES block must be 16 bytes")
        s = [[block[r + 4 * c] for c in range(4)] for r in range(4)]
        self._add_round_key(s, self._nr)
        for rnd in range(self._nr - 1, 0, -1):
            s[1] = s[1][-1:] + s[1][:-1]
            s[2] = s[2][-2:] + s[2][:-2]
            s[3] = s[3][-3:] + s[3][:-3]
            for r in range(4):
                for c in range(4):
                    s[r][c] = _INV_SBOX[s[r][c]]
            self._add_round_key(s, rnd)
            for c in range(4):
                a0, a1, a2, a3 = s[0][c], s[1][c], s[2][c], s[3][c]
                s[0][c] = _mul(a0, 14) ^ _mul(a1, 11) ^ _mul(a2, 13) ^ _mul(a3, 9)
                s[1][c] = _mul(a0, 9) ^ _mul(a1, 14) ^ _mul(a2, 11) ^ _mul(a3, 13)
                s[2][c] = _mul(a0, 13) ^ _mul(a1, 9) ^ _mul(a2, 14) ^ _mul(a3, 11)
                s[3][c] = _mul(a0, 11) ^ _mul(a1, 13) ^ _mul(a2, 9) ^ _mul(a3, 14)
        s[1] = s[1][-1:] + s[1][:-1]
        s[2] = s[2][-2:] + s[2][:-2]
        s[3] = s[3][-3:] + s[3][:-3]
        for r in range(4):
            for c in range(4):
                s[r][c] = _INV_SBOX[s[r][c]]
        self._add_round_key(s, 0)
        return bytes(s[r][c] for c in range(4) for r in range(4))


def _u64(b: bytes) -> int:
    return struct.unpack(">Q", b)[0]


def _p64(n: int) -> bytes:
    return struct.pack(">Q", n & 0xFFFFFFFFFFFFFFFF)


def aes_unwrap(kek: bytes, wrapped: bytes) -> Optional[bytes]:
    if len(wrapped) < 24 or len(wrapped) % 8 != 0:
        return None
    aes = _get_aes_ecb(kek)
    n = len(wrapped) // 8 - 1
    r = [0] * (n + 1)
    a = _u64(wrapped[0:8])
    for i in range(1, n + 1):
        r[i] = _u64(wrapped[i * 8 : (i + 1) * 8])
    for j in range(5, -1, -1):
        for i in range(n, 0, -1):
            t = n * j + i
            b = aes.decrypt(_p64(a ^ t) + _p64(r[i]))
            a = _u64(b[:8])
            r[i] = _u64(b[8:])
    if a != AES_IV_MAGIC:
        return None
    return b"".join(_p64(r[i]) for i in range(1, n + 1))


def aes_wrap(kek: bytes, plaintext: bytes) -> bytes:
    if len(plaintext) < 16 or len(plaintext) % 8 != 0:
        raise ValueError("wrap plaintext length invalid")
    aes = _get_aes_ecb(kek)
    n = len(plaintext) // 8
    r = [0] * (n + 1)
    for i in range(1, n + 1):
        r[i] = _u64(plaintext[(i - 1) * 8 : i * 8])
    a = AES_IV_MAGIC
    for j in range(6):
        for i in range(1, n + 1):
            t = n * j + i
            b = aes.encrypt(_p64(a) + _p64(r[i]))
            a = _u64(b[:8]) ^ t
            r[i] = _u64(b[8:])
    return _p64(a) + b"".join(_p64(r[i]) for i in range(1, n + 1))


def loop_tlv(blob: bytes) -> Iterable[Tuple[bytes, bytes]]:
    i = 0
    while i + 8 <= len(blob):
        tag = blob[i : i + 4]
        length = struct.unpack(">I", blob[i + 4 : i + 8])[0]
        data = blob[i + 8 : i + 8 + length]
        yield tag, data
        i += 8 + length


def tlv(tag: bytes, data: bytes) -> bytes:
    return tag + struct.pack(">I", len(data)) + data


def parse_keybag(blob: bytes) -> Tuple[Dict[bytes, Any], Dict[int, Dict[bytes, Any]]]:
    attrs: Dict[bytes, Any] = {}
    class_keys: Dict[int, Dict[bytes, Any]] = {}
    current: Optional[Dict[bytes, Any]] = None
    bag_uuid_seen = False

    for tag, data in loop_tlv(blob):
        if len(data) == 4 and tag in (b"TYPE", b"WRAP", b"CLAS", b"KTYP", b"ITER", b"DPIC"):
            data = struct.unpack(">I", data)[0]
        if tag == b"TYPE":
            attrs[tag] = data
        elif tag == b"UUID" and not bag_uuid_seen:
            attrs[tag] = data
            bag_uuid_seen = True
        elif tag == b"WRAP" and b"WRAP" not in attrs:
            attrs[tag] = data
        elif tag == b"UUID":
            if current is not None and b"CLAS" in current:
                class_keys[int(current[b"CLAS"])] = current
            current = {b"UUID": data}
        elif tag in CLASSKEY_TAGS:
            if current is None:
                current = {}
            current[tag] = data
        else:
            attrs[tag] = data
    if current is not None and b"CLAS" in current:
        class_keys[int(current[b"CLAS"])] = current
    return attrs, class_keys


def derive_passphrase_key(
    password: bytes, attrs: Dict[bytes, Any], *, force_double: Optional[bool] = None
) -> bytes:
    dpsl = attrs.get(b"DPSL")
    dpic = attrs.get(b"DPIC")
    salt = attrs[b"SALT"]
    itera = int(attrs[b"ITER"])
    use_double = force_double
    if use_double is None:
        use_double = isinstance(dpsl, (bytes, bytearray)) and dpic is not None
    if use_double:
        temp = hashlib.pbkdf2_hmac("sha256", password, dpsl, int(dpic), dklen=32)
        return hashlib.pbkdf2_hmac("sha1", temp, salt, itera, dklen=32)
    return hashlib.pbkdf2_hmac("sha1", password, salt, itera, dklen=32)


def unlock_keybag(password: bytes, attrs: Dict[bytes, Any], class_keys: Dict[int, Dict[bytes, Any]]) -> bool:
    # Prefer double-layer when DPSL/DPIC present; also try single-layer as fallback for odd bags.
    attempts: List[Optional[bool]] = []
    if b"DPSL" in attrs and b"DPIC" in attrs:
        attempts.extend([True, False])
    else:
        attempts.append(False)
    for force in attempts:
        kek = derive_passphrase_key(password, attrs, force_double=force)
        ok_any = False
        failed = False
        for ck in class_keys.values():
            if b"WPKY" not in ck:
                continue
            wrap = ck.get(b"WRAP", 0)
            if isinstance(wrap, bytes):
                wrap = struct.unpack(">I", wrap)[0]
            if not (int(wrap) & WRAP_PASSCODE):
                continue
            unwrapped = aes_unwrap(kek, ck[b"WPKY"])
            if unwrapped is None:
                failed = True
                break
            ok_any = True
        if ok_any and not failed:
            return True
    return False


def load_manifest_keybag(path: str) -> Tuple[Dict[bytes, Any], Dict[int, Dict[bytes, Any]], Dict[str, Any]]:
    with open(path, "rb") as f:
        raw = f.read()
    try:
        plist = plistlib.loads(raw)
    except Exception as e:
        raise SystemExit(f"ERROR: cannot parse plist: {e}") from e
    if not isinstance(plist, dict):
        raise SystemExit("ERROR: Manifest root is not a dict")
    bag = plist.get("BackupKeyBag")
    if bag is None:
        raise SystemExit("ERROR: Manifest has no BackupKeyBag (not an encrypted iTunes backup?)")
    if isinstance(bag, memoryview):
        bag = bag.tobytes()
    if not isinstance(bag, (bytes, bytearray)):
        raise SystemExit("ERROR: BackupKeyBag is not bytes")
    attrs, class_keys = parse_keybag(bytes(bag))
    meta = {
        "IsEncrypted": plist.get("IsEncrypted"),
        "ITER": attrs.get(b"ITER"),
        "DPIC": attrs.get(b"DPIC"),
        "class_count": len(class_keys),
        "passcode_wrapped": sum(
            1
            for ck in class_keys.values()
            if b"WPKY" in ck
            and (int(ck.get(b"WRAP", 0) if not isinstance(ck.get(b"WRAP"), bytes) else struct.unpack(">I", ck[b"WRAP"])[0]) & WRAP_PASSCODE)
        ),
    }
    return attrs, class_keys, meta


def cmd_info(path: str) -> int:
    attrs, class_keys, meta = load_manifest_keybag(path)
    print(f"Manifest: {path}")
    print(f"IsEncrypted: {meta['IsEncrypted']}")
    print(f"ITER: {meta['ITER']}  DPIC: {meta['DPIC']}")
    print(f"class_keys: {meta['class_count']}  passcode_wrapped: {meta['passcode_wrapped']}")
    has_dpsl = b"DPSL" in attrs
    print(f"DPSL present: {has_dpsl}  (double-layer KDF if True)")
    return 0


def cmd_verify(path: str, password: str) -> int:
    attrs, class_keys, _meta = load_manifest_keybag(path)
    ok = unlock_keybag(password.encode("utf-8"), attrs, class_keys)
    if ok:
        print(f"OK: password accepted: {password!r}")
        return 0
    print(f"FAIL: password rejected: {password!r}")
    return 1


def cmd_brute(
    path: str,
    *,
    digits: int,
    start: int,
    end: Optional[int],
    common_first: bool,
) -> int:
    attrs, class_keys, meta = load_manifest_keybag(path)
    dpic = meta.get("DPIC")
    if isinstance(dpic, int) and dpic >= 1_000_000:
        print(
            f"WARN: DPIC={dpic} — full {digits}-digit space may be very slow; "
            "prefer common PINs / hashcat -m 14800 after exporting hash.",
            file=sys.stderr,
        )
    common = ["0000", "1111", "1234", "2222", "8888", "6666", "9999", "1212", "1122", "4321", "2020", "2024", "2025", "2026"]
    tried = set()

    def try_pw(pw: str) -> bool:
        if pw in tried:
            return False
        tried.add(pw)
        return unlock_keybag(pw.encode("utf-8"), attrs, class_keys)

    if common_first:
        for pw in common:
            if len(pw) != digits:
                continue
            if try_pw(pw):
                print(f"FOUND: {pw}")
                return 0

    lo = start
    hi = end if end is not None else (10**digits) - 1
    width = digits
    for n in range(lo, hi + 1):
        pw = f"{n:0{width}d}"
        if try_pw(pw):
            print(f"FOUND: {pw}")
            return 0
        if n % 500 == 0 and n != lo:
            print(f"... tried through {pw}", file=sys.stderr)
    print("NOT_FOUND")
    return 2


def build_synthetic_keybag(password: bytes, *, double: bool) -> bytes:
    """Build a minimal BackupKeyBag for --self-test (not a real Apple bag)."""
    salt = os.urandom(20)
    dpsl = os.urandom(20)
    itera = 1000
    dpic = 1000
    class_key = os.urandom(32)
    attrs: Dict[bytes, Any] = {
        b"SALT": salt,
        b"ITER": itera,
    }
    if double:
        attrs[b"DPSL"] = dpsl
        attrs[b"DPIC"] = dpic
    kek = derive_passphrase_key(password, attrs, force_double=double if double else False)
    wpky = aes_wrap(kek, class_key)
    parts = [
        tlv(b"TYPE", struct.pack(">I", 1)),
        tlv(b"UUID", os.urandom(16)),
        tlv(b"WRAP", struct.pack(">I", 1)),
        tlv(b"SALT", salt),
        tlv(b"ITER", struct.pack(">I", itera)),
    ]
    if double:
        parts.append(tlv(b"DPSL", dpsl))
        parts.append(tlv(b"DPIC", struct.pack(">I", dpic)))
    parts.extend(
        [
            tlv(b"UUID", os.urandom(16)),
            tlv(b"CLAS", struct.pack(">I", 3)),
            tlv(b"WRAP", struct.pack(">I", WRAP_PASSCODE)),
            tlv(b"KTYP", struct.pack(">I", 0)),
            tlv(b"WPKY", wpky),
        ]
    )
    return b"".join(parts)


def cmd_self_test() -> int:
    failures = 0

    # Round-trip AES wrap
    kek = os.urandom(32)
    pt = os.urandom(32)
    wrapped = aes_wrap(kek, pt)
    unwrapped = aes_unwrap(kek, wrapped)
    if unwrapped != pt:
        print("SELFTEST FAIL: aes wrap/unwrap roundtrip")
        failures += 1
    else:
        print("SELFTEST OK: aes wrap/unwrap")

    for label, double in (("double", True), ("single", False)):
        pw = b"1111"
        bag = build_synthetic_keybag(pw, double=double)
        attrs, class_keys = parse_keybag(bag)
        if not unlock_keybag(pw, attrs, class_keys):
            print(f"SELFTEST FAIL: {label} accept correct password")
            failures += 1
        elif unlock_keybag(b"0000", attrs, class_keys):
            print(f"SELFTEST FAIL: {label} rejected wrong password expected")
            failures += 1
        else:
            print(f"SELFTEST OK: {label} KDF verify")

        # Write temp Manifest and exercise CLI path
        import tempfile

        plist = {
            "IsEncrypted": True,
            "BackupKeyBag": bag,
            "Version": "10.0",
        }
        with tempfile.TemporaryDirectory() as td:
            mp = os.path.join(td, "Manifest.plist")
            with open(mp, "wb") as f:
                plistlib.dump(plist, f)
            attrs2, keys2, _ = load_manifest_keybag(mp)
            if not unlock_keybag(pw, attrs2, keys2):
                print(f"SELFTEST FAIL: {label} Manifest roundtrip")
                failures += 1
            else:
                print(f"SELFTEST OK: {label} Manifest roundtrip")

    if failures:
        print(f"SELFTEST DONE: {failures} failure(s)")
        return 1
    print("SELFTEST DONE: all passed")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        description="Verify or brute short PINs for iTunes/Finder BackupKeyBag (Manifest.plist)"
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("self-test", help="Synthetic KeyBag unit checks (no evidence needed)")
    sp.set_defaults(func=lambda _a: cmd_self_test())

    ip = sub.add_parser("info", help="Show KeyBag parameters from Manifest.plist")
    ip.add_argument("manifest", help="Path to Manifest.plist")
    ip.set_defaults(func=lambda a: cmd_info(a.manifest))

    vp = sub.add_parser("verify", help="Test one password")
    vp.add_argument("manifest", help="Path to Manifest.plist")
    vp.add_argument("password", help="Candidate password (e.g. 1111)")
    vp.set_defaults(func=lambda a: cmd_verify(a.manifest, a.password))

    bp = sub.add_parser("brute", help="Try common PINs then numeric mask")
    bp.add_argument("manifest", help="Path to Manifest.plist")
    bp.add_argument("--digits", type=int, default=4, help="PIN width (default 4)")
    bp.add_argument("--start", type=int, default=0)
    bp.add_argument("--end", type=int, default=None, help="Inclusive end (default 10^digits-1)")
    bp.add_argument("--no-common-first", action="store_true")
    bp.set_defaults(
        func=lambda a: cmd_brute(
            a.manifest,
            digits=a.digits,
            start=a.start,
            end=a.end,
            common_first=not a.no_common_first,
        )
    )

    args = p.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
