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


def set_schedule(core, name: str, spec: str | None) -> dict:
    """Nouvel horaire (None ou vide = défaut), écrit dans config.json et appliqué aussitôt."""
    if name not in core.TASKS:
        raise ValueError("tâche inconnue")
    t = core.TASKS[name]
    if t["fixed"]:
        raise ValueError(f"horaire fixé par MYSERVICES_{name.upper()}_AT (environnement du conteneur)")
    spec = (spec or "").strip() or core.DEFAULTS_AT[name][1]
    mins, hrs = core.parse_at(spec)
    f = Path(os.environ.get("MYSERVICES_CONFIG") or Path(core.HERE) / "config.json")
    raw = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    sched = dict(raw.get("schedule") or {})
    if spec == core.DEFAULTS_AT[name][1]:
        sched.pop(name, None)
    else:
        sched[name] = spec
    raw["schedule"] = sched
    if not sched:
        raw.pop("schedule")
    out, _ = secrets_store.encrypt_all(raw, f) if secrets_store.key_path(f).exists() else (raw, 0)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(f)
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
