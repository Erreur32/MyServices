"""Nom de système Windows corrigé d'après le numéro de build.

Le nom lu par WMI ou le registre dit parfois « Windows 10 » sur un Windows 11 (même version majeure 10.0) :
le build décide (22000 et plus = Windows 11, 26100 et plus = Server 2025 pour un Server)."""
from __future__ import annotations

import re

# build -> version de fonctionnalités des Windows 10 et 11 (client)
_RELEASE = {19041: "2004", 19042: "20H2", 19043: "21H1", 19044: "21H2", 19045: "22H2",
            22000: "21H2", 22621: "22H2", 22631: "23H2", 26100: "24H2", 26200: "25H2"}
_SERVER_BY_BUILD = ((26100, "2025"), (20348, "2022"), (17763, "2019"), (14393, "2016"))


def windows_name(name: str | None, build: str | int | None) -> str | None:
    """Rend le nom, avec Windows 10 changé en Windows 11 (ou Server complété de son année) quand le build le montre."""
    if not name or not re.search(r"windows", name, re.I):
        return name
    try:
        b = int(str(build).strip())
    except (TypeError, ValueError):
        return name
    if re.search(r"windows server\s*$", name.strip(), re.I) or re.search(r"windows server (standard|datacenter|essentials)\b", name, re.I):
        year = next((y for lo, y in _SERVER_BY_BUILD if b >= lo), None)
        return re.sub(r"(?i)windows server", f"Windows Server {year}", name, count=1) if year else name
    if re.search(r"windows server", name, re.I):
        return name
    if b >= 22000:
        name = re.sub(r"(?i)windows 10", "Windows 11", name, count=1)
    rel = _RELEASE.get(b)
    if rel and re.search(r"windows 1[01]", name, re.I) and rel not in name:
        name = f"{name.rstrip()} {rel}"
    return name
