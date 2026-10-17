#!/usr/bin/env python3
"""Veille sauvegardes : état des backups de chaque machine, leurs copies et l'espace disque.

Facultatif : tourne seulement si backups-meta.json existe (config.json : backups_meta ; modèle
backups-meta.example.json). Installé par install.sh (myservices-backups.timer, root, 07:05 et 19:05).
Lecture seule, sans LLM. Pour chaque machine de backups-meta.json (alias SSH de /root/.ssh/config,
null ou "local" = la collectrice) :
  - un agent Python envoyé par stdin liste les archives de chaque emplacement (date, taille),
    les disques locaux (df) et les lignes de cron liées aux sauvegardes ;
  - une machine « mount » (NAS, partage monté sur la collectrice) n'est lue que par son point de montage ;
  - Syncthing est interrogé par son API REST locale sur les nœuds qui l'hébergent
    (dossiers, pairs connectés, % de complétion) ;
  - Home Assistant (sans SSH) par son API REST : capteurs du gestionnaire de sauvegardes et disque ;
  - les dossiers de sauvegarde présents sur les disques locaux (motifs discover) sont listés,
    pour repérer ceux qu'aucun jeu ne surveille.
Chaque jeu de sauvegarde (origine + copies) reçoit un niveau ok / warn / crit selon l'âge
des archives, le retard des copies sur la source et le nombre de copies hors machine.

Sortie : <web_dir>/backups.json, lu par l'onglet Backups (backups_url = "backups.json").
Si <web_dir>/backups.json est un lien (script de sauvegardes externe), rien n'est écrit.
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from config import CFG, HERE
from connectors.backup_apis import HomeAssistant, PbsBackups, Veeam
from connectors.base import ConnectorError, Context

CONNECTOR_OF = {Veeam: ("veeam",), HomeAssistant: ("home-assistant",), PbsBackups: ("proxmox-backup",)}  # types de config.json dont un hôte « connector » reprend les réglages
META = Path(CFG["backups_meta"])
OUT_JSON = Path(CFG["web_dir"]) / "backups.json"
SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15"]
TIMEOUT = 240
DISK_WARN, DISK_CRIT = 80, 90
GRACE_H = 6  # une copie a ce délai pour rattraper une archive toute neuve
RANK = {"ok": 0, "archive": 0, "na": 0, "warn": 1, "crit": 2, "down": 3}

# ───────────── Agent exécuté sur chaque machine (python3 -) ─────────────

AGENT = r'''
import fnmatch, json, os, pwd, re, shlex, subprocess, sys
req = json.loads(sys.argv[1])
def sh(cmd, t=20):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=t)
        return r.returncode, r.stdout
    except Exception as e:
        return 1, str(e)
out = {"user": pwd.getpwuid(os.getuid()).pw_name, "hostname": os.uname().nodename, "locs": {}, "disks": [], "crons": [], "cron_root": None}

for key, loc in req.get("locs", {}).items():
    base = loc["path"].rstrip("/")
    try:
        if not os.path.isdir(base):
            out["locs"][key] = {"exists": False}; continue
    except OSError as e:
        out["locs"][key] = {"exists": False, "error": str(e)}; continue
    depth, pat, files, err = loc.get("depth", 1), loc.get("pattern", "*"), [], None
    skip = loc.get("exclude", [])
    bd = base.count("/")
    for root, dirs, fs in os.walk(base, onerror=lambda e: None):
        d = root.rstrip("/").count("/") - bd
        dirs[:] = [x for x in dirs if not x.startswith(".st")] if d + 1 < depth else []
        for f in fs:
            if f.startswith(".") or not fnmatch.fnmatch(f, pat) or any(fnmatch.fnmatch(f, x) for x in skip):
                continue
            p = os.path.join(root, f)
            try:
                st = os.stat(p)
            except OSError:
                continue
            files.append((os.path.relpath(p, base), int(st.st_mtime), st.st_size))
    files.sort(key=lambda x: -x[1])
    out["locs"][key] = {"exists": True, "count": len(files), "size": sum(f[2] for f in files),
                        "files": [{"name": n, "mtime": m, "size": s} for n, m, s in files[:60]]}

if req.get("disks"):
    mount = req.get("mount")
    if mount:
        sh("ls %s >/dev/null 2>&1" % shlex.quote(mount))
        rc, txt = sh("df -P -B1 -T %s | tail -n +2" % shlex.quote(mount))
    else:
        rc, txt = sh("df -P -B1 -T -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs -x cifs -x nfs -x nfs4 -x autofs -x fuse.sshfs | tail -n +2")
    for line in txt.splitlines():
        # le nom de partage CIFS peut contenir des espaces : on se cale sur la 1re colonne numérique (taille)
        p = line.split()
        i = next((k for k, x in enumerate(p) if k >= 2 and x.isdigit()), None)
        if i is None or len(p) < i + 5:
            continue
        dev, fs, size, used, avail, mnt = " ".join(p[:i - 1]), p[i - 1], int(p[i]), int(p[i + 1]), int(p[i + 2]), " ".join(p[i + 4:])
        if not mount and (size < 2 << 30 or mnt.startswith("/boot") or fs in ("vfat", "fuse")):
            continue
        out["disks"].append({"dev": dev, "fs": fs, "mount": mnt, "size": size, "used": used, "avail": avail,
                             "pct": round(used * 100 / size, 1) if size else 0})

if req.get("crons"):
    RX = re.compile(r"backup|rsync|vzdump|rclone|borg|restic|dump|sync", re.I)
    NOISE = re.compile("|".join([r"dpkg-db-backup|e2scrub|sysstat|munin|logcheck|myservices-backups|^\s*(#|$|SHELL=|PATH=|MAILTO=|TZ=)"] + req.get("cron_ignore", [])), re.I)
    def add(src, txt):
        for l in txt.splitlines():
            if RX.search(l) and not NOISE.search(l):
                out["crons"].append({"src": src, "line": " ".join(l.split())})
    rc, txt = sh("crontab -l 2>/dev/null")
    add("crontab " + out["user"], txt)
    if out["user"] != "root":
        rc, txt = sh("sudo -n crontab -l -u root 2>&1")
        if rc == 0 or "no crontab for root" in txt:  # crontab vide : lisible, rien à lister
            add("crontab root", txt)
        else:
            out["cron_root"] = "non lisible"
    for f in ["/etc/crontab"] + sorted(os.path.join("/etc/cron.d", x) for x in (os.listdir("/etc/cron.d") if os.path.isdir("/etc/cron.d") else [])):
        try:
            add(f, open(f).read())
        except OSError:
            pass
    if os.path.exists("/etc/pve/jobs.cfg"):
        for blk in open("/etc/pve/jobs.cfg").read().split("\n\n"):
            if blk.startswith("vzdump"):
                kv = dict(l.split(None, 1) for l in blk.splitlines()[1:] if len(l.split(None, 1)) == 2)
                out["crons"].append({"src": "Proxmox (jobs.cfg)", "line": "vzdump %s VM %s -> %s (%s, %s)" % (
                    kv.get("schedule", "?"), kv.get("vmid", "?"), kv.get("storage", "?"), kv.get("prune-backups", ""), "actif" if kv.get("enabled", "1") == "1" else "désactivé")})
    rc, txt = sh("systemctl list-timers --all --no-legend --no-pager 2>/dev/null")
    for l in txt.splitlines():
        if RX.search(l) and not NOISE.search(l):
            unit = [w for w in l.split() if w.endswith(".timer")]
            out["crons"].append({"src": "timer systemd", "line": unit[0] if unit else l})
if req.get("discover"):
    # Dossiers de sauvegarde présents sur les disques locaux (pas sur les partages réseau montés)
    import glob
    net = [l.split()[1] for l in open("/proc/mounts") if l.split()[2] in ("cifs", "smb3", "nfs", "nfs4", "fuse.sshfs", "autofs")]
    found = set()
    for g in req["discover"]:
        for d in glob.glob(g):
            if os.path.isdir(d) and not os.path.islink(d) and not any(d == m or d.startswith(m + "/") for m in net):
                found.add(d.rstrip("/"))
    # on garde les dossiers les plus profonds : /mnt/x/backup_server est remplacé par ses sous-dossiers
    found = [d for d in found if not any(o.startswith(d + "/") for o in found)]
    out["local"] = []
    for d in sorted(found):
        rc, du = sh("timeout 120 du -sb %s 2>/dev/null | tail -1" % shlex.quote(d), 130)
        rc2, nw = sh("timeout 120 find %s -type f ! -path '*/.st*' -printf '%%T@ %%P\\n' 2>/dev/null | sort -n | tail -1" % shlex.quote(d), 130)
        size = int(du.split()[0]) if du.split() and du.split()[0].isdigit() else None
        nw = nw.strip().split(" ", 1)
        out["local"].append({"path": d, "size": size, "newest": int(float(nw[0])) if nw[0] else None,
                             "newest_name": nw[1] if len(nw) > 1 else "", "readable": os.access(d, os.R_OK | os.X_OK)})

if req.get("vzdump") and os.path.isdir("/etc/pve"):
    # Proxmox VE dumps (vzdump without Proxmox Backup): every storage holding backups keeps them in <path>/dump,
    # one group per guest (vzdump-qemu-100-2026_10_12-03_00_02.vma.zst, .log and .notes beside it)
    import glob
    stores, cur = {}, None
    try:
        for l in open("/etc/pve/storage.cfg"):
            if l.strip() and not l[0].isspace() and ":" in l:
                t, sid = l.split(":", 1)
                cur = stores.setdefault(sid.strip(), {"type": t.strip(), "content": "", "path": "/var/lib/vz" if sid.strip() == "local" else ""})
            elif cur is not None and len(l.split(None, 1)) == 2:
                k, v = l.split(None, 1)
                cur[k] = v.strip()
    except OSError:
        out["vzdump_error"] = "/etc/pve/storage.cfg non lisible"
    dirs = {"/var/lib/vz/dump": ("local", False)} if os.path.isdir("/var/lib/vz/dump") else {}
    for sid, s in stores.items():
        if "backup" in s["content"].split(",") and s["path"]:
            dirs[s["path"].rstrip("/") + "/dump"] = (sid, s["type"] in ("nfs", "cifs", "cephfs", "glusterfs"))
    names = {}
    for kind, sub, key in (("qemu", "qemu-server", "name"), ("lxc", "lxc", "hostname")):
        for f in glob.glob("/etc/pve/nodes/*/%s/*.conf" % sub):
            try:
                m = re.search(r"^%s:\s*(\S+)" % key, open(f).read().split("\n[")[0], re.M)
            except OSError:
                continue
            if m:
                names[(kind, os.path.basename(f)[:-5])] = m.group(1)
    rx = re.compile(r"^vzdump-(qemu|lxc|openvz)-(\d+)-\d{4}_\d\d_\d\d-\d\d_\d\d_\d\d\.(vma|tar|tgz)(\.(zst|gz|lzo))?$")
    groups = {}
    for d, (sid, network) in dirs.items():
        try:
            fs = os.listdir(d)
        except OSError:
            continue
        for f in fs:
            m = rx.match(f)
            if not m:
                continue
            try:
                st = os.stat(os.path.join(d, f))
            except OSError:
                continue
            g = groups.setdefault((d, m.group(1), m.group(2)), {"dir": d, "storage": sid, "network": network, "kind": m.group(1), "vmid": m.group(2),
                                                               "name": names.get((m.group(1), m.group(2)), ""), "count": 0, "newest": 0, "newest_name": "", "size": 0})
            g["count"] += 1
            if st.st_mtime > g["newest"]:
                g.update(newest=int(st.st_mtime), newest_name=f, size=st.st_size)
    out["vzdump"] = sorted(groups.values(), key=lambda g: (g["dir"], int(g["vmid"])))

if req.get("find"):
    # Copies of followed archives: folders holding a file with one of these names, network shares included (a NAS mounted in CIFS / NFS
    # is the usual place of a copy). Bounded: depth, time budget, number of hits.
    import time
    want, t0, hits = set(req["find"]["names"]), time.time(), {}
    net = [l.split()[1] for l in open("/proc/mounts") if l.split()[2] in ("cifs", "smb3", "nfs", "nfs4", "fuse.sshfs")]
    roots = sorted({r for r in req["find"]["roots"] + net if os.path.isdir(r)})
    roots = [r for r in roots if not any(r != o and r.startswith(o.rstrip("/") + "/") for o in roots)]
    for root in roots:
        bd = root.rstrip("/").count("/")
        for cur, dirs, fs in os.walk(root, onerror=lambda e: None):
            if time.time() - t0 > req["find"].get("budget", 60) or len(hits) > 200:
                dirs[:] = []; break
            dirs[:] = [x for x in dirs if not x.startswith(".")] if cur.rstrip("/").count("/") - bd < req["find"].get("depth", 5) else []
            for f in fs:
                if f in want:
                    hits.setdefault(f, []).append({"dir": cur, "network": any(cur == m or cur.startswith(m.rstrip("/") + "/") for m in net)})
    out["found"] = hits

print(json.dumps(out))
'''

# API REST Syncthing locale (clé lue dans config.xml du nœud)
ST_AGENT = r'''
import json, re, ssl, sys, urllib.request
conf = open(sys.argv[1]).read()
key = re.search(r"<apikey>([^<]+)", conf).group(1)
gui = re.search(r"<gui[^>]*>.*?</gui>", conf, re.S).group(0)
host, port = re.search(r"<address>([^<]+)", gui).group(1).rsplit(":", 1)
if host in ("0.0.0.0", "", "[::]"):
    host = "127.0.0.1"
base = ("https" if 'tls="true"' in gui else "http") + "://%s:%s/rest" % (host, port)
ctx = ssl._create_unverified_context()
def g(p):
    r = urllib.request.Request(base + p, headers={"X-API-Key": key})
    return json.load(urllib.request.urlopen(r, context=ctx, timeout=15))
st = g("/system/status"); me = st["myID"]
cfg = g("/config"); conns = g("/system/connections")["connections"]; stats = g("/stats/folder")
names = {d["deviceID"]: d["name"] for d in cfg["devices"]}
out = {"me": names.get(me, me[:7]), "uptime": st.get("uptime"), "devices": [], "folders": []}
for d in cfg["devices"]:
    if d["deviceID"] == me:
        continue
    c = conns.get(d["deviceID"], {})
    out["devices"].append({"name": d["name"], "id": d["deviceID"][:7], "connected": bool(c.get("connected")),
                           "address": c.get("address") or "", "paused": d.get("paused", False)})
for f in cfg["folders"]:
    s = {} if f["paused"] else g("/db/status?folder=" + f["id"])
    peers = []
    for x in f["devices"]:
        if x["deviceID"] == me:
            continue
        try:
            c = g("/db/completion?folder=%s&device=%s" % (f["id"], x["deviceID"]))
        except Exception:
            c = {}
        peers.append({"name": names.get(x["deviceID"], x["deviceID"][:7]), "completion": round(c.get("completion", 0), 1),
                      "need_bytes": c.get("needBytes", 0)})
    out["folders"].append({"id": f["id"], "label": f["label"], "path": f["path"], "type": f["type"], "paused": f["paused"],
                           "state": s.get("state"), "global_bytes": s.get("globalBytes", 0), "need_bytes": s.get("needBytes", 0),
                           "errors": s.get("errors", 0) + s.get("pullErrors", 0), "last_scan": stats.get(f["id"], {}).get("lastScan"),
                           "peers": peers})
print(json.dumps(out))
'''


def run_py(ssh: str | None, src: str, arg: str, sudo: str | None = None) -> tuple[dict | None, str]:
    """Exécute un script Python (stdin) en local ou via SSH ; renvoie (json, erreur)."""
    py = (f"sudo -u {sudo} " if sudo else "") + "python3 - " + shlex.quote(arg)
    cmd = ["bash", "-c", py] if ssh in (None, "local") else ["ssh", *SSH_OPTS, ssh, py]
    try:
        r = subprocess.run(cmd, input=src, capture_output=True, text=True, timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        return None, f"timeout après {TIMEOUT}s"
    if r.returncode != 0:
        return None, (r.stderr.strip().splitlines() or [f"code {r.returncode}"])[-1][:200]
    # Un bandeau de connexion (fastfetch, motd dans ~/.bashrc) peut précéder la réponse : elle est sur la dernière ligne JSON
    for line in reversed(r.stdout.splitlines()):
        if line.startswith("{"):
            try:
                return json.loads(line), ""
            except ValueError:
                break
    return None, "réponse illisible"


def qm_crontab(spec: str) -> list[dict]:
    """Crontab root d'une VM lue par le guest agent depuis Proxmox (spec = alias:vmid)."""
    alias, vmid = spec.split(":")
    if not vmid.isdigit() or alias.startswith("-"):   # VM id put in a remote command: digits only; an alias is never an ssh option
        return []
    try:
        r = subprocess.run(["ssh", *SSH_OPTS, alias, f"qm guest exec {vmid} -- crontab -l"],  # NOSONAR S6350: vmid checked as digits and alias never an option, just above
                           capture_output=True, text=True, timeout=60)
        txt = json.loads(r.stdout).get("out-data", "")
    except Exception:
        return []
    return [{"src": "crontab root (qm guest exec)", "line": " ".join(l.split())} for l in txt.splitlines()
            if l.strip() and not l.lstrip().startswith("#") and any(k in l.lower() for k in ("backup", "rsync", "dump"))]


def api_collect(cls, h: dict, prefix: str) -> tuple[dict | None, str]:
    """Machine lue par API (connecteur Veeam ou Home Assistant) : (données, "") ou (None, message)."""
    conf = {"name": h["id"], **{k: h[k] for k in ("url", "secrets", "api_version") if k in h}}
    if h.get("connector"):  # compte réglé dans la page (connecteur de config.json, secrets déjà déchiffrés en mémoire)
        c = next((c for c in CFG.get("connectors") or [] if c.get("name") == h["connector"] and c.get("type") in CONNECTOR_OF[cls]), None)
        if c is None:
            return None, f"{prefix} : connecteur « {h['connector']} » absent de config.json (ou coupé dans Réglages)"
        conf.update({k: c[k] for k in ("url", "user", "password", "token", "api_version", "secret", "verify_tls", "mcp_url") if c.get(k)})
    try:
        return cls(conf, Context()).collect(), ""
    except ConnectorError as e:
        return None, f"{prefix} : {e}"[:200]
    except Exception as e:  # bug du connecteur : machine « injoignable », les autres sont lues
        return None, f"{prefix} : erreur interne ({type(e).__name__}: {e})"[:200]


def remote_collect(h: dict, locs: list[tuple[str, dict]]) -> tuple[dict | None, str]:
    """Box read over FTP / FTPS / Samba (connector « backup-folder » of config.json): the followed folders in the shape of the SSH agent."""
    from connectors.remote_folder import RemoteFolder
    c = next((c for c in CFG.get("connectors") or [] if c.get("name") == h.get("connector") and c.get("type") == RemoteFolder.type), None)
    if c is None:
        return None, f"dossier distant : connecteur « {h.get('connector')} » absent de config.json (ou coupé dans Réglages)"
    conn = RemoteFolder(dict(c), Context())
    out: dict = {"user": conn.proto.upper(), "locs": {}, "disks": [], "crons": [], "cron_root": None}
    try:
        for key, loc in locs:
            out["locs"][key] = conn.scan(loc["path"], loc.get("depth", 1), loc.get("pattern", "*"), loc.get("exclude"))
    except ConnectorError as e:
        return None, f"dossier distant : {e}"[:200]
    except Exception as e:  # connector bug: this box is « unreachable », the others are read
        return None, f"dossier distant : erreur interne ({type(e).__name__}: {e})"[:200]
    return out, ""


# ───────────── Collecte ─────────────

def collect(meta: dict) -> tuple[dict, dict]:
    hosts = {h["id"]: h for h in meta["hosts"]}
    # Machine « mount » (NAS monté sur la collectrice) : disque du point de montage seulement, ni cron ni discover
    reqs: dict[str, dict] = {hid: {"locs": {}, "disks": True, "crons": not h.get("mount"), "mount": h.get("mount"),
                                   "discover": [] if h.get("mount") else meta.get("discover", []),
                                   "cron_ignore": meta.get("cron_ignore", [])}
                             for hid, h in hosts.items() if not h.get("api")}
    for s in meta["sets"]:
        for i, loc in enumerate(s["locations"]):
            if loc.get("path") and not loc.get("syncthing") and loc["host"] in reqs:
                reqs[loc["host"]]["locs"][f"{s['id']}#{i}"] = {k: loc[k] for k in ("path", "pattern", "depth", "exclude") if k in loc}

    def one(hid):
        return hid, run_py(hosts[hid].get("ssh"), AGENT, json.dumps(reqs[hid]))

    def st(node):
        return node["host"], run_py(hosts[node["host"]]["ssh"], ST_AGENT, node["conf"], node.get("sudo"))

    with ThreadPoolExecutor(max_workers=12) as ex:
        res = dict(ex.map(one, reqs))
        sres = dict(ex.map(st, meta.get("syncthing", [])))
    for hid, h in hosts.items():
        if h.get("api") == "ha":
            res[hid] = api_collect(HomeAssistant, h, "API HA")
        elif h.get("api") == "veeam":
            res[hid] = api_collect(Veeam, h, "API Veeam")
        elif h.get("api") == "pbs":
            res[hid] = api_collect(PbsBackups, h, "API Proxmox Backup")
        elif h.get("api") == "remote":
            res[hid] = remote_collect(h, [(f"{s['id']}#{i}", loc) for s in meta["sets"] for i, loc in enumerate(s["locations"])
                                          if loc["host"] == hid and loc.get("path")])
        elif h.get("api") == "none":  # origine sans accès (poste sauvegardé par Veeam) : rien à lire, pas « injoignable »
            res[hid] = ({"user": None, "locs": {}, "disks": [], "crons": [], "cron_root": None}, "")
    for hid, h in hosts.items():
        if h.get("cron_via") and res.get(hid, (None,))[0]:
            res[hid][0]["crons"] += qm_crontab(h["cron_via"])
            res[hid][0]["cron_root"] = None
    return res, sres


# ───────────── Analyse ─────────────

CADENCE_WINDOW_DAYS = 120   # an archive older than this says nothing about the current rhythm (a forgotten file would stretch it)
CADENCE_RUNS = 8            # the rhythm is read on the most recent runs only


def cadence(files: list[dict]) -> float | None:
    """Observed rhythm of a folder, in days: median gap between the days archives were written (several files the same day = one run).
    Only the recent runs count: the files of the last CADENCE_WINDOW_DAYS days before the newest one, and at most CADENCE_RUNS runs. None with fewer than 3 runs."""
    if not files:
        return None
    newest = max(f["mtime"] for f in files)
    recent = [f for f in files if newest - f["mtime"] <= CADENCE_WINDOW_DAYS * 86400]
    days = sorted({f["mtime"] // 3600 // 6 for f in recent}, reverse=True)[:CADENCE_RUNS]   # 6-hour slots: one run, even if it writes for a while
    gaps = sorted((a - b) * 0.25 for a, b in zip(days, days[1:]))
    return round(gaps[len(gaps) // 2], 1) if len(gaps) >= 2 else None


def age_days(ts: int, now: float) -> float:
    return round((now - ts) / 86400, 1)


def level_for_age(age: float, max_age: float) -> str:
    return "ok" if age <= max_age else "warn" if age <= max_age * 2 else "crit"


def analyse(meta: dict, res: dict, sres: dict, now: float) -> dict:
    hosts = {h["id"]: h for h in meta["hosts"]}
    devmap = meta.get("syncthing_devices", {})
    sets_out, issues = [], []

    for s in meta["sets"]:
        archived, max_age, each = s.get("archived", False), s.get("max_age_days", 8), s.get("mode") == "each"
        locs, src_files = [], None
        for i, loc in enumerate(s["locations"]):
            L = {"host": loc["host"], "label": hosts[loc["host"]]["label"], "path": loc.get("path"), "via": loc.get("via", ""),
                 "role": "source" if i == 0 else "copie", "level": "na", "detail": "", "encrypted": bool(loc.get("encrypted")), "vzdump": loc.get("vzdump"),
                 "share": bool((i or loc.get("vzdump")) and loc.get("offsite"))}   # copy (or Proxmox dump) on a network share (NAS) mounted on the origin: off the machine all the same
            if loc.get("syncthing"):
                node = (sres.get(loc["from"]) or (None,))[0]
                f = next((x for x in (node or {}).get("folders", []) if x["id"] == loc["syncthing"]), None)
                peer = next((p for p in (f or {}).get("peers", []) if devmap.get(p["name"]) == loc["host"]), None)
                dev = next((d for d in (node or {}).get("devices", []) if devmap.get(d["name"]) == loc["host"]), None)
                if not peer:
                    L["level"], L["detail"] = "warn", "état Syncthing illisible"
                else:
                    L["completion"] = peer["completion"]
                    L["connected"] = bool(dev and dev["connected"])
                    L["level"] = "ok" if peer["completion"] >= 100 and L["connected"] else "warn"
                    L["detail"] = (f"{peer['completion']:g} % à jour" + ("" if L["connected"] else ", pair déconnecté"))
                locs.append(L)
                continue
            r, err = res.get(loc["host"], (None, "machine non lue"))
            data = (r or {}).get("locs", {}).get(f"{s['id']}#{i}")
            if loc.get("veeam_job") and r:
                # Job Veeam : âge du dernier passage ; Failed = crit, Warning = au moins warn
                j = r["veeam_jobs"].get(loc["veeam_job"])
                if not j:
                    L["level"], L["detail"] = "crit", f"job « {loc['veeam_job']} » absent de Veeam"
                elif not j["last_run"]:
                    L["level"], L["detail"] = "crit", "job jamais lancé"
                else:
                    L["age"] = age_days(j["last_run"], now)
                    L["newest"] = {"name": loc["veeam_job"], "mtime": j["last_run"], "size": 0}
                    L["level"] = "crit" if j["result"] == "Failed" else \
                        max(level_for_age(L["age"], max_age), "warn" if j["result"] == "Warning" else "ok", key=RANK.get)
                    L["detail"] = f"dernier passage : {j['result']}" + (f" ({j['status']})" if j["status"] not in (None, "Inactive") else "")
                # Le job écrit dans un dépôt Veeam (NAS, autre serveur) : copie hors machine, sauf "offsite": false
                L["offsite"] = loc.get("offsite", True)
                locs.append(L)
                continue
            if loc.get("pbs_group") and r:
                # Groupe Proxmox Backup (magasin/type/id) : âge de la dernière sauvegarde
                g = r["pbs_groups"].get(loc["pbs_group"])
                if not g:
                    L["level"], L["detail"] = "crit", f"groupe « {loc['pbs_group']} » absent de Proxmox Backup"
                elif not g["last_run"]:
                    L["level"], L["detail"] = "crit", "aucune sauvegarde"
                else:
                    L["age"] = age_days(g["last_run"], now)
                    L["newest"] = {"name": loc["pbs_group"], "mtime": g["last_run"], "size": 0}
                    L["level"] = level_for_age(L["age"], max_age)
                    L["detail"] = f"{g['count']} sauvegarde(s) gardée(s)"
                L["offsite"] = loc.get("offsite", True)
                locs.append(L)
                continue
            if loc.get("ha_backup") and r:
                hb = r["ha_backup"]
                top = next((i for i in (hb.get("list") or {}).get("items") or [] if i.get("date")), None)
                if top:   # liste réelle des sauvegardes (module ha-mcp) : la plus récente, et où elle est copiée
                    L["age"] = age_days(top["date"], now)
                    L["newest"] = {"name": top["name"] or top["id"], "mtime": top["date"], "size": top["size"]}
                    L["level"] = level_for_age(L["age"], max_age)
                    L["count"] = hb["list"]["total"]
                    L["encrypted"] = bool(top["protected"])
                    L["offsite"] = bool(hb["list"]["offsite"])   # constaté, pas supposé : la plus récente existe aussi hors de Home Assistant
                    where = ", ".join(top["locations"]) or "?"
                    L["detail"] = (f"{hb['list']['total']} sauvegarde(s) ; la dernière est {'chiffrée' if top['protected'] else 'NON chiffrée'}, "
                                   f"stockée : {where}" + ("" if L["offsite"] else " (uniquement sur Home Assistant)"))
                    if hb["last_attempt"] and hb["last_ok"] and hb["last_attempt"] > hb["last_ok"] + 3600:
                        L["level"], L["detail"] = "crit", "le dernier essai de sauvegarde a échoué"
                    locs.append(L)
                    continue
                if not hb["last_ok"]:
                    L["level"], L["detail"] = "crit", "aucune sauvegarde réussie connue"
                else:
                    L["age"] = age_days(hb["last_ok"], now)
                    L["newest"] = {"name": "sauvegarde auto HA", "mtime": hb["last_ok"], "size": 0}
                    L["level"] = level_for_age(L["age"], max_age)
                    L["detail"] = "dernière sauvegarde auto réussie"
                    L["offsite"] = loc.get("offsite", False)  # « offsite »: true (Réglages) : la sauvegarde de HA compte comme copie hors de lui
                    if hb["last_attempt"] and hb["last_attempt"] > hb["last_ok"] + 3600:
                        L["level"], L["detail"] = "crit", "le dernier essai de sauvegarde a échoué"
                locs.append(L)
                continue
            if r is None:
                L["level"], L["detail"] = "down", f"injoignable ({err})"
            elif not data or not data.get("exists"):
                L["level"], L["detail"] = "crit", "dossier absent"
            elif not data["count"]:
                L["level"], L["detail"] = "crit", "aucune archive"
                L["count"] = 0
            else:
                files = data["files"]
                L.update(count=data["count"], size=data["size"], newest=files[0])
                if i == 0:
                    L["recent"] = [f["name"] for f in files[:5]]   # names looked for when searching where the set is copied
                if each:
                    latest = {}
                    for f in files:
                        latest.setdefault(Path(f["name"]).name, f)
                    oldest = min(latest.values(), key=lambda f: f["mtime"])
                    L["age"] = age_days(oldest["mtime"], now)
                    L["oldest"] = oldest
                    L["level"] = level_for_age(L["age"], max_age)
                    L["detail"] = f"{len(latest)} archives, la plus ancienne : {oldest['name']}"
                else:
                    L["age"] = age_days(files[0]["mtime"], now)
                    L["level"] = level_for_age(L["age"], max_age)
                    L["detail"] = files[0]["name"]
                if i == 0:
                    src_files = files
                elif src_files:
                    # Copie jugée sur son retard par rapport à la source (l'âge de la source est jugé une fois, sur la source) :
                    # archive manquante ou plus ancienne, hors archives de moins de GRACE_H (copie pas encore passée)
                    L["level"], L["detail"] = "ok", "à jour avec la source"
                    # archives à nom fixe : comparées par nom ; archives datées : par chemin (dossiers datés à fichier commun)
                    key = (lambda f: Path(f["name"]).name) if each else (lambda f: f["name"])
                    cmap = {}
                    for f in files:
                        cmap.setdefault(key(f), f)
                    ref = src_files if each else src_files[:1]
                    seen, late = set(), []
                    for f in ref:
                        n = key(f)
                        if n in seen or now - f["mtime"] < GRACE_H * 3600:
                            continue
                        seen.add(n)
                        c = cmap.get(n)
                        size_differs = c and c["size"] != f["size"] and not L["encrypted"]  # gocryptfs ajoute ses en-têtes
                        if not c or c["mtime"] < f["mtime"] - 3600 or (size_differs and c["mtime"] <= f["mtime"]):
                            late.append(n)
                    if late:
                        L["late"] = late
                        L["level"] = "warn"
                        L["detail"] = f"en retard sur la source : {', '.join(late[:3])}" + (" …" if len(late) > 3 else "")
            if archived and L["level"] != "down":
                L["level"] = "archive"
            locs.append(L)

        src = locs[0]
        # Copie à jour hors machine ; un job Veeam en Warning compte (son niveau propre est déjà dans celui du jeu)
        offsite = [l for i, l in enumerate(locs) if (l["host"] != s["origin"] or l.get("share")) and
                   (i and l["level"] == "ok" or not i and (l.get("offsite") or l.get("share")) and l["level"] in ("ok", "warn"))]
        level, why = src["level"], []
        if src["level"] in ("warn", "crit"):
            old = None if src.get("offsite") else src.get("oldest") or src.get("newest")  # job Veeam : son résultat
            if src.get("offsite") and src.get("age") is not None:
                src["detail"] += f", il y a {hage(src['age'])} (seuil {max_age} j)"
            why.append(f"source {src['label']} : " + (f"{Path(old['name']).name} date de {hage(src['age'])} (seuil {max_age} j)" if old else src["detail"]))
        expect = s.get("expect_offsite", True)  # False : jeu décrit depuis la page (un dossier) sans copie déclarée ailleurs : rien à exiger
        if not archived:
            if not offsite and expect:
                cov = s.get("covered_by")
                lv = "warn" if cov else "crit"
                level = max(level, lv, key=RANK.get)
                why.append("aucune copie hors machine à jour" + (f" (couvert par le jeu {cov})" if cov else ""))
            for l in locs[1:]:
                if l["level"] in ("warn", "crit", "down"):
                    level = max(level, "warn", key=RANK.get)
                    why.append(f"copie {l['label']} : {l['detail']}")
        else:
            level = "archive"
        sets_out.append({"id": s["id"], "label": s["label"], "origin": s["origin"], "origin_label": hosts[s["origin"]]["label"],
                         "schedule": s.get("schedule", ""), "retention": s.get("retention", ""), "max_age_days": max_age,
                         "mode": "each" if each else "latest", "archived": archived, "level": level,
                         "offsite": len(offsite), "expect_offsite": expect, "locations": locs, "why": why, "size": src.get("size", 0),
                         "cadence_days": cadence(src_files) if src_files else None})
        for w in why:
            issues.append({"level": level, "set": s["label"], "text": w})

    meta_sets = {st["id"]: st for st in meta["sets"]}
    by_id = {st["id"]: st for st in sets_out}
    hosts_out = []
    for h in meta["hosts"]:
        r, err = res.get(h["id"], (None, "non lu"))
        mine = [x for x in sets_out if x["origin"] == h["id"] and not x["archived"]]
        disks = (r or {}).get("disks", [])
        dlevel = "ok"
        for d in disks:
            d["level"] = "crit" if d["pct"] >= DISK_CRIT else "warn" if d["pct"] >= DISK_WARN else "ok"
            dlevel = max(dlevel, d["level"], key=RANK.get)
            if d["level"] != "ok":
                issues.append({"level": d["level"], "set": h["label"], "text": f"disque {d['mount']} rempli à {d['pct']:g} %"})
        local = []
        ignored = meta.get("discover_ignore", {}).get(h["id"], [])
        for x in (r or {}).get("local", []):
            if any(x["path"] == i or x["path"].startswith(i + "/") for i in ignored):
                continue
            cov = sorted({st["id"] for st in meta["sets"] for loc in st["locations"]
                          if loc["host"] == h["id"] and loc.get("path") and
                          (loc["path"].rstrip("/") == x["path"] or loc["path"].startswith(x["path"] + "/") or x["path"].startswith(loc["path"].rstrip("/") + "/"))})
            local.append(x | {"covered": cov, "age": age_days(x["newest"], now) if x["newest"] else None})
        # Dernier backup local : archive la plus récente parmi les sources des jeux produits par la machine
        srcs = [(x["locations"][0], x) for x in mine if x["locations"][0].get("newest")]
        last = max(srcs, key=lambda t: t[0]["newest"]["mtime"]) if srcs else None
        last_local = {"age": age_days(last[0]["newest"]["mtime"], now), "mtime": last[0]["newest"]["mtime"],
                      "set": last[1]["label"], "level": last[0]["level"]} if last else None
        # Copié ailleurs : une entrée par machine de destination (hors machine d'origine), le pire niveau l'emporte
        dests = {}
        for x in mine:
            cov = meta_sets[x["id"]].get("covered_by")
            # jeu couvert par un autre (ex. dump de la VM) : ses copies valent aussi pour cette machine
            locs_ = x["locations"][1:] + ([dict(l, via=f"{l['via']} (dump VM)") for l in by_id[cov]["locations"]] if cov in by_id else [])
            for l in locs_:
                if l["host"] == h["id"] and not l.get("share"):
                    continue
                dk = f"{l['host']}:share" if l.get("share") else l["host"]
                dd = dests.setdefault(dk, {"host": l["host"], "label": l["label"] + (" · partage réseau" if l.get("share") else ""), "vias": [], "sets": 0, "level": "ok", "age": None,
                                                  "encrypted": bool(l.get("encrypted"))})
                dd["sets"] += 1
                if l["via"] not in dd["vias"]:
                    dd["vias"].append(l["via"])
                dd["level"] = max(dd["level"], "warn" if l["level"] in ("crit", "down") else l["level"], key=RANK.get)
                if l.get("age") is not None:
                    dd["age"] = l["age"] if dd["age"] is None else min(dd["age"], l["age"])
        lv = "down" if r is None else max([dlevel] + [x["level"] for x in mine], key=RANK.get)
        hosts_out.append({"id": h["id"], "label": h["label"], "ip": h.get("ip", ""), "kind": h.get("kind", ""), "note": h.get("note", ""),
                          "storage": bool(h.get("storage") or h.get("mount")),
                          "reachable": r is not None, "error": "" if r else err, "user": (r or {}).get("user"),
                          "disks": disks, "crons": (r or {}).get("crons", []),
                          "cron_root": (r or {}).get("cron_root"), "cron_hint": h.get("cron_hint", ""),
                          "sets": [x["id"] for x in mine], "level": lv, "local": local,
                          "last_local": last_local, "copies": list(dests.values()),
                          "set_levels": {k: sum(1 for x in mine if x["level"] == k) for k in ("ok", "warn", "crit")}})
        if r is None:
            issues.append({"level": "down", "set": h["label"], "text": f"machine injoignable ({err})"})

    stn = []
    for node in meta.get("syncthing", []):
        r, err = sres.get(node["host"], (None, "non lu"))
        stn.append({"host": node["host"], "label": hosts[node["host"]]["label"], "ok": r is not None, "error": err, **(r or {})})
        for d in (r or {}).get("devices", []):
            if not d["connected"] and not d["paused"]:
                issues.append({"level": "warn", "set": "Syncthing", "text": f"{hosts[node['host']]['label']} : pair {d['name']} déconnecté"})
        for f in (r or {}).get("folders", []):
            if f["errors"]:
                issues.append({"level": "warn", "set": "Syncthing", "text": f"{hosts[node['host']]['label']} : {f['label']} a {f['errors']} erreur(s)"})

    issues.sort(key=lambda i: -RANK[i["level"]])
    active = [x for x in sets_out if not x["archived"]]
    return {"generated": datetime.fromtimestamp(now).astimezone().isoformat(timespec="seconds"),
            "summary": {k: sum(1 for x in active if x["level"] == k) for k in ("ok", "warn", "crit")}
                       | {"sets": len(active), "archived": len(sets_out) - len(active), "hosts": len(hosts_out),
                          "volume": sum(x["size"] for x in active),
                          "no_offsite": sum(1 for x in active if not x["offsite"] and x["expect_offsite"]),
                          "offsite_unknown": sum(1 for x in active if not x["offsite"] and not x["expect_offsite"]),
                          "local_dirs": sum(len(h["local"]) for h in hosts_out),
                          "local_unlisted": sum(1 for h in hosts_out for x in h["local"] if not x["covered"] and x["size"])},
            "crypt_help": meta.get("crypt_help"),
            "hosts": hosts_out, "sets": sets_out, "syncthing": stn, "issues": issues}



def hage(a: float | None) -> str:
    if a is None:
        return ""
    if a < 1:
        return f"{max(1, round(a * 24))} h"
    return f"{a:.0f} j" if a >= 10 else f"{a:.1f} j".replace(".", ",")


def main() -> int:
    if OUT_JSON.is_symlink():  # backups_url branché sur un script externe : ne jamais écrire dedans
        sys.exit(f"{OUT_JSON} est un lien (script de sauvegardes externe) : backups.py ne tourne pas")
    try:
        meta = json.loads(META.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        sys.exit(f"{META} illisible : {e} (modèle : backups-meta.example.json)")
    now = datetime.now().timestamp()
    res, sres = collect(meta)
    d = analyse(meta, res, sres, now)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
    if os.geteuid() == 0:  # rendu au propriétaire du projet, comme data.json
        st = HERE.stat()
        os.chown(tmp, st.st_uid, st.st_gid)
    os.replace(tmp, OUT_JSON)
    sm = d["summary"]
    print(f"{d['generated']} backups : {sm['ok']} ok, {sm['warn']} warn, {sm['crit']} crit, "
          f"{len(d['issues'])} point(s) d'attention", flush=True)
    return 0


if __name__ == "__main__":
    import app_user
    app_user.drop_root()   # docker compose exec : root -> compte 10001 (sa config SSH, fichiers de /data restés à lui)
    sys.exit(main())
