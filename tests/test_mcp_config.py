"""MCP *_config tools (mcp_server.py): off by default, help, actions run through ctx["route"], refusals as tool errors.

  Runs without FastAPI: the REST side is a fake ctx["route"].
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import mcp_server  # noqa: E402


class Ctx(dict):
    def __init__(self, level="admin", status=200, out=None):
        self.calls = []
        super().__init__(token={"name": "t", "level": level}, audit=lambda a: None,
                         route=lambda m, p, params: self.calls.append((m, p, params)) or (status, out if out is not None else {"ok": True}),
                         route_help=lambda m, p: {"summary": f"{m} {p}", "params": {"type": "object"}})


def call(ctx, name, args=None, states=None):
    msg = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}}
    return mcp_server.handle(msg, ctx, None, states if states is not None else {name: True})


class McpConfig(unittest.TestCase):
    def test_config_tools_off_by_default(self):
        listed = mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, Ctx(), None, {})
        names = [t["name"] for t in listed["result"]["tools"]]
        self.assertIn("status", names)
        self.assertNotIn("backups_config", names)
        info = {t["name"]: t for t in mcp_server.tools_info({})}
        self.assertFalse(info["agents_config"]["enabled"])
        self.assertEqual(info["connectors_config"]["level"], "admin")
        self.assertIn("error", call(Ctx(), "backups_config", {"action": "list"}, states={}))

    def test_admin_level_needed(self):
        r = call(Ctx(level="runs"), "connectors_config", {"action": "list"})
        self.assertTrue(r["result"]["isError"])

    def test_help_lists_every_action(self):
        r = call(Ctx(), "backups_config", {"action": "help"})["result"]["structuredContent"]
        self.assertEqual(set(r["actions"]), set(mcp_server.CONFIG["backups_config"]))
        self.assertEqual(r["actions"]["unfollow"]["summary"], "DELETE /backups/settings/{set_id}")

    def test_action_runs_its_route(self):
        ctx = Ctx(out={"ok": True, "enabled": True})
        r = call(ctx, "connectors_config", {"action": "switch", "params": {"type": "npm", "name": "a", "enabled": True}})
        self.assertEqual(ctx.calls, [("PATCH", "/connectors/settings/{type_}/{name}", {"type": "npm", "name": "a", "enabled": True})])
        self.assertEqual(r["result"]["structuredContent"], {"ok": True, "enabled": True})
        r = call(Ctx(out=[1, 2]), "agents_config", {"action": "list"})
        self.assertEqual(r["result"]["structuredContent"], {"result": [1, 2]})

    def test_refusals_are_tool_errors(self):
        r = call(Ctx(status=400, out={"error": "dossier introuvable"}), "backups_config", {"action": "unfollow", "params": {"set_id": "x"}})
        self.assertTrue(r["result"]["isError"])
        self.assertIn("HTTP 400: dossier introuvable", r["result"]["content"][0]["text"])
        r = call(Ctx(), "agents_config", {"action": "nope"})
        self.assertIn("action inconnue", r["result"]["content"][0]["text"])
        r = call(Ctx(), "agents_config", {"action": "list", "params": [1]})
        self.assertIn("objet attendu", r["result"]["content"][0]["text"])

    def test_schema_offers_help_and_actions(self):
        s = mcp_server.config_schema("agents_config")
        self.assertEqual(s["properties"]["action"]["enum"][0], "help")
        self.assertIn("revoke", s["properties"]["action"]["enum"])


if __name__ == "__main__":
    unittest.main()
