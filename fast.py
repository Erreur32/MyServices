"""Fast tier: the light, read-only calls of the connectors, made every few minutes (the full collection stays at 30 min).

  MynetworK  the scanner inventory (one call): status, ping, open ports and the date of their last scan
             + the detail sheet of each followed address (one call each, every `details_every` s), once MynetworK lets API tokens read it
  Proxmox    guests and nodes by API token (hosts read by SSH are left to the collection: no extra SSH)
  Beszel     the status (up / down / paused) of each system, matched to the followed machines: one light call

The result goes to <web_dir>/live.json with the time of each reading; the page puts it over data.json, a value older than its limit
is shown as such instead of as fresh.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import connectors
from connectors.base import ConnectorError
from connectors.mynetwork import compact_sheet

VERSION_EVERY = 6 * 3600   # s, between two version readings of a light-read connector
PORTS_MAX_AGE = 3600   # s, a port list older than this is called old (its scan date, not the time we read it)


def _try(fn):
    try:
        return fn(), ""
    except ConnectorError as e:
        return None, str(e)


def refresh(cfg: dict, path: Path, followed: list[str], prev: dict | None = None, details_every: float = 900, now: float | None = None) -> dict:
    """Reads the fast connectors once and writes `path`; a source that fails keeps its last reading, marked not ok."""
    now = time.time() if now is None else now
    prev = prev or {}
    sources: dict[str, dict] = {}
    try:
        insts = connectors.instances(cfg, kind="network") + connectors.instances(cfg, kind="virtualization") + connectors.instances(cfg, kind="health")
    except ConnectorError:
        insts = []
    for c in insts:
        key = f"{c.type}/{c.name}"
        old = (prev.get("sources") or {}).get(key, {})
        if c.type == "mynetwork":
            devices, err = _try(c.scan)
            cur = {"at": now, "ok": devices is not None, "error": err,
                   "devices": {d["ip"]: {k: d.get(k) for k in ("status", "ping_ms", "ports", "ports_at")} for d in devices} if devices is not None else old.get("devices", {})}
            if devices is not None:
                cur["details"], cur["details_at"] = _details(c, followed, old, now, details_every)
            else:
                cur["details"], cur["details_at"] = old.get("details", {}), old.get("details_at")
            sources[key] = cur
        elif c.type == "beszel":
            systems, err = _try(lambda c=c: c._records("systems"))
            ver, ver_at = old.get("version"), old.get("version_at", 0)
            if systems is not None and now - ver_at > VERSION_EVERY:   # the version changes rarely: asked again every few hours, not every reading
                got, _ = _try(c.test)
                ver, ver_at = (got.version if got else ver), now
            sources[key] = {"at": now, "ok": systems is not None, "error": err, "version": ver, "version_at": ver_at,
                            "total": len(systems) if systems is not None else old.get("total"),
                            "status": _beszel_by_ip(systems, cfg) if systems is not None else old.get("status", {})}
        elif c.type == "proxmox":
            got, err = _try(c.collect)
            sources[key] = {"at": now, "ok": got is not None, "error": err, **(_guests(got) if got else {k: old.get(k, {}) for k in ("guests", "nodes")})}
    doc = {"ts": now, "sources": sources}
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(doc), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass   # a convenience file: a full disk must not stop the server
    return doc


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
