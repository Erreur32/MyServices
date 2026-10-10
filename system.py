"""Réglages → Système (version Docker) : clé SSH de l'app, tâches et horaires, export de /config, informations.

Horaires : écrits dans « schedule » de config.json et appliqués tout de suite au planificateur (server.TASKS) ;
une tâche fixée par MYSERVICES_<TÂCHE>_AT n'est pas modifiable ici. Export : archive tar.gz de /config
(configs, secrets chiffrés et leur clé, clés et alias SSH) en mémoire, jamais écrite sur le disque.
"""
from __future__ import annotations

import io
import json
import os
import platform
import subprocess
import tarfile
import time
from pathlib import Path

import secrets_store

STARTED = time.time()
LABELS = {"collect": "Collecte", "watch": "Veille (pannes, alertes)", "health": "Santé des machines", "backups": "Sauvegardes"}


def _size(p: Path) -> int:
    try:
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.is_dir() else p.stat().st_size
    except OSError:
        return 0


def ssh_key(core) -> dict:
    pub = core.KEY.with_suffix(".pub")
    try:
        text = pub.read_text(encoding="utf-8").strip()
    except OSError:
        return {"public": None}
    fp = subprocess.run(["ssh-keygen", "-lf", str(pub)], capture_output=True, text=True).stdout.split()
    known = core.SSH_DIR / "known_hosts"
    try:
        hosts = sum(1 for ln in known.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#"))
    except OSError:
        hosts = 0
    return {"public": text, "fingerprint": fp[1] if len(fp) > 1 else None, "known_hosts": hosts,
            "authorize": f"echo '{text}' >> ~/.ssh/authorized_keys"}


def tasks(core) -> list[dict]:
    out = []
    for name, t in core.TASKS.items():
        out.append({"name": name, "label": LABELS.get(name, name), "at": t["at"], "fixed": t["fixed"],
                    "enabled": core.enabled(name), "running": t["proc"] is not None, "started": t["start"],
                    "ended": t["end"], "result": t["result"], "timeout_s": t["timeout"],
                    "default": core.DEFAULTS_AT[name][1]})
    return out


def _update_config(core, change) -> None:
    """Relit config.json, y applique `change(raw)` et le réécrit (secrets rechiffrés, droits 600, remplacement atomique)."""
    f = Path(os.environ.get("MYSERVICES_CONFIG") or Path(core.HERE) / "config.json")
    raw = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    change(raw)
    out, _ = secrets_store.encrypt_all(raw, f) if secrets_store.key_path(f).exists() else (raw, 0)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(f)


NETSCAN_DEFAULT_H, NETSCAN_MAX_H = 6, 168


def netscan_settings(core) -> dict:
    """Recherche réseau automatique : toutes les `every_h` heures (0 = coupée) ; `fixed` si MYSERVICES_NETSCAN_EVERY l'impose."""
    return {"every_h": core.CFG["netscan_every"], "default_h": NETSCAN_DEFAULT_H, "max_h": NETSCAN_MAX_H,
            "fixed": "MYSERVICES_NETSCAN_EVERY" in os.environ,
            "nets": core.CFG["netscan_nets"], "ignored": core.CFG["netscan_ignored"], "discreet": core.CFG["netscan_discreet"]}


def set_netscan_every(core, hours: int) -> dict:
    """Nouvelle fréquence (0 à 168 h), écrite dans config.json et appliquée au prochain passage du planificateur."""
    if "MYSERVICES_NETSCAN_EVERY" in os.environ:
        raise ValueError("fréquence fixée par MYSERVICES_NETSCAN_EVERY (environnement du conteneur)")
    if not 0 <= hours <= NETSCAN_MAX_H:
        raise ValueError(f"entre 0 (coupée) et {NETSCAN_MAX_H} heures")

    def change(raw: dict) -> None:
        if hours == NETSCAN_DEFAULT_H:
            raw.pop("netscan_every", None)
        else:
            raw["netscan_every"] = hours
    _update_config(core, change)
    core.CFG["netscan_every"] = hours
    return netscan_settings(core)


def set_netscan_nets(core, nets: list[str]) -> dict:
    """Réseaux de la recherche (CIDR, chacun un /24 au plus, 8 au plus) ; liste vide = réseau de l'hôte."""
    import ipaddress
    clean = []
    for n in nets:
        try:
            net = ipaddress.ip_network(n.strip(), strict=False)
        except ValueError:
            raise ValueError(f"« {n} » n'est pas un réseau (ex. 192.168.1.0/24)") from None
        if net.version != 4 or net.num_addresses > 256:
            raise ValueError(f"« {n} » : un réseau IPv4 de /24 au plus")
        if str(net) not in clean:
            clean.append(str(net))
    if len(clean) > 8:
        raise ValueError("8 réseaux au plus")

    def change(raw: dict) -> None:
        if clean:
            raw["netscan_nets"] = clean
        else:
            raw.pop("netscan_nets", None)
    _update_config(core, change)
    core.CFG["netscan_nets"] = clean
    return netscan_settings(core)


def set_netscan_ignored(core, ip: str, name: str = "", ignore: bool = True) -> dict:
    """Ajoute (ignore) ou retire (ignore=False) un appareil de la liste de ceux que la recherche ne propose plus."""
    import ipaddress
    try:
        ip = str(ipaddress.IPv4Address(ip.strip()))
    except ValueError:
        raise ValueError(f"« {ip} » n'est pas une adresse IPv4") from None
    kept = [e for e in core.CFG["netscan_ignored"] if e["ip"] != ip]
    if ignore:
        if len(kept) >= 500:
            raise ValueError("500 appareils ignorés au plus")
        kept.append({"ip": ip, "name": name.strip()[:60]})

    def change(raw: dict) -> None:
        if kept:
            raw["netscan_ignored"] = kept
        else:
            raw.pop("netscan_ignored", None)
    _update_config(core, change)
    core.CFG["netscan_ignored"] = kept
    return netscan_settings(core)


def set_netscan_discreet(core, on: bool) -> dict:
    """Mode discret : la recherche ne lit ni le TTL ni l'adresse MAC."""
    def change(raw: dict) -> None:
        if on:
            raw["netscan_discreet"] = True
        else:
            raw.pop("netscan_discreet", None)
    _update_config(core, change)
    core.CFG["netscan_discreet"] = on
    return netscan_settings(core)


def set_schedule(core, name: str, spec: str | None) -> dict:
    """Nouvel horaire (None ou vide = défaut), écrit dans config.json et appliqué aussitôt."""
    if name not in core.TASKS:
        raise ValueError("tâche inconnue")
    t = core.TASKS[name]
    if t["fixed"]:
        raise ValueError(f"horaire fixé par MYSERVICES_{name.upper()}_AT (environnement du conteneur)")
    spec = (spec or "").strip() or core.DEFAULTS_AT[name][1]
    mins, hrs = core.parse_at(spec)
    def change(raw: dict) -> None:
        sched = dict(raw.get("schedule") or {})
        if spec == core.DEFAULTS_AT[name][1]:
            sched.pop(name, None)
        else:
            sched[name] = spec
        raw["schedule"] = sched
        if not sched:
            raw.pop("schedule")
    _update_config(core, change)
    with core.LOCK:
        t.update(minutes=mins, hours=hrs, at=spec)
    return {"name": name, "at": spec}


def info(core, api) -> dict:
    data = Path(core.WEB).parent
    from auth import db_path
    return {"version": os.environ.get("MYSERVICES_VERSION", "dev"), "python": platform.python_version(),
            "started": STARTED, "uptime_s": int(time.time() - STARTED), "port": core.PORT,
            "allow": [str(n) for n in core.ALLOW], "auth": api.AUTH,
            "cookie_secure": os.environ.get("MYSERVICES_COOKIE_SECURE") == "1",
            "docker": os.environ.get("MYSERVICES_DOCKER") == "1",
            "sizes": {"data": _size(data), "db": _size(Path(db_path(core.CFG))), "config": _size(api_config_dir())},
            "paths": {"config": str(api_config_dir()), "data": str(data)}}


def api_config_dir() -> Path:
    return Path(os.environ.get("MYSERVICES_CONFIG", "/config/config.json")).parent


def export_config() -> bytes:
    """Archive tar.gz de /config (secrets compris), construite en mémoire."""
    root = api_config_dir()
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for f in sorted(root.rglob("*")):
            if f.is_file() and not f.name.endswith((".tmp", ".lock")):
                tar.add(f, arcname=f"config/{f.relative_to(root)}")
    return buf.getvalue()
