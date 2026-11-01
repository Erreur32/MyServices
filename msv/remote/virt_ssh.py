"""Other hypervisors read on the host itself by SSH, read only, in the shape of the Proxmox rows (data.json « virtualization »):
KVM / libvirt (virsh -r domstats), Incus or LXD (incus / lxc list --format json) and VirtualBox (VBoxManage list). The tools found on a
machine come from hostinfo.py (« hypervisors »); one SSH command per machine runs all of them.

virsh needs read access to the system libvirt (root or the libvirt group); VBoxManage only lists the VMs of the SSH account.
"""
from __future__ import annotations

import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from msv.remote.sshmux import SSH_MUX, ssh_run

MAX = 300
LABEL = {"libvirt": "KVM / libvirt", "incus": "Incus", "lxd": "LXD", "virtualbox": "VirtualBox"}
VIA = {"libvirt": "virsh", "incus": "incus", "lxd": "lxc", "virtualbox": "VBoxManage"}
STEP = {
    "virsh": "echo '##VIRSH'; virsh -r -c qemu:///system domstats --state --balloon --vcpu 2>&1 | head -n 6000",
    "incus": "echo '##INCUS'; incus list --format json 2>&1",
    "lxc": "echo '##LXD'; lxc list --format json 2>&1",   # LXD's client is also called lxc (not the old lxc-* tools)
    "VBoxManage": "echo '##VBOX'; VBoxManage list vms 2>&1; echo '##VBOXRUN'; VBoxManage list runningvms 2>&1",
}


def _totals(guests: list[dict]) -> dict:
    return {"vm": sum(1 for g in guests if g["type"] == "vm"), "lxc": sum(1 for g in guests if g["type"] == "lxc"),
            "running": sum(1 for g in guests if g["status"] == "running"), "stopped": sum(1 for g in guests if g["status"] != "running")}


def parse_virsh(text: str, node: str) -> list[dict] | None:
    """« virsh domstats » blocks (Domain: 'x' then key=value lines). state.state 1 = running. None if virsh refused."""
    if "Domain:" not in text and text.strip():
        return None
    out = []
    for block in re.split(r"^Domain: ", text, flags=re.M)[1:MAX + 1]:
        name = block.splitlines()[0].strip().strip("'")
        f = dict(re.findall(r"^\s+([\w.]+)=(\S+)", block, re.M))
        on = f.get("state.state") == "1"
        cur, top = (int(f[k]) * 1024 if f.get(k, "").isdigit() else None for k in ("balloon.current", "balloon.maximum"))
        out.append({"vmid": name, "name": name, "type": "vm", "node": node, "status": "running" if on else "stopped", "template": False, "tags": [],
                    "cpus": int(f["vcpu.maximum"]) if f.get("vcpu.maximum", "").isdigit() else None,
                    "mem": cur if on else None, "maxmem": top})
    return out


def parse_incus(text: str, node: str) -> list[dict] | None:
    """« incus list --format json »: containers (lxc) and virtual machines, with memory in use."""
    try:
        items = json.loads(text[text.find("["):]) if "[" in text else None
    except ValueError:
        return None
    if not isinstance(items, list):
        return None
    out = []
    for it in items[:MAX]:
        if not isinstance(it, dict):
            continue
        state = it.get("state") if isinstance(it.get("state"), dict) else {}
        mem = (state.get("memory") or {}).get("usage") if isinstance(state.get("memory"), dict) else None
        on = str(it.get("status", "")).lower() == "running"
        out.append({"vmid": it.get("name"), "name": it.get("name"), "type": "vm" if it.get("type") == "virtual-machine" else "lxc", "node": node,
                    "status": "running" if on else "stopped", "template": False, "mem": mem if on else None,
                    "tags": [p for p in it.get("profiles") or [] if isinstance(p, str) and p != "default"][:5]})
    return out


def parse_vbox(listed: str, running: str, node: str) -> list[dict] | None:
    """« VBoxManage list vms / runningvms »: "name" {uuid} lines."""
    rx = re.compile(r'^"(.*)" \{([0-9a-f-]+)\}$', re.M)
    vms = rx.findall(listed)
    if not vms and listed.strip():
        return None
    on = {u for _, u in rx.findall(running)}
    return [{"vmid": u, "name": n, "type": "vm", "node": node, "status": "running" if u in on else "stopped", "template": False, "tags": []}
            for n, u in vms[:MAX]]


def parse(stdout: str, node: str) -> dict[str, tuple[dict | None, str]]:
    """{kind: (data, error)} for each tool that answered in the output of one SSH command."""
    parts = re.split(r"^##(VIRSH|INCUS|LXD|VBOX|VBOXRUN)\s*$", stdout, flags=re.M)
    b = dict(zip(parts[1::2], parts[2::2]))
    got: dict[str, list[dict] | None] = {}
    if "VIRSH" in b:
        got["libvirt"] = parse_virsh(b["VIRSH"], node)
    if "INCUS" in b:
        got["incus"] = parse_incus(b["INCUS"], node)
    if "LXD" in b:
        got["lxd"] = parse_incus(b["LXD"], node)
    if "VBOX" in b:
        got["virtualbox"] = parse_vbox(b["VBOX"], b.get("VBOXRUN", ""), node)
    out = {}
    for kind, guests in got.items():
        text = b.get({"libvirt": "VIRSH", "incus": "INCUS", "lxd": "LXD", "virtualbox": "VBOX"}[kind], "")
        if guests is None:
            out[kind] = (None, f"{VIA[kind]} : " + ((text.strip().splitlines() or ["réponse illisible"])[-1])[:180])
        else:
            out[kind] = ({"nodes": [{"name": node, "online": True}], "guests": guests, "storage": [], "totals": _totals(guests), "backups": None}, "")
    return {k: v for k, v in out.items() if v[0] is None or v[0]["guests"] or k != "lxd"}   # an LXD client without any instance is often just the old lxc tools


def read(alias: str, tools: list[str], node: str) -> dict[str, tuple[dict | None, str]]:
    cmd = "; ".join(STEP[t] for t in tools if t in STEP)
    argv = ["bash", "-c", cmd] if alias == "local" else ["ssh", *SSH_MUX, "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, cmd]
    try:
        r = ssh_run("hypervisors", alias, argv, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return {}
    return parse(r.stdout, node)


def rows(machines_out: list[dict], sshc: dict) -> list[dict]:
    """libvirt, Incus / LXD and VirtualBox hosts followed by SSH, in the shape of the virtualization rows. Proxmox hosts are left to pve_ssh
    (they may have lxc tools too)."""
    hosts = {m["ip"]: ("local" if m.get("local") else (sshc.get(m["ip"]) or {}).get("alias"), (m.get("info") or {}).get("hypervisors") or [], m["name"])
             for m in machines_out if (m.get("info") or {}).get("hypervisors") and not (m.get("info") or {}).get("proxmox") and m.get("ssh") is not None}
    hosts = {ip: h for ip, h in hosts.items() if h[0]}
    with ThreadPoolExecutor(max(1, min(4, len(hosts)))) as ex:
        got = dict(zip(hosts, ex.map(lambda h: read(*h), hosts.values())))
    return [{"connector": kind, "name": hosts[ip][2], "label": LABEL[kind], "ok": data is not None, "stale": False,
             "message": err or f"lu par SSH ({VIA[kind]})", "version": None, "url": None, "via": "ssh", "ip": ip, **(data or {})}
            for ip, res in got.items() for kind, (data, err) in res.items()]
