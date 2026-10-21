"""Module ha-mcp (Home Assistant) : six lectures fixes, jamais d'écriture ; les réponses sont réduites à des champs sûrs."""
import json
import threading
import unittest
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from connectors import ha_mcp
from connectors.base import ConnectorError, Context

BACKUPS = {"success": True, "count": 3, "total": 14, "backups": [
    {"backup_id": "aaa11111", "name": "Automatic backup 2026.10.1", "date": "2026-10-17T00:01:37.602129+02:00", "size_bytes": 5337098240,
     "protected": True, "database_included": True, "homeassistant_included": True, "homeassistant_version": "2026.10.1",
     "with_automatic_settings": True, "agent_ids": ["hassio.local", "hassio.nas_copy"]},
    {"backup_id": "bbb22222", "name": "Avant mise à jour", "date": "2026-10-16T00:01:00+02:00", "size_bytes": 100, "protected": False,
     "agent_ids": ["hassio.local"]},
    {"name": "sans identifiant"}, "pas un dictionnaire"]}
OVERVIEW = {"success": True, "system_info": {"version": "2026.10.1", "state": "RUNNING", "location_name": "Maison"},
            "notifications": [{"notification_id": "n1", "title": "Mise à jour", "message": "texte long", "created_at": "2026-10-17T08:00:00+00:00"}],
            "repair_count": 1, "repairs": [{"x": 1}]}
UPDATES = {"success": True, "updates_available": 2, "skipped_count": 1, "updates": [], "categories": {"addons": 2, "hacs": "x"}}
HEALTH = {"success": True, "component_count": 90, "repairs": {"issues": [{"domain": "mqtt", "issue_id": "deprecated", "severity": "warning", "ignored": False}], "count": 1},
          "config_check": {"result": "valid", "is_valid": False, "errors": ["erreur de configuration " + "x" * 400]}}
APPS = {"success": True, "addons": [{"name": "SSH", "slug": "core_ssh", "version": "9.0", "state": "started", "update_available": False},
                                    {"name": "Z", "slug": "z_app", "version": "1", "state": "stopped", "update_available": True}, {"name": "sans slug"}],
        "summary": {"total_installed": 2, "running": 1, "stopped": 1, "updates_available": 1}}
INTEG = {"success": True, "total_count": 3, "entries": [{"entry_id": "e1", "domain": "mqtt", "title": "MQTT", "state": "setup_retry"},
                                                         {"entry_id": "e2", "domain": "sun", "title": "Sun", "state": "loaded"},
                                                         {"entry_id": "e3", "domain": "wyoming", "title": "W", "state": "not_loaded"}],
         "state_summary": {"loaded": 2, "setup_retry": 1, "not_loaded": 1}}
PAYLOADS = {"ha_manage_backup": BACKUPS, "ha_get_overview": OVERVIEW, "ha_manage_updates": UPDATES, "ha_get_system_health": HEALTH,
            "ha_get_app": APPS, "ha_get_integration": INTEG}


class FakeMcp(BaseHTTPRequestHandler):
    calls: list = []
    fail: set = set()

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        method, rid = body.get("method"), body.get("id")
        out, headers = {}, {}
        if method == "initialize":
            out, headers = {"serverInfo": {"name": "ha-mcp", "version": "8.7.0"}}, {"Mcp-Session-Id": "s1"}
        elif method == "tools/call":
            name, args = body["params"]["name"], body["params"]["arguments"]
            type(self).calls.append((name, args, self.headers.get("Mcp-Session-Id")))
            if name in type(self).fail:
                out = {"isError": True, "content": [{"type": "text", "text": "boom"}]}
            else:
                out = {"content": [{"type": "text", "text": json.dumps(PAYLOADS[name])}]}
        raw = json.dumps({"jsonrpc": "2.0", "id": rid, "result": out}).encode() if rid is not None else b""
        self.send_response(200 if rid is not None else 202)
        self.send_header("Content-Type", "application/json")
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class Guard(unittest.TestCase):
    def test_table_is_read_only(self):
        ha_mcp.assert_read_only()
        self.assertEqual(len(ha_mcp.READ_CALLS), 6)

    def test_guard_catches_a_write_action(self):
        saved = dict(ha_mcp.READ_CALLS)
        try:
            for bad in ({"scope": "snapshot", "action": "delete"}, {"action": "install"}, {"scope": "edits", "action": "list"}):
                ha_mcp.READ_CALLS["x"] = ("ha_manage_backup" if "scope" in bad else "ha_manage_updates", bad)
                with self.assertRaises(AssertionError):
                    ha_mcp.assert_read_only()
                del ha_mcp.READ_CALLS["x"]
        finally:
            ha_mcp.READ_CALLS.clear()
            ha_mcp.READ_CALLS.update(saved)


class Parsing(unittest.TestCase):
    def test_backups(self):
        got = ha_mcp.parse_backups(BACKUPS)
        self.assertEqual(got["total"], 14)
        self.assertEqual([b["id"] for b in got["items"]], ["aaa11111", "bbb22222"])   # newest first, rows without id dropped
        first = got["items"][0]
        self.assertEqual(first["locations"], ["local", "nas_copy"])
        self.assertTrue(first["offsite"] and first["protected"] and first["database"])
        self.assertEqual(first["date"], int(datetime.fromisoformat("2026-10-17T00:01:37.602129+02:00").timestamp()))
        self.assertFalse(got["items"][1]["offsite"])
        self.assertTrue(got["offsite"])   # the newest one is copied elsewhere

    def test_backups_newest_only_local(self):
        got = ha_mcp.parse_backups({"backups": [BACKUPS["backups"][1]], "total": 1})
        self.assertFalse(got["offsite"])

    def test_empty_and_garbage(self):
        self.assertEqual(ha_mcp.parse_backups({})["items"], [])
        self.assertEqual(ha_mcp.parse_overview({})["repairs"], 0)
        self.assertIsNone(ha_mcp.parse_health({})["config_ok"])
        self.assertEqual(ha_mcp.parse_apps({"addons": "x"})["items"], [])
        self.assertEqual(ha_mcp.parse_integrations({"entries": [None, 3]})["problems"], [])

    def test_other_blocks(self):
        self.assertEqual(ha_mcp.parse_overview(OVERVIEW)["notifications"], [{"title": "Mise à jour", "created": 1792224000}])   # the message text is not kept
        self.assertEqual(ha_mcp.parse_updates(UPDATES), {"available": 2, "skipped": 1, "categories": {"addons": 2}})
        h = ha_mcp.parse_health(HEALTH)
        self.assertEqual((h["config_ok"], h["repairs_count"], h["repairs"]), (False, 1, [{"domain": "mqtt", "issue_id": "deprecated", "severity": "warning"}]))
        self.assertEqual(len(h["config_errors"][0]), 160)
        a = ha_mcp.parse_apps(APPS)
        self.assertEqual((a["total"], a["stopped"], [x["slug"] for x in a["items"]]), (2, 1, ["core_ssh", "z_app"]))
        i = ha_mcp.parse_integrations(INTEG)
        self.assertEqual(i["problems"], [{"domain": "mqtt", "title": "MQTT", "state": "setup_retry"}])   # « not_loaded » is a normal state, not a fault
        self.assertEqual(i["states"]["not_loaded"], 1)


class Client(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeMcp)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}/private_abc"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        FakeMcp.calls, FakeMcp.fail = [], set()

    def test_collect_sends_only_the_six_read_calls(self):
        got = ha_mcp.HaMcp(self.url, 5).collect()
        self.assertEqual(got["errors"], {})
        self.assertEqual(got["server"]["version"], "8.7.0")
        self.assertEqual(sorted(got), ["apps", "backups", "errors", "health", "integrations", "overview", "server", "updates"])
        self.assertEqual({c[0] for c in FakeMcp.calls}, {t for t, _ in ha_mcp.READ_CALLS.values()})
        self.assertEqual(len(FakeMcp.calls), 6)
        for name, args, sid in FakeMcp.calls:
            self.assertEqual(sid, "s1")   # the session id given at initialize is sent back
            self.assertNotIn(args.get("action"), ha_mcp.WRITE_ACTIONS)
            if name in ("ha_manage_backup", "ha_manage_updates"):
                self.assertEqual(args["action"], "list")

    def test_slow_calls_go_through_the_cache(self):
        seen = []

        def cached(key, ttl, fn):
            seen.append((key, ttl))
            return {"kept": True}
        got = ha_mcp.HaMcp(self.url, 5).collect(cached=cached)
        self.assertEqual(seen, [("ha-mcp-health", 3600)])
        self.assertEqual(got["health"], {"kept": True})
        self.assertNotIn("ha_get_system_health", {c[0] for c in FakeMcp.calls})   # Home Assistant does not test GitHub again
        self.assertEqual(len(FakeMcp.calls), 5)

    def test_one_failing_tool_does_not_spoil_the_others(self):
        FakeMcp.fail = {"ha_get_app"}
        got = ha_mcp.HaMcp(self.url, 5).collect()
        self.assertIn("apps", got["errors"])
        self.assertIn("boom", got["errors"]["apps"])
        self.assertEqual(got["backups"]["total"], 14)

    def test_bad_address(self):
        with self.assertRaises(ConnectorError):
            ha_mcp.HaMcp("ftp://x/y")
        got = ha_mcp.HaMcp("http://127.0.0.1:9/private", 2).collect()
        self.assertIn("connexion", got["errors"])
        self.assertNotIn("private", got["errors"]["connexion"])   # the secret path is never echoed


class ConnectorMode(unittest.TestCase):
    """Le connecteur Home Assistant ajoute le bloc « mcp » quand l'adresse est donnée, sans toucher au reste."""

    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeMcp)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}/private_abc"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        FakeMcp.calls, FakeMcp.fail = [], set()

    def test_summary(self):
        from connectors.home_assistant import mcp_summary
        self.assertEqual(mcp_summary(None), "")
        full = ha_mcp.HaMcp(self.url, 5).collect()
        self.assertEqual(mcp_summary(full), " · ha-mcp : 14 sauvegarde(s), 1 réparation(s), configuration invalide")
        self.assertIn("injoignable", mcp_summary(ha_mcp.HaMcp("http://127.0.0.1:9/x", 2).collect()))

    def test_field_is_secret_and_optional(self):
        from connectors.home_assistant import HomeAssistantAPI
        f = next(f for f in HomeAssistantAPI.fields if f.name == "mcp_url")
        self.assertTrue(f.secret and not f.required)
        self.assertIn("ha-mcp", f.help)
        self.assertIn("natif", f.help)   # said clearly: not the native MCP of Home Assistant


class BackupSet(unittest.TestCase):
    """La page Sauvegardes lit la vraie liste : âge de la dernière, chiffrement, copie hors de Home Assistant (constatée, pas supposée)."""
    NOW = datetime.fromisoformat("2026-10-17T03:00:00+02:00").timestamp()
    META = {"hosts": [{"id": "ha", "label": "Home Assistant", "api": "ha"}, {"id": "ha-src", "label": "Config HA", "api": "none"}],
            "sets": [{"id": "s", "label": "HA", "origin": "ha-src", "max_age_days": 2,
                      "locations": [{"host": "ha-src"}, {"host": "ha", "ha_backup": True, "offsite": True}]}]}

    def level(self, items, last_ok=1, last_attempt=1):
        import backups
        lst = ha_mcp.parse_backups({"backups": items, "total": len(items)})
        data = {"user": "x", "locs": {}, "cron_root": None, "disks": [], "crons": [], "ha_backup": {"last_ok": last_ok, "last_attempt": last_attempt, "next": None, "list": lst}}
        res = {"ha": (data, ""), "ha-src": ({"locs": {}, "disks": [], "crons": []}, "")}
        return backups.analyse(self.META, res, {}, self.NOW)["sets"][0]["locations"][1]

    def test_recent_copied_and_encrypted(self):
        loc = self.level(BACKUPS["backups"][:1])
        self.assertEqual((loc["level"], loc["offsite"], loc["encrypted"]), ("ok", True, True))
        self.assertEqual(loc["newest"]["size"], 5337098240)
        self.assertIn("nas_copy", loc["detail"])

    def test_only_on_home_assistant_is_not_offsite_even_if_configured(self):
        loc = self.level([BACKUPS["backups"][1]])
        self.assertFalse(loc["offsite"])
        self.assertIn("uniquement sur Home Assistant", loc["detail"])
        self.assertIn("NON chiffrée", loc["detail"])

    def test_too_old_is_critical(self):
        old = dict(BACKUPS["backups"][0], date="2026-09-01T00:00:00+02:00")
        self.assertEqual(self.level([old])["level"], "crit")

    def test_failed_last_attempt(self):
        t = int(self.NOW)
        self.assertEqual(self.level(BACKUPS["backups"][:1], last_ok=t - 86400, last_attempt=t)["level"], "crit")


if __name__ == "__main__":
    unittest.main()
