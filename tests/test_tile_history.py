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


class NetworkPoints(unittest.TestCase):
    DATA = {"generated": "2026-10-27T20:00:00+00:00",
            "network": [{"label": "MynetworK", "unifi": {"devices": [{"mac": "AA", "name": "ap", "online": True}, {"mac": "BB", "name": "sw", "state": "Offline"}],
                                                          "clients": [{"mac": "C1", "wired": False}, {"mac": "C2", "wired": True}]},
                         "devices": [{"ip": "10.0.0.2", "status": "online"}, {"ip": "10.0.0.3", "status": "offline"}]}],
            "services_status": [{"connector": "unifi", "label": "UniFi", "unifi": {"devices": [{"mac": "bb", "state": "connected"}], "clients": [{"mac": "c3"}]}}]}

    def test_merged_by_mac_the_connector_being_fresher(self):
        got = th.network_points(self.DATA)
        self.assertEqual(got[th.NET_GEAR], (2, 2))   # BB came back online in the direct connector, same MAC in another case
        self.assertEqual(got[th.NET_CLIENTS], (3, 3))
        self.assertEqual(got[th.NET_DEVICES], (1, 2))

    def test_a_missing_source_leaves_its_figure_out(self):
        self.assertEqual(th.network_points({"network": [{"label": "x"}]}), {})

    def test_sampled_once_per_gap(self):
        with tempfile.TemporaryDirectory() as tmp:
            f, db = Path(tmp) / "data.json", Path(tmp) / "t.db"
            f.write_text(json.dumps(self.DATA), encoding="utf-8")
            ts = int(th.datetime.fromisoformat(self.DATA["generated"]).timestamp())
            self.assertEqual(th.sample_network(db, f, now=ts), 3)
            self.assertEqual(th.sample_network(db, f, now=ts), 0)
            self.assertEqual(th.series(db, th.NET_GEAR, 24, now=ts), [[ts, 2, 2]])


class BackupsPoints(unittest.TestCase):
    SETS = [{"level": "ok"}, {"level": "ok"}, {"level": "warn"}, {"level": "crit"}, {"level": "down"}, {"level": "ok", "archived": True}]

    def test_counted_like_the_page(self):
        got = th.backups_points({"sets": self.SETS})
        # five sets in use: two up to date, one late (so four not late), two missing or failing (three not)
        self.assertEqual(got, {th.BACKUPS_OK: (2, 5), th.BACKUPS_LATE: (4, 5), th.BACKUPS_BAD: (3, 5)})
        self.assertEqual(th.backups_points({"sets": []}), {})

    def test_one_point_per_collection_even_when_the_file_is_old(self):
        with tempfile.TemporaryDirectory() as tmp:
            f, db = Path(tmp) / "backups.json", Path(tmp) / "t.db"
            f.write_text(json.dumps({"sets": self.SETS}), encoding="utf-8")
            self.assertEqual(th.sample_backups(db, f, now=NOW), 3)
            self.assertEqual(th.sample_backups(db, f, now=NOW + 60), 0)   # under MIN_GAP
            self.assertEqual(th.sample_backups(db, f, now=NOW + 900), 3)
            self.assertEqual(th.sample_backups(db, Path(tmp) / "none.json", now=NOW + 3600), 0)


class ServicesWarn(unittest.TestCase):
    HOSTS = [
        {"type": "proxy", "enabled": True, "public": {"code": 200}, "backend": {"up": True}},                        # fine
        {"type": "proxy", "enabled": True, "public": {"err": "gaierror"}, "backend": {"up": True}},                  # no DNS: warning
        {"type": "proxy", "enabled": True, "public": {"err": "RemoteDisconnected"}, "backend": {"up": True}},        # closed connection: warning
        {"type": "proxy", "enabled": True, "public": {"err": "RemoteDisconnected"}, "closes_root": True},            # wanted: fine
        {"type": "proxy", "enabled": True, "public": {"code": 200}, "backend": {"up": False}},                       # down, not a warning
        {"type": "dead", "enabled": True, "public": {"code": 502}},                                                  # 404 expected: warning
        {"type": "redirect", "enabled": True, "public": {"code": 301}, "follow": {"code": 503}},                     # final page failing: warning
        {"type": "proxy", "enabled": True, "paused": "x", "public": {"err": "gaierror"}},                            # paused: not followed
        {"type": "local", "enabled": True, "backend": {"internal": True}},                                           # internal only: not followed
    ]

    def test_counted_like_the_page(self):
        # seven followed services, four in warning
        self.assertEqual(th.services_points({"hosts": self.HOSTS}), {th.SERVICES_WARN: (3, 7)})
        self.assertEqual(th.services_points({"hosts": []}), {})

    def test_sampled_at_the_time_of_the_collection(self):
        with tempfile.TemporaryDirectory() as tmp:
            f, db = Path(tmp) / "data.json", Path(tmp) / "t.db"
            f.write_text(json.dumps({"generated": "2026-10-27T20:00:00+00:00", "hosts": self.HOSTS}), encoding="utf-8")
            ts = int(th.datetime.fromisoformat("2026-10-27T20:00:00+00:00").timestamp())
            self.assertEqual(th.sample_services(db, f, now=ts), 1)
            self.assertEqual(th.series(db, th.SERVICES_WARN, 24, now=ts), [[ts, 3, 7]])


class AgentsPoints(unittest.TestCase):
    AGENTS = [{"state": "actif"}, {"state": "actif", "outdated": True}, {"state": "actif", "outdated": True, "update_requested": True},
              {"state": "silencieux"}, {"state": "en attente"}, {"state": "révoqué", "outdated": True}]

    def test_counted_like_the_page(self):
        # five agents followed (the revoked one is out): three running, one late (the other one has its update asked for)
        self.assertEqual(th.agents_points(self.AGENTS), {th.AGENTS_RUNNING: (3, 5), th.AGENTS_LATE: (4, 5)})
        self.assertEqual(th.agents_points([{"state": "révoqué"}]), {})

    def test_sampled_once_per_gap(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "t.db"
            self.assertEqual(th.sample_agents(db, self.AGENTS, now=10_000), 2)
            self.assertEqual(th.sample_agents(db, self.AGENTS, now=10_060), 0)
            self.assertEqual(th.series(db, th.AGENTS_RUNNING, 24, now=10_060), [[10_000, 3, 5]])


if __name__ == "__main__":
    unittest.main()
