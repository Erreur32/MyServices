"""Réglages → Machines : équivalent graphique de « setup.py --add », sans question.

  detect(cible)  ping, ports, nom DNS, SSH (Linux ou Windows), Docker, AdGuard, VM, services web, connecteurs
                 reconnus d'après les images : une proposition, rien n'est écrit
  save(ip, m)    écrit la machine dans services-meta.json (autres machines et clés intouchées)
  delete(ip)     la retire (et de process_hosts)
  redetect(ips)  détection refaite pour les machines déclarées : écarts proposés, rien n'est écrit
  check(ip)      vérification de setup.py (SSH, Docker, AdGuard, santé), lignes ✓ / ⚠ / ✗

Mêmes fonctions que setup.py (importées) : une détection corrigée là l'est ici aussi. Lecture seule sur le
réseau, comme le collecteur. Prise en compte : au prochain passage de la collecte (ou bouton ⟳).
"""
from __future__ import annotations

import contextlib
import io
import time
import ipaddress
import json
import os
import re
import socket
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import connectors
from msv.collect import hostinfo
from msv.machines import setup

# Champs d'une machine réglables depuis la page (le reste du fichier est gardé tel quel)
FLAGS = ("off", "gateway", "npm", "npm_only", "vm", "disabled")
TEXT = ("name", "role", "ssh", "adguard", "adguard_sync", "health", "os", "icon")
PAGE = TEXT + FLAGS + ("health_sources", "stopped_ok", "temp_warn_c", "disk_warn_pct", "disk_crit_pct", "mem_warn_pct", "mem_crit_pct")   # every field the Machines page (and machines_config) may set
LIMIT_LABELS = {"disk_warn_pct": "seuil disque (à surveiller)", "disk_crit_pct": "seuil disque (critique)",
                "mem_warn_pct": "seuil mémoire (à surveiller)", "mem_crit_pct": "seuil mémoire (critique)"}
TEMP_WARN_MIN, TEMP_WARN_MAX = 50, 110   # °C: a processor warning threshold a machine may set for itself (default: health.TEMP_WARN_C)
STOPPED_OK_MAX = 30  # containers that may stay stopped, per machine
HEALTH_SOURCES = ("ssh", "agent", "beszel")  # priorité de lecture de la santé (health.py : source_order)
NAME_MAX = 80
ROLE_MAX = 200  # le rôle est une liste d'étiquettes (« Docker, SSH, partage SMB ») gardée en texte


class MachineError(Exception):
    """Refus lisible (IP invalide, alias inconnu…)."""


def _meta() -> dict:
    """services-meta.json ; installation neuve (fichier absent) : vide, créé à la première machine enregistrée."""
    if not setup.META.exists():
        return {"machines": {}, "process_hosts": {}, "extra": []}
    return json.loads(setup.META.read_text(encoding="utf-8"))


def aliases() -> list[dict]:
    """Alias SSH connus du collecteur (~/.ssh/config), pour la liste de choix de la page."""
    out = []
    for host, s in hostinfo.ssh_config().items():
        try:
            ip = socket.gethostbyname(host)
        except OSError:
            ip = None
        out.append({"alias": s["alias"], "host": host, "ip": ip, "user": s.get("user"), "port": s.get("port")})
    return sorted(out, key=lambda a: a["alias"])


def listing() -> dict:
    meta = _meta()
    return {"machines": meta.get("machines", {}), "process_hosts": meta.get("process_hosts", {}),
            "aliases": aliases(), "ssh_conf": setup.SSH_CONF}


def _resolve(target: str) -> tuple[str, str | None]:
    """(IP, alias SSH) d'une IP, d'un nom ou d'un alias."""
    target = (target or "").strip()
    if not target or not re.fullmatch(r"[\w.:-]{1,253}", target):
        raise MachineError("IP, nom ou alias SSH attendu")
    host = next((h for h, s in hostinfo.ssh_config().items() if s["alias"] == target), target)
    try:
        ip = socket.gethostbyname(host)
    except OSError:
        raise MachineError(f"{target} : ni IP, ni nom connu, ni alias de {setup.SSH_CONF}") from None
    alias = target if host != target else setup.ssh_aliases().get(ip)
    return ip, alias


default_gateway = hostinfo.default_gateway  # la détection de l'ajout et celle de la collecte partagent le même code


WINDOWS_SERVER_NAME = re.compile(r"WIN-[A-Z0-9]{11}", re.I)   # the host name Windows Server generates itself


def detect(target: str) -> dict:
    """Proposition pour une machine, nouvelle ou déjà déclarée (ses réglages gardés, détection refaite)."""
    ip, alias = _resolve(target)
    known = _meta().get("machines", {}).get(ip)
    up = subprocess.run(["ping", "-c1", "-W1", ip], capture_output=True).returncode == 0
    dns, hints = setup.identify(ip)
    m = dict(known or {"name": dns or alias or ip, "role": hints[0] if hints else "", "ssh": None})
    notes, found, detected = [], [], []
    kind = None
    if alias and not m.get("gateway"):
        kind, r = setup.ssh_os(alias)
        if kind == "windows":
            m.update(ssh=None, os="windows", health=alias)
            notes.append(f"✓ Windows joignable par {alias} : santé activée")
        elif kind == "linux":
            conts = setup.containers(alias)
            m["ssh"] = alias
            roles = setup.roles(conts or [])
            m.update(roles)
            if setup.is_vm(alias) and "vm" not in m:
                m["vm"] = True
                detected.append("vm")
            notes.append(f"✓ SSH {alias} : Linux" + (f", Docker {len(conts)} conteneurs" if conts is not None
                                                      else " ; Docker inaccessible (absent, ou compte hors du groupe docker)"))
            if "adguard" not in m and (ag := setup.find_adguard(alias, conts)):
                m["adguard"] = ag
                notes.append(f"✓ AdGuard Home : {ag}")
            found = _connectors(ip, conts or [])
        else:
            notes.append("⚠ " + setup.ssh_why(alias, r))
    elif "SSH" in hints:
        notes.append(f"⚠ accepte SSH, mais aucun alias ne la vise : en ajouter un dans {setup.SSH_CONF}")
    if "gateway" not in m and ip == default_gateway():
        m["gateway"] = True
        detected.append("gateway")
    notes += [{"gateway": "✓ Passerelle détectée (route par défaut de l'hôte) : cochée, à confirmer",
               "npm": "✓ Nginx Proxy Manager trouvé dans ses conteneurs : « Héberge NPM » coché, à confirmer",
               "vm": "✓ Machine virtuelle détectée : « Machine virtuelle » cochée, à confirmer"}[f] for f in detected]
    web = []
    if kind != "linux":
        with ThreadPoolExecutor(len(setup.WEB_PORTS)) as px:
            web = [{"port": p, "scheme": setup.WEB_PORTS[p][0], "label": setup.WEB_PORTS[p][1]}
                   for p, o in zip(setup.WEB_PORTS, px.map(lambda p: setup._open(ip, p), setup.WEB_PORTS)) if o]
        if "off" not in m and ("Windows (RDP)" in hints or m.get("os") == "windows") and not WINDOWS_SERVER_NAME.fullmatch(dns or ""):
            m["off"] = True  # poste souvent éteint : proposé, modifiable ; jamais pour un serveur Windows, qui doit rester allumé
    return {"ip": ip, "alias": alias, "up": up, "dns": dns, "hints": hints, "known": known is not None,
            "machine": m, "notes": notes, "detected": detected, "connectors": found, "web": web}

REDETECT_OFF = ("vm", "gateway")  # drapeaux que la détection peut retirer ; « off » (poste souvent éteint) reste un choix de l'utilisateur ; « npm » est posé par la collecte, jamais proposé


def role_tags(role: str | None) -> list[str]:
    """Rôle (texte « a, b, c ») en étiquettes."""
    return [t.strip() for t in (role or "").split(",") if t.strip()]


def auto_labels() -> set[str]:
    """Étiquettes que la recherche réseau écrit elle-même (indices de ports, applis connues) : seules celles-là sont retirées à la
    redétection, jamais un texte saisi à la main. Y figurent aussi les anciennes formes (« NAS Synology » pour le port 5000)."""
    from msv.machines import known_apps
    from msv.collect import netscan
    return ({*netscan.HINT_PORTS.values(), "SSH", "web :80", "web :443", "NAS Synology"} | {a.label for a in known_apps.APPS}
            | {f"SSH :{p}" for p in netscan.SSH_PORTS})


def role_changes(current: str | None, seen: list[str]) -> tuple[list[str], list[str]]:
    """(étiquettes à ajouter, à retirer) : ajoute ce que la détection voit (applis, ports par défaut joignables) ; retire une étiquette
    automatique que la détection ne voit plus, ou un « port N » / « web :N … » générique. Les étiquettes saisies à la main restent."""
    have = role_tags(current)
    low = {t.lower() for t in have}
    seen_low = {t.lower() for t in seen}
    add = [t for t in seen if t.lower() not in low]
    auto = {a.lower() for a in auto_labels()}
    generic = re.compile(r"^(port \d+|web :\d+( · .*)?)$", re.I)
    remove = [t for t in have if t.lower() not in seen_low and (t.lower() in auto or (generic.match(t) and t.lower() not in ("web :80", "web :443")))]
    return add, remove


def _seen_tags(ip: str, ssh_port_hint: bool = True) -> list[str]:
    """Étiquettes d'après la détection du réseau (applis reconnues, puis ports par défaut joignables), sans rien écrire."""
    from msv.collect import netscan
    d = netscan._describe(ip, ssh=netscan.ssh_ports())
    return list(dict.fromkeys([*d["apps"], *d["hints"]]))


def _redetect_one(ip: str, m: dict, process_hosts: dict) -> dict:
    """Écarts d'une machine déclarée : détection de detect(), drapeaux confirmés de hostinfo, ports hors Docker du process connector."""
    out = {"ip": ip, "name": m.get("name") or ip, "verifiable": False, "note": None,
           "flags_on": [], "flags_off": [], "os": None, "process": False, "ports": [], "role_add": [], "role_remove": []}
    try:
        d = detect(ip)
    except MachineError as e:
        out["note"] = str(e)
        return out
    if not d["up"]:
        out["note"] = "injoignable : non vérifiable"
        return out
    out["verifiable"] = True
    if not m.get("os") and (d["machine"].get("os") == "windows" or "Windows (RDP)" in d["hints"]):
        out["os"] = "windows"
    ssh = m.get("ssh")
    info = hostinfo.host_info(ssh) if ssh else None  # None : pas d'accès SSH ou machine muette, rien n'est retiré
    flags = set(hostinfo.detected_flags(ip, info, {**m, **({"os": out["os"]} if out["os"] else {})}))
    out["flags_on"] = [f for f in FLAGS if f in flags and not m.get(f) and f != "npm"]
    if info is not None:  # fiable : lu par SSH et la machine répond
        out["flags_off"] = [f for f in REDETECT_OFF if m.get(f) and f not in flags]
        try:
            from connectors.process import listening_processes
            ports = listening_processes(ssh)
        except connectors.ConnectorError:
            ports = {}
        out["ports"] = [{"port": p, "name": v["name"]} for p, v in sorted(ports.items()) if v["lan"]]
        out["process"] = bool(out["ports"]) and ip not in process_hosts
    try:
        out["role_add"], out["role_remove"] = role_changes(m.get("role"), _seen_tags(ip))
    except OSError:
        pass  # détection réseau indisponible : le rôle n'est pas touché
    if not (out["flags_on"] or out["flags_off"] or out["os"] or out["process"] or out["role_add"] or out["role_remove"]):
        out["note"] = "rien à changer"
    return out


def redetect(ips: list[str] | None = None) -> dict:
    """Détection refaite sans rien écrire pour les machines déclarées non désactivées (ou celles de la liste) : les écarts
    à confirmer (drapeaux à allumer ou à éteindre, système, services hors Docker). L'écriture passe par save()."""
    meta = _meta()
    machines, ph = meta.get("machines", {}), meta.get("process_hosts", {})
    if ips is not None:
        unknown = [i for i in ips if i not in machines]
        if unknown:
            raise MachineError(f"machine inconnue : {unknown[0]}")
    todo = [(ip, m) for ip, m in machines.items() if not m.get("disabled") and (ips is None or ip in ips)]
    with ThreadPoolExecutor(max(1, min(4, len(todo)))) as px:
        res = list(px.map(lambda t: _redetect_one(t[0], t[1], ph), todo))
    return {"machines": res, "changes": sum(1 for r in res if r["note"] is None)}


def _connectors(ip: str, conts: list) -> list[dict]:
    """Services connus parmi les conteneurs (NPM, Beszel, Uptime Kuma…) : réglages proposés, à finir
    dans Réglages → Connecteurs (compte, clé)."""
    from msv.core.config import CFG
    try:
        have = connectors.instances(CFG)
    except connectors.ConnectorError:
        have = []
    # Déjà réglé : NPM par machine (plusieurs possibles), les autres par type (une instance suffit)
    done = {c.type for c in have if c.type != "npm" or ip in str(c.conf.get("url", "")) or c.conf.get("ip") == ip}
    out = []
    for name, image, ports in conts:
        for cls in connectors.for_image(image):
            if cls.type in ("adguard", "docker", "process") or cls.type in done:
                continue
            done.add(cls.type)  # un seul par type (ex. dozzle et dozzle-agent)
            pairs = [(int(h), int(c)) for h, c in re.findall(r"(?:[\d.]+:)?(\d+)->(\d+)/tcp", ports)]
            out.append({"type": cls.type, "label": cls.label, "container": name,
                        "proposed": cls.discover(image, ip, pairs) or {}})
    return out


def _clean(m: dict) -> dict:
    out = {}
    for k in TEXT:
        v = m.get(k)
        if v in (None, "") or (k == "ssh" and v is False):
            continue
        limit = ROLE_MAX if k == "role" else NAME_MAX
        if not isinstance(v, str) or len(v) > limit:
            raise MachineError(f"« {k} » : texte de {limit} caractères au plus")
        out[k] = v.strip()
    for k in FLAGS:
        if m.get(k):
            out[k] = True
    if m.get("health") is False:
        out["health"] = False
    if out.get("icon") and not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", out["icon"]):  # clé d'icône choisie à la main (front/src/lib/machineIcons.ts)
        raise MachineError("icône : une clé en minuscules, chiffres et tirets")
    src = m.get("health_sources")
    if src:
        if not isinstance(src, list) or any(x not in HEALTH_SOURCES for x in src):
            raise MachineError("priorité de la santé : ssh, agent, beszel")
        out["health_sources"] = list(dict.fromkeys(src))
    ok = m.get("stopped_ok")
    if ok:
        if not isinstance(ok, list) or len(ok) > STOPPED_OK_MAX or any(not isinstance(x, str) or not re.fullmatch(r"[\w][\w.-]{0,127}", x.strip()) for x in ok):
            raise MachineError(f"conteneurs autorisés à rester arrêtés : {STOPPED_OK_MAX} noms au plus (lettres, chiffres, _ . -)")
        out["stopped_ok"] = list(dict.fromkeys(x.strip() for x in ok))
    t = m.get("temp_warn_c")
    if t not in (None, ""):
        if isinstance(t, bool) or not str(t).strip().isdigit() or not TEMP_WARN_MIN <= int(t) <= TEMP_WARN_MAX:
            raise MachineError(f"seuil de température : un entier entre {TEMP_WARN_MIN} et {TEMP_WARN_MAX} °C")
        out["temp_warn_c"] = int(t)
    for key, label in LIMIT_LABELS.items():   # disk and memory limits, in % used
        v = m.get(key)
        if v not in (None, ""):
            if isinstance(v, bool) or not str(v).strip().isdigit() or not 1 <= int(v) <= 100:
                raise MachineError(f"{label} : un entier entre 1 et 100 %")
            out[key] = int(v)
    for kind in ("disk", "mem"):
        w, c = out.get(f"{kind}_warn_pct"), out.get(f"{kind}_crit_pct")
        if w and c and w >= c:
            raise MachineError(f"{LIMIT_LABELS[kind + '_warn_pct']} : doit rester sous le seuil critique")
    if not out.get("name"):
        raise MachineError("nom requis")
    known = {a["alias"] for a in aliases()} | {"local"}
    for k in ("ssh",) + (("health",) if out.get("os") == "windows" else ()):
        if isinstance(out.get(k), str) and out[k] not in known:
            raise MachineError(f"alias SSH « {out[k]} » absent de {setup.SSH_CONF}")
    out.setdefault("ssh", False if m.get("ssh") is False else None)   # False : coupé à la main, jamais réactivé seul (adopt_ssh)
    return out


def adopt_ssh(found: dict[str, str]) -> list[str]:
    """Interrupteur SSH jamais réglé (absent ou None), accès trouvé dans la config SSH pour cette IP et connexion par clé réussie
    (`found` : {ip: alias}, d'après le passage) : l'accès est enregistré tout seul. Jamais une machine coupée à la main (False),
    désactivée ou Windows (lue par l'agent). Rend les IP activées."""
    meta = _meta()
    done = []
    for ip, alias in found.items():
        m = meta.get("machines", {}).get(ip)
        if not m or m.get("ssh") is False or m.get("ssh") or m.get("disabled") or m.get("os") == "windows":
            continue
        m["ssh"] = alias
        done.append(ip)
    if done:
        with contextlib.redirect_stdout(io.StringIO()):
            setup.save(setup.META, meta)
    return done


def interesting(h: dict) -> bool:
    """Same rule as the page (front lib/netScan.ts interesting()): answers SSH, has a recognised app or a service other than a plain
    web page (share, remote desktop, Veeam...). A connected object with only a web page is not."""
    return bool(h.get("ssh_port")) or bool(h.get("apps")) or any(not x.startswith(("web", "port ")) for x in h.get("hints") or [])


def adopt_found(found: list[dict], skip: set[str]) -> list[str]:
    """Auto mode: machines of the last network search worth following (interesting()), not declared yet and not in `skip`
    (ignored, or already added once by the auto mode and removed by hand since: never added again). Returns the IPs added."""
    known = known_ips()
    done = []
    for h in found:
        if h["ip"] in known or h["ip"] in skip or not interesting(h):
            continue
        role = ", ".join(dict.fromkeys([*(h.get("apps") or []), *(h.get("hints") or [])]))[:ROLE_MAX]
        save(h["ip"], {"name": (h.get("name") or h["ip"])[:NAME_MAX], "role": role})
        done.append(h["ip"])
    return done


def _alias_is_root(alias: str) -> bool:
    """True when the SSH alias connects as root (the only account that sees every listening process)."""
    return any(s.get("alias") == alias and s.get("user") == "root" for s in hostinfo.ssh_config().values())


def _update_process_host(meta: dict, ip: str, old: dict, new: dict, process: bool | None) -> None:
    """process_hosts follows the « read the listening ports » choice; switching SSH on with a root alias turns it on by default (ss needs root)."""
    ph = meta.setdefault("process_hosts", {})
    if new.get("ssh") and not old.get("ssh") and _alias_is_root(new["ssh"]):
        process = True
    if process is None:
        return
    if process and new.get("ssh"):
        ph[ip] = new["ssh"]
    else:
        ph.pop(ip, None)


def _add_extra(meta: dict, ip: str, new: dict, extra: list[dict] | None) -> None:
    """Web services to follow on this machine, added once per port."""
    have = {(x.get("ip"), x.get("port")) for x in meta.setdefault("extra", [])}
    for w in extra or []:
        if (ip, int(w["port"])) not in have:
            meta["extra"].append({"name": str(w.get("name") or f"{new['name']} · {w.get('label', '')}")[:NAME_MAX],
                                  "ip": ip, "port": int(w["port"]), "scheme": "https" if w.get("scheme") == "https" else "http"})


def save(ip: str, m: dict, process: bool | None = None, extra: list[dict] | None = None) -> dict:
    """Machine écrite (réglages hors page gardés : « health » objet, notes…). process : lire aussi ses
    ports en écoute (process_hosts, root requis sur la machine). extra : services web à suivre."""
    try:
        ip = str(ipaddress.ip_address(ip))
    except ValueError:
        raise MachineError("IP invalide") from None
    meta = _meta()
    machines = meta.setdefault("machines", {})
    old = machines.get(ip, {})
    new = _clean(m)
    keep = {k: v for k, v in old.items() if k not in PAGE}  # réglages hors page (ex. health détaillé)
    machines[ip] = {**keep, **new}
    if old.get("ssh") != new.get("ssh"):
        expire_inventory(ip)
    _update_process_host(meta, ip, old, new, process)
    _add_extra(meta, ip, new, extra)
    with contextlib.redirect_stdout(io.StringIO()):
        setup.save(setup.META, meta)
    return machines[ip]


def patch(ip: str, fields: dict) -> dict:
    """Change some fields of a declared machine and keep the others: save() takes the whole page record, so a script that
    only means to set one option would drop the role or the SSH access. A field set to null is removed."""
    try:
        ip = str(ipaddress.ip_address(ip))
    except ValueError:
        raise MachineError("IP invalide") from None
    old = _meta().get("machines", {}).get(ip)
    if old is None:
        raise MachineError("machine non déclarée : l'enregistrer d'abord")
    if not isinstance(fields, dict) or not fields:
        raise MachineError("champs à changer : " + ", ".join(PAGE))
    if bad := sorted(set(fields) - set(PAGE)):
        raise MachineError("champ inconnu : " + ", ".join(bad))
    merged = {**{k: v for k, v in old.items() if k in PAGE}, **fields}
    return save(ip, {k: v for k, v in merged.items() if v is not None})


def _rewrite_data(change) -> None:
    """Applies `change(data)` to the published data.json (it returns whether it touched anything) and writes the file back atomically.
    Nothing to do before the first collection."""
    from msv.core import config
    p = Path(config.CFG["web_dir"]) / "data.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if not change(data):
        return
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
    os.chmod(tmp, p.stat().st_mode & 0o777)
    tmp.replace(p)


def publish(ip: str, m: dict) -> None:
    """Name, role tags, icon and « not followed » written into the published data.json at once, so the pages show them without waiting
    for the next collection (which rewrites the whole file from services-meta.json anyway)."""
    def change(data: dict) -> bool:
        hit = False
        for x in data.get("machine_list") or []:
            if x.get("ip") == ip:
                x["name"], x["role"], x["icon"], x["disabled"], hit = m.get("name") or x.get("name"), m.get("role") or "", m.get("icon") or None, bool(m.get("disabled")), True
        if ip in (data.get("machines") or {}):
            data["machines"][ip].update(name=m.get("name") or data["machines"][ip].get("name"), role=m.get("role") or "")
            hit = True
        return hit
    _rewrite_data(change)


def unpublish(ip: str) -> None:
    """A removed machine leaves the published data.json at once, so the pages stop listing it instead of waiting for the next collection."""
    def change(data: dict) -> bool:
        before = len(data.get("machine_list") or [])
        if before:
            data["machine_list"] = [x for x in data["machine_list"] if x.get("ip") != ip]
        gone = (data.get("machines") or {}).pop(ip, None) is not None
        return gone or len(data.get("machine_list") or []) != before
    _rewrite_data(change)


def expire_inventory(ip: str | None = None) -> None:
    """Accès SSH changé : l'inventaire Docker et machines (cache 2 h) est relu à la prochaine collecte, au lieu
    de garder un relevé fait avec l'ancien accès (ex. « SSH refusé » d'avant l'autorisation de la clé). ip : cette machine
    seulement (les autres restent en cache) ; sans ip, tout est relu."""
    from msv.core import inventory_cache
    from msv.core.config import CFG
    inventory_cache.mark_stale(str(Path(CFG["cache_dir"]) / "docker.json"), ip)


def delete(ip: str) -> None:
    meta = _meta()
    if ip not in meta.get("machines", {}):
        raise MachineError("machine inconnue")
    del meta["machines"][ip]
    meta.get("process_hosts", {}).pop(ip, None)
    with contextlib.redirect_stdout(io.StringIO()):
        setup.save(setup.META, meta)


def check(ip: str) -> dict:
    """Vérification de setup.py pour cette machine : lignes affichées et nombre d'échecs."""
    ip = resolve(ip)
    m = _meta().get("machines", {})[ip]
    agent_lines, agent_failed = _check_agent(ip, m)
    has_ssh = bool(m.get("ssh") or isinstance(m.get("health"), str))
    if agent_lines and not has_ssh:  # lu par son agent seulement (PC Windows) : rien à tester en SSH
        return {"lines": agent_lines, "failed": agent_failed}
    lines = agent_lines + _ssh_check_lines(ip, m)
    if not setup.FAILED:  # accès SSH qui répond : l'inventaire raté d'avant ne doit pas rester en cache (2 h)
        expire_inventory(ip)
    return {"lines": lines, "failed": len(setup.FAILED) + agent_failed}


def _ssh_check_lines(ip: str, m: dict) -> list[str]:
    """Lines of setup.py's access check for one machine (setup.FAILED counts the failures); a closed port is explained."""
    buf = io.StringIO()
    setup.FAILED.clear()
    with contextlib.redirect_stdout(buf):
        setup.check_machine(ip, m, setup.ssh_aliases())
    lines = [ln.strip() for ln in buf.getvalue().splitlines() if ln.strip()]
    if any("Connection refused" in ln for ln in lines):   # port fermé : ce n'est pas la clé, souvent un sshd sur un autre port
        port = scan_ssh_port(ip)
        alias = setup.ssh_aliases().get(ip)
        used = _alias_port(alias) if alias else None
        if port and used and port != used:
            lines.append(f"✗ Le port SSH de l'alias ({used}) est fermé ; la recherche réseau a vu SSH sur le port {port} : corriger le port, puis tester de nouveau")
        else:
            lines.append(f"✗ Connexion refusée au port {used or 22} : sshd n'écoute pas là (ou un pare-feu bloque)")
        setup.FAILED.append(lines[-1])
    return lines


def probe_alias(ip: str, windows: bool = False) -> dict:
    """Test of the SSH access of a machine NOT declared yet (add page, before the final button): the alias of this IP is
    checked as setup.py would, without writing anything. Windows: the health access (PowerShell) is what is tested."""
    try:
        ip = str(ipaddress.ip_address(ip))
    except ValueError:
        raise MachineError("IP invalide") from None
    alias = _alias_for(ip)
    if not alias:
        raise MachineError("aucun accès SSH ne vise cette machine : préparer l'accès d'abord")
    m = {"name": ip, "os": "windows", "health": alias} if windows else {"name": ip, "ssh": alias}
    lines = _ssh_check_lines(ip, m)
    return {"lines": lines, "failed": len(setup.FAILED)}


def remove_alias(ip: str) -> dict:
    """Removes the « Host m-<ip> » block written by add_alias when the add is cancelled. An alias written by hand, or
    one still used by a declared machine, is left alone: {removed: False}."""
    try:
        ip = str(ipaddress.ip_address(ip))
    except ValueError:
        raise MachineError("IP invalide") from None
    alias = _alias_for(ip)
    if not alias or not alias.startswith("m-"):
        return {"removed": False}
    if any(alias in (c.get("ssh"), c.get("health")) for c in _meta().get("machines", {}).values()):
        return {"removed": False}
    conf = Path(setup.SSH_CONF)
    try:
        lines = conf.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {"removed": False}
    out, inside = [], False
    for ln in lines:
        head = ln.split()
        if head[:1] == ["Host"]:
            inside = head[1:] == [alias]
            if inside and out and out[-1].strip() == "# Machine trouvée par la recherche réseau":
                out.pop()   # the comment line add_alias writes above the block
        if not inside:
            out.append(ln)
    while out and not out[-1].strip():
        out.pop()
    conf.write_text("\n".join(out) + "\n" if out else "", encoding="utf-8")  # NOSONAR S2083: path from the config, never from a request
    conf.chmod(0o600)
    return {"removed": True}


def _check_agent(ip: str, m: dict, store=None) -> tuple[list[str], int]:
    """Lignes de vérification de l'agent de la machine (état, dernier relevé) ; vide si elle n'en a pas."""
    try:
        if store is None:
            from msv.machines.agents import Agents
            from msv.core.auth import db_path
            from msv.core.config import CFG
            store = Agents(db_path(CFG))
        a = next((x for x in store.listing() if x["ip"] == ip and x["state"] != "révoqué"), None)
    except Exception:  # base absente ou illisible : pas de ligne agent
        return [], 0
    if a is None:
        return [], 0
    name = m.get("name", ip)
    age = f"il y a {max(1, round((time.time() - a['last_seen']) / 60))} min" if a["last_seen"] else None
    if a["state"] == "actif":
        return [f"✓ {name} : agent actif, dernier relevé {age} (toutes les {a['interval'] // 60} min)"], 0
    if a["state"] == "silencieux":
        return [f"✗ {name} : l'agent ne répond plus (dernier relevé {age}) : PC éteint, ou tâche « MyServices Agent » arrêtée"], 1
    return [f"⚠ {name} : agent créé, aucun relevé reçu : coller la commande d'installation sur le PC (Réglages → Connecteurs → Agents)"], 1


def resolve(key: str) -> str:
    """IP d'une machine d'après son IP ou son nom (la page envoie parfois le nom du connecteur, qui est celui de la machine) ; MachineError sinon."""
    machines = _meta().get("machines", {})
    if key in machines:
        return key
    hit = [ip for ip, v in machines.items() if v.get("name") == key]
    if len(hit) != 1:
        raise MachineError("machine inconnue" if not hit else f"plusieurs machines s'appellent « {key} » : utiliser leur IP")
    return hit[0]


def scan_ssh_port(ip: str) -> int | None:
    """Port SSH vu par la dernière recherche réseau pour cette IP (None si inconnu)."""
    try:
        from msv.core import config
        from msv.collect import netscan
        f = Path(config.CFG["state_dir"]) / "network-scan.json"
        found = netscan.state(f).get("found", []) if f.exists() else []
    except Exception:  # noqa: BLE001 : un détail de diagnostic ne casse jamais la vérification
        return None
    port = next((h.get("ssh_port") for h in found if h.get("ip") == ip), None)
    return int(port) if isinstance(port, int) else None


def known_ips() -> set[str]:
    """IP des machines déjà déclarées (la recherche réseau ne les ping pas)."""
    return set(_meta().get("machines", {}))


_ALIAS_USER = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,31}$")  # Linux (minuscules) comme Windows (Administrateur, Jean.Dupont)


def _alias_port(alias: str) -> int | None:
    """Port d'un alias de la config SSH de l'app (None si illisible)."""
    try:
        text = Path(setup.SSH_CONF).read_text(encoding="utf-8")
    except OSError:
        return None
    block = re.search(rf"^Host\s+{re.escape(alias)}\s*$(.*?)(?=^Host\s|\Z)", text, re.M | re.S)
    m = re.search(r"^\s*Port\s+(\d+)", block.group(1), re.M) if block else None
    return int(m.group(1)) if m else 22


def _set_alias_user(alias: str, user: str, port: int, host: str | None = None) -> bool:
    """Compte, port (et adresse, si donnée) d'un alias créé par la page (« m-<ip> ») changés dans la config SSH de l'app ; un alias
    écrit à la main n'est jamais modifié. True si le fichier a changé (ex. alias créé en root par défaut pour un PC Windows, à passer
    au compte Windows)."""
    if not alias.startswith("m-"):
        return False
    conf = Path(setup.SSH_CONF)
    try:
        lines = conf.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    out, inside = [], False
    for ln in lines:
        head = ln.split()
        if head[:1] == ["Host"]:
            inside = head[1:] == [alias]
        elif inside and head[:1] == ["User"]:
            ln = f"    User {user}"
        elif inside and head[:1] == ["Port"]:
            ln = f"    Port {port}"
        elif inside and host and head[:1] == ["HostName"]:
            ln = f"    HostName {host}"
        out.append(ln)
    if out == lines:
        return False
    conf.write_text("\n".join(out) + "\n", encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
    conf.chmod(0o600)
    return True


_ALIAS_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$")   # an IP or a DNS name (a server reached through another address, or a domain)


def _alias_for(ip: str) -> str | None:
    """Alias SSH of a declared machine: the one its settings name (ssh or health), when it exists in the SSH config, otherwise the first
    alias whose HostName resolves to its IP. A machine reached through another address (HostName = a domain) is found by the first way."""
    m = _meta().get("machines", {}).get(ip) or {}
    named = next((x for x in (m.get("ssh"), m.get("health")) if isinstance(x, str) and x and x != "local"), None)
    if named and any(s["alias"] == named for s in hostinfo.ssh_config().values()):
        return named
    return setup.ssh_aliases().get(ip)


def add_alias(ip: str, user: str = "root", port: int = 22, host: str | None = None) -> dict:
    """Alias SSH pour une machine trouvée (clé de l'app, version Docker) : écrit un bloc « Host » dans la config SSH
    de l'app et rend {alias, created}. Déjà un alias qui vise cette IP : il est repris (compte, port et adresse mis à jour s'il
    a été écrit par la page). host : adresse SSH quand elle diffère de l'IP de la machine (nom DNS, autre réseau)."""
    if not setup.DOCKER:
        raise MachineError("disponible dans la version Docker (la config SSH de l'installation classique reste à la main)")
    try:
        ip = str(ipaddress.ip_address(ip))
    except ValueError:
        raise MachineError("IP invalide") from None
    if not _ALIAS_USER.fullmatch(user or ""):   # fullmatch: « $ » would let a final newline through into the SSH config
        raise MachineError("compte SSH : lettres minuscules, chiffres, . _ - (32 au plus)")
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise MachineError("port SSH invalide")
    host = (host or "").strip() or ip
    if not _ALIAS_HOST.fullmatch(host):
        raise MachineError("adresse SSH : une IP ou un nom DNS")
    if alias := _alias_for(ip):
        return {"alias": alias, "created": False, "updated": _set_alias_user(alias, user, port, host)}
    alias = "m-" + ip.replace(".", "-")
    conf = Path(setup.SSH_CONF)
    text = conf.read_text(encoding="utf-8") if conf.exists() else ""
    block = (f"\n# Machine trouvée par la recherche réseau\nHost {alias}\n    HostName {host}\n    User {user}\n    Port {port}\n"
             "    IdentityFile ~/.ssh/myservices\n    IdentityFile ~/.ssh/myservices_ecdsa\n    IdentitiesOnly yes\n    StrictHostKeyChecking accept-new\n")
    conf.write_text(text + block, encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
    conf.chmod(0o600)
    return {"alias": alias, "created": True}
