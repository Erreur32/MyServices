"""Connecteurs : registre, isolation (délai, erreur, dernier résultat bon), versions, et NPM contre un faux
NPM qui rejoue de vraies réponses anonymisées (tests/fixtures/npm/lists.json).

  python3 -m unittest discover -s tests
"""
import json
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import connectors  # noqa: E402
from connectors.base import Connector, ConnectorError, Context, run_isolated, version_tested  # noqa: E402

LISTS = json.loads((ROOT / "tests/fixtures/npm/lists.json").read_text())
PATHS = {"proxy-hosts": "hosts", "redirection-hosts": "redirects", "dead-hosts": "dead", "streams": "streams",
         "access-lists": "acls"}


class FakeNPM(BaseHTTPRequestHandler):
    """/api/ (version), /api/tokens (connexion), /api/nginx/<liste> avec jeton."""
    version = {"major": 2, "minor": 16, "revision": 0}

    def reply(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/api/":
            return self.reply(200, {"status": "OK", "version": self.version})
        if self.headers.get("Authorization") != "Bearer jeton":
            return self.reply(401, {"error": {"message": "Unauthorized"}})
        key = PATHS.get(self.path.split("/")[-1])
        return self.reply(200, LISTS[key]) if key else self.reply(404, {"error": {"message": "Not found"}})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if body == {"identity": "a@b", "secret": "bon"}:
            return self.reply(200, {"token": "jeton"})
        return self.reply(401, {"error": {"message": "Invalid email or password"}})

    def log_message(self, *a):
        pass


class Npm(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeNPM)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def conn(self, password="bon"):
        cfg = {"npm": [{"name": "lan", "url": self.url, "user": "a@b", "password": password}]}
        return connectors.instances(cfg)[0]

    def test_collect_and_version(self):
        c = self.conn()
        got = c.collect()
        self.assertEqual({k: len(v) for k, v in got.items()}, {k: len(v) for k, v in LISTS.items()})
        self.assertEqual(c.version(), "2.16.0")
        r = c.test()
        self.assertTrue(r.ok)
        self.assertIn("proxy hosts", r.message)

    def test_wrong_password(self):
        r = self.conn("faux").test()
        self.assertFalse(r.ok)
        self.assertIn("401", r.message)

    def test_untested_version_flagged(self):
        FakeNPM.version = {"major": 3, "minor": 0, "revision": 1}
        try:
            data, st = run_isolated(self.conn(), {}, 10)
        finally:
            FakeNPM.version = {"major": 2, "minor": 16, "revision": 0}
        self.assertTrue(st.ok)
        self.assertEqual((st.version, st.version_tested), ("3.0.1", False))

    def test_secret_never_public(self):
        c = self.conn()
        self.assertEqual(type(c).public(c.conf)["password"], "configuré")


class Slow(Connector):
    type, label, kinds = "lent", "Lent", ("services",)

    def collect(self):
        mode = self.conf["mode"]
        if mode == "lent":
            time.sleep(5)
        if mode == "erreur":
            raise ConnectorError("API changée")
        if mode == "bug":
            raise KeyError("champ")
        if mode == "status":
            return {"version": "2.3.1", "facts": []}
        return {"n": 1}


class Isolation(unittest.TestCase):
    def run_mode(self, mode, state):
        return run_isolated(Slow({"name": "x", "mode": mode}, Context()), state, timeout=1)

    def test_failure_reuses_last_good_and_counts(self):
        state = {}
        data, st = self.run_mode("ok", state)
        self.assertEqual((data, st.ok, st.stale), ({"n": 1}, True, False))
        data, st = self.run_mode("erreur", state)
        self.assertEqual((data, st.ok, st.stale, st.failures, st.message), ({"n": 1}, False, True, 1, "API changée"))
        data, st = self.run_mode("bug", state)
        self.assertEqual((st.failures, st.stale), (2, True))
        self.assertIn("erreur interne", st.message)
        data, st = self.run_mode("ok", state)
        self.assertEqual((st.ok, st.failures, st.since), (True, 0, None))

    def test_version_found_while_collecting_reaches_the_card(self):
        self.assertEqual(self.run_mode("status", {})[1].version, "2.3.1")
        self.assertIsNone(self.run_mode("ok", {})[1].version)

    def test_timeout(self):
        data, st = self.run_mode("lent", {})
        self.assertIsNone(data)
        self.assertFalse(st.ok)
        self.assertIn("délai dépassé", st.message)


class Registry(unittest.TestCase):
    def test_legacy_keys(self):
        self.assertEqual(connectors.declared({"npm_api": "/x/npm-api.sh"}),
                         [{"type": "npm", "name": "NPM", "api": "/x/npm-api.sh"}])
        cfg = {"connectors": [{"type": "npm", "name": "a", "api": "/a"}], "npm": [{"name": "b", "api": "/b"}]}
        self.assertEqual([c.name for c in connectors.instances(cfg)], ["a", "b"])

    def test_errors(self):
        for cfg, msg in (({"connectors": [{"type": "zzz", "name": "a"}]}, "inconnu"),
                         ({"npm": [{"name": "a", "api": "/a"}, {"name": "a", "api": "/b"}]}, "unique"),
                         ({"npm": [{"name": "a", "url": "http://x"}]}, "requis")):
            with self.assertRaises(ConnectorError) as e:
                connectors.instances(cfg)
            self.assertIn(msg, str(e.exception))

    def test_alerts_from_legacy_keys(self):
        cfg = {"discord_webhook": "https://d/1", "health_webhook": "https://d/2",
               "telegram_token": "t", "telegram_chat_id": "42"}
        got = [(c.type, c.name, c.conf.get("scope")) for c in connectors.instances(cfg, kind="alerts")]
        self.assertEqual(got, [("discord", "alertes", "all"), ("discord", "santé", "health"), ("telegram", "telegram", None)])
        self.assertEqual(connectors.TYPES["telegram"].public({"token": "t", "chat_id": "42"}), {"token": "configuré", "chat_id": "42"})

    def test_bad_alert_does_not_block_collection(self):
        cfg = {"npm": [{"name": "a", "api": "/a"}], "telegram_token": "t"}  # chat_id manquant
        self.assertEqual([c.type for c in connectors.instances(cfg, kind="services")], ["npm"])
        with self.assertRaises(ConnectorError):
            connectors.instances(cfg, kind="alerts")

    def test_kind_filter(self):
        cfg = {"npm": [{"name": "a", "api": "/a"}]}
        self.assertEqual(connectors.instances(cfg, kind="health"), [])

    def test_image_detection(self):
        for image in ("jc21/nginx-proxy-manager:latest", "docker.io/jc21/nginx-proxy-manager",
                      "ghcr.io/x/jc21/nginx-proxy-manager:2.16@sha256:abc"):
            self.assertEqual([c.type for c in connectors.for_image(image)], ["npm"], image)
        self.assertEqual(connectors.for_image("nginx:latest"), [])
        self.assertEqual(connectors.TYPES["npm"].discover("x", "10.0.0.5", [(8181, 81), (80, 80)]),
                         {"url": "http://10.0.0.5:8181"})

    def test_versions(self):
        self.assertTrue(version_tested("2.16.0", ("2.16",)))
        self.assertFalse(version_tested("2.160.0", ("2.16",)))
        self.assertIsNone(version_tested(None, ("2.16",)))
        self.assertTrue(version_tested("0.15.3", ("0.",)))   # a prefix ending with a dot (LogviewR) still matches


if __name__ == "__main__":
    unittest.main()


YAML = """http:
  address: 0.0.0.0:3000
users:
  - name: admin
    password: $2y$10$secret
filtering:
  rewrites:
    - domain: NAS.example.lan
      answer: 10.0.0.5
      enabled: true
    - domain: '*.old.lan'
      answer: 10.0.0.9
      enabled: false
user_rules:
  - '! commentaire'
  - '||ads.example^'
  - ''
dns:
  rewrites: []
"""


class FakeAdGuard(BaseHTTPRequestHandler):
    """API REST d'AdGuard Home (openapi.yaml v0.107.79) : /control/status, /rewrite/list, /filtering/status."""

    def do_GET(self):
        if self.headers.get("Authorization") != "Basic YWRtaW46Ym9u":  # admin:bon
            return FakeNPM.reply(self, 401, {"message": "unauthorized"})
        answers = {"/control/status": {"version": "v0.107.79", "running": True},
                   "/control/rewrite/list": [{"domain": "NAS.example.lan", "answer": "10.0.0.5", "enabled": True}],
                   "/control/filtering/status": {"enabled": True, "user_rules": ["||ads.example^", "! note"]}}
        if self.path in answers:
            return FakeNPM.reply(self, 200, answers[self.path])
        return FakeNPM.reply(self, 404, {})

    def log_message(self, *a):
        pass


class AdGuardTests(unittest.TestCase):
    def test_yaml_over_ssh(self):
        ctx = Context()
        ctx.ssh = lambda alias, cmd, **kw: YAML if alias == "srv" and "docker exec agh cat" in cmd else ""
        c = connectors.instances({}, ctx=ctx, kind="dns",
                                 meta={"machines": {"10.0.0.2": {"name": "srv", "ssh": "srv", "adguard": "agh"}}})[0]
        self.assertEqual(c.collect(), {"rewrites": [{"domain": "nas.example.lan", "answer": "10.0.0.5", "enabled": True},
                                                    {"domain": "*.old.lan", "answer": "10.0.0.9", "enabled": False}],
                                       "user_rules": ["||ads.example^"]})
        self.assertIsNone(c.version())

    def test_native_install_reads_file_with_sudo_fallback(self):
        seen = []
        ctx = Context()
        ctx.ssh = lambda alias, cmd, **kw: seen.append(cmd) or YAML
        meta = {"machines": {"10.0.0.3": {"name": "n", "ssh": "n", "adguard": "/opt/AdGuardHome/AdGuardHome.yaml"}}}
        connectors.instances({}, ctx=ctx, kind="dns", meta=meta)[0].collect()
        self.assertEqual(seen, ["cat /opt/AdGuardHome/AdGuardHome.yaml 2>/dev/null || sudo -n cat /opt/AdGuardHome/AdGuardHome.yaml"])

    def test_rest_api_without_ssh(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeAdGuard)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            base = {"type": "adguard", "name": "box", "url": f"http://127.0.0.1:{srv.server_port}", "user": "admin", "ip": "10.0.0.1"}
            good = connectors.instances({"connectors": [dict(base, password="bon")]}, kind="dns")[0]
            data, st = run_isolated(good, {}, 10)
            self.assertEqual(data, {"rewrites": [{"domain": "nas.example.lan", "answer": "10.0.0.5", "enabled": True}],
                                    "user_rules": ["||ads.example^"]})
            self.assertEqual((st.version, st.version_tested), ("v0.107.79", True))
            bad = connectors.instances({"connectors": [dict(base, password="faux")]}, kind="dns")[0]
            self.assertIn("401", bad.test().message)
        finally:
            srv.shutdown()

    def test_needs_ssh_or_api(self):
        with self.assertRaises(ConnectorError):
            connectors.instances({"connectors": [{"type": "adguard", "name": "x", "ip": "10.0.0.1"}]}, kind="dns")


BESZEL = {
    "systems": [
        {"id": "s1", "name": "srv-main", "host": "10.0.0.2", "status": "up",
         "info": {"cpu": 12.5, "mp": 40.1, "dp": 81.0, "efs": {"data": 55.0}, "la": [0.5, 0.4, 0.3], "u": 3600,
                  "dt": 48.0, "sv": [120, 1], "pu": [7, 2], "v": "0.21.0", "nouveau_champ": 1}},
        {"id": "s2", "name": "PC-Jeu", "host": "10.0.0.50", "status": "down", "info": {"sv": "illisible"}},
    ],
    "system_details": [{"system": "s1", "os_name": "Debian 13", "kernel": "6.12", "cpu": "Ryzen", "cores": 8, "memory": 32e9}],
    "smart_devices": [{"system": "s1", "name": "/dev/sda", "model": "WD", "state": "PASSED", "temp": 35, "hours": 1000, "cycles": 9}],
    "systemd_services": [{"system": "s1", "name": "nginx.service", "state": 2}, {"system": "s1", "name": "ok.service", "state": 0}],
    "system_stats": [{"system": "s1", "type": "1m", "created": "2026-10-10 00:00:00.000Z",
                      "stats": {"d": 100.0, "du": 81.0, "dp": 81.0, "efs": {"data": {"d": 1000.0, "du": 550.0}}}}],
}


class FakeBeszel(BaseHTTPRequestHandler):
    """Hub Beszel (PocketBase) : connexion, /api/beszel/info, listes paginées avec filtre state=2."""

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/api/collections/users/auth-with-password" and body == {"identity": "ro@x", "password": "bon"}:
            return FakeNPM.reply(self, 200, {"token": "tok", "record": {"role": "readonly"}})
        return FakeNPM.reply(self, 400, {"message": "Failed to authenticate.", "status": 400})

    def do_GET(self):
        if self.headers.get("Authorization") != "tok":
            return FakeNPM.reply(self, 401, {"message": "The request requires valid record authorization token."})
        path, _, q = self.path.partition("?")
        if path == "/api/beszel/info":
            return FakeNPM.reply(self, 200, {"key": "ssh-ed25519 AAAA", "v": "0.21.0"})
        coll = path.split("/")[3] if path.startswith("/api/collections/") else None
        items = BESZEL.get(coll)
        if items is None:
            return FakeNPM.reply(self, 404, {})
        if "state%3D2" in q:
            items = [x for x in items if x.get("state") == 2]
        if "type%3D%221m%22" in q:
            items = [x for x in items if x.get("type") == "1m"]
        page = int(dict(x.split("=") for x in q.split("&")).get("page", 1))
        chunk = items[(page - 1):page]  # une entrée par page : force la pagination
        return FakeNPM.reply(self, 200, {"items": chunk, "page": page, "perPage": 1, "totalPages": max(1, len(items))})

    def log_message(self, *a):
        pass


class BeszelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeBeszel)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def conn(self, password="bon"):
        cfg = {"connectors": [{"type": "beszel", "name": "hub", "url": self.url, "user": "ro@x", "password": password}]}
        return connectors.instances(cfg, kind="health")[0]

    def test_collect(self):
        data, st = run_isolated(self.conn(), {}, 10)
        self.assertTrue(st.ok, st.message)
        self.assertEqual((st.version, st.version_tested), ("0.21.0", True))
        s1, s2 = data["systems"]
        self.assertEqual((s1["disk_pct"], s1["extra_disks_pct"], s1["services_failed"], s1["updates_security"]), (81.0, {"data": 55.0}, 1, 2))
        self.assertEqual((s1["os"], s1["cores"], s1["failed_services"]), ("Debian 13", 8, ["nginx.service"]))
        self.assertEqual(s1["smart"][0]["state"], "PASSED")
        self.assertEqual(s1["disks"], [{"mount": "/", "size_gb": 100.0, "used_gb": 81.0, "used_pct": 81},
                                       {"mount": "data", "size_gb": 1000.0, "used_gb": 550.0, "used_pct": 55}])
        # champ illisible : None, sans faire échouer le connecteur
        self.assertEqual((s2["status"], s2["services_total"], s2["cpu"], s2["smart"]), ("down", None, None, []))

    def test_wrong_password(self):
        r = self.conn("faux").test()
        self.assertFalse(r.ok)
        self.assertIn("400", r.message)

    def test_match_by_ip_then_name(self):
        from connectors.beszel import match
        systems = [{"name": "srv-main", "host": "10.0.0.2"}, {"name": "PC-Jeu", "host": "pc.lan"}, {"name": "x", "host": "9.9.9.9"}]
        got = match(systems, {"10.0.0.2": {"name": "serveur"}, "10.0.0.50": {"name": "pc-jeu"}})
        self.assertEqual({ip: s["name"] for ip, s in got.items()}, {"10.0.0.2": "srv-main", "10.0.0.50": "PC-Jeu"})


class HealthFromBeszel(unittest.TestCase):
    """health.py : machine sans SSH relevée par Beszel seul (disques, SMART, services, mises à jour)."""

    def test_parse_and_level(self):
        import health
        with ThreadingHTTPServer(("127.0.0.1", 0), FakeBeszel) as srv:
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            cfg = {"connectors": [{"type": "beszel", "name": "hub", "url": f"http://127.0.0.1:{srv.server_port}",
                                   "user": "ro@x", "password": "bon"}]}
            sys_ = connectors.instances(cfg, kind="health")[0].collect()["systems"][0]
            srv.shutdown()
        h = {"id": "x", "name": "x", "reachable": True, **health.parse_beszel(sys_)}
        self.assertEqual([d["mount"] for d in h["disks"]], ["/", "data"])
        self.assertTrue(h["disks"][0]["warning"])  # 81 % >= 80
        self.assertEqual(h["systemd"]["failed"][0]["unit"], "nginx.service")
        self.assertEqual((h["apt"]["upgradable"], h["apt"]["security"]), (7, 2))
        self.assertEqual(h["smart"]["disks"][0]["healthy"], True)
        self.assertEqual(health.host_level(h), "warn")
        blocks = health.compute_host_blocks(dict(h, level="warn"))
        self.assertIn("lu par Beszel", blocks["smart"])
        self.assertIn("Non relevé (Beszel seul)", blocks["docker"])
        self.assertIn("Non relevé (Beszel seul)", blocks["kernel"])


METRICS = """# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)
# TYPE monitor_status gauge
monitor_status{monitor_id="1",monitor_name="Site \\"public\\"",monitor_type="http",monitor_url="https://svc1.example.lan",monitor_hostname="null",monitor_port="null"} 1
monitor_status{monitor_id="2",monitor_name="NAS",monitor_type="ping",monitor_url="https://",monitor_hostname="10.0.0.5",monitor_port="null"} 0
monitor_response_time{monitor_id="1",monitor_name="Site",monitor_type="http",monitor_url="https://svc1.example.lan",monitor_hostname="null",monitor_port="null"} 123.4
monitor_cert_days_remaining{monitor_id="1",monitor_name="Site",monitor_type="http",monitor_url="https://svc1.example.lan",monitor_hostname="null",monitor_port="null"} 41
app_version{version="2.5.6",major="2",minor="5",patch="6"} 1
"""


class FakeKuma(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/metrics":
            return FakeNPM.reply(self, 404, {})
        if self.headers.get("Authorization") != "Basic " + __import__("base64").b64encode(b"myservices:uk_cle").decode():
            self.send_response(401)
            self.send_header("Content-Length", "0")
            return self.end_headers()
        raw = METRICS.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *a):
        pass


class UptimeKumaTests(unittest.TestCase):
    def test_metrics(self):
        with ThreadingHTTPServer(("127.0.0.1", 0), FakeKuma) as srv:
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            base = {"type": "uptime-kuma", "name": "kuma", "url": f"http://127.0.0.1:{srv.server_port}"}
            good = connectors.instances({"connectors": [dict(base, api_key="uk_cle")]})[0]
            data, st = run_isolated(good, {}, 10)
            bad = connectors.instances({"connectors": [dict(base, api_key="faux")]})[0].test()
            srv.shutdown()
        self.assertTrue(st.ok, st.message)
        self.assertEqual((st.version, st.version_tested), ("2.5.6", True))
        site, nas = data["monitors"][1], data["monitors"][0]  # triés par nom : NAS, Site
        self.assertEqual((site["status"], site["response_ms"], site["cert_days"], site["url"]), ("up", 123, 41, "https://svc1.example.lan"))
        self.assertEqual((nas["status"], nas["hostname"], nas["url"]), ("down", "10.0.0.5", None))
        self.assertFalse(bad.ok)
        self.assertIn("clé d'API refusée", bad.message)
        self.assertEqual([c.type for c in connectors.for_image("louislam/uptime-kuma:2")], ["uptime-kuma"])


class ConfigKey(unittest.TestCase):
    def test_connectors_key_is_read(self):
        import os
        import tempfile
        import config
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "config.json"
            f.write_text(json.dumps({"connectors": [{"type": "dozzle", "name": "d", "url": "http://x"}]}))
            os.environ["MYSERVICES_CONFIG"] = str(f)
            try:
                cfg = config.load()
            finally:
                del os.environ["MYSERVICES_CONFIG"]
        self.assertEqual([c.type for c in connectors.instances(cfg, kind="logs")], ["dozzle"])
        self.assertEqual(connectors.instances(cfg, kind="logs")[0].link("mon app"), "http://x/show?name=mon+app")


class WebCheckTests(unittest.TestCase):
    def test_summary(self):
        from connectors.webcheck import summarize
        got = summarize({
            "ssl": {"valid_to": "Dec 23 09:55:24 2099 GMT", "isValid": True},
            "hsts": {"message": "Site does not serve any HSTS headers.", "compatible": False, "hstsHeader": None},
            "http-security": {"strictTransportPolicy": False, "contentSecurityPolicy": True, "xContentTypeOptions": True,
                              "xFrameOptions": False, "referrerPolicy": False, "permissionsPolicy": False, "xXSSProtection": False},
            "security-txt": {"isPresent": False}})
        self.assertGreater(got["cert_days"], 1000)
        self.assertEqual((got["cert_valid"], got["hsts"], got["headers_ok"], got["headers_total"], got["security_txt"], got["errors"]),
                         (True, False, 2, 6, False, {}))
        bad = summarize({"ssl": {"error": "No certificate presented by the server"}, "hsts": {"error": "HSTS check failed: X"}})
        self.assertEqual((bad["cert_days"], bad["hsts"], bad["headers"]), (None, None, None))
        self.assertIn("ssl", bad["errors"])

    def test_never_scans(self):
        from connectors.webcheck import CHECKS
        self.assertNotIn("ports", CHECKS)
        self.assertNotIn("trace-route", CHECKS)


class ApiMessages(unittest.TestCase):
    """Message d'erreur d'une API, quelle que soit sa forme (bug réel : {"error": "texte"} de Web-Check)."""

    def test_forms(self):
        import io
        import urllib.error
        from connectors.base import _api_message
        def err(body):
            return urllib.error.HTTPError("http://x", 500, "x", {}, io.BytesIO(body.encode()))
        self.assertEqual(_api_message(err('{"error": "Unable to fetch headers"}')), " : Unable to fetch headers")
        self.assertEqual(_api_message(err('{"error": {"message": "Unauthorized"}}')), " : Unauthorized")
        self.assertEqual(_api_message(err('{"message": "Failed to authenticate."}')), " : Failed to authenticate.")
        self.assertEqual(_api_message(err('["liste"]')), "")
        self.assertEqual(_api_message(err("pas du json")), "")


class DockerTests(unittest.TestCase):
    """Docker par SSH : une instance par machine avec SSH ; docker inaccessible = None, adresses gardées."""

    def test_instances_from_meta(self):
        meta = {"machines": {"10.0.0.2": {"name": "srv", "ssh": "srv"}, "10.0.0.3": {"name": "box", "ssh": None}}}
        got = [(c.type, c.conf["ip"], c.conf["ssh"]) for c in connectors.instances({}, kind="inventory", meta=meta)]
        self.assertEqual(got, [("docker", "10.0.0.2", "srv")])

    def test_collect(self):
        import subprocess
        from unittest import mock
        import connectors.docker_ssh as ds
        ps = "web|nginx:1|0.0.0.0:8080->80/tcp, 127.0.0.1:9000->9000/tcp|Up 2 hours (healthy)|app|Nginx||1.27||bridge\n"
        net = "web=172.18.0.2/16 _host=10.0.0.2/24\n"

        def fake(argv, **kw):
            cmd = argv[-1]
            out = ps if "docker ps" in cmd else net
            return subprocess.CompletedProcess(argv, 0, out, "")
        with mock.patch.object(ds.subprocess, "run", side_effect=fake):
            got = ds.DockerSSH({"name": "x", "ssh": "srv", "ip": "10.0.0.2"}, Context()).collect()
        c = got["containers"][0]
        self.assertEqual((c["name"], c["image"], c["ports"], c["compose"], c["version"]), ("web", "nginx:1", [(8080, 80)], "app", "1.27"))
        self.assertEqual(got["internal"], {"172.18.0.2": "web", "10.0.0.2": "_host"})

        def denied(argv, **kw):
            if "docker ps" in argv[-1]:
                return subprocess.CompletedProcess(argv, 1, "", "permission denied")
            return subprocess.CompletedProcess(argv, 0, "_host=10.0.0.2/24\n", "")
        with mock.patch.object(ds.subprocess, "run", side_effect=denied):
            got = ds.DockerSSH({"name": "x", "ssh": "srv", "ip": "10.0.0.2"}, Context()).collect()
        self.assertEqual((got["containers"], got["internal"]), (None, {"10.0.0.2": "_host"}))


class ProcessTests(unittest.TestCase):
    def test_ports_and_failure(self):
        import subprocess
        from unittest import mock
        import connectors.process as pr
        out = ('LISTEN 0 4096 0.0.0.0:8006 0.0.0.0:* users:(("pveproxy",pid=1,fd=6))\n'
               'LISTEN 0 4096 127.0.0.1:85 0.0.0.0:* users:(("pvedaemon",pid=2,fd=6))\n'
               'LISTEN 0 4096 0.0.0.0:111 0.0.0.0:* users:(("rpcbind",pid=3,fd=6))\n')
        meta = {"machines": {"10.0.0.2": {"name": "pve"}}, "process_hosts": {"10.0.0.2": "pve", "10.0.0.9": "autre"}}
        conns = connectors.instances({}, kind="inventory", meta=meta)
        self.assertEqual([(c.type, c.conf["ip"], c.conf["label"]) for c in conns if c.type == "process"],
                         [("process", "10.0.0.2", "pve"), ("process", "10.0.0.9", "10.0.0.9")])
        c = [c for c in conns if c.type == "process"][0]
        with mock.patch.object(pr.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, out, "")):
            self.assertEqual(c.collect()["ports"], {8006: {"name": "pveproxy", "lan": True}, 85: {"name": "pvedaemon", "lan": False}})
        with mock.patch.object(pr.subprocess, "run", return_value=subprocess.CompletedProcess([], 255, "", "Permission denied (publickey).")):
            with self.assertRaises(ConnectorError) as e:
                c.collect()
            self.assertIn("Permission denied", str(e.exception))


class BackupApis(unittest.TestCase):
    """Veeam et Home Assistant : vraies formes de réponse (fixtures), même résultat que l'ancien backups.py
    (vérifié par comparaison directe avant son retrait, 2026-10-10)."""

    @classmethod
    def setUpClass(cls):
        v = json.loads((ROOT / "tests/fixtures/veeam/states.json").read_text())
        ha = json.loads((ROOT / "tests/fixtures/ha/states.json").read_text())

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"])).decode()
                ok = "username=u" in body and "password=p" in body
                FakeNPM.reply(self, 200 if ok else 401, {"access_token": "t"} if ok else {"error": "invalid_grant"})

            def do_GET(self):
                if self.path == "/api/states":
                    return FakeNPM.reply(self, 200, ha) if self.headers.get("Authorization") == "Bearer jeton" else FakeNPM.reply(self, 401, {})
                if self.path == "/api/config":
                    return FakeNPM.reply(self, 200, {"version": "2026.10.1"})
                if self.headers.get("x-api-version") != "1.1-rev0":
                    return FakeNPM.reply(self, 400, {})
                FakeNPM.reply(self, 200, v["jobs"] if self.path.endswith("jobs/states") else v["repos"])
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"
        import tempfile
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        (cls.dir / "v").write_text("VEEAM_USER=u\nVEEAM_PASS=p\n")
        (cls.dir / "vbad").write_text("VEEAM_USER=u\nVEEAM_PASS=faux\n")
        (cls.dir / "h").write_text(f"HA_URL={cls.url}\nHA_TOKEN=jeton\n")

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.tmp.cleanup()

    def test_veeam(self):
        import backups
        got, err = backups.api_collect(backups.Veeam, {"id": "v", "url": self.url, "secrets": str(self.dir / "v")}, "API Veeam")
        self.assertEqual(err, "")
        self.assertEqual(sorted(got["veeam_jobs"]), ["Ancien job", "PC-Jeu image", "Serveur fichiers"])
        self.assertEqual(got["veeam_jobs"]["Serveur fichiers"]["result"], "Warning")
        self.assertEqual(got["veeam_jobs"]["Ancien job"]["result"], "None")
        self.assertEqual([d["dev"] for d in got["disks"]], ["NAS"])  # dépôt sans capacité ignoré
        self.assertEqual(got["disks"][0]["pct"], 67.7)
        got, err = backups.api_collect(backups.Veeam, {"id": "v", "url": self.url, "secrets": str(self.dir / "vbad")}, "API Veeam")
        self.assertIsNone(got)
        self.assertIn("401", err)
        got, err = backups.api_collect(backups.Veeam, {"id": "v", "url": self.url, "secrets": "/nulle/part"}, "API Veeam")
        self.assertIn("secrets illisibles", err)

    def test_home_assistant(self):
        import backups
        got, err = backups.api_collect(backups.HomeAssistant, {"id": "ha", "secrets": str(self.dir / "h")}, "API HA")
        self.assertEqual(err, "")
        self.assertEqual(got["disks"][0]["pct"], 40.4)
        self.assertIn("état idle", got["crons"][0]["line"])
        from datetime import datetime
        self.assertEqual(got["ha_backup"]["last_ok"], int(datetime.fromisoformat("2026-10-09T04:45:01+00:00").timestamp()))
        from connectors.backup_apis import HomeAssistant
        self.assertEqual(HomeAssistant({"name": "ha", "secrets": str(self.dir / "h")}, Context()).version(), "2026.10.1")


class UptimeAttach(unittest.TestCase):
    def test_attach_by_domain_then_address(self):
        from connectors.uptime_kuma import attach_monitors
        rows = [{"domains": ["svc1.example.lan"], "ip": "10.0.0.2", "port": 8080},
                {"domains": [], "ip": "10.0.0.5", "port": 445}, {"domains": ["autre.lan"]}]
        mons = [{"name": "Site", "status": "up", "response_ms": 12, "cert_days": 40, "url": "https://SVC1.example.lan/login"},
                {"name": "NAS SMB", "status": "down", "response_ms": None, "cert_days": None, "url": None,
                 "hostname": "10.0.0.5", "port": "445"},
                {"name": "inconnue", "status": "up", "url": "https://ailleurs.lan"},
                {"name": "URL cassée", "status": "up", "url": "http://x:port/"}]
        self.assertEqual(attach_monitors(rows, mons, "kuma", stale=True), 2)
        self.assertEqual(rows[0]["uptime"], [{"name": "Site", "status": "up", "response_ms": 12, "cert_days": 40,
                                              "instance": "kuma", "stale": True}])
        self.assertEqual(rows[1]["uptime"][0]["status"], "down")
        self.assertNotIn("uptime", rows[2])



class HostDocker(unittest.TestCase):
    """Docker de l'hôte estimé sans SSH, d'après les interfaces réseau."""

    def test_interfaces(self):
        from unittest import mock
        from connectors import process
        with mock.patch.object(process.os, "listdir", return_value=["lo", "eth0", "docker0", "br-1a2b", "vethaa", "vethbb"]):
            self.assertEqual(process.host_docker(), {"present": True, "containers": 2, "networks": 1})
        with mock.patch.object(process.os, "listdir", return_value=["lo", "eth0"]):
            self.assertEqual(process.host_docker(), {"present": False, "containers": 0, "networks": 0})
        with mock.patch.object(process.os, "listdir", side_effect=OSError):
            self.assertFalse(process.host_docker()["present"])
