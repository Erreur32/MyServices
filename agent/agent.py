#!/usr/bin/env python3
"""MyServices agent for Linux: runs a fixed list of read-only commands on this machine and sends their outputs to MyServices.

- Read-only: it runs only the commands listed below (the same ones MyServices runs over SSH), changes nothing and listens on no port.
- It never runs anything it is told by the server. The server only answers "ok", and may offer a newer version of this very script
  (self-update, below).
- MyServices reads the outputs with the same code as an SSH session, so the machine looks the same whichever way it is followed.

Config: config.json next to this script ({url, token, interval}). Python 3.6 or newer, standard library only.
Started by a systemd timer (see install.sh).
"""
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

VERSION = "__VERSION__"
COMMANDS = __COMMANDS__                  # filled in by the server when it serves this file
SMART_LIST = __SMART_LIST__              # lists the disks; one SMART command per disk follows
SMART_FMT = __SMART_FMT__
DIR = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(DIR, "agent.log")
MAX_OUT = 50000                          # characters kept per command (the server accepts 60000)
SLOW = ("docker stats", "apt list")      # commands allowed more time


def log(msg):
    line = "%s %s" % (time.strftime("%Y-%m-%dT%H:%M:%S"), msg)
    print(line, flush=True)
    try:
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 200 * 1024:
            os.replace(LOG_PATH, LOG_PATH + ".old")
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def run(cmd, timeout):
    """(return code, output) the way the SSH collection reads it: stdout when it worked, stdout + stderr when it failed."""
    try:
        r = subprocess.run(["bash", "-c", cmd], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "timeout apres %ds" % timeout
    except OSError as e:
        return 1, str(e)
    out = r.stdout.decode("utf-8", "replace")
    if r.returncode == 0:
        return 0, out
    return r.returncode, (out + r.stderr.decode("utf-8", "replace")).strip()


def collect():
    cmds = {}
    for cmd in COMMANDS:
        rc, out = run(cmd, 40 if any(s in cmd for s in SLOW) else 20)
        cmds[cmd] = [rc, out[:MAX_OUT]]
    # SMART: one command per disk found (an NVMe namespace is asked through its controller), same rule as the SSH collection
    rc, out = cmds.get(SMART_LIST, [1, ""])
    seen = set()
    if rc == 0:
        for dev in out.split():
            m = re.match(r"^(nvme\d+)n\d+$", dev)
            target = m.group(1) if m else dev
            if target in seen or not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", target):
                continue
            seen.add(target)
            cmd = SMART_FMT.format(target=target)
            rc2, out2 = run(cmd, 20)
            cmds[cmd] = [rc2, out2[:MAX_OUT]]
    return cmds


def os_name():
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    return line.split("=", 1)[1].strip().strip('"')[:120]
    except OSError:
        pass
    return "Linux"


def post(cfg, body):
    """Sends the report; returns the server's answer. Raises HTTPError (4xx/5xx), URLError or OSError."""
    req = urllib.request.Request(cfg["url"].rstrip("/") + "/myservices/api/v1/agent/report", data=body, method="POST",  # NOSONAR S5144: address written by the installer in config.json, checked in load_config()
                                 headers={"Authorization": "Bearer " + cfg["token"], "Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def self_update(cfg, upd):
    """Only when the server asks (automatic update on, or "update now" clicked in MyServices): download the script from the server that
    already receives the reports, check its SHA-256 and its syntax, then replace this very file. The next run uses it."""
    path = str(upd.get("path") or "")
    if not (path.startswith("/myservices/agent/") and path.endswith(".py") and upd.get("sha256")):
        return
    try:
        with urllib.request.urlopen(cfg["url"].rstrip("/") + path, timeout=30) as r:  # NOSONAR S5144: same address as post(); the path is checked above (/myservices/agent/*.py)
            new = r.read()
        if hashlib.sha256(new).hexdigest() != str(upd["sha256"]):
            raise ValueError("downloaded script does not match the announced SHA-256")
        compile(new, "agent.py", "exec")
        tmp = os.path.join(DIR, "agent.py.new")
        with open(tmp, "wb") as f:
            f.write(new)
        shutil.copymode(os.path.abspath(__file__), tmp)
        os.replace(tmp, os.path.abspath(__file__))
        log("agent updated to version %s" % upd.get("version"))
    except Exception as e:  # a failed update must never break the agent
        log("UPDATE FAILED: %s" % e)


def load_config():
    """config.json written by the installer (address of MyServices and token); None, after logging, when it is missing or malformed."""
    try:
        with open(os.path.join(DIR, "config.json")) as f:
            cfg = json.load(f)
        if not re.match(r"^https?://", str(cfg.get("url"))) or not re.match(r"^msv_agent_[A-Za-z0-9_-]+$", str(cfg.get("token"))):
            raise ValueError("config.json: bad url or token")
        return cfg
    except (OSError, ValueError) as e:
        log("FAILED: %s" % e)
        return None


def send(cfg, body, tries=3):
    """Sends the report with a few tries; the server's answer, or None after logging why it failed."""
    for i in range(1, tries + 1):
        try:
            answer = post(cfg, body)
            if not answer.get("ok"):
                raise ValueError("server answered without ok")
            return answer
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404, 409, 413) or i == tries:   # revoked token, host name to confirm, ...: waiting will not help
                log("FAILED: HTTP %d %s" % (e.code, e.read().decode("utf-8", "replace")[:200]))
                return None
            log("try %d/%d failed (HTTP %d), new try in 15 s" % (i, tries, e.code))
        except (OSError, ValueError) as e:   # URLError is an OSError
            if i == tries:
                log("FAILED: %s" % e)
                return None
            log("try %d/%d failed (%s), new try in 15 s" % (i, tries, e))
        time.sleep(15)
    return None


def main():
    cfg = load_config()
    if cfg is None:
        return 1
    body = json.dumps({"version": VERSION, "os": os_name(), "host": socket.gethostname(), "interval": int(cfg.get("interval") or 900),
                       "data": {"kind": "linux", "cmds": collect()}}).encode("utf-8")
    answer = send(cfg, body)
    if answer is None:
        return 1
    log("report sent to %s (agent %s)" % (cfg["url"], VERSION))
    if isinstance(answer.get("update"), dict):
        self_update(cfg, answer["update"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
