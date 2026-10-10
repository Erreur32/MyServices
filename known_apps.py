"""Applis connues : reconnaître un service sans configuration, d'après son image Docker, sa page web ou son port.

Trois indices, du plus fiable au moins fiable :
  image   (« sure »)     conteneur lu par SSH : jc21/nginx-proxy-manager, adguard/adguardhome…
  page    (« probable ») titre HTML de la page (la sonde de la collecte le lit sans SSH)
  port    (« possible »)  port distinctif de l'appli ; les ports courants (80, 3000, 8080, 8090, 9000…) en sont absents

Une appli reconnue donne un nom, une catégorie (celles de services-meta.json), le type d'interface
(ui / api) et, si MyServices sait la lire, le connecteur proposé. Les images d'un connecteur viennent de
la classe du connecteur (connectors/*.py, `images`) : une seule liste à tenir à jour.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import connectors

SURE, PROBABLE, POSSIBLE = "sure", "probable", "possible"


@dataclass(frozen=True)
class App:
    key: str
    label: str
    category: str
    ui: str = "ui"                  # interface web : "ui" (page) ou "api"
    images: tuple[str, ...] = ()    # images Docker (sans étiquette) ; complétées par celles du connecteur
    ports: tuple[int, ...] = ()     # ports habituels
    title: str = ""                 # regex du titre de la page (insensible à la casse)
    host: str = ""                  # regex du nom DNS de la machine (« unifi », « proxmox »…)
    connector: str | None = None    # type de connecteur à proposer (connectors.TYPES)


APPS: tuple[App, ...] = (
    # Lues par un connecteur
    App("npm", "Nginx Proxy Manager", "Réseau / DNS", ports=(81,), title=r"nginx proxy manager", connector="npm"),
    App("adguard", "AdGuard Home", "Réseau / DNS", title=r"adguard home", connector="adguard"),
    App("beszel", "Beszel", "Monitoring", title=r"^beszel\b", connector="beszel"),
    App("uptime-kuma", "Uptime Kuma", "Monitoring", ports=(3001,), title=r"uptime kuma", connector="uptime-kuma"),
    App("dozzle", "Dozzle", "Monitoring", title=r"^dozzle\b", connector="dozzle"),
    App("web-check", "Web-Check", "Outils", title=r"web[ -]check", connector="web-check"),
    # Reconnues pour le nom et la catégorie, sans connecteur
    App("apache", "Apache", "Web / perso", title=r"apache2? .*default page"),  # pas « Index of / » : nginx et Python l'affichent aussi
    App("syncthing", "Syncthing", "Fichiers / sync", ports=(8384,), title=r"syncthing", images=("syncthing/syncthing", "linuxserver/syncthing")),
    App("netdata", "Netdata", "Monitoring", ports=(19999,), title=r"netdata", images=("netdata/netdata",)),
    App("portainer", "Portainer", "Infra / virtualisation", ports=(9443,), title=r"portainer", images=("portainer/portainer-ce", "portainer/portainer-ee")),
    App("prometheus", "Prometheus", "Monitoring", title=r"prometheus", images=("prom/prometheus",)),
    App("grafana", "Grafana", "Monitoring", title=r"^grafana", images=("grafana/grafana", "grafana/grafana-oss")),
    App("webmin", "Webmin", "Système", ports=(10000,), title=r"webmin"),
    App("sonarr", "Sonarr", "Médias", ports=(8989,), title=r"^sonarr", images=("linuxserver/sonarr", "hotio/sonarr")),
    App("radarr", "Radarr", "Médias", ports=(7878,), title=r"^radarr", images=("linuxserver/radarr", "hotio/radarr")),
    App("jellyfin", "Jellyfin", "Médias", ports=(8096,), title=r"jellyfin", images=("jellyfin/jellyfin", "linuxserver/jellyfin")),
    App("plex", "Plex", "Médias", ports=(32400,), title=r"^plex", images=("plexinc/pms-docker", "linuxserver/plex")),
    App("homeassistant", "Home Assistant", "Domotique", ports=(8123, 4357), title=r"home assistant", connector="home-assistant"),
    App("proxmox", "Proxmox VE", "Infra / virtualisation", ports=(8006,), title=r"proxmox", host=r"^proxmox"),
    App("unifi", "UniFi", "Réseau / DNS", title=r"unifi", host=r"^(unifi|udm|ucg|usg)"),  # lu plus tard par l'API MynetworK, pas par SSH
    App("synology", "Synology DSM", "Fichiers / sync", title=r"synology"),
    App("frigate", "Frigate", "Domotique", title=r"^frigate", images=("ghcr.io/blakeblackshear/frigate", "blakeblackshear/frigate")),  # port 5000 : trop courant pour l'identifier seul
    App("myelectricaldata", "MyElectricalData", "Domotique", title=r"myelectricaldata"),
)


def _base(image: str) -> str:
    """« docker.io/jc21/nginx-proxy-manager:2.12 » -> « jc21/nginx-proxy-manager »"""
    name = image.split("@")[0]
    if ":" in name.split("/")[-1]:
        name = name.rsplit(":", 1)[0]
    return name.removeprefix("docker.io/").removeprefix("library/")


def images_of(app: App) -> tuple[str, ...]:
    cls = connectors.TYPES.get(app.connector or "")
    return app.images + (tuple(cls.images) if cls else ())


_BY_PORT: dict[int, list[App]] = {}
for _a in APPS:
    for _p in _a.ports:
        _BY_PORT.setdefault(_p, []).append(_a)
_TITLES = [(a, re.compile(a.title, re.I)) for a in APPS if a.title]
_HOSTS = [(a, re.compile(a.host, re.I)) for a in APPS if a.host]


def identify(image: str | None = None, title: str | None = None, port: int | None = None,
             name: str | None = None) -> tuple[App, str] | None:
    """(appli, confiance) ou None. Image d'abord, puis titre de page, puis nom DNS de la machine, puis port (seulement
    s'il est sans ambiguïté)."""
    if image:
        base = _base(image)
        for a in APPS:
            if any(base == i or base.endswith("/" + i) for i in images_of(a)):
                return a, SURE
    if title:
        for a, rx in _TITLES:
            if rx.search(title):
                return a, PROBABLE
    if name:
        for a, rx in _HOSTS:
            if rx.search(name):
                return a, PROBABLE
    if port is not None and len(_BY_PORT.get(port, [])) == 1:
        return _BY_PORT[port][0], POSSIBLE
    return None


def annotate(row: dict, keep_category: bool = False) -> None:
    """Ajoute row["app"] ({key, label, confidence, connector}) si l'appli est reconnue, et complète ce qui manque :
    nom « port N » -> nom de l'appli, catégorie « Autre » -> celle de l'appli, interface non sondée -> son type.
    Un simple port (« possible ») ne change rien d'autre que row["app"]. keep_category : catégorie réglée à la main."""
    s = row.get("service") or {}
    hit = identify(image=s.get("image"), title=row.get("page_title"), port=row.get("port"))
    if hit is None:
        return
    app, how = hit
    row["app"] = {"key": app.key, "label": app.label, "confidence": how, "connector": app.connector}
    if how == POSSIBLE:
        return
    if not keep_category and row.get("category") == "Autre":
        row["category"] = app.category
    if row.get("web") is None:
        row["web"] = app.ui
    if row.get("name") == f"port {row.get('port')}":
        row["name"] = app.label


def propose(rows: list[dict], declared: list[dict]) -> list[dict]:
    """Un connecteur à proposer par appli reconnue sur une machine, sauf s'il est déjà réglé pour cette
    machine (une instance du même type dont un réglage texte contient son IP). Les plus sûres d'abord."""
    order = {SURE: 0, PROBABLE: 1, POSSIBLE: 2}
    out, seen = [], set()
    for r in sorted((r for r in rows if (r.get("app") or {}).get("connector")), key=lambda r: order[r["app"]["confidence"]]):
        ctype, ip = r["app"]["connector"], r.get("ip")
        if not ip or (ctype, ip) in seen:
            continue
        seen.add((ctype, ip))
        if any(c.get("type") == ctype and ip in " ".join(v for v in c.values() if isinstance(v, str)) for c in declared):
            continue
        scheme = r.get("web_scheme") or r.get("scheme") or "http"
        out.append({"connector": ctype, "label": r["app"]["label"], "confidence": r["app"]["confidence"],
                    "ip": ip, "port": r.get("port"), "url": f"{scheme}://{ip}:{r.get('port')}",
                    "machine": r.get("machine"), "service": r.get("id")})
    return out
