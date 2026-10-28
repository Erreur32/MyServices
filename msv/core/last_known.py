"""Dernière identification connue des services : relue dans le data.json du passage précédent, pour la garder quand un backend
tombe (conteneur arrêté, machine éteinte). Sans elle, la ligne perd son nom et ressemble à un service jamais identifié.

Elle n'est reprise que si la cible (ip:port) n'a pas changé : un host NPM qui vise un autre port (Apache remplacé par Anubis) ne garde
pas l'ancien nom. Le changement de cible est daté (target_changed) et gardé RECENT_DAYS jours pour le badge « changé récemment »."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

RECENT_DAYS = 7


def _rows(path: str) -> list[dict]:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("hosts", [])
    except (OSError, ValueError, AttributeError):
        return []


def target(r: dict) -> str | None:
    """« ip:port » visé par une ligne (forward d'un host NPM, port d'un service local) ; None sans adresse."""
    return f'{r["ip"]}:{r["port"]}' if r.get("ip") and r.get("port") else None


def previous_rows(path: str) -> dict:
    """{(type, id): {service, target, target_changed, target_before}} d'après le data.json de `path` ; vide si absent ou illisible.
    service None s'il n'était pas identifié ; les services saisis à la main sont ignorés (stables)."""
    return {(r.get("type"), str(r.get("id"))): {
        "service": r["service"] if r.get("service") and r["service"].get("kind") != "manuel" else None,
        "target": target(r), "target_changed": r.get("target_changed"), "target_before": r.get("target_before")} for r in _rows(path)}


def mark_target_change(r: dict, prev: dict | None, now: datetime | None = None) -> bool:
    """Date le changement de cible de la ligne `r` (target_changed, ISO UTC ; target_before = ancienne cible) ou recopie celui du passage
    précédent tant qu'il a moins de RECENT_DAYS jours. Renvoie True si la cible est la même qu'avant (l'ancien service peut être repris)."""
    if not prev:
        return False
    now = now or datetime.now(timezone.utc)
    cur = target(r)
    if prev["target"] and cur and prev["target"] != cur:
        r.update(target_changed=now.isoformat(timespec="seconds"), target_before=prev["target"])
        return False
    try:
        when = datetime.fromisoformat(prev["target_changed"]) if prev.get("target_changed") else None
    except (TypeError, ValueError):
        when = None
    if when and now - when < timedelta(days=RECENT_DAYS):
        r.update(target_changed=prev["target_changed"], target_before=prev.get("target_before"))
    return prev["target"] == cur
