"""Data of the UniFi front-panel cards (Network tab): switches, gateways and access points with their port tables.

Sources, in this order, the first that answers wins:
  MynetworK   GET /api/plugins/unifi/card-devices (MynetworK 0.11.1+), through its API token
  UniFi       the controller read directly with a local account (UniFi connector, « account » access), for those who do not have MynetworK
Every call to a source queries the UniFi controller behind it: the answer is kept a few seconds and shared by all the open pages.
"""
from __future__ import annotations

import sys
import threading
import time

import connectors
from connectors import reqstats
from connectors.base import ConnectorError

TTL = 30   # s, one reading shared by every page and every viewer (each one asks the controller behind the source)
TTL_FAILED = 120   # s, after a failed reading: the source is left alone for a while instead of being asked again at once
_lock = threading.Lock()
_cache: dict = {"at": 0.0, "doc": None}


FAILED = "MynetworK ne répond pas (détail dans les journaux)"
FAILED_CONTROLLER = "Le contrôleur UniFi ne répond pas (détail dans les journaux)"


def _failed(e: Exception) -> str:
    """Fixed text for the screen; the detail of the error stays in the container log."""
    print("MynetworK UniFi cards: %s" % e, file=sys.stderr)
    return FAILED


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
            err = _failed(e)
            continue
        if got is not None:
            return got, ""
    return None, err


def _from_controller(cfg: dict) -> tuple[list[dict] | None, str]:
    """(devices, error) from the first UniFi connector that reads its controller with an account; (None, "") when there is none."""
    try:
        insts = [c for c in connectors.instances(cfg, kind="status") if c.type == "unifi" and c.conf.get("auth") == "account"]
    except ConnectorError:
        return None, ""
    err = ""
    for c in insts:
        try:
            got = c.card_devices()
        except ConnectorError as e:
            print("UniFi controller cards: %s" % e, file=sys.stderr)
            err = FAILED_CONTROLLER
            continue
        if got:
            return got, ""
    return None, err


def read(cfg: dict, now: float | None = None) -> dict:
    """{"source": "mynetwork" | None, "devices": [...], "at": reading time, "error": text}; never raises."""
    now = time.time() if now is None else now
    with _lock:
        kept = TTL if _cache["doc"] is None or _cache["doc"]["source"] else TTL_FAILED
        if _cache["doc"] is not None and now - _cache["at"] < kept:
            reqstats.hit("cache", "unifi_cards")
            return _cache["doc"]
        devices, err = _from_mynetwork(cfg)
        source = "mynetwork"
        if devices is None:
            devices, err2 = _from_controller(cfg)
            source, err = "unifi", err2 or err
        doc = {"source": source if devices is not None else None, "devices": devices or [], "at": now, "error": err}
        _cache.update(at=now, doc=doc)
        return doc


def reset() -> None:
    """Forgets the kept reading (tests)."""
    _cache.update(at=0.0, doc=None)
