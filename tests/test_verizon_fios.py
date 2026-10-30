"""connectors/verizon_fios.py: the reading of the web pages of a Fios router against frozen answers (fetch() replaced), never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import hashlib
import json
import unittest
import urllib.parse

from connectors.base import ConnectorError, Context
from connectors.verizon_fios import REFUSED_BY, HttpStatus, VerizonFios, js_records, known_devices, luci_password, md5_sha512

BASE = "https://192.168.1.1"
PUBLIC_IP = ".".join(("1", "1", "1", "42"))   # a global address: the documentation ranges are not
SECRET = "pw-" + "x".join(("a", "b", "c"))    # built at run time, never a literal credential
TOKEN = "ab" * 16
SALT = "cd" * 8
STATUS_JS = f'addROD("uptime", "7200");\naddROD("get_wan4_ip", "{PUBLIC_IP}");\naddROD("cgi_wan_ip6_addr", "");\n'
OWL_JS = 'addROD("known_device_list", { "known_devices": [ {"mac":"m1","hostname":"a","activity":1}, {"mac":"m2","hostname":"b","activity":0}, {"mac":"m3","hostname":"c","activity":1} ] });\n'


class Fake(VerizonFios):
    """Answers by path; a path not listed is a 404. Records the calls; cookies are faked."""

    def __init__(self, answers: dict, cookies: dict | None = None, **conf):
        super().__init__({"type": "verizon-fios", "name": "box", "url": BASE, "password": SECRET, **conf}, Context())
        self.answers, self.calls, self.cookies = answers, [], cookies or {}

    def fetch(self, path, body=None, headers=None):
        self.calls.append((path, body, headers))
        if path not in self.answers:
            raise HttpStatus(404)
        answer = self.answers[path]
        return answer(body) if callable(answer) else answer

    def cookie(self, name):
        return self.cookies.get(name)


def g3100(good=True) -> dict:
    state = {"in": False}

    def login(body):
        form = dict(urllib.parse.parse_qsl(body.decode()))
        state["in"] = good and form["luci_password"] == luci_password(SECRET, TOKEN) and form["luci_token"] == TOKEN
        return b""

    def status(_):
        return json.dumps({"loginToken": TOKEN, "islogin": "1" if state["in"] else "0", "token": "tok"}).encode()
    return {"loginStatus.cgi": status, "login.cgi": login, "logout.cgi": b"", "cgi/cgi_status.js": STATUS_JS.encode(), "cgi/cgi_owl.js": OWL_JS.encode()}


def g1100(good=True) -> dict:
    proof = hashlib.sha512((SECRET + SALT).encode()).hexdigest()

    def login(body):
        if json.loads(body)["password"] != proof or not good:
            raise HttpStatus(401)
        return b"{}"
    return {"api/login": lambda body: login(body) if body else json.dumps({"passwordSalt": SALT}).encode(),
            "api/devices": json.dumps([{"mac": "m1", "name": "a", "status": True}, {"mac": "m2", "name": "b", "status": False}]).encode()}


class Helpers(unittest.TestCase):
    def test_hashes(self):
        self.assertEqual(md5_sha512("admin"), hashlib.sha512(hashlib.md5(b"admin").hexdigest().encode()).hexdigest())
        self.assertEqual(luci_password("x", ""), md5_sha512("x"))
        self.assertEqual(luci_password("x", "T"), hashlib.sha512(("T" + md5_sha512("x")).encode()).hexdigest())

    def test_pages(self):
        self.assertEqual(js_records(STATUS_JS), {"uptime": "7200", "get_wan4_ip": PUBLIC_IP, "cgi_wan_ip6_addr": ""})
        self.assertEqual(known_devices(OWL_JS), 2)
        self.assertIsNone(known_devices("nothing"))
        self.assertIsNone(known_devices('addROD("known_device_list", { broken'))


class Reading(unittest.TestCase):
    def setUp(self):
        REFUSED_BY.clear()

    def test_g3100(self):
        f = Fake(g3100())
        card = f.collect()
        box = card["box"]
        self.assertEqual((box["line"], box["public_ip"], box["uptime_s"], box["devices"], box["connected"]), ("fibre", PUBLIC_IP, 7200, 2, None))
        self.assertNotIn(PUBLIC_IP, str(card["facts"]))
        self.assertNotIn(SECRET, str(f.calls))
        self.assertEqual(f.calls[-1][0], "logout.cgi")

    def test_g3100_missing_fields(self):
        answers = {**g3100(), "cgi/cgi_status.js": b"", "cgi/cgi_owl.js": b"garbage"}
        box = Fake(answers).collect()["box"]
        self.assertEqual((box["public_ip"], box["uptime_s"], box["devices"]), (None, None, None))
        del answers["cgi/cgi_owl.js"]
        self.assertIsNone(Fake(answers).collect()["box"]["devices"])

    def test_g3100_refused_once_then_remembered(self):
        f = Fake(g3100(False))
        with self.assertRaises(ConnectorError) as cm:
            f.collect()
        self.assertNotIn(SECRET, str(cm.exception))
        n = len(f.calls)
        with self.assertRaises(ConnectorError):
            f.collect()
        self.assertEqual(len(f.calls), n)

    def test_g3100_sessions_full_and_unreadable(self):
        def full(_):
            raise HttpStatus(403)
        answers = {**g3100(), "login.cgi": full}
        with self.assertRaises(ConnectorError) as cm:
            Fake(answers).collect()
        self.assertIn("Refused", type(cm.exception).__name__)   # 403 without the sessions flag = refused
        body = json.dumps({"flag": 2, "maxsession": 3}).encode()

        def full2(_):
            raise HttpStatus(403, body)
        with self.assertRaises(ConnectorError) as cm:
            Fake({**g3100(), "login.cgi": full2}, password=SECRET + "2").collect()
        self.assertIn("sessions", str(cm.exception))
        with self.assertRaises(ConnectorError):
            Fake({"loginStatus.cgi": b"<html>"}).collect()

    def test_g1100(self):
        f = Fake(g1100(), cookies={"XSRF-TOKEN": "xt"})
        box = f.collect()["box"]
        self.assertEqual((box["model"], box["line"], box["devices"], box["public_ip"]), ("Fios Quantum Gateway G1100", "fibre", 1, None))
        self.assertEqual(f.calls[-1][2], {"X-XSRF-TOKEN": "xt"})
        self.assertNotIn(SECRET, str(f.calls))

    def test_g1100_refused_and_no_cookie(self):
        with self.assertRaises(ConnectorError) as cm:
            Fake(g1100(False), cookies={"XSRF-TOKEN": "xt"}).collect()
        self.assertNotIn(SECRET, str(cm.exception))
        REFUSED_BY.clear()
        with self.assertRaises(ConnectorError):
            Fake(g1100()).collect()   # login answered but no XSRF cookie

    def test_unreachable_is_not_a_refusal(self):
        class Down(Fake):
            def fetch(self, *a, **k):
                raise ConnectorError("injoignable (timeout)")
        with self.assertRaises(ConnectorError):
            Down({}).collect()
        self.assertEqual(REFUSED_BY, {})


if __name__ == "__main__":
    unittest.main()
