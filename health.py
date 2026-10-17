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

import base64
import hashlib
import html as html_lib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import notify
from config import CFG, next_timer_run

STATE_FILE = Path(CFG["state_dir"]) / "health.json"
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
)
# ───────────── Machines surveillées ─────────────

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
                      "sources": m.get("health_sources") if isinstance(m.get("health_sources"), list) else []})
    return hosts, meta


LEVEL_RANK = {"ok": 0, "na": 0, "warn": 1, "crit": 2, "down": 3}
LEVEL_LABEL = {"ok": "OK", "warn": "WARN", "crit": "CRIT", "down": "INJOIGNABLE", "na": "N/A"}


def worst(*levels: str) -> str:
    return max(levels, key=lambda l: LEVEL_RANK[l])

# ───────────── Exécution locale / distante ─────────────

def make_runner(host: dict):
    """Retourne run(cmd, timeout) -> (rc, stdout) local ou via SSH selon host['mode']."""
    if host["mode"] == "local":
        def run(cmd: str, timeout: int = 15) -> tuple[int, str]:
            try:
                r = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=timeout)
            except subprocess.TimeoutExpired:
                return 124, f"timeout après {timeout}s"
            except Exception as e:
                return 1, str(e)
            return (0, r.stdout) if r.returncode == 0 else (r.returncode, (r.stdout + r.stderr).strip())
    else:
        target = host["target"]

        def run(cmd: str, timeout: int = 15) -> tuple[int, str]:
            # Repère avant la commande : un bandeau d'accueil (fastfetch, motd dans ~/.bashrc) précède sinon la sortie
            marked = host.get("os") != "windows"  # PowerShell n'a pas printf : Windows garde sa commande telle quelle
            full = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", target, f"printf '%s\\n' {SSH_MARK}; {cmd}" if marked else cmd]
            try:
                r = subprocess.run(full, capture_output=True, text=True, timeout=timeout)
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
KERNEL_CMD = "journalctl -k -p err --since '-24h' --no-pager 2>/dev/null | tail -n 50"
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


def collect_docker(run) -> dict:
    """Best effort : gracieux si pas d'accès au socket docker (retourne accessible: False)."""
    rc, out = run(DOCKER_PS_CMD, timeout=10)
    if rc != 0 or "permission denied" in out.lower() or "cannot connect" in out.lower():
        return {"accessible": False, "reason": out.strip()[:120]}
    containers, stopped = [], []
    healthy = unhealthy = restarting = exited = 0
    for ln in out.strip().splitlines():
        cols = ln.split("|", 2)
        if len(cols) < 3:
            continue
        name, status, image = cols
        # Arrêt voulu : jamais démarré (Created) ou arrêté proprement (docker stop / compose down :
        # code 0, 143 SIGTERM, 137 SIGKILL après délai). Pas une panne, affiché à part.
        if status.startswith("Created") or re.match(r"Exited \((0|137|143)\)", status):
            stopped.append({"name": name, "status": status, "image": image})
            continue
        if "Restarting" in status:
            restarting += 1
        elif "Exited" in status or "Dead" in status:
            exited += 1
        elif "unhealthy" in status.lower():
            unhealthy += 1
        else:
            healthy += 1
        containers.append({"name": name, "status": status, "image": image})
    issues = [c for c in containers if "Exited" in c["status"] or "Restarting" in c["status"]
              or "unhealthy" in c["status"].lower()]

    # Stats CPU/mem : un seul échantillon, pour repérer les conteneurs gourmands.
    cstats = []
    rc2, out2 = run(DOCKER_STATS_CMD, timeout=25)
    if rc2 == 0:
        for ln in out2.strip().splitlines():
            cols = ln.split("|")
            if len(cols) < 4:
                continue
            try:
                cpu_v = float(cols[1].rstrip("%").replace(",", "."))
            except ValueError:
                cpu_v = 0.0
            try:
                mem_v = float(cols[3].rstrip("%").replace(",", "."))
            except ValueError:
                mem_v = 0.0
            cstats.append({"name": cols[0], "cpu": cpu_v, "mem_usage": cols[2].strip(), "mem_pct": mem_v})
    cstats.sort(key=lambda c: c["cpu"], reverse=True)
    total_cpu = round(sum(c["cpu"] for c in cstats), 1)
    avg_cpu = round(total_cpu / len(cstats), 1) if cstats else 0.0

    return {
        "accessible": True, "total": len(containers),  # hors conteneurs arrêtés volontairement
        "stopped": len(stopped), "stopped_list": stopped[:10],
        "healthy": healthy, "unhealthy": unhealthy, "restarting": restarting, "exited": exited,
        "issues": issues[:10],
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
    seen = set()
    for dev in out.strip().splitlines():
        dev = dev.strip()
        if not dev:
            continue
        m = re.match(r"^(nvme\d+)n\d+$", dev)
        target = m.group(1) if m else dev
        if target in seen:
            continue
        seen.add(target)
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

# ───────────── Windows (OpenSSH Server + PowerShell) ─────────────

# Un seul script, en lecture. Erreurs ignorées une à une : un contrôle refusé ne masque pas les autres.
# 4625 (échecs de connexion) : journal Sécurité, administrateurs seulement ; -1 = non lisible.
# MSV_UPD (agent) : titres de la dernière recherche Windows Update, réutilisés pour ne la refaire qu'une fois par heure.
# Matériel (lecture seule, sans droits particuliers) : m=fabricant, mo=modèle, bios, cpu, cc/cl=cœurs physiques/logiques, ram=Go,
# gpu=[{n=nom, r=résolution}], net=[{n=carte, ip=IPv4}] (jamais d'adresse MAC), dom=domaine ou groupe de travail, wu=dernière mise à jour installée.
WIN_PS = r"""
$ErrorActionPreference='SilentlyContinue';$ProgressPreference='SilentlyContinue';$o=@{};$t=(Get-Date).AddHours(-24)
$o.disks=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3'|%{@{m=$_.DeviceID;s=[double]$_.Size;f=[double]$_.FreeSpace}})
$o.svc=@(Get-CimInstance Win32_Service -Filter "StartMode='Auto' AND State<>'Running'"|?{$_.ExitCode -ne 0}|%{@{n=$_.Name;d=$_.DisplayName;e=$_.ExitCode}})
$p=@(Get-CimInstance Win32_Processor);$o.cpu=($p|Measure-Object LoadPercentage -Average).Average;$o.ncpu=($p|Measure-Object NumberOfLogicalProcessors -Sum).Sum
$w=Get-CimInstance Win32_OperatingSystem;$o.boot=$w.LastBootUpTime.ToUniversalTime().ToString('o');if($w.TotalVisibleMemorySize){$o.mem=[math]::Round(100*($w.TotalVisibleMemorySize-$w.FreePhysicalMemory)/$w.TotalVisibleMemorySize,1)}
$o.os=@{n=$w.Caption;v=$w.Version;b=$w.BuildNumber;h=$env:COMPUTERNAME}
$pm=@{};Get-Process|%{$pm[[int]$_.Id]=$_.ProcessName};$o.ports=@(Get-NetTCPConnection -State Listen|Select-Object -First 400|%{@{p=[int]$_.LocalPort;a=[string]$_.LocalAddress;n=$pm[[int]$_.OwningProcess]}})
$k='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion';$o.reboot=(Test-Path "$k\WindowsUpdate\Auto Update\RebootRequired") -or (Test-Path "$k\Component Based Servicing\RebootPending")
$o.pd=@(Get-PhysicalDisk|%{@{n=$_.FriendlyName;h=[string]$_.HealthStatus}})
$o.ev=@(Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=$t} -MaxEvents 300|?{$_.Level -eq 1 -or $_.ProviderName -match 'disk|Ntfs|volmgr|stor|WHEA'}|Select-Object -First 8|%{'{0} {1} {2}' -f $_.TimeCreated.ToString('dd/MM HH:mm'),$_.ProviderName,(($_.Message -split "`n")[0]).Trim()})
try{$o.fail=@(Get-WinEvent -FilterHashtable @{LogName='Security';Id=4625;StartTime=$t} -ErrorAction Stop).Count}catch{$o.fail=$(if($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*'){0}else{-1})}
if($env:MSV_UPD){$o.upd=@($env:MSV_UPD|ConvertFrom-Json)}else{try{$r=(New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0 and Type='Software'");$o.upd=@($r.Updates|%{$_.Title})}catch{$o.upd=$null}}
$h=@{};try{$cs=Get-CimInstance Win32_ComputerSystem;$h.m=[string]$cs.Manufacturer;$h.mo=[string]$cs.Model;$h.ram=[math]::Round($cs.TotalPhysicalMemory/1GB,1);$h.dom=$(if($cs.PartOfDomain){[string]$cs.Domain}else{'WORKGROUP: '+$cs.Workgroup})}catch{}
try{$h.bios=[string](Get-CimInstance Win32_BIOS|Select-Object -First 1).SMBIOSBIOSVersion}catch{}
try{$h.cpu=[string]($p|Select-Object -First 1).Name;$h.cc=($p|Measure-Object NumberOfCores -Sum).Sum;$h.cl=$o.ncpu}catch{}
try{$h.gpu=@(Get-CimInstance Win32_VideoController|?{$_.Name}|Select-Object -First 4|%{@{n=[string]$_.Name;r=$(if($_.CurrentHorizontalResolution){'{0}x{1}' -f $_.CurrentHorizontalResolution,$_.CurrentVerticalResolution}else{''})}})}catch{}
try{$h.net=@(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True'|?{$_.IPAddress}|Select-Object -First 8|%{$d=$_.Description;@($_.IPAddress|?{$_ -match '^\d+\.\d+\.\d+\.\d+$'}|%{@{n=[string]$d;ip=[string]$_}})})}catch{}
try{$q=Get-HotFix|Where-Object{$_.InstalledOn}|Sort-Object InstalledOn -Descending|Select-Object -First 1;if($q){$h.wu=$q.InstalledOn.ToString('yyyy-MM-dd')}}catch{}
try{$o.sv=@(Get-CimInstance Win32_Service -Filter "State='Running'"|Select-Object -First 300|%{@{n=[string]$_.Name;d=[string]$_.DisplayName}})}catch{}
try{if(Get-Command docker.exe -ErrorAction Stop){$l=@(& docker.exe ps -a --format '{{.Names}}|{{.Image}}|{{.Ports}}|{{.Status}}|{{.Networks}}' 2>$null);if($LASTEXITCODE -eq 0){$o.dk=@($l|Select-Object -First 200|%{[string]$_})}}}catch{}
try{if(Get-Command Get-VM -ErrorAction Stop){$o.hv=@(Get-VM|Select-Object -First 200|%{@{n=[string]$_.Name;s=[string]$_.State;c=[int]$_.ProcessorCount;m=[double]$_.MemoryAssigned;x=[double]$_.MemoryStartup;u=[int]$_.Uptime.TotalSeconds}})}}catch{}
$ev={param($l,$f)try{Get-WinEvent -FilterHashtable @{LogName=$l} -MaxEvents 50 -ErrorAction Stop|?{& $f $_}|Select-Object -First 1|%{@{t=$_.TimeCreated.ToUniversalTime().ToString('o');i=$_.Id;l=$_.Level;m=(($_.Message -split "`n")[0]).Trim()}}}catch{}}
$o.va=& $ev 'Veeam Agent' {param($e)$e.Id -eq 190}
$o.wb=& $ev 'Microsoft-Windows-Backup' {param($e)$e.Id -eq 4 -or $e.Level -le 2}
$o.hw=$h
ConvertTo-Json -InputObject $o -Depth 5 -Compress
"""


def ps_command(script: str) -> str:
    """powershell -EncodedCommand : aucun guillemet à protéger, que le shell OpenSSH soit cmd ou PowerShell."""
    return "powershell -NoProfile -NonInteractive -EncodedCommand " + base64.b64encode(script.encode("utf-16-le")).decode()


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
                   if _txt(n, "n") and re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", _txt(n, "ip") or "")]}
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


def collect_windows(host: dict) -> dict:
    run = make_runner(host)
    rc, out = run(ps_command(WIN_PS), timeout=180)  # la recherche Windows Update peut prendre une minute
    base = {"id": host["id"], "name": host["name"], "os": "windows"}
    try:
        raw = json.loads(out.strip().lstrip("\ufeff")) if rc == 0 else None
    except ValueError:
        raw = None
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


def parse_agent_data(hc: dict, data: dict) -> dict:
    """Champs de santé lus dans le relevé d'un agent, Linux (sorties rejouées) ou Windows (PowerShell)."""
    if data.get("kind") == "linux":
        return collect_linux(hc, replay_runner(data.get("cmds")))
    return parse_windows(data)


# ───────────── Fusion des sources (SSH, agent, Beszel) ─────────────

SOURCES = ("ssh", "agent", "beszel", "ha")   # ha : l'API d'un connecteur (Home Assistant : capteurs de la machine hôte)


def source_order(hc: dict) -> list[str]:
    """Priorité de lecture de la santé d'une machine : « health_sources » de services-meta, puis l'ordre par défaut pour
    les sources non citées. Par défaut SSH, agent, Beszel ; Windows : agent d'abord (c'est son accès recommandé)."""
    default = ["agent", "ssh", "beszel", "ha"] if hc.get("os") == "windows" else ["ssh", "agent", "beszel", "ha"]
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
    for name in source_order(hc):
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
    for name in source_order(hc):
        if name == primary["source"]:
            continue
        if name == "agent" and agent and agent["fresh"] and isinstance((agent["report"] or {}).get("data"), dict):
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
    devs = sys_.get("smart") or []
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


def api_systems(meta: dict) -> dict:
    """{IP: système au format Beszel} des machines lues par l'API d'un service relié : Glances ou Netdata (sur la machine même), puis
    Home Assistant (capteurs System Monitor / Supervisor de la machine hôte)."""
    import connectors
    import connectors.base as cbase
    from api_link import host_ip
    try:
        conns = sorted((c for c in connectors.instances(CFG, kind="status") if c.type in ("glances", "netdata", "home-assistant")), key=lambda c: c.type == "home-assistant")
    except connectors.ConnectorError:
        return {}
    machines, found = meta.get("machines", {}), {}
    state = cbase.load_state(Path(CFG["state_dir"]) / "connectors.json")
    for c in conns:
        data = cbase.recent(c, state, API_REUSE_S)   # read by the collection a moment ago: no second call for the same data
        if data is None:
            data, st = cbase.run_isolated(c, state, 60)
            if not (st.ok or st.stale):
                continue
        host = (data or {}).get("host")
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
    state_path = Path(CFG["state_dir"]) / "connectors.json"
    state, found, statuses = cbase.load_state(state_path), {}, []
    for c in conns:
        data, st = cbase.run_isolated(c, state, 120)
        statuses.append(st)
        print(("✓" if st.ok else "⚠") + f" {c.label} {c.name} : {st.message}" + (" (dernier relevé bon réutilisé)" if st.stale else ""))
        for ip, s in match((data or {}).get("systems", []), meta.get("machines", {})).items():
            found.setdefault(ip, s)
    cbase.save_state(state_path, state)
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
    n = docker.get("unhealthy", 0) + docker.get("restarting", 0) + docker.get("exited", 0)
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


def host_level(h: dict) -> str:
    """Pire niveau des contrôles d'une machine joignable (Linux ou Windows)."""
    return worst(disk_level(h["disks"]), systemd_level(h["systemd"]), docker_level(h["docker"]),
                 kernel_level(h["kernel"]), load_level(h["load"]), ssh_auth_level(h["ssh_auth"]),
                 smart_level(h["smart"]), temp_level(h.get("temp")), resources_level(h.get("res")))


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
    rc, _ = run("echo ok", timeout=6)
    if rc != 0:
        return {"id": host["id"], "name": host["name"], "reachable": False,
                "disks": [], "systemd": {"failed": []}, "docker": {"accessible": False},
                "level": "down", **_EMPTY_HOST_EXTRAS}
    rc, esxi = run("vmware -v 2>/dev/null", timeout=6)
    if rc == 0 and esxi.startswith("VMware ESXi"):
        # ESXi: no apt, systemd nor Docker; its VMs and datastores are read by the collection (esxi_ssh.py, Virtualization tab)
        return {"id": host["id"], "name": host["name"], "reachable": True, "os": "esxi", "esxi": esxi.strip()[:80],
                "disks": [], "systemd": {"failed": []}, "docker": {"accessible": False, "reason": "esxi"}, "level": "ok", **_EMPTY_HOST_EXTRAS}
    return collect_linux(host, run)


# Commands the Linux agent runs on its own machine (the SSH collectors' commands, fixed); smart_cmd(<disk>) is added per disk it finds.
LINUX_AGENT_COMMANDS = [DISKS_CMD, SYSTEMD_CMD, DOCKER_PS_CMD, DOCKER_STATS_CMD, APT_CMD, KERNEL_CMD, REBOOT_CMD, LOAD_CMD,
                        _RES_CMD, _TEMP_CMD, VIRT_CMD, SSH_AUTH_CMD, SMART_LIST_CMD]


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
    docker = collect_docker(run)
    apt = collect_apt(run)
    kernel = collect_kernel_errors(run)
    reboot_required = collect_reboot_required(run)
    load = collect_load(run)
    ssh_auth = collect_ssh_auth(run)
    temp = collect_cpu_temp(run, bool(host.get("vm")))
    res = collect_resources(run)
    # SMART non pertinent sur une VM (disque virtualisé, pas de hardware physique dédié)
    smart = {"accessible": False, "disks": [], "vm": True} if host.get("vm") else collect_smart(run)
    h = {"id": host["id"], "name": host["name"], "reachable": True,
         "disks": disks, "systemd": systemd, "docker": docker, "apt": apt, "kernel": kernel,
         "reboot_required": reboot_required, "load": load, "ssh_auth": ssh_auth, "smart": smart, "temp": temp, "res": res}
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
        kernel_block = ("<div class='muted'>✅ Aucune erreur critique ou disque (journal Système, 24h)</div>"
                        if h.get("os") == "windows" else "<div class='muted'>✅ Aucune erreur kernel (24h)</div>")

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

EVENT_LABELS = {"health_ok": "🩺 Santé OK", "health_warn": "🩺 Santé WARN",
                "health_crit": "🩺 Santé CRIT", "health_down": "🩺 Machine injoignable (health)"}
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

def main() -> int:
    dry = "--dry-run" in sys.argv
    ts = datetime.now(timezone.utc).isoformat()

    if OUT_DIR.is_symlink():  # health_url branché sur un health-watcher externe : ne jamais écrire dedans
        sys.exit(f"{OUT_DIR} est un lien (health externe) : health.py ne tourne pas")
    hosts = []
    agents = agent_reports()
    candidates, meta = load_hosts(set(agents))
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv[:-1] else None  # une seule machine (IP) : les autres gardent leur dernier relevé
    previous, previous_asleep = [], []
    if only:
        try:
            last = json.loads(STATS_JSON.read_text(encoding="utf-8"))
            previous, previous_asleep = last.get("hosts", []), last.get("asleep", [])
        except (OSError, ValueError):
            pass
        candidates = [hc for hc in candidates if hc["ip"] == only]
    asleep = []
    apis = api_systems(meta)
    besz, _ = beszel_systems(meta) if (not only or any(hc["target"] is None or "beszel" in source_order(hc) for hc in candidates)) else ({}, [])
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
        hosts.append(h)

    if only:  # relevé d'une machine : elle remplace son ancienne ligne (ou s'ajoute), les autres restent telles quelles
        fresh = {h["id"] for h in hosts} | {a["id"] for a in asleep}
        hosts = [h for h in previous if h["id"] not in fresh] + hosts
        asleep += [a for a in previous_asleep if a["id"] not in fresh]
    overall = worst(*(h["level"] for h in hosts))
    stats = {"timestamp": ts, "hosts": hosts, "asleep": asleep, "overall_level": overall}
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
