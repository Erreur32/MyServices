"""Routes de lecture typées de l'API v1 (api.py, models.py) : machines, services, santé, sauvegardes.

Forme de réponse, filtres, fichier absent, élément hors modèle ignoré (et compté), accès par jeton « read », refus sans jeton.

  À lancer dans l'image (FastAPI) : python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from fastapi.testclient import TestClient

    import api
    import auth
    import server
    import tokens
except ImportError:
    api = None

PW = "un mot de passe long"
BASE = "/myservices/api/v1"
DATA = {"generated": "2026-10-10 10:00",
        "machine_list": [{"ip": "10.0.0.2", "name": "nas", "ping": True, "role": "stockage"},
                         {"ip": "10.0.0.3", "name": "pc", "ping": False, "off": True},
                         {"name": "sans-ip"}],  # invalide : ip manquante
        "hosts": [{"type": "proxy", "enabled": True, "domains": ["a.example.org"], "machine": "nas", "ip": "10.0.0.2", "port": 80},
                  {"type": "local", "enabled": True, "machine": "pc", "ip": "10.0.0.3"},
                  {"type": "inconnu", "enabled": True}]}  # invalide : type hors liste
STATS = {"timestamp": "2026-10-10 10:05", "overall_level": "warn",
         "hosts": [{"id": "nas", "name": "nas · 10.0.0.2", "reachable": True, "level": "warn", "source": "ssh",
                    "disks": [{"mount": "/", "used_pct": 91.5, "warning": True}]},
                   {"id": "x", "name": "x", "reachable": True, "level": "bizarre"}]}
SAVES = {"generated": "2026-10-10 10:10",
         "sets": [{"id": "s1", "label": "Photos", "origin": "nas", "schedule": "quotidien", "level": "ok",
                   "locations": [{"host": "nas", "label": "disque 2", "level": "ok", "age": 3.5}]},
                  {"label": "sans id"}]}


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class ApiModels(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = d = Path(self.tmp.name)
        server.STATIC = server.WEB = d
        api.AUTH = True
        api.STORE = auth.Store(d / "myservices.db")
        api.TOKENS = tokens.Tokens(d / "myservices.db")
        api.STORE.create_user("admin", PW, "admin")
        self.c = TestClient(api.app, client=("192.168.1.50", 50000))
        self.c.post(BASE + "/login", json={"username": "admin", "password": PW})
        self.h = {"X-CSRF-Token": self.c.cookies["ms_csrf"]}
        self.anon = TestClient(api.app, client=("192.168.1.51", 50000))

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, rel, content):
        f = self.d / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(content), encoding="utf-8")

    def full(self):
        self.put("data.json", DATA)
        self.put("health/stats.json", STATS)
        self.put("backups.json", SAVES)

    def test_machines(self):
        self.full()
        j = self.c.get(BASE + "/machines").json()
        self.assertEqual([m["name"] for m in j["machines"]], ["nas", "pc"])
        self.assertEqual((j["skipped"], j["generated"]), (1, "2026-10-10 10:00"))
        self.assertTrue(j["machines"][1]["off"])

    def test_services_and_filters(self):
        self.full()
        j = self.c.get(BASE + "/services").json()
        self.assertEqual((len(j["services"]), j["skipped"]), (2, 1))
        self.assertEqual([s["machine"] for s in self.c.get(BASE + "/services?machine=NAS").json()["services"]], ["nas"])
        self.assertEqual([s["machine"] for s in self.c.get(BASE + "/services?machine=10.0.0.3").json()["services"]], ["pc"])
        self.assertEqual([s["type"] for s in self.c.get(BASE + "/services?type=local").json()["services"]], ["local"])
        self.assertEqual(self.c.get(BASE + "/services?type=nimporte").status_code, 422)

    def test_health(self):
        self.full()
        j = self.c.get(BASE + "/health").json()
        self.assertEqual((j["overall"], j["skipped"], len(j["hosts"])), ("warn", 1, 1))
        self.assertEqual(j["hosts"][0]["disks"][0]["used_pct"], 91.5)

    def test_backups(self):
        self.full()
        j = self.c.get(BASE + "/backups").json()
        self.assertEqual(([s["id"] for s in j["sets"]], j["skipped"]), (["s1"], 1))
        self.assertEqual(j["sets"][0]["locations"][0]["label"], "disque 2")

    def test_missing_files(self):
        for path in ("machines", "services", "health"):
            r = self.c.get(f"{BASE}/{path}")
            self.assertEqual(r.status_code, 200, path)
            self.assertEqual(r.json()["skipped"], 0)
        self.assertEqual(self.c.get(BASE + "/machines").json()["machines"], [])
        self.assertIsNone(self.c.get(BASE + "/health").json()["overall"])
        self.assertEqual(self.c.get(BASE + "/backups").status_code, 404)
        (self.d / "data.json").write_text("{pas du json", encoding="utf-8")  # fichier cassé : pas de 500
        self.assertEqual(self.c.get(BASE + "/machines").json()["machines"], [])

    def test_openapi(self):
        paths = self.c.get(BASE + "/openapi.json").json()["paths"]
        for p in ("machines", "services", "health", "backups"):
            self.assertIn(f"{BASE}/{p}", paths)

    def test_read_token(self):
        self.full()
        r = self.c.post(BASE + "/tokens", json={"kind": "api", "name": "lecteur", "level": "read"}, headers=self.h)
        tok = r.json()["token"]
        for p in ("machines", "services", "health", "backups"):
            r = self.anon.get(f"{BASE}/{p}", headers={"Authorization": f"Bearer {tok}"})
            self.assertEqual(r.status_code, 200, p)
        self.assertEqual(tokens.api_route_level("GET", "machines"), "read")
        self.assertEqual(tokens.api_route_level("GET", "machines/settings"), "admin")  # inchangé

    def test_no_token(self):
        self.full()
        for p in ("machines", "services", "health", "backups"):
            self.assertEqual(self.anon.get(f"{BASE}/{p}").status_code, 401, p)


class Validation(unittest.TestCase):
    def test_erreur_422_ne_renvoie_pas_la_valeur_envoyee(self):
        import tempfile
        import auth
        import api
        import server
        from fastapi.testclient import TestClient
        with tempfile.TemporaryDirectory() as d:
            server.STATIC = server.WEB = Path(d)
            api.AUTH = True
            api.STORE = auth.Store(Path(d) / "myservices.db")
            api.STORE.create_user("admin", "un mot de passe long", "admin")
            c = TestClient(api.app, client=("192.168.1.50", 50000))
            c.post("/myservices/api/v1/login", json={"username": "admin", "password": "un mot de passe long"})
            r = c.post("/myservices/api/v1/backups/veeam/test", json={"password": "SECRET-A-NE-PAS-RENVOYER"}, headers={"X-CSRF-Token": c.cookies["ms_csrf"]})
        self.assertEqual(r.status_code, 422)
        self.assertNotIn("SECRET-A-NE-PAS-RENVOYER", r.text)
        self.assertIn("url", r.text)  # le champ manquant est dit


if __name__ == "__main__":
    unittest.main()
