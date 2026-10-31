"""connectors/livebox.py: the reading of the sysbus API of a Livebox against frozen answers, never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import json
import unittest

from connectors.base import ConnectorError, Context
from connectors.livebox import Livebox, kbit, line_of

PUBLIC_IP = ".".join(("1", "1", "1", "42"))   # a global address: the documentation ranges are not
PASSWORD = "-".join(("pw", "unit", "test"))   # built at run time, never a literal secret
CTX_ID = "ctx-" + "abc123"
BASE = "http://192.168.1.1"

LOGIN = {"status": 0, "data": {"contextID": CTX_ID, "groups": "http,admin"}}
FIBRE = {
    "NMC.getWANStatus": {"result": {"status": True, "data": {"LinkType": "ftth", "LinkState": "up", "WanState": "up", "ConnectionState": "Bound", "IPAddress": PUBLIC_IP, "MACAddress": "00:11:22:33:44:55"}}},
    "DeviceInfo.get": {"status": {"ProductClass": "Livebox 6", "SoftwareVersion": "SG40_sip-fr-6.1.2", "SerialNumber": "SECRETSERIAL"}},
    "NMC.Wifi.get": {"result": {"status": {"Enable": True}}},
}
DSL = {**FIBRE, "NMC.getWANStatus": {"result": {"data": {"LinkType": "vdsl", "WanState": "up", "ConnectionState": "Bound", "IPAddress": "10.0.0.5"}}},
       "NeMo.Intf.data.getMIBs": {"result": {"status": {"dsl": {"dsl0": {"DownstreamCurrRate": 95000, "UpstreamCurrRate": 30000}}}}}}


class FakeContext(Context):
    """Answers by service.method; a call not listed is a box error, a refused login is configurable."""

    def __init__(self, answers: dict, login=LOGIN):
        super().__init__()
        self.answers, self.login, self.calls = answers, login, []

    def http(self, url, *, method="GET", payload=None, headers=None, binary=False, **kw):
        sent = json.loads(payload)
        key = f"{sent['service']}.{sent['method']}"
        self.calls.append((method, url, key, headers or {}))
        answer = self.login if key == "sah.Device.Information.createContext" else {"result": {"status": True}} if key.endswith("releaseContext") else self.answers.get(key)
        if isinstance(answer, str):
            raise ConnectorError(answer)
        if answer is None:
            return {"errors": [{"error": 196618, "description": "Permission denied"}]}
        return answer


def read(answers: dict, login=LOGIN, **conf) -> tuple[dict, FakeContext]:
    ctx = FakeContext(answers, login)
    return Livebox({"type": "livebox", "name": "box", "url": BASE, "username": "admin", "password": PASSWORD, **conf}, ctx).collect(), ctx


class Helpers(unittest.TestCase):
    def test_line_types(self):
        self.assertEqual([line_of(x) for x in ("ftth", "GPON", "vdsl2", "adsl", "ethernet", "", None)], ["fibre", "fibre", "dsl", "dsl", None, None, None])

    def test_rates_in_kbit(self):
        self.assertEqual((kbit("95000"), kbit(0), kbit(None)), (95_000_000, None, None))


class Reading(unittest.TestCase):
    def test_fibre_box(self):
        d, ctx = read(FIBRE)
        b = d["box"]
        self.assertEqual((b["model"], b["line"], b["connected"], b["public_ip"], b["firmware"], b["wifi"]), ("Livebox 6", "fibre", True, PUBLIC_IP, "SG40_sip-fr-6.1.2", True))
        self.assertIsNone(b["line_down_bps"])
        text = str(d)
        for secret in ("SECRETSERIAL", "00:11:22", PASSWORD):
            self.assertNotIn(secret, text)
        self.assertNotIn(PUBLIC_IP, str(d["facts"]))
        keys = [c[2] for c in ctx.calls]
        self.assertEqual(keys[0], "sah.Device.Information.createContext")
        self.assertEqual(keys[-1], "sah.Device.Information.releaseContext")
        self.assertNotIn("NeMo.Intf.data.getMIBs", keys, "no DSL reading on a fibre line")
        self.assertTrue(all(c[0] == "POST" and c[1] == BASE + "/ws" for c in ctx.calls))
        self.assertTrue(all(c[3]["X-Context"] == CTX_ID for c in ctx.calls[1:]))

    def test_dsl_box_and_a_private_address(self):
        b = read(DSL)[0]["box"]
        self.assertEqual((b["line"], b["line_down_bps"], b["line_up_bps"], b["public_ip"]), ("dsl", 95_000_000, 30_000_000, None))

    def test_missing_optional_readings(self):
        b = read({"NMC.getWANStatus": FIBRE["NMC.getWANStatus"]})[0]["box"]
        self.assertEqual((b["model"], b["firmware"], b["wifi"], b["line"]), (None, None, None, "fibre"))

    def test_line_down(self):
        d, _ = read({**FIBRE, "NMC.getWANStatus": {"result": {"data": {"LinkType": "ftth", "WanState": "down"}}}})
        self.assertIs(d["box"]["connected"], False)
        self.assertIn("connexion Internet coupée", d["problems"])

    def test_nothing_readable(self):
        with self.assertRaises(ConnectorError):
            read({})


class Refusals(unittest.TestCase):
    def check(self, login, **conf):
        ctx = FakeContext(FIBRE, login)
        box = Livebox({"type": "livebox", "name": "box", "url": BASE, "username": "admin", "password": PASSWORD, **conf}, ctx)
        with self.assertRaises(ConnectorError) as e:
            box.collect()
        self.assertEqual(len(ctx.calls), 1, "a refused login is the only call")
        self.assertNotIn(PASSWORD, str(e.exception))
        return str(e.exception)

    def test_login_without_context(self):
        self.assertIn("refusé", self.check({"status": 13}))
        self.assertIn("refusé", self.check({"data": {}}))

    def test_login_http_401(self):
        self.assertIn("refusé", self.check("HTTP 401"))

    def test_unknown_route(self):
        self.assertIn("/ws", self.check("HTTP 404"))

    def test_bad_address(self):
        ctx = FakeContext(FIBRE)
        box = Livebox({"type": "livebox", "name": "box", "url": "nope", "password": PASSWORD}, ctx)
        with self.assertRaises(ConnectorError):
            box.collect()
        self.assertEqual(ctx.calls, [])

    def test_test_shows_no_secret(self):
        ctx = FakeContext(FIBRE)
        r = Livebox({"type": "livebox", "name": "box", "url": BASE, "username": "admin", "password": PASSWORD}, ctx).test()
        self.assertTrue(r.ok)
        self.assertNotIn(PUBLIC_IP, r.message)
        self.assertNotIn(PASSWORD, r.message)


if __name__ == "__main__":
    unittest.main()
