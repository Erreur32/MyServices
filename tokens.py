"""Jetons d'API et MCP (version Docker), dans SQLite (/data/myservices.db), sur le modèle de MynetworK.

- Deux sortes, chacune refusée chez l'autre : « api » (REST, /myservices/api/v1/…) et « mcp » (serveur MCP,
  /myservices/mcp). Préfixes msv_api_ / msv_mcp_ : repérables par les scanners de secrets.
- Trois niveaux : « read » (lecture), « runs » (lecture + demander un passage), « admin » (réglages compris).
  Un jeton ne gère jamais les jetons ni les comptes (pas d'escalade) : ces routes demandent une session.
- Affiché une seule fois à la création ; la base ne garde que son empreinte SHA-256 et ses 4 derniers caractères.
- Durée de validité au choix (obligatoire pour « admin », qui demande aussi le mot de passe à la création) ;
  révocation douce (ligne gardée, date de révocation) ; dernier usage et dernière IP.
- Niveau relu à chaque requête : un jeton révoqué ou expiré tombe aussitôt, y compris pour une session MCP.
- Outils MCP : interrupteur par outil (désactivé = absent de tools/list et refusé à l'appel).
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

KINDS = ("api", "mcp")
LEVELS = ("read", "runs", "admin")
LEVEL_RANK = {lvl: i for i, lvl in enumerate(LEVELS)}
PREFIX = {"api": "msv_api_", "mcp": "msv_mcp_"}
NAME_RE = re.compile(r"^[\w .@-]{2,64}$")
MAX_DAYS = 3650
LAST_USED_EVERY = 60  # s : au plus une écriture « dernier usage » par minute et par jeton

SCHEMA = """
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('api', 'mcp')), name TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('read', 'runs', 'admin')), hash TEXT UNIQUE NOT NULL, hint TEXT NOT NULL,
  created REAL NOT NULL, created_by TEXT, expires REAL, revoked REAL, last_used REAL, last_ip TEXT);
CREATE TABLE IF NOT EXISTS mcp_tools (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
"""


class TokenError(Exception):
    """Refus lisible."""


class Tokens:
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

    def create(self, kind: str, name: str, level: str, days: int | None, by: str) -> tuple[str, dict]:
        """(jeton en clair, à montrer une seule fois ; fiche). days None = sans fin (interdit pour admin)."""
        if kind not in KINDS:
            raise TokenError("sorte inconnue (api ou mcp)")
        if level not in LEVELS:
            raise TokenError("niveau inconnu (read, runs, admin)")
        name = (name or "").strip()
        if not NAME_RE.match(name):
            raise TokenError("nom : 2 à 64 caractères (lettres, chiffres, espace, . _ @ -)")
        if days is not None and not 1 <= days <= MAX_DAYS:
            raise TokenError(f"durée : de 1 à {MAX_DAYS} jours")
        if level == "admin" and days is None:
            raise TokenError("un jeton admin doit avoir une durée de validité")
        raw = PREFIX[kind] + secrets.token_urlsafe(32)
        now = time.time()
        with self._db() as db:
            tid = db.execute("INSERT INTO tokens (kind, name, level, hash, hint, created, created_by, expires) "
                             "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                             (kind, name, level, _h(raw), raw[-4:], now, by, now + days * 86400 if days else None)).lastrowid
        return raw, self.get(tid)

    def get(self, tid: int) -> dict:
        with self._db() as db:
            r = db.execute("SELECT * FROM tokens WHERE id = ?", (tid,)).fetchone()
        if r is None:
            raise TokenError("jeton inconnu")
        return _public(r)

    def listing(self) -> list[dict]:
        with self._db() as db:
            return [_public(r) for r in db.execute("SELECT * FROM tokens ORDER BY revoked IS NOT NULL, created DESC")]

    def revoke(self, tid: int) -> None:
        with self._db() as db:
            if not db.execute("UPDATE tokens SET revoked = ? WHERE id = ? AND revoked IS NULL", (time.time(), tid)).rowcount:
                raise TokenError("jeton inconnu ou déjà révoqué")

    def check(self, raw: str | None, kind: str, ip: str) -> dict:
        """Fiche du jeton s'il est valable pour cette sorte ; TokenError(code) sinon. Note le dernier usage."""
        if not raw:
            raise TokenError("TOKEN_MISSING")
        other = next((k for k, p in PREFIX.items() if raw.startswith(p)), None)
        if other is None:
            raise TokenError("TOKEN_INVALID")
        if other != kind:
            raise TokenError("TOKEN_WRONG_KIND")
        with self._db() as db:
            r = db.execute("SELECT * FROM tokens WHERE hash = ?", (_h(raw),)).fetchone()
            if r is None or r["kind"] != kind:
                raise TokenError("TOKEN_INVALID")
            if r["revoked"]:
                raise TokenError("TOKEN_REVOKED")
            now = time.time()
            if r["expires"] and r["expires"] < now:
                raise TokenError("TOKEN_EXPIRED")
            if not r["last_used"] or now - r["last_used"] > LAST_USED_EVERY or r["last_ip"] != ip:
                db.execute("UPDATE tokens SET last_used = ?, last_ip = ? WHERE id = ?", (now, ip, r["id"]))
        return _public(r)

    # ── outils MCP ──
    def tool_states(self) -> dict[str, bool]:
        with self._db() as db:
            return {r["name"]: bool(r["enabled"]) for r in db.execute("SELECT * FROM mcp_tools")}

    def set_tool(self, name: str, enabled: bool) -> None:
        with self._db() as db:
            db.execute("INSERT OR REPLACE INTO mcp_tools (name, enabled) VALUES (?, ?)", (name, int(enabled)))


def allows(level: str, needed: str) -> bool:
    return LEVEL_RANK[level] >= LEVEL_RANK[needed]


# Droits d'un jeton d'API sur les routes REST : (méthode, motif de chemin sous api/v1/) -> niveau requis.
# Absent de la liste = refusé (TOKEN_ROUTE_NOT_ALLOWED) : jetons, comptes, mots de passe, déconnexion.
API_ROUTES: list[tuple[str, re.Pattern, str]] = [
    ("GET", re.compile(r"^(status|tasks|connectors|events|events/per-day|me)$"), "read"),
    ("POST", re.compile(r"^refresh$"), "runs"),
    ("GET", re.compile(r"^(audit|alerts|connectors/settings|machines/settings|system|sources)$"), "admin"),
    ("PUT", re.compile(r"^sources/.+$"), "admin"),
    ("*", re.compile(r"^system/tasks/.+$"), "admin"),
    ("*", re.compile(r"^(alerts/.+|connectors/settings/.+|machines/.+)$"), "admin"),
]


def api_route_level(method: str, sub: str) -> str | None:
    for m, pat, lvl in API_ROUTES:
        if (m == "*" or m == method) and pat.match(sub):
            return lvl
    return None


def _public(r: sqlite3.Row) -> dict:
    now = time.time()
    state = "révoqué" if r["revoked"] else "expiré" if r["expires"] and r["expires"] < now else "actif"
    return {"id": r["id"], "kind": r["kind"], "name": r["name"], "level": r["level"], "hint": r["hint"],
            "created": r["created"], "created_by": r["created_by"], "expires": r["expires"], "revoked": r["revoked"],
            "last_used": r["last_used"], "last_ip": r["last_ip"], "state": state}


def _h(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def dumps(v) -> str:
    return json.dumps(v, ensure_ascii=False, default=str)
