"""Downloads and requests, read only: Bazarr (subtitles), Overseerr / Jellyseerr (requests), qBittorrent and Transmission (torrents).

Routes come from each project's API documentation, checked against fake servers only. Nothing is ever added, paused or removed.
"""
from __future__ import annotations

import base64
import http.cookiejar
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, fact, host_port, num, rows

VERIFY = Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé")


def host_port(ports: list, inner: int) -> int | None:
    return next((h for h, c in ports if c == inner), None)


def _rate(bps) -> str:
    """Bytes per second -> « 12,3 Mo/s »."""
    v = num(bps, 0)
    for unit in ("o/s", "Ko/s", "Mo/s", "Go/s"):
        if v < 1024 or unit == "Go/s":
            return f"{v:.0f} {unit}" if unit == "o/s" else f"{v:.1f}".replace(".", ",") + f" {unit}"
        v /= 1024
    return "?"


class Bazarr(StatusConnector):
    """Bazarr: version, health issues, episodes and movies still missing subtitles. API key (X-API-KEY).
    Routes (GET): /api/system/status, /api/system/health, /api/badges."""
    type = "bazarr"
    label = "Bazarr"
    images = ("linuxserver/bazarr", "hotio/bazarr")
    fields = (
        Field("url", "Adresse de Bazarr", "url", required=True, help="http://<IP>:6767"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Settings → General → Security → API Key"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans Bazarr : Settings → General → Security → copier « API Key ». MyServices ne fait que des GET.",)

    def collect(self) -> dict:
        h = {"X-API-KEY": str(self.conf.get("api_key", ""))}
        st = self.get("/api/system/status", h)
        data = st.get("data") if isinstance(st, dict) else None
        if not isinstance(data, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Bazarr")
        health = rows(self.get_opt("/api/system/health", h))
        badges = self.get_opt("/api/badges", h) or {}
        ep, mv = int(num(badges.get("episodes"), 0)), int(num(badges.get("movies"), 0))
        facts = [fact("Épisodes sans sous-titres", ep, "warn" if ep else "ok"), fact("Films sans sous-titres", mv, "warn" if mv else "ok"),
                 fact("Santé", f"{len(health)} problème(s)" if health else "OK", "bad" if health else "ok")]
        if num(badges.get("providers")):
            facts.append(fact("Fournisseurs en pause", int(num(badges["providers"])), "warn"))
        problems = [f"{x.get('object') or '?'} : {x.get('issue') or '?'}" for x in health]
        return self.out(str(data.get("bazarr_version") or "").lstrip("v") or None, facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 6767) or 6767}"}


class Overseerr(StatusConnector):
    """Overseerr / Jellyseerr: version and update, restart pending, requests waiting for approval. API key (X-Api-Key).
    Routes (GET): /api/v1/status, /api/v1/request/count."""
    type = "overseerr"
    label = "Overseerr / Jellyseerr"
    images = ("sctx/overseerr", "linuxserver/overseerr", "fallenbagel/jellyseerr", "ghcr.io/fallenbagel/jellyseerr")
    fields = (
        Field("url", "Adresse d'Overseerr ou Jellyseerr", "url", required=True, help="http://<IP>:5055"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Settings → General → API Key"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans Overseerr ou Jellyseerr : Settings → General → copier « API Key ». MyServices ne fait que des GET.",)

    def collect(self) -> dict:
        h = {"X-Api-Key": str(self.conf.get("api_key", ""))}
        st = self.get("/api/v1/status", h)
        if not isinstance(st, dict) or "version" not in st:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Overseerr ni Jellyseerr")
        cnt = self.get("/api/v1/request/count", h) or {}
        pending = int(num(cnt.get("pending"), 0))
        facts = [fact("Demandes en attente", pending, "warn" if pending else "ok"), fact("En cours", int(num(cnt.get("processing"), 0))),
                 fact("Disponibles", int(num(cnt.get("available"), 0))), fact("Total", int(num(cnt.get("total"), 0)))]
        problems = [f"{pending} demande(s) à approuver"] if pending else []
        if st.get("updateAvailable") is True:
            facts.append(fact("Mise à jour", "disponible", "warn"))
            problems.append("mise à jour disponible")
        if st.get("restartRequired") is True:
            problems.append("redémarrage requis (réglages modifiés)")
        return self.out(st.get("version"), facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 5055) or 5055}"}


class QBittorrent(StatusConnector):
    """qBittorrent (Web UI API v2): version, speeds, connection, torrents in error or stalled. Web UI account (session cookie), or none
    when the Web UI lets the MyServices address in without login. Routes: POST /api/v2/auth/login, GET /api/v2/app/version,
    /api/v2/transfer/info, /api/v2/torrents/info."""
    type = "qbittorrent"
    label = "qBittorrent"
    images = ("linuxserver/qbittorrent", "qbittorrentofficial/qbittorrent-nox", "hotio/qbittorrent")
    fields = (
        Field("url", "Adresse de l'interface web", "url", required=True, help="http://<IP>:8080"),
        Field("user", "Utilisateur", help="vide si l'interface laisse entrer MyServices sans connexion (liste blanche)"),
        Field("password", "Mot de passe", "password", secret=True),
        VERIFY,
    )
    setup_fields = ("url", "user", "password")
    guide = ("qBittorrent : Outils → Options → Interface web : compte de l'interface web, ou « Contourner l'authentification » pour l'adresse de MyServices.",
             "MyServices ne fait que lire : jamais d'ajout, de pause ni de suppression de torrent.")
    BAD = ("error", "missingFiles")
    STALLED = ("stalledDL",)

    def _opener(self):
        ctx = None if self.tls() else ssl._create_unverified_context()
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), urllib.request.HTTPSHandler(context=ctx))

    def _req(self, op, path: str, form: dict | None = None):
        base = self.base_url()
        req = urllib.request.Request(base + path, data=urllib.parse.urlencode(form).encode() if form is not None else None,
                                     headers={"User-Agent": "myservices", "Referer": base, "Origin": base})   # qBittorrent checks them (CSRF)
        try:
            with op.open(req, timeout=self.ctx.timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise ConnectorError("accès refusé : compte de l'interface web à vérifier") from None
            raise ConnectorError(f"HTTP {e.code}") from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None

    def collect(self) -> dict:
        op = self._opener()
        if self.conf.get("user"):
            if self._req(op, "/api/v2/auth/login", {"username": self.conf["user"], "password": self.conf.get("password", "")}).strip() != "Ok.":
                raise ConnectorError("accès refusé : compte de l'interface web à vérifier")
        version = self._req(op, "/api/v2/app/version").strip()
        try:
            info = json.loads(self._req(op, "/api/v2/transfer/info"))
            torrents = json.loads(self._req(op, "/api/v2/torrents/info"))
        except ValueError:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à qBittorrent") from None
        if not isinstance(info, dict) or not isinstance(torrents, list):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à qBittorrent")
        torrents = [t for t in torrents if isinstance(t, dict)]
        bad = [t for t in torrents if t.get("state") in self.BAD]
        stalled = [t for t in torrents if t.get("state") in self.STALLED]
        conn = str(info.get("connection_status") or "")
        facts = [fact("Torrents", len(torrents)), fact("En erreur", len(bad), "bad" if bad else "ok"), fact("Bloqués", len(stalled), "warn" if stalled else None),
                 fact("Débit", f"↓ {_rate(info.get('dl_info_speed'))} · ↑ {_rate(info.get('up_info_speed'))}"),
                 fact("Connexion", {"connected": "connectée", "firewalled": "derrière un pare-feu", "disconnected": "coupée"}.get(conn, conn or "?"),
                      "ok" if conn == "connected" else "warn" if conn == "firewalled" else "bad")]
        problems = [f"« {t.get('name', '?')} » en erreur" for t in bad]
        if conn == "disconnected":
            problems.insert(0, "qBittorrent n'est plus connecté au réseau")
        return self.out(version.lstrip("v") or None, facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        port = host_port(ports, 8080)
        return {"url": f"http://{ip}:{port}"} if port else None


class Transmission(StatusConnector):
    """Transmission (RPC): version, speeds, torrents in error. Optional account (Basic). The RPC first answers 409 with the session id to send
    back (X-Transmission-Session-Id). Methods: session-get, session-stats, torrent-get (read only)."""
    type = "transmission"
    label = "Transmission"
    images = ("linuxserver/transmission", "haugene/transmission-openvpn")
    fields = (
        Field("url", "Adresse de Transmission", "url", required=True, help="http://<IP>:9091"),
        Field("user", "Utilisateur (si l'accès est protégé)"),
        Field("password", "Mot de passe", "password", secret=True),
        VERIFY,
    )
    setup_fields = ("url", "user", "password")
    guide = ("Transmission : le compte est celui de l'interface web (rpc-username / rpc-password), vide si l'accès n'est pas protégé.",
             "MyServices ne fait que lire : jamais d'ajout, de pause ni de suppression de torrent.")

    def _rpc(self, method: str, arguments: dict | None = None, sid: list | None = None):
        url = self.base_url().removesuffix("/transmission/web").removesuffix("/transmission") + "/transmission/rpc"
        h = {"User-Agent": "myservices", "Content-Type": "application/json"}
        if self.conf.get("user"):
            h["Authorization"] = "Basic " + base64.b64encode(f"{self.conf['user']}:{self.conf.get('password', '')}".encode()).decode()
        ctx = None if self.tls() else ssl._create_unverified_context()
        body = json.dumps({"method": method, "arguments": arguments or {}}).encode()
        for _ in range(2):
            if sid and sid[0]:
                h["X-Transmission-Session-Id"] = sid[0]
            try:
                with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=h, method="POST"), timeout=self.ctx.timeout, context=ctx) as r:
                    d = json.loads(r.read() or b"null")
                break
            except urllib.error.HTTPError as e:
                if e.code == 409 and sid is not None and e.headers.get("X-Transmission-Session-Id"):
                    sid[:] = [e.headers["X-Transmission-Session-Id"]]
                    continue
                if e.code in (401, 403):
                    raise ConnectorError("accès refusé : compte de Transmission à vérifier") from None
                raise ConnectorError(f"HTTP {e.code}") from None
            except (OSError, ValueError) as e:
                raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None
        else:
            raise ConnectorError("Transmission refuse l'identifiant de session")
        if not isinstance(d, dict) or d.get("result") != "success":
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Transmission")
        return d.get("arguments") or {}

    def collect(self) -> dict:
        sid: list = [None]
        session = self._rpc("session-get", {"fields": ["version"]}, sid)
        stats = self._rpc("session-stats", None, sid)
        torrents = rows(self._rpc("torrent-get", {"fields": ["name", "error", "errorString", "status", "percentDone"]}, sid).get("torrents"))
        bad = [t for t in torrents if num(t.get("error"), 0)]
        facts = [fact("Torrents", len(torrents)), fact("Actifs", int(num(stats.get("activeTorrentCount"), 0))),
                 fact("En erreur", len(bad), "bad" if bad else "ok"),
                 fact("Débit", f"↓ {_rate(stats.get('downloadSpeed'))} · ↑ {_rate(stats.get('uploadSpeed'))}")]
        problems = [f"« {t.get('name', '?')} » : {t.get('errorString') or 'erreur'}" for t in bad]
        return self.out(str(session.get("version") or "").split(" ")[0] or None, facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 9091) or 9091}"}
