"""AI connectors (connectors/homelab_ai.py) against a fake server: Hermes Agent, Ollama, llama.cpp, OpenAI-compatible servers, Open WebUI."""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors.base import ConnectorError, Context  # noqa: E402
from connectors.homelab_ai import Hermes, LlamaCpp, Ollama, OpenAICompatible, OpenWebUI, bare_url  # noqa: E402


ADMIN = "Bearer admin-" + "key"   # built at run time: no secret-looking literal in the repository


class Fake(BaseHTTPRequestHandler):
    routes: dict = {}
    admin_only: set = set()   # paths answered only to the admin key

    def do_GET(self):
        code, obj = self.routes.get(self.path, (404, {"error": "not found"}))
        if self.path in self.admin_only and self.headers.get("Authorization") != ADMIN:
            code, obj = 401, {"detail": "Not authenticated"}
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

    def setUp(self):
        Fake.admin_only = set()

    def run_it(self, cls, **conf):
        return cls({"name": "x", "url": self.url, **conf}, Context(timeout=5)).collect()

    def test_hermes_dashboard_then_gateway(self):
        Fake.routes = {"/api/status": (200, {"version": "0.21.6", "release_date": "2026.9.24", "gateway_running": True, "gateway_state": "running",
                                             "gateway_platforms": {"api_server": {"state": "connected"},
                                                                   "telegram": {"state": "error", "error_message": "bad token"}}})}
        d = self.run_it(Hermes)
        self.assertEqual(d["version"], "0.21.6")
        self.assertEqual(d["facts"][1]["value"], "1/2 connectées")
        self.assertEqual(d["problems"], ["plateforme « telegram » : bad token"])
        self.assertEqual(d["ai"]["platforms"][1], {"name": "telegram", "state": "error", "error": "bad token"})
        self.assertEqual(d["ai"]["uses"], [])
        Fake.routes["/api/model/info"] = (200, {"model": "qwen3-coder-30b", "provider": "custom", "effective_context_length": 65536})
        self.assertEqual(self.run_it(Hermes)["ai"]["uses"], [{"model": "qwen3-coder-30b", "provider": "custom", "context": 65536}])
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
        self.assertEqual(d["ai"]["models"][0], {"name": "qwen3:8b", "loaded": True, "vram": 6 * 1024 ** 3})
        Fake.routes["/api/tags"] = (200, {"models": [{"name": "glm:cloud", "size": 338, "remote_host": "https://ollama.com:443",
                                                      "details": {"family": "glm", "parameter_size": "756b", "context_length": 1000000, "quantization_level": "Q4_K_M"}}]})
        Fake.routes["/api/ps"] = (200, {"models": []})
        self.assertEqual(self.run_it(Ollama)["ai"]["models"], [{"name": "glm:cloud", "quant": "Q4_K_M", "family": "glm", "params": "756b", "context": 1000000, "cloud": True}])

    def test_llamacpp(self):
        Fake.routes = {"/health": (200, {"status": "ok"}),
                       "/props": (200, {"build_info": "b6123-abc", "model_path": "/models/Qwen3-8B-Q4.gguf", "total_slots": 4,
                                        "default_generation_settings": {"n_ctx": 8192}})}
        d = self.run_it(LlamaCpp)
        facts = {f["label"]: f["value"] for f in d["facts"]}
        self.assertEqual((d["version"], facts["Modèle"], facts["Contexte"], facts["Emplacements"]), ("b6123-abc", "Qwen3-8B-Q4.gguf", "8192 jetons", "4"))
        self.assertEqual(d["ai"]["models"], [{"name": "Qwen3-8B-Q4.gguf", "context": 8192, "loaded": True}])   # no /v1/models: from /props
        Fake.routes["/v1/models"] = (200, {"data": [{"id": "qwen3-coder", "owned_by": "llamacpp",
                                                     "meta": {"n_ctx": 65536, "n_params": 30532122624, "size": 21719611392, "ftype": "Q5_K - Medium"}}]})
        self.assertEqual(self.run_it(LlamaCpp)["ai"]["models"], [{"name": "qwen3-coder", "size": 21719611392.0, "quant": "Q5_K - Medium", "params": "30.5B", "context": 65536, "loaded": True}])
        Fake.routes = {"/health": (503, {"error": "loading"})}
        self.assertEqual(self.run_it(LlamaCpp)["facts"][0]["value"], "modèle en cours de chargement")

    def test_openai_compatible(self):
        Fake.routes = {"/v1/models": (200, {"object": "list", "data": [{"id": "Qwen/Qwen3-8B", "owned_by": "vllm", "max_model_len": 32768}]}),
                       "/version": (200, {"version": "0.11.0"})}
        d = self.run_it(OpenAICompatible, url=self.url + "/v1")   # the address may be given with /v1
        self.assertEqual((d["version"], d["ai"]["engine"], d["ai"]["models"]), ("0.11.0", "vLLM", [{"name": "Qwen/Qwen3-8B", "context": 32768}]))
        Fake.routes = {"/api/v0/models": (200, {"data": [{"id": "gemma-3", "state": "loaded", "quantization": "Q4_K_M", "arch": "gemma3", "max_context_length": 8192},
                                                         {"id": "nomic-embed", "state": "not-loaded"}]})}
        d = self.run_it(OpenAICompatible)
        self.assertEqual(d["ai"]["engine"], "LM Studio")
        self.assertEqual([m.get("loaded", False) for m in d["ai"]["models"]], [True, False])
        Fake.routes = {"/v1/models": (200, {"data": [{"id": "koboldcpp/mistral"}]}), "/api/extra/version": (200, {"result": "KoboldCpp", "version": "1.98"})}
        self.assertEqual(self.run_it(OpenAICompatible)["ai"]["engine"], "KoboldCpp")
        Fake.routes = {"/v1/models": (200, {"hello": "world"})}
        with self.assertRaises(ConnectorError):
            self.run_it(OpenAICompatible)

    def test_open_webui(self):
        Fake.routes = {"/api/version": (200, {"version": "0.12.3"}),
                       "/api/models": (200, {"data": [{"id": "qwen3:8b", "name": "Qwen 3", "owned_by": "ollama"}]}),
                       "/ollama/config": (200, {"ENABLE_OLLAMA_API": True, "OLLAMA_BASE_URLS": ["http://192.168.1.10:11434", "http://192.168.1.10:11434/"]}),
                       "/openai/config": (200, {"ENABLE_OPENAI_API": True, "OPENAI_API_BASE_URLS": ["https://u:p@api.example.com/v1?x=1"], "OPENAI_API_KEYS": ["sk-" + "x" * 20]}),
                       "/api/v1/configs/tool_servers": (200, {"TOOL_SERVER_CONNECTIONS": [{"url": "http://192.168.1.10:8000/time", "type": "mcp", "key": "k" * 12, "config": {"enable": True}}]})}
        Fake.admin_only = {"/ollama/config", "/openai/config", "/api/v1/configs/tool_servers"}
        d = self.run_it(OpenWebUI)
        self.assertEqual((d["version"], d["ai"]["partial"], d["ai"]["models"]), ("0.12.3", True, []))   # no key: the version only
        d = self.run_it(OpenWebUI, api_key="user-" + "key")
        self.assertEqual((d["ai"]["models"], d["ai"]["uses"], d["ai"]["partial"]), ([{"name": "Qwen 3", "family": "ollama"}], [], True))
        d = self.run_it(OpenWebUI, api_key="admin-" + "key")
        self.assertEqual(d["ai"]["uses"], [{"url": "http://192.168.1.10:11434", "kind": "ollama"}, {"url": "https://api.example.com", "kind": "openai"},
                                           {"url": "http://192.168.1.10:8000", "kind": "mcp"}])
        self.assertNotIn("partial", d["ai"])
        self.assertNotIn("sk-", json.dumps(d))
        self.assertNotIn("kkkk", json.dumps(d))

    def test_bare_url(self):
        self.assertEqual(bare_url("https://user:pw@host.lan:8443/v1?key=1"), "https://host.lan:8443")
        self.assertIsNone(bare_url("not an address"))


if __name__ == "__main__":
    unittest.main()
