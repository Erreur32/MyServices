"""Connecteurs du homelab (Frigate, *arr, OPNsense, CrowdSec, Pi-hole, Technitium, TrueNAS, Synology, UniFi, Tailscale, NUT, Portainer)
contre de FAUX serveurs construits d'après leurs documentations : ils vérifient notre lecture, pas les vrais services.

  python3 -m unittest discover -s tests
"""
import json
import socketserver
import sys
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import connectors  # noqa: E402
from connectors.base import ConnectorError, Context  # noqa: E402

ROUTES: dict = {}     # (méthode, chemin) -> (code, corps)
SEEN: list = []       # (méthode, chemin, en-têtes, corps)


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _go(self, method):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode() if n else ""
        path = urllib.parse.urlsplit(self.path).path
        SEEN.append((method, self.path, dict(self.headers), body))
        hit = ROUTES.get((method, path)) or ROUTES.get((method, self.path))
        code, data = hit if hit else (404, {"error": "inconnu"})
        out = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    do_GET = lambda self: self._go("GET")        # noqa: E731
    do_POST = lambda self: self._go("POST")      # noqa: E731
    do_DELETE = lambda self: self._go("DELETE")  # noqa: E731


class Nut(socketserver.BaseRequestHandler):
    def handle(self):
        req = self.request.recv(200).decode()
        if req.startswith("LIST UPS"):
            self.request.sendall(b'BEGIN LIST UPS\nUPS salon "APC"\nEND LIST UPS\n')
        elif req.startswith("LIST VAR salon"):
            self.request.sendall(b'BEGIN LIST VAR salon\nVAR salon ups.status "OB DISCHRG"\nVAR salon battery.charge "42"\n'
                                 b'VAR salon battery.runtime "900"\nVAR salon ups.load "35"\nVAR salon ups.model "Back-UPS"\nEND LIST VAR salon\n')
        else:
            self.request.sendall(b"ERR UNKNOWN-UPS\n")


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Fake)
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        ROUTES.clear()
        SEEN.clear()

    def conn(self, type_, **conf):
        return connectors.TYPES[type_]({"type": type_, "name": type_, "url": self.url, **conf}, Context(timeout=5))

    def route(self, path, data, method="GET", code=200):
        ROUTES[(method, path)] = (code, data)


class Registre(unittest.TestCase):
    def test_tous_enregistres_avec_champs_et_aide(self):
        for t in ("frigate", "arr", "opnsense", "crowdsec", "pihole", "technitium", "truenas", "synology", "unifi", "tailscale", "nut", "portainer"):
            cls = connectors.TYPES[t]
            self.assertIn("status", cls.kinds, t)
            self.assertTrue(cls.label and cls.fields and cls.guide, t)
            secrets = {f.name for f in cls.fields if f.secret}
            self.assertTrue(secrets or t in ("frigate", "nut"), f"{t} : aucun secret déclaré ?")
        self.assertEqual(connectors.TYPES["frigate"].validate({}), ["« url » requis"])


class Frigate(Base):
    def test_cameras_detecteurs_stockage_evenements(self):
        self.route("/api/stats", {"service": {"version": "0.14.1", "uptime": 90000, "storage": {"/media/frigate/recordings": {"total": 1000000, "free": 50000}}},
                                  "cameras": {"salon": {"camera_fps": 5.0}, "garage": {"camera_fps": 0.0}}, "detectors": {"coral": {"inference_speed": 12.3}}})
        self.route("/api/events", [{"id": "1"}, {"id": "2"}])
        d = self.conn("frigate").collect()
        facts = {f["label"]: f for f in d["facts"]}
        self.assertEqual(d["version"], "0.14.1")
        self.assertEqual((facts["Caméras"]["value"], facts["Caméras"]["tone"]), ("1/2", "bad"))
        self.assertEqual(facts["Événements 24 h"]["value"], "2")
        self.assertEqual(d["problems"], ["caméra « garage » sans image (0 image/s)"])

    def test_pas_frigate(self):
        self.route("/api/stats", ["autre chose"])
        with self.assertRaises(ConnectorError):
            self.conn("frigate").collect()


class Arr(Base):
    def test_sante_et_files(self):
        self.route("/api/v3/system/status", {"version": "4.0.9"})
        self.route("/api/v3/health", [{"type": "warning", "message": "Aucun client de téléchargement"}, {"type": "notice", "message": "ok"}])
        self.route("/api/v3/queue", {"totalRecords": 3})
        self.route("/api/v3/wanted/missing", {"totalRecords": 12})
        d = self.conn("arr", app="sonarr", api_key="K").collect()
        self.assertEqual(SEEN[0][2].get("X-Api-Key"), "K")                      # clé en en-tête, jamais dans l'adresse
        self.assertTrue(all("K" not in s[1] for s in SEEN))
        facts = {f["label"]: f["value"] for f in d["facts"]}
        self.assertEqual((d["version"], facts["File d'attente"], facts["Manquants"]), ("4.0.9", "3", "12"))
        self.assertEqual(d["problems"], ["Aucun client de téléchargement"])

    def test_prowlarr_api_v1_sans_manquants(self):
        self.route("/api/v1/system/status", {"version": "1.2"})
        self.route("/api/v1/health", [])
        d = self.conn("arr", app="prowlarr", api_key="K").collect()
        self.assertNotIn("Manquants", {f["label"] for f in d["facts"]})

    def test_cle_refusee(self):
        self.route("/api/v3/system/status", {"error": "Unauthorized"}, code=401)
        with self.assertRaises(ConnectorError) as e:
            self.conn("arr", app="radarr", api_key="mauvaise").collect()
        self.assertIn("accès refusé", str(e.exception))


class OPNsense(Base):
    def test_passerelles_et_mises_a_jour(self):
        self.route("/api/core/firmware/status", {"product_version": "24.7.5", "updates": "3", "needs_reboot": "1"})
        self.route("/api/routes/gateway/status", {"items": [{"name": "WAN_DHCP", "status": "none", "status_translated": "Online", "loss": "0.0 %"},
                                                            {"name": "WAN2", "status": "down", "status_translated": "Offline", "loss": "100 %"}]})
        d = self.conn("opnsense", key="k", secret="s").collect()
        self.assertTrue(SEEN[0][2]["Authorization"].startswith("Basic "))
        self.assertEqual(d["version"], "24.7.5")
        self.assertIn("passerelle « WAN2 » : Offline (perte 100 %)", d["problems"])
        self.assertIn("redémarrage requis", d["problems"])


class CrowdSec(Base):
    def test_decisions(self):
        self.route("/v1/decisions", [{"scenario": "crowdsecurity/ssh-bf", "value": f"1.2.3.{i}"} for i in range(25)] + [{"scenario": "crowdsecurity/http-probing", "value": "5.6.7.8"}])
        d = self.conn("crowdsec", api_key="K").collect()
        self.assertEqual(SEEN[0][2].get("X-Api-Key"), "K")
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}["Décisions actives"], "26")
        self.assertEqual(d["problems"], ["25 bannissement(s) : ssh-bf"])

    def test_aucune_decision(self):
        self.route("/v1/decisions", None)
        self.assertEqual(self.conn("crowdsec", api_key="K").collect()["facts"][0]["value"], "0")


class PiHole(Base):
    def test_session_ouverte_puis_fermee(self):
        self.route("/api/auth", {"session": {"valid": True, "sid": "SID1"}}, "POST")
        self.route("/api/auth", {}, "DELETE")
        self.route("/api/stats/summary", {"queries": {"total": 1000, "percent_blocked": 25.4}, "gravity": {"domains_being_blocked": 90000}})
        self.route("/api/dns/blocking", {"blocking": "enabled"})
        self.route("/api/info/version", {"version": {"core": {"local": {"version": "v6.0"}}}})
        d = self.conn("pihole", password="pw").collect()
        self.assertEqual(d["version"], "v6.0")
        self.assertEqual(json.loads(SEEN[0][3]), {"password": "pw"})                       # mot de passe dans le corps, jamais dans l'adresse
        self.assertEqual(SEEN[-1][0], "DELETE")                                            # la session est fermée
        self.assertEqual(d["problems"], [])

    def test_blocage_coupe_signale_et_mauvais_mot_de_passe(self):
        self.route("/api/auth", {"session": {"valid": True, "sid": "S"}}, "POST")
        self.route("/api/stats/summary", {"queries": {"total": 1}})
        self.route("/api/dns/blocking", {"blocking": "disabled"})
        self.assertEqual(self.conn("pihole", password="pw").collect()["problems"], ["le blocage des publicités est coupé"])
        self.route("/api/auth", {"session": {"valid": False}}, "POST")
        with self.assertRaises(ConnectorError):
            self.conn("pihole", password="x").collect()


class Technitium(Base):
    def test_stats_en_post(self):
        self.route("/api/dashboard/stats/get", {"status": "ok", "response": {"stats": {"totalQueries": 200, "totalBlocked": 50, "totalClients": 7}}}, "POST")
        d = self.conn("technitium", token="T").collect()
        self.assertIn("token=T", SEEN[0][3])
        self.assertNotIn("T", urllib.parse.urlsplit(SEEN[0][1]).query)                     # jamais dans l'adresse
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}["Bloquées"], "25 %")

    def test_jeton_invalide(self):
        self.route("/api/dashboard/stats/get", {"status": "invalid-token"}, "POST")
        with self.assertRaises(ConnectorError):
            self.conn("technitium", token="x").collect()


class TrueNAS(Base):
    def test_pools_et_alertes(self):
        self.route("/api/v2.0/system/info", {"version": "TrueNAS-SCALE-24.10", "uptime_seconds": 3600})
        self.route("/api/v2.0/pool", [{"name": "tank", "status": "ONLINE", "healthy": True, "size": 1000, "allocated": 920},
                                      {"name": "bad", "status": "DEGRADED", "healthy": False, "size": 100, "allocated": 10}])
        self.route("/api/v2.0/alert/list", [{"level": "CRITICAL", "formatted": "Disque sda en défaut", "dismissed": False}, {"level": "INFO", "formatted": "x", "dismissed": True}])
        d = self.conn("truenas", api_key="K").collect()
        self.assertEqual(SEEN[0][2]["Authorization"], "Bearer K")
        self.assertIn("pool « bad » : DEGRADED", d["problems"])
        self.assertIn("Disque sda en défaut", d["problems"])
        self.assertEqual({f["label"]: f.get("tone") for f in d["facts"]}["Pool tank"], "bad")   # 92 % plein


class Synology(Base):
    def test_volumes_disques_et_deconnexion(self):
        self.route("/webapi/auth.cgi", {"success": True, "data": {"sid": "SID"}}, "POST")
        calls = []

        def entry(method_api):
            return {"SYNO.DSM.Info": {"success": True, "data": {"version_string": "DSM 7.2.1", "temperature": 48}},
                    "SYNO.Storage.CGI.Storage": {"success": True, "data": {"volumes": [{"id": "volume_1", "status": "normal", "size": {"total": "1000", "used": "950"}}],
                                                                           "disks": [{"name": "Disque 1", "status": "normal", "smart_status": "normal"},
                                                                                     {"name": "Disque 2", "status": "crashed", "smart_status": "normal"}]}}}[method_api]
        orig = Fake._go

        def go(handler, method):
            if urllib.parse.urlsplit(handler.path).path == "/webapi/entry.cgi":
                n = int(handler.headers.get("Content-Length") or 0)
                form = urllib.parse.parse_qs(handler.rfile.read(n).decode())
                calls.append(form["api"][0])
                out = json.dumps(entry(form["api"][0])).encode()
                handler.send_response(200)
                handler.send_header("Content-Length", str(len(out)))
                handler.end_headers()
                handler.wfile.write(out)
                return
            return orig(handler, method)
        Fake._go = go
        self.addCleanup(setattr, Fake, "_go", orig)
        d = self.conn("synology", user="u", password="pw").collect()
        self.assertEqual(d["version"], "DSM 7.2.1")
        self.assertEqual(calls, ["SYNO.DSM.Info", "SYNO.Storage.CGI.Storage"])
        self.assertIn("disque Disque 2 : crashed (SMART normal)", d["problems"])
        self.assertIn("passwd=pw", SEEN[0][3])
        self.assertNotIn("pw", SEEN[0][1])                                                   # identifiants en POST seulement
        self.assertIn("logout", SEEN[-1][3])                                                 # session fermée

    def test_connexion_refusee(self):
        self.route("/webapi/auth.cgi", {"success": False, "error": {"code": 400}}, "POST")
        with self.assertRaises(ConnectorError) as e:
            self.conn("synology", user="u", password="x").collect()
        self.assertIn("refusé", str(e.exception))


class UniFi(Base):
    def test_appareils_et_clients(self):
        base = "/proxy/network/integration/v1"
        self.route(f"{base}/info", {"applicationVersion": "9.0.114"})
        self.route(f"{base}/sites", {"data": [{"id": "s1", "name": "Default"}]})
        self.route(f"{base}/sites/s1/devices", {"data": [{"name": "AP salon", "state": "ONLINE"}, {"name": "Switch", "state": "OFFLINE"}]})
        self.route(f"{base}/sites/s1/clients", {"totalCount": 31, "data": []})
        d = self.conn("unifi", api_key="K").collect()
        self.assertEqual(SEEN[0][2].get("X-Api-Key") or SEEN[0][2].get("X-API-KEY"), "K")
        self.assertEqual(d["problems"], ["appareil « Switch » hors ligne"])
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}["Clients"], "31")


class Tailscale(Base):
    def test_headscale(self):
        self.route("/api/v1/node", {"nodes": [{"givenName": "nas", "online": True}, {"givenName": "pc", "online": False}]})
        d = self.conn("tailscale", server="headscale", api_key="K").collect()
        self.assertEqual(SEEN[0][2]["Authorization"], "Bearer K")
        self.assertEqual(d["problems"], ["« pc » hors ligne"])

    def test_headscale_sans_adresse(self):
        self.assertFalse(connectors.TYPES["tailscale"]({"type": "tailscale", "name": "t", "server": "headscale", "api_key": "K"}, Context(timeout=2)).test().ok)


class NUTTest(unittest.TestCase):
    def test_onduleur_sur_batterie(self):
        srv = socketserver.TCPServer(("127.0.0.1", 0), Nut)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        c = connectors.TYPES["nut"]({"type": "nut", "name": "n", "host": "127.0.0.1", "port": srv.server_address[1]}, Context(timeout=3))
        d = c.collect()
        facts = {f["label"]: f for f in d["facts"]}
        self.assertEqual((d["version"], facts["Batterie"]["value"], facts["Autonomie"]["value"]), ("Back-UPS", "42 %", "15 min"))
        self.assertEqual(facts["Secteur"]["tone"], "warn")
        self.assertEqual(d["problems"], ["onduleur : sur batterie"])

    def test_injoignable(self):
        c = connectors.TYPES["nut"]({"type": "nut", "name": "n", "host": "127.0.0.1", "port": 1}, Context(timeout=1))
        with self.assertRaises(ConnectorError):
            c.collect()


class Portainer(Base):
    def test_environnements_et_conteneurs(self):
        self.route("/api/system/status", {"Version": "2.21.0"})
        self.route("/api/endpoints", [{"Name": "local", "Status": 1, "Snapshots": [{"RunningContainerCount": 10, "StoppedContainerCount": 2, "UnhealthyContainerCount": 1}]},
                                      {"Name": "vps", "Status": 2}])
        d = self.conn("portainer", api_key="K").collect()
        self.assertEqual(SEEN[0][2].get("X-Api-Key") or SEEN[0][2].get("X-API-KEY"), "K")
        self.assertEqual(d["problems"], ["environnement « vps » hors ligne", "1 conteneur(s) unhealthy"])
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}["Conteneurs"], "10 en marche")

    def test_test_donne_une_ligne_lisible(self):
        self.route("/api/system/status", {"Version": "2.21.0"})
        self.route("/api/endpoints", [{"Name": "local", "Status": 1}])
        r = self.conn("portainer", api_key="K").test()
        self.assertTrue(r.ok)
        self.assertEqual(r.version, "2.21.0")
        self.assertIn("Environnements 1/1", r.message)


if __name__ == "__main__":
    unittest.main()
