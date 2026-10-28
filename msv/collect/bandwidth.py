"""Bandwidth of the Internet link, kept for the Network tiles (Download and Upload), one series per source and direction.

Freebox: the live rate MynetworK reads (connection.rate_down / rate_up, bytes per second), taken from the reading the connector readers already
keep in <state_dir>/connectors.json: no call of its own. UniFi: the traffic of the WAN port of the gateway in the UniFi cards (unifi_cards.py,
a reading shared for 30 s with the pages). Stored in tile_history's table as [time, rate in kbit/s, capacity of the link in kbit/s]; 7 days kept.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from msv.collect import tile_history as th

GAP_S = 50   # s, two points of a series at least this far apart (read every minute)
FBX_DOWN, FBX_UP, UNIFI_DOWN, UNIFI_UP = "bw.fbx.down", "bw.fbx.up", "bw.unifi.down", "bw.unifi.up"
KEYS = (FBX_DOWN, FBX_UP, UNIFI_DOWN, UNIFI_UP)
GATEWAYS = ("udm", "ugw", "uxg")


def _kbit(bytes_per_s: object) -> int | None:
    return round(bytes_per_s * 8 / 1000) if isinstance(bytes_per_s, (int, float)) and not isinstance(bytes_per_s, bool) and bytes_per_s >= 0 else None


def _freebox_connection(name: str, entry: object) -> tuple[int, dict] | None:
    """(time, connection) of a MynetworK entry of the shared state that carries the connection of the Freebox, None for any other entry."""
    last = entry.get("last") if isinstance(entry, dict) and str(name).startswith("mynetwork/") else None
    conn = ((last or {}).get("freebox") or {}).get("connection") if isinstance(last, dict) else None
    at = entry.get("at") if isinstance(conn, dict) else None
    return (int(at), conn) if isinstance(at, (int, float)) else None


def freebox_points(state: dict) -> dict[str, tuple[int, int, int]]:
    """{key: (time, kbit/s, link kbit/s)} of the Freebox, from the first MynetworK reading of the shared state that carries its connection."""
    for name, entry in state.items():
        found = _freebox_connection(name, entry)
        if not found:
            continue
        at, conn = found
        out = {key: (at, kbit, round((conn.get(cap) or 0) / 1000))
               for key, rate, cap in ((FBX_DOWN, "rate_down", "bandwidth_down"), (FBX_UP, "rate_up", "bandwidth_up"))
               if (kbit := _kbit(conn.get(rate))) is not None}
        if out:
            return out
    return {}


def _wan_port(gateway: dict) -> dict | None:
    """The port of the gateway that carries the Internet link: the one its `wan1` names, else the one marked as uplink."""
    ports = [p for p in gateway.get("port_table") or [] if isinstance(p, dict)]
    idx = (gateway.get("wan1") or {}).get("port_idx")
    return next((p for p in ports if idx is not None and p.get("port_idx") == idx), None) or next((p for p in ports if p.get("is_uplink")), None)


def unifi_points(devices: list, now: float) -> dict[str, tuple[int, int, int]]:
    """{key: (time, kbit/s, link kbit/s)} of the WAN port of the first UniFi gateway of the cards (received = download, sent = upload)."""
    gateway = next((d for d in devices if isinstance(d, dict) and (d.get("type") in GATEWAYS or d.get("wan1"))), None)
    port = _wan_port(gateway) if gateway else None
    if not port:
        return {}
    cap = int(port.get("speed") or 0) * 1000
    down, up = _kbit(port.get("rx_bytes-r")), _kbit(port.get("tx_bytes-r"))
    out = {}
    if down is not None:
        out[UNIFI_DOWN] = (int(now), down, cap)
    if up is not None:
        out[UNIFI_UP] = (int(now), up, cap)
    return out


def sample(db_path: str | Path, state_file: Path, unifi_devices: list, now: float | None = None) -> int:
    """Stores the points of both sources; how many were added."""
    now = now or time.time()
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    points = {**freebox_points(state if isinstance(state, dict) else {}), **unifi_points(unifi_devices, now)}
    return sum(th.store(db_path, key, pt, now, gap=GAP_S) for key, pt in points.items())
