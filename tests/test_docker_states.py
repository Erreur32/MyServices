"""Container states refreshed between two Docker inventories: the health reading's `docker ps -a` (SSH, every pass) and the
Linux agent's report (every minute) update the status of each cached container; a container that appeared or disappeared
marks the machine to be read again.

  python3 -m unittest discover -s tests (collect_docker / docker_states: in the image)
"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.core import docker_state  # noqa: E402
from msv.core import inventory_cache  # noqa: E402

try:
    from msv.machines import agents
    from msv.collect import health
except ImportError:
    agents = health = None

PS = ("web|Up 2 days (healthy)|nginx:latest\n"
      "pl_mail-php-1|Created|php:8\n"
      "crashy|Exited (1) 2 hours ago|app:1\n")
CACHED = [{"name": "web", "image": "nginx:latest", "status": "Up 27 minutes (healthy)", "ports": [[80, 80]]},
          {"name": "pl_mail-php-1", "image": "php:8", "status": "Up 27 minutes (healthy)", "ports": []}]


class States(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(docker_state.parse_states(PS), {"web": "Up 2 days (healthy)", "pl_mail-php-1": "Created", "crashy": "Exited (1) 2 hours ago"})
        self.assertEqual(docker_state.parse_states(""), {})

    def test_refresh_keeps_the_inventory_and_changes_the_status(self):
        fresh, changed = docker_state.refresh_states(CACHED, {"web": "Up 2 days (healthy)", "pl_mail-php-1": "Created"})
        self.assertEqual([c["status"] for c in fresh], ["Up 2 days (healthy)", "Created"])
        self.assertEqual(fresh[0]["ports"], [[80, 80]])
        self.assertFalse(changed)
        self.assertEqual(CACHED[1]["status"], "Up 27 minutes (healthy)")   # the cached list is not modified in place

    def test_a_container_that_came_or_went_asks_for_a_new_inventory(self):
        _, changed = docker_state.refresh_states(CACHED, docker_state.parse_states(PS))
        self.assertTrue(changed)
        _, changed = docker_state.refresh_states(CACHED, {"web": "Up"})
        self.assertTrue(changed)
        self.assertEqual(docker_state.refresh_states(None, {"web": "Up"}), (None, False))

    def test_uptime_from_the_status(self):
        self.assertEqual([docker_state.uptime_s(s) for s in ("Up 5 minutes (healthy)", "Up About an hour", "Up About a minute", "Up Less than a second", "Up 2 days")],
                         [300, 3600, 60, 0, 172800])
        self.assertIsNone(docker_state.uptime_s("Exited (0) 3 hours ago"))
        self.assertIsNone(docker_state.uptime_s("Created"))

    def test_a_container_started_after_the_inventory_asks_for_a_new_one(self):
        states, now = {"web": "Up 5 minutes", "pl_mail-php-1": "Up 3 days"}, 100_000.0
        self.assertTrue(docker_state.refresh_states(CACHED, states, since=now - 3600, now=now)[1])   # recreated 5 min ago, inventory 1 h ago: its image may be new
        self.assertFalse(docker_state.refresh_states(CACHED, {"web": "Up 2 hours", "pl_mail-php-1": "Up 3 days"}, since=now - 3600, now=now)[1])
        self.assertFalse(docker_state.refresh_states(CACHED, states, now=now)[1])   # no inventory time: the roster only


class CacheUpdate(unittest.TestCase):
    def test_status_written_and_machine_marked_stale_on_change(self):
        with tempfile.TemporaryDirectory() as t:
            path = os.path.join(t, "docker.json")
            ts = time.time() - 60   # an inventory of a minute ago: the containers up for days started before it
            inventory_cache._write(path, {"ts": ts, "data": {"10.0.0.2": CACHED, "_internal": {}, "_hostinfo": {}}})
            self.assertTrue(inventory_cache.update_states(path, "10.0.0.2", {"web": "Up 2 days (healthy)", "pl_mail-php-1": "Created"}))
            cache = json.loads(Path(path).read_text())
            self.assertEqual(cache["data"]["10.0.0.2"][1]["status"], "Created")
            self.assertEqual((cache["ts"], cache.get("stale", [])), (ts, []))
            self.assertTrue(inventory_cache.update_states(path, "10.0.0.2", docker_state.parse_states(PS)))
            self.assertEqual(json.loads(Path(path).read_text())["stale"], ["10.0.0.2"])
            self.assertFalse(inventory_cache.update_states(path, "10.0.0.9", {"x": "Up"}))   # machine not in the cache
            self.assertFalse(inventory_cache.update_states(os.path.join(t, "none.json"), "10.0.0.2", {}))
            self.assertEqual([f for f in os.listdir(t) if f.endswith(".tmp")], [])


@unittest.skipIf(health is None, "health.py needs its dependencies (run in the image)")
class HealthAndAgent(unittest.TestCase):
    def test_collect_docker_lists_every_state(self):
        got = health.collect_docker(lambda cmd, timeout=0: (0, PS) if cmd == health.DOCKER_PS_CMD else (1, ""))
        self.assertEqual(got["states"], docker_state.parse_states(PS))

    def test_agent_report_states(self):
        report = {"data": {"kind": "linux", "cmds": {health.DOCKER_PS_CMD: [0, PS]}}}
        self.assertEqual(agents.docker_states(report)["pl_mail-php-1"], "Created")
        self.assertIsNone(agents.docker_states({"data": {"kind": "linux", "cmds": {health.DOCKER_PS_CMD: [1, "permission denied"]}}}))
        self.assertIsNone(agents.docker_states({"data": {"kind": "windows"}}))
        self.assertIsNone(agents.docker_states(None))


if __name__ == "__main__":
    unittest.main()
