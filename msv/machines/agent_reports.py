"""Last reports of the agents, read from the accounts database. Standalone (no reader, no health module), so that both the
agents module and the health module can use it without importing each other."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

DEFAULT_INTERVAL = 900    # s : 15 min
FRESH_MULT = 2.5          # un relevé plus vieux que 2,5 × l'intervalle est périmé


def fresh_output(ip: object, key: str) -> str | None:
    """What a fresh report of the agent of this address sent under this key, when it worked; None otherwise."""
    from msv.core.auth import db_path
    from msv.core.config import CFG
    try:
        rep = fresh_reports(db_path(CFG)).get(str(ip)) or {}
    except (OSError, ValueError, sqlite3.Error):
        return None
    got = (((rep.get("report") or {}).get("data") or {}).get("cmds") or {}).get(key) if rep.get("fresh") else None
    return got[1] if isinstance(got, list) and len(got) == 2 and got[0] == 0 else None


def fresh_reports(path: str | Path) -> dict[str, dict]:
    """{IP: {"report": relevé, "seen": date, "fresh": bool}} pour les agents actifs ayant déjà envoyé un relevé."""
    out, now = {}, time.time()
    db = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    try:
        db.row_factory = sqlite3.Row
        rows = db.execute("SELECT * FROM agents WHERE revoked IS NULL ORDER BY created").fetchall()
    finally:
        db.close()
    for r in rows:
        out[r["ip"]] = {"report": json.loads(r["report"]) if r["report"] else None, "seen": r["last_seen"],
                        "fresh": bool(r["last_seen"] and now - r["last_seen"] <= FRESH_MULT * (r["interval"] or DEFAULT_INTERVAL))}
    return out
