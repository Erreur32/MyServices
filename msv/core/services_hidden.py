"""Services hidden from « To watch » (Services page), and from the tab's dot and the home page: one entry per service, with the signature of the
problem that was hidden (state, label, points to check). The page shows a hidden service again by itself when its signature changes."""
from __future__ import annotations

import json
import time
from pathlib import Path

KEEP = 500   # entries kept, the most recent ones


def read(path: str | Path) -> dict[str, dict]:
    """{service key: {sig, name, at}}; empty when the file is missing or unreadable."""
    try:
        got = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in got.items() if isinstance(k, str) and isinstance(v, dict)} if isinstance(got, dict) else {}


def set_hidden(path: str | Path, key: str, sig: str, name: str, hidden: bool) -> None:
    """Hide (with the signature of its problem) or show again one service; written whole then renamed."""
    if not key or len(key) > 200 or len(sig) > 500 or len(name) > 300:
        raise ValueError("clé invalide")
    f, cur = Path(path), read(path)
    cur.pop(key, None)
    if hidden:
        cur[key] = {"sig": sig, "name": name, "at": int(time.time())}
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f.name + ".tmp")
    tmp.write_text(json.dumps(dict(list(cur.items())[-KEEP:]), ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)
