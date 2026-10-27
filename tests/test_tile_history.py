"""tile_history.py: the health count of the Machines tiles taken from health/stats.json, one point per MIN_GAP s, 7 days kept.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tile_history as th  # noqa: E402

NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc).timestamp()


def stats(at, levels):
    return {"timestamp": datetime.fromtimestamp(at, timezone.utc).isoformat(),
            "hosts": [{"name": f"m{i} · 10.0.0.{i}", "level": lv, "reachable": lv != "down"} for i, lv in enumerate(levels)]}


class TileHistory(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "t.db"
        self.file = Path(self.tmp.name) / "stats.json"

    def put(self, at, levels):
        self.file.write_text(json.dumps(stats(at, levels)), encoding="utf-8")
        return th.sample(self.db, self.file, now=at)

    def test_health_point_counts_like_the_tile(self):
        # a machine not read ("na") is left out of the total; an unreachable one is read but not healthy
        self.assertEqual(th.health_point(stats(NOW, ["ok", "ok", "warn", "na", "ok"]))[1:], (3, 4))
        self.assertEqual(th.health_point(stats(NOW, ["ok", "crit"]))[1:], (1, 2))
        self.assertIsNone(th.health_point(stats(NOW, ["na"])))
        self.assertIsNone(th.health_point({"timestamp": "bad", "hosts": [{"level": "ok"}]}))

    def test_stored_once_with_a_gap_and_read_back(self):
        self.assertEqual(self.put(NOW - 3600, ["ok", "ok"]), 1)
        self.assertEqual(self.put(NOW - 3600, ["ok", "ok"]), 0)       # the same pass read twice
        self.assertEqual(self.put(NOW - 3600 + 60, ["ok", "warn"]), 0)   # less than MIN_GAP after the last one
        self.assertEqual(self.put(NOW, ["ok", "warn"]), 1)
        got = th.series(self.db, th.HEALTH, 24, now=NOW)
        self.assertEqual([(v, t) for _, v, t in got], [(2, 2), (1, 2)])
        self.assertEqual(len(th.series(self.db, th.HEALTH, 1, now=NOW + 1800)), 1)   # a shorter period keeps only the recent point

    def test_old_points_purged_and_missing_file(self):
        self.put(NOW - 8 * 86400, ["ok"])
        self.assertEqual(th.series(self.db, th.HEALTH, 168, now=NOW), [])   # past KEEP_S: not stored at all
        self.assertEqual(th.sample(self.db, Path(self.tmp.name) / "none.json", now=NOW), 0)


if __name__ == "__main__":
    unittest.main()
