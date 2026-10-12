"""Pulse, Arcane, Glances, GpuViewR, Speedtest Tracker, NetAlertX, Wazuh, Umami, Rybbit, Tautulli and Webmin connectors against FAKE servers
built from their documentation or OpenAPI file (GpuViewR: our own repo): they check our reading, not the real services.

  python3 -m unittest discover -s tests
"""
import sys
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import connectors  # noqa: E402
import known_apps  # noqa: E402
from connectors.base import ConnectorError, Context  # noqa: E402
from test_homelab import SEEN, Base  # noqa: E402

KEY = "k" * 16   # built at run time: the safety check refuses keys written as such
NEW = ("pulse", "arcane", "glances", "gpuviewr", "speedtest-tracker", "netalertx", "wazuh", "umami", "rybbit", "tautulli", "webmin")


def facts(d):
    return {f["label"]: f for f in d["facts"]}


class Registry(unittest.TestCase):
    def test_registered_with_fields_guide_and_app(self):
        apps = {a.connector for a in known_apps.APPS}
        for t in NEW:
            cls = connectors.TYPES[t]
            self.assertEqual(cls.kinds, ("status",), t)
            self.assertTrue(cls.label and cls.fields and cls.guide, t)
            self.assertIn(t, apps, f"{t}: no known app proposes it")

    def test_proposal_uses_the_api_address(self):
        """NetAlertX and Wazuh: the page found by the scan is not where the API answers."""
        rows = [{"ip": "10.0.0.9", "port": 20211, "id": 1, "app": {"key": "netalertx", "label": "NetAlertX", "confidence": "probable", "connector": "netalertx"}},
                {"ip": "10.0.0.9", "port": 443, "id": 2, "app": {"key": "wazuh", "label": "Wazuh", "confidence": "probable", "connector": "wazuh"}}]
        got = {p["connector"]: (p["url"], p["port"]) for p in known_apps.propose(rows, [])}
        self.assertEqual(got, {"netalertx": ("http://10.0.0.9:20212", 20212), "wazuh": ("https://10.0.0.9:55000", 55000)})


class Pulse(Base):
    def test_summary(self):
        self.route("/api/version", {"version": "5.1.2", "updateAvailable": True, "latestVersion": "5.2.0"})
        self.route("/api/state/summary", {"activeAlerts": 2, "nodes": 3, "vms": 12, "containers": 8,
                                          "verdicts": {"ok": 20, "attention": 1, "critical": 1},
                                          "attention": [{"name": "vm-db", "type": "vm", "verdict": "critical", "topReason": {"code": "disk_full"}},
                                                        {"name": "ok-vm", "type": "vm", "verdict": "ok"}]})
        d = self.conn("pulse", token=KEY).collect()
        f = facts(d)
        self.assertEqual(d["version"], "5.1.2")
        self.assertEqual((f["Nœuds"]["value"], f["Alertes actives"]["tone"], f["À regarder"]["tone"]), ("3", "bad", "bad"))
        self.assertEqual(d["problems"], ["« vm-db » (vm) : disk_full", "mise à jour de Pulse disponible : 5.2.0"])
        self.assertEqual({k.lower(): v for k, v in SEEN[-1][2].items()}.get("x-api-token"), KEY)

    def test_not_pulse(self):
        self.route("/api/version", {"autre": 1})
        with self.assertRaises(ConnectorError):
            self.conn("pulse", token=KEY).collect()


class Arcane(Base):
    def test_environments_counts_updates(self):
        self.route("/api/version", {"currentVersion": "v2.15.1", "newestVersion": "v2.15.1", "updateAvailable": False})
        self.route("/api/environments", {"success": True, "data": [{"id": "0", "name": "local", "status": "online"},
                                                                   {"id": "2", "name": "nas", "status": "offline"}]})
        self.route("/api/environments/0/containers/counts", {"success": True, "data": {"runningContainers": 20, "stoppedContainers": 2, "totalContainers": 22}})
        self.route("/api/environments/0/image-updates/summary", {"success": True, "data": {"totalImages": 30, "imagesWithUpdates": 3}})
        d = self.conn("arcane", api_key=KEY).collect()
        f = facts(d)
        self.assertEqual(d["version"], "2.15.1")
        self.assertEqual((f["Conteneurs"]["value"], f["Images à mettre à jour"]["value"]), ("20 en marche, 2 arrêté(s)", "3"))
        self.assertEqual(d["problems"], ["« local » : 3 image(s) à mettre à jour", "environnement « nas » : offline"])
        self.assertEqual({k.lower(): v for k, v in SEEN[-1][2].items()}.get("x-api-key"), KEY)


class Glances(Base):
    def test_v4(self):
        self.route("/api/4/status", {"version": "4.5.8"})
        self.route("/api/4/quicklook", {"cpu": 12.5, "mem": 85.0})
        self.route("/api/4/load", {"min1": 0.5, "min5": 0.71, "min15": 0.7, "cpucore": 16})
        self.route("/api/4/system", {"hr_name": "Debian GNU/Linux 13 64bit"})
        self.route("/api/4/fs", [{"mnt_point": "/", "percent": 9.2, "free": 5 * 2**30}, {"mnt_point": "/data", "percent": 93.0, "free": 2**30}])
        self.route("/api/4/alert", [{"begin": 1, "end": -1, "state": "CRITICAL", "type": "MEM"}, {"begin": 1, "end": 5, "state": "WARNING", "type": "CPU"}])
        d = self.conn("glances").collect()
        f = facts(d)
        self.assertEqual(d["version"], "4.5.8")
        self.assertEqual((f["Mémoire"]["tone"], f["Charge (5 min)"]["value"], f["Disque le plus plein"]["tone"]), ("warn", "0.71 / 16 cœurs", "warn"))
        self.assertEqual(d["problems"], ["disque /data plein à 93 %", "alerte Glances MEM : critical"])

    def test_v3_fallback(self):
        self.route("/api/3/quicklook", {"cpu": 5, "mem": 20})
        self.route("/api/3/alert", [[1, -1, "WARNING", "LOAD", 3.0]])
        d = self.conn("glances").collect()
        self.assertIsNone(d["version"])
        self.assertEqual(d["problems"], ["alerte Glances LOAD : warning"])


class GpuViewR(Base):
    def test_hosts_and_gpus(self):
        self.route("/api/v1/health", {"status": "ok", "version": "0.12.0", "gpu_count": 2, "hosts_total": 2, "hosts_online": 1, "hosts_offline": 1})
        self.route("/api/v1/hosts", {"hosts": [{"id": "local", "name": "Jarvis", "status": "online"}, {"id": "a1", "name": "Tower", "status": "offline"}]})
        self.route("/api/v1/gpus", {"gpus": [{"host_id": "local", "name": "RTX 3090", "temperature": 88, "utilization": 97}]})
        d = self.conn("gpuviewr", token=KEY).collect()
        f = facts(d)
        self.assertEqual(d["version"], "0.12.0")
        self.assertEqual((f["Machines"]["value"], f["GPU le plus chaud"]["tone"], f["GPU le plus occupé"]["value"]), ("1/2 en ligne", "bad", "97 %"))
        self.assertEqual(d["problems"], ["machine « Tower » hors ligne", "GPU RTX 3090 (Jarvis) à 88 °C"])
        self.assertEqual(SEEN[-1][2].get("Authorization"), f"Bearer {KEY}")

    def test_api_off(self):
        self.route("/api/v1/health", {"error": "API access is disabled (Settings > API)"}, code=403)
        with self.assertRaises(ConnectorError) as e:
            self.conn("gpuviewr", token=KEY).collect()
        self.assertIn("API désactivée", str(e.exception))


class SpeedtestTracker(Base):
    def test_latest(self):
        at = (datetime.now(timezone.utc) - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S.000000Z")
        self.route("/api/healthcheck", {"message": "Speedtest Tracker is running!"})
        self.route("/api/v1/results/latest", {"data": {"id": 9, "ping": 7.4, "download": 117_500_000, "upload": 87_500_000, "download_bits": 940_000_000,
                                                       "upload_bits": 700_000_000, "healthy": False, "status": "completed", "created_at": at,
                                                       "data": {"isp": "Free SAS"}}, "message": "ok"})
        d = self.conn("speedtest-tracker", token=KEY).collect()
        f = facts(d)
        self.assertEqual((f["Descendant"]["value"], f["Descendant"]["tone"], f["Montant"]["value"], f["Ping"]["value"]), ("940 Mbit/s", "warn", "700 Mbit/s", "7 ms"))
        self.assertEqual((f["Dernier test"]["value"], f["Fournisseur"]["value"]), ("il y a 3 h 00", "Free SAS"))
        self.assertEqual(d["problems"], ["dernier test sous les seuils réglés dans Speedtest Tracker"])

    def test_old_or_failed(self):
        at = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        self.route("/api/healthcheck", {"message": "ok"})
        self.route("/api/v1/results/latest", {"status": "failed", "created_at": at})
        d = self.conn("speedtest-tracker", token=KEY).collect()
        self.assertEqual(d["problems"], ["dernier test en échec", "aucun test depuis 3 j 0 h"])


class NetAlertX(Base):
    def test_totals_and_down(self):
        self.route("/devices/totals", [120, 85, 5, 2, 1, 12])
        self.route("/devices/by-status", [{"devName": "Imprimante", "devLastIP": "10.0.0.7"}])
        d = self.conn("netalertx", token=KEY).collect()
        f = facts(d)
        self.assertEqual((f["Appareils"]["value"], f["Nouveaux"]["tone"], f["Absents (alerte)"]["tone"]), ("120", "warn", "bad"))
        self.assertEqual(d["problems"], ["« Imprimante » absent", "2 nouvel(s) appareil(s) à valider dans NetAlertX"])

    def test_refused(self):
        self.route("/devices/totals", {"success": False, "message": "ERROR: Not authorized", "error": "Forbidden"}, code=403)
        with self.assertRaises(ConnectorError) as e:
            self.conn("netalertx", token="faux").collect()
        self.assertIn("accès refusé", str(e.exception))


class Wazuh(Base):
    def test_agents(self):
        self.route("/security/user/authenticate", {"data": {"token": "jwt"}, "error": 0}, method="POST")
        self.route("/", {"data": {"api_version": "4.14.1", "title": "Wazuh API REST"}})
        self.route("/agents/summary/status", {"data": {"connection": {"active": 4, "disconnected": 1, "never_connected": 1, "pending": 0, "total": 6}}})
        self.route("/agents", {"data": {"affected_items": [{"name": "pc-salon"}], "total_affected_items": 1}})
        d = self.conn("wazuh", username="myservices", password=KEY).collect()
        f = facts(d)
        self.assertEqual(d["version"], "4.14.1")
        self.assertEqual((f["Agents"]["value"], f["Agents"]["tone"]), ("4/6 actifs", "bad"))
        self.assertEqual(d["problems"], ["agent « pc-salon » déconnecté", "1 agent(s) jamais connecté(s)"])
        self.assertEqual(SEEN[0][0], "POST")
        self.assertTrue(SEEN[0][2].get("Authorization", "").startswith("Basic "))
        self.assertEqual(SEEN[-1][2].get("Authorization"), "Bearer jwt")


class Analytics(Base):
    def test_umami(self):
        self.route("/api/auth/login", {"token": "tok", "user": {"username": "myservices"}}, method="POST")
        self.route("/api/websites", {"data": [{"id": "a", "name": "blog"}, {"id": "b", "name": "vieux"}], "count": 2})
        self.route("/api/websites/a/stats", {"pageviews": {"value": 120, "prev": 100}, "visitors": {"value": 40, "prev": 30}})
        self.route("/api/websites/b/stats", {"pageviews": 0, "visitors": 0})   # Umami 3: bare numbers
        d = self.conn("umami", username="myservices", password=KEY).collect()
        f = facts(d)
        self.assertEqual((f["Sites"]["value"], f["Visiteurs (24 h)"]["value"], f["Pages vues (24 h)"]["value"]), ("2", "40", "120"))
        self.assertEqual(d["problems"], ["site « vieux » : aucune page vue en 24 h (script de suivi absent ?)"])
        self.assertEqual(SEEN[-1][2].get("Authorization"), "Bearer tok")

    def test_rybbit(self):
        self.route("/api/organizations", [{"id": "org1", "name": "Moi"}])
        self.route("/api/organizations/org1/sites", [{"siteId": 1, "name": "echosystem"}])
        self.route("/api/sites/1/overview", {"data": {"users": 15, "pageviews": 60, "sessions": 20}})
        d = self.conn("rybbit", api_key=KEY).collect()
        self.assertEqual(facts(d)["Le plus visité"]["value"], "echosystem (60 pages)")
        self.assertIn("past_minutes_start=1440", SEEN[-1][1])

    def test_rybbit_given_sites(self):
        self.route("/api/sites/7/overview", {"data": {"users": 0, "pageviews": 0}})
        d = self.conn("rybbit", api_key=KEY, sites="7").collect()
        self.assertEqual(len(d["problems"]), 1)
        self.assertNotIn("/api/organizations", [s[1] for s in SEEN])


class Tautulli(Base):
    def r(self, cmd, data, result="success"):
        self.route(f"/api/v2?apikey={KEY}&cmd={cmd}", {"response": {"result": result, "message": None, "data": data}})

    def test_plex_and_streams(self):
        self.r("get_tautulli_info", {"tautulli_version": "v2.15.2"})
        self.r("get_server_status", {"connected": False})
        self.r("get_activity", {"stream_count": "2", "stream_count_transcode": 1})
        self.r("update_check", {"update": True})
        d = self.conn("tautulli", api_key=KEY).collect()
        f = facts(d)
        self.assertEqual(d["version"], "2.15.2")
        self.assertEqual((f["Plex"]["tone"], f["Lectures en cours"]["value"]), ("bad", "2"))
        self.assertEqual(d["problems"], ["Tautulli ne joint plus Plex", "mise à jour de Tautulli disponible"])


class MiniServ(BaseHTTPRequestHandler):
    server_version, sys_version = "MiniServ/2.302", ""   # the Server header sent by send_response()

    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()


class Webmin(unittest.TestCase):
    def test_version_from_header(self):
        srv = HTTPServer(("127.0.0.1", 0), MiniServ)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            c = connectors.TYPES["webmin"]({"type": "webmin", "name": "w", "url": f"http://127.0.0.1:{srv.server_port}"}, Context(timeout=5))
            d = c.collect()
        finally:
            srv.shutdown()
        self.assertEqual(d["version"], "2.302")
        self.assertEqual(d["problems"], [])

    def test_not_webmin(self):
        srv = HTTPServer(("127.0.0.1", 0), type("Quiet", (BaseHTTPRequestHandler,), {"log_message": lambda *a: None}))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            with self.assertRaises(ConnectorError):
                connectors.TYPES["webmin"]({"type": "webmin", "name": "w", "url": f"http://127.0.0.1:{srv.server_port}"}, Context(timeout=5)).collect()
        finally:
            srv.shutdown()
