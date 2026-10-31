"""connectors/technicolor_gateway.py: the SRP-6 login against an independent server-side computation, and the page readings against frozen pages, never the network.

  À lancer dans l'image : python3 -m unittest tests.test_technicolor_gateway
"""
import hashlib
import json
import unittest

from connectors import technicolor_gateway as tg
from connectors.base import ConnectorError, Context
from connectors.technicolor_gateway import TechnicolorGateway, Page, srp_proof, srp_public, uptime_of

BASE = "http://192.168.0.1"
USER = "admin"
PASSWORD = "-".join(("not", "a", "real", "pw"))
PUBLIC = ".".join(("93", "184", "216", "34"))
SALT = bytes.fromhex("0a1b2c3d4e5f60718293a4b5c6d7e8f9")
LOGIN = b'<html><head><meta name="CSRFtoken" content="tok123"></head><body>login</body></html>'


def row(label, *values):
    return f"<div><span>{label}</span><span>{'</span><span>'.join(values)}</span></div>"


def html(*rows):
    return ("<html><body><script>var x='Line Rate'</script>" + "".join(rows) + "</body></html>").encode()


GATEWAY = html(row("Product Name", "DJA0231"), row("Software Version", "AB.CD.EF"), row("Uptime", "5 days 1 hours 2 minutes 3 seconds"))
BROADBAND = html(row("DSL Status", "Up"), row("DSL Mode", "VDSL2"), row("DSL Uptime", "1 days 2 hours 3 minutes 4 seconds"),
                 row("Line Rate", "20.94 Mbps", "61.08 Mbps"), row("Maximum Line rate", "30 Mbps", "90 Mbps"))
DEVICES = html("<table><tr><th>Hostname</th><th>MAC</th></tr><tr><td>a</td><td>AA:BB:CC:DD:EE:01</td></tr><tr><td>b</td><td>aa:bb:cc:dd:ee:02</td></tr></table>")
INTERNET = html(row("IP Address", PUBLIC))


class Server:
    """The server side of SRP-6 as the textbook gives it (B = kv + g^b, S = (A v^u)^b), written apart from the connector's client side."""

    def __init__(self, user, password, bad_proof=False):
        n, g, k = tg.N, 2, tg.K
        b_len = lambda i: i.to_bytes((i.bit_length() + 7) // 8, "big")
        sha = lambda *p: int.from_bytes(hashlib.sha256(b"".join(p)).digest(), "big")
        s = int.from_bytes(SALT, "big")
        x = sha(b_len(s), b_len(sha(f"{user}:{password}".encode())))
        self.v, self.b = pow(g, x, n), 0x1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF
        self.B = (k * self.v + pow(g, self.b, n)) % n
        self.bad_proof = bad_proof
        self.n, self.g, self.s, self.user, self.b_len, self.sha = n, g, s, user, b_len, sha

    def first(self, big_a: bytes) -> bytes:
        self.A = int.from_bytes(big_a, "big")
        return json.dumps({"s": SALT.hex(), "B": self.b_len(self.B).hex()}).encode()

    def second(self, m: bytes) -> bytes:
        n, b_len, sha = self.n, self.b_len, self.sha
        u = sha(b_len(self.A), b_len(self.B))
        key = hashlib.sha256(b_len(pow(self.A * pow(self.v, u, n), self.b, n))).digest()
        xor = bytes(p ^ q for p, q in zip(hashlib.sha256(b_len(n)).digest(), hashlib.sha256(b_len(self.g)).digest()))
        want = hashlib.sha256(xor + hashlib.sha256(self.user.encode()).digest() + b_len(self.s) + b_len(self.A) + b_len(self.B) + key).digest()
        if m != want:
            return json.dumps({"error": "bad"}).encode()
        proof = hashlib.sha256(b_len(self.A) + want + key).digest()
        return json.dumps({"M": (b"\0" * 32 if self.bad_proof else proof).hex()}).encode()


class Fake(TechnicolorGateway):
    """Answers by « METHOD path » for the pages, and runs a real SRP server for /authenticate."""

    def fetch(self, method, path, form=None):
        self.calls.append((method, path, form))
        if path == tg.AUTH_PATH:
            if self.auth_error:
                raise ConnectorError(self.auth_error)
            if "A" in form:
                return self.server.first(bytes.fromhex(form["A"]))
            return self.server.second(bytes.fromhex(form["M"]))
        got = self.pages.get(f"{method} {path}")
        if got is None:
            raise ConnectorError("HTTP 404")
        return got


def make(conf=None, pages=None, password=PASSWORD, bad_proof=False, auth_error=None):
    tg.REFUSED_BY.clear()
    base = {"url": BASE, "username": USER, "password": PASSWORD, **(conf or {})}
    c = Fake(base, Context(timeout=1))
    c.calls, c.auth_error = [], auth_error
    c.server = Server(USER, password, bad_proof)
    c.pages = {"GET ": LOGIN, "GET modals/gateway-modal.lp": GATEWAY, "GET modals/broadband-modal.lp": BROADBAND, "GET modals/device-modal.lp": DEVICES,
               "GET modals/internet-modal.lp": INTERNET, **(pages or {})}
    return c


class Srp(unittest.TestCase):
    def test_client_proof_matches_independent_server(self):
        a = 0xABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789
        srv = Server(USER, PASSWORD)
        challenge = json.loads(srv.first(tg.raw(srp_public(a))))
        m, expected = srp_proof(USER, PASSWORD, a, bytes.fromhex(challenge["s"]), bytes.fromhex(challenge["B"]))
        self.assertEqual(bytes.fromhex(json.loads(srv.second(m))["M"]), expected)

    def test_wrong_password_gives_a_proof_the_server_rejects(self):
        a = 0xABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789
        srv = Server(USER, PASSWORD)
        challenge = json.loads(srv.first(tg.raw(srp_public(a))))
        m, _ = srp_proof(USER, "other", a, bytes.fromhex(challenge["s"]), bytes.fromhex(challenge["B"]))
        self.assertIn("error", json.loads(srv.second(m)))

    def test_degenerate_server_value_refused(self):
        with self.assertRaises(ConnectorError):
            srp_proof(USER, PASSWORD, 5, SALT, bytes(1))


class Parsing(unittest.TestCase):
    def test_labels_and_rates(self):
        p = Page(BROADBAND)
        self.assertEqual(p.value("DSL Status"), "Up")
        self.assertEqual(p.rates("Line Rate"), (20_940_000, 61_080_000))
        self.assertEqual(p.rates("Missing"), (None, None))

    def test_script_text_is_ignored(self):
        self.assertNotIn("var x='Line Rate'", Page(GATEWAY).nodes)

    def test_uptime(self):
        self.assertEqual(uptime_of("1 days 2 hours 3 minutes 4 seconds"), 93784)
        self.assertEqual(uptime_of("2:03:04"), 7384)
        self.assertIsNone(uptime_of("soon"))


class Collect(unittest.TestCase):
    def test_full_reading(self):
        c = make()
        d = c.collect()
        box = d["box"]
        self.assertEqual((box["model"], box["firmware"], box["line"], box["connected"]), ("DJA0231", "AB.CD.EF", "dsl", True))
        self.assertEqual((box["line_up_bps"], box["line_down_bps"], box["uptime_s"], box["devices"], box["public_ip"]), (20_940_000, 61_080_000, 93784, 2, PUBLIC))
        self.assertEqual([c_[1] for c_ in c.calls[:3]], ["", tg.AUTH_PATH, tg.AUTH_PATH])
        self.assertNotIn(PASSWORD, json.dumps(d))
        self.assertTrue(all(PASSWORD not in json.dumps(c_[2]) for c_ in c.calls))

    def test_missing_pages_leave_fields_empty(self):
        c = make(pages={"GET modals/broadband-modal.lp": None, "GET modals/internet-modal.lp": None, "GET modals/device-modal.lp": None})
        box = c.collect()["box"]
        self.assertEqual((box["model"], box["line"], box["connected"], box["devices"], box["public_ip"]), ("DJA0231", None, None, None, None))

    def test_private_address_is_not_a_public_one(self):
        self.assertIsNone(make(pages={"GET modals/internet-modal.lp": INTERNET.replace(PUBLIC.encode(), b"10.0.0.2")}).collect()["box"]["public_ip"])

    def test_wrong_password_stops_at_the_first_call_and_is_not_repeated(self):
        c = make(password="something else")
        with self.assertRaises(ConnectorError) as e:
            c.collect()
        self.assertEqual(str(e.exception), tg.REFUSED)
        self.assertNotIn(PASSWORD, str(e.exception))
        n = len(c.calls)
        with self.assertRaises(ConnectorError):
            c.collect()
        self.assertEqual(len(c.calls), n)   # no second attempt with the same credentials
        c.conf["password"] = "changed"
        with self.assertRaises(ConnectorError):
            c.collect()   # new credentials: tried once (the fake server still refuses)
        self.assertGreater(len(c.calls), n)

    def test_http_403_on_authenticate_is_a_refusal(self):
        box = make(auth_error="HTTP 403")
        with self.assertRaises(ConnectorError) as e:
            box.collect()
        self.assertEqual(str(e.exception), tg.REFUSED)

    def test_server_proof_checked(self):
        box = make(bad_proof=True)
        with self.assertRaises(ConnectorError) as e:
            box.collect()
        self.assertEqual(str(e.exception), tg.BAD_PROOF)

    def test_not_a_homeware_page(self):
        box = make(pages={"GET ": b"<html>hello</html>"})
        with self.assertRaises(ConnectorError) as e:
            box.collect()
        self.assertEqual(str(e.exception), tg.UNKNOWN)

    def test_login_page_instead_of_data_is_a_lost_session(self):
        box = make(pages={"GET modals/gateway-modal.lp": LOGIN})
        with self.assertRaises(ConnectorError) as e:
            box.collect()
        self.assertEqual(str(e.exception), tg.SESSION_LOST)

    def test_unreadable_page_is_unknown(self):
        box = make(pages={"GET modals/gateway-modal.lp": b"<p>nothing</p>"})
        with self.assertRaises(ConnectorError) as e:
            box.collect()
        self.assertEqual(str(e.exception), tg.UNKNOWN)

    def test_test_shows_no_secret(self):
        r = make().test()
        self.assertTrue(r.ok)
        self.assertNotIn(PASSWORD, r.message)
        self.assertNotIn(PUBLIC, r.message)


if __name__ == "__main__":
    unittest.main()
