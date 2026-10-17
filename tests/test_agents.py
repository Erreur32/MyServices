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
        self.gap, agents.MIN_GAP = agents.MIN_GAP, 0   # most tests send several reports in a row
        agents._bad.clear()

    def tearDown(self):
        agents.MIN_GAP = self.gap
        agents._bad.clear()
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

    def test_effacer_un_agent_revoque_seulement(self):
        _, info = self.create()
        url = BASE + f"/agents/{info['id']}"
        self.assertEqual(self.c.delete(url + "/purge", headers=self.h).status_code, 400)  # actif : pas effaçable
        self.assertEqual(self.c.delete(url, headers=self.h).status_code, 200)             # révoqué
        self.assertEqual(self.anon.delete(url + "/purge").status_code, 401)
        self.assertEqual(self.c.delete(url + "/purge", headers=self.h).status_code, 200)
        self.assertEqual(self.c.get(BASE + "/agents").json()["agents"], [])
        self.assertEqual(self.c.delete(url + "/purge", headers=self.h).status_code, 400)  # déjà parti

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

    def test_releve_linux_accepte_et_range_comme_une_lecture_ssh(self):
        token, _ = self.create("192.168.1.61")
        body = {"version": "1", "os": "Debian 12", "host": "box", "interval": 900,
                "data": {"kind": "linux", "cmds": {health.REBOOT_CMD: [0, "yes\n"], health.LOAD_CMD: [0, "0.5 0.4 0.3 1/200 1\n4\n"]}}}
        self.assertEqual(self.send(token, body).status_code, 200)
        rep = api.agents_store().fresh_reports()["192.168.1.61"]
        self.assertTrue(rep["fresh"])
        hc = {"id": "box", "name": "Box · 192.168.1.61", "os": "linux", "ip": "192.168.1.61", "target": None, "off": False}
        h = health.host_from_agent(hc, rep)
        self.assertEqual((h["reachable"], h["os"], h["source"], h["reboot_required"]), (True, "linux", "agent", True))
        self.assertEqual(self.send(token, {**body, "data": {"kind": "linux", "cmds": {"a": "x"}}}).status_code, 400)

    def test_un_releve_par_minute(self):
        agents.MIN_GAP = 60
        token, _ = self.create()
        self.assertEqual(self.send(token).status_code, 200)
        r = self.send(token)
        self.assertEqual((r.status_code, r.json()["code"]), (429, "TOO_SOON"))
        self.assertGreater(int(r.headers["Retry-After"]), 0)
        agents.MIN_GAP = 0
        self.assertEqual(self.send(token).status_code, 200)

    def test_faux_jetons_bloquent_l_ip(self):
        token, _ = self.create()
        for _ in range(agents.BAD_MAX):
            self.assertEqual(self.send("msv_agent_faux").status_code, 401)
        r = self.send("msv_agent_faux")
        self.assertEqual((r.status_code, r.json()["code"]), (429, "TOO_MANY_BAD_TOKENS"))
        self.assertEqual(self.send(token).status_code, 429)   # same IP: even the good token waits
        other = TestClient(api.app, client=("192.168.1.52", 50000))
        self.assertEqual(other.post(BASE + "/agent/report", json=REPORT, headers={"Authorization": f"Bearer {token}"}).status_code, 200)

    def test_jeton_revoque_ne_compte_pas_comme_faux_jeton(self):
        token, info = self.create()
        self.c.delete(f"{BASE}/agents/{info['id']}", headers=self.h)
        for _ in range(agents.BAD_MAX + 2):
            self.assertEqual(self.send(token).status_code, 401)   # never 429: a known agent still retrying

    def test_nom_de_poste_different_refuse_jusqu_a_confirmation(self):
        token, info = self.create()
        self.assertEqual(self.send(token).status_code, 200)
        self.assertEqual(self.send(token, {**REPORT, "host": "gamer32"}).status_code, 200)   # case does not matter
        r = self.send(token, {**REPORT, "host": "AUTRE-PC"})
        self.assertEqual((r.status_code, r.json()["code"]), (409, "HOST_CHANGED"))
        a = next(x for x in self.c.get(BASE + "/agents").json()["agents"] if x["id"] == info["id"])
        self.assertEqual((a["hostname"], a["host_pending"]), ("GAMER32", "AUTRE-PC"))
        self.assertEqual(self.anon.post(BASE + f"/agents/{info['id']}/confirm-host").status_code, 401)
        self.assertEqual(self.c.post(BASE + f"/agents/{info['id']}/confirm-host", headers=self.h).status_code, 200)
        self.assertEqual(self.send(token, {**REPORT, "host": "AUTRE-PC"}).status_code, 200)
        self.assertEqual(self.c.post(BASE + f"/agents/{info['id']}/confirm-host", headers=self.h).status_code, 400)   # nothing pending

    def test_nom_de_poste_des_agents_v7(self):
        token, info = self.create()
        legacy = {**REPORT, "host": agents.LEGACY_HOST}
        self.assertEqual(self.send(token, legacy).status_code, 200)   # version 7 sends a placeholder: accepted, nothing learned
        a = next(x for x in self.c.get(BASE + "/agents").json()["agents"] if x["id"] == info["id"])
        self.assertIsNone(a["hostname"])
        self.assertEqual(self.send(token, REPORT).status_code, 200)   # the updated agent announces the real name: learned, no 409
        self.assertEqual(self.send(token, legacy).status_code, 200)   # an old agent still reports: not a name change
        self.assertEqual(self.send(token, {**REPORT, "host": "AUTRE-PC"}).status_code, 409)
        # a placeholder stored by an earlier server version is replaced by the real name
        with api.agents_store()._db() as db:
            db.execute("UPDATE agents SET hostname = ? WHERE id = ?", (agents.LEGACY_HOST, info["id"]))
        a = next(x for x in self.c.get(BASE + "/agents").json()["agents"] if x["id"] == info["id"])
        self.assertIsNone(a["hostname"])   # the placeholder is never shown as a host name
        self.assertEqual(self.send(token, REPORT).status_code, 200)
        a = next(x for x in self.c.get(BASE + "/agents").json()["agents"] if x["id"] == info["id"])
        self.assertEqual(a["hostname"], "GAMER32")

    def test_script_garde_son_propre_dossier(self):
        script = self.anon.get("/myservices/agent/agent.ps1").text
        self.assertIn("$Dir = $PSScriptRoot", script)   # a self-updated copy must not fall back to the installed agent's folder
        self.assertNotIn("Join-Path $env:ProgramData", script)

    def test_script_envoie_le_vrai_nom_du_poste(self):
        script = self.anon.get("/myservices/agent/agent.ps1").text
        self.assertIn("(Json ([Environment]::MachineName))", script)   # without the inner parentheses PowerShell sends the literal text

    def test_ancien_nom_de_retour_efface_l_avertissement(self):
        token, info = self.create()
        self.send(token)
        self.assertEqual(self.send(token, {**REPORT, "host": "AUTRE-PC"}).status_code, 409)
        self.assertEqual(self.send(token).status_code, 200)   # the real PC reports again under its known name
        a = next(x for x in self.c.get(BASE + "/agents").json()["agents"] if x["id"] == info["id"])
        self.assertEqual((a["hostname"], a["host_pending"]), ("GAMER32", None))

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
        self.assertIn("$env:MSV_URL/agent/install.ps1", cmd)          # root address; the old /myservices/agent/… one still works (test above)

    def test_adresse_corrigee_a_la_main(self):
        ok = self.c.post(BASE + "/agents", json={"ip": "192.168.1.60", "name": "Gamer32", "url": "http://192.168.1.10:8090/"}, headers=self.h)
        self.assertIn("$env:MSV_URL = 'http://192.168.1.10:8090'", ok.json()["command"])
        for bad in ("ftp://x", "http://x/chemin", "http://a b", "javascript:alert(1)", "http://x'; calc; '"):
            r = self.c.post(BASE + "/agents", json={"ip": "192.168.1.60", "name": "Gamer32", "url": bad}, headers=self.h)
            self.assertEqual(r.status_code, 400, bad)

    def test_premier_releve_lance_la_sante_une_fois(self):
        calls, chains = [], []
        old = (server.run_task, server.enabled, server.run_chain)
        server.run_task, server.enabled, server.run_chain = (lambda name, why, args=(): calls.append((name, args)) or True), (lambda name: True), (lambda names, why: chains.append(names))
        try:
            token, _ = self.create()
            self.send(token)
            self.send(token)
        finally:
            server.run_task, server.enabled, server.run_chain = old
        # 1er relevé : passage complet de la santé ; relevés suivants : seulement la fiche de cette machine (--only)
        self.assertEqual(calls, [("health", ()), ("health", ("--only", "192.168.1.60"))])
        self.assertEqual(chains, [["collect"]])   # le premier relevé lance aussi la collecte (système, matériel, ports), une seule fois

    def test_verifier_une_machine_lue_par_son_agent(self):
        import machines_admin
        token, info = self.create()
        m = {"name": "Gamer32", "os": "windows", "ssh": None}
        lines, failed = machines_admin._check_agent("192.168.1.60", m, api.agents_store())
        self.assertEqual(failed, 1)
        self.assertIn("aucun relevé reçu", lines[0])
        self.send(token)
        lines, failed = machines_admin._check_agent("192.168.1.60", m, api.agents_store())
        self.assertEqual((failed, lines[0].startswith("✓ Gamer32 : agent actif")), (0, True))
        self.assertEqual(machines_admin._check_agent("192.168.1.99", m, api.agents_store()), ([], 0))  # pas d'agent pour cette IP

    def test_sante_relue_quand_le_niveau_change(self):
        calls, chains = [], []
        old = (server.run_task, server.enabled, server.run_chain)
        server.run_task, server.enabled, server.run_chain = (lambda name, why, args=(): calls.append((why, args)) or True), (lambda name: True), (lambda names, why: chains.append(why))
        try:
            token, _ = self.create()
            self.send(token)                       # premier relevé
            self.send(token)                       # même niveau : rien
            bad = {**REPORT, "data": {**DATA, "disks": [{"m": "C:", "s": 500e9, "f": 10e9}]}}
            self.send(token, bad)                  # disque à 98 % : critique
            self.send(token, bad)                  # toujours critique : rien
            self.send(token)                       # retour à la normale
            self.send(token, {**REPORT, "version": "9"})   # agent réinstallé dans une autre version : la collecte est relancée
        finally:
            server.run_task, server.enabled, server.run_chain = old
        self.assertEqual(len(chains), 2)           # premier relevé, puis changement de version (pas à chaque relevé)
        self.assertIn("version 9", chains[1])
        full = [why for why, args in calls if not args]
        self.assertEqual(len(full), 3)             # passage complet : 1er relevé et chaque changement de niveau
        self.assertIn("ok → crit", full[1])
        self.assertIn("crit → ok", full[2])
        self.assertEqual(len(calls) - len(full), 3)  # les autres relevés rafraîchissent seulement la fiche de la machine

    def test_systeme_et_ports_du_releve(self):
        data = {**DATA, "os": {"n": "Microsoft Windows 11 Professionnel", "v": "10.0.26100", "b": "26100", "h": "GAMER32"},
                "boot": "2026-10-10T08:00:00.0000000Z",
                "ports": [{"p": 445, "a": "0.0.0.0", "n": "System"}, {"p": 8080, "a": "127.0.0.1", "n": "node"},
                          {"p": 8080, "a": "0.0.0.0", "n": "node"}, {"p": 135, "a": "0.0.0.0", "n": "svchost"},
                          {"p": 49670, "a": "0.0.0.0", "n": "lsass"}, {"p": 32400, "a": "::", "n": "Plex Media Server"}, {"p": "x"}]}
        rep = {**REPORT, "data": data}
        self.assertEqual(agents.ports_of(rep), {445: {"name": "System", "lan": True}, 8080: {"name": "node", "lan": True},
                                               32400: {"name": "Plex Media Server", "lan": True}})
        s = agents.system_of(rep)
        self.assertEqual((s["os"], s["kernel"]), ("Microsoft Windows 11 Professionnel", "10.0.26100 (build 26100)"))
        self.assertGreater(s["uptime_s"], 0)
        self.assertEqual(agents.ports_of({}), {})
        self.assertIsNone(agents.system_of({"data": DATA}))
        h = health.parse_windows(data)
        self.assertEqual(h["system"]["build"], "26100")

    def test_materiel_du_releve(self):
        hw = {"m": "Dell Inc.", "mo": "OptiPlex 7090", "bios": "1.12.0", "cpu": "Intel(R) Core(TM) i7", "cc": 8, "cl": 16, "ram": 31.8,
              "dom": "WORKGROUP: HOME", "wu": "2026-10-01",
              "gpu": {"n": "NVIDIA GeForce", "r": "1920x1080"},  # un seul élément : objet et non liste
              "net": [{"n": "Ethernet", "ip": "192.168.1.60"}, {"n": "VPN", "ip": "10.0.0.5"}, {"n": "Mauvaise", "ip": "fe80::1"}]}
        rep = {**REPORT, "data": {**DATA, "hw": hw}}
        h = agents.hardware_of(rep)
        self.assertEqual((h["maker"], h["model"], h["bios"], h["cores"], h["threads"], h["ram_gb"]),
                         ("Dell Inc.", "OptiPlex 7090", "1.12.0", 8, 16, 31.8))
        self.assertEqual(h["gpu"], [{"name": "NVIDIA GeForce", "res": "1920x1080"}])
        self.assertEqual([n["ip"] for n in h["net"]], ["192.168.1.60", "10.0.0.5"])  # IPv6 écartée
        self.assertEqual(health.parse_windows({**DATA, "hw": hw})["hardware"], h)
        self.assertEqual(h["last_update"], "2026-10-01")

    def test_materiel_tolerant(self):
        self.assertIsNone(agents.hardware_of(None))
        self.assertIsNone(agents.hardware_of({"data": DATA}))
        self.assertIsNone(agents.hardware_of({"data": {"hw": "n'importe quoi"}}))
        self.assertIsNone(agents.hardware_of({"data": {"hw": {}}}))
        h = agents.hardware_of({"data": {"hw": {"mo": "PC", "ram": "x", "cc": -1, "gpu": [1, None, {"r": "1x1"}], "net": ["a", {"n": "x"}]}}})
        self.assertEqual((h["model"], h["ram_gb"], h["cores"], h["gpu"], h["net"]), ("PC", None, None, [], []))
        self.assertIsNone(health.parse_windows(DATA)["hardware"])

    def test_mise_a_jour_de_l_agent_automatique_ou_demandee(self):
        token, info = self.create()
        old = {**REPORT, "version": "1"}
        self.assertNotIn("update", self.send(token, old).json())                                   # rien demandé : jamais de mise à jour d'office
        self.assertFalse(info["auto_update"])
        self.assertTrue(self.c.post(BASE + f"/agents/{info['id']}/update", headers=self.h).json()["ok"])   # « Mettre à jour maintenant »
        upd = self.send(token, old).json()["update"]
        self.assertEqual((upd["version"], upd["path"]), (agents.VERSION, "/myservices/agent/agent.ps1"))
        self.assertEqual(upd["sha256"], agents.script_sha256())                                    # l'agent contrôlera l'empreinte avant de remplacer son fichier
        self.assertIn("update", self.send(token, old).json())                                      # demande gardée tant que l'agent est ancien
        self.assertNotIn("update", self.send(token, {**REPORT, "version": agents.VERSION}).json())  # à jour : rien, et la demande est classée
        self.assertNotIn("update", self.send(token, old).json())
        self.assertEqual(self.c.patch(BASE + f"/agents/{info['id']}", json={"auto_update": True}, headers=self.h).status_code, 200)
        self.assertIn("update", self.send(token, old).json())                                      # automatique : à chaque relevé d'un agent ancien
        self.assertNotIn("update", self.send(token, {**REPORT, "version": agents.VERSION}).json())
        self.assertTrue(next(a for a in self.c.get(BASE + "/agents", headers=self.h).json()["agents"] if a["id"] == info["id"])["auto_update"])

    def test_mise_a_jour_reservee_a_une_session_admin_et_aux_agents_actifs(self):
        token, info = self.create()
        self.assertEqual(self.anon.post(BASE + f"/agents/{info['id']}/update").status_code, 401)
        self.assertEqual(self.anon.patch(BASE + f"/agents/{info['id']}", json={"auto_update": True}).status_code, 401)
        self.c.delete(BASE + f"/agents/{info['id']}", headers=self.h)
        self.assertEqual(self.c.post(BASE + f"/agents/{info['id']}/update", headers=self.h).status_code, 400)   # révoqué : rien à mettre à jour
        self.assertEqual(self.c.patch(BASE + f"/agents/{info['id']}", json={"auto_update": True}, headers=self.h).status_code, 400)

    def test_version_ancienne_signalee(self):
        token, info = self.create()
        self.send(token, {**REPORT, "version": "1"})
        a = next(x for x in self.c.get(BASE + "/agents", headers=self.h).json()["agents"] if x["id"] == info["id"])
        self.assertEqual((a["outdated"], a["latest_version"]), (True, agents.VERSION))

    def test_docker_et_services_du_pc(self):
        rep = {"data": {"dk": ["plex|plexinc/pms-docker|0.0.0.0:32400->32400/tcp, :::32400->32400/tcp|Up 2 hours|bridge", "|sans nom"],
                         "sv": [{"n": "AdGuardHome", "d": "AdGuard Home"}, {"n": "", "d": "x"}, "pas un objet"]}}
        c = agents.docker_of(rep)
        self.assertEqual([(x["name"], x["image"], x["ports"], x["network"]) for x in c], [("plex", "plexinc/pms-docker", [(32400, 32400)], "bridge")])
        self.assertEqual(agents.services_of(rep), [{"name": "AdGuardHome", "display": "AdGuard Home"}])
        self.assertIsNone(agents.docker_of({"data": {}}))                  # agent ancien ou Docker absent : on ne dit rien
        self.assertEqual(agents.docker_of({"data": {"dk": []}}), [])       # Docker présent, sans conteneur
        self.assertEqual(agents.services_of({"data": {}}), [])
        self.assertEqual(agents.docker_of({"data": {"dk": "seule|ligne|0.0.0.0:80->80/tcp|Up|bridge"}})[0]["ports"], [(80, 80)])   # PowerShell : un seul élément = texte

    def test_script_ascii_et_version(self):
        self.assertEqual(agents.VERSION, "8")
        agents.script("agent.ps1").encode("ascii")

    def test_titres_de_mises_a_jour_au_format_powershell_5_1(self):
        # PowerShell 5.1 envoie parfois {"value": [...], "Count": n} (tableau relu d'un fichier JSON) ou des éléments non textuels
        for upd, want in (([ "KB1", "KB2" ], ["KB1", "KB2"]), ({"value": ["KB1", "KB2"], "Count": 2}, ["KB1", "KB2"]),
                          ([{"value": ["KB1", "KB2"], "Count": 2}], ["KB1", "KB2"]), ([{"Title": "KB9"}], ["KB9"]),
                          ("KB3", ["KB3"]), ([], []), (None, None), (7, None), ([None, " ", "KB4"], ["KB4"])):
            self.assertEqual(health._titles(upd), want, upd)
        h = health.parse_windows({**DATA, "upd": [{"value": ["Mise a jour A", "Mise a jour B"], "Count": 2}]})
        self.assertEqual(h["apt"]["sample"], ["Mise a jour A", "Mise a jour B"])
        self.assertEqual(h["apt"]["upgradable"], 2)

    def test_la_page_sante_ne_plante_pas_sur_un_releve_mal_forme(self):
        raw = {**DATA, "upd": [{"value": ["Mise a jour A"], "Count": 1}]}
        host = {"id": "pc", "name": "PC · 192.168.1.60", "os": "windows", "reachable": True, **health.parse_windows(raw)}
        host["level"] = health.host_level(host)
        self.assertIn("Mise a jour A", health.render_html({"timestamp": "2026-10-11T00:00:00+00:00", "hosts": [host], "overall_level": host["level"]}))

    def test_fraicheur(self):
        token, info = self.create()
        self.send(token)
        with api.agents_store()._db() as db:
            db.execute("UPDATE agents SET last_seen = ?", (time.time() - agents.FRESH_MULT * 900 - 5,))
        self.assertFalse(api.agents_store().fresh_reports()["192.168.1.60"]["fresh"])
        self.assertEqual(api.agents_store().listing()[0]["state"], "silencieux")


if __name__ == "__main__":
    unittest.main()
