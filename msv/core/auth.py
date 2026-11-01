"""Comptes, sessions et journal d'audit de MyServices (version Docker), dans SQLite (/data/myservices.db).

- Rôles : « admin » (réglages, comptes) et « viewer » (lecture, bouton ⟳).
- Mots de passe : argon2id (argon2-cffi, paramètres par défaut recommandés), jamais stockés en clair.
- Session : jeton aléatoire de 32 octets dans un cookie HttpOnly + SameSite=Strict ; la base ne garde
  que son empreinte SHA-256 (une copie de la base ne permet pas de se connecter). Durée : SESSION_DAYS,
  prolongée à l'usage. Jeton CSRF propre à la session, à renvoyer dans l'en-tête X-CSRF-Token.
- Limite : LOGIN_MAX_FAIL échecs par IP en LOGIN_WINDOW s, puis refus (429) jusqu'à la fin de la fenêtre.
- Premier compte : créé depuis la page de connexion tant qu'aucun n'existe (create_first_admin, api.py).
- Audit : connexions (réussies ou non), déconnexions, passages demandés, changements de comptes.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from msv.core.config import db_path  # noqa: F401  (re-exported: most callers import it from here)

ROLES = ("admin", "viewer")
SESSION_DAYS = 14                # modifiable (Réglages → Comptes) : set_session_days
SESSION_DAYS_MAX = 90
LOGIN_MAX_FAIL = 10
LOGIN_WINDOW = 15 * 60
USERNAME_RE = re.compile(r"^[a-zA-Z0-9._@-]{2,64}$")
PASSWORD_MIN = 12


def email_ok(email: str) -> bool:
    """name@domain.tld: one « @ », no space, a dot in the domain (no regular expression: nothing to backtrack)."""
    local, at, domain = email.partition("@")
    return (bool(at) and 0 < len(local) <= 64 and "@" not in domain and not any(c.isspace() for c in email)
            and "." in domain.strip(".") and len(domain.rsplit(".", 1)[-1]) >= 2)
RESET_MIN = 30   # a reset link lasts 30 minutes, once

_ph = PasswordHasher()
_lock = threading.Lock()
_DUMMY = _ph.hash("compte-inexistant")  # même durée de calcul pour un compte inconnu (pas d'énumération)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')), created REAL NOT NULL, last_login REAL,
  disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL, ip TEXT);
CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS resets (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created REAL NOT NULL, expires REAL NOT NULL, ip TEXT);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, username TEXT, ip TEXT, action TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
"""


class AuthError(Exception):
    """Refus lisible (mot de passe trop court, nom pris…)."""


class Store:
    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript(SCHEMA)
            cols = {r["name"] for r in db.execute("PRAGMA table_info(users)")}
            if "email" not in cols:   # added in 0.11.11
                db.execute("ALTER TABLE users ADD COLUMN email TEXT")
            if "avatar" not in cols:   # added in 0.11.11 (avatars.py: checked image, its type)
                db.execute("ALTER TABLE users ADD COLUMN avatar BLOB")
                db.execute("ALTER TABLE users ADD COLUMN avatar_type TEXT")
        try:
            Path(self.path).chmod(0o600)
        except OSError:
            pass

    @contextmanager
    def _db(self):
        """Connexion fermée en sortie de bloc (le « with » de sqlite3 seul ne ferme pas)."""
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys = ON")
            db.execute("PRAGMA journal_mode = WAL")
            yield db
        finally:
            db.close()

    # ── comptes ──
    def users(self) -> list[dict]:
        with self._db() as db:
            return [dict(r) for r in db.execute(
                "SELECT id, username, role, created, last_login, disabled, email FROM users ORDER BY username")]

    def has_users(self) -> bool:
        with self._db() as db:
            return db.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None

    def create_user(self, username: str, password: str, role: str) -> None:
        if not USERNAME_RE.match(username or ""):
            raise AuthError("nom de compte : 2 à 64 caractères parmi lettres, chiffres, . _ @ -")
        if role not in ROLES:
            raise AuthError(f"rôle inconnu (rôles : {', '.join(ROLES)})")
        check_password(password)
        with _lock, self._db() as db:
            try:
                db.execute("INSERT INTO users (username, password, role, created) VALUES (?, ?, ?, ?)",
                           (username, _ph.hash(password), role, time.time()))
            except sqlite3.IntegrityError:
                raise AuthError(f"le compte « {username} » existe déjà") from None

    def create_first_admin(self, username: str, password: str) -> bool:
        """Premier compte, admin, seulement si aucun n'existe (vérifié et créé sous le même verrou : deux
        visiteurs en même temps n'en créent pas deux). False si un compte existe déjà."""
        if not USERNAME_RE.match(username or ""):
            raise AuthError("nom de compte : 2 à 64 caractères parmi lettres, chiffres, . _ @ -")
        check_password(password)
        with _lock, self._db() as db:
            if db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                return False
            db.execute("INSERT INTO users (username, password, role, created) VALUES (?, ?, 'admin', ?)",
                       (username, _ph.hash(password), time.time()))
        return True

    def set_password(self, username: str, password: str) -> None:
        check_password(password)
        with _lock, self._db() as db:
            n = db.execute("UPDATE users SET password = ? WHERE username = ?", (_ph.hash(password), username)).rowcount
            db.execute("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)", (username,))
        if not n:
            raise AuthError(f"compte « {username} » inconnu")

    def email_of(self, username: str) -> str | None:
        with self._db() as db:
            row = db.execute("SELECT email FROM users WHERE username = ?", (username,)).fetchone()
        return row["email"] if row and row["email"] else None

    def set_email(self, username: str, email: str) -> str | None:
        """Address used to send a reset link; empty: removed. One address for one account only."""
        email = (email or "").strip()
        if email and (len(email) > 254 or not email_ok(email)):
            raise AuthError("adresse e-mail invalide")
        with _lock, self._db() as db:
            row = _user_row(db, username)
            if email and db.execute("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ?", (email, row["id"])).fetchone():
                raise AuthError("adresse déjà utilisée par un autre compte")
            db.execute("UPDATE users SET email = ? WHERE id = ?", (email or None, row["id"]))
        return email or None

    def avatar(self, username: str) -> tuple[bytes, str] | None:
        with self._db() as db:
            row = db.execute("SELECT avatar, avatar_type FROM users WHERE username = ?", (username,)).fetchone()
        return (row["avatar"], row["avatar_type"]) if row and row["avatar"] else None

    def set_avatar(self, username: str, raw: bytes | None, mime: str | None) -> None:
        """Image already checked by avatars.check; None: removed."""
        with _lock, self._db() as db:
            row = _user_row(db, username)
            db.execute("UPDATE users SET avatar = ?, avatar_type = ? WHERE id = ?", (raw, mime if raw else None, row["id"]))

    # ── mot de passe oublié ──
    def reset_target(self, identity: str) -> sqlite3.Row | None:
        """Active account named by its name or its e-mail, with an address to write to; None otherwise."""
        identity = (identity or "").strip()
        if not identity:
            return None
        with self._db() as db:
            return db.execute("SELECT id, username, email FROM users WHERE disabled = 0 AND email IS NOT NULL AND email != '' "
                              "AND (username = ? OR email = ? COLLATE NOCASE)", (identity, identity)).fetchone()

    def create_reset(self, user_id: int, ip: str) -> str | None:
        """New one-time link token (only its hash is kept), the older ones of that account dropped; None when one was
        made less than a minute ago (no mailbox flooding)."""
        now = time.time()
        with _lock, self._db() as db:
            db.execute("DELETE FROM resets WHERE expires < ?", (now,))
            if db.execute("SELECT 1 FROM resets WHERE user_id = ? AND created > ?", (user_id, now - 60)).fetchone():
                return None
            db.execute("DELETE FROM resets WHERE user_id = ?", (user_id,))
            token = secrets.token_urlsafe(32)
            db.execute("INSERT INTO resets (token_hash, user_id, created, expires, ip) VALUES (?, ?, ?, ?, ?)",
                       (_h(token), user_id, now, now + RESET_MIN * 60, ip))
        return token

    def reset_valid(self, token: str) -> bool:
        with self._db() as db:
            return db.execute("SELECT 1 FROM resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires > ? AND u.disabled = 0",
                              (_h(token or ""), time.time())).fetchone() is not None

    def use_reset(self, token: str, password: str) -> str:
        """New password through a reset link: used once, every session of the account closed. Returns the account name."""
        check_password(password)
        with _lock, self._db() as db:
            row = db.execute("SELECT u.id, u.username FROM resets r JOIN users u ON u.id = r.user_id "
                             "WHERE r.token_hash = ? AND r.expires > ? AND u.disabled = 0", (_h(token or ""), time.time())).fetchone()
            if row is None:
                raise AuthError("lien expiré ou déjà utilisé : en demander un nouveau")
            db.execute("UPDATE users SET password = ? WHERE id = ?", (_ph.hash(password), row["id"]))
            db.execute("DELETE FROM resets WHERE user_id = ?", (row["id"],))
            db.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
        return row["username"]

    def note_failure(self, ip: str) -> None:
        """Counts a request against the same limit as a failed sign-in (forgotten password asked)."""
        with self._db() as db:
            db.execute("INSERT INTO login_failures (ip, ts) VALUES (?, ?)", (ip, time.time()))

    def delete_user(self, username: str) -> None:
        with _lock, self._db() as db:
            row = _user_row(db, username)
            if _last_admin(db, row):
                raise AuthError("dernier compte admin : en créer un autre avant de le supprimer")
            db.execute("DELETE FROM users WHERE username = ?", (username,))

    def update_user(self, username: str, role: str | None = None, disabled: bool | None = None) -> None:
        """Change le rôle ou active / désactive un compte. Le dernier admin actif ne peut ni perdre son rôle
        ni être désactivé. Désactivé : ses sessions sont fermées (il ne peut plus se connecter)."""
        if role is not None and role not in ROLES:
            raise AuthError(f"rôle inconnu (rôles : {', '.join(ROLES)})")
        with _lock, self._db() as db:
            row = _user_row(db, username)
            if ((role is not None and role != "admin") or disabled) and _last_admin(db, row):
                raise AuthError("dernier compte admin actif : en créer un autre avant")
            if role is not None:
                db.execute("UPDATE users SET role = ? WHERE id = ?", (role, row["id"]))
            if disabled is not None:
                db.execute("UPDATE users SET disabled = ? WHERE id = ?", (int(disabled), row["id"]))
                if disabled:
                    db.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))

    # ── connexion ──
    def too_many_failures(self, ip: str) -> bool:
        with self._db() as db:
            db.execute("DELETE FROM login_failures WHERE ts < ?", (time.time() - LOGIN_WINDOW,))
            return db.execute("SELECT COUNT(*) FROM login_failures WHERE ip = ?", (ip,)).fetchone()[0] >= LOGIN_MAX_FAIL

    def verify(self, username: str, password: str, ip: str) -> sqlite3.Row | None:
        """Compte si le mot de passe est bon ; None sinon (échec compté pour l'IP, même durée de calcul
        pour un compte inconnu)."""
        with self._db() as db:
            row = db.execute("SELECT * FROM users WHERE username = ? AND disabled = 0", (username or "",)).fetchone()
        try:
            _ph.verify(row["password"] if row else _DUMMY, password or "")
            ok = row is not None
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            ok = False
        if not ok:
            with self._db() as db:
                db.execute("INSERT INTO login_failures (ip, ts) VALUES (?, ?)", (ip, time.time()))
            return None
        return row

    def login(self, username: str, password: str, ip: str) -> tuple[str, str, dict] | None:
        """(jeton de session, jeton CSRF, compte) ; None si refus."""
        row = self.verify(username, password, ip)
        if row is None:
            return None
        token, csrf, now = secrets.token_urlsafe(32), secrets.token_urlsafe(24), time.time()
        with self._db() as db:
            if _ph.check_needs_rehash(row["password"]):
                db.execute("UPDATE users SET password = ? WHERE id = ?", (_ph.hash(password), row["id"]))
            db.execute("INSERT INTO sessions (token_hash, user_id, csrf, created, expires, ip) VALUES (?, ?, ?, ?, ?, ?)",
                       (_h(token), row["id"], csrf, now, now + SESSION_DAYS * 86400, ip))
            db.execute("UPDATE users SET last_login = ? WHERE id = ?", (now, row["id"]))
            db.execute("DELETE FROM login_failures WHERE ip = ?", (ip,))
            db.execute("DELETE FROM sessions WHERE expires < ?", (now,))
        return token, csrf, {"username": row["username"], "role": row["role"]}

    def session(self, token: str | None) -> dict | None:
        """Compte de la session (username, role, csrf), prolongée à l'usage ; None si absente ou expirée."""
        if not token:
            return None
        now = time.time()
        with self._db() as db:
            row = db.execute("SELECT u.username, u.role, s.csrf, s.expires FROM sessions s JOIN users u ON u.id = s.user_id "
                             "WHERE s.token_hash = ? AND u.disabled = 0", (_h(token),)).fetchone()
            if row is None or row["expires"] < now:
                return None
            if row["expires"] - now < (SESSION_DAYS - 1) * 86400:  # au plus une écriture par jour et par session
                db.execute("UPDATE sessions SET expires = ? WHERE token_hash = ?", (now + SESSION_DAYS * 86400, _h(token)))
        return {"username": row["username"], "role": row["role"], "csrf": row["csrf"]}

    def sessions_of(self, username: str, token: str | None) -> list[dict]:
        """Sessions ouvertes d'un compte (la plus récente d'abord) ; `current` marque celle du jeton donné. L'empreinte
        complète n'est jamais rendue : seulement ce qu'il faut pour reconnaître un appareil."""
        now = time.time()
        with self._db() as db:
            rows = db.execute("SELECT s.token_hash, s.created, s.expires, s.ip FROM sessions s JOIN users u ON u.id = s.user_id "
                              "WHERE u.username = ? AND s.expires >= ? ORDER BY s.created DESC", (username, now)).fetchall()
        mine = _h(token) if token else None
        return [{"created": r["created"], "expires": r["expires"], "ip": r["ip"], "current": r["token_hash"] == mine} for r in rows]

    def revoke_others(self, username: str, token: str | None) -> int:
        """Ferme toutes les sessions du compte sauf celle du jeton donné ; nombre de sessions fermées."""
        if not token:
            return 0
        with self._db() as db:
            return db.execute("DELETE FROM sessions WHERE token_hash != ? AND user_id = (SELECT id FROM users WHERE username = ?)",
                              (_h(token), username)).rowcount

    def logout(self, token: str | None) -> None:
        if token:
            with self._db() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (_h(token),))

    # ── audit ──
    def audit(self, action: str, username: str | None = None, ip: str | None = None, detail: str = "") -> None:
        with self._db() as db:
            db.execute("INSERT INTO audit (ts, username, ip, action, detail) VALUES (?, ?, ?, ?, ?)",
                       (time.time(), username, ip, action, detail[:300]))
            db.execute("DELETE FROM audit WHERE ts < ?", (time.time() - 365 * 86400,))

    def audit_log(self, limit: int = 200) -> list[dict]:
        with self._db() as db:
            return [dict(r) for r in db.execute("SELECT ts, username, ip, action, detail FROM audit ORDER BY id DESC LIMIT ?",
                                                (min(max(limit, 1), 1000),))]


def set_session_days(days: int) -> None:
    """Durée des sessions ouvertes à partir de maintenant (celles qui existent déjà gardent leur échéance jusqu'à leur prolongation)."""
    global SESSION_DAYS
    if not 1 <= days <= SESSION_DAYS_MAX:
        raise AuthError(f"durée des sessions : de 1 à {SESSION_DAYS_MAX} jours")
    SESSION_DAYS = days


def check_password(password: str) -> None:
    if len(password or "") < PASSWORD_MIN:
        raise AuthError(f"mot de passe : {PASSWORD_MIN} caractères minimum")


def _user_row(db: sqlite3.Connection, username: str) -> sqlite3.Row:
    row = db.execute("SELECT id, role, disabled FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        raise AuthError(f"compte « {username} » inconnu")
    return row


def _last_admin(db: sqlite3.Connection, row: sqlite3.Row) -> bool:
    """Ce compte est-il le seul admin actif ? (le retirer laisserait la page sans admin)"""
    if row["role"] != "admin" or row["disabled"]:
        return False
    return db.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0").fetchone()[0] <= 1


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
