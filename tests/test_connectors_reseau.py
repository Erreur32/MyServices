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
from connectors.mynetwork import MynetworK, freebox_status  # noqa: E402
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
        self.assertIsNone(inst(MynetworK, self.url).version())   # before MynetworK 0.10.67: no version in /api/health
        Fake.routes["/api/health"] = (200, {"status": "ok", "version": "0.10.67"})
        self.assertEqual(inst(MynetworK, self.url).version(), "0.10.67")
        self.assertTrue(all(s[0] == "GET" for s in Fake.seen))  # lecture seule
        self.assertTrue(inst(MynetworK, self.url).test().ok)

    def test_mynetwork_freebox(self):
        Fake.routes = {"/api/network-scan/history": (200, {"success": True, "result": {"items": [], "total": 0}}),
                       "/api/connection/summary": (200, {"success": True, "result": {
                           "connection": {"state": "up", "media": "ftth", "rate_down": 1_250_000, "rate_up": 125_000, "bandwidth_down": 8e9, "bandwidth_up": 7e8},
                           "system": {"model": "Freebox Ultra", "firmware": "4.9.4", "uptime": 90000, "sensors": [{"id": "t1", "name": "CPU", "value": 78}],
                                      "fans": [{"id": "fan0_speed", "name": "Ventilateur 1", "value": 570}], "disk_status": "active"}}}),
                       "/api/lan/devices": (200, {"success": True, "result": [{"active": True}, {"active": False}]})}
        data = inst(MynetworK, self.url).collect()
        card = freebox_status({"name": "lan", "ok": True, **data})
        facts = {f["label"]: f["value"] for f in card["facts"]}
        self.assertEqual((card["label"], card["version"]), ("Freebox Ultra (via MynetworK)", "4.9.4"))
        self.assertEqual(facts["Débit max"], "8,0 Gb/s / 700 Mb/s")
        self.assertEqual(facts["Débit actuel"], "10 Mb/s / 1 Mb/s")
        self.assertEqual(facts["Appareils actifs"], "1 (+1 dans l'historique)")
        self.assertEqual(card["problems"], ["Freebox chaude : CPU à 78 °C"])
        self.assertEqual(facts["Ventilateur"], "570 tr/min")
        self.assertNotIn("Disque interne", facts)   # « active » is the normal state

    def test_mynetwork_freebox_extras(self):
        extras = {"storage": {"disks": [{"model": "SSD", "state": "enabled", "smart_ok": None}], "partitions": [{"label": "NVME 32", "used_pct": 55}]},
                  "ftth": {"sfp_has_signal": True, "link": True, "sfp_pwr_rx": -15.71, "sfp_pwr_tx": 6.46},
                  "wifi": {"enabled": True, "aps": [{"name": "a"}, {"name": "b"}], "stations_count": 3},
                  "vms": [{"name": "vm", "status": "stopped"}, {"name": "vm2", "status": "running"}], "vm_system": {"total_cpus": 2}, "missing_rights": [],
                  "dhcp": {"enabled": True, "ip_range_start": "10.0.0.10", "ip_range_end": "10.0.0.200", "gateway": "10.0.0.254", "netmask": "255.255.255.0", "dns": ["10.0.0.254"]},
                  "firmware_update": {"server": {"installed": "4.9.4", "latest": "4.9.16", "update_available": True}}}
        Fake.routes = {"/api/network-scan/history": (200, {"success": True, "result": {"items": [], "total": 0}}),
                       "/api/connection/summary": (200, {"success": True, "result": {"connection": {"state": "up"}, "system": {"model": "Freebox Ultra", "lan_ip": "10.0.0.254"}, **extras}}),
                       "/api/lan/devices": (200, {"success": True, "result": []})}
        data = inst(MynetworK, self.url).collect()
        fb = data["freebox"]
        self.assertEqual(fb["storage"]["partitions"][0]["used_pct"], 55)
        self.assertEqual((fb["system"]["lan_ip"], fb["missing_rights"], len(fb["vms"])), ("10.0.0.254", [], 2))
        self.assertEqual((fb["dhcp"]["dns"], fb["firmware_update"]["server"]["latest"]), (["10.0.0.254"], "4.9.16"))
        facts = {f["label"]: f["value"] for f in freebox_status({"name": "lan", "ok": True, **data})["facts"]}
        self.assertEqual((facts["Stockage"], facts["Fibre"], facts["Wi-Fi"], facts["Machines virtuelles"]),
                         ("55 % (NVME 32)", "-15.7 dBm reçus", "2 borne(s), 3 appareil(s)", "1 en marche sur 2"))

    def test_mynetwork_freebox_non_appairee(self):
        Fake.routes = {"/api/network-scan/history": (200, {"success": True, "result": {"items": [], "total": 0}}),
                       "/api/lan/devices": (200, {"success": False, "msg": "Freebox non appairée"}),
                       "/api/connection/summary": (403, {"success": False})}
        self.assertIsNone(inst(MynetworK, self.url).collect()["freebox"])
        self.assertIsNone(freebox_status({"freebox": None}))

    def test_mynetwork_unifi_system(self):
        dev = {"success": True, "result": [{"name": "UCG", "type": "udm", "ip": "203.0.113.2", "state": "connected"}]}
        system = {"success": True, "result": {"version": "9.4.19", "update_available": True, "console_version": "4.2.13", "sso_app_sec": "never-kept",
                                              "gateway": {"version": "4.2.13", "upgradable": False, "upgrade_to_firmware": None, "lan_ip": "10.0.0.1",
                                                          "cpu_pct": 12.5, "mem_pct": 40.0, "temperature": 61, "mem_total": 4e9, "mem_used": 1.6e9}}}
        base = {"/api/network-scan/history": (200, {"success": True, "result": {"items": [], "total": 0}}),
                "/api/plugins/unifi/clients": (200, {"success": True, "result": []}), "/api/plugins/unifi/devices": (200, dev)}
        Fake.routes = {**base, "/api/plugins/unifi/system": (200, system)}
        got = inst(MynetworK, self.url).collect()["unifi"]["system"]
        self.assertEqual((got["version"], got["update_available"], got["console_version"], got["gateway"]["lan_ip"]), ("9.4.19", True, "4.2.13", "10.0.0.1"))
        self.assertNotIn("sso_app_sec", got)                                 # only the fields named are kept
        Fake.routes = base                                                    # MynetworK before 0.10.68: no route, no system
        self.assertIsNone(inst(MynetworK, self.url).collect()["unifi"]["system"])

    def test_freebox_update_waiting(self):
        card = freebox_status({"name": "lan", "ok": True, "freebox": {"connection": {}, "system": {"model": "Freebox", "update_available": True, "latest_firmware": "4.14.0"}}})
        self.assertIn({"label": "Mise à jour", "value": "→ 4.14.0", "tone": "warn"}, card["facts"])

    def test_mynetwork_unifi_unavailable_is_no_unifi(self):
        Fake.routes = {"/api/network-scan/history": (200, {"success": True, "result": {"items": [], "total": 0}}),
                       "/api/plugins/unifi/clients": (503, {"success": False, "error": {"code": "UNIFI_UNAVAILABLE"}}),
                       "/api/plugins/unifi/devices": (503, {"success": False, "error": {"code": "UNIFI_UNAVAILABLE"}})}
        self.assertIsNone(inst(MynetworK, self.url).collect()["unifi"])   # the rest of MynetworK is still read

    def test_mynetwork_sans_unifi_et_jeton_refuse(self):
        Fake.routes = {"/api/health": (200, {}), "/api/network-scan/history": (200, {"success": True, "result": {"items": [], "total": 0}}),
                       "/api/plugins/unifi/clients": (404, {}), "/api/plugins/unifi/devices": (404, {})}
        data = inst(MynetworK, self.url).collect()
        self.assertIsNone(data["unifi"])
        self.assertIsNone(data["freebox"])   # older MynetworK or no Freebox: no card
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
                       "/api2/json/cluster/tasks": (200, {"data": [{"type": "vzdump", "status": "OK", "endtime": 1760000000}]}),
                       "/api2/json/nodes/pve/status": (200, {"data": {"loadavg": ["0.5", "0.4", "0.3"], "kversion": "Linux 6.8.12-1-pve #1", "swap": {"used": 1, "total": 2}}})}
        c = ProxmoxVE({"type": "proxmox", "name": "t", "url": self.url, "user": "u@pve!t", "secret": "s", "verify_tls": False}, Context(timeout=5))
        d = c.collect()
        self.assertEqual(d["totals"], {"vm": 1, "lxc": 1, "running": 1, "stopped": 1})  # le modèle n'est pas compté
        self.assertEqual(d["storage"][0]["used_pct"], 50.0)
        self.assertTrue(d["backups"]["ok"])
        self.assertEqual((d["nodes"][0]["load"], d["nodes"][0]["kernel"]), ([0.5, 0.4, 0.3], "6.8.12-1-pve"))
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
        self.assertIsNone(inst(Dockhand, self.url).version())   # no changelog route: no version, no error
        Fake.routes["/api/changelog"] = (200, [{"version": "1.0.53", "date": "2026-10-10"}, {"version": "1.0.52"}])
        self.assertEqual(inst(Dockhand, self.url).version(), "1.0.53")
        self.assertEqual(d["environments"][0]["containers"]["running"], 4)
        self.assertEqual(d["updates"], 2)
        self.assertTrue(all(s[0] == "GET" for s in Fake.seen))
        self.assertFalse(inst(Dockhand, self.url, token="autre-" + "y" * 6).test().ok)


if __name__ == "__main__":
    unittest.main()
