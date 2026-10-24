"""Quelle méthode de lecture recommander pour une machine : SSH, agent, connecteur, ou ping seul.

Une seule règle, côté serveur, pour l'assistant de démarrage et la page Agents. Fonction pure (aucune lecture réseau, aucune écriture) :
elle reçoit ce que l'on sait de la machine et répond. Rien n'est décidé à la place de l'utilisateur, c'est une recommandation.

Règle (la même que dans le README) :
- box, passerelle, appli fermée (Freebox, UniFi…) : le connecteur, jamais d'agent ;
- Home Assistant OS : son API (connecteur), ni SSH ni agent : l'accès SSH y est effacé à chaque redémarrage (constat de l'auteur) ;
- VMware ESXi et NAS fermé (Synology, QNAP, WD My Cloud, TrueNAS, Unraid) : leur connecteur ou le SSH, jamais d'agent (rien ne s'y installe) ;
- PC Windows : l'agent ;
- machine Linux : l'agent (il relit la machine chaque minute, sans clé SSH ; décidé le 2026-10-23), le SSH en alternative et gardé pour ce
  que l'agent ne lit pas (sauvegardes, Proxmox ou ESXi, NPM, AdGuard : ssh_uses) ; une machine déjà lue par SSH n'est pas signalée pour autant ;
- le reste : ping seul.
"""
from __future__ import annotations

import re

METHODS = ("ssh", "agent", "connector", "ping")

# Matériel fermé : on n'y installe rien, même si un port SSH répond (une passerelle UniFi se présente comme un Linux)
APPLIANCE_ICONS = {"freebox", "free", "nut", "unifi"}
APPLIANCE_APPS = {"unifi", "freebox", "opnsense", "pfsense", "openwrt", "mikrotik", "ubiquiti"}
APPLIANCE_ROLE = re.compile(r"passerelle|gateway|routeur|router|firewall|\bbox\b", re.IGNORECASE)
# Closed systems where nothing gets installed, read by their connector or over SSH: VMware ESXi, NAS systems
ESXI = re.compile(r"esxi|vmware", re.IGNORECASE)
CLOSED_NAS = re.compile(r"synology|qnap|\bwd\b|my ?cloud|truenas|freenas|unraid", re.IGNORECASE)


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


def closed_system(f: dict) -> str | None:
    """« esxi » or « nas » for a closed system read by its connector or over SSH (never an agent), from the SSH reading, the icon, the
    apps recognised or the connectors; None otherwise."""
    words = " ".join(str(w) for w in [f.get("info_os") or "", f.get("icon") or "", *(f.get("apps") or []), *(f.get("connectors") or [])])
    if ESXI.search(words):
        return "esxi"
    return "nas" if CLOSED_NAS.search(words) else None


def advise(f: dict) -> dict:
    """Recommandation pour une machine décrite par ses faits (clés facultatives) :
    ip, os (réglage « windows »), info_os (relevé SSH), scan_os, ttl, ping, icon, role, gateway, apps, ssh_port (vu par le scan),
    ssh_alias (accès réglé), ssh_ok (relevé SSH reçu), agent (« actif » si son relevé est frais), agent_state (état de l'agent installé :
    actif, silencieux, en attente ; absent s'il n'y en a pas), connectors (libellés).

    Retour : kind (système), method (ssh | agent | connector | ping), why (code court), agent_possible, agent_kind (windows | linux | None),
    agent_state (celui de l'agent installé, pour dire « il ne répond plus »), current (méthodes qui lisent déjà la machine),
    alternatives (autres méthodes possibles, dans l'ordre)."""
    kind = os_kind(f)
    connectors = [c for c in f.get("connectors") or [] if c]
    current = [m for m, on in (("ssh", f.get("ssh_ok")), ("agent", f.get("agent") == "actif"), ("connector", bool(connectors))) if on]
    method, why, alternatives, agent_possible, agent_kind = _plan(f, kind, connectors)
    return {"kind": kind, "method": method, "why": why, "current": current, "alternatives": [a for a in alternatives if a != method],
            "agent_possible": agent_possible, "agent_kind": agent_kind, "agent_state": f.get("agent_state")}


def _plan(f: dict, kind: str, connectors: list[str]) -> tuple[str, str, list[str], bool, str | None]:
    """(méthode, motif, alternatives, agent possible, type d'agent) pour une machine de ce système, dans l'ordre des règles du module."""
    via_tool = "connector" if connectors else "ping"
    if is_appliance(f):
        return via_tool, "appliance", ["ping"], False, None
    if is_home_assistant_os(f):   # ni SSH ni agent : l'API
        return via_tool, "home_assistant", ["ping"], False, None
    closed = closed_system(f)
    if closed:   # its connector first, else SSH when it answers, else the ping
        ssh = bool(f.get("ssh_ok") or f.get("ssh_alias") or f.get("ssh_port"))
        usable = [m for m, ok in (("connector", connectors), ("ssh", ssh)) if ok] or ["ping"]
        return usable[0], closed, usable[1:], False, None
    if kind == "windows":
        return "agent", "windows", ["connector"] if connectors else [], True, "windows"
    if kind in ("ios", "network"):
        return via_tool, "device", [], False, None
    ssh_possible = bool(f.get("ssh_ok") or f.get("ssh_alias") or f.get("ssh_port"))
    if kind == "macos":   # pas d'agent macOS
        return ("ssh", "macos", [], False, None) if ssh_possible else ("ping", "macos_no_ssh", [], False, None)
    return _plan_linux(f, kind, connectors, ssh_possible)


def _plan_linux(f: dict, kind: str, connectors: list[str], ssh_possible: bool) -> tuple[str, str, list[str], bool, str | None]:
    """Linux ou système inconnu : l'agent (SSH en alternative quand il est possible), un outil seul s'il n'y a que lui, sinon le ping."""
    if ssh_possible:
        why = "agent_linux_ssh" if f.get("ssh_ok") or f.get("ssh_alias") else "agent_linux"
        return "agent", why, ["ssh"] + (["connector"] if connectors else []), True, "linux"
    if connectors:
        return "connector", "connector_only", ["agent"], True, "linux"
    if f.get("ping") is False:
        return "ping", "unreachable", ["agent"], True, "linux" if kind == "linux" else None
    if kind == "linux":
        return "agent", "no_ssh_port", [], True, "linux"
    return "ping", "unknown_system", ["agent"], True, None


def freebox_tool(m: dict, network: list[dict] | None) -> str | None:
    """Libellé de l'outil réseau qui lit la Freebox : MynetworK ne donne pas son adresse, elle est reconnue par son nom (pas le « Player »)."""
    if not re.search(r"freebox", str(m.get("name") or ""), re.IGNORECASE) or re.search(r"player", str(m.get("name")), re.IGNORECASE):
        return None
    return next((c.get("label") for c in network or [] if (c.get("freebox") or {}).get("system")), None)


def connectors_of(m: dict, network: list[dict] | None) -> list[str]:
    """Libellés des outils qui lisent cette machine : connecteurs d'API (y compris périmés), outils rapprochés qui répondent, et l'outil de la Freebox."""
    out = [a.get("label") for a in m.get("api") or [] if a.get("ok") or a.get("stale")]
    out += [s.get("label") for s in (m.get("links") or {}).get("sources") or [] if s.get("ok") is not False and s.get("label") not in out]
    if (fb := freebox_tool(m, network)) and fb not in out:
        out.append(fb)
    return out


def facts_of(m: dict, conf: dict | None = None, scan: dict | None = None, network: list[dict] | None = None, agent_state: str | None = None) -> dict:
    """Faits d'une machine à partir de l'entrée de data.json « machine_list » (m), de son réglage (conf), de son entrée du dernier scan réseau
    et des outils réseau (data.json « network », pour reconnaître la Freebox)."""
    conf, scan = conf or {}, scan or {}
    ssh = m.get("ssh") or {}
    return {
        "ip": m.get("ip"), "os": conf.get("os"), "info_os": (m.get("info") or {}).get("os"), "scan_os": scan.get("os"), "ttl": m.get("ttl"),
        "ping": m.get("ping"), "icon": m.get("icon") or conf.get("icon"), "role": m.get("role") or conf.get("role"),
        "gateway": bool(conf.get("gateway")) or "gateway" in (m.get("detected") or []), "apps": scan.get("apps") or [],
        "ssh_port": scan.get("ssh_port"), "ssh_alias": ssh.get("alias") or (conf.get("ssh") if isinstance(conf.get("ssh"), str) else None),
        "ssh_ok": bool(m.get("info")), "agent": "actif" if m.get("agent") else None, "agent_state": agent_state, "connectors": connectors_of(m, network),
    }


def advise_all(machines: list[dict], confs: dict[str, dict] | None = None, scan_found: list[dict] | None = None, network: list[dict] | None = None,
               agents: dict[str, str] | None = None) -> dict[str, dict]:
    """Recommandation de chaque machine suivie : {ip: advise(...)}. `agents` : {ip: état de l'agent installé}."""
    scans = {h.get("ip"): h for h in scan_found or []}
    return {m["ip"]: advise(facts_of(m, (confs or {}).get(m["ip"]), scans.get(m["ip"]), network, (agents or {}).get(m["ip"]))) for m in machines if m.get("ip")}


# What the Linux agent reads as well as SSH: the health and the inventory (Docker, listening ports, services out of Docker). Anything else
# read over SSH on a machine needs its SSH access even when an agent runs there.
AGENT_COVERS = ("docker", "process")


def ssh_uses(machines: dict, connectors: list[dict], backup_hosts: list[dict], virtualization: list[dict]) -> dict[str, list[str]]:
    """{IP: [what needs SSH there]} for Machines › SSH connections: « backups » (backups.py reads its folders or crontab), the type of a
    connector set on its SSH alias (npm, adguard, borgmatic…), « adguard » for the AdGuard of a machine, and the hypervisor read by SSH
    (proxmox, esxi, virsh, incus, lxc, vboxmanage). A machine absent here is read over SSH for its health and inventory only, which an agent
    also does. Pure: it gets the settings and the rows already read."""
    ip_of = {m["ssh"]: ip for ip, m in machines.items() if isinstance(m.get("ssh"), str) and not m.get("disabled")}
    out: dict[str, list[str]] = {}

    def add(ip: str | None, what: str) -> None:
        if ip and what not in out.setdefault(ip, []):
            out[ip].append(what)

    for h in backup_hosts:
        if not h.get("api") and not h.get("mount"):
            add(ip_of.get(str(h.get("ssh"))), "backups")
        add(ip_of.get(str(h.get("cron_via") or "").split(":")[0]), "backups")
    for c in connectors:
        if isinstance(c.get("ssh"), str) and c.get("type") not in AGENT_COVERS:
            add(ip_of.get(c["ssh"]), str(c.get("type")))
    for ip, m in machines.items():
        if m.get("adguard") and isinstance(m.get("ssh"), str):
            add(ip, "adguard")
    for r in virtualization:
        if r.get("via") == "ssh":
            add(r.get("ip"), str(r.get("connector")))
    return {ip: v for ip, v in out.items() if v}
