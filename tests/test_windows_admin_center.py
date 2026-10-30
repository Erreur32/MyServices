"""connectors/windows_admin_center.py against a small fake gateway that asks for the Windows sign-in (NTLM) on ONE connection and checks the proof.

  python3 -m unittest discover -s tests
"""
import base64
import json
import struct
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import ntlm  # noqa: E402
from connectors.base import ConnectorError  # noqa: E402
from connectors.windows_admin_center import WindowsAdminCenter  # noqa: E402

PW = "Pass" + "word"
CHALLENGE = bytes.fromhex("0123456789abcdef")
INFO = ntlm._pack([(2, "DOMAIN".encode("utf-16-le")), (1, "WAC".encode("utf-16-le"))])
TYPE2 = (ntlm.SIGNATURE + struct.pack("<I", 2) + struct.pack("<HHI", 0, 0, 48) + struct.pack("<I", ntlm.FLAGS) + CHALLENGE + b"\x00" * 8
         + struct.pack("<HHI", len(INFO), len(INFO), 48) + INFO)
CONNECTIONS = {"value": [{"id": "msft.sme.connection-type.server!srv1", "name": "srv1", "type": "msft.sme.connection-type.server", "tags": ["prod"]},
                         {"id": "msft.sme.connection-type.cluster!cl1", "name": "cl1", "type": "msft.sme.connection-type.cluster", "tags": []},
                         {"id": "msft.sme.connection-type.windowsClient!pc1", "name": "pc1", "type": "msft.sme.connection-type.windowsClient"}]}


class Gateway(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive: the sign-in only holds on one connection
    offered = ("Negotiate", "NTLM")
    answer = CONNECTIONS

    def log_message(self, *a):
        pass

    def _send(self, code: int, body: bytes = b"", www: list[str] | None = None, cookies: tuple = ()):
        self.send_response(code)
        for w in www or []:
            self.send_header("WWW-Authenticate", w)
        for c in cookies:
            self.send_header("Set-Cookie", c)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        auth = self.headers.get("Authorization", "")
        word, _, token = auth.partition(" ")
        scheme = "NTLM" if word.upper() == "NTLM" else "Negotiate"   # a fixed word, never the client's text, in a header
        if not auth:
            return self._send(401, www=list(self.offered))
        raw = base64.b64decode(token)
        kind = struct.unpack("<I", raw[8:12])[0]
        if kind == 1:
            return self._send(401, www=[f"{scheme} {base64.b64encode(TYPE2).decode()}"])
        length, _, offset = struct.unpack("<HHI", raw[20:28])   # the NT response: proof (16 bytes) then the blob it covers
        nt = raw[offset:offset + length]
        domain = raw[struct.unpack("<I", raw[32:36])[0]:][:struct.unpack("<H", raw[28:30])[0]].decode("utf-16-le")
        user = raw[struct.unpack("<I", raw[40:44])[0]:][:struct.unpack("<H", raw[36:38])[0]].decode("utf-16-le")
        expected = ntlm._md5_hmac(ntlm.ntowf_v2(user, PW, domain), CHALLENGE + nt[16:])
        if user != "alice" or nt[:16] != expected:
            return self._send(401, www=list(self.offered))
        self._send(200, json.dumps(self.answer).encode())


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
CSRF = "csrf&amp;1"


def _b64url(number: int) -> str:
    return base64.urlsafe_b64encode(number.to_bytes((number.bit_length() + 7) // 8, "big")).rstrip(b"=").decode()


class RecentGateway(Gateway):
    """The recent gateway: a login page and cookies, the calls of its page, no Windows challenge."""

    def do_GET(self):
        cookie = self.headers.get("Cookie", "")
        if self.path == "/api/connections" and "WAC-TOKEN=signed" in cookie:
            return self._send(200, json.dumps(self.answer).encode())
        if self.path == "/":
            page = f'<input type="text" name="username" /><input type="hidden" name="csrf" id="csrf" value="{CSRF}" />'
            return self._send(403, page.encode(), cookies=("WAC-SESSION=s1; path=/; HttpOnly",))
        self._send(403, b'{"error":{"code":"UnauthorizedExpiredError"}}', cookies=("WAC-TOKEN=; path=/",))

    def do_POST(self):
        got = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if "WAC-SESSION=s1" not in self.headers.get("Cookie", "") or got.get("csrf") != "csrf&1":
            return self._send(403)
        if self.path == "/api/user/key":
            numbers = KEY.public_key().public_numbers()
            return self._send(200, json.dumps({"jwk": {"kty": "RSA", "n": _b64url(numbers.n), "e": _b64url(numbers.e)}}).encode())
        sealed = padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
        who = json.loads(KEY.decrypt(base64.b64decode(got["packet"]), sealed))
        if who != {"username": "DOMAIN\\alice", "password": PW, "csrf": "csrf&1"}:
            return self._send(401)
        self._send(200, b"{}", cookies=("WAC-TOKEN=signed; path=/; HttpOnly",))


def serve(**attrs):
    handler = type("H", (Gateway,), attrs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def connector(server, user="DOMAIN\\alice", password=PW):
    return WindowsAdminCenter({"name": "wac", "url": f"http://127.0.0.1:{server.server_port}", "user": user, "password": password}, None)


class Collect(unittest.TestCase):
    def serve(self, **attrs):
        s = serve(**attrs)
        self.addCleanup(s.server_close)
        self.addCleanup(s.shutdown)
        return s

    def test_the_connections_are_read_after_the_windows_sign_in(self):
        d = connector(self.serve()).collect()
        self.assertEqual([(r["name"], r["kind"]) for r in d["connections"]], [("srv1", "server"), ("cl1", "cluster"), ("pc1", "pc")])
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}, {"Connexions": "3", "Serveurs": "1", "Clusters": "1", "PC": "1"})
        self.assertEqual(d["connections"][0]["tags"], ["prod"])

    def test_a_plain_list_and_the_ntlm_only_scheme_work_too(self):
        d = connector(self.serve(offered=("NTLM",), answer=[{"id": "x!srv2", "name": "srv2", "type": "x.server"}])).collect()
        self.assertEqual([r["name"] for r in d["connections"]], ["srv2"])

    def test_a_wrong_password_is_said(self):
        wrong = connector(self.serve(), password="wrong")
        with self.assertRaises(ConnectorError) as e:
            wrong.collect()
        self.assertIn("compte refusé", str(e.exception))

    def test_a_gateway_without_the_windows_sign_in_is_said(self):
        form_only = connector(self.serve(offered=("Basic realm=\"wac\"",)))
        with self.assertRaises(ConnectorError) as e:
            form_only.collect()
        self.assertIn("n'est pas proposée", str(e.exception))

    def recent(self, gateway=RecentGateway):
        s = ThreadingHTTPServer(("127.0.0.1", 0), gateway)
        threading.Thread(target=s.serve_forever, daemon=True).start()
        self.addCleanup(s.server_close)
        self.addCleanup(s.shutdown)
        return s

    def test_a_recent_gateway_is_read_after_its_login_page(self):
        d = connector(self.recent()).collect()
        self.assertEqual([r["name"] for r in d["connections"]], ["srv1", "cl1", "pc1"])

    def test_a_wrong_password_on_the_login_page_is_said(self):
        wrong = connector(self.recent(), password="wrong")
        with self.assertRaises(ConnectorError) as e:
            wrong.collect()
        self.assertIn("compte refusé", str(e.exception))

    def test_a_login_page_without_csrf_is_said(self):
        class NoPage(RecentGateway):
            def do_GET(self):
                self._send(403, b"<html></html>")
        unknown = connector(self.recent(NoPage))
        with self.assertRaises(ConnectorError) as e:
            unknown.collect()
        self.assertIn("non reconnue", str(e.exception))

    def test_test_gives_the_count(self):
        r = connector(self.serve()).test()
        self.assertTrue(r.ok)
        self.assertEqual(r.message, "3 connexion(s) lue(s)")

    def test_domain_and_user_are_split(self):
        from connectors.windows_admin_center import _account
        self.assertEqual(_account("CORP\\bob"), ("CORP", "bob"))
        self.assertEqual(_account("bob@corp.local"), ("", "bob@corp.local"))
        self.assertEqual(_account("bob"), ("", "bob"))
