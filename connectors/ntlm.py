"""NTLMv2 sign-in over HTTP, standard library only (a Windows account on a gateway such as Windows Admin Center).

Three messages travel on ONE connection: the client opens (negotiate), the server answers with a challenge, the client proves it knows the
password (authenticate). Nothing here is sent in clear: the password only goes in the HMAC of the proof. Checked against the test vectors
of Microsoft's MS-NLMP (section 4.2.4) in tests/test_ntlm.py.

MD4 is written out because OpenSSL 3 no longer offers it (hashlib.new("md4") fails on many systems).
shortcut: no channel binding (Extended Protection) and no message signing, a gateway that demands them refuses the sign-in, build them then.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import struct

SIGNATURE = b"NTLMSSP\x00"
# unicode, request target, NTLM, always sign, target info, extended session security, 128 bit, 56 bit
FLAGS = 0x00000001 | 0x00000004 | 0x00000200 | 0x00008000 | 0x00800000 | 0x00080000 | 0x20000000 | 0x80000000
AV_EOL, AV_FLAGS, AV_TIMESTAMP = 0, 6, 7
MIC_PRESENT = 0x2


def _rol(x: int, n: int) -> int:
    x &= 0xFFFFFFFF
    return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF


def md4(data: bytes) -> bytes:
    msg = data + b"\x80" + b"\x00" * ((55 - len(data)) % 64) + struct.pack("<Q", len(data) * 8)
    a, b, c, d = 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476
    for off in range(0, len(msg), 64):
        x = struct.unpack("<16I", msg[off:off + 64])
        aa, bb, cc, dd = a, b, c, d
        for i in range(16):   # round 1
            k, s = i, (3, 7, 11, 19)[i % 4]
            a, b, c, d = d, _rol(a + ((b & c) | (~b & d)) + x[k], s), b, c
        for i in range(16):   # round 2
            k, s = (i % 4) * 4 + i // 4, (3, 5, 9, 13)[i % 4]
            a, b, c, d = d, _rol(a + ((b & c) | (b & d) | (c & d)) + x[k] + 0x5A827999, s), b, c
        for i in range(16):   # round 3
            k, s = (0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15)[i], (3, 9, 11, 15)[i % 4]
            a, b, c, d = d, _rol(a + (b ^ c ^ d) + x[k] + 0x6ED9EBA1, s), b, c
        a, b, c, d = (a + aa) & 0xFFFFFFFF, (b + bb) & 0xFFFFFFFF, (c + cc) & 0xFFFFFFFF, (d + dd) & 0xFFFFFFFF
    return struct.pack("<4I", a, b, c, d)


def _md5_hmac(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.md5).digest()   # NOSONAR S4790: the algorithm NTLMv2 is defined with


def ntowf_v2(user: str, password: str, domain: str) -> bytes:
    return _md5_hmac(md4(password.encode("utf-16-le")), (user.upper() + domain).encode("utf-16-le"))


def negotiate() -> bytes:
    """Message 1: no domain, no workstation."""
    return SIGNATURE + struct.pack("<I", 1) + struct.pack("<I", FLAGS) + struct.pack("<HHI", 0, 0, 0) * 2


def _field(raw: bytes, at: int) -> bytes:
    length, _, offset = struct.unpack("<HHI", raw[at:at + 8])
    return raw[offset:offset + length]


def parse_challenge(raw: bytes) -> tuple[bytes, bytes, int]:
    """(server challenge, target info, flags) of message 2; ValueError when it is not one."""
    if len(raw) < 48 or raw[:8] != SIGNATURE or struct.unpack("<I", raw[8:12])[0] != 2:
        raise ValueError("not an NTLM challenge")
    return raw[24:32], _field(raw, 40), struct.unpack("<I", raw[20:24])[0]


def _pairs(info: bytes) -> list[tuple[int, bytes]]:
    out, i = [], 0
    while i + 4 <= len(info):
        kind, length = struct.unpack("<HH", info[i:i + 4])
        if kind == AV_EOL:
            break
        out.append((kind, info[i + 4:i + 4 + length]))
        i += 4 + length
    return out


def _pack(pairs: list[tuple[int, bytes]]) -> bytes:
    return b"".join(struct.pack("<HH", k, len(v)) + v for k, v in pairs) + struct.pack("<HH", AV_EOL, 0)


def authenticate(negotiate_msg: bytes, challenge_msg: bytes, user: str, password: str, domain: str = "", workstation: str = "",
                 client_challenge: bytes | None = None, now: bytes | None = None) -> bytes:
    """Message 3 from the server's challenge. `client_challenge` and `now` (8 bytes, FILETIME) are for the tests only."""
    server_challenge, info, flags = parse_challenge(challenge_msg)
    pairs = _pairs(info)
    stamp = next((v for k, v in pairs if k == AV_TIMESTAMP), None)
    if stamp is not None:   # a server that sends its time wants a MIC (message integrity code) on the three messages
        pairs = [(k, v) for k, v in pairs if k != AV_FLAGS] + [(AV_FLAGS, struct.pack("<I", MIC_PRESENT))]
    key = ntowf_v2(user, password, domain)
    client_challenge = client_challenge or os.urandom(8)
    temp = b"\x01\x01" + b"\x00" * 6 + (stamp or now or struct.pack("<Q", 0)) + client_challenge + b"\x00" * 4 + _pack(pairs) + b"\x00" * 4
    proof = _md5_hmac(key, server_challenge + temp)
    session_key = _md5_hmac(key, proof)
    nt_response, lm_response = proof + temp, b"\x00" * 24
    parts = [lm_response, nt_response, domain.encode("utf-16-le"), user.encode("utf-16-le"), workstation.encode("utf-16-le"), b""]
    header_len = 88
    head, body, offset = b"", b"", header_len
    for p in parts:
        head += struct.pack("<HHI", len(p), len(p), offset)
        body += p
        offset += len(p)
    out = SIGNATURE + struct.pack("<I", 3) + head + struct.pack("<I", flags & FLAGS) + b"\x00" * 8
    mic_at = len(out)
    out += b"\x00" * 16 + body
    if stamp is not None:
        mic = _md5_hmac(session_key, negotiate_msg + challenge_msg + out)
        out = out[:mic_at] + mic + out[mic_at + 16:]
    return out
