"""One rule for « this container is stopped on purpose », shared by the health reading (health.py) and the services collection
(myservices.py): a container that never started, one stopped cleanly (docker stop / compose down: exit 0, 143 SIGTERM, 137
SIGKILL after the delay), or one the machine lists in « stopped_ok » (any exit code: an app that exits with 1 on SIGTERM)."""
import re


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


def refresh_states(cached: list[dict] | None, states: dict[str, str]) -> tuple[list[dict] | None, bool]:
    """The cached inventory of a machine with the fresh status of each container (`docker ps -a` of the health reading, every
    pass, when the inventory itself is read every 2 h): a container started, stopped or « Created » shows as such without a new
    inventory. Also says whether a container appeared or disappeared since the inventory: it is then to be read again."""
    if cached is None:
        return None, False
    fresh = [{**c, "status": states[c["name"]]} if c.get("name") in states else c for c in cached]
    return fresh, {c.get("name") for c in cached} != set(states)
