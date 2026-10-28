"""The last 24 hours of each machine's figures (processor, memory, fullest disk, temperature), in SQLite (/data/myservices.db).

After each health pass, sample() reads health/stats.json and stores one point per machine read since its last point: the key is the
machine's IP (« Name · IP » in stats.json), the time is the host's own `read_at` (a pass of « --only <ip> » leaves the other machines
with their old time, so they get no new point). One point every MIN_GAP s at most (an agent reports every minute): about 360 points
a machine a day. A machine read over SSH first that also has an agent keeps its SSH health, but each agent report still gives a
point (health.py, agent_figures()). Points older than KEEP_S are purged at each store(). The machine page draws them as small curves in its tiles.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

KEEP_S = 7 * 24 * 3600   # the longest period of a tile of the Machines page
CURVE_S = 24 * 3600   # what the small curves of a machine page draw
BUCKET_S = 600
MIN_GAP = 240
FIELDS = ("cpu", "mem", "disk", "temp")

SCHEMA = """
CREATE TABLE IF NOT EXISTS metric_samples (machine TEXT NOT NULL, ts INTEGER NOT NULL, cpu REAL, mem REAL, disk REAL, temp REAL,
  PRIMARY KEY (machine, ts)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS metric_samples_ts ON metric_samples(ts);
"""


@contextmanager
def _db(path: str | Path):
    db = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript(SCHEMA)
        yield db
    finally:
        db.close()


def _num(v) -> float | None:
    return round(float(v), 1) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def figures(h: dict) -> dict:
    """The four figures of a host of stats.json, as the machine page shows them (None: not reported)."""
    res, load, temp = h.get("res") or {}, h.get("load") or {}, h.get("temp") or {}
    cpu = res.get("cpu_pct") if res.get("cpu_pct") is not None else load.get("cpu_pct")
    disks = [v for d in h.get("disks") or [] if isinstance(d, dict) and (v := _num(d.get("used_pct"))) is not None]
    return {"cpu": _num(cpu), "mem": _num(res.get("mem_pct")), "disk": max(disks) if disks else None,
            "temp": _num(temp.get("celsius")) if temp.get("available") else None}


def points(stats: dict) -> list[dict]:
    """What to store from stats.json: [{machine, ts, cpu, mem, disk, temp}] for the hosts read, reachable and reporting something."""
    out = []
    for h in stats.get("hosts") or []:
        ip = str(h.get("name") or "").rpartition(" · ")[2]
        try:
            ts = int(datetime.fromisoformat(str(h.get("read_at"))).timestamp())
        except ValueError:
            continue   # stats.json written before read_at existed
        f = figures(h)
        if ip and h.get("reachable") and any(v is not None for v in f.values()):
            out.append({"machine": ip, "ts": ts, **f})
    return out


def sample(db_path: str | Path, stats_file: Path, now: float | None = None) -> int:
    """Points of stats_file not stored yet; how many were added. Missing or unreadable file: 0."""
    try:
        stats = json.loads(stats_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    return store(db_path, points(stats), now)


def store(db_path: str | Path, pts: list[dict], now: float | None = None) -> int:
    """Points not stored yet (and not within MIN_GAP s of the machine's last one); how many were added. Purges what is past KEEP_S."""
    oldest = int((now or time.time()) - KEEP_S)
    n = 0
    with _db(db_path) as db:
        db.execute("DELETE FROM metric_samples WHERE ts < ?", (oldest,))
        for p in pts:
            last = db.execute("SELECT MAX(ts) FROM metric_samples WHERE machine = ?", (p["machine"],)).fetchone()[0]
            if p["ts"] < oldest or (last is not None and p["ts"] < last + MIN_GAP):
                continue
            db.execute("INSERT OR IGNORE INTO metric_samples (machine, ts, cpu, mem, disk, temp) VALUES (?, ?, ?, ?, ?, ?)",
                       (p["machine"], p["ts"], *(p[k] for k in FIELDS)))
            n += 1
    return n


def series(db_path: str | Path, machine: str, now: float | None = None) -> dict:
    """The last 24 hours of a machine: {"points": [[ts, cpu, mem, disk, temp], ...]} oldest first."""
    with _db(db_path) as db:
        rows = db.execute("SELECT ts, cpu, mem, disk, temp FROM metric_samples WHERE machine = ? AND ts >= ? ORDER BY ts",
                          (machine, int((now or time.time()) - CURVE_S))).fetchall()
    return {"points": [list(r) for r in rows]}


def average(db_path: str | Path, field: str, hours: int, now: float | None = None) -> list[list[int]]:
    """[[time, average %, machines], ...] of one figure (cpu or mem) over the last `hours`, one point per BUCKET_S, oldest first
    (the Processor and Memory tiles of the Machines page)."""
    if field not in ("cpu", "mem"):
        raise ValueError(field)
    with _db(db_path) as db:
        rows = db.execute(f"SELECT ts / ? * ?, ROUND(AVG({field})), COUNT(DISTINCT machine) FROM metric_samples WHERE {field} IS NOT NULL AND ts >= ? "
                          "GROUP BY 1 ORDER BY 1", (BUCKET_S, BUCKET_S, int((now or time.time()) - hours * 3600))).fetchall()
    return [[int(t), int(v), int(n)] for t, v, n in rows]
