"""Progression de l'assistant de démarrage, gardée côté serveur : on reprend où l'on en était depuis un autre navigateur ou après un
rechargement. Un petit fichier JSON dans le dossier d'état ; tout ce qui est lu est validé (jamais de confiance dans le fichier ni dans la page)."""
from __future__ import annotations

import ipaddress
import json
import os
from pathlib import Path

STEPS = ("welcome", "machine", "network", "access", "tools", "alerts")
MAX_ACCEPTED = 500
EMPTY = {"current": "welcome", "done": [], "skipped": [], "host": "", "accepted": []}


def clean(raw) -> dict:
    """État propre depuis n'importe quelle valeur : étapes connues seulement, sans doublon, `host` = une adresse IP ou vide."""
    if not isinstance(raw, dict) or raw.get("current") not in STEPS:
        return dict(EMPTY, done=[], skipped=[], accepted=[])
    def steps(v):
        return [s for s in dict.fromkeys(v if isinstance(v, list) else []) if s in STEPS]
    def address(v) -> str:
        try:
            return str(ipaddress.ip_address(str(v or "").strip())) if v else ""
        except ValueError:
            return ""
    done = steps(raw.get("done"))
    # accepted : machines dont l'utilisateur a choisi de garder la méthode de lecture actuelle (« C'est suffisant ainsi »)
    accepted = list(dict.fromkeys(a for a in map(address, raw.get("accepted") if isinstance(raw.get("accepted"), list) else []) if a))[:MAX_ACCEPTED]
    return {"current": raw["current"], "done": done, "skipped": [s for s in steps(raw.get("skipped")) if s not in done], "host": address(raw.get("host")),
            "accepted": accepted}


def load(path: str | Path) -> dict | None:
    """L'état enregistré, ou None si l'assistant n'a jamais servi (fichier absent ou illisible)."""
    try:
        return clean(json.loads(Path(path).read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return None


def save(path: str | Path, raw) -> dict:
    """Valide puis écrit d'un coup (fichier temporaire puis remplacement : jamais un fichier à moitié écrit)."""
    state, p = clean(raw), Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)
    return state


def finished(state: dict | None) -> bool:
    """Toutes les étapes faites ou passées."""
    return bool(state) and all(s in state["done"] or s in state["skipped"] for s in STEPS)
