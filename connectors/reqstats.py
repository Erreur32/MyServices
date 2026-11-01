"""Request counters per connector and per route, in memory, for the debugging block of Settings > Connectors and Network > Diagnostic
(development builds only): calls over the last minute, the last hour and in all, last and mean duration, last HTTP code, 429 answers
and their Retry-After, last error; readings served by a cache without any call. Reset at restart, never written to disk.

A route is the path of the URL without its query, an address at the end of ip-details replaced by « * », and the `mode` parameter
kept for top-traffic (MynetworK limits its « live » mode on its own).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import deque
from urllib.parse import parse_qs, urlsplit

MINUTE, HOUR = 60.0, 3600.0
MAX_ROUTES = 1000   # rows kept in all: beyond, the oldest untouched row goes
KEEP = 600         # call times kept per route: enough for the hour window of a route called every few seconds
KEY_IN_PATH = re.compile(r"/[A-Za-z0-9_-]{20,}(?=/|$)")
GROUPED = ("/api/search/ip-details/",)   # the address at the end is not part of the route
MODE_ROUTES = ("/api/plugins/unifi/top-traffic",)   # the mode parameter makes a route of its own

# Limits per minute and per token known on the services (MynetworK, 2026-10-19): a route near its limit is shown « to watch »
ROUTE_LIMITS = {"mynetwork": {"/api/search/ip-details/*": 30, "/api/plugins/unifi/top-traffic?mode=live": 30}}
TOTAL_LIMITS = {"mynetwork": 300}
NEAR = 0.8   # share of a limit from which a route is to watch

SPOOL_ENV = "MYSERVICES_REQ_SPOOL"   # set on a task's process: it dies with its counters, so its calls go to this file for the server (drain)

_lock = threading.Lock()
_drain_lock = threading.Lock()
_rows: dict[tuple[str, str], dict] = {}


def route_of(url: str) -> str:
    """The route a URL counts under: path without the query, grouped address, `mode` kept where it matters."""
    u = urlsplit(url)
    path = KEY_IN_PATH.sub("/*", u.path)   # a key in the path (Shinobi: /<api key>/monitor/<group>) never reaches the counters
    for prefix in GROUPED:
        if path.startswith(prefix):
            path = prefix + "*"
    if path in MODE_ROUTES:
        mode = (parse_qs(u.query).get("mode") or [""])[0]
        if mode:
            path += f"?mode={mode}"
    return path


def _row(owner: str, route: str) -> dict:
    key = (owner, route)
    row = _rows.get(key)
    if row is None:
        if len(_rows) >= MAX_ROUTES:
            oldest = min(_rows, key=lambda k: _rows[k]["last_at"] or 0)
            del _rows[oldest]
        row = _rows[key] = {"times": deque(maxlen=KEEP), "total": 0, "ms_sum": 0.0, "last_ms": None, "last_code": None, "n429": 0,
                            "retry_after": None, "last_error": "", "last_at": None, "hits": 0}
    return row


def record(owner: str, url: str, ms: float, code: int | None, error: str = "", retry_after: float | None = None, now: float | None = None) -> None:
    """One call made: its duration, HTTP code (None: no answer), error text and, on a 429, the delay the service asked for."""
    now = time.time() if now is None else now
    if spool := os.environ.get(SPOOL_ENV):
        _to_spool(spool, [owner, route_of(url), ms, code, (error or "")[:200], retry_after, now])
        return
    with _lock:
        row = _row(owner or "?", route_of(url))
        row["times"].append(now)
        row["total"] += 1
        row["ms_sum"] += ms
        row.update(last_ms=round(ms), last_code=code, last_at=now, last_error=(error or "")[:200])
        if code == 429:
            row["n429"] += 1
            row["retry_after"] = retry_after


def _to_spool(path: str, call: list) -> None:
    try:
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, (json.dumps(call) + "\n").encode())   # one write in append mode: lines of parallel calls never mix
        finally:
            os.close(fd)
    except OSError:
        pass   # a counter is never worth failing a read


def drain(path: str) -> None:
    """Adds the calls a task wrote to its file to the counters of this process, with their own dates. Called when a task ends, which bounds the file."""
    taken = f"{path}.reading"
    with _drain_lock:
        try:
            os.replace(path, taken)
            with open(taken, encoding="utf-8") as f:
                lines = f.readlines()
            os.unlink(taken)
        except OSError:
            return
    for line in lines:
        try:
            record(*json.loads(line))
        except (ValueError, TypeError):
            continue   # a line cut short by a killed task


def hit(owner: str, what: str) -> None:
    """One reading served by a cache instead of a call (counted on a « cache: » route of its own)."""
    with _lock:
        row = _row(owner or "?", f"cache:{what}")
        row["hits"] += 1
        row["last_at"] = time.time()


def _count(times: deque, since: float) -> int:
    return sum(1 for t in times if t >= since)


def _type_of(owner: str) -> str:
    return owner.split("/", 1)[0]


def _row_out(owner: str, route: str, r: dict, now: float) -> tuple[dict, dict | None]:
    """(row, watch entry or None): the row of one route as the page shows it; to watch when near or over its known limit, or after a 429
    in the last hour."""
    per_min = _count(r["times"], now - MINUTE)
    limit = ROUTE_LIMITS.get(_type_of(owner), {}).get(route)
    recent_429 = r["n429"] > 0 and r["last_code"] == 429 and r["last_at"] is not None and now - r["last_at"] < HOUR
    watch = bool((limit and per_min >= NEAR * limit) or recent_429)
    row = {"owner": owner, "route": route, "per_min": per_min, "per_hour": _count(r["times"], now - HOUR), "total": r["total"], "hits": r["hits"],
           "last_ms": r["last_ms"], "avg_ms": round(r["ms_sum"] / r["total"]) if r["total"] else None, "last_code": r["last_code"],
           "n429": r["n429"], "retry_after": r["retry_after"], "last_error": r["last_error"], "last_at": r["last_at"], "limit": limit, "watch": watch}
    if not watch:
        return row, None
    n429, retry_after = (r["n429"], r["retry_after"]) if recent_429 else (0, None)
    return row, {"owner": owner, "route": route, "per_min": per_min, "limit": limit, "n429": n429, "retry_after": retry_after}


def _totals_watch(per_owner: dict[str, int]) -> list[dict]:
    """The connectors near the total limit of their service (every route together)."""
    out = []
    for owner, n in per_owner.items():
        total = TOTAL_LIMITS.get(_type_of(owner))
        if total and n >= NEAR * total:
            out.append({"owner": owner, "route": "*", "per_min": n, "limit": total, "n429": 0, "retry_after": None})
    return out


def snapshot(now: float | None = None) -> dict:
    """{"rows": [...], "watch": [...]}: one row per connector and route, and what is to watch (a route near or over a known limit,
    a 429 received during the last hour, a connector near its total limit)."""
    now = time.time() if now is None else now
    rows, watch, per_owner = [], [], {}
    with _lock:
        for (owner, route), r in sorted(_rows.items()):
            row, entry = _row_out(owner, route, r, now)
            rows.append(row)
            if not route.startswith("cache:"):
                per_owner[owner] = per_owner.get(owner, 0) + row["per_min"]
            if entry:
                watch.append(entry)
    return {"rows": rows, "watch": watch + _totals_watch(per_owner), "at": now}


def reset() -> None:
    with _lock:
        _rows.clear()
