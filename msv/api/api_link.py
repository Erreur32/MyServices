"""Machines lues par l'API d'un connecteur (Home Assistant, Proxmox, Dockhand, MynetworK…), sans SSH ni agent.

by_machine() relie chaque connecteur « état d'un service » à la machine qui l'héberge : l'adresse IP de son URL, ou les adresses que le service
annonce lui-même (Home Assistant : capteurs « System Monitor »). Le résultat est ajouté à chaque machine de data.json (`api`) : la page y voit que
la machine est lue (« API actif »), par quoi, en quelle version, et si ça marche.
"""
from __future__ import annotations

import ipaddress
import urllib.parse


def host_ip(url: str | None) -> str | None:
    """Adresse IPv4 de l'URL d'un connecteur (un nom d'hôte n'est pas résolu : la collecte ne fait pas de DNS pour ça), sinon None."""
    try:
        return str(ipaddress.IPv4Address(urllib.parse.urlsplit(str(url or "")).hostname or ""))
    except ValueError:
        return None


def by_machine(rows: list[dict], machines: set[str]) -> dict[str, list[dict]]:
    """{IP de la machine: [connecteurs qui la lisent]} d'après les lignes de connecteurs de data.json (une ligne = type, nom, état, version, adresse).
    Un connecteur dont aucune adresse ne correspond à une machine connue n'est rattaché à personne."""
    out: dict[str, list[dict]] = {}
    for r in rows:
        ips = [i for i in [host_ip(r.get("url")), *((r.get("host") or {}).get("ips") or [])] if i in machines]
        for ip in dict.fromkeys(ips):
            out.setdefault(ip, []).append({"type": r.get("connector"), "name": r.get("name"), "label": r.get("label"), "ok": bool(r.get("ok")),
                                           "stale": bool(r.get("stale")), "version": r.get("version"), "message": r.get("message"),
                                           "host": ({k: v for k, v in (r.get("host") or {}).items() if k in ("cpu", "mem_pct", "temp", "boot")} or None)})
    return out


def app_version(url: str | None, rows: list[dict]) -> str | None:
    """Version of the app behind a connector URL, read from its container (image label, found by SSH): the service row at the
    same « ip:port », or the NPM host serving that name. For connectors whose API gives no version (Dockhand, older MynetworK)."""
    u = urllib.parse.urlsplit(str(url or ""))
    host = (u.hostname or "").lower()
    if not host:
        return None
    port = u.port or (443 if u.scheme == "https" else 80)
    for r in rows:
        hit = (r.get("ip") == host and r.get("port") == port) if host_ip(url) else host in [d.lower() for d in r.get("domains") or []]
        if hit and (v := (r.get("service") or {}).get("version")):
            return str(v).lstrip("v")
    return None
