"""Live tier: <web_dir>/live.json, the light picture the page puts over data.json between two collections, now derived from the
shared readings of the server's readers (readers.py), never from calls of its own:

  MynetworK  the scanner inventory (status, ping, open ports and the date of their last scan) from the last full reading
             + the detail sheet of each followed address (one call each, read again after `details_every` s), once MynetworK lets API
             tokens read it ; at most DETAILS_PER_PASS sheets per pass and a minute between two passes (MynetworK limits that route to
             30 calls per minute per token) ; a 429 stops the pass until the delay it asks for
  Proxmox    guests and nodes from the last reading
  Beszel     the status (up / down / paused) of each system, matched to the followed machines

Each source carries the time of its reading; the page shows a value older than its limit as such instead of as fresh.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from connectors.base import ConnectorError, RateLimited
from connectors.mynetwork import compact_sheet

PORTS_MAX_AGE = 3600   # s, a port list older than this is called old (its scan date, not the time we read it)
DETAILS_PER_PASS = 30   # ip-details calls per pass: the limit of MynetworK per minute and per token
PASS_GAP = 60   # s, between two passes of detail sheets
RETRY_DEFAULT = 60   # s, after a 429 without Retry-After


def _try(fn):
    try:
        return fn(), ""
    except ConnectorError as e:
        return None, str(e)


def refresh(cfg: dict, path: Path, followed: list[str], state: dict, insts: list, prev: dict | None = None, details_every: float = 900, now: float | None = None) -> dict:
    """Writes `path` from the shared state of `insts` (the instances the readers handle); a source that failed keeps its last reading, marked not ok."""
    now = time.time() if now is None else now
    prev = prev or {}
    sources: dict[str, dict] = {}
    for c in insts:
        key = f"{c.type}/{c.name}"
        cur = _from_state(c, cfg, state.get(key) or {}, followed, (prev.get("sources") or {}).get(key, {}), now, details_every)
        if cur is not None:
            sources[key] = cur
    doc = {"ts": now, "sources": sources}
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(doc), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass   # a convenience file: a full disk must not stop the server
    return doc


def _from_state(c, cfg: dict, entry: dict, followed: list[str], old: dict, now: float, details_every: float) -> dict | None:
    """One live entry built from the shared reading of a connector, or None for a type without a light picture or never read.
    Not ok: the last good picture stays, with the error of the last attempt."""
    if c.type not in ("mynetwork", "beszel", "proxmox") or "tried" not in entry:
        return None
    ok = bool(entry.get("ok"))
    last = entry.get("last") if ok else None
    cur = {"at": entry.get("at") or entry.get("tried"), "ok": ok, "error": "" if ok else str(entry.get("message") or "")}
    if c.type == "mynetwork":
        cur.update(_net_entry(c, last, followed, old, now, details_every))
    elif c.type == "beszel":
        cur.update(_beszel_entry(cfg, entry, last, old))
    else:
        cur.update(_guests(last) if last else {k: old.get(k, {}) for k in ("guests", "nodes")})
    return cur


def _net_entry(c, last: dict | None, followed: list[str], old: dict, now: float, details_every: float) -> dict:
    devices = (last or {}).get("devices")
    out = {"devices": {d["ip"]: {k: d.get(k) for k in ("status", "ping_ms", "ports", "ports_at")} for d in devices if d.get("ip")} if isinstance(devices, list) else old.get("devices", {})}
    out.update(_details(c, followed, old, now, details_every) if last is not None else {k: old.get(k) for k in DETAIL_KEYS})
    return out


def _beszel_entry(cfg: dict, entry: dict, last: dict | None, old: dict) -> dict:
    systems = (last or {}).get("systems")
    return {"version": entry.get("version"), "version_at": entry.get("version_at"),
            "total": len(systems) if isinstance(systems, list) else old.get("total"),
            "status": _beszel_by_ip(systems, cfg) if isinstance(systems, list) else old.get("status", {})}


def _beszel_by_ip(systems: list[dict], cfg: dict) -> dict:
    """{ip of a followed machine: {"status", "name"}} for the Beszel systems, matched the way the health reading matches them."""
    from connectors.beszel import match
    try:
        machines = json.loads(Path(cfg["meta"]).read_text(encoding="utf-8")).get("machines", {})
    except (OSError, ValueError, KeyError):
        return {}
    return {ip: {"status": s.get("status"), "name": s.get("name")} for ip, s in match(systems, machines).items()}


DETAIL_KEYS = ("details", "details_at", "details_read", "details_wait")


def _details(c, followed: list[str], old: dict, now: float, every: float) -> dict:
    """The detail sheets of the followed addresses: each one read again after `every` s, at most DETAILS_PER_PASS per pass and PASS_GAP s
    between two passes; a 429 ends the pass and nothing is asked before the delay the service gave. {} while the route is closed to API
    tokens (the first answer of a pass with nothing yet tells, and nothing is asked again before the period). The sheets of the
    addresses not read in this pass are kept, those of addresses no longer followed go."""
    details = {ip: v for ip, v in (old.get("details") or {}).items() if ip in followed}
    read_at = {ip: t for ip, t in (old.get("details_read") or {}).items() if ip in followed}
    keep = {"details": details, "details_at": old.get("details_at"), "details_read": read_at, "details_wait": old.get("details_wait")}
    due = [ip for ip in followed if now - (read_at.get(ip) or 0) >= every]
    if not due or not _pass_due(old, now):
        return keep
    wait, closed = _read_sheets(c, due[:DETAILS_PER_PASS], details, read_at, now)
    if closed:   # closed (or MynetworK too old): not asked for every address, nor before the next period
        return {"details": {}, "details_at": now, "details_read": dict.fromkeys(followed, now), "details_wait": None}
    keep.update(details_at=now, details_wait=wait)
    return keep


def _pass_due(old: dict, now: float) -> bool:
    """No pass while the service asked to wait (429), nor less than PASS_GAP s after the previous one."""
    if now < (old.get("details_wait") or 0):
        return False
    return not (old.get("details_at") and now - old["details_at"] < PASS_GAP)


def _read_sheets(c, ips: list[str], details: dict, read_at: dict, now: float) -> tuple[float | None, bool]:
    """Reads the sheets of `ips` into `details` (and their time into `read_at`): (time to wait until after a 429, route closed).
    A plain error leaves the address for another time, with its last sheet."""
    got_one = bool(details)
    for ip in ips:
        try:
            sheet = c.ip_details(ip)
        except RateLimited as e:
            return now + (e.retry_after or RETRY_DEFAULT), False
        except ConnectorError:
            continue
        read_at[ip] = now
        if sheet is None and not got_one:
            return None, True
        if sheet is not None:
            details[ip], got_one = compact_sheet(sheet), True
    return None, False


def _guests(got: dict) -> dict:
    return {"guests": {f"{g.get('node')}/{g.get('vmid')}": g.get("status") for g in got.get("guests") or []},
            "nodes": {n.get("name"): bool(n.get("online")) for n in got.get("nodes") or []}}


def read(path: Path, max_age: float = 900) -> dict:
    """The last live.json, {} when it is missing, unreadable or older than `max_age` seconds."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        if time.time() - float(doc["ts"]) > max_age:
            return {}
    except (OSError, ValueError, KeyError, TypeError):
        return {}
    return doc if isinstance(doc.get("sources"), dict) else {}


def _missing_row(kind: str, name: str, src: dict) -> dict:
    ok = bool(src.get("ok"))
    count = len(src.get("status") or {})
    total = src.get("total") or count
    if not ok:
        message = str(src.get("error") or "illisible")[:160]
    else:
        message = f"{count} système(s)" if count else "OK"
    found = [{"name": "systèmes", "count": total}] if ok and total else []
    return {"type": kind, "name": name, "ok": ok, "message": message, "stale": False, "failures": 0, "since": None, "duration_s": 0.0,
            "version": src.get("version"), "version_tested": None, "extra": {}, "found": found, "warning": ""}


def statuses_missing(live: dict, have: set[tuple[str, str]]) -> list[dict]:
    """Connector states, in the shape of data.json « connectors », for the instances the light reading read but the full collection never lists
    (Beszel is read for its health, not by the collector): without them the settings card says « not read yet » after every collection."""
    out = []
    for key, src in (live.get("sources") or {}).items():
        kind, _, name = key.partition("/")
        if isinstance(src, dict) and name and (kind, name) not in have:
            out.append(_missing_row(kind, name, src))
    return out
