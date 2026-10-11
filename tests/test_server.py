"""api.py (FastAPI) et server.py : fichiers servis (jamais hors de web/ ni du volume), réseaux autorisés,
contrôle d'origine, réponses de l'API ⟳ et de l'API v1, horaires.

  docker compose run --rm --entrypoint python3 myservices -m unittest discover -s tests   (dépendances de l'image)
"""
import ipaddress
import json
from unittest import mock
import threading
import time
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

try:
    from fastapi.testclient import TestClient

    import api
except ImportError:  # hors image (bibliothèque standard seule) : ces tests sont sautés
    api = None


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class Files(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.static, self.web = root / "app" / "web", root / "data" / "web"
        self.static.mkdir(parents=True)
        self.web.mkdir(parents=True)
        (self.static / "index.html").write_text("page")
        (self.web / "data.json").write_text("{}")
        (root / "app" / "config.py").write_text("secret")
        (self.static / "lien.md").symlink_to(root / "app" / "config.py")
        server.STATIC, server.WEB = self.static, self.web

    def tearDown(self):
        self.tmp.cleanup()

    def test_page_and_produced_files(self):
        self.assertEqual(api.find("index.html"), (self.static / "index.html").resolve())
        self.assertEqual(api.find("data.json"), (self.web / "data.json").resolve())

    def test_never_outside(self):
        for rel in ("../config.py", "../../app/config.py", "lien.md", "/etc/passwd", "missing.html"):
            self.assertIsNone(api.find(rel), rel)


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        web = Path(cls.tmp.name)
        (web / "index.html").write_text("<p>page</p>")
        (web / "data.json").write_text(json.dumps({"generated": "2026-10-10T00:00:00+00:00",
                                                   "connectors": [{"type": "npm", "name": "lan", "ok": True}]}))
        server.STATIC = server.WEB = web
        server.PROGRESS = str(web / "progress.json")
        api.AUTH = False  # comptes testés à part (test_auth.py)
        cls.c = TestClient(api.app, client=("192.168.1.20", 50000))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_page(self):
        r = self.c.get("/myservices/", follow_redirects=False)  # le front est sous /v2/ : /myservices/ y mène
        self.assertEqual((r.status_code, r.headers["location"]), (302, "/myservices/v2/"))
        r = self.c.get("/myservices/index.html")
        self.assertEqual((r.status_code, r.text), (200, "<p>page</p>"))
        self.assertEqual(r.headers["x-content-type-options"], "nosniff")
        self.assertNotIn("server", {k.lower() for k in r.headers})
        self.assertEqual(self.c.get("/", follow_redirects=False).headers["location"], "/myservices/v2/")

    def test_csp(self):
        page = self.c.get("/myservices/index.html").headers["content-security-policy"]
        self.assertIn("default-src 'self'", page)
        self.assertIn("object-src 'none'", page)
        (server.STATIC / "login.html").write_text("<form>")
        login = self.c.get("/myservices/login.html").headers["content-security-policy"]
        self.assertNotIn("unsafe-inline", login)  # page de connexion : politique stricte
        (server.STATIC / "v2").mkdir(exist_ok=True)
        (server.STATIC / "v2" / "index.html").write_text("<div id=root>")
        v2 = self.c.get("/myservices/v2/").headers["content-security-policy"]
        self.assertNotIn("unsafe-inline", v2)  # nouveau front compilé : politique stricte
        self.assertNotIn("content-security-policy", self.c.get("/myservices/api/v1/status").headers)  # JSON : inutile

    def test_folder_without_slash_and_unknown_page(self):
        (server.STATIC / "v2").mkdir(exist_ok=True)
        (server.STATIC / "v2" / "index.html").write_text("<div id=root>")
        r = self.c.get("/myservices/v2", follow_redirects=False)
        self.assertEqual((r.status_code, r.headers["location"]), (302, "/myservices/v2/"))
        r = self.c.get("/myservices/v2login.html")
        self.assertEqual(r.status_code, 404)
        self.assertIn('href="/myservices/"', r.text)  # page lisible avec un lien de retour, pas du JSON

    def test_traversal_refused(self):
        for p in ("/myservices/../server.py", "/myservices/%2e%2e/%2e%2e/etc/passwd", "/myservices/..%2fserver.py"):
            self.assertEqual(self.c.get(p).status_code, 404, p)

    def test_status_v1(self):
        st = self.c.get("/myservices/api/v1/status").json()
        self.assertEqual(st["generated"], "2026-10-10T00:00:00+00:00")
        for k in ("running", "progress", "started", "ended", "result", "cooldown", "wait", "now"):
            self.assertIn(k, st)

    def test_refresh_other_origin_refused(self):
        r = self.c.post("/myservices/api/v1/refresh", headers={"Origin": "http://evil.example"})
        self.assertEqual(r.status_code, 403)

    def test_refresh_too_soon(self):
        server.TASKS["collect"]["trigger"] = server.time.time()
        r = self.c.post("/myservices/api/v1/refresh", headers={"Origin": "http://testserver"})
        self.assertEqual(r.status_code, 429)
        self.assertGreater(r.json()["wait"], 0)

    def test_v1_connectors_tasks_docs(self):
        self.assertEqual(self.c.get("/myservices/api/v1/connectors").json()["connectors"][0]["name"], "lan")
        tasks = self.c.get("/myservices/api/v1/tasks").json()
        self.assertEqual(tasks["collect"]["minutes"], [10, 40])
        self.assertEqual(self.c.get("/myservices/api/v1/openapi.json").json()["info"]["title"], "MyServices")

    def test_network_not_allowed(self):
        saved = server.ALLOW
        server.ALLOW = [ipaddress.ip_network("10.99.0.0/16")]
        try:
            self.assertEqual(self.c.get("/myservices/").status_code, 403)
        finally:
            server.ALLOW = saved


class Schedule(unittest.TestCase):
    def test_default_hours(self):
        self.assertEqual(server.TASKS["collect"]["minutes"], {10, 40})
        self.assertIsNone(server.TASKS["collect"]["hours"])
        self.assertEqual(server.TASKS["health"]["hours"], {0, 6, 12, 18})
        self.assertEqual(server.TASKS["backups"]["minutes"], {5})

    def test_next_run(self):
        from datetime import datetime
        at = lambda h, m, s=30: datetime(2026, 10, 11, h, m, s)  # noqa: E731
        with mock.patch.object(server, "enabled", lambda name: name != "watch"):
            self.assertEqual(datetime.fromtimestamp(server.next_run("collect", at(10, 12))), at(10, 40, 0))
            self.assertEqual(datetime.fromtimestamp(server.next_run("collect", at(10, 40))), at(11, 10, 0))  # le créneau en cours ne compte pas
            self.assertEqual(datetime.fromtimestamp(server.next_run("health", at(18, 30))), datetime(2026, 10, 12, 0, 0))
            self.assertIsNone(server.next_run("watch", at(10, 12)))  # tâche coupée


class Chain(unittest.TestCase):
    def test_enchaine_sante_puis_collecte_sans_doubler(self):
        real_sleep = time.sleep
        calls, busy = [], {"health": 2}  # la santé est déjà en cours pour 2 essais : on l'attend

        def fake_run(name, why):
            if busy.get(name):
                busy[name] -= 1
                return False
            calls.append(name)
            server.TASKS[name]["proc"] = object()
            threading.Timer(0.05, lambda: server.TASKS[name].update(proc=None)).start()
            return True
        with mock.patch.object(server, "run_task", fake_run), mock.patch.object(server.time, "sleep", lambda s: real_sleep(0.01)):
            server.run_chain(["health", "collect"], "test")
            for _ in range(200):
                if calls == ["health", "collect"] and server.TASKS["collect"]["proc"] is None:
                    break
                real_sleep(0.02)
        self.assertEqual(calls, ["health", "collect"])


if __name__ == "__main__":
    unittest.main()
