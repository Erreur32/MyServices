"""One reader per connector (tier 4 of the request plan): the server reads every configured connector at its own period and keeps the
result in the shared state (<state_dir>/connectors.json). The collection, the health check and the live tier reuse that reading instead
of calling the service again: one caller per service, at a frequency the user sets per connector (Settings → Connectors, « every »),
with the default of Settings → System (« fast_every »; 0 = readers off, every task reads directly as before).

A connector is due when it was never tried, or when its last attempt is older than its period (a failure is tried again at the next
period, not sooner: a slow or down controller is not hammered). NPM stays with the collection (its hosts are the backbone of the pass),
the per-machine SSH readers (Docker, processes, AdGuard by SSH) too: they are the inventory, not a service API.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import connectors
import connectors.base as cbase

KINDS = ("services", "status", "network", "security", "containers", "logs", "virtualization", "health", "backups", "dns", "inventory")
SKIP_TYPES = {"npm", "docker", "process"}   # read by the collection itself
TIMEOUT = 60   # s, one reading
WORKERS = 8   # readings at the same time: one slow service does not hold the others
SLACK = 90   # s, a reading older than its period by less than this is still « recent » for the tasks (the reader is about to renew it)


def instances(cfg: dict) -> list[cbase.Connector]:
    """Every instance the readers handle, once each (an instance with two kinds comes once); a kind whose settings are wrong is skipped."""
    out: dict[str, cbase.Connector] = {}
    for kind in KINDS:
        try:
            found = connectors.instances(cfg, kind=kind)
        except cbase.ConnectorError:
            continue
        for c in found:
            if c.type not in SKIP_TYPES and not c.conf.get("ssh") and f"{c.type}/{c.name}" not in out:
                out[f"{c.type}/{c.name}"] = c
    return list(out.values())


def due(conn: cbase.Connector, state: dict, now: float, default: float) -> bool:
    """Never tried, or last attempt older than the instance's period."""
    tried = (state.get(f"{conn.type}/{conn.name}") or {}).get("tried")
    return not isinstance(tried, (int, float)) or now - tried >= cbase.period(conn, default)


def max_age(conn: cbase.Connector, default: float) -> float:
    """How old a shared reading may be for a task to reuse it: the instance's period plus a margin."""
    return cbase.period(conn, default) + SLACK


def tick(cfg: dict, state_path: Path, now: float | None = None, default: float = 300, timeout: float = TIMEOUT) -> list[tuple[cbase.Connector, cbase.Status]]:
    """Reads the connectors that are due, in parallel, and merges their entries into the shared state; (instance, status) of each one read."""
    now = time.time() if now is None else now
    state = cbase.load_state(state_path)
    todo = [c for c in instances(cfg) if due(c, state, now, default)]
    if not todo:
        return []
    with ThreadPoolExecutor(min(WORKERS, len(todo))) as ex:
        jobs = [(c, ex.submit(cbase.run_isolated, c, state, timeout)) for c in todo]
    out = [(c, job.result()[1]) for c, job in jobs]
    cbase.merge_state(state_path, state, [f"{c.type}/{c.name}" for c in todo])
    return out


def on(cfg: dict) -> bool:
    """Readers on: a default period above zero (Settings → System, « fast_every »)."""
    every = cfg.get("fast_every")
    return isinstance(every, (int, float)) and every > 0


def recent(conn: cbase.Connector, state: dict, cfg: dict) -> tuple[dict | None, cbase.Status | None]:
    """(data, status) of the shared reading of this instance when the readers are on and it is recent enough; (None, None) otherwise:
    the task then reads the service itself (first start, readers off, reading too old)."""
    if not on(cfg):
        return None, None
    data = cbase.recent(conn, state, max_age(conn, cfg["fast_every"]))
    if data is None:
        return None, None
    return data, cbase.status_of(conn, state)
