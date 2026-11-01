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
IMAGES = {"adguard": "adguard/adguardhome", "pihole": "pihole/pihole"}


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
    tools = {"adguard": adguard(boxes), "pihole": pihole(boxes)}
    masq = conf_files("/etc/dnsmasq.conf", "/etc/dnsmasq.d/*.conf")
    if masq:
        tools["dnsmasq"] = {"rewrites": dnsmasq_records(masq), "user_rules": []}
    unbound = conf_files("/etc/unbound/unbound.conf", "/etc/unbound/unbound.conf.d/*.conf", "/etc/unbound/conf.d/*.conf")
    if unbound:
        tools["unbound"] = {"rewrites": unbound_records(unbound), "user_rules": []}
    print(json.dumps({k: v for k, v in tools.items() if v}))


if __name__ == "__main__":
    main()
