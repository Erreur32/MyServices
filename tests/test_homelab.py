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
            self.assertIn("containers" if t == "portainer" else "status", cls.kinds, t)
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
                                                                                     {"name": "Disque 2", "status": "crashed", "smart_status": "normal"}]}},
                    "SYNO.Backup.Task": {"success": True, "data": {"task_list": [{"name": "Vers C2", "last_bkp_result": "done"},
                                                                                {"name": "Vers USB", "last_bkp_result": "failed"}]}}}.get(
                        method_api, {"success": False, "error": {"code": 102}})   # package absent: DSM answers « API does not exist »
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
        self.assertEqual(calls, ["SYNO.DSM.Info", "SYNO.Storage.CGI.Storage", "SYNO.Backup.Task", "SYNO.Virtualization.API.Guest"])
        self.assertIn("disque Disque 2 : crashed (SMART normal)", d["problems"])
        self.assertIn("Hyper Backup « Vers USB » : failed", d["problems"])
        self.assertNotIn("VM (VMM)", {f["label"] for f in d["facts"]})                       # Virtual Machine Manager absent: nothing shown
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
        self.route(f"{base}/sites/s1/clients", {"totalCount": 31, "data": [
            {"name": "pc", "type": "WIRELESS", "ipAddress": "10.0.0.9", "macAddress": "m9", "uplinkDeviceId": "d1"}]})
        self.route(f"{base}/sites/s1/devices", {"data": [{"id": "d1", "name": "AP salon", "macAddress": "ap", "state": "ONLINE"}, {"name": "Switch", "state": "OFFLINE"}]})
        d = self.conn("unifi", api_key="K").collect()
        self.assertEqual(d["unifi"]["clients"], [{"name": "pc", "mac": "m9", "ip": "10.0.0.9", "wired": False, "ap_mac": "ap"}])
        self.assertEqual(len(d["unifi"]["devices"]), 2)
        self.assertEqual(SEEN[0][2].get("X-Api-Key") or SEEN[0][2].get("X-API-KEY"), "K")
        self.assertEqual(d["problems"], ["appareil « Switch » hors ligne"])
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}["Clients"], "31")


    def test_mises_a_jour_et_attente_adoption(self):
        base = "/proxy/network/integration/v1"
        self.route(f"{base}/info", {"applicationVersion": "9.4.19"})
        self.route(f"{base}/sites", {"data": [{"id": "s1"}]})
        self.route(f"{base}/sites/s1/devices", {"data": [{"name": "AP", "state": "ONLINE", "firmwareUpdatable": True}, {"name": "USW", "state": "PENDING_ADOPTION"}]})
        self.route(f"{base}/sites/s1/clients", {"totalCount": 4})
        d = self.conn("unifi", api_key="K").collect()
        self.assertEqual(d["version"], "9.4.19")
        self.assertEqual(d["problems"], ["appareil « AP » : mise à jour disponible"])
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}["Appareils"], "2/2 en ligne")

    def test_compte_local_docker(self):
        self.route("/api/login", {"meta": {"rc": "ok"}, "data": []}, "POST")
        self.route("/api/logout", {"meta": {"rc": "ok"}, "data": []}, "POST")
        self.route("/api/self/sites", {"data": [{"name": "default", "desc": "Default"}]})
        self.route("/api/s/default/stat/sysinfo", {"data": [{"version": "9.0.114"}]})
        self.route("/api/s/default/stat/device", {"data": [{"name": "AP", "mac": "ap", "ip": "10.0.0.2", "state": 1, "upgradable": True},
                                                           {"name": "USW", "mac": "sw", "state": 0}]})
        self.route("/api/s/default/stat/sta", {"data": [{"hostname": "pc", "mac": "m1", "ip": "10.0.0.9", "is_wired": False, "ap_mac": "ap"},
                                                        {"name": "nas", "mac": "m2", "ip": "10.0.0.10", "is_wired": True, "sw_mac": "sw"}]})
        pw = "p" * 8
        d = self.conn("unifi", auth="account", user="ro", password=pw).collect()
        self.assertEqual(d["version"], "9.0.114")
        self.assertEqual(d["problems"], ["appareil « USW » hors ligne", "appareil « AP » : mise à jour disponible"])
        self.assertEqual(d["unifi"]["clients"][0], {"name": "pc", "mac": "m1", "ip": "10.0.0.9", "wired": False, "ap_mac": "ap"})
        self.assertEqual(d["unifi"]["clients"][1]["switch_mac"], "sw")
        login = next(x for x in SEEN if x[1] == "/api/login")
        self.assertEqual(json.loads(login[3])["username"], "ro")
        self.assertEqual(SEEN[-1][1], "/api/logout")   # session closed
        self.assertTrue(all(m == "GET" for m, path, *_ in SEEN if path not in ("/api/login", "/api/logout")))

    def test_compte_refuse(self):
        self.route("/api/login", {"meta": {"rc": "error", "msg": "api.err.Invalid"}}, "POST", code=400)
        with self.assertRaises(ConnectorError) as e:
            self.conn("unifi", auth="account", user="ro", password="x" * 4).collect()
        self.assertIn("compte refusé", str(e.exception))

    def test_reglages_selon_acces(self):
        v = connectors.TYPES["unifi"].validate
        self.assertEqual(v({"auth": "account", "url": "https://x:8443", "user": "ro"}), ["« password » requis"])
        self.assertEqual(v({"url": "https://x"}), ["« api_key » requis"])
        self.assertEqual(connectors.TYPES["unifi"].discover("jacobalberty/unifi", "10.0.0.5", [(8443, 8443)]),
                         {"auth": "account", "url": "https://10.0.0.5:8443", "verify_tls": False})

    def test_pas_une_console_unifi_os(self):
        with self.assertRaises(ConnectorError):
            self.conn("unifi", api_key="K").collect()


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
        self.assertEqual((d["version"], facts["Modèle"]["value"], facts["Batterie"]["value"], facts["Autonomie"]["value"]), (None, "Back-UPS", "42 %", "15 min"))
        self.assertEqual(facts["Secteur"]["tone"], "warn")
        self.assertEqual(d["problems"], ["onduleur : sur batterie"])

    def test_injoignable(self):
        c = connectors.TYPES["nut"]({"type": "nut", "name": "n", "host": "127.0.0.1", "port": 1}, Context(timeout=1))
        with self.assertRaises(ConnectorError):
            c.collect()


class Portainer(Base):
    def test_environnements_et_conteneurs(self):
        self.route("/api/system/status", {"Version": "2.21.0"})
        self.route("/api/endpoints", [{"Id": 1, "Name": "local", "URL": "unix:///var/run/docker.sock", "Status": 1,
                                       "Snapshots": [{"RunningContainerCount": 10, "StoppedContainerCount": 2, "UnhealthyContainerCount": 1, "ContainerCount": 12}]},
                                      {"Id": 2, "Name": "vps", "URL": "tcp://10.0.0.5:9001", "Status": 2}])
        local, vps = self.conn("portainer", api_key="K").collect()["environments"]
        self.assertEqual(SEEN[0][2].get("X-Api-Key") or SEEN[0][2].get("X-API-KEY"), "K")
        self.assertEqual((local["host"], local["available"], local["containers"]),
                         (None, True, {"total": 12, "running": 10, "stopped": 2, "paused": 0, "unhealthy": 1}))
        self.assertEqual((vps["host"], vps["available"], vps["containers"]["total"]), ("tcp://10.0.0.5:9001", False, 0))

    def test_test_donne_une_ligne_lisible(self):
        self.route("/api/system/status", {"Version": "2.21.0"})
        self.route("/api/endpoints", [{"Name": "local", "Status": 1}])
        r = self.conn("portainer", api_key="K").test()
        self.assertTrue(r.ok)
        self.assertEqual(r.version, "2.21.0")
        self.assertIn("Environnements 1/1", r.message)

    def test_pas_portainer(self):
        self.route("/api/system/status", ["autre"])
        self.assertFalse(self.conn("portainer", api_key="K").test().ok)


if __name__ == "__main__":
    unittest.main()


class HomeAssistantHote(unittest.TestCase):
    """La machine qui héberge Home Assistant est lue par ses capteurs : source de santé « API », rattachée à la machine."""
    STATES = [{"entity_id": "sensor.system_monitor_processor_use", "state": "3"}, {"entity_id": "sensor.system_monitor_memory_usage", "state": "17.5"},
              {"entity_id": "sensor.system_monitor_processor_temperature", "state": "52"}, {"entity_id": "sensor.home_assistant_host_disk_total", "state": "400"},
              {"entity_id": "sensor.home_assistant_host_disk_used", "state": "380"}, {"entity_id": "sensor.system_monitor_ipv4_address_enp3s0", "state": "10.0.0.7"},
              {"entity_id": "sensor.system_monitor_ipv4_address_docker0", "state": "172.30.232.1"}, {"entity_id": "sensor.pile", "state": "9",
                                                                                                     "attributes": {"device_class": "battery", "friendly_name": "Capteur porte"}},
              {"entity_id": "light.x", "state": "unavailable"}]

    def test_capteurs_de_la_machine_hote(self):
        from connectors.home_assistant import host_sensors
        h = host_sensors(self.STATES)
        self.assertEqual((h["cpu"], h["mem_pct"], h["temp"], h["ips"]), (3.0, 17.5, 52.0, ["10.0.0.7"]))        # l'adresse du pont docker n'est pas la machine
        self.assertEqual(h["disks"], [{"mount": "/", "size_gb": 400.0, "used_gb": 380.0, "used_pct": 95}])
        self.assertIsNone(host_sensors([{"entity_id": "sensor.autre", "state": "1"}]))                           # Core seul : pas de bloc machine

    def test_sante_lue_par_l_api(self):
        import health
        hc = {"id": "ha", "name": "homeassistant · 10.0.0.7", "os": "linux", "ip": "10.0.0.7", "target": None, "off": False, "sources": []}
        api = {"status": "up", "cpu": 3.0, "mem_pct": 17.5, "temp": 52.0, "disks": [{"mount": "/", "size_gb": 400.0, "used_gb": 380.0, "used_pct": 95}]}
        h = health.read_host(hc, None, None, api=api)
        self.assertEqual((h["source"], h["reachable"], h["res"]["cpu_pct"], h["temp"]["celsius"]), ("ha", True, 3.0, 52.0))
        self.assertTrue(h["disks"][0]["critical"])                       # disque à 95 % : critique, comme pour toute source
        self.assertEqual(h["level"], "crit")
        self.assertIsNone(health.read_host(hc, None, None))             # sans API : toujours rien (pas de source)

    def test_rattachement_a_la_machine(self):
        import api_link
        rows = [{"connector": "home-assistant", "name": "Home", "label": "Home Assistant", "ok": True, "version": "2026.10.1", "url": "http://10.0.0.7:8123", "message": "OK",
                 "host": {"cpu": 3.0, "ips": ["10.0.0.7"], "secret": "x"}},
                {"connector": "dockhand", "name": "d", "label": "Dockhand", "ok": False, "url": "http://machine.lan:3000"},        # un nom n'est pas résolu
                {"connector": "proxmox", "name": "p", "label": "Proxmox VE", "ok": True, "url": "https://10.0.0.99:8006"}]           # machine inconnue
        got = api_link.by_machine(rows, {"10.0.0.7", "10.0.0.8"})
        self.assertEqual(list(got), ["10.0.0.7"])
        self.assertEqual(len(got["10.0.0.7"]), 1)                                                                                  # URL et adresse annoncée : une seule entrée
        self.assertEqual((got["10.0.0.7"][0]["version"], got["10.0.0.7"][0]["host"]), ("2026.10.1", {"cpu": 3.0}))                # rien d'autre que les chiffres utiles
        self.assertEqual(api_link.host_ip("https://10.0.0.5:8006/x"), "10.0.0.5")
        self.assertIsNone(api_link.host_ip("http://nas.lan"))
