"""Supervision (Prometheus, Healthchecks, Netdata) et médiathèque (Jellyfin), en lecture seule."""
from __future__ import annotations

from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, fact, rows

VERIFY = Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé")


class Prometheus(StatusConnector):
    """Prometheus : cibles de collecte en haut ou en bas, alertes en cours. Routes lues (GET) : /api/v1/status/buildinfo, /api/v1/targets, /api/v1/alerts."""
    type = "prometheus"
    label = "Prometheus"
    images = ("prom/prometheus", "bitnami/prometheus")
    fields = (
        Field("url", "Adresse de Prometheus", "url", required=True, help="http://<IP>:9090"),
        Field("token", "Jeton (si derrière un proxy authentifié)", "password", secret=True, help="facultatif : envoyé en « Authorization: Bearer »"),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Prometheus n'a pas d'authentification par défaut : l'adresse suffit. Le jeton ne sert que derrière un proxy qui en exige un.",
             "MyServices ne fait que des GET (version, cibles, alertes).")

    def collect(self) -> dict:
        h = {"Authorization": f"Bearer {self.conf['token']}"} if self.conf.get("token") else None
        info = self.get("/api/v1/status/buildinfo", h)
        data = info.get("data") if isinstance(info, dict) else None
        if not isinstance(data, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Prometheus")
        targets = ((self.get("/api/v1/targets?state=active", h) or {}).get("data") or {}).get("activeTargets") or []
        targets = [t for t in targets if isinstance(t, dict)]
        down = [t for t in targets if t.get("health") == "down"]
        firing = []
        try:
            alerts = ((self.get("/api/v1/alerts", h) or {}).get("data") or {}).get("alerts")
            firing = [x for x in rows(alerts) if x.get("state") == "firing"]
        except ConnectorError:
            pass   # alertes illisibles (droits, version) : les cibles sont lues
        facts = [fact("Cibles", f"{len(targets) - len(down)}/{len(targets)} en ligne", "bad" if down else "ok"),
                 fact("Alertes en cours", len(firing), "bad" if firing else "ok")]
        def name(t):
            labels = t.get("labels") if isinstance(t.get("labels"), dict) else {}
            return f"{labels.get('job', '?')} ({labels.get('instance', t.get('scrapeUrl', '?'))})"
        problems = [f"cible « {name(t)} » hors ligne" for t in down]
        problems += [f"alerte « {(a.get('labels') or {}).get('alertname', '?')} » en cours" for a in firing]
        return self.out(data.get("version"), facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        port = next((h for h, c in ports if c == 9090), None)
        return {"url": f"http://{ip}:{port}"} if port else None


class Healthchecks(StatusConnector):
    """Healthchecks (auto-hébergé) : tâches planifiées en échec ou en retard. Clé d'API en lecture seule (X-Api-Key). Route lue : /api/v3/checks/."""
    type = "healthchecks"
    label = "Healthchecks"
    images = ("healthchecks/healthchecks", "linuxserver/healthchecks")
    fields = (
        Field("url", "Adresse de Healthchecks", "url", required=True, help="http://<IP>:8000"),
        Field("api_key", "Clé d'API (lecture seule)", "password", required=True, secret=True, help="Project Settings → API Keys → clé « read-only »"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans Healthchecks : Project Settings → API Keys → créez une clé « read-only » (les clés en lecture seule ne voient pas les adresses de ping).",)

    def collect(self) -> dict:
        d = self.get("/api/v3/checks/", {"X-Api-Key": str(self.conf.get("api_key", ""))})
        if not isinstance(d, dict) or not isinstance(d.get("checks"), list):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Healthchecks")
        checks = [c for c in d["checks"] if isinstance(c, dict)]
        by = lambda s: [c for c in checks if c.get("status") == s]   # noqa: E731
        down, grace, paused = by("down"), by("grace"), by("paused")
        facts = [fact("Tâches", len(checks)), fact("En échec", len(down), "bad" if down else "ok"),
                 fact("En retard", len(grace), "warn" if grace else None), fact("En pause", len(paused))]
        problems = [f"« {c.get('name') or c.get('slug') or '?'} » en échec" for c in down]
        problems += [f"« {c.get('name') or c.get('slug') or '?'} » en retard" for c in grace]
        return self.out(None, facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        port = next((h for h, c in ports if c == 8000), None)
        return {"url": f"http://{ip}:{port}"} if port else None


class Netdata(StatusConnector):
    """Netdata : alarmes actives (critiques ou d'avertissement) d'une machine. Routes lues (GET) : /api/v1/info, /api/v1/alarms."""
    type = "netdata"
    label = "Netdata"
    images = ("netdata/netdata",)
    fields = (
        Field("url", "Adresse de Netdata", "url", required=True, help="http://<IP>:19999"),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Aucune clé à créer : l'API locale de Netdata est ouverte sur le réseau local. MyServices ne fait que des GET (version, alarmes).",)

    def collect(self) -> dict:
        info = self.get("/api/v1/info")
        if not isinstance(info, dict) or "version" not in info:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Netdata")
        alarms = self.get("/api/v1/alarms")
        items = [a for a in ((alarms or {}).get("alarms") or {}).values() if isinstance(a, dict)] if isinstance(alarms, dict) else []
        crit = [a for a in items if a.get("status") == "CRITICAL"]
        warn = [a for a in items if a.get("status") == "WARNING"]
        facts = [fact("Alarmes critiques", len(crit), "bad" if crit else "ok"), fact("Avertissements", len(warn), "warn" if warn else None)]
        if info.get("hostname"):
            facts.insert(0, fact("Machine", info["hostname"]))
        problems = [f"{a.get('chart', '?')} : {a.get('name', '?')} ({'critique' if a in crit else 'avertissement'})" for a in crit + warn]
        return self.out(str(info.get("version", "")).lstrip("v") or None, facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{next((h for h, c in ports if c == 19999), 19999)}"}


class Jellyfin(StatusConnector):
    """Jellyfin : version, lectures en cours, bibliothèque. Clé d'API (X-Emby-Token). Routes lues (GET) : /System/Info, /Sessions."""
    type = "jellyfin"
    label = "Jellyfin"
    images = ("jellyfin/jellyfin", "linuxserver/jellyfin")
    fields = (
        Field("url", "Adresse de Jellyfin", "url", required=True, help="http://<IP>:8096"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Tableau de bord → Clés d'API → « + »"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans Jellyfin : Tableau de bord → Avancé → Clés d'API → « + », nommez-la « MyServices ». La clé ne sert qu'à lire.",)

    def collect(self) -> dict:
        h = {"X-Emby-Token": str(self.conf.get("api_key", ""))}
        info = self.get("/System/Info", h)
        if not isinstance(info, dict) or "Version" not in info:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Jellyfin")
        sessions = rows(self.get("/Sessions", h))
        playing = [s for s in sessions if isinstance(s.get("NowPlayingItem"), dict)]
        facts = [fact("Lectures en cours", len(playing)), fact("Appareils connectés", len(sessions))]
        problems = []
        if info.get("HasPendingRestart") is True:
            facts.append(fact("Redémarrage", "en attente", "warn"))
            problems.append("redémarrage en attente (mise à jour installée)")
        if info.get("HasUpdateAvailable") is True:
            problems.append("mise à jour de Jellyfin disponible")
        return self.out(info.get("Version"), facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        port = next((h for h, c in ports if c == 8096), None)
        return {"url": f"http://{ip}:{port}"} if port else None
