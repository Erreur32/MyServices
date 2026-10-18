"""config_transfer.py: export by part, preview and import of an archive, and the refusal of anything unsafe."""
from __future__ import annotations

import io
import json
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

    def target(self) -> Path:
        return Path(tempfile.mkdtemp(dir=self.tmp.name))


class Export(Base):
    def names(self, data: bytes) -> list[str]:
        files, _, _ = ct.read_archive(data)
        return sorted(files)

    def test_everything_by_default_with_a_manifest(self):
        data = ct.export_config(self.root, None, "0.14.0")
        self.assertEqual(self.names(data), ["backups-meta.json", "config.json", "secret.key", "services-meta.json", "ssh/config", "ssh/id_test"])
        _, manifest, _ = ct.read_archive(data)
        self.assertEqual((manifest["format"], manifest["app"]), (1, "0.14.0"))

    def test_only_the_chosen_parts(self):
        self.assertEqual(self.names(ct.export_config(self.root, ["machines", "backups"])), ["backups-meta.json", "services-meta.json"])

    def test_refuses_nothing_or_unknown(self):
        with self.assertRaises(ct.TransferError):
            ct.export_config(self.root, [])
        with self.assertRaises(ct.TransferError):
            ct.export_config(self.root, ["machines", "nope"])


class Import(Base):
    def test_roundtrip_into_an_empty_folder(self):
        data = ct.export_config(self.root)
        out = self.target()
        got = ct.apply(data, list(ct.PARTS), out)
        self.assertTrue(got["restart"])
        self.assertEqual(json.loads((out / "services-meta.json").read_text())["machines"]["10.0.0.2"]["name"], "pc")
        self.assertEqual((out / "secret.key").read_bytes(), self.key)
        self.assertEqual((out / "config.json").stat().st_mode & 0o777, 0o600)

    def test_machines_only_leaves_the_rest_alone_and_keeps_the_old_file(self):
        data = ct.export_config(self.root)
        out = self.target()
        (out / "services-meta.json").write_text('{"machines": {}}')
        got = ct.apply(data, ["machines"], out)
        self.assertFalse(got["restart"])
        self.assertEqual(got["written"], ["services-meta.json"])
        self.assertEqual((out / ("services-meta.json" + ct.BACKUP_SUFFIX)).read_text(), '{"machines": {}}')
        self.assertFalse((out / "config.json").exists())

    def test_settings_alone_need_a_key_that_opens_the_secrets(self):
        data = ct.export_config(self.root, ["settings", "secrets"])
        out = self.target()
        with self.assertRaises(ct.TransferError):
            ct.apply(data, ["settings"], out)                     # no key here, none imported
        (out / "secret.key").write_bytes(make_key())
        with self.assertRaises(ct.TransferError):
            ct.apply(data, ["settings"], out)                     # another key here
        self.assertEqual(ct.apply(data, ["settings", "secrets"], out)["written"], ["config.json", "secret.key"])
        (out / "config.json").unlink()
        self.assertEqual(ct.apply(data, ["settings"], out)["written"], ["config.json"])   # the imported key is now in place

    def test_preview_lists_the_parts_and_warns_about_the_key(self):
        data = ct.export_config(self.root)
        got = ct.preview(data, self.target())
        self.assertEqual([p["id"] for p in got["parts"]], ["settings", "machines", "backups", "secrets", "ssh"])
        self.assertEqual(got["secrets"], {"with_archive_key": "ok", "with_current_key": "unreadable"})
        self.assertTrue(next(p for p in got["parts"] if p["id"] == "ssh")["sensitive"])

    def test_part_missing_from_the_archive_is_refused(self):
        data = ct.export_config(self.root, ["machines"])
        with self.assertRaises(ct.TransferError):
            ct.apply(data, ["backups"], self.target())

    def test_invalid_contents_are_refused(self):
        bad_json = tar_of([("config/services-meta.json", b"{nope", None)])
        with self.assertRaises(ct.TransferError):
            ct.apply(bad_json, ["machines"], self.target())
        bad_key = tar_of([("config/secret.key", b"short", None)])
        with self.assertRaises(ct.TransferError):
            ct.apply(bad_key, ["secrets"], self.target())


class Zip(Base):
    def test_the_export_is_a_zip_anyone_can_open(self):
        data = ct.export_config(self.root, ["machines"])
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
        with self.assertRaises(ct.TransferError):
            ct.read_archive(zip_of([("config/config.json", b"x" * (ct.MAX_FILE + 1))]))
        with self.assertRaises(ct.TransferError):
            ct.read_archive(b"PK\x03\x04 not really")


class Unsafe(Base):
    def refuses(self, entries):
        with self.assertRaises(ct.TransferError):
            ct.read_archive(tar_of(entries))

    def test_paths_that_escape(self):
        self.refuses([("config/../evil", b"x", None)])
        self.refuses([("/etc/passwd", b"x", None)])
        self.refuses([("config/ssh/../../x", b"x", None)])

    def test_links_are_refused(self):
        self.refuses([("config/config.json", b"", tarfile.SYMTYPE)])

    def test_not_an_archive_or_too_big(self):
        with self.assertRaises(ct.TransferError):
            ct.read_archive(b"hello")
        with self.assertRaises(ct.TransferError):
            ct.read_archive(b"x" * (ct.MAX_ARCHIVE + 1))
        self.refuses([("config/config.json", b"x" * (ct.MAX_FILE + 1), None)])

    def test_unknown_files_are_ignored_not_written(self):
        data = tar_of([("config/services-meta.json", b"{}", None), ("config/evil.sh", b"x", None), ("other/a", b"x", None), ("config/ssh/sub/deep", b"x", None)])
        files, _, ignored = ct.read_archive(data)
        self.assertEqual(sorted(files), ["services-meta.json"])
        self.assertEqual(len(ignored), 3)
        out = self.target()
        ct.apply(data, ["machines"], out)
        self.assertEqual(sorted(p.name for p in out.iterdir()), ["services-meta.json"])


if __name__ == "__main__":
    unittest.main()
