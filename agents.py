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
import time
from contextlib import contextmanager
from pathlib import Path

VERSION = "5"
SCRIPTS = Path(__file__).resolve().parent / "agent"
PREFIX = "msv_agent_"
NAME_RE = re.compile(r"^[\w .@-]{2,64}$")
MAX_BODY = 256 * 1024     # octets : un relevé fait quelques ko
DEFAULT_INTERVAL = 900    # s : 15 min
MIN_INTERVAL, MAX_INTERVAL = 60, 86400
FRESH_MULT = 2.5          # un relevé plus vieux que 2,5 × l'intervalle est périmé

SCHEMA = """
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY, ip TEXT NOT NULL, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, hint TEXT NOT NULL,
  created REAL NOT NULL, created_by TEXT, revoked REAL, last_seen REAL, last_ip TEXT,
  interval INTEGER, version TEXT, os_name TEXT, report TEXT);
"""


class AgentError(Exception):
    """Refus lisible."""


class Agents:
    def __init__(self, path: str | Path):
        self.path = str(path)
        with self._db() as db:
            db.executescript(SCHEMA)

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

    def revoke(self, aid: int) -> None:
        with self._db() as db:
            if not db.execute("UPDATE agents SET revoked = ? WHERE id = ? AND revoked IS NULL", (time.time(), aid)).rowcount:
                raise AgentError("agent inconnu ou déjà révoqué")

    def purge(self, aid: int) -> None:
        """Efface un agent déjà révoqué (sa ligne seulement : son jeton ne marchait plus de toute façon). Un agent actif ne s'efface pas."""
        with self._db() as db:
            if not db.execute("DELETE FROM agents WHERE id = ? AND revoked IS NOT NULL", (aid,)).rowcount:
                raise AgentError("agent inconnu ou pas révoqué (révoquez-le d'abord)")

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
    return {"id": r["id"], "ip": r["ip"], "name": r["name"], "hint": r["hint"], "created": r["created"],
            "created_by": r["created_by"], "revoked": r["revoked"], "last_seen": r["last_seen"], "last_ip": r["last_ip"],
            "interval": interval, "version": r["version"], "os": r["os_name"], "state": state}


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
            'iex (iwr "$env:MSV_URL/myservices/agent/install.ps1" -UseBasicParsing).Content')
