"""The collection and the health check reuse the shared reading of the server's readers (readers.py) instead of a second call.

  python3 -m unittest discover -s tests
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from msv.core import config  # noqa: E402
import connectors  # noqa: E402
import connectors.base as cbase  # noqa: E402
import health  # noqa: E402

# CI has no /config/services-meta.json and importing myservices reads it: the example stands in, for the import only
with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    import myservices  # noqa: E402


class Fake(cbase.Connector):
    type, label, kinds = "glances", "Glances", ("status",)

    def __init__(self, name, data, type_=None, conf=None):
        super().__init__({"name": name, "url": "http://10.0.0.2:1", **(conf or {})}, cbase.Context())
        self.data, self.calls = data, 0
        if type_:
            self.type = type_

    def collect(self):
        self.calls += 1
        return self.data


def shared(path, conn, data, at):
    state = cbase.load_state(path)
    state[f"{conn.type}/{conn.name}"] = {"ok": True, "at": at, "tried": at, "last": data, "message": "OK", "failures": 0, "found": []}
    cbase.save_state(path, state)


class Collection(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "connectors.json"
        for p in (mock.patch.object(myservices, "CONNECTORS_STATE", self.path), mock.patch.object(myservices, "CONNECTOR_STATUS", []),
                  mock.patch.dict(myservices.CFG, {"fast_every": 300})):
            p.start()
            self.addCleanup(p.stop)

    def test_rows_from_the_shared_reading_without_a_call(self):
        c = Fake("g", {"host": {"ips": ["10.0.0.2"]}, "n": 1})
        shared(self.path, c, {"host": {"ips": ["10.0.0.2"]}, "n": 1}, at=__import__("time").time())
        with mock.patch.object(connectors, "instances", return_value=[c]):
            out = myservices.connector_rows(("status",))
        self.assertEqual(c.calls, 0)
        self.assertEqual((out["status"][0]["ok"], out["status"][0]["n"], out["status"][0]["instance"]), (True, 1, "g"))
        self.assertEqual((myservices.CONNECTOR_STATUS[0].ok, myservices.CONNECTOR_STATUS[0].stale), (True, False))

    def test_direct_read_when_nothing_recent_then_merged(self):
        c = Fake("g", {"n": 2})
        with mock.patch.object(connectors, "instances", return_value=[c]):
            out = myservices.connector_rows(("status",))
        self.assertEqual((c.calls, out["status"][0]["n"]), (1, 2))
        self.assertEqual(cbase.load_state(self.path)["glances/g"]["last"], {"n": 2})

    def test_uptime_kuma_reuses_the_shared_reading(self):
        k = Fake("kuma", {"monitors": []}, type_="uptime-kuma")
        shared(self.path, k, {"monitors": []}, at=__import__("time").time())
        with mock.patch.object(connectors, "instances", return_value=[k]):
            myservices.uptime_rows([])
        self.assertEqual(k.calls, 0)
        self.assertEqual(myservices.CONNECTOR_STATUS[0].name, "kuma")
        with mock.patch.object(connectors, "instances", return_value=[k]), mock.patch.dict(myservices.CFG, {"fast_every": 0}):
            myservices.uptime_rows([])
        self.assertEqual(k.calls, 1)   # readers off: read by the collection itself


class Health(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "connectors.json"
        for p in (mock.patch.object(health, "CONNECTORS_STATE", self.path), mock.patch.dict(health.CFG, {"fast_every": 300})):
            p.start()
            self.addCleanup(p.stop)
        self.meta = {"machines": {"10.0.0.2": {"name": "box"}}}

    def test_api_systems_from_the_shared_reading(self):
        c = Fake("g", {"host": {"ips": ["10.0.0.2"], "cpu": 1}})
        shared(self.path, c, c.data, at=__import__("time").time())
        with mock.patch.object(connectors, "instances", return_value=[c]):
            self.assertEqual(health.api_systems(self.meta), {"10.0.0.2": {"cpu": 1}})
        self.assertEqual(c.calls, 0)

    def test_api_systems_reads_itself_when_nothing_is_shared(self):
        c = Fake("g", {"host": {"ips": ["10.0.0.2"], "cpu": 2}})
        with mock.patch.object(connectors, "instances", return_value=[c]):
            self.assertEqual(health.api_systems(self.meta), {"10.0.0.2": {"cpu": 2}})
        self.assertEqual((c.calls, cbase.load_state(self.path)["glances/g"]["ok"]), (1, True))

    def test_beszel_systems_shared_then_direct(self):
        b = Fake("hub", {"systems": [{"name": "box", "host": "10.0.0.2", "status": "up"}]}, type_="beszel")
        shared(self.path, b, b.data, at=__import__("time").time())
        with mock.patch.object(connectors, "instances", return_value=[b]):
            found, st = health.beszel_systems(self.meta)
        self.assertEqual((list(found), st[0].ok, b.calls), (["10.0.0.2"], True, 0))
        with mock.patch.object(connectors, "instances", return_value=[b]), mock.patch.dict(health.CFG, {"fast_every": 0}):
            found, st = health.beszel_systems(self.meta)
        self.assertEqual((list(found), b.calls), (["10.0.0.2"], 1))


class EverySetting(unittest.TestCase):
    def test_every_is_a_number_of_minutes_within_bounds(self):
        from connectors import settings
        self.assertEqual(settings._clean("beszel", {"url": "http://x", "every": "5"})["every"], 5)
        self.assertNotIn("every", settings._clean("beszel", {"url": "http://x", "every": ""}))
        for bad in (0, 2000):
            with self.assertRaises(settings.SettingsError):
                settings._clean("beszel", {"url": "http://x", "every": bad})
        self.assertIn("every", [f["name"] for t in settings.schema() if t["type"] == "beszel" for f in t["fields"]])


if __name__ == "__main__":
    unittest.main()
