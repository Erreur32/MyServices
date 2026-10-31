"""Availability over time (Historique → Disponibilité), in SQLite (/data/myservices.db).

After each collection, sample() reads the published data.json and stores one point per thing watched:
  svc:<type>:<id>     a service (NPM host or local service): backend answers, and its response time
  machine:<ip>        a followed machine: answers the ping
  kuma:<inst>:<name>  an Uptime Kuma monitor: up, and its response time
Things switched off on purpose (disabled host, paused, machine off, Kuma maintenance or pending) are not sampled: they would
count as downtime. Two tables keep the size small:
  avail_samples  one row per thing and collection, kept SAMPLE_DAYS days (the last day in detail, the hour strip)
  avail_days     one row per thing and day (points, points up, sum of response times), kept DAY_DAYS days (stats, day strip)
avail_items gives each key its label, kind and machine. Older rows are purged at each sample().

The pulses (pulse.py: machine ping every 30 s, service port every minute) add a third table, with no extra request: record() keeps, for what
they follow, runs of the same state { key, first and last pulse seen, up }. A healthy thing is one row that grows; a new row only appears when
its state changes (or after a hole longer than `gap`), so an outage of a minute is a row of a minute and the table stays small (a few rows per
thing and per day at most, kept DAY_DAYS days). report() reads a cell from the runs where they cover it, from the collections elsewhere.
"""
from __future__ import annotations

import json
import sqlite3
import time
from bisect import bisect_right
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

SAMPLE_DAYS = 14
DAY_DAYS = 365
QUARTER = 900   # s: a cell of the 24 h view; also what one collection stands for in a mix (shortcut: the default 15 minutes, read the setting if it matters)

SCHEMA = """
CREATE TABLE IF NOT EXISTS avail_items (key TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT, machine TEXT, target TEXT, seen REAL NOT NULL);
CREATE TABLE IF NOT EXISTS avail_samples (key TEXT NOT NULL, ts INTEGER NOT NULL, up INTEGER NOT NULL, ms INTEGER,
  PRIMARY KEY (key, ts)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS avail_samples_ts ON avail_samples(ts);
CREATE TABLE IF NOT EXISTS avail_days (key TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, up INTEGER NOT NULL,
  ms_sum INTEGER NOT NULL DEFAULT 0, ms_n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, day)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS avail_runs (key TEXT NOT NULL, t0 INTEGER NOT NULL, t1 INTEGER NOT NULL, up INTEGER NOT NULL, PRIMARY KEY (key, t0)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS avail_runs_t1 ON avail_runs(t1);
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


def points(data: dict) -> list[dict]:
    """What to sample in data.json: [{key, kind, label, machine, target, up, ms}]."""
    out = []
    off = {m["ip"] for m in data.get("machine_list") or [] if m.get("off") or m.get("disabled") or not m.get("ping")}
    for r in data.get("hosts") or []:
        b = r.get("backend") or {}
        if not r.get("enabled", True) or r.get("paused") or r.get("machine_off") or r.get("stopped") or b.get("up") is None or r.get("type") in ("redirect", "dead"):
            continue
        if not b.get("up") and (r.get("host_ip") or r.get("ip")) in off:
            continue   # its machine is down or off: the machine's own line already says it
        name = (r.get("domains") or [None])[0] or (r.get("service") or {}).get("name") or r.get("name") or f'{r["type"]} {r["id"]}'
        out.append({"key": f'svc:{r["type"]}:{r["id"]}', "kind": "service", "label": name, "machine": r.get("machine"),
                    "target": f'{r.get("ip")}:{r.get("port")}' if r.get("ip") and r.get("port") else None, "up": bool(b["up"]), "ms": b.get("ms")})
    for m in data.get("machine_list") or []:
        if m.get("off") or m.get("disabled"):
            continue
        out.append({"key": f'machine:{m["ip"]}', "kind": "machine", "label": m.get("name") or m["ip"], "machine": m.get("name"),
                    "target": m["ip"], "up": bool(m.get("ping")), "ms": None})
    seen = set()
    for r in data.get("hosts") or []:
        for u in r.get("uptime") or []:
            k = f'kuma:{u.get("instance")}:{u.get("name")}'
            if k in seen or u.get("stale") or u.get("status") not in ("up", "down"):
                continue
            seen.add(k)
            out.append({"key": k, "kind": "kuma", "label": u.get("name"), "machine": r.get("machine"), "target": (r.get("domains") or [None])[0],
                        "up": u["status"] == "up", "ms": u.get("response_ms")})
    return out


def sample(db_path: str | Path, data_file: Path, now: float | None = None) -> int:
    """Points of the current data.json stored once (the same collection read twice adds nothing). Returns the number added."""
    try:
        data = json.loads(data_file.read_text(encoding="utf-8"))
        ts = int(datetime.fromisoformat(data["generated"]).timestamp())
    except (OSError, ValueError, KeyError, TypeError):
        return 0
    now = now or time.time()
    day = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    n = 0
    with _db(db_path) as db:
        db.execute("BEGIN")
        for p in points(data):
            ms = int(p["ms"]) if isinstance(p["ms"], (int, float)) and not isinstance(p["ms"], bool) else None
            if not db.execute("INSERT OR IGNORE INTO avail_samples (key, ts, up, ms) VALUES (?, ?, ?, ?)", (p["key"], ts, int(p["up"]), ms)).rowcount:
                continue
            n += 1
            db.execute("INSERT INTO avail_days (key, day, n, up, ms_sum, ms_n) VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT (key, day) DO UPDATE SET "
                       "n = n + 1, up = up + excluded.up, ms_sum = ms_sum + excluded.ms_sum, ms_n = ms_n + excluded.ms_n",
                       (p["key"], day, int(p["up"]), ms or 0, int(ms is not None)))
            db.execute("INSERT INTO avail_items (key, kind, label, machine, target, seen) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET "
                       "kind = excluded.kind, label = excluded.label, machine = excluded.machine, target = excluded.target, seen = excluded.seen",
                       (p["key"], p["kind"], p["label"], p["machine"], p["target"], ts))
        db.execute("DELETE FROM avail_samples WHERE ts < ?", (now - SAMPLE_DAYS * 86400,))
        old_day = datetime.fromtimestamp(now - DAY_DAYS * 86400).strftime("%Y-%m-%d")
        db.execute("DELETE FROM avail_days WHERE day < ?", (old_day,))
        db.execute("DELETE FROM avail_items WHERE seen < ?", (now - DAY_DAYS * 86400,))
        db.execute("COMMIT")
    return n


def record(db_path: str | Path, states: dict[str, tuple[bool, float | None]], now: float, gap: float) -> None:
    """What the pulses know right now, {key: (confirmed state, when it began)}: the last run of the key grows while its state holds and the hole
    since its last pulse is at most `gap` s; else a run starts (at the first contrary pulse when the state just changed, which the pulse
    only confirmed a few seconds later)."""
    at = int(now)
    with _db(db_path) as db:
        db.execute("BEGIN")
        for key, (up, began) in states.items():
            last = db.execute("SELECT t0, t1, up FROM avail_runs WHERE key = ? ORDER BY t0 DESC LIMIT 1", (key,)).fetchone()
            joined = last is not None and at - last["t1"] <= gap
            if joined and bool(last["up"]) == up:
                db.execute("UPDATE avail_runs SET t1 = ? WHERE key = ? AND t0 = ?", (at, key, last["t0"]))
                continue
            t0 = at
            if joined:
                t0 = min(max(int(began or at), last["t0"] + 1), at)
                db.execute("UPDATE avail_runs SET t1 = ? WHERE key = ? AND t0 = ?", (t0, key, last["t0"]))
            db.execute("INSERT OR REPLACE INTO avail_runs (key, t0, t1, up) VALUES (?, ?, ?, ?)", (key, t0, at, int(up)))
        db.execute("DELETE FROM avail_runs WHERE t1 < ?", (now - DAY_DAYS * 86400,))
        db.execute("COMMIT")


def _run_cells(runs: list[tuple[int, int, int]], slots: list[int], width: int) -> dict[int, list[int]]:
    """{slot index: [seconds covered by the runs, seconds up]} for the runs (t0, t1, up) of one key; a slot lasts until the next one (`width` for the last)."""
    out: dict[int, list[int]] = {}
    for t0, t1, up in runs:
        i = max(bisect_right(slots, t0) - 1, 0)
        while i < len(slots) and slots[i] < t1:
            end = slots[i + 1] if i + 1 < len(slots) else slots[i] + width
            sec = min(t1, end) - max(t0, slots[i])
            if sec > 0:
                c = out.setdefault(i, [0, 0])
                c[0] += sec
                c[1] += sec * up
            i += 1
    return out


def report(db_path: str | Path, days: int = 30, now: float | None = None) -> dict:
    """Per thing: uptime % and mean response time over `days`, one cell per quarter of an hour (over 1 day) or per day, last state.
    Worst uptime first. Cells: {"t": start (s), "pct": 0..100 or None when nothing was sampled}. A cell the pulses' runs cover comes from
    them (to the minute), else from the collections; `samples` and `down` count readings of QUARTER s either way."""
    now = now or time.time()
    days = min(max(int(days), 1), DAY_DAYS)
    with _db(db_path) as db:
        items = {r["key"]: dict(r) for r in db.execute("SELECT key, kind, label, machine, target, seen FROM avail_items WHERE seen >= ?", (now - days * 86400,))}
        last = {r["key"]: (r["ts"], bool(r["up"])) for r in db.execute(
            "SELECT s.key, s.ts, s.up FROM avail_samples s JOIN (SELECT key, MAX(ts) AS ts FROM avail_samples GROUP BY key) m ON s.key = m.key AND s.ts = m.ts")}
        for r in db.execute("SELECT r.key, r.t1, r.up FROM avail_runs r JOIN (SELECT key, MAX(t0) AS t0 FROM avail_runs GROUP BY key) m ON r.key = m.key AND r.t0 = m.t0"):
            if r["t1"] >= (last.get(r["key"]) or (0,))[0]:   # a pulse is fresher than the last collection
                last[r["key"]] = (r["t1"], bool(r["up"]))
        if days == 1:   # a cell per quarter of an hour, from the samples
            start = int(now // QUARTER * QUARTER) - 95 * QUARTER
            rows = db.execute("SELECT key, ts / ? * ? AS t, COUNT(*) AS n, SUM(up) AS up, SUM(COALESCE(ms, 0)) AS ms_sum, COUNT(ms) AS ms_n "
                              "FROM avail_samples WHERE ts >= ? GROUP BY key, t", (QUARTER, QUARTER, start)).fetchall()
            slots, width = [start + i * QUARTER for i in range(96)], QUARTER
            cell = {(r["key"], r["t"]): r for r in rows}
        else:
            today = datetime.fromtimestamp(now).date()
            dayset = [today - timedelta(days=days - 1 - i) for i in range(days)]   # by the calendar: a change of clock makes a day of 23 or 25 hours
            rows = db.execute("SELECT key, day, n, up, ms_sum, ms_n FROM avail_days WHERE day >= ?", (dayset[0].isoformat(),)).fetchall()
            slots, width = [int(datetime(d.year, d.month, d.day).timestamp()) for d in dayset], 86400
            by_day = {datetime.fromtimestamp(s).strftime("%Y-%m-%d"): s for s in slots}
            cell = {(r["key"], by_day.get(r["day"])): r for r in rows}
        runs: dict[str, list[tuple[int, int, int]]] = {}
        for r in db.execute("SELECT key, t0, t1, up FROM avail_runs WHERE t1 >= ? ORDER BY key, t0", (slots[0],)):
            runs.setdefault(r["key"], []).append((r["t0"], r["t1"], r["up"]))
    out = []
    for key, it in items.items():
        by_run = _run_cells(runs.get(key, []), slots, width)
        cells, n, up, ms_sum, ms_n, w, w_up = [], 0, 0, 0, 0, 0, 0
        for i, s in enumerate(slots):
            r, c = cell.get((key, s)), by_run.get(i)
            if r:
                ms_sum, ms_n = ms_sum + r["ms_sum"], ms_n + r["ms_n"]
            if c:   # covered by the pulses: to the second
                cells.append({"t": s, "pct": round(100 * c[1] / c[0], 1)})
                w, w_up = w + c[0], w_up + c[1]
            else:
                cells.append({"t": s, "pct": round(100 * r["up"] / r["n"], 1) if r and r["n"] else None})
                if r:
                    w, w_up = w + r["n"] * QUARTER, w_up + r["up"] * QUARTER
            if r:
                n, up = n + r["n"], up + r["up"]
        if not w:
            continue
        if by_run:   # seconds, in readings of a quarter of an hour (an outage of a minute still counts as one down)
            samples, down, uptime = max(1, round(w / QUARTER)), -(-(w - w_up) // QUARTER), 100 * w_up / w
        else:
            samples, down, uptime = n, n - up, 100 * up / n
        lt = last.get(key)
        out.append({**it, "uptime": round(uptime, 2), "samples": samples, "down": down, "ms": round(ms_sum / ms_n) if ms_n else None,
                    "last": {"ts": lt[0], "up": lt[1]} if lt else None, "cells": cells})
    out.sort(key=lambda x: (x["uptime"], x["kind"], (x["label"] or "").lower()))
    return {"days": days, "step": "hour" if days == 1 else "day", "items": out}


def sampled_series(db_path: str | Path, prefix: str, hours: int, now: float | None = None) -> list[list[int]]:
    """[[time, items that answered, items sampled], ...] of the last `hours` for the keys starting with `prefix`, one per collection, oldest first."""
    now = now or time.time()
    with _db(db_path) as db:
        rows = db.execute("SELECT ts, SUM(up), COUNT(*) FROM avail_samples WHERE key LIKE ? AND ts >= ? GROUP BY ts ORDER BY ts",
                          (prefix + "%", int(now - min(max(int(hours), 1), SAMPLE_DAYS * 24) * 3600))).fetchall()
    return [list(r) for r in rows]


def reach_series(db_path: str | Path, hours: int, now: float | None = None) -> list[list[int]]:
    """The machines that answered per collection (the figures behind the « Reachable » and « Unreachable » tiles of the Machines page)."""
    return sampled_series(db_path, "machine:", hours, now)


def service_series(db_path: str | Path, hours: int, now: float | None = None) -> list[list[int]]:
    """The services whose backend answered per collection (the figures behind the tiles of the Services page)."""
    return sampled_series(db_path, "svc:", hours, now)
