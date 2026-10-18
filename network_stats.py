"""Statistics of the Network tab read through MynetworK: scan counters, addresses offline, worst latencies, data volume per client.

The scan figures come from MynetworK's own counters when it has them (0.11.2+), else they are counted from the inventory it already gave
(always available). The data volume per client needs the top-traffic route (0.11.2+): without it that part is simply absent.
One reading is kept a few seconds and shared by every page.
"""
from __future__ import annotations

import sys
import threading
import time

import connectors
from connectors.base import ConnectorError
from connectors.mynetwork import TRAFFIC_MODES

TTL = 30   # s, the scan figures
TRAFFIC_TTL = {"live": 8, "today": 60, "alltime": 300}   # s, per mode: the live volume follows the traffic, the totals hardly move
LIST_MAX = 10
TRAFFIC_MAX = 50   # the route's own ceiling: the page shows the first ten and all of them in a window
_lock = threading.Lock()
_cache: dict = {}


def _num(*values):
    return next((v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)), None)


def _text(*values):
    return next((v for v in values if isinstance(v, str) and v), None)


def traffic_items(raw: list[dict]) -> list[dict]:
    """Clients of the top-traffic route reduced to {name, ip, mac, vendor, rx, tx, total, unit}. MynetworK gives, for « live », a rate in KiB/s
    (download, upload: unit « rate », returned here in bytes per second) and, for « today » and « alltime », bytes (rxBytes, txBytes: unit
    « volume »). Other usual field names are accepted too."""
    out = [_traffic_item(i) for i in raw]
    return sorted(out, key=lambda x: -(x["total"] or 0))


def _traffic_item(i: dict) -> dict:
    live = _num(i.get("download")) is not None or _num(i.get("upload")) is not None
    total = None
    if live:
        rx, tx = (None if v is None else v * 1024 for v in (_num(i.get("download")), _num(i.get("upload"))))
    else:
        rx = _num(i.get("rxBytes"), i.get("rx_bytes"), i.get("rx"), i.get("bytes_rx"))
        tx = _num(i.get("txBytes"), i.get("tx_bytes"), i.get("tx"), i.get("bytes_tx"))
        total = _num(i.get("totalBytes"), i.get("total_bytes"), i.get("total"), i.get("bytes"), i.get("volume"))
    if total is None and (rx is not None or tx is not None):
        total = (rx or 0) + (tx or 0)
    return {"name": _text(i.get("name"), i.get("hostname"), i.get("mac")), "ip": _text(i.get("ip")), "mac": _text(i.get("mac")), "vendor": _text(i.get("vendor")),
            "rx": rx, "tx": tx, "total": total, "unit": "rate" if live else "volume"}


def _scan(c) -> dict:
    devices = c.scan()
    counted = {"total": len(devices), "online": sum(1 for d in devices if d["status"] == "online"), "offline": sum(1 for d in devices if d["status"] == "offline"),
               "unknown": sum(1 for d in devices if d["status"] not in ("online", "offline"))}
    given = c.scan_stats()
    # last reading of an address: its last-seen date, else its last port scan (MynetworK 0.11.x sends lastSeen as an empty object)
    label = lambda d, *fallback: {"ip": d["ip"], "name": d.get("hostname") or d.get("vendor"), "ping_ms": d.get("ping_ms"),   # noqa: E731
                                  "last": _text(d.get("last_seen"), *(d.get(f) for f in fallback))}
    ip_key = lambda d: tuple(int(x) if x.isdigit() else 0 for x in d["ip"].split("."))   # noqa: E731
    return {"counters": {**counted, **{k: v for k, v in (given or {}).items() if v is not None}, "source": "mynetwork" if given else "inventory"},
            "offline": [label(d, "ports_at") for d in sorted((d for d in devices if d["status"] == "offline"), key=ip_key)][:LIST_MAX * 3],
            "worst_latency": [label(d) for d in sorted((d for d in devices if d["status"] == "online" and d.get("ping_ms") is not None), key=lambda d: -d["ping_ms"])][:LIST_MAX]}


def _instances(cfg: dict) -> list:
    try:
        return [c for c in connectors.instances(cfg, kind="network") if c.type == "mynetwork"]
    except ConnectorError:
        return []


FAILED = "MynetworK ne répond pas (détail dans les journaux)"


def _failed(e: Exception) -> str:
    """Fixed text for the screen; the detail of the error stays in the container log."""
    print("MynetworK network stats: %s" % e, file=sys.stderr)
    return FAILED


def _read_scan(cfg: dict) -> tuple[dict | None, str]:
    """(scan, error): the first MynetworK instance that answers; the last error when none does."""
    err = ""
    for c in _instances(cfg):
        try:
            return _scan(c), err
        except ConnectorError as e:
            err = _failed(e)
    return None, err


def _read_traffic(cfg: dict, mode: str) -> tuple[list | None, str]:
    """(items, error): the traffic of the first instance that has the route; the last error met on the way."""
    err = ""
    for c in _instances(cfg):
        try:
            got = c.top_traffic(mode, TRAFFIC_MAX)
        except ConnectorError as e:
            err = _failed(e)
            continue
        return (None if got is None else traffic_items(got)[:TRAFFIC_MAX]), err
    return None, err


def read(cfg: dict, traffic: str = "live", now: float | None = None) -> dict:
    """{"scan": {...} | None, "traffic": {"mode", "items"} | None, "at", "error"}; never raises. traffic: live, today or alltime.
    The scan part and each traffic mode are kept apart: the live volume is read often, the rest much less."""
    now = now or time.time()
    mode = traffic if traffic in TRAFFIC_MODES else "live"
    with _lock:
        err = ""
        hit = _cache.get("scan")
        if not hit or now - hit["at"] >= TTL:
            scan, err = _read_scan(cfg)
            hit = _cache["scan"] = {"at": now, "scan": scan, "error": err}
        tr = _cache.get(("traffic", mode))
        if not tr or now - tr["at"] >= TRAFFIC_TTL[mode]:
            items, terr = _read_traffic(cfg, mode) if hit["scan"] else (None, "")
            err = terr or err
            tr = _cache[("traffic", mode)] = {"at": now, "items": items}
        return {"scan": hit["scan"], "traffic": None if tr["items"] is None else {"mode": mode, "items": tr["items"]}, "at": max(hit["at"], tr["at"]),
                "error": err or hit["error"]}


def reset() -> None:
    _cache.clear()
