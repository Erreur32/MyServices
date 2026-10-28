"""Assistant Proxmox Backup de Réglages → Sauvegardes (backups_admin.py) et lecture des groupes (backups.py), contre un FAUX serveur.
Ni vrai Proxmox Backup Server : les réponses sont construites d'après la documentation de son API.

  python3 -m unittest discover -s tests
"""
import json
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from msv.backups import backups  # noqa: E402
from msv.backups import backups_admin as ba  # noqa: E402
from test_backups_wizard import Base, FakeServer  # noqa: E402

NOW = int(time.time())
ROUTES = {
    "/api2/json/admin/datastore": [{"store": "nas"}],
    "/api2/json/status/datastore-usage": [{"store": "nas", "total": 1000, "used": 250}],
    "/api2/json/admin/datastore/nas/groups": [
        {"backup-type": "vm", "backup-id": "100", "last-backup": NOW - 3600, "backup-count": 7, "comment": "web"},
        {"backup-type": "ct", "backup-id": "101", "last-backup": NOW - 40 * 86400, "backup-count": 2}],
}


class Pbs(Base):
    def setUp(self):
        super().setUp()
        self._get = FakeServer.do_GET

        def do_GET(h):
            FakeServer.seen.append(("GET", h.path))
            body = ROUTES.get(h.path.split("?")[0])
            h._reply(200, {"data": body}) if body is not None else h._reply(404, {"errors": "inconnu"})
        FakeServer.do_GET = do_GET
        self.addCleanup(setattr, FakeServer, "do_GET", self._get)
        FakeServer._reply = FakeServer.reply

    def add_connector(self):
        ba.settings.save("proxmox-backup", "pbs1", {"url": self.url, "user": "myservices@pbs!lecture", "secret": "secret-de-test", "verify_tls": False})

    def test_sans_connecteur(self):
        self.assertEqual(ba.current()["pbs"], {"connectors": [], "followed": 0})
        with self.assertRaises(ba.BackupError):
            ba.pbs_discover("pbs1")

    def test_recherche_ne_modifie_rien(self):
        self.add_connector()
        got = ba.pbs_discover("pbs1")["groups"]
        self.assertEqual([(g["key"], g["followed"]) for g in got], [("nas/vm/100", False), ("nas/ct/101", False)])
        self.assertFalse(self.meta.exists())
        self.assertEqual({m for m, _ in FakeServer.seen}, {"GET"})

    def test_suivi_puis_niveau_selon_l_age(self):
        self.add_connector()
        r = ba.pbs_follow("pbs1", [{"key": "nas/vm/100", "label": "Web", "max_age_days": 2}, {"key": "nas/ct/101", "max_age_days": 2}])
        self.assertEqual(r, {"added": 2, "updated": 0})
        self.assertEqual(ba.current()["pbs"]["followed"], 2)
        with self.assertRaises(ba.BackupError):
            ba.pbs_follow("pbs1", [{"key": "nas/vm/999"}])
        meta = self.meta_json()
        self.assertEqual(next(h for h in meta["hosts"] if h["id"] == "pbs")["connector"], "pbs1")
        conf = {"name": "pbs", "connector": "pbs1"}
        with __import__("unittest.mock").mock.patch.dict(backups.CFG, {"connectors": [{"name": "pbs1", "type": "proxmox-backup", **self.saved()["connectors"][0]}]}):
            res = {"pbs": backups.api_collect(backups.PbsBackups, {"id": "pbs", **conf}, "API PBS"), "pbs-sources": ({"locs": {}, "disks": [], "crons": []}, "")}
        out = backups.analyse(meta, res, {}, time.time())
        by = {s["label"]: s["locations"][0] for s in out["sets"]}
        self.assertEqual(by["Web"]["level"], "ok")
        self.assertEqual(by["Proxmox Backup : nas/ct/101"]["level"], "crit")


if __name__ == "__main__":
    unittest.main()
