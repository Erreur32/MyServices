"""Export and import of the /config folder, whole or by part.

Parts: settings (config.json), machines (services-meta.json), backups (backups-meta.json), secrets (secret.key, the key that opens every
encrypted password and token of config.json) and ssh (the keys and the config of the SSH folder). The archive is a ZIP (a tar.gz from an older export is still read) of `config/...`
plus a MANIFEST.json. Nothing in an uploaded archive is trusted: names, types, sizes and contents are checked before anything is written,
and the same checks run again when the import is applied (the preview is only a preview).
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import tarfile
import time
import zipfile
from collections.abc import Callable
from pathlib import Path, PurePosixPath

FORMAT = 1
FILES = {"settings": ("config.json",), "machines": ("services-meta.json",), "backups": ("backups-meta.json",), "secrets": ("secret.key",)}
PARTS = (*FILES, "ssh")
SENSITIVE = ("secrets", "ssh")        # the parts the page warns about
NEEDS_RESTART = ("settings", "secrets")   # read once at start
MAX_ARCHIVE, MAX_FILE, MAX_TOTAL, MAX_FILES = 8 << 20, 2 << 20, 12 << 20, 200
SSH_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.@+-]{0,127}$")
BACKUP_SUFFIX = ".avant-import"


class TransferError(ValueError):
    """A reason the page can show as is."""


def part_of(rel: str) -> str | None:
    """The part a path of the archive (without its `config/` prefix) belongs to, or None when it is not ours."""
    for part, names in FILES.items():
        if rel in names:
            return part
    head, _, name = rel.partition("/")
    return "ssh" if head == "ssh" and SSH_NAME.match(name) else None


def present(root: Path) -> dict[str, list[str]]:
    """{part: file names} of what this installation has."""
    out: dict[str, list[str]] = {}
    for part, names in FILES.items():
        found = [n for n in names if (root / n).is_file()]
        if found:
            out[part] = found
    ssh = root / "ssh"
    if ssh.is_dir():
        found = sorted(f"ssh/{f.name}" for f in ssh.iterdir() if f.is_file() and not f.is_symlink() and SSH_NAME.match(f.name))
        if found:
            out["ssh"] = found
    return out


def export_config(root: Path, parts: list[str] | None = None, version: str = "") -> bytes:
    """ZIP of the chosen parts (all of them when `parts` is None), with a manifest listing what is inside."""
    chosen = list(PARTS) if parts is None else [p for p in PARTS if p in parts]
    if not chosen:
        raise TransferError("rien à exporter : choisir au moins une partie")
    unknown = [p for p in (parts or []) if p not in PARTS]
    if unknown:
        raise TransferError("partie inconnue : " + ", ".join(unknown))
    have, now, hashes = present(root), time.time(), {}
    buf = io.BytesIO()

    def add(zf: zipfile.ZipFile, name: str, data: bytes) -> None:
        info = zipfile.ZipInfo(f"config/{name}", time.localtime(now)[:6])
        info.external_attr = 0o600 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, data)

    with zipfile.ZipFile(buf, "w") as zf:
        for part in chosen:
            for rel in have.get(part, []):
                data = (root / rel).read_bytes()
                hashes[rel] = hashlib.sha256(data).hexdigest()
                add(zf, rel, data)
        manifest = {"format": FORMAT, "app": version, "created": int(now), "parts": [p for p in chosen if have.get(p)], "files": hashes}
        add(zf, "MANIFEST.json", json.dumps(manifest, indent=2).encode())
    return buf.getvalue()


# An entry of an archive, whatever its format: (name, kind, size, read) with kind "dir", "file" or "other" (link, device…)
Entry = tuple[str, str, int, "Callable[[], bytes]"]


def _zip_entries(data: bytes):
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            mode = (info.external_attr >> 16) & 0o170000
            if info.flag_bits & 0x1:
                raise TransferError("archive refusée : fichier chiffré par mot de passe")
            kind = "dir" if info.is_dir() else "other" if mode in (0o120000, 0o060000, 0o020000, 0o010000, 0o140000) else "file"
            yield info.filename, kind, info.file_size, lambda i=info: zf.open(i).read(MAX_FILE + 1)


def _tar_entries(data: bytes):
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for m in tar:
            kind = "dir" if m.isdir() else "file" if m.isfile() else "other"
            yield m.name, kind, m.size, lambda m=m: tar.extractfile(m).read(MAX_FILE + 1)   # type: ignore[union-attr]


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
    files: dict[str, bytes] = {}
    ignored: list[str] = []
    total, count = 0, 0
    try:
        for name, kind, size, read in entries(data):
            count += 1
            if count > MAX_FILES:
                raise TransferError("archive refusée : trop de fichiers")
            name = name.replace("\\", "/")
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts:
                raise TransferError(f"archive refusée : chemin dangereux ({name[:80]})")
            if kind == "dir":
                continue
            if kind != "file":
                raise TransferError(f"archive refusée : entrée qui n'est pas un fichier ({name[:80]})")
            if path.parts[:1] != ("config",) or len(path.parts) < 2:
                ignored.append(name)
                continue
            if size > MAX_FILE:
                raise TransferError(f"archive refusée : fichier trop gros ({name[:80]})")
            body = read()
            total += len(body)
            if len(body) > MAX_FILE or total > MAX_TOTAL:
                raise TransferError("archive refusée : contenu trop gros une fois ouvert")
            files["/".join(path.parts[1:])] = body
    except (tarfile.TarError, zipfile.BadZipFile, zipfile.LargeZipFile, EOFError, OSError, RuntimeError) as e:
        raise TransferError(f"ce n'est pas une archive lisible ({type(e).__name__})") from None
    manifest: dict = {}
    if "MANIFEST.json" in files:
        try:
            got = json.loads(files.pop("MANIFEST.json"))
            manifest = got if isinstance(got, dict) else {}
        except ValueError:
            manifest = {}
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
        return "secret.key : clé invalide"
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


def problems(files: dict[str, bytes]) -> dict[str, str]:
    """{path: reason} for the files whose content is not what its name says."""
    out: dict[str, str] = {}
    for rel, body in files.items():
        reason = _key_problem(body) if rel == "secret.key" else _json_problem(rel, body) if rel.endswith(".json") else None
        if reason:
            out[rel] = reason
    return out


def _current_key(root: Path) -> bytes | None:
    try:
        return (root / "secret.key").read_bytes()
    except OSError:
        return None


def settings_status(files: dict[str, bytes], selected: list[str], root: Path) -> str:
    """Secrets of the imported config.json under the key that will be in place after the import."""
    if "settings" not in selected or "config.json" not in files:
        return "none"
    key = files.get("secret.key") if "secrets" in selected and "secret.key" in files else _current_key(root)
    return secrets_status(files["config.json"], key)


def preview(data: bytes, root: Path) -> dict:
    """What an archive holds, part by part, and what would not work; nothing is written."""
    files, manifest, ignored = read_archive(data)
    bad = problems(files)
    parts = []
    for part in PARTS:
        names = sorted(r for r in files if part_of(r) == part)
        if names:
            parts.append({"id": part, "files": names, "bytes": sum(len(files[n]) for n in names), "sensitive": part in SENSITIVE,
                          "problems": [bad[n] for n in names if n in bad], "exists_here": part in present(root)})
    every = [p["id"] for p in parts]
    return {"manifest": {k: manifest.get(k) for k in ("format", "app", "created")}, "parts": parts, "ignored": ignored[:20],
            "secrets": {"with_archive_key": settings_status(files, every, root), "with_current_key": settings_status(files, [p for p in every if p != "secrets"], root)}}


def apply(data: bytes, selected: list[str], root: Path) -> dict:
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
    if settings_status(files, chosen, root) == "unreadable":
        raise TransferError("les mots de passe de config.json ne sont lisibles avec aucune clé disponible : importer aussi la partie « secrets » (secret.key)")
    written, kept = [], []
    for rel in sorted(todo):
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if rel.startswith("ssh/"):
            target.parent.chmod(0o700)
        if target.is_file():
            shutil.copy2(target, target.with_name(target.name + BACKUP_SUFFIX))
            kept.append(rel)
        tmp = target.with_name(target.name + ".tmp")
        tmp.write_bytes(todo[rel])
        tmp.chmod(0o600)
        tmp.replace(target)
        written.append(rel)
    return {"written": written, "kept": kept, "restart": any(p in NEEDS_RESTART for p in chosen)}
