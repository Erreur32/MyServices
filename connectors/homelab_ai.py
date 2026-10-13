"""AI services: Hermes Agent, Ollama, llama.cpp. Status cards (version, models, what needs a look), GET only, nothing written."""
from __future__ import annotations

from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, fact, host_port, num, rows, size

VERIFY = Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé")


class Hermes(StatusConnector):
    """Hermes Agent (Nous Research): version, gateway and its platforms (API server, Discord, Telegram…). No key: /health of the gateway
    (version), and /api/status of the dashboard when the address is the dashboard one (gateway state, platforms needing attention)."""
    type = "hermes"
    label = "Hermes Agent"
    fields = (
        Field("url", "Adresse de Hermes", "url", required=True, help="tableau de bord http://<IP>:19119 (le plus complet) ou passerelle http://<IP>:8642"),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Aucune clé : MyServices lit /api/status du tableau de bord (hermes dashboard, port 19119) ou /health de la passerelle (port 8642).",
             "Le tableau de bord donne l'état de chaque plateforme (API, Discord…) ; la passerelle seule ne donne que la version.")

    def collect(self) -> dict:
        st = self.get_opt("/api/status")
        if isinstance(st, dict) and "gateway_state" in st:
            plats = st.get("gateway_platforms") if isinstance(st.get("gateway_platforms"), dict) else {}
            down = [k for k, p in plats.items() if isinstance(p, dict) and (p.get("state") != "connected" or p.get("needs_attention"))]
            running = st.get("gateway_running") is True
            facts = [fact("Passerelle", "en marche" if running else str(st.get("gateway_state") or "arrêtée"), "ok" if running else "bad"),
                     fact("Plateformes", f"{len(plats) - len(down)}/{len(plats)} connectées", "warn" if down else "ok" if plats else None)]
            if st.get("release_date"):
                facts.append(fact("Publiée le", str(st["release_date"])))
            problems = ([] if running else ["passerelle Hermes arrêtée"]) + [f"plateforme « {k} » : {(plats[k] or {}).get('error_message') or plats[k].get('state')}" for k in down]
            return self.out(st.get("version"), facts, problems)
        h = self.get("/health")
        if not isinstance(h, dict) or h.get("platform") != "hermes-agent":
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Hermes Agent")
        return self.out(h.get("version"), [fact("Passerelle", "en marche" if h.get("status") == "ok" else str(h.get("status")), "ok" if h.get("status") == "ok" else "bad")], [])


class Ollama(StatusConnector):
    """Ollama: version, installed models, models loaded in memory. No key. Routes (GET): /api/version, /api/tags, /api/ps."""
    type = "ollama"
    label = "Ollama"
    images = ("ollama/ollama",)
    fields = (Field("url", "Adresse d'Ollama", "url", required=True, help="http://<IP>:11434"), VERIFY)
    setup_fields = ("url",)
    guide = ("Aucune clé : Ollama répond sans authentification. Il doit écouter sur le réseau (OLLAMA_HOST=0.0.0.0), pas seulement sur 127.0.0.1.",)

    def collect(self) -> dict:
        ver = self.get("/api/version")
        if not isinstance(ver, dict) or "version" not in ver:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Ollama")
        models = rows((self.get_opt("/api/tags") or {}).get("models"))
        loaded = rows((self.get_opt("/api/ps") or {}).get("models"))
        facts = [fact("Modèles installés", len(models)), fact("Modèles chargés", ", ".join(str(m.get("name")) for m in loaded[:3]) or "aucun")]
        vram = sum(num(m.get("size_vram"), 0) for m in loaded)
        if vram:
            facts.append(fact("Mémoire GPU utilisée", size(vram)))
        return self.out(str(ver["version"]).lstrip("v"), facts, [] if models else ["aucun modèle installé"])

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 11434) or 11434}"}


class LlamaCpp(StatusConnector):
    """llama.cpp server (llama-server): build, model loaded, context size, slots. API key optional (--api-key, Bearer).
    Routes (GET): /health (503 while the model loads), /props."""
    type = "llamacpp"
    label = "llama.cpp"
    images = ("ghcr.io/ggml-org/llama.cpp", "ghcr.io/ggerganov/llama.cpp")
    fields = (
        Field("url", "Adresse de llama-server", "url", required=True, help="http://<IP>:8080"),
        Field("api_key", "Clé d'API", "password", secret=True, help="seulement si llama-server est lancé avec --api-key"),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Aucune clé par défaut. Si llama-server est lancé avec --api-key, la renseigner ici : MyServices ne fait que des GET.",)

    def collect(self) -> dict:
        h = {"Authorization": f"Bearer {self.conf['api_key']}"} if self.conf.get("api_key") else None
        try:
            health = self.get("/health", h)
        except ConnectorError as e:
            if str(e).startswith("HTTP 503"):
                return self.out(None, [fact("État", "modèle en cours de chargement", "warn")], [])
            raise
        if not isinstance(health, dict) or "status" not in health:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à llama-server")
        props = self.get_opt("/props", h) or {}
        model = str(props.get("model_alias") or props.get("model_path") or "").rsplit("/", 1)[-1]
        gen = props.get("default_generation_settings") if isinstance(props.get("default_generation_settings"), dict) else {}
        facts = [fact("État", "prêt", "ok")]
        if model:
            facts.append(fact("Modèle", model))
        if num(gen.get("n_ctx")):
            facts.append(fact("Contexte", f"{int(num(gen['n_ctx']))} jetons"))
        if num(props.get("total_slots")):
            facts.append(fact("Emplacements", int(num(props["total_slots"]))))
        return self.out(props.get("build_info"), facts, [])

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 8080) or 8080}"}
