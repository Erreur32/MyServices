# Web traffic of the last 24 h read in the access logs of the local Nginx Proxy Manager, run on the machine as it is (python3 -c) by the Linux agent
# or over SSH, the same text both ways. It finds the logs through Docker (the /data mount of each NPM container) and prints totals only: requests
# and 5xx per site and per hour, the addresses of a site that stay under the Fail2ban limits (diffuse scraping), and the 10 busiest addresses of
# the last hour. No other address leaves the machine. Never a single quote in this file: it is sent between single quotes.
import glob
import json
import os
import re
import subprocess
import time
from datetime import datetime

DAY, HOUR, RECENT = 86400, 3600, 600
DIFFUSE = (50, 400)        # requests in 24 h of one address on one site that Fail2ban lets through
TOP_IPS, MAX_SITES = 10, 60
BOTS = re.compile(r"bot|crawl|spider|slurp|facebookexternalhit|bingpreview|feedfetcher|monitor", re.I)
MINUTES = {}


def log_dirs():
    try:
        out = subprocess.run(["docker", "ps", "--format", "{{.ID}} {{.Image}}"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10).stdout.decode()
    except (OSError, subprocess.TimeoutExpired):
        return []
    dirs = []
    for ln in out.splitlines():
        cid, _, image = ln.partition(" ")
        if "nginx-proxy-manager" not in image:
            continue
        try:
            mounts = json.loads(subprocess.run(["docker", "inspect", "-f", "{{json .Mounts}}", cid], stdout=subprocess.PIPE, timeout=10).stdout.decode() or "[]")
        except (OSError, ValueError, subprocess.TimeoutExpired):
            continue
        dirs += [m.get("Source", "") + "/logs" for m in mounts or [] if m.get("Destination") == "/data" and m.get("Source")]
    return [d for d in dirs if os.path.isdir(d)]


def when(line):
    """Epoch of an NPM log line ([02/Nov/2026:11:05:04 +0100] ...), None when it is not one; parsed once per minute."""
    if not line.startswith("[") or len(line) < 28:
        return None
    key = line[1:18] + line[21:27]
    t = MINUTES.get(key)
    if t is None:
        try:
            t = MINUTES[key] = datetime.strptime(key, "%d/%b/%Y:%H:%M %z").timestamp()
        except ValueError:
            return None
    return t + int(line[19:21] or 0)


def start_of(f, size, since):
    """Byte offset of the first line at or after `since` (the log is in time order): a binary search, so a week of log is not read for one day."""
    lo, hi = 0, size
    while hi - lo > 65536:
        mid = (lo + hi) // 2
        f.seek(mid)
        f.readline()
        t = None
        while t is None:
            ln = f.readline()
            if not ln:
                break
            t = when(ln.decode("utf-8", "replace"))
        if t is None or t >= since:
            hi = mid
        else:
            lo = mid
    return lo


def read(paths, now):
    sites, recent, ips_all = {}, {}, set()
    since = now - DAY
    for p in paths:
        try:
            if os.path.getmtime(p) < since:
                continue
            f = open(p, "rb")
        except OSError:
            continue
        with f:
            f.seek(start_of(f, os.fstat(f.fileno()).st_size, since))
            for raw in f:
                line = raw.decode("utf-8", "replace")
                t = when(line)
                if t is None or t < since or t > now + 60:
                    continue
                cols = line.split(" ", 10)
                c = line.find("[Client ")
                if len(cols) < 10 or c < 0 or not cols[4].isdigit():
                    continue
                host, status, ip = cols[8].lower()[:120], int(cols[4]), line[c + 8:line.find("]", c)]
                s = sites.setdefault(host, {"h": {}, "ips": {}, "bots": 0, "m10": [0, 0]})
                hr = s["h"].setdefault(int(t // HOUR * HOUR), [0, 0])
                bad = status >= 500
                hr[0] += 1
                hr[1] += bad
                if t >= now - RECENT:
                    s["m10"][0] += 1
                    s["m10"][1] += bad
                parts = line.rsplit("\"", 4)
                if len(parts) == 5 and BOTS.search(parts[1]):
                    s["bots"] += 1
                else:
                    s["ips"][ip] = s["ips"].get(ip, 0) + 1
                ips_all.add(ip)
                if t >= now - HOUR:
                    recent[(ip, host)] = recent.get((ip, host), 0) + 1
    out = {}
    for host, s in sorted(sites.items(), key=lambda kv: -sum(v[0] for v in kv[1]["h"].values()))[:MAX_SITES]:
        diffuse = [n for n in s["ips"].values() if DIFFUSE[0] <= n <= DIFFUSE[1]]
        out[host] = {"h": sorted([k, v[0], v[1]] for k, v in s["h"].items()), "ips": len(s["ips"]), "dip": len(diffuse), "dreq": sum(diffuse),
                     "bots": s["bots"], "m10": s["m10"]}
    top = sorted(recent.items(), key=lambda kv: -kv[1])[:TOP_IPS]
    return {"at": int(now), "sites": out, "ips": len(ips_all), "top": [[ip, host, n] for (ip, host), n in top]}


def main():
    dirs = log_dirs()
    if not dirs:
        print(json.dumps({"none": "no Nginx Proxy Manager container with its /data folder"}))
        return
    paths = [p for d in dirs for p in glob.glob(d + "/proxy-host-*_access.log")]
    print(json.dumps(dict(read(paths, time.time()), dirs=dirs), separators=(",", ":")))


if __name__ == "__main__":   # python3 -c runs it as __main__ too
    main()
