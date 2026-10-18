"""config_transfer.py: export by part, preview and import of an archive, and the refusal of anything unsafe."""
from __future__ import annotations

import io
import json
import sqlite3
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config_transfer as ct  # noqa: E402


def make_key() -> bytes:
    from cryptography.fernet import Fernet
    return Fernet.generate_key()


def encrypted(key: bytes, text: str) -> str:
    from cryptography.fernet import Fernet
    import secrets_store
    return secrets_store.PREFIX + Fernet(key).encrypt(text.encode()).decode()


def tar_of(entries: list[tuple[str, bytes, bytes | None]]) -> bytes:
    """entries: (name, content, type) with type None = regular file, tarfile.SYMTYPE for a link."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, body, kind in entries:
            info = tarfile.TarInfo(name)
            if kind == tarfile.SYMTYPE:
                info.type, info.linkname = tarfile.SYMTYPE, "/etc/passwd"
                tar.addfile(info)
            else:
                info.size = len(body)
                tar.addfile(info, io.BytesIO(body))
    return buf.getvalue()


def zip_of(entries: list[tuple[str, bytes]], link: str | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, body in entries:
            zf.writestr(name, body)
        if link:
            info = zipfile.ZipInfo(link)
            info.external_attr = 0o120777 << 16
            zf.writestr(info, "/etc/passwd")
    return buf.getvalue()


def make_db(path: Path, admin: bool = True) -> None:
    db = sqlite3.connect(path)
    db.executescript("""CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, disabled INTEGER);
        CREATE TABLE sessions (token_hash TEXT, user_id INTEGER);
        CREATE TABLE resets (token_hash TEXT);
        CREATE TABLE login_failures (ip TEXT, ts REAL);
        CREATE TABLE events (id INTEGER PRIMARY KEY, kind TEXT);
        CREATE TABLE audit (id INTEGER PRIMARY KEY, what TEXT);""")
    db.execute("INSERT INTO users (username, role, disabled) VALUES ('boss', ?, 0)", ("admin" if admin else "viewer",))
    db.execute("INSERT INTO sessions VALUES ('h', 1)")
    db.execute("INSERT INTO login_failures VALUES ('1.2.3.4', 1)")
    db.executemany("INSERT INTO events (kind) VALUES (?)", [("down",), ("up",)])
    db.commit()
    db.close()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "config"
        (self.root / "ssh").mkdir(parents=True)
        self.key = make_key()
        (self.root / "secret.key").write_bytes(self.key)
        (self.root / "config.json").write_text(json.dumps({"smtp_password": encrypted(self.key, "pw"), "pulse_every": 45}))
        (self.root / "services-meta.json").write_text(json.dumps({"machines": {"10.0.0.2": {"name": "pc"}}}))
        (self.root / "backups-meta.json").write_text("{}")
        (self.root / "ssh" / "config").write_text("Host a\n")
        (self.root / "ssh" / "id_test").write_text("not a real key")
        self.state = Path(self.tmp.name) / "state"
        self.state.mkdir()
        (self.state / "services-decided.json").write_text('{"local:10.0.0.2:80": 1}')
        (self.state / "diagnostic-accepted.json").write_text('{"aa|speed_100|2|": "hub"}')
        (self.state / "health.json").write_text("{}")   # generated, not a decision
        self.db = Path(self.tmp.name) / "data" / "myservices.db"
        self.db.parent.mkdir()
        make_db(self.db)
        self.places = ct.Places(self.root, self.state, self.db)

    def target(self) -> ct.Places:
        base = Path(tempfile.mkdtemp(dir=self.tmp.name))
        (base / "config").mkdir()
        (base / "state").mkdir()
        return ct.Places(base / "config", base / "state", base / "data" / "myservices.db")


class Export(Base):
    def names(self, data: bytes) -> list[str]:
        files, _, _ = ct.read_archive(data)
        return sorted(files)

    def test_everything_by_default_with_a_manifest(self):
        data = ct.export_config(self.places, None, "0.14.0")
        self.assertEqual(self.names(data), ["backups-meta.json", "config.json", "data/myservices.db", "secret.key", "services-meta.json", "ssh/config", "ssh/id_test",
                                            "state/diagnostic-accepted.json", "state/services-decided.json"])
        _, manifest, _ = ct.read_archive(data)
        self.assertEqual((manifest["format"], manifest["app"]), (1, "0.14.0"))

    def test_only_the_chosen_parts(self):
        self.assertEqual(self.names(ct.export_config(self.places, ["machines", "backups"])), ["backups-meta.json", "services-meta.json"])

    def test_refuses_nothing_or_unknown(self):
        with self.assertRaises(ct.TransferError):
            ct.export_config(self.places, [])
        with self.assertRaises(ct.TransferError):
            ct.export_config(self.places, ["machines", "nope"])


class Import(Base):
    def test_roundtrip_into_an_empty_folder(self):
        data = ct.export_config(self.places)
        out = self.target()
        got = ct.apply(data, list(ct.PARTS), out)
        self.assertTrue(got["restart"])
        self.assertEqual(json.loads((out.config / "services-meta.json").read_text())["machines"]["10.0.0.2"]["name"], "pc")
        self.assertEqual((out.config / "secret.key").read_bytes(), self.key)
        self.assertEqual((out.config / "config.json").stat().st_mode & 0o777, 0o600)

    def test_machines_only_leaves_the_rest_alone_and_keeps_the_old_file(self):
        data = ct.export_config(self.places)
        out = self.target()
        (out.config / "services-meta.json").write_text('{"machines": {}}')
        got = ct.apply(data, ["machines"], out)
        self.assertFalse(got["restart"])
        self.assertEqual(got["written"], ["services-meta.json"])
        self.assertEqual((out.config / ("services-meta.json" + ct.BACKUP_SUFFIX)).read_text(), '{"machines": {}}')
        self.assertFalse((out.config / "config.json").exists())

    def test_settings_alone_need_a_key_that_opens_the_secrets(self):
        data = ct.export_config(self.places, ["settings", "secrets"])
        out = self.target()
        with self.assertRaises(ct.TransferError):
            ct.apply(data, ["settings"], out)                     # no key here, none imported
        (out.config / "secret.key").write_bytes(make_key())
        with self.assertRaises(ct.TransferError):
            ct.apply(data, ["settings"], out)                     # another key here
        self.assertEqual(ct.apply(data, ["settings", "secrets"], out)["written"], ["config.json", "secret.key"])
        (out.config / "config.json").unlink()
        self.assertEqual(ct.apply(data, ["settings"], out)["written"], ["config.json"])   # the imported key is now in place

    def test_preview_lists_the_parts_and_warns_about_the_key(self):
        data = ct.export_config(self.places)
        got = ct.preview(data, self.target())
        self.assertEqual([p["id"] for p in got["parts"]], ["settings", "machines", "backups", "decisions", "accounts", "secrets", "ssh"])
        self.assertEqual(got["secrets"], {"with_archive_key": "ok", "with_current_key": "unreadable", "swap_unsafe": False})
        self.assertTrue(next(p for p in got["parts"] if p["id"] == "ssh")["sensitive"])

    def test_importing_only_the_key_would_lock_the_current_settings_out(self):
        data = ct.export_config(self.places, ["secrets"])
        out = self.target()
        (out.config / "secret.key").write_bytes(make_key())
        (out.config / "config.json").write_text(json.dumps({"smtp_password": encrypted(out.config.joinpath("secret.key").read_bytes(), "pw")}))
        self.assertTrue(ct.preview(data, out)["secrets"]["swap_unsafe"])
        with self.assertRaises(ct.TransferError):
            ct.apply(data, ["secrets"], out)
        self.assertEqual(ct.apply(ct.export_config(self.places, ["settings", "secrets"]), ["settings", "secrets"], out)["written"], ["config.json", "secret.key"])

    def test_preview_flags_the_part_that_needs_the_key(self):
        got = ct.preview(ct.export_config(self.places, ["settings", "machines", "secrets"]), self.target())
        self.assertEqual({p["id"]: p["needs_key"] for p in got["parts"]}, {"settings": True, "machines": False, "secrets": False})

    def test_part_missing_from_the_archive_is_refused(self):
        data = ct.export_config(self.places, ["machines"])
        out = self.target()
        with self.assertRaises(ct.TransferError):
            ct.apply(data, ["backups"], out)

    def test_invalid_contents_are_refused(self):
        bad_json = tar_of([("config/services-meta.json", b"{nope", None)])
        out = self.target()
        with self.assertRaises(ct.TransferError):
            ct.apply(bad_json, ["machines"], out)
        bad_key = tar_of([("config/secret.key", b"short", None)])
        with self.assertRaises(ct.TransferError):
            ct.apply(bad_key, ["secrets"], out)


class Data(Base):
    """The two parts that do not live in /config: the decisions (state folder) and the accounts and history (database)."""

    def test_decisions_are_only_the_choices_not_the_generated_files(self):
        files, _, _ = ct.read_archive(ct.export_config(self.places, ["decisions"]))
        self.assertEqual(sorted(files), ["state/diagnostic-accepted.json", "state/services-decided.json"])
        out = self.target()
        ct.apply(ct.export_config(self.places, ["decisions"]), ["decisions"], out)
        self.assertEqual(json.loads((out.state / "services-decided.json").read_text()), {"local:10.0.0.2:80": 1})

    def test_the_database_travels_without_logins(self):
        files, _, _ = ct.read_archive(ct.export_config(self.places, ["accounts"]))
        copy = Path(self.tmp.name) / "copy.db"
        copy.write_bytes(files[ct.DB_REL])
        db = sqlite3.connect(copy)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 2)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM login_failures").fetchone()[0], 0)
        db.close()

    def test_import_replaces_the_live_database_and_keeps_the_old_one(self):
        data = ct.export_config(self.places, ["accounts"])
        out = self.target()
        out.db.parent.mkdir()
        make_db(out.db)
        live = sqlite3.connect(out.db)
        live.execute("INSERT INTO users (username, role, disabled) VALUES ('other', 'viewer', 0)")
        live.commit()
        got = ct.apply(data, ["accounts"], out)
        self.assertTrue(got["relogin"])
        self.assertEqual(live.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)   # the open connection sees the new contents
        live.close()
        old = sqlite3.connect(out.db.with_name(out.db.name + ct.BACKUP_SUFFIX))
        self.assertEqual(old.execute("SELECT COUNT(*) FROM users").fetchone()[0], 2)
        old.close()

    def test_a_database_nobody_could_sign_in_to_is_refused(self):
        bad = Path(self.tmp.name) / "noadmin.db"
        make_db(bad, admin=False)
        data = zip_of([("config/" + ct.DB_REL, bad.read_bytes())])
        out = self.target()
        with self.assertRaises(ct.TransferError):
            ct.apply(data, ["accounts"], out)
        junk = zip_of([("config/" + ct.DB_REL, b"not a database at all, just text")])
        with self.assertRaises(ct.TransferError):
            ct.apply(junk, ["accounts"], out)

    def test_preview_tells_what_is_in_the_database(self):
        got = ct.preview(ct.export_config(self.places, ["accounts"]), self.target())
        self.assertEqual(got["parts"][0]["facts"], {"users": 1, "events": 2})
        self.assertTrue(got["parts"][0]["sensitive"])


class Zip(Base):
    def test_the_export_is_a_zip_anyone_can_open(self):
        data = ct.export_config(self.places, ["machines"])
        self.assertEqual(data[:2], b"PK")
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            self.assertEqual(sorted(zf.namelist()), ["config/MANIFEST.json", "config/services-meta.json"])

    def test_an_older_tar_gz_export_is_still_read(self):
        data = tar_of([("config/services-meta.json", b"{}", None)])
        self.assertEqual(list(ct.read_archive(data)[0]), ["services-meta.json"])

    def test_unsafe_zips_are_refused(self):
        for data in (zip_of([("config/../evil", b"x")]), zip_of([("/etc/passwd", b"x")]), zip_of([], link="config/config.json")):
            with self.assertRaises(ct.TransferError):
                ct.read_archive(data)
        too_big = zip_of([("config/config.json", b"x" * (ct.MAX_FILE + 1))])
        with self.assertRaises(ct.TransferError):
            ct.read_archive(too_big)
        with self.assertRaises(ct.TransferError):
            ct.read_archive(b"PK\x03\x04 not really")


class Unsafe(Base):
    def refuses(self, entries):
        archive = tar_of(entries)
        with self.assertRaises(ct.TransferError):
            ct.read_archive(archive)

    def test_paths_that_escape(self):
        self.refuses([("config/../evil", b"x", None)])
        self.refuses([("/etc/passwd", b"x", None)])
        self.refuses([("config/ssh/../../x", b"x", None)])

    def test_links_are_refused(self):
        self.refuses([("config/config.json", b"", tarfile.SYMTYPE)])

    def test_not_an_archive_or_too_big(self):
        with self.assertRaises(ct.TransferError):
            ct.read_archive(b"hello")
        oversized = b"x" * (ct.MAX_ARCHIVE + 1)
        with self.assertRaises(ct.TransferError):
            ct.read_archive(oversized)
        self.refuses([("config/config.json", b"x" * (ct.MAX_FILE + 1), None)])

    def test_unknown_files_are_ignored_not_written(self):
        data = tar_of([("config/services-meta.json", b"{}", None), ("config/evil.sh", b"x", None), ("other/a", b"x", None), ("config/ssh/sub/deep", b"x", None)])
        files, _, ignored = ct.read_archive(data)
        self.assertEqual(sorted(files), ["services-meta.json"])
        self.assertEqual(len(ignored), 3)
        out = self.target()
        ct.apply(data, ["machines"], out)
        self.assertEqual(sorted(p.name for p in out.config.iterdir()), ["services-meta.json"])


if __name__ == "__main__":
    unittest.main()
