"""availability.py: points taken from data.json, stored once per collection, daily roll-up, report and purge.

  python3 -m unittest discover -s tests
"""
import json
import os
import sys
import tempfile
import time
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
        self.assertEqual(len(web["cells"]), 96)   # a cell per quarter of an hour
        self.assertEqual(r["items"][0]["uptime"], 0.0)   # worst first: the local service always down
        week = av.report(self.db, 7, now=NOW)
        self.assertEqual(len(week["items"][0]["cells"]), 7)
        self.assertEqual({x["key"]: x["uptime"] for x in week["items"]}["kuma:kuma:Web"], 66.67)

    def test_changement_d_heure_un_jour_par_case(self):
        os.environ["TZ"] = "Europe/Paris"
        time.tzset()
        self.addCleanup(time.tzset)
        self.addCleanup(os.environ.__setitem__, "TZ", os.environ.get("TZ", "UTC"))
        for at in ("2026-10-31 23:26", "2026-03-30 23:26"):   # after the day of 25 hours, then after the day of 23 hours
            now = datetime.strptime(at, "%Y-%m-%d %H:%M").timestamp()
            self.put(now)
            days = [datetime.fromtimestamp(c["t"]) for c in av.report(self.db, 30, now=now)["items"][0]["cells"]]
            self.assertEqual(len({d.date() for d in days}), 30)
            self.assertEqual(days[-1].date(), datetime.fromtimestamp(now).date())
            self.assertTrue(all(d.hour == 0 for d in days))

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


class PulseRuns(unittest.TestCase):
    """What the pulses know goes to runs of the same state: a short outage shows, the table stays small, the old history stays readable."""
    KEY = "machine:10.0.0.2"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "t.db"

    def pulse(self, at, up, began=None):
        av.record(self.db, {self.KEY: (up, began)}, at, gap=120)

    def runs(self):
        with av._db(self.db) as db:
            return [tuple(r) for r in db.execute("SELECT t0, t1, up FROM avail_runs ORDER BY t0")]

    def test_a_healthy_thing_is_one_row_that_grows(self):
        for i in range(120):   # an hour of pulses every 30 s
            self.pulse(NOW + 30 * i, True)
        self.assertEqual(self.runs(), [(NOW, NOW + 3570, 1)])

    def test_an_outage_begins_at_the_first_contrary_pulse(self):
        self.pulse(NOW, True)
        self.pulse(NOW + 30, True)
        self.pulse(NOW + 90, False, began=NOW + 60)   # confirmed one pulse after it began
        self.pulse(NOW + 120, False)
        self.pulse(NOW + 150, True, began=NOW + 150)
        self.assertEqual(self.runs(), [(NOW, NOW + 60, 1), (NOW + 60, NOW + 150, 0), (NOW + 150, NOW + 150, 1)])

    def test_a_hole_longer_than_the_gap_is_not_counted(self):
        self.pulse(NOW, True)
        self.pulse(NOW + 3600, True)   # the server was stopped for an hour
        self.assertEqual(self.runs(), [(NOW, NOW, 1), (NOW + 3600, NOW + 3600, 1)])

    def test_report_shows_a_two_minute_outage_the_collections_missed(self):
        t = NOW - 1200
        with av._db(self.db) as db:
            for at in (NOW - 1800, NOW - 900, NOW):   # the collections only see « up »
                db.execute("INSERT INTO avail_samples (key, ts, up) VALUES (?, ?, 1)", (self.KEY, at))
                db.execute("INSERT INTO avail_days (key, day, n, up) VALUES (?, ?, 1, 1) ON CONFLICT (key, day) DO UPDATE SET n = n + 1, up = up + 1",
                           (self.KEY, datetime.fromtimestamp(at).strftime("%Y-%m-%d")))
            db.execute("INSERT INTO avail_items (key, kind, label, machine, target, seen) VALUES (?, 'machine', 'srv', 'srv', '10.0.0.2', ?)", (self.KEY, NOW))
        for i in range(0, 271, 30):
            self.pulse(t + i, True)
        for i in (330, 360, 390):
            self.pulse(t + i, False, began=t + 300)
        self.pulse(t + 450, True, began=t + 420)   # the way back, confirmed two pulses after it began
        self.assertEqual(self.runs(), [(t, t + 300, 1), (t + 300, t + 420, 0), (t + 420, t + 450, 1)])
        day = av.report(self.db, 1, now=NOW)["items"][0]
        self.assertEqual((day["uptime"], day["down"], len(day["cells"])), (91.11, 1, 96))   # a minute-long outage still counts as one reading down
        self.assertEqual(min(c["pct"] for c in day["cells"] if c["pct"] is not None), 20.0)
        week = av.report(self.db, 7, now=NOW)["items"][0]
        self.assertEqual((len(week["cells"]), week["cells"][-1]["pct"]), (7, 73.3))
        self.assertTrue(day["last"]["up"])

    def test_old_runs_are_purged(self):
        self.pulse(NOW - 400 * 86400, True)
        self.pulse(NOW, True)
        self.assertEqual(self.runs(), [(int(NOW), int(NOW), 1)])


if __name__ == "__main__":
    unittest.main()
