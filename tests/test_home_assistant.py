"""connectors/home_assistant.py : Home Assistant par son API REST, contre un faux serveur (jamais le vrai).

  python3 -m unittest discover -s tests
"""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import connectors  # noqa: E402
from connectors.base import Context, run_isolated  # noqa: E402

TOKEN = "jeton-de-test"
CONFIG = {"version": "2026.10.1", "location_name": "Maison", "state": "RUNNING"}
STATES = [
    {"entity_id": "light.salon", "state": "on", "attributes": {}},
    {"entity_id": "update.home_assistant_core_update", "state": "on",
     "attributes": {"friendly_name": "Core", "installed_version": "2026.10.1", "latest_version": "2026.10.2"}},
    {"entity_id": "update.hacs", "state": "off", "attributes": {"friendly_name": "HACS"}},
    {"entity_id": "update.esphome", "state": "on", "attributes": {"friendly_name": "ESPHome", "installed_version": "1", "latest_version": "2"}},
    {"entity_id": "update.studio_code_server_update", "state": "on",
     "attributes": {"friendly_name": "Studio Code Server", "entity_picture": "/api/hassio/addons/a0d7b954_vscode/icon"}},
    {"entity_id": "update.deb13tower_update", "state": "on", "attributes": {"friendly_name": "Deb13tower Update", "installed_version": "1.43.3", "latest_version": "1.43.4"}},
]


class FakeHA(BaseHTTPRequestHandler):
    seen = []  # (méthode, chemin) de chaque requête : le connecteur ne doit faire que des GET

    def log_message(self, *a):
        pass

    def do_GET(self):
        FakeHA.seen.append(("GET", self.path))
        if self.headers.get("Authorization") != "Bearer " + TOKEN:
            return self.reply(401, {"message": "401: Unauthorized"})
        if self.path == "/api/config":
            return self.reply(200, CONFIG)
        if self.path == "/api/states":
            return self.reply(200, STATES)
        if self.path == "/broken/api/config":
            return self.reply(200, "pas du json", raw=True)
        self.reply(404, {})

    def do_POST(self):
        FakeHA.seen.append(("POST", self.path))
        self.reply(405, {})

    do_PUT = do_DELETE = do_POST

    def reply(self, code, body, raw=False):
        data = body.encode() if raw else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class HomeAssistantTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeHA)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def conn(self, **kw):
        conf = {"type": "home-assistant", "name": "maison", "url": self.url, "token": TOKEN, **kw}
        return connectors.instances({"connectors": [conf]}, kind="status")[0]

    def test_registre_et_images(self):
        self.assertIn("home-assistant", connectors.TYPES)
        self.assertEqual([c.type for c in connectors.for_image("ghcr.io/home-assistant/home-assistant:stable")], ["home-assistant"])
        self.assertTrue(connectors.TYPES["home-assistant"].guide)

    def test_lecture(self):
        data, st = run_isolated(self.conn(), {}, 10)
        self.assertTrue(st.ok)
        self.assertEqual((st.version, st.version_tested), ("2026.10.1", True))
        self.assertEqual((data["name"], data["state"], data["entities"]), ("Maison", "RUNNING", 6))
        self.assertEqual([u["name"] for u in data["updates"]], ["Core", "Deb13tower Update", "ESPHome", "Studio Code Server"])  # « off » exclue, triées
        self.assertEqual(data["updates"][0], {"name": "Core", "installed": "2026.10.1", "latest": "2026.10.2", "group": "core"})
        self.assertEqual({u["name"]: u["group"] for u in data["updates"]},
                         {"Core": "core", "Deb13tower Update": "other", "ESPHome": "other", "Studio Code Server": "addon"})

    def test_message_du_test(self):
        r = self.conn().test()
        self.assertTrue(r.ok)
        self.assertEqual(r.version, "2026.10.1")
        self.assertIn("Maison", r.message)
        self.assertIn("6 entités", r.message)
        self.assertIn("Home Assistant : 1 mise(s) à jour", r.message)
        self.assertIn("3 autre(s)", r.message)

    def test_jeton_refuse(self):
        r = self.conn(token="mauvais").test()
        self.assertFalse(r.ok)
        self.assertIn("jeton refusé (401)", r.message)
        self.assertNotIn("mauvais", r.message)

    def test_lecture_seule(self):
        FakeHA.seen.clear()
        self.conn().test()
        self.conn(token="mauvais").test()
        self.assertTrue(FakeHA.seen)
        self.assertEqual({m for m, _ in FakeHA.seen}, {"GET"})
        self.assertTrue({p for _, p in FakeHA.seen} <= {"/api/config", "/api/states"})

    def test_pas_home_assistant(self):
        r = self.conn(url=self.url + "/broken").test()
        self.assertFalse(r.ok)
        self.assertIn("ne mène pas à Home Assistant", r.message)

    def test_adresse_sans_schema_ou_port_ferme(self):
        self.assertIn("http://<IP>:8123", self.conn(url="127.0.0.1:8123").test().message)
        closed = ThreadingHTTPServer(("127.0.0.1", 0), FakeHA)
        port = closed.server_port
        closed.server_close()
        self.assertIn("connexion refusée", self.conn(url=f"http://127.0.0.1:{port}").test().message)

    def test_jeton_jamais_montre(self):
        cls = connectors.TYPES["home-assistant"]
        self.assertEqual(cls.public({"url": self.url, "token": TOKEN})["token"], "configuré")
        self.assertEqual(cls.public({"url": self.url, "token": ""})["token"], "")

    def test_reglages_proposes(self):
        d = connectors.TYPES["home-assistant"].discover("homeassistant/home-assistant", "10.0.0.8", [(8123, 8123)])
        self.assertEqual(d, {"url": "http://10.0.0.8:8123"})
        self.assertEqual(connectors.TYPES["home-assistant"].validate({"url": "http://x"}), ["« token » requis"])


if __name__ == "__main__":
    unittest.main()
