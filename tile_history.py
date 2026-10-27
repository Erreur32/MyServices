"""History of the figures shown in the tiles of a page that the other histories do not keep, in SQLite (/data/myservices.db).

The health of the machines (how many read machines are fully healthy, out of how many were read), taken from health/stats.json
after each health pass, with the same rule as the « Health » tile of the Machines page; and the figures of the Network tiles (equipment
online, clients, devices online), taken from data.json after each collection with the same merge as the page. One point every MIN_GAP s at most, kept for
KEEP_S (7 days: the longest period a tile can draw). Reachability is not stored here: availability.py already keeps it.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

KEEP_S = 7 * 24 * 3600
MIN_GAP = 540
HEALTH = "machines.health"
NET_GEAR, NET_CLIENTS, NET_DEVICES = "network.gear", "network.clients", "network.devices"
NETWORK = (NET_GEAR, NET_CLIENTS, NET_DEVICES)

SCHEMA = """
CREATE TABLE IF NOT EXISTS tile_samples (key TEXT NOT NULL, ts INTEGER NOT NULL, value INTEGER NOT NULL, total INTEGER NOT NULL,
  PRIMARY KEY (key, ts)) WITHOUT ROWID;
"""


@contextmanager
def _db(path: str | Path):
    db = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    try:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript(SCHEMA)
        yield db
    finally:
        db.close()


def health_point(stats: dict) -> tuple[int, int, int] | None:
    """(time, healthy machines, machines read) of stats.json; None without a readable time or without any machine read."""
    try:
        ts = int(datetime.fromisoformat(str(stats.get("timestamp"))).timestamp())
    except ValueError:
        return None
    read = [h for h in stats.get("hosts") or [] if isinstance(h, dict) and h.get("level") not in (None, "na")]
    if not read:
        return None
    return ts, sum(1 for h in read if h.get("reachable") is not False and h.get("level") == "ok"), len(read)


def sample(db_path: str | Path, stats_file: Path, now: float | None = None) -> int:
    """The health point of stats_file when it is new enough to add; how many were added (0 or 1). Missing or unreadable file: 0."""
    try:
        pt = health_point(json.loads(stats_file.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return 0
    return store(db_path, HEALTH, pt, now) if pt else 0


def _gear_up(g: dict) -> bool:
    if g.get("online") is not None:
        return bool(g["online"])
    return not re.search(r"offline|disconnect|interrupt|isolat", str(g.get("state") or "online"), re.I)


def network_points(data: dict) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the Network tiles from data.json: equipment online / equipment, clients (wifi + wired, same count as total),
    devices online / devices. UniFi lists of MynetworK then of the UniFi connector are merged by MAC (the later one fresher), like the page.
    A figure the sources do not give is left out."""
    net = [c for c in data.get("network") or [] if isinstance(c, dict)]
    lists = [(str(c.get("label")), c.get("unifi")) for c in net]
    lists += [(str(c.get("label")), c.get("unifi")) for c in data.get("services_status") or [] if isinstance(c, dict) and c.get("connector") == "unifi"]
    gear: dict[str, dict] = {}
    clients: dict[str, dict] = {}
    for source, u in lists:
        if not isinstance(u, dict):
            continue
        for d in u.get("devices") or []:
            k = str(d.get("mac") or "").lower() or f"{source}/{d.get('name')}"
            gear[k] = {**gear.get(k, {}), **d}
        for c in u.get("clients") or []:
            k = str(c.get("mac") or "").lower() or f"{c.get('ip')}/{c.get('name')}"
            clients[k] = {**clients.get(k, {}), **c}
    out: dict[str, tuple[int, int]] = {}
    if gear:
        out[NET_GEAR] = (sum(1 for g in gear.values() if _gear_up(g)), len(gear))
    if clients:
        out[NET_CLIENTS] = (len(clients), len(clients))
    devices = [d for c in net for d in c.get("devices") or [] if isinstance(d, dict)]
    if devices:
        out[NET_DEVICES] = (sum(1 for d in devices if d.get("status") == "online"), len(devices))
    return out


def sample_network(db_path: str | Path, data_file: Path, now: float | None = None) -> int:
    """The Network points of data.json (read at its own time) when new enough to add; how many were added. Missing or unreadable file: 0."""
    try:
        data = json.loads(data_file.read_text(encoding="utf-8"))
        ts = int(datetime.fromisoformat(str(data.get("generated"))).timestamp())
    except (OSError, ValueError):
        return 0
    return sum(store(db_path, key, (ts, *vt), now) for key, vt in network_points(data).items())


def store(db_path: str | Path, key: str, pt: tuple[int, int, int], now: float | None = None) -> int:
    """One point (time, value, total) unless the key has one less than MIN_GAP s older; purges what is past KEEP_S."""
    ts, value, total = pt
    oldest = int((now or time.time()) - KEEP_S)
    with _db(db_path) as db:
        db.execute("DELETE FROM tile_samples WHERE ts < ?", (oldest,))
        last = db.execute("SELECT MAX(ts) FROM tile_samples WHERE key = ?", (key,)).fetchone()[0]
        if ts < oldest or (last is not None and ts < last + MIN_GAP):
            return 0
        return db.execute("INSERT OR IGNORE INTO tile_samples (key, ts, value, total) VALUES (?, ?, ?, ?)", (key, ts, value, total)).rowcount


def series(db_path: str | Path, key: str, hours: int, now: float | None = None) -> list[list[int]]:
    """[[time, value, total], ...] of the last `hours`, oldest first."""
    with _db(db_path) as db:
        rows = db.execute("SELECT ts, value, total FROM tile_samples WHERE key = ? AND ts >= ? ORDER BY ts",
                          (key, int((now or time.time()) - hours * 3600))).fetchall()
    return [list(r) for r in rows]
