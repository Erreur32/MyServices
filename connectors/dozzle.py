"""Dozzle : lien vers les journaux de chaque conteneur, et ses hôtes / conteneurs lus par l'API de sa page. Aucun journal lu.

Dozzle ouvre un conteneur par son nom : /show?name=<conteneur> (assets/pages/show.vue : le nom est
cherché parmi les conteneurs de tous ses hôtes et agents ; même nom sur plusieurs machines = vue
fusionnée). Santé : GET /healthcheck (200 si Dozzle voit au moins un hôte Docker).

Lecture (code source de Dozzle v11, internal/web) : l'API est celle de sa page, non documentée, lue champ par champ :
  POST /api/token (formulaire username / password, connexion « simple » seulement)  cookie de session « jwt »
  GET  /                    <script id="config__json"> : version, hosts (id, name, endpoint, type, available, nCPU, memTotal)
  GET  /api/events/stream   flux SSE : « update-host » (hôtes injoignables) puis « containers-changed » (tous les conteneurs) ;
                            lu jusqu'à ce premier instantané, puis fermé
  GET  /api/image/check     état des images vérifié par Dozzle (« update-available »), vide si sa vérification est coupée
Sans connexion Dozzle, tout est lisible sans compte ; connexion activée et pas de compte ici : liens seulement.
"""
from __future__ import annotations

import http.cookiejar
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import Connector, ConnectorError, Field, Result

LINKS_ONLY = "connexion Dozzle activée : compte nécessaire pour lire hôtes et conteneurs (liens « journaux » gardés)"


class Dozzle(Connector):
    type = "dozzle"
    label = "Dozzle"
    kinds = ("containers", "logs")
    images = ("amir20/dozzle",)
    tested = ()
    fields = (
        Field("url", "URL de Dozzle", "url", required=True, help="ex. https://dozzle.lan, celle ouverte dans le navigateur"),
        Field("user", "Compte Dozzle", help="seulement si la connexion Dozzle est activée (connexion simple) ; vide sinon"),
        Field("password", "Mot de passe", "password", secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé"),
    )
    setup_fields = ("url",)
    guide = (
        "Sans connexion Dozzle (cas par défaut) : seule l'URL est utile, compte et mot de passe restent vides.",
        "Connexion Dozzle activée (DOZZLE_AUTH_PROVIDER=simple) : un compte du fichier users.yml.",
        "Connexion par un proxy (Authelia, Authentik…) : MyServices garde seulement les liens « journaux ».",
    )

    def _base(self) -> str:
        return self.conf["url"].rstrip("/")

    def _opener(self) -> urllib.request.OpenerDirector:
        if not getattr(self, "_op", None):
            tls = None if self.conf.get("verify_tls", True) is not False else ssl._create_unverified_context()  # NOSONAR S5527 ; certificat auto-signé
            self._op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                                                   urllib.request.HTTPSHandler(context=tls))
            if self.conf.get("user"):
                self._login()
        return self._op

    def _login(self) -> None:
        body = urllib.parse.urlencode({"username": self.conf["user"], "password": self.conf.get("password") or ""}).encode()
        try:
            self._op.open(urllib.request.Request(self._base() + "/api/token", data=body, method="POST"), timeout=self.ctx.timeout).read()
        except urllib.error.HTTPError as e:
            self._op = None
            raise ConnectorError("compte ou mot de passe refusé" if e.code == 401
                                 else f"HTTP {e.code} à la connexion (connexion « simple » seulement)") from None
        except (OSError, ValueError) as e:
            self._op = None
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e)})") from None

    def _open(self, path: str, accept: str = "application/json"):
        req = urllib.request.Request(self._base() + path, headers={"Accept": accept, "User-Agent": "myservices"})
        try:
            return self._opener().open(req, timeout=self.ctx.timeout)
        except urllib.error.HTTPError as e:
            raise ConnectorError(f"HTTP {e.code} sur {path}") from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e)})") from None

    def _config(self) -> dict:
        """config__json of the page; without a session behind Dozzle's login, only « base » (and the providers)."""
        if getattr(self, "_conf_json", None) is None:
            with self._open("/", "text/html") as r:
                page = r.read(2_000_000).decode("utf-8", "replace")
            m = re.search(r'id="config__json"[^>]*>(.*?)</script>', page, re.S)
            try:
                got = json.loads(m.group(1)) if m else {}
            except ValueError:
                got = {}
            self._conf_json = got if isinstance(got, dict) else {}
        return self._conf_json

    def _snapshot(self) -> tuple[list, set]:
        """(containers, ids of the hosts said unavailable) from the start of the event stream, read until the first snapshot."""
        down, event, data = set(), "", []
        deadline = time.monotonic() + self.ctx.timeout
        with self._open("/api/events/stream", "text/event-stream") as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].strip())
                elif not line:   # end of one event
                    payload = _json(data)
                    if event == "update-host" and isinstance(payload, dict) and payload.get("available") is False:
                        down.add(str(payload.get("id")))
                    if event == "containers-changed":
                        return (payload if isinstance(payload, list) else []), down
                    event, data = "", []
                if time.monotonic() > deadline:
                    break
        raise ConnectorError("flux d'événements sans liste de conteneurs")

    def _updates(self) -> dict:
        """{container id: image} of the containers whose image has a newer version (Dozzle's own check, its cache)."""
        try:
            with self._open("/api/image/check") as r:
                got = json.loads(r.read() or b"[]")
        except (ConnectorError, ValueError):
            return {}   # check switched off, or the registries slow to answer: no update rather than a failure
        if not isinstance(got, list):
            return {}
        return {str(u.get("id")): u["result"].get("image") for u in got
                if isinstance(u, dict) and isinstance(u.get("result"), dict) and u["result"].get("status") == "update-available"}

    def link(self, container: str) -> str:
        return f"{self._base()}/show?{urllib.parse.urlencode({'name': container})}"

    def collect(self) -> dict:
        r = self._health()
        if not r.ok:
            raise ConnectorError(r.message)
        cfg = self._config()
        if "hosts" not in cfg:   # Dozzle's login page: the session is missing
            if self.conf.get("user"):
                raise ConnectorError("connecté, mais Dozzle ne montre pas ses hôtes (rôle du compte ?)")
            return {"url": self._base(), "links_only": True}
        containers, down = self._snapshot()
        updates = self._updates()
        envs = [_environment(h, containers, down, updates) for h in cfg.get("hosts") or [] if isinstance(h, dict) and h.get("id") is not None]
        return {"url": self._base(), "environments": envs, "updates": sum(len(e["updates"]) for e in envs)}

    def version(self) -> str | None:
        """App version written by Dozzle in its page (config__json « version »), readable once signed in."""
        try:
            v = self._config().get("version")
        except ConnectorError:
            return None
        return str(v).lstrip("v") if v else None

    def _health(self) -> Result:
        try:
            with self._open("/healthcheck", "*/*") as r:
                code = r.status
        except ConnectorError as e:
            m = re.match(r"HTTP (\d+)", str(e))
            if not m:
                return Result(False, str(e))
            code = int(m.group(1))
        if code == 200:
            return Result(True, "joignable")
        return Result(False, f"HTTP {code} sur /healthcheck (aucun hôte Docker vu par Dozzle ?)")

    def test(self) -> Result:
        try:
            data = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        if data.get("links_only"):
            return Result(True, f"joignable : liens « journaux » ajoutés aux conteneurs ; {LINKS_ONLY}")
        envs, n = data["environments"], data["updates"]
        total = sum(e["containers"]["total"] for e in envs)
        return Result(True, f"{len(envs)} hôte(s), {total} conteneur(s)" + (f", {n} mise(s) à jour d'image" if n else "")
                      + " ; liens « journaux » ajoutés aux conteneurs", self.version())

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c == 8080), None)
        return {"url": f"http://{ip}:{web}"} if web else None


def _json(lines: list[str]):
    try:
        return json.loads("\n".join(lines)) if lines else None
    except ValueError:
        return None


def _environment(h: dict, containers: list, down: set, updates: dict) -> dict:
    """One Dozzle host (local socket, remote host or agent) in the shape of a Dockhand environment (card, matching.py)."""
    mine = [c for c in containers if isinstance(c, dict) and str(c.get("host")) == str(h["id"])]
    states = [str(c.get("state") or "") for c in mine]
    endpoint = str(h.get("endpoint") or "")
    return {
        "id": h["id"], "name": h.get("name"), "agent": h.get("name") if h.get("type") == "agent" else None,
        # remote host or agent: its address; local socket: none, matching.py takes the machine of Dozzle itself
        "host": endpoint if re.match(r"^(tcp://|https?://)?[\w.-]+:\d+$", endpoint) else None,
        "available": h.get("available") is not False and str(h["id"]) not in down,
        "cpus": h.get("nCPU") if isinstance(h.get("nCPU"), int) else None,
        "memory": h.get("memTotal") if isinstance(h.get("memTotal"), int) else None,
        "containers": {"total": len(mine), "running": states.count("running"), "stopped": states.count("exited") + states.count("dead"),
                       "paused": states.count("paused"), "unhealthy": sum(1 for c in mine if c.get("health") == "unhealthy")},
        "updates": [{"container": c.get("name"), "image": updates[str(c.get("id"))], "newer": None} for c in mine if str(c.get("id")) in updates],
    }
