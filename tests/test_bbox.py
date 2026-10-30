"""connectors/bbox.py: the reading of the local API of a Bbox against frozen JSON answers, never the network."""
import unittest

from connectors.base import ConnectorError, Context, RateLimited
from connectors.bbox import BouyguesBbox, dig, kbit, line_of, wifi_state

PUBLIC_IP = ".".join(("1", "1", "1", "42"))   # a global address: the documentation ranges are not
SECRET = "-".join(("pw", str(id(object()))))  # a fake secret built at run time
BASE = "http://192.168.1.254"

DEVICE = [{"device": {"modelname": "F@st5696b", "main": {"version": "25.5.28"}, "uptime": 99, "using": {"ftth": True, "adsl": False, "vdsl": False}, "serialnumber": "SECRETSERIAL"}}]
WAN = [{"wan": {"ip": {"state": "Up", "address": PUBLIC_IP}}}]
STATS = [{"wan": {"ip": {"stats": {"rx": {"bandwidth": 0, "maxBandwidth": 1000000}, "tx": {"bandwidth": 250, "maxBandwidth": 500000}}}}}]
HOSTS = [{"hosts": {"list": [{"active": True}, {"active": 1}, {"active": False}]}}]
WIRELESS = [{"wireless": {"radio": {"24": {"enable": 0}, "5": {"enable": 1}}}}]
FULL = {"login": {}, "device": DEVICE, "wan/ip": WAN, "wan/ip/stats": STATS, "hosts": HOSTS, "wireless": WIRELESS}


class Fake(BouyguesBbox):
    """The box by route name: a route not listed is a 404, an Exception value is raised."""

    def __init__(self, answers: dict, **conf):
        super().__init__({"type": "bbox", "name": "box", "url": BASE, "password": SECRET, **conf}, Context())
        self.answers, self.calls = answers, []

    def fetch(self, path, form=None):
        self.calls.append((path, form))
        a = self.answers.get(path, ConnectorError("HTTP 404"))
        if isinstance(a, Exception):
            raise a
        return a


class Helpers(unittest.TestCase):
    def test_small_helpers(self):
        self.assertEqual((kbit("300"), kbit(0), kbit(0, True), kbit(None, True)), (300_000, None, 0, None))
        self.assertEqual((line_of({"ftth": True}), line_of({"vdsl": 1}), line_of({}), line_of(None)), ("fibre", "dsl", None, None))
        self.assertEqual((wifi_state(WIRELESS[0]), wifi_state({"wireless": {"radio": {"5": {"enable": 0}}}}), wifi_state({})), (True, False, None))
        self.assertIsNone(dig([1], "a"))


class Reading(unittest.TestCase):
    def test_full_reading(self):
        f = Fake(FULL)
        d = f.collect()
        self.assertEqual(d["box"], {"model": "F@st5696b", "line": "fibre", "connected": True, "down_bps": 0, "up_bps": 250_000, "line_down_bps": 1_000_000_000,
                                    "line_up_bps": 500_000_000, "public_ip": PUBLIC_IP, "uptime_s": None, "firmware": "25.5.28", "update_available": None,
                                    "latest_firmware": None, "devices": 2, "wifi": True, "temperature": None})
        for secret in (SECRET, "SECRETSERIAL", PUBLIC_IP):
            self.assertNotIn(secret, str(d["facts"]))
        self.assertEqual(f.calls[0], ("login", {"password": SECRET, "remember": "1"}))
        self.assertTrue(all(c[1] is None for c in f.calls[1:]), "read-only after the login")

    def test_missing_optional_routes(self):
        d = Fake({"login": {}, "device": DEVICE}).collect()
        b = d["box"]
        self.assertEqual((b["model"], b["connected"], b["public_ip"], b["devices"], b["wifi"]), ("F@st5696b", None, None, None, None))

    def test_old_firmware_without_login(self):
        d = Fake({"device": DEVICE}).collect()
        self.assertEqual(d["box"]["model"], "F@st5696b")

    def test_refused_password_stops_at_the_first_call(self):
        f = Fake({**FULL, "login": ConnectorError("HTTP 401")})
        with self.assertRaises(ConnectorError) as cm:
            f.collect()
        self.assertEqual([c[0] for c in f.calls], ["login"])
        self.assertNotIn(SECRET, str(cm.exception))

    def test_rate_limited_login_is_said_without_retry(self):
        f = Fake({**FULL, "login": RateLimited("HTTP 429")})
        with self.assertRaises(ConnectorError):
            f.collect()
        self.assertEqual(len(f.calls), 1)

    def test_no_password_makes_no_call(self):
        f = Fake(FULL, password="")
        with self.assertRaises(ConnectorError):
            f.collect()
        self.assertEqual(f.calls, [])

    def test_not_a_bbox_and_unreadable_answers(self):
        for device in ([], "x", [{"other": 1}], ConnectorError("HTTP 500")):
            with self.assertRaises(ConnectorError):
                Fake({**FULL, "device": device}).collect()

    def test_session_lost_midway_is_an_error(self):
        with self.assertRaises(ConnectorError) as cm:
            Fake({**FULL, "wan/ip": ConnectorError("HTTP 401")}).collect()
        self.assertNotIn(SECRET, str(cm.exception))

    def test_the_test_button_shows_no_secret(self):
        r = Fake(FULL).test()
        self.assertTrue(r.ok)
        self.assertNotIn(PUBLIC_IP, r.message)
        self.assertNotIn(SECRET, r.message)

    def test_fields(self):
        self.assertEqual([f.name for f in BouyguesBbox.fields if f.secret], ["password"])
        self.assertEqual(BouyguesBbox.validate({"url": BASE}), [])


if __name__ == "__main__":
    unittest.main()
