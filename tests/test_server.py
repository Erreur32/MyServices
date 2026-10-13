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
        (web / "v2").mkdir(exist_ok=True)
        (web / "v2" / "index.html").write_text("<p>page</p>")        # the compiled front, served at the root
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
        r = self.c.get("/myservices/", follow_redirects=False)  # the old address leads to the root, where the front now lives
        self.assertEqual((r.status_code, r.headers["location"]), (302, "/"))
        (server.STATIC / "v2" / "index.html").write_text("<p>page</p>")   # other tests write their own front: set ours here
        r = self.c.get("/myservices/index.html")                          # the old address redirects to /index.html, the front
        self.assertEqual((r.status_code, r.text), (200, "<p>page</p>"))
        self.assertEqual(r.headers["x-content-type-options"], "nosniff")
        self.assertNotIn("server", {k.lower() for k in r.headers})
        self.assertEqual(self.c.get("/index.html").status_code, 200)

    def test_etag_304_si_inchange(self):
        r = self.c.get("/myservices/data.json")
        tag = r.headers["etag"]
        r2 = self.c.get("/myservices/data.json", headers={"If-None-Match": tag})
        self.assertEqual((r2.status_code, r2.content, r2.headers["etag"]), (304, b"", tag))
        self.assertEqual(self.c.get("/myservices/data.json", headers={"If-None-Match": '"autre"'}).status_code, 200)

    def test_creating_a_diagram_starts_a_build_and_reports_it(self):
        """Regression: PUT /diagrams/{id} answered HTTP 500 because `threading` was not imported in api.py."""
        built = threading.Event()
        data = {"generated": "2026-10-11T10:00:00+00:00", "services_status": [],
                "hosts": [{"type": "proxy", "npm": "n", "domains": ["a.lan"], "machine": "m", "ip": "10.0.0.2", "port": 80, "enabled": True}], "machine_list": []}
        f = server.WEB / "data.json"
        before = f.read_text()
        f.write_text(json.dumps(data))
        self.addCleanup(f.write_text, before)            # data.json is shared with the other tests of this class
        asked = []
        user = mock.Mock(state=mock.Mock(user={"username": "admin"}))
        with mock.patch.object(api.core, "ARCHIFY", __file__), mock.patch.object(api.core, "build_map", built.set), \
                mock.patch.object(api, "admin_write", lambda request: None), mock.patch.object(api, "store", lambda: mock.Mock()), \
                mock.patch.object(api, "ip_of", lambda request: "127.0.0.1"), \
                mock.patch("system.set_diagram_extra", lambda core, key, on: asked.append((key, on))):
            r = api.diagram_set("domaines", api.DiagramAsk(enabled=True), user)
            self.assertEqual(r, {"ok": True})
            self.assertTrue(built.wait(5), "the build was not started")
            self.assertEqual(asked, [("domaines", True)])
            self.assertEqual(api.diagram_set("inconnu", api.DiagramAsk(enabled=True), user).status_code, 404)
            listing = api.diagrams(user)
        self.assertEqual(set(listing["build"]), {"running", "started", "last_seconds", "next_run"})
        self.assertTrue(any(d["id"] == "domaines" and d["optional"] and d["available"] for d in listing["diagrams"]))

    def test_front_is_served_at_the_root_and_old_addresses_still_work(self):
        (server.STATIC / "v2").mkdir(exist_ok=True)
        (server.STATIC / "v2" / "index.html").write_text("<div id=root>")
        (server.STATIC / "v2" / "assets").mkdir(exist_ok=True)
        (server.STATIC / "v2" / "assets" / "app.js").write_text("console.log(1)")
        self.assertEqual(self.c.get("/").text, "<div id=root>")                              # the front, at the root
        self.assertEqual(self.c.get("/assets/app.js").status_code, 200)                      # its assets
        self.assertEqual(self.c.get("/data.json").status_code, 200)                          # produced files
        self.assertEqual(self.c.get("/api/v1/status").status_code, 200)                      # API at the root
        self.assertEqual(self.c.get("/api/v1/inconnue").json()["error"], "introuvable")      # JSON 404 for an unknown API route
        for old, new in (("/myservices/v2/", "/"), ("/myservices/", "/"), ("/myservices/v2/assets/app.js", "/assets/app.js"),
                         ("/myservices/data.json?x=1", "/data.json?x=1"), ("/myservices/login.html", "/login.html")):
            r = self.c.get(old, follow_redirects=False)
            self.assertEqual((r.status_code, r.headers["location"]), (302, new), old)       # pages and files: redirected to the root
        self.assertEqual(self.c.get("/myservices/api/v1/status").status_code, 200)           # API: answered in place (agents, tokens, scripts)
        self.assertEqual(self.c.post("/myservices/api/v1/refresh", headers={"Origin": "http://testserver"}).status_code, self.c.post("/api/v1/refresh").status_code)

    def test_old_prefix_redirect_never_leaves_the_site(self):
        """/myservices//evil.com or /myservices/\\evil.com must not become a redirect to another host."""
        for bad in ("/myservices//evil.com", "/myservices///evil.com/x", "/myservices/\\evil.com", "/myservices/v2//evil.com"):
            r = self.c.get(bad, follow_redirects=False)
            loc = r.headers.get("location", "")
            self.assertTrue(r.status_code in (302, 404), bad)
            self.assertFalse(loc.startswith("//") or "\\" in loc or "://" in loc, f"{bad} -> {loc}")
            self.assertTrue(loc == "" or loc.startswith("/"), f"{bad} -> {loc}")

    def test_csp(self):
        page = self.c.get("/myservices/index.html").headers["content-security-policy"]
        self.assertIn("default-src 'self'", page)
        self.assertIn("object-src 'none'", page)
        (server.STATIC / "login.html").write_text("<form>")
        login = self.c.get("/myservices/login.html").headers["content-security-policy"]
        self.assertNotIn("unsafe-inline", login)  # page de connexion : politique stricte
        (server.STATIC / "v2").mkdir(exist_ok=True)
        (server.STATIC / "v2" / "index.html").write_text("<div id=root>")
        root = self.c.get("/").headers["content-security-policy"]
        self.assertNotIn("unsafe-inline", root)  # the compiled front at the root: strict policy
        self.assertNotIn("content-security-policy", self.c.get("/myservices/api/v1/status").headers)  # JSON : inutile

    def test_folder_without_slash_and_unknown_page(self):
        (server.STATIC / "v2").mkdir(exist_ok=True)
        (server.STATIC / "v2" / "index.html").write_text("<div id=root>")
        r = self.c.get("/v2", follow_redirects=False)           # the front used to live under /v2/: it is the root now
        self.assertEqual((r.status_code, r.headers["location"]), (302, "/"))
        r = self.c.get("/v2login.html")
        self.assertEqual(r.status_code, 404)
        self.assertIn('href="/"', r.text)  # readable page with a link back, not JSON

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


class UpdateCheck(unittest.TestCase):
    """The scheduler asks for the latest version only when the automatic check is on (about.latest keeps the answer 6 h)"""
    def test_runs_only_when_on(self):
        with mock.patch.object(server.threading, "Thread") as thread, mock.patch.dict(server.CFG, {"update_check": False}):
            server.update_check()
            thread.assert_not_called()
        with mock.patch.object(server.threading, "Thread") as thread, mock.patch.dict(server.CFG, {"update_check": True}):
            server.update_check()
            thread.return_value.start.assert_called_once()


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class UpdateSettingsRoute(unittest.TestCase):
    def test_settings_and_header_notice(self):
        req = mock.Mock()
        req.state.user = {"username": "admin", "role": "admin"}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(api, "admin_write", return_value=None), mock.patch.object(api, "store"), \
                mock.patch.object(api, "ip_of", return_value="10.0.0.9"), mock.patch("system.set_update_settings", return_value={"auto": True, "header": False}) as setter, \
                mock.patch.dict(api.core.CFG, {"state_dir": tmp, "update_header": True}), mock.patch.dict(api.os.environ, {"MYSERVICES_VERSION": "v0.11.9"}):
            self.assertEqual(api.about_settings(api.UpdateSettings(header=False), req), {"auto": True, "header": False})
            setter.assert_called_once_with(api.core, auto=None, header=False)
            (Path(tmp) / "update-check.json").write_text(json.dumps({"release": {"tag": "v99.0.0", "url": "u"}}))
            self.assertEqual(api.me(req)["update"], {"available": True, "tag": "v99.0.0", "url": "u"})
            with mock.patch.dict(api.core.CFG, {"update_header": False}):
                self.assertIsNone(api.me(req)["update"])   # notice off: nothing for the header


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


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class RemoveMachine(unittest.TestCase):
    def test_retiree_puis_ignoree_par_la_recherche(self):
        """A machine removed by hand goes to the ignored list: the auto mode never adds it back."""
        seen = []
        m = mock.Mock()
        m._meta.return_value = {"machines": {"10.0.0.9": {"name": "nas"}}}
        user = mock.Mock(state=mock.Mock(user={"username": "admin"}))
        with mock.patch.object(api, "admin_write", lambda request: None), mock.patch.object(api, "store", lambda: mock.Mock()), \
                mock.patch.object(api, "ip_of", lambda request: "127.0.0.1"), mock.patch.dict(sys.modules, {"machines_admin": m}), \
                mock.patch("system.set_netscan_ignored", lambda core, ip, name, on: seen.append((ip, name, on))):
            self.assertEqual(api.machines_delete("10.0.0.9", user), {"ok": True, "ignored": True})
        m.delete.assert_called_once_with("10.0.0.9")
        self.assertEqual(seen, [("10.0.0.9", "nas", True)])


class EcdsaKey(unittest.TestCase):
    """with_ecdsa: the app's aliases also offer the ECDSA key (VMware ESXi refuses ed25519), once, others untouched."""

    def test_ajout_une_fois(self):
        conf = ("Host m-1\n    HostName 10.0.0.1\n    IdentityFile ~/.ssh/myservices\n    IdentitiesOnly yes\n"
                "Host perso\n    IdentityFile ~/.ssh/id_ed25519_perso\n")
        got = server.with_ecdsa(conf)
        self.assertIn("    IdentityFile ~/.ssh/myservices\n    IdentityFile ~/.ssh/myservices_ecdsa\n    IdentitiesOnly yes", got)
        self.assertIn("IdentityFile ~/.ssh/id_ed25519_perso\n", got)
        self.assertEqual(server.with_ecdsa(got), got)
        self.assertEqual(got.count("myservices_ecdsa"), 1)


if __name__ == "__main__":
    unittest.main()
