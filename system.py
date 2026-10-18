"""Réglages → Système (version Docker) : clé SSH de l'app, tâches et horaires, export de /config, informations.

Horaires : écrits dans « schedule » de config.json et appliqués tout de suite au planificateur (server.TASKS) ;
une tâche fixée par MYSERVICES_<TÂCHE>_AT n'est pas modifiable ici. Export : archive tar.gz de /config
(configs, secrets chiffrés et leur clé, clés et alias SSH) en mémoire, jamais écrite sur le disque.
"""
from __future__ import annotations

import json
import os
import platform
import subprocess
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
    try:   # ECDSA key, the one VMware ESXi accepts (its sshd in FIPS mode refuses ed25519)
        esxi = core.KEY.with_name(core.KEY.name + "_ecdsa.pub").read_text(encoding="utf-8").strip()
    except OSError:
        esxi = None
    return {"public": text, "fingerprint": fp[1] if len(fp) > 1 else None, "known_hosts": hosts,
            "authorize": f"echo '{text}' >> ~/.ssh/authorized_keys", "public_esxi": esxi}


def tasks(core) -> list[dict]:
    out = []
    for name, t in core.TASKS.items():
        out.append({"name": name, "label": LABELS.get(name, name), "at": t["at"], "fixed": t["fixed"],
                    "enabled": core.enabled(name), "running": t["proc"] is not None, "started": t["start"],
                    "ended": t["end"], "result": t["result"], "timeout_s": t["timeout"],
                    "default": core.DEFAULTS_AT[name][1], "next": core.next_run(name), **_why_off(core, name)})
    return out


def _why_off(core, name: str) -> dict:
    """Pourquoi une tâche est coupée et comment l'allumer : `switch` = interrupteur proposé dans la page, `why` = explication."""
    if core.enabled(name):
        return {"switch": name == "health", "why": None}
    if name == "health":
        ext = core.CFG["health_url"] not in ("", "health/")
        return {"switch": not ext, "why": ("Santé lue par un health-watcher externe (health_url dans config.json) : rien à faire ici."
                                           if ext else "Coupée. Allumez-la pour lire disque, services, mises à jour et SMART des machines en SSH.")}
    if name == "backups":
        return {"switch": False, "why": "Pas d'inventaire de sauvegardes (backups-meta.json) : rien à surveiller pour l'instant."}
    return {"switch": False, "why": "Aucune machine déclarée : la tâche démarre dès qu'il y en a une."}


def set_backups_url(core, url: str) -> None:
    """Active l'onglet Sauvegardes (backups_url = « backups.json », fichier de backups.py) dans config.json, appliqué aussitôt."""
    def change(raw: dict) -> None:
        raw["backups_url"] = url
    _update_config(core, change)
    core.CFG["backups_url"] = url


def set_health(core, on: bool) -> dict:
    """Allume ou coupe la santé intégrée (health_url = « health/ »), écrite dans config.json et appliquée aussitôt."""
    if core.CFG["health_url"] not in ("", "health/"):
        raise ValueError("santé branchée sur un health-watcher externe (health_url) : à changer dans config.json")

    def change(raw: dict) -> None:
        if on:
            raw["health_url"] = "health/"
        else:
            raw.pop("health_url", None)
    _update_config(core, change)
    core.CFG["health_url"] = "health/" if on else ""
    return {"enabled": on}


def _update_config(core, change, secret: bool = False) -> None:
    """Relit config.json, y applique `change(raw)` et le réécrit (secrets rechiffrés, droits 600, remplacement atomique).
    secret : a secret is written, encrypted even when no key exists yet (it is created)."""
    f = Path(os.environ.get("MYSERVICES_CONFIG") or Path(core.HERE) / "config.json")
    raw = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    change(raw)
    out, _ = secrets_store.encrypt_all(raw, f) if secret or secrets_store.key_path(f).exists() else (raw, 0)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
    tmp.chmod(0o600)
    tmp.replace(f)


# Live checks: (lowest, highest) of each setting; 0 = off is also accepted where listed in LIVE_OFF
LIVE_LIMITS = {"pulse_every": (10, 600), "pulse_confirm": (1, 5), "fast_every": (60, 3600)}
LIVE_OFF = ("pulse_every", "fast_every")


def live_settings(core) -> dict:
    """Pulse (ping of every machine), its confirmation and the fast connector reads: current values, defaults and limits."""
    from config import DEFAULTS
    return {"values": {k: core.CFG[k] for k in LIVE_LIMITS}, "defaults": {k: DEFAULTS[k] for k in LIVE_LIMITS},
            "limits": {k: list(v) for k, v in LIVE_LIMITS.items()}, "off_allowed": list(LIVE_OFF)}


def set_live(core, values: dict) -> dict:
    """Writes the given live-check settings to config.json, applied at the next pass of each loop (no restart)."""
    from config import DEFAULTS
    clean = {}
    for k, v in values.items():
        lo, hi = LIVE_LIMITS[k]
        if isinstance(v, bool) or not isinstance(v, int) or not (lo <= v <= hi or (v == 0 and k in LIVE_OFF)):
            raise ValueError(f"{k} : entre {lo} et {hi}" + (", ou 0 pour couper" if k in LIVE_OFF else ""))
        clean[k] = v

    def change(raw: dict) -> None:
        for k, v in clean.items():
            if v == DEFAULTS[k]:
                raw.pop(k, None)
            else:
                raw[k] = v
    _update_config(core, change)
    core.CFG.update(clean)
    return live_settings(core)


NETSCAN_DEFAULT_H, NETSCAN_MAX_H = 6, 168


def netscan_settings(core) -> dict:
    """Recherche réseau automatique : toutes les `every_h` heures (0 = coupée) ; `fixed` si MYSERVICES_NETSCAN_EVERY l'impose."""
    return {"every_h": core.CFG["netscan_every"], "default_h": NETSCAN_DEFAULT_H, "max_h": NETSCAN_MAX_H,
            "fixed": "MYSERVICES_NETSCAN_EVERY" in os.environ,
            "nets": core.CFG["netscan_nets"], "ignored": core.CFG["netscan_ignored"], "discreet": core.CFG["netscan_discreet"],
            "auto": core.CFG.get("auto_mode", True)}


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


def set_session_days(core, days: int) -> int:
    """Durée des sessions (1 à 90 jours), écrite dans config.json et appliquée aux prochaines connexions."""
    import auth
    auth.set_session_days(days)  # refuse hors bornes (AuthError)

    def change(raw: dict) -> None:
        if days == 14:
            raw.pop("session_days", None)
        else:
            raw["session_days"] = days
    _update_config(core, change)
    core.CFG["session_days"] = days
    return days


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


def set_discovery_muted(core, did: str, muted: bool) -> list[str]:
    """Coupe (muted) ou rétablit le rappel d'une découverte « à faire » : elle reste listée, mais ne compte plus dans la cloche ni sur l'accueil."""
    did = did.strip()
    if not did or len(did) > 120:
        raise ValueError("identifiant de découverte invalide")
    same = {did}   # a machine access has two names (ssh:, access:): recalling it removes both
    if did.startswith("ssh:"):
        same.add("access:" + did[4:])
    elif did.startswith("access:"):
        same.add("ssh:" + did[7:])
    kept = [d for d in core.CFG.get("discoveries_muted") or [] if d not in same]   # recall: both names of a machine access go
    if muted:
        if len(kept) >= 200:
            raise ValueError("200 rappels coupés au plus")
        kept.append(did)

    def change(raw: dict) -> None:
        if kept:
            raw["discoveries_muted"] = kept
        else:
            raw.pop("discoveries_muted", None)
    _update_config(core, change)
    core.CFG["discoveries_muted"] = kept
    return kept


def set_diagram_extra(core, key: str, on: bool) -> list[str]:
    """Demande (on) ou retire un schéma proposé : la liste est gardée dans config.json (« diagrams_extra »)."""
    from archify_extra import CATALOG
    if key not in CATALOG:
        raise ValueError("schéma inconnu")
    kept = [k for k in core.CFG.get("diagrams_extra") or [] if k != key]
    if on:
        kept.append(key)

    def change(raw: dict) -> None:
        if kept:
            raw["diagrams_extra"] = kept
        else:
            raw.pop("diagrams_extra", None)
    _update_config(core, change)
    core.CFG["diagrams_extra"] = kept
    return kept


def set_update_settings(core, auto: bool | None = None, header: bool | None = None) -> dict:
    """Settings → Updates: the automatic check (update_check, every 6 h by the scheduler) and the notice in the header (update_header)."""
    def change(raw: dict) -> None:
        for key, val in (("update_check", auto), ("update_header", header)):
            if val is None:
                continue
            if val:
                raw.pop(key, None)   # on is the default
            else:
                raw[key] = False
    _update_config(core, change)
    if auto is not None:
        core.CFG["update_check"] = auto
    if header is not None:
        core.CFG["update_header"] = header
    return {"auto": bool(core.CFG.get("update_check", True)), "header": bool(core.CFG.get("update_header", True))}


def set_auto_mode(core, on: bool) -> dict:
    """Auto mode (default): found machines added and SSH turned on by themselves. Turning it on also turns back on the automatic
    network search (unless fixed by MYSERVICES_NETSCAN_EVERY) and the /home/backup follow-up; off: nothing is added by itself."""
    fixed = "MYSERVICES_NETSCAN_EVERY" in os.environ

    def change(raw: dict) -> None:
        if on:
            raw.pop("auto_mode", None)
            raw.pop("backups_auto", None)
            if not fixed and raw.get("netscan_every") == 0:
                raw.pop("netscan_every")
        else:
            raw["auto_mode"] = False
    _update_config(core, change)
    core.CFG["auto_mode"] = on
    if on:
        core.CFG["backups_auto"] = True
        if not fixed and not core.CFG["netscan_every"]:
            core.CFG["netscan_every"] = NETSCAN_DEFAULT_H
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


def _host_relay() -> str:
    """Where the host's mail relay (postfix, sendmail…) is reached from here: 127.0.0.1 with the host network (the supplied compose files), else the
    container's default gateway, which is the Docker host."""
    import hostinfo
    from pathlib import Path
    if Path("/sys/class/net/docker0").exists():   # the host's Docker bridge is visible: this container shares the host network
        return "127.0.0.1"
    return hostinfo.default_gateway() or ""


def mail_settings(core) -> dict:
    """Settings → System → E-mail, without the password (only whether it is set)."""
    import mailer
    c = core.CFG
    return {"host": c.get("smtp_host") or "", "port": int(c.get("smtp_port") or 587), "security": c.get("smtp_security") or "starttls",
            "user": c.get("smtp_user") or "", "password_set": bool(c.get("smtp_password")), "from": c.get("smtp_from") or "",
            "page_url": c.get("page_url") or "", "ready": mailer.ready(c), "suggested_host": _host_relay()}


def _check_mail(security: str, port: int, page_url: str, sender: str) -> None:
    import urllib.parse
    import mailer
    if security not in mailer.SECURITY:
        raise ValueError("sécurité : starttls, ssl ou none")
    if not 1 <= int(port) <= 65535:
        raise ValueError("port entre 1 et 65535")
    if page_url and urllib.parse.urlsplit(page_url).scheme not in ("http", "https"):
        raise ValueError("adresse de la page : http://… ou https://…")
    if sender and "@" not in sender:
        raise ValueError("expéditeur : une adresse e-mail")


def set_mail_settings(core, host: str, port: int, security: str, user: str, password: str | None, sender: str, page_url: str) -> dict:
    """Saves the sending server; password None or empty: the saved one is kept, « - » clears it."""
    page_url, sender = page_url.strip().rstrip("/"), sender.strip()
    _check_mail(security, port, page_url, sender)
    vals = {"smtp_host": host.strip(), "smtp_port": int(port), "smtp_security": security, "smtp_user": user.strip(),
            "smtp_from": sender, "page_url": page_url}
    if password:
        vals["smtp_password"] = "" if password == "-" else password
    defaults = {"smtp_port": 587, "smtp_security": "starttls"}

    def change(raw: dict) -> None:
        for k, v in vals.items():
            if v in ("", None) or defaults.get(k) == v:
                raw.pop(k, None)   # default: not written
            else:
                raw[k] = v
    _update_config(core, change, secret=bool(vals.get("smtp_password")))
    core.CFG.update(vals)
    return mail_settings(core)
