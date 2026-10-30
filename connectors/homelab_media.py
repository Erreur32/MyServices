"""Frigate (caméras) et la famille *arr (Sonarr, Radarr, Lidarr, Prowlarr), en lecture seule."""
from __future__ import annotations

import http.cookiejar
import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

from connectors import reqstats
from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, fact, num, size, duration, rows


def _enabled(cam: dict, part: str) -> bool | None:
    """Whether a part of a Frigate camera's config (detect, record) is on; None when the config does not say."""
    v = cam.get(part)
    return v.get("enabled") if isinstance(v, dict) else None


def _host(url: object) -> str | None:
    """The machine of a stream address, never its account; none for the local relay."""
    try:
        host = urllib.parse.urlsplit(str(url).removeprefix("ffmpeg:")).hostname
    except ValueError:
        return None
    return None if host in (None, "127.0.0.1", "localhost") else host


def _camera_host(camera: dict, relays: dict) -> str | None:
    """The address of a camera: in its input, or in the go2rtc list when the input goes through the local relay (rtsp://127.0.0.1:8554/<name>)."""
    for item in (camera.get("ffmpeg") or {}).get("inputs") or []:
        path = item.get("path") if isinstance(item, dict) else None
        sources = relays.get(str(path).rsplit("/", 1)[-1].partition("?")[0])
        for url in [path, *(sources if isinstance(sources, list) else [sources])]:
            if host := _host(url):
                return host
    return None


class Frigate(StatusConnector):
    """Frigate NVR : caméras (images par seconde), détecteurs, stockage, événements des 24 dernières heures.

    Routes lues (GET) : /api/version, /api/stats, /api/config (detection and recording of each camera), /api/events,
    /api/<camera>/latest.jpg (the picture shown on the camera tile, never kept), /api/<camera> (live MJPEG feed, relayed on a click). Port 5000 (internal, no sign-in) needs no account; port 8971
    (Frigate 0.14+, sign-in) takes an account: POST /api/login gives the frigate_token cookie (a JWT), kept in memory only and sent with
    each call. D'après la documentation de Frigate (API HTTP) : à confirmer sur un vrai Frigate."""
    type = "frigate"
    label = "Frigate"
    images = ("ghcr.io/blakeblackshear/frigate", "blakeblackshear/frigate")
    tested = ()
    fields = (
        Field("url", "Adresse de Frigate", "url", required=True, help="http://<IP>:5000 sans connexion, ou https://<IP>:8971 avec un compte"),
        Field("user", "Utilisateur", "text", help="seulement pour le port 8971 : un compte de rôle « viewer » suffit"),
        Field("password", "Mot de passe", "password", secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé du port 8971"),
    )
    setup_fields = ("url",)
    guide = ("Port 5000 (API interne, sans connexion) : aucun compte à donner ; ce port ne doit pas être exposé sur Internet.",
             "Port 8971 (avec connexion, Frigate 0.14+) : donnez un compte de rôle « viewer » (lecture seule) et décochez la vérification du certificat s'il est auto-signé.",
             "MyServices ne fait que des GET (version, statistiques, événements), après la connexion.")
    _token: str | None = None

    def _login(self) -> str:
        """Signs in with the account (POST /api/login) and returns the frigate_token cookie Frigate sets; the password is never kept nor logged."""
        jar = http.cookiejar.CookieJar()
        ctx = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in per connector for a self-signed LAN certificate
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ctx))
        url = self.base_url() + "/api/login"
        body = json.dumps({"user": str(self.conf["user"]), "password": str(self.conf.get("password") or "")}).encode()
        req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json", "User-Agent": "myservices"})
        t0 = time.monotonic()
        try:
            with opener.open(req, timeout=self.ctx.timeout) as r:
                r.read()
        except urllib.error.HTTPError as e:
            reqstats.record(self.ctx.owner, url, (time.monotonic() - t0) * 1000, e.code, f"HTTP {e.code}")
            raise ConnectorError("compte refusé : identifiant ou mot de passe faux" if e.code in (400, 401, 403) else f"connexion : HTTP {e.code}") from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None
        reqstats.record(self.ctx.owner, url, (time.monotonic() - t0) * 1000, 200)
        token = next((c.value for c in jar if c.name == "frigate_token"), None)
        if not token:
            raise ConnectorError("connexion refusée : ce Frigate ne renvoie pas de jeton")
        return token

    def get(self, path: str, headers: dict | None = None, **kw):
        """With an account, each call carries the session token; an expired one (refused) signs in again, once."""
        if not self.conf.get("user"):
            return super().get(path, headers, **kw)
        for retry in (False, True):
            if self._token is None:
                self._token = self._login()
            auth = {"Authorization": f"Bearer {self._token}", "Cookie": f"frigate_token={self._token}"}
            try:
                return super().get(path, {**(headers or {}), **auth}, **kw)
            except ConnectorError as e:
                if retry or not str(e).startswith("accès refusé"):
                    raise
                self._token = None

    def collect(self) -> dict:
        stats = self.get("/api/stats")
        if not isinstance(stats, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Frigate")
        service = stats.get("service") if isinstance(stats.get("service"), dict) else {}
        cams = {k: v for k, v in (stats.get("cameras") or {}).items() if isinstance(v, dict)}
        down = sorted(k for k, v in cams.items() if num(v.get("camera_fps"), 0) == 0)
        dets = [v for v in (stats.get("detectors") or {}).values() if isinstance(v, dict)]
        speeds = [num(d.get("inference_speed")) for d in dets if num(d.get("inference_speed")) is not None]
        free, rec = None, None
        for path, v in (service.get("storage") or {}).items():
            if isinstance(v, dict) and num(v.get("total")) and num(v.get("free")) is not None:   # Mo
                free = (num(v["free"]) * 1048576, num(v["total"]) * 1048576) if free is None else free
                if "recordings" in str(path) and rec is None:
                    rec = {"used": (num(v["total"]) - num(v["free"])) * 1048576, "total": num(v["total"]) * 1048576}
        events, ev = None, []
        try:
            ev = rows(self.get(f"/api/events?limit=500&after={int(time.time()) - 86400}"))
            events = len(ev)
        except ConnectorError:
            pass   # événements indisponibles (version, droits) : le reste est lu
        facts = [fact("Caméras", f"{len(cams) - len(down)}/{len(cams)}", "bad" if down else "ok")]
        if speeds:
            facts.append(fact("Détection", f"{max(speeds):.0f} ms", "warn" if max(speeds) > 100 else "ok"))
        if free:
            pct = 100 * (free[1] - free[0]) / free[1] if free[1] else 0
            facts.append(fact("Stockage", f"{size(free[0])} libres", "bad" if pct >= 95 else "warn" if pct >= 90 else None))
        if events is not None:
            facts.append(fact("Événements 24 h", f"{events}{'+' if events >= 500 else ''}"))
        if service.get("uptime") is not None:
            facts.append(fact("En marche", duration(num(service.get("uptime")))))
        out = self.out(service.get("version"), facts, [f"caméra « {c} » sans image (0 image/s)" for c in down])
        out["stream"] = self._block(cams, ev, events, rec or ({"used": free[1] - free[0], "total": free[1]} if free else None), max(speeds) if speeds else None)
        out["frigate"] = self._system(stats, service, cams)
        return out

    @staticmethod
    def _system(stats: dict, service: dict, cams: dict) -> dict:
        """What Frigate says about its own load (/api/stats), for the Frigate tab: detectors, GPUs, each camera's processes, storage, temperatures.
        Process figures come from `cpu_usages`, keyed by pid (percent of CPU and of memory)."""
        usage = stats.get("cpu_usages") if isinstance(stats.get("cpu_usages"), dict) else {}

        def proc(pid) -> dict:
            u = usage.get(str(pid)) if pid is not None else None
            return {"cpu": num(u.get("cpu")), "mem": num(u.get("mem"))} if isinstance(u, dict) else {}
        dets = [{"name": str(k), "ms": num(v.get("inference_speed")), "pid": v.get("pid"), **proc(v.get("pid"))}
                for k, v in (stats.get("detectors") or {}).items() if isinstance(v, dict)]
        def pct(v):   # « 12.5 % » (a string)
            return num(str(v).replace("%", "").strip()) if v is not None else None
        gpus = [{"name": str(k), "gpu": pct(v.get("gpu")), "mem": pct(v.get("mem")), "enc": pct(v.get("enc")), "dec": pct(v.get("dec"))}
                for k, v in (stats.get("gpu_usages") or {}).items() if isinstance(v, dict)]
        cameras = [{"name": k, "fps": num(v.get("camera_fps")), "process_fps": num(v.get("process_fps")), "detection_fps": num(v.get("detection_fps")),
                    "skipped_fps": num(v.get("skipped_fps")), "ffmpeg": proc(v.get("ffmpeg_pid")), "capture": proc(v.get("capture_pid")), "detect": proc(v.get("pid"))}
                   for k, v in list(cams.items())[:64]]
        storage = [{"path": str(k), "total": num(v.get("total")), "used": num(v.get("used")), "free": num(v.get("free"))}   # Mo
                   for k, v in (service.get("storage") or {}).items() if isinstance(v, dict)]
        temps = {str(k): num(v) for k, v in (service.get("temperatures") or {}).items() if num(v) is not None}
        return {"detectors": dets, "gpus": gpus, "cameras": cameras, "storage": storage, "temperatures": temps, "uptime": num(service.get("uptime")),
                "latest_version": service.get("latest_version"), "version": service.get("version")}

    def _block(self, cams: dict, ev: list[dict], events: int | None, storage: dict | None, speed: float | None) -> dict:
        """The « stream » block (see homelab_stream): each camera with what its config says it does, its events of the last 24 h."""
        conf = self.get_opt("/api/config") or {}
        cc = conf.get("cameras") if isinstance(conf, dict) and isinstance(conf.get("cameras"), dict) else {}
        relays = ((conf.get("go2rtc") or {}).get("streams") or {}) if isinstance(conf, dict) else {}
        per = Counter(str(e.get("camera")) for e in ev)
        by_cam: dict[str, Counter] = {}
        for e in ev:
            if e.get("label"):
                by_cam.setdefault(str(e.get("camera")), Counter())[str(e["label"])] += 1
        now = time.time()
        hourly = [0] * 24   # index 0 = the oldest hour of the last 24, 23 = the hour just gone
        for e in ev:
            t = num(e.get("start_time"))
            if t is not None and 0 <= now - t < 86400:
                hourly[23 - int((now - t) // 3600)] += 1
        recent = [{"camera": str(e.get("camera")), "label": str(e.get("label") or "?"), "t": num(e.get("start_time"))}
                  for e in sorted((e for e in ev if num(e.get("start_time")) is not None), key=lambda e: -num(e.get("start_time")))[:5]]
        last: dict[str, float] = {}
        for e in ev:
            t = num(e.get("start_time"))
            if t is not None and t > last.get(str(e.get("camera")), 0):
                last[str(e.get("camera"))] = t
        out = []
        for name, v in list(cams.items())[:64]:
            c = cc.get(name) if isinstance(cc.get(name), dict) else {}
            fps = num(v.get("camera_fps"))
            out.append({"name": name, "ip": _camera_host(c, relays), "up": fps is None or fps > 0, "fps": fps, "detect": _enabled(c, "detect"), "record": _enabled(c, "record"),
                        "events": per.get(name, 0) if events is not None else None, "last": last.get(name),
                        "labels": dict(by_cam.get(name, Counter()).most_common(4))})
        labels = dict(Counter(str(e.get("label")) for e in ev if e.get("label")).most_common(6))
        return {"role": "nvr", "engine": "Frigate", "cameras": out, "events": events, "labels": labels, "storage": storage,
                "detector_ms": speed, "snapshot": True, "hourly": hourly if events is not None else None, "recent": recent}

    def snapshot(self, cam: str) -> bytes:
        return self.get(f"/api/{urllib.parse.quote(cam, safe='')}/latest.jpg?h=360", binary=True)

    def mjpeg(self, cam: str):
        """The live MJPEG feed of a camera (Frigate /api/<camera>?fps=5&h=480), opened for the server to relay as it comes: the raw response, the
        caller closes it. Signs in again once when the session token is refused."""
        url = f"{self.base_url()}/api/{urllib.parse.quote(cam, safe='')}?fps=5&h=480"
        ctx = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in per connector for a self-signed LAN certificate
        for retry in (False, True):
            headers = {"User-Agent": "myservices"}
            if self.conf.get("user"):
                if self._token is None:
                    self._token = self._login()
                headers.update({"Authorization": f"Bearer {self._token}", "Cookie": f"frigate_token={self._token}"})
            try:
                return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=self.ctx.timeout, context=ctx)
            except urllib.error.HTTPError as e:
                if e.code in (401, 403) and self.conf.get("user") and not retry:
                    self._token = None
                    continue
                raise ConnectorError(f"flux refusé : HTTP {e.code}") from None
            except OSError as e:
                raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:5000"}


ARR_APPS = {"sonarr": ("Sonarr", "v3"), "radarr": ("Radarr", "v3"), "lidarr": ("Lidarr", "v1"), "prowlarr": ("Prowlarr", "v1"), "readarr": ("Readarr", "v1"),
            "whisparr": ("Whisparr", "v3")}   # Whisparr v2 is a Sonarr fork: same v3 API


class Arr(StatusConnector):
    """Famille *arr : version, avertissements de santé, file d'attente, éléments manquants. Clé d'API en en-tête X-Api-Key (Réglages → Général).

    Routes lues : /api/<v3|v1>/system/status, /health, /queue, /wanted/missing. L'application (champ « app ») fixe la version de l'API."""
    type = "arr"
    label = "Sonarr / Radarr / Prowlarr…"
    images = ("linuxserver/sonarr", "linuxserver/radarr", "linuxserver/lidarr", "linuxserver/prowlarr", "hotio/sonarr", "hotio/radarr", "hotio/prowlarr")
    tested = ()
    fields = (
        Field("url", "Adresse de l'application", "url", required=True, help="ex. http://<IP>:8989 (Sonarr), 7878 (Radarr), 9696 (Prowlarr), 8686 (Lidarr)"),
        Field("app", "Application", "choice", required=True, default="sonarr", choices=tuple(ARR_APPS)),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Réglages → Général → Sécurité → Clé d'API"),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True),
    )
    setup_fields = ("url", "app", "api_key")
    guide = ("Dans l'application : Réglages → Général → Sécurité → copier la « Clé d'API ».",
             "Une instance par application (Sonarr, Radarr…) : donnez-lui un nom (« sonarr », « radarr »). Lecture seule.")

    def collect(self) -> dict:
        app = str(self.conf.get("app") or "sonarr").lower()
        name, ver = ARR_APPS.get(app, (app.title(), "v3"))
        h = {"X-Api-Key": str(self.conf.get("api_key", ""))}
        status = self.get(f"/api/{ver}/system/status", h)
        if not isinstance(status, dict):
            raise ConnectorError(f"réponse inattendue : l'adresse ne mène pas à {name}")
        health = rows(self.get(f"/api/{ver}/health", h))
        bad = [x for x in health if str(x.get("type", "")).lower() in ("warning", "error")]
        facts = [fact("Santé", f"{len(bad)} alerte(s)" if bad else "OK", "bad" if any(str(x.get("type")).lower() == "error" for x in bad) else "warn" if bad else "ok")]
        for label, path in (("File d'attente", f"/api/{ver}/queue?pageSize=1"), ("Manquants", f"/api/{ver}/wanted/missing?pageSize=1")):
            if app == "prowlarr" or (app != "sonarr" and app != "radarr" and label == "Manquants" and app not in ("lidarr", "readarr")):
                continue
            try:
                r = self.get(path, h)
                if isinstance(r, dict) and r.get("totalRecords") is not None:
                    facts.append(fact(label, int(num(r["totalRecords"], 0))))
            except ConnectorError:
                pass   # route absente selon l'application ou la version
        return self.out(status.get("version"), facts, [str(x.get("message") or x.get("source") or "avertissement") for x in bad])

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        for app, port in (("sonarr", 8989), ("radarr", 7878), ("prowlarr", 9696), ("lidarr", 8686)):
            if app in image.lower():
                web = next((h for h, c in ports if c == port), port)
                return {"url": f"http://{ip}:{web}", "app": app}
        return None
