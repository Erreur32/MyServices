"""Dernière identification connue d'un service (last_known.previous_services) : relue dans data.json du passage précédent."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import last_known


class LastKnown(unittest.TestCase):
    def read(self, hosts):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "data.json"
            if hosts is not None:
                p.write_text(json.dumps({"hosts": hosts}), encoding="utf-8")
            return last_known.previous_services(str(p))

    def test_garde_l_identification_du_passage_precedent(self):
        out = self.read([
            {"type": "proxy", "id": 12, "service": {"kind": "docker", "name": "plex", "image": "plexinc/pms"}},
            {"type": "proxy", "id": 13, "service": None},
            {"type": "local", "id": "10.0.0.5:80", "service": {"kind": "manuel", "name": "à la main"}},   # saisi à la main : déjà stable
        ])
        self.assertEqual(list(out), [("proxy", "12")])
        self.assertEqual(out[("proxy", "12")]["image"], "plexinc/pms")

    def test_fichier_absent_ou_illisible(self):
        self.assertEqual(self.read(None), {})
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "data.json"
            p.write_text("pas du json", encoding="utf-8")
            self.assertEqual(last_known.previous_services(str(p)), {})


if __name__ == "__main__":
    unittest.main()
