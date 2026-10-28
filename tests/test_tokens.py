"""Jetons d'API et MCP (tokens.py, api.py, mcp_server.py) : sortes séparées, niveaux, routes fermées aux jetons,
révocation immédiate, jeton admin (mot de passe, durée), outils MCP coupés.

  À lancer dans l'image (FastAPI) : python3 -m unittest discover -s tests
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from fastapi.testclient import TestClient

    from msv.machines import agents
    from msv.api import api
    from msv.api import common
    from msv.core import auth
    from msv.alerts import mailer  # noqa: F401  (patched by name)
    from msv.api import server
    from msv.core import tokens
except ImportError:
    api = None
    common = None

PW = "un mot de passe long"


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class Tokens(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        server.STATIC = server.WEB = d
        common.AUTH = True
        common.STORE = auth.Store(d / "myservices.db")
        common.TOKENS = tokens.Tokens(d / "myservices.db")
        common.AGENTS = agents.Agents(d / "myservices.db")
        common.STORE.create_user("admin", PW, "admin")
        self.c = TestClient(api.app, client=("192.168.1.50", 50000))
        self.c.post("/myservices/api/v1/login", json={"username": "admin", "password": PW})
        self.h = {"X-CSRF-Token": self.c.cookies["ms_csrf"]}
        self.anon = TestClient(api.app, client=("192.168.1.51", 50000))

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, kind="api", level="read", **kw):
        r = self.c.post("/myservices/api/v1/tokens", json={"kind": kind, "name": f"t-{kind}-{level}", "level": level, **kw}, headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["token"]

    def get(self, path, tok, method="GET", **kw):
        return self.anon.request(method, "/myservices/" + path, headers={"Authorization": f"Bearer {tok}"}, **kw)

    def test_levels_and_closed_routes(self):
        ro = self.make()
        self.assertTrue(ro.startswith("msv_api_"))
        self.assertEqual(self.get("api/v1/status", ro).status_code, 200)
        r = self.get("api/v1/refresh", ro, "POST")
        self.assertEqual((r.status_code, r.json()["code"]), (403, "API_TOKEN_READ_ONLY"))
        for path, method in (("api/v1/users", "GET"), ("api/v1/tokens", "GET"), ("api/v1/me/password", "POST")):
            self.assertEqual(self.get(path, ro, method).json().get("code"), "API_TOKEN_ROUTE_NOT_ALLOWED")
        self.assertEqual(self.get("api/v1/alerts", ro).json()["code"], "API_TOKEN_READ_ONLY")
        self.assertEqual(self.get("api/v1/status", "msv_api_faux").json()["code"], "TOKEN_INVALID")

    def test_kinds_are_separate_and_revoke(self):
        api_tok, mcp_tok = self.make(), self.make("mcp")
        self.assertEqual(self.get("mcp", api_tok, "POST", json={}).json()["code"], "TOKEN_WRONG_KIND")
        self.assertEqual(self.get("api/v1/status", mcp_tok).json()["code"], "TOKEN_WRONG_KIND")
        tid = [t for t in self.c.get("/myservices/api/v1/tokens").json()["tokens"] if t["kind"] == "api"][0]["id"]
        self.assertEqual(self.c.delete(f"/myservices/api/v1/tokens/{tid}", headers=self.h).status_code, 200)
        self.assertEqual(self.get("api/v1/status", api_tok).json()["code"], "TOKEN_REVOKED")

    def test_admin_token_needs_password_and_expiry(self):
        r = self.c.post("/myservices/api/v1/tokens", json={"kind": "api", "name": "adm", "level": "admin", "days": 30, "password": "faux"}, headers=self.h)
        self.assertEqual(r.status_code, 401)
        r = self.c.post("/myservices/api/v1/tokens", json={"kind": "api", "name": "adm", "level": "admin", "password": PW}, headers=self.h)
        self.assertEqual(r.status_code, 400)  # sans durée
        adm = self.make(level="admin", days=30, password=PW)
        self.assertEqual(self.get("api/v1/alerts", adm).status_code, 200)
        self.assertEqual(self.get("api/v1/tokens", adm).json()["code"], "API_TOKEN_ROUTE_NOT_ALLOWED")  # pas d'escalade

    def test_mcp_tools_and_levels(self):
        tok = self.make("mcp")
        call = lambda m, p=None: self.get("mcp", tok, "POST", json={"jsonrpc": "2.0", "id": 1, "method": m, "params": p or {}}).json()
        self.assertEqual(call("initialize", {"protocolVersion": "2025-06-18"})["result"]["serverInfo"]["name"], "myservices")
        names = [t["name"] for t in call("tools/list")["result"]["tools"]]
        self.assertIn("list_services", names)
        self.assertNotIn("run_collect", names)  # niveau runs requis
        self.assertTrue(call("tools/call", {"name": "run_collect"})["result"]["isError"])
        self.assertEqual(self.get("mcp", tok, "POST", json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code, 202)
        self.c.patch("/myservices/api/v1/tokens/tools/status", json={"enabled": False}, headers=self.h)
        self.assertNotIn("status", [t["name"] for t in call("tools/list")["result"]["tools"]])
        self.assertIn("error", call("tools/call", {"name": "status"}))
        self.assertEqual(self.anon.post("/myservices/mcp", json={}).status_code, 401)  # sans jeton

    def test_mcp_config_tools_run_the_rest_routes(self):
        tok = self.make("mcp", level="admin", days=30, password=PW)
        call = lambda m, p=None: self.get("mcp", tok, "POST", json={"jsonrpc": "2.0", "id": 1, "method": m, "params": p or {}}).json()
        tool = lambda name, args: call("tools/call", {"name": name, "arguments": args})["result"]
        self.assertNotIn("agents_config", [t["name"] for t in call("tools/list")["result"]["tools"]])  # off by default
        self.assertEqual(self.c.patch("/myservices/api/v1/tokens/tools/agents_config", json={"enabled": True}, headers=self.h).status_code, 200)
        self.c.patch("/myservices/api/v1/tokens/tools/connectors_config", json={"enabled": True}, headers=self.h)
        helped = tool("agents_config", {"action": "help"})["structuredContent"]["actions"]
        self.assertIn("ip", helped["create"]["params"]["properties"])
        self.assertEqual(helped["revoke"]["params"]["required"], ["aid"])
        made = tool("agents_config", {"action": "create", "params": {"ip": "10.0.0.7", "name": "pc-test"}})
        self.assertFalse(made.get("isError"), made)
        self.assertTrue(made["structuredContent"]["token"].startswith("msv_agent_"))
        listed = tool("agents_config", {"action": "list"})["structuredContent"]["agents"]
        self.assertEqual([a["name"] for a in listed], ["pc-test"])
        self.assertFalse(tool("agents_config", {"action": "revoke", "params": {"aid": listed[0]["id"]}}).get("isError"))
        bad = tool("agents_config", {"action": "revoke", "params": {}})
        self.assertIn("aid", bad["content"][0]["text"])
        self.assertIn("switch", tool("connectors_config", {"action": "help"})["structuredContent"]["actions"])
        self.c.patch("/myservices/api/v1/tokens/tools/machines_config", json={"enabled": True}, headers=self.h)
        machines = tool("machines_config", {"action": "help"})["structuredContent"]["actions"]
        self.assertEqual(set(machines), {"list", "save", "patch", "delete", "check", "refresh", "network_get", "network_set"})   # each one a real route
        self.assertFalse(tool("machines_config", {"action": "list"}).get("isError"))
        self.assertFalse(tool("machines_config", {"action": "network_get"}).get("isError"))
        self.assertIn("ip", tool("machines_config", {"action": "check", "params": {}})["content"][0]["text"])
        self.c.patch("/myservices/api/v1/tokens/tools/settings_config", json={"enabled": True}, headers=self.h)
        settings = tool("settings_config", {"action": "help"})["structuredContent"]["actions"]
        self.assertIn("mail_set", settings)   # each one a real route: help would fail on a wrong path
        self.assertIn("task_run", settings)
        for read in ("mail_get", "tasks_list", "live_get", "updates_get", "alerts_list"):
            self.assertFalse(tool("settings_config", {"action": read}).get("isError"), read)
        self.assertNotIn("changelog", tool("settings_config", {"action": "updates_get"})["structuredContent"])   # 200 KB of no use here
        self.assertIn("cid", tool("settings_config", {"action": "channel_delete", "params": {}})["content"][0]["text"])
        self.assertIn("jeton", tool("settings_config", {"action": "mail_test"})["content"][0]["text"])   # creator has no address yet
        common.STORE.set_email("admin", "admin@example.test")
        with mock.patch.dict(server.CFG, {"smtp_host": "smtp.example.test", "smtp_from": "ms@example.test"}), \
                mock.patch("msv.alerts.mailer.send") as sent:
            self.assertFalse(tool("settings_config", {"action": "mail_test"}).get("isError"))
        self.assertEqual(sent.call_args.args[1], "admin@example.test")   # a token writes to its creator
        who = {e["username"] for e in self.c.get("/myservices/api/v1/audit").json()["audit"]}
        self.assertIn("mcp:t-mcp-admin", who)   # audited as the token, like from the page

    def test_admin_api_token_reaches_agents_and_backups(self):
        adm = self.make(level="admin", days=30, password=PW)
        self.assertEqual(self.get("api/v1/agents", adm).status_code, 200)
        self.assertEqual(self.get("api/v1/backups/patterns", adm, "PUT", json={}).status_code, 422)   # past the token guard
        ro = self.make(level="runs")
        self.assertEqual(self.get("api/v1/agents", ro).json()["code"], "API_TOKEN_LEVEL")


if __name__ == "__main__":
    unittest.main()
