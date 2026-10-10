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
FLAGS = ("off", "gateway", "npm", "npm_only", "vm")
TEXT = ("name", "role", "ssh", "adguard", "adguard_sync", "health", "os")
NAME_MAX = 80


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


def detect(target: str) -> dict:
    """Proposition pour une machine, nouvelle ou déjà déclarée (ses réglages gardés, détection refaite)."""
    ip, alias = _resolve(target)
    known = _meta().get("machines", {}).get(ip)
    up = subprocess.run(["ping", "-c1", "-W1", ip], capture_output=True).returncode == 0
    dns, hints = setup.identify(ip)
    m = dict(known or {"name": dns or alias or ip, "role": hints[0] if hints else "", "ssh": None})
    notes, found = [], []
    kind = None
    if alias and not m.get("gateway"):
        kind, r = setup.ssh_os(alias)
        if kind == "windows":
            m.update(ssh=None, os="windows", health=alias)
            notes.append(f"✓ Windows joignable par {alias} : santé activée")
        elif kind == "linux":
            conts = setup.containers(alias)
            m["ssh"] = alias
            m.update(setup.roles(conts or []))
            if setup.is_vm(alias):
                m["vm"] = True
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
    web = []
    if kind != "linux":
        with ThreadPoolExecutor(len(setup.WEB_PORTS)) as px:
            web = [{"port": p, "scheme": setup.WEB_PORTS[p][0], "label": setup.WEB_PORTS[p][1]}
                   for p, o in zip(setup.WEB_PORTS, px.map(lambda p: setup._open(ip, p), setup.WEB_PORTS)) if o]
        if "off" not in m and ("Windows (RDP)" in hints or m.get("os") == "windows"):
            m["off"] = True  # poste souvent éteint : proposé, modifiable
    return {"ip": ip, "alias": alias, "up": up, "dns": dns, "hints": hints, "known": known is not None,
            "machine": m, "notes": notes, "connectors": found, "web": web}


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
        if not isinstance(v, str) or len(v) > NAME_MAX:
            raise MachineError(f"« {k} » : texte de {NAME_MAX} caractères au plus")
        out[k] = v.strip()
    for k in FLAGS:
        if m.get(k):
            out[k] = True
    if m.get("health") is False:
        out["health"] = False
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
    keep = {k: v for k, v in old.items() if k not in TEXT + FLAGS}  # réglages hors page (ex. health détaillé)
    machines[ip] = {**keep, **new}
    if old.get("ssh") != new.get("ssh"):
        expire_inventory()
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


def expire_inventory() -> None:
    """Accès SSH changé : l'inventaire Docker et machines (cache 2 h) est relu à la prochaine collecte, au lieu
    de garder un relevé fait avec l'ancien accès (ex. « SSH refusé » d'avant l'autorisation de la clé)."""
    from config import CFG
    f = Path(CFG["cache_dir"]) / "docker.json"
    try:
        c = json.loads(f.read_text(encoding="utf-8"))
        c["ts"] = 0
        f.write_text(json.dumps(c), encoding="utf-8")
    except (OSError, ValueError):
        pass


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
    m = _meta().get("machines", {}).get(ip)
    if m is None:
        raise MachineError("machine inconnue")
    buf = io.StringIO()
    setup.FAILED.clear()
    with contextlib.redirect_stdout(buf):
        setup.check_machine(ip, m, setup.ssh_aliases())
    lines = [ln.strip() for ln in buf.getvalue().splitlines() if ln.strip()]
    return {"lines": lines, "failed": len(setup.FAILED)}
