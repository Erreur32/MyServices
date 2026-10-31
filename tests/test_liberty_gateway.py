"""connectors/liberty_gateway.py: the LG-RDK REST reading against frozen answers, never the network.

  À lancer dans l'image : python3 -m unittest tests.test_liberty_gateway
"""
import unittest

from connectors import liberty_gateway as lg
from connectors.base import ConnectorError, Context, RateLimited
from connectors.liberty_gateway import LibertyGateway, rates

BASE = "https://192.0.2.1"
PASSWORD = "-".join(("not", "a", "real", "pw"))
TOKEN = "-".join(("tok", "fake", "1"))
PUBLIC_IP = "93.184.216.34"
LOGIN_URL = BASE + "/rest/v1/user/login"
PAGES = {
    "/system/info": {"info": {"modelName": "F5685LGB", "softwareVersion": "LG-RDK_1.2.3", "hardwareVersion": "1"}},
    "/cablemodem/state": {"cablemodem": {"status": "OPERATIONAL", "upTime": 90000}},
    "/cablemodem/serviceflows": {"serviceFlows": [{"serviceFlow": {"direction": "downstream", "maxTrafficRate": 1130000000}}, {"serviceFlow": {"direction": "upstream", "maxTrafficRate": "104000000"}}]},
    "/system/gateway/provisioning": {"provisioning": {"mode": "ipv4", "ipv4": {"address": PUBLIC_IP}}},
    "/network/hosts?connectedOnly=true": {"hosts": {"hosts": [{"macAddress": "02:00:00:00:00:01"}, {"macAddress": "02:00:00:00:00:02"}]}},
    "/wifi/band2g/state": {"state": {"status": "down"}},
    "/wifi/band5g/state": {"state": {"status": "up"}},
}


class Fake(Context):
    """Answers by « METHOD path »; a string is an error; a missing page is a 404."""

    def __init__(self, pages: dict, login=None, status=None):
        super().__init__()
        self.pages, self.calls = dict(pages), []
        self.login = {"created": {"token": TOKEN, "userId": 3}} if login is None else login
        self.status = {"loginDetails": {"numberOfContiguousFailures": 0, "lockoutTime": 0}} if status is None else status

    def http(self, url, *, method="GET", body=None, headers=None, **kw):
        path = url.removeprefix(BASE + "/rest/v1")
        self.calls.append((method, path, body, headers))
        if path == "/user/login":
            got = self.login if method == "POST" else self.status
        elif method == "DELETE":
            got = None
        else:
            got = self.pages.get(path, "HTTP 404")
        if isinstance(got, str):
            raise ConnectorError(got)
        return got


def make(ctx: Fake) -> LibertyGateway:
    return LibertyGateway({"type": "liberty-gateway", "name": "box", "url": BASE, "password": PASSWORD}, ctx)


class Base(unittest.TestCase):
    def setUp(self):
        lg.REFUSED_BY.clear()


class Reading(Base):
    def test_full_reading(self):
        ctx = Fake(PAGES)
        d = make(ctx).collect()
        box = d["box"]
        self.assertEqual((box["model"], box["line"], box["connected"], box["firmware"]), ("F5685LGB", "cable", True, "LG-RDK_1.2.3"))
        self.assertEqual((box["line_down_bps"], box["line_up_bps"], box["public_ip"], box["uptime_s"]), (1130000000, 104000000, PUBLIC_IP, 90000))
        self.assertEqual((box["devices"], box["wifi"]), (2, True))
        self.assertNotIn(PASSWORD, str(d))
        self.assertNotIn(TOKEN, str(d))

    def test_token_is_sent_and_session_released(self):
        ctx = Fake(PAGES)
        make(ctx).collect()
        reads = [c for c in ctx.calls if c[1] != "/user/login" and c[0] == "GET"]
        self.assertTrue(all(c[3] == {"Authorization": f"Bearer {TOKEN}"} for c in reads))
        self.assertEqual(ctx.calls[-1][:2], ("DELETE", f"/user/3/token/{TOKEN}"))
        self.assertEqual({c[0] for c in ctx.calls}, {"GET", "POST", "DELETE"})

    def test_missing_pages_leave_fields_empty(self):
        d = make(Fake({"/cablemodem/state": {"cablemodem": {"status": "Operational"}}})).collect()
        box = d["box"]
        self.assertEqual((box["connected"], box["devices"], box["wifi"], box["line_down_bps"], box["public_ip"]), (True, None, None, None, None))

    def test_modem_not_operational(self):
        d = make(Fake({**PAGES, "/cablemodem/state": {"cablemodem": {"status": "ranging"}}})).collect()
        self.assertIs(d["box"]["connected"], False)
        self.assertTrue(d["problems"])

    def test_private_address_is_not_shown(self):
        d = make(Fake({**PAGES, "/system/gateway/provisioning": {"provisioning": {"ipv4": {"address": "10.0.0.2"}}}})).collect()
        self.assertIsNone(d["box"]["public_ip"])

    def test_rates_helper(self):
        self.assertEqual(rates([{"direction": "Downstream", "maxTrafficRate": 5}, {"direction": "downstream", "maxTrafficRate": 9}, {"direction": "weird", "maxTrafficRate": 4}]), (9, None))
        self.assertEqual(rates(None), (None, None))

    def test_session_expiring_mid_reading_is_said(self):
        ctx = Fake({**PAGES, "/system/info": "HTTP 401"})
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("session", str(e.exception))
        self.assertEqual(ctx.calls[-1][0], "DELETE")

    def test_rate_limit_passes_through(self):
        class Limited(Fake):
            def http(self, url, **kw):
                if "/system/info" in url:
                    raise RateLimited("HTTP 429")
                return super().http(url, **kw)
        conn = make(Limited(PAGES))
        with self.assertRaises(RateLimited):
            conn.collect()


class Login(Base):
    def test_refused_password_is_one_attempt_and_remembered(self):
        ctx = Fake(PAGES, login="HTTP 401")
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertNotIn(PASSWORD, str(e.exception))
        self.assertEqual(len([c for c in ctx.calls if c[0] == "POST"]), 1)
        again = Fake(PAGES)
        conn = make(again)
        with self.assertRaises(ConnectorError):
            conn.collect()
        self.assertEqual(again.calls, [])

    def test_new_password_is_tried_again(self):
        conn = make(Fake(PAGES, login="HTTP 401"))
        with self.assertRaises(ConnectorError):
            conn.collect()
        box = make(Fake(PAGES))
        box.conf["password"] = PASSWORD + "x"
        self.assertEqual(box.collect()["box"]["model"], "F5685LGB")

    def test_busy_session_is_not_a_refusal(self):
        conn = make(Fake(PAGES, login="HTTP 503"))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("session", str(e.exception))
        self.assertEqual(lg.REFUSED_BY, {})

    def test_lockout_stops_before_any_attempt(self):
        ctx = Fake(PAGES, status={"loginDetails": {"lockoutTime": 120}})
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("120", str(e.exception))
        self.assertFalse([c for c in ctx.calls if c[0] == "POST"])

    def test_answer_without_token(self):
        conn = make(Fake(PAGES, login={"created": {}}))
        with self.assertRaises(ConnectorError):
            conn.collect()

    def test_unreachable(self):
        class Down(Fake):
            def http(self, url, **kw):
                raise ConnectorError("injoignable (timed out)")
        conn = make(Down(PAGES))
        with self.assertRaises(ConnectorError):
            conn.collect()

    def test_secret_field_and_no_username(self):
        names = {f.name: f for f in LibertyGateway.fields}
        self.assertTrue(names["password"].secret)
        self.assertNotIn("username", names)

    def test_test_line(self):
        r = make(Fake(PAGES)).test()
        self.assertTrue(r.ok)


if __name__ == "__main__":
    unittest.main()
