"""Applis connues : reconnaître un service sans configuration, d'après son image Docker, sa page web ou son port.

Quatre indices, du plus fiable au moins fiable :
  image   (« sure »)     conteneur lu par SSH : jc21/nginx-proxy-manager, adguard/adguardhome…
  page    (« probable ») titre HTML de la page (la sonde de la collecte le lit sans SSH)
  empreinte (« probable ») en-têtes HTTP (Server, X-Powered-By, cookies, en-têtes propres à l'appli) et balise generator de la page,
                         lus par la même sonde, sans SSH ; un simple serveur web (nginx, Apache, Caddy…) n'est que « possible »
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
    fp: str = ""                    # regex de l'empreinte HTTP (voir fingerprint() de myservices.py)
    weak_fp: bool = False           # l'empreinte ne dit que le serveur web, pas l'appli : confiance « possible »
    host: str = ""                  # regex du nom DNS de la machine (« unifi », « proxmox »…)
    connector: str | None = None    # type de connecteur à proposer (connectors.TYPES)


APPS: tuple[App, ...] = (
    # Lues par un connecteur
    App("npm", "Nginx Proxy Manager", "Réseau / DNS", ports=(81,), title=r"nginx proxy manager", connector="npm"),
    App("adguard", "AdGuard Home", "Réseau / DNS", title=r"adguard home", connector="adguard"),
    App("beszel", "Beszel", "Monitoring", title=r"^beszel\b", connector="beszel"),
    App("uptime-kuma", "Uptime Kuma", "Monitoring", ports=(3001,), title=r"uptime kuma", connector="uptime-kuma"),
    App("dozzle", "Dozzle", "Monitoring", title=r"^dozzle\b", connector="dozzle"),
    App("mynetwork", "MynetworK", "Réseau / DNS", title=r"mynetwork", connector="mynetwork"),
    App("logviewr", "LogviewR", "Monitoring", title=r"logviewr", connector="logviewr"),
    App("dockhand", "Dockhand", "Infra / virtualisation", title=r"dockhand", connector="dockhand"),
    App("web-check", "Web-Check", "Outils", title=r"web[ -]check", connector="web-check"),
    # Reconnues pour le nom et la catégorie, sans connecteur
    App("apache", "Apache", "Web / perso", title=r"apache2? .*default page"),  # pas « Index of / » : nginx et Python l'affichent aussi
    App("syncthing", "Syncthing", "Fichiers / sync", ports=(8384,), title=r"syncthing", images=("syncthing/syncthing", "linuxserver/syncthing")),
    App("netdata", "Netdata", "Monitoring", ports=(19999,), title=r"netdata", images=("netdata/netdata",)),
    App("portainer", "Portainer", "Infra / virtualisation", ports=(9443,), title=r"portainer", images=("portainer/portainer-ce", "portainer/portainer-ee"), connector="portainer"),
    App("prometheus", "Prometheus", "Monitoring", title=r"prometheus", images=("prom/prometheus",)),
    App("grafana", "Grafana", "Monitoring", title=r"^grafana", images=("grafana/grafana", "grafana/grafana-oss")),
    App("webmin", "Webmin", "Système", ports=(10000,), title=r"webmin"),
    App("sonarr", "Sonarr", "Médias", ports=(8989,), title=r"^sonarr", images=("linuxserver/sonarr", "hotio/sonarr"), connector="arr"),
    App("radarr", "Radarr", "Médias", ports=(7878,), title=r"^radarr", images=("linuxserver/radarr", "hotio/radarr"), connector="arr"),
    App("jellyfin", "Jellyfin", "Médias", ports=(8096,), title=r"jellyfin", images=("jellyfin/jellyfin", "linuxserver/jellyfin")),
    App("plex", "Plex", "Médias", ports=(32400,), title=r"^plex", images=("plexinc/pms-docker", "linuxserver/plex")),
    App("homeassistant", "Home Assistant", "Domotique", ports=(8123, 4357), title=r"home assistant", connector="home-assistant"),
    App("proxmox", "Proxmox VE", "Infra / virtualisation", ports=(8006,), title=r"proxmox virtual environment|^proxmox", host=r"^(proxmox|pve)", connector="proxmox"),
    App("pbs", "Proxmox Backup Server", "Sauvegardes", ports=(8007,), title=r"proxmox backup server", host=r"^(pbs|proxmox-?backup)", connector="proxmox-backup"),
    # IA locale : Ollama et LM Studio ont un port à eux ; llama.cpp (8080) et Open WebUI (3000 / 8080) partagent des ports trop courants, d'où le titre de la page
    App("ollama", "Ollama", "IA / LLM", ports=(11434,), images=("ollama/ollama",)),
    App("lmstudio", "LM Studio", "IA / LLM", ports=(1234,)),
    App("llamacpp", "llama.cpp", "IA / LLM", title=r"^llama\.cpp", images=("ghcr.io/ggml-org/llama.cpp", "ghcr.io/ggerganov/llama.cpp")),
    App("open-webui", "Open WebUI", "IA / LLM", title=r"open webui", images=("ghcr.io/open-webui/open-webui",)),
    # Veeam Backup & Replication : API REST 9419 (lue par Sauvegardes), service 9392, serveur de montage 9401. Ports d'après la doc Veeam, à confirmer sur un vrai serveur
    App("veeam", "Veeam Backup & Replication", "Sauvegardes", ports=(9419, 9392, 9401)),
    App("unifi", "UniFi", "Réseau / DNS", title=r"unifi", host=r"^(unifi|udm|ucg|usg)", images=("linuxserver/unifi-network-application", "jacobalberty/unifi"), connector="unifi"),  # MynetworK lit aussi UniFi
    App("synology", "Synology DSM", "Fichiers / sync", title=r"synology"),
    App("frigate", "Frigate", "Domotique", title=r"^frigate", images=("ghcr.io/blakeblackshear/frigate", "blakeblackshear/frigate"), connector="frigate"),  # port 5000 : trop courant pour l'identifier seul
    App("myelectricaldata", "MyElectricalData", "Domotique", title=r"myelectricaldata"),
    # Reconnues par leur page ou leur empreinte HTTP (en-têtes, cookies), sans SSH
    App("pihole", "Pi-hole", "Réseau / DNS", title=r"pi-?hole", fp=r"x-pi-hole", images=("pihole/pihole",), connector="pihole"),
    App("nextcloud", "Nextcloud", "Fichiers / sync", title=r"nextcloud", fp=r"oc_sessionpassphrase|x-nextcloud", images=("nextcloud", "linuxserver/nextcloud")),
    App("vaultwarden", "Vaultwarden", "Outils", title=r"vaultwarden|bitwarden web vault", images=("vaultwarden/server",)),
    App("gitea", "Gitea", "Outils", title=r"gitea", fp=r"i_like_gitea", images=("gitea/gitea",)),
    App("gitlab", "GitLab", "Outils", title=r"gitlab", fp=r"_gitlab_session", images=("gitlab/gitlab-ce", "gitlab/gitlab-ee")),
    App("traefik", "Traefik", "Réseau / DNS", title=r"traefik", images=("traefik",)),
    App("transmission", "Transmission", "Médias", ports=(9091,), title=r"transmission", fp=r"x-transmission-session-id", images=("linuxserver/transmission",)),
    App("qbittorrent", "qBittorrent", "Médias", title=r"qbittorrent", images=("linuxserver/qbittorrent", "qbittorrentofficial/qbittorrent-nox")),
    App("prowlarr", "Prowlarr", "Médias", ports=(9696,), title=r"^prowlarr", images=("linuxserver/prowlarr", "hotio/prowlarr"), connector="arr"),
    App("lidarr", "Lidarr", "Médias", ports=(8686,), title=r"^lidarr", images=("linuxserver/lidarr", "hotio/lidarr"), connector="arr"),
    App("bazarr", "Bazarr", "Médias", ports=(6767,), title=r"^bazarr", images=("linuxserver/bazarr", "hotio/bazarr")),
    App("overseerr", "Overseerr", "Médias", ports=(5055,), title=r"overseerr|jellyseerr", images=("sctx/overseerr", "fallenbagel/jellyseerr")),
    App("navidrome", "Navidrome", "Médias", ports=(4533,), title=r"navidrome", images=("deluan/navidrome",)),
    App("audiobookshelf", "Audiobookshelf", "Médias", ports=(13378,), title=r"audiobookshelf", images=("advplyr/audiobookshelf",)),
    App("immich", "Immich", "Fichiers / sync", ports=(2283,), title=r"immich", images=("ghcr.io/immich-app/immich-server",)),
    App("paperless", "Paperless-ngx", "Fichiers / sync", title=r"paperless", images=("ghcr.io/paperless-ngx/paperless-ngx",)),
    App("nodered", "Node-RED", "Domotique", ports=(1880,), title=r"node-red", images=("nodered/node-red",)),
    App("esphome", "ESPHome", "Domotique", ports=(6052,), title=r"esphome", images=("esphome/esphome", "ghcr.io/esphome/esphome")),
    App("homebridge", "Homebridge", "Domotique", ports=(8581,), title=r"homebridge", images=("homebridge/homebridge",)),
    App("zigbee2mqtt", "Zigbee2MQTT", "Domotique", title=r"zigbee2mqtt", images=("koenkk/zigbee2mqtt",)),
    App("influxdb", "InfluxDB", "Monitoring", ports=(8086,), title=r"influxdb", images=("influxdb",)),
    App("alertmanager", "Alertmanager", "Monitoring", ports=(9093,), title=r"alertmanager", images=("prom/alertmanager",)),
    App("node-exporter", "Node Exporter", "Monitoring", ports=(9100,), ui="api", images=("prom/node-exporter",)),
    App("kibana", "Kibana", "Monitoring", ports=(5601,), title=r"kibana", images=("kibana", "docker.elastic.co/kibana/kibana")),
    App("rabbitmq", "RabbitMQ", "Infra / virtualisation", ports=(15672,), title=r"rabbitmq", images=("rabbitmq",)),
    App("vault", "HashiCorp Vault", "Infra / virtualisation", ports=(8200,), title=r"^vault", images=("hashicorp/vault", "vault")),
    App("consul", "Consul", "Infra / virtualisation", ports=(8500,), title=r"consul", images=("hashicorp/consul", "consul")),
    App("crowdsec", "CrowdSec", "Sécurité", title=r"crowdsec", images=("crowdsecurity/crowdsec",), connector="crowdsec"),
    App("technitium", "Technitium DNS", "Réseau / DNS", ports=(5380,), title=r"technitium", images=("technitium/dns-server",), connector="technitium"),
    App("headscale", "Headscale", "Réseau / DNS", title=r"headscale", images=("headscale/headscale",), connector="tailscale"),
    App("nut", "NUT (onduleur)", "Système", ports=(3493,), ui="api", images=("upshift/nut-upsd", "instantlinux/nut-upsd"), connector="nut"),
    App("cockpit", "Cockpit", "Système", title=r"cockpit|^login - .*\bcockpit", fp=r"cockpit"),
    App("openwrt", "OpenWrt (LuCI)", "Réseau / DNS", title=r"luci|openwrt", host=r"^openwrt"),
    App("truenas", "TrueNAS", "Fichiers / sync", title=r"truenas", host=r"^(truenas|freenas)", connector="truenas"),
    App("pfsense", "pfSense", "Réseau / DNS", title=r"pfsense", host=r"^pfsense"),
    App("opnsense", "OPNsense", "Réseau / DNS", title=r"opnsense", host=r"^opnsense", connector="opnsense"),
    # Serveurs web : l'en-tête Server dit ce qui répond, pas l'appli derrière (confiance « possible », jamais prioritaire)
    App("nginx-web", "nginx", "Web / perso", fp=r"^server: nginx", weak_fp=True),
    App("caddy-web", "Caddy", "Web / perso", fp=r"^server: caddy", weak_fp=True),
    App("iis-web", "Microsoft IIS", "Web / perso", fp=r"^server: microsoft-iis", weak_fp=True),
    App("lighttpd-web", "lighttpd", "Web / perso", fp=r"^server: lighttpd", weak_fp=True),
    App("kestrel-web", "ASP.NET (Kestrel)", "Web / perso", fp=r"^server: kestrel", weak_fp=True),
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
_FPS = [(a, re.compile(a.fp, re.I | re.M)) for a in APPS if a.fp]


def identify(image: str | None = None, title: str | None = None, port: int | None = None,
             name: str | None = None, fingerprint: str | None = None) -> tuple[App, str] | None:
    """(appli, confiance) ou None. Image d'abord, puis titre de page, puis empreinte HTTP, puis nom DNS de la machine, puis port
    (seulement s'il est sans ambiguïté). Un simple serveur web reconnu par son en-tête n'est que « possible » et cède au port."""
    if image:
        base = _base(image)
        for a in APPS:
            if any(base == i or base.endswith("/" + i) for i in images_of(a)):
                return a, SURE
    if title:
        for a, rx in _TITLES:
            if rx.search(title):
                return a, PROBABLE
    weak = None
    if fingerprint:
        for a, rx in _FPS:
            if rx.search(fingerprint):
                if not a.weak_fp:
                    return a, PROBABLE
                weak = weak or a
    if name:
        for a, rx in _HOSTS:
            if rx.search(name):
                return a, PROBABLE
    if port is not None and len(_BY_PORT.get(port, [])) == 1:
        return _BY_PORT[port][0], POSSIBLE
    return (weak, POSSIBLE) if weak else None


def annotate(row: dict, keep_category: bool = False) -> None:
    """Ajoute row["app"] ({key, label, confidence, connector}) si l'appli est reconnue, et complète ce qui manque :
    nom « port N » -> nom de l'appli, catégorie « Autre » -> celle de l'appli, interface non sondée -> son type.
    Un simple port (« possible ») ne change rien d'autre que row["app"]. keep_category : catégorie réglée à la main."""
    s = row.get("service") or {}
    hit = identify(image=s.get("image"), title=row.get("page_title"), port=row.get("port"), fingerprint=row.pop("fingerprint", None))
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


# Services Windows (nom ou nom affiché) qui révèlent une appli installée sur un PC lu par l'agent : (regex, clé de l'appli)
WINDOWS_SERVICES: tuple[tuple[str, str], ...] = (
    (r"plex media server|plexupdateservice", "plex"), (r"adguard ?home", "adguard"), (r"jellyfin", "jellyfin"), (r"^sonarr|\bsonarr\b", "sonarr"),
    (r"^radarr|\bradarr\b", "radarr"), (r"^prowlarr", "prowlarr"), (r"^lidarr", "lidarr"), (r"syncthing", "syncthing"), (r"^grafana", "grafana"),
    (r"^prometheus", "prometheus"), (r"netdata", "netdata"), (r"home ?assistant", "homeassistant"), (r"veeam backup service|veeamdeploymentservice", "veeam"),
    (r"portainer", "portainer"), (r"uptime ?kuma", "uptime-kuma"), (r"frigate", "frigate"), (r"crowdsec", "crowdsec"),
)
WEB_PORTS = {"adguard": 3000, "plex": 32400, "jellyfin": 8096, "grafana": 3000, "prometheus": 9090, "sonarr": 8989, "radarr": 7878, "uptime-kuma": 3001}   # port web par défaut quand l'appli n'en déclare pas
_WIN = [(re.compile(rx, re.I), key) for rx, key in WINDOWS_SERVICES]
_BY_KEY = {a.key: a for a in APPS}


def apps_from_services(services: list[dict]) -> list[App]:
    """Applis reconnues d'après les services Windows en marche ([{"name", "display"}]), sans doublon, dans l'ordre de la liste."""
    found: dict[str, App] = {}
    for s in services or []:
        text = f"{s.get('name', '')} {s.get('display', '')}"
        for rx, key in _WIN:
            if key not in found and key in _BY_KEY and rx.search(text):
                found[key] = _BY_KEY[key]
    return list(found.values())


def propose_windows(ip: str, machine: str | None, apps: list[App], ports: dict, declared: list[dict]) -> list[dict]:
    """Connecteurs à proposer pour les applis vues par les services d'un PC Windows : la même forme que propose(). L'adresse est celle du port
    web connu de l'appli, ou son port par défaut ; une appli qui n'écoute pas là reste proposée (l'utilisateur corrige l'adresse)."""
    out = []
    for a in apps:
        if not a.connector:
            continue
        if any(c.get("type") == a.connector and ip in " ".join(v for v in c.values() if isinstance(v, str)) for c in declared):
            continue
        port = next((p for p in a.ports if p in ports), None) or WEB_PORTS.get(a.key) or (a.ports[0] if a.ports else None)
        out.append({"connector": a.connector, "label": a.label, "confidence": SURE, "ip": ip, "port": port,
                    "url": f"http://{ip}:{port}" if port else f"http://{ip}", "machine": machine, "service": f"windows:{a.key}", "via": "service Windows"})
    return out


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
