"""Dernière identification connue d'un service (last_known) : relue dans data.json du passage précédent, reprise seulement si la cible
(ip:port) n'a pas changé ; un changement de cible est daté et gardé 7 jours (badge « changé récemment »)."""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import last_known

NOW = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)


class LastKnown(unittest.TestCase):
    def read(self, hosts):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "data.json"
            if hosts is not None:
                p.write_text(json.dumps({"hosts": hosts}), encoding="utf-8")
            return last_known.previous_rows(str(p))

    def test_garde_l_identification_du_passage_precedent(self):
        out = self.read([
            {"type": "proxy", "id": 12, "ip": "10.0.0.5", "port": 32400, "service": {"kind": "docker", "name": "plex", "image": "plexinc/pms"}},
            {"type": "proxy", "id": 13, "service": None},
            {"type": "local", "id": "10.0.0.5:80", "service": {"kind": "manuel", "name": "à la main"}},   # saisi à la main : déjà stable
        ])
        self.assertEqual(out[("proxy", "12")]["service"]["image"], "plexinc/pms")
        self.assertEqual(out[("proxy", "12")]["target"], "10.0.0.5:32400")
        self.assertIsNone(out[("proxy", "13")]["service"])
        self.assertIsNone(out[("local", "10.0.0.5:80")]["service"])

    def test_fichier_absent_ou_illisible(self):
        self.assertEqual(self.read(None), {})
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "data.json"
            p.write_text("pas du json", encoding="utf-8")
            self.assertEqual(last_known.previous_rows(str(p)), {})


class TargetChange(unittest.TestCase):
    prev = {"service": {"kind": "apache", "name": "apache2 · rss"}, "target": "172.30.0.1:8443", "target_changed": None, "target_before": None}

    def test_meme_cible_l_ancien_service_peut_revenir(self):
        r = {"ip": "172.30.0.1", "port": 8443}
        self.assertTrue(last_known.mark_target_change(r, self.prev, NOW))
        self.assertNotIn("target_changed", r)

    def test_cible_changee_datee_et_ancien_nom_non_repris(self):
        r = {"ip": "172.30.0.1", "port": 8445}
        self.assertFalse(last_known.mark_target_change(r, self.prev, NOW))
        self.assertEqual((r["target_changed"], r["target_before"]), (NOW.isoformat(timespec="seconds"), "172.30.0.1:8443"))

    def test_changement_recopie_7_jours_puis_oublie(self):
        recent = dict(self.prev, target="172.30.0.1:8445", target_changed=(NOW - timedelta(days=3)).isoformat(), target_before="172.30.0.1:8443")
        r = {"ip": "172.30.0.1", "port": 8445}
        self.assertTrue(last_known.mark_target_change(r, recent, NOW))
        self.assertEqual(r["target_before"], "172.30.0.1:8443")
        old = dict(recent, target_changed=(NOW - timedelta(days=8)).isoformat())
        r = {"ip": "172.30.0.1", "port": 8445}
        last_known.mark_target_change(r, old, NOW)
        self.assertNotIn("target_changed", r)

    def test_sans_passage_precedent_ou_date_illisible(self):
        self.assertFalse(last_known.mark_target_change({"ip": "10.0.0.1", "port": 80}, None, NOW))
        r = {"ip": "10.0.0.1", "port": 80}
        last_known.mark_target_change(r, dict(self.prev, target="10.0.0.1:80", target_changed="hier"), NOW)
        self.assertNotIn("target_changed", r)


if __name__ == "__main__":
    unittest.main()
