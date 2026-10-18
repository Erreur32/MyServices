"""Pulse: a light ping of every followed machine every few seconds, so that « online / offline » is live.

The collector (every 30 min) and the watcher (twice an hour) stay in charge of the heavy reading; the pulse only answers
« does it ping? ». A state change is confirmed after `confirm` pulses in a row (a lost packet is not an outage), then written to
<web_dir>/pulse.json: the page overlays it on data.json and the watcher takes its machine events from it.
"""
from __future__ import annotations

import json
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

TIME = re.compile(r"time[=<]([\d.]+) ?ms")


def ping(ip: str) -> tuple[bool, float | None]:
    """(answered, round-trip in ms) of one ICMP echo, one second at most."""
    try:
        r = subprocess.run(["ping", "-c1", "-W1", ip], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return False, None
    m = TIME.search(r.stdout)
    return r.returncode == 0, float(m.group(1)) if m else None


class Pulse:
    """Confirmed ping state of each machine: {ip: {"ping", "ms", "since", "streak"}}."""

    def __init__(self, path: Path, confirm: int = 2, probe=ping) -> None:
        self.path, self.confirm, self.probe = path, max(1, confirm), probe
        self.state: dict[str, dict] = {}

    def tick(self, ips: list[str], now: float | None = None) -> list[str]:
        """Pings `ips` once, updates the confirmed state, writes the file; the IPs whose confirmed state changed."""
        now = time.time() if now is None else now
        with ThreadPoolExecutor(max(1, min(8, len(ips)))) as ex:
            seen = dict(zip(ips, ex.map(self.probe, ips)))
        changed = []
        for ip, (up, ms) in seen.items():
            s = self.state.get(ip)
            if s is None:   # first sight: adopted as it is, nothing to announce
                self.state[ip] = {"ping": up, "ms": ms, "since": now, "streak": 0}
                continue
            s["ms"] = ms if up else None
            s["streak"] = 0 if up == s["ping"] else s["streak"] + 1
            if s["streak"] >= self.confirm:
                s.update(ping=up, since=now, streak=0)
                changed.append(ip)
        for ip in set(self.state) - set(ips):   # machine removed or no longer followed
            del self.state[ip]
        self.save(now)
        return changed

    def save(self, now: float) -> None:
        doc = {"ts": now, "confirm": self.confirm,
               "machines": {ip: {"ping": s["ping"], "ms": s["ms"], "since": s["since"]} for ip, s in self.state.items()}}
        tmp = self.path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(doc), encoding="utf-8")
            tmp.replace(self.path)
        except OSError:
            pass   # the pulse is a convenience: a full disk must not stop the server


def read(path: Path, max_age: float = 300) -> dict[str, dict]:
    """Machines of a recent pulse file, {} when it is missing, unreadable or older than `max_age` seconds."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        if time.time() - float(doc["ts"]) > max_age:
            return {}
        machines = doc["machines"]
    except (OSError, ValueError, KeyError, TypeError):
        return {}
    return machines if isinstance(machines, dict) else {}
