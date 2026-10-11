"""Dernière identification connue des services : relue dans le data.json du passage précédent, pour la garder quand un backend
tombe (conteneur arrêté, machine éteinte). Sans elle, la ligne perd son nom et ressemble à un service jamais identifié."""
from __future__ import annotations

import json


def previous_services(path: str) -> dict:
    """{(type, id): service} d'après le data.json de `path` ; vide si absent ou illisible. Les services saisis à la main sont ignorés (stables)."""
    try:
        with open(path, encoding="utf-8") as f:
            rows = json.load(f).get("hosts", [])
    except (OSError, ValueError):
        return {}
    return {(r.get("type"), str(r.get("id"))): r["service"] for r in rows if r.get("service") and r["service"].get("kind") != "manuel"}
