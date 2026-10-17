"""Quelle méthode de lecture recommander pour une machine : SSH, agent, connecteur, ou ping seul.

Une seule règle, côté serveur, pour l'assistant de démarrage et la page Agents. Fonction pure (aucune lecture réseau, aucune écriture) :
elle reçoit ce que l'on sait de la machine et répond. Rien n'est décidé à la place de l'utilisateur, c'est une recommandation.

Règle (la même que dans le README) :
- box, passerelle, appli fermée (Freebox, UniFi…) : le connecteur, jamais d'agent ;
- Home Assistant OS : son API (connecteur), ni SSH ni agent : l'accès SSH y est effacé à chaque redémarrage (constat de l'auteur) ;
- PC Windows : l'agent ;
- machine Linux où le SSH est possible : le SSH (l'agent n'y sert que de secours) ;
- machine où le SSH est impossible : l'agent ;
- le reste : ping seul.
"""
from __future__ import annotations

import re

METHODS = ("ssh", "agent", "connector", "ping")

# Matériel fermé : on n'y installe rien, même si un port SSH répond (une passerelle UniFi se présente comme un Linux)
APPLIANCE_ICONS = {"freebox", "free", "nut", "unifi"}
APPLIANCE_APPS = {"unifi", "freebox", "opnsense", "pfsense", "openwrt", "mikrotik", "ubiquiti"}
APPLIANCE_ROLE = re.compile(r"passerelle|gateway|routeur|router|firewall|\bbox\b", re.IGNORECASE)


def os_kind(f: dict) -> str:
    """windows | linux | macos | ios | network | unknown, d'après le réglage, le relevé SSH, le scan puis le TTL (même ordre de confiance que la page)."""
    raw = str(f.get("info_os") or "").lower()
    if f.get("os") == "windows" or "windows" in raw:
        return "windows"
    if "mac os" in raw or "macos" in raw or "darwin" in raw:
        return "macos"
    if raw:
        return "linux"
    scan = f.get("scan_os")
    if scan in ("windows", "linux", "macos", "ios", "network"):
        return scan
    ttl = f.get("ttl") or 0
    if ttl > 128:
        return "network"
    if ttl > 64:
        return "windows"
    return "unknown"


def is_appliance(f: dict) -> bool:
    """Box, passerelle, routeur, onduleur ou appli fermée : lue par un connecteur, jamais par un agent."""
    apps = {str(a).lower() for a in f.get("apps") or []}
    return bool(
        f.get("gateway")
        or str(f.get("icon") or "").lower() in APPLIANCE_ICONS
        or apps & APPLIANCE_APPS
        or APPLIANCE_ROLE.search(str(f.get("role") or ""))
        or f.get("scan_os") == "network"
    )


def is_home_assistant_os(f: dict) -> bool:
    """Home Assistant OS : système fermé, lu par l'API de Home Assistant. Reconnu par le relevé SSH, ou, sans relevé SSH, par l'appli reconnue,
    le connecteur ou l'icône (un Home Assistant en conteneur sur un Linux lu par SSH reste une machine Linux normale)."""
    if "home assistant" in str(f.get("info_os") or "").lower():
        return True
    if f.get("ssh_ok"):
        return False
    words = [str(a).lower() for a in (f.get("apps") or []) + (f.get("connectors") or [])] + [str(f.get("icon") or "").lower()]
    return any(re.search(r"home[ _-]?assistant", w) for w in words)


def advise(f: dict) -> dict:
    """Recommandation pour une machine décrite par ses faits (clés facultatives) :
    ip, os (réglage « windows »), info_os (relevé SSH), scan_os, ttl, ping, icon, role, gateway, apps, ssh_port (vu par le scan),
    ssh_alias (accès réglé), ssh_ok (relevé SSH reçu), agent (état de l'agent : actif, silencieux, en attente), connectors (libellés).

    Retour : kind (système), method (ssh | agent | connector | ping), why (code court), agent_possible, agent_kind (windows | linux | None),
    current (méthodes qui lisent déjà la machine), alternatives (autres méthodes possibles, dans l'ordre)."""
    kind = os_kind(f)
    connectors = [c for c in f.get("connectors") or [] if c]
    current = [m for m, on in (("ssh", f.get("ssh_ok")), ("agent", f.get("agent") == "actif"), ("connector", bool(connectors))) if on]
    ssh_possible = bool(f.get("ssh_ok") or f.get("ssh_alias") or f.get("ssh_port"))

    def answer(method: str, why: str, alternatives: list[str], agent_possible: bool = False, agent_kind: str | None = None) -> dict:
        return {"kind": kind, "method": method, "why": why, "current": current, "alternatives": [a for a in alternatives if a != method],
                "agent_possible": agent_possible, "agent_kind": agent_kind}

    if is_appliance(f):
        return answer("connector" if connectors else "ping", "appliance", ["ping"])
    if is_home_assistant_os(f):   # ni SSH ni agent : l'API
        return answer("connector" if connectors else "ping", "home_assistant", ["ping"])
    if kind == "windows":
        return answer("agent", "windows", ["connector"] if connectors else [], True, "windows")
    if kind in ("ios", "network"):
        return answer("connector" if connectors else "ping", "device", [])
    if kind == "macos":   # pas d'agent macOS
        return answer("ssh" if ssh_possible else "ping", "macos" if ssh_possible else "macos_no_ssh", [])
    # Linux ou système inconnu
    agent_kind = "linux" if kind == "linux" else None
    if ssh_possible:
        return answer("ssh", "ssh_configured" if f.get("ssh_ok") or f.get("ssh_alias") else "ssh_port",
                      ["agent"] + (["connector"] if connectors else []), True, "linux")
    if connectors:
        return answer("connector", "connector_only", ["agent"], True, "linux")
    if f.get("ping") is False:
        return answer("ping", "unreachable", ["agent"], True, agent_kind)
    if kind == "linux":
        return answer("agent", "no_ssh_port", [], True, "linux")
    return answer("ping", "unknown_system", ["agent"], True, None)


def freebox_tool(m: dict, network: list[dict] | None) -> str | None:
    """Libellé de l'outil réseau qui lit la Freebox : MynetworK ne donne pas son adresse, elle est reconnue par son nom (pas le « Player »)."""
    if not re.search(r"freebox", str(m.get("name") or ""), re.IGNORECASE) or re.search(r"player", str(m.get("name")), re.IGNORECASE):
        return None
    return next((c.get("label") for c in network or [] if (c.get("freebox") or {}).get("system")), None)


def facts_of(m: dict, conf: dict | None = None, scan: dict | None = None, network: list[dict] | None = None) -> dict:
    """Faits d'une machine à partir de l'entrée de data.json « machine_list » (m), de son réglage (conf), de son entrée du dernier scan réseau
    et des outils réseau (data.json « network », pour reconnaître la Freebox)."""
    conf, scan = conf or {}, scan or {}
    ssh = m.get("ssh") or {}
    sources = (m.get("links") or {}).get("sources") or []
    connectors = [a.get("label") for a in m.get("api") or [] if a.get("ok") or a.get("stale")]
    connectors += [s.get("label") for s in sources if s.get("ok") is not False and s.get("label") not in connectors]
    if (fb := freebox_tool(m, network)) and fb not in connectors:
        connectors.append(fb)
    return {
        "ip": m.get("ip"), "os": conf.get("os"), "info_os": (m.get("info") or {}).get("os"), "scan_os": scan.get("os"), "ttl": m.get("ttl"),
        "ping": m.get("ping"), "icon": m.get("icon") or conf.get("icon"), "role": m.get("role") or conf.get("role"),
        "gateway": bool(conf.get("gateway")) or "gateway" in (m.get("detected") or []), "apps": scan.get("apps") or [],
        "ssh_port": scan.get("ssh_port"), "ssh_alias": ssh.get("alias") or (conf.get("ssh") if isinstance(conf.get("ssh"), str) else None),
        "ssh_ok": bool(m.get("info")), "agent": "actif" if m.get("agent") else None, "connectors": connectors,
    }


def advise_all(machines: list[dict], confs: dict[str, dict] | None = None, scan_found: list[dict] | None = None, network: list[dict] | None = None) -> dict[str, dict]:
    """Recommandation de chaque machine suivie : {ip: advise(...)}."""
    scans = {h.get("ip"): h for h in scan_found or []}
    return {m["ip"]: advise(facts_of(m, (confs or {}).get(m["ip"]), scans.get(m["ip"]), network)) for m in machines if m.get("ip")}
