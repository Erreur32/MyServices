"""availability.py: points taken from data.json, stored once per collection, daily roll-up, report and purge.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import availability as av  # noqa: E402

NOW = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc).timestamp()


def data(at: float, web_up=True, nas_ping=True):
    return {"generated": datetime.fromtimestamp(at, timezone.utc).isoformat(),
            "machine_list": [{"ip": "10.0.0.2", "name": "srv", "ping": True}, {"ip": "10.0.0.3", "name": "nas", "ping": nas_ping},
                             {"ip": "10.0.0.4", "name": "pc", "ping": False, "off": True}],
            "hosts": [{"type": "proxy", "id": 1, "domains": ["web.lan"], "enabled": True, "machine": "srv", "ip": "10.0.0.2", "port": 80,
                       "backend": {"up": web_up, "ms": 20}, "uptime": [{"instance": "kuma", "name": "Web", "status": "up" if web_up else "down", "response_ms": 30}]},
                      {"type": "proxy", "id": 2, "domains": ["off.lan"], "enabled": False, "backend": {"up": False}},
                      {"type": "local", "id": "x", "enabled": True, "ip": "10.0.0.3", "port": 5000, "backend": {"up": False}},
                      {"type": "proxy", "id": 3, "domains": ["paused.lan"], "enabled": True, "backend": {"up": True},
                       "uptime": [{"instance": "kuma", "name": "Paused", "status": "maintenance"}]}]}


class Availability(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "t.db"
        self.file = Path(self.tmp.name) / "data.json"

    def put(self, at, **kw):
        self.file.write_text(json.dumps(data(at, **kw)), encoding="utf-8")
        return av.sample(self.db, self.file, now=at)

    def test_points(self):
        keys = {p["key"]: p["up"] for p in av.points(data(NOW, nas_ping=False))}
        # disabled host, machine off, Kuma in maintenance: not sampled ; a service down on a machine that does not ping: the machine says it
        self.assertEqual(keys, {"svc:proxy:1": True, "svc:proxy:3": True, "machine:10.0.0.2": True, "machine:10.0.0.3": False, "kuma:kuma:Web": True})
        self.assertIn("svc:local:x", {p["key"] for p in av.points(data(NOW))})

    def test_une_fois_par_collecte_et_rapport(self):
        self.assertEqual(self.put(NOW - 3600), 6)
        self.assertEqual(self.put(NOW - 3600), 0)   # same collection read twice
        self.put(NOW - 1800, web_up=False)
        self.put(NOW)
        r = av.report(self.db, 1, now=NOW)
        by = {x["key"]: x for x in r["items"]}
        web = by["svc:proxy:1"]
        self.assertEqual((web["samples"], web["down"], web["uptime"], web["ms"], web["last"]["up"]), (3, 1, 66.67, 20, True))
        self.assertEqual(len(web["cells"]), 24)
        self.assertEqual(r["items"][0]["uptime"], 0.0)   # worst first: the local service always down
        week = av.report(self.db, 7, now=NOW)
        self.assertEqual(len(week["items"][0]["cells"]), 7)
        self.assertEqual({x["key"]: x["uptime"] for x in week["items"]}["kuma:kuma:Web"], 66.67)

    def test_purge(self):
        self.put(NOW - 20 * 86400)
        self.put(NOW)
        with av._db(self.db) as db:
            self.assertEqual(db.execute("SELECT COUNT(DISTINCT ts) FROM avail_samples").fetchone()[0], 1)   # older than SAMPLE_DAYS: gone
            self.assertEqual(db.execute("SELECT COUNT(DISTINCT day) FROM avail_days").fetchone()[0], 2)      # the day roll-up stays
        self.assertEqual(self.put(NOW + 400 * 86400), 6)
        with av._db(self.db) as db:
            self.assertEqual(db.execute("SELECT COUNT(DISTINCT day) FROM avail_days").fetchone()[0], 1)

    def test_fichier_illisible(self):
        self.assertEqual(av.sample(self.db, self.file), 0)


class ReachSeries(Availability):
    def test_machines_answering_per_collection(self):
        self.put(NOW - 7200)
        self.put(NOW - 3600, nas_ping=False)
        self.put(NOW)
        got = av.reach_series(self.db, 24, now=NOW)
        # the machine switched off on purpose (pc) is not sampled: two followed machines, one of them down in the middle
        self.assertEqual([(up, n) for _, up, n in got], [(2, 2), (1, 2), (2, 2)])
        self.assertEqual([t for t, _, _ in got], sorted(t for t, _, _ in got))
        self.assertEqual(len(av.reach_series(self.db, 1, now=NOW)), 2)   # the last hour: the point exactly an hour old and the latest
        self.assertEqual(av.reach_series(self.db, 24, now=NOW + 3 * 86400), [])   # older than the period asked
    def test_services_series_leaves_the_machines_out(self):
        self.put(NOW - 3600)
        self.put(NOW, web_up=False)
        got = av.service_series(self.db, 24, now=NOW)
        # three services sampled (the local one is always down); the second collection has the web one down too
        self.assertEqual([(up, n) for _, up, n in got], [(2, 3), (1, 3)])


if __name__ == "__main__":
    unittest.main()
