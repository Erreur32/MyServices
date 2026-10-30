"""connectors/vodafone_station.py: the Technicolor and Sercomm readings against frozen answers, never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import hashlib
import json
import unittest

from connectors import vodafone_station as vs
from connectors.base import ConnectorError, Context
from connectors.vodafone_station import VodafoneStation, hmac_hex, link_up, pbkdf2, uptime_s

BASE = "http://192.168.0.1"
PASSWORD = "-".join(("not", "a", "real", "pw"))
SALT, SALT_UI = "saltA", "saltB"
TC_CONF = {"ModelName": "CGA4233DE"}
TC_STATUS = {"data": {"serialnumber": "SERIAL42", "firmwareversion": "AR01.02.03", "hardwaretype": "HW-1", "uptime": "7200", "WANStatus": "Operational", "CMStatus": "Operational", "LanMode": "x"}}
TC_HOSTS = {"data": {"hostTbl": [{"active": "true", "layer1interface": "WiFi"}, {"active": "false"}, {"active": "true", "layer1interface": "Ethernet"}]}}
KEY = "enckey"
SC_PAGE = b"<script>var csrf_token = 'tok123';</script>"


def j(o) -> bytes:
    return json.dumps(o).encode()


def tc_answers(**extra) -> dict:
    ok = {"POST api/v1/session/login": [j({"salt": SALT, "saltwebui": SALT_UI}), j({"error": "ok"})]}
    return {"GET api/v1/login_conf": j({"data": TC_CONF}), **ok, "GET api/v1/session/menu": b"{}", "GET api/v1/sta_status": j(TC_STATUS),
            "GET api/v1/host/hostTbl": j(TC_HOSTS), "POST api/v1/session/logout": b"{}", **extra}


def sc_answers(code="1", key=KEY, **extra) -> dict:
    return {"GET login.html": SC_PAGE, "GET data/user_lang.json": j({"encryption_key": key, "salt": "00"}), "POST data/reset.json": b"1",
            "GET data/login.json": j({"challenge": "chal"}), "POST data/login.json": [j(int(c)) for c in code] if isinstance(code, list) else j(int(code)),
            "GET data/overview.json": j({"wifi_user": "on|pc|lap|aa:bb|1.1.1.1|x|y|2.4G;off|pc|old|cc:dd|1.1.1.2|x|y|2.4G;", "wifi_guest": "", "ethernet": "tv|ee:ff|1.1.1.3;"}),
            "GET data/user_data.json": j([{"sys_firmware_version": "SC.9.9"}, {"sys_hardware_version": "Sercomm-X"}, {"sys_uptime": "1:2:3"}]),
            "GET data/statussupportstatus.json": j({"wan_status": "Connected", "cm_status": "Operational"}), **extra}


class Fake(VodafoneStation):
    """Answers by « METHOD path »; a list is a queue; a missing page is a 404."""

    def fetch(self, method, path, form=None, query=None, csrf=""):
        self.calls.append((method, path, form))
        got = self.answers.get(f"{method} {path}")
        if isinstance(got, list):
            got = got.pop(0)
        if isinstance(got, Exception):
            raise got
        if got is None:
            raise ConnectorError("HTTP 404")
        return got

    def opener(self):   # no network: only the cookie jar is real
        if getattr(self, "_jar", None) is None:
            import http.cookiejar
            self._jar = http.cookiejar.CookieJar()
        return None


def make(answers: dict, password: str = PASSWORD, url: str = BASE) -> Fake:
    box = Fake({"type": "vodafone-station", "name": "box", "url": url, "username": "vodafone", "password": password}, Context())
    box.answers, box.calls = answers, []
    return box


class Base(unittest.TestCase):
    def setUp(self):
        vs.REFUSED_BY.clear()
        vs.VARIANT.clear()


class Helpers(Base):
    def test_uptime_formats(self):
        self.assertEqual((uptime_s("7200"), uptime_s("1:2:3"), uptime_s(None), uptime_s("abc"), uptime_s(-5)), (7200, 86400 + 7200 + 180, None, None, None))

    def test_link_words(self):
        self.assertEqual([link_up(*w) for w in (("Operational",), ("Connected", "Operational"), ("Disconnected",), ("Not Operational",), ("weird",), (None, ""))], [True, True, False, False, None, None])


class Technicolor(Base):
    def test_full_reading(self):
        box = make(tc_answers())
        d = box.collect()
        self.assertEqual(d["box"], {"model": "CGA4233DE", "line": "cable", "connected": True, "down_bps": None, "up_bps": None, "line_down_bps": None, "line_up_bps": None,
                                    "public_ip": None, "uptime_s": 7200, "firmware": "AR01.02.03", "update_available": None, "latest_firmware": None, "devices": 2, "wifi": None, "temperature": None})
        self.assertNotIn("SERIAL42", str(d))
        self.assertEqual(d["version"], "AR01.02.03")

    def test_login_hash_and_no_password_sent(self):
        box = make(tc_answers())
        box.collect()
        logins = [c for c in box.calls if c[1] == "api/v1/session/login"]
        self.assertEqual(logins[0][2]["password"], "seeksalthash")
        self.assertEqual(logins[1][2]["password"], pbkdf2(pbkdf2(PASSWORD, SALT), SALT_UI))
        self.assertNotIn(PASSWORD, str(box.calls))
        self.assertTrue(all(c[0] == "GET" or c[1] in ("api/v1/session/login", "api/v1/session/logout") for c in box.calls), "read-only")
        self.assertEqual(box.calls[-1][1], "api/v1/session/logout")

    def test_wrong_password_stops_and_is_not_repeated(self):
        box = make(tc_answers(**{"POST api/v1/session/login": [j({"salt": SALT, "saltwebui": SALT_UI}), j({"error": "error", "message": "MSG_LOGIN_X"})]}))
        with self.assertRaises(ConnectorError) as cm:
            box.collect()
        self.assertNotIn(PASSWORD, str(cm.exception))
        again = make(tc_answers())
        with self.assertRaises(ConnectorError):
            again.collect()
        self.assertEqual(again.calls, [], "no call at all with the same refused credentials")
        self.assertEqual(make(tc_answers(), password=PASSWORD + "2").collect()["version"], "AR01.02.03", "new credentials are tried")

    def test_session_already_taken(self):
        box = make(tc_answers(**{"POST api/v1/session/login": [j({"message": "MSG_LOGIN_150"})]}))
        with self.assertRaises(ConnectorError) as cm:
            box.collect()
        self.assertIn("session ouverte", str(cm.exception))
        self.assertEqual(vs.REFUSED_BY, {}, "a busy box is not a refusal")

    def test_missing_fields_and_hosts_still_answer(self):
        a = tc_answers(**{"GET api/v1/sta_status": j({"data": {"operational": "Operational"}})})
        a.pop("GET api/v1/host/hostTbl")
        b = make(a).collect()["box"]
        self.assertEqual((b["firmware"], b["uptime_s"], b["devices"], b["connected"]), (None, None, None, True))

    def test_unreadable_answer_is_an_error(self):
        with self.assertRaises(ConnectorError):
            make(tc_answers(**{"GET api/v1/sta_status": b"<<<"})).collect()

    def test_session_lost_midway(self):
        with self.assertRaises(ConnectorError) as cm:
            make(tc_answers(**{"GET api/v1/sta_status": ConnectorError("HTTP 401")})).collect()
        self.assertIn("fermé la session", str(cm.exception))

    def test_the_test_button_shows_no_secret(self):
        r = make(tc_answers()).test()
        self.assertTrue(r.ok)
        self.assertNotIn(PASSWORD, r.message)


class Sercomm(Base):
    def test_reading_with_hashed_username(self):
        box = make(sc_answers())
        d = box.collect()
        b = d["box"]
        self.assertEqual((b["model"], b["firmware"], b["uptime_s"], b["connected"], b["line"], b["devices"], b["wifi"]), ("Sercomm-X", "SC.9.9", 93780, True, "cable", 2, None))
        login = next(c for c in box.calls if c[0] == "POST" and c[1] == "data/login.json")
        self.assertEqual(login[2], {"LoginName": hmac_hex(KEY, hmac_hex("$1$SERCOMM$", "vodafone")), "LoginPWD": hmac_hex(KEY, hmac_hex("$1$SERCOMM$", PASSWORD))})
        self.assertNotIn(PASSWORD, str(box.calls))
        self.assertTrue(vs.VARIANT[BASE])

    def test_challenge_login_without_key(self):
        box = make(sc_answers(key=""))
        box.collect()
        login = next(c for c in box.calls if c[0] == "POST" and c[1] == "data/login.json")
        self.assertEqual(login[2]["LoginPWD"], hashlib.sha256((PASSWORD + "chal").encode()).hexdigest())
        self.assertEqual(login[2]["LoginName"], "vodafone")

    def test_plain_username_variant_is_remembered(self):
        box = make(sc_answers(code=["3", "1"]))
        box.collect()
        self.assertFalse(vs.VARIANT[BASE])
        second = make(sc_answers(code="1"))
        second.collect()
        logins = [c for c in second.calls if c[0] == "POST" and c[1] == "data/login.json"]
        self.assertEqual((len(logins), logins[0][2]["LoginName"]), (1, "vodafone"))

    def test_wrong_password_stops_and_is_remembered(self):
        box = make(sc_answers(code=["3", "3"]))
        with self.assertRaises(ConnectorError) as cm:
            box.collect()
        self.assertNotIn(PASSWORD, str(cm.exception))
        again = make(sc_answers())
        with self.assertRaises(ConnectorError):
            again.collect()
        self.assertEqual(again.calls, [])

    def test_known_variant_refused_costs_one_attempt(self):
        vs.VARIANT[BASE] = True
        box = make(sc_answers(code=["5", "1"]))
        with self.assertRaises(ConnectorError):
            box.collect()
        self.assertEqual(len([c for c in box.calls if c[1] == "data/login.json" and c[0] == "POST"]), 1)

    def test_session_already_taken(self):
        with self.assertRaises(ConnectorError) as cm:
            make(sc_answers(code="2")).collect()
        self.assertIn("session ouverte", str(cm.exception))

    def test_devices_absent_and_wan_down(self):
        a = sc_answers(**{"GET data/overview.json": j({}), "GET data/statussupportstatus.json": j({"wan_status": "Disconnected"})})
        d = make(a).collect()
        self.assertIsNone(d["box"]["devices"])
        self.assertIs(d["box"]["connected"], False)
        self.assertIn("connexion Internet coupée", d["problems"])


class Detection(Base):
    def test_unsupported_families_are_named(self):
        for answers in ({"GET login.lp": j({"status": "alive"})}, {"GET api/config/details.jst": j({"X_VODAFONE_WebUI_Language": "en"})}):
            with self.assertRaises(ConnectorError) as cm:
                make(answers).collect()
            self.assertIn("n'est pas géré", str(cm.exception))

    def test_not_a_vodafone_station(self):
        with self.assertRaises(ConnectorError):
            make({}).collect()

    def test_unreachable_is_an_error(self):
        with self.assertRaises(ConnectorError) as cm:
            make({"GET api/v1/login_conf": ConnectorError("injoignable (timed out)")}).collect()
        self.assertIn("injoignable", str(cm.exception))


class Registration(unittest.TestCase):
    def test_password_is_a_secret_and_fields_validate(self):
        self.assertTrue(next(f for f in VodafoneStation.fields if f.name == "password").secret)
        self.assertEqual(VodafoneStation.type, "vodafone-station")
        self.assertEqual(VodafoneStation.validate({"url": BASE, "username": "u", "password": PASSWORD}), [])
        self.assertNotEqual(VodafoneStation.validate({"url": BASE}), [])


if __name__ == "__main__":
    unittest.main()
