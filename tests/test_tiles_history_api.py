"""The history of the figure tiles: the routes /…/history of every page, and the sampling after a collection (server.keep_availability),
where each history is kept on its own.

  À lancer dans l'image (FastAPI) : python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from fastapi.testclient import TestClient

    import api
    import auth
    import dns_probe
    import server
    import tile_history
    import tokens
    from auth import db_path
except ImportError:
    api = None

PW = "un mot de passe long"
BASE = "/myservices/api/v1"
ROUTES = {"machines": ["reach", "health", "cpu", "mem"], "network": ["gear", "clients", "devices", "bw"], "backups": ["ok", "late", "bad"],
          "services": ["up", "warn", "health"], "agents": ["running", "late", "health"], "ai": ["gpu", "vram", "temp", "power", "engines", "models", "agents", "ram"],
          "virtualization": ["hosts", "guests", "cpu", "mem", "storage", "backups"], "dns": ["local", "external"]}


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class HistoryRoutes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        server.STATIC = server.WEB = d
        api.AUTH = True
        api.STORE = auth.Store(d / "myservices.db")
        api.TOKENS = tokens.Tokens(d / "myservices.db")
        api.STORE.create_user("admin", PW, "admin")
        self.c = TestClient(api.app, client=("192.168.1.50", 50000))
        self.c.post(BASE + "/login", json={"username": "admin", "password": PW})

    def tearDown(self):
        self.tmp.cleanup()

    def test_every_page_answers_with_its_series_for_a_period(self):
        for page, keys in ROUTES.items():
            with self.subTest(page=page):
                r = self.c.get(f"{BASE}/{page}/history?hours=72")
                self.assertEqual(r.status_code, 200)
                body = r.json()
                self.assertEqual(body["hours"], 72)
                for key in keys:
                    self.assertIn(key, body)

    def test_a_period_that_is_not_offered_falls_back_to_24_hours(self):
        self.assertEqual(self.c.get(f"{BASE}/ai/history?hours=5").json()["hours"], 24)

    def test_the_dns_history_names_the_public_resolvers(self):
        external = self.c.get(f"{BASE}/dns/history").json()["external"]
        self.assertEqual([e["ip"] for e in external], [ip for _, ip in dns_probe.EXTERNAL])
        self.assertEqual(set(external[0]), {"name", "ip", "ms", "up"})

    def test_the_agents_history_is_for_the_admin_only(self):
        anon = TestClient(api.app, client=("192.168.1.51", 50000))
        self.assertIn(anon.get(f"{BASE}/agents/history").status_code, (401, 403))


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class Sampling(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        server.WEB = Path(self.tmp.name)
        self.db = db_path(server.CFG)
        self.original = dns_probe.latency_ms
        dns_probe.latency_ms = lambda ip, *a, **k: 4
        self.sample_services = tile_history.sample_services

    def tearDown(self):
        dns_probe.latency_ms = self.original
        tile_history.sample_services = self.sample_services
        self.tmp.cleanup()

    def write(self, data: dict):
        (server.WEB / "data.json").write_text(json.dumps(data), encoding="utf-8")

    def test_the_dns_servers_are_the_ones_of_the_dns_page(self):
        self.assertEqual(server.local_dns_servers(), [])   # no data.json yet
        self.write({"dns": {"servers": {"10.0.0.1": {}, "10.0.0.2": {}}}})
        self.assertEqual(server.local_dns_servers(), ["10.0.0.1", "10.0.0.2"])

    def test_a_collection_keeps_the_histories_and_one_that_fails_leaves_the_others_alone(self):
        self.write({"generated": "2026-10-27T20:00:00+00:00", "hosts": [],
                    "virtualization": [{"connector": "proxmox", "nodes": [{"online": True, "cpu_pct": 10, "mem_pct": 20}]}]})
        def broken(*a, **k):
            raise RuntimeError("boom")
        tile_history.sample_services = broken
        server.keep_availability()
        points = tile_history.series(self.db, "virt.hosts", 1)
        self.assertEqual([p[1:] for p in points], [[1, 1]])   # the Virtualization tiles were kept although the Services ones failed

    def test_the_round_of_the_minute_keeps_the_dns_answers_and_the_gpu_reading(self):
        self.write({"dns": {"servers": {"10.0.0.1": {}}}})
        state = Path(server.CFG["state_dir"]) / "connectors.json"
        state.parent.mkdir(parents=True, exist_ok=True)
        saved = state.read_text(encoding="utf-8") if state.exists() else None
        now = int(time.time())
        state.write_text(json.dumps({"gpuviewr/g": {"at": now, "last": {"machines": [{"online": True, "ips": ["10.0.0.5"], "gpus": [{"util": 40, "temp": 60, "mem_used": 1, "mem_total": 2, "power": 90}]}]}}}), encoding="utf-8")
        try:
            server.tiles_live_round()
        finally:
            state.write_text(saved, encoding="utf-8") if saved is not None else state.unlink()
        self.assertEqual([p[1:] for p in tile_history.series(self.db, dns_probe.LOCAL, 1)][-1], [1, 1])
        self.assertEqual([p[1:] for p in tile_history.series(self.db, "ai.gpu", 1)][-1], [40, 100])


if __name__ == "__main__":
    unittest.main()
