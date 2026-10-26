"""Container states refreshed between two Docker inventories: the health reading's `docker ps -a` (SSH, every pass) and the
Linux agent's report (every minute) update the status of each cached container; a container that appeared or disappeared
marks the machine to be read again.

  python3 -m unittest discover -s tests (collect_docker / docker_states: in the image)
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import docker_state  # noqa: E402
import inventory_cache  # noqa: E402

try:
    import agents
    import health
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


class CacheUpdate(unittest.TestCase):
    def test_status_written_and_machine_marked_stale_on_change(self):
        with tempfile.TemporaryDirectory() as t:
            path = os.path.join(t, "docker.json")
            inventory_cache._write(path, {"ts": 1.0, "data": {"10.0.0.2": CACHED, "_internal": {}, "_hostinfo": {}}})
            self.assertTrue(inventory_cache.update_states(path, "10.0.0.2", {"web": "Up 2 days (healthy)", "pl_mail-php-1": "Created"}))
            cache = json.loads(Path(path).read_text())
            self.assertEqual(cache["data"]["10.0.0.2"][1]["status"], "Created")
            self.assertEqual((cache["ts"], cache.get("stale", [])), (1.0, []))
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
