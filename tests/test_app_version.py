"""App version on the connector cards: from the container behind the connector URL (api_link.app_version), and Dozzle's own page."""
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.api import api_link  # noqa: E402
from connectors.base import Context  # noqa: E402
from connectors.dozzle import Dozzle  # noqa: E402

ROWS = [
    {"type": "local", "ip": "10.0.0.6", "port": 3998, "service": {"name": "dockhand", "version": ""}},
    {"type": "local", "ip": "10.0.0.6", "port": 8079, "service": {"name": "dozzle", "version": "v11.3.1"}},
    {"type": "proxy", "domains": ["Dozz.lan"], "service": {"name": "dozzle", "version": "v11.3.1"}},
]


class ContainerVersion(unittest.TestCase):
    def test_by_ip_port_or_npm_name(self):
        self.assertEqual(api_link.app_version("http://10.0.0.6:8079", ROWS), "11.3.1")
        self.assertEqual(api_link.app_version("https://dozz.lan/", ROWS), "11.3.1")
        self.assertIsNone(api_link.app_version("http://10.0.0.6:3998", ROWS))   # image without a version label
        self.assertIsNone(api_link.app_version("http://10.0.0.7:8079", ROWS))
        self.assertIsNone(api_link.app_version(None, ROWS))


class Page(BaseHTTPRequestHandler):
    def do_GET(self):
        body = (b'<html><script id="config__json" type="application/json">{"version":"v11.3.1","base":""}</script></html>'
                if self.path == "/" else b"OK")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class DozzleVersion(unittest.TestCase):
    def test_version_from_page_and_state(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Page)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            d = Dozzle({"name": "dozzle", "url": f"http://127.0.0.1:{srv.server_port}"}, Context(timeout=5))
            self.assertEqual(d.version(), "11.3.1")
            self.assertEqual(d.collect()["url"], f"http://127.0.0.1:{srv.server_port}")
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()
