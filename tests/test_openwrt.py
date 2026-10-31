"""connectors/openwrt.py: the ubus JSON-RPC reading against frozen answers, never the network.

  À lancer dans l'image : python3 -m unittest tests.test_openwrt
"""
import unittest

from connectors import openwrt as ow
from connectors.base import ConnectorError, Context
from connectors.openwrt import OpenWrt, pick_wan

BASE = "http://192.0.2.1"
PASSWORD = "-".join(("not", "a", "real", "pw"))
SESSION = "".join(("ab", "12")) * 8
PUBLIC_IP = "93.184.216.34"
BOARD = {"model": "Example Router v1", "board_name": "example", "release": {"version": "23.05.3", "description": "OpenWrt 23.05.3 r23809"}}
WAN = {"interface": "wan", "up": True, "uptime": 86017, "device": "eth1", "ipv4-address": [{"address": PUBLIC_IP, "mask": 24}],
       "route": [{"target": "0.0.0.0", "mask": 0, "nexthop": "192.0.2.254"}]}   # NOSONAR S1313: documentation addresses of the test
DUMP = {"interface": [{"interface": "loopback", "up": True}, {"interface": "lan", "up": True, "ipv4-address": [{"address": "192.0.2.1", "mask": 24}]}, WAN]}   # NOSONAR S1313: documentation address
LOGIN_OK = [0, {"ubus_rpc_session": SESSION, "timeout": 300, "expires": 299}]


class Fake(Context):
    """Answers a ubus call by « object.method »; a value is the `result`, a dict with « error » is the whole answer, a string raises."""

    def __init__(self, answers: dict | None = None):
        super().__init__()
        self.answers = {"session.login": LOGIN_OK, "system.board": [0, BOARD], "network.interface.dump": [0, DUMP], "session.destroy": [0]}
        self.answers.update(answers or {})
        self.calls = []

    def http(self, url, *, method="GET", body=None, **kw):
        session, obj, name, args = body["params"]
        self.calls.append((url, method, session, f"{obj}.{name}", args))
        got = self.answers.get(f"{obj}.{name}", "HTTP 404")
        if isinstance(got, str):
            raise ConnectorError(got)
        return got if isinstance(got, dict) and "error" in got else {"jsonrpc": "2.0", "id": 1, "result": got}


def make(ctx: Fake) -> OpenWrt:
    return OpenWrt({"type": "openwrt", "name": "router", "url": BASE, "username": "monitor", "password": PASSWORD}, ctx)


class Base(unittest.TestCase):
    def setUp(self):
        ow.REFUSED_BY.clear()


class Reading(Base):
    def test_full_reading(self):
        d = make(Fake()).collect()
        box = d["box"]
        self.assertEqual((box["model"], box["connected"], box["firmware"]), ("Example Router v1", True, "OpenWrt 23.05.3 r23809"))
        self.assertEqual((box["public_ip"], box["uptime_s"]), (PUBLIC_IP, 86017))
        self.assertEqual((box["devices"], box["wifi"], box["line"], box["down_bps"]), (None, None, None, None))
        self.assertNotIn(PASSWORD, str(d))
        self.assertNotIn(SESSION, str(d))

    def test_session_is_sent_then_destroyed(self):
        ctx = Fake()
        make(ctx).collect()
        self.assertEqual([c[3] for c in ctx.calls], ["session.login", "system.board", "network.interface.dump", "session.destroy"])
        self.assertEqual(ctx.calls[0][2], "0" * 32)
        self.assertTrue(all(c[2] == SESSION for c in ctx.calls[1:]))
        self.assertEqual(ctx.calls[-1][4], {"ubus_rpc_session": SESSION})
        self.assertTrue(all(c[0] == BASE + "/ubus" and c[1] == "POST" for c in ctx.calls))

    def test_missing_fields_leave_none(self):
        d = make(Fake({"system.board": [0, {}], "network.interface.dump": [0, {"interface": [{"interface": "lan", "up": True}]}]})).collect()
        box = d["box"]
        self.assertEqual((box["model"], box["connected"], box["public_ip"], box["uptime_s"], box["firmware"]), (None, None, None, None, None))

    def test_wan_down(self):
        down = {**WAN, "up": False, "ipv4-address": []}
        d = make(Fake({"network.interface.dump": [0, {"interface": [down]}]})).collect()
        self.assertIs(d["box"]["connected"], False)
        self.assertTrue(d["problems"])

    def test_private_address_is_not_shown(self):
        behind = {**WAN, "ipv4-address": [{"address": "10.0.0.2", "mask": 24}]}
        d = make(Fake({"network.interface.dump": [0, {"interface": [behind]}]})).collect()
        self.assertIsNone(d["box"]["public_ip"])

    def test_wan_found_by_default_route(self):
        renamed = {**WAN, "interface": "pppoe-fibre"}
        self.assertEqual(pick_wan([{"interface": "lan"}, renamed]), renamed)
        self.assertEqual(pick_wan(None), {})

    def test_missing_read_right(self):
        ctx = Fake({"network.interface.dump": [6]})
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("droits", str(e.exception))
        self.assertEqual(ctx.calls[-1][3], "session.destroy")


class Failures(Base):
    def test_refused_password_is_one_attempt_and_remembered(self):
        ctx = Fake({"session.login": [6]})
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertNotIn(PASSWORD, str(e.exception))
        self.assertEqual(len(ctx.calls), 1)
        again = Fake()
        conn = make(again)
        with self.assertRaises(ConnectorError):
            conn.collect()
        self.assertEqual(again.calls, [])

    def test_new_password_is_tried_again(self):
        conn = make(Fake({"session.login": [6]}))
        with self.assertRaises(ConnectorError):
            conn.collect()
        retry = make(Fake())
        retry.conf["password"] = PASSWORD + "x"
        self.assertEqual(retry.collect()["box"]["model"], "Example Router v1")

    def test_unreadable_answer(self):
        conn = make(Fake({"session.login": {"unexpected": True}}))
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("ubus", str(e.exception))
        self.assertEqual(ow.REFUSED_BY, {})

    def test_login_without_session_id(self):
        conn = make(Fake({"session.login": [0, {}]}))
        with self.assertRaises(ConnectorError):
            conn.collect()

    def test_session_expired(self):
        ctx = Fake({"system.board": {"jsonrpc": "2.0", "id": 1, "error": {"code": -32002, "message": "Access denied"}}})
        conn = make(ctx)
        with self.assertRaises(ConnectorError) as e:
            conn.collect()
        self.assertIn("session expirée", str(e.exception))

    def test_unreachable(self):
        class Down(Fake):
            def http(self, url, **kw):
                raise ConnectorError("injoignable (timed out)")
        conn = make(Down())
        with self.assertRaises(ConnectorError):
            conn.collect()

    def test_secret_field(self):
        names = {f.name: f for f in OpenWrt.fields}
        self.assertTrue(names["password"].secret)
        self.assertFalse(names["username"].secret)

    def test_test_line(self):
        self.assertTrue(make(Fake()).test().ok)


if __name__ == "__main__":
    unittest.main()
