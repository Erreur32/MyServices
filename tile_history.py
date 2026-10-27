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
BACKUPS_OK, BACKUPS_LATE, BACKUPS_BAD = "backups.ok", "backups.late", "backups.bad"
BACKUPS = (BACKUPS_OK, BACKUPS_LATE, BACKUPS_BAD)
SERVICES_WARN = "services.warn"

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


def _merge_unifi(lists: list[tuple[str, object]]) -> tuple[dict[str, dict], dict[str, dict]]:
    """The UniFi equipment and clients of several sources merged by MAC (the later source wins field by field)."""
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
    return gear, clients


def network_points(data: dict) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the Network tiles from data.json: equipment online / equipment, clients (wifi + wired, same count as total),
    devices online / devices. UniFi lists of MynetworK then of the UniFi connector are merged by MAC (the later one fresher), like the page.
    A figure the sources do not give is left out."""
    net = [c for c in data.get("network") or [] if isinstance(c, dict)]
    lists = [(str(c.get("label")), c.get("unifi")) for c in net]
    lists += [(str(c.get("label")), c.get("unifi")) for c in data.get("services_status") or [] if isinstance(c, dict) and c.get("connector") == "unifi"]
    gear, clients = _merge_unifi(lists)
    out: dict[str, tuple[int, int]] = {}
    if gear:
        out[NET_GEAR] = (sum(1 for g in gear.values() if _gear_up(g)), len(gear))
    if clients:
        out[NET_CLIENTS] = (len(clients), len(clients))
    devices = [d for c in net for d in c.get("devices") or [] if isinstance(d, dict)]
    if devices:
        out[NET_DEVICES] = (sum(1 for d in devices if d.get("status") == "online"), len(devices))
    return out


def _service_warns(h: dict) -> bool | None:
    """True when a service of data.json is « to watch » (front lib/status.ts, class warn), False when it is in another state, None when it is not
    followed (paused, machine or container stopped on purpose, disabled, listening on an internal address only)."""
    p, b = h.get("public") or {}, h.get("backend") or {}
    kind = h.get("type")
    if h.get("paused") or h.get("machine_off") or h.get("stopped") or not h.get("enabled"):
        return None
    if kind == "dead":
        return p.get("code") != 404
    if kind == "stream":
        return False
    if kind == "redirect":
        return bool(p.get("code")) and (h.get("follow") or {}).get("code", 0) >= 500
    if kind == "local":
        return None if b.get("internal") and not b.get("up") else False
    if b.get("internal") or b.get("up") is False or (p.get("code") or 0) >= 500:
        return False
    if p.get("err") == "RemoteDisconnected":
        return not h.get("closes_root")
    return bool(p.get("err"))


def services_points(data: dict) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the Services « Warning » tile: the services followed that are not in warning, out of the services followed
    (so a strip counts the ones in warning). The services the user hid from « To watch » are counted like the others."""
    states = [w for h in data.get("hosts") or [] if isinstance(h, dict) and (w := _service_warns(h)) is not None]
    return {SERVICES_WARN: (states.count(False), len(states))} if states else {}


def sample_services(db_path: str | Path, data_file: Path, now: float | None = None) -> int:
    """The Services tile point of data.json (read at its own time) when new enough to add; how many were added."""
    try:
        data = json.loads(data_file.read_text(encoding="utf-8"))
        ts = int(datetime.fromisoformat(str(data.get("generated"))).timestamp())
    except (OSError, ValueError):
        return 0
    return sum(store(db_path, key, (ts, *vt), now) for key, vt in services_points(data).items())


def backups_points(data: dict) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the Backups tiles from backups.json, counted like the page: the sets not archived; « up to date » as the value of
    its key, « late » and « missing or failing » as the sets that are not (so a strip counts the missing ones, like the Machines tiles)."""
    live = [s for s in data.get("sets") or [] if isinstance(s, dict) and not s.get("archived")]
    if not live:
        return {}
    n = len(live)
    late = sum(1 for s in live if s.get("level") == "warn")
    bad = sum(1 for s in live if s.get("level") in ("crit", "down"))
    return {BACKUPS_OK: (sum(1 for s in live if s.get("level") == "ok"), n), BACKUPS_LATE: (n - late, n), BACKUPS_BAD: (n - bad, n)}


def sample_backups(db_path: str | Path, backups_file: Path, now: float | None = None) -> int:
    """The state of the backups as of now (backups.json is written a few times a day, the tiles want a point at each collection)."""
    now = now or time.time()
    try:
        points = backups_points(json.loads(backups_file.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return 0
    return sum(store(db_path, key, (int(now), *vt), now) for key, vt in points.items())


def sample_network(db_path: str | Path, data_file: Path, now: float | None = None) -> int:
    """The Network points of data.json (read at its own time) when new enough to add; how many were added. Missing or unreadable file: 0."""
    try:
        data = json.loads(data_file.read_text(encoding="utf-8"))
        ts = int(datetime.fromisoformat(str(data.get("generated"))).timestamp())
    except (OSError, ValueError):
        return 0
    return sum(store(db_path, key, (ts, *vt), now) for key, vt in network_points(data).items())


def store(db_path: str | Path, key: str, pt: tuple[int, int, int], now: float | None = None, gap: int = MIN_GAP) -> int:
    """One point (time, value, total) unless the key has one less than `gap` s older; purges what is past KEEP_S."""
    ts, value, total = pt
    oldest = int((now or time.time()) - KEEP_S)
    with _db(db_path) as db:
        db.execute("DELETE FROM tile_samples WHERE ts < ?", (oldest,))
        last = db.execute("SELECT MAX(ts) FROM tile_samples WHERE key = ?", (key,)).fetchone()[0]
        if ts < oldest or (last is not None and ts < last + gap):
            return 0
        return db.execute("INSERT OR IGNORE INTO tile_samples (key, ts, value, total) VALUES (?, ?, ?, ?)", (key, ts, value, total)).rowcount


def series(db_path: str | Path, key: str, hours: int, now: float | None = None) -> list[list[int]]:
    """[[time, value, total], ...] of the last `hours`, oldest first."""
    with _db(db_path) as db:
        rows = db.execute("SELECT ts, value, total FROM tile_samples WHERE key = ? AND ts >= ? ORDER BY ts",
                          (key, int((now or time.time()) - hours * 3600))).fetchall()
    return [list(r) for r in rows]
