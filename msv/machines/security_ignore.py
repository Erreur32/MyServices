"""Security page: the findings an admin chose not to be told about any more.

A key is either « area|title|detail » (one finding: it comes back when its detail changes) or « area:* » (every finding of that area, the check
is switched off). The list is kept in services-meta.json for the next collections, shown as `security_ignore` in data.json, and applied to the
published data.json at once.
"""
from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path

from msv.machines import new_services

KEY_MAX = 300
LIST_MAX = 300
AREAS = ("fail2ban", "sites", "certs", "ssh", "access", "ports")


def _valid(key: str) -> bool:
    if len(key) > KEY_MAX or not key.isprintable():
        return False
    area, sep, rest = key.partition(":") if key.endswith(":*") else key.partition("|")
    return area in AREAS and (rest == "*" if sep == ":" else bool(sep) and "|" in rest)


def read(meta_path: Path) -> list[str]:
    try:
        got = json.loads(meta_path.read_text(encoding="utf-8")).get("security_ignore")
    except (OSError, ValueError):
        return []
    return [k for k in got if isinstance(k, str)] if isinstance(got, list) else []


def set_keys(meta_path: Path, web_dir: str | Path, keys: list[str]) -> list[str]:
    """Replaces the list; a bad key raises ValueError. Returns the cleaned list."""
    from msv.machines import setup
    clean = sorted({k.strip() for k in keys if k.strip()})
    if len(clean) > LIST_MAX or not all(_valid(k) for k in clean):
        raise ValueError("point de sécurité invalide")
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    if clean:
        meta["security_ignore"] = clean
    else:
        meta.pop("security_ignore", None)
    with contextlib.redirect_stdout(io.StringIO()):
        setup.save(meta_path, meta)
    new_services.rewrite_data(web_dir, lambda data: data.update(security_ignore=clean))
    return clean
