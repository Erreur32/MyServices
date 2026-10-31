"""connectors/tmobile_home.py: the reading of the local API of a T-Mobile gateway against frozen answers (fetch() replaced), never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import unittest

from connectors.base import ConnectorError, Context
from connectors.tmobile_home import GATEWAY_PATH, LOGIN_PATH, REFUSED_BY, TMobileHome, count_clients, signal_fact, wifi_on

BASE = "http://192.168.12.1"
SECRET = "pw-" + "x".join(("a", "b", "c"))   # built at run time, never a literal credential
TOKEN = "tok-" + "".join(("1", "2", "3"))
GATEWAY = {"device": {"model": "KVD21", "softwareVersion": "1.2.3", "hardwareVersion": "R1", "serial": "SECRETSERIAL"},
           "signal": {"4g": {"bars": 4, "rsrp": -96, "rsrq": -9, "sinr": 7, "bands": ["b66"], "cid": 2},
                      "5g": {"bars": 3, "rsrp": -103, "rsrq": -11, "sinr": 4, "bands": ["n41"], "cid": 2},
                      "generic": {"registration": "registered", "roaming": False}},
           "time": {"upTime": 90000}}
CLIENTS = {"clients": {"2.4ghz": [{"connected": True}, {"connected": False}], "5.0ghz": [{"connected": True}], "ethernet": []}}
AP = {"2.4ghz": {"isRadioEnabled": False}, "5.0ghz": {"isRadioEnabled": True}}


class Fake(TMobileHome):
    """Answers by path; a path not listed is a 404; a gateway that wants a login answers 401 without token."""

    def __init__(self, answers=None, open_state=True, good=True, **conf):
        super().__init__({"type": "tmobile-home-internet", "name": "box", "url": BASE, **conf}, Context())
        self.answers = {GATEWAY_PATH: GATEWAY, "network/telemetry?get=clients": CLIENTS, "network/configuration/v2?get=ap": AP, **(answers or {})}
        self.open_state, self.good, self.calls = open_state, good, []

    def fetch(self, path, token="", body=None):
        self.calls.append((path, token, body))
        if path == LOGIN_PATH:
            if not self.good:
                raise ConnectorError("HTTP 401")
            return {"auth": {"token": TOKEN}}
        if path not in self.answers:
            raise ConnectorError("HTTP 404")
        if not token and not self.open_state:
            raise ConnectorError("HTTP 401")
        return self.answers[path]


class Helpers(unittest.TestCase):
    def test_readers(self):
        self.assertEqual(count_clients(CLIENTS), 2)
        self.assertEqual(count_clients([{"connected": True}, {"connected": True}]), 2)
        self.assertIsNone(count_clients({}))
        self.assertIs(wifi_on(AP), True)
        self.assertIsNone(wifi_on({}))
        self.assertIsNone(signal_fact("5G", {}))
        self.assertEqual(signal_fact("5G", {"bars": 0})["tone"], "bad")


class Reading(unittest.TestCase):
    def setUp(self):
        REFUSED_BY.clear()

    def test_without_account(self):
        card = Fake().collect()
        box = card["box"]
        self.assertEqual((box["model"], box["firmware"], box["line"], box["connected"], box["uptime_s"], box["devices"], box["wifi"]),
                         ("KVD21", "1.2.3", "mobile", True, 90000, None, None))
        labels = [f["label"] for f in card["facts"]]
        self.assertIn("Signal 5G", labels)
        self.assertIn("RSRP -103 dBm", str(card["facts"]))
        self.assertNotIn("SECRETSERIAL", str(card))

    def test_with_account(self):
        f = Fake(password=SECRET)
        box = f.collect()["box"]
        self.assertEqual((box["devices"], box["wifi"]), (2, True))
        self.assertEqual(f.calls[1][1], TOKEN)

    def test_needs_account(self):
        box = Fake(open_state=False)
        with self.assertRaises(ConnectorError) as cm:
            box.collect()
        self.assertIn("compte", str(cm.exception))
        self.assertEqual(Fake(open_state=False, password=SECRET).collect()["box"]["model"], "KVD21")

    def test_refused_once_then_remembered(self):
        f = Fake(good=False, password=SECRET)
        with self.assertRaises(ConnectorError) as cm:
            f.collect()
        self.assertNotIn(SECRET, str(cm.exception))
        with self.assertRaises(ConnectorError):
            f.collect()
        self.assertEqual(len([c for c in f.calls if c[0] == LOGIN_PATH]), 1)
        self.assertNotIn(SECRET, str([c[:2] for c in f.calls]))

    def test_unknown_and_unreadable_and_offline(self):
        box = Fake({GATEWAY_PATH: None})
        with self.assertRaises(ConnectorError) as cm:
            box.collect()
        self.assertIn("illisible", str(cm.exception))
        f = Fake()
        f.answers = {}
        with self.assertRaises(ConnectorError) as cm:
            f.collect()
        self.assertIn("T-Mobile", str(cm.exception))
        down = {**GATEWAY, "signal": {"generic": {"registration": "searching"}}}
        self.assertEqual(Fake({GATEWAY_PATH: down}).collect()["problems"], ["connexion Internet coupée"])


if __name__ == "__main__":
    unittest.main()
