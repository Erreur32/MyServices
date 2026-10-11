"""Frigate (caméras) et la famille *arr (Sonarr, Radarr, Lidarr, Prowlarr), en lecture seule."""
from __future__ import annotations

import time

from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, fact, num, size, duration, rows


class Frigate(StatusConnector):
    """Frigate NVR : caméras (images par seconde), détecteurs, stockage, événements des 24 dernières heures.

    Routes lues (GET) : /api/version, /api/stats, /api/events. Le port 5000 de Frigate (interne, sans authentification) est celui à utiliser ;
    le port 8971 (avec connexion, Frigate 0.14+) n'est pas géré. D'après la documentation de Frigate (API HTTP) : à confirmer sur un vrai Frigate."""
    type = "frigate"
    label = "Frigate"
    images = ("ghcr.io/blakeblackshear/frigate", "blakeblackshear/frigate")
    tested = ()
    fields = (
        Field("url", "Adresse de Frigate", "url", required=True, help="http://<IP>:5000 (port interne, sans connexion)"),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True),
    )
    setup_fields = ("url",)
    guide = ("Utilisez le port 5000 de Frigate (API interne, sans authentification) : il ne doit pas être exposé sur Internet.",
             "Aucun jeton à créer. MyServices ne fait que des GET (version, statistiques, événements).")

    def collect(self) -> dict:
        stats = self.get("/api/stats")
        if not isinstance(stats, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Frigate")
        service = stats.get("service") if isinstance(stats.get("service"), dict) else {}
        cams = {k: v for k, v in (stats.get("cameras") or {}).items() if isinstance(v, dict)}
        down = sorted(k for k, v in cams.items() if num(v.get("camera_fps"), 0) == 0)
        dets = [v for v in (stats.get("detectors") or {}).values() if isinstance(v, dict)]
        speeds = [num(d.get("inference_speed")) for d in dets if num(d.get("inference_speed")) is not None]
        free = None
        for v in (service.get("storage") or {}).values():
            if isinstance(v, dict) and num(v.get("total")) and num(v.get("free")) is not None:   # Mo
                free = (num(v["free"]) * 1048576, num(v["total"]) * 1048576) if free is None else free
        events = None
        try:
            ev = rows(self.get(f"/api/events?limit=100&after={int(time.time()) - 86400}"))
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
            facts.append(fact("Événements 24 h", f"{events}{'+' if events >= 100 else ''}"))
        if service.get("uptime") is not None:
            facts.append(fact("En marche", duration(num(service.get("uptime")))))
        return self.out(service.get("version"), facts, [f"caméra « {c} » sans image (0 image/s)" for c in down])

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:5000"}


ARR_APPS = {"sonarr": ("Sonarr", "v3"), "radarr": ("Radarr", "v3"), "lidarr": ("Lidarr", "v1"), "prowlarr": ("Prowlarr", "v1"), "readarr": ("Readarr", "v1")}


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
