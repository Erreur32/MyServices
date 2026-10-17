"""Home Assistant par son API REST (adresse + jeton d'accès longue durée), en lecture seule.

Rien d'autre que des GET : /api/config (version, nom du lieu, état), /api/states (entités : nombre, mises à jour
disponibles = entités update.* à l'état « on »). Aucun appel de service, aucun SSH.

Un jeton Home Assistant a les droits de son compte, il n'est pas « lecture seule » : le guide recommande un compte
dédié non administrateur. Les sauvegardes lues dans les mêmes données sont l'affaire du module backups.py
(connectors/backup_apis.py, fichier de secrets), pas de ce connecteur.

Mode avancé facultatif : l'adresse du module complémentaire « ha-mcp » (serveur MCP communautaire, PAS le MCP natif de Home Assistant)
ajoute la liste réelle des sauvegardes, les réparations, la validité de la configuration, les modules et les intégrations en erreur
(connectors/ha_mcp.py : six appels de lecture fixes). Sans elle, rien ne change.
"""
from __future__ import annotations

import errno
import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import Connector, ConnectorError, Field, Result
from connectors.ha_mcp import HaMcp

GUIDE = (
    "Créer un compte dédié : Paramètres → Personnes → onglet Utilisateurs → Ajouter un utilisateur (nom « myservices », "
    "sans les droits d'administrateur).",
    "Se connecter avec ce compte, ouvrir son profil (en bas à gauche), onglet Sécurité.",
    "« Jetons d'accès longue durée » → Créer un jeton (nom « MyServices »), puis le copier : il ne s'affiche qu'une fois.",
    "Coller le jeton ici. L'adresse est celle de Home Assistant, avec son port (8123 par défaut).",
    "Facultatif, mode avancé : si vous avez installé le module complémentaire « ha-mcp » (module communautaire, ce n'est pas le MCP natif de "
    "Home Assistant), collez l'adresse HTTP qu'il affiche (elle contient un chemin secret). MyServices n'y fait que six lectures ; "
    "activez aussi le mode lecture seule de ha-mcp (BACKUP_READ_ONLY=true) pour que le module refuse toute écriture de son côté.",
    "Pour que l'adresse ne change pas au redémarrage : lancez ha-mcp en mode HTTP (commande ha-mcp-web, ou son conteneur) avec une valeur fixe de "
    "MCP_SECRET_PATH (une longue chaîne au hasard, par exemple /private_ suivi de 22 caractères). Sans cette variable le chemin par défaut est /mcp, sans secret. "
    "Le ha-mcp lancé en local par Claude Code (mode stdio) n'a pas d'adresse réseau et ne peut pas servir ici.",
)


def explain(e: Exception) -> str:
    """Cause lisible d'un échec de lecture, avec ce qu'il faut corriger. Jamais le jeton."""
    if isinstance(e, urllib.error.HTTPError):
        if e.code == 401:
            return "jeton refusé (401) : le copier de nouveau ; un jeton supprimé ou d'un autre Home Assistant ne marche pas"
        if e.code == 400:
            return "requête refusée (400) : Home Assistant refuse peut-être cette adresse (réglage http: use_x_forwarded_for / trusted_proxies)"
        if e.code == 404:
            return "adresse incorrecte (404) : ce n'est pas l'API de Home Assistant ; vérifier l'adresse et le port (8123)"
        if e.code >= 500:
            return f"erreur interne de Home Assistant (HTTP {e.code}) : voir Paramètres → Système → Journaux dans Home Assistant"
        return f"Home Assistant répond HTTP {e.code}"
    reason = getattr(e, "reason", e)
    if isinstance(reason, ssl.SSLError):
        return "certificat non reconnu : utiliser http:// sur le réseau local, ou un certificat reconnu (Let's Encrypt, autorité de l'entreprise)"
    if getattr(reason, "errno", None) in (errno.EHOSTUNREACH, errno.ENETUNREACH, errno.EHOSTDOWN):
        return "machine injoignable : adresse fausse ou Home Assistant éteint"
    if isinstance(reason, (ConnectionRefusedError,)):
        return "connexion refusée : Home Assistant n'écoute pas sur ce port ; vérifier l'adresse et le port (8123), et http / https"
    if isinstance(reason, TimeoutError) or "timed out" in str(reason):
        return "pas de réponse : Home Assistant est éteint ou l'adresse est fausse"
    if isinstance(e, ValueError):
        return "réponse inattendue : l'adresse ne mène pas à Home Assistant"
    return f"{reason}"[:160]


def mcp_summary(m: dict | None) -> str:
    """Fin du message de test : ce que le module ha-mcp a donné (ou pourquoi il n'a rien donné)."""
    if m is None:
        return ""
    if not m.get("backups") and m.get("errors"):
        return " · ha-mcp : " + next(iter(m["errors"].values()))
    bits = []
    if m.get("backups"):
        bits.append(f"{m['backups']['total']} sauvegarde(s)")
    if m.get("health"):
        bits.append(f"{m['health']['repairs_count']} réparation(s)")
    if (m.get("health") or {}).get("config_ok") is False:
        bits.append("configuration invalide")
    if m.get("errors"):
        bits.append(f"{len(m['errors'])} lecture(s) en échec")
    return " · ha-mcp : " + ", ".join(bits) if bits else " · ha-mcp : connecté"


def update_group(entity_id: str, attrs: dict) -> str:
    """Famille d'une entité update.* : « core » (Home Assistant lui-même : cœur, Supervisor, système, interface), « addon »
    (module complémentaire, dont l'icône vient de l'API hassio) ou « other » (appareils et intégrations : Plex, ESPHome,
    une prise…). Seul le cœur dit si Home Assistant est à jour."""
    if entity_id in SYSTEM_PARTS:
        return "core"
    if "/api/hassio/addons/" in str(attrs.get("entity_picture") or ""):
        return "addon"
    return "other"


UPDATE = "update."
# Home Assistant's own parts, by their update entity (« update.home_assistant_* » alone also matches HACS cards, e.g. plant)
SYSTEM_PARTS = {"update.home_assistant_core_update": "core", "update.home_assistant_supervisor_update": "supervisor",
                "update.home_assistant_operating_system_update": "os"}


def system(states: list) -> dict:
    """What Home Assistant runs on, from its update entities: versions of Core, Supervisor and the OS, and the installation method
    they imply (OS entity: Home Assistant OS; Supervisor alone: Supervised; neither: Core or Container, which the API does not tell)."""
    out = {}
    for s in states:
        part = SYSTEM_PARTS.get(s.get("entity_id")) if isinstance(s, dict) else None
        if part and (v := (s.get("attributes") or {}).get("installed_version")):
            out[part] = str(v)
    if "os" in out:
        out["method"] = "Home Assistant OS"
    elif "supervisor" in out:
        out["method"] = "Supervised"
    return out   # entity id prefix of what can be updated (core, add-ons, devices)
ADDON_ICON = re.compile(r"/api/hassio/addons/([a-z0-9_-]{1,64})/icon")


def addons(states: list) -> list[dict]:
    """Add-ons installed, from their update.* entities (one per add-on, whatever its state): no admin right needed, unlike
    /api/hassio/addons. Name, slug (for the icon), installed version, and the new one when an update waits."""
    out = []
    for s in states:
        a = s.get("attributes") or {} if isinstance(s, dict) else {}
        m = ADDON_ICON.search(str(a.get("entity_picture") or "")) if str(s.get("entity_id", "")).startswith(UPDATE) else None
        if m:
            name = str(a.get("title") or a.get("friendly_name") or m[1]).removesuffix(" Update")
            out.append({"name": name, "slug": m[1], "version": a.get("installed_version"),
                        **({"latest": a.get("latest_version")} if s.get("state") == "on" else {})})
    return sorted(out, key=lambda x: x["name"].lower())


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def host_sensors(states: list) -> dict | None:
    """Machine qui héberge Home Assistant, d'après ses capteurs : intégration « System Monitor » (processeur, mémoire, disque, température,
    démarrage, adresses IP) et capteurs du Supervisor (disque de l'hôte). Même forme qu'un système Beszel (voir health.parse_beszel) pour être lu
    comme une source de santé. None si aucun de ces capteurs n'existe (Home Assistant Core seul, intégration non installée)."""
    by = {s.get("entity_id"): s for s in states if isinstance(s, dict)}

    def val(*ids):
        for i in ids:
            s = by.get(i)
            if s and str(s.get("state")) not in ("unavailable", "unknown", "none", ""):
                return s["state"]
        return None
    cpu, mem = _num(val("sensor.system_monitor_processor_use", "sensor.processor_use")), _num(val("sensor.system_monitor_memory_usage", "sensor.memory_use_percent"))
    temp = _num(val("sensor.system_monitor_processor_temperature", "sensor.processor_temperature", "sensor.hwmon_temperatures_package_id_0"))
    total, used = _num(val("sensor.home_assistant_host_disk_total")), _num(val("sensor.home_assistant_host_disk_used"))
    pct = _num(val("sensor.system_monitor_disk_usage", "sensor.disk_use_percent"))
    disks = []
    if total and used is not None:      # Go, d'après le Supervisor
        disks.append({"mount": "/", "size_gb": round(total, 1), "used_gb": round(used, 1), "used_pct": round(100 * used / total)})
    elif pct is not None:               # seulement un pourcentage : taille inconnue
        disks.append({"mount": "/", "size_gb": 100.0, "used_gb": round(pct, 1), "used_pct": round(pct)})
    ips = sorted({str(s["state"]) for e, s in by.items() if str(e).startswith("sensor.system_monitor_ipv4_address_") and str(s.get("state", "")).count(".") == 3
                  and not str(s["state"]).startswith(("127.", "172.30.", "172.17."))})
    boot = val("sensor.system_monitor_last_boot")
    if cpu is None and mem is None and temp is None and not disks:
        return None
    out = {"status": "up", "cpu": cpu, "mem_pct": mem, "temp": temp, "disks": disks, "ips": ips, "boot": boot}
    return {k: v for k, v in out.items() if v is not None}


class HomeAssistantAPI(Connector):
    type = "home-assistant"
    label = "Home Assistant"
    kinds = ("status",)
    images = ("homeassistant/home-assistant", "ghcr.io/home-assistant/home-assistant")
    tested = ("2025", "2026")
    guide = GUIDE
    fields = (
        Field("url", "Adresse de Home Assistant", "url", required=True, help="http://<IP>:8123"),
        Field("token", "Jeton d'accès longue durée", "password", required=True, secret=True,
              help="créé dans le profil d'un compte dédié non administrateur (voir l'aide)"),
        Field("mcp_url", "Adresse du module ha-mcp (facultatif)", "password", secret=True,
              help="mode avancé : sauvegardes réelles, réparations, configuration. Module communautaire « ha-mcp », pas le MCP natif de Home Assistant ; "
                   "l'adresse contient un chemin secret"),
    )
    setup_fields = ("url", "token")

    def _get(self, path: str, timeout: float = 15):
        base = str(self.conf.get("url", "")).rstrip("/")
        if urllib.parse.urlsplit(base).scheme not in ("http", "https"):
            raise ConnectorError("adresse : http://<IP>:8123 attendu")
        req = urllib.request.Request(base + path, headers={"Authorization": "Bearer " + str(self.conf.get("token", ""))})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # certificat vérifié (https) : jamais désactivé
                return json.load(r)
        except (OSError, ValueError) as e:  # HTTPError, URLError, délai, JSON invalide
            raise ConnectorError(f"{explain(e)} [{path}]" if isinstance(e, urllib.error.HTTPError) else explain(e)) from None

    def addon_icon(self, slug: str) -> bytes:
        """Icon of an add-on (PNG), read with the token: the browser cannot ask Home Assistant itself"""
        if not re.fullmatch(r"[a-z0-9_-]{1,64}", slug):
            raise ConnectorError("module inconnu")
        base = str(self.conf.get("url", "")).rstrip("/")
        req = urllib.request.Request(f"{base}/api/hassio/addons/{slug}/icon", headers={"Authorization": "Bearer " + str(self.conf.get("token", ""))})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:  # NOSONAR S5144: the address is the connector's own, the slug checked above
                return r.read(512 * 1024)
        except OSError as e:
            raise ConnectorError(explain(e)) from None

    def version(self) -> str | None:
        v = self._get("/api/config").get("version")
        return str(v) if v else None

    def collect(self) -> dict:
        cfg = self._get("/api/config")
        states = self._get("/api/states")
        if not isinstance(states, list):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Home Assistant")
        updates = [{"name": (s.get("attributes") or {}).get("friendly_name") or s["entity_id"],
                    "installed": (s.get("attributes") or {}).get("installed_version"),
                    "latest": (s.get("attributes") or {}).get("latest_version"),
                    "group": update_group(s["entity_id"], s.get("attributes") or {})}
                   for s in states if str(s.get("entity_id", "")).startswith(UPDATE) and s.get("state") == "on"]
        unavailable = sum(1 for s in states if s.get("state") == "unavailable")
        low = [(s.get("attributes") or {}).get("friendly_name") or s["entity_id"] for s in states
               if s.get("entity_id", "").startswith("sensor.") and (s.get("attributes") or {}).get("device_class") == "battery"
               and (_num(s.get("state")) is not None and _num(s["state"]) <= 20)]
        name_of = lambda st: (st.get("attributes") or {}).get("friendly_name") or st["entity_id"]   # noqa: E731
        autos = [st for st in states if str(st.get("entity_id", "")).startswith("automation.")]
        gone = sorted(name_of(st) for st in states if st.get("state") == "unavailable" and not str(st.get("entity_id", "")).startswith(UPDATE))
        out = {"version": cfg.get("version"), "name": cfg.get("location_name"), "state": cfg.get("state"),
               "entities": len(states), "unavailable": unavailable, "unavailable_names": gone[:12], "batteries_low": sorted(low)[:10],
               "automations": {"on": sum(1 for st in autos if st.get("state") == "on"), "total": len(autos)},
               "updates": sorted(updates, key=lambda u: u["name"].lower()), "addons": addons(states),
               "system": {"core": cfg.get("version"), **system(states)}}
        if host := host_sensors(states):
            out["host"] = host
        if str(self.conf.get("mcp_url") or "").strip():   # mode avancé : un échec de ha-mcp ne gâche pas la lecture par l'API REST
            out["mcp"] = HaMcp(self.conf["mcp_url"], self.ctx.timeout).collect()
        return out

    def test(self) -> Result:
        try:
            d = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        core = sum(u["group"] == "core" for u in d["updates"])
        other = len(d["updates"]) - core
        return Result(True, f"{d['name'] or 'Home Assistant'} · {d['entities']} entités · "
                            + (f"Home Assistant : {core} mise(s) à jour" if core else "Home Assistant à jour")
                            + (f" · {other} autre(s) (modules, appareils)" if other else "") + mcp_summary(d.get("mcp")), d["version"])

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c == 8123), 8123)
        return {"url": f"http://{ip}:{web}"}
