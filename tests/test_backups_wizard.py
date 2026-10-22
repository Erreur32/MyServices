"""Assistants Veeam et Home Assistant de Réglages → Sauvegardes (backups_admin.py), contre de faux serveurs HTTP locaux.

Ni vrai Veeam ni vrai Home Assistant : les réponses viennent de tests/fixtures/veeam et tests/fixtures/ha.
  python3 -m unittest discover -s tests
"""
import json
import os
import sys
import tempfile
import threading
import unittest
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import backups_admin as ba  # noqa: E402

VEEAM = json.loads((ROOT / "tests/fixtures/veeam/states.json").read_text())
HA_STATES = json.loads((ROOT / "tests/fixtures/ha/states.json").read_text())
SECRET = "mdp-de-test"
TOKEN = "jeton-de-test"


class FakeServer(BaseHTTPRequestHandler):
    """Veeam (POST /api/oauth2/token, GET /api/v1/...) et Home Assistant (GET /api/states, /api/config) sur le même port."""
    seen: list = []  # (méthode, chemin) : seuls le jeton d'accès (POST) et des GET doivent passer

    def log_message(self, *a):
        pass

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        FakeServer.seen.append(("POST", self.path))
        form = self.rfile.read(int(self.headers["Content-Length"])).decode()
        if self.path == "/api/oauth2/token" and "username=viewer" in form and f"password={SECRET}" in form:
            return self.reply(200, {"access_token": "t"})
        self.reply(400, {"error": "invalid_grant"})  # Veeam répond 400 à un mauvais compte

    def do_GET(self):
        FakeServer.seen.append(("GET", self.path))
        if self.path.startswith("/api/v1/"):
            if self.headers.get("Authorization") != "Bearer t":
                return self.reply(401, {})
            return self.reply(200, VEEAM["jobs"] if self.path.endswith("jobs/states") else VEEAM["sessions"] if "/sessions" in self.path else VEEAM["repos"])
        if self.headers.get("Authorization") != "Bearer " + TOKEN:
            return self.reply(401, {})
        self.reply(200, HA_STATES if self.path == "/api/states" else {"version": "2026.10.1"})


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeServer)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = Path(self.tmp.name)
        self.meta, self.config = d / "backups-meta.json", d / "config.json"
        self.config.write_text("{}", encoding="utf-8")
        for p in (mock.patch.dict("config.CFG", {"backups_meta": str(self.meta), "backups_url": ""}),
                  mock.patch.dict(os.environ, {"MYSERVICES_CONFIG": str(self.config)}),
                  mock.patch.object(ba.setup, "META", d / "services-meta.json"),
                  mock.patch.object(ba.setup, "EXAMPLE_BACKUPS", d / "example.json")):
            p.start()
            self.addCleanup(p.stop)
        FakeServer.seen = []

    def acct(self, **kw):
        return {"url": self.url, "user": "viewer", "password": SECRET, **kw}

    def saved(self):
        return json.loads(self.config.read_text(encoding="utf-8"))

    def meta_json(self):
        return json.loads(self.meta.read_text(encoding="utf-8"))


class VeeamAssistant(Base):
    def test_essai_sans_rien_enregistrer(self):
        r = ba.veeam_test(self.acct())
        self.assertTrue(r["ok"], r)
        self.assertIn("3 job(s), 2 dépôt(s)", r["message"])
        self.assertEqual(self.config.read_text(encoding="utf-8"), "{}")  # ni config.json ni backups-meta.json touchés
        self.assertFalse(self.meta.exists())
        self.assertEqual({m for m, _ in FakeServer.seen}, {"POST", "GET"})
        self.assertNotIn(("POST", "/api/v1/jobs/states"), FakeServer.seen)  # le seul POST est le jeton d'accès

    def test_refus_lisibles_sans_le_mot_de_passe(self):
        bad = ba.veeam_test(self.acct(password="faux"))
        self.assertFalse(bad["ok"])
        self.assertIn("identifiants refusés", bad["message"])
        self.assertNotIn("faux", json.dumps(bad))
        down = ba.veeam_test({**self.acct(), "url": "http://127.0.0.1:9"})
        self.assertFalse(down["ok"])
        self.assertNotIn(SECRET, json.dumps(down))
        for bad_form in ({**self.acct(), "url": "ftp://x"}, self.acct(user=""), self.acct(password="")):
            with self.assertRaises(ba.BackupError, msg=str(bad_form)):
                ba.veeam_test(bad_form)

    def test_decouverte_jobs_et_depots(self):
        out = ba.veeam_discover(self.acct())
        names = {j["name"]: j for j in out["jobs"]}
        self.assertEqual(sorted(names), ["Ancien job", "PC-Jeu image", "Serveur fichiers"])
        self.assertTrue(names["Ancien job"]["disabled"])
        self.assertEqual(names["Serveur fichiers"]["last_result"], "Warning")
        self.assertEqual([r["name"] for r in out["repos"]], ["NAS", "Local"])
        self.assertNotIn(SECRET, json.dumps(out))
        with self.assertRaises(ba.BackupError):
            ba.veeam_discover(self.acct(password="faux"))

    def test_suivi_ecrit_le_compte_chiffre_et_les_jeux(self):
        jobs = [{"name": "PC-Jeu image", "label": "PC de jeu", "max_age_days": 2}, {"name": "Serveur fichiers"}]
        self.assertEqual(ba.veeam_follow(self.acct(), jobs), {"added": 2, "updated": 0})
        conn = self.saved()["connectors"][0]
        self.assertEqual((conn["type"], conn["name"], conn["user"]), ("veeam", "veeam", "viewer"))
        self.assertTrue(conn["password"].startswith("enc:v1:"))  # chiffré au repos
        self.assertNotIn(SECRET, self.config.read_text(encoding="utf-8"))
        self.assertNotIn(SECRET, self.meta.read_text(encoding="utf-8"))
        meta = self.meta_json()
        host = next(h for h in meta["hosts"] if h["id"] == "veeam")
        self.assertEqual((host["api"], host["connector"], host.get("secrets")), ("veeam", "veeam", None))
        s = meta["sets"][0]
        self.assertEqual((s["label"], s["origin"], s["locations"][0]["veeam_job"]), ("PC de jeu", "veeam-sources", "PC-Jeu image"))
        self.assertEqual(meta["sets"][1]["label"], "Veeam : Serveur fichiers")
        # relance : sans mot de passe, celui déjà enregistré sert ; pas de doublon, nom mis à jour
        self.assertEqual(ba.veeam_follow(self.acct(password=""), [{"name": "PC-Jeu image", "label": "Autre nom", "max_age_days": 5}]),
                         {"added": 0, "updated": 1})
        self.assertEqual([s["label"] for s in self.meta_json()["sets"]][0], "Autre nom")
        self.assertEqual(len(self.saved()["connectors"]), 1)
        cur = ba.current()
        self.assertEqual(cur["veeam"], {"configured": True, "url": self.url, "user": "viewer", "password_set": True})
        self.assertNotIn("enc:v1", json.dumps(cur))
        found = {j["name"]: j["followed"] for j in ba.veeam_discover(self.acct(password=""))["jobs"]}  # compte enregistré réutilisé
        self.assertEqual(found, {"PC-Jeu image": True, "Serveur fichiers": True, "Ancien job": False})

    def test_refus_sans_rien_ecrire(self):
        for jobs in ([], [{"name": "Inconnu"}], [{"name": "PC-Jeu image", "max_age_days": 0}], [{"name": "PC-Jeu image", "label": "x" * 81}]):
            with self.assertRaises(ba.BackupError, msg=str(jobs)):
                ba.veeam_follow(self.acct(), jobs)
        with self.assertRaises(ba.BackupError):
            ba.veeam_follow(self.acct(password="faux"), [{"name": "PC-Jeu image"}])
        self.assertEqual(self.config.read_text(encoding="utf-8"), "{}")
        self.assertFalse(self.meta.exists())

    def test_ancien_fichier_de_secrets_remplace_et_autres_cles_gardees(self):
        self.meta.write_text(json.dumps({"hosts": [{"id": "veeam", "api": "veeam", "label": "Mon Veeam", "url": "https://x:9419", "secrets": "/s"}],
                                         "sets": [], "syncthing": [{"x": 1}]}), encoding="utf-8")
        ba.veeam_follow(self.acct(), [{"name": "PC-Jeu image"}])
        meta = self.meta_json()
        host = next(h for h in meta["hosts"] if h["id"] == "veeam")
        self.assertEqual((host["label"], host["url"], "secrets" in host), ("Mon Veeam", self.url, False))
        self.assertEqual(meta["syncthing"], [{"x": 1}])

    def test_releve_par_le_compte_de_la_page_puis_niveau_selon_l_age(self):
        import backups
        ba.veeam_follow(self.acct(), [{"name": "PC-Jeu image", "max_age_days": 2}, {"name": "Serveur fichiers", "max_age_days": 2}])
        meta = self.meta_json()
        host = next(h for h in meta["hosts"] if h["id"] == "veeam")
        # config.json en clair en mémoire (config.load déchiffre) : c'est ce que backups.py lit
        plain = ba.settings.get("veeam", "veeam", plain=True)
        with mock.patch.dict(backups.CFG, {"connectors": [plain]}):
            got, err = backups.api_collect(backups.Veeam, host, "API Veeam")
        self.assertEqual(err, "")
        self.assertEqual(sorted(got["veeam_jobs"]), ["Ancien job", "PC-Jeu image", "Serveur fichiers"])
        res = {"veeam": (got, ""), "veeam-sources": ({"user": None, "locs": {}, "disks": [], "crons": [], "cron_root": None}, "")}
        now = datetime.fromisoformat("2026-10-09T12:00:00+02:00").timestamp()
        out = backups.analyse(meta, res, {}, now)
        lv = {s["id"]: s["level"] for s in out["sets"]}
        self.assertEqual(lv["veeam-pc-jeu-image"], "ok")  # passé il y a 9 h, résultat Success
        self.assertEqual(lv["veeam-serveur-fichiers"], "warn")  # récent, mais son dernier résultat est Warning
        late = backups.analyse(meta, res, {}, now + 3 * 86400)
        self.assertEqual({s["id"]: s["level"] for s in late["sets"]}["veeam-pc-jeu-image"], "warn")

    def test_jeu_sans_copie_attendue_n_alerte_pas_sur_l_absence_de_copie(self):
        import backups
        now = datetime.fromisoformat("2026-10-09T12:00:00+02:00").timestamp()
        meta = {"hosts": [{"id": "srv", "label": "Serveur", "ip": "10.0.0.2", "kind": "machine"}],
                "sets": [{"id": "page", "label": "Serveur : /home/backup", "origin": "srv", "max_age_days": 8, "expect_offsite": False,
                          "locations": [{"host": "srv", "path": "/home/backup", "pattern": "*", "depth": 3}]},
                         {"id": "ancien", "label": "Ancien jeu", "origin": "srv", "max_age_days": 8,
                          "locations": [{"host": "srv", "path": "/home/backup", "pattern": "*", "depth": 3}]}]}
        files = [{"name": "a.tgz", "mtime": now - 6 * 86400, "size": 100}]       # hebdomadaire, vu à 6 jours
        data = {"exists": True, "count": 1, "size": 100, "files": files}
        res = {"srv": ({"locs": {"page#0": data, "ancien#0": data}, "disks": [], "crons": [], "cron_root": None}, "")}
        out = backups.analyse(meta, res, {}, now)
        by = {x["id"]: x for x in out["sets"]}
        self.assertEqual((by["page"]["level"], by["page"]["why"], by["page"]["expect_offsite"]), ("ok", [], False))
        self.assertEqual(by["ancien"]["level"], "crit")                           # jeu écrit à la main : la copie hors machine reste exigée
        self.assertIn("aucune copie hors machine à jour", by["ancien"]["why"])
        sm = out["summary"]
        self.assertEqual((sm["no_offsite"], sm["offsite_unknown"]), (1, 1))        # l'un exigé et absent, l'autre simplement non déclaré
        self.assertEqual([i["set"] for i in out["issues"]], ["Ancien jeu"])        # une seule alerte, pas deux

    def test_hote_sans_connecteur_dit_pourquoi(self):
        import backups
        got, err = backups.api_collect(backups.Veeam, {"id": "veeam", "api": "veeam", "connector": "absent"}, "API Veeam")
        self.assertIsNone(got)
        self.assertIn("absent de config.json", err)


class HomeAssistantAssistant(Base):
    def add_connector(self, **kw):
        ba.settings.save("home-assistant", "maison", {"url": self.url, "token": kw.get("token", TOKEN)})

    def test_sans_connecteur(self):
        self.assertEqual(ba.current()["ha"], {"connectors": [], "followed": False, "connector": ""})
        with self.assertRaises(ba.BackupError):
            ba.ha_check("maison")
        with self.assertRaises(ba.BackupError):
            ba.ha_follow("maison")

    def test_verification_lit_la_derniere_sauvegarde(self):
        self.add_connector()
        self.assertEqual(ba.current()["ha"]["connectors"], ["maison"])
        r = ba.ha_check("maison")
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["last_ok"], int(datetime.fromisoformat("2026-10-09T04:45:01+00:00").timestamp()))
        self.assertFalse(self.meta.exists())  # lecture seule, rien d'enregistré
        self.assertEqual({m for m, _ in FakeServer.seen}, {"GET"})

    def test_jeton_refuse_et_capteurs_absents(self):
        self.add_connector(token="mauvais")
        r = ba.ha_check("maison")
        self.assertFalse(r["ok"])
        self.assertNotIn("mauvais", json.dumps(r))
        ba.settings.save("home-assistant", "maison", {"url": self.url, "token": TOKEN}, "maison")
        with mock.patch.dict(globals(), {"HA_STATES": [{"entity_id": "sun.sun", "state": "below_horizon"}]}):
            r = ba.ha_check("maison")
        self.assertFalse(r["ok"])
        self.assertIn("aucune sauvegarde automatique réussie", r["message"])

    def test_suivi_puis_niveau_selon_l_age(self):
        import backups
        self.add_connector()
        self.assertEqual(ba.ha_follow("maison", "", 2), {"added": 1, "updated": 0})
        self.assertEqual(ba.ha_follow("maison", "Maison HA", 3), {"added": 0, "updated": 1})
        meta = self.meta_json()
        host = next(h for h in meta["hosts"] if h["id"] == "home-assistant")
        self.assertEqual((host["api"], host["connector"]), ("ha", "maison"))
        self.assertNotIn(TOKEN, self.meta.read_text(encoding="utf-8"))  # le jeton reste dans config.json (chiffré)
        self.assertEqual(len(meta["sets"]), 1)
        self.assertEqual(ba.current()["ha"], {"connectors": ["maison"], "followed": True, "connector": "maison"})
        self.assertTrue(ba.current()["sets"][0]["ha"])
        plain = ba.settings.get("home-assistant", "maison", plain=True)
        with mock.patch.dict(backups.CFG, {"connectors": [plain]}):
            got, err = backups.api_collect(backups.HomeAssistant, host, "API HA")
        self.assertEqual(err, "")
        res = {"home-assistant": (got, ""), "home-assistant-source": ({"user": None, "locs": {}, "disks": [], "crons": [], "cron_root": None}, "")}
        ok_at = datetime.fromisoformat("2026-10-09T04:45:01+00:00").timestamp()
        for days, expected in ((1, "ok"), (4, "warn"), (8, "crit")):  # seuil 3 j : ok jusqu'à 3 j, warn jusqu'à 6 j, crit au-delà
            out = backups.analyse(meta, res, {}, ok_at + days * 86400)
            self.assertEqual(out["sets"][0]["level"], expected, days)
        self.assertEqual(backups.analyse(meta, res, {}, ok_at + 3600)["summary"]["ok"], 1)


if __name__ == "__main__":
    unittest.main()
