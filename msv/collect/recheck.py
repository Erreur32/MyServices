"""Quick recheck: a service the collection sees bad for what the port pulse cannot see (a 5xx or no answer on its public site) is tried
again 60 to 120 s later, alone, instead of waiting for the next collection (15 min) to confirm it.

Only the services waiting for their confirmation (the watcher's `pending`) that are bad while their port answers are tried, each domain once
per pass and at most MAX_PASS of them (a mass failure is a network problem, not a hundred outages to probe in a burst). The fresh answer is
written to <web_dir>/recheck.json, tagged with the collection it belongs to; the watcher reads it like a pulse: a service still bad is
confirmed at once, one that answers again is left to the next collection.
"""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MAX_PASS = 20   # probes in a pass
WORKERS = 4     # at the same time, as the second pass of the collection
DELAY = 90      # s after the watcher run that made a service wait


def pick(data: dict, pending: dict, limit: int = MAX_PASS) -> dict[str, dict]:
    """{service key: row} to try again: waiting for confirmation, bad although its backend answers (a 5xx), with a public domain. One per domain."""
    from msv.collect import watcher   # the watcher reads this file too: imported here, not at the top
    out, seen = {}, set()
    for r in data.get("hosts") or []:
        k, b = watcher.key(r), r.get("backend") or {}
        domain = (r.get("domains") or [None])[0]
        if k in pending and domain and domain not in seen and b.get("up") is not False and watcher.status(r) == "bad":
            seen.add(domain)
            out[k] = r
    return dict(sorted(out.items())[:limit])


def run(todo: dict[str, dict], probe, workers: int = WORKERS) -> dict[str, dict]:
    """{service key: fresh public probe} of the domains of the rows of `todo` (probe: myservices.probe_https)."""
    with ThreadPoolExecutor(max(1, min(workers, len(todo)))) as ex:
        return dict(zip(todo, ex.map(probe, [r["domains"][0] for r in todo.values()])))


def confirmed(todo: dict[str, dict], got: dict[str, dict]) -> list[str]:
    """The services still bad with their fresh answer: the ones for which the watcher has something to announce."""
    from msv.collect import watcher
    return [k for k, public in got.items() if watcher.status({**todo[k], "public": public}) == "bad"]


def save(path: Path, generated: str, rows: dict[str, dict]) -> None:
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps({"gen": generated, "ts": time.time(), "rows": rows}), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass   # a convenience: the next collection decides as before


def read(path: Path, generated: str | None) -> dict[str, dict]:
    """The fresh answers of the collection `generated`, {} for any other one (or a missing file)."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        rows = doc["rows"]
        return rows if doc["gen"] == generated and isinstance(rows, dict) else {}
    except (OSError, ValueError, KeyError, TypeError):
        return {}
