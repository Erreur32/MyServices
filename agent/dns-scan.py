#!/usr/bin/env python3
# Root read of the local DNS records of this machine, set by the agent's installer (MSV_DNS=1). It takes no input: the tools are found here, and
# only their own records and rules are printed, never an account or a key. The parsers of AdGuardHome.yaml are added by the server when it serves
# this file (connectors/adguard.py).
import glob
import json
import os
import re
import subprocess

ADGUARD_FILES = ("/opt/AdGuardHome/AdGuardHome.yaml", "/var/snap/adguard-home/current/AdGuardHome.yaml")
ADGUARD_IN_DOCKER = "/opt/adguardhome/conf/AdGuardHome.yaml"
IMAGES = {"adguard": "adguard/adguardhome", "pihole": "pihole/pihole", "bind": "bind9"}
BIND_CONF = ("/etc/bind/named.conf", "/etc/named.conf")
ZONE_TYPES = ("master", "primary", "secondary", "slave")


def rec(name, answer):
    return {"domain": name.strip().rstrip(".").lower(), "answer": answer.strip(), "enabled": True}


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def docker(*args):
    try:
        r = subprocess.run(["docker", *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.decode("utf-8", "replace") if r.returncode == 0 else None


def containers():
    """{tool: first running container of its image}."""
    found = {}
    for line in (docker("ps", "--format", "{{.Names}} {{.Image}}") or "").splitlines():
        name, _, image = line.partition(" ")
        for tool, wanted in IMAGES.items():
            if wanted in image:
                found.setdefault(tool, name)
    return found


def pihole_records(toml, custom):
    """v6: the hosts list of pihole.toml, « IP name » each; v5: custom.list, same lines."""
    out = []
    m = re.search(r"^\s*hosts\s*=\s*\[(.*?)\]", toml or "", re.M | re.S)
    lines = re.findall(r'"([^"]+)"', m.group(1)) if m else []
    for line in lines + (custom or "").splitlines():
        p = line.split("#")[0].split()
        out += [rec(n, p[0]) for n in p[1:]]
    return out


def dnsmasq_records(text):
    out = []
    for m in re.finditer(r"^\s*address=/([^/\s]+)/([^\s#]+)", text, re.M):
        out.append(rec(m.group(1), m.group(2)))
    for m in re.finditer(r"^\s*host-record=([^\s#]+)", text, re.M):
        parts = m.group(1).split(",")
        ips = [p for p in parts if re.fullmatch(r"[0-9a-fA-F.:]+", p) and ("." in p or ":" in p) and not re.search(r"[g-zG-Z]", p)]
        names = [p for p in parts if p not in ips and not p.isdigit()]
        out += [rec(n, ips[0]) for n in names if ips]
    return out


def unbound_records(text):
    return [rec(m.group(1), m.group(2)) for m in re.finditer(r"""^\s*local-data:\s*["']([^\s"']+)(?:\s+\d+)?\s+(?:IN\s+)?(?:A|AAAA)\s+([^\s"']+)""", text, re.M)]


def bind_zones(cat):
    """([(zone, file)] of the zones this server holds, the folder of relative files), from named.conf and what it includes."""
    todo, seen, zones, base = list(BIND_CONF), set(), [], "/var/cache/bind"
    while todo:
        path = todo.pop()
        if path in seen:
            continue
        seen.add(path)
        text = re.sub(r"(//|#).*", "", cat(path) or "")
        todo += re.findall(r'^\s*include\s+"([^"]+)"', text, re.M)
        folder = re.search(r'\bdirectory\s+"([^"]+)"', text)
        base = folder.group(1) if folder else base
        for chunk in re.split(r'\bzone\s+"', text)[1:]:
            name = chunk.split('"', 1)[0].rstrip(".")
            kind, file = re.search(r"\btype\s+(\w+)", chunk), re.search(r'\bfile\s+"([^"]+)"', chunk)
            if kind and file and kind.group(1) in ZONE_TYPES and name and name != "localhost" and not name.endswith(".arpa"):
                zones.append((name, file.group(1)))
    return zones, base


def zone_name(owner, origin):
    if owner == "@":
        return origin
    return owner if owner.endswith(".") else owner + "." + origin


def zone_records(zone, text):
    """A and AAAA records of a zone file: a line without a name keeps the previous one, a relative name gets the $ORIGIN."""
    origin, owner, out = zone.rstrip(".") + ".", "@", []
    for raw in text.splitlines():
        line = raw.split(";", 1)[0].rstrip()
        if line.upper().startswith("$ORIGIN"):
            origin = line.split()[1]
        if not line or line.startswith("$"):
            continue
        fields = line.split()
        if not line[0].isspace():
            owner = fields.pop(0)
        while fields and (re.fullmatch(r"\d+[smhdwSMHDW]?", fields[0]) or fields[0].upper() == "IN"):
            fields.pop(0)
        if len(fields) >= 2 and fields[0].upper() in ("A", "AAAA"):
            out.append(rec(zone_name(owner, origin), fields[1]))
    return out


def bind(boxes):
    if any(os.path.exists(p) for p in BIND_CONF):
        cat = read
    elif "bind" in boxes:
        cat = lambda path: docker("exec", boxes["bind"], "cat", path)
    else:
        return None
    zones, base = bind_zones(cat)
    found = [x for zone, file in zones for x in zone_records(zone, cat(os.path.join(base, file)) or "")]
    return {"rewrites": found, "user_rules": []} if zones else None


def conf_files(*patterns):
    return "\n".join(read(f) or "" for p in patterns for f in sorted(glob.glob(p)))


def adguard(boxes):
    text = next((t for t in map(read, ADGUARD_FILES) if t), None)
    version = None
    if text is None and "adguard" in boxes:
        text = docker("exec", boxes["adguard"], "cat", ADGUARD_IN_DOCKER)
        label = docker("inspect", "-f", '{{index .Config.Labels "org.opencontainers.image.version"}}', boxes["adguard"])
        version = (label or "").strip().lstrip("v") or None
        version = None if version == "<no value>" else version
    return dict(parse_yaml(text), version=version) if text else None   # noqa: F821, added by the server


def pihole(boxes):
    if os.path.isdir("/etc/pihole"):
        toml, custom = read("/etc/pihole/pihole.toml"), read("/etc/pihole/custom.list")
    elif "pihole" in boxes:
        toml, custom = docker("exec", boxes["pihole"], "cat", "/etc/pihole/pihole.toml"), docker("exec", boxes["pihole"], "cat", "/etc/pihole/custom.list")
    else:
        return None
    return {"rewrites": pihole_records(toml, custom), "user_rules": []}


def main():
    boxes = containers()
    tools = {"adguard": adguard(boxes), "pihole": pihole(boxes), "bind": bind(boxes)}
    masq = conf_files("/etc/dnsmasq.conf", "/etc/dnsmasq.d/*.conf")
    if masq:
        tools["dnsmasq"] = {"rewrites": dnsmasq_records(masq), "user_rules": []}
    unbound = conf_files("/etc/unbound/unbound.conf", "/etc/unbound/unbound.conf.d/*.conf", "/etc/unbound/conf.d/*.conf")
    if unbound:
        tools["unbound"] = {"rewrites": unbound_records(unbound), "user_rules": []}
    print(json.dumps({k: v for k, v in tools.items() if v}))


if __name__ == "__main__":
    main()
