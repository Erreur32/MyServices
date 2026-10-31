"""metrics.py: the figures of each machine taken from health/stats.json, one point per reading, at most one every MIN_GAP s, 24 h kept.

  python3 -m unittest discover -s tests
"""
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.core import metrics  # noqa: E402

NOW = datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc).timestamp()


def iso(at: float) -> str:
    return datetime.fromtimestamp(at, timezone.utc).isoformat()


def host(name="srv · 10.0.0.2", at=NOW, cpu=12.34, **kw):
    return {"id": name.split(" ")[0], "name": name, "reachable": True, "level": "ok", "read_at": iso(at),
            "res": {"available": True, "cpu_pct": cpu, "mem_pct": 40}, "disks": [{"mount": "/", "used_pct": 30}, {"mount": "/data", "used_pct": 81}],
            "temp": {"available": True, "celsius": 52}, **kw}


class Metrics(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "t.db"
        self.file = Path(self.tmp.name) / "stats.json"

    def put(self, hosts, now):
        self.file.write_text(json.dumps({"hosts": hosts}), encoding="utf-8")
        return metrics.sample(self.db, self.file, now=now)

    def test_figures(self):
        self.assertEqual(metrics.figures(host()), {"cpu": 12.3, "mem": 40.0, "disk": 81.0, "temp": 52.0})
        # Windows: the processor in « load »; no disk, temperature not available
        win = {"load": {"cpu_pct": 7}, "res": {"available": False}, "temp": {"available": False, "celsius": 40}}
        self.assertEqual(metrics.figures(win), {"cpu": 7.0, "mem": None, "disk": None, "temp": None})
        self.assertIsNone(metrics.figures({"res": {"cpu_pct": True}, "disks": [{"used_pct": None}, "x"]})["cpu"])

    def test_points(self):
        stats = {"hosts": [host(), host("off · 10.0.0.3", reachable=False), host("old · 10.0.0.4", read_at=None),
                           {"name": "empty · 10.0.0.5", "reachable": True, "read_at": iso(NOW)}]}
        self.assertEqual([p["machine"] for p in metrics.points(stats)], ["10.0.0.2"])

    def test_une_lecture_un_point_et_ecart_minimal(self):
        self.assertEqual(self.put([host(at=NOW - 600)], NOW - 600), 1)
        self.assertEqual(self.put([host(at=NOW - 600)], NOW - 540), 0)    # same reading (another machine read by --only)
        self.assertEqual(self.put([host(at=NOW - 540)], NOW - 540), 0)    # agent a minute later: under MIN_GAP
        self.assertEqual(self.put([host(at=NOW - 300, cpu=90)], NOW - 300), 1)
        got = metrics.series(self.db, "10.0.0.2", now=NOW)["points"]
        self.assertEqual(got, [[int(NOW - 600), 12.3, 40.0, 81.0, 52.0], [int(NOW - 300), 90.0, 40.0, 81.0, 52.0]])
        self.assertEqual(metrics.series(self.db, "10.0.0.9", now=NOW), {"points": []})

    def test_purge_apres_7_jours(self):
        self.put([host(at=NOW - metrics.KEEP_S - 60)], NOW - metrics.KEEP_S - 60)
        self.assertEqual(self.put([host(at=NOW)], NOW), 1)
        self.assertEqual([p[0] for p in metrics.series(self.db, "10.0.0.2", now=NOW)["points"]], [int(NOW)])
        self.assertEqual(self.put([host(at=NOW - metrics.KEEP_S - 600)], NOW), 0)   # a reading already too old is not stored

    def test_average_per_bucket_over_the_machines(self):
        self.put([host(at=NOW - 7200, cpu=10), host("b · 10.0.0.3", at=NOW - 7200, cpu=30)], NOW - 7200)
        self.put([host(at=NOW - 60, cpu=50)], NOW - 60)
        got = metrics.average(self.db, "cpu", 24, now=NOW)
        self.assertEqual([(v, n) for _, v, n in got], [(20, 2), (50, 1)])
        self.assertEqual(len(metrics.average(self.db, "cpu", 1, now=NOW)), 1)   # the last hour only
        self.assertEqual([v for _, v, _ in metrics.average(self.db, "mem", 24, now=NOW)], [40, 40])
        with self.assertRaises(ValueError):
            metrics.average(self.db, "disk", 24, now=NOW)

    def test_fichier_absent_ou_illisible(self):
        self.assertEqual(metrics.sample(self.db, self.file, now=NOW), 0)
        self.file.write_text("{", encoding="utf-8")
        self.assertEqual(metrics.sample(self.db, self.file, now=NOW), 0)


@unittest.skipUnless(importlib.util.find_spec("argon2"), "auth.py needs argon2 (in the image)")
class AgentOfSshMachine(unittest.TestCase):
    """health.agent_figures: a machine read over SSH first keeps its SSH health, its agent's report still gives a point."""
    def test_point_du_releve_d_agent(self):
        from msv.collect import health
        hc = {"id": "pc", "name": "pc · 10.0.0.7", "ip": "10.0.0.7", "os": "windows"}
        report = {"report": {"data": {"cpu": 12, "mem": 40, "disks": [{"m": "C:", "s": 100, "f": 20}]}}, "fresh": True}
        with tempfile.TemporaryDirectory() as tmp, patch("msv.core.auth.db_path", return_value=Path(tmp) / "t.db"), \
                patch("msv.core.metrics.time.time", return_value=NOW):   # the purge counts from the clock: fixed, or NOW ages out after a day
            self.assertTrue(health.agent_figures(hc, report, iso(NOW)))
            self.assertFalse(health.agent_figures(hc, report, iso(NOW + 60)))      # under MIN_GAP
            self.assertFalse(health.agent_figures(hc, {**report, "fresh": False}, iso(NOW + 600)))
            self.assertFalse(health.agent_figures(hc, None, iso(NOW + 600)))
            self.assertEqual(metrics.series(Path(tmp) / "t.db", "10.0.0.7", now=NOW)["points"], [[int(NOW), 12.0, 40.0, 80.0, None]])


if __name__ == "__main__":
    unittest.main()
