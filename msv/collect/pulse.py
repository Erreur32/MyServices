"""Pulse: a light ping of every followed machine every few seconds, so that « online / offline » is live.

The collector (every 15 min) and the watcher (right after it) stay in charge of the heavy reading; the pulse only answers
« does it ping? ». A state change is confirmed after `confirm` pulses in a row (a lost packet is not an outage), then written to
<web_dir>/pulse.json: the page overlays it on data.json and the watcher takes its machine events from it. The same logic follows
the port of each service in <web_dir>/ports.json: a port that closes or opens no longer waits for two collections.
"""
from __future__ import annotations

import json
import re
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

TIME = re.compile(r"time[=<]([\d.]+) ?ms")
PORT_TIMEOUT = 3   # s


def ping(ip: str) -> tuple[bool, float | None]:
    """(answered, round-trip in ms) of one ICMP echo, one second at most."""
    try:
        r = subprocess.run(["ping", "-c1", "-W1", ip], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return False, None
    m = TIME.search(r.stdout)
    return r.returncode == 0, float(m.group(1)) if m else None


def port_open(target: str) -> tuple[bool, float | None]:
    """(open, connection time in ms) of one « ip:port », a plain TCP connection closed at once."""
    host, _, port = target.rpartition(":")
    t = time.monotonic()
    try:
        with socket.create_connection((host, int(port)), timeout=PORT_TIMEOUT):
            return True, round((time.monotonic() - t) * 1000, 1)
    except OSError:
        return False, None


def port_of(r: dict) -> str | None:
    """The « ip:port » the port pulse follows for a row of data.json: one the collection probed itself. Same rule in the page (withPulse).
    A port that answers without a web page (SSH, mail, SMB, a database) is left out: a silent connection every minute fills its logs and
    can get MyServices banned by Fail2ban. It stays read at the collection."""
    b = r.get("backend") or {}
    silent = b.get("up") and r.get("web") == "none" and not r.get("by_agent")   # by_agent: its state comes from the agent's report, no connection
    if not r.get("enabled") or r.get("paused") or r.get("machine_off") or r.get("stopped") or b.get("internal") or silent:
        return None
    return f'{r["ip"]}:{r["port"]}' if r.get("ip") and r.get("port") and isinstance(b.get("up"), bool) else None


def agent_states(hosts: list[dict], listening: dict[str, set[int]]) -> dict[str, bool]:
    """{« ip:port »: listening} for the followed rows flagged `by_agent` whose machine has a fresh agent report with listening ports. A row
    whose agent is silent or sends no ports is left out: it is neither probed nor announced down, the collection's state stays."""
    out = {}
    for r in hosts:
        key = port_of(r)
        if key and r.get("by_agent") and r["ip"] in listening:
            out[key] = int(r["port"]) in listening[r["ip"]]
    return out


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
