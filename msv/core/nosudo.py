"""Sudo refused over SSH, remembered per machine (SSH alias) and per read: a refused sudo is logged, and mailed by sudo (mail_no_user,
mail_badpass) at every try, so a read refused is not asked again before RETRY_S. « Relire » of one machine asks again at once (FORCE).

Shared by every collection that runs `sudo -n` over SSH: health (needrestart, fail2ban, SMART), backups (root crontab), ports (ss), AdGuard."""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

from msv.core.config import CFG

RETRY_S = 24 * 3600
FORCE = False            # set by a pass asked for one machine: its sudo reads are tried again
_lock = threading.Lock()


def _path() -> Path:
    return Path(CFG["state_dir"]) / "nosudo.json"


def _load() -> dict:
    try:
        data = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def skipped(alias: str | None, what: str, now: float | None = None) -> bool:
    """True when `what` was refused on this machine less than RETRY_S ago: run it without sudo."""
    if FORCE or not alias:
        return False
    t = (_load().get(alias) or {}).get(what)
    return isinstance(t, (int, float)) and (now or time.time()) - t < RETRY_S


def record(alias: str | None, what: str, refused: bool, now: float | None = None) -> None:
    """After a real try: a refusal is dated, a success forgets it."""
    if not alias:
        return
    # shortcut: two collections writing at the same moment can lose one entry, that read is then simply asked once more
    with _lock:
        data = _load()
        cur = data.get(alias) if isinstance(data.get(alias), dict) else {}
        if refused:
            cur[what] = now or time.time()
        elif what in cur:
            del cur[what]
        else:
            return
        if cur:
            data[alias] = cur
        else:
            data.pop(alias, None)
        path = _path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
            os.replace(tmp, path)
        except OSError:
            pass   # not kept: the read is asked again next pass, as before
