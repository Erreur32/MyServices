"""Proxmox VE read on the host itself by SSH (pvesh, read only), without an API token: same rows as the « proxmox » connector, for
data.json « virtualization » (Virtualisation tab, matching layer, watcher)."""
from __future__ import annotations

import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor

from connectors.proxmox import resources as pve_resources

PVE_CMD = "pveversion 2>/dev/null | head -1; pvesh get /cluster/resources --output-format json"


def read(alias: str) -> tuple[dict | None, str, str | None]:
    """Guests, nodes and storages of a Proxmox VE host, read on the host itself by SSH (pvesh, read only): (data, error, version)."""
    cmd = ["bash", "-c", PVE_CMD] if alias == "local" else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, PVE_CMD]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return None, "pvesh : pas de réponse en 30 s", None
    first, _, rest = r.stdout.partition("\n")
    m = re.match(r"pve-manager/([\w.~-]+)", first)
    try:
        res = json.loads(rest if m else r.stdout)
    except ValueError:
        return None, ("pvesh : " + (r.stderr.strip().splitlines() or ["réponse illisible"])[-1])[:200], None
    if not isinstance(res, list):
        return None, "pvesh : réponse inattendue", None
    return pve_resources(res), "", m.group(1) if m else None


def rows(machines_out: list[dict], sshc: dict, taken: set[str]) -> list[dict]:
    """Proxmox VE hosts read by SSH, in the shape of the « proxmox » connector rows (data.json « virtualization »): no API token needed.
    A host already read by a Proxmox connector (its URL on the same IP) is left to it."""
    hosts = {m["ip"]: ("local" if m.get("local") else (sshc.get(m["ip"]) or {}).get("alias")) for m in machines_out
             if (m.get("info") or {}).get("proxmox") and m.get("ssh") is not None and m["ip"] not in taken}
    hosts = {ip: a for ip, a in hosts.items() if a}
    names = {m["ip"]: m["name"] for m in machines_out}
    with ThreadPoolExecutor(max(1, min(4, len(hosts)))) as ex:
        got = dict(zip(hosts, ex.map(read, hosts.values())))
    return [{"connector": "proxmox", "name": names[ip], "label": "Proxmox VE", "ok": data is not None, "stale": False,
             "message": err or "lu par SSH (pvesh)", "version": version, "url": f"https://{ip}:8006", "via": "ssh", "ip": ip, **(data or {})}
            for ip, (data, err, version) in got.items()]
