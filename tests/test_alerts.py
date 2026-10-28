"""Alertes (alerts.py, api.py) : canaux (secrets chiffrés, jamais renvoyés), règles, délai entre deux envois,
retours à la normale, reprise de config.json, essai, préréglages, droits.

  À lancer dans l'image (cryptography, FastAPI) : python3 -m unittest discover -s tests
"""
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    import cryptography  # noqa: F401
    from fastapi.testclient import TestClient

    from msv.alerts import alerts
    import api
    from msv.core import auth
    import server
except ImportError:
    alerts = None

PW = "un mot de passe long"


class Hook(BaseHTTPRequestHandler):
    """Faux Discord / webhook : garde chaque requête reçue ; /refuse répond 404."""
    got: list = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Hook.got.append({"path": self.path, "body": body, "auth": self.headers.get("Authorization")})
        self.send_response(404 if self.path == "/refuse" else 204)
        self.end_headers()

    def log_message(self, *a):
        pass


def ev(kind, key="svc", machine="Dev", detail="d", label="nas.lan"):
    return {"kind": kind, "key": key, "label": label, "machine": machine, "target": "192.168.1.5", "detail": detail}


@unittest.skipIf(alerts is None, "cryptography / FastAPI absents : tests à lancer dans l'image")
class Engine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Hook)
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        os.environ["MYSERVICES_SECRET_KEY"] = str(d / "secret.key")
        self.db = d / "myservices.db"
        self.a = alerts.Alerts(self.db)
        Hook.got = []

    def tearDown(self):
        os.environ.pop("MYSERVICES_SECRET_KEY", None)
        self.tmp.cleanup()

    def test_secret_sealed_and_masked(self):
        cid = self.a.add_channel("Hook", "webhook", {"url": self.url + "/x", "token": "jeton-secret"})
        raw = sqlite3.connect(self.db).execute("SELECT config FROM alert_channels").fetchone()[0]
        self.assertNotIn("jeton-secret", raw)
        self.assertNotIn("127.0.0.1", raw)  # l'URL d'un webhook est un secret aussi
        ch = self.a.channels()[0]
        self.assertEqual((ch["config"]["url"], ch["set"]), ("", {"url": True, "token": True}))
        self.a.update_channel(cid, name="Autre", conf={"url": "", "token": ""})  # vide = gardé
        self.assertEqual(self.a._channel(cid)["token"], "jeton-secret")
        with self.assertRaises(alerts.AlertError):
            self.a.add_channel("x", "webhook", {"url": "ftp://x"})
        with self.assertRaises(alerts.AlertError):
            self.a.add_channel("x", "telegram", {"token": "t"})  # chat_id manquant

    def test_rule_match_cooldown_resolved(self):
        cid = self.a.add_channel("Hook", "webhook", {"url": self.url + "/x", "token": "t"})
        self.a.add_rule({"kinds": ["panne"], "channels": [cid], "cooldown_min": 60, "machine": "dev"})
        self.assertTrue(self.a.active())
        out = self.a.dispatch([ev("panne"), ev("panne", machine="Autre"), ev("nouveau")], now=1000)
        self.assertEqual(len(out), 1)
        body = Hook.got[0]["body"]
        self.assertEqual((Hook.got[0]["auth"], len(body["events"]), body["events"][0]["state"]), ("Bearer t", 1, "firing"))
        self.a.dispatch([ev("panne")], now=1000 + 30 * 60)  # dans le délai : rien
        self.assertEqual(len(Hook.got), 1)
        self.a.dispatch([ev("retabli")], now=1000 + 31 * 60)  # retour à la normale : autre clé, envoyé
        self.assertEqual(Hook.got[1]["body"]["events"][0]["state"], "resolved")
        self.a.dispatch([ev("panne")], now=1000 + 61 * 60)  # délai passé : renvoyé
        self.assertEqual(len(Hook.got), 3)
        self.assertEqual([s["ok"] for s in self.a.sent()], [1, 1, 1])

    def test_disabled_rule_or_channel_and_failures(self):
        cid = self.a.add_channel("Discord", "discord", {"url": self.url + "/refuse"})
        rid = self.a.add_rule({"kinds": ["hors_ligne"], "channels": [cid], "resolved": False})
        self.assertEqual(self.a.dispatch([ev("en_ligne")]), [])  # retour non demandé
        out = self.a.dispatch([ev("hors_ligne")])
        self.assertIn("échec : HTTP 404", out[0])  # échec noté, pas d'exception
        self.assertIn("**MyServices", Hook.got[0]["body"]["content"])
        self.a.update_rule(rid, {"enabled": False})
        self.assertFalse(self.a.active())
        self.assertEqual(self.a.dispatch([ev("hors_ligne", key="autre")]), [])

    def test_legacy_import_once(self):
        cfg = {"discord_webhook": self.url + "/d", "health_webhook": self.url + "/h",
               "telegram_token": "123:abc", "telegram_chat_id": "42"}
        a = alerts.Alerts(self.db, cfg)
        names = [c["name"] for c in a.channels()]
        self.assertEqual(names, ["Discord", "Telegram", "Discord (santé)"])
        rules = {r["name"]: r for r in a.rules()}
        sante = rules["Santé (repris de config.json)"]
        self.assertEqual(set(sante["kinds"]), {"health_crit", "health_warn", "health_down"})
        self.assertNotIn("health_crit", rules["Comme avant (repris de config.json)"]["kinds"])
        alerts.Alerts(self.db, cfg)  # deuxième démarrage : rien en double
        self.assertEqual(len(alerts.Alerts(self.db).channels()), 3)

    def test_presets_added_disabled(self):
        self.a.add_channel("Hook", "webhook", {"url": self.url + "/x"})
        self.assertEqual(self.a.add_presets(["Pannes de services", "inconnu"]), 1)
        self.assertEqual(self.a.add_presets(["Pannes de services"]), 0)  # déjà là
        self.assertFalse(self.a.rules()[0]["enabled"])
        self.assertFalse(self.a.active())

    def test_api_admin_only_and_test_button(self):
        d = Path(self.tmp.name)
        server.STATIC = server.WEB = d
        server._ALERTS = alerts.Alerts(self.db)
        api.AUTH = True
        api.STORE = auth.Store(d / "users.db")
        api.STORE.create_user("admin", PW, "admin")
        api.STORE.create_user("lecteur", PW, "viewer")
        c = TestClient(api.app, client=("192.168.1.40", 50000))
        c.post("/myservices/api/v1/login", json={"username": "lecteur", "password": PW})
        self.assertEqual(c.get("/myservices/api/v1/alerts").status_code, 403)
        c = TestClient(api.app, client=("192.168.1.41", 50000))
        c.post("/myservices/api/v1/login", json={"username": "admin", "password": PW})
        h = {"X-CSRF-Token": c.cookies["ms_csrf"]}
        r = c.post("/myservices/api/v1/alerts/channels", json={"name": "Hook", "type": "webhook",
                                                                "config": {"url": self.url + "/x"}}, headers=h)
        cid = r.json()["id"]
        self.assertEqual(c.post(f"/myservices/api/v1/alerts/channels/{cid}/test", headers=h).status_code, 200)
        self.assertTrue(Hook.got[-1]["body"]["test"])
        r = c.post("/myservices/api/v1/alerts/rules", json={"kinds": [], "channels": [cid]}, headers=h)
        self.assertEqual(r.status_code, 400)  # aucun genre choisi
        self.assertEqual(c.post("/myservices/api/v1/alerts/rules", json={"kinds": ["panne"], "channels": [cid]}, headers=h).status_code, 200)
        st = c.get("/myservices/api/v1/alerts").json()
        self.assertTrue(st["active"])
        self.assertEqual(st["channels"][0]["config"]["url"], "")  # jamais renvoyée
        self.assertIn("essai d'alerte", [x["action"] for x in api.STORE.audit_log()])
        server._ALERTS = None


if __name__ == "__main__":
    unittest.main()
