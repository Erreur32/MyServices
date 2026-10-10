"""Cache de l'inventaire Docker et machines (lu par SSH) : un fichier JSON pour toutes les machines, valable `ttl` secondes,
avec une liste « stale » de machines à relire sans toucher aux autres (accès SSH changé, machine qui change d'état).

  {"ts": <date de la lecture complète>, "data": {ip: conteneurs, "_internal": {...}, "_hostinfo": {...}}, "stale": [ip, ...]}
"""
from __future__ import annotations

import json
import os
import time


def load(path: str, ttl: float) -> dict | None:
    """Le cache s'il est lisible et encore valable ; None sinon (tout est alors à relire)."""
    try:
        with open(path) as f:
            cache = json.load(f)
        return cache if time.time() - cache["ts"] < ttl and isinstance(cache["data"], dict) else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def mark_stale(path: str, ip: str | None = None) -> None:
    """Une machine (ip) ou tout (sans ip) sera relue à la prochaine collecte."""
    try:
        with open(path) as f:
            cache = json.load(f)
        if ip:
            cache["stale"] = sorted({*cache.get("stale", []), ip})
        else:
            cache["ts"] = 0
        with open(path, "w") as f:
            json.dump(cache, f)
    except (OSError, ValueError, TypeError):
        pass


def refresh(path: str, ttl: float, read, force: bool | set = False) -> dict:
    """Inventaire à jour. read(only) lit par SSH (only = ensemble d'IP, ou None pour toutes). Cache valable et rien à relire :
    rendu tel quel. Machines à relire (« stale », ou `force` = ensemble d'IP) : seules celles-là sont lues, le reste vient du
    cache ; une lecture ratée (None) reste « stale » pour le prochain passage. `force=True` ou cache périmé : tout est relu."""
    cache = None if force is True else load(path, ttl)
    if cache is not None:
        stale = set(cache.get("stale", [])) | (force if isinstance(force, set) else set())
        data = cache["data"]
        if not stale:
            return data
        part = read(stale)
        for key in ("_internal", "_hostinfo"):
            data.setdefault(key, {})
        for ip in stale:
            for k in (ip,):
                data.pop(k, None)
            data["_internal"].pop(ip, None)
            data["_hostinfo"].pop(ip, None)
        data.update({k: v for k, v in part.items() if not k.startswith("_")})
        data["_internal"].update(part.get("_internal", {}))
        data["_hostinfo"].update(part.get("_hostinfo", {}))
        retry = sorted(ip for ip in stale if part.get(ip, 0) is None)
        _write(path, {"ts": cache["ts"], "data": data, "stale": retry})
        return data
    data = read(None)
    failed = any(v is None for k, v in data.items() if not k.startswith("_"))
    # lecture ratée (clé pas encore autorisée) : relue au prochain passage, pas dans `ttl`
    _write(path, {"ts": time.time() - (ttl if failed else 0), "data": data})
    return data


def _write(path: str, cache: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(cache, f)
