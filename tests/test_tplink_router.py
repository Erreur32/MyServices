"""connectors/tplink_router.py: the LuCI reading against a fake router that speaks the scheme with keys made at run time, never the network.

  À lancer dans l'image : python3 -m unittest tests.test_tplink_router
"""
import base64
import json
import unittest
import urllib.parse

from cryptography.hazmat.primitives import padding as sympad
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from connectors import tplink_router as tp
from connectors.base import ConnectorError, Context
from connectors.tplink_router import TplinkRouter

BASE = "http://192.0.2.1"
PASSWORD = "-".join(("not", "a", "real", "pw"))
USER = "admin"
STOK = "-".join(("stok", "fake", "1"))
PUBLIC_IP = "93.184.216.34"
SEQ = 1234567
PWD_KEY = rsa.generate_private_key(65537, 1024)
SIGN_KEY = rsa.generate_private_key(65537, 1024)
STATUS = {"wan_ipv4_ipaddr": PUBLIC_IP, "wan_ipv4_uptime": 90000, "access_devices_wired": [{}, {}], "access_devices_wireless_host": [{}],
          "access_devices_wireless_guest": [], "wireless_2g_enable": "off", "wireless_5g_enable": "on"}
FIRMWARE = {"model": "Archer C6U", "firmware_version": "1.2.3 Build 20230101", "hardware_version": "1.0"}


def hexpair(key) -> list[str]:
    n = key.public_key().public_numbers()
    return [format(n.n, "x"), format(n.e, "x")]


def rsa_open(key, hexa: str) -> str:
    size = key.key_size // 8
    parts = [hexa[i:i + size * 2] for i in range(0, len(hexa), size * 2)]
    return "".join(key.decrypt(bytes.fromhex(p), padding.PKCS1v15()).decode() for p in parts)


class FakeRouter(TplinkRouter):
    """Plays the router: opens sign and data with the private keys, answers encrypted. `pages` maps a read page to its data; the calls are recorded."""

    def __init__(self, pages=None, password=PASSWORD, keys=None, login_answer=None, **conf):
        super().__init__({"type": "tplink-router", "name": "box", "url": BASE, "username": USER, "password": password, **conf}, Context())
        self.pages = {"admin/status?form=all": STATUS, "admin/firmware?form=upgrade": FIRMWARE} if pages is None else pages
        self.keys, self.login_answer = keys, login_answer
        self.calls, self.aes, self.logged_in = [], None, False

    def fetch(self, path, form):
        self.calls.append((path, dict(form)))
        if path.endswith("form=keys"):
            return json.dumps({"success": True, "data": {"password": hexpair(PWD_KEY)}}).encode() if self.keys is None else self.keys
        if path.endswith("form=auth"):
            return json.dumps({"success": True, "data": {"seq": SEQ, "key": hexpair(SIGN_KEY)}}).encode()
        sign = rsa_open(SIGN_KEY, form["sign"])
        fields = dict(p.split("=", 1) for p in sign.split("&"))
        if "k" in fields:
            self.aes = (fields["k"], fields["i"])
        key, iv = self.aes
        dec = Cipher(algorithms.AES(key.encode()), modes.CBC(iv.encode())).decryptor()
        un = sympad.PKCS7(128).unpadder()
        text = (un.update(dec.update(base64.b64decode(form["data"])) + dec.finalize()) + un.finalize()).decode()
        assert fields["s"] == str(SEQ + len(form["data"]))
        return self.answer(path, text, fields)

    def reply(self, doc) -> bytes:
        return json.dumps({"data": tp.aes_encrypt(json.dumps(doc), *self.aes)}).encode()

    def answer(self, path, text, fields) -> bytes:
        if "form=login" in path:
            asked = dict(urllib.parse.parse_qsl(text))
            secret = PWD_KEY.decrypt(bytes.fromhex(asked["password"]), padding.PKCS1v15()).decode()
            if self.login_answer is not None:
                return self.reply(self.login_answer)
            if secret != PASSWORD or fields["h"] != tp.hashlib.md5((USER + PASSWORD).encode()).hexdigest():
                return self.reply({"success": False, "errorcode": "login failed", "data": {"attemptsAllowed": 8}})
            self.logged_in = True
            return self.reply({"success": True, "data": {"stok": STOK}})
        if "form=logout" in path:
            self.logged_in = False
            return self.reply({"success": True})
        page = path.split("/", 1)[1]
        if STOK not in path or page not in self.pages:
            return self.reply({"success": False, "errorcode": "no such page"}) if STOK in path else b"<html>"
        return self.reply({"success": True, "data": self.pages[page]})


class Reading(unittest.TestCase):
    def setUp(self):
        tp.REFUSED_BY.clear()

    def test_full_reading(self):
        router = FakeRouter()
        card = router.collect()
        box = card["box"]
        self.assertEqual((box["model"], box["connected"], box["public_ip"], box["uptime_s"], box["firmware"]), ("Archer C6U", True, PUBLIC_IP, 90000, "1.2.3 Build 20230101"))
        self.assertEqual((box["devices"], box["wifi"]), (3, True))
        for empty in ("line", "line_down_bps", "line_up_bps", "down_bps", "up_bps", "update_available", "temperature"):
            self.assertIsNone(box[empty])
        self.assertEqual(card["version"], "1.2.3 Build 20230101")
        self.assertNotIn(PASSWORD, json.dumps(card))
        self.assertNotIn(STOK, json.dumps(card))
        self.assertTrue(router.test().ok)

    def test_session_is_released_and_only_reads(self):
        router = FakeRouter()
        router.collect()
        self.assertTrue(router.calls[-1][0].endswith("admin/system?form=logout"))
        self.assertFalse(router.logged_in)
        self.assertEqual(sorted(p.split("?")[0].split("/")[-1] for p, _ in router.calls if STOK in p), ["firmware", "status", "system"])

    def test_password_never_in_the_clear_on_the_wire(self):
        router = FakeRouter()
        router.collect()
        self.assertNotIn(PASSWORD, json.dumps(router.calls))

    def test_missing_fields_stay_empty(self):
        card = FakeRouter({"admin/status?form=all": {"wan_ipv4_ipaddr": "0.0.0.0"}}).collect()
        box = card["box"]
        self.assertEqual((box["connected"], box["public_ip"], box["uptime_s"], box["devices"], box["wifi"], box["model"], box["firmware"]), (False, None, None, None, None, None, None))
        self.assertEqual(card["problems"], ["connexion Internet coupée"])

    def test_private_wan_address_is_not_shown(self):
        card = FakeRouter({"admin/status?form=all": {"wan_ipv4_ipaddr": "10.0.0.2"}}).collect()
        self.assertEqual((card["box"]["connected"], card["box"]["public_ip"]), (True, None))

    def test_unreadable_status_answer(self):
        router = FakeRouter({"admin/status?form=all": {}})
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.UNREADABLE)

    def test_page_that_is_not_json(self):
        router = FakeRouter({})
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.SESSION_LOST)
        self.assertFalse(router.logged_in)


class Login(unittest.TestCase):
    def setUp(self):
        tp.REFUSED_BY.clear()

    def test_refused_password_is_remembered(self):
        router = FakeRouter(password="-".join(("wrong", "pw")))
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.REFUSED)
        tried = len(router.calls)
        again = FakeRouter(password="-".join(("wrong", "pw")))
        with self.assertRaises(ConnectorError):
            again.collect()
        self.assertEqual(again.calls, [])
        self.assertGreater(tried, 0)

    def test_changed_password_is_tried_again(self):
        refused = FakeRouter(password="-".join(("wrong", "pw")))
        with self.assertRaises(ConnectorError):
            refused.collect()
        self.assertEqual(FakeRouter().collect()["box"]["model"], "Archer C6U")

    def test_locked_router_is_not_remembered_as_refused(self):
        router = FakeRouter(login_answer={"success": False, "data": {"errorcode": "exceeded max attempts"}})
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.LOCKED)
        self.assertEqual(tp.REFUSED_BY, {})

    def test_http_403_at_login(self):
        router = FakeRouter()
        real = router.fetch

        def fetch(path, form):
            if path.endswith("form=login"):
                raise ConnectorError("HTTP 403")
            return real(path, form)
        router.fetch = fetch
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.DENIED)
        self.assertEqual(tp.REFUSED_BY, {})


class Unsupported(unittest.TestCase):
    def setUp(self):
        tp.REFUSED_BY.clear()

    def test_router_without_the_luci_pages(self):
        router = FakeRouter()

        def fetch(path, form):
            raise ConnectorError("HTTP 404")
        router.fetch = fetch
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.UNSUPPORTED)

    def test_two_thousand_bit_password_key(self):
        big = rsa.generate_private_key(65537, 2048)
        router = FakeRouter(keys=json.dumps({"success": True, "data": {"password": hexpair(big)}}).encode())
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.UNSUPPORTED)
        self.assertEqual(len(router.calls), 2)   # keys and auth only: no login was sent

    def test_keys_page_that_is_not_json(self):
        router = FakeRouter(keys=b"<html>login</html>")
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.UNSUPPORTED)

    def test_garbled_encrypted_answer(self):
        router = FakeRouter()
        router.reply = lambda doc: json.dumps({"data": "%%not base64%%"}).encode()
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.UNREADABLE)


class Helpers(unittest.TestCase):
    def test_flag_and_counts(self):
        self.assertEqual([tp.flag(v) for v in ("on", "Yes", 1, "off", None, "?")], [True, True, True, False, None, None])
        self.assertIsNone(tp.count_devices({}))
        self.assertIsNone(tp.wifi_state({"wireless_2g_enable": "?"}))

    def test_password_too_long_for_the_key(self):
        router = FakeRouter(password="x" * 200)
        with self.assertRaises(ConnectorError) as cm:
            router.collect()
        self.assertEqual(str(cm.exception), tp.PASSWORD_TOO_LONG)


if __name__ == "__main__":
    unittest.main()
