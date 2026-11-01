#!/usr/bin/env python3
"""MyServices agent for Linux: runs a fixed list of read-only commands on this machine and sends their outputs to MyServices.

- Read-only: it runs only the commands listed below (the same ones MyServices runs over SSH), changes nothing and listens on no port.
- It never runs anything it is told by the server. The server only answers "ok", and may offer a newer version of this very script
  (self-update, below).
- MyServices reads the outputs with the same code as an SSH session, so the machine looks the same whichever way it is followed.
- Slow commands (apt list, the big files of /var/log, SMART) run at most once per hour or every 6 h: their last output is kept in cache.json
  and sent again in between. The report is sent compressed (gzip).

Config: config.json next to this script ({url, token, interval}). Python 3.6 or newer, standard library only.
Started by a systemd timer (see install.sh).
"""
import gzip
import hashlib
import json
import os
import re
import shlex
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
CACHED = __CACHED__                      # {command: seconds}: outputs kept and sent again for that long instead of running the command
SMART_CACHE = __SMART_CACHE__            # seconds: SMART of each disk
NPM_LISTS = __NPM_LISTS__                # options of npm-api.sh, read when the install gave its path (MSV_NPM)
DNS_EVERY = 3600                         # seconds between two reads of the local DNS records
BACKUP_EVERY = 6 * 3600                  # seconds between two scans of the backup folders (kept and sent again meanwhile)
NPM_MAX = 200000                         # characters of one NPM list (the server limit)
# The only lines of an advanced config the server needs; the others can hold secrets and stay on the machine
NPM_KEEP = re.compile(r"^\s*(location\s|proxy_pass\s|deny\s|return\s+444|\})|acl_|CF-Connecting-IP")
DIR = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(DIR, "agent.log")
CACHE_PATH = os.path.join(DIR, "cache.json")
BACKUP_STATE = os.path.join(DIR, "backups.json")   # what to read, and the last result
DNS_STATE = os.path.join(DIR, "dns.json")
MAX_OUT = 50000                          # characters kept per command (the server accepts 60000)
MAX_BODY = 240 * 1024                    # bytes: compressed report size kept under the server limit (256 KiB)
CUT_TO = 12000                           # characters an output is cut to, longest first, when the report is still too big
SLOW = ("docker stats", "apt list", "snap refresh")   # commands allowed more time (health.SLOW_CMDS)


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


def load_cache(path=None):
    try:
        with open(path or CACHE_PATH) as f:
            got = json.load(f)
        return got if isinstance(got, dict) else {}
    except (OSError, ValueError):
        return {}


def save_cache(cache, path=None):
    path = path or CACHE_PATH
    try:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(cache, f)
        os.replace(tmp, path)
    except OSError:
        pass   # no cache: the slow commands simply run again next time


def run_cached(cmd, timeout, ttl, cache, now):
    """(rc, output) of the command, from cache.json while it is younger than ttl seconds; only a success is kept."""
    hit = cache.get(cmd)
    if ttl and isinstance(hit, list) and len(hit) == 3 and now - hit[0] < ttl:
        return hit[1], hit[2]
    rc, out = run(cmd, timeout)
    out = out[:MAX_OUT]
    if ttl and rc == 0:
        cache[cmd] = [now, rc, out]
    return rc, out


def root_script(conf, stdin, timeout):
    """[rc, output] of a script set by the installer as root, through its exact sudo rule."""
    try:
        r = subprocess.run(["sudo", "-n", str(conf.get("python")), str(conf.get("script"))], input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return [1, str(e)[:500]]
    if r.returncode != 0:
        return [r.returncode, r.stderr.decode("utf-8", "replace")[-500:]]
    text = r.stdout.decode("utf-8", "replace")
    return [0, text] if len(text) <= NPM_MAX else [1, "answer too long"]


def dns_scan(conf, now):
    state = load_cache(DNS_STATE)
    if now - state.get("at", 0) < DNS_EVERY and state.get("result"):
        return state["result"]
    result = root_script(conf, b"", 60)
    save_cache({"at": now, "result": result}, DNS_STATE)
    return result


def backup_scan(conf, now):
    """[rc, output] of the root scan of the backup folders, every BACKUP_EVERY or when the server asks for other folders. The scan is the script
    set by the installer, through its exact sudo rule; it refuses any folder outside the list kept on this machine, whatever the server asks."""
    state = load_cache(BACKUP_STATE)
    req = state.get("req")
    if not isinstance(req, dict):
        return None
    # Followed folders only: the archive names to look for change with every backup
    if state.get("scanned") == req.get("locs") and now - state.get("at", 0) < BACKUP_EVERY and state.get("result"):
        return state["result"]
    result = root_script(conf, json.dumps(req).encode("utf-8"), 270)
    state.update(scanned=req.get("locs"), at=now, result=result)
    save_cache(state, BACKUP_STATE)
    return result


def keep_backup_request(req):
    state = load_cache(BACKUP_STATE)
    if state.get("req") != req:
        state["req"] = req
        save_cache(state, BACKUP_STATE)


def npm_clean(opt, text):
    """A list of npm-api.sh without what the server does not need: access lists reduced to id and name, no owner, advanced configs filtered."""
    rows = json.loads(text)
    if opt == "--access-list":
        return json.dumps([{"id": a.get("id"), "name": a.get("name")} for a in rows])
    for x in rows:
        x.pop("owner", None)
        x.pop("access_list", None)
        adv = x.get("advanced_config") or ""
        if adv.strip():
            kept = [ln for ln in adv.splitlines() if NPM_KEEP.search(ln)]
            x["advanced_config"] = "\n".join(kept) or "# kept on the machine"
    return json.dumps(rows)


def npm_lists(npm):
    """{label: [rc, output]} of the local NPM. Not cached: nothing raw is left on the disk. The path comes from the install, never from the server."""
    out = {}
    for opt in NPM_LISTS:
        who = "sudo -n -u %s " % shlex.quote(str(npm["user"])) if npm.get("user") else ""   # none: the script was installed for this account
        rc, text = run("%s%s --json %s" % (who, shlex.quote(str(npm.get("path"))), opt), 30)
        if rc == 0:
            try:
                text = npm_clean(opt, text)
            except (ValueError, AttributeError, TypeError):
                rc, text = 1, "npm-api.sh: unexpected answer"
        if len(text) > NPM_MAX:
            rc, text = 1, "npm-api.sh: list too long"
        out["npm " + opt] = [rc, text[-500:] if rc else text]
    return out


def collect():
    cmds, cache, now = {}, load_cache(), time.time()
    for cmd in COMMANDS:
        cmds[cmd] = list(run_cached(cmd, 40 if any(s in cmd for s in SLOW) else 20, CACHED.get(cmd), cache, now))
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
            cmds[cmd] = list(run_cached(cmd, 20, SMART_CACHE, cache, now))
    save_cache({k: v for k, v in cache.items() if k in cmds})   # a disk or a command gone: its output is dropped
    return cmds


def pack(meta, cmds):
    """The report as gzip-compressed JSON; when it is still bigger than MAX_BODY, the longest outputs are cut (marked) one by one
    rather than losing the whole report."""
    while True:
        body = gzip.compress(json.dumps(dict(meta, data={"kind": "linux", "cmds": cmds})).encode("utf-8"))
        longest = max(cmds, key=lambda c: len(cmds[c][1]), default=None)
        if len(body) <= MAX_BODY or longest is None or len(cmds[longest][1]) <= CUT_TO:
            return body
        cmds[longest] = [cmds[longest][0], cmds[longest][1][:CUT_TO] + "\n[cut by the agent: report too big]"]


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
                                 headers={"Authorization": "Bearer " + cfg["token"], "Content-Type": "application/json; charset=utf-8",
                                          "Content-Encoding": "gzip"})
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
    cmds = collect()
    if isinstance(cfg.get("npm"), dict):
        cmds.update(npm_lists(cfg["npm"]))
    if isinstance(cfg.get("dns"), dict):
        cmds["dns"] = dns_scan(cfg["dns"], time.time())
    if isinstance(cfg.get("backups"), dict):
        scan = backup_scan(cfg["backups"], time.time())
        if scan:
            cmds["backups"] = scan
    body = pack({"version": VERSION, "os": os_name(), "host": socket.gethostname(), "interval": int(cfg.get("interval") or 900)}, cmds)
    answer = send(cfg, body)
    if answer is None:
        return 1
    log("report sent to %s (agent %s)" % (cfg["url"], VERSION))
    if isinstance(answer.get("backups"), dict) and isinstance(cfg.get("backups"), dict):
        keep_backup_request(answer["backups"])
    if isinstance(answer.get("update"), dict):
        self_update(cfg, answer["update"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
