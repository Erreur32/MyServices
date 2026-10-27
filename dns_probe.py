"""Do the DNS servers answer, and how fast: a real query (an A record) sent to each AdGuard of the DNS page and to a few public resolvers
(Cloudflare, Google). Kept for the DNS tiles in tile_history's table every minute: for the local servers [time, answering, asked], for each
public resolver [time, latency in ms, 0] (only when it answered) and [time, answered, 1] (so the share of answers over a period is known). 7 days kept."""
from __future__ import annotations

import secrets
import socket
import struct
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import tile_history as th

QUERY_NAME = "cloudflare.com"   # a name no blocklist holds back: an answer, even a refusal, proves the server is alive
TIMEOUT = 2.0
LOCAL = "dns.local"
EXTERNAL = (("Cloudflare", "1.1.1.1"), ("Google", "8.8.8.8"))  # NOSONAR S1313: the public resolvers the tiles test, written on purpose


def ext_keys(ip: str) -> tuple[str, str]:
    """The keys of a public resolver: its latency and its answers."""
    return f"dns.ext.{ip}.ms", f"dns.ext.{ip}.up"


def latency_ms(server: str, name: str = QUERY_NAME, timeout: float = TIMEOUT, port: int = 53) -> int | None:
    """Milliseconds a DNS server takes to answer one A query over UDP, None without a valid answer."""
    qid = secrets.randbelow(65536)
    query = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + b"".join(bytes([len(x)]) + x.encode("ascii") for x in name.split(".")) + b"\0" + struct.pack(">HH", 1, 1)
    start = time.monotonic()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(timeout)
            s.sendto(query, (server, port))
            data = s.recv(512)
    except OSError:
        return None
    return max(1, round((time.monotonic() - start) * 1000)) if len(data) >= 12 and data[:2] == query[:2] and data[2] & 0x80 else None


def probe(local: list[str], external=EXTERNAL) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of one round: the local servers answering out of the ones asked, and per public resolver its latency (when it
    answered) and whether it did. All asked at once, so a round lasts one timeout at most."""
    targets = list(local) + [ip for _, ip in external]
    if not targets:
        return {}
    with ThreadPoolExecutor(len(targets)) as ex:
        got = dict(zip(targets, ex.map(latency_ms, targets)))
    out: dict[str, tuple[int, int]] = {}
    if local:
        out[LOCAL] = (sum(1 for ip in local if got[ip] is not None), len(local))
    for _, ip in external:
        ms_key, up_key = ext_keys(ip)
        out[up_key] = (int(got[ip] is not None), 1)
        if got[ip] is not None:
            out[ms_key] = (got[ip], 0)
    return out


def sample(db_path: str | Path, local: list[str], now: float | None = None, external=EXTERNAL) -> int:
    """One round of tests stored; how many points were added."""
    now = now or time.time()
    return sum(th.store(db_path, key, (int(now), *vt), now, gap=th.LIVE_GAP) for key, vt in probe(local, external).items())
