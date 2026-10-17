"""Agents MyServices (version Docker) : une machine envoie elle-même son relevé de santé, sans SSH.

- Un agent = un jeton msv_agent_ lié à UNE machine (son IP dans services-meta). Il ne sert qu'à envoyer un relevé
  pour cette machine : jamais à lire quoi que ce soit, ni à appeler une autre route.
- Affiché une seule fois à la création ; la base ne garde que son empreinte SHA-256 et ses 4 derniers caractères.
- Dernier relevé gardé tel quel (JSON) avec sa date : health.py le range dans les mêmes champs qu'une machine lue
  par SSH (parse_windows) tant qu'il est frais (moins de FRESH_MULT × l'intervalle annoncé par l'agent).
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

VERSION = "7"
SCRIPTS = Path(__file__).resolve().parent / "agent"
PREFIX = "msv_agent_"
NAME_RE = re.compile(r"^[\w .@-]{2,64}$")
MAX_BODY = 256 * 1024     # octets : un relevé fait quelques ko
DEFAULT_INTERVAL = 900    # s : 15 min
MIN_INTERVAL, MAX_INTERVAL = 60, 86400
FRESH_MULT = 2.5          # un relevé plus vieux que 2,5 × l'intervalle est périmé
MIN_GAP = 60              # s: an agent sends at most one report per minute (the rest gets 429)
BAD_MAX, BAD_WINDOW = 10, 15 * 60   # bad tokens tolerated per IP, then refused until the window ends

SCHEMA = """
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY, ip TEXT NOT NULL, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, hint TEXT NOT NULL,
  created REAL NOT NULL, created_by TEXT, revoked REAL, last_seen REAL, last_ip TEXT,
  interval INTEGER, version TEXT, os_name TEXT, report TEXT);
"""


_bad: dict[str, list[float]] = {}   # IP -> dates of its recent bad tokens
_bad_lock = threading.Lock()


class AgentError(Exception):
    """Refus lisible."""


class Agents:
    def __init__(self, path: str | Path):
        self.path = str(path)
        with self._db() as db:
            db.executescript(SCHEMA)
            have = {r["name"] for r in db.execute("PRAGMA table_info(agents)")}
            for col, ddl in (("auto_update", "INTEGER NOT NULL DEFAULT 0"), ("update_requested", "REAL"),
                             ("hostname", "TEXT"), ("host_pending", "TEXT")):   # databases created before these columns
                if col not in have:
                    db.execute(f"ALTER TABLE agents ADD COLUMN {col} {ddl}")

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA journal_mode = WAL")
            yield db
        finally:
            db.close()

    def create(self, ip: str, name: str, by: str) -> tuple[str, dict]:
        """(jeton en clair, à montrer une seule fois ; fiche). Un seul agent actif par machine : le précédent est révoqué."""
        try:
            ip = str(ipaddress.ip_address((ip or "").strip()))
        except ValueError:
            raise AgentError("adresse IP de la machine invalide")
        name = (name or "").strip()
        if not NAME_RE.match(name):
            raise AgentError("nom : 2 à 64 caractères (lettres, chiffres, espace, . _ @ -)")
        raw = PREFIX + secrets.token_urlsafe(32)
        now = time.time()
        with self._db() as db:
            db.execute("UPDATE agents SET revoked = ? WHERE ip = ? AND revoked IS NULL", (now, ip))
            aid = db.execute("INSERT INTO agents (ip, name, hash, hint, created, created_by) VALUES (?, ?, ?, ?, ?, ?)",
                             (ip, name, _h(raw), raw[-4:], now, by)).lastrowid
        return raw, self.get(aid)

    def get(self, aid: int) -> dict:
        with self._db() as db:
            r = db.execute("SELECT * FROM agents WHERE id = ?", (aid,)).fetchone()
        if r is None:
            raise AgentError("agent inconnu")
        return _public(r)

    def listing(self) -> list[dict]:
        with self._db() as db:
            return [_public(r) for r in db.execute("SELECT * FROM agents ORDER BY revoked IS NOT NULL, created DESC")]

    def set_auto_update(self, aid: int, on: bool) -> None:
        """Mise à jour automatique d'un agent : à son prochain relevé, il récupère le script du serveur s'il est plus ancien."""
        with self._db() as db:
            if not db.execute("UPDATE agents SET auto_update = ? WHERE id = ? AND revoked IS NULL", (int(bool(on)), aid)).rowcount:
                raise AgentError("agent inconnu ou révoqué")

    def request_update(self, aid: int) -> None:
        """« Mettre à jour maintenant » : au prochain relevé l'agent récupère le script, même sans mise à jour automatique."""
        a = self.get(aid)
        if a["revoked"]:
            raise AgentError("agent révoqué")
        with self._db() as db:
            db.execute("UPDATE agents SET update_requested = ? WHERE id = ?", (time.time(), aid))

    def update_for(self, aid: int, version: str | None) -> dict | None:
        """Ce que le serveur répond à un relevé de version `version` : la mise à jour (version, chemin, empreinte du script servi) si l'agent est
        plus ancien et que la mise à jour est automatique ou demandée ; None sinon. Une demande dont l'agent est à jour est classée."""
        with self._db() as db:
            r = db.execute("SELECT auto_update, update_requested FROM agents WHERE id = ? AND revoked IS NULL", (aid,)).fetchone()
            if r is None:
                return None
            if not older(version, VERSION):
                if r["update_requested"]:
                    db.execute("UPDATE agents SET update_requested = NULL WHERE id = ?", (aid,))
                return None
        if not (r["auto_update"] or r["update_requested"]):
            return None
        return {"version": VERSION, "path": "/myservices/agent/agent.ps1", "sha256": script_sha256()}

    def revoke(self, aid: int) -> None:
        with self._db() as db:
            if not db.execute("UPDATE agents SET revoked = ? WHERE id = ? AND revoked IS NULL", (time.time(), aid)).rowcount:
                raise AgentError("agent inconnu ou déjà révoqué")

    def purge(self, aid: int) -> None:
        """Efface un agent déjà révoqué (sa ligne seulement : son jeton ne marchait plus de toute façon). Un agent actif ne s'efface pas."""
        with self._db() as db:
            if not db.execute("DELETE FROM agents WHERE id = ? AND revoked IS NOT NULL", (aid,)).rowcount:
                raise AgentError("agent inconnu ou pas révoqué (révoquez-le d'abord)")

    def too_many_bad(self, ip: str) -> bool:
        """True when this IP presented too many bad tokens in the window (in memory: resets on restart)."""
        with _bad_lock:
            recent = [t for t in _bad.get(ip, []) if t > time.time() - BAD_WINDOW]
            _bad[ip] = recent
            return len(recent) >= BAD_MAX

    def note_bad(self, ip: str) -> None:
        with _bad_lock:
            _bad.setdefault(ip, []).append(time.time())
            if len(_bad) > 1000:   # drop IPs with nothing recent so the table stays small
                for k in [k for k, v in _bad.items() if not v or v[-1] <= time.time() - BAD_WINDOW]:
                    del _bad[k]

    def claim_host(self, aid: int, host: object) -> bool:
        """Host name announced by the agent. The first name seen is kept; another name is refused (token copied to another
        machine?) and held until the admin confirms it. True when the report can be stored."""
        host = str(host or "").strip()[:64]
        if not host:
            return True
        with self._db() as db:
            r = db.execute("SELECT hostname FROM agents WHERE id = ?", (aid,)).fetchone()
            if r is None:
                return False
            if not r["hostname"]:
                db.execute("UPDATE agents SET hostname = ?, host_pending = NULL WHERE id = ?", (host, aid))
                return True
            if r["hostname"].casefold() == host.casefold():
                return True
            db.execute("UPDATE agents SET host_pending = ? WHERE id = ?", (host, aid))
            return False

    def confirm_host(self, aid: int) -> None:
        """The admin accepts the new host name (machine renamed)."""
        with self._db() as db:
            if not db.execute("UPDATE agents SET hostname = host_pending, host_pending = NULL "
                              "WHERE id = ? AND host_pending IS NOT NULL AND revoked IS NULL", (aid,)).rowcount:
                raise AgentError("aucun changement de nom à confirmer")

    def check(self, raw: str | None) -> dict:
        """Fiche de l'agent si le jeton est valable ; AgentError(code) sinon."""
        if not raw:
            raise AgentError("TOKEN_MISSING")
        if not raw.startswith(PREFIX):
            raise AgentError("TOKEN_INVALID")
        with self._db() as db:
            r = db.execute("SELECT * FROM agents WHERE hash = ?", (_h(raw),)).fetchone()
        if r is None:
            raise AgentError("TOKEN_INVALID")
        if r["revoked"]:
            raise AgentError("TOKEN_REVOKED")
        return _public(r)

    def store_report(self, aid: int, report: dict, ip: str) -> tuple[str | None, str | None]:
        """Garde le relevé (déjà validé) et note le passage de l'agent. Rend (niveau du relevé précédent, niveau de celui-ci) :
        None pour le précédent s'il n'y en avait pas ; le serveur relit la santé quand ils diffèrent."""
        interval = report.get("interval")
        interval = interval if isinstance(interval, int) and MIN_INTERVAL <= interval <= MAX_INTERVAL else DEFAULT_INTERVAL
        with self._db() as db:
            old = db.execute("SELECT report FROM agents WHERE id = ?", (aid,)).fetchone()
            db.execute("UPDATE agents SET last_seen = ?, last_ip = ?, interval = ?, version = ?, os_name = ?, report = ? "
                       "WHERE id = ? AND revoked IS NULL",
                       (time.time(), ip, interval, str(report.get("version") or "")[:32], str(report.get("os") or "")[:120],
                        json.dumps(report, ensure_ascii=False), aid))
        return report_level(json.loads(old["report"])) if old and old["report"] else None, report_level(report)

    def fresh_reports(self) -> dict[str, dict]:
        """{IP: {"report": relevé, "seen": date, "fresh": bool}} pour les agents actifs ayant déjà envoyé un relevé."""
        out, now = {}, time.time()
        with self._db() as db:
            rows = db.execute("SELECT * FROM agents WHERE revoked IS NULL ORDER BY created").fetchall()
        for r in rows:
            out[r["ip"]] = {"report": json.loads(r["report"]) if r["report"] else None, "seen": r["last_seen"],
                            "fresh": bool(r["last_seen"] and now - r["last_seen"] <= FRESH_MULT * (r["interval"] or DEFAULT_INTERVAL))}
        return out


# Ports Windows sans intérêt dans l'annuaire : RPC dynamique (49152 et au-delà), RPC/DCOM (135), NetBIOS (139), diffusion de l'appli Connected Devices (5040)
NOISE_PORTS = {135, 139, 5040}


def ports_of(report: dict | None) -> dict[int, dict]:
    """Ports TCP à l'écoute d'un relevé d'agent : {port: {"name": processus, "lan": joignable depuis le réseau}} (même forme que
    connectors/process.py). Les ports de bouclage seuls ne sont pas « lan » ; les ports dynamiques et le bruit Windows sont écartés."""
    out: dict[int, dict] = {}
    for it in ((report or {}).get("data") or {}).get("ports") or []:
        try:
            port, addr, name = int(it["p"]), str(it.get("a") or ""), str(it.get("n") or "").strip()
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= port < 49152 or port in NOISE_PORTS:
            continue
        lan = not addr.startswith(("127.", "::1"))
        cur = out.setdefault(port, {"name": name or f"port {port}", "lan": lan})
        cur["lan"] = cur["lan"] or lan
    return out


def docker_of(report: dict | None) -> list[dict] | None:
    """Conteneurs Docker d'un relevé d'agent (docker.exe présent sur le PC), même forme que connectors.docker_ssh ; None si le relevé n'en
    parle pas (agent ancien, Docker absent ou inaccessible pour le compte SYSTEM). Texte du PC : jamais fait confiance aux champs."""
    from connectors.docker_ssh import publish_ports
    lines = ((report or {}).get("data") or {}).get("dk")
    if lines is None:
        return None
    out = []
    for ln in (lines if isinstance(lines, list) else [lines])[:200]:
        f = (str(ln).split("|") + [""] * 5)[:5]
        if f[0].strip():
            out.append({"name": f[0].strip()[:80], "image": f[1].strip()[:200], "status": f[3].strip()[:80], "compose": "", "title": "",
                        "description": "", "version": "", "url": "", "network": f[4].strip()[:80], "ports": publish_ports(f[2])})
    return out


def services_of(report: dict | None) -> list[dict]:
    """Services Windows en marche d'un relevé d'agent : [{"name", "display"}] (300 au plus), vide pour un agent ancien."""
    out = []
    for it in (((report or {}).get("data") or {}).get("sv") or [])[:300]:
        if isinstance(it, dict) and it.get("n"):
            out.append({"name": str(it["n"]).strip()[:80], "display": str(it.get("d") or "").strip()[:120]})
    return out


def system_of(report: dict | None) -> dict | None:
    """Système d'un relevé d'agent : {"os", "kernel" (build), "uptime_s"} ou None si le relevé n'en contient pas."""
    import datetime
    data = (report or {}).get("data") or {}
    o = data.get("os")
    if not isinstance(o, dict) or not o.get("n"):
        return None
    up = None
    try:
        up = int((datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(str(data["boot"]).replace("Z", "+00:00"))).total_seconds())
    except (KeyError, ValueError, TypeError):
        pass
    return {"os": str(o["n"]).strip(), "kernel": f"{o.get('v') or ''} (build {o.get('b')})".strip() if o.get("b") else o.get("v"), "uptime_s": up}


def hardware_of(report: dict | None) -> dict | None:
    """Matériel d'un relevé d'agent (clé « hw » : modèle, BIOS, processeur, mémoire, graphique, réseau...) ou None s'il est absent."""
    import health
    data = (report or {}).get("data")
    return health.hardware_of_raw(data.get("hw")) if isinstance(data, dict) else None


def _dt(v) -> float | None:
    import datetime
    try:
        return datetime.datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def hyperv_of(report: dict | None, node: str) -> dict | None:
    """Hyper-V VMs of an agent report (key « hv », Get-VM), in the shape of the virtualization rows; None if the PC has no Hyper-V."""
    vms = ((report or {}).get("data") or {}).get("hv")
    if not isinstance(vms, list):
        return None
    guests = []
    for v in vms[:300]:
        if not isinstance(v, dict) or not v.get("n"):
            continue
        on = str(v.get("s")).lower() == "running" or v.get("s") == 2   # State is text, or its enum number (2 = Running) on some hosts
        mem = v.get("m") if isinstance(v.get("m"), (int, float)) and v["m"] > 0 else None
        guests.append({"vmid": str(v["n"])[:80], "name": str(v["n"])[:80], "type": "vm", "node": node, "status": "running" if on else "stopped",
                       "template": False, "tags": [], "cpus": v.get("c") if isinstance(v.get("c"), int) else None,
                       "mem": mem if on else None, "maxmem": mem or (v.get("x") if isinstance(v.get("x"), (int, float)) and v["x"] > 0 else None),
                       "uptime": v.get("u") if on and isinstance(v.get("u"), int) and v["u"] > 0 else None})
    return {"nodes": [{"name": node, "online": True}], "guests": guests, "storage": [], "backups": None,
            "totals": {"vm": len(guests), "lxc": 0, "running": sum(1 for g in guests if g["status"] == "running"),
                       "stopped": sum(1 for g in guests if g["status"] != "running")}}


def windows_backups_of(report: dict | None) -> list[dict]:
    """Last Veeam Agent job (event 190 of the « Veeam Agent » log) and last Windows Server Backup (Microsoft-Windows-Backup: event 4 = success,
    level error otherwise) of an agent report: [{"tool", "at" (epoch), "ok", "warn", "message"}]. Event levels: 2 error, 3 warning."""
    data = (report or {}).get("data") or {}
    out = []
    for key, tool in (("va", "Veeam Agent"), ("wb", "Sauvegarde Windows Server")):
        e = data.get(key)
        if not isinstance(e, dict):
            continue
        msg = str(e.get("m") or "")[:200]
        failed = e.get("l") in (1, 2) or (key == "va" and re.search(r"\bfailed\b", msg, re.I) is not None)
        warn = e.get("l") == 3 or (key == "va" and re.search(r"\bwarning\b", msg, re.I) is not None)
        out.append({"tool": tool, "at": _dt(e.get("t")), "ok": not failed, "warn": warn and not failed, "message": msg})
    return out


def windows_backup_card(b: dict, machine: str) -> dict:
    """Status card (Health, « service via API ») for the last Veeam Agent or Windows Server Backup run seen by a Windows agent."""
    age = time.time() - b["at"] if b.get("at") else None
    late = age is None or age > 26 * 3600
    when = "jamais" if age is None else f"il y a {int(age // 86400)} j" if age >= 86400 else f"il y a {max(1, int(age // 3600))} h"
    problems = ([] if b["ok"] else [f"dernière sauvegarde en échec : {b['message']}"]) + ([f"terminée avec avertissements : {b['message']}"] if b["warn"] else [])
    if late and b["ok"]:
        problems.append(f"aucune sauvegarde réussie depuis plus de 26 h ({when})")
    return {"connector": "veeam-agent" if b["tool"] == "Veeam Agent" else "wbadmin", "name": machine, "label": b["tool"], "ok": True, "stale": False,
            "message": "lu par l'agent Windows", "version": None, "url": None, "via": "agent",
            "facts": [{"label": "Dernière sauvegarde", "value": when, "tone": "bad" if not b["ok"] else "warn" if late or b["warn"] else "ok"},
                      {"label": "Résultat", "value": "échec" if not b["ok"] else "avertissements" if b["warn"] else "réussie",
                       "tone": "bad" if not b["ok"] else "warn" if b["warn"] else "ok"}],
            "problems": problems}


def report_level(report: dict) -> str | None:
    """Niveau de santé (ok, warn, crit) que donne un relevé, avec les mêmes règles que la page Santé ; None s'il est illisible."""
    import health
    try:
        return health.host_level({"reachable": True, **health.parse_windows(report["data"])})
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def validate_report(body) -> dict:
    """Relevé reçu : un objet {"interval", "version", "os", "host", "data": relevé PowerShell}. AgentError sinon."""
    if not isinstance(body, dict) or not isinstance(body.get("data"), dict):
        raise AgentError("relevé invalide : objet « data » attendu")
    import health
    try:
        health.parse_windows(body["data"])
    except (KeyError, TypeError, ValueError, AttributeError):
        raise AgentError("relevé invalide : champs illisibles")
    return body


def older(version: str | None, latest: str) -> bool:
    """Vrai si `version` (numéro d'un agent, « 5 ») est strictement plus ancienne que `latest` ; une version illisible ou absente est « plus ancienne »."""
    try:
        return int(str(version).strip()) < int(latest)
    except ValueError:
        return True


def script_sha256() -> str:
    """Empreinte du script d'agent tel que servi (ASCII) : l'agent la contrôle avant de remplacer son propre fichier."""
    return hashlib.sha256(script("agent.ps1").encode("utf-8")).hexdigest()


def _public(r: sqlite3.Row) -> dict:
    now = time.time()
    interval = r["interval"] or DEFAULT_INTERVAL
    if r["revoked"]:
        state = "révoqué"
    elif not r["last_seen"]:
        state = "en attente"
    elif now - r["last_seen"] <= FRESH_MULT * interval:
        state = "actif"
    else:
        state = "silencieux"
    return {"auto_update": bool(r["auto_update"]), "update_requested": bool(r["update_requested"]), "latest_version": VERSION,
            "outdated": bool(r["version"]) and older(r["version"], VERSION),
            "id": r["id"], "ip": r["ip"], "name": r["name"], "hint": r["hint"], "created": r["created"],
            "created_by": r["created_by"], "revoked": r["revoked"], "last_seen": r["last_seen"], "last_ip": r["last_ip"],
            "interval": interval, "version": r["version"], "os": r["os_name"], "state": state,
            "hostname": r["hostname"], "host_pending": r["host_pending"]}


def _h(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def script(name: str) -> str:
    """agent.ps1 (relevé de health.WIN_PS inclus : une seule source pour SSH et agent) ou install.ps1, tels que servis.
    ASCII seulement : Windows PowerShell 5.1 lit un script sans BOM en ANSI."""
    text = (SCRIPTS / name).read_text(encoding="utf-8")
    if name == "agent.ps1":
        import health
        text = text.replace("#__COLLECT__", health.WIN_PS.strip()).replace("__VERSION__", VERSION)
    return text


def clean_url(url: str) -> str:
    """Adresse de MyServices pour l'agent : http(s)://hôte[:port], sans chemin. AgentError sinon."""
    url = (url or "").strip().rstrip("/")
    if not re.fullmatch(r"https?://[A-Za-z0-9.-]+(:\d{1,5})?", url) and not re.fullmatch(r"https?://\[[0-9A-Fa-f:]+\](:\d{1,5})?", url):
        raise AgentError("adresse de MyServices : http(s)://hôte[:port], sans chemin")
    return url


def install_command(base_url: str, token: str) -> str:
    """Commande à coller dans un PowerShell administrateur de la machine."""
    return ("Set-ExecutionPolicy Bypass -Scope Process -Force\n"
            f"$env:MSV_URL = '{base_url}'\n$env:MSV_TOKEN = '{token}'\n"
            'iex (iwr "$env:MSV_URL/agent/install.ps1" -UseBasicParsing).Content')
