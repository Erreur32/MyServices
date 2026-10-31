"""connectors/mikrotik.py: the RouterOS REST reading against frozen answers, never the network.

  À lancer dans l'image : python3 -m unittest tests.test_mikrotik
"""
import base64
import unittest

from connectors import mikrotik as mt
from connectors.base import ConnectorError, Context, RateLimited
from connectors.mikrotik import MikroTik

BASE = "https://192.0.2.1"
USER = "reader"
PASSWORD = "-".join(("not", "a", "real", "pw"))
PUBLIC_IP = "93.184.216.34"
PAGES = {
    "/system/resource": {"uptime": "2h31m3s", "version": "7.15.3 (stable)", "board-name": "hAP ax^2", "cpu-load": "1"},
    "/system/routerboard": {"routerboard": "true", "model": "C52iG-5HaxD2HaxD", "serial-number": "X"},
    "/ip/dhcp-client": [{"interface": "ether1", "status": "bound", "disabled": "false", "address": PUBLIC_IP + "/24"}],
    "/ip/dhcp-server/lease": [{"status": "bound", "address": "192.0.2.10"}, {"status": "bound", "address": "192.0.2.11"}, {"status": "waiting"}],
    "/interface/wifi": [{"name": "wifi1", "disabled": "false", "running": "true"}, {"name": "wifi2", "disabled": "true", "running": "false"}],
    "/system/health": [{"name": "cpu-temperature", "value": "43", "type": "C"}, {"name": "fan1-speed", "value": "5654", "type": "RPM"}],
}


class Fake(Context):
    """Answers by path; a string is an error; a missing page is a 404."""

    def __init__(self, pages: dict):
        super().__init__()
        self.pages, self.calls = dict(pages), []

    def http(self, url, *, method="GET", headers=None, **kw):
        path = url.removeprefix(BASE + "/rest")
        self.calls.append((method, path, headers))
        got = self.pages.get(path, "HTTP 404")
        if isinstance(got, str):
            raise ConnectorError(got)
        return got


def make(ctx: Fake) -> MikroTik:
    return MikroTik({"type": "mikrotik", "name": "router", "url": BASE, "username": USER, "password": PASSWORD}, ctx)


class Base(unittest.TestCase):
    def setUp(self):
        mt.REFUSED_BY.clear()


class Reading(Base):
    def test_pppoe_client_gives_the_line_and_its_address(self):
        pages = {k: v for k, v in PAGES.items() if k != "/ip/dhcp-client"}
        pages["/interface/pppoe-client"] = [{"name": "pppoe-out1", "running": "true", "disabled": "false"}]
        pages["/ip/address"] = [{"interface": "bridge", "address": "192.0.2.1/24"}, {"interface": "pppoe-out1", "address": PUBLIC_IP + "/32"}]
        self.assertEqual(mt.wan_of([], pages["/interface/pppoe-client"], pages["/ip/address"]), (True, PUBLIC_IP))

    def test_stopped_pppoe_client_is_a_line_down(self):
        stopped = [{"name": "pppoe-out1", "running": "false", "disabled": "false"}]
        self.assertEqual(mt.wan_of([], stopped, []), (False, None))

    def test_no_pppoe_nor_dhcp_client_says_nothing(self):
        self.assertEqual(mt.wan_of([], [], []), (None, None))

    def test_full_reading(self):
        ctx = Fake(PAGES)
        d = make(ctx).collect()
        box = d["box"]
        self.assertEqual((box["model"], box["connected"], box["public_ip"], box["firmware"]), ("C52iG-5HaxD2HaxD", True, PUBLIC_IP, "7.15.3 (stable)"))
        self.assertEqual((box["devices"], box["wifi"], box["temperature"]), (2, True, 43.0))
        self.assertIsNone(box["line"])
        self.assertIsNone(box["down_bps"])
        self.assertNotIn(PASSWORD, str(d))
        self.assertNotIn(PUBLIC_IP, str(d["facts"]))

    def test_only_get_with_basic_auth(self):
        ctx = Fake(PAGES)
        make(ctx).collect()
        expected = "Basic " + base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()
        self.assertEqual({c[0] for c in ctx.calls}, {"GET"})
        self.assertTrue(all(c[2]["Authorization"] == expected for c in ctx.calls))

    def test_missing_fields_leave_none(self):
        box = make(Fake({"/system/resource": [{"board-name": "CHR"}]})).collect()["box"]
        self.assertEqual(box["model"], "CHR")
        for key in ("connected", "public_ip", "firmware", "devices", "wifi", "temperature"):
            self.assertIsNone(box[key], key)

    def test_dhcp_client_searching_is_disconnected(self):
        pages = {**PAGES, "/ip/dhcp-client": [{"status": "searching...", "disabled": "false"}]}
        d = make(Fake(pages)).collect()
        self.assertIs(d["box"]["connected"], False)
        self.assertIsNone(d["box"]["public_ip"])
        self.assertTrue(d["problems"])

    def test_private_wan_address_is_not_shown(self):
        pages = {**PAGES, "/ip/dhcp-client": [{"status": "bound", "address": "10.0.0.2/24"}]}
        self.assertIsNone(make(Fake(pages)).collect()["box"]["public_ip"])

    def test_wireless_menu_and_old_health_shape(self):
        pages = {**PAGES, "/system/health": {"temperature": "51"}, "/interface/wireless": [{"disabled": "true"}]}
        del pages["/interface/wifi"]
        box = make(Fake(pages)).collect()["box"]
        self.assertEqual((box["wifi"], box["temperature"]), (False, 51.0))

    def test_rate_limit_passes_through(self):
        class Limited(Fake):
            def http(self, url, **kw):
                raise RateLimited("HTTP 429")
        conn = make(Limited(PAGES))
        with self.assertRaises(RateLimited):
            conn.collect()

    def test_secret_field(self):
        self.assertTrue({f.name: f for f in MikroTik.fields}["password"].secret)

    def test_test_line(self):
        self.assertTrue(make(Fake(PAGES)).test().ok)


class Failures(Base):
    def test_refused_password_is_one_attempt_and_remembered(self):
        ctx = Fake({**PAGES, "/system/resource": "HTTP 401"})
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertNotIn(PASSWORD, str(e.exception))
        self.assertEqual(len(ctx.calls), 1)
        again = Fake(PAGES)
        conn = make(again)
        with self.assertRaises(ConnectorError):
            conn.collect()
        self.assertEqual(again.calls, [])

    def test_new_password_is_tried_again(self):
        conn = make(Fake({"/system/resource": "HTTP 401"}))
        with self.assertRaises(ConnectorError):
            conn.collect()
        other = make(Fake(PAGES))
        other.conf["password"] = PASSWORD + "x"
        self.assertEqual(other.collect()["box"]["model"], "C52iG-5HaxD2HaxD")

    def test_unreadable_answer(self):
        conn = make(Fake({"/system/resource": ["x"]}))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertEqual(str(e.exception), mt.NOT_ROUTEROS)

    def test_not_json(self):
        class Bad(Fake):
            def http(self, url, **kw):
                raise ConnectorError("réponse illisible (pas du JSON)")
        conn = make(Bad(PAGES))
        with self.assertRaises(ConnectorError):
            conn.collect()

    def test_routeros_6_without_rest(self):
        conn = make(Fake({}))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("RouterOS 6", str(e.exception))
        self.assertEqual(mt.REFUSED_BY, {})


if __name__ == "__main__":
    unittest.main()
