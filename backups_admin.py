"""Réglages → Sauvegardes : décrire les sauvegardes à suivre depuis la page, sans écrire backups-meta.json à la main.

  discover()       cherche, par SSH et en lecture seule, les dossiers de sauvegarde habituels de chaque machine
                   (motifs « discover » de backups.py : /home/backup*, /root/*ackup*, /mnt/*/backup*) : rien n'est écrit
  current()        les jeux déjà suivis (backups-meta.json) et l'état de l'onglet
  follow(items)    ajoute un jeu par dossier choisi (nom, âge maximum) et écrit backups-meta.json, autres clés intouchées
  unfollow(id)     retire un jeu

Un « jeu » de sauvegarde = un dossier d'une machine dont le fichier le plus récent ne doit pas dépasser un certain âge.
  veeam_test / veeam_discover / veeam_follow   assistant Veeam B&R : essai de connexion sans rien enregistrer, jobs et dépôts
                   lus par l'API REST (lecture seule), puis compte (connecteur « veeam » de config.json, mot de passe chiffré)
                   et un jeu par job coché
  ha_check / ha_follow   sauvegardes de Home Assistant, lues avec l'adresse et le jeton du connecteur « home-assistant »
                   (déjà réglé dans Connecteurs) : un jeu « sauvegarde automatique » rapproché de l'âge de la dernière réussie

Un « jeu » de sauvegarde = un dossier d'une machine dont le fichier le plus récent ne doit pas dépasser un certain âge ;
pour Veeam, le dernier passage d'un job ; pour Home Assistant, sa dernière sauvegarde automatique réussie.
Les secrets (mot de passe Veeam, jeton HA) ne sont jamais renvoyés à la page ni écrits dans backups-meta.json ni dans un journal.
"""
from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import setup
from connectors import settings
from connectors.backup_apis import HomeAssistant, Veeam
from connectors.base import ConnectorError, Context

AGE_MIN, AGE_MAX = 0.1, 365.0
AGE_DEFAULT = 2.0
LABEL_MAX = 80
DEPTH = 3  # un dossier de sauvegarde range souvent ses archives dans des sous-dossiers datés


VEEAM_NAME = "veeam"  # nom de l'instance « veeam » de config.json (une seule, gérée ici)
VEEAM_HOST, VEEAM_SOURCES = "veeam", "veeam-sources"
HA_HOST, HA_SOURCE, HA_SET = "home-assistant", "home-assistant-source", "home-assistant-sauvegardes"
TEST_TIMEOUT = 20


class BackupError(Exception):
    """Refus lisible (dossier invalide, machine inconnue…)."""


def _path() -> Path:
    import config
    return Path(config.CFG["backups_meta"])


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "x"


def _read() -> dict:
    p = _path()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except ValueError as e:
            raise BackupError(f"{p.name} illisible : {e}") from None
    patterns = []
    try:
        patterns = json.loads(setup.EXAMPLE_BACKUPS.read_text(encoding="utf-8")).get("discover", [])
    except (OSError, ValueError):
        pass
    return {"hosts": [], "sets": [], "discover": patterns, "discover_ignore": {}, "cron_ignore": [], "syncthing": []}


def _write(meta: dict) -> None:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(p)


def _machines() -> dict:
    """Machines de services-meta.json lues par SSH : {ip: {name, ssh}} (les machines non suivies et sans accès sont ignorées)."""
    if not setup.META.exists():
        return {}
    machines = json.loads(setup.META.read_text(encoding="utf-8")).get("machines", {})
    return {ip: {"name": m.get("name") or ip, "ssh": m["ssh"]} for ip, m in machines.items()
            if m.get("ssh") and not m.get("disabled")}


def current() -> dict:
    meta = _read()
    hosts = {h["id"]: h for h in meta.get("hosts", [])}
    sets = []
    for s in meta.get("sets", []):
        loc = (s.get("locations") or [{}])[0]
        sets.append({"id": s["id"], "label": s.get("label", s["id"]), "origin": hosts.get(s.get("origin"), {}).get("label", s.get("origin", "")),
                     "path": loc.get("path"), "veeam_job": loc.get("veeam_job"), "max_age_days": s.get("max_age_days", 8),
                     "ha": any(l.get("ha_backup") for l in s.get("locations", [])),
                     "editable": bool(loc.get("path")) and len(s.get("locations", [])) == 1})
    import config
    return {"sets": sets, "exists": _path().exists(), "tab": bool(config.CFG.get("backups_url")),
            "patterns": meta.get("discover", []), "machines": len(_machines()),
            "veeam": _veeam_state(), "ha": _ha_state(meta)}


def _scan(item: tuple[str, dict], patterns: list[str]) -> dict:
    import backups
    ip, m = item
    req = {"locs": {}, "disks": False, "crons": False, "discover": patterns}
    out, err = backups.run_py(m["ssh"], backups.AGENT, json.dumps(req))
    folders = [{"path": d["path"], "size": d.get("size"), "newest": d.get("newest"), "newest_name": d.get("newest_name", ""),
                "readable": d.get("readable", True)} for d in (out or {}).get("local", [])]
    return {"ip": ip, "name": m["name"], "ssh": m["ssh"], "ok": out is not None, "error": err, "folders": folders}


def discover() -> dict:
    """Dossiers de sauvegarde trouvés sur chaque machine lue par SSH (lecture seule, quelques secondes à une minute)."""
    meta = _read()
    patterns = meta.get("discover") or []
    machines = _machines()
    with ThreadPoolExecutor(max(1, min(8, len(machines)))) as ex:
        found = list(ex.map(lambda it: _scan(it, patterns), machines.items()))
    followed = {(loc.get("host"), loc.get("path")) for s in meta.get("sets", []) for loc in s.get("locations", []) if loc.get("path")}
    hosts = {h.get("ip"): h["id"] for h in meta.get("hosts", [])}
    for m in found:
        for f in m["folders"]:
            f["followed"] = (hosts.get(m["ip"]), f["path"]) in followed
    return {"machines": found, "patterns": patterns, "at": time.time()}


def _check_item(it: dict, machines: dict) -> tuple[str, str, float, str]:
    ip, path, label = str(it.get("ip", "")), str(it.get("path", "")), str(it.get("label", "")).strip()
    if ip not in machines:
        raise BackupError(f"machine {ip or '?'} inconnue ou sans accès SSH")
    if not path.startswith("/") or ".." in path.split("/") or len(path) > 300 or "\n" in path or path == "/":
        raise BackupError(f"dossier invalide : {path or '?'}")
    if not label or len(label) > LABEL_MAX:
        raise BackupError(f"nom : 1 à {LABEL_MAX} caractères")
    try:
        age = float(it.get("max_age_days", AGE_DEFAULT))
    except (TypeError, ValueError):
        raise BackupError("âge maximum : un nombre de jours") from None
    if not AGE_MIN <= age <= AGE_MAX:
        raise BackupError(f"âge maximum : de {AGE_MIN:g} à {AGE_MAX:g} jours")
    return ip, path, age, label


def follow(items: list[dict]) -> dict:
    """Ajoute un jeu par dossier choisi. Un dossier déjà suivi est repris sans doublon (nom et âge mis à jour)."""
    if not items:
        raise BackupError("aucun dossier choisi")
    if len(items) > 50:
        raise BackupError("50 dossiers au plus à la fois")
    machines = _machines()
    meta = _read()
    hosts = {h["id"]: h for h in meta.setdefault("hosts", [])}
    meta.setdefault("sets", [])
    added = updated = 0
    for it in items:
        ip, path, age, label = _check_item(it, machines)
        m = machines[ip]
        hid = next((h["id"] for h in hosts.values() if h.get("ip") == ip and not h.get("api")), None)
        if hid is None:
            hid = _slug(m["name"])
            while hid in hosts:
                hid += "-2"
            hosts[hid] = {"id": hid, "label": m["name"], "ip": ip, "ssh": m["ssh"], "kind": "machine"}
            meta["hosts"].append(hosts[hid])
        elif hosts[hid].get("ssh") != m["ssh"]:
            hosts[hid]["ssh"] = m["ssh"]
        existing = next((s for s in meta["sets"] for loc in s.get("locations", []) if loc.get("host") == hid and loc.get("path") == path), None)
        if existing:
            existing["label"], existing["max_age_days"] = label, age
            updated += 1
            continue
        sid = _slug(f"{m['name']}-{path.rstrip('/').rsplit('/', 1)[-1]}")
        taken = {s["id"] for s in meta["sets"]}
        n, base = 2, sid
        while sid in taken:
            sid, n = f"{base}-{n}", n + 1
        meta["sets"].append({"id": sid, "label": label, "origin": hid, "schedule": "", "max_age_days": age,
                             "locations": [{"host": hid, "path": path, "pattern": "*", "depth": DEPTH, "via": "dossier"}]})
        added += 1
    _write(meta)
    return {"added": added, "updated": updated}


def unfollow(set_id: str) -> None:
    meta = _read()
    keep = [s for s in meta.get("sets", []) if s["id"] != set_id]
    if len(keep) == len(meta.get("sets", [])):
        raise BackupError("jeu inconnu")
    meta["sets"] = keep
    _write(meta)


# ───────────── Veeam Backup & Replication ─────────────

def _veeam_state() -> dict:
    """Compte Veeam enregistré, sans le mot de passe (seulement s'il existe)."""
    c = settings.get("veeam", VEEAM_NAME)
    return {"configured": c is not None, "url": (c or {}).get("url", ""), "user": (c or {}).get("user", ""),
            "password_set": bool((c or {}).get("password"))}


def _veeam_conn(conf: dict) -> Veeam:
    """Connecteur prêt d'après le formulaire (mot de passe vide = celui déjà enregistré). Rien n'est écrit."""
    exists = settings.get("veeam", VEEAM_NAME) is not None
    fields = {k: str(conf.get(k) or "").strip() for k in ("url", "user")} | {"password": str(conf.get("password") or "")}
    if len(fields["user"]) > 200 or len(fields["password"]) > 500:
        raise BackupError("compte ou mot de passe trop long")
    try:
        plain = settings.resolve("veeam", VEEAM_NAME, fields, VEEAM_NAME if exists else None)
    except settings.SettingsError as e:
        raise BackupError(str(e)) from None
    return Veeam(plain, Context(timeout=TEST_TIMEOUT))


def veeam_test(conf: dict) -> dict:
    """Essai de connexion (jeton d'accès, jobs, dépôts) sans rien enregistrer."""
    conn = _veeam_conn(conf)
    try:
        r = conn.test()
    except ConnectorError as e:
        return {"ok": False, "message": str(e)}
    except Exception as e:  # bug du connecteur : message lisible plutôt qu'une erreur 500
        return {"ok": False, "message": f"erreur du connecteur : {type(e).__name__}"}
    return {"ok": r.ok, "message": r.message}


def _epoch(v) -> int | None:
    from datetime import datetime
    try:
        return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp())
    except (AttributeError, TypeError, ValueError):
        return None


def veeam_discover(conf: dict) -> dict:
    """Jobs et dépôts du serveur Veeam (lecture seule, rien n'est enregistré). Les dépôts n'ont rien à cocher :
    leur espace libre est lu à chaque relevé dès que le serveur Veeam est suivi."""
    try:
        jobs, repos = _veeam_conn(conf).fetch()
    except ConnectorError as e:
        raise BackupError(str(e)) from None
    followed = {loc.get("veeam_job") for s in _read().get("sets", []) for loc in s.get("locations", [])}
    return {"jobs": [{"name": j.get("name", "?"), "type": j.get("type") or "", "status": j.get("status") or "",
                      "last_result": j.get("lastResult") or "", "last_run": _epoch(j.get("lastRun")),
                      "disabled": j.get("status") == "Disabled", "followed": j.get("name") in followed} for j in jobs],
            "repos": [{"name": r.get("name", "?"), "type": r.get("type") or "", "size_gb": r.get("capacityGB"), "free_gb": r.get("freeGB")}
                      for r in repos]}


def _ensure_host(meta: dict, host: dict) -> dict:
    """Machine de backups-meta.json par son id : créée, ou complétée (champs donnés) si elle existe."""
    cur = next((h for h in meta["hosts"] if h["id"] == host["id"]), None)
    if cur is None:
        meta["hosts"].append(host)
        return host
    cur.update(host)
    return cur


def _check_age_label(it: dict, default_label: str) -> tuple[str, float]:
    label = str(it.get("label") or default_label).strip()
    if not label or len(label) > LABEL_MAX:
        raise BackupError(f"nom : 1 à {LABEL_MAX} caractères")
    try:
        age = float(it.get("max_age_days", AGE_DEFAULT))
    except (TypeError, ValueError):
        raise BackupError("âge maximum : un nombre de jours") from None
    if not AGE_MIN <= age <= AGE_MAX:
        raise BackupError(f"âge maximum : de {AGE_MIN:g} à {AGE_MAX:g} jours")
    return label, age


def veeam_follow(conf: dict, jobs: list[dict]) -> dict:
    """Enregistre le compte Veeam (connecteur « veeam », mot de passe chiffré) puis un jeu par job choisi. Le serveur est relu avant
    d'écrire : compte refusé ou job inconnu = rien n'est enregistré."""
    if not jobs:
        raise BackupError("aucun job choisi")
    if len(jobs) > 50:
        raise BackupError("50 jobs au plus à la fois")
    conn = _veeam_conn(conf)
    try:
        known = {j.get("name") for j in conn.fetch()[0]}
    except ConnectorError as e:
        raise BackupError(str(e)) from None
    todo = []
    for it in jobs:
        name = str(it.get("name") or "")
        if name not in known:
            raise BackupError(f"job « {name[:80]} » absent de Veeam")
        todo.append((name, *_check_age_label(it, f"Veeam : {name}")))
    exists = settings.get("veeam", VEEAM_NAME) is not None
    try:
        settings.save("veeam", VEEAM_NAME, {"url": conn.conf["url"], "user": conn.conf["user"], "password": conn.conf["password"]},
                      VEEAM_NAME if exists else None)
    except settings.SettingsError as e:
        raise BackupError(str(e)) from None
    meta = _read()
    meta.setdefault("hosts", [])
    meta.setdefault("sets", [])
    old = next((h for h in meta["hosts"] if h["id"] == VEEAM_HOST), {})
    old.pop("secrets", None)  # l'ancien fichier de secrets cède la place au compte réglé ici
    _ensure_host(meta, {**old, "id": VEEAM_HOST, "label": old.get("label", "Serveur Veeam"), "kind": "Veeam Backup & Replication",
                        "api": "veeam", "url": conn.conf["url"], "connector": VEEAM_NAME})
    _ensure_host(meta, {"id": VEEAM_SOURCES, "label": "Machines sauvegardées par Veeam", "kind": "origine des jobs Veeam", "api": "none"})
    added = updated = 0
    for name, label, age in todo:
        existing = next((s for s in meta["sets"] for loc in s.get("locations", []) if loc.get("veeam_job") == name), None)
        if existing:
            existing["label"], existing["max_age_days"] = label, age
            updated += 1
            continue
        taken = {s["id"] for s in meta["sets"]}
        base = sid = _slug(f"veeam-{name}")
        n = 2
        while sid in taken:
            sid, n = f"{base}-{n}", n + 1
        meta["sets"].append({"id": sid, "label": label, "origin": VEEAM_SOURCES, "schedule": "", "max_age_days": age,
                             "locations": [{"host": VEEAM_HOST, "veeam_job": name, "via": "job Veeam"}]})
        added += 1
    _write(meta)
    return {"added": added, "updated": updated}


# ───────────── Home Assistant ─────────────

def _ha_names() -> list[str]:
    """Noms des connecteurs « home-assistant » actifs de config.json (réglés dans Connecteurs, jeton déjà géré)."""
    return settings.names("home-assistant")


def _ha_state(meta: dict) -> dict:
    host = next((h for h in meta.get("hosts", []) if h.get("api") == "ha"), None)
    return {"connectors": _ha_names(), "followed": any(l.get("ha_backup") for s in meta.get("sets", []) for l in s.get("locations", [])),
            "connector": (host or {}).get("connector", "")}


def _ha_conn(name: str) -> HomeAssistant:
    if name not in _ha_names():
        raise BackupError(f"connecteur Home Assistant « {name[:64]} » introuvable (Réglages → Connecteurs)")
    plain = settings.get("home-assistant", name, plain=True)
    return HomeAssistant({"name": name, "url": plain.get("url"), "token": plain.get("token")}, Context(timeout=TEST_TIMEOUT))


def ha_check(name: str) -> dict:
    """Lit les sauvegardes de Home Assistant avec le connecteur choisi (rien n'est enregistré) : dernière réussie et son âge."""
    import time
    conn = _ha_conn(name)
    try:
        d = conn.collect()
    except ConnectorError as e:
        return {"ok": False, "message": str(e), "last_ok": None, "age_days": None}
    hb = d["ha_backup"]
    if not hb["last_ok"]:
        return {"ok": False, "last_ok": None, "age_days": None,
                "message": "connexion bonne, mais aucune sauvegarde automatique réussie n'est publiée (capteur sensor.backup_last_successful_automatic_backup) : "
                           "sauvegardes automatiques non activées dans Home Assistant (Paramètres → Système → Sauvegardes) ?"}
    age = round((time.time() - hb["last_ok"]) / 86400, 1)
    return {"ok": True, "last_ok": hb["last_ok"], "age_days": age, "message": f"dernière sauvegarde automatique réussie il y a {age:g} j"}


def ha_follow(name: str, label: str = "", max_age_days: float = 2.0) -> dict:
    """Un jeu « sauvegarde automatique de Home Assistant » : l'hôte lit le connecteur choisi (adresse et jeton), pas de fichier de secrets."""
    _ha_conn(name)
    label, age = _check_age_label({"label": label, "max_age_days": max_age_days}, "Home Assistant : sauvegarde automatique")
    meta = _read()
    meta.setdefault("hosts", [])
    meta.setdefault("sets", [])
    old = next((h for h in meta["hosts"] if h["id"] == HA_HOST), {})
    old.pop("secrets", None)
    _ensure_host(meta, {**old, "id": HA_HOST, "label": old.get("label", "Home Assistant"), "kind": "domotique", "api": "ha", "connector": name})
    _ensure_host(meta, {"id": HA_SOURCE, "label": "Configuration de Home Assistant", "kind": "origine de la sauvegarde", "api": "none"})
    existing = next((s for s in meta["sets"] if s["id"] == HA_SET), None)
    if existing:
        existing["label"], existing["max_age_days"] = label, age
    else:
        # offsite : la sauvegarde automatique de HA compte comme copie hors de lui (sinon le jeu serait toujours « critique »)
        meta["sets"].append({"id": HA_SET, "label": label, "origin": HA_SOURCE, "schedule": "", "max_age_days": age,
                             "locations": [{"host": HA_HOST, "ha_backup": True, "offsite": True, "via": "gestionnaire de sauvegardes HA"}]})
    _write(meta)
    return {"added": 0 if existing else 1, "updated": 1 if existing else 0}
