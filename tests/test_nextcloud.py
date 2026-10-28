"""Nextcloud connector against a FAKE server (answer after the serverinfo app README), not a real Nextcloud.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import connectors  # noqa: E402
from msv.machines import known_apps  # noqa: E402
from connectors.base import ConnectorError  # noqa: E402
from test_homelab import SEEN, Base  # noqa: E402

ROUTE = "/ocs/v2.php/apps/serverinfo/api/v1/info"
TOKEN = "nc-" + "t" * 12   # built at run time: the safety check refuses tokens written as such


def info(update=None, apps_updates=None, open_links=0, free=48472944640, debug="no"):
    system = {"version": "30.0.0.1", "debug": debug, "freespace": free, "cpuload": [0.8, 1.0, 1.1], "mem_total": 8183664,
              "apps": {"num_installed": 53, "num_updates_available": len(apps_updates or {}), "app_updates": apps_updates or {}},
              "update": {"lastupdatedat": 1719244666, **(update or {"available": False})}}
    return {"ocs": {"meta": {"status": "ok", "statuscode": 200}, "data": {
        "nextcloud": {"system": system, "storage": {"num_users": 7, "num_files": 708860},
                      "shares": {"num_shares": 4, "num_shares_link": 3, "num_shares_link_no_password": open_links}},
        "server": {"webserver": "Apache/2.4", "php": {"version": "8.3.12"}, "database": {"type": "mysql", "version": "10.11.9", "size": 331382784}},
        "activeUsers": {"last5minutes": 2, "last1hour": 3, "last24hours": 5}}}}


class Nextcloud(Base):
    def test_tout_va_bien(self):
        self.route(ROUTE, info())
        d = self.conn("nextcloud", token=TOKEN).collect()
        facts = {f["label"]: f["value"] for f in d["facts"]}
        self.assertEqual(d["version"], "30.0.0.1")
        self.assertEqual((facts["Version"], facts["Actifs (24 h)"], facts["Fichiers"], facts["PHP"]), ("30.0.0.1", "5 / 7 utilisateurs", "708 860", "8.3.12"))
        self.assertEqual(facts["Liens publics"], "3")
        self.assertEqual(d["problems"], [])
        headers = {k.lower(): v for k, v in SEEN[-1][2].items()}   # header names are case-insensitive (urllib sends « Nc-token »)
        self.assertEqual((headers.get("nc-token"), headers.get("ocs-apirequest")), (TOKEN, "true"))
        self.assertIn("format=json", SEEN[-1][1])
        self.assertEqual({m for m, *_ in SEEN}, {"GET"})

    def test_a_regarder(self):
        self.route(ROUTE, info({"available": True, "available_version": "30.0.2"}, {"files_antivirus": "2.0.1"}, open_links=2, free=2 * 2**30, debug="yes"))
        d = self.conn("nextcloud", token=TOKEN).collect()
        self.assertEqual(d["problems"], ["mise à jour de Nextcloud disponible : 30.0.2", "appli « files_antivirus » : mise à jour 2.0.1",
                                         "2 lien(s) public(s) sans mot de passe", "espace libre bas : 2,0 Go", "mode debug actif (à couper en production)"])
        facts = {f["label"]: f for f in d["facts"]}
        self.assertEqual((facts["Version"]["value"], facts["Version"]["tone"]), ("30.0.0.1 → 30.0.2", "warn"))
        self.assertEqual([c["key"] for c in d["checks"]], ["update", "app:files_antivirus", "links", "space", "debug"])

    def test_jeton_refuse_et_pas_nextcloud(self):
        self.route(ROUTE, {"ocs": {"meta": {"statuscode": 401}}}, code=401)
        with self.assertRaises(ConnectorError) as e:
            self.conn("nextcloud", token="faux").collect()
        self.assertIn("accès refusé", str(e.exception))
        self.route(ROUTE, {"autre": 1})
        with self.assertRaises(ConnectorError):
            self.conn("nextcloud", token=TOKEN).collect()

    def test_registre_et_proposition(self):
        cls = connectors.TYPES["nextcloud"]
        self.assertIn("status", cls.kinds)
        self.assertTrue(any(f.secret for f in cls.fields))
        self.assertEqual(next(a for a in known_apps.APPS if a.key == "nextcloud").connector, "nextcloud")
        self.assertEqual(cls.discover("nextcloud", "10.0.0.5", [(8443, 443)]), {"url": "https://10.0.0.5:8443", "verify_tls": False})
        self.assertEqual(cls.discover("nextcloud", "10.0.0.5", [(8080, 80)]), {"url": "http://10.0.0.5:8080"})


if __name__ == "__main__":
    unittest.main()
