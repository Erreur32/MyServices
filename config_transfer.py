"""Export and import of the /config folder, whole or by part.

Parts: settings (config.json), machines (services-meta.json), backups (backups-meta.json), decisions (the choices kept in the state folder),
accounts (the database: accounts, tokens, agents, alert rules, history, audit), secrets (secret.key, the key that opens every encrypted password
and token of config.json) and ssh (the keys and the config of the SSH folder). The archive is a ZIP (a tar.gz from an older export is still read)
of `config/...` (the state files are `config/state/...`, the database `config/data/myservices.db`) plus a MANIFEST.json. Nothing in an uploaded archive is trusted: names, types, sizes and contents are checked before anything is written,
and the same checks run again when the import is applied (the preview is only a preview).
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import sqlite3
import tarfile
import tempfile
import time
import zipfile
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import NamedTuple

FORMAT = 1
MANIFEST = "MANIFEST.json"
CONFIG_FILE = "config.json"
KEY_FILE = "secret.key"
DB_REL = "data/myservices.db"
DECISIONS = tuple(f"state/{n}.json" for n in ("services-decided", "diagnostic-accepted", "assistant", "auto-mode", "connectors-saved"))
FILES = {"settings": (CONFIG_FILE,), "machines": ("services-meta.json",), "backups": ("backups-meta.json",), "decisions": DECISIONS,
         "accounts": (DB_REL,), "secrets": (KEY_FILE,)}
PARTS = (*FILES, "ssh")
SENSITIVE = ("accounts", "secrets", "ssh")   # the parts the page warns about
NEEDS_RESTART = ("settings", "secrets")      # read once at start
MAX_ARCHIVE, MAX_FILE, MAX_DB, MAX_TOTAL, MAX_FILES = 64 << 20, 2 << 20, 64 << 20, 80 << 20, 200
TRANSIENT_TABLES = ("sessions", "resets", "login_failures")   # logins and reset links are not worth carrying to another installation
REQUIRED_TABLES = {"users", "sessions", "events", "audit"}
SSH_NAME = re.compile(r"^\w[\w.@+-]{0,127}$", re.ASCII)
BACKUP_SUFFIX = ".avant-import"


class TransferError(ValueError):
    """A reason the page can show as is."""


class Places(NamedTuple):
    """Where the parts live: the /config folder, the state folder and the SQLite database."""
    config: Path
    state: Path
    db: Path


def disk_path(rel: str, places: Places) -> Path:
    """The file an archive path stands for on this installation."""
    if rel == DB_REL:
        return places.db
    if rel.startswith("state/"):
        return places.state / rel[len("state/"):]
    return places.config / rel


def limit_of(rel: str) -> int:
    return MAX_DB if rel == DB_REL else MAX_FILE


def part_of(rel: str) -> str | None:
    """The part a path of the archive (without its `config/` prefix) belongs to, or None when it is not ours."""
    for part, names in FILES.items():
        if rel in names:
            return part
    head, _, name = rel.partition("/")
    return "ssh" if head == "ssh" and SSH_NAME.match(name) else None


def present(places: Places) -> dict[str, list[str]]:
    """{part: archive paths} of what this installation has."""
    out: dict[str, list[str]] = {}
    for part, names in FILES.items():
        found = [n for n in names if disk_path(n, places).is_file()]
        if found:
            out[part] = found
    ssh = places.config / "ssh"
    if ssh.is_dir():
        found = sorted(f"ssh/{f.name}" for f in ssh.iterdir() if f.is_file() and not f.is_symlink() and SSH_NAME.match(f.name))
        if found:
            out["ssh"] = found
    return out


def db_snapshot(db: Path) -> bytes:
    """A consistent copy of the live database (SQLite's own backup, safe while the app writes), without the logins and reset links."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "copy.db"
        src, dst = sqlite3.connect(db, timeout=30), sqlite3.connect(out)
        try:
            src.backup(dst)
            for table in TRANSIENT_TABLES:
                dst.execute(f"DELETE FROM {table}")   # NOSONAR S2077: fixed table names from the constant above
            dst.commit()
            dst.execute("PRAGMA journal_mode=DELETE")
            dst.execute("VACUUM")
        finally:
            src.close()
            dst.close()
        return out.read_bytes()


def export_config(places: Places, parts: list[str] | None = None, version: str = "") -> bytes:
    """ZIP of the chosen parts (all of them when `parts` is None), with a manifest listing what is inside."""
    chosen = list(PARTS) if parts is None else [p for p in PARTS if p in parts]
    if not chosen:
        raise TransferError("rien à exporter : choisir au moins une partie")
    unknown = [p for p in (parts or []) if p not in PARTS]
    if unknown:
        raise TransferError("partie inconnue : " + ", ".join(unknown))
    have, now, hashes = present(places), time.time(), {}
    buf = io.BytesIO()

    def add(zf: zipfile.ZipFile, name: str, data: bytes) -> None:
        info = zipfile.ZipInfo(f"config/{name}", time.localtime(now)[:6])
        info.external_attr = 0o600 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, data)

    with zipfile.ZipFile(buf, "w") as zf:
        for part in chosen:
            for rel in have.get(part, []):
                data = db_snapshot(places.db) if rel == DB_REL else disk_path(rel, places).read_bytes()
                hashes[rel] = hashlib.sha256(data).hexdigest()
                add(zf, rel, data)
        manifest = {"format": FORMAT, "app": version, "created": int(now), "parts": [p for p in chosen if have.get(p)], "files": hashes}
        add(zf, MANIFEST, json.dumps(manifest, indent=2).encode())
    return buf.getvalue()


# An entry of an archive, whatever its format: (name, kind, size, read) with kind "dir", "file" or "other" (link, device…)
Entry = tuple[str, str, int, "Callable[[int], bytes]"]


def _zip_entries(data: bytes):
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            mode = (info.external_attr >> 16) & 0o170000
            if info.flag_bits & 0x1:
                raise TransferError("archive refusée : fichier chiffré par mot de passe")
            kind = "file"
            if info.is_dir():
                kind = "dir"
            elif mode in (0o120000, 0o060000, 0o020000, 0o010000, 0o140000):
                kind = "other"
            yield info.filename, kind, info.file_size, lambda limit, i=info: zf.open(i).read(limit + 1)


def _tar_entries(data: bytes):
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for m in tar:
            kind = "file"
            if m.isdir():
                kind = "dir"
            elif not m.isfile():
                kind = "other"
            yield m.name, kind, m.size, lambda limit, m=m: tar.extractfile(m).read(limit + 1)   # type: ignore[union-attr]


def _entry_name(name: str, kind: str) -> PurePosixPath | None:
    """The cleaned path of an entry, None for a directory. Refuses a dangerous path or an entry that is not a plain file."""
    name = name.replace("\\", "/")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise TransferError(f"archive refusée : chemin dangereux ({name[:80]})")
    if kind == "dir":
        return None
    if kind != "file":
        raise TransferError(f"archive refusée : entrée qui n'est pas un fichier ({name[:80]})")
    return path


def _manifest_of(files: dict[str, bytes]) -> dict:
    """The manifest taken out of `files` (an empty one when it is missing or unreadable)."""
    if MANIFEST not in files:
        return {}
    try:
        got = json.loads(files.pop(MANIFEST))
    except ValueError:
        return {}
    return got if isinstance(got, dict) else {}


def _read_entries(entries, data: bytes) -> tuple[dict[str, bytes], list[str]]:
    files: dict[str, bytes] = {}
    ignored: list[str] = []
    total, count = 0, 0
    for name, kind, size, read in entries(data):
        count += 1
        if count > MAX_FILES:
            raise TransferError("archive refusée : trop de fichiers")
        path = _entry_name(name, kind)
        if path is None:
            continue
        if path.parts[:1] != ("config",) or len(path.parts) < 2:
            ignored.append(name.replace("\\", "/"))
            continue
        rel = "/".join(path.parts[1:])
        limit = limit_of(rel)
        if size > limit:
            raise TransferError(f"archive refusée : fichier trop gros ({name[:80]})")
        body = read(limit)
        total += len(body)
        if len(body) > limit or total > MAX_TOTAL:
            raise TransferError("archive refusée : contenu trop gros une fois ouvert")
        files[rel] = body
    return files, ignored


def read_archive(data: bytes) -> tuple[dict[str, bytes], dict, list[str]]:
    """(files, manifest, ignored names) from a ZIP (or an older .tar.gz). Raises TransferError for anything unsafe: the whole archive is refused."""
    if len(data) > MAX_ARCHIVE:
        raise TransferError(f"archive trop grosse (plus de {MAX_ARCHIVE >> 20} Mo)")
    if data[:2] == b"PK":
        entries = _zip_entries
    elif data[:2] == b"\x1f\x8b":
        entries = _tar_entries
    else:
        raise TransferError("ce n'est pas une archive .zip lisible")
    try:
        files, ignored = _read_entries(entries, data)
    except (tarfile.TarError, zipfile.BadZipFile, zipfile.LargeZipFile, EOFError, OSError, RuntimeError) as e:
        raise TransferError(f"ce n'est pas une archive lisible ({type(e).__name__})") from None
    manifest = _manifest_of(files)
    for rel in [r for r in files if part_of(r) is None]:
        ignored.append(f"config/{rel}")
        del files[rel]
    return files, manifest, ignored


def _json_problem(rel: str, body: bytes) -> str | None:
    try:
        ok = isinstance(json.loads(body), dict)
    except ValueError:
        ok = False
    return None if ok else f"{rel} : n'est pas un fichier JSON valide"


def _key_problem(body: bytes) -> str | None:
    from cryptography.fernet import Fernet
    try:
        Fernet(body.strip())
    except (ValueError, TypeError):
        return f"{KEY_FILE} : clé invalide"
    return None


def _encrypted_values(node) -> list[str]:
    import secrets_store
    if isinstance(node, str):
        return [node] if node.startswith(secrets_store.PREFIX) else []
    if isinstance(node, dict):
        return [v for x in node.values() for v in _encrypted_values(x)]
    if isinstance(node, list):
        return [v for x in node for v in _encrypted_values(x)]
    return []


def secrets_status(config_body: bytes, key: bytes | None) -> str:
    """'none' (nothing encrypted in this config.json), 'ok' (the key opens every secret), 'unreadable' (no key, or the wrong one)."""
    import secrets_store
    from cryptography.fernet import Fernet, InvalidToken
    try:
        values = _encrypted_values(json.loads(config_body))
    except ValueError:
        return "unreadable"
    if not values:
        return "none"
    if not key:
        return "unreadable"
    try:
        f = Fernet(key.strip())
        for v in values:
            f.decrypt(v[len(secrets_store.PREFIX):].encode())
    except (InvalidToken, ValueError, TypeError):
        return "unreadable"
    return "ok"


def _db_open(body: bytes, tmp: str) -> sqlite3.Connection:
    path = Path(tmp) / "incoming.db"
    path.write_bytes(body)
    return sqlite3.connect(path)


def db_facts(body: bytes) -> tuple[str | None, dict]:
    """(problem, facts) of an uploaded database: it must be a healthy MyServices one with an admin who can sign in."""
    with tempfile.TemporaryDirectory() as tmp:
        try:
            db = _db_open(body, tmp)
            try:
                if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    return "base de données abîmée", {}
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if not REQUIRED_TABLES <= tables:
                    return "ce n'est pas une base MyServices", {}
                admins = db.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND COALESCE(disabled, 0)=0").fetchone()[0]
                facts = {"users": db.execute("SELECT COUNT(*) FROM users").fetchone()[0], "events": db.execute("SELECT COUNT(*) FROM events").fetchone()[0]}
            finally:
                db.close()
        except sqlite3.DatabaseError:
            return "ce n'est pas une base de données lisible", {}
    return (None if admins else "aucun compte admin actif : plus personne ne pourrait se connecter"), facts


def problems(files: dict[str, bytes]) -> dict[str, str]:
    """{path: reason} for the files whose content is not what its name says."""
    out: dict[str, str] = {}
    for rel, body in files.items():
        reason = None
        if rel == DB_REL:
            reason = db_facts(body)[0]
        elif rel == KEY_FILE:
            reason = _key_problem(body)
        elif rel.endswith(".json"):
            reason = _json_problem(rel, body)
        if reason:
            out[rel] = reason
    return out


def _current_key(places: Places) -> bytes | None:
    try:
        return (places.config / KEY_FILE).read_bytes()
    except OSError:
        return None


def settings_status(files: dict[str, bytes], selected: list[str], places: Places) -> str:
    """Secrets of the imported config.json under the key that will be in place after the import."""
    if "settings" not in selected or CONFIG_FILE not in files:
        return "none"
    key = files.get(KEY_FILE) if "secrets" in selected and KEY_FILE in files else _current_key(places)
    return secrets_status(files[CONFIG_FILE], key)


def key_swap_unsafe(files: dict[str, bytes], selected: list[str], places: Places) -> bool:
    """True when the imported key would replace this installation's key while the current config.json (left as it is) holds secrets it cannot open."""
    if "secrets" not in selected or "settings" in selected or KEY_FILE not in files:
        return False
    try:
        current = (places.config / CONFIG_FILE).read_bytes()
    except OSError:
        return False
    return secrets_status(current, files[KEY_FILE]) == "unreadable"


def preview(data: bytes, places: Places) -> dict:
    """What an archive holds, part by part, and what would not work; nothing is written."""
    files, manifest, ignored = read_archive(data)
    bad, here = problems(files), present(places)
    parts = []
    for part in PARTS:
        names = sorted(r for r in files if part_of(r) == part)
        if names:
            facts = db_facts(files[DB_REL])[1] if part == "accounts" else {}
            parts.append({"id": part, "files": names, "bytes": sum(len(files[n]) for n in names), "sensitive": part in SENSITIVE, "facts": facts,
                          "problems": [bad[n] for n in names if n in bad], "exists_here": part in here,
                          "needs_key": part == "settings" and secrets_status(files[CONFIG_FILE], None) != "none"})
    every = [p["id"] for p in parts]
    return {"manifest": {k: manifest.get(k) for k in ("format", "app", "created")}, "parts": parts, "ignored": ignored[:20],
            "secrets": {"with_archive_key": settings_status(files, every, places), "with_current_key": settings_status(files, [p for p in every if p != "secrets"], places),
                        "swap_unsafe": key_swap_unsafe(files, ["secrets"], places)}}


def _keep_copy(target: Path) -> bool:
    if not target.is_file():
        return False
    shutil.copy2(target, target.with_name(target.name + BACKUP_SUFFIX))
    return True


def _restore_db(body: bytes, live: Path) -> bool:
    """Replaces the contents of the live database through SQLite's own backup (the app keeps its connections); the old one is kept next to it."""
    kept = False
    with tempfile.TemporaryDirectory() as tmp:
        src = _db_open(body, tmp)
        try:
            if live.is_file():
                old, copy = sqlite3.connect(live, timeout=30), sqlite3.connect(live.with_name(live.name + BACKUP_SUFFIX))
                try:
                    old.backup(copy)
                    kept = True
                finally:
                    old.close()
                    copy.close()
            live.parent.mkdir(parents=True, exist_ok=True)
            dst = sqlite3.connect(live, timeout=30)
            try:
                dst.execute("PRAGMA busy_timeout=30000")
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
    return kept


def _write_file(target: Path, body: bytes, ssh: bool) -> bool:
    target.parent.mkdir(parents=True, exist_ok=True)
    if ssh:
        target.parent.chmod(0o700)
    kept = _keep_copy(target)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_bytes(body)
    tmp.chmod(0o600)
    tmp.replace(target)
    return kept


def apply(data: bytes, selected: list[str], places: Places) -> dict:
    """Writes the chosen parts. Everything is checked first; an existing file is kept next to the new one as `<name>.avant-import`."""
    files, _, _ = read_archive(data)
    chosen = [p for p in PARTS if p in selected]
    if not chosen or len(chosen) != len(set(selected)):
        raise TransferError("choisir au moins une partie connue")
    todo = {rel: body for rel, body in files.items() if part_of(rel) in chosen}
    missing = [p for p in chosen if not any(part_of(r) == p for r in todo)]
    if missing:
        raise TransferError("absent de l'archive : " + ", ".join(missing))
    if bad := problems(todo):
        raise TransferError("; ".join(bad.values()))
    if settings_status(files, chosen, places) == "unreadable":
        raise TransferError("les mots de passe de config.json ne sont lisibles avec aucune clé disponible : importer aussi la partie « secrets » (secret.key)")
    if key_swap_unsafe(files, chosen, places):
        raise TransferError("remplacer la clé sans reprendre aussi les réglages de l'archive rendrait illisibles les mots de passe actuels : cocher aussi « Réglages et connecteurs »")
    written, kept = [], []
    for rel in sorted(todo):
        had = _restore_db(todo[rel], places.db) if rel == DB_REL else _write_file(disk_path(rel, places), todo[rel], rel.startswith("ssh/"))
        written.append(rel)
        if had:
            kept.append(rel)
    return {"written": written, "kept": kept, "restart": any(p in NEEDS_RESTART for p in chosen), "relogin": "accounts" in chosen}
