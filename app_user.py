"""Docker image: the app always runs under the account 10001, never root.

The container starts as root only so that deploy/entrypoint.sh can give /config and /data to that account; it then drops to it.
A command run with `docker compose exec` starts as root too: drop_root() switches it to the same account, so that what it
writes in /config (accounts, secrets, SSH keys) stays readable by the app.
"""
from __future__ import annotations

import os

UID = 10001
HOME = "/home/myservices"


def drop_root() -> None:
    """In the Docker image, run as root: start this same command again as the account 10001 (nothing to do otherwise)."""
    if os.environ.get("MYSERVICES_DOCKER") != "1" or os.geteuid() != 0:
        return
    os.environ.update(HOME=HOME, USER="myservices")
    with open("/proc/self/cmdline", "rb") as f:   # the exact command line (sys.argv loses the code of « python3 -c »)
        argv = [x.decode() for x in f.read().split(b"\0") if x]
    os.execvp("setpriv", ["setpriv", f"--reuid={UID}", f"--regid={UID}", "--clear-groups", "--inh-caps=-all", *argv])
