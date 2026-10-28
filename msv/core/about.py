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
TAGS_API = f"https://api.github.com/repos/{REPO}/tags?per_page=30"
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


def released(changelog: str) -> str | None:
    """Last version published in the changelog of this build (« ## v0.10.1 (...) » -> « 0.10.1 »), None without one. An image built from a branch
    carries the changelog of its commit, so this is the release it sits on or just after."""
    m = re.search(r"^## v(\d+\.\d+\.\d+)\b", changelog, re.M)
    return m[1] if m else None


def newer(latest: str | None, current: str | None) -> bool:
    """Vrai seulement si `latest` est strictement plus récent : une version locale en avance sur son étiquette (« dev », commit local) n'est pas
    présentée comme « plus ancienne que la dernière »."""
    a, b = parse(latest), parse(core_version(current) or current)
    return bool(a and b and a > b)


def _get(url: str, opener) -> object:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "myservices-update-check"})
    with opener(req, timeout=8) as r:
        return json.loads(r.read(200_000))


def fetch_latest(opener=urllib.request.urlopen, current: str | None = None) -> dict:
    """The latest GitHub release. When it is older than the installed version (a tag pushed without its release), the highest published tag
    stands in for it: the page then says what is really the latest instead of a version older than the one running."""
    d = _get(API, opener)
    rel = {"tag": d.get("tag_name"), "name": d.get("name") or d.get("tag_name"), "url": d.get("html_url"), "published": d.get("published_at"),
           "prerelease": bool(d.get("prerelease")), "notes": (d.get("body") or "")[:3000]}
    if current and newer(core_version(current) or current, rel["tag"]):
        try:
            got: object = _get(TAGS_API, opener)
            raw_tags: list = got if isinstance(got, list) else []
            tags = [t.get("name") for t in raw_tags if isinstance(t, dict)]
        except (OSError, ValueError, TypeError):
            return rel
        final = [t for t in tags if parse(t) and parse(t)[3] == 1]   # final versions only (a pre-release has a 0 there)
        top = max(final, key=parse, default=None)
        if top and newer(top, rel["tag"]):
            return {"tag": top, "name": top, "url": f"https://github.com/{REPO}/releases/tag/{top}", "published": None, "prerelease": False, "notes": "", "from_tag": True}
    return rel


def latest(state_dir: Path, force: bool = False, enabled: bool = True, now: float | None = None, opener=urllib.request.urlopen,
           current: str | None = None) -> dict:
    """{release, checked_at, error, cached} ; jamais d'exception : hors ligne ou limite GitHub atteinte, on garde la dernière réponse connue.
    `current` : la version installée ; une réponse gardée plus ancienne qu'elle (vérifiée avant la publication) est revérifiée tout de suite."""
    now = now or time.time()
    f = state_dir / "update-check.json"
    try:
        cur = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cur = {}
    if not enabled:
        return {"release": cur.get("release"), "checked_at": cur.get("checked_at"), "error": "vérification coupée (update_check)", "cached": True, "enabled": False}
    stale = newer(core_version(current) or current, (cur.get("release") or {}).get("tag"))   # installed is newer than the latest kept
    if not force and not stale and cur.get("checked_at") and now - cur["checked_at"] < TTL:
        return {**cur, "error": None, "cached": True, "enabled": True}
    try:
        cur = {"release": fetch_latest(opener, current), "checked_at": now}
        err = None
        state_dir.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(cur), encoding="utf-8")
        tmp.replace(f)
    except (OSError, ValueError) as e:
        err = f"GitHub injoignable : {type(e).__name__}"
    return {"release": cur.get("release"), "checked_at": cur.get("checked_at"), "error": err, "cached": err is not None, "enabled": True}


def cached(state_dir: Path, current: str | None) -> dict:
    """The last answer kept, without any request (for every page load): {available, tag, url}; nothing known: available False."""
    try:
        rel = json.loads((state_dir / "update-check.json").read_text(encoding="utf-8")).get("release") or {}
    except (OSError, ValueError):
        rel = {}
    return {"available": newer(rel.get("tag"), current), "tag": rel.get("tag"), "url": rel.get("url")}


def changelog(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")[:200_000]
    except OSError:
        return ""
