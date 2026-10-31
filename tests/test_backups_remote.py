"""Backup folder on a box over FTP / FTPS / Samba (connectors/remote_folder.py) and its assistant (backups_admin.remote_*).

  python3 -m unittest discover -s tests
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.backups import backups  # noqa: E402
from msv.backups import backups_admin as ba  # noqa: E402
from connectors import remote_folder as rf  # noqa: E402
from connectors.base import ConnectorError, Context  # noqa: E402

SECRET = "mdp-de-test"
NOW = 1_790_000_000
DAY = 86400
TREE = {   # fake box: folder -> entries
    "/": [{"name": "backups", "is_dir": True, "size": 0, "mtime": 0}],
    "/backups": [{"name": "pve", "is_dir": True, "size": 0, "mtime": 0}, {"name": "old.tar", "is_dir": False, "size": 10, "mtime": NOW - 9 * DAY},
                 {"name": ".hidden", "is_dir": False, "size": 1, "mtime": NOW}],
    "/backups/pve": [{"name": "a.vma", "is_dir": False, "size": 100, "mtime": NOW - DAY}, {"name": "b.vma", "is_dir": False, "size": 50, "mtime": NOW - 3 * DAY}],
}


def fake_list(self, path="/"):
    path = rf.check_path(path)
    if path not in TREE:
        raise ConnectorError("FTP : 550 No such file or directory")
    return TREE[path]


def conn(**kw):
    return rf.RemoteFolder({"name": "box", "protocol": "ftp", "host": "192.168.1.254", **kw}, Context())


class Parsing(unittest.TestCase):
    def test_list_unix(self):
        e = rf.parse_list_line("-rw-r--r--   1 ftp ftp   123456 Oct 10 12:34 vzdump-qemu-100.vma.zst", NOW)
        self.assertEqual((e["name"], e["is_dir"], e["size"]), ("vzdump-qemu-100.vma.zst", False, 123456))
        d = rf.parse_list_line("drwxr-xr-x   2 ftp ftp 4096 Jan  3  2024 sauvegardes", NOW)
        self.assertEqual((d["name"], d["is_dir"]), ("sauvegardes", True))
        self.assertIsNone(rf.parse_list_line("total 12", NOW))
        self.assertIsNone(rf.parse_list_line("drwxr-xr-x 2 ftp ftp 4096 Jan 3 2024 ..", NOW))

    def test_list_this_year_not_in_the_future(self):
        t = rf.parse_list_line("-rw-r--r-- 1 u g 1 Dec 31 23:00 x", 1_790_000_000)["mtime"]   # now = 2026-09: « Dec 31 » is last year
        self.assertLess(t, 1_790_000_000)

    def test_smb(self):
        e = rf.parse_smb_line("  config-2026.tar.gz                   N  2048576  Thu Oct  8 03:00:01 2026")
        self.assertEqual((e["name"], e["is_dir"], e["size"]), ("config-2026.tar.gz", False, 2048576))
        self.assertTrue(rf.parse_smb_line("  Sauvegarde PVE                      D        0  Thu Oct  8 03:00:01 2026")["is_dir"])
        self.assertIsNone(rf.parse_smb_line("  .                                   D        0  Thu Oct  8 03:00:01 2026"))
        self.assertIsNone(rf.parse_smb_line("\t\t7999413 blocks of size 1024. 4012345 blocks available"))

    def test_chemins_refuses(self):
        for bad in ("/a/../b", '/a"b', "/a;b", "/a\nb", "/" + "x" * 301, "/$(id)"):
            with self.assertRaises(ConnectorError, msg=bad):
                rf.check_path(bad)
        self.assertEqual(rf.check_path("backups/pve/"), "/backups/pve")

    def test_validation(self):
        self.assertEqual(rf.RemoteFolder.validate({"protocol": "ftp", "host": "192.168.1.254"}), [])
        self.assertTrue(rf.RemoteFolder.validate({"protocol": "ftp", "host": "-oProxy x"}))
        self.assertTrue(rf.RemoteFolder.validate({"protocol": "smb", "host": "nas"}))   # no share
        self.assertEqual(rf.RemoteFolder.validate({"protocol": "smb", "host": "nas", "share": "backup"}), [])
        self.assertTrue(rf.RemoteFolder.validate({"protocol": "sftp", "host": "nas"}))


class FakeFtp:
    def __init__(self, mlsd=None, lines=()):
        self._mlsd, self.lines = mlsd, lines

    def mlsd(self, path, facts=()):
        import ftplib
        if self._mlsd is None:
            raise ftplib.error_perm("500 MLSD not understood")
        return iter(self._mlsd)

    def retrlines(self, cmd, cb):
        for l in self.lines:
            cb(l)


class FtpListing(unittest.TestCase):
    def test_mlsd(self):
        ftp = FakeFtp(mlsd=[(".", {"type": "cdir"}), ("d", {"type": "dir", "modify": "20261008030001"}),
                            ("f.tar", {"type": "file", "size": "42", "modify": "20261008030001"})])
        out = conn()._list_ftp(ftp, "/x")
        self.assertEqual([(e["name"], e["is_dir"], e["size"]) for e in out], [("d", True, 0), ("f.tar", False, 42)])
        self.assertEqual(out[1]["mtime"], 1791428401)   # 2026-10-08 03:00:01 UTC

    def test_repli_sur_list(self):
        ftp = FakeFtp(lines=["total 4", "-rw-r--r-- 1 ftp ftp 7 Oct 10 12:34 a.tar", "drwxr-xr-x 2 ftp ftp 4096 Oct 10 12:34 sub"])
        self.assertEqual([(e["name"], e["is_dir"]) for e in conn()._list_ftp(ftp, "/")], [("a.tar", False), ("sub", True)])


class Scan(unittest.TestCase):
    def test_forme_de_l_agent_ssh(self):
        with mock.patch.object(rf.RemoteFolder, "list_dir", fake_list):
            out = conn().scan("/backups", depth=2)
        self.assertTrue(out["exists"])
        self.assertEqual((out["count"], out["size"]), (3, 160))            # hidden file skipped
        self.assertEqual([f["name"] for f in out["files"]], ["pve/a.vma", "pve/b.vma", "old.tar"])   # newest first, relative names
        with mock.patch.object(rf.RemoteFolder, "list_dir", fake_list):
            self.assertEqual(conn().scan("/backups", depth=1)["count"], 1)   # no sub-folder at depth 1
            self.assertEqual(conn().scan("/nope"), {"exists": False})

    def test_erreur_reseau_reste_une_erreur(self):
        with mock.patch.object(rf.RemoteFolder, "list_dir", side_effect=ConnectorError("FTP : timed out")):
            box = conn()
            with self.assertRaises(ConnectorError):
                box.scan("/backups")


class Collect(unittest.TestCase):
    def test_remote_collect_lit_les_emplacements_suivis(self):
        cfg = {"connectors": [{"type": "backup-folder", "name": "box", "protocol": "ftp", "host": "192.168.1.254"}]}
        with mock.patch.dict("msv.backups.backups.CFG", cfg), mock.patch.object(rf.RemoteFolder, "list_dir", fake_list):
            res, err = backups.remote_collect({"id": "remote-box", "connector": "box"}, [("s#0", {"path": "/backups/pve", "depth": 1}), ("s#1", {"path": "/nope"})])
            gone, err2 = backups.remote_collect({"id": "x", "connector": "autre"}, [])
        self.assertEqual(err, "")
        self.assertEqual(res["locs"]["s#0"]["count"], 2)
        self.assertEqual(res["locs"]["s#1"], {"exists": False})
        self.assertIsNone(gone)
        self.assertIn("absent de config.json", err2)

    def test_analyse_comme_un_dossier_local(self):
        meta = {"hosts": [{"id": "remote-box", "label": "box", "api": "remote"}],
                "sets": [{"id": "s", "label": "PVE", "origin": "remote-box", "max_age_days": 2, "expect_offsite": False,
                          "locations": [{"host": "remote-box", "path": "/backups/pve", "depth": 1}]}]}
        data = {"user": "FTP", "locs": {"s#0": {"exists": True, "count": 2, "size": 150, "files": [{"name": "a.vma", "mtime": NOW - DAY, "size": 100}]}},
                "disks": [], "crons": [], "cron_root": None}
        out = backups.analyse(meta, {"remote-box": (data, "")}, {}, NOW)
        self.assertEqual(out["sets"][0]["locations"][0]["level"], "ok")
        old = dict(data, locs={"s#0": {"exists": True, "count": 2, "size": 150, "files": [{"name": "a.vma", "mtime": NOW - 9 * DAY, "size": 100}]}})
        self.assertEqual(backups.analyse(meta, {"remote-box": (old, "")}, {}, NOW)["sets"][0]["locations"][0]["level"], "crit")

    def test_missing_folder_names_the_path_to_create(self):
        meta = {"hosts": [{"id": "remote-box", "label": "Freebox", "api": "remote"}],
                "sets": [{"id": "s", "label": "PVE", "origin": "remote-box", "max_age_days": 2, "expect_offsite": False,
                          "locations": [{"host": "remote-box", "path": "/backups/pve", "depth": 1}]}]}
        data = {"user": "FTP", "locs": {"s#0": {"exists": False}}, "disks": [], "crons": [], "cron_root": None}
        loc = backups.analyse(meta, {"remote-box": (data, "")}, {}, NOW)["sets"][0]["locations"][0]
        self.assertEqual((loc["level"], loc["detail"]), ("crit", "dossier absent : /backups/pve (à créer sur Freebox)"))


class Assistant(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = Path(self.tmp.name)
        self.meta, self.config = d / "backups-meta.json", d / "config.json"
        self.config.write_text("{}", encoding="utf-8")
        for p in (mock.patch.dict("msv.core.config.CFG", {"backups_meta": str(self.meta), "backups_url": ""}),
                  mock.patch.dict(os.environ, {"MYSERVICES_CONFIG": str(self.config)}),
                  mock.patch.object(ba.setup, "META", d / "services-meta.json"), mock.patch.object(ba.setup, "EXAMPLE_BACKUPS", d / "example.json"),
                  mock.patch.object(rf.RemoteFolder, "list_dir", fake_list)):
            p.start()
            self.addCleanup(p.stop)

    def acct(self, **kw):
        return {"name": "Freebox", "protocol": "ftp", "host": "192.168.1.254", "user": "ms", "password": SECRET, **kw}

    def test_essai_et_parcours_sans_rien_enregistrer(self):
        self.assertEqual(ba.remote_test(self.acct()), {"ok": True, "message": "connecté : 1 élément(s) à la racine"})
        out = ba.remote_browse(self.acct(), "/backups")
        self.assertEqual((out["folders"], out["file_count"], out["size"]), (["pve"], 2, 10 + 1))   # .hidden still listed here: browsing shows all
        self.assertEqual(self.config.read_text(encoding="utf-8"), "{}")
        self.assertFalse(self.meta.exists())
        acct = self.acct()
        with self.assertRaises(ba.BackupError):
            ba.remote_browse(acct, "/nope")
        acct = self.acct()
        with self.assertRaises(ba.BackupError):
            ba.remote_browse(acct, "/a/../b")
        acct = self.acct(name="")
        with self.assertRaises(ba.BackupError):
            ba.remote_test(acct)

    def test_suivi_ecrit_le_compte_chiffre_et_le_jeu(self):
        self.assertEqual(ba.remote_follow(self.acct(), "/backups/pve", "PVE sur Freebox", 2), {"added": 1, "updated": 0, "copy": False})
        cfg = json.loads(self.config.read_text(encoding="utf-8"))
        saved = cfg["connectors"][0]
        self.assertEqual((saved["type"], saved["name"], saved["host"]), ("backup-folder", "Freebox", "192.168.1.254"))
        self.assertNotIn(SECRET, json.dumps(cfg))   # encrypted
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        self.assertEqual(meta["hosts"][0]["api"], "remote")
        self.assertEqual(meta["sets"][0]["locations"][0]["path"], "/backups/pve")
        self.assertFalse(meta["sets"][0]["expect_offsite"])
        self.assertEqual(ba.remote_follow(self.acct(password=""), "/backups/pve", "Autre nom", 5), {"added": 0, "updated": 1, "copy": False})
        self.assertEqual(json.loads(self.meta.read_text(encoding="utf-8"))["sets"][0]["label"], "Autre nom")
        state = ba.current()["remote"]
        self.assertEqual((state[0]["name"], state[0]["password_set"]), ("Freebox", True))
        self.assertNotIn(SECRET, json.dumps(ba.current()))

    def test_refus_sans_rien_enregistrer(self):
        for path in ("/nope", "/"):
            acct = self.acct()
            with self.assertRaises(ba.BackupError, msg=path):
                ba.remote_follow(acct, path)
        acct = self.acct()
        with self.assertRaises(ba.BackupError):
            ba.remote_follow(acct, "/backups/pve", "x", 999)
        self.assertEqual(self.config.read_text(encoding="utf-8"), "{}")
        self.assertFalse(self.meta.exists())

    def test_copie_d_un_jeu_existant(self):
        self.meta.write_text(json.dumps({"hosts": [{"id": "srv", "label": "Serveur", "ip": "10.0.0.2", "ssh": "srv"}], "sets": [
            {"id": "pve-config", "label": "PVE", "origin": "srv", "max_age_days": 2, "expect_offsite": False,
             "locations": [{"host": "srv", "path": "/mnt/nvme0/proxmox-host-backup/config", "pattern": "*", "depth": 3}]}]}), encoding="utf-8")
        self.assertEqual(ba.remote_follow(self.acct(), "/backups/pve", copy_of="pve-config"), {"added": 0, "updated": 0, "copy": True})
        s = json.loads(self.meta.read_text(encoding="utf-8"))["sets"][0]
        self.assertEqual([l["host"] for l in s["locations"]], ["srv", "remote-freebox"])
        self.assertTrue(s["locations"][1]["offsite"] and s["expect_offsite"])
        acct = self.acct()
        with self.assertRaises(ba.BackupError):
            ba.remote_follow(acct, "/backups/pve", copy_of="pve-config")   # already there
        acct = self.acct()
        with self.assertRaises(ba.BackupError):
            ba.remote_follow(acct, "/backups/pve", copy_of="inconnu")


if __name__ == "__main__":
    unittest.main()
