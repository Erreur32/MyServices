"""network_stats.py: scan counters, offline addresses, worst latencies and data volume per client, through MynetworK.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import network_stats as ns  # noqa: E402
from connectors.base import ConnectorError  # noqa: E402
from connectors.mynetwork import MynetworK  # noqa: E402

DEVICES = [
    {"ip": "10.0.0.2", "status": "online", "ping_ms": 0.4, "hostname": "nas", "vendor": None},
    {"ip": "10.0.0.10", "status": "online", "ping_ms": 31.0, "hostname": None, "vendor": "Espressif"},
    {"ip": "10.0.0.3", "status": "online", "ping_ms": 2.5, "hostname": "pc", "vendor": None},
    {"ip": "10.0.0.9", "status": "offline", "ping_ms": None, "hostname": "old", "vendor": None, "last_seen": {}, "ports_at": "2026-09-13T00:03:23.708Z"},
    {"ip": "10.0.0.4", "status": "offline", "ping_ms": None, "hostname": None, "vendor": "Apple", "last_seen": "2026-10-17T10:00:00Z", "ports_at": "2026-09-01T00:00:00Z"},
    {"ip": "10.0.0.5", "status": "unknown", "ping_ms": None, "hostname": None, "vendor": None},
]


class Fake:
    type = "mynetwork"

    def __init__(self, stats=None, traffic=None, boom=None):
        self.stats, self.traffic, self.boom, self.traffic_modes = stats, traffic, boom, []

    def scan(self):
        if self.boom:
            raise self.boom
        return DEVICES

    def scan_stats(self):
        return self.stats

    def top_traffic(self, mode="live", limit=10):
        self.traffic_modes.append(mode)
        return self.traffic


def run(inst, now, traffic="live"):
    with mock.patch.object(ns.connectors, "instances", return_value=[inst]):
        return ns.read({}, traffic, now)


class Stats(unittest.TestCase):
    def setUp(self):
        ns.reset()

    def test_counted_from_the_inventory_when_mynetwork_has_no_counters(self):
        s = run(Fake(), 100.0)["scan"]
        self.assertEqual(s["counters"], {"total": 6, "online": 3, "offline": 2, "unknown": 1, "source": "inventory"})
        self.assertEqual([x["ip"] for x in s["offline"]], ["10.0.0.4", "10.0.0.9"])               # by address, not as text
        self.assertEqual([(x["ip"], x["ping_ms"]) for x in s["worst_latency"]], [("10.0.0.10", 31.0), ("10.0.0.3", 2.5), ("10.0.0.2", 0.4)])
        self.assertEqual(s["offline"][0]["name"], "Apple")                                       # no hostname: the maker
        self.assertEqual([x["last"] for x in s["offline"]], ["2026-10-17T10:00:00Z", "2026-09-13T00:03:23.708Z"])   # last seen, else the last port scan (lastSeen arrives as {})

    def test_mynetwork_counters_win_when_given(self):
        s = run(Fake(stats={"total": 60, "online": 50, "offline": 9, "unknown": 1, "last_scan": "2026-10-18T10:00:00Z"}), 100.0)["scan"]
        self.assertEqual((s["counters"]["total"], s["counters"]["source"], s["counters"]["last_scan"]), (60, "mynetwork", "2026-10-18T10:00:00Z"))

    def test_traffic_is_absent_without_the_route_and_sorted_when_there(self):
        self.assertIsNone(run(Fake(), 100.0)["traffic"])
        ns.reset()
        raw = [{"hostname": "tv", "ip": "10.0.0.7", "vendor": "Samsung", "rxBytes": 100, "txBytes": 20}, {"name": "pc", "total_bytes": 5000}, {"mac": "aa:bb"}]
        t = run(Fake(traffic=raw), 100.0, "today")["traffic"]
        self.assertEqual(t["mode"], "today")
        self.assertEqual([(i["name"], i["total"], i["unit"]) for i in t["items"]], [("pc", 5000, "volume"), ("tv", 120, "volume"), ("aa:bb", None, "volume")])
        self.assertEqual(t["items"][1]["vendor"], "Samsung")

    def test_live_gives_rates_in_bytes_per_second_from_kib(self):
        raw = [{"mac": "aa", "name": "tv", "download": 2, "upload": 1}, {"mac": "bb", "name": "pc", "download": 100, "upload": 50}]
        items = run(Fake(traffic=raw), 100.0, "live")["traffic"]["items"]
        self.assertEqual([(i["name"], i["rx"], i["tx"], i["total"], i["unit"]) for i in items], [("pc", 102400, 51200, 153600, "rate"), ("tv", 2048, 1024, 3072, "rate")])

    def test_a_mode_is_read_once_and_a_wrong_mode_becomes_live(self):
        f = Fake(traffic=[{"name": "pc", "total": 1}])
        run(f, 100.0)
        run(f, 105.0)
        self.assertEqual(f.traffic_modes, ["live"])                                               # shared for a few seconds
        run(f, 120.0)
        self.assertEqual(f.traffic_modes, ["live", "live"])                                       # the live volume is read again soon
        run(f, 120.0, "today")
        run(f, 150.0, "today")
        self.assertEqual(f.traffic_modes, ["live", "live", "today"])                              # a total is kept longer
        self.assertEqual(run(f, 150.0, "nonsense")["traffic"]["mode"], "live")

    def test_an_error_is_told_never_raised(self):
        doc = run(Fake(boom=ConnectorError("HTTP 500")), 100.0)
        self.assertEqual((doc["scan"], doc["traffic"], doc["error"]), (None, None, "HTTP 500"))


class Connector(unittest.TestCase):
    def conn(self, got):
        c = MynetworK.__new__(MynetworK)
        c.asked = []
        c._get = lambda path, params=None, optional=False: (c.asked.append((path, params)), got)[1]
        return c

    def test_scan_stats_shapes(self):
        self.assertEqual(self.conn({"total": 5, "online": 3, "offline": 1, "unknown": 1, "lastScan": "t"}).scan_stats()["last_scan"], "t")
        self.assertIsNone(self.conn(None).scan_stats())
        self.assertIsNone(self.conn({"nothing": 1}).scan_stats())

    def test_top_traffic_shapes_and_limits(self):
        c = self.conn({"items": [{"name": "a", "x_authkey": "no"}, "junk"]})
        self.assertEqual(c.top_traffic("today", 500), [{"name": "a"}])
        self.assertEqual(c.asked[0][1], {"mode": "today", "limit": 50})                           # the limit is held to 1..50
        self.assertIsNone(c.top_traffic("whatever"))                                              # unknown mode: no request
        self.assertEqual(len(c.asked), 1)
        self.assertEqual(self.conn([{"name": "b"}]).top_traffic(), [{"name": "b"}])
        self.assertIsNone(self.conn(None).top_traffic())


if __name__ == "__main__":
    unittest.main()
