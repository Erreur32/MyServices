"""Branchements faits tout seuls à partir de ce que la collecte voit déjà, une seule fois par machine.

  adguard()   AdGuard Home trouvé dans les conteneurs d'une machine lue par SSH : « adguard » est posé dans services-meta.json (connecteur
              AdGuard par SSH) sans passer par « Redétecter ». Chaque machine n'est regardée qu'une fois (liste dans un fichier d'état) :
              vider ensuite le champ dans Réglages → Machines ne le fait pas revenir.
"""
from __future__ import annotations

import json
from pathlib import Path

ADGUARD_IMAGE = "adguard/adguardhome"


def containers_of(entry) -> list[dict]:
    """Conteneurs d'une machine dans le cache docker.json : liste nue ou {"containers": [...]}."""
    cs = entry if isinstance(entry, list) else (entry or {}).get("containers") if isinstance(entry, dict) else None
    return [c for c in cs or [] if isinstance(c, dict)]


def adguard_container(entry) -> str | None:
    """Nom du conteneur AdGuard Home (pas adguardhome-sync) parmi les conteneurs d'une machine."""
    for c in containers_of(entry):
        image = str(c.get("image") or "")
        if ADGUARD_IMAGE in image and "sync" not in image and not str(c.get("name") or "").endswith("sync"):
            return str(c.get("name"))
    return None


def adguard(machines: dict, docker: dict, state_file: Path) -> dict[str, str]:
    """{ip: conteneur} des machines à qui « adguard » doit être posé ; met à jour la liste des machines déjà regardées.
    Une machine sans inventaire Docker lisible n'est pas marquée (retentée au passage suivant)."""
    try:
        done = set(json.loads(state_file.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        done = set()
    found: dict[str, str] = {}
    for ip, m in machines.items():
        if ip in done or not m.get("ssh") or m.get("disabled"):
            continue
        entry = docker.get(ip)
        if entry is None or (isinstance(entry, dict) and entry.get("containers") is None):
            continue                                            # inventaire absent ou illisible : plus tard
        done.add(ip)
        if m.get("adguard") in (None, "") and (name := adguard_container(entry)):
            found[ip] = name
    state_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = state_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(sorted(done)), encoding="utf-8")
    tmp.replace(state_file)
    return found
