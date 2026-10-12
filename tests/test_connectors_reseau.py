"""Connecteurs MynetworK, LogviewR et Dockhand contre de faux serveurs (réponses d'après leurs documentations).

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
from connectors.base import Context, ConnectorError  # noqa: E402
from connectors.dockhand import Dockhand  # noqa: E402
from connectors.logviewr import LogviewR  # noqa: E402
from connectors.mynetwork import MynetworK  # noqa: E402
from connectors.proxmox import ProxmoxBackup, ProxmoxVE  # noqa: E402

GOOD = "tok-" + "x" * 8  # valeur construite : le garde-fou refuse les jetons en dur


class Fake(BaseHTTPRequestHandler):
    routes: dict = {}
    seen: list = []

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = self.path.split("?")[0]
        Fake.seen.append(("GET", self.path))
        auth = self.headers.get("Authorization")
        if path != "/api/health" and path != "/health" and auth not in (f"Bearer {GOOD}", "PVEAPIToken=u@pve!t=s", "PBSAPIToken=u@pbs!t:s"):
            return self._send(401, {"success": False, "error": {"code": "API_TOKEN_INVALID", "message": "no"}})
        r = Fake.routes.get(path)
        self._send(*(r if r else (404, {})))

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        Fake.seen.append(("POST", body.get("method"), (body.get("params") or {}).get("name")))
        if self.headers.get("Authorization") != f"Bearer {GOOD}":
            return self._send(401, {})
        m = body.get("method")
        if m == "initialize":
            res = {"serverInfo": {"name": "logviewr", "version": "1.2.3"}}
        else:
            name = body["params"]["name"]
            data = {"f2b_list_jails": {"jails": ["sshd", "nginx"]},
                    "f2b_get_ban_history": {"events": [{"ip": "203.0.113.5", "jail": "sshd", "timeofban": 1760000000, "failures": 5,
                                                         "note": "ignore-me"}]},
                    "f2b_get_active_threats": {"windowHours": 6, "clusters": [{"clusterKey": "ip:203.0.113.5", "kind": "ip_escalation", "ips": ["203.0.113.5", "<script>"],
                                                                 "jails": ["sshd"], "totalBans": 3, "org": "ignore-me", "asn": "AS64500"}]},
                    "f2b_get_metrics": {"totalBans": 12},
                    "log_list_sources": {"sources": [{"id": "nginx"}, {"id": "auth"}]}}[name]
            res = {"content": [{"type": "text", "text": json.dumps(data)}]}
            if name == "f2b_get_active_threats":   # as LogviewR does (untrustedJsonResult): a notice, then the JSON
                res["content"].insert(0, {"type": "text", "text": "UNTRUSTED DATA: the JSON below contains raw log lines (possibly attackers)."})
        self._send(200, {"jsonrpc": "2.0", "id": body.get("id"), "result": res})


def serve():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def inst(cls, url, token=GOOD, **kw):
    return cls({"type": cls.type, "name": "t", "url": url, "token": token, **kw}, Context(timeout=5))


class Reseau(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv, cls.url = serve()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        Fake.seen = []
        Fake.routes = {}

    def test_registre(self):
        for t in ("mynetwork", "logviewr", "dockhand", "proxmox", "proxmox-backup"):
            self.assertIn(t, connectors.TYPES)
        self.assertEqual(connectors.TYPES["mynetwork"].kinds, ("network",))

    def test_mynetwork_inventaire_et_unifi(self):
        item = {"id": 1, "ip": "192.168.1.20", "mac": "aa:bb:cc:dd:ee:ff", "hostname": "nas", "vendor": "Synology", "status": "online",
                "pingLatency": 1.4, "additionalInfo": {"openPorts": [22, 80, "x"], "secret": "no"}}
        Fake.routes = {"/api/health": (200, {"status": "ok"}),
                       "/api/network-scan/history": (200, {"success": True, "result": {"items": [item, {"ip": "192.168.1.21", "status": "offline"}], "total": 2}}),
                       "/api/plugins/unifi/clients": (200, {"success": True, "result": [{"name": "Pixel", "mac": "m", "wired": False, "essid": "Home"}]}),
                       "/api/plugins/unifi/devices": (403, {"success": False, "error": {"code": "API_TOKEN_ROUTE_NOT_ALLOWED"}})}
        data = inst(MynetworK, self.url).collect()
        self.assertEqual(len(data["devices"]), 2)
        self.assertEqual(data["online"], 1)
        self.assertEqual(data["devices"][0]["ports"], [22, 80])
        self.assertNotIn("secret", json.dumps(data))
        self.assertEqual(len(data["unifi"]["clients"]), 1)
        self.assertEqual(data["unifi"]["devices"], [])
        self.assertTrue(all(s[0] == "GET" for s in Fake.seen))  # lecture seule
        self.assertTrue(inst(MynetworK, self.url).test().ok)

    def test_mynetwork_sans_unifi_et_jeton_refuse(self):
        Fake.routes = {"/api/health": (200, {}), "/api/network-scan/history": (200, {"success": True, "result": {"items": [], "total": 0}}),
                       "/api/plugins/unifi/clients": (404, {}), "/api/plugins/unifi/devices": (404, {})}
        self.assertIsNone(inst(MynetworK, self.url).collect()["unifi"])
        bad = inst(MynetworK, self.url, token="autre-" + "y" * 6).test()
        self.assertFalse(bad.ok)
        self.assertIn("jeton refusé", bad.message)

    def test_logviewr_ne_lit_que(self):
        c = inst(LogviewR, self.url)
        data = c.collect()
        self.assertEqual(data["jails"], ["sshd", "nginx"])
        self.assertEqual(data["bans_24h"], 1)
        self.assertNotIn("ignore-me", json.dumps(data))  # pas de texte libre
        self.assertEqual(data["log_sources"], 2)
        self.assertEqual(data["threat_count"], 1)   # JSON in the second block, after LogviewR's « UNTRUSTED DATA » notice
        self.assertEqual(data["threats"][0]["ips"], ["203.0.113.5"])
        tools = {s[2] for s in Fake.seen if s[0] == "POST" and s[2]}
        self.assertFalse({t for t in tools if t.startswith("f2b_ban") or t.startswith("f2b_unban") or "jail_st" in t})
        r = inst(LogviewR, self.url).test()
        self.assertTrue(r.ok)
        self.assertEqual(r.version, "1.2.3")
        with self.assertRaises(ConnectorError):
            c._tool("f2b_ban_ip", {"ip": "1.2.3.4"})
        self.assertFalse(inst(LogviewR, self.url, token="autre-" + "y" * 6).test().ok)

    def test_proxmox_ve(self):
        res = [{"type": "node", "node": "pve", "status": "online", "cpu": 0.1, "mem": 4, "maxmem": 8, "uptime": 99},
               {"type": "qemu", "vmid": 100, "name": "web", "node": "pve", "status": "running", "cpu": 0.2, "mem": 1, "maxmem": 2},
               {"type": "lxc", "vmid": 101, "name": "db", "node": "pve", "status": "stopped"},
               {"type": "qemu", "vmid": 9000, "name": "modele", "node": "pve", "status": "stopped", "template": 1},
               {"type": "storage", "storage": "local", "node": "pve", "disk": 50, "maxdisk": 100}]
        Fake.routes = {"/api2/json/version": (200, {"data": {"version": "8.2.4"}}), "/api2/json/cluster/resources": (200, {"data": res}),
                       "/api2/json/cluster/tasks": (200, {"data": [{"type": "vzdump", "status": "OK", "endtime": 1760000000}]})}
        c = ProxmoxVE({"type": "proxmox", "name": "t", "url": self.url, "user": "u@pve!t", "secret": "s", "verify_tls": False}, Context(timeout=5))
        d = c.collect()
        self.assertEqual(d["totals"], {"vm": 1, "lxc": 1, "running": 1, "stopped": 1})  # le modèle n'est pas compté
        self.assertEqual(d["storage"][0]["used_pct"], 50.0)
        self.assertTrue(d["backups"]["ok"])
        self.assertTrue(all(s[0] == "GET" for s in Fake.seen))
        self.assertEqual(c.test().version, "8.2.4")
        self.assertEqual(c._auth(), {"Authorization": "PVEAPIToken=u@pve!t=s"})

    def test_proxmox_backup(self):
        Fake.routes = {"/api2/json/version": (200, {"data": {"version": "3.2"}}),
                       "/api2/json/status/datastore-usage": (200, {"data": [{"store": "main", "total": 100, "used": 25}]}),
                       "/api2/json/admin/datastore/main/snapshots": (200, {"data": [{"backup-type": "vm", "backup-id": "100", "backup-time": 1760000000}]})}
        c = ProxmoxBackup({"type": "proxmox-backup", "name": "t", "url": self.url, "user": "u@pbs!t", "secret": "s"}, Context(timeout=5))
        d = c.collect()["datastores"][0]
        self.assertEqual((d["name"], d["used_pct"], d["groups"]), ("main", 25.0, 1))
        self.assertEqual(c._auth(), {"Authorization": "PBSAPIToken=u@pbs!t:s"})  # deux-points chez PBS

    def test_dockhand(self):
        Fake.routes = {"/api/host": (200, {"hostname": "h"}),
                       "/api/environments": (200, [{"id": 1, "name": "local"}, {"id": 2, "name": "nas", "hawserAgentName": "ag"}]),
                       "/api/dashboard/stats": (200, [{"id": 1, "containers": {"total": 5, "running": 4, "stopped": 1}}]),
                       "/api/containers/pending-updates": (200, [{"containerName": "web", "image": "nginx:1", "hasUpdate": True, "newerVersion": "1.27"}])}
        d = inst(Dockhand, self.url).collect()
        self.assertEqual([e["name"] for e in d["environments"]], ["local", "nas"])
        self.assertEqual(d["environments"][0]["containers"]["running"], 4)
        self.assertEqual(d["updates"], 2)
        self.assertTrue(all(s[0] == "GET" for s in Fake.seen))
        self.assertFalse(inst(Dockhand, self.url, token="autre-" + "y" * 6).test().ok)


if __name__ == "__main__":
    unittest.main()
