"""New services on the machines (new_services.py): proposed from the « nouveau » events, follow, don't follow (pause), resume."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import new_services  # noqa: E402

ROWS = [
    {"type": "local", "id": "10.0.0.2:8080", "ip": "10.0.0.2", "port": 8080, "machine": "nas", "name": "speedtest",
     "service": {"kind": "docker", "name": "speedtest", "image": "lscr.io/speedtest"}, "app": {"label": "Speedtest Tracker"}},
    {"type": "local", "id": "10.0.0.3:18991", "ip": "10.0.0.3", "port": 18991, "machine": "dev", "service": {"kind": "process", "name": "python3"}},
    {"type": "proxy", "id": "12", "domains": ["a.lan"]},
]
EVENTS = [{"ts": 300.0, "key": "local:10.0.0.3:18991"}, {"ts": 200.0, "key": "local:10.0.0.2:8080"},
          {"ts": 100.0, "key": "local:10.0.0.9:22"}, {"ts": 50.0, "key": "proxy:12"}]


class NewServices(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.meta = self.d / "services-meta.json"
        self.meta.write_text(json.dumps({"machines": {}, "services": {"10.0.0.2:8080": {"description": "kept"}}}))
        self.data = {"hosts": [dict(r) for r in ROWS]}
        (self.d / "data.json").write_text(json.dumps(self.data))

    def tearDown(self):
        self.tmp.cleanup()

    def keys(self, data=None):
        return [x["key"] for x in new_services.pending(data or self.data, EVENTS, self.d)]

    def test_only_present_machine_services_newest_first(self):
        got = new_services.pending(self.data, EVENTS, self.d)
        self.assertEqual([x["key"] for x in got], ["local:10.0.0.3:18991", "local:10.0.0.2:8080"])   # gone and NPM hosts left out
        self.assertEqual((got[1]["name"], got[1]["kind"], got[1]["app"], got[1]["since"]), ("speedtest", "docker", "Speedtest Tracker", 200.0))

    def test_follow_is_remembered(self):
        new_services.follow(["local:10.0.0.3:18991"], self.d)
        self.assertEqual(self.keys(), ["local:10.0.0.2:8080"])

    def test_ignore_pauses_under_ip_port_then_resume(self):
        self.assertEqual(new_services.ignore("local:10.0.0.2:8080", self.data, self.meta, self.d, self.d), "10.0.0.2:8080")
        entry = json.loads(self.meta.read_text())["services"]["10.0.0.2:8080"]
        self.assertEqual(entry["description"], "kept")
        self.assertTrue(entry["pause"].startswith("not followed ("))
        published = json.loads((self.d / "data.json").read_text())
        self.assertTrue(published["hosts"][0]["paused"])               # the page shows it at once
        self.assertEqual(self.keys(published), ["local:10.0.0.3:18991"])
        new_services.set_pause(self.meta, self.d, "10.0.0.2:8080", None)
        self.assertEqual(json.loads(self.meta.read_text())["services"]["10.0.0.2:8080"], {"description": "kept"})
        self.assertNotIn("paused", json.loads((self.d / "data.json").read_text())["hosts"][0])

    def test_machine_ssh_never_proposed(self):
        data = {"hosts": self.data["hosts"] + [{"type": "local", "id": "10.0.0.3:22", "ip": "10.0.0.3", "port": 22, "app": {"key": "openssh"},
                                                "service": {"kind": "process", "name": "sshd"}}]}
        got = new_services.pending(data, [{"ts": 400.0, "key": "local:10.0.0.3:22"}, *EVENTS], self.d)
        self.assertNotIn("local:10.0.0.3:22", [x["key"] for x in got])

    def test_ignore_unknown_service(self):
        with self.assertRaises(LookupError):
            new_services.ignore("local:10.0.0.9:22", self.data, self.meta, self.d, self.d)


if __name__ == "__main__":
    unittest.main()
