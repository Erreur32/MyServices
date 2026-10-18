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


def contradicted(hosts: list[dict], state: dict, health_age: float, tried: dict, now: float, min_age: float = 120, cooldown: float = 600) -> list[str]:
    """IPs whose health snapshot says « unreachable » while their confirmed ping answers and the snapshot is old enough to be behind: their
    health is read again, alone. A machine that stays contradictory (no health source works) is retried less and less often (x2, up to 2 h).
    `tried` {ip: (time, tries)} is updated."""
    out = []
    for h in hosts:
        ip = str(h.get("name", "")).rpartition(" · ")[2].strip()
        if h.get("reachable") is not False or not (state.get(ip) or {}).get("ping") or health_age < min_age:
            tried.pop(ip, None) if h.get("reachable") is not False else None
            continue
        last, n = tried.get(ip, (float("-inf"), 0))
        if now - last >= min(cooldown * 2 ** max(0, n - 1), 7200):
            tried[ip] = (now, n + 1)
            out.append(ip)
    return out


class Owed:
    """What a confirmed change still owes: one watcher run (events, history, alerts) and one health reading per machine that moved.
    Each task runs one at a time, so what could not start (task busy) is asked again at the next pulse."""

    def __init__(self) -> None:
        self.watch, self.health = False, []

    def add(self, changed: list[str]) -> None:
        self.watch = self.watch or bool(changed)
        self.health += [ip for ip in changed if ip not in self.health]

    def settle(self, run_watch, run_health, watch_on: bool, health_on: bool) -> None:
        """Starts the owed tasks that can start now; run_* return True when the task started."""
        if self.watch and watch_on and run_watch():
            self.watch = False
        if self.health and health_on and run_health(self.health[0]):
            self.health.pop(0)
        if not watch_on:
            self.watch = False
        if not health_on:
            self.health.clear()


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
