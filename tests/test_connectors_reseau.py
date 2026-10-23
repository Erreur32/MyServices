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

    def _send(self, code, obj, headers=None):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
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
                    "log_list_sources": {"sources": [{"id": "nginx"}, {"id": "auth"}]},
                    "f2b_lookup_ip": {"ip": "203.0.113.5", "geo": {"countryCode": "NL", "country": "ignore-me", "org": "ignore-me"}, "whois": {"asn": "AS64500", "org": "<b>ignore</b>"}},
                    "log_list_files": {"files": [{"pluginId": "npm", "path": "/host/logs/big.log", "type": "access", "size": 15317565, "modified": "2026-10-18T13:46:19.573Z", "content": "ignore-me"}]},
                    "log_search": {"matches": [{"domain": "app.example.test:443", "content": "ignore-me"}]}}[name]
            res = {"content": [{"type": "text", "text": json.dumps(data)}]}
            args = body["params"].get("arguments") or {}
            if name == "f2b_get_ban_history" and args.get("limit", 0) > 1000:   # as LogviewR does: a call asking for more than 1000 is refused
                res = {"isError": True, "content": [{"type": "text", "text": "Too big: expected number to be <=1000 at limit"}]}
            if name == "log_search" and "npm" not in (args.get("pluginIds") or []):   # without the web log plugins the hits are all Fail2ban's own log
                res = {"content": [{"type": "text", "text": json.dumps({"matches": [{"pluginId": "host-system", "fileName": "fail2ban.log"}]})}]}
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

    def test_mynetwork_429_is_rate_limited_with_its_delay(self):
        from connectors.base import RateLimited
        from connectors import reqstats
        reqstats.reset()
        Fake.routes = {"/api/search/ip-details/192.168.1.20": (429, {"success": False, "error": {"code": "RATE_LIMITED", "message": "Too many requests for this API token"}}, {"Retry-After": "7"})}
        c = inst(MynetworK, self.url)
        with self.assertRaises(RateLimited) as got:
            c.ip_details("192.168.1.20")   # optional routes swallow 403 / 404 / 503, never a 429
        self.assertEqual(got.exception.retry_after, 7)
        self.assertIn("Too many requests", str(got.exception))
        self.assertIsInstance(got.exception, ConnectorError)   # the callers that only know ConnectorError still catch it
        [row] = reqstats.snapshot()["rows"]
        self.assertEqual((row["owner"], row["route"], row["last_code"], row["n429"], row["retry_after"]), ("mynetwork/t", "/api/search/ip-details/*", 429, 1, 7))

    def test_mynetwork_counts_its_calls_and_reads_the_freebox_hosts_compact(self):
        from connectors import reqstats
        reqstats.reset()
        Fake.seen = []
        Fake.routes = {"/api/network-scan/history": (200, {"success": True, "result": {"items": [], "total": 0}}),
                       "/api/connection/summary": (200, {"success": True, "result": {"connection": {"state": "up"}, "system": {}}}),
                       "/api/lan/devices": (200, {"success": True, "result": [{"active": True}], "total": 1})}
        inst(MynetworK, self.url).collect()
        self.assertIn(("GET", "/api/lan/devices?compact=1"), Fake.seen)   # the compact form: only counted here
        rows = {r["route"]: r for r in reqstats.snapshot()["rows"]}
        self.assertEqual(rows["/api/lan/devices"]["last_code"], 200)
        self.assertEqual(rows["/api/plugins/unifi/clients"]["last_code"], 404)
        self.assertGreaterEqual(rows["/api/network-scan/history"]["per_min"], 1)

    def test_mynetwork_inventory_paginated_by_the_real_total(self):
        from connectors import mynetwork as mn
        items = [{"id": i, "ip": f"10.0.{i // 250}.{i % 250}", "status": "online"} for i in range(mn.PAGE)]
        Fake.seen = []
        Fake.routes = {"/api/network-scan/history": (200, {"success": True, "result": {"items": items, "total": mn.PAGE + 1}})}
        devices = inst(MynetworK, self.url).scan()
        asked = [p for m, p in Fake.seen if p.startswith("/api/network-scan/history")]
        self.assertEqual(len(asked), 2)   # the total says a second page exists: asked with its offset
        self.assertIn(f"offset={mn.PAGE}", asked[1])
        self.assertEqual(len(devices), 2 * mn.PAGE)   # the fake server gives the same page twice; a real one gives the last item

    def test_mynetwork_device_drops_dates_that_are_not_dates(self):
        from connectors.mynetwork import device
        d = device({"ip": "10.0.0.7", "firstSeen": {}, "lastSeen": "2026-10-22T22:03:21Z", "additionalInfo": {"lastPortScan": {}}})
        self.assertEqual((d["first_seen"], d["last_seen"], d["ports_at"]), (None, "2026-10-22T22:03:21Z", None))

    def test_registre(self):
        for t in ("mynetwork", "logviewr", "dockhand", "proxmox", "proxmox-backup"):
            self.assertIn(t, connectors.TYPES)
        self.assertEqual(connectors.TYPES["mynetwork"].kinds, ("network",))

    def test_mynetwork_stays_read_when_its_unifi_routes_fail(self):
        item = {"id": 1, "ip": "192.168.1.20", "status": "online"}
        Fake.routes = {"/api/health": (200, {"status": "ok"}),
                       "/api/network-scan/history": (200, {"success": True, "result": {"items": [item], "total": 1}}),
                       "/api/plugins/unifi/clients": (500, {"success": False}), "/api/plugins/unifi/devices": (500, {"success": False}),
                       "/api/plugins/unifi/system": (500, {"success": False})}
        data = inst(MynetworK, self.url).collect()
        self.assertEqual((len(data["devices"]), data["unifi"]), (1, None))   # the inventory is kept, UniFi is left out for this pass
        self.assertIn("500", data["unifi_error"])
        res = inst(MynetworK, self.url).test()
        self.assertTrue(res.ok)
        self.assertIn("UniFi indisponible", res.message)

    def test_mynetwork_inventaire_et_unifi(self):
        item = {"id": 1, "ip": "192.168.1.20", "mac": "aa:bb:cc:dd:ee:ff", "hostname": "nas", "vendor": "Synology", "status": "online",
                "pingLatency": 1.4, "additionalInfo": {"openPorts": [22, {"port": 80, "protocol": "tcp"}, {"port": "x"}, "x"], "lastPortScan": "2026-10-17T22:04:57.703Z", "secret": "no"}}
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

    def test_logviewr_ban_statistics(self):
        from connectors.logviewr import ban_stats
        now = 1_800_000_000
        ev = [{"ip": "203.0.113.5", "jail": "sshd", "timeofban": now - 600, "failures": 5}, {"ip": "203.0.113.5", "jail": "nginx", "timeofban": now - 7200, "failures": 3},
              {"ip": "198.51.100.7", "jail": "sshd", "timeofban": now - 3 * 86400}, {"ip": "198.51.100.8", "jail": "sshd", "timeofban": now - 9 * 86400},
              {"ip": "<script>", "jail": "sshd", "timeofban": now - 60}, {"ip": "203.0.113.9", "jail": "sshd", "timeofban": now + 500}]
        st = ban_stats(ev, now)
        self.assertEqual((sum(st["hours"]), sum(st["days"]), st["hours"][23], st["hours"][21], st["days"][6]), (2, 3, 1, 1, 2))
        self.assertEqual((st["unique_1d"], st["unique_7d"], st["repeat"], st["failures_1d"]), (1, 2, 1, 8))
        self.assertEqual(st["by_jail"][0], {"jail": "sshd", "d1": 1, "d7": 2})
        self.assertEqual(st["top_ips"][0]["ip"], "203.0.113.5")
        self.assertEqual(st["top_ips"][0]["jails"], ["nginx", "sshd"])
        self.assertEqual(ban_stats([], now)["unique_7d"], 0)

    def test_logviewr_domains_come_from_the_domain_field_only(self):
        from connectors.logviewr import add_domains, attack_domains
        self.assertEqual(attack_domains([{"domain": "App.Example.test:443"}, {"domain": "app.example.test"}, {"domain": "<b>x</b>"}, {"content": "evil.test"}, {"domain": 5}, "x"]), {"app.example.test": 2})
        stats = {"top_ips": [{"ip": "203.0.113.5"}, {"ip": "198.51.100.7"}]}
        out = add_domains(stats, lambda ip: [{"domain": "a.test"}, {"domain": "b.test"}] if ip.startswith("203") else [{"domain": "a.test"}])
        self.assertEqual(out["top_ips"][0]["domains"], [{"domain": "a.test", "hits": 1}, {"domain": "b.test", "hits": 1}])
        self.assertEqual(out["by_domain"][0], {"domain": "a.test", "hits": 2, "ips": 2})
        def broken(ip):
            raise ConnectorError("down")
        self.assertEqual(add_domains({"top_ips": [{"ip": "203.0.113.5"}]}, broken)["top_ips"][0]["domains"], [])

    def test_logviewr_origin_keeps_the_country_code_and_the_as_number_only(self):
        from connectors.logviewr import add_origins, origin_of
        self.assertEqual(origin_of({"geo": {"countryCode": "nl", "org": "Infraly, LLC"}, "whois": {"asn": "AS64500", "org": "<b>x</b>"}}), {"country": "NL", "asn": "AS64500", "org": "Infraly, LLC"})
        self.assertEqual(origin_of({"geo": {"org": "<script>alert(1)</script> Evil; DROP"}})["org"], "scriptalert1script Evil DROP")   # no markup, no instructions
        self.assertEqual(len(origin_of({"geo": {"org": "x" * 200}})["org"]), 48)
        self.assertEqual(origin_of({"whois": {"asn": "64500", "country": "DE"}}), {"country": "DE", "asn": "AS64500", "org": None})
        self.assertEqual(origin_of({"geo": {"countryCode": "<script>"}, "whois": {"asn": "AS1; drop"}}), {"country": None, "asn": None, "org": None})
        stats = {"top_ips": [{"ip": "203.0.113.5"}, {"ip": "198.51.100.7"}]}

        def lookup(ip):
            if ip.startswith("198"):
                raise ConnectorError("down")
            return {"geo": {"countryCode": "FR"}, "whois": {"asn": "AS3215"}}
        out = add_origins(stats, lookup)
        self.assertEqual((out["top_ips"][0]["country"], out["top_ips"][0]["asn"]), ("FR", "AS3215"))
        self.assertEqual((out["top_ips"][1]["country"], out["top_ips"][1]["asn"]), (None, None))

    def test_logviewr_ne_lit_que(self):
        c = inst(LogviewR, self.url)
        data = c.collect()
        self.assertEqual(data["jails"], ["sshd", "nginx"])
        self.assertEqual(data["bans_24h"], 1)
        self.assertNotIn("ignore-me", json.dumps(data))  # pas de texte libre
        self.assertEqual(data["log_sources"], 2)
        self.assertEqual(data["threats"][0]["domains"], ["app.example.test"])   # looked up for the threat's own addresses
        self.assertEqual(data["big_logs"], [{"plugin": "npm", "path": "/host/logs/big.log", "size": 15317565, "modified": "2026-10-18T13:46:19.573Z"}])   # sizes only, no content
        self.assertIsNotNone(data["stats"])   # the week of history was accepted (LogviewR refuses a limit above 1000)
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

    def test_mynetwork_fiche_adresse(self):
        sheet = {"ip": "192.168.1.20", "scan": {"status": "online", "pingLatency": 1.2}, "freeboxDevice": {"name": "nas", "apiKey": "no", "access": {"token": "no"}},
                 "dhcpLease": {"mac": "aa:bb", "wifiPassword": "no"}, "redirects": [{"lan_port": 22, "secret": "no"}]}
        Fake.routes = {"/api/search/ip-details/192.168.1.20": (200, {"success": True, "result": sheet})}
        c = inst(MynetworK, self.url)
        got = c.ip_details("192.168.1.20")
        self.assertEqual(got["scan"]["status"], "online")
        self.assertEqual(got["dhcpLease"], {"mac": "aa:bb"})
        self.assertEqual(got["redirects"], [{"lan_port": 22}])
        self.assertNotIn("no", json.dumps(got))
        self.assertIsNone(c.ip_details("192.168.1.21"))          # route open but nothing there: 404 is "absent", not an error
        Fake.seen.clear()
        self.assertIsNone(c.ip_details("../etc/passwd"))         # not an address: no request at all
        self.assertEqual(Fake.seen, [])
        Fake.routes = {"/api/search/ip-details/192.168.1.20": (403, {"success": False, "error": {"code": "API_TOKEN_ROUTE_NOT_ALLOWED"}})}
        self.assertIsNone(c.ip_details("192.168.1.20"))          # not open to API tokens yet

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
