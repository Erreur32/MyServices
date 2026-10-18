"""Server-sent events for the page (GET api/v1/stream): « manifest » when a produced file moved, « status » when the collector's
state changed (pass running, progress), « tasks » when a task started or ended. One watcher thread compares these every second
and publishes a change to every open stream; the page then reads only what the event names, and nothing at rest."""
from __future__ import annotations

import json
import queue
import threading
import time

_subs: set[queue.Queue] = set()
_lock = threading.Lock()
HEARTBEAT_S = 25     # a comment line keeps the connection alive through proxies
QUEUE_MAX = 64       # a page that stops reading is dropped rather than growing a queue forever


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue(QUEUE_MAX)
    with _lock:
        _subs.add(q)
    return q


def unsubscribe(q: queue.Queue) -> None:
    with _lock:
        _subs.discard(q)


def subscribers() -> int:
    with _lock:
        return len(_subs)


def publish(kind: str, payload) -> None:
    """One event to every open stream; a full queue (page stalled) loses this event, the next one tells the same."""
    with _lock:
        subs = list(_subs)
    for q in subs:
        try:
            q.put_nowait((kind, payload))
        except queue.Full:
            pass


def frame(kind: str, payload) -> str:
    return f"event: {kind}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def stream(q: queue.Queue, first: dict[str, object] | None = None):
    """SSE body: the current state first (so a page that just opened the stream needs no other request), then each change,
    a heartbeat comment when nothing happened for HEARTBEAT_S. Unsubscribes when the client goes away."""
    try:
        yield "retry: 3000\n\n"
        for kind, payload in (first or {}).items():
            yield frame(kind, payload)
        while True:
            try:
                kind, payload = q.get(timeout=HEARTBEAT_S)
            except queue.Empty:
                yield ": ping\n\n"
                continue
            yield frame(kind, payload)
    finally:
        unsubscribe(q)


def watch(sources: dict[str, callable], every: float = 1.0, once: bool = False, last: dict[str, str] | None = None) -> dict[str, str]:
    """Compares each source (name -> function returning a JSON-able value) every `every` seconds while a stream is open, and publishes
    the ones that changed. once: a single comparison from the given fingerprints, returned updated (tests)."""
    last = {} if last is None else last
    while True:
        if subscribers() or once:
            for kind, fn in sources.items():
                try:
                    value = fn()
                    fp = json.dumps(value, sort_keys=True, default=str)
                except Exception:  # a source that fails must not stop the watcher
                    continue
                if last.get(kind) != fp:
                    if kind in last:    # the first reading is the baseline: the stream sends the current state itself
                        publish(kind, value)
                    last[kind] = fp
        else:
            last.clear()   # nobody listens: the next stream starts from a fresh baseline
        if once:
            return last
        time.sleep(every)
