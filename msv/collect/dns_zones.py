"""Who runs the DNS of each domain, read from its NS records. Asked of the DNS servers of the page, never of a public resolver, so an internal
name stays at home. At most once a day per domain, kept in a small cache file."""
from __future__ import annotations

import json
import os
import secrets
import socket
import struct
import time

NS_TYPE = 2
IN_CLASS = 1
TIMEOUT = 2.0
MAX_AGE_S = 86400
POINTER = 0xC0
MAX_JUMPS = 16   # a looping compressed name in a broken answer stops here
# Part of the name of a NS -> its DNS host; any other host shows the domain of its NS
PROVIDERS = {"cloudflare.com": "Cloudflare", "ovh.net": "OVH", "anycast.me": "OVH", "dns-parking.com": "Hostinger", "hostinger.": "Hostinger", "gandi.net": "Gandi",
             "domaincontrol.com": "GoDaddy", "registrar-servers.com": "Namecheap", "digitalocean.com": "DigitalOcean", "hetzner.": "Hetzner", "first-ns.de": "Hetzner",
             "ui-dns.": "IONOS", ".awsdns-": "AWS Route 53", "googledomains.com": "Google Cloud", "azure-dns.": "Azure", "scw.cloud": "Scaleway", "infomaniak.": "Infomaniak",
             "porkbun.com": "Porkbun", "vultr.com": "Vultr", "linode.com": "Linode"}


def root_of(name: str) -> str | None:
    """The domain a name belongs to. shortcut: its last two labels, gives the registry for co.uk-like suffixes, add a suffix list if one matters."""
    labels = name.lower().rstrip(".").removeprefix("*.").split(".")
    return ".".join(labels[-2:]) if len(labels) >= 2 else None


def _read_name(data: bytes, pos: int) -> tuple[str, int]:
    """A name of a DNS message, compressed or not, and the position after it."""
    labels, end, jumps = [], None, 0
    while data[pos]:
        if data[pos] >= POINTER:
            end = end or pos + 2
            pos = struct.unpack(">H", data[pos:pos + 2])[0] & 0x3FFF
            jumps += 1
            if jumps > MAX_JUMPS:
                raise ValueError("looping name")
            continue
        size = data[pos]
        labels.append(data[pos + 1:pos + 1 + size].decode("ascii", "replace"))
        pos += size + 1
    return ".".join(labels).lower(), end or pos + 1


def parse_ns(data: bytes) -> list[str]:
    """The name servers of an answer."""
    questions, answers = struct.unpack(">HH", data[4:8])
    pos, out = 12, []
    for _ in range(questions):
        pos = _read_name(data, pos)[1] + 4
    for _ in range(answers):
        pos = _read_name(data, pos)[1]
        kind, _cls, _ttl, size = struct.unpack(">HHIH", data[pos:pos + 10])
        pos += 10
        if kind == NS_TYPE:
            out.append(_read_name(data, pos)[0])
        pos += size
    return sorted(out)


def ask_ns(server: str, domain: str, timeout: float = TIMEOUT) -> list[str] | None:
    """The NS of a domain ([]: it has none, an internal name), None without an answer."""
    qid = secrets.randbelow(65536)
    query = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + b"".join(bytes([len(x)]) + x.encode("ascii", "replace") for x in domain.split(".")) + b"\0" + struct.pack(">HH", NS_TYPE, IN_CLASS)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(timeout)
            s.sendto(query, (server, 53))
            data = s.recv(4096)
        return parse_ns(data) if data[:2] == query[:2] else None
    except (OSError, struct.error, IndexError, ValueError):
        return None


def provider(servers: list[str]) -> str | None:
    """The DNS host behind name servers: its name when known, else the domain of the first one."""
    for ns in servers:
        for mark, name in PROVIDERS.items():
            if mark in ns:
                return name
    return root_of(servers[0]) if servers else None


def _read(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            found = json.load(f)
        return found if isinstance(found, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path: str, seen: dict) -> None:
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(seen, f)
        os.replace(tmp, path)
    except OSError:
        pass   # no cache: the next collection asks again


def _first_answer(servers: list[str], domain: str, ask) -> list[str] | None:
    for server in servers:
        got = ask(server, domain)
        if got is not None:
            return got
    return None


def zones(servers: list[str], names: list[str], path: str, now: float | None = None, ask=ask_ns) -> dict[str, str]:
    """{domain: who runs its DNS} for the domains of these names. A domain without NS (an internal name) is left out; one that gets no answer
    keeps what was known and is asked again at the next collection."""
    now = now or time.time()
    seen = _read(path)
    kept = {}
    for domain in sorted({r for r in map(root_of, names) if r}):
        known = seen.get(domain)
        if not known or now - known.get("at", 0) >= MAX_AGE_S:
            got = _first_answer(servers, domain, ask)
            known = {"at": now, "by": provider(got)} if got is not None else known
        if known:
            kept[domain] = known
    if kept != seen:
        _write(path, kept)
    return {domain: k["by"] for domain, k in kept.items() if k.get("by")}
