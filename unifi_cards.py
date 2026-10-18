"""Data of the UniFi front-panel cards (Network tab): switches, gateways and access points with their port tables.

Sources, in this order, the first that answers wins:
  MynetworK   GET /api/plugins/unifi/card-devices (MynetworK 0.11.1+), through its API token
  (the UniFi controller read directly comes next, for those who do not have MynetworK)
Every call to a source queries the UniFi controller behind it: the answer is kept a few seconds and shared by all the open pages.
"""
from __future__ import annotations

import threading
import time

import connectors
from connectors.base import ConnectorError

TTL = 8   # s, one reading shared by every page and every viewer
_lock = threading.Lock()
_cache: dict = {"at": 0.0, "doc": None}


def _from_mynetwork(cfg: dict) -> tuple[list[dict] | None, str]:
    """(devices, error) from the first MynetworK instance that has the route; (None, "") when no instance has it."""
    try:
        insts = [c for c in connectors.instances(cfg, kind="network") if c.type == "mynetwork"]
    except ConnectorError:
        return None, ""
    err = ""
    for c in insts:
        try:
            got = c.card_devices()
        except ConnectorError as e:
            err = str(e)
            continue
        if got is not None:
            return got, ""
    return None, err


def read(cfg: dict, now: float | None = None) -> dict:
    """{"source": "mynetwork" | None, "devices": [...], "at": reading time, "error": text}; never raises."""
    now = time.time() if now is None else now
    with _lock:
        if _cache["doc"] is not None and now - _cache["at"] < TTL:
            return _cache["doc"]
        devices, err = _from_mynetwork(cfg)
        doc = {"source": "mynetwork" if devices is not None else None, "devices": devices or [], "at": now, "error": err}
        _cache.update(at=now, doc=doc)
        return doc


def reset() -> None:
    """Forgets the kept reading (tests)."""
    _cache.update(at=0.0, doc=None)
