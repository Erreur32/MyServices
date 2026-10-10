"""Réglages → Machines : équivalent graphique de « setup.py --add », sans question.

  detect(cible)  ping, ports, nom DNS, SSH (Linux ou Windows), Docker, AdGuard, VM, services web, connecteurs
                 reconnus d'après les images : une proposition, rien n'est écrit
  save(ip, m)    écrit la machine dans services-meta.json (autres machines et clés intouchées)
  delete(ip)     la retire (et de process_hosts)
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
import re
import socket
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import connectors
import hostinfo
import setup

# Champs d'une machine réglables depuis la page (le reste du fichier est gardé tel quel)
FLAGS = ("off", "gateway", "npm", "npm_only", "vm", "disabled")
TEXT = ("name", "role", "ssh", "adguard", "adguard_sync", "health", "os")
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
            if roles.get("npm") and not known:
                detected.append("npm")
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
        if "off" not in m and ("Windows (RDP)" in hints or m.get("os") == "windows"):
            m["off"] = True  # poste souvent éteint : proposé, modifiable
    return {"ip": ip, "alias": alias, "up": up, "dns": dns, "hints": hints, "known": known is not None,
            "machine": m, "notes": notes, "detected": detected, "connectors": found, "web": web}


def _connectors(ip: str, conts: list) -> list[dict]:
    """Services connus parmi les conteneurs (NPM, Beszel, Uptime Kuma…) : réglages proposés, à finir
    dans Réglages → Connecteurs (compte, clé)."""
    from config import CFG
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
        if v in (None, ""):
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
    src = m.get("health_sources")
    if src:
        if not isinstance(src, list) or any(x not in HEALTH_SOURCES for x in src):
            raise MachineError("priorité de la santé : ssh, agent, beszel")
        out["health_sources"] = list(dict.fromkeys(src))
    if not out.get("name"):
        raise MachineError("nom requis")
    known = {a["alias"] for a in aliases()} | {"local"}
    for k in ("ssh",) + (("health",) if out.get("os") == "windows" else ()):
        if isinstance(out.get(k), str) and out[k] not in known:
            raise MachineError(f"alias SSH « {out[k]} » absent de {setup.SSH_CONF}")
    out.setdefault("ssh", None)
    return out


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
    keep = {k: v for k, v in old.items() if k not in TEXT + FLAGS + ("health_sources",)}  # réglages hors page (ex. health détaillé)
    machines[ip] = {**keep, **new}
    if old.get("ssh") != new.get("ssh"):
        expire_inventory(ip)
    if process is not None:
        ph = meta.setdefault("process_hosts", {})
        if process and new.get("ssh"):
            ph[ip] = new["ssh"]
        else:
            ph.pop(ip, None)
    have = {(x.get("ip"), x.get("port")) for x in meta.setdefault("extra", [])}
    for w in extra or []:
        if (ip, int(w["port"])) not in have:
            meta["extra"].append({"name": str(w.get("name") or f"{new['name']} · {w.get('label', '')}")[:NAME_MAX],
                                  "ip": ip, "port": int(w["port"]), "scheme": "https" if w.get("scheme") == "https" else "http"})
    with contextlib.redirect_stdout(io.StringIO()):
        setup.save(setup.META, meta)
    return machines[ip]


def expire_inventory(ip: str | None = None) -> None:
    """Accès SSH changé : l'inventaire Docker et machines (cache 2 h) est relu à la prochaine collecte, au lieu
    de garder un relevé fait avec l'ancien accès (ex. « SSH refusé » d'avant l'autorisation de la clé). ip : cette machine
    seulement (les autres restent en cache) ; sans ip, tout est relu."""
    import inventory_cache
    from config import CFG
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
    machines = _meta().get("machines", {})
    if ip not in machines:  # la page envoie le nom du connecteur (= nom de la machine) quand elle n'a pas l'IP
        ip = next((k for k, v in machines.items() if v.get("name") == ip), ip)
    m = machines.get(ip)
    if m is None:
        raise MachineError("machine inconnue")
    agent_lines, agent_failed = _check_agent(ip, m)
    has_ssh = bool(m.get("ssh") or isinstance(m.get("health"), str))
    if agent_lines and not has_ssh:  # lu par son agent seulement (PC Windows) : rien à tester en SSH
        return {"lines": agent_lines, "failed": agent_failed}
    buf = io.StringIO()
    setup.FAILED.clear()
    with contextlib.redirect_stdout(buf):
        setup.check_machine(ip, m, setup.ssh_aliases())
    lines = agent_lines + [ln.strip() for ln in buf.getvalue().splitlines() if ln.strip()]
    if not setup.FAILED:  # accès SSH qui répond : l'inventaire raté d'avant ne doit pas rester en cache (2 h)
        expire_inventory(ip)
    return {"lines": lines, "failed": len(setup.FAILED) + agent_failed}


def _check_agent(ip: str, m: dict, store=None) -> tuple[list[str], int]:
    """Lignes de vérification de l'agent de la machine (état, dernier relevé) ; vide si elle n'en a pas."""
    try:
        if store is None:
            from agents import Agents
            from auth import db_path
            from config import CFG
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


def known_ips() -> set[str]:
    """IP des machines déjà déclarées (la recherche réseau ne les ping pas)."""
    return set(_meta().get("machines", {}))


_ALIAS_USER = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,31}$")  # Linux (minuscules) comme Windows (Administrateur, Jean.Dupont)


def _set_alias_user(alias: str, user: str, port: int) -> bool:
    """Compte et port d'un alias créé par la page (« m-<ip> ») changés dans la config SSH de l'app ; un alias écrit à la main n'est
    jamais modifié. True si le fichier a changé (ex. alias créé en root par défaut pour un PC Windows, à passer au compte Windows)."""
    if not alias.startswith("m-"):
        return False
    conf = Path(setup.SSH_CONF)
    try:
        lines = conf.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    out, inside, seen = [], False, {"user": False, "port": False}
    for ln in lines:
        head = ln.split()
        if head[:1] == ["Host"]:
            inside = head[1:] == [alias]
        elif inside and head[:1] == ["User"]:
            ln, seen["user"] = f"    User {user}", True
        elif inside and head[:1] == ["Port"]:
            ln, seen["port"] = f"    Port {port}", True
        out.append(ln)
    if out == lines:
        return False
    conf.write_text("\n".join(out) + "\n", encoding="utf-8")
    conf.chmod(0o600)
    return True


def add_alias(ip: str, user: str = "root", port: int = 22) -> dict:
    """Alias SSH pour une machine trouvée (clé de l'app, version Docker) : écrit un bloc « Host » dans la config SSH
    de l'app et rend {alias, created}. Déjà un alias qui vise cette IP : il est repris, rien n'est écrit."""
    if not setup.DOCKER:
        raise MachineError("disponible dans la version Docker (la config SSH de l'installation classique reste à la main)")
    try:
        ip = str(ipaddress.ip_address(ip))
    except ValueError:
        raise MachineError("IP invalide") from None
    if not _ALIAS_USER.match(user or ""):
        raise MachineError("compte SSH : lettres minuscules, chiffres, . _ - (32 au plus)")
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise MachineError("port SSH invalide")
    if alias := setup.ssh_aliases().get(ip):
        return {"alias": alias, "created": False, "updated": _set_alias_user(alias, user, port)}
    alias = "m-" + ip.replace(".", "-")
    conf = Path(setup.SSH_CONF)
    text = conf.read_text(encoding="utf-8") if conf.exists() else ""
    block = (f"\n# Machine trouvée par la recherche réseau\nHost {alias}\n    HostName {ip}\n    User {user}\n    Port {port}\n"
             "    IdentityFile ~/.ssh/myservices\n    IdentitiesOnly yes\n    StrictHostKeyChecking accept-new\n")
    conf.write_text(text + block, encoding="utf-8")
    conf.chmod(0o600)
    return {"alias": alias, "created": True}
