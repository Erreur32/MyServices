"""Video and cameras, read-only: Shinobi (camera recorder), go2rtc and MediaMTX (stream relays), Owncast (live broadcast).

Each one adds a « stream » block to its result, the same for all (Frigate too, in homelab_media.py), read by the « Video and cameras » page:
{role: "nvr" | "relay" | "live", engine, cameras: [{name, up, fps, detect, record, events, last}], streams: [{name, ready, codec, readers,
kinds}], storage: {used, total}, events, labels, detector_ms, live: {online, viewers, since, last}, snapshot, partial}.
The address of a camera or of a stream's source (an rtsp address, often with a user and a password in it) is never kept: only its name."""
from __future__ import annotations

import base64
import json
import re
import urllib.parse

from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, fact, num, rows

VERIFY = Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé")
MAX_ITEMS = 64
CODEC = re.compile(r"\b(H\.?26[45]|HEVC|AV1|VP[89]|MJPEG|JPEG)\b", re.I)


def camera(name, *, up=None, fps=None, detect=None, record=None, events=None, last=None) -> dict:
    """One camera of the block, its name only (never its address)."""
    return {"name": str(name), "up": up, "fps": fps, "detect": detect, "record": record, "events": events, "last": last}


def stream(name, *, ready=None, codec=None, readers=0, kinds=()) -> dict:
    return {"name": str(name), "ready": ready, "codec": codec, "readers": readers, "kinds": sorted(set(kinds))}


def codec_of(*texts) -> str | None:
    """The video codec named in a track description (« video, recvonly, H264 »), written the usual way."""
    for t in texts:
        m = CODEC.search(str(t or ""))
        if m:
            c = m.group(1).upper().replace(".", "")
            return {"H264": "H.264", "H265": "H.265", "HEVC": "H.265", "JPEG": "MJPEG"}.get(c, c)
    return None


def basic(conf: dict) -> dict | None:
    """HTTP basic authentication, when a user is set."""
    if not conf.get("user"):
        return None
    token = base64.b64encode(f'{conf["user"]}:{conf.get("password") or ""}'.encode()).decode()
    return {"Authorization": f"Basic {token}"}


def cameras_fact(cams: list[dict]) -> tuple[dict, list[str]]:
    """« Cameras 3/4 » and a problem for each silent one."""
    down = [c["name"] for c in cams if c["up"] is False]
    return fact("Caméras", f"{len(cams) - len(down)}/{len(cams)}", "bad" if down else "ok"), [f"caméra « {c} » sans image" for c in down]


class Shinobi(StatusConnector):
    """Shinobi CCTV: each camera (monitor) with its mode (watch only, record, stopped) and its state. The API key is part of the address
    (/<api key>/monitor/<group key>), read-only key from the Shinobi dashboard › API. Routes (GET): /<key>/monitor/<group>,
    /<key>/jpeg/<group>/<monitor>/s.jpg (the picture an admin asks for, never kept)."""
    type = "shinobi"
    label = "Shinobi"
    images = ("shinobisystems/shinobi", "registry.gitlab.com/shinobi-systems/shinobi", "migoller/shinobidocker")
    tested = ()
    fields = (
        Field("url", "Adresse de Shinobi", "url", required=True, help="http://<IP>:8080"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="tableau de bord Shinobi › API : une clé avec les seuls droits de lecture"),
        Field("group_key", "Clé de groupe", "text", required=True, help="Paramètres du compte › Clé de groupe"),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Dans Shinobi, menu API : créez une clé limitée à la lecture (voir les caméras, pas les modifier).",
             "La clé de groupe est dans les paramètres du compte. MyServices ne lit que la liste des caméras et leur état.")

    def _base(self) -> str:
        return f'/{urllib.parse.quote(self.conf["api_key"], safe="")}'

    def _group(self) -> str:
        return urllib.parse.quote(self.conf["group_key"], safe="")

    def _monitors(self) -> list[dict]:
        raw = self.get(f"{self._base()}/monitor/{self._group()}")
        if isinstance(raw, dict) and raw.get("ok") is False:   # Shinobi answers 200 with {ok: false} to a wrong key
            raise ConnectorError("accès refusé : clé d'API ou clé de groupe à vérifier")
        if not isinstance(raw, list):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Shinobi")
        return rows(raw)

    def collect(self) -> dict:
        mons = self._monitors()
        cams = []
        for m in mons[:MAX_ITEMS]:
            try:
                details = json.loads(m.get("details") or "{}") if isinstance(m.get("details"), str) else (m.get("details") or {})
            except ValueError:
                details = {}
            mode, state = str(m.get("mode") or ""), str(m.get("status") or "")
            on = mode in ("start", "record")
            up = None if not on else state.lower() in ("watching", "recording", "started")
            cams.append(camera(m.get("name") or m.get("mid"), up=up, detect=str(details.get("detector")) == "1" if on else None,
                               record=mode == "record"))
        head, problems = cameras_fact(cams)
        facts = [head, fact("Enregistrent", sum(1 for c in cams if c["record"]))]
        out = self.out(None, facts, problems)
        out["stream"] = {"role": "nvr", "engine": "Shinobi", "cameras": cams, "snapshot": True}
        return out

    def snapshot(self, cam: str) -> bytes:
        mid = next((m.get("mid") for m in self._monitors() if (m.get("name") or m.get("mid")) == cam), None)
        if not mid:
            raise ConnectorError("caméra inconnue")
        return self.get(f"{self._base()}/jpeg/{self._group()}/{urllib.parse.quote(str(mid), safe='')}/s.jpg", binary=True)

class Go2rtc(StatusConnector):
    """go2rtc: the streams it relays, their codec and who reads them. Routes (GET, no key by default): /api (version), /api/streams,
    /api/frame.jpeg?src=<stream> (the picture an admin asks for, never kept). A producer's address is never kept."""
    type = "go2rtc"
    label = "go2rtc"
    images = ("alexxit/go2rtc",)
    tested = ()
    fields = (
        Field("url", "Adresse de go2rtc", "url", required=True, help="http://<IP>:1984"),
        Field("user", "Utilisateur", "text", help="seulement si l'API demande un compte (api: username)"),
        Field("password", "Mot de passe", "password", secret=True),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("L'API de go2rtc (port 1984) répond sans compte par défaut ; renseignez le compte s'il est réglé dans go2rtc.yaml.",
             "MyServices lit la liste des flux et leurs lecteurs, jamais l'adresse des caméras.")

    def collect(self) -> dict:
        h = basic(self.conf)
        info = self.get_opt("/api", h) or {}
        data = self.get("/api/streams", h)
        if not isinstance(data, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à go2rtc")
        streams = []
        for name, s in list(data.items())[:MAX_ITEMS]:
            s = s if isinstance(s, dict) else {}
            prods = [p for p in s.get("producers") or [] if isinstance(p, dict)]
            cons = [c for c in s.get("consumers") or [] if isinstance(c, dict)]
            medias = [m for p in prods for m in p.get("medias") or []]
            streams.append(stream(name, ready=any(p.get("medias") or p.get("receivers") for p in prods) if prods else None,
                                  codec=codec_of(*medias), readers=len(cons), kinds=[str(c.get("type") or c.get("format_name") or "")[:20] for c in cons if c.get("type") or c.get("format_name")]))
        readers = sum(s["readers"] for s in streams)
        facts = [fact("Flux", len(streams)), fact("Lecteurs", readers)]
        out = self.out(info.get("version") if isinstance(info, dict) else None, facts, [])
        out["stream"] = {"role": "relay", "engine": "go2rtc", "streams": streams, "snapshot": True}
        return out

    def snapshot(self, cam: str) -> bytes:
        return self.get(f"/api/frame.jpeg?src={urllib.parse.quote(cam, safe='')}", basic(self.conf), binary=True)


class MediaMTX(StatusConnector):
    """MediaMTX: each path, ready or not, its tracks and its readers. Its API must be on (api: yes, port 9997). Routes (GET): /v3/info
    (version, 1.9 and later), /v3/paths/list. A path's source address is never kept."""
    type = "mediamtx"
    label = "MediaMTX"
    images = ("bluenviron/mediamtx", "aler9/rtsp-simple-server")
    tested = ()
    fields = (
        Field("url", "Adresse de l'API MediaMTX", "url", required=True, help="http://<IP>:9997 (api: yes dans mediamtx.yml)"),
        Field("user", "Utilisateur", "text", help="un compte avec la seule permission « api »"),
        Field("password", "Mot de passe", "password", secret=True),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Activez l'API dans mediamtx.yml (api: yes). Si l'authentification est réglée, donnez un compte qui n'a que la permission « api ».",
             "MyServices lit la liste des chemins (flux) et leurs lecteurs.")

    def collect(self) -> dict:
        h = basic(self.conf)
        info = self.get_opt("/v3/info", h) or {}
        data = self.get("/v3/paths/list?itemsPerPage=200", h)
        if not isinstance(data, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à l'API MediaMTX")
        items = rows(data.get("items"))
        streams = [stream(p.get("name"), ready=bool(p.get("ready")), codec=codec_of(*(p.get("tracks") or [])),
                          readers=len(p.get("readers") or []), kinds=[str((r or {}).get("type") or "")[:20] for r in p.get("readers") or [] if isinstance(r, dict)])
                   for p in items[:MAX_ITEMS] if p.get("name")]
        idle = [s["name"] for s in streams if not s["ready"]]
        facts = [fact("Flux", f"{len(streams) - len(idle)}/{len(streams)}", "warn" if idle else "ok"), fact("Lecteurs", sum(s["readers"] for s in streams))]
        out = self.out(info.get("version") if isinstance(info, dict) else None, facts, [])
        out["stream"] = {"role": "relay", "engine": "MediaMTX", "streams": streams}
        return out


class Owncast(StatusConnector):
    """Owncast: on air or not, viewers, last broadcast. Route (GET, public): /api/status."""
    type = "owncast"
    label = "Owncast"
    images = ("owncast/owncast", "gabekangas/owncast")
    tested = ()
    fields = (Field("url", "Adresse d'Owncast", "url", required=True, help="http://<IP>:8080"), VERIFY)
    setup_fields = ("url",)
    guide = ("Aucune clé : la route /api/status est publique.",)

    def collect(self) -> dict:
        st = self.get("/api/status")
        if not isinstance(st, dict) or "online" not in st:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Owncast")
        online = bool(st.get("online"))
        viewers = int(num(st.get("viewerCount"), 0) or 0)
        facts = [fact("Direct", "à l'antenne" if online else "hors antenne", "ok" if online else None)]
        if online:
            facts.append(fact("Spectateurs", viewers))
        out = self.out(st.get("versionNumber"), facts, [])
        out["stream"] = {"role": "live", "engine": "Owncast", "live": {"online": online, "viewers": viewers, "since": st.get("lastConnectTime"),
                                                                   "last": st.get("lastDisconnectTime")}}
        return out
