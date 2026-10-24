"""AI services: Hermes Agent, Ollama, llama.cpp, Open WebUI and any server with an OpenAI-compatible API (vLLM, LM Studio, LocalAI,
KoboldCpp, LiteLLM). Status cards (version, models, what needs a look), GET only, nothing written.

Besides the facts, each one gives an « ai » block for the « IA et agents » page, the same shape for all:
{"role": "engine" | "agent" | "interface", "engine": name, "models": [model, …], "platforms": [{name, state, error}, …],
 "uses": [{"model", "provider"} or {"url", "kind"}, …], "partial": true when the address gives less than it could}, where a model is
{"name", "size" (bytes), "quant", "family", "params", "context", "loaded", "vram" (bytes), "cloud"}, each field only when known.
"""
from __future__ import annotations

import urllib.parse

from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, fact, host_port, num, rows, size

VERIFY = Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé")
MAX_MODELS = 200


def model(name, **kw) -> dict:
    """One model of the « ai » block, without the empty fields."""
    return {"name": str(name), **{k: v for k, v in kw.items() if v not in (None, "", [], False)}}


def bearer(conf: dict) -> dict | None:
    return {"Authorization": f"Bearer {conf['api_key']}"} if conf.get("api_key") else None


def bare_url(u) -> str | None:
    """Scheme, host and port of an address read in a service's settings: never its path, query or credentials."""
    try:
        p = urllib.parse.urlsplit(str(u).strip())
        return f"{p.scheme}://{p.hostname}{f':{p.port}' if p.port else ''}" if p.scheme in ("http", "https") and p.hostname else None
    except ValueError:
        return None


class Hermes(StatusConnector):
    """Hermes Agent (Nous Research): version, gateway and its platforms (API server, Discord, Telegram…), model in use. No key: /health of
    the gateway (version), and /api/status and /api/model/info of the dashboard when the address is the dashboard one (gateway state,
    platforms needing attention, model and provider); both are on the dashboard's list of public routes."""
    type = "hermes"
    label = "Hermes Agent"
    fields = (
        Field("url", "Adresse de Hermes", "url", required=True, help="tableau de bord http://<IP>:19119 (le plus complet) ou passerelle http://<IP>:8642"),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Aucune clé : MyServices lit /api/status et /api/model/info du tableau de bord (hermes dashboard, port 19119) ou /health de la passerelle (port 8642).",
             "Le tableau de bord donne l'état de chaque plateforme (API, Discord…) et le modèle utilisé ; la passerelle seule ne donne que la version.")

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
            info = self.get_opt("/api/model/info")
            info = info if isinstance(info, dict) else {}
            if info.get("model"):
                facts.append(fact("Modèle", str(info["model"])))
            problems = ([] if running else ["passerelle Hermes arrêtée"]) + [f"plateforme « {k} » : {(plats[k] or {}).get('error_message') or plats[k].get('state')}" for k in down]
            out = self.out(st.get("version"), facts, problems)
            out["ai"] = {"role": "agent", "engine": "Hermes Agent",
                         "platforms": [{"name": k, "state": str((p or {}).get("state") or "?"), **({"error": str(p["error_message"])} if (p or {}).get("error_message") else {})}
                                       for k, p in plats.items() if isinstance(p, dict)],
                         "uses": [{"model": str(info["model"]), **({"provider": str(info["provider"])} if info.get("provider") else {}),
                                   **({"context": int(num(info["effective_context_length"]))} if num(info.get("effective_context_length")) else {})}] if info.get("model") else [],
                         **({"sessions": int(num(st["active_sessions"]))} if num(st.get("active_sessions")) is not None else {})}
            return out
        h = self.get("/health")
        if not isinstance(h, dict) or h.get("platform") != "hermes-agent":
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Hermes Agent")
        out = self.out(h.get("version"), [fact("Passerelle", "en marche" if h.get("status") == "ok" else str(h.get("status")), "ok" if h.get("status") == "ok" else "bad")], [])
        out["ai"] = {"role": "agent", "engine": "Hermes Agent", "partial": True}   # the gateway alone: no platforms, no model
        return out


class Ollama(StatusConnector):
    """Ollama: version, installed models (size, quantization, family, context; « cloud » ones run on ollama.com), models loaded in memory.
    No key. Routes (GET): /api/version, /api/tags, /api/ps."""
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
        out = self.out(str(ver["version"]).lstrip("v"), facts, [] if models else ["aucun modèle installé"])
        mem, names = {m.get("name"): m for m in loaded}, {m.get("name") for m in models}
        every = [*models, *(m for m in loaded if m.get("name") not in names)]   # a loaded model is installed, but keep it if the list lags
        out["ai"] = {"role": "engine", "engine": "Ollama", "models": [self._model(m, mem.get(m.get("name"))) for m in every[:MAX_MODELS]]}
        return out

    @staticmethod
    def _model(m: dict, live: dict | None) -> dict:
        d = m.get("details") if isinstance(m.get("details"), dict) else {}
        cloud = bool(m.get("remote_host"))   # a pointer to a model served by ollama.com: a few bytes on disk, nothing in memory
        return model(m.get("name"), size=None if cloud else num(m.get("size")), quant=d.get("quantization_level"), family=d.get("family"),
                     params=d.get("parameter_size"), context=int(num(d.get("context_length"), 0)) or None, loaded=live is not None,
                     vram=num((live or {}).get("size_vram")) or None, cloud=cloud)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 11434) or 11434}"}


class LlamaCpp(StatusConnector):
    """llama.cpp server (llama-server): build, model loaded (size, parameters, quantization, context), slots. API key optional
    (--api-key, Bearer). Routes (GET): /health (503 while the model loads), /props, /v1/models."""
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
        h = bearer(self.conf)
        try:
            health = self.get("/health", h)
        except ConnectorError as e:
            if str(e).startswith("HTTP 503"):
                out = self.out(None, [fact("État", "modèle en cours de chargement", "warn")], [])
                out["ai"] = {"role": "engine", "engine": "llama.cpp", "partial": True}
                return out
            raise
        if not isinstance(health, dict) or "status" not in health:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à llama-server")
        props = self.get_opt("/props", h) or {}
        name = str(props.get("model_alias") or props.get("model_path") or "").rsplit("/", 1)[-1]
        gen = props.get("default_generation_settings") if isinstance(props.get("default_generation_settings"), dict) else {}
        facts = [fact("État", "prêt", "ok")]
        if name:
            facts.append(fact("Modèle", name))
        if num(gen.get("n_ctx")):
            facts.append(fact("Contexte", f"{int(num(gen['n_ctx']))} jetons"))
        if num(props.get("total_slots")):
            facts.append(fact("Emplacements", int(num(props["total_slots"]))))
        out = self.out(props.get("build_info"), facts, [])
        served = rows(self.get_opt("/v1/models", h))   # {"data": [{"id", "meta": {n_ctx, n_params, size, ftype}}]}
        models = [model(m.get("id"), size=num((m.get("meta") or {}).get("size")), quant=(m.get("meta") or {}).get("ftype"),
                        params=_params(num((m.get("meta") or {}).get("n_params"))), context=int(num((m.get("meta") or {}).get("n_ctx"), 0)) or None, loaded=True)
                  for m in served if m.get("id")]
        out["ai"] = {"role": "engine", "engine": "llama.cpp", "models": models or ([model(name, loaded=True, context=int(num(gen.get("n_ctx"), 0)) or None)] if name else [])}
        return out

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 8080) or 8080}"}


def _params(n: float | None) -> str | None:
    """30532122624 -> « 30.5B », as Ollama writes it."""
    return None if not n else f"{n / 1e9:.1f}B" if n >= 1e9 else f"{n / 1e6:.0f}M"


class OpenAICompatible(StatusConnector):
    """Any model server with an OpenAI-compatible API: vLLM, LM Studio, LocalAI, KoboldCpp, LiteLLM… Models it serves, loaded or not when the
    server says it. API key optional (Bearer). Routes (GET): /api/v0/models (LM Studio: state, quantization, context), else /v1/models;
    version from /version (vLLM, LocalAI) or /api/extra/version (KoboldCpp) when there is one."""
    type = "openai-compatible"
    label = "API compatible OpenAI"
    images = ("vllm/vllm-openai", "localai/localai", "quay.io/go-skynet/local-ai", "ghcr.io/berriai/litellm", "koboldcpp/koboldcpp")
    fields = (
        Field("url", "Adresse du serveur", "url", required=True, help="http://<IP>:<port>, sans /v1 (vLLM 8000, LM Studio 1234, LocalAI 8080, KoboldCpp 5001, LiteLLM 4000)"),
        Field("api_key", "Clé d'API", "password", secret=True, help="seulement si le serveur en demande une (LiteLLM, vLLM lancé avec --api-key)"),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Pour vLLM, LM Studio, LocalAI, KoboldCpp, LiteLLM et tout serveur qui répond à /v1/models comme l'API d'OpenAI.",
             "MyServices ne fait que lire la liste des modèles et la version : il n'envoie aucune requête au modèle.")

    def base_url(self) -> str:
        return super().base_url().removesuffix("/v1")

    def collect(self) -> dict:
        h = bearer(self.conf)
        lms = rows(self.get_opt("/api/v0/models", h))   # LM Studio's own list: says which model is loaded
        if lms and all("state" in m for m in lms):
            engine, models = "LM Studio", [model(m.get("id"), quant=m.get("quantization"), family=m.get("arch"), loaded=m.get("state") == "loaded",
                                                 context=int(num(m.get("max_context_length"), 0)) or None) for m in lms if m.get("id")]
        else:
            listing = self.get("/v1/models", h)
            if not isinstance(listing, dict) or not isinstance(listing.get("data"), list):
                raise ConnectorError("réponse inattendue : l'adresse ne mène pas à une API compatible OpenAI")
            served = rows(listing["data"])
            owners = {str(m.get("owned_by") or "").lower() for m in served}
            engine = "vLLM" if "vllm" in owners else "llama.cpp" if "llamacpp" in owners else "KoboldCpp" if "koboldcpp" in owners else None
            models = [model(m.get("id"), context=int(num(m.get("max_model_len"), 0)) or None) for m in served if m.get("id")]
        version = None
        kobold = self.get_opt("/api/extra/version", h)
        if isinstance(kobold, dict) and kobold.get("result") == "KoboldCpp":
            engine, version = "KoboldCpp", kobold.get("version")
        else:
            v = self.get_opt("/version", h)
            version = v.get("version") if isinstance(v, dict) else None
        loaded = [m["name"] for m in models if m.get("loaded")]
        facts = [fact("Modèles", len(models))] + ([fact("Chargés", ", ".join(loaded[:3]))] if loaded else []) + ([fact("Serveur", engine)] if engine else [])
        out = self.out(str(version).lstrip("v") if version else None, facts, [] if models else ["aucun modèle servi"])
        out["ai"] = {"role": "engine", "engine": engine or "API compatible OpenAI", "models": models[:MAX_MODELS]}
        return out

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        inner = 4000 if "litellm" in image else 5001 if "koboldcpp" in image else 8080 if "local" in image else 8000
        return {"url": f"http://{ip}:{host_port(ports, inner) or inner}"}


class OpenWebUI(StatusConnector):
    """Open WebUI: version; with an API key, the models it offers; with an admin's key, the model servers (Ollama, OpenAI-compatible) and
    tool servers (MCP, OpenAPI) it talks to, for « who talks to whom ». Only their addresses are kept, never the keys stored next to them.
    Routes (GET): /api/version (public), /api/models, /ollama/config, /openai/config, /api/v1/configs/tool_servers (admin)."""
    type = "open-webui"
    label = "Open WebUI"
    images = ("ghcr.io/open-webui/open-webui",)
    fields = (
        Field("url", "Adresse d'Open WebUI", "url", required=True, help="http://<IP>:3000 ou le port publié"),
        Field("api_key", "Clé d'API", "password", secret=True, help="Réglages → Compte → Clés d'API ; celle d'un admin montre aussi à quoi Open WebUI est relié"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Sans clé : la version seulement. Avec une clé d'API (Réglages → Compte → Clés d'API, à autoriser par l'admin) : les modèles proposés.",
             "Avec la clé d'un admin : les serveurs de modèles et d'outils reliés. MyServices n'en garde que les adresses, jamais les clés.")

    def collect(self) -> dict:
        ver = self.get("/api/version")
        if not isinstance(ver, dict) or "version" not in ver:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Open WebUI")
        h, facts, ai = bearer(self.conf), [], {"role": "interface", "engine": "Open WebUI", "models": [], "uses": []}
        if not h:
            ai["partial"] = True
            return {**self.out(ver.get("version"), [fact("Clé d'API", "absente : version seulement")], []), "ai": ai}
        listed = rows(self.get("/api/models", h))
        ai["models"] = [model(m.get("name") or m.get("id"), family=m.get("owned_by")) for m in listed[:MAX_MODELS] if m.get("id")]
        facts.append(fact("Modèles proposés", len(listed)))
        admin = True
        for path, key, kind in (("/ollama/config", "OLLAMA_BASE_URLS", "ollama"), ("/openai/config", "OPENAI_API_BASE_URLS", "openai")):
            try:
                cfg = self.get(path, h)
            except ConnectorError:
                admin = False   # not an admin's key, or the route is gone: the links stay unknown
                continue
            if isinstance(cfg, dict) and cfg.get(f"ENABLE_{kind.upper()}_API") is not False:
                ai["uses"] += [{"url": u, "kind": kind} for u in dict.fromkeys(filter(None, map(bare_url, cfg.get(key) or [])))]
        try:
            tools = self.get("/api/v1/configs/tool_servers", h)
        except ConnectorError:
            tools = None
        for c in rows((tools or {}).get("TOOL_SERVER_CONNECTIONS") if isinstance(tools, dict) else None):
            if (u := bare_url(c.get("url"))) and (c.get("config") or {}).get("enable", True) is not False:
                ai["uses"].append({"url": u, "kind": "mcp" if c.get("type") == "mcp" else "tools"})
        if not admin:
            ai["partial"] = True
            facts.append(fact("Liens", "clé d'un admin nécessaire"))
        else:
            facts.append(fact("Serveurs reliés", len(ai["uses"])))
        return {**self.out(ver.get("version"), facts, []), "ai": ai}

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 8080) or 8080}"}
