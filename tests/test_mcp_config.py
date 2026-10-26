"""MCP *_config tools (mcp_server.py): off by default, help, actions run through ctx["route"], refusals as tool errors.

  Runs without FastAPI: the REST side is a fake ctx["route"].
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import mcp_server  # noqa: E402
try:
    import machines_admin
except ImportError:   # its dependencies live in the image; the other tests run without them
    machines_admin = None


def fake_core(web, tasks=None):
    """What the read tools take from server.py: the web folder, the collection status and the tasks table."""
    tasks = {"collect": {"proc": None, "end": 1700000000, "result": "success"}} if tasks is None else tasks
    return SimpleNamespace(WEB=web, status=lambda: {}, TASKS=tasks, enabled=lambda n: n == "collect", next_run=lambda n: 1700003600)


def write(web, name, data):
    (Path(web) / name).parent.mkdir(parents=True, exist_ok=True)
    (Path(web) / name).write_text(json.dumps(data), encoding="utf-8")


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

    def test_validate_has_help_too(self):
        r = call(Ctx(), "validate_config", {"action": "help"})["result"]["structuredContent"]
        self.assertEqual(list(r["actions"]), ["run"])   # described, not run
        self.assertIn("type", r["actions"]["run"]["params"]["properties"])
        self.assertIn("action inconnue", call(Ctx(), "validate_config", {"action": "nope"})["result"]["content"][0]["text"])

    def test_schema_offers_help_and_actions(self):
        s = mcp_server.config_schema("agents_config")
        self.assertEqual(s["properties"]["action"]["enum"][0], "help")
        self.assertIn("revoke", s["properties"]["action"]["enum"])


class McpMachines(unittest.TestCase):
    def test_machines_config_is_an_admin_tool_off_by_default(self):
        info = {t["name"]: t for t in mcp_server.tools_info({})}
        self.assertEqual((info["machines_config"]["level"], info["machines_config"]["enabled"]), ("admin", False))

    def test_machines_config_runs_the_page_routes(self):
        ctx = Ctx(out={"machines": []})
        call(ctx, "machines_config", {"action": "refresh", "params": {"ip": "10.0.0.9"}})
        call(ctx, "machines_config", {"action": "network_set", "params": {"every_h": 6}})
        self.assertEqual(ctx.calls, [("POST", "/machines/settings/{ip}/refresh", {"ip": "10.0.0.9"}), ("PUT", "/network/settings", {"every_h": 6})])
        self.assertIn("network_get", call(Ctx(), "machines_config", {"action": "help"})["result"]["structuredContent"]["actions"])


class McpSettings(unittest.TestCase):
    def test_settings_config_is_an_admin_tool_off_by_default(self):
        info = {t["name"]: t for t in mcp_server.tools_info({})}
        self.assertEqual((info["settings_config"]["level"], info["settings_config"]["enabled"]), ("admin", False))

    def test_settings_config_leaves_out_what_is_sensitive(self):
        routes = " ".join(path for _, path in mcp_server.CONFIG["settings_config"].values())
        for left_out in ("export", "import", "logs", "/tokens", "ssh"):
            self.assertNotIn(left_out, routes)

    def test_settings_config_runs_the_page_routes(self):
        ctx = Ctx(out={"ok": True})
        call(ctx, "settings_config", {"action": "mail_set", "params": {"host": "smtp.example.org", "security": "starttls"}})
        call(ctx, "settings_config", {"action": "channel_test", "params": {"cid": 3}})
        self.assertEqual(ctx.calls, [("PUT", "/system/mail", {"host": "smtp.example.org", "security": "starttls"}), ("POST", "/alerts/channels/{cid}/test", {"cid": 3})])


class McpHealth(unittest.TestCase):
    def test_health_says_why_a_host_is_not_ok(self):
        with tempfile.TemporaryDirectory() as web:
            (Path(web) / "health").mkdir()
            (Path(web) / "health" / "stats.json").write_text(json.dumps({"timestamp": "t", "overall_level": "warn", "hosts": [
                {"name": "A · 10.0.0.1", "level": "warn", "reachable": True, "disks": [], "checks": {"docker": "warn"},
                 "kernel": {"has_errors": True, "samples": ["kernel: CIFS: VFS: boom"]}},
                {"name": "B · 10.0.0.2", "level": "ok", "reachable": True, "disks": []}]}), encoding="utf-8")
            hosts = mcp_server.t_health(SimpleNamespace(WEB=web), {}, Ctx())["hosts"]
        self.assertEqual(hosts[0]["checks"], {"docker": "warn"})
        self.assertEqual(hosts[0]["kernel_errors"], ["kernel: CIFS: VFS: boom"])
        self.assertNotIn("kernel_errors", hosts[1])
        self.assertEqual(hosts[1]["checks"], {})   # a healthy host: an empty answer, not a missing key

    def test_status_lists_a_health_connector_that_fails(self):
        with tempfile.TemporaryDirectory() as web:
            (Path(web) / "health").mkdir()
            (Path(web) / "data.json").write_text(json.dumps({"connectors": [{"type": "npm", "name": "npm", "ok": True, "message": "OK"}]}), encoding="utf-8")
            (Path(web) / "health" / "stats.json").write_text(json.dumps({"connectors": [
                {"type": "beszel", "name": "beszel", "ok": False, "message": "injoignable"},
                {"type": "npm", "name": "npm", "ok": False, "message": "doublon ignoré"}]}), encoding="utf-8")
            out = mcp_server.t_status(fake_core(web), {}, Ctx())["connectors"]
        self.assertEqual([(c["type"], c["ok"]) for c in out], [("npm", True), ("beszel", False)])   # the collection's line wins, Beszel is added

    def test_machines_name_their_services_in_trouble(self):
        row = lambda ip, up: {"type": "local", "enabled": True, "ip": ip, "port": 80, "backend": {"up": up}, "service": {"name": "web"}}
        with tempfile.TemporaryDirectory() as web:
            (Path(web) / "data.json").write_text(json.dumps({"machine_list": [{"name": "A", "ip": "10.0.0.1", "down": 1}, {"name": "B", "ip": "10.0.0.2", "down": 0}],
                                                              "hosts": [row("10.0.0.1", False), row("10.0.0.2", True)]}), encoding="utf-8")
            out = mcp_server.t_machines(SimpleNamespace(WEB=web), {}, Ctx())["machines"]
        self.assertEqual([x["status"] for x in out[0]["problems"]], ["bad"])
        self.assertEqual(out[1]["problems"], [])


class McpRead(unittest.TestCase):
    """What the assistant needs to check a server without its pages: version and tasks, SMART and Docker with their source,
    the container behind a service, the machines' stopped_ok, and the Backups page as data."""

    def test_status_gives_the_version_the_time_and_the_tasks(self):
        with tempfile.TemporaryDirectory() as web, mock.patch.dict(os.environ, {"MYSERVICES_VERSION": "v0.25.0-abc"}):
            write(web, "data.json", {"generated": "g", "hosts": [], "machine_list": []})
            tasks = {"collect": {"proc": None, "end": 1700000000, "result": "success"}, "backups": {"proc": object(), "end": None, "result": None}}
            out = mcp_server.t_status(fake_core(web, tasks), {}, Ctx())
        self.assertEqual(out["version"], "v0.25.0-abc")
        self.assertRegex(out["server_time"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$")
        self.assertEqual(out["tasks"]["collect"], {"enabled": True, "next": 1700003600, "ended": 1700000000, "result": "success", "running": False})
        self.assertEqual((out["tasks"]["backups"]["enabled"], out["tasks"]["backups"]["running"]), (False, True))

    def test_services_show_the_container_state_and_filter_on_one_status(self):
        stopped = "Exited (0) 3 days ago"
        rows = [{"type": "local", "enabled": True, "ip": "10.0.0.1", "port": 8081, "backend": {"up": False}, "stopped": stopped,
                 "service": {"kind": "docker", "name": "llamacpp", "state": stopped}},
                {"type": "local", "enabled": True, "ip": "10.0.0.1", "port": 80, "backend": {"up": True},
                 "service": {"kind": "docker", "name": "web", "state": "Up 2 days"}}]
        with tempfile.TemporaryDirectory() as web:
            write(web, "data.json", {"hosts": rows})
            core = fake_core(web)
            every = mcp_server.t_services(core, {}, Ctx())["services"]
            off = mcp_server.t_services(core, {"status": "off"}, Ctx())["services"]
            ok = mcp_server.t_services(core, {"status": "ok"}, Ctx())["services"]
        by = {x["container"]: x for x in every}
        self.assertEqual((by["llamacpp"]["status"], by["llamacpp"]["container_state"], by["llamacpp"]["stopped_on_purpose"]), ("off", stopped, True))
        self.assertEqual((by["web"]["status"], by["web"]["container_state"], by["web"]["stopped_on_purpose"]), ("ok", "Up 2 days", False))
        self.assertEqual(([x["container"] for x in off], [x["container"] for x in ok]), (["llamacpp"], ["web"]))

    @unittest.skipIf(machines_admin is None, "machines_admin.py needs its dependencies (run in the image)")
    def test_machines_carry_their_stopped_ok_and_filter_on_a_query(self):
        with tempfile.TemporaryDirectory() as web:
            write(web, "data.json", {"hosts": [], "machine_list": [{"name": "Jarvis", "ip": "10.0.0.1", "role": "Ollama", "down": 0},
                                                                  {"name": "Tower", "ip": "10.0.0.2", "role": "Plex", "down": 0}]})
            meta = Path(web) / "meta.json"
            meta.write_text(json.dumps({"machines": {"10.0.0.1": {"name": "Jarvis", "stopped_ok": ["koboldcpp"]}, "10.0.0.2": {"name": "Tower"}}}), encoding="utf-8")
            with mock.patch.object(machines_admin.setup, "META", meta):
                every = mcp_server.t_machines(fake_core(web), {}, Ctx())["machines"]
                plex = mcp_server.t_machines(fake_core(web), {"query": "plex"}, Ctx())["machines"]
        self.assertEqual(every[0]["stopped_ok"], ["koboldcpp"])
        self.assertNotIn("stopped_ok", every[1])   # nothing listed: no key, not an empty list
        self.assertEqual([m["name"] for m in plex], ["Tower"])

    def test_health_gives_smart_and_docker_with_their_source(self):
        hosts = [{"name": "Jarvis · 10.0.0.1", "level": "ok", "reachable": True, "source": "agent", "sources": ["agent", "beszel"], "read_at": "r",
                  "disks": [{"mount": "/", "used_pct": 68}], "checks": {},
                  "smart": {"accessible": True, "source": "beszel", "disks": [{"device": "/dev/sda", "healthy": True, "failed": False, "temp": 40}]},
                  "docker": {"accessible": True, "total": 16, "unhealthy": 0, "restarting": 0, "exited": 1,
                             "stopped_list": [{"name": "koboldcpp", "status": "Exited (1) 2 h ago", "image": "k"}],
                             "issues": [{"name": "crashy", "status": "Exited (1) 1 h ago", "image": "c"}]},
                  "temp": {"available": True, "celsius": 77.5}, "apt": {"upgradable": 3}},
                 {"name": "vm · 10.0.0.2", "level": "ok", "reachable": True, "disks": [], "smart": {"accessible": False, "vm": True, "disks": []},
                  "docker": {"accessible": False}, "temp": {"available": False}}]
        with tempfile.TemporaryDirectory() as web:
            write(web, "health/stats.json", {"timestamp": "t", "overall_level": "ok", "hosts": hosts})
            out = mcp_server.t_health(fake_core(web), {}, Ctx())["hosts"]
            one = mcp_server.t_health(fake_core(web), {"query": "jarvis"}, Ctx())["hosts"]
        j, vm = out
        self.assertEqual((j["source"], j["sources"]), ("agent", ["agent", "beszel"]))
        self.assertEqual(j["smart"], {"accessible": True, "source": "beszel", "disks": [{"device": "/dev/sda", "healthy": True, "failed": False}]})
        self.assertEqual(j["docker"]["stopped_on_purpose"], ["koboldcpp"])
        self.assertEqual((j["docker"]["exited"], j["docker"]["issues"]), (1, ["crashy (Exited (1) 1 h ago)"]))
        self.assertEqual((j["temperature_c"], j["updates"]), (77.5, 3))
        self.assertEqual(vm["smart"], {"accessible": False, "vm": True})
        for key in ("docker", "temperature_c", "updates"):
            self.assertNotIn(key, vm)
        self.assertEqual([h["name"] for h in one], ["Jarvis · 10.0.0.1"])

    def test_backups_as_the_page_shows_them_problems_first(self):
        newest = {"name": "Backup-A.tar.gz", "mtime": 1700000000, "size": 5}
        sets = [{"id": "b", "label": "B set", "origin": "srv", "level": "ok", "why": [], "schedule": "lun. 01:00", "retention": "1", "max_age_days": 8,
                 "offsite": 1, "expect_offsite": True,
                 "locations": [{"host": "srv", "role": "source", "level": "ok", "detail": "d", "via": "tar", "path": "/p", "count": 1, "age": 0.5, "newest": newest, "recent": ["x"], "size": 5}]},
                {"id": "a", "label": "A set", "origin": "nas", "level": "warn", "why": ["source trop vieille"], "locations": []},
                {"id": "c", "label": "old", "origin": "nas", "level": "archive", "why": [], "locations": []}]
        with tempfile.TemporaryDirectory() as web:
            core = fake_core(web)
            self.assertFalse(mcp_server.t_backups(core, {}, Ctx())["tracked"])   # nothing read yet: a message, not an error
            write(web, "backups.json", {"generated": "g", "summary": {"ok": 1, "warn": 1}, "issues": [], "sets": sets})
            every = mcp_server.t_backups(core, {}, Ctx())
            problems = mcp_server.t_backups(core, {"problems_only": True}, Ctx())["sets"]
            found = mcp_server.t_backups(core, {"query": "b set"}, Ctx())["sets"]
        self.assertEqual((every["tracked"], every["count"], every["summary"]), (True, 3, {"ok": 1, "warn": 1}))
        self.assertEqual([x["id"] for x in every["sets"]], ["a", "b", "c"])   # warn, ok, archive
        self.assertEqual(every["sets"][0]["why"], ["source trop vieille"])
        loc = every["sets"][1]["locations"][0]
        self.assertEqual((loc["host"], loc["role"], loc["age"], loc["newest"], loc["newest_at"]), ("srv", "source", 0.5, "Backup-A.tar.gz", 1700000000))
        self.assertNotIn("recent", loc)
        self.assertEqual(([x["id"] for x in problems], [x["id"] for x in found]), (["a"], ["b"]))

    def test_new_actions_run_their_routes(self):
        ctx = Ctx(out={"ok": True})
        call(ctx, "machines_config", {"action": "patch", "params": {"ip": "10.0.0.1", "fields": {"stopped_ok": ["koboldcpp"]}}})
        call(ctx, "settings_config", {"action": "task_run", "params": {"name": "backups"}})
        self.assertEqual(ctx.calls, [("PATCH", "/machines/settings/{ip}", {"ip": "10.0.0.1", "fields": {"stopped_ok": ["koboldcpp"]}}),
                                     ("POST", "/system/tasks/{name}/run", {"name": "backups"})])
        self.assertIn("get_backups", [t["name"] for t in mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, Ctx(level="read"), None, {})["result"]["tools"]])


if __name__ == "__main__":
    unittest.main()
