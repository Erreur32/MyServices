"""Proxmox VE read on the host itself by SSH (pvesh, read only), without an API token: same rows as the « proxmox » connector, for
data.json « virtualization » (Virtualisation tab, matching layer, watcher)."""
from __future__ import annotations

import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor

from connectors.proxmox import node_extra, resources as pve_resources

# One SSH run, sections introduced by « @@name » lines: cluster resources, per-node status (load, swap, root disk, kernel, CPU) and, if
# lm-sensors is installed on the host, its readings (CPU temperature, fans). Everything is read only.
PVE_CMD = (
    "pveversion 2>/dev/null | head -1; echo '@@res'; pvesh get /cluster/resources --output-format json; "
    "for n in $(ls /etc/pve/nodes 2>/dev/null); do echo \"@@node $n\"; timeout 8 pvesh get /nodes/$n/status --output-format json 2>/dev/null; done; "
    "echo \"@@sensors $(hostname -s)\"; sensors -j 2>/dev/null"
)


def _sections(out: str) -> tuple[str, dict[str, str]]:
    """Text before the first « @@ » line (the pveversion line), then {section header: body}."""
    head, _, rest = out.partition("@@")
    secs: dict[str, str] = {}
    for chunk in ("@@" + rest).split("\n@@") if rest else []:
        title, _, body = chunk.removeprefix("@@").partition("\n")
        secs[title.strip()] = body
    return head, secs


def _json(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return None


def sensor_readings(data: object) -> dict:
    """CPU temperature (hottest core/package of coretemp / k10temp / cpu_thermal chips) and fan speeds of `sensors -j`; {} when nothing usable."""
    if not isinstance(data, dict):
        return {}
    temps: list[float] = []
    fans: list[int] = []
    for chip, feats in data.items():
        if not isinstance(feats, dict):
            continue
        cpu_chip = chip.startswith(("coretemp", "k10temp", "zenpower", "cpu_thermal", "cpu-thermal"))
        for feat in feats.values():
            if not isinstance(feat, dict):
                continue
            for key, val in feat.items():
                if not isinstance(val, (int, float)) or isinstance(val, bool):
                    continue
                if cpu_chip and key.startswith("temp") and key.endswith("_input") and 0 < val < 150:
                    temps.append(float(val))
                elif key.startswith("fan") and key.endswith("_input") and val > 0:
                    fans.append(int(val))
    out: dict = {}
    if temps:
        out["temp_c"] = round(max(temps), 1)
    if fans:
        out["fans_rpm"] = sorted(fans, reverse=True)[:8]
    return out


def read(alias: str) -> tuple[dict | None, str, str | None]:
    """Guests, nodes and storages of a Proxmox VE host, read on the host itself by SSH (pvesh, read only): (data, error, version)."""
    cmd = ["bash", "-c", PVE_CMD] if alias == "local" else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, PVE_CMD]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return None, "pvesh : pas de réponse en 60 s", None
    head, secs = _sections(r.stdout)
    first = head.strip().splitlines()[0] if head.strip() else ""
    m = re.match(r"pve-manager/([\w.~-]+)", first)
    # older shape (a version line, then the resources JSON): kept readable
    res = _json(secs["res"]) if "res" in secs else _json(r.stdout.partition("\n")[2] if m else r.stdout)
    if res is None:
        return None, ("pvesh : " + (r.stderr.strip().splitlines() or ["réponse illisible"])[-1])[:200], None
    if not isinstance(res, list):
        return None, "pvesh : réponse inattendue", None
    data = pve_resources(res)
    sensors = next((sensor_readings(_json(b)) for t, b in secs.items() if t.startswith("sensors")), {})
    local = next((t.split(" ", 1)[1].strip() for t in secs if t.startswith("sensors ")), "")
    for n in data["nodes"]:
        n.update(node_extra(_json(secs.get(f"node {n['name']}", ""))))
        if sensors and (n["name"] == local or len(data["nodes"]) == 1):
            n.update(sensors)
    return data, "", m.group(1) if m else None


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
