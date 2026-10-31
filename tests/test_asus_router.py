"""connectors/asus_router.py: the AsusWRT web reading against frozen answers, never the network.

  À lancer dans l'image : python3 -m unittest tests.test_asus_router
"""
import base64
import json
import unittest
import urllib.parse

from connectors import asus_router as ar
from connectors.base import ConnectorError, Context, RateLimited
from connectors.asus_router import AsusRouter

BASE = "http://192.0.2.1"
USER = "admin"
PASSWORD = "-".join(("not", "a", "real", "pw"))
TOKEN = "-".join(("tok", "fake", "1"))
PUBLIC_IP = "93.184.216.34"
MAIN = {
    "get_wan_unit": 0, "productid": "RT-AX88U", "firmver": "3.0.0.4", "buildno": "388", "extendno": "24198",
    "link_internet": "2", "wan0_state_t": "2", "wan0_realip_ip": PUBLIC_IP, "wan0_ipaddr": PUBLIC_IP,
    "wan1_state_t": "0", "wan1_realip_ip": "", "wan1_ipaddr": "0.0.0.0",
    "wl0_radio": "0", "wl1_radio": "1", "wl2_radio": "", "wl3_radio": "",
}
CLIENTS = {"get_clientlist": {
    "02:00:00:00:00:01": {"isOnline": "1", "isGateway": "0"}, "02:00:00:00:00:02": {"isOnline": "1"},
    "02:00:00:00:00:03": {"isOnline": "0"}, "02:00:00:00:00:04": {"isOnline": "1", "isGateway": "1"},
    "maclist": ["02:00:00:00:00:01"], "ClientAPILevel": "2"}}


class Fake(Context):
    """Answers as bytes by path; the hook of an appGet call tells the page. A string is a raw answer, an Exception is raised."""

    def __init__(self, main=None, clients=None, login=None):
        super().__init__()
        self.main, self.clients, self.calls = MAIN if main is None else main, CLIENTS if clients is None else clients, []
        self.login = {"asus_token": TOKEN} if login is None else login

    def http(self, url, *, method="GET", form=None, headers=None, payload=None, binary=False, **kw):
        path = url.removeprefix(BASE)
        self.calls.append((method, path, form, headers))
        assert binary, "the connector reads the answers itself"
        if path == "/login.cgi":
            got = self.login
        elif path == "/Logout.asp":
            got = ""
        else:
            hook = urllib.parse.unquote(path.removeprefix("/appGet.cgi?hook="))
            got = self.clients if hook.startswith("get_clientlist") else self.main
        if isinstance(got, Exception):
            raise got
        return (got if isinstance(got, str) else json.dumps(got)).encode()


def make(ctx: Fake) -> AsusRouter:
    return AsusRouter({"type": "asus-router", "name": "router", "url": BASE, "username": USER, "password": PASSWORD}, ctx)


def hooks(ctx: Fake) -> list:
    return [c for c in ctx.calls if c[1].startswith("/appGet.cgi")]


class Base(unittest.TestCase):
    def setUp(self):
        ar.REFUSED_BY.clear()


class Reading(Base):
    def test_full_reading(self):
        ctx = Fake()
        d = make(ctx).collect()
        box = d["box"]
        self.assertEqual((box["model"], box["connected"], box["firmware"]), ("RT-AX88U", True, "3.0.0.4.388_24198"))
        self.assertEqual((box["public_ip"], box["devices"], box["wifi"]), (PUBLIC_IP, 2, True))
        for name in ("line", "down_bps", "up_bps", "line_down_bps", "line_up_bps", "uptime_s", "update_available", "temperature"):
            self.assertIsNone(box[name], name)
        self.assertNotIn(PASSWORD, str(d))
        self.assertNotIn(TOKEN, str(d))

    def test_login_form_cookie_and_logout(self):
        ctx = Fake()
        make(ctx).collect()
        method, path, form, headers = ctx.calls[0]
        self.assertEqual((method, path), ("POST", "/login.cgi"))
        self.assertEqual(base64.b64decode(form["login_authorization"]).decode(), f"{USER}:{PASSWORD}")
        self.assertTrue(headers["User-Agent"])
        self.assertTrue(all(c[3]["Cookie"] == f"asus_token={TOKEN}" for c in hooks(ctx)))
        self.assertEqual(ctx.calls[-1][:2], ("POST", "/Logout.asp"))
        self.assertEqual({c[1].split("?")[0] for c in ctx.calls}, {"/login.cgi", "/appGet.cgi", "/Logout.asp"})

    def test_missing_fields_stay_empty(self):
        ctx = Fake(main={"productid": "RT-AC68U", "link_internet": "2"}, clients=ConnectorError("HTTP 500"))
        box = make(ctx).collect()["box"]
        self.assertEqual((box["model"], box["connected"]), ("RT-AC68U", True))
        self.assertEqual((box["firmware"], box["public_ip"], box["wifi"], box["devices"]), (None, None, None, None))

    def test_line_down_hides_stale_address_and_raises_problem(self):
        d = make(Fake(main={**MAIN, "link_internet": "0"})).collect()
        self.assertIs(d["box"]["connected"], False)
        self.assertIsNone(d["box"]["public_ip"])
        self.assertTrue(d["problems"])

    def test_private_address_is_not_shown(self):
        d = make(Fake(main={**MAIN, "wan0_realip_ip": "10.0.0.2", "wan0_ipaddr": "10.0.0.2"})).collect()
        self.assertIsNone(d["box"]["public_ip"])

    def test_dual_wan_second_unit(self):
        d = make(Fake(main={**MAIN, "get_wan_unit": "1", "wan1_realip_ip": PUBLIC_IP, "wan0_realip_ip": "", "wan0_ipaddr": ""})).collect()
        self.assertEqual(d["box"]["public_ip"], PUBLIC_IP)

    def test_all_radios_off(self):
        d = make(Fake(main={**MAIN, "wl1_radio": "0"})).collect()
        self.assertIs(d["box"]["wifi"], False)

    def test_slightly_broken_json_is_read(self):
        raw = '{ "productid":"RT-AX88U", "link_internet":"2", "wan0_realip_ip":, "extendno":"1", }'
        box = make(Fake(main=raw)).collect()["box"]
        self.assertEqual((box["model"], box["connected"], box["public_ip"]), ("RT-AX88U", True, None))

    def test_unreadable_answer(self):
        conn = make(Fake(main="<html>not json</html>"))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("illisible", str(e.exception))

    def test_answer_of_another_device(self):
        ctx = Fake(main={"hello": "world"})
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("pas un routeur Asus", str(e.exception))
        self.assertEqual(ctx.calls[-1][1], "/Logout.asp")

    def test_session_lost_mid_reading_still_logs_out(self):
        ctx = Fake(main={"error_status": "8"})
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("session", str(e.exception))
        self.assertEqual(ctx.calls[-1][1], "/Logout.asp")

    def test_rate_limit_passes_through(self):
        conn = make(Fake(main=RateLimited("HTTP 429")))
        with self.assertRaises(RateLimited):
            conn.collect()

    def test_helpers(self):
        self.assertIsNone(ar.firmware_of({"firmver": "3.0.0.4"}))
        self.assertEqual(ar.firmware_of({"firmver": "3.0.0.4", "buildno": "386"}), "3.0.0.4.386")
        self.assertIsNone(ar.online_clients({}))


class Login(Base):
    def test_refused_password_is_one_attempt_and_remembered(self):
        ctx = Fake(login={"error_status": "3"})
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertNotIn(PASSWORD, str(e.exception))
        self.assertEqual(len([c for c in ctx.calls if c[1] == "/login.cgi"]), 1)
        self.assertNotIn("/Logout.asp", [c[1] for c in ctx.calls])
        again = Fake()
        conn = make(again)
        with self.assertRaises(ConnectorError):
            conn.collect()
        self.assertEqual(again.calls, [])

    def test_new_password_is_tried_again(self):
        conn = make(Fake(login={"error_status": "3"}))
        with self.assertRaises(ConnectorError):
            conn.collect()
        other = make(Fake())
        other.conf["password"] = PASSWORD + "x"
        self.assertEqual(other.collect()["box"]["model"], "RT-AX88U")

    def test_session_already_taken_is_not_a_refusal(self):
        conn = make(Fake(login={"error_status": "9"}))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("session", str(e.exception))
        self.assertEqual(ar.REFUSED_BY, {})

    def test_lockout_says_the_time_and_is_not_remembered(self):
        conn = make(Fake(login={"error_status": "7", "remaining_lock_time": "120"}))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("120", str(e.exception))
        self.assertEqual(ar.REFUSED_BY, {})

    def test_captcha_is_remembered(self):
        conn = make(Fake(login={"error_status": "10"}))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("captcha", str(e.exception))
        self.assertTrue(ar.REFUSED_BY)

    def test_unknown_code(self):
        conn = make(Fake(login={"error_status": "42"}))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("42", str(e.exception))
        self.assertEqual(ar.REFUSED_BY, {})

    def test_answer_without_token(self):
        conn = make(Fake(login={"hello": "world"}))
        with self.assertRaises(ConnectorError):
            conn.collect()

    def test_unreadable_login_answer(self):
        conn = make(Fake(login="<html>login</html>"))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("illisible", str(e.exception))

    def test_unreachable(self):
        conn = make(Fake(login=ConnectorError("injoignable (timed out)")))
        with self.assertRaises(ConnectorError):
            conn.collect()

    def test_page_not_found_is_not_a_router(self):
        conn = make(Fake(login=ConnectorError("HTTP 404")))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("pas un routeur Asus", str(e.exception))

    def test_secret_field(self):
        names = {f.name: f for f in AsusRouter.fields}
        self.assertTrue(names["password"].secret)
        self.assertFalse(names["username"].secret)

    def test_test_line(self):
        self.assertTrue(make(Fake()).test().ok)


if __name__ == "__main__":
    unittest.main()
