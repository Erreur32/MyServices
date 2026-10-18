"""Statistics of the Network tab read through MynetworK: scan counters, addresses offline, worst latencies, data volume per client.

The scan figures come from MynetworK's own counters when it has them (0.11.2+), else they are counted from the inventory it already gave
(always available). The data volume per client needs the top-traffic route (0.11.2+): without it that part is simply absent.
One reading is kept a few seconds and shared by every page.
"""
from __future__ import annotations

import threading
import time

import connectors
from connectors.base import ConnectorError
from connectors.mynetwork import TRAFFIC_MODES

TTL = 30   # s
LIST_MAX = 10
_lock = threading.Lock()
_cache: dict = {}


def _num(*values):
    return next((v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)), None)


def _text(*values):
    return next((v for v in values if isinstance(v, str) and v), None)


def traffic_items(raw: list[dict]) -> list[dict]:
    """Clients of the top-traffic route reduced to {name, ip, mac, rx, tx, total}: the names of the fields are read the usual ways
    (the route is new, its exact shape is to be confirmed on a real MynetworK 0.11.2)."""
    out = []
    for i in raw:
        rx = _num(i.get("rx_bytes"), i.get("rxBytes"), i.get("rx"), i.get("download"), i.get("bytes_rx"))
        tx = _num(i.get("tx_bytes"), i.get("txBytes"), i.get("tx"), i.get("upload"), i.get("bytes_tx"))
        total = _num(i.get("total_bytes"), i.get("totalBytes"), i.get("total"), i.get("bytes"), i.get("volume"))
        if total is None and (rx is not None or tx is not None):
            total = (rx or 0) + (tx or 0)
        out.append({"name": _text(i.get("name"), i.get("hostname"), i.get("mac")), "ip": _text(i.get("ip")), "mac": _text(i.get("mac")),
                    "rx": rx, "tx": tx, "total": total})
    return sorted(out, key=lambda x: -(x["total"] or 0))


def _scan(c) -> dict:
    devices = c.scan()
    counted = {"total": len(devices), "online": sum(1 for d in devices if d["status"] == "online"), "offline": sum(1 for d in devices if d["status"] == "offline"),
               "unknown": sum(1 for d in devices if d["status"] not in ("online", "offline"))}
    given = c.scan_stats()
    label = lambda d: {"ip": d["ip"], "name": d.get("hostname") or d.get("vendor"), "ping_ms": d.get("ping_ms")}   # noqa: E731
    ip_key = lambda d: tuple(int(x) if x.isdigit() else 0 for x in d["ip"].split("."))   # noqa: E731
    return {"counters": {**counted, **{k: v for k, v in (given or {}).items() if v is not None}, "source": "mynetwork" if given else "inventory"},
            "offline": [label(d) for d in sorted((d for d in devices if d["status"] == "offline"), key=ip_key)][:LIST_MAX * 3],
            "worst_latency": [label(d) for d in sorted((d for d in devices if d["status"] == "online" and d.get("ping_ms") is not None), key=lambda d: -d["ping_ms"])][:LIST_MAX]}


def read(cfg: dict, traffic: str = "live", now: float | None = None) -> dict:
    """{"scan": {...} | None, "traffic": {"mode", "items"} | None, "at", "error"}; never raises. traffic: live, today or alltime."""
    now = now or time.time()
    mode = traffic if traffic in TRAFFIC_MODES else "live"
    with _lock:
        hit = _cache.get(mode)
        if hit and now - hit["at"] < TTL:
            return hit["doc"]
        doc: dict = {"scan": None, "traffic": None, "at": now, "error": ""}
        try:
            insts = [c for c in connectors.instances(cfg, kind="network") if c.type == "mynetwork"]
        except ConnectorError:
            insts = []
        for c in insts:
            try:
                doc["scan"] = _scan(c)
                got = c.top_traffic(mode)
                if got is not None:
                    doc["traffic"] = {"mode": mode, "items": traffic_items(got)[:LIST_MAX]}
                break
            except ConnectorError as e:
                doc["error"] = str(e)
        _cache[mode] = {"at": now, "doc": doc}
        return doc


def reset() -> None:
    _cache.clear()
