"""Prometheus, Healthchecks, Netdata, Jellyfin contre de FAUX serveurs construits d'après leurs documentations (pas les vrais services).

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import connectors  # noqa: E402
from connectors.base import ConnectorError  # noqa: E402
from test_homelab import SEEN, Base  # noqa: E402


class Registre(unittest.TestCase):
    def test_enregistres_avec_champs_et_aide(self):
        for t in ("prometheus", "healthchecks", "netdata", "jellyfin"):
            cls = connectors.TYPES[t]
            self.assertIn("status", cls.kinds, t)
            self.assertTrue(cls.label and cls.fields and cls.guide, t)
        for t in ("healthchecks", "jellyfin"):
            self.assertTrue(any(f.secret for f in connectors.TYPES[t].fields), t)


class Prometheus(Base):
    def test_cibles_et_alertes(self):
        self.route("/api/v1/status/buildinfo", {"status": "success", "data": {"version": "2.53.0"}})
        self.route("/api/v1/targets", {"data": {"activeTargets": [
            {"health": "up", "labels": {"job": "node", "instance": "a:9100"}},
            {"health": "down", "labels": {"job": "cadvisor", "instance": "b:8080"}}]}})
        self.route("/api/v1/alerts", {"data": {"alerts": [{"state": "firing", "labels": {"alertname": "DiskFull"}},
                                                          {"state": "pending", "labels": {"alertname": "Autre"}}]}})
        d = self.conn("prometheus").collect()
        self.assertEqual(d["version"], "2.53.0")
        self.assertEqual(d["problems"], ["cible « cadvisor (b:8080) » hors ligne", "alerte « DiskFull » en cours"])
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}["Cibles"], "1/2 en ligne")

    def test_alertes_illisibles_ne_cassent_pas(self):
        self.route("/api/v1/status/buildinfo", {"data": {"version": "2.53.0"}})
        self.route("/api/v1/targets", {"data": {"activeTargets": []}})
        self.assertEqual(self.conn("prometheus").collect()["problems"], [])

    def test_pas_prometheus(self):
        self.route("/api/v1/status/buildinfo", {"autre": 1})
        with self.assertRaises(ConnectorError):
            self.conn("prometheus").collect()

    def test_jeton_en_en_tete(self):
        self.route("/api/v1/status/buildinfo", {"data": {"version": "2"}})
        self.route("/api/v1/targets", {"data": {"activeTargets": []}})
        self.conn("prometheus", token="T").collect()
        self.assertEqual(SEEN[0][2].get("Authorization"), "Bearer T")


class Healthchecks(Base):
    def test_taches_en_echec_et_en_retard(self):
        self.route("/api/v3/checks/", {"checks": [{"name": "sauvegarde", "status": "down"}, {"name": "dns", "status": "grace"},
                                                  {"name": "ok", "status": "up"}, {"slug": "vieux", "status": "paused"}]})
        d = self.conn("healthchecks", api_key="K").collect()
        self.assertEqual(SEEN[0][2].get("X-Api-Key") or SEEN[0][2].get("X-API-KEY"), "K")
        self.assertEqual(d["problems"], ["« sauvegarde » en échec", "« dns » en retard"])
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}["Tâches"], "4")

    def test_cle_refusee(self):
        self.route("/api/v3/checks/", {"error": "no"}, code=401)
        r = self.conn("healthchecks", api_key="mauvaise").test()
        self.assertFalse(r.ok)
        self.assertIn("accès refusé", r.message)


class Netdata(Base):
    def test_alarmes(self):
        self.route("/api/v1/info", {"version": "v1.45.0", "hostname": "nas"})
        self.route("/api/v1/alarms", {"alarms": {"a": {"status": "CRITICAL", "chart": "disk.space", "name": "disk_full"},
                                                 "b": {"status": "WARNING", "chart": "system.ram", "name": "ram_usage"},
                                                 "c": {"status": "CLEAR", "chart": "x", "name": "y"}}})
        d = self.conn("netdata").collect()
        self.assertEqual(d["version"], "1.45.0")
        self.assertEqual(d["problems"], ["disk.space : disk_full (critique)", "system.ram : ram_usage (avertissement)"])

    def test_pas_netdata(self):
        self.route("/api/v1/info", {"autre": 1})
        with self.assertRaises(ConnectorError):
            self.conn("netdata").collect()


class Jellyfin(Base):
    def test_lectures_et_mise_a_jour(self):
        self.route("/System/Info", {"Version": "10.9.7", "HasPendingRestart": True, "HasUpdateAvailable": True})
        self.route("/Sessions", [{"NowPlayingItem": {"Name": "Film"}}, {"DeviceName": "TV"}])
        d = self.conn("jellyfin", api_key="K").collect()
        self.assertEqual(SEEN[0][2].get("X-Emby-Token"), "K")
        facts = {f["label"]: f["value"] for f in d["facts"]}
        self.assertEqual((facts["Lectures en cours"], facts["Appareils connectés"]), ("1", "2"))
        self.assertEqual(d["problems"], ["redémarrage en attente (mise à jour installée)", "mise à jour de Jellyfin disponible"])


if __name__ == "__main__":
    unittest.main()
