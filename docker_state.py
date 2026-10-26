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
