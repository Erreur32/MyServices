"""system.py : fréquence de la recherche réseau automatique (Réglages → Recherche réseau), écrite dans config.json.

  python3 -m unittest discover -s tests
"""
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import system  # noqa: E402


class NetscanEvery(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.f = Path(self.dir.name) / "config.json"
        self.f.write_text(json.dumps({"public_url": "http://x/"}), encoding="utf-8")
        self.core = types.SimpleNamespace(CFG={"netscan_every": 6}, HERE=self.dir.name)
        env = {k: v for k, v in os.environ.items() if k != "MYSERVICES_NETSCAN_EVERY"}
        env["MYSERVICES_CONFIG"] = str(self.f)
        self.patch = mock.patch.dict(os.environ, env, clear=True)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.dir.cleanup()

    def raw(self):
        return json.loads(self.f.read_text(encoding="utf-8"))

    def test_defaut(self):
        self.assertEqual(system.netscan_settings(self.core), {"every_h": 6, "default_h": 6, "max_h": 168, "fixed": False})

    def test_change_et_applique_tout_de_suite(self):
        out = system.set_netscan_every(self.core, 12)
        self.assertEqual(out["every_h"], 12)
        self.assertEqual(self.core.CFG["netscan_every"], 12)
        self.assertEqual(self.raw(), {"public_url": "http://x/", "netscan_every": 12})

    def test_zero_coupe_et_defaut_efface_la_cle(self):
        system.set_netscan_every(self.core, 0)
        self.assertEqual(self.raw()["netscan_every"], 0)
        system.set_netscan_every(self.core, 6)
        self.assertNotIn("netscan_every", self.raw())

    def test_hors_limites_refuse_sans_ecrire(self):
        for bad in (-1, 169):
            with self.assertRaises(ValueError):
                system.set_netscan_every(self.core, bad)
        self.assertEqual(self.raw(), {"public_url": "http://x/"})
        self.assertEqual(self.core.CFG["netscan_every"], 6)

    def test_fixe_par_l_environnement(self):
        with mock.patch.dict(os.environ, {"MYSERVICES_NETSCAN_EVERY": "3"}):
            self.assertTrue(system.netscan_settings(self.core)["fixed"])
            with self.assertRaises(ValueError):
                system.set_netscan_every(self.core, 12)
        self.assertEqual(self.raw(), {"public_url": "http://x/"})


if __name__ == "__main__":
    unittest.main()
