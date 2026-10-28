"""Icons imported by the user for machines and services (the icon picker): PNG, JPEG, WebP, GIF or SVG.

Each file is checked like an avatar (avatars.check: type read from the content, SVG reduced to plain drawing) and kept in the state
folder, named by a fingerprint of its content, so the same image sent twice is one icon. The key stored with a machine or a service
is « custom-<12 hex> », which the pages turn into an address under /api/v1/icons/.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from pathlib import Path

import avatars

MAX_ICONS = 200
KEY_RE = re.compile(r"custom-[0-9a-f]{12}")
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg"}
_LOCK = threading.Lock()


class IconError(Exception):
    pass


def _dir() -> Path:
    import config
    return Path(config.CFG["state_dir"]) / "icons"


def _file(key: str, mime: str | None) -> Path:
    """Path of an icon file, always inside the icons folder (the key is also checked by KEY_RE)."""
    base = os.path.realpath(_dir())
    path = os.path.realpath(os.path.join(base, f"{key}.{EXT.get(mime, 'bin')}"))
    if not path.startswith(base + os.sep):
        raise IconError("clé d'icône invalide")
    return Path(path)


def _index() -> dict[str, dict]:
    try:
        got = json.loads((_dir() / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return got if isinstance(got, dict) else {}


def _write(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def _label(name: str | None) -> str:
    base = re.sub(r"\.(png|jpe?g|webp|gif|svg)$", "", (name or "").strip(), flags=re.I)
    return re.sub(r"[\x00-\x1f<>]", "", base).strip()[:40] or "Icône importée"


def add(raw: bytes, name: str | None = None) -> str:
    """Key of the checked image (IconError / avatars.AvatarError when refused). Sending the same image again only renames it."""
    mime = avatars.check(raw)
    key = "custom-" + hashlib.sha256(raw).hexdigest()[:12]
    with _LOCK:
        idx = _index()
        if key not in idx and len(idx) >= MAX_ICONS:
            raise IconError(f"{MAX_ICONS} icônes importées au plus : en supprimer avant d'en ajouter")
        folder = _dir()
        folder.mkdir(parents=True, exist_ok=True)
        _write(_file(key, mime), raw)
        idx[key] = {"label": _label(name), "mime": mime, "created": idx.get(key, {}).get("created") or time.time()}
        _write(folder / "index.json", json.dumps(idx, ensure_ascii=False).encode("utf-8"))
    return key


def get(key: str) -> tuple[bytes, str] | None:
    """(bytes, MIME type) of an imported icon, None when unknown."""
    if not KEY_RE.fullmatch(key or ""):
        return None
    entry = _index().get(key)
    if not entry or entry.get("mime") not in EXT:
        return None
    try:
        return _file(key, entry["mime"]).read_bytes(), entry["mime"]
    except (OSError, IconError):
        return None


def listing() -> list[dict]:
    """Imported icons, oldest first: [{key, label, mime}]."""
    idx = _index()
    return [{"key": k, "label": v.get("label") or "", "mime": v.get("mime")} for k, v in sorted(idx.items(), key=lambda kv: kv[1].get("created") or 0)]


def remove(key: str) -> bool:
    with _LOCK:
        idx = _index()
        entry = idx.pop(key, None) if KEY_RE.fullmatch(key or "") else None
        if entry is None:
            return False
        _file(key, entry.get("mime")).unlink(missing_ok=True)
        _write(_dir() / "index.json", json.dumps(idx, ensure_ascii=False).encode("utf-8"))
    return True


def used(key: str, meta_text: str) -> bool:
    """Whether a machine or a service of services-meta.json still points at this icon."""
    return f'"{key}"' in meta_text
