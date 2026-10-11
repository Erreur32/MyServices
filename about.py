"""Réglages → À propos : version installée, dernière version publiée sur GitHub, journal des changements.

La dernière version est lue côté serveur (la page n'a pas le droit de contacter GitHub : CSP), sur demande ou à l'ouverture de l'onglet, avec un
résultat gardé 6 heures dans state_dir. Une seule requête GET anonyme vers api.github.com (aucune donnée envoyée) ; coupée par la clé de
configuration « update_check » (false). Le journal des changements est le CHANGELOG.md livré dans l'image.
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

REPO = "Erreur32/MyServices"
API = f"https://api.github.com/repos/{REPO}/releases/latest"
TTL = 6 * 3600
SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$")


def parse(v: str | None) -> tuple | None:
    """« v0.9.3 » / « 0.9.4-rc.1 » -> (0, 9, 3, 1, '') ; une préversion précède sa version finale. None si ce n'est pas un numéro de version."""
    m = SEMVER.match((v or "").strip())
    return None if not m else (int(m[1]), int(m[2]), int(m[3]), 0 if m[4] else 1, m[4] or "")


def core_version(v: str | None) -> str | None:
    """Numéro de version d'une étiquette d'image : « v0.9.3-0a1b2c… » (étiquette + commit) -> « 0.9.3 » ; « dev » ou un commit seul -> None."""
    m = re.match(r"^v?(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)(?:-[0-9a-f]{7,40})?$", (v or "").strip())
    return m[1] if m else None


def planned(changelog: str) -> str | None:
    """Version prévue : la dernière publiée du journal + 1 (patch) quand une section « Unreleased » est en cours ; None sans travail en cours."""
    if not re.search(r"^## Unreleased", changelog, re.M):
        return None
    m = re.search(r"^## v(\d+)\.(\d+)\.(\d+)\b", changelog, re.M)
    return f"{m[1]}.{m[2]}.{int(m[3]) + 1}" if m else None


def newer(latest: str | None, current: str | None) -> bool:
    """Vrai seulement si `latest` est strictement plus récent : une version locale en avance sur son étiquette (« dev », commit local) n'est pas
    présentée comme « plus ancienne que la dernière »."""
    a, b = parse(latest), parse(core_version(current) or current)
    return bool(a and b and a > b)


def fetch_latest(opener=urllib.request.urlopen) -> dict:
    req = urllib.request.Request(API, headers={"Accept": "application/vnd.github+json", "User-Agent": "myservices-update-check"})
    with opener(req, timeout=8) as r:
        d = json.loads(r.read(200_000))
    return {"tag": d.get("tag_name"), "name": d.get("name") or d.get("tag_name"), "url": d.get("html_url"), "published": d.get("published_at"),
            "prerelease": bool(d.get("prerelease")), "notes": (d.get("body") or "")[:3000]}


def latest(state_dir: Path, force: bool = False, enabled: bool = True, now: float | None = None, opener=urllib.request.urlopen) -> dict:
    """{release, checked_at, error, cached} ; jamais d'exception : hors ligne ou limite GitHub atteinte, on garde la dernière réponse connue."""
    now = now or time.time()
    f = state_dir / "update-check.json"
    try:
        cur = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cur = {}
    if not enabled:
        return {"release": cur.get("release"), "checked_at": cur.get("checked_at"), "error": "vérification coupée (update_check)", "cached": True, "enabled": False}
    if not force and cur.get("checked_at") and now - cur["checked_at"] < TTL:
        return {**cur, "error": None, "cached": True, "enabled": True}
    try:
        cur = {"release": fetch_latest(opener), "checked_at": now}
        err = None
        state_dir.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(cur), encoding="utf-8")
        tmp.replace(f)
    except (OSError, ValueError) as e:
        err = f"GitHub injoignable : {type(e).__name__}"
    return {"release": cur.get("release"), "checked_at": cur.get("checked_at"), "error": err, "cached": err is not None, "enabled": True}


def changelog(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")[:200_000]
    except OSError:
        return ""
