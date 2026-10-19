"""Live tier: <web_dir>/live.json, the light picture the page puts over data.json between two collections, now derived from the
shared readings of the server's readers (readers.py), never from calls of its own:

  MynetworK  the scanner inventory (status, ping, open ports and the date of their last scan) from the last full reading
             + the detail sheet of each followed address (one call each, every `details_every` s), once MynetworK lets API tokens read it
  Proxmox    guests and nodes from the last reading
  Beszel     the status (up / down / paused) of each system, matched to the followed machines

Each source carries the time of its reading; the page shows a value older than its limit as such instead of as fresh.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from connectors.base import ConnectorError
from connectors.mynetwork import compact_sheet

PORTS_MAX_AGE = 3600   # s, a port list older than this is called old (its scan date, not the time we read it)


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
    out["details"], out["details_at"] = _details(c, followed, old, now, details_every) if last is not None else (old.get("details", {}), old.get("details_at"))
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


def _details(c, followed: list[str], old: dict, now: float, every: float) -> tuple[dict, float | None]:
    """Detail sheets of the followed addresses, at most every `every` s; {} while the route is closed to API tokens (the first answer tells)."""
    if old.get("details_at") and now - old["details_at"] < every:
        return old.get("details", {}), old["details_at"]
    out: dict[str, dict] = {}
    for ip in followed:
        sheet, _ = _try(lambda ip=ip: c.ip_details(ip))
        if sheet is None and not out:
            return {}, now   # closed (or MynetworK too old): not asked again for every address, nor before the next period
        if sheet is not None:
            out[ip] = compact_sheet(sheet)
    return out, now


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
