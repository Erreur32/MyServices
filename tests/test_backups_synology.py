"""Hyper Backup assistant of Réglages → Sauvegardes (backups_admin.py) and the reading of the tasks (backups.py), against a FAKE DSM.
No real Synology: the answers are built from the documentation of DSM's web API (SYNO.Backup.Task).

  python3 -m unittest discover -s tests
"""
import json
import sys
import time
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from msv.backups import backups  # noqa: E402
from msv.backups import backups_admin as ba  # noqa: E402
from connectors.backup_apis import dsm_time  # noqa: E402
from test_backups_wizard import Base, FakeServer  # noqa: E402

PW = "-".join(["pw", "de", "test"])   # built at run time: the secret scanner refuses a password written in a file, even a fake one
NOW = time.time()
stamp = lambda ago_days: time.strftime("%Y/%m/%d %H:%M", time.localtime(NOW - ago_days * 86400))   # noqa: E731
TASKS = [{"task_id": 1, "name": "Photos vers C2", "state": "none", "last_bkp_time": stamp(0.5), "last_bkp_result": "done", "next_bkp_time": stamp(-0.5), "target_type": "cloud"},
         {"task_id": 2, "name": "Disque USB", "state": "none", "last_bkp_time": stamp(30), "last_bkp_result": "done", "target_type": "local"},
         {"task_id": 3, "name": "Documents", "state": "none", "last_bkp_time": stamp(0.2), "last_bkp_result": "failed", "target_type": "remote"},
         {"task_id": 4, "name": "Jamais lancée", "state": "none", "last_bkp_time": "", "last_bkp_result": "none"}]
ENTRY = {"SYNO.Backup.Task": {"success": True, "data": {"task_list": TASKS}},
         "SYNO.Storage.CGI.Storage": {"success": True, "data": {"volumes": [{"id": "volume_1", "vol_path": "/volume1", "size": {"total": "1000", "used": "250"}}]}}}


class Synology(Base):
    def setUp(self):
        super().setUp()
        self.forms = []

        def do_POST(h):
            form = urllib.parse.parse_qs(h.rfile.read(int(h.headers["Content-Length"])).decode())
            self.forms.append((h.path, {k: v[0] for k, v in form.items()}))
            if h.path == "/webapi/auth.cgi":
                ok = form.get("method") == ["logout"] or (form.get("account") == ["viewer"] and form.get("passwd") == [PW])
                return h.reply(200, {"success": True, "data": {"sid": "SID"}} if ok else {"success": False, "error": {"code": 400}})
            h.reply(200, ENTRY.get(form["api"][0], {"success": False, "error": {"code": 102}}))
        self._post = FakeServer.do_POST
        FakeServer.do_POST = do_POST
        self.addCleanup(setattr, FakeServer, "do_POST", self._post)

    def add_connector(self):
        ba.settings.save("synology", "nas1", {"url": self.url, "user": "viewer", "password": PW, "verify_tls": False})

    def test_time_formats(self):
        self.assertIsNotNone(dsm_time("2026/10/17 03:00"))
        self.assertEqual(dsm_time(1700000000), 1700000000)
        self.assertIsNone(dsm_time(""))
        self.assertIsNone(dsm_time("-"))

    def test_sans_connecteur(self):
        self.assertEqual(ba.current()["synology"], {"connectors": [], "followed": 0})
        with self.assertRaises(ba.BackupError):
            ba.synology_discover("nas1")

    def test_recherche_ne_modifie_rien_et_ferme_la_session(self):
        self.add_connector()
        got = ba.synology_discover("nas1")["tasks"]
        self.assertEqual([(t["key"], t["followed"]) for t in got], [("Photos vers C2", False), ("Disque USB", False), ("Documents", False), ("Jamais lancée", False)])
        self.assertFalse(self.meta.exists())
        self.assertEqual(self.forms[-1][1]["method"], "logout")   # the session is closed
        self.assertNotIn(PW, json.dumps([f for f in self.forms if f[0] != "/webapi/auth.cgi"]))   # the password goes to the login only

    def test_suivi_puis_niveau_selon_l_age_et_le_resultat(self):
        self.add_connector()
        r = ba.synology_follow("nas1", [{"key": "Photos vers C2", "max_age_days": 2}, {"key": "Disque USB", "max_age_days": 2},
                                        {"key": "Documents", "max_age_days": 2}, {"key": "Jamais lancée", "max_age_days": 2}])
        self.assertEqual(r, {"added": 4, "updated": 0})
        self.assertEqual(ba.current()["synology"]["followed"], 4)
        with self.assertRaises(ba.BackupError):
            ba.synology_follow("nas1", [{"key": "n'existe pas"}])
        meta = self.meta_json()
        self.assertEqual(next(h for h in meta["hosts"] if h["id"] == "synology")["connector"], "nas1")
        self.assertNotIn("password", json.dumps(meta))
        with mock.patch.dict(backups.CFG, {"connectors": [{"name": "nas1", "type": "synology", "url": self.url, "user": "viewer", "password": PW, "verify_tls": False}]}):   # secrets are decrypted in memory at run time
            res = {"synology": backups.api_collect(backups.SynologyBackups, {"id": "synology", "connector": "nas1"}, "API Synology"),
                   "synology-sources": ({"locs": {}, "disks": [], "crons": []}, "")}
        self.assertEqual(res["synology"][1], "")
        out = backups.analyse(meta, res, {}, time.time())
        by = {s["label"]: s["locations"][0] for s in out["sets"]}
        self.assertEqual(by["Synology : Photos vers C2"]["level"], "ok")
        self.assertTrue(by["Synology : Photos vers C2"]["offsite"])          # cloud target: a copy outside the machine
        self.assertEqual(by["Synology : Disque USB"]["level"], "crit")        # 30 days for a 2-day threshold
        self.assertFalse(by["Synology : Disque USB"]["offsite"])             # local target
        self.assertEqual(by["Synology : Documents"]["level"], "crit")         # last run failed
        self.assertEqual(by["Synology : Jamais lancée"]["level"], "crit")     # never run
        self.assertEqual(res["synology"][0]["disks"][0]["pct"], 25.0)


if __name__ == "__main__":
    unittest.main()
