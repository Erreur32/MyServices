"""connectors/home_assistant.py : Home Assistant par son API REST, contre un faux serveur (jamais le vrai).

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import threading
import unittest
from unittest import mock
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


ICON = b"\x89PNG\r\n\x1a\n-icon-"


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
        if self.path == "/api/hassio/addons/a0d7b954_vscode/icon":
            return self.reply(200, ICON, raw=True)
        if self.path == "/broken/api/config":
            return self.reply(200, "pas du json", raw=True)
        self.reply(404, {})

    def do_POST(self):
        FakeHA.seen.append(("POST", self.path))
        self.reply(405, {})

    do_PUT = do_DELETE = do_POST

    def reply(self, code, body, raw=False):
        data = body if isinstance(body, bytes) else body.encode() if raw else json.dumps(body).encode()
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
        self.assertEqual((data["automations"], data["unavailable_names"]), ({"on": 0, "total": 0}, []))
        self.assertEqual([u["name"] for u in data["updates"]], ["Core", "Deb13tower Update", "ESPHome", "Studio Code Server"])  # « off » exclue, triées
        self.assertEqual(data["updates"][0], {"name": "Core", "installed": "2026.10.1", "latest": "2026.10.2", "group": "core"})
        self.assertEqual({u["name"]: u["group"] for u in data["updates"]},
                         {"Core": "core", "Deb13tower Update": "other", "ESPHome": "other", "Studio Code Server": "addon"})

    def test_automatisations_et_indisponibles(self):
        extra = [{"entity_id": "automation.a", "state": "on", "attributes": {}}, {"entity_id": "automation.b", "state": "off", "attributes": {}},
                 {"entity_id": "sensor.cave", "state": "unavailable", "attributes": {"friendly_name": "Cave"}},
                 {"entity_id": "update.vieux", "state": "unavailable", "attributes": {}}]
        STATES.extend(extra)
        self.addCleanup(lambda: [STATES.remove(x) for x in extra])
        data, _ = run_isolated(self.conn(), {}, 10)
        self.assertEqual((data["automations"], data["unavailable"], data["unavailable_names"]), ({"on": 1, "total": 2}, 2, ["Cave"]))   # an update entity is not a lost device

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



class AddonIcons(unittest.TestCase):
    """Add-on icons: read with the token by the connector, served by the API from a cache"""
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeHA)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.ha = connectors.TYPES["home-assistant"]({"type": "home-assistant", "name": "maison", "url": f"http://127.0.0.1:{cls.srv.server_port}", "token": TOKEN},
                                                     Context(timeout=5))

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_connector_reads_the_icon(self):
        self.assertEqual(self.ha.addon_icon("a0d7b954_vscode"), ICON)
        with self.assertRaises(connectors.ConnectorError):
            self.ha.addon_icon("../config")        # never a path
        with self.assertRaises(connectors.ConnectorError):
            self.ha.addon_icon("core_unknown")     # 404 from Home Assistant

    def test_api_route_caches_and_refuses(self):
        try:
            import api
        except ImportError:
            self.skipTest("FastAPI absent : tests à lancer dans l'image")
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(api.core.CFG, {"cache_dir": tmp}), \
                mock.patch("connectors.instances", return_value=[self.ha]):
            r = api.ha_addon_icon("maison", "a0d7b954_vscode")
            self.assertEqual((r.status_code, r.body, r.media_type), (200, ICON, "image/png"))
            self.assertTrue((Path(tmp) / "ha-icons" / "a0d7b954_vscode.png").is_file())
            with mock.patch("connectors.instances", side_effect=AssertionError("cache not used")):
                self.assertEqual(api.ha_addon_icon("maison", "a0d7b954_vscode").body, ICON)
            self.assertEqual(api.ha_addon_icon("maison", "../x").status_code, 404)
            self.assertEqual(api.ha_addon_icon("other", "core_x").status_code, 404)
            self.assertEqual(api.ha_addon_icon("maison", "core_unknown").status_code, 404)


class Addons(unittest.TestCase):
    def test_addons_from_update_entities(self):
        from connectors.home_assistant import addons
        states = [{"entity_id": "update.mosquitto_broker_update", "state": "off",
                   "attributes": {"title": "Mosquitto broker", "installed_version": "7.1.1", "entity_picture": "/api/hassio/addons/core_mosquitto/icon"}},
                  {"entity_id": "update.zigbee2mqtt_update", "state": "on",
                   "attributes": {"friendly_name": "Zigbee2MQTT Update", "installed_version": "2.1", "latest_version": "2.2", "entity_picture": "/api/hassio/addons/45df7312_zigbee2mqtt/icon"}},
                  {"entity_id": "update.home_assistant_core_update", "state": "off", "attributes": {"entity_picture": "https://brands/x.png"}},
                  {"entity_id": "sensor.x", "state": "1", "attributes": {"entity_picture": "/api/hassio/addons/nope/icon"}}]
        self.assertEqual(addons(states), [
            {"name": "Mosquitto broker", "slug": "core_mosquitto", "version": "7.1.1"},
            {"name": "Zigbee2MQTT", "slug": "45df7312_zigbee2mqtt", "version": "2.1", "latest": "2.2"}])

if __name__ == "__main__":
    unittest.main()
