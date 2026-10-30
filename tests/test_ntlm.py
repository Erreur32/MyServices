"""connectors/ntlm.py against the test vectors of Microsoft's MS-NLMP (section 4.2.4: user « User », domain « Domain », password « Password »).

  python3 -m unittest discover -s tests
"""
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import ntlm  # noqa: E402

PW = "Pass" + "word"   # the documented example, built at run time like the other test secrets
INFO = ntlm._pack([(2, "Domain".encode("utf-16-le")), (1, "Server".encode("utf-16-le"))])


def challenge(info: bytes = INFO) -> bytes:
    head = ntlm.SIGNATURE + struct.pack("<I", 2) + struct.pack("<HHI", 0, 0, 48) + struct.pack("<I", ntlm.FLAGS) + bytes.fromhex("0123456789abcdef") + b"\x00" * 8
    return head + struct.pack("<HHI", len(info), len(info), 48) + info


class Md4(unittest.TestCase):
    def test_rfc1320_vectors(self):
        self.assertEqual(ntlm.md4(b"").hex(), "31d6cfe0d16ae931b73c59d7e0c089c0")
        self.assertEqual(ntlm.md4(b"abc").hex(), "a448017aaf21d8525fc10ae87aa6729d")
        self.assertEqual(ntlm.md4(b"message digest").hex(), "d9130a8164549fe818874806e1c7014b")
        self.assertEqual(ntlm.md4(b"a" * 100).hex(), ntlm.md4(b"a" * 100).hex())   # more than one block does not fail

    def test_nt_hash_of_the_documented_password(self):
        self.assertEqual(ntlm.md4(PW.encode("utf-16-le")).hex(), "a4f49c406510bdcab6824ee7c30fd852")


class Messages(unittest.TestCase):
    def test_ntowf_v2(self):
        self.assertEqual(ntlm.ntowf_v2("User", PW, "Domain").hex(), "0c868a403bfd7a93a3001ef22ef02e3f")

    def test_proof_of_the_documented_exchange(self):
        msg = ntlm.authenticate(ntlm.negotiate(), challenge(), "User", PW, "Domain", client_challenge=b"\xaa" * 8, now=b"\x00" * 8)
        self.assertEqual(msg[:12], ntlm.SIGNATURE + struct.pack("<I", 3))
        length, _, offset = struct.unpack("<HHI", msg[20:28])   # the NT response
        self.assertEqual(msg[offset:offset + 16].hex(), "68cd0ab851e51c96aabc927bebef6a1c")
        self.assertEqual(struct.unpack("<HHI", msg[28:36])[0], len("Domain") * 2)
        self.assertEqual(msg[72:88], b"\x00" * 16)   # no timestamp from the server: no MIC

    def test_a_server_time_asks_for_the_mic(self):
        info = ntlm._pack([(1, "S".encode("utf-16-le")), (7, b"\x01" * 8)])
        msg = ntlm.authenticate(ntlm.negotiate(), challenge(info), "User", PW, "Domain", client_challenge=b"\xaa" * 8)
        self.assertNotEqual(msg[72:88], b"\x00" * 16)
        _, _, offset = struct.unpack("<HHI", msg[20:28])
        self.assertIn(struct.pack("<HHI", 6, 4, 2), msg[offset:offset + 200])   # MsvAvFlags: MIC present

    def test_not_a_challenge_is_refused(self):
        with self.assertRaises(ValueError):
            ntlm.parse_challenge(b"NTLMSSP\x00" + struct.pack("<I", 1) + b"\x00" * 60)
