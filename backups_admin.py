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
  vzdump_discover / vzdump_follow   dumps of Proxmox VE (vzdump, without Proxmox Backup) read by SSH on the Proxmox host: one set
                   per guest (VM or container) and dump folder ; copies (rsync to a NAS…) are then declared or found like any folder
  remote_test / remote_browse / remote_follow   folder on a box read over FTP, FTPS or Samba (a Freebox, a NAS): connection test,
                   folder browsing (read-only, nothing saved), then the account (connector « backup-folder », password encrypted) and a
                   set for the folder, or a copy added to a set already followed
  ha_check / ha_follow   sauvegardes de Home Assistant, lues avec l'adresse et le jeton du connecteur « home-assistant »
                   (déjà réglé dans Connecteurs) : un jeu « sauvegarde automatique » rapproché de l'âge de la dernière réussie
  synology_discover / synology_follow   Hyper Backup tasks of a Synology NAS, read with the account of the « synology » connector (already set in
                   Connecteurs, read-only): the tasks are listed (nothing saved), then one set per ticked task (last run, result, age)

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
from connectors.backup_apis import HomeAssistant, PbsBackups, SynologyBackups, Veeam
from connectors.base import ConnectorError, Context
from connectors.remote_folder import RemoteFolder, check_path

AGE_MIN, AGE_MAX = 0.1, 365.0
AGE_DEFAULT = 2.0
LABEL_MAX = 80
AGE_STEPS = (2.0, 8.0, 15.0, 31.0)   # seuils proposés : sauvegarde quotidienne, hebdomadaire, tous les 15 jours, mensuelle
DEPTH = 3  # un dossier de sauvegarde range souvent ses archives dans des sous-dossiers datés


DEFAULT_PATH = "/home/backup"  # dossier de sauvegarde par défaut : toujours cherché, et proposé coché quand il existe
PATTERNS_MAX = 20

VEEAM_NAME = "veeam"  # nom donné à l'instance si aucune n'existe encore ; sinon celle de Réglages → Connecteurs est reprise (_veeam_name)
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


def patterns_of(meta: dict) -> list[str]:
    """Emplacements cherchés : le dossier par défaut d'abord, puis ceux de backups-meta.json (motifs glob acceptés)."""
    return [DEFAULT_PATH] + [p for p in meta.get("discover", []) if p != DEFAULT_PATH]


def _clean_paths(raw_list: list[str]) -> list[str]:
    """Validated absolute paths (glob allowed), without duplicates and without the default folder."""
    out: list[str] = []
    for raw in raw_list:
        p = str(raw).strip().rstrip("/") if str(raw).strip() != "/" else "/"
        if p == DEFAULT_PATH or p in out:
            continue
        if not p.startswith("/") or p == "/" or ".." in p.split("/") or len(p) > 300 or any(c in p for c in "\n\r\0"):
            raise BackupError(f"chemin invalide : {raw!s:.80}")
        out.append(p)
    if len(out) > PATTERNS_MAX:
        raise BackupError(f"{PATTERNS_MAX} emplacements au plus")
    return out


def host_patterns_of(meta: dict, ip: str) -> list[str]:
    """Locations searched on one machine only: the shared ones (default folder first), then its own."""
    own = [p for p in (meta.get("discover_by_host") or {}).get(ip, []) if p not in patterns_of(meta)]
    return patterns_of(meta) + own


def set_patterns(extra: list[str], by_host: dict[str, list[str]] | None = None) -> dict:
    """Replace the locations searched besides the default folder: `extra` on every machine, `by_host` ({ip: paths}) on one machine
    only. `by_host` None keeps the per-machine lists as they are. An absolute path, glob allowed."""
    meta = _read()
    meta["discover"] = _clean_paths(extra)
    if by_host is not None:
        known = set(_machines())
        meta["discover_by_host"] = {ip: paths for ip, raw in by_host.items() if ip in known and (paths := _clean_paths(raw))}
    _write(meta)
    return {"patterns": patterns_of(meta), "by_host": meta.get("discover_by_host", {})}


def _write(meta: dict) -> None:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
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
    seen = _last_report()
    sets = []
    for s in meta.get("sets", []):
        loc = (s.get("locations") or [{}])[0]
        sets.append({"id": s["id"], "label": s.get("label", s["id"]), "origin": hosts.get(s.get("origin"), {}).get("label", s.get("origin", "")),
                     "origin_ip": hosts.get(s.get("origin"), {}).get("ip"),
                     "path": loc.get("path"), "remote": hosts.get(loc.get("host"), {}).get("api") == "remote", "veeam_job": loc.get("veeam_job"), "pbs_group": loc.get("pbs_group"), "synology_task": loc.get("synology_task"), "vzdump": loc.get("vzdump"), "max_age_days": s.get("max_age_days", 8),
                     "ha": any(l.get("ha_backup") for l in s.get("locations", [])),
                     "expect_offsite": s.get("expect_offsite", True), "editable": bool(loc.get("path")),
                     "copies": [{"index": i, "host": hosts.get(l.get("host"), {}).get("label", l.get("host", "")), "path": l.get("path"),
                                 "offsite": l.get("host") != s.get("origin") or bool(l.get("offsite"))} for i, l in enumerate(s.get("locations", [])) if i and l.get("path")],
                     "cadence_days": seen.get(s["id"], {}).get("cadence_days")})
    import config
    return {"sets": sets, "exists": _path().exists(), "tab": bool(config.CFG.get("backups_url")),
            "patterns": patterns_of(meta), "host_patterns": meta.get("discover_by_host", {}), "default_path": DEFAULT_PATH, "machines": len(_machines()),
            "ssh_machines": [{"ip": ip, "name": m["name"]} for ip, m in sorted(_machines().items(), key=lambda x: x[1]["name"].lower())],
            "veeam": _veeam_state(), "ha": _ha_state(meta), "pbs": _pbs_state(meta), "synology": _synology_state(meta),
            "vzdump": {"followed": sum(1 for s in meta.get("sets", []) if (s.get("locations") or [{}])[0].get("vzdump"))},
            "remote": _remote_state()}


def _last_report() -> dict:
    """{set id: set} of the last backups.json (observed rhythm…), empty when not written yet."""
    import config
    try:
        got = json.loads((Path(config.CFG["web_dir"]) / "backups.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        return {}
    return {x.get("id"): x for x in got.get("sets", []) if isinstance(x, dict)}


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
    patterns = patterns_of(meta)
    machines = _machines()
    with ThreadPoolExecutor(max(1, min(8, len(machines)))) as ex:
        found = list(ex.map(lambda it: _scan(it, host_patterns_of(meta, it[0])), machines.items()))
    followed = {(loc.get("host"), loc.get("path")) for s in meta.get("sets", []) for loc in s.get("locations", []) if loc.get("path") and not loc.get("vzdump")}
    hosts = {h.get("ip"): h["id"] for h in meta.get("hosts", [])}
    for m in found:
        for f in m["folders"]:
            f["followed"] = (hosts.get(m["ip"]), f["path"]) in followed
            f["default"] = f["path"] == DEFAULT_PATH  # trouvé au chemin par défaut : la page le coche d'office
    return {"machines": found, "patterns": patterns, "at": time.time()}


def suggest_age(age_days: float | None) -> float:
    """Seuil d'alerte proposé d'après l'âge du fichier le plus récent vu au moment de la découverte : le plus petit palier (2, 8, 15, 31 j)
    qui laisse une marge de 25 %. Une sauvegarde hebdomadaire vue à 6 jours reçoit 8 j au lieu d'être critique d'emblée ; dossier vide : 8 j."""
    if age_days is None:
        return 8.0
    return next((s for s in AGE_STEPS if s >= age_days * 1.25), AGE_STEPS[-1])


def auto_default(state_file: Path) -> list[dict]:
    """Première lecture d'une machine par SSH : si le dossier par défaut (/home/backup) existe et est lisible, il est suivi tout de suite
    (nom et âge par défaut). Chaque machine n'est regardée qu'une fois (liste dans `state_file`) : retirer ensuite le jeu ne le fait pas
    revenir. Une machine qui ne répond pas est retentée au passage suivant. Retourne les jeux ajoutés [{ip, name, path}]."""
    try:
        checked = set(json.loads(state_file.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        checked = set()
    machines = {ip: m for ip, m in _machines().items() if ip not in checked}
    added: list[dict] = []
    for ip, m in machines.items():
        res = _scan((ip, m), [DEFAULT_PATH])
        if not res["ok"]:
            continue                                           # injoignable pour l'instant : on réessaiera
        checked.add(ip)
        hit = next((f for f in res["folders"] if f["path"] == DEFAULT_PATH and f.get("readable", True)), None)
        if hit:
            age = (time.time() - hit["newest"]) / 86400 if hit.get("newest") else None
            follow([{"ip": ip, "path": DEFAULT_PATH, "label": f"{m['name']} : {DEFAULT_PATH}"[:LABEL_MAX], "max_age_days": suggest_age(age)}])
            added.append({"ip": ip, "name": m["name"], "path": DEFAULT_PATH})
    state_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = state_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(sorted(checked)), encoding="utf-8")
    tmp.replace(state_file)
    return added


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


def _machine_host(meta: dict, hosts: dict, ip: str, m: dict) -> str:
    """Id of the machine's host in backups-meta.json, created on first use (SSH alias kept up to date)."""
    hid = next((h["id"] for h in hosts.values() if h.get("ip") == ip and not h.get("api")), None)
    if hid is None:
        hid = _slug(m["name"])
        while hid in hosts:
            hid += "-2"
        hosts[hid] = {"id": hid, "label": m["name"], "ip": ip, "ssh": m["ssh"], "kind": "machine"}
        meta["hosts"].append(hosts[hid])
    elif hosts[hid].get("ssh") != m["ssh"]:
        hosts[hid]["ssh"] = m["ssh"]
    return hid


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
        hid = _machine_host(meta, hosts, ip, m)
        existing = next((s for s in meta["sets"] for loc in s.get("locations", [])
                         if loc.get("host") == hid and loc.get("path") == path and not loc.get("vzdump")), None)
        if existing:
            existing["label"], existing["max_age_days"] = label, age
            updated += 1
            continue
        sid = _slug(f"{m['name']}-{path.rstrip('/').rsplit('/', 1)[-1]}")
        taken = {s["id"] for s in meta["sets"]}
        n, base = 2, sid
        while sid in taken:
            sid, n = f"{base}-{n}", n + 1
        meta["sets"].append({"id": sid, "label": label, "origin": hid, "schedule": "", "max_age_days": age, "expect_offsite": False,   # copie ailleurs : à déclarer (Réglages) pour qu'elle soit exigée
                             "locations": [{"host": hid, "path": path, "pattern": "*", "depth": DEPTH, "via": "dossier"}]})
        added += 1
    _write(meta)
    return {"added": added, "updated": updated}


def update_set(set_id: str, label: str | None = None, max_age_days: float | None = None, expect_offsite: bool | None = None) -> None:
    """Nom, seuil d'âge (jours) et « copie hors machine exigée » d'un jeu déjà suivi."""
    meta = _read()
    s = next((x for x in meta.get("sets", []) if x["id"] == set_id), None)
    if s is None:
        raise BackupError("jeu inconnu")
    if label is not None:
        if not label.strip() or len(label.strip()) > LABEL_MAX:
            raise BackupError(f"nom : 1 à {LABEL_MAX} caractères")
        s["label"] = label.strip()
    if max_age_days is not None:
        if not AGE_MIN <= float(max_age_days) <= AGE_MAX:
            raise BackupError(f"âge maximum : de {AGE_MIN:g} à {AGE_MAX:g} jours")
        s["max_age_days"] = float(max_age_days)
    if expect_offsite is not None:
        s["expect_offsite"] = bool(expect_offsite)
    _write(meta)


def add_copy(set_id: str, ip: str, path: str, network: bool = False) -> dict:
    """Declares where a folder set is copied (another machine, or another disk of the same one). backups.py then checks at each run
    that the copy keeps up with the source. A copy on another machine turns « off-machine copy required » on."""
    machines = _machines()
    _, path, _, _ = _check_item({"ip": ip, "path": path, "label": "x"}, machines)
    meta = _read()
    s = next((x for x in meta.get("sets", []) if x["id"] == set_id), None)
    if s is None:
        raise BackupError("jeu inconnu")
    if not (s.get("locations") or [{}])[0].get("path"):
        raise BackupError("copie déclarable seulement pour un dossier (Veeam, PBS, Synology et Home Assistant ont déjà leur copie)")
    hosts = {h["id"]: h for h in meta.setdefault("hosts", [])}
    hid = _machine_host(meta, hosts, ip, machines[ip])
    if any(l.get("host") == hid and l.get("path") == path for l in s["locations"]):
        raise BackupError("cet emplacement est déjà dans le jeu")
    if len(s["locations"]) >= 6:
        raise BackupError("5 copies au plus par jeu")
    src = s["locations"][0]
    offsite = hid != s.get("origin") or network
    s["locations"].append({"host": hid, "path": path, "pattern": src.get("pattern", "*"), "depth": src.get("depth", DEPTH), "via": "copie",
                           **({"exclude": src["exclude"]} if src.get("exclude") else {}),
                           **({"offsite": True} if network else {})})   # network share (NAS) seen from the origin: still off the machine
    if offsite:
        s["expect_offsite"] = True
    _write(meta)
    return {"offsite": offsite}


def remove_copy(set_id: str, index: int) -> None:
    """Removes copy number `index` (1 = first copy ; 0, the source, cannot be removed this way)."""
    meta = _read()
    s = next((x for x in meta.get("sets", []) if x["id"] == set_id), None)
    if s is None:
        raise BackupError("jeu inconnu")
    if not 1 <= index < len(s.get("locations", [])):
        raise BackupError("copie inconnue")
    del s["locations"][index]
    hosts = {h["id"]: h for h in meta.get("hosts", [])}
    if not any(l.get("host") != s.get("origin") or l.get("offsite") for l in s["locations"][1:]):
        s["expect_offsite"] = False   # last off-machine copy gone: nothing left to require
    _write(meta)


COPY_ROOTS = ["/mnt", "/media", "/srv", "/home", "/volume1", "/volume2", "/share", "/backup", "/data"]   # + every network share of the machine


def _wanted(meta: dict, report: dict) -> dict:
    """{archive file name: [(set id, path relative to the set's folder)]} : the last archives of each followed folder set, from the last
    backups.json (several: the newest one may not be copied yet)."""
    want: dict[str, list[tuple[str, str]]] = {}
    for s in meta.get("sets", []):
        if not (s.get("locations") or [{}])[0].get("path"):
            continue
        src = ((report.get(s["id"]) or {}).get("locations") or [{}])[0]
        for rel in src.get("recent") or [(src.get("newest") or {}).get("name")]:
            if rel and (s["id"], rel) not in want.get(Path(rel).name, []):
                want.setdefault(Path(rel).name, []).append((s["id"], rel))
    return want


def copies_from_hits(meta: dict, want: dict, hits: list[dict]) -> list[dict]:
    """Suggested copies from the search results [{ip, name, found: {archive: [{dir, network}]}}]. The source folder itself is left out,
    and so are places already in a set. One share mounted on several machines (the same NAS) is proposed once, through a machine other
    than the set's origin when there is one: that way it counts as an off-machine copy."""
    hosts = {h["id"]: h for h in meta.get("hosts", [])}
    sets = {s["id"]: s for s in meta.get("sets", [])}
    # (ip, folder, file pattern): one dump folder holds the sets of several guests (vzdump), each with its own pattern
    taken = {(hosts.get(l.get("host"), {}).get("ip"), (l.get("path") or "").rstrip("/"), l.get("pattern", "*"))
             for x in sets.values() for l in x.get("locations", [])}
    best: dict[tuple, dict] = {}
    for m in hits:
        for archive, places in (m.get("found") or {}).items():
            for sid, rel in want.get(archive, []):
                s = sets[sid]
                src = s["locations"][0]
                origin_ip = hosts.get(s.get("origin"), {}).get("ip")
                sub = str(Path(rel).parent).strip("./")   # archive kept in a subfolder of the set (« ia-config/x.tgz »): the copy root is above it
                for p in places:
                    d = p["dir"].rstrip("/")
                    if sub:
                        if not d.endswith("/" + sub):
                            continue
                        d = d[: -len(sub) - 1] or "/"
                    # a place already in a set (a network share counts whatever machine it was declared through)
                    if any((m["ip"] == ip or p.get("network")) and (d + "/").startswith(path + "/") and pat in ("*", src.get("pattern", "*"))
                           for ip, path, pat in taken if path):
                        continue
                    if m["ip"] == origin_ip and (d + "/").startswith(src["path"].rstrip("/") + "/"):
                        continue
                    c = {"set_id": sid, "set_label": s.get("label", sid), "ip": m["ip"], "name": m["name"], "path": d, "archive": archive,
                         "network": bool(p.get("network")), "offsite": m["ip"] != origin_ip or bool(p.get("network"))}
                    k = (sid, d) if p.get("network") else (sid, m["ip"], d)
                    if k not in best or (best[k]["ip"] == origin_ip and m["ip"] != origin_ip):
                        best[k] = c
    return sorted(best.values(), key=lambda c: (c["set_label"], not c["offsite"], c["path"]))[:40]


def find_copies() -> dict:
    """Looks on every machine read by SSH (network shares included) for the newest archive of each followed folder: where it is found,
    the folder is probably a copy. Read only ; nothing is linked until the page asks."""
    import backups
    meta = _read()
    want = _wanted(meta, _last_report())
    if not want:
        return {"copies": [], "searched": 0, "reason": "aucune archive connue : attendre le premier relevé des sauvegardes"}
    machines = _machines()
    req = json.dumps({"locs": {}, "disks": False, "crons": False, "find": {"names": sorted(want), "roots": COPY_ROOTS, "depth": 5, "budget": 60}})

    def one(item):
        ip, m = item
        out, err = backups.run_py(m["ssh"], backups.AGENT, req)
        return {"ip": ip, "name": m["name"], "found": (out or {}).get("found") or {}, "error": err if out is None else ""}
    with ThreadPoolExecutor(max(1, min(8, len(machines)))) as ex:
        hits = list(ex.map(one, machines.items()))
    return {"copies": copies_from_hits(meta, want, hits), "searched": len(hits),
            "errors": [{"name": h["name"], "error": h["error"]} for h in hits if h["error"]]}


def unfollow(set_id: str) -> None:
    meta = _read()
    keep = [s for s in meta.get("sets", []) if s["id"] != set_id]
    if len(keep) == len(meta.get("sets", [])):
        raise BackupError("jeu inconnu")
    meta["sets"] = keep
    _write(meta)


# ───────────── Veeam Backup & Replication ─────────────

def _veeam_name() -> str:
    """Instance « veeam » de config.json : la première (réglée dans Connecteurs ou ici), sinon le nom par défaut."""
    return next(iter(settings.names("veeam")), VEEAM_NAME)


def _veeam_state() -> dict:
    """Compte Veeam enregistré, sans le mot de passe (seulement s'il existe)."""
    c = settings.get("veeam", _veeam_name())
    return {"configured": c is not None, "url": (c or {}).get("url", ""), "user": (c or {}).get("user", ""),
            "password_set": bool((c or {}).get("password"))}


def _veeam_conn(conf: dict) -> Veeam:
    """Connecteur prêt d'après le formulaire (mot de passe vide = celui déjà enregistré). Rien n'est écrit."""
    name = _veeam_name()
    exists = settings.get("veeam", name) is not None
    fields = {k: str(conf.get(k) or "").strip() for k in ("url", "user")} | {"password": str(conf.get("password") or "")}
    if len(fields["user"]) > 200 or len(fields["password"]) > 500:
        raise BackupError("compte ou mot de passe trop long")
    try:
        plain = settings.resolve("veeam", name, fields, name if exists else None)
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
    name = _veeam_name()
    exists = settings.get("veeam", name) is not None
    try:
        settings.save("veeam", name, {"url": conn.conf["url"], "user": conn.conf["user"], "password": conn.conf["password"]},
                      name if exists else None)
    except settings.SettingsError as e:
        raise BackupError(str(e)) from None
    meta = _read()
    meta.setdefault("hosts", [])
    meta.setdefault("sets", [])
    old = next((h for h in meta["hosts"] if h["id"] == VEEAM_HOST), {})
    old.pop("secrets", None)  # l'ancien fichier de secrets cède la place au compte réglé ici
    _ensure_host(meta, {**old, "id": VEEAM_HOST, "label": old.get("label", "Serveur Veeam"), "kind": "Veeam Backup & Replication",
                        "api": "veeam", "url": conn.conf["url"], "connector": name})
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


# ───────────── Proxmox Backup Server ─────────────

PBS_HOST, PBS_SOURCES = "pbs", "pbs-sources"


def _pbs_state(meta: dict) -> dict:
    """Connecteurs « proxmox-backup » réglés dans Connecteurs (compte déjà géré là) et groupes déjà suivis."""
    return {"connectors": settings.names("proxmox-backup"),
            "followed": sum(1 for s in meta.get("sets", []) for l in s.get("locations", []) if l.get("pbs_group"))}


def _pbs_conn(name: str) -> PbsBackups:
    if name not in settings.names("proxmox-backup"):
        raise BackupError(f"connecteur « {name[:64]} » absent ou coupé : le régler dans Réglages → Connecteurs")
    plain = settings.get("proxmox-backup", name, plain=True) or {}
    return PbsBackups({"name": name, **plain}, Context(timeout=TEST_TIMEOUT))


def pbs_discover(name: str) -> dict:
    """Groupes de sauvegarde du serveur (lecture seule, rien n'est enregistré) ; « followed » : déjà suivis."""
    try:
        groups = _pbs_conn(name).groups()
    except ConnectorError as e:
        raise BackupError(str(e)) from None
    followed = {loc.get("pbs_group") for s in _read().get("sets", []) for loc in s.get("locations", [])}
    return {"groups": [{**g, "key": f"{g['store']}/{g['type']}/{g['id']}", "followed": f"{g['store']}/{g['type']}/{g['id']}" in followed} for g in groups]}


def pbs_follow(name: str, groups: list[dict]) -> dict:
    """Un jeu par groupe choisi ; le serveur est relu avant d'écrire (groupe inconnu = rien n'est enregistré)."""
    if not groups:
        raise BackupError("aucun groupe choisi")
    if len(groups) > 100:
        raise BackupError("100 groupes au plus à la fois")
    known = {g["key"] for g in pbs_discover(name)["groups"]}
    todo = []
    for it in groups:
        key = str(it.get("key") or "")
        if key not in known:
            raise BackupError(f"groupe « {key[:80]} » absent de Proxmox Backup")
        todo.append((key, *_check_age_label(it, f"Proxmox Backup : {key}")))
    meta = _read()
    meta.setdefault("hosts", [])
    meta.setdefault("sets", [])
    _ensure_host(meta, {"id": PBS_HOST, "label": "Proxmox Backup Server", "kind": "Proxmox Backup Server", "api": "pbs", "connector": name})
    _ensure_host(meta, {"id": PBS_SOURCES, "label": "Machines sauvegardées par Proxmox Backup", "kind": "origine des groupes Proxmox Backup", "api": "none"})
    added = updated = 0
    for key, label, age in todo:
        existing = next((s for s in meta["sets"] for loc in s.get("locations", []) if loc.get("pbs_group") == key), None)
        if existing:
            existing["label"], existing["max_age_days"] = label, age
            updated += 1
            continue
        taken = {s["id"] for s in meta["sets"]}
        base = sid = _slug(f"pbs-{key}")
        n = 2
        while sid in taken:
            sid, n = f"{base}-{n}", n + 1
        meta["sets"].append({"id": sid, "label": label, "origin": PBS_SOURCES, "schedule": "", "max_age_days": age,
                             "locations": [{"host": PBS_HOST, "pbs_group": key, "via": "Proxmox Backup"}]})
        added += 1
    _write(meta)
    return {"added": added, "updated": updated}


# ───────────── Synology Hyper Backup ─────────────

SYNO_HOST, SYNO_SOURCES = "synology", "synology-sources"


def _synology_state(meta: dict) -> dict:
    """Connecteurs « synology » réglés dans Connecteurs (compte déjà géré là) et tâches Hyper Backup déjà suivies."""
    return {"connectors": settings.names("synology"),
            "followed": sum(1 for s in meta.get("sets", []) for l in s.get("locations", []) if l.get("synology_task"))}


def _synology_conn(name: str) -> SynologyBackups:
    if name not in settings.names("synology"):
        raise BackupError(f"connecteur « {name[:64]} » absent ou coupé : le régler dans Réglages → Connecteurs")
    plain = settings.get("synology", name, plain=True) or {}
    return SynologyBackups({"name": name, **plain}, Context(timeout=TEST_TIMEOUT))


def synology_discover(name: str) -> dict:
    """Tâches Hyper Backup du NAS (lecture seule, rien n'est enregistré) ; « followed » : déjà suivies."""
    try:
        tasks, _ = _synology_conn(name).snapshot()
    except ConnectorError as e:
        raise BackupError(str(e)) from None
    followed = {loc.get("synology_task") for s in _read().get("sets", []) for loc in s.get("locations", [])}
    return {"tasks": [{**t, "key": t["name"], "followed": t["name"] in followed} for t in tasks]}


def synology_follow(name: str, tasks: list[dict]) -> dict:
    """Un jeu par tâche choisie ; le NAS est relu avant d'écrire (tâche inconnue = rien n'est enregistré)."""
    if not tasks:
        raise BackupError("aucune tâche choisie")
    if len(tasks) > 100:
        raise BackupError("100 tâches au plus à la fois")
    known = {t["key"] for t in synology_discover(name)["tasks"]}
    todo = []
    for it in tasks:
        key = str(it.get("key") or "")
        if key not in known:
            raise BackupError(f"tâche « {key[:80]} » absente de Hyper Backup")
        todo.append((key, *_check_age_label(it, f"Synology : {key}")))
    meta = _read()
    meta.setdefault("hosts", [])
    meta.setdefault("sets", [])
    _ensure_host(meta, {"id": SYNO_HOST, "label": "Synology", "kind": "NAS Synology (Hyper Backup)", "api": "synology", "connector": name})
    _ensure_host(meta, {"id": SYNO_SOURCES, "label": "Données sauvegardées par Hyper Backup", "kind": "origine des tâches Hyper Backup", "api": "none"})
    added = updated = 0
    for key, label, age in todo:
        existing = next((s for s in meta["sets"] for loc in s.get("locations", []) if loc.get("synology_task") == key), None)
        if existing:
            existing["label"], existing["max_age_days"] = label, age
            updated += 1
            continue
        taken = {s["id"] for s in meta["sets"]}
        base = sid = _slug(f"synology-{key}")
        n = 2
        while sid in taken:
            sid, n = f"{base}-{n}", n + 1
        meta["sets"].append({"id": sid, "label": label, "origin": SYNO_SOURCES, "schedule": "", "max_age_days": age,
                             "locations": [{"host": SYNO_HOST, "synology_task": key, "via": "Hyper Backup"}]})
        added += 1
    _write(meta)
    return {"added": added, "updated": updated}


# ───────────── Proxmox VE dumps (vzdump) ─────────────

VZDUMP_KINDS = ("qemu", "lxc", "openvz")
VZDUMP_SIDE = ["*.log", "*.notes", "*.protected"]   # written next to each dump: not an archive


def _vzdump_scan(item: tuple[str, dict]) -> dict:
    import backups
    ip, m = item
    out, err = backups.run_py(m["ssh"], backups.AGENT, json.dumps({"locs": {}, "disks": False, "crons": False, "vzdump": True}))
    return {"ip": ip, "name": m["name"], "ok": out is not None, "error": err or (out or {}).get("vzdump_error", ""),
            "groups": (out or {}).get("vzdump", []), "proxmox": out is not None and "vzdump" in out}


def vzdump_discover() -> dict:
    """Dumps found on each machine read by SSH that is a Proxmox VE host (read only, nothing written) ; « followed » : already a set."""
    machines = _machines()
    with ThreadPoolExecutor(max(1, min(8, len(machines)))) as ex:
        found = list(ex.map(_vzdump_scan, machines.items()))
    meta = _read()
    hosts = {h["id"]: h.get("ip") for h in meta.get("hosts", [])}
    followed = {(hosts.get(l.get("host")), l.get("path"), l.get("vzdump")) for s in meta.get("sets", []) for l in s.get("locations", [])[:1] if l.get("vzdump")}
    for m in found:
        for g in m["groups"]:
            g["followed"] = (m["ip"], g["dir"], f"{g['kind']}/{g['vmid']}") in followed
            g["suggested_age"] = suggest_age((time.time() - g["newest"]) / 86400)
    return {"machines": [m for m in found if m["proxmox"] or not m["ok"]], "at": time.time()}


def vzdump_follow(items: list[dict]) -> dict:
    """One set per chosen guest dump: the folder of the dumps, files of that guest only (logs and notes left aside). A dump on a network
    storage (NFS, CIFS) is already off the Proxmox host. Already followed = name and age updated."""
    if not items:
        raise BackupError("aucune sauvegarde choisie")
    if len(items) > 100:
        raise BackupError("100 sauvegardes au plus à la fois")
    machines = _machines()
    meta = _read()
    hosts = {h["id"]: h for h in meta.setdefault("hosts", [])}
    meta.setdefault("sets", [])
    added = updated = 0
    for it in items:
        kind, vmid = str(it.get("kind", "")), str(it.get("vmid", ""))
        if kind not in VZDUMP_KINDS or not vmid.isdigit() or len(vmid) > 9:
            raise BackupError(f"machine invitée invalide : {kind[:10]}/{vmid[:10]}")
        ip, path, age, label = _check_item({**it, "path": it.get("dir", "")}, machines)
        hid = _machine_host(meta, hosts, ip, machines[ip])
        key = f"{kind}/{vmid}"
        existing = next((s for s in meta["sets"] for l in s.get("locations", [])[:1] if l.get("host") == hid and l.get("path") == path and l.get("vzdump") == key), None)
        if existing:
            existing["label"], existing["max_age_days"] = label, age
            updated += 1
            continue
        network = bool(it.get("network"))
        taken = {s["id"] for s in meta["sets"]}
        base = sid = _slug(f"{machines[ip]['name']}-vzdump-{vmid}")
        n = 2
        while sid in taken:
            sid, n = f"{base}-{n}", n + 1
        meta["sets"].append({"id": sid, "label": label, "origin": hid, "schedule": "", "max_age_days": age, "expect_offsite": network,
                             "locations": [{"host": hid, "path": path, "pattern": f"vzdump-{kind}-{vmid}-*", "exclude": VZDUMP_SIDE, "depth": 1,
                                            "via": "vzdump", "vzdump": key, **({"offsite": True} if network else {})}]})
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
    return HomeAssistant({"name": name, "url": plain.get("url"), "token": plain.get("token"), "mcp_url": plain.get("mcp_url")}, Context(timeout=TEST_TIMEOUT))


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


# ───────────── Folder on a box (FTP, FTPS, Samba) ─────────────

REMOTE_TYPE = RemoteFolder.type
REMOTE_FIELDS = ("protocol", "host", "port", "user", "share")


def _remote_state() -> list[dict]:
    """Accounts already saved (connector « backup-folder »), without their password: the form offers them."""
    out = []
    for name in settings.names(REMOTE_TYPE):
        c = settings.get(REMOTE_TYPE, name) or {}
        out.append({"name": name, "password_set": bool(c.get("password")), **{k: c.get(k, "") for k in REMOTE_FIELDS}})
    return out


def _remote_conn(conf: dict) -> tuple[str, RemoteFolder]:
    """Connector ready from the form (empty password = the saved one of the same name). Nothing is written."""
    name = str(conf.get("name") or "").strip()
    if not re.fullmatch(r"[\w .-]{1,60}", name):
        raise BackupError("nom du compte : 1 à 60 caractères (lettres, chiffres, espace, . - _)")
    fields = {k: str(conf.get(k) or "").strip() for k in REMOTE_FIELDS} | {"password": str(conf.get("password") or "")}
    if len(fields["user"]) > 200 or len(fields["password"]) > 500:
        raise BackupError("compte ou mot de passe trop long")
    try:
        plain = settings.resolve(REMOTE_TYPE, name, fields, name if settings.get(REMOTE_TYPE, name) is not None else None)
    except settings.SettingsError as e:
        raise BackupError(str(e)) from None
    if problems := RemoteFolder.validate(plain):
        raise BackupError("; ".join(problems))
    return name, RemoteFolder(plain, Context(timeout=TEST_TIMEOUT))


def _remote_path(path: str) -> str:
    try:
        return check_path(path)
    except ConnectorError as e:
        raise BackupError(str(e)) from None


def remote_test(conf: dict) -> dict:
    """Connection test (login and root listing) without saving anything."""
    r = _remote_conn(conf)[1].test()
    return {"ok": r.ok, "message": r.message}


def remote_browse(conf: dict, path: str) -> dict:
    """One folder of the box, read-only: its sub-folders and its newest files. Nothing is saved."""
    path = _remote_path(path)
    try:
        entries = _remote_conn(conf)[1].list_dir(path)
    except ConnectorError as e:
        raise BackupError(str(e)) from None
    files = sorted((e for e in entries if not e["is_dir"]), key=lambda e: -e["mtime"])
    return {"path": path, "folders": sorted(e["name"] for e in entries if e["is_dir"]), "files": files[:10],
            "file_count": len(files), "size": sum(e["size"] for e in files), "newest": files[0]["mtime"] if files else None}


def remote_follow(conf: dict, path: str, label: str = "", max_age_days: float = AGE_DEFAULT, copy_of: str = "") -> dict:
    """Saves the account (connector « backup-folder ») then follows the folder: as a set of its own, or as a copy of the set `copy_of`
    (a folder followed on a machine and copied to the box). The folder is read first: absent folder = nothing is saved."""
    name, conn = _remote_conn(conf)
    path = _remote_path(path)
    if path == "/":
        raise BackupError("choisir un dossier, pas la racine")
    label, age = _check_age_label({"label": label, "max_age_days": max_age_days}, f"{name} : {path}"[:LABEL_MAX])
    try:
        found = conn.scan(path, DEPTH)
    except ConnectorError as e:
        raise BackupError(str(e)) from None
    if not found.get("exists"):
        raise BackupError(f"dossier absent : {path}")
    exists = settings.get(REMOTE_TYPE, name) is not None
    try:
        settings.save(REMOTE_TYPE, name, {k: conn.conf[k] for k in (*REMOTE_FIELDS, "password") if conn.conf.get(k) not in (None, "")}, name if exists else None)
    except settings.SettingsError as e:
        raise BackupError(str(e)) from None
    meta = _read()
    meta.setdefault("hosts", [])
    meta.setdefault("sets", [])
    hid = "remote-" + _slug(name)
    _ensure_host(meta, {"id": hid, "label": name, "kind": "dossier distant (" + conn.proto.upper() + ")", "api": "remote", "connector": name})
    here = next((s for s in meta["sets"] for loc in s.get("locations", []) if loc.get("host") == hid and loc.get("path") == path), None)
    if copy_of:
        s = next((x for x in meta["sets"] if x["id"] == copy_of), None)
        if s is None:
            raise BackupError("jeu inconnu")
        src = (s.get("locations") or [{}])[0]
        if not src.get("path"):
            raise BackupError("copie déclarable seulement pour un dossier (Veeam, PBS, Synology et Home Assistant ont déjà leur copie)")
        if any(l.get("host") == hid and l.get("path") == path for l in s["locations"]):
            raise BackupError("cet emplacement est déjà dans le jeu")
        if len(s["locations"]) >= 6:
            raise BackupError("5 copies au plus par jeu")
        s["locations"].append({"host": hid, "path": path, "pattern": src.get("pattern", "*"), "depth": src.get("depth", DEPTH), "via": "copie",
                               **({"exclude": src["exclude"]} if src.get("exclude") else {}), "offsite": True})
        s["expect_offsite"] = True
        _write(meta)
        return {"added": 0, "updated": 0, "copy": True}
    if here:
        here["label"], here["max_age_days"] = label, age
        _write(meta)
        return {"added": 0, "updated": 1, "copy": False}
    taken = {s["id"] for s in meta["sets"]}
    base = sid = _slug(f"{name}-{path.rstrip('/').rsplit('/', 1)[-1]}")
    n = 2
    while sid in taken:
        sid, n = f"{base}-{n}", n + 1
    meta["sets"].append({"id": sid, "label": label, "origin": hid, "schedule": "", "max_age_days": age, "expect_offsite": False,
                         "locations": [{"host": hid, "path": path, "pattern": "*", "depth": DEPTH, "via": "dossier distant"}]})
    _write(meta)
    return {"added": 1, "updated": 0, "copy": False}
