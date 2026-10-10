"""Agents MyServices (agents.py, api.py, health.py) : jeton lié à une machine, une seule route ouverte,
relevé validé, révocation immédiate, fraîcheur, fusion dans la santé.

  À lancer dans l'image (FastAPI) : python3 -m unittest discover -s tests
"""
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from fastapi.testclient import TestClient

    import agents
    import api
    import auth
    import health
    import server
    import tokens
except ImportError:
    api = None

PW = "un mot de passe long"
BASE = "/myservices/api/v1"
DATA = {"disks": [{"m": "C:", "s": 500e9, "f": 150e9}], "svc": [], "cpu": 12, "ncpu": 8, "mem": 41.5,
        "boot": "2026-10-10T08:00:00.0000000Z", "reboot": False, "pd": [{"n": "Samsung", "h": "Healthy"}],
        "ev": [], "fail": 0, "upd": ["KB1"]}
REPORT = {"version": "1", "os": "Windows 11", "host": "GAMER32", "interval": 900, "data": DATA}


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class Agents(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        server.STATIC = server.WEB = d
        api.AUTH = True
        api.STORE = auth.Store(d / "myservices.db")
        api.TOKENS = tokens.Tokens(d / "myservices.db")
        api.AGENTS = agents.Agents(d / "myservices.db")
        api.STORE.create_user("admin", PW, "admin")
        self.c = TestClient(api.app, client=("192.168.1.50", 50000))
        self.c.post(BASE + "/login", json={"username": "admin", "password": PW})
        self.h = {"X-CSRF-Token": self.c.cookies["ms_csrf"]}
        self.anon = TestClient(api.app, client=("192.168.1.51", 50000))

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, ip="192.168.1.60"):
        r = self.c.post(BASE + "/agents", json={"ip": ip, "name": "Gamer32"}, headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["token"], r.json()["info"]

    def send(self, token, body=REPORT):
        return self.anon.post(BASE + "/agent/report", json=body, headers={"Authorization": f"Bearer {token}"})

    def test_creation_reservee_a_une_session_admin(self):
        self.assertEqual(self.anon.post(BASE + "/agents", json={"ip": "192.168.1.60", "name": "Gamer32"}).status_code, 401)
        token, info = self.create()
        self.assertTrue(token.startswith("msv_agent_"))
        self.assertEqual(info["state"], "en attente")
        self.assertNotIn(token, str(self.c.get(BASE + "/agents").json()))  # le clair n'est jamais relu
        self.assertEqual(self.c.post(BASE + "/agents", json={"ip": "pas-une-ip", "name": "Gamer32"}, headers=self.h).status_code, 400)

    def test_releve_accepte_puis_etat_actif(self):
        token, info = self.create()
        self.assertEqual(self.send(token).status_code, 200)
        a = self.c.get(BASE + "/agents").json()["agents"][0]
        self.assertEqual((a["state"], a["os"], a["interval"]), ("actif", "Windows 11", 900))

    def test_sans_jeton_ou_mauvais_jeton_refuse(self):
        self.assertEqual(self.anon.post(BASE + "/agent/report", json=REPORT).status_code, 401)
        self.assertEqual(self.send("msv_agent_faux").status_code, 401)
        self.assertEqual(self.send("msv_api_autre").status_code, 401)

    def test_jeton_agent_ne_sert_qua_envoyer(self):
        token, _ = self.create()
        h = {"Authorization": f"Bearer {token}"}
        for path in ("/status", "/agents", "/tokens", "/system"):
            self.assertIn(self.anon.get(BASE + path, headers=h).status_code, (401, 403), path)

    def test_jeton_api_ne_peut_pas_envoyer_de_releve(self):
        raw, _ = api.tokens_store().create("api", "lecture", "admin", 30, "admin")
        self.assertEqual(self.send(raw).status_code, 401)

    def test_revocation_immediate(self):
        token, info = self.create()
        self.assertEqual(self.c.delete(f"{BASE}/agents/{info['id']}", headers=self.h).status_code, 200)
        self.assertEqual(self.send(token).status_code, 401)

    def test_nouvel_agent_revoque_le_precedent_de_la_machine(self):
        old, _ = self.create()
        new, _ = self.create()
        self.assertEqual(self.send(old).status_code, 401)
        self.assertEqual(self.send(new).status_code, 200)

    def test_releve_invalide_refuse(self):
        token, _ = self.create()
        self.assertEqual(self.send(token, {"data": "x"}).status_code, 400)
        self.assertEqual(self.send(token, {"data": {"disks": [{"s": 5}]}}).status_code, 400)  # champ « m » manquant
        r = self.anon.post(BASE + "/agent/report", content=b"pas du json", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(r.status_code, 400)
        big = {**REPORT, "pad": "x" * agents.MAX_BODY}
        self.assertEqual(self.send(token, big).status_code, 413)

    def test_fusion_dans_la_sante(self):
        token, info = self.create()
        self.send(token)
        reports = api.agents_store().fresh_reports()
        a = reports["192.168.1.60"]
        self.assertTrue(a["fresh"])
        hc = {"id": "gamer32", "name": "Gamer32 · 192.168.1.60", "os": "windows", "ip": "192.168.1.60", "target": None, "off": True}
        h = health.host_from_agent(hc, a)
        self.assertEqual((h["reachable"], h["source"], h["level"]), (True, "agent", "ok"))
        self.assertEqual(h["res"], {"available": True, "cpu_pct": 12.0, "mem_pct": 41.5})
        self.assertEqual(h["disks"][0]["used_pct"], 70)
        # relevé périmé : injoignable
        a["fresh"] = False
        self.assertEqual(health.host_from_agent(hc, a)["level"], "down")

    def test_scripts_publics_sans_secret_et_en_ascii(self):
        for name in ("install", "agent"):
            r = self.anon.get(f"/myservices/agent/{name}.ps1")
            self.assertEqual(r.status_code, 200, name)
            self.assertTrue(r.text.isascii(), name)
            self.assertNotIn("msv_agent_" + "x", r.text)
        agent = self.anon.get("/myservices/agent/agent.ps1").text
        self.assertIn("Win32_LogicalDisk", agent)       # le relevé de health.WIN_PS est inclus
        self.assertNotIn("__VERSION__", agent)
        self.assertNotIn("#__COLLECT__", agent)
        self.assertEqual(self.anon.get("/myservices/agent/autre.ps1").status_code, 404)

    def test_commande_d_installation(self):
        r = self.c.post(BASE + "/agents", json={"ip": "192.168.1.60", "name": "Gamer32"},
                        headers={**self.h, "X-Forwarded-Proto": "https", "X-Forwarded-Host": "ms.lan"})
        cmd = r.json()["command"]
        self.assertIn("$env:MSV_URL = 'https://ms.lan'", cmd)
        self.assertIn(f"$env:MSV_TOKEN = '{r.json()['token']}'", cmd)
        self.assertIn("/myservices/agent/install.ps1", cmd)

    def test_adresse_corrigee_a_la_main(self):
        ok = self.c.post(BASE + "/agents", json={"ip": "192.168.1.60", "name": "Gamer32", "url": "http://192.168.1.10:8090/"}, headers=self.h)
        self.assertIn("$env:MSV_URL = 'http://192.168.1.10:8090'", ok.json()["command"])
        for bad in ("ftp://x", "http://x/chemin", "http://a b", "javascript:alert(1)", "http://x'; calc; '"):
            r = self.c.post(BASE + "/agents", json={"ip": "192.168.1.60", "name": "Gamer32", "url": bad}, headers=self.h)
            self.assertEqual(r.status_code, 400, bad)

    def test_premier_releve_lance_la_sante_une_fois(self):
        calls = []
        old = (server.run_task, server.enabled)
        server.run_task, server.enabled = (lambda name, why: calls.append(name) or True), (lambda name: True)
        try:
            token, _ = self.create()
            self.send(token)
            self.send(token)
        finally:
            server.run_task, server.enabled = old
        self.assertEqual(calls, ["health"])

    def test_fraicheur(self):
        token, info = self.create()
        self.send(token)
        with api.agents_store()._db() as db:
            db.execute("UPDATE agents SET last_seen = ?", (time.time() - agents.FRESH_MULT * 900 - 5,))
        self.assertFalse(api.agents_store().fresh_reports()["192.168.1.60"]["fresh"])
        self.assertEqual(api.agents_store().listing()[0]["state"], "silencieux")


if __name__ == "__main__":
    unittest.main()
