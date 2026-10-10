"""Modèle de données commun (models.py) : les formes produites par le collecteur, la santé, les sauvegardes, la veille et les
alertes s'y plient ; un champ de base manquant ou mal typé est refusé ; un champ en plus est gardé.

  À lancer dans l'image (pydantic) : python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    import models
except ImportError:
    models = None

MACHINE = {"ip": "192.168.1.20", "name": "nas", "role": "stockage", "ping": True, "off": False, "ttl": 64, "detected": ["vm"],
           "ssh": {"alias": "nas", "port": 22, "user": "root", "identity": "~/.ssh/k"}, "services": 4, "npm": 2, "down": 0}
SERVICE = {"type": "local", "id": "192.168.1.20:8080", "domains": [], "enabled": True, "ip": "192.168.1.20", "port": 8080,
           "machine": "nas", "name": "app", "service": {"kind": "docker", "name": "app", "image": "app:1"}}
HEALTH = {"id": "nas", "name": "nas · 192.168.1.20", "reachable": True, "level": "ok", "source": "agent", "sources": ["agent"],
          "disks": [{"mount": "C:", "used_pct": 70, "size_gb": 500.0, "avail_gb": 150.0, "warning": False, "critical": False}]}
BACKUP = {"id": "docs", "label": "Documents", "origin": "nas", "schedule": "quotidien", "level": "ok", "archived": False,
          "offsite": 1, "locations": [{"host": "nas", "label": "/mnt/b", "level": "ok", "age": 3.5}]}
EVENT = {"kind": "panne", "key": "svc:app", "label": "app", "machine": "nas", "target": "192.168.1.20:8080", "detail": "HTTP 500",
         "ts": 1760000000.0}
ALERT = {"name": "Connecteurs et collecte", "kinds": ["connecteur", "connecteur_version"], "resolved": True, "cooldown_min": 120}


@unittest.skipIf(models is None, "pydantic absent : tests à lancer dans l'image")
class Models(unittest.TestCase):
    CASES = [(models.Machine, MACHINE), (models.Service, SERVICE), (models.Health, HEALTH), (models.Backup, BACKUP),
             (models.Event, EVENT), (models.Alert, ALERT)] if models else []

    def test_les_formes_produites_sont_conformes(self):
        for model, item in self.CASES:
            self.assertEqual(models.validate(model, [item]), [], model.__name__)

    def test_champ_en_plus_garde(self):
        m = models.Machine.model_validate(MACHINE)
        self.assertEqual(m.model_extra["services"], 4)

    def test_champ_de_base_manquant_ou_mal_type_refuse(self):
        bad = [(models.Machine, {"name": "x"}), (models.Machine, {**MACHINE, "ping": "peut-être"}),
               (models.Service, {**SERVICE, "type": "inconnu"}), (models.Health, {**HEALTH, "level": "rouge"}),
               (models.Health, {**HEALTH, "source": "telepathie"}), (models.Backup, {"id": "x"}),
               (models.Event, {"label": "sans genre"}), (models.Alert, {"name": "x"})]
        for model, item in bad:
            self.assertTrue(models.validate(model, [item]), (model.__name__, item))

    def test_validate_dit_quel_element_et_quel_champ(self):
        out = models.validate(models.Machine, [MACHINE, {"name": "x"}])
        self.assertEqual(len(out), 1)
        self.assertIn("Machine #1 : ip", out[0])

    def test_controle_des_fichiers_produits(self):
        self.assertEqual(models.snapshot_problems({"machine_list": [MACHINE], "hosts": [SERVICE]}, {"hosts": [HEALTH]}, {"sets": [BACKUP]}), [])
        self.assertTrue(models.snapshot_problems({"machine_list": [{"name": "x"}]}))


if __name__ == "__main__":
    unittest.main()
