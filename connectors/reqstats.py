"""Request counters per connector and per route, in memory, for the debugging block of Settings > Connectors and Network > Diagnostic
(development builds only): calls over the last minute, the last hour and in all, last and mean duration, last HTTP code, 429 answers
and their Retry-After, last error; readings served by a cache without any call. Reset at restart, never written to disk.

A route is the path of the URL without its query, an address at the end of ip-details replaced by « * », and the `mode` parameter
kept for top-traffic (MynetworK limits its « live » mode on its own).
"""
from __future__ import annotations

import threading
import time
from collections import deque
from urllib.parse import parse_qs, urlsplit

MINUTE, HOUR = 60.0, 3600.0
MAX_ROUTES = 300   # rows kept in all: beyond, the oldest untouched row goes
KEEP = 600         # call times kept per route: enough for the hour window of a route called every few seconds
GROUPED = ("/api/search/ip-details/",)   # the address at the end is not part of the route
MODE_ROUTES = ("/api/plugins/unifi/top-traffic",)   # the mode parameter makes a route of its own

# Limits per minute and per token known on the services (MynetworK, 2026-10-19): a route near its limit is shown « to watch »
ROUTE_LIMITS = {"mynetwork": {"/api/search/ip-details/*": 30, "/api/plugins/unifi/top-traffic?mode=live": 30}}
TOTAL_LIMITS = {"mynetwork": 300}
NEAR = 0.8   # share of a limit from which a route is to watch

_lock = threading.Lock()
_rows: dict[tuple[str, str], dict] = {}


def route_of(url: str) -> str:
    """The route a URL counts under: path without the query, grouped address, `mode` kept where it matters."""
    u = urlsplit(url)
    path = u.path
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
    with _lock:
        row = _row(owner or "?", route_of(url))
        row["times"].append(now)
        row["total"] += 1
        row["ms_sum"] += ms
        row.update(last_ms=round(ms), last_code=code, last_at=now, last_error=(error or "")[:200])
        if code == 429:
            row["n429"] += 1
            row["retry_after"] = retry_after


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


def snapshot(now: float | None = None) -> dict:
    """{"rows": [...], "watch": [...]}: one row per connector and route, and what is to watch (a route near or over a known limit,
    a 429 received during the last hour, a connector near its total limit)."""
    now = time.time() if now is None else now
    rows, watch, per_owner = [], [], {}
    with _lock:
        for (owner, route), r in sorted(_rows.items()):
            per_min, per_hour = _count(r["times"], now - MINUTE), _count(r["times"], now - HOUR)
            limit = ROUTE_LIMITS.get(_type_of(owner), {}).get(route)
            recent_429 = r["n429"] > 0 and r["last_code"] == 429 and r["last_at"] is not None and now - r["last_at"] < HOUR
            row = {"owner": owner, "route": route, "per_min": per_min, "per_hour": per_hour, "total": r["total"], "hits": r["hits"],
                   "last_ms": r["last_ms"], "avg_ms": round(r["ms_sum"] / r["total"]) if r["total"] else None, "last_code": r["last_code"],
                   "n429": r["n429"], "retry_after": r["retry_after"], "last_error": r["last_error"], "last_at": r["last_at"], "limit": limit,
                   "watch": bool((limit and per_min >= NEAR * limit) or recent_429)}
            rows.append(row)
            if not route.startswith("cache:"):
                per_owner[owner] = per_owner.get(owner, 0) + per_min
            if row["watch"]:
                watch.append({"owner": owner, "route": route, "per_min": per_min, "limit": limit, "n429": r["n429"] if recent_429 else 0,
                              "retry_after": r["retry_after"] if recent_429 else None})
    for owner, n in per_owner.items():
        total = TOTAL_LIMITS.get(_type_of(owner))
        if total and n >= NEAR * total:
            watch.append({"owner": owner, "route": "*", "per_min": n, "limit": total, "n429": 0, "retry_after": None})
    return {"rows": rows, "watch": watch, "at": now}


def reset() -> None:
    with _lock:
        _rows.clear()
