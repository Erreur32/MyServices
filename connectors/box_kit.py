"""The shape shared by the « Internet box » connectors: what any box can tell, each connector fills what its own protocol gives and the rest stays None.
A field left None is not shown. Read-only, like every connector.
"""
from __future__ import annotations

import ipaddress
from dataclasses import asdict, dataclass
from typing import Literal

from connectors.status_kit import StatusConnector, duration, fact

LINE_NAMES = {"fibre": "fibre", "dsl": "DSL", "cable": "câble", "mobile": "4G/5G", "satellite": "satellite"}


@dataclass
class Box:
    model: str | None = None
    line: Literal["fibre", "dsl", "cable", "mobile", "satellite"] | None = None
    connected: bool | None = None
    down_bps: int | None = None        # current traffic, bit/s
    up_bps: int | None = None
    line_down_bps: int | None = None   # what the line can carry, bit/s
    line_up_bps: int | None = None
    public_ip: str | None = None       # the output of public_address(); shown in clear for now, by decision of the author
    uptime_s: int | None = None        # of the Internet connection
    firmware: str | None = None
    update_available: bool | None = None
    latest_firmware: str | None = None
    devices: int | None = None         # connected devices
    wifi: bool | None = None
    temperature: float | None = None   # °C


def public_address(ip: object) -> str | None:
    """A public address as it stands; None for anything else (0.0.0.0 of a line down, the private address of a box behind another box)."""
    try:
        addr = ipaddress.ip_address(str(ip).strip())
    except ValueError:
        return None
    return str(addr) if addr.is_global else None


def rate(bits: float) -> str:
    return f"{bits / 1e9:.1f} Gb/s".replace(".", ",") if bits >= 1e9 else f"{bits / 1e6:.1f} Mb/s".replace(".", ",")


def _pair(down: int | None, up: int | None) -> str | None:
    """« down / up », one side alone when the other is unknown; a rate of 0 is a real one."""
    return " / ".join(rate(v) for v in (down, up) if v is not None) or None


def _line_fact(box: Box) -> dict | None:
    name = LINE_NAMES.get(box.line or "")
    if box.connected is None:
        return fact("Ligne", name) if name else None
    state = "en ligne" if box.connected else "coupée"
    return fact("Ligne", f"{state} ({name})" if name else state, "ok" if box.connected else "bad")


def facts_of(box: Box) -> list[dict]:
    """The figures of the card, the most useful first (the list is cut at MAX_FACTS). The public address stays out: test() prints these."""
    update = f"→ {box.latest_firmware}" if box.latest_firmware else "disponible"
    found = [
        _line_fact(box),
        (now := _pair(box.down_bps, box.up_bps)) and fact("Débit actuel", now),
        (top := _pair(box.line_down_bps, box.line_up_bps)) and fact("Débit max", top),
        box.uptime_s is not None and fact("Connectée depuis", duration(box.uptime_s)),
        box.update_available and fact("Mise à jour", update, "warn"),
        box.devices is not None and fact("Appareils", box.devices),
        box.wifi is not None and fact("Wi-Fi", "actif" if box.wifi else "coupé"),
        box.temperature is not None and fact("Température", f"{box.temperature:.0f} °C"),
    ]
    return [f for f in found if f]


def box_card(box: Box) -> dict:
    """What collect() returns: the status card, plus the whole reading under « box »."""
    problems = ["connexion Internet coupée"] if box.connected is False else []
    return {**StatusConnector.out(box.firmware, facts_of(box), problems), "box": asdict(box)}
