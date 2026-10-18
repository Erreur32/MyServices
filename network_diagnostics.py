"""Potential problems of the network, read from the UniFi devices (their port tables) and their clients.

The main check: a port that negotiated a lower speed than it can do. The maximum of a port comes from its `media` (the controller's name for
what the port is: FE 100 Mb/s, GE 1 Gb/s, 2P5GE 2.5 Gb/s, 10GE, SFP+...). Two UniFi devices linked together are expected to run at the
slower of their two ports. A client at less than its port allows may simply have a slower network card: that one is only a hint.
Other checks: a device that is down, a WAN link that is down, a firmware update waiting, a device that is overloaded or hot or just restarted,
an access point linked by radio, a weak Wi-Fi signal, an address seen with two MAC addresses, a high latency, and, for the machines that tell it
(SSH, agent), their own network card: half duplex, a forced speed, a card that negotiates below what it can do or below its switch port.
Every finding has a `code` (what the page translates) and `args` (the figures in it); `text` is the same thing in English.
"""
from __future__ import annotations

import re

MEDIA_MAX = {"FE": 100, "GE": 1000, "2P5GE": 2500, "2.5GE": 2500, "5GE": 5000, "10GE": 10000, "SFP": 1000, "SFP+": 10000, "SFP28": 25000,
             "QSFP+": 40000, "QSFP28": 100000}
SEVERITY = {"bad": 0, "warn": 1, "info": 2}
LOAD_HIGH = 90   # %, CPU or memory of a device
TEMP_WARN, TEMP_BAD = 80, 90   # °C
REBOOT_S = 600   # a device restarted less than this long ago
WIFI_WARN, WIFI_BAD = -75, -85   # dBm
CLIENTS_HIGH = 50   # clients on one access point
LATENCY_WIRED, LATENCY_OTHER = 50, 300   # ms


def port_max(row: dict) -> int | None:
    """Highest speed (Mb/s) the port can do, from its media; None when the media is not known."""
    media = re.sub(r"\s+", "", str(row.get("media") or "")).upper()
    return MEDIA_MAX.get(media)


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def findings(devices: list[dict], clients: list[dict] | None = None, scan: list[dict] | None = None, machines: list[dict] | None = None) -> list[dict]:
    """[{severity, kind, code, args, device, port, speed, max, peer, text}] sorted by severity; never raises on odd data.
    scan: the addresses of the network scan ({ip, mac, hostname, status, ping_ms}). machines: [{name, ip, nics: [...]}] read on the machines themselves."""
    clients = [c for c in clients or [] if isinstance(c, dict)]
    scan = [d for d in scan or [] if isinstance(d, dict)]
    devices = [d for d in devices if isinstance(d, dict)]
    by_mac = {str(d.get("mac") or "").lower(): d for d in devices}
    ports = {(m, p.get("port_idx")): p for m, d in by_mac.items() for p in d.get("port_table") or [] if isinstance(p, dict)}
    seen: dict[tuple, str] = {}   # (device mac, port) -> name of what is plugged there
    for c in clients:
        if c.get("wired") and c.get("switch_mac") and c.get("switch_port") is not None:
            seen[(str(c["switch_mac"]).lower(), c["switch_port"])] = c.get("name") or c.get("ip") or c.get("mac") or "?"
    out: list[dict] = []

    def add(sev, kind, d, port, text, speed=None, mx=None, peer=None, code=None, **args):
        out.append({"severity": sev, "kind": kind, "code": code or kind, "args": args, "device": d.get("name") or d.get("model") or d.get("mac"), "mac": d.get("mac"),
                    "port": port, "speed": speed, "max": mx, "peer": peer, "text": text})

    links: set[tuple] = set()   # ports that are the two ends of a link between UniFi devices: judged together
    for mac, d in by_mac.items():
        up = d.get("uplink") if isinstance(d.get("uplink"), dict) else {}
        parent = by_mac.get(str(up.get("uplink_mac") or "").lower())
        local, remote = up.get("port_idx"), up.get("uplink_remote_port")
        if parent and (local is not None or d.get("type") == "uap"):
            lmax = port_max(ports[(mac, local)]) if (mac, local) in ports else None
            rmax = port_max(ports[(str(parent.get("mac")).lower(), remote)]) if (str(parent.get("mac")).lower(), remote) in ports else None
            if local is not None:
                links.add((mac, local))
            if remote is not None:
                links.add((str(parent.get("mac")).lower(), remote))
            speed = _num(up.get("speed"))
            caps = [x for x in (lmax, rmax) if x]
            if speed and caps and speed < min(caps):
                add("warn", "link", d, local, "link to " + str(parent.get("name") or parent.get("model")) + " runs below what both ports can do",
                    speed, min(caps), parent.get("name") or parent.get("model"), code="link_slow", peer_name=parent.get("name") or parent.get("model"))

    for mac, d in by_mac.items():
        state = d.get("state")
        if state is not None and str(state) != "1":
            add("bad", "offline", d, None, "device is not connected to the controller", code="offline")
        wan = d.get("wan1") if isinstance(d.get("wan1"), dict) else None
        if wan and wan.get("up") is False:
            add("bad", "wan", d, wan.get("port_idx"), "WAN link is down", code="wan_down")
        if d.get("upgradable"):
            add("info", "firmware", d, None, "firmware update available" + (f" ({d['upgrade_to_firmware']})" if d.get("upgrade_to_firmware") else ""),
                code="firmware", version=d.get("upgrade_to_firmware"))
        stats = d.get("system-stats") if isinstance(d.get("system-stats"), dict) else {}
        for label, v in (("CPU", _num(stats.get("cpu"))), ("memory", _num(stats.get("mem")))):
            if v is not None and v >= LOAD_HIGH:
                add("warn", "load", d, None, f"{label} at {v:.0f} %", v, LOAD_HIGH, code="load_cpu" if label == "CPU" else "load_mem", value=round(v))
        for p in d.get("port_table") or []:
            if not isinstance(p, dict) or not p.get("up") or (mac, p.get("port_idx")) in links:
                continue
            speed, mx = _num(p.get("speed")), port_max(p)
            if not speed or not mx or speed >= mx:
                continue
            peer = seen.get((mac, p.get("port_idx")))
            if speed <= 10:
                add("bad", "speed", d, p.get("port_idx"), "link at 10 Mb/s", speed, mx, peer, code="speed_10")
            elif speed <= 100:   # only a warning: many connected objects (bridges, hubs) have a 100 Mb/s card
                add("warn", "speed", d, p.get("port_idx"), "link at 100 Mb/s on a faster port (cable, or a device limited to 100 Mb/s)", speed, mx, peer, code="speed_100")
            else:
                add("info", "speed", d, p.get("port_idx"), "negotiated below the port maximum (cable, or the device's own network card)", speed, mx, peer, code="speed_low")
    # --- more checks -------------------------------------------------------------------------------------------------------------------
    for d in devices:
        up = d.get("uplink") if isinstance(d.get("uplink"), dict) else {}
        if str(up.get("type") or "").lower() in ("wireless", "wifi"):
            add("warn", "mesh", d, None, "device is linked by radio (wireless uplink): its throughput is shared with the air", code="mesh")
        t = _num(d.get("general_temperature")) or _num((d.get("system-stats") or {}).get("temps", {}).get("CPU") if isinstance(d.get("system-stats"), dict) and isinstance((d.get("system-stats") or {}).get("temps"), dict) else None)
        if t is not None and t >= TEMP_WARN:
            add("bad" if t >= TEMP_BAD else "warn", "temp", d, None, f"temperature {t:.0f} °C", t, TEMP_WARN, code="temp", value=round(t))
        upt = _num(d.get("uptime"))
        if upt is not None and 0 <= upt < REBOOT_S and str(d.get("state")) == "1":
            add("info", "reboot", d, None, "restarted a few minutes ago", code="reboot", minutes=max(1, round(upt / 60)))
        sta = _num(d.get("num_sta"))
        if d.get("type") in ("uap", "u6", "u7") and sta is not None and sta >= CLIENTS_HIGH:
            add("info", "clients", d, None, f"{sta:.0f} clients on this access point", sta, CLIENTS_HIGH, code="clients", value=round(sta))
    ap_name = {str(d.get("mac") or "").lower(): d.get("name") or d.get("model") for d in devices}
    for c in clients:
        sig = _num(c.get("signal_dbm"))
        if c.get("wired") is False and sig is not None and sig <= WIFI_WARN:
            ap = {"mac": c.get("ap_mac"), "name": ap_name.get(str(c.get("ap_mac") or "").lower()) or "?"}
            add("bad" if sig <= WIFI_BAD else "warn", "wifi", ap, None, f"weak Wi-Fi signal ({sig:.0f} dBm)", sig, WIFI_WARN, c.get("name") or c.get("ip"), code="wifi_weak", value=round(sig))
    ip_macs: dict[str, set[str]] = {}
    for src in (clients, scan):
        for x in src:
            ip, mac = x.get("ip"), str(x.get("mac") or "").lower().replace("-", ":")
            if ip and re.fullmatch(r"([0-9a-f]{2}:){5}[0-9a-f]{2}", mac):
                ip_macs.setdefault(ip, set()).add(mac)
    names: dict = {}
    for src in (clients, scan):
        for x in src:
            if x.get("ip") and (x.get("name") or x.get("hostname")):
                names.setdefault(x["ip"], x.get("name") or x.get("hostname"))
    for ip, macs in sorted(ip_macs.items()):
        if len(macs) > 1:
            add("bad", "conflict", {"name": ip, "mac": None}, None, f"address {ip} is seen with {len(macs)} different MAC addresses", peer=names.get(ip), code="ip_conflict", ip=ip, n=len(macs))
    wired_ips = {c.get("ip") for c in clients if c.get("wired") is True}
    for x in scan:
        ms = _num(x.get("ping_ms"))
        if x.get("status") != "online" or ms is None:
            continue
        wired = x.get("ip") in wired_ips
        if (wired and ms >= LATENCY_WIRED) or (not wired and ms >= LATENCY_OTHER):
            add("warn" if wired else "info", "latency", {"name": x.get("ip"), "mac": x.get("mac")}, None, f"latency {ms:.0f} ms", ms, LATENCY_WIRED if wired else LATENCY_OTHER,
                x.get("hostname") or names.get(x.get("ip")), code="latency_wired" if wired else "latency", value=round(ms))
    # --- the machines' own network cards -----------------------------------------------------------------------------------------------
    plugged = {str(c.get("mac") or "").lower().replace("-", ":"): c for c in clients if c.get("wired") and c.get("switch_mac") and c.get("switch_port") is not None}
    for m in machines or []:
        for n in (m.get("nics") or []) if isinstance(m, dict) else []:
            if not isinstance(n, dict):
                continue
            speed = _num(n.get("speed"))
            if not speed or speed <= 0:
                continue   # no negotiated speed known (link down, or not told): nothing to judge
            who = {"name": m.get("name") or m.get("ip"), "mac": n.get("mac")}
            c = plugged.get(str(n.get("mac") or "").lower())
            port = ports.get((str(c["switch_mac"]).lower(), c["switch_port"])) if c else None
            sw = by_mac.get(str(c["switch_mac"]).lower()) if c else None
            where = f"{(sw or {}).get('name') or c.get('switch_name') or '?'} port {c['switch_port']}" if c else None
            pmax = port_max(port) if port else None
            half = n.get("duplex") == "half" or n.get("full_duplex") is False
            if half:
                add("bad", "nic", who, None, "half duplex", speed, None, where, code="nic_half", nic=n.get("name"))
            setting = str(n.get("setting") or "")
            if setting and not re.search(r"auto", setting, re.I):
                add("warn", "nic", who, None, f"speed and duplex forced ({setting})", speed, None, where, code="nic_forced", setting=setting, nic=n.get("name"))
            nmax = _num(n.get("max"))
            if nmax and speed < (min(nmax, pmax) if pmax else nmax):
                add("warn", "nic", who, None, "network card negotiates below what it can do", speed, min(nmax, pmax) if pmax else nmax, where, code="nic_low", nic=n.get("name"))
            elif port and _num(port.get("speed")) and port.get("up") and _num(port.get("speed")) != speed and not nmax:
                add("warn", "nic", who, None, "card and switch port do not report the same speed", speed, _num(port.get("speed")), where, code="nic_mismatch", port_speed=_num(port.get("speed")), nic=n.get("name"))
    out.sort(key=lambda f: (SEVERITY[f["severity"]], str(f["device"]), f["port"] if isinstance(f["port"], int) else -1))
    return out


def summary(items: list[dict]) -> dict:
    return {s: sum(1 for f in items if f["severity"] == s) for s in SEVERITY}
