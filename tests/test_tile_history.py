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
from msv.collect import tile_history as th  # noqa: E402

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
        {"type": "redirect", "enabled": True, "public": {"code": 301}, "follow": {"code": None}},                    # redirect not followed to the end: fine
        {"type": "local", "enabled": True, "backend": {"internal": True}},                                           # internal only: not followed
    ]

    def test_counted_like_the_page(self):
        # seven followed services, four in warning
        # eight followed, three healthy (the one down and the four in warning are not)
        self.assertEqual(th.services_points({"hosts": self.HOSTS}), {th.SERVICES_UP: (7, 8), th.SERVICES_WARN: (4, 8), th.SERVICES_HEALTH: (38, 100)})
        self.assertEqual(th.services_points({"hosts": []}), {})

    def test_one_service_per_machine_whatever_its_ports(self):
        svc = lambda machine, port, up, name="anydesk": {"type": "local", "enabled": True, "machine": machine, "port": port, "backend": {"up": up}, "service": {"kind": "process", "name": name}}
        hosts = [svc("a", 7070, True), svc("a", 27461, False), svc("b", 7070, True), svc("a", 3000, True, "node"), svc("a", 3001, True, "node")]
        self.assertEqual(th.services_points({"hosts": hosts}), {th.SERVICES_UP: (3, 4), th.SERVICES_WARN: (4, 4), th.SERVICES_HEALTH: (75, 100)})
        self.assertEqual(th.service_count(hosts), 4)

    def test_sampled_at_the_time_of_the_collection(self):
        with tempfile.TemporaryDirectory() as tmp:
            f, db = Path(tmp) / "data.json", Path(tmp) / "t.db"
            f.write_text(json.dumps({"generated": "2026-10-27T20:00:00+00:00", "hosts": self.HOSTS}), encoding="utf-8")
            ts = int(th.datetime.fromisoformat("2026-10-27T20:00:00+00:00").timestamp())
            self.assertEqual(th.sample_services(db, f, now=ts), 3)
            self.assertEqual(th.series(db, th.SERVICES_WARN, 24, now=ts), [[ts, 4, 8]])


class AgentsPoints(unittest.TestCase):
    AGENTS = [{"state": "actif"}, {"state": "actif", "outdated": True}, {"state": "actif", "outdated": True, "update_requested": True},
              {"state": "silencieux"}, {"state": "en attente"}, {"state": "révoqué", "outdated": True}]

    def test_counted_like_the_page(self):
        # five agents followed (the revoked one is out): three running, one late (the other one has its update asked for)
        self.assertEqual(th.agents_points(self.AGENTS), {th.AGENTS_RUNNING: (3, 5), th.AGENTS_LATE: (4, 5), th.AGENTS_HEALTH: (round((100 + 70 + 70 + 50 + 0) / 5), 100)})
        self.assertEqual(th.agents_points([{"state": "révoqué"}]), {})

    def test_sampled_once_per_gap(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "t.db"
            self.assertEqual(th.sample_agents(db, self.AGENTS, now=10_000), 3)
            self.assertEqual(th.sample_agents(db, self.AGENTS, now=10_060), 0)
            self.assertEqual(th.series(db, th.AGENTS_RUNNING, 24, now=10_060), [[10_000, 3, 5]])


class AgentHealth(unittest.TestCase):
    def test_three_parts_out_of_100(self):
        self.assertEqual(th.agent_health({"state": "actif"}), 100)
        self.assertEqual(th.agent_health({"state": "actif", "outdated": True}), 70)
        self.assertEqual(th.agent_health({"state": "actif", "host_pending": 1}), 80)
        self.assertEqual(th.agent_health({"state": "silencieux"}), 50)
        self.assertEqual(th.agent_health({"state": "en attente"}), 0)
        self.assertIsNone(th.agent_health({"state": "révoqué"}))


class AiPoints(unittest.TestCase):
    GPU = {"connector": "gpuviewr", "machines": [
        {"online": True, "ips": ["10.0.0.5"], "gpus": [{"util": 40, "temp": 60, "mem_used": 1000, "mem_total": 4000, "power": 100, "power_limit": 300},
                                                       {"util": 60, "temp": 70, "mem_used": 3000, "mem_total": 4000, "power": 50, "power_limit": 300}]},
        {"online": False, "ips": ["10.0.0.9"], "gpus": [{"util": 100, "temp": 99, "mem_used": 1, "mem_total": 1, "power": 999}]}]}
    DATA = {"services_status": [GPU,
        {"connector": "ollama", "ok": True, "ai": {"role": "engine", "models": [{"loaded": True}, {"loaded": False}, {"loaded": False}]}},
        {"connector": "llamacpp", "ok": False, "ai": {"role": "engine", "models": []}},
        {"connector": "hermes", "ok": True, "ai": {"role": "agent", "platforms": [{"state": "connected"}, {"state": "error"}]}}]}
    STATS = {"hosts": [{"name": "IA · 10.0.0.5", "res": {"mem_pct": 58.2}}, {"name": "Autre · 10.0.0.9", "res": {"mem_pct": 10}}]}

    def test_counted_like_the_page(self):
        p = th.ai_points(self.DATA, self.STATS)
        self.assertEqual(p["ai.gpu"], (50, 100))
        self.assertEqual(p["ai.vram"], (50, 100))   # 4000 of 8000, the machine that does not answer is out
        self.assertEqual(p["ai.temp"], (70, 100))
        self.assertEqual(p["ai.power"], (150, 600))
        self.assertEqual(p["ai.engines"], (1, 2))
        self.assertEqual(p["ai.models"], (1, 3))
        self.assertEqual(p["ai.agents"], (1, 2))
        self.assertEqual(p["ai.ram"], (58, 100))

    def test_what_is_not_read_leaves_its_key_out(self):
        self.assertEqual(th.ai_points({"services_status": []}), {})
        self.assertNotIn("ai.ram", th.ai_points(self.DATA))


class VirtPoints(unittest.TestCase):
    DATA = {"virtualization": [
        {"connector": "proxmox", "nodes": [{"online": True, "cpu_pct": 20, "mem_pct": 60}, {"online": True, "cpu_pct": 40, "mem_pct": 80}, {"online": False, "cpu_pct": 99, "mem_pct": 99}],
         "guests": [{"status": "running"}, {"status": "stopped"}, {"status": "running", "template": True}], "storage": [{"used_pct": 40}, {"used_pct": 81.4}]},
        {"connector": "proxmox-backup", "datastores": []}]}
    BACKUPS = {"sets": [{"level": "ok", "locations": [{"vzdump": "qemu/100"}]}, {"level": "warn", "locations": [{"vzdump": "lxc/101"}]},
                        {"level": "ok", "archived": True, "locations": [{"vzdump": "qemu/102"}]}, {"level": "ok", "locations": [{"path": "/x"}]}]}

    def test_counted_like_the_page(self):
        p = th.virt_points(self.DATA, self.BACKUPS)
        self.assertEqual(p["virt.hosts"], (2, 3))
        self.assertEqual(p["virt.guests"], (1, 2))   # the template is out
        self.assertEqual((p["virt.cpu"], p["virt.mem"]), ((30, 100), (70, 100)))   # the host that is off is out of the means
        self.assertEqual(p["virt.storage"], (81, 100))
        self.assertEqual(p["virt.backups"], (1, 2))   # archived sets and sets that are not a vzdump are out

    def test_what_is_not_read_leaves_its_key_out(self):
        self.assertEqual(th.virt_points({"virtualization": []}), {})
        self.assertNotIn("virt.backups", th.virt_points(self.DATA))


class GpuLive(unittest.TestCase):
    STATE = {"gpuviewr/a": {"at": 1000, "last": {"machines": [{"online": True, "ips": ["10.0.0.5"], "gpus": [{"util": 30, "temp": 55, "mem_used": 1, "mem_total": 4, "power": 80}]}]}},
             "npm/x": {"at": 5, "last": {}}}

    def test_a_point_per_reading_of_the_connector_not_per_look(self):
        with tempfile.TemporaryDirectory() as tmp:
            f, db = Path(tmp) / "connectors.json", Path(tmp) / "t.db"
            f.write_text(json.dumps(self.STATE), encoding="utf-8")
            self.assertEqual(th.sample_gpu_live(db, f, now=1010), 4)   # load, memory, temperature, power
            self.assertEqual(th.sample_gpu_live(db, f, now=1020), 0)   # same reading
            self.assertEqual(th.series(db, "ai.gpu", 24, now=1020), [[1000, 30, 100]])

    def test_no_reading_no_point(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(th.sample_gpu_live(Path(tmp) / "t.db", Path(tmp) / "none.json"), 0)
            (Path(tmp) / "c.json").write_text(json.dumps({"npm/x": {"at": 1, "last": {}}}), encoding="utf-8")
            self.assertEqual(th.sample_gpu_live(Path(tmp) / "t.db", Path(tmp) / "c.json"), 0)


if __name__ == "__main__":
    unittest.main()
