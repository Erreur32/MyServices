"""Réglages → Sauvegardes : décrire les sauvegardes à suivre depuis la page, sans écrire backups-meta.json à la main.

  discover()       cherche, par SSH et en lecture seule, les dossiers de sauvegarde habituels de chaque machine
                   (motifs « discover » de backups.py : /home/backup*, /root/*ackup*, /mnt/*/backup*) : rien n'est écrit
  current()        les jeux déjà suivis (backups-meta.json) et l'état de l'onglet
  follow(items)    ajoute un jeu par dossier choisi (nom, âge maximum) et écrit backups-meta.json, autres clés intouchées
  unfollow(id)     retire un jeu

Un « jeu » de sauvegarde = un dossier d'une machine dont le fichier le plus récent ne doit pas dépasser un certain âge.
Les sauvegardes Veeam, Home Assistant, Proxmox… se décrivent autrement (étapes suivantes) ; leurs jeux, s'il y en a, sont gardés.
"""
from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import setup

AGE_MIN, AGE_MAX = 0.1, 365.0
AGE_DEFAULT = 2.0
LABEL_MAX = 80
DEPTH = 3  # un dossier de sauvegarde range souvent ses archives dans des sous-dossiers datés


class BackupError(Exception):
    """Refus lisible (dossier invalide, machine inconnue…)."""


def _path() -> Path:
    import config
    return Path(config.CFG["backups_meta"])


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "x"


def _read() -> dict:
    p = _path()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except ValueError as e:
            raise BackupError(f"{p.name} illisible : {e}") from None
    patterns = []
    try:
        patterns = json.loads(setup.EXAMPLE_BACKUPS.read_text(encoding="utf-8")).get("discover", [])
    except (OSError, ValueError):
        pass
    return {"hosts": [], "sets": [], "discover": patterns, "discover_ignore": {}, "cron_ignore": [], "syncthing": []}


def _write(meta: dict) -> None:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(p)


def _machines() -> dict:
    """Machines de services-meta.json lues par SSH : {ip: {name, ssh}} (les machines non suivies et sans accès sont ignorées)."""
    if not setup.META.exists():
        return {}
    machines = json.loads(setup.META.read_text(encoding="utf-8")).get("machines", {})
    return {ip: {"name": m.get("name") or ip, "ssh": m["ssh"]} for ip, m in machines.items()
            if m.get("ssh") and not m.get("disabled")}


def current() -> dict:
    meta = _read()
    hosts = {h["id"]: h for h in meta.get("hosts", [])}
    sets = []
    for s in meta.get("sets", []):
        loc = (s.get("locations") or [{}])[0]
        sets.append({"id": s["id"], "label": s.get("label", s["id"]), "origin": hosts.get(s.get("origin"), {}).get("label", s.get("origin", "")),
                     "path": loc.get("path"), "veeam_job": loc.get("veeam_job"), "max_age_days": s.get("max_age_days", 8),
                     "editable": bool(loc.get("path")) and len(s.get("locations", [])) == 1})
    import config
    return {"sets": sets, "exists": _path().exists(), "tab": bool(config.CFG.get("backups_url")),
            "patterns": meta.get("discover", []), "machines": len(_machines())}


def _scan(item: tuple[str, dict], patterns: list[str]) -> dict:
    import backups
    ip, m = item
    req = {"locs": {}, "disks": False, "crons": False, "discover": patterns}
    out, err = backups.run_py(m["ssh"], backups.AGENT, json.dumps(req))
    folders = [{"path": d["path"], "size": d.get("size"), "newest": d.get("newest"), "newest_name": d.get("newest_name", ""),
                "readable": d.get("readable", True)} for d in (out or {}).get("local", [])]
    return {"ip": ip, "name": m["name"], "ssh": m["ssh"], "ok": out is not None, "error": err, "folders": folders}


def discover() -> dict:
    """Dossiers de sauvegarde trouvés sur chaque machine lue par SSH (lecture seule, quelques secondes à une minute)."""
    meta = _read()
    patterns = meta.get("discover") or []
    machines = _machines()
    with ThreadPoolExecutor(max(1, min(8, len(machines)))) as ex:
        found = list(ex.map(lambda it: _scan(it, patterns), machines.items()))
    followed = {(loc.get("host"), loc.get("path")) for s in meta.get("sets", []) for loc in s.get("locations", []) if loc.get("path")}
    hosts = {h.get("ip"): h["id"] for h in meta.get("hosts", [])}
    for m in found:
        for f in m["folders"]:
            f["followed"] = (hosts.get(m["ip"]), f["path"]) in followed
    return {"machines": found, "patterns": patterns, "at": time.time()}


def _check_item(it: dict, machines: dict) -> tuple[str, str, float, str]:
    ip, path, label = str(it.get("ip", "")), str(it.get("path", "")), str(it.get("label", "")).strip()
    if ip not in machines:
        raise BackupError(f"machine {ip or '?'} inconnue ou sans accès SSH")
    if not path.startswith("/") or ".." in path.split("/") or len(path) > 300 or "\n" in path or path == "/":
        raise BackupError(f"dossier invalide : {path or '?'}")
    if not label or len(label) > LABEL_MAX:
        raise BackupError(f"nom : 1 à {LABEL_MAX} caractères")
    try:
        age = float(it.get("max_age_days", AGE_DEFAULT))
    except (TypeError, ValueError):
        raise BackupError("âge maximum : un nombre de jours") from None
    if not AGE_MIN <= age <= AGE_MAX:
        raise BackupError(f"âge maximum : de {AGE_MIN:g} à {AGE_MAX:g} jours")
    return ip, path, age, label


def follow(items: list[dict]) -> dict:
    """Ajoute un jeu par dossier choisi. Un dossier déjà suivi est repris sans doublon (nom et âge mis à jour)."""
    if not items:
        raise BackupError("aucun dossier choisi")
    if len(items) > 50:
        raise BackupError("50 dossiers au plus à la fois")
    machines = _machines()
    meta = _read()
    hosts = {h["id"]: h for h in meta.setdefault("hosts", [])}
    meta.setdefault("sets", [])
    added = updated = 0
    for it in items:
        ip, path, age, label = _check_item(it, machines)
        m = machines[ip]
        hid = next((h["id"] for h in hosts.values() if h.get("ip") == ip and not h.get("api")), None)
        if hid is None:
            hid = _slug(m["name"])
            while hid in hosts:
                hid += "-2"
            hosts[hid] = {"id": hid, "label": m["name"], "ip": ip, "ssh": m["ssh"], "kind": "machine"}
            meta["hosts"].append(hosts[hid])
        elif hosts[hid].get("ssh") != m["ssh"]:
            hosts[hid]["ssh"] = m["ssh"]
        existing = next((s for s in meta["sets"] for loc in s.get("locations", []) if loc.get("host") == hid and loc.get("path") == path), None)
        if existing:
            existing["label"], existing["max_age_days"] = label, age
            updated += 1
            continue
        sid = _slug(f"{m['name']}-{path.rstrip('/').rsplit('/', 1)[-1]}")
        taken = {s["id"] for s in meta["sets"]}
        n, base = 2, sid
        while sid in taken:
            sid, n = f"{base}-{n}", n + 1
        meta["sets"].append({"id": sid, "label": label, "origin": hid, "schedule": "", "max_age_days": age,
                             "locations": [{"host": hid, "path": path, "pattern": "*", "depth": DEPTH, "via": "dossier"}]})
        added += 1
    _write(meta)
    return {"added": added, "updated": updated}


def unfollow(set_id: str) -> None:
    meta = _read()
    keep = [s for s in meta.get("sets", []) if s["id"] != set_id]
    if len(keep) == len(meta.get("sets", [])):
        raise BackupError("jeu inconnu")
    meta["sets"] = keep
    _write(meta)
