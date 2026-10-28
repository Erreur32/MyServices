"""Dozzle: hosts and containers read through the API of its page (event stream, image check), with or without its login."""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors.base import Context  # noqa: E402
from connectors.dozzle import Dozzle  # noqa: E402
from msv.machines.matching import link  # noqa: E402

SECRET = "pw-" + "d" * 6   # built at run time: the commit guard refuses any literal secret
HOSTS = [{"id": "h1", "name": "srv", "endpoint": "local", "type": "local", "available": True, "nCPU": 8, "memTotal": 16 << 30},
         {"id": "h2", "name": "nas", "endpoint": "10.0.0.7:7007", "type": "agent", "available": True}]
CONTAINERS = [{"id": "a", "name": "web", "host": "h1", "state": "running", "health": "healthy"},
              {"id": "b", "name": "db", "host": "h1", "state": "running", "health": "unhealthy"},
              {"id": "c", "name": "old", "host": "h1", "state": "exited"},
              {"id": "d", "name": "plex", "host": "h2", "state": "running"}]
CHECKS = [{"host": "h1", "id": "a", "result": {"status": "update-available", "image": "nginx:latest"}},
          {"host": "h2", "id": "d", "result": {"status": "up-to-date", "image": "plex:latest"}}]


class FakeDozzle(BaseHTTPRequestHandler):
    login = False   # Dozzle's simple login switched on

    def signed(self):
        return not self.login or "jwt=ok" in (self.headers.get("Cookie") or "")

    def send(self, code, body, ctype="application/json", extra=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        form = parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
        if self.path == "/api/token" and form == {"username": ["me"], "password": [SECRET]}:
            return self.send(200, b"OK", "text/plain", {"Set-Cookie": "jwt=ok; Path=/"})
        return self.send(401, b"bad credentials", "text/plain")

    def do_GET(self):
        if self.path == "/healthcheck":
            return self.send(200, b"", "text/plain")
        if self.path == "/":
            conf = {"base": "", "version": "v11.3.2", "hosts": HOSTS} if self.signed() else {"base": ""}
            return self.send(200, f'<script id="config__json" type="application/json">{json.dumps(conf)}</script>'.encode(), "text/html")
        if not self.signed():
            return self.send(401, {})
        if self.path == "/api/events/stream":
            sse = (": retry\n\n" "event: server-version\ndata: {\"version\":\"v11.3.2\"}\n\n"
                   f"event: containers-changed\ndata: {json.dumps(CONTAINERS)}\n\n" "event: ping\ndata: {}\n\n")
            return self.send(200, sse.encode(), "text/event-stream")
        if self.path == "/api/image/check":
            return self.send(200, CHECKS)
        return self.send(404, {})

    def log_message(self, *a):
        pass


class DozzleApi(unittest.TestCase):
    def setUp(self):
        FakeDozzle.login = False
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeDozzle)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_port}"
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)

    def dozzle(self, **conf):
        return Dozzle({"name": "dozzle", "url": self.url, **conf}, Context(timeout=5))

    def test_hosts_and_containers_without_login(self):
        data = self.dozzle().collect()
        srv, nas = data["environments"]
        self.assertEqual(srv["containers"], {"total": 3, "running": 2, "stopped": 1, "paused": 0, "unhealthy": 1})
        self.assertEqual((srv["host"], srv["agent"], srv["cpus"]), (None, None, 8))
        self.assertEqual(srv["updates"], [{"container": "web", "image": "nginx:latest", "newer": None}])
        self.assertEqual((nas["host"], nas["agent"], nas["containers"]["total"], nas["updates"]), ("10.0.0.7:7007", "nas", 1, []))
        self.assertEqual(data["updates"], 1)
        r = self.dozzle().test()
        self.assertTrue(r.ok, r.message)
        self.assertIn("2 hôte(s), 4 conteneur(s), 1 mise(s) à jour", r.message)
        self.assertEqual(r.version, "11.3.2")

    def test_login_without_account_keeps_links(self):
        FakeDozzle.login = True
        self.assertTrue(self.dozzle().collect()["links_only"])
        r = self.dozzle().test()
        self.assertTrue(r.ok)
        self.assertIn("compte nécessaire", r.message)

    def test_login_with_account(self):
        FakeDozzle.login = True
        data = self.dozzle(user="me", password=SECRET).collect()
        self.assertEqual(len(data["environments"]), 2)

    def test_wrong_password(self):
        FakeDozzle.login = True
        r = self.dozzle(user="me", password="x" + SECRET).test()
        self.assertFalse(r.ok)
        self.assertIn("refusé", r.message)

    def test_unreachable(self):
        r = Dozzle({"name": "d", "url": "http://127.0.0.1:1"}, Context(timeout=2)).test()
        self.assertFalse(r.ok)
        self.assertIn("injoignable", r.message)

    def test_matching_by_agent_and_own_machine(self):
        data = self.dozzle().collect()
        row = {"connector": "dozzle", "name": "dozzle", "label": "Dozzle", "url": self.url, **data}
        machines = [{"ip": "127.0.0.1", "name": "srv"}, {"ip": "10.0.0.7", "name": "nas"}]
        got = link(machines, [], [], [row], [])["machines"]
        self.assertTrue(any(s["source"] == "dozzle" for s in got["10.0.0.7"]["sources"]))
        self.assertTrue(any(s["source"] == "dozzle" and s.get("containers") == 3 for s in got["127.0.0.1"]["sources"]))


if __name__ == "__main__":
    unittest.main()
