"""VMware ESXi read on the host itself by SSH (vim-cmd and esxcli, read only), without vCenter: same rows as the Proxmox ones, for
data.json « virtualization » (Virtualization tab, matching layer, watcher).

SSH is off by default on ESXi (Host → Actions → Services → Enable Secure Shell) and root's key goes in
/etc/ssh/keys-root/authorized_keys. One command per host: the host summary, the datastores, then the summary of each VM.
vim-cmd prints vim objects (« key = value, » lines, nested); the first occurrence of a key is the one wanted.
"""
from __future__ import annotations

import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from msv.remote.sshmux import SSH_MUX, ssh_run

MAX_VMS = 300
SCRIPT = ("echo '##HOST'; vim-cmd hostsvc/hostsummary 2>&1; "
          "echo '##FS'; esxcli storage filesystem list 2>&1; "
          "for id in $(vim-cmd vmsvc/getallvms 2>/dev/null | awk 'NR>1 && $1 ~ /^[0-9]+$/ {print $1}' | head -n %d); do "
          "echo \"##VM $id\"; vim-cmd vmsvc/get.summary $id 2>&1; done" % MAX_VMS)
DATASTORE_TYPES = ("VMFS", "NFS", "vsan", "VVOL")   # not the boot volumes (vfat, VFFS / OSDATA)


def vim_fields(text: str) -> dict[str, str | None]:
    """« key = value, » lines of a vim-cmd dump: {key: value} (first occurrence, quotes removed, <unset> = None)."""
    out: dict[str, str | None] = {}
    for m in re.finditer(r"^\s*(\w+) = (.*?),?\s*$", text, re.M):
        k, v = m.group(1), m.group(2).strip()
        if k in out or v.endswith(("{", "[")):
            continue
        out[k] = None if v == "<unset>" else v.strip("'\"")
    return out


def config_fields(text: str) -> dict[str, str | None]:
    """Fields of the « config = (…ConfigSummary) » part only: the name of the host or VM (health sensors further up also have a « name »)."""
    i = text.find("ConfigSummary)")
    return vim_fields(text[i:]) if i >= 0 else {}


def _int(v) -> int | None:
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return None


def _pct(used, total) -> float | None:
    return round(100 * used / total, 1) if isinstance(used, (int, float)) and total else None


def filesystems(text: str) -> list[dict]:
    """Datastores of « esxcli storage filesystem list » (columns placed by the dashes line, a volume name may hold spaces)."""
    lines = text.splitlines()
    dash = next((i for i, line in enumerate(lines) if line.startswith("---")), None)
    if dash is None:
        return []
    cols = [(m.start(), m.end()) for m in re.finditer(r"-+", lines[dash])]
    if len(cols) < 7:
        return []
    out = []
    for line in lines[dash + 1:]:
        if not line.strip():
            continue
        cell = [line[a:(cols[i + 1][0] if i + 1 < len(cols) else None)].strip() for i, (a, _) in enumerate(cols)]
        mount, name, _, mounted, kind, size, free = cell[:7]
        if not kind.startswith(DATASTORE_TYPES) or mounted != "true":
            continue
        total, avail = _int(size), _int(free)
        used = total - avail if total is not None and avail is not None else None
        out.append({"name": name or mount.rsplit("/", 1)[-1], "type": kind, "shared": kind.startswith(("NFS", "vsan", "VVOL")),
                    "status": "available", "used": used, "total": total, "used_pct": _pct(used, total)})
    return out


def parse(stdout: str) -> tuple[dict | None, str, str | None]:
    """(data, error, version) from the output of SCRIPT."""
    parts = re.split(r"^##(HOST|FS|VM \d+)\s*$", stdout, flags=re.M)
    blocks = dict(zip(parts[1::2], parts[2::2]))
    host = vim_fields(blocks.get("HOST", ""))
    if not host.get("memorySize"):
        tail = (blocks.get("HOST") or stdout).strip().splitlines()
        return None, ("vim-cmd : " + (tail[-1] if tail else "réponse vide"))[:200], None
    conf = config_fields(blocks.get("HOST", ""))
    name = conf.get("name") or "esxi"
    mhz, cores = _int(host.get("cpuMhz")) or 0, _int(host.get("numCpuCores")) or 0
    mem = _int(host.get("memorySize"))
    used_mb = _int(host.get("overallMemoryUsage"))
    node = {"name": name, "online": host.get("connectionState", "connected") == "connected",
            "cpu_pct": _pct(_int(host.get("overallCpuUsage")), mhz * cores), "mem_pct": _pct(used_mb * 2**20 if used_mb is not None else None, mem),
            "uptime": _int(host.get("uptime")), "cpus": _int(host.get("numCpuThreads")) or cores or None,
            "mem": used_mb * 2**20 if used_mb is not None else None, "maxmem": mem,
            "model": " ".join(x for x in (host.get("vendor"), host.get("model")) if x) or None}
    guests = []
    for key, text in blocks.items():
        if not key.startswith("VM "):
            continue
        f = {**vim_fields(text), **config_fields(text)}
        if not f.get("powerState"):
            continue
        on = f["powerState"] == "poweredOn"
        mem_mb, cpus = _int(f.get("memorySizeMB")), _int(f.get("numCpu"))
        disk = (_int(f.get("committed")) or 0) + (_int(f.get("uncommitted")) or 0)
        guests.append({"vmid": int(key[3:]), "name": f.get("name"), "type": "vm", "node": name, "status": "running" if on else "stopped",
                       "template": f.get("template") == "true",
                       "cpu_pct": _pct(_int(f.get("overallCpuUsage")), (cpus or 0) * mhz) if on else None,
                       "mem_pct": _pct(_int(f.get("guestMemoryUsage")), mem_mb) if on else None,
                       "uptime": _int(f.get("uptimeSeconds")) if on else None, "cpus": cpus,
                       "mem": (_int(f.get("guestMemoryUsage")) or 0) * 2**20 if on else None, "maxmem": mem_mb * 2**20 if mem_mb else None,
                       "maxdisk": disk or None, "tags": [], "os": f.get("guestFullName"),
                       "ip": f.get("ipAddress"), "hostname": f.get("hostName"), "tools": f.get("toolsStatus")})
    guests.sort(key=lambda g: g["vmid"])
    live = [g for g in guests if not g["template"]]
    data = {"nodes": [node], "guests": guests, "storage": filesystems(blocks.get("FS", "")),
            "totals": {"vm": len(live), "lxc": 0, "running": sum(1 for g in live if g["status"] == "running"),
                       "stopped": sum(1 for g in live if g["status"] != "running")}, "backups": None}
    return data, "", conf.get("version")


def read(alias: str) -> tuple[dict | None, str, str | None]:
    """VMs, host and datastores of an ESXi host read by SSH: (data, error, version)."""
    try:
        r = ssh_run("esxi", alias, ["ssh", *SSH_MUX, "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, SCRIPT], capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return None, "vim-cmd : pas de réponse en 90 s", None
    if r.returncode == 255:
        return None, ("SSH : " + (r.stderr.strip().splitlines() or ["refusé"])[-1])[:200], None
    return parse(r.stdout)


def rows(machines_out: list[dict], sshc: dict, taken: set[str]) -> list[dict]:
    """ESXi hosts followed by SSH (detected by `vmware -v`), in the shape of the virtualization rows. A host already read by a vCenter
    connector is left out (`taken`: its IPs)."""
    hosts = {m["ip"]: (sshc.get(m["ip"]) or {}).get("alias") for m in machines_out
             if (m.get("info") or {}).get("esxi") and m.get("ssh") is not None and m["ip"] not in taken}
    hosts = {ip: a for ip, a in hosts.items() if a}
    names = {m["ip"]: m["name"] for m in machines_out}
    with ThreadPoolExecutor(max(1, min(4, len(hosts)))) as ex:
        got = dict(zip(hosts, ex.map(read, hosts.values())))
    return [{"connector": "esxi", "name": names[ip], "label": "VMware ESXi", "ok": data is not None, "stale": False,
             "message": err or "lu par SSH (vim-cmd)", "version": version, "url": f"https://{ip}/ui/", "via": "ssh", "ip": ip, **(data or {})}
            for ip, (data, err, version) in got.items()]
