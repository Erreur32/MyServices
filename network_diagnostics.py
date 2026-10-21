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

import json
import re
from pathlib import Path

MEDIA_MAX = {"FE": 100, "GE": 1000, "2P5GE": 2500, "2.5GE": 2500, "5GE": 5000, "10GE": 10000, "SFP": 1000, "SFP+": 10000, "SFP28": 25000,
             "QSFP+": 40000, "QSFP28": 100000}
SEVERITY = {"bad": 0, "warn": 1, "info": 2}
LOAD_HIGH = 90   # %, CPU or memory of a device
TEMP_WARN, TEMP_BAD = 80, 90   # °C
REBOOT_S = 600   # a device restarted less than this long ago
WIFI_WARN, WIFI_BAD = -75, -85   # dBm
CLIENTS_HIGH = 50   # clients on one access point
LATENCY_WIRED, LATENCY_OTHER = 50, 300   # ms
SFP_TEMP_WARN, SFP_TEMP_BAD = 75, 85   # °C, the case of a transceiver (most are rated 0-70 °C, 10GBASE-T copper ones run hotter)
SFP_RX_WARN, SFP_RX_BAD, SFP_RX_HIGH = -14, -18, 0.5   # dBm received: little margin left, no light to speak of, enough to blind the receiver
SFP_VOLT_LOW, SFP_VOLT_HIGH = 3.13, 3.47   # V, the 3.3 V supply ± 5 %
PORT_COUNTERS = ("rx_errors", "tx_errors", "rx_dropped", "tx_dropped")


def port_max(row: dict) -> int | None:
    """Highest speed (Mb/s) the port can do, from its media; None when the media is not known."""
    media = re.sub(r"\s+", "", str(row.get("media") or "")).upper()
    return MEDIA_MAX.get(media)


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _norm_mac(v) -> str:
    return str(v or "").lower().replace("-", ":")


def _dict(v) -> dict:
    return v if isinstance(v, dict) else {}


def _nics_of(m) -> list:
    """The network cards listed on one machine record (empty when the record is odd)."""
    return (m.get("nics") or []) if isinstance(m, dict) else []


def _nic_duplex(n: dict) -> str | None:
    half = n.get("duplex") == "half" or n.get("full_duplex") is False
    if half and _num(n.get("speed")):
        return "half"
    if n.get("duplex") == "full" or n.get("full_duplex"):
        return "full"
    return None


def nic_index(machines: list[dict] | None) -> dict[str, dict]:
    """{mac: {machine, name, speed, max, duplex, setting}} of the network cards the machines reported."""
    out = {}
    for m in machines or []:
        for n in _nics_of(m):
            if isinstance(n, dict) and n.get("mac"):
                out[_norm_mac(n["mac"])] = {"machine": m.get("name") or m.get("ip"), "name": n.get("name"), "speed": _num(n.get("speed")) or None, "max": _num(n.get("max")),
                                             "duplex": _nic_duplex(n), "setting": n.get("setting")}
    return out


def _wired_clients(clients: list[dict] | None) -> list[dict]:
    """The wired clients that report the switch port they are plugged into."""
    return [c for c in clients or [] if isinstance(c, dict) and c.get("wired") and c.get("switch_mac") and c.get("switch_port") is not None]


class _Ctx:
    """What the checks share: the cleaned inputs, the lookups built from them and the findings found so far."""

    def __init__(self, devices, clients, scan, machines):
        self.clients = [c for c in clients or [] if isinstance(c, dict)]
        self.scan = [d for d in scan or [] if isinstance(d, dict)]
        self.devices = [d for d in devices if isinstance(d, dict)]
        self.machines = machines
        self.by_mac = {str(d.get("mac") or "").lower(): d for d in self.devices}
        self.ports = {(m, p.get("port_idx")): p for m, d in self.by_mac.items() for p in d.get("port_table") or [] if isinstance(p, dict)}
        self.seen: dict[tuple, str] = {}   # (device mac, port) -> name of what is plugged there
        self.seen_mac: dict[tuple, str] = {}   # (device mac, port) -> MAC of what is plugged there
        for c in _wired_clients(self.clients):
            key = (str(c["switch_mac"]).lower(), c["switch_port"])
            self.seen[key] = c.get("name") or c.get("ip") or c.get("mac") or "?"
            self.seen_mac[key] = _norm_mac(c.get("mac"))
        self.cards = nic_index(machines)
        self.out: list[dict] = []
        self.links: set[tuple] = set()   # ports that are the two ends of a link between UniFi devices: judged together

    def add(self, sev, kind, d, port, text, speed=None, mx=None, peer=None, code=None, **args):
        key = (str(d.get("mac") or "").lower(), port)
        self.out.append({"severity": sev, "kind": kind, "code": code or kind, "args": args, "device": d.get("name") or d.get("model") or d.get("mac"), "mac": d.get("mac"),
                         "port": port, "speed": speed, "max": mx, "peer": peer, "text": text,
                         "nic": self.cards.get(self.seen_mac.get(key, "")) if kind in ("speed", "link") else None})   # the machine's own card, side by side with the port


def _check_uplink(ctx: _Ctx, mac: str, d: dict) -> None:
    up = _dict(d.get("uplink"))
    parent = ctx.by_mac.get(str(up.get("uplink_mac") or "").lower())
    local, remote = up.get("port_idx"), up.get("uplink_remote_port")
    if not parent or (local is None and d.get("type") != "uap"):
        return
    pmac = str(parent.get("mac")).lower()
    lmax = port_max(ctx.ports[(mac, local)]) if (mac, local) in ctx.ports else None
    rmax = port_max(ctx.ports[(pmac, remote)]) if (pmac, remote) in ctx.ports else None
    if local is not None:
        ctx.links.add((mac, local))
    if remote is not None:
        ctx.links.add((pmac, remote))
    speed = _num(up.get("speed"))
    caps = [x for x in (lmax, rmax) if x]
    if speed and caps and speed < min(caps):
        pname = parent.get("name") or parent.get("model")
        ctx.add("warn", "link", d, local, "link to " + str(pname) + " runs below what both ports can do",
                speed, min(caps), pname, code="link_slow", peer_name=pname)


def _check_links(ctx: _Ctx) -> None:
    for mac, d in ctx.by_mac.items():
        _check_uplink(ctx, mac, d)


def _check_state(ctx: _Ctx, d: dict) -> None:
    state = d.get("state")
    if state is not None and str(state) != "1":
        ctx.add("bad", "offline", d, None, "device is not connected to the controller", code="offline")
    wan = d.get("wan1") if isinstance(d.get("wan1"), dict) else None
    if wan and wan.get("up") is False:
        ctx.add("bad", "wan", d, wan.get("port_idx"), "WAN link is down", code="wan_down")
    if d.get("upgradable"):
        ctx.add("info", "firmware", d, None, "firmware update available" + (f" ({d['upgrade_to_firmware']})" if d.get("upgrade_to_firmware") else ""),
                code="firmware", version=d.get("upgrade_to_firmware"))


def _check_load(ctx: _Ctx, d: dict) -> None:
    stats = _dict(d.get("system-stats"))
    for label, code, v in (("CPU", "load_cpu", _num(stats.get("cpu"))), ("memory", "load_mem", _num(stats.get("mem")))):
        if v is not None and v >= LOAD_HIGH:
            ctx.add("warn", "load", d, None, f"{label} at {v:.0f} %", v, LOAD_HIGH, code=code, value=round(v))


def _port_speed_finding(speed: float) -> tuple[str, str, str]:
    """(severity, text, code) of a port that negotiated below its maximum."""
    if speed <= 10:
        return "bad", "link at 10 Mb/s", "speed_10"
    if speed <= 100:   # only a warning: many connected objects (bridges, hubs) have a 100 Mb/s card
        return "warn", "link at 100 Mb/s on a faster port (cable, or a device limited to 100 Mb/s)", "speed_100"
    return "info", "negotiated below the port maximum (cable, or the device's own network card)", "speed_low"


def _check_port(ctx: _Ctx, mac: str, d: dict, p: dict) -> None:
    if not isinstance(p, dict) or not p.get("up") or (mac, p.get("port_idx")) in ctx.links:
        return
    speed, mx = _num(p.get("speed")), port_max(p)
    plugged_machine = ctx.seen_mac.get((mac, p.get("port_idx"))) in ctx.cards   # a machine we follow (SSH, agent), not a connected object
    if not speed or not mx or (speed >= mx and not (speed <= 100 and plugged_machine)):
        return
    sev, text, code = _port_speed_finding(speed)
    ctx.add(sev, "speed", d, p.get("port_idx"), text, speed, mx, ctx.seen.get((mac, p.get("port_idx"))), code=code)


def _check_devices(ctx: _Ctx) -> None:
    for mac, d in ctx.by_mac.items():
        _check_state(ctx, d)
        _check_load(ctx, d)
        for p in d.get("port_table") or []:
            _check_port(ctx, mac, d, p)
            _check_sfp(ctx, d, p)


def _copper(p: dict) -> bool:
    """A 10GBASE-T (RJ45) module: no light, its « received » and « sent » figures mean nothing."""
    return "BASE-T" in str(p.get("sfp_compliance") or "").upper() or bool(re.search(r"10G-?T\b", str(p.get("sfp_part") or ""), re.I))


def sfp_reading(p: dict) -> dict | None:
    """The sensors of the transceiver in a port (DOM), None when the port has none."""
    if not isinstance(p, dict) or p.get("sfp_found") is not True:
        return None
    copper = _copper(p)
    return {"part": p.get("sfp_part"), "vendor": p.get("sfp_vendor"), "compliance": p.get("sfp_compliance"), "copper": copper,
            "temp": _num(p.get("sfp_temperature")), "voltage": _num(p.get("sfp_voltage")), "current": _num(p.get("sfp_current")),
            "rx": None if copper else _num(p.get("sfp_rxpower")), "tx": None if copper else _num(p.get("sfp_txpower")),
            "los": p.get("sfp_rx_los") is True or p.get("sfp_rxfault") is True, "fault": p.get("sfp_tx_fault") is True or p.get("sfp_txfault") is True}


def _sfp_light(rx: float | None) -> list[tuple[str, str, str, dict]]:
    if rx is None:
        return []
    if rx > SFP_RX_HIGH:
        return [("bad", "sfp_rx_high", f"received light too strong ({rx:.1f} dBm): an attenuator is missing", {"value": round(rx, 1)})]
    if rx < SFP_RX_WARN:
        sev = "bad" if rx < SFP_RX_BAD else "warn"
        return [(sev, "sfp_rx_low", f"received light weak ({rx:.1f} dBm): fibre, connector or far end to check", {"value": round(rx, 1)})]
    return []


def sfp_problems(r: dict) -> list[tuple[str, str, str, dict]]:
    """(severity, code, text, args) of each problem of one transceiver reading."""
    out = []
    if r["los"]:
        out.append(("bad", "sfp_los", "the transceiver receives no signal (loss of signal)", {}))
    if r["fault"]:
        out.append(("bad", "sfp_fault", "the transceiver reports a transmit fault", {}))
    t = r["temp"]
    if t is not None and t >= SFP_TEMP_WARN:
        out.append(("bad" if t >= SFP_TEMP_BAD else "warn", "sfp_temp", f"transceiver hot ({t:.0f} °C)", {"value": round(t), "limit": SFP_TEMP_WARN}))
    out += _sfp_light(r["rx"])
    v = r["voltage"]
    if v is not None and not SFP_VOLT_LOW <= v <= SFP_VOLT_HIGH:
        out.append(("warn", "sfp_volt", f"transceiver supply at {v:.2f} V", {"value": round(v, 2)}))
    return out


def _check_sfp(ctx: _Ctx, d: dict, p: dict) -> None:
    r = sfp_reading(p)
    if not r:
        return
    module = " ".join(x for x in (r["part"], f"({r['vendor']})" if r["vendor"] else "") if x)
    for sev, code, text, args in sfp_problems(r):
        ctx.add(sev, "sfp", d, p.get("port_idx"), text, code=code, module=module, **args)


def _temperature(d: dict) -> float | None:
    t = _num(d.get("general_temperature"))
    if t:
        return t
    temps = _dict(d.get("system-stats")).get("temps")
    return _num(temps.get("CPU")) if isinstance(temps, dict) else None


def _check_device_extras(ctx: _Ctx) -> None:
    for d in ctx.devices:
        if str(_dict(d.get("uplink")).get("type") or "").lower() in ("wireless", "wifi"):
            ctx.add("warn", "mesh", d, None, "device is linked by radio (wireless uplink): its throughput is shared with the air", code="mesh")
        _check_temp_and_uptime(ctx, d)
        sta = _num(d.get("num_sta"))
        if d.get("type") in ("uap", "u6", "u7") and sta is not None and sta >= CLIENTS_HIGH:
            ctx.add("info", "clients", d, None, f"{sta:.0f} clients on this access point", sta, CLIENTS_HIGH, code="clients", value=round(sta))


def _check_temp_and_uptime(ctx: _Ctx, d: dict) -> None:
    t = _temperature(d)
    if t is not None and t >= TEMP_WARN:
        ctx.add("bad" if t >= TEMP_BAD else "warn", "temp", d, None, f"temperature {t:.0f} °C", t, TEMP_WARN, code="temp", value=round(t))
    upt = _num(d.get("uptime"))
    if upt is not None and 0 <= upt < REBOOT_S and str(d.get("state")) == "1":
        ctx.add("info", "reboot", d, None, "restarted a few minutes ago", code="reboot", minutes=max(1, round(upt / 60)))


def _check_wifi(ctx: _Ctx) -> None:
    ap_name = {str(d.get("mac") or "").lower(): d.get("name") or d.get("model") for d in ctx.devices}
    for c in ctx.clients:
        sig = _num(c.get("signal_dbm"))
        if c.get("wired") is False and sig is not None and sig <= WIFI_WARN:
            ap = {"mac": c.get("ap_mac"), "name": ap_name.get(str(c.get("ap_mac") or "").lower()) or "?"}
            ctx.add("bad" if sig <= WIFI_BAD else "warn", "wifi", ap, None, f"weak Wi-Fi signal ({sig:.0f} dBm)", sig, WIFI_WARN, c.get("name") or c.get("ip"), code="wifi_weak", value=round(sig))


def _known_names(ctx: _Ctx) -> dict:
    """{ip: name} from the clients, then the scan (the first name wins)."""
    names: dict = {}
    for src in (ctx.clients, ctx.scan):
        for x in src:
            if x.get("ip") and (x.get("name") or x.get("hostname")):
                names.setdefault(x["ip"], x.get("name") or x.get("hostname"))
    return names


def _check_conflicts(ctx: _Ctx, names: dict) -> None:
    ip_macs: dict[str, set[str]] = {}
    for src in (ctx.clients, ctx.scan):
        for x in src:
            ip, mac = x.get("ip"), _norm_mac(x.get("mac"))
            if ip and re.fullmatch(r"([0-9a-f]{2}:){5}[0-9a-f]{2}", mac):
                ip_macs.setdefault(ip, set()).add(mac)
    for ip, macs in sorted(ip_macs.items()):
        if len(macs) > 1:
            ctx.add("bad", "conflict", {"name": ip, "mac": None}, None, f"address {ip} is seen with {len(macs)} different MAC addresses", peer=names.get(ip), code="ip_conflict", ip=ip, n=len(macs))


def _check_latency(ctx: _Ctx, names: dict) -> None:
    wired_ips = {c.get("ip") for c in ctx.clients if c.get("wired") is True}
    for x in ctx.scan:
        ms = _num(x.get("ping_ms"))
        if x.get("status") != "online" or ms is None:
            continue
        wired = x.get("ip") in wired_ips
        limit = LATENCY_WIRED if wired else LATENCY_OTHER
        if ms >= limit:
            ctx.add("warn" if wired else "info", "latency", {"name": x.get("ip"), "mac": x.get("mac")}, None, f"latency {ms:.0f} ms", ms, limit,
                    x.get("hostname") or names.get(x.get("ip")), code="latency_wired" if wired else "latency", value=round(ms))


def _nic_where(ctx: _Ctx, c: dict | None) -> str | None:
    """Where a card is plugged, as « switch port N » (None when unknown)."""
    if not c:
        return None
    sw = ctx.by_mac.get(str(c["switch_mac"]).lower())
    return f"{(sw or {}).get('name') or c.get('switch_name') or '?'} port {c['switch_port']}"


def _check_nic_speed(ctx: _Ctx, who: dict, n: dict, speed: float, port: dict | None, c: dict | None, where: str | None, slow_ports: set) -> None:
    pmax = port_max(port) if port else None
    nmax = _num(n.get("max"))
    nic = n.get("name")
    if nmax and speed < (min(nmax, pmax) if pmax else nmax):
        ctx.add("warn", "nic", who, None, "network card negotiates below what it can do", speed, min(nmax, pmax) if pmax else nmax, where, code="nic_low", nic=nic)
    elif port and _num(port.get("speed")) and port.get("up") and _num(port.get("speed")) != speed and not nmax:
        ctx.add("warn", "nic", who, None, "card and switch port do not report the same speed", speed, _num(port.get("speed")), where, code="nic_mismatch", port_speed=_num(port.get("speed")), nic=nic)
    elif speed <= 100 and not (port and (str(c["switch_mac"]).lower(), c["switch_port"]) in slow_ports):   # rare on a machine (a connected object is another story)
        ctx.add("warn", "nic", who, None, "network card at 100 Mb/s or less", speed, None, where, code="nic_slow", nic=nic)


def _check_nic(ctx: _Ctx, m: dict, n, slow_ports: set, plugged: dict) -> None:
    if not isinstance(n, dict):
        return
    speed = _num(n.get("speed"))
    if not speed or speed <= 0:
        return   # no negotiated speed known (link down, or not told): nothing to judge
    who = {"name": m.get("name") or m.get("ip"), "mac": n.get("mac")}
    c = plugged.get(str(n.get("mac") or "").lower())
    port = ctx.ports.get((str(c["switch_mac"]).lower(), c["switch_port"])) if c else None
    where = _nic_where(ctx, c)
    if n.get("duplex") == "half" or n.get("full_duplex") is False:
        ctx.add("bad", "nic", who, None, "half duplex", speed, None, where, code="nic_half", nic=n.get("name"))
    setting = str(n.get("setting") or "")
    if setting and not re.search(r"auto", setting, re.I):
        ctx.add("warn", "nic", who, None, f"speed and duplex forced ({setting})", speed, None, where, code="nic_forced", setting=setting, nic=n.get("name"))
    _check_nic_speed(ctx, who, n, speed, port, c, where, slow_ports)


def _check_nics(ctx: _Ctx) -> None:
    slow_ports = {(str(f.get("mac") or "").lower(), f.get("port")) for f in ctx.out if f["kind"] == "speed"}   # ports already reported from the switch side
    plugged = {_norm_mac(c.get("mac")): c for c in _wired_clients(ctx.clients)}
    for m in ctx.machines or []:
        for n in _nics_of(m):
            _check_nic(ctx, m, n, slow_ports, plugged)


def findings(devices: list[dict], clients: list[dict] | None = None, scan: list[dict] | None = None, machines: list[dict] | None = None) -> list[dict]:
    """[{severity, kind, code, args, device, port, speed, max, peer, text}] sorted by severity; never raises on odd data.
    scan: the addresses of the network scan ({ip, mac, hostname, status, ping_ms}). machines: [{name, ip, nics: [...]}] read on the machines themselves."""
    ctx = _Ctx(devices, clients, scan, machines)
    _check_links(ctx)
    _check_devices(ctx)
    _check_device_extras(ctx)
    _check_wifi(ctx)
    names = _known_names(ctx)
    _check_conflicts(ctx, names)
    _check_latency(ctx, names)
    _check_nics(ctx)
    ctx.out.sort(key=lambda f: (SEVERITY[f["severity"]], str(f["device"]), f["port"] if isinstance(f["port"], int) else -1))
    return ctx.out


def _ok_port_row(d: dict, mac: str, p: dict, peer, cards: dict, seen_mac: dict) -> dict:
    return {"device": d.get("name") or d.get("model") or d.get("mac"), "mac": d.get("mac"), "port": p.get("port_idx"), "speed": _num(p.get("speed")),
            "max": port_max(p), "peer": peer, "name": p.get("name"), "nic": cards.get(seen_mac.get((mac, p.get("port_idx")), ""))}


def ok_ports(devices: list[dict], clients: list[dict] | None, items: list[dict], machines: list[dict] | None = None) -> list[dict]:
    """The ports that are up and have no finding: [{device, mac, port, speed, max, peer, name}] (the page shows them on request only)."""
    flagged = {(str(f.get("mac") or "").lower(), f.get("port")) for f in items if f.get("port") is not None}
    wired = _wired_clients(clients)
    seen = {(str(c["switch_mac"]).lower(), c["switch_port"]): c.get("name") or c.get("ip") or c.get("mac") for c in wired}
    seen_mac = {(str(c["switch_mac"]).lower(), c["switch_port"]): _norm_mac(c.get("mac")) for c in wired}
    cards = nic_index(machines)
    names = {str(d.get("mac") or "").lower(): d.get("name") or d.get("model") for d in devices if isinstance(d, dict)}
    out = []
    for d in devices:
        if not isinstance(d, dict):
            continue
        mac = str(d.get("mac") or "").lower()
        up = _dict(d.get("uplink"))
        for p in d.get("port_table") or []:
            if not isinstance(p, dict) or not p.get("up") or (mac, p.get("port_idx")) in flagged:
                continue
            peer = seen.get((mac, p.get("port_idx")))
            if peer is None and (p.get("is_uplink") or p.get("port_idx") == up.get("port_idx")):
                peer = names.get(str(up.get("uplink_mac") or "").lower())
            out.append(_ok_port_row(d, mac, p, peer, cards, seen_mac))
    out.sort(key=lambda r: (str(r["device"]), r["port"] if isinstance(r["port"], int) else -1))
    return out


def _device_name(d: dict) -> str:
    return d.get("name") or d.get("model") or d.get("mac") or "?"


def sfp_modules(devices: list[dict]) -> list[dict]:
    """Every transceiver found, with its readings and its state (« ok », « warn », « bad ») and problem codes, for the « SFP modules » table."""
    out = []
    for d in devices:
        for p in (d.get("port_table") or []) if isinstance(d, dict) else []:
            r = sfp_reading(p)
            if r:
                probs = sfp_problems(r)
                state = min((x[0] for x in probs), key=SEVERITY.get, default="ok")
                out.append({"device": _device_name(d), "mac": d.get("mac"), "port": p.get("port_idx"), **r, "state": state, "codes": [x[1] for x in probs]})
    return sorted(out, key=lambda m: (str(m["device"]), m["port"] if isinstance(m["port"], int) else -1))


def port_errors(devices: list[dict]) -> dict:
    """The error counters of the ports, when the source gives them: {known, ports: [{device, port, rx_errors, tx_errors, rx_dropped, tx_dropped}]}
    with only the ports that have some, the most affected first. known is False while no port reports any counter (MynetworK without them)."""
    known, ports = False, []
    for d in devices:
        for p in (d.get("port_table") or []) if isinstance(d, dict) else []:
            counts = {k: _num(p.get(k)) for k in PORT_COUNTERS} if isinstance(p, dict) else {}
            if any(v is not None for v in counts.values()):
                known = True
                if any(counts.values()):
                    ports.append({"device": _device_name(d), "mac": d.get("mac"), "port": p.get("port_idx"), **{k: v or 0 for k, v in counts.items()}})
    ports.sort(key=lambda x: -sum(x[k] for k in PORT_COUNTERS))
    return {"known": known, "ports": ports}


def summary(items: list[dict]) -> dict:
    return {s: sum(1 for f in items if f["severity"] == s and not f.get("accepted")) for s in SEVERITY}


def finding_key(f: dict) -> str:
    """Stable identity of a finding, to remember « this one is fine »: device MAC, check, port and network card."""
    return "|".join([str(f.get("mac") or "").lower(), str(f.get("code") or ""), str(f.get("port") if f.get("port") is not None else ""), str((f.get("args") or {}).get("nic") or "")])


def accepted_keys(path: str | Path) -> dict[str, str]:
    """{key: label} of the findings the admin marked as normal (a missing or odd file is an empty list)."""
    try:
        got = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {str(k): str(v)[:200] for k, v in got.items()} if isinstance(got, dict) else {}


def set_accepted(path: str | Path, key: str, label: str, on: bool) -> None:
    """Mark (or unmark) a finding as normal; written whole then renamed."""
    if not key or len(key) > 200:
        raise ValueError("clé invalide")
    f, cur = Path(path), accepted_keys(path)
    if on:
        cur[key] = label
    else:
        cur.pop(key, None)
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f.name + ".tmp")
    tmp.write_text(json.dumps(dict(list(cur.items())[-500:]), ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)


def mark_accepted(items: list[dict], accepted: dict[str, str]) -> list[dict]:
    """Add `key` and `accepted` to every finding."""
    for f in items:
        f["key"] = finding_key(f)
        f["accepted"] = f["key"] in accepted
    return items
