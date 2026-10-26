#!/usr/bin/env python3
"""health.py : santé des machines de services-meta.json (disque, systemd, Docker, maj, noyau,
charge, échecs SSH, SMART), sans LLM, en LECTURE SEULE.

Machines : celles de services-meta.json qui ont un accès (« ssh » = alias de ~/.ssh/config, ou
"local"), sauf « off » (éteinte voulue) ou « health »: false. « vm »: true désactive SMART
(disque virtuel). Une commande SSH par contrôle, avec les clés de l'utilisateur qui lance le
script (root via myservices-health.service, comme le collecteur).

Sorties dans <web_dir>/health/ : index.html (tableau), stats.json (lu par l'onglet Machines et
le bandeau de la page MyServices), events.json (changements de niveau, fusionnés dans l'onglet
Historique). Page activée par health_url = "health/" dans config.json.

Comptes distants : lire le journal (échecs SSH, noyau) demande le groupe adm ou systemd-journal,
sinon « non lisible », jamais 0. SMART : règle sudoers NOPASSWD pour /usr/sbin/smartctl -H,
facultative (sans elle : « non accessible »).

Windows (« os »: "windows", accès par « health »: "<alias>" vers OpenSSH Server) : un seul appel
PowerShell, en lecture, rangé dans les mêmes champs que Linux : volumes (disque), services automatiques
arrêtés en erreur (systemd), CPU et dernier démarrage (charge), erreurs critiques et disque du journal
Système (noyau), mises à jour en attente (maj), échecs de connexion 4625 (SSH, compte administrateur),
Get-PhysicalDisk (SMART), redémarrage en attente.

Alerte Discord (health_webhook, sinon discord_webhook) : envoyée seulement si le résumé change.
Usage : python3 health.py [--dry-run]
"""
from __future__ import annotations

import ast
import base64
import hashlib
import html as html_lib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import notify
from config import CFG, next_timer_run
from docker_state import allowed_names, intended_stop
import readers
from sshmux import SSH_MUX

STATE_FILE = Path(CFG["state_dir"]) / "health.json"
CONNECTORS_STATE = Path(CFG["state_dir"]) / "connectors.json"   # shared readings of the connectors (readers.py, the collection)
OUT_DIR = Path(CFG["web_dir"]) / "health"
INDEX = OUT_DIR / "index.html"
STATS_JSON = OUT_DIR / "stats.json"
HASH_FILE = OUT_DIR / ".last-discord-hash"
# Changements de niveau par machine, même format que events.json du watcher (fusionnés dans l'onglet Historique)
EVENTS_JSON = OUT_DIR / "events.json"
EVENTS_RETENTION_DAYS = CFG["retention_days"]
TIMER = "myservices-health.timer"
USER_AGENT = "myservices-health/1.0"

# Seuils d'alerte
DISK_WARN_PCT = 80
DISK_CRIT_PCT = 90
INODE_WARN_PCT = 80
SYSTEMD_WARN_N = 1
SYSTEMD_CRIT_N = 3
DOCKER_WARN_N = 1
DOCKER_CRIT_N = 3
DOCKER_CPU_WARN_PCT = 50   # % CPU moyen/conteneur : repère un conteneur gourmand
DOCKER_CPU_CRIT_PCT = 80
DOCKER_MEM_WARN_PCT = 50   # % mem/conteneur : repere un conteneur gourmand
DOCKER_MEM_CRIT_PCT = 80
APT_CRIT_N = 20  # paquets en attente : au-dela, systeme visiblement pas maintenu
UPDATES_LISTED = 30  # packages (apt) or Windows updates named in the list; the count stays exact beyond
CPU_WARN_PCT = 90   # Windows : % CPU instantané (pas de load average)
LOAD_WARN_MULT = 1.5   # load avg 1min > mult × ncpu
LOAD_CRIT_MULT = 3.0
SSH_AUTH_WARN_N = 20    # tentatives échouées / 24h
SSH_AUTH_CRIT_N = 100
# Erreurs noyau connues et bénignes, ignorées (toutes machines).
# shpchp -16 (EBUSY) : sur les ponts PCI QEMU, acpiphp a déjà pris les slots au boot,
# shpchp échoue ensuite : sans impact, le hotplug passe par ACPI (vu sur dev, 2026-09-28).
# AF_VSOCK : VM sans périphérique vsock, systemd-ssh-generator échoue au boot (dev, monitor).
# snd_hda_intel : carte son virtuelle QEMU sans codec (dev).
KERNEL_IGNORE_RE = re.compile(
    r"shpchp [0-9a-f:.]+: (pci_hp_register failed with error -16|Slot initialization failed)"
    r"|systemd-ssh-generator\[\d+\]: Failed to query local AF_VSOCK CID"
    r"|system-generators/systemd-ssh-generator failed with exit status 1"
    r"|snd_hda_intel [0-9a-f:.]+: no codecs found"
    r"|CIFS: VFS: (Autodisabling the use of server inode numbers|The server doesn't seem to support them|Hardlinks will not be recognized)"   # a mount notice of a Samba share, not a fault
)
# ───────────── Machines surveillées ─────────────

def _list_of(m: dict, key: str) -> list:
    """Réglage de machine attendu sous forme de liste (sinon vide)."""
    return m[key] if isinstance(m.get(key), list) else []


def load_hosts(agent_ips: frozenset | set = frozenset()) -> tuple[list[dict], dict]:
    """Machines de services-meta.json hors « off » et « health »: false, et le services-meta lu.
    Accès : « health » (alias dédié), sinon « ssh », sinon l'alias de process_hosts ; sans accès
    (target None) : relevée seulement si Beszel la connaît ou si un agent lui envoie ses relevés (même « off » :
    une machine souvent éteinte reste lue quand son agent a parlé, voir main)."""
    try:
        meta = json.loads(Path(CFG["meta"]).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        sys.exit(f"{CFG['meta']} illisible : {e}")
    hosts = []
    for ip, m in meta.get("machines", {}).items():
        alias = m.get("health") if isinstance(m.get("health"), str) else m.get("ssh") or meta.get("process_hosts", {}).get(ip)
        if m.get("disabled") or m.get("health") is False or (m.get("off") and ip not in agent_ips):
            continue
        hid = re.sub(r"[^a-z0-9]+", "-", m["name"].lower()).strip("-") or ip
        hosts.append({"id": hid, "name": f"{m['name']} · {ip}",  # « Nom · IP » : l'IP est relue par la page
                      "mode": "local" if alias == "local" else "ssh", "target": alias, "vm": bool(m.get("vm")),
                      "os": m.get("os", "linux"), "ip": ip, "off": bool(m.get("off")),
                      "sources": _list_of(m, "health_sources"), "stopped_ok": _list_of(m, "stopped_ok")})
    return hosts, meta


LEVEL_RANK = {"ok": 0, "na": 0, "warn": 1, "crit": 2, "down": 3}
LEVEL_LABEL = {"ok": "OK", "warn": "WARN", "crit": "CRIT", "down": "INJOIGNABLE", "na": "N/A"}


def worst(*levels: str) -> str:
    return max(levels, key=lambda l: LEVEL_RANK[l])

# ───────────── Exécution locale / distante ─────────────

def make_runner(host: dict):
    """Retourne run(cmd, timeout) -> (rc, stdout) local ou via SSH selon host['mode']."""
    if host["mode"] == "local":
        def run(cmd: str, timeout: int = 15, data: str | None = None) -> tuple[int, str]:
            try:
                r = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=timeout, input=data)
            except subprocess.TimeoutExpired:
                return 124, f"timeout après {timeout}s"
            except Exception as e:
                return 1, str(e)
            return (0, r.stdout) if r.returncode == 0 else (r.returncode, (r.stdout + r.stderr).strip())
    else:
        target = host["target"]

        def run(cmd: str, timeout: int = 15, data: str | None = None) -> tuple[int, str]:   # data: sent on the command's stdin
            # Repère avant la commande : un bandeau d'accueil (fastfetch, motd dans ~/.bashrc) précède sinon la sortie
            marked = host.get("os") != "windows"  # PowerShell n'a pas printf : Windows garde sa commande telle quelle
            full = ["ssh", *SSH_MUX, "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", target, f"printf '%s\\n' {SSH_MARK}; {cmd}" if marked else cmd]
            try:
                r = subprocess.run(full, capture_output=True, text=True, timeout=timeout, input=data)
            except subprocess.TimeoutExpired:
                return 124, f"timeout après {timeout}s"
            except Exception as e:
                return 1, str(e)
            return (0, after_banner(r.stdout) if marked else r.stdout) if r.returncode == 0 else (r.returncode, ((after_banner(r.stdout) if marked else r.stdout) + r.stderr).strip())
    return run

SSH_MARK = "__MSV_START__"


def after_banner(out: str) -> str:
    """Sortie d'une commande SSH sans ce qui précède le repère (bandeau de connexion, avertissements du shell distant)."""
    head, sep, tail = out.partition(SSH_MARK + "\n")
    return tail if sep else out


# ───────────── Collecte ─────────────

DISKS_CMD = "df -P -B1M | tail -n +2; echo '---'; df -P -i | tail -n +2"
SYSTEMD_CMD = "systemctl --failed --no-legend --no-pager"
DOCKER_PS_CMD = "docker ps -a --format '{{.Names}}|{{.Status}}|{{.Image}}' 2>&1"
DOCKER_STATS_CMD = "docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>/dev/null"
APT_CMD = "LC_ALL=C apt list --upgradable 2>/dev/null"
KERNEL_CMD = "journalctl -k -p err --since '-12h' --no-pager 2>/dev/null | tail -n 50"
REBOOT_CMD = "test -f /var/run/reboot-required && echo yes || echo no"
LOAD_CMD = "cat /proc/loadavg; nproc"
VIRT_CMD = "systemd-detect-virt 2>/dev/null"
SSH_AUTH_CMD = (
    "if [ \"$(id -u)\" = 0 ] || id -nG | grep -qwE 'adm|systemd-journal'; then "
    "journalctl -u ssh -u sshd --since '-24h' --no-pager 2>/dev/null "
    "| grep -E 'Failed password|authentication failure|Invalid user' | grep -vc 'Invalid user nobody' || true; "
    "else echo noaccess; fi")
SMART_LIST_CMD = "test -x /usr/sbin/smartctl && lsblk -dno NAME,TYPE 2>/dev/null | awk '$2==\"disk\"{print $1}'"


def smart_cmd(target: str) -> str:
    return f"sudo -n /usr/sbin/smartctl -H /dev/{target} 2>&1"


def collect_disks(run) -> list[dict]:
    rc, out = run(DISKS_CMD)
    disks = []
    if rc != 0:
        return disks
    parts = out.split("---")
    sizes_section = parts[0] if parts else ""
    inodes_section = parts[1] if len(parts) > 1 else ""
    inode_map = {}
    for ln in inodes_section.strip().splitlines():
        cols = ln.split()
        if len(cols) >= 6:
            try:
                inode_map[cols[-1]] = int(cols[4].rstrip("%"))
            except ValueError:
                pass
    skip_fs_prefix = ("tmpfs", "devtmpfs", "udev", "/dev/loop", "//", "overlay", "shm")
    skip_mount_prefix = ("/sys", "/proc", "/run", "/dev", "/var/lib/docker/overlay", "/snap")
    for ln in sizes_section.strip().splitlines():
        cols = ln.split()
        if len(cols) < 6:
            continue
        device, mount = cols[0], cols[-1]
        if device.startswith(skip_fs_prefix) or mount.startswith(skip_mount_prefix):
            continue
        try:
            size_mb, used_mb, avail_mb = int(cols[1]), int(cols[2]), int(cols[3])
            pct = int(cols[4].rstrip("%"))
        except ValueError:
            continue
        inode_pct = inode_map.get(mount, 0)
        disks.append({
            "device": device, "mount": mount,
            "size_gb": round(size_mb / 1024, 1), "used_gb": round(used_mb / 1024, 1),
            "avail_gb": round(avail_mb / 1024, 1), "used_pct": pct, "inode_pct": inode_pct,
            "critical": pct >= DISK_CRIT_PCT or inode_pct >= DISK_CRIT_PCT,
            "warning": pct >= DISK_WARN_PCT or inode_pct >= INODE_WARN_PCT,
        })
    disks.sort(key=lambda d: d["used_pct"], reverse=True)
    return disks


def collect_systemd(run) -> dict:
    rc, out = run(SYSTEMD_CMD)
    info = {"failed": []}
    if rc != 0:
        return info
    for ln in out.strip().splitlines():
        cols = ln.split(maxsplit=4)
        if cols and cols[0].endswith(".service"):
            info["failed"].append({
                "unit": cols[0],
                "active": cols[2] if len(cols) > 2 else "",
                "sub": cols[3] if len(cols) > 3 else "",
                "desc": cols[4] if len(cols) > 4 else "",
            })
    return info


def _docker_state(status: str) -> str:
    """healthy, unhealthy, restarting ou exited (un conteneur « Dead » compte comme arrêté en erreur)."""
    if "Restarting" in status:
        return "restarting"
    if "Exited" in status or "Dead" in status:
        return "exited"
    return "unhealthy" if "unhealthy" in status.lower() else "healthy"


def _percent(text: str) -> float:
    try:
        return float(text.rstrip("%").replace(",", "."))
    except ValueError:
        return 0.0


def _docker_stats(run) -> list[dict]:
    """Stats CPU/mem : un seul échantillon, pour repérer les conteneurs gourmands (le plus gourmand d'abord)."""
    rc, out = run(DOCKER_STATS_CMD, timeout=25)
    cstats = []
    for ln in out.strip().splitlines() if rc == 0 else ():
        cols = ln.split("|")
        if len(cols) >= 4:
            cstats.append({"name": cols[0], "cpu": _percent(cols[1]), "mem_usage": cols[2].strip(), "mem_pct": _percent(cols[3])})
    return sorted(cstats, key=lambda c: c["cpu"], reverse=True)


def collect_docker(run, stopped_ok=()) -> dict:
    """Best effort : gracieux si pas d'accès au socket docker (retourne accessible: False).
    stopped_ok : noms de conteneurs que l'on laisse arrêtés exprès (réglage de la machine), quel que soit leur code de sortie."""
    allowed = allowed_names(stopped_ok)
    rc, out = run(DOCKER_PS_CMD, timeout=10)
    if rc != 0 or "permission denied" in out.lower() or "cannot connect" in out.lower():
        return {"accessible": False, "reason": out.strip()[:120]}
    containers, stopped = [], []
    count = dict.fromkeys(("healthy", "unhealthy", "restarting", "exited"), 0)
    for ln in out.strip().splitlines():
        cols = ln.split("|", 2)
        if len(cols) < 3:
            continue
        name, status, image = cols
        entry = {"name": name, "status": status, "image": image}
        if intended_stop(name, status, allowed):
            stopped.append(entry)
            continue
        count[_docker_state(status)] += 1
        containers.append(entry)
    issues = [c for c in containers if "Exited" in c["status"] or "Restarting" in c["status"]
              or "unhealthy" in c["status"].lower()]
    cstats = _docker_stats(run)
    total_cpu = round(sum(c["cpu"] for c in cstats), 1)
    avg_cpu = round(total_cpu / len(cstats), 1) if cstats else 0.0

    return {
        "accessible": True, "total": len(containers),  # hors conteneurs arrêtés volontairement
        "stopped": len(stopped), "stopped_list": stopped[:10],
        **count, "issues": issues[:10],
        "total_cpu": total_cpu, "avg_cpu": avg_cpu, "top": cstats[:3],
    }


def collect_apt(run) -> dict:
    """Compte + échantillon des paquets upgradable en un seul appel `apt list`.

    Ne filtre PAS sur le texte "Listing..." (locale-dépendant : en français apt affiche
    "En train de lister…", donc `grep -v '^Listing'` ne le voit pas et cette ligne de
    statut était comptée à tort comme un paquet). On matche directement le format réel
    d'une ligne de paquet (nom/repo version ...), ce qui exclut naturellement toute ligne
    de statut/progression quelle que soit la langue du système.
    """
    rc, out = run(APT_CMD, timeout=15)
    info = {"upgradable": 0, "sample": []}
    if rc != 0:
        return info
    for ln in out.splitlines():
        m = re.match(r"^(\S+)/\S+\s+(\S+)\s+", ln)
        if not m:
            continue
        info["upgradable"] += 1
        if len(info["sample"]) < 8:
            info["sample"].append(f"{m.group(1)} → {m.group(2)}")
    return info


def collect_kernel_errors(run) -> dict:
    # Pas de 2>&1 : le hint "vous ne voyez pas les messages des autres utilisateurs..."
    # (compte hors groupes adm/systemd-journal) part sur stderr et ne doit pas polluer stdout.
    rc, out = run(KERNEL_CMD, timeout=15)
    lines = []
    if rc == 0:
        for ln in out.splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("--") or "No entries" in ln:
                continue
            # Filet de sécurité si le hint arrive quand même (certains systèmes le mettent sur stdout).
            if ln.startswith(("Hint:", "Users in groups", "Pass -q")):
                continue
            if KERNEL_IGNORE_RE.search(ln):
                continue
            lines.append(ln[:200])
    return {"has_errors": bool(lines), "samples": lines[-8:]}   # the 8 most recent (the journal comes oldest first)


def collect_reboot_required(run) -> bool:
    rc, out = run(REBOOT_CMD, timeout=6)
    return rc == 0 and out.strip() == "yes"


def collect_load(run) -> dict:
    rc, out = run(LOAD_CMD, timeout=8)
    if rc != 0:
        return {"load_1": 0.0, "ncpu": 1, "available": False}
    lines = out.strip().splitlines()
    try:
        load_1 = float(lines[0].split()[0])
        ncpu = max(int(lines[1].strip()), 1)
    except (IndexError, ValueError):
        return {"load_1": 0.0, "ncpu": 1, "available": False}
    return {"load_1": load_1, "ncpu": ncpu, "available": True}


# Biggest log files under /var/log (same filesystem only), then the journal's disk use; read-only
LOGS_MIN_MB, LOGS_TOP = 10, 6
LOGS_CMD = ("find /var/log -xdev -type f -not -path '/var/log/journal/*' -size +%dM -printf '%%s %%p\\n' 2>/dev/null | sort -rn | head -n %d; echo '---'; "
            "journalctl --disk-usage 2>/dev/null") % (LOGS_MIN_MB, LOGS_TOP)


def collect_big_logs(run) -> dict:
    """The biggest files of /var/log (over LOGS_MIN_MB) and the size of the systemd journal, both in MB."""
    rc, out = run(LOGS_CMD, timeout=15)
    if rc != 0:
        return {"available": False, "files": [], "journal_mb": None}
    head, _, tail = out.partition("---")
    files = []
    for ln in head.strip().splitlines():
        size, _, path = ln.strip().partition(" ")
        if size.isdigit() and path.startswith("/var/log/"):
            files.append({"path": path[:200], "mb": round(int(size) / 1048576)})
    m = re.search(r"take up ([\d.]+)([KMGT])", tail)
    journal = round(float(m.group(1)) * {"K": 1 / 1024, "M": 1, "G": 1024, "T": 1048576}[m.group(2)]) if m else None
    return {"available": True, "files": files, "journal_mb": journal}


MEM_WARN_PCT, MEM_CRIT_PCT = 90, 97  # mémoire utilisée (hors cache) ; le CPU instantané seul n'alerte pas, c'est la charge qui le fait

# Deux lectures de /proc/stat à 1 s d'écart (pourcentage CPU réel) puis la mémoire
_RES_CMD = "head -1 /proc/stat; sleep 1; head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo"


def parse_resources(out: str) -> dict:
    """Usage CPU (%) et mémoire d'une machine Linux d'après /proc ; {"available": False} si illisible."""
    stats, mem = [], {}
    for ln in out.splitlines():
        cols = ln.split()
        if cols and cols[0] == "cpu" and len(cols) >= 8:
            try:
                stats.append([int(x) for x in cols[1:9]])
            except ValueError:
                return {"available": False}
        elif len(cols) >= 2 and cols[0].rstrip(":") in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree") and cols[1].isdigit():
            mem[cols[0].rstrip(":")] = int(cols[1]) // 1024  # ko -> Mo
    if len(stats) != 2 or not mem.get("MemTotal") or "MemAvailable" not in mem:
        return {"available": False}
    total = sum(stats[1]) - sum(stats[0])
    idle = (stats[1][3] + stats[1][4]) - (stats[0][3] + stats[0][4])
    used = mem["MemTotal"] - mem["MemAvailable"]
    return {"available": True, "cpu_pct": round(100 * (total - idle) / total, 1) if total > 0 else 0.0,
            "mem_total_mb": mem["MemTotal"], "mem_used_mb": used, "mem_pct": round(100 * used / mem["MemTotal"], 1),
            "swap_total_mb": mem.get("SwapTotal", 0), "swap_used_mb": max(mem.get("SwapTotal", 0) - mem.get("SwapFree", 0), 0)}


def collect_resources(run) -> dict:
    rc, out = run(_RES_CMD, timeout=10)
    return parse_resources(out) if rc == 0 else {"available": False}


def resources_level(res) -> str:
    p = res.get("mem_pct") if isinstance(res, dict) else None
    if not isinstance(p, (int, float)):
        return "na"
    return "crit" if p >= MEM_CRIT_PCT else "warn" if p >= MEM_WARN_PCT else "ok"


TEMP_WARN_C, TEMP_CRIT_C = 85, 95  # °C du processeur ; au-delà, la machine bride ou s'éteint

# Capteur du processeur : AMD (k10temp), Intel (coretemp), ARM / Raspberry Pi (cpu_thermal, cpu-thermal), x86_pkg_temp.
# On ignore acpitz, nvme, amdgpu, wifi : ce ne sont pas le CPU.
CPU_SENSORS = ("k10temp", "coretemp", "zenpower", "cpu_thermal", "cpu-thermal", "x86_pkg_temp")
_TEMP_CMD = (
    "for d in /sys/class/hwmon/hwmon*; do n=$(cat $d/name 2>/dev/null); for t in $d/temp*_input; do "
    "[ -r \"$t\" ] && echo \"hwmon $n $(cat ${t%_input}_label 2>/dev/null | tr ' ' _) $(cat $t)\"; done; done; "
    "for z in /sys/class/thermal/thermal_zone*; do [ -r \"$z/temp\" ] && echo \"zone $(cat $z/type 2>/dev/null) - $(cat $z/temp)\"; done"
)


def parse_cpu_temp(out: str) -> dict:
    """Température du CPU d'après les lignes « source capteur étiquette millidegrés » ; la plus parlante :
    Tctl / Package / Tdie d'abord, sinon le premier capteur CPU. {"available": False} si la machine n'en expose pas (VM…)."""
    best = None
    for ln in out.splitlines():
        cols = ln.split()
        if len(cols) != 4 or not cols[3].lstrip("-").isdigit():
            continue
        kind, name, label, milli = cols
        if name not in CPU_SENSORS:
            continue
        c = round(int(milli) / 1000, 1)
        if not -20 < c < 150:
            continue
        rank = 0 if re.match(r"(Tctl|Tdie|Package|Physical)", label, re.I) or label == "-" else 1
        if best is None or rank < best[0]:
            best = (rank, c, name if label in ("-", "") else f"{name} {label.replace('_', ' ')}")
    return {"available": True, "celsius": best[1], "source": best[2]} if best else {"available": False}


def collect_cpu_temp(run, vm: bool = False) -> dict:
    """Température du CPU ; sans capteur, `virt` dit pourquoi (kvm, vmware… ou « vm » si la machine est déclarée VM)."""
    rc, out = run(_TEMP_CMD, timeout=8)
    temp = parse_cpu_temp(out) if rc == 0 else {"available": False}
    if not temp["available"]:
        rc, out = run(VIRT_CMD, timeout=6)
        virt = out.strip().splitlines()[-1].strip() if out.strip() else ""
        if re.fullmatch(r"[a-z0-9-]{2,20}", virt) and virt != "none":
            temp["virt"] = virt
        elif vm:
            temp["virt"] = "vm"
    return temp


# Graphics cards by their own tool (NVIDIA, AMD): load, temperature, memory, power. Absent tools print nothing; the final « true » keeps the exit code 0.
GPU_CMD = ("(nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw --format=csv,noheader,nounits 2>/dev/null; "
           "echo '---'; rocm-smi --showproductname --showuse --showtemp --showmeminfo vram --json 2>/dev/null; true)")


def _num(v) -> float | None:
    """A number from a tool field (« 45 », « 12.5 », « 4.0 W »); « [N/A] », « N/A » or empty -> None."""
    m = re.match(r"\s*(-?\d+(?:\.\d+)?)", str(v))
    return float(m[1]) if m else None


def _rocm_field(card: dict, *words: str):
    """First value of a rocm-smi card whose key holds every word (its key names change between versions)."""
    return next((v for k, v in card.items() if all(w in k.lower() for w in words)), None)


def _nvidia_gpus(text: str) -> list[dict]:
    gpus = []
    for ln in filter(None, (x.strip() for x in text.splitlines())):
        f = [x.strip() for x in ln.split(",")]
        if len(f) >= 6 and f[0]:
            gpus.append({"name": f[0][:80], "util": _num(f[1]), "temp": _num(f[2]), "mem_used": _num(f[3]), "mem_total": _num(f[4]), "power": _num(f[5])})
    return gpus


def _rocm_gpu(card: dict) -> dict:
    used, total = _num(_rocm_field(card, "vram", "used")), _num(_rocm_field(card, "vram", "total", "memory"))
    return {"name": str(_rocm_field(card, "series") or _rocm_field(card, "card", "model") or "AMD GPU")[:80], "util": _num(_rocm_field(card, "gpu use")),
            "temp": _num(_rocm_field(card, "temperature", "edge")), "power": None,
            "mem_used": round(used / 1048576) if used is not None else None, "mem_total": round(total / 1048576) if total is not None else None}


def parse_gpu(out: str) -> dict:
    """{available, gpus:[{name, util %, temp °C, mem_used MB, mem_total MB, power W}]} from nvidia-smi (csv) and rocm-smi (json); nothing found -> available False."""
    nv, _, amd = out.partition("---")
    try:
        cards = json.loads(amd) if amd.strip() else {}
    except ValueError:
        cards = {}
    gpus = _nvidia_gpus(nv) + [_rocm_gpu(c) for k, c in (cards.items() if isinstance(cards, dict) else []) if k.startswith("card") and isinstance(c, dict)]
    return {"available": bool(gpus), "gpus": gpus}


def collect_gpu(run) -> dict:
    rc, out = run(GPU_CMD, timeout=10)
    return parse_gpu(out) if rc == 0 else {"available": False, "gpus": []}


def temp_level(temp) -> str:
    c = temp.get("celsius") if isinstance(temp, dict) else None
    if not isinstance(c, (int, float)):
        return "na"
    return "crit" if c >= TEMP_CRIT_C else "warn" if c >= TEMP_WARN_C else "ok"


def collect_ssh_auth(run) -> dict:
    """Tentatives d'auth SSH échouées sur 24h (journalctl, service ssh/sshd).

    Sans droit de lecture du journal système (groupe adm / systemd-journal, ou root),
    journalctl ne renvoie rien : on le détecte et on rend available=False au lieu d'un faux 0.
    Les « Invalid user nobody » du test de méthodes SSH de MyServices sont exclus.
    """
    rc, out = run(SSH_AUTH_CMD, timeout=15)
    out = (out or "").strip()
    if rc != 0 or out == "noaccess":
        return {"failed_24h": 0, "available": False, "reason": "journal non lisible (groupe adm requis)"}
    try:
        return {"failed_24h": int(out), "available": True}
    except ValueError:
        return {"failed_24h": 0, "available": False, "reason": "sortie inattendue"}



def collect_smart(run) -> dict:
    """Santé SMART des disques via `sudo -n /usr/sbin/smartctl -H` (règle NOPASSWD dédiée
    par host, cf /etc/sudoers.d/*-smart-health). Gracieux si absente (host non provisionné).

    Chemin absolu obligatoire : un SSH non-interactif n'a pas /usr/sbin dans le PATH, et la
    règle sudoers cible elle-même le chemin absolu. Device NVMe : la règle sudoers vise le
    contrôleur (/dev/nvme0), pas le namespace bloc listé par lsblk (nvme0n1) → on convertit.
    """
    rc, out = run(SMART_LIST_CMD, timeout=8)
    if rc != 0 or not out.strip():
        return {"accessible": False, "disks": []}
    disks = []
    for target in smart_targets(out):
        _, out2 = run(smart_cmd(target), timeout=10)
        low = out2.lower()
        # Deux formats selon le type de disque : ATA/NVMe ("overall-health ... PASSED/FAILED")
        # vs SCSI/virtio ("Health Status: OK/...") : ex. disque virtuel de VM.
        if "overall-health" not in low and "health status" not in low:
            # sudo -n refusé (pas de règle NOPASSWD sur ce host) ou device non supporté
            return {"accessible": False, "disks": []}
        healthy = "passed" in low or "health status: ok" in low
        failed = "failed" in low or ("health status" in low and "ok" not in low)
        disks.append({"device": target, "healthy": healthy, "failed": failed})
    return {"accessible": True, "disks": disks}


def smart_targets(out: str) -> list[str]:
    """Disks to ask SMART about, from SMART_LIST_CMD's output: an NVMe namespace (nvme0n1) is asked through its controller (nvme0)."""
    seen = []
    for dev in out.split():
        m = re.match(r"^(nvme\d+)n\d+$", dev)
        target = m.group(1) if m else dev
        if target not in seen and re.fullmatch(r"[A-Za-z0-9_-]{1,32}", target):
            seen.append(target)
    return seen

# ───────────── Services and storage (PM2, RAID, ZFS, network shares, clock, timers, automatic updates, Snap, sessions) ─────────────

# One read-only script, sections introduced by « @@name ». Nothing needs sudo, and nothing is started: PM2 is read from its processes
# and its files, never through the pm2 command (which starts its daemon when it is down). A network share is tested in the background with
# a short limit, so a share that hangs is reported without blocking the rest. Absent tools print nothing.
NET_FS = "nfs,nfs4,cifs,smb3,sshfs,fuse.sshfs"
# The two reads that need root, each through one exact sudo rule (no wildcard), read-only: needrestart in list mode (it never restarts
# anything), and the bans of every Fail2ban jail in one command. Without the rule: « NOSUDO », and the page gives the rule to add.
NEEDRESTART, NEEDRESTART_ARGS = "/usr/sbin/needrestart", "/usr/sbin/needrestart -b -r l"
FAIL2BAN, FAIL2BAN_ARGS = "/usr/bin/fail2ban-client", "/usr/bin/fail2ban-client banned"


def as_root(cmd: str) -> str:
    """cmd as is for root, else through sudo -n (fails at once without the rule, never asks a password)."""
    return f"if [ \"$(id -u)\" = 0 ]; then timeout 15 {cmd}; else timeout 15 sudo -n {cmd}; fi 2>/dev/null"


def root_or_why(cmd: str) -> str:
    """cmd as root (as_root); when it fails, why: NOANSWER when root or the sudo rule allows it (the tool itself did not answer), else NOSUDO.
    `sudo -n -l <cmd>` only checks the rule, it runs nothing."""
    return f"{as_root(cmd)} || {{ {{ [ \"$(id -u)\" = 0 ] || sudo -n -l {cmd} >/dev/null 2>&1; }} && echo NOANSWER || echo NOSUDO; }}"


def sudo_rule(user: str, cmd: str) -> str:
    """The sudoers line that lets `user` run `cmd` alone, without password."""
    return f"{user} ALL=(root) NOPASSWD: {cmd}"
SYSTEM_CMD = (
    "export PATH=\"$PATH:/usr/sbin:/sbin\"; echo \"@@now $(date +%s)\"; echo \"@@user $(id -un)\"; "
    "echo @@pm2; pgrep -af '^PM2 v[0-9.]+: God Daemon' 2>/dev/null | sed 's/^[0-9]* /D /'; "
    "systemctl list-unit-files --no-legend --plain 'pm2-*' 2>/dev/null | awk '{print \"E\",$1,$2}'; "
    "systemctl list-units --all --type=service --no-legend --plain 'pm2-*' 2>/dev/null | awk '{print \"U\",$1,$3}'; "
    "d=\"$HOME/.pm2\"; if [ -d \"$d\" ]; then echo \"H $d\"; for f in \"$d\"/pids/*.pid; do [ -f \"$f\" ] || continue; p=$(cat \"$f\" 2>/dev/null); "
    "if [ -n \"$p\" ] && [ -d \"/proc/$p\" ]; then echo \"P up $(basename \"$f\" .pid)\"; else echo \"P down $(basename \"$f\" .pid)\"; fi; done; "
    "[ -r \"$d/dump.pm2\" ] && python3 -c 'import json,sys;[print(\"S\",a.get(\"name\",\"\")) for a in json.load(open(sys.argv[1]))]' \"$d/dump.pm2\" 2>/dev/null; fi; "
    "echo @@md; grep -E '^md|blocks|recovery|resync|reshape' /proc/mdstat 2>/dev/null; "
    "echo @@zfs; command -v zpool >/dev/null 2>&1 && timeout 8 zpool list -H -o name,health 2>/dev/null; "
    f"echo @@mnt; ts=$(findmnt -rn -t {NET_FS} -o TARGET 2>/dev/null); if [ -n \"$ts\" ]; then m=$(mktemp); n=0; "
    "while read -r t; do n=$((n+1)); ( timeout -k 1 4 stat -t -- \"$(printf '%b' \"$t\")\" >/dev/null 2>&1; echo \"$? $t\" >>\"$m\" ) </dev/null >/dev/null 2>&1 & "
    "done <<< \"$ts\"; i=0; while [ $i -lt 12 ] && [ \"$(wc -l <\"$m\")\" -lt $n ]; do sleep 0.5; i=$((i+1)); done; "
    "echo \"$ts\" | sed 's/^/T /'; sed 's/^/R /' \"$m\"; rm -f \"$m\"; fi; "
    f"findmnt -rn -s -t {NET_FS} -o TARGET,OPTIONS 2>/dev/null | awk '$2 !~ /noauto|x-systemd.automount/ {{print \"F\",$1}}'; "
    "echo @@ntp; echo \"C $(systemd-detect-virt -c 2>/dev/null || true)\"; timedatectl show -p NTP -p NTPSynchronized 2>/dev/null; "
    "echo @@tim; u=$(systemctl list-timers --no-legend --plain 2>/dev/null | awk '{print $NF}' | sort -u | head -n 60); "
    "[ -n \"$u\" ] && systemctl show -p Id -p Result -p ActiveState $u 2>/dev/null; "
    "echo @@uu; dpkg-query -W -f='I ${Status}\\n' unattended-upgrades 2>/dev/null; "
    "apt-config dump 2>/dev/null | grep -E '^APT::Periodic::Unattended-Upgrade '; "
    "stat -c 'S %Y' /var/lib/apt/periodic/unattended-upgrades-stamp 2>/dev/null; "
    "grep -h ' ERROR ' /var/log/unattended-upgrades/unattended-upgrades.log 2>/dev/null | tail -n 5 | sed 's/^/X /'; "
    "echo @@snap; command -v snap >/dev/null 2>&1 && timeout 10 snap refresh --list 2>&1 | head -n 30; "
    "echo @@who; who 2>/dev/null | head -n 20; "
    f"echo @@nr; [ -x {NEEDRESTART} ] && {{ {as_root(NEEDRESTART_ARGS)} || echo NOSUDO; }}; "
    f"echo @@f2b; [ -x {FAIL2BAN} ] && {{ {root_or_why(FAIL2BAN_ARGS)}; }}; "
    "echo @@dkr; command -v docker >/dev/null 2>&1 && docker ps -q 2>/dev/null | head -n 200 "
    "| xargs -r docker inspect --format '{{.Name}}|{{.RestartCount}}|{{.State.StartedAt}}' 2>/dev/null; true"
)
UU_STALE_DAYS = 3          # automatic updates that have not run for this long
DOCKER_LOOP_N = 3          # restarts of a container that started again within the last hour: a loop


def _sections(out: str) -> dict[str, list[str]]:
    secs, cur = {}, None
    for ln in out.splitlines():
        if ln.startswith("@@"):
            name, _, rest = ln[2:].partition(" ")
            cur = secs.setdefault(name, [])
            if rest:
                cur.append(rest)
        elif cur is not None and ln.strip():
            cur.append(ln.rstrip())
    return secs


def _iso_epoch(s: str) -> int | None:
    try:
        return int(datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
    except ValueError:
        return None


def _pm2_read(lines: list[str]) -> tuple[list, dict, dict, dict, list, str | None]:
    """The tagged lines of the pm2 section: (daemons, units active state, units enabled state, apps alive, apps saved, home)."""
    daemons, units, enabled, apps, saved, home = [], {}, {}, {}, [], None
    for ln in lines:
        tag, _, rest = ln.partition(" ")
        if tag == "D":
            m = re.search(r"\((/[^)]+)\)", rest)
            daemons.append(m.group(1) if m else rest[:120])
        elif tag == "E":
            unit, _, state = rest.partition(" ")
            enabled[unit] = state
        elif tag == "U":
            unit, _, active = rest.partition(" ")
            units[unit] = active
        elif tag == "H":
            home = rest
        elif tag == "P":
            state, _, pid_file = rest.partition(" ")
            name = re.sub(r"-\d+$", "", pid_file)   # <name>-<pm_id>.pid
            apps[name] = apps.get(name, False) or state == "up"
        elif tag == "S" and rest:
            saved.append(rest[:80])
    return daemons, units, enabled, apps, saved, home


def parse_pm2(lines: list[str]) -> dict:
    """PM2 without the pm2 command: the daemons running (by their home), the pm2-<user> units, and for the account's own home the apps
    saved by « pm2 save » and those whose process is alive. Nothing of PM2 on the machine: available False."""
    daemons, units, enabled, apps, saved, home = _pm2_read(lines)
    us = [{"unit": u, "enabled": s == "enabled", "active": units.get(u, "inactive") == "active"} for u, s in sorted(enabled.items()) if u.endswith(".service")]
    if not (daemons or us or home):
        return {"available": False}
    running = home in daemons if home else None
    names = sorted(set(saved) | set(apps))
    return {"available": True, "daemons": daemons, "units": us, "home": home, "running": running,
            "apps": [{"name": n, "up": bool(running and apps.get(n)), "saved": n in saved} for n in names][:40]}


def parse_mdstat(lines: list[str]) -> dict:
    """Software RAID arrays of /proc/mdstat: state, members seen, and a rebuild in progress (its percentage)."""
    arrays = []
    for ln in lines:
        m = re.match(r"^(md\S+)\s*:\s*(\S+)\s*(\S*)", ln)
        if m:
            arrays.append({"name": m.group(1), "state": m.group(2), "level": m.group(3) if m.group(3).startswith("raid") else "", "degraded": m.group(2) != "active"})
            continue
        if not arrays:
            continue
        m = re.search(r"\[(\d+)/(\d+)\]\s*\[([U_]+)\]", ln)
        if m:
            arrays[-1]["members"] = f"{m.group(2)}/{m.group(1)}"
            arrays[-1]["degraded"] = arrays[-1]["degraded"] or "_" in m.group(3)
        m = re.search(r"(recovery|resync|reshape|check)\s*=\s*([\d.]+)%", ln)
        if m:
            arrays[-1]["rebuild"] = {"kind": m.group(1), "pct": float(m.group(2))}
    return {"available": bool(arrays), "arrays": arrays}


def parse_zfs(lines: list[str]) -> dict:
    pools = [{"name": c[0], "health": c[1]} for c in map(str.split, lines) if len(c) >= 2]
    return {"available": bool(pools), "pools": pools}


def _unescape(target: str) -> str:
    return re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), target)


def parse_mounts(lines: list[str]) -> dict:
    """Network shares: mounted ones that answer or not (a share whose test did not come back in time hangs), and those of /etc/fstab
    that are not mounted (noauto and automount left aside: not mounted is normal for them)."""
    mounted, results, fstab = [], {}, []
    for ln in lines:
        tag, _, rest = ln.partition(" ")
        if tag == "T":
            mounted.append(rest)
        elif tag == "R":
            rc, _, t = rest.partition(" ")
            results[t] = rc
        elif tag == "F":
            fstab.append(rest)
    shares = [{"path": _unescape(t), "ok": results.get(t) == "0", "state": "ok" if results.get(t) == "0" else ("hang" if t not in results else "error")} for t in mounted]
    shares += [{"path": _unescape(t), "ok": False, "state": "missing"} for t in dict.fromkeys(fstab) if t not in mounted]
    return {"available": bool(shares), "shares": shares}


def parse_ntp(lines: list[str]) -> dict:
    """Clock synchronisation (timedatectl); a container takes its clock from its host: not read there."""
    kv = {k: v for k, _, v in (ln.partition("=") for ln in lines if "=" in ln)}
    container = next((ln[2:].strip() for ln in lines if ln.startswith("C ")), "")
    if "NTPSynchronized" not in kv or (container and container != "none"):
        return {"available": False}
    return {"available": True, "synced": kv["NTPSynchronized"] == "yes", "service": kv.get("NTP") == "yes"}


def parse_timers(lines: list[str]) -> dict:
    """Active timers and, for each, whether the last run of the service it starts went well (Result of systemctl show)."""
    blocks, cur = [], {}
    for ln in lines + ["Id="]:
        k, _, v = ln.partition("=")
        if k in cur:
            blocks.append(cur)
            cur = {}
        cur[k] = v
    units = [b for b in blocks if b.get("Id")]
    failed = [b["Id"] for b in units if b.get("Result") not in ("success", "", None)]
    return {"available": bool(units), "total": len(units), "failed": failed[:20]}


def parse_unattended(lines: list[str], now: int | None) -> dict:
    """Automatic updates (unattended-upgrades): installed, enabled, days since the last run, the errors of its log in the last 48 hours."""
    inst = any(ln.startswith("I ") and ln.endswith("install ok installed") for ln in lines)
    if not inst:
        return {"available": False}
    m = re.search(r'Unattended-Upgrade "(\d+)"', "\n".join(lines))
    stamp = next((int(ln[2:]) for ln in lines if ln.startswith("S ") and ln[2:].isdigit()), None)
    days = round((now - stamp) / 86400, 1) if now and stamp else None
    return {"available": True, "enabled": bool(m and m.group(1) != "0"), "days": days, "errors": _uu_errors(lines, now)}


def _uu_errors(lines: list[str], now: int | None) -> list[str]:
    """The errors of the unattended-upgrades log (« X <date> <text> » lines) in the last 48 hours."""
    errors = []
    for ln in lines:
        if ln.startswith("X "):
            when = ln[2:21]
            try:
                t = int(datetime.strptime(when, "%Y-%m-%d %H:%M:%S").timestamp())
            except ValueError:
                continue
            if now and now - t <= 48 * 3600:
                errors.append(ln[2:][:200])
    return errors


def parse_snap(lines: list[str]) -> dict:
    """Snaps with an update waiting (snap refresh --list: a table, or « All snaps up to date. »); snapd absent or silent: not read."""
    if lines and lines[0].startswith("Name"):
        rows = [ln.split()[0] for ln in lines[1:] if ln.split()]
        return {"available": True, "pending": len(rows), "names": rows[:10]}
    if any("up to date" in ln for ln in lines):
        return {"available": True, "pending": 0, "names": []}
    return {"available": False}


def parse_sessions(lines: list[str]) -> dict:
    sessions = []
    for ln in lines:
        c = ln.split()
        if len(c) >= 2:
            m = re.search(r"\(([^)]*)\)\s*$", ln)
            sessions.append({"user": c[0][:40], "tty": c[1][:20], "from": m.group(1)[:80] if m else ""})
    return {"available": True, "sessions": sessions}


def parse_docker_loops(lines: list[str], now: int | None) -> list[dict]:
    """Containers that restart in a loop: restarted DOCKER_LOOP_N times or more, and started again within the last hour."""
    out = []
    for ln in lines:
        c = ln.split("|")
        if len(c) == 3 and c[1].isdigit():
            started = _iso_epoch(c[2])
            if int(c[1]) >= DOCKER_LOOP_N and now and started and now - started <= 3600:
                out.append({"name": c[0].lstrip("/"), "restarts": int(c[1])})
    return out


def parse_needrestart(lines: list[str], user: str) -> dict:
    """Services still running old libraries after an update (needrestart -b): their names, and whether the running kernel is the newest."""
    if not lines:
        return {"available": False}
    if "NOSUDO" in lines or not any(ln.startswith("NEEDRESTART-") for ln in lines):
        return {"available": True, "access": False, "rule": sudo_rule(user or "<compte>", NEEDRESTART_ARGS)}
    kv = [ln.partition(":")[::2] for ln in lines]
    services = [v.strip() for k, v in kv if k == "NEEDRESTART-SVC"]
    ksta = next((v.strip() for k, v in kv if k == "NEEDRESTART-KSTA"), "")
    return {"available": True, "access": True, "services": services[:40], "kernel_pending": ksta in ("2", "3")}


def parse_fail2ban(lines: list[str], user: str) -> dict:
    """Bans of every jail (fail2ban-client banned: a list of {jail: [IP…]}); read as a literal, never evaluated."""
    if not lines:
        return {"available": False}
    if "NOSUDO" in lines:
        return {"available": True, "access": False, "rule": sudo_rule(user or "<compte>", FAIL2BAN_ARGS)}
    if "NOANSWER" in lines:   # allowed, but fail2ban-client got no answer: the service is stopped or its socket gone
        return {"available": True, "access": True, "down": True, "jails": [], "total": 0}
    try:
        data = ast.literal_eval(" ".join(lines)[:200000])
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        return {"available": False}
    jails = [{"name": str(name)[:60], "banned": len(ips) if isinstance(ips, list) else 0}
             for item in (data if isinstance(data, list) else []) if isinstance(item, dict) for name, ips in item.items()]
    return {"available": True, "access": True, "jails": sorted(jails, key=lambda j: j["name"])[:40], "total": sum(j["banned"] for j in jails)}


def collect_system(run) -> dict:
    """The services and storage checks, in one command. A machine where it cannot run (old shell, agent of an older version): {}."""
    rc, out = run(SYSTEM_CMD, timeout=20)
    if rc != 0 or "@@now" not in out:
        return {}
    s = _sections(out)
    now = int(s["now"][0]) if s.get("now") and s["now"][0].isdigit() else None
    user = (s.get("user") or [""])[0][:40]
    return {"pm2": parse_pm2(s.get("pm2", [])), "raid": parse_mdstat(s.get("md", [])), "zfs": parse_zfs(s.get("zfs", [])),
            "mounts": parse_mounts(s.get("mnt", [])), "ntp": parse_ntp(s.get("ntp", [])), "timers": parse_timers(s.get("tim", [])),
            "auto_upd": parse_unattended(s.get("uu", []), now), "snap": parse_snap(s.get("snap", [])),
            "sessions": parse_sessions(s.get("who", [])), "docker_loops": parse_docker_loops(s.get("dkr", []), now),
            "needrestart": parse_needrestart(s.get("nr", []), user), "fail2ban": parse_fail2ban(s.get("f2b", []), user)}


def _pm2_level(p: dict) -> str:
    down_unit = any(u["enabled"] and not u["active"] for u in p["units"])
    stopped = p["running"] is False and any(a["saved"] for a in p["apps"])
    app_down = p["running"] and any(not a["up"] for a in p["apps"])
    return "warn" if down_unit or stopped or app_down else "ok"


def _raid_level(r: dict) -> str:
    """A degraded array not being rebuilt is critical; degraded and rebuilding, or a resync / reshape (not a check), is a warning."""
    if any(a["degraded"] and not a.get("rebuild") for a in r["arrays"]):
        return "crit"
    if any(a["degraded"] or (a.get("rebuild") and a["rebuild"]["kind"] != "check") for a in r["arrays"]):
        return "warn"
    return "ok"


def _zfs_level(z: dict) -> str:
    hs = {p_["health"] for p_ in z["pools"]}
    if hs & {"FAULTED", "UNAVAIL", "SUSPENDED"}:
        return "crit"
    return "warn" if hs - {"ONLINE"} else "ok"


def _mounts_level(mo: dict) -> str:
    if any(x["state"] == "hang" for x in mo["shares"]):
        return "crit"
    return "warn" if any(not x["ok"] for x in mo["shares"]) else "ok"


def _auto_upd_level(u: dict) -> str | None:
    """None when automatic updates are installed but turned off: no level for them."""
    if not u["enabled"]:
        return None
    return "warn" if u["errors"] or (u["days"] is not None and u["days"] > UU_STALE_DAYS) else "ok"


# Each check with the level of what was read on the machine, in the order of the page
_SYSTEM_LEVELS = (("pm2", _pm2_level), ("raid", _raid_level), ("zfs", _zfs_level), ("mounts", _mounts_level),
                  ("ntp", lambda n: "ok" if n["synced"] else "warn"), ("timers", lambda t: "warn" if t["failed"] else "ok"),
                  ("auto_upd", _auto_upd_level))


def system_levels(sys_: dict) -> dict[str, str]:
    """Level of each services and storage check (na: nothing of it on the machine)."""
    sys_ = sys_ or {}
    lv = {}
    for key, level_of in _SYSTEM_LEVELS:
        d = sys_.get(key) or {}
        if d.get("available") and (level := level_of(d)):
            lv[key] = level
    return lv

# ───────────── Windows (OpenSSH Server + PowerShell) ─────────────

# Un seul script, en lecture. Erreurs ignorées une à une : un contrôle refusé ne masque pas les autres.
# 4625 (échecs de connexion) : journal Sécurité, administrateurs seulement ; -1 = non lisible.
# MSV_UPD (agent, et SSH par le cache du serveur) : titres de la dernière recherche Windows Update, réutilisés pour ne la refaire qu'une fois par heure.
# MSV_SKIP (agent) : le matériel, les disques physiques et les services en marche changent peu ; l'agent ne les relit que toutes les 6 h et le
# serveur garde ceux du relevé précédent (agents.SLOW_KEYS). Une seule requête Win32_Service pour les services arrêtés et en marche.
# Matériel (lecture seule, sans droits particuliers) : m=fabricant, mo=modèle, bios, cpu, cc/cl=cœurs physiques/logiques, ram=Go,
# gpu=[{n=nom, r=résolution}], net=[{n=carte, ip=IPv4}] (jamais d'adresse MAC), dom=domaine ou groupe de travail, wu=dernière mise à jour installée.
WIN_PS = r"""
$ErrorActionPreference='SilentlyContinue';$ProgressPreference='SilentlyContinue';$o=@{};$t=(Get-Date).AddHours(-24)
$o.disks=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3'|%{@{m=$_.DeviceID;s=[double]$_.Size;f=[double]$_.FreeSpace}})
$sa=@(Get-CimInstance Win32_Service);$o.svc=@($sa|?{$_.StartMode -eq 'Auto' -and $_.State -ne 'Running' -and $_.ExitCode -ne 0}|%{@{n=$_.Name;d=$_.DisplayName;e=$_.ExitCode}})
$p=@(Get-CimInstance Win32_Processor);$o.cpu=($p|Measure-Object LoadPercentage -Average).Average;$o.ncpu=($p|Measure-Object NumberOfLogicalProcessors -Sum).Sum
$w=Get-CimInstance Win32_OperatingSystem;$o.boot=$w.LastBootUpTime.ToUniversalTime().ToString('o');if($w.TotalVisibleMemorySize){$o.mem=[math]::Round(100*($w.TotalVisibleMemorySize-$w.FreePhysicalMemory)/$w.TotalVisibleMemorySize,1)}
$o.os=@{n=$w.Caption;v=$w.Version;b=$w.BuildNumber;h=$env:COMPUTERNAME}
$pm=@{};Get-Process|%{$pm[[int]$_.Id]=$_.ProcessName};$o.ports=@(Get-NetTCPConnection -State Listen|Select-Object -First 400|%{@{p=[int]$_.LocalPort;a=[string]$_.LocalAddress;n=$pm[[int]$_.OwningProcess]}})
$k='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion';$o.reboot=(Test-Path "$k\WindowsUpdate\Auto Update\RebootRequired") -or (Test-Path "$k\Component Based Servicing\RebootPending")
$slow=-not $env:MSV_SKIP
if($slow){$o.pd=@(Get-PhysicalDisk|%{@{n=$_.FriendlyName;h=[string]$_.HealthStatus}})}
$o.ev=@(Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=$t} -MaxEvents 300|?{$_.Level -eq 1 -or $_.ProviderName -match 'disk|Ntfs|volmgr|stor|WHEA'}|Select-Object -First 8|%{'{0} {1} {2}' -f $_.TimeCreated.ToString('dd/MM HH:mm'),$_.ProviderName,(($_.Message -split "`n")[0]).Trim()})
try{$o.fail=@(Get-WinEvent -FilterHashtable @{LogName='Security';Id=4625;StartTime=$t} -MaxEvents 1000 -ErrorAction Stop).Count}catch{$o.fail=$(if($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*'){0}else{-1})}
if($env:MSV_UPD){$o.upd=@($env:MSV_UPD|ConvertFrom-Json)}else{try{$r=(New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0 and Type='Software'");$o.upd=@($r.Updates|%{$_.Title})}catch{$o.upd=$null}}
$h=@{};if($slow){try{$cs=Get-CimInstance Win32_ComputerSystem;$h.m=[string]$cs.Manufacturer;$h.mo=[string]$cs.Model;$h.ram=[math]::Round($cs.TotalPhysicalMemory/1GB,1);$h.dom=$(if($cs.PartOfDomain){[string]$cs.Domain}else{'WORKGROUP: '+$cs.Workgroup})}catch{}
try{$h.bios=[string](Get-CimInstance Win32_BIOS|Select-Object -First 1).SMBIOSBIOSVersion}catch{}
try{$h.cpu=[string]($p|Select-Object -First 1).Name;$h.cc=($p|Measure-Object NumberOfCores -Sum).Sum;$h.cl=$o.ncpu}catch{}
try{$h.gpu=@(Get-CimInstance Win32_VideoController|?{$_.Name}|Select-Object -First 4|%{@{n=[string]$_.Name;r=$(if($_.CurrentHorizontalResolution){'{0}x{1}' -f $_.CurrentHorizontalResolution,$_.CurrentVerticalResolution}else{''})}})}catch{}
try{$h.net=@(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True'|?{$_.IPAddress}|Select-Object -First 8|%{$d=$_.Description;@($_.IPAddress|?{$_ -match '^\d+\.\d+\.\d+\.\d+$'}|%{@{n=[string]$d;ip=[string]$_}})})}catch{}
try{$h.nic=@(Get-NetAdapter -Physical -ErrorAction Stop|?{$_.Status -eq 'Up'}|Select-Object -First 6|%{$a=$_;$sd=$null;try{$sd=(Get-NetAdapterAdvancedProperty -Name $a.Name -RegistryKeyword '*SpeedDuplex' -ErrorAction Stop).DisplayValue}catch{};@{n=[string]$a.Name;mac=[string]$a.MacAddress;sp=[int64]$a.Speed;fd=[bool]$a.FullDuplex;sd=[string]$sd}})}catch{}
try{$q=Get-HotFix|Where-Object{$_.InstalledOn}|Sort-Object InstalledOn -Descending|Select-Object -First 1;if($q){$h.wu=$q.InstalledOn.ToString('yyyy-MM-dd')}}catch{}
$o.sv=@($sa|?{$_.State -eq 'Running'}|Select-Object -First 300|%{@{n=[string]$_.Name;d=[string]$_.DisplayName}})}
try{if(Get-Command docker.exe -ErrorAction Stop){$l=@(& docker.exe ps -a --format '{{.Names}}|{{.Image}}|{{.Ports}}|{{.Status}}|{{.Networks}}' 2>$null);if($LASTEXITCODE -eq 0){$o.dk=@($l|Select-Object -First 200|%{[string]$_})}}}catch{}
try{if(Get-Command Get-VM -ErrorAction Stop){$o.hv=@(Get-VM|Select-Object -First 200|%{@{n=[string]$_.Name;s=[string]$_.State;c=[int]$_.ProcessorCount;m=[double]$_.MemoryAssigned;x=[double]$_.MemoryStartup;u=[int]$_.Uptime.TotalSeconds}})}}catch{}
$ev={param($l,$f)try{Get-WinEvent -FilterHashtable @{LogName=$l} -MaxEvents 50 -ErrorAction Stop|?{& $f $_}|Select-Object -First 1|%{@{t=$_.TimeCreated.ToUniversalTime().ToString('o');i=$_.Id;l=$_.Level;m=(($_.Message -split "`n")[0]).Trim()}}}catch{}}
$o.va=& $ev 'Veeam Agent' {param($e)$e.Id -eq 190}
$o.wb=& $ev 'Microsoft-Windows-Backup' {param($e)$e.Id -eq 4 -or $e.Level -le 2}
if($slow){$o.hw=$h}
ConvertTo-Json -InputObject $o -Depth 5 -Compress
"""


def ps_command(script: str) -> str:
    """powershell -EncodedCommand : aucun guillemet à protéger, que le shell OpenSSH soit cmd ou PowerShell. Pour un script court seulement :
    l'encodage triple la taille, et cmd.exe (shell OpenSSH par défaut de Windows) refuse une ligne de plus de 8191 caractères."""
    return "powershell -NoProfile -NonInteractive -EncodedCommand " + base64.b64encode(script.encode("utf-16-le")).decode()


# A long script goes through stdin, in base64 (ASCII: no console code page can spoil it); this short loader reads and runs it
PS_STDIN = ps_command("$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()));& ([scriptblock]::Create($s))")


def ps_stdin(script: str) -> str:
    """Ce que PS_STDIN attend sur son entrée : le script en UTF-8, encodé en base64."""
    return base64.b64encode(script.encode("utf-8")).decode()


def _txt(d: dict, k: str, n: int = 120):
    """Texte court d'un champ (texte ou nombre), None s'il est absent, vide ou d'un autre type."""
    v = d.get(k)
    return str(v).strip()[:n] if isinstance(v, (str, int, float)) and not isinstance(v, bool) and str(v).strip() else None


def _pos(d: dict, k: str):
    """Nombre strictement positif d'un champ, None sinon."""
    v = d.get(k)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def hardware_of_raw(hw) -> dict | None:
    """Matériel du relevé PowerShell (clé « hw ») -> dict propre, champs absents tolérés ; None si rien de lisible."""
    if not isinstance(hw, dict):
        return None
    def items(k, limit):  # PowerShell range parfois un seul élément en objet plutôt qu'en liste
        v = hw.get(k)
        return [x for x in (v if isinstance(v, list) else [v]) if isinstance(x, dict)][:limit]
    out = {"maker": _txt(hw, "m"), "model": _txt(hw, "mo"), "bios": _txt(hw, "bios"), "cpu": _txt(hw, "cpu"),
           "cores": int(_pos(hw, "cc") or 0) or None, "threads": int(_pos(hw, "cl") or 0) or None,
           "ram_gb": round(_pos(hw, "ram"), 1) if _pos(hw, "ram") else None, "domain": _txt(hw, "dom"), "last_update": _txt(hw, "wu", 20),
           "gpu": [{"name": _txt(g, "n"), "res": _txt(g, "r", 20)} for g in items("gpu", 4) if _txt(g, "n")],
           "net": [{"name": _txt(n, "n"), "ip": _txt(n, "ip", 15)} for n in items("net", 8)
                   if _txt(n, "n") and re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", _txt(n, "ip") or "")],
           # wired cards that are up: negotiated speed (Mb/s), duplex, and the « Speed & Duplex » setting ("Auto Negotiation" or a forced value)
           "nics": [{"name": _txt(n, "n"), "mac": (_txt(n, "mac", 17) or "").lower().replace("-", ":") or None, "speed": round(_pos(n, "sp") / 1_000_000) if _pos(n, "sp") else None,
                     "full_duplex": bool(n.get("fd")), "setting": _txt(n, "sd", 60)} for n in items("nic", 6) if _txt(n, "n")]}
    return out if any(out.values()) else None


def _titles(upd) -> list[str] | None:
    """Titres des mises à jour d'un relevé Windows : une liste de textes, ou None si la recherche n'a rien donné. PowerShell 5.1 peut
    envoyer {"value": [...], "Count": n} au lieu du tableau, ou des éléments qui ne sont pas des textes : on déballe et on convertit."""
    if isinstance(upd, dict):
        upd = upd.get("value")
    if upd is None or isinstance(upd, bool):
        return None
    if isinstance(upd, str):
        upd = [upd]
    if not isinstance(upd, list):
        return None
    out = []
    for u in upd:
        if isinstance(u, dict):
            u = u.get("value") if "value" in u else u.get("Title") or u.get("title")
        out += [str(x) for x in (u if isinstance(u, list) else [u]) if x is not None and str(x).strip()]
    return out


def parse_windows(raw: dict) -> dict:
    """Relevé PowerShell -> mêmes champs que la collecte Linux (rendu, niveaux et alertes communs)."""
    gb = 1024 ** 3
    disks = []
    for d in raw.get("disks") or []:
        size, free = d.get("s") or 0, d.get("f") or 0
        if not size:
            continue
        pct = round((size - free) * 100 / size)
        disks.append({"device": d["m"], "mount": d["m"], "size_gb": round(size / gb, 1),
                      "used_gb": round((size - free) / gb, 1), "avail_gb": round(free / gb, 1),
                      "used_pct": pct, "inode_pct": 0,
                      "critical": pct >= DISK_CRIT_PCT, "warning": pct >= DISK_WARN_PCT})
    disks.sort(key=lambda d: d["used_pct"], reverse=True)
    upd = _titles(raw.get("upd"))
    fail = raw.get("fail")
    pd = raw.get("pd") or []
    return {
        "disks": disks,
        "systemd": {"failed": [{"unit": s.get("n", "?"), "active": "arrêté", "sub": f"code {s.get('e')}",
                                "desc": s.get("d", "")} for s in raw.get("svc") or []]},
        "docker": {"accessible": False, "reason": "windows"},
        "apt": {"upgradable": len(upd), "sample": upd[:8], "available": True} if isinstance(upd, list)
               else {"upgradable": 0, "sample": [], "available": False},
        "kernel": {"has_errors": bool(raw.get("ev")), "samples": [str(e)[:200] for e in raw.get("ev") or []]},
        "reboot_required": bool(raw.get("reboot")),
        "load": {"load_1": 0.0, "ncpu": raw.get("ncpu") or 1, "available": raw.get("cpu") is not None,
                 "cpu_pct": raw.get("cpu"), "boot": raw.get("boot")},
        "ssh_auth": {"failed_24h": fail, "available": True} if isinstance(fail, int) and fail >= 0
                    else {"failed_24h": 0, "available": False, "reason": "journal Sécurité réservé aux administrateurs"},
        "smart": {"accessible": bool(pd), "disks": [{"device": d.get("n", "?"), "healthy": d.get("h") == "Healthy",
                                                     "failed": d.get("h") not in ("Healthy", "", None)} for d in pd]},
        "system": {"os": (raw.get("os") or {}).get("n"), "version": (raw.get("os") or {}).get("v"), "build": (raw.get("os") or {}).get("b"),
                   "boot": raw.get("boot")} if isinstance(raw.get("os"), dict) else None,
        "hardware": hardware_of_raw(raw.get("hw")),
        "res": ({"available": True, "cpu_pct": round(raw["cpu"], 1), "mem_pct": round(raw["mem"], 1)}
                if isinstance(raw.get("cpu"), (int, float)) and isinstance(raw.get("mem"), (int, float)) else {"available": False}),
    }


WIN_UPD_CACHE = os.path.join(CFG["cache_dir"], "windows-updates.json")
WIN_UPD_EVERY = 3600   # s: the Windows Update search can take a minute, its titles are reused for an hour (as the agent does)


def _win_upd_cached(key: str) -> list | None:
    """Titres Windows Update de la dernière lecture SSH de cette machine s'ils ont moins d'une heure ; None sinon (nouvelle recherche)."""
    try:
        got = json.load(open(WIN_UPD_CACHE, encoding="utf-8")).get(key) or {}
    except (OSError, ValueError, AttributeError):
        return None
    return got.get("upd") if isinstance(got.get("upd"), list) and time.time() - float(got.get("at") or 0) < WIN_UPD_EVERY else None


def _win_upd_store(key: str, titles: list) -> None:
    try:
        cache = json.load(open(WIN_UPD_CACHE, encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    cache = cache if isinstance(cache, dict) else {}
    cache[key] = {"at": time.time(), "upd": [str(t)[:300] for t in titles][:100]}
    try:
        os.makedirs(os.path.dirname(WIN_UPD_CACHE), exist_ok=True)
        tmp = f"{WIN_UPD_CACHE}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, WIN_UPD_CACHE)
    except OSError:
        pass   # no cache: the search simply runs again next time


def win_script(upd: list | None) -> str:
    """WIN_PS, précédé des titres Windows Update encore frais (MSV_UPD) : la recherche lente n'est alors pas refaite."""
    if upd is None:
        return WIN_PS
    return "$env:MSV_UPD='" + json.dumps(upd, ensure_ascii=False).replace("'", "''") + "'\n" + WIN_PS


def collect_windows(host: dict) -> dict:
    run = make_runner(host)
    key = str(host.get("target") or host["id"])
    upd = _win_upd_cached(key)
    rc, out = run(PS_STDIN, timeout=180, data=ps_stdin(win_script(upd)))  # la recherche Windows Update peut prendre une minute
    base = {"id": host["id"], "name": host["name"], "os": "windows"}
    try:
        raw = json.loads(out.strip().lstrip("\ufeff")) if rc == 0 else None
    except ValueError:
        raw = None
    if isinstance(raw, dict) and upd is None and isinstance(raw.get("upd"), list):
        _win_upd_store(key, raw["upd"])
    if not isinstance(raw, dict):
        return {**base, "reachable": False, "disks": [], "systemd": {"failed": []},
                "docker": {"accessible": False, "reason": "windows"}, "level": "down", **_EMPTY_HOST_EXTRAS,
                "error": (out or "")[-200:]}
    h = {**base, "reachable": True, **parse_windows(raw)}
    h["level"] = host_level(h)
    return h

# ───────────── Agent MyServices (relevé envoyé par la machine) ─────────────

def agent_reports() -> dict:
    """{IP: {"report", "seen", "fresh"}} des agents actifs ; vide si la base n'existe pas (version sans Docker)."""
    try:
        from agents import Agents
        from auth import db_path
        return Agents(db_path(CFG)).fresh_reports()
    except Exception as e:  # base absente ou illisible : la santé continue sans agents
        print(f"⚠ agents : {e}", file=sys.stderr)
        return {}


def host_from_agent(hc: dict, a: dict) -> dict:
    """Machine d'après le dernier relevé de son agent (mêmes champs qu'une lecture SSH). Relevé périmé ou jamais
    reçu : injoignable, comme une machine SSH qui ne répond pas."""
    data = (a["report"] or {}).get("data")
    linux = isinstance(data, dict) and data.get("kind") == "linux"   # Linux agent: recorded command outputs; otherwise the PowerShell report
    base = {"id": hc["id"], "name": hc["name"], "os": "linux" if linux else "windows"}
    if not a["fresh"] or not isinstance(data, dict):
        return {**base, "reachable": False, "disks": [], "systemd": {"failed": []},
                "docker": {"accessible": False, "reason": "agent"}, "level": "down", **_EMPTY_HOST_EXTRAS,
                "error": "agent : aucun relevé récent"}
    if linux:
        h = {**collect_linux(hc, replay_runner(data.get("cmds"))), **base, "source": "agent", "agent_seen": a["seen"]}
        h["level"] = host_level(h)
        return h
    h = {**base, "reachable": True, **parse_windows(data), "source": "agent", "agent_seen": a["seen"]}
    h["docker"] = {"accessible": False, "reason": "agent"}
    h["level"] = host_level(h)
    return h


def agent_figures(hc: dict, a: dict | None, ts: str) -> bool:
    """A machine read over SSH first keeps its SSH health, but its agent's fresh report still gives a point to its 24 h curves (metrics.py);
    True when one was stored."""
    data = ((a or {}).get("report") or {}).get("data")
    if not (a and a.get("fresh") and isinstance(data, dict)):
        return False
    try:
        import metrics
        from auth import db_path
        h = {"name": hc["name"], "reachable": True, "read_at": ts, **parse_agent_data(hc, data)}
        return metrics.store(db_path(CFG), metrics.points({"hosts": [h]})) > 0
    except Exception as e:  # base unavailable: only the curves miss a point
        print(f"⚠ courbes : {e}", file=sys.stderr)
        return False


def parse_agent_data(hc: dict, data: dict) -> dict:
    """Champs de santé lus dans le relevé d'un agent, Linux (sorties rejouées) ou Windows (PowerShell)."""
    if data.get("kind") == "linux":
        return collect_linux(hc, replay_runner(data.get("cmds")))
    return parse_windows(data)


# ───────────── Fusion des sources (SSH, agent, Beszel) ─────────────

SOURCES = ("ssh", "agent", "beszel", "ha")   # ha : l'API d'un connecteur (Home Assistant : capteurs de la machine hôte)


def agent_fresh(agent: dict | None) -> bool:
    """The machine's agent sent a recent report (health.agent_reports): its health can be read from it, without SSH."""
    return bool(agent and agent.get("fresh") and isinstance((agent.get("report") or {}).get("data"), dict))


def source_order(hc: dict, agent: dict | None = None) -> list[str]:
    """Priorité de lecture de la santé d'une machine : « health_sources » de services-meta, puis l'ordre par défaut pour
    les sources non citées. Par défaut SSH, agent, Beszel ; agent d'abord quand il a un relevé frais (il relit la machine chaque minute,
    sans clé SSH : le SSH n'est plus ouvert que s'il se tait) et toujours pour Windows (c'est son accès recommandé)."""
    first_agent = hc.get("os") == "windows" or agent_fresh(agent)
    default = ["agent", "ssh", "beszel", "ha"] if first_agent else ["ssh", "agent", "beszel", "ha"]
    wanted = [x for x in hc.get("sources") or [] if x in SOURCES]
    return list(dict.fromkeys(wanted + default))


def host_from_beszel(hc: dict, b: dict) -> dict:
    h = {"id": hc["id"], "name": hc["name"], "os": hc["os"], "reachable": b.get("status") == "up", **parse_beszel(b)}
    h["level"] = host_level(h) if h["reachable"] else "down"
    return h


def complement(h: dict, parts: dict[str, dict]) -> None:
    """Ce que la source retenue n'a pas pu lire (SMART, mémoire / processeur, température) est pris dans les autres
    sources qui répondent, dans l'ordre de priorité. h est modifié ; h["sources"] dit qui a servi."""
    used = [h["source"]]
    for name, part in parts.items():
        gave = False
        if not h["smart"]["accessible"] and not h["smart"].get("vm") and part.get("smart", {}).get("accessible"):
            h["smart"], gave = {**part["smart"], "source": name}, True
        if not h.get("res", {}).get("available") and part.get("res", {}).get("available"):
            h["res"], gave = part["res"], True
        if not h.get("temp", {}).get("available") and part.get("temp", {}).get("available"):
            h["temp"], gave = part["temp"], True
        elif h.get("temp", {}).get("available") and not h["temp"].get("sensors") and part.get("temp", {}).get("sensors"):
            h["temp"], gave = {**h["temp"], "sensors": part["temp"]["sensors"]}, True   # every sensor, the reading keeps its own value
        if gave:
            used.append(name)
    h["sources"] = used
    h["level"] = host_level(h)


def ping(ip: str) -> bool:
    try:
        return subprocess.run(["ping", "-c1", "-W1", ip], capture_output=True, timeout=5).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def asleep_entry(hc: dict, agent: dict | None) -> dict:
    """Fiche d'un poste « souvent éteint » sans relevé frais : nom, IP, dernier relevé de son agent (epoch, None si jamais) et
    réponse au ping (allumé mais agent muet, ou vraiment éteint)."""
    return {"id": hc["id"], "name": hc["name"], "ip": hc["ip"], "os": hc["os"], "last_seen": (agent or {}).get("seen"), "ping": ping(hc["ip"])}


def read_host(hc: dict, agent: dict | None, beszel: dict | None, ssh=None, api: dict | None = None) -> dict | None:
    """Santé d'une machine d'après ses sources, dans l'ordre de priorité : la première qui répond fait foi, les suivantes
    ne complètent que ce qu'elle n'a pas pu lire. Aucune ne répond : la première muette (« injoignable »), sauf pour un
    poste « souvent éteint » (rien, pas d'alerte). None : machine sans aucune source (ni SSH, ni agent, ni Beszel)."""
    ssh = ssh or collect_host
    readers = {"ssh": lambda: ssh(hc) if hc["target"] else None,
               "agent": lambda: host_from_agent(hc, agent) if agent else None,
               "beszel": lambda: host_from_beszel(hc, beszel) if beszel else None,
               "ha": lambda: host_from_api(hc, api) if api else None}
    silent, primary = None, None
    for name in source_order(hc, agent):
        h = readers[name]()
        if h is None:
            continue
        h["source"] = name
        if h["reachable"]:
            primary = h
            break
        silent = silent or h
    if primary is None:
        return None if hc.get("off") else silent
    # parties lisibles à peu de frais (relevé d'agent frais, Beszel qui répond), sans relancer de lecture SSH
    cheap = {}
    for name in source_order(hc, agent):
        if name == primary["source"]:
            continue
        if name == "agent" and agent_fresh(agent):
            cheap[name] = parse_agent_data(hc, agent["report"]["data"])
        elif name == "beszel" and beszel and beszel.get("status") == "up":
            cheap[name] = parse_beszel(beszel)
        elif name == "ha" and api:
            cheap[name] = parse_beszel(api)
    complement(primary, cheap)
    return primary


# ───────────── Beszel (connecteur) ─────────────

def parse_beszel(sys_: dict) -> dict:
    """Système Beszel -> mêmes champs que la collecte SSH. Ce que Beszel ne donne pas (docker, journal
    noyau, échecs de connexion, titres des mises à jour) reste « non lisible »."""
    disks = [{"device": d["mount"], "mount": d["mount"], "size_gb": d["size_gb"], "used_gb": d["used_gb"],
              "avail_gb": round(d["size_gb"] - d["used_gb"], 1), "used_pct": d["used_pct"], "inode_pct": 0,
              "critical": d["used_pct"] >= DISK_CRIT_PCT, "warning": d["used_pct"] >= DISK_WARN_PCT}
             for d in sys_.get("disks") or []]
    disks.sort(key=lambda d: d["used_pct"], reverse=True)
    la, ncpu = sys_.get("load") or [], sys_.get("cores") or 1
    if la and any(la):
        load = {"load_1": float(la[0]), "ncpu": ncpu, "available": True}
    else:  # agent Windows : pas de load average, % CPU
        load = {"load_1": 0.0, "ncpu": ncpu, "available": sys_.get("cpu") is not None,
                "cpu_pct": round(sys_["cpu"]) if sys_.get("cpu") is not None else None, "boot": None}
    upd = sys_.get("updates")
    return {
        "disks": disks,
        "systemd": {"failed": [{"unit": n, "active": "failed", "sub": "", "desc": ""} for n in sys_.get("failed_services") or []]},
        "docker": docker_from_beszel(sys_.get("containers")),
        "apt": {"upgradable": upd or 0, "sample": [], "available": upd is not None,
                "security": sys_.get("updates_security")},
        "kernel": {"has_errors": False, "samples": [], "available": False},
        "reboot_required": False,
        "load": load,
        "ssh_auth": {"failed_24h": 0, "available": False, "reason": "non relevé par Beszel"},
        "smart": smart_from_beszel(sys_),
        "temp": ({"available": True, "celsius": round(sys_["temp"], 1), "source": "Beszel", "sensors": (sys_.get("sensors") or [])[:12]}
                 if isinstance(sys_.get("temp"), (int, float)) else {"available": False}),
        "res": ({"available": True, "cpu_pct": round(sys_["cpu"], 1), "mem_pct": round(sys_["mem_pct"], 1)}
                if isinstance(sys_.get("cpu"), (int, float)) and isinstance(sys_.get("mem_pct"), (int, float)) else {"available": False}),
        "source": "beszel",
    }


def docker_from_beszel(containers) -> dict:
    """Running containers seen by the Beszel agent -> the Docker part of the SSH reading (it lists no stopped container)."""
    if not containers:
        return {"accessible": False, "reason": "beszel"}
    unhealthy = [c for c in containers if c.get("health") == "unhealthy"]
    restarting = [c for c in containers if "restarting" in str(c.get("status") or "").lower()]
    top = sorted((c for c in containers if isinstance(c.get("cpu"), (int, float))), key=lambda c: -c["cpu"])[:3]
    total_cpu = round(sum(c.get("cpu") or 0 for c in containers), 1)
    return {"accessible": True, "source": "beszel", "total": len(containers), "stopped": 0, "stopped_list": [],
            "healthy": len(containers) - len(unhealthy) - len(restarting), "unhealthy": len(unhealthy), "restarting": len(restarting), "exited": 0,
            "issues": [{"name": c.get("name"), "status": f"{c.get('status')} (unhealthy)" if c in unhealthy else c.get("status"), "image": c.get("image")}
                       for c in unhealthy + restarting][:10],
            "image_updates": sorted(str(c.get("name")) for c in containers if c.get("updatable")),
            "total_cpu": total_cpu, "avg_cpu": round(total_cpu / len(containers), 1),
            "top": [{"name": c.get("name"), "cpu": c["cpu"], "mem_usage": f"{c.get('memory_mb') or 0:.0f} Mo", "mem_pct": 0.0} for c in top]}


def smart_from_beszel(sys_: dict) -> dict:
    """A disk Beszel could not read (state UNKNOWN, temperature and hours at 0) is left out: it is not a failure."""
    devs = [d for d in sys_.get("smart") or [] if str(d.get("state")).upper() in ("PASSED", "FAILED")]
    return {"accessible": bool(devs), "source": "beszel",
            "disks": [{"device": d.get("name") or "?", "healthy": str(d.get("state")).upper() == "PASSED",
                       "failed": str(d.get("state")).upper() == "FAILED", "temp": d.get("temp"), "hours": d.get("hours")}
                      for d in devs]}


def host_from_api(hc: dict, b: dict) -> dict:
    """Machine lue par l'API d'un service (Home Assistant) : mêmes champs qu'avec Beszel, source « ha » ; ce que l'API ne dit pas reste « non relevé »."""
    h = host_from_beszel(hc, b)
    h["docker"] = {"accessible": False, "reason": "api"}
    h["ssh_auth"] = {"failed_24h": 0, "available": False, "reason": "non relevé par l'API"}
    h["source"] = "ha"
    h["api_name"] = b.get("via") or "Home Assistant"
    return h


API_REUSE_S = 600   # a service's API read less than 10 minutes ago is not read again for the health


def _api_data(c, state: dict, cached_only: bool) -> dict | None:
    """What a status connector read: its result of a moment ago, else a new call (never with cached_only); None if nothing usable."""
    import connectors.base as cbase
    data = cbase.recent(c, state, max(API_REUSE_S, readers.max_age(c, CFG["fast_every"])) if readers.on(CFG) else API_REUSE_S)   # read by the server's reader or the collection a moment ago: no second call for the same data
    if data is not None or cached_only:
        return data
    data, st = cbase.run_isolated(c, state, 60)
    cbase.merge_state(CONNECTORS_STATE, state, [f"{c.type}/{c.name}"])
    return data if st.ok or st.stale else None


def api_systems(meta: dict, cached_only: bool = False) -> dict:
    """{IP: système au format Beszel} des machines lues par l'API d'un service relié : Glances ou Netdata (sur la machine même), puis
    Home Assistant (capteurs System Monitor / Supervisor de la machine hôte). cached_only: what was read a moment ago, never a new call
    (the pass of one machine after an agent report)."""
    import connectors
    import connectors.base as cbase
    from api_link import host_ip
    try:
        conns = sorted((c for c in connectors.instances(CFG, kind="status") if c.type in ("glances", "netdata", "home-assistant")), key=lambda c: c.type == "home-assistant")
    except connectors.ConnectorError:
        return {}
    machines, found = meta.get("machines", {}), {}
    state = cbase.load_state(CONNECTORS_STATE)
    for c in conns:
        host = (_api_data(c, state, cached_only) or {}).get("host")
        if not host:
            continue
        ip = next((i for i in [host_ip(c.conf.get("url")), *host.get("ips", [])] if i in machines), None)
        if ip:
            found.setdefault(ip, {k: v for k, v in host.items() if k not in ("ips", "boot")})   # Glances / Netdata first: read on the machine itself
    return found


def beszel_systems(meta: dict) -> tuple[dict, list]:
    """{IP: système Beszel} des machines de services-meta, et l'état des connecteurs Beszel lus."""
    import connectors
    import connectors.base as cbase
    from connectors.beszel import match
    try:
        conns = connectors.instances(CFG, kind="health")
    except connectors.ConnectorError as e:
        print(f"⚠ Beszel : {e}", file=sys.stderr)
        return {}, []
    state, found, statuses, read = cbase.load_state(CONNECTORS_STATE), {}, [], []
    for c in conns:
        data, st = readers.recent(c, state, CFG)   # read by the server's reader a moment ago: no second call
        if st is None:
            data, st = cbase.run_isolated(c, state, 120)
            read.append(f"{c.type}/{c.name}")
        statuses.append(st)
        print(("✓" if st.ok else "⚠") + f" {c.label} {c.name} : {st.message}" + (" (dernier relevé bon réutilisé)" if st.stale else ""))
        for ip, s in match((data or {}).get("systems", []), meta.get("machines", {})).items():
            found.setdefault(ip, s)
    cbase.merge_state(CONNECTORS_STATE, state, read)
    return found, statuses


# ───────────── Scoring par machine ─────────────

def disk_level(disks: list[dict]) -> str:
    if any(d["critical"] for d in disks):
        return "crit"
    if any(d["warning"] for d in disks):
        return "warn"
    return "ok"


def systemd_level(systemd: dict) -> str:
    n = len(systemd["failed"])
    if n >= SYSTEMD_CRIT_N:
        return "crit"
    if n >= SYSTEMD_WARN_N:
        return "warn"
    return "ok"


def docker_level(docker: dict) -> str:
    if not docker.get("accessible"):
        return "na"
    n = docker.get("unhealthy", 0) + docker.get("restarting", 0) + docker.get("exited", 0) + len(docker.get("loops") or [])
    if n >= DOCKER_CRIT_N:
        return "crit"
    if n >= DOCKER_WARN_N:
        return "warn"
    return "ok"


def kernel_level(kernel: dict) -> str:
    return "warn" if kernel.get("has_errors") else "ok"


def load_level(load: dict) -> str:
    if not load.get("available"):
        return "na"
    if load.get("cpu_pct") is not None:  # Windows : % CPU instantané
        return "warn" if load["cpu_pct"] >= CPU_WARN_PCT else "ok"
    ratio = load["load_1"] / load["ncpu"]
    if ratio >= LOAD_CRIT_MULT:
        return "crit"
    if ratio >= LOAD_WARN_MULT:
        return "warn"
    return "ok"


def ssh_auth_level(ssh_auth: dict) -> str:
    if not ssh_auth.get("available"):
        return "na"
    n = ssh_auth.get("failed_24h", 0)
    if n >= SSH_AUTH_CRIT_N:
        return "crit"
    if n >= SSH_AUTH_WARN_N:
        return "warn"
    return "ok"



def smart_level(smart: dict) -> str:
    if not smart.get("accessible"):
        return "na"
    return "crit" if any(d["failed"] for d in smart["disks"]) else "ok"


def host_checks(h: dict) -> dict[str, str]:
    """Level of each control of a reachable machine (Linux or Windows): disk, systemd, docker, kernel, load, ssh_auth, smart, temp, res,
    and the services and storage ones a Linux machine has (pm2, raid, zfs, mounts, ntp, timers, auto_upd).
    Published with the host (`checks`) so the page can say why a machine is « warn » without repeating the thresholds."""
    return {"disk": disk_level(h["disks"]), "systemd": systemd_level(h["systemd"]), "docker": docker_level(h["docker"]),
            "kernel": kernel_level(h["kernel"]), "load": load_level(h["load"]), "ssh_auth": ssh_auth_level(h["ssh_auth"]),
            "smart": smart_level(h["smart"]), "temp": temp_level(h.get("temp")), "res": resources_level(h.get("res")),
            **system_levels(h.get("system"))}


def host_level(h: dict) -> str:
    """Pire niveau des contrôles d'une machine joignable (Linux ou Windows)."""
    return worst(*host_checks(h).values())


_EMPTY_HOST_EXTRAS = {
    "apt": {"upgradable": 0, "sample": []}, "kernel": {"has_errors": False, "samples": []},
    "reboot_required": False, "load": {"load_1": 0.0, "ncpu": 1, "available": False},
    "ssh_auth": {"failed_24h": 0, "available": False},
    "smart": {"accessible": False, "disks": []}, "temp": {"available": False}, "res": {"available": False},
}


def collect_host(host: dict) -> dict:
    if host.get("os") == "windows":
        return collect_windows(host)
    run = make_runner(host)
    # One connection says whether the machine answers and whether it is an ESXi (no bash there: the batch below is not for it)
    rc, first = run("echo ok; vmware -v 2>/dev/null; true", timeout=8)
    if rc != 0 or not first.startswith("ok"):
        return {"id": host["id"], "name": host["name"], "reachable": False,
                "disks": [], "systemd": {"failed": []}, "docker": {"accessible": False},
                "level": "down", **_EMPTY_HOST_EXTRAS}
    esxi = first[2:].strip()
    if esxi.startswith("VMware ESXi"):
        # ESXi: no apt, systemd nor Docker; its VMs and datastores are read by the collection (esxi_ssh.py, Virtualization tab)
        return {"id": host["id"], "name": host["name"], "reachable": True, "os": "esxi", "esxi": esxi.strip()[:80],
                "disks": [], "systemd": {"failed": []}, "docker": {"accessible": False, "reason": "esxi"}, "level": "ok", **_EMPTY_HOST_EXTRAS}
    # Every command in one connection, then SMART for all the disks in a second one; the collectors read the outputs like an agent report
    recorded = run_batch(run, LINUX_AGENT_COMMANDS)
    rc, out = recorded.get(SMART_LIST_CMD, [1, ""])
    if rc == 0 and not host.get("vm"):
        recorded.update(run_batch(run, [smart_cmd(t) for t in smart_targets(out)]))
    return collect_linux(host, replay_runner(recorded))


# Commands the Linux agent runs on its own machine (the SSH collectors' commands, fixed); smart_cmd(<disk>) is added per disk it finds.
LINUX_AGENT_COMMANDS = [DISKS_CMD, SYSTEMD_CMD, DOCKER_PS_CMD, DOCKER_STATS_CMD, APT_CMD, KERNEL_CMD, REBOOT_CMD, LOAD_CMD,
                        _RES_CMD, _TEMP_CMD, VIRT_CMD, SSH_AUTH_CMD, SMART_LIST_CMD, LOGS_CMD, GPU_CMD, SYSTEM_CMD]
SLOW_CMDS = ("docker stats", "apt list", "snap refresh")   # allowed 40 s instead of 20 (the same rule in agent.py)
# Linux agent (version 3): outputs it keeps and sends again instead of running the command at each report, with their lifetime (s)
LINUX_AGENT_CACHE = {APT_CMD: 3600, LOGS_CMD: 3600}
SMART_CACHE = 6 * 3600   # SMART of each disk: every 6 h


def _limit(cmd: str) -> int:
    return 40 if any(s in cmd for s in SLOW_CMDS) else 20


def batch_script(cmds: list[str]) -> str:
    """One bash script that runs each command with its own time limit, then prints « @@<n> <rc> » and its output in base64 on one line:
    stdout, plus stderr when it failed, as run() gives it. Nothing in an output can be mistaken for the next marker."""
    lines = ['t=$(mktemp -d) || exit 1']
    for i, c in enumerate(cmds):
        quoted = "'" + c.replace("'", "'\\''") + "'"
        lines.append(f"timeout -k 2 {_limit(c)} bash -c {quoted} >$t/o 2>$t/e </dev/null; r=$?; [ $r = 0 ] || cat $t/e >>$t/o; "
                     f"printf '@@%d %d\\n' {i} $r; base64 -w0 <$t/o; echo")
    lines.append('rm -rf "$t"')
    return "\n".join(lines)


def parse_batch(cmds: list[str], out: str) -> dict:
    """{command: [rc, output]} from batch_script's output; a command missing (the connection cut short) is left out."""
    recorded, lines = {}, out.splitlines()
    for i, ln in enumerate(lines[:-1]):
        m = re.fullmatch(r"@@(\d+) (\d+)", ln)
        if not m or int(m.group(1)) >= len(cmds):
            continue
        try:
            text = base64.b64decode(lines[i + 1], validate=True).decode("utf-8", "replace")
        except ValueError:
            continue
        rc = int(m.group(2))
        recorded[cmds[int(m.group(1))]] = [rc, text if rc == 0 else text.strip()]
    return recorded


def run_batch(run, cmds: list[str]) -> dict:
    """Runs the commands in a single call of run() (one SSH connection) and returns their outputs."""
    if not cmds:
        return {}
    _, out = run(batch_script(cmds), timeout=min(150, sum(map(_limit, cmds)) + 10))
    return parse_batch(cmds, out)


def replay_runner(recorded):
    """run(cmd, timeout) -> (rc, out) that answers from the outputs a Linux agent recorded (nothing is ever executed here):
    the collectors then read an agent report exactly like an SSH session. A command the agent did not record fails like a missing tool."""
    recorded = recorded if isinstance(recorded, dict) else {}

    def run(cmd: str, timeout: int = 15) -> tuple[int, str]:
        r = recorded.get(cmd)
        if isinstance(r, (list, tuple)) and len(r) == 2 and isinstance(r[0], int) and isinstance(r[1], str):
            return r[0], r[1]
        return 127, "commande non relevée par l'agent"
    return run


def collect_linux(host: dict, run) -> dict:
    """Santé d'une machine Linux joignable : `run` exécute les commandes (SSH, local) ou les rejoue (relevé d'agent)."""
    disks = collect_disks(run)
    systemd = collect_systemd(run)
    docker = collect_docker(run, host.get("stopped_ok"))
    apt = collect_apt(run)
    kernel = collect_kernel_errors(run)
    reboot_required = collect_reboot_required(run)
    load = collect_load(run)
    ssh_auth = collect_ssh_auth(run)
    temp = collect_cpu_temp(run, bool(host.get("vm")))
    gpu = collect_gpu(run)
    res = collect_resources(run)
    logs = collect_big_logs(run)
    # SMART non pertinent sur une VM (disque virtualisé, pas de hardware physique dédié)
    smart = {"accessible": False, "disks": [], "vm": True} if host.get("vm") else collect_smart(run)
    system = collect_system(run)
    if docker.get("accessible") and system.get("docker_loops"):
        docker["loops"] = system["docker_loops"]
    system.pop("docker_loops", None)
    h = {"id": host["id"], "name": host["name"], "reachable": True,
         "disks": disks, "systemd": systemd, "docker": docker, "apt": apt, "kernel": kernel,
         "reboot_required": reboot_required, "load": load, "ssh_auth": ssh_auth, "smart": smart, "temp": temp, "gpu": gpu, "res": res, "logs": logs,
         "system": system}
    h["level"] = host_level(h)
    return h

# ───────────── Secrets / Discord ─────────────

def build_discord_payload(stats: dict) -> dict:
    overall = stats["overall_level"]
    color = {"ok": 0x10B981, "warn": 0xF59E0B, "crit": 0xEF4444, "down": 0x71717A}[overall]
    emoji = {"ok": "🟢", "warn": "🟡", "crit": "🔴", "down": "⚪"}[overall]
    mark_of = {"ok": "🟢", "warn": "🟡", "crit": "🔴", "down": "⚪", "na": "🟢"}

    lines = []
    for h in stats["hosts"]:
        mark = mark_of[h["level"]]
        if not h["reachable"]:
            lines.append(f"{mark} **{h['name']}** : injoignable")
            continue
        bits = []
        warn_disks = [d for d in h["disks"] if d["warning"]]
        if warn_disks:
            bits.append(", ".join(f"`{d['mount']}` {d['used_pct']}%" for d in warn_disks[:3]))
        if h["systemd"]["failed"]:
            bits.append(f"{len(h['systemd']['failed'])} service(s) KO")
        if h["kernel"]["has_errors"]:
            bits.append("erreurs kernel")
        if h["reboot_required"]:
            bits.append("reboot requis")
        if load_level(h["load"]) not in ("ok", "na"):
            bits.append(f"CPU {h['load']['cpu_pct']}%" if h["load"].get("cpu_pct") is not None
                        else f"load {h['load']['load_1']:.1f}/{h['load']['ncpu']} CPU")
        if ssh_auth_level(h["ssh_auth"]) != "ok":
            bits.append(f"{h['ssh_auth']['failed_24h']} échecs SSH (24h)")
        if smart_level(h["smart"]) == "crit":
            bits.append("disque SMART en échec")
        if temp_level(h.get("temp")) in ("warn", "crit"):
            bits.append(f"CPU {h['temp']['celsius']:.0f} °C")
        if resources_level(h.get("res")) in ("warn", "crit"):
            bits.append(f"mémoire {h['res']['mem_pct']:.0f} %")
        dk = h["docker"]
        if dk.get("accessible"):
            n = dk["unhealthy"] + dk["restarting"] + dk["exited"]
            if n:
                bits.append(f"{n} conteneur(s) KO")
        lines.append(f"{mark} **{h['name']}** : " + (" · ".join(bits) if bits else "RAS"))

    embed = {
        "author": {"name": "MyServices · health"},
        "title": f"{emoji} Health multi-hosts · {LEVEL_LABEL[overall]}",
        "description": "\n".join(lines)[:4096],
        "color": color,
        "footer": {"text": next_label()},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    url = CFG["public_url"].rstrip("/") + "/health/" if CFG["public_url"] else ""
    if url.startswith(("http://", "https://")):
        embed["url"] = url
        embed["description"] = (embed["description"] + f"\n\n🔗 **Page complète** : {url}")[:4096]
    return {"username": "Health", "embeds": [embed]}


def post_discord(payload: dict) -> int:
    webhook = CFG["health_webhook"] or CFG["discord_webhook"]
    if not webhook:
        print("pas de webhook Discord (health_webhook / discord_webhook vides)", file=sys.stderr)
        return 1
    req = urllib.request.Request(
        webhook, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"✓ Discord posté (HTTP {r.status})")
            return 0
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:400]
        except Exception:
            pass
        print(f"⚠ Discord POST HTTP {e.code}: {body}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"⚠ Discord POST échoué: {e}", file=sys.stderr)
        return 1

# ───────────── HTML render ─────────────

CSS = """
:root{color-scheme:dark}*{box-sizing:border-box}
body{font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;
     max-width:1700px;margin:0 auto;padding:1.5rem 2.5rem;
     background:#0a0a0b;color:#e4e4e7}
header.hero{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;
  background:linear-gradient(135deg,#0f1626 0%,#161618 62%);border:1px solid #1e3a5f;
  border-radius:14px;padding:1.1rem 1.4rem;margin-bottom:1.4rem}
header.hero h1{margin:0;font-size:1.6rem;letter-spacing:-.01em}
header.hero .sub{color:#8a8a93;font-size:.82em;margin-top:.35rem}
.health{display:inline-flex;align-items:center;gap:.5rem;padding:.4rem .9rem;
        border-radius:999px;font-weight:600;font-size:.9em;border:1px solid}
.health.ok{color:#10b981;border-color:#064e3b;background:#022c22}
.health.warn{color:#f59e0b;border-color:#78350f;background:#2c1a02}
.health.crit{color:#ef4444;border-color:#7f1d1d;background:#2a0808}
.health.down{color:#a1a1aa;border-color:#3f3f46;background:#18181b}
.mx-wrap{overflow-x:auto;margin-top:.6rem}
.hostgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1.1rem;margin-top:.5rem}
.host-row{display:grid;grid-template-columns:88px 1fr;gap:.5rem;align-items:start;
  padding:.4rem 0;border-bottom:1px solid #1f1f23;font-size:.88em}
.host-row:last-child{border-bottom:0}
.host-row .host-label{margin-bottom:0;font-size:.82em;line-height:1.25}
.mx-corner{background:transparent}
.mx-head{background:#18181b;border:1px solid #27272a;border-top:4px solid #3f3f46;
  border-radius:10px 10px 0 0;padding:.65rem .8rem;font-weight:600;font-size:.95rem;
  display:flex;align-items:center;flex-wrap:wrap;gap:.5rem}
.mx-head.ok{border-top-color:#10b981}
.mx-head.warn{border-top-color:#f59e0b}
.mx-head.crit{border-top-color:#ef4444}
.mx-head.down{border-top-color:#52525b}
.mx-label{display:flex;align-items:center;color:#a1a1aa;font-size:.76rem;font-weight:600;
  text-transform:uppercase;letter-spacing:.04em;padding:.6rem .4rem;white-space:nowrap}
.mx-cell{background:#141417;border:1px solid #232326;border-radius:8px;padding:.6rem .8rem;font-size:.9em}
.mx-label.z-even,.mx-cell.z-even{background:#191a1e}
.host-card{background:#18181b;border:1px solid #27272a;border-left:4px solid #3f3f46;
           border-radius:12px;padding:1rem 1.2rem}
.host-card.ok{border-left-color:#10b981}
.host-card.warn{border-left-color:#f59e0b}
.host-card.crit{border-left-color:#ef4444}
.host-card.down{border-left-color:#52525b}
.host-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:.7rem}
.host-head h3{margin:0;font-size:1.05rem}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:.72em;font-weight:700;
  border:1px solid transparent}
.badge.ok{background:#0d3d30;color:#34d399;border-color:#10b981}
.badge.warn{background:#4a2d06;color:#fbbf24;border-color:#f59e0b}
.badge.crit{background:#4c0f0f;color:#f87171;border-color:#ef4444}
.badge.na{background:#27272a;color:#a1a1aa;border-color:#3f3f46}
.badge.down{background:#3f3f46;color:#e4e4e7;border-color:#71717a}
.val{font-size:1.15em;font-weight:700;font-variant-numeric:tabular-nums}
.val.ok{color:#34d399}.val.warn{color:#fbbf24}.val.crit{color:#f87171}.val.na{color:#a1a1aa}
.host-section{margin-top:.7rem}
.host-label{color:#a1a1aa;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;
            font-weight:600;margin-bottom:.35rem}
.disk-row{display:flex;align-items:center;gap:.5rem;font-size:.85em;margin:.25rem 0}
.disk-row code{flex:0 0 auto;min-width:70px;color:#d4d4d8}
.disk-row .bar{flex:1;background:#27272a;border-radius:6px;height:6px;overflow:hidden}
.disk-row .bar>span{display:block;height:100%;border-radius:6px}
.bar>span.green{background:linear-gradient(90deg,#10b981,#34d399)}
.bar>span.yellow{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
.bar>span.orange{background:linear-gradient(90deg,#f97316,#fb923c)}
.bar>span.red{background:linear-gradient(90deg,#ef4444,#f87171)}
.disk-row .pct{flex:0 0 auto;width:38px;text-align:right;color:#a1a1aa}
.disk-size{color:#71717a;font-size:.78em;margin:-.05rem 0 .4rem 0}
.muted{color:#71717a;font-size:.85em}
.issue-list{list-style:none;margin:0;padding:0;font-size:.85em}
.issue-list li{padding:.15rem 0;color:#d4d4d8}
.issue-list li code{color:#fca5a5}
.top-list{list-style:none;margin:.3rem 0 0;padding:0;font-size:.85em}
.top-list li{padding:.1rem 0;color:#d4d4d8}
.top-list li code{color:#93c5fd}
code{background:#27272a;padding:1px 6px;border-radius:4px;font-size:.85em;color:#d4d4d8;word-break:break-all}
details{margin-top:.25rem}
details summary{cursor:pointer;font-size:.78em;color:#71717a}
.logpre{white-space:pre-wrap;word-break:break-all;font-size:.72em;color:#a1a1aa;margin:.3rem 0 0;
        background:#0f0f11;border:1px solid #27272a;border-radius:6px;padding:.5rem .7rem;overflow-x:auto}
.synthesis-band{background:linear-gradient(180deg,#0f1626,#161618);border:1px solid #1e3a5f;
  border-left:4px solid #3b82f6;border-radius:14px;padding:1.2rem 1.5rem;margin:0 0 1.4rem}
.synthesis-band h2{margin:0 0 .7rem;font-size:1rem;color:#93c5fd}
.synthesis-band .tldr{font-size:1.02rem;line-height:1.6;margin:0 0 .8rem;font-style:normal;color:#e8e8ea}
.bullets{list-style:none;padding:0;margin:0}
.bullets li{padding:.35rem 0;border-bottom:1px solid #1e293b;font-size:.92rem}
.bullets li:last-child{border:0}
.bullets li::before{content:"▸ ";color:#3b82f6;font-weight:bold}
/* Tableau full-bleed : deborde du body centre pour utiliser toute la largeur ecran */
.full-bleed{width:100vw;position:relative;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;
  padding:0 2rem;box-sizing:border-box;overflow-x:auto;margin-top:.5rem}
.dash-table{width:100%;min-width:1000px;border-collapse:collapse;background:#141417;
  border-radius:10px;overflow:hidden}
.dash-table th{background:#18181b;color:#a1a1aa;text-align:left;padding:.7rem .9rem;
  font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;font-weight:600;
  border-bottom:2px solid #27272a;white-space:nowrap}
.dash-table td{padding:.7rem .9rem;border-bottom:1px solid #232326;vertical-align:top;font-size:.86em}
.dash-table tbody tr:last-child td{border-bottom:0}
.dash-table tbody tr:nth-child(even){background:#18181b}
.dash-table tbody tr.ok{box-shadow:inset 4px 0 0 #10b981}
.dash-table tbody tr.warn{box-shadow:inset 4px 0 0 #f59e0b}
.dash-table tbody tr.crit{box-shadow:inset 4px 0 0 #ef4444}
.dash-table tbody tr.down{box-shadow:inset 4px 0 0 #52525b}
.dash-table td.td-host{font-weight:600;white-space:nowrap;font-size:.92em}
.dash-table td.td-host .badge{margin-left:.5rem}
footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #27272a;color:#52525b;font-size:.78em;text-align:center}
a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}
"""


def _bar_class(pct: int) -> str:
    if pct >= DISK_CRIT_PCT:
        return "red"
    if pct >= DISK_WARN_PCT:
        return "orange"
    if pct >= 60:
        return "yellow"
    return "green"


def _pct_badge_class(pct: float, warn: float, crit: float) -> str:
    if pct >= crit:
        return "crit"
    if pct >= warn:
        return "warn"
    return "ok"


def compute_host_blocks(h: dict) -> dict:
    """Construit les blocs HTML de chaque catégorie pour un host (grille alignée par ligne)."""
    if not h["reachable"]:
        na = "<div class='muted'>-</div>"
        return {
            "header": html_lib.escape(h["name"]), "level": "down",
            "disk": "<div class='muted'>Hôte injoignable en SSH (timeout ou clé refusée)"
                    + (" ou PowerShell sans réponse" if h.get("os") == "windows" else "") + ".</div>",
            "systemd": na, "load": na, "kernel": na, "apt": na, "ssh": na, "smart": na,
            "docker_label": "🐳 Docker", "docker": na,
        }

    level = h["level"]

    def _disk_row(d: dict) -> str:
        cls = _bar_class(d["used_pct"])
        return (
            f"<div class='disk-row'><code>{html_lib.escape(d['mount'])}</code>"
            f"<div class='bar'><span class='{cls}' style='width:{d['used_pct']}%'></span></div>"
            f"<span class='pct'>{d['used_pct']}%</span></div>"
            f"<div class='disk-size'>{d['used_gb']} / {d['size_gb']} GB</div>"
        )
    # Petits volumes (ex. /boot/efi, /etc/pve) caches par defaut, SAUF s'ils ont un vrai
    # souci (warn/crit) : un petit volume plein reste un probleme a voir tout de suite.
    DISK_MINOR_GB = 2
    def _is_minor(d: dict) -> bool:
        return d["size_gb"] < DISK_MINOR_GB and not d["warning"] and not d["critical"]
    main_disks = [d for d in h["disks"][:8] if not _is_minor(d)]
    minor_disks = [d for d in h["disks"][:8] if _is_minor(d)]
    disk_block = "".join(_disk_row(d) for d in main_disks) or "<div class='muted'>-</div>"
    if minor_disks:
        minor_rows = "".join(_disk_row(d) for d in minor_disks)
        disk_block += (f"<details><summary>+{len(minor_disks)} petit(s) volume(s)</summary>"
                       f"{minor_rows}</details>")

    failed = h["systemd"]["failed"]
    if failed:
        items = "".join(
            f"<li><code>{html_lib.escape(s['unit'])}</code> "
            f"<span class='muted'>{html_lib.escape(s['sub'])}</span></li>" for s in failed[:6]
        )
        systemd_block = f"<ul class='issue-list'>{items}</ul>"
    else:
        systemd_block = ("<div class='muted'>✅ Services automatiques démarrés</div>" if h.get("os") == "windows"
                         else "<div class='muted'>✅ A jour!</div>")

    kernel = h["kernel"]
    if kernel["has_errors"]:
        logs = "".join(f"<div>{html_lib.escape(l)}</div>" for l in kernel["samples"])
        kernel_block = (f"<span class='badge warn'>{len(kernel['samples'])}</span> erreur(s) récente(s)"
                        f"<details><summary>voir</summary><div class='logpre'>{logs}</div></details>")
    elif kernel.get("available") is False:
        kernel_block = "<div class='muted'>Non relevé (Beszel seul)</div>"
    else:
        kernel_block = ("<div class='muted'>✅ Aucune erreur critique ou disque (journal Système, 12h)</div>"
                        if h.get("os") == "windows" else "<div class='muted'>✅ Aucune erreur kernel (12h)</div>")

    apt = h["apt"]
    if apt.get("available") is False:
        apt_block = ("<div class='muted'>Non relevé par Beszel</div>" if h.get("source") == "beszel"
                     else "<div class='muted'>Non lisible (recherche Windows Update refusée)</div>")
    elif apt["upgradable"]:
        apt_cls = "crit" if apt["upgradable"] >= APT_CRIT_N else "warn"
        sample = "".join(f"<li>{html_lib.escape(str(s))}</li>" for s in apt["sample"])
        apt_block = (f"<span class='badge {apt_cls}'>{apt['upgradable']}</span> paquet(s) à mettre à jour"
                    + (f"<details><summary>voir</summary><ul class='top-list'>{sample}</ul></details>" if sample else ""))
    else:
        apt_block = "<div class='muted'>✅ Système à jour</div>"

    dk = h["docker"]
    if not dk.get("accessible"):
        docker_label = "🐳 Docker"
        docker_block = ("<div class='muted'>N/A (Windows)</div>" if dk.get("reason") == "windows"
                        else "<div class='muted'>Non relevé (Beszel seul)</div>" if dk.get("reason") == "beszel"
                        else "<div class='muted'>Non accessible (pas d'accès docker)</div>")
    else:
        docker_label = f"🐳 Docker<br>({dk['total']} cont.)"
        count_cls = docker_level(dk)
        # CPU cumulé compare au nombre de coeurs de l'hote (meme logique que la Charge) :
        # ex. 250% cumule sur 2 CPU = 1.25x -> ok/warn/crit selon LOAD_WARN/CRIT_MULT.
        ncpu = h["load"]["ncpu"] if h["load"].get("available") else 1
        total_ratio = dk["total_cpu"] / 100 / max(ncpu, 1)
        total_cls = "crit" if total_ratio >= LOAD_CRIT_MULT else "warn" if total_ratio >= LOAD_WARN_MULT else "ok"
        avg_cls = _pct_badge_class(dk["avg_cpu"], DOCKER_CPU_WARN_PCT, DOCKER_CPU_CRIT_PCT)
        parts = [
            f"<div><span class='badge {count_cls}' title='conteneurs en marche / conteneurs censés tourner'>"
            f"{dk['healthy']}/{dk['total']} OK</span>"
            + (f" <span class='muted' title='Created ou arrêtés proprement (code 0/137/143) : arrêt voulu, pas une panne'>"
               f"· {dk['stopped']} arrêté{'s' if dk['stopped'] > 1 else ''}</span>" if dk.get("stopped") else "")
            + "</div>",
            f"<div style='margin-top:.35rem'><span class='val {total_cls}'>{dk['total_cpu']}%</span> "
            f"<span class='muted'>CPU cumulé</span></div>"
            f"<div><span class='val {avg_cls}'>{dk['avg_cpu']}%</span> <span class='muted'>moyenne/conteneur</span></div>",
        ]
        if dk["top"]:
            titems = "".join(
                f"<li><code>{html_lib.escape(c['name'])}</code> "
                f"<span class='val {_pct_badge_class(c['cpu'], DOCKER_CPU_WARN_PCT, DOCKER_CPU_CRIT_PCT)}'>{c['cpu']}%</span> "
                f"<span class='muted'>cpu</span> "
                f"<span class='val {_pct_badge_class(c['mem_pct'], DOCKER_MEM_WARN_PCT, DOCKER_MEM_CRIT_PCT)}'>{c['mem_pct']}%</span> "
                f"<span class='muted'>mem</span></li>"
                for c in dk["top"]
            )
            parts.append(f"<div class='host-label' style='margin-top:.5rem'>Top conso</div><ul class='top-list'>{titems}</ul>")
        if dk["issues"]:
            items = "".join(
                f"<li><code>{html_lib.escape(c['name'])}</code> "
                f"<span class='muted'>{html_lib.escape(c['status'])}</span></li>" for c in dk["issues"][:6]
            )
            parts.append(f"<ul class='issue-list'>{items}</ul>")
        if dk.get("stopped_list"):
            items = "".join(
                f"<li><code>{html_lib.escape(c['name'])}</code> "
                f"<span class='muted'>{html_lib.escape(c['status'])}</span></li>" for c in dk["stopped_list"]
            )
            parts.append(f"<details class='muted' style='margin-top:.35rem'><summary>arrêtés volontairement</summary>"
                         f"<ul class='top-list'>{items}</ul></details>")
        docker_block = "".join(parts)

    reboot_chip = " <span class='badge warn'>🔄 reboot</span>" if h["reboot_required"] else ""

    load = h["load"]
    if not load["available"]:
        load_block = "<div class='muted'>Non disponible</div>"
    elif load.get("cpu_pct") is not None:  # Windows
        try:
            up = (datetime.now(timezone.utc) - datetime.fromisoformat(load["boot"].replace("Z", "+00:00"))).days
        except (AttributeError, ValueError):
            up = None
        load_block = (f"<div><span class='val {load_level(load)}'>{load['cpu_pct']}%</span> <span class='muted'>CPU</span></div>"
                      f"<div class='muted'>{load['ncpu']} CPU</div>"
                      + (f"<div class='muted'>démarré il y a {up} j</div>" if up is not None else ""))
    else:
        lcls = load_level(load)
        ratio_pct = round((load["load_1"] / load["ncpu"]) * 100)
        # Valeurs en couleur seule (sans badge) : plus lisibles, couleur selon le seuil
        load_block = (f"<div><span class='val {lcls}'>{load['load_1']:.2f}</span> <span class='muted'>load 1 min</span></div>"
                      f"<div class='muted'>{load['ncpu']} CPU</div>"
                      f"<div><span class='val {lcls}'>{ratio_pct}%</span> <span class='muted'>de charge</span></div>")

    ssh_auth = h["ssh_auth"]
    if not ssh_auth["available"]:
        ssh_block = f"<div class='muted'>Non lisible ({html_lib.escape(ssh_auth.get('reason', 'journal inaccessible'))})</div>"
    else:
        scls = ssh_auth_level(ssh_auth)
        ssh_block = (f"<div class='muted'><span class='badge {scls}'>{ssh_auth['failed_24h']}</span> "
                    + ("échec(s) de connexion Windows (24h)" if h.get("os") == "windows" else "tentative(s) échouée(s) (24h)")
                    + "</div>")

    smart = h["smart"]
    if smart.get("vm"):
        smart_block = "<div class='muted'>N/A (machine virtuelle)</div>"
    elif not smart["accessible"]:
        smart_block = "<div class='muted'>Non accessible (smartctl absent ou permissions)</div>"
    else:
        sitems = "".join(
            f"<li>Disk {html_lib.escape(d['device'])}: "
            f"<span class='badge {'crit' if d['failed'] else 'ok'}'>{'FAILED' if d['failed'] else 'PASSED'}</span></li>"
            for d in smart["disks"]
        )
        smart_block = f"<ul class='top-list'>{sitems}</ul>" if sitems else "<div class='muted'>Aucun disque détecté</div>"
        if smart.get("source") == "beszel":
            smart_block += "<div class='muted'>lu par Beszel</div>"

    return {
        "header": f"{html_lib.escape(h['name'])}{reboot_chip}", "level": level,
        "disk": disk_block, "systemd": systemd_block, "load": load_block, "kernel": kernel_block,
        "apt": apt_block, "ssh": ssh_block, "smart": smart_block,
        "docker_label": docker_label, "docker": docker_block,
    }


def next_label() -> str:
    """« prochaine analyse à HH:MM » d'après le timer systemd, vide sans timer."""
    nxt = next_timer_run(TIMER)
    return f"prochaine analyse à {datetime.fromisoformat(nxt).astimezone():%H:%M}" if nxt else ""


def render_html(stats: dict) -> str:
    local_ts = datetime.fromisoformat(stats["timestamp"]).astimezone()
    now_str = local_ts.strftime("%Y-%m-%d %H:%M ") + local_ts.tzname()
    hosts = stats["hosts"]
    blocks = [compute_host_blocks(h) for h in hosts]
    overall = stats["overall_level"]
    nxt = next_label()

    columns = [
        ("💾 Disque", "disk"), ("⚙️ Systemd", "systemd"), ("⚡ Charge", "load"),
        ("🐧 Kernel", "kernel"), ("📦 Maj", "apt"), ("🔐 SSH", "ssh"),
        ("🩺 SMART", "smart"), ("🐳 Docker", "docker"),
    ]
    thead = "<th>Machine</th>" + "".join(f"<th>{label}</th>" for label, _ in columns)
    trows = []
    for b in blocks:
        tds = "".join(f"<td>{b[key]}</td>" for _, key in columns)
        trows.append(
            f"<tr class='{b['level']}'>"
            f"<td class='td-host'>{b['header']}<br><span class='badge {b['level']}'>{LEVEL_LABEL[b['level']]}</span></td>"
            f"{tds}</tr>"
        )
    table_html = f"""<div class="full-bleed"><table class="dash-table">
<thead><tr>{thead}</tr></thead>
<tbody>{''.join(trows)}</tbody>
</table></div>"""
    return f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Health · MyServices</title><link rel="icon" type="image/svg+xml" href="../favicon.svg?v=2">
<style>{CSS}</style></head><body>
<header class="hero">
  <div>
    <h1>🩺 Health Dashboard <span class='muted' style='font-size:.6em;font-weight:400'>· {len(stats['hosts'])} machines</span></h1>
    <div class="sub">Dernière analyse : <strong>{now_str}</strong>{' · ' + nxt if nxt else ''} · sans LLM, lecture seule · <a href="../#machines" style="color:#60a5fa">voir aussi MyServices › Machines</a></div>
  </div>
  <div class="health {overall}">● {LEVEL_LABEL[overall]}</div>
</header>
{table_html}
</body></html>"""

# ───────────── Historique (events.json) ─────────────

EVENT_LABELS = {"health_ok": "🩺 Santé bonne", "health_warn": "🩺 Santé à surveiller",
                "health_crit": "🩺 Santé critique", "health_down": "🩺 Machine injoignable"}
EVENT_SEVERITY = {"health_ok": 0, "health_warn": 1, "health_crit": 3, "health_down": 3}


def host_reasons(h: dict) -> str:
    """Sous-contrôles non OK d'une machine, ex. « noyau WARN, disque CRIT »."""
    if not h["reachable"]:
        return "SSH injoignable"
    sub = (("disque", disk_level(h["disks"])), ("systemd", systemd_level(h["systemd"])),
           ("docker", docker_level(h["docker"])), ("noyau", kernel_level(h["kernel"])),
           ("charge", load_level(h["load"])), ("SSH", ssh_auth_level(h["ssh_auth"])),
           ("SMART", smart_level(h["smart"])), ("température", temp_level(h.get("temp"))), ("mémoire", resources_level(h.get("res"))))
    return ", ".join(f"{name} {LEVEL_LABEL[lvl]}" for name, lvl in sub if lvl in ("warn", "crit"))


def record_events(hosts: list[dict], prev_levels: dict, ts: str) -> None:
    """Ajoute un événement par machine dont le niveau a changé depuis le passage précédent.
    Premier passage (prev_levels vide) = simple relevé de référence, aucun événement."""
    try:
        data = json.loads(EVENTS_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {"events": []}
    local = datetime.fromisoformat(ts).astimezone()
    for h in hosts:
        old, new = prev_levels.get(h["id"]), h["level"]
        if old is None or old == new:
            continue
        reasons = host_reasons(h)
        name, ip = h["name"].split(" · ")[0], h["name"].split(" · ")[-1]  # « Nom · IP »
        data["events"].append({
            "kind": f"health_{new}", "key": f"health:{h['id']}", "label": name, "machine": name, "target": ip,
            "detail": f"{LEVEL_LABEL.get(old, old)} → {LEVEL_LABEL[new]}" + (f" · {reasons}" if reasons else ""),
            "at": local.strftime("%Y-%m-%d %H:%M"), "ts": local.isoformat(timespec="seconds"),
        })
    cutoff = local - timedelta(days=EVENTS_RETENTION_DAYS)
    data["events"] = sorted((e for e in data["events"] if datetime.fromisoformat(e["ts"]) >= cutoff),
                            key=lambda e: e["ts"], reverse=True)
    data.update(generated=local.isoformat(timespec="seconds"), retention_days=EVENTS_RETENTION_DAYS,
                labels=EVENT_LABELS, severity=EVENT_SEVERITY)
    EVENTS_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user


# ───────────── Main ─────────────

def awake_ips(besz: dict) -> set[str]:
    """IPs of the machines Beszel gives as up right now."""
    return {ip for ip, s in besz.items() if isinstance(s, dict) and s.get("status") == "up"}


def merge_only(previous: list[dict], previous_asleep: list[dict], hosts: list[dict], asleep: list[dict], only: str) -> tuple[list[dict], list[dict]]:
    """Result of « --only <ip> »: the machine read replaces its old row, the others keep theirs. A machine no longer read at all (switched
    off in Settings, « often off » without an agent report...) loses its old row instead of keeping a stale « unreachable » for ever."""
    fresh = {h["id"] for h in hosts} | {a["id"] for a in asleep}
    return ([h for h in previous if h["id"] not in fresh and not str(h.get("name", "")).endswith(f" · {only}")] + hosts,
            asleep + [a for a in previous_asleep if a["id"] not in fresh and a.get("ip") != only])


def main() -> int:
    dry = "--dry-run" in sys.argv
    ts = datetime.now(timezone.utc).isoformat()

    if OUT_DIR.is_symlink():  # health_url branché sur un health-watcher externe : ne jamais écrire dedans
        sys.exit(f"{OUT_DIR} est un lien (health externe) : health.py ne tourne pas")
    hosts = []
    agents = agent_reports()
    candidates, meta = load_hosts(set(agents))
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv[:-1] else None  # une seule machine (IP) : les autres gardent leur dernier relevé
    # After an agent report (--agent): a machine read over SSH first keeps its SSH reading until the next pass (the report only complements it)
    ssh_first = [hc for hc in candidates if hc["ip"] == only and hc["target"] and source_order(hc, agents.get(only))[0] == "ssh"] if only and "--agent" in sys.argv else []
    if ssh_first:
        print(f"= relevé d'agent de {only} : machine lue en SSH, rien à relire" + (" (un point pour les courbes)" if agent_figures(ssh_first[0], agents.get(only), ts) else ""))
        return 0
    previous, previous_asleep, previous_connectors = [], [], []
    if only:
        try:
            last = json.loads(STATS_JSON.read_text(encoding="utf-8"))
            previous, previous_asleep, previous_connectors = last.get("hosts", []), last.get("asleep", []), last.get("connectors", [])
        except (OSError, ValueError):
            pass
    asleep = []
    apis = api_systems(meta, cached_only=bool(only))
    # Beszel is read for a whole pass, or for the one machine asked for (even a « often off » one: Beszel may be telling it is up)
    needs_beszel = any(hc["target"] is None or "beszel" in source_order(hc, agents.get(hc["ip"])) for hc in candidates if not only or hc["ip"] == only)
    besz, besz_status = beszel_systems(meta) if (not only or needs_beszel or only in meta.get("machines", {})) else ({}, [])
    awake = awake_ips(besz)
    if awake - set(agents):   # a « often off » machine that Beszel sees up is read like the others, from Beszel
        candidates, meta = load_hosts(set(agents) | awake)
    if only:
        candidates = [hc for hc in candidates if hc["ip"] == only]
    for hc in candidates:
        print(f"▸ {hc['name']}...")
        h = read_host(hc, agents.get(hc["ip"]), besz.get(hc["ip"]), api=apis.get(hc["ip"]))
        if h is None:
            if hc["off"]:  # poste « souvent éteint » sans relevé : sa fiche reste, grisée, sans alerte ni événement
                asleep.append(asleep_entry(hc, agents.get(hc["ip"])))
            continue
        if h.get("sources"):
            print("  sources : " + " + ".join(h["sources"]))
        print(f"  → {h['level'].upper()}" + ("" if h["reachable"] else " (injoignable)"))
        h["read_at"] = ts   # when this machine was read: a pass of --only leaves the others with theirs (machine page, metrics.py)
        hosts.append(h)

    if only:  # relevé d'une machine : elle remplace son ancienne ligne (ou s'ajoute), les autres restent telles quelles
        hosts, asleep = merge_only(previous, previous_asleep, hosts, asleep, only)
    for h in hosts:   # the controls that are not « ok »: what the page shows next to a « warn » or « crit » badge
        if h.get("reachable") and "disks" in h:
            h["checks"] = {k: v for k, v in host_checks(h).items() if v in ("warn", "crit")}
    overall = worst(*(h["level"] for h in hosts))
    connectors = [{"type": st.type, "name": st.name, "ok": st.ok, "message": st.message} for st in besz_status] or previous_connectors   # a pass of one machine reads no Beszel: it keeps the last states
    stats = {"timestamp": ts, "hosts": hosts, "asleep": asleep, "overall_level": overall, "connectors": connectors}
    print(f"→ global={overall.upper()}")

    if dry:
        print(json.dumps(stats, indent=2, ensure_ascii=False, default=str)[:6000])
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    try:  # état du passage précédent : sans lui, 1er passage = référence, aucun événement
        prev_levels = json.loads(STATE_FILE.read_text(encoding="utf-8")).get("levels", {})
    except (OSError, ValueError):
        prev_levels = {}
    record_events(hosts, prev_levels, ts)
    STATS_JSON.write_text(json.dumps(stats, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    INDEX.write_text(render_html(stats), encoding="utf-8")
    print(f"✓ {INDEX}")
    print(f"✓ {STATS_JSON}")

    payload = build_discord_payload(stats)
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    if os.environ.get("MYSERVICES_ALERTS_ENGINE") == "1":
        print("= Alertes envoyées par Réglages → Alertes (changements de niveau).")
    elif HASH_FILE.exists() and HASH_FILE.read_text().strip() == digest:
        print("= Même contenu, pas d'alerte.")
    else:
        # Résumé mémorisé seulement si chaque canal configuré l'a reçu : sinon renvoyé au passage suivant
        sent = [post_discord(payload) == 0] if CFG["health_webhook"] or CFG["discord_webhook"] else []
        if notify.telegram_on():
            e = payload["embeds"][0]
            ok_, msg = notify.send_telegram(f"{e['title']}\n\n{e['description']}")
            print(("✓ " if ok_ else "⚠ ") + msg, file=sys.stdout if ok_ else sys.stderr)
            sent.append(ok_)
        if not sent:
            print("pas d'alerte : ni Discord ni Telegram configuré", file=sys.stderr)
        elif all(sent):
            HASH_FILE.write_text(digest, encoding="utf-8")

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"last_run": ts, "overall_level": overall,
                                      "levels": {h["id"]: h["level"] for h in hosts}}, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    import app_user
    app_user.drop_root()   # docker compose exec : root -> compte 10001 (sa config SSH, fichiers de /data restés à lui)
    sys.exit(main())
