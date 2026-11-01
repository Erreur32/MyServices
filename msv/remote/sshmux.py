"""One SSH connection per machine, shared by every read of a pass (health, ports, Docker, machine info, hypervisors, NPM, AdGuard,
backups): the first ssh opens it, the next ones go through it for 60 s, so a machine sees one handshake instead of one per command.
The socket sits in /tmp (a tmpfs in the Docker image, its root filesystem being read-only); %C keeps one per host, port and account."""
import subprocess
import time

SSH_MUX = ["-o", "ControlMaster=auto", "-o", "ControlPath=/tmp/msv-ssh-%C", "-o", "ControlPersist=60"]


def ssh_run(what: str, alias: str, argv: list[str], **kwargs) -> subprocess.CompletedProcess:
    """subprocess.run of a read, counted in Settings > Requests under « ssh/<alias> » when it goes over SSH; rc 255 is ssh itself failing."""
    from connectors import reqstats   # here: the connectors package imports this module
    if argv[0] != "ssh":
        return subprocess.run(argv, **kwargs)  # NOSONAR S6350: fixed read-only commands of the collection, run on this machine
    t0, code, error = time.monotonic(), None, "no answer"
    try:
        r = subprocess.run(argv, **kwargs)  # NOSONAR S6350: alias set by the admin in the settings, commands fixed by the callers
        code, error = (None, str(r.stderr)[-200:]) if r.returncode == 255 else (r.returncode, "")
        return r
    finally:
        reqstats.record(f"ssh/{alias}", what, (time.monotonic() - t0) * 1000, code, error)
