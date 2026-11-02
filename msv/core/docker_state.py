"""One rule for « this container is stopped on purpose », shared by the health reading (health.py) and the services collection
(myservices.py): a container that never started, one stopped cleanly (docker stop / compose down: exit 0, 143 SIGTERM, 137
SIGKILL after the delay), or one the machine lists in « stopped_ok » (any exit code: an app that exits with 1 on SIGTERM)."""
import re
import time


def intended_stop(name: str, status: str, allowed=frozenset()) -> bool:
    """name/status as `docker ps -a` prints them; allowed: lower-case names of the machine's stopped_ok list."""
    if status.startswith("Created") or re.match(r"Exited \((0|137|143)\)", status):
        return True
    return name.lower() in allowed and status.startswith("Exited")


def allowed_names(stopped_ok) -> frozenset:
    return frozenset(str(n).lower() for n in stopped_ok or ())


def parse_states(out: str) -> dict[str, str]:
    """{name: status} from a `docker ps -a --format '{{.Names}}|{{.Status}}|...'` output (the health reading, SSH or agent)."""
    states = {}
    for ln in (out or "").splitlines():
        cols = ln.split("|", 2)
        if len(cols) >= 2 and cols[0]:
            states[cols[0]] = cols[1]
    return states


UPTIME_RE = re.compile(r"^Up (?:(Less than a second)|About an? (minute|hour)|(\d+) (second|minute|hour|day|week|month|year)s?)\b")
UNIT_S = {"second": 1, "minute": 60, "hour": 3600, "day": 86400, "week": 604800, "month": 2592000, "year": 31536000}
START_SLACK = 60   # seconds: `docker ps` rounds the uptime down, a start right at the inventory is not a new one


def uptime_s(status: str) -> int | None:
    """Seconds a container has been up, from its `docker ps` status (« Up 5 minutes (healthy) », « Up About an hour »); None when not up."""
    m = UPTIME_RE.match(status or "")
    if not m:
        return None
    if m[1]:
        return 0
    return UNIT_S[m[2]] if m[2] else int(m[3]) * UNIT_S[m[4]]


def refresh_states(cached: list[dict] | None, states: dict[str, str], since: float | None = None, now: float | None = None) -> tuple[list[dict] | None, bool]:
    """The cached inventory of a machine with the fresh status of each container (`docker ps -a` of the health reading, every
    pass, when the inventory itself is read every 2 h): a container started, stopped or « Created » shows as such without a new
    inventory. Also says whether it is to be read again: a container appeared or disappeared, or (`since`: time of the inventory)
    one started after it, recreated by `docker compose up -d` on a new image under the same name, whose version the inventory lacks.
    shortcut: a container in a restart loop asks for a new inventory at each pass, cheap; skip it if a machine loops for days."""
    if cached is None:
        return None, False
    fresh = [{**c, "status": states[c["name"]]} if c.get("name") in states else c for c in cached]
    now = now or time.time()
    started = bool(since) and any(
        (up := uptime_s(st)) is not None and now - up > since + START_SLACK for st in states.values())
    return fresh, started or {c.get("name") for c in cached} != set(states)
