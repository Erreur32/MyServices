"""AI connectors (connectors/homelab_ai.py) against a fake server: Hermes Agent, Ollama, llama.cpp."""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors.base import ConnectorError, Context  # noqa: E402
from connectors.homelab_ai import Hermes, LlamaCpp, Ollama  # noqa: E402


class Fake(BaseHTTPRequestHandler):
    routes: dict = {}

    def do_GET(self):
        code, obj = self.routes.get(self.path, (404, {"error": "not found"}))
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class AI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def run_it(self, cls):
        return cls({"name": "x", "url": self.url}, Context(timeout=5)).collect()

    def test_hermes_dashboard_then_gateway(self):
        Fake.routes = {"/api/status": (200, {"version": "0.21.6", "release_date": "2026.9.24", "gateway_running": True, "gateway_state": "running",
                                             "gateway_platforms": {"api_server": {"state": "connected"},
                                                                   "telegram": {"state": "error", "error_message": "bad token"}}})}
        d = self.run_it(Hermes)
        self.assertEqual(d["version"], "0.21.6")
        self.assertEqual(d["facts"][1]["value"], "1/2 connectées")
        self.assertEqual(d["problems"], ["plateforme « telegram » : bad token"])
        Fake.routes = {"/health": (200, {"status": "ok", "platform": "hermes-agent", "version": "0.21.6"})}   # gateway address: version only
        self.assertEqual(self.run_it(Hermes)["version"], "0.21.6")
        Fake.routes = {"/health": (200, {"status": "ok"})}
        with self.assertRaises(ConnectorError):
            self.run_it(Hermes)

    def test_ollama(self):
        Fake.routes = {"/api/version": (200, {"version": "0.12.3"}), "/api/tags": (200, {"models": [{"name": "qwen3:8b"}, {"name": "llama3"}]}),
                       "/api/ps": (200, {"models": [{"name": "qwen3:8b", "size_vram": 6 * 1024 ** 3}]})}
        d = self.run_it(Ollama)
        facts = {f["label"]: f["value"] for f in d["facts"]}
        self.assertEqual((d["version"], facts["Modèles installés"], facts["Modèles chargés"]), ("0.12.3", "2", "qwen3:8b"))
        self.assertIn("Mémoire GPU utilisée", facts)

    def test_llamacpp(self):
        Fake.routes = {"/health": (200, {"status": "ok"}),
                       "/props": (200, {"build_info": "b6123-abc", "model_path": "/models/Qwen3-8B-Q4.gguf", "total_slots": 4,
                                        "default_generation_settings": {"n_ctx": 8192}})}
        d = self.run_it(LlamaCpp)
        facts = {f["label"]: f["value"] for f in d["facts"]}
        self.assertEqual((d["version"], facts["Modèle"], facts["Contexte"], facts["Emplacements"]), ("b6123-abc", "Qwen3-8B-Q4.gguf", "8192 jetons", "4"))
        Fake.routes = {"/health": (503, {"error": "loading"})}
        self.assertEqual(self.run_it(LlamaCpp)["facts"][0]["value"], "modèle en cours de chargement")


if __name__ == "__main__":
    unittest.main()
