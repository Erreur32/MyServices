"""Matching layer: one machine, everything the other tools say about it.

The same machine shows up under several names: an IP in MyServices, an IP + MAC + hostname in MynetworK, a name in Proxmox (node or guest),
a host in Dockhand and Beszel. link() ties them together, strongest key first:
  1. IP address        (MynetworK, UniFi, Beszel host, Dockhand host)
  2. MAC address       (UniFi client whose IP changed: its MAC was learnt from MynetworK on the machine's IP)
  3. name              (Proxmox nodes and guests, Beszel / Dockhand names) ; short name, no case, no domain ; only when exactly one machine has it
A name match is weaker than an address: it is flagged (`by: "name"`) so the page can say how the link was made.
What matches no machine is returned apart (`unlinked`): devices and guests seen by a tool but not followed in MyServices.
Pure function, no I/O: the collection hands it the connector rows of data.json.
"""
from __future__ import annotations

import ipaddress
import re
import urllib.parse

MAC_RE = re.compile(r"^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$")
MAX_UNLINKED = 500   # a big network is not listed in full
HYPERVISORS = ("proxmox", "pulse", "esxi", "vcenter")   # virtualization rows with nodes and guests (PBS has neither)


def norm_mac(v) -> str | None:
    s = str(v or "").strip().lower()
    if not MAC_RE.match(s):
        return None
    h = re.sub(r"[^0-9a-f]", "", s)
    return ":".join(h[i:i + 2] for i in range(0, 12, 2)).upper()


def _ip(v) -> str | None:
    try:
        return str(ipaddress.IPv4Address(str(v or "").strip()))
    except ValueError:
        return None


def host_of(v) -> str | None:
    """IP or name in « tcp://10.0.0.5:2375 », « 10.0.0.5:2375 », « https://nas.lan », « nas »."""
    s = str(v or "").strip()
    if not s:
        return None
    if "://" not in s:
        s = "//" + s
    try:
        h = urllib.parse.urlsplit(s).hostname
    except ValueError:
        return None
    return h or None


def norm_name(v) -> str | None:
    """« PVE.lan » -> « pve » ; an IP is not a name."""
    s = str(v or "").strip().lower().rstrip(".")
    if not s or _ip(s):
        return None
    s = s.split(".")[0]
    return s if re.fullmatch(r"[a-z0-9][a-z0-9_-]*", s) else None


class _Index:
    def __init__(self, machines: list[dict]):
        self.ips = {m["ip"] for m in machines if m.get("ip")}
        self.macs: dict[str, str] = {}
        self.names: dict[str, set[str]] = {}
        for m in machines:
            for n in (m.get("name"), (m.get("info") or {}).get("hostname"), (m.get("agent") or {}).get("hostname")):
                self.add_name(n, m["ip"])

    def add_name(self, n, ip: str) -> None:
        k = norm_name(n)
        if k:
            self.names.setdefault(k, set()).add(ip)

    def by_name(self, *names) -> str | None:
        for n in names:
            hit = self.names.get(norm_name(n) or "")
            if hit and len(hit) == 1:
                return next(iter(hit))
        return None

    def find(self, ip=None, mac=None, names=()) -> tuple[str | None, str | None]:
        """(machine IP, how) : by address first, then MAC, then name."""
        a = _ip(ip)
        if a in self.ips:
            return a, "ip"
        m = norm_mac(mac)
        if m and m in self.macs:
            return self.macs[m], "mac"
        hit = self.by_name(*names)
        return (hit, "name") if hit else (None, None)


def link(machines: list[dict], network: list[dict] | None = None, virtualization: list[dict] | None = None,
         containers: list[dict] | None = None, beszel: list[dict] | None = None, services: list[dict] | None = None) -> dict:
    """{"machines": {ip: {mac, vendor, names, sources, guest, hypervisor}}, "unlinked": [...]}.
    network / virtualization / containers / services: connector rows of data.json (MynetworK ; Proxmox VE and PBS ; Dockhand,
    Dozzle, Arcane, Portainer ; GpuViewR among the services).
    beszel: [{"name": instance, "systems": [...]}], read from the connectors' last result."""
    idx = _Index(machines)
    out = {m["ip"]: {"mac": None, "vendor": None, "names": [], "sources": [], "guest": None, "hypervisor": None} for m in machines if m.get("ip")}
    unlinked: list[dict] = []

    def seen(ip: str, source: str, label: str, inst: str, by: str, ok: bool = True, **ref) -> None:
        e = out[ip]
        if not any(s["source"] == source and (s["instance"] == inst or source == "unifi") for s in e["sources"]):   # UniFi via MynetworK and direct: one badge
            e["sources"].append({"source": source, "label": label, "instance": inst, "by": by, "ok": ok, **{k: v for k, v in ref.items() if v is not None}})

    def lost(source: str, label: str, inst: str, **ref) -> None:
        if len(unlinked) < MAX_UNLINKED:
            unlinked.append({"source": source, "label": label, "instance": inst, **{k: v for k, v in ref.items() if v is not None}})

    # 1. MynetworK first: it gives the MAC and the hostname that the other sources then match on
    for c in network or []:
        inst, label = c.get("name") or "", c.get("label") or "MynetworK"
        for d in c.get("devices") or []:
            ip = _ip(d.get("ip"))
            mac = norm_mac(d.get("mac"))
            if ip in out:
                e = out[ip]
                e["mac"] = e["mac"] or mac
                e["vendor"] = e["vendor"] or d.get("vendor")
                if mac:
                    idx.macs.setdefault(mac, ip)
                if d.get("hostname"):
                    idx.add_name(d["hostname"], ip)
                    e["names"].append(d["hostname"])
                seen(ip, "mynetwork", label, inst, "ip", ok=d.get("status") != "offline")
            else:
                lost("mynetwork", label, inst, ip=ip, mac=mac, name=d.get("hostname") or d.get("vendor"), online=d.get("status") == "online")
        uni = c.get("unifi") or {}
        for kind, rows in (("client", uni.get("clients")), ("device", uni.get("devices"))):
            for d in rows or []:
                ip, by = idx.find(d.get("ip"), d.get("mac"), (d.get("name"),))
                if ip:
                    out[ip]["mac"] = out[ip]["mac"] or norm_mac(d.get("mac"))
                    seen(ip, "unifi", "UniFi", inst, by, kind=kind, ap=d.get("ap_mac") or d.get("switch_mac"))

    # 2. Beszel: host is an IP or a name, else the system name
    for b in beszel or []:
        for s in b.get("systems") or []:
            h = host_of(s.get("host"))
            ip, by = idx.find(h, None, (h, s.get("name")))
            if ip:
                seen(ip, "beszel", "Beszel", b.get("name") or "", by, ok=s.get("status") == "up")
            else:
                lost("beszel", "Beszel", b.get("name") or "", ip=_ip(h), name=s.get("name"), online=s.get("status") == "up")

    # 3. Hypervisors (Proxmox VE, VMware ESXi / vCenter): nodes and guests ; a matched guest says which node it runs on. VMware Tools
    #    give a guest's IP and hostname (sure link) ; Proxmox only its name
    for c in virtualization or []:
        inst, label, src = c.get("name") or "", c.get("label") or "Proxmox", c.get("connector") or ""
        if src not in HYPERVISORS:
            ip = _ip(host_of(c.get("url")))
            if ip in out:
                seen(ip, c.get("connector") or "", label, inst, "ip", ok=bool(c.get("ok")))
            continue
        for n in c.get("nodes") or []:
            ip, by = idx.find(_ip(n.get("ip")), None, (n.get("name"),))
            target = _ip(host_of(c.get("url")))
            if not ip and src != "vcenter" and len(c.get("nodes") or []) == 1 and target in out:   # single node: the machine read (vCenter is another machine)
                ip, by = target, "ip"
            if ip:
                out[ip]["hypervisor"] = {"node": n.get("name"), "instance": inst, "source": src}
                seen(ip, src, label, inst, by, ok=bool(n.get("online")), node=n.get("name"))
        for g in c.get("guests") or []:
            if g.get("template"):
                continue
            ip, by = idx.find(_ip(g.get("ip")), None, (g.get("hostname"), g.get("name")))
            if ip:
                out[ip]["guest"] = {"vmid": g.get("vmid"), "type": g.get("type"), "node": g.get("node"), "status": g.get("status"), "instance": inst, "source": src}
                seen(ip, src, label, inst, by, ok=g.get("status") == "running", vmid=g.get("vmid"), node=g.get("node"))
            else:
                lost(src, label, inst, ip=_ip(g.get("ip")), name=g.get("name"), vmid=g.get("vmid"), type=g.get("type"), node=g.get("node"),
                     online=g.get("status") == "running")

    # 4. Dockhand, Dozzle: one environment per Docker host (local, or a remote host / agent)
    for c in containers or []:
        inst, label, src = c.get("name") or "", c.get("label") or "Dockhand", c.get("connector") or "dockhand"
        for e in c.get("environments") or []:
            h = host_of(e.get("host"))
            if h in (None, "localhost", "127.0.0.1") or str(e.get("host") or "").startswith("unix:"):
                h = host_of(c.get("url"))   # local socket: the machine Dockhand itself runs on
            ip, by = idx.find(h, None, (h, e.get("agent"), e.get("name")))
            if ip:
                seen(ip, src, label, inst, by, environment=e.get("name"), containers=(e.get("containers") or {}).get("total"))
            else:
                lost(src, label, inst, ip=_ip(h), name=e.get("name"))

    # 5. GpuViewR: its machines and their GPUs, by the addresses its agent sends (0.13+), else by name
    for c in services or []:
        if c.get("connector") != "gpuviewr":
            continue
        inst = c.get("name") or ""
        for g in c.get("machines") or []:
            ip, by = next(((a, "ip") for a in g.get("ips") or [] if _ip(a) in idx.ips), (None, None))
            if not ip:
                ip, by = idx.find(None, None, (g.get("hostname"), g.get("name")))
            if ip:
                seen(ip, "gpuviewr", "GpuViewR", inst, by, ok=bool(g.get("online")), gpus=g.get("gpus") or None, models=g.get("models") or None)
            else:
                lost("gpuviewr", "GpuViewR", inst, ip=next(iter(g.get("ips") or []), None), name=g.get("name"), online=g.get("online"))

    for e in out.values():
        e["names"] = sorted(set(e["names"]))
    return {"machines": out, "unlinked": unlinked}
