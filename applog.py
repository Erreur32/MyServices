"""What the container prints (stdout and stderr, the same as `docker logs`), also kept in memory for Settings -> Logs.

install() is called once by server.py at startup: every later write is copied, line by line, into a ring of the last MAX lines.
A module of its own: api.py loads server.py a second time (as « server », next to « __main__ »), this one is shared by both.
"""
from __future__ import annotations

import sys
import threading
import time
from collections import deque

MAX = 3000
_lines: deque = deque(maxlen=MAX)
_lock = threading.Lock()
_seq = 0
STARTED = time.time()


class _Tee:
    """Writes through to the real stream and keeps each finished line."""

    def __init__(self, stream, err: bool):
        self._stream, self._err, self._part = stream, err, ""

    def write(self, s: str) -> int:
        n = self._stream.write(s)
        global _seq
        with _lock:
            *done, self._part = (self._part + s).split("\n")
            for line in done:
                if line.strip():
                    _seq += 1
                    _lines.append({"n": _seq, "t": time.time(), "err": self._err, "text": line})
        return n

    def flush(self) -> None:
        self._stream.flush()

    def __getattr__(self, name):   # isatty, fileno, encoding… : those of the real stream
        return getattr(self._stream, name)


def install() -> None:
    if not isinstance(sys.stdout, _Tee):
        sys.stdout, sys.stderr = _Tee(sys.stdout, False), _Tee(sys.stderr, True)


def lines(after: int = 0) -> dict:
    """Lines numbered above `after` (0: all those kept), the last number, and since when the ring is filled."""
    with _lock:
        out = [x for x in _lines if x["n"] > after]
        return {"lines": out, "last": _seq, "started": STARTED, "kept": MAX}
