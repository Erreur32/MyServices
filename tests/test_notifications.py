"""notifications.py : rapports à heure fixe, événements en direct filtrés, exemples, envoi (canaux simulés)."""
import json
import sqlite3
import sys
import tempfile
import time
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import alerts  # noqa: E402
import notifications as nf  # noqa: E402

STATS = {"hosts": [
    {"name": "Gamer32 · 10.0.0.50", "reachable": True, "level": "crit", "res": {"available": True, "cpu_pct": 3.2, "mem_pct": 50.7, "mem_used_mb": 16000, "mem_total_mb": 32000},
     "disks": [{"mount": "C:", "used_pct": 91, "size_gb": 1862}, {"mount": "E:", "used_pct": 48, "size_gb": 1863}], "temp": {"available": True, "celsius": 54.2},
     "apt": {"upgradable": 2, "available": True}, "reboot_required": False, "systemd": {"failed": []}, "docker": {"accessible": False},
     "smart": {"accessible": True, "disks": [{"device": "NVMe A", "healthy": True, "failed": False}]}, "ssh_auth": {"available": False}, "load": {"available": False}},
    {"name": "dev · 10.0.0.2", "reachable": True, "level": "ok", "res": {"available": True, "cpu_pct": 2.9, "mem_pct": 29.9}, "disks": [], "temp": {"available": False},
     "docker": {"accessible": True, "total": 4, "unhealthy": 1}, "systemd": {"failed": [{"unit": "x.service"}]}},
], "asleep": [{"id": "pc", "name": "Salon · 10.0.0.77", "ip": "10.0.0.77", "ping": True}]}
DATA = {"machine_list": [{"ip": "10.0.0.50", "name": "Gamer32", "ping": True, "agent": {"uptime_s": 90000}}, {"ip": "10.0.0.2", "name": "dev", "ping": True, "info": {"uptime_s": 4000}}]}


class Report(unittest.TestCase):
    def test_capteurs_choisis_seulement(self):
        text, extra = nf.build_report(STATS, DATA, {"sensors": ["cpu", "disk"], "machines": ["10.0.0.50"]}, "Matin", datetime(2026, 10, 12, 8, 0))
        self.assertIn("Matin · 12/10/2026 08:00", text)
        self.assertIn("Gamer32 (10.0.0.50)", text)
        self.assertIn("3 %", text)
        self.assertIn("C: 91 %", text)
        self.assertNotIn("dev (", text)                 # machine non choisie
        self.assertNotIn("Salon", text)                 # poste éteint hors sélection
        self.assertEqual([m["ip"] for m in extra["machines"]], ["10.0.0.50"])

    def test_toutes_les_machines_et_postes_eteints(self):
        text, extra = nf.build_report(STATS, DATA, {"sensors": ["level", "docker", "systemd", "uptime"], "machines": []}, "Tout")
        self.assertIn("dev (10.0.0.2)", text)
        self.assertIn("4 conteneurs, 1 unhealthy", text)
        self.assertIn("1 (x.service)", text)
        self.assertIn("1 j 1 h", text)                  # durée de marche de Gamer32 (agent)
        self.assertIn("💤 Salon : éteinte", text)
        self.assertTrue(any(m.get("asleep") for m in extra["machines"]))

    def test_valeurs_absentes_omises(self):
        v = nf.sensor_values(STATS["hosts"][1], None)
        self.assertNotIn("temp", v)
        self.assertNotIn("ping", v)
        self.assertEqual(nf.sensor_values(STATS["hosts"][0], DATA["machine_list"][0])["disks"], "C: 91 % · E: 48 %")


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = Path(self.tmp.name)
        (d / "health").mkdir()
        (d / "health" / "stats.json").write_text(json.dumps(STATS), encoding="utf-8")
        (d / "data.json").write_text(json.dumps(DATA), encoding="utf-8")
        p0 = mock.patch.dict("os.environ", {"MYSERVICES_SECRET_KEY": str(d / "secret.key")})   # clé de chiffrement des secrets : dans le dossier d'essai
        p0.start()
        self.addCleanup(p0.stop)
        self.a = alerts.Alerts(d / "t.db")
        self.cid = self.a.add_channel("Test", "discord", {"url": "https://discord.example/webhook"})
        self.n = nf.Notifications(self.a, d)
        self.sent = []
        p = mock.patch.object(alerts, "_post", lambda url, body, token=None: self.sent.append((url, body)))
        p.start()
        self.addCleanup(p.stop)

    def report(self, **cfg):
        return {"name": "R", "kind": "report", "channels": [self.cid], "config": {"sensors": ["cpu"], "at": ["08:00"], **cfg}}

    def test_validation(self):
        for bad in ({"kind": "autre"}, {**self.report(), "config": {"sensors": []}}, {**self.report(), "config": {"sensors": ["cpu"], "at": ["8h"]}}):
            with self.assertRaises(nf.NotificationError):
                self.n.add(bad)
        nid = self.n.add({**self.report(), "config": {"sensors": ["cpu", "inconnu"], "at": ["08:00", "08:00"], "days": [9, 1], "machines": ["10.0.0.50", "pas une ip!"]}})
        c = self.n.list()[0]["config"]
        self.assertEqual((c["sensors"], c["at"], c["days"], c["machines"]), (["cpu"], ["08:00"], [1], ["10.0.0.50"]))
        self.n.delete(nid)
        with self.assertRaises(nf.NotificationError):
            self.n.delete(nid)

    def test_rapport_envoye_a_l_heure_et_une_seule_fois(self):
        self.n.add(self.report(days=[0]))                                 # lundi
        monday = datetime(2026, 10, 12, 8, 0, 5)
        self.assertEqual(len(self.n.tick(monday)), 1)
        self.assertIn("Gamer32", self.sent[0][1]["content"])
        self.assertEqual(self.n.tick(monday.replace(second=40)), [])      # même minute : pas deux fois
        self.assertEqual(self.n.tick(datetime(2026, 10, 12, 8, 1)), [])   # mauvaise heure
        self.assertEqual(self.n.tick(datetime(2026, 10, 13, 8, 0)), [])   # mardi : pas dans les jours choisis
        self.assertEqual(len(self.n.tick(datetime(2026, 10, 19, 8, 0))), 1)   # lundi suivant

    def test_notification_desactivee_ou_sans_canal_ne_part_pas(self):
        self.n.add({**self.report(), "enabled": False})
        self.n.add({**self.report(), "channels": []})
        self.assertEqual(self.n.tick(datetime(2026, 10, 12, 8, 0)), [])
        self.assertEqual(self.sent, [])

    def test_evenements_filtres_en_direct(self):
        base = {"name": "E", "kind": "events", "channels": [self.cid]}
        self.n.add({**base, "name": "Tout", "config": {"kinds": []}})
        self.n.add({**base, "name": "Pannes de dev", "config": {"kinds": ["panne"], "machine": "dev", "resolved": True}})
        evs = [{"kind": "panne", "label": "plex", "machine": "dev", "detail": "x", "key": "a"},
               {"kind": "retabli", "label": "plex", "machine": "dev", "detail": "ok", "key": "a"},
               {"kind": "nouveau", "label": "nginx", "machine": "autre", "detail": "n", "key": "b"}]
        out = self.n.dispatch(evs)
        self.assertEqual(len(out), 2)                                      # une notification « Tout », une « Pannes de dev »
        by = {}
        for _, body in self.sent:
            by[body["content"].split("**")[1].split(" · ")[1]] = body["content"]
        self.assertIn("nginx", by["Tout"])                                  # tous les événements
        self.assertIn("plex", by["Pannes de dev"])
        self.assertNotIn("nginx", by["Pannes de dev"])                      # filtré par machine
        self.assertIn("Service rétabli", by["Pannes de dev"])               # retour à la normale gardé

    def test_delai_entre_deux_envois(self):
        self.n.add({"name": "E", "kind": "events", "channels": [self.cid], "config": {"kinds": ["panne"], "cooldown_min": 60}})
        ev = [{"kind": "panne", "label": "a", "key": "k"}]
        self.assertEqual(len(self.n.dispatch(ev, now=1000.0)), 1)
        self.assertEqual(self.n.dispatch(ev, now=1000.0 + 600), [])
        self.assertEqual(len(self.n.dispatch(ev, now=1000.0 + 3700)), 1)

    def test_exemples_desactives_et_sans_doublon(self):
        names = [e["name"] for e in nf.EXAMPLES]
        self.assertEqual(self.n.add_examples(names), len(names))
        self.assertEqual(self.n.add_examples(names), 0)
        got = self.n.list()
        self.assertTrue(all(not n["enabled"] and n["channels"] == [self.cid] for n in got))
        self.assertEqual(next(n for n in got if n["name"].startswith("Une machine"))["config"]["machine"], "Gamer32")   # première machine connue

    def test_envoyer_maintenant(self):
        rid = self.n.add(self.report())
        self.assertIn("envoyé", self.n.send_now(rid)[0])
        self.assertIn("Gamer32", self.sent[-1][1]["content"])
        eid = self.n.add({"name": "E", "kind": "events", "channels": [self.cid], "config": {"kinds": ["panne"]}})
        self.assertIn("envoyé", self.n.send_now(eid)[0])                    # aucun événement : message explicite
        self.assertIn("Aucun événement correspondant", self.sent[-1][1]["content"])
        with self.assertRaises(nf.NotificationError):
            self.n.send_now(999)
        nid = self.n.add({**self.report(), "channels": []})
        with self.assertRaises(nf.NotificationError):
            self.n.send_now(nid)


if __name__ == "__main__":
    unittest.main()
