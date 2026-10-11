"""discoveries.py : ce qui est automatique, ce qui demande un clic, ce qui reste à faire."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import discoveries as d  # noqa: E402


def by(items):
    return {x["id"]: x for x in items}


class Discoveries(unittest.TestCase):
    def test_recherche_reseau_jamais_lancee_est_a_faire(self):
        x = by(d.build({"net_has_run": False, "net_every_h": 6}))["network"]
        self.assertEqual((x["mode"], x["state"]), (d.FIRST, "todo"))
        self.assertIn("UNE FOIS", x["what"])
        self.assertEqual(x["action"]["href"], "#settings/network")

    def test_recherche_reseau_deja_faite_se_repete_seule(self):
        x = by(d.build({"net_has_run": True, "net_last": 1000.0, "net_every_h": 6}))["network"]
        self.assertEqual((x["state"], x["last"], x["next"]), ("ok", 1000.0, 1000.0 + 6 * 3600))
        off = by(d.build({"net_has_run": True, "net_last": 1000.0, "net_every_h": 0}))["network"]
        self.assertEqual((off["mode"], off["next"]), (d.MANUAL, None))        # répétition coupée : à la main

    def test_les_modes_sont_dits_clairement(self):
        m = by(d.build({"ssh_machines": 2, "auto_checked": 2}))
        self.assertEqual(m["services"]["mode"], d.AUTO)
        self.assertEqual(m["redetect"]["mode"], d.MANUAL)                       # ne se fait jamais seul
        self.assertEqual(m["backups-default"]["mode"], d.FIRST)
        self.assertEqual(m["backups-other"]["mode"], d.MANUAL)
        self.assertEqual(m["cron"]["mode"], d.AUTO)

    def test_sauvegardes_a_chercher_et_connecteurs_proposes(self):
        m = by(d.build({"ssh_machines": 2, "proposals": 3, "backups_search_last": None}))
        self.assertEqual(m["backups-other"]["state"], "todo")
        self.assertEqual(m["connectors"]["state"], "todo")
        self.assertIn("3 connecteur", m["connectors"]["note"])
        m = by(d.build({"ssh_machines": 2, "proposals": 0, "backups_search_last": 5.0}))
        self.assertEqual((m["backups-other"]["state"], m["connectors"]["state"]), ("info", "ok"))
        self.assertEqual(by(d.build({"ssh_machines": 0}))["backups-other"]["state"], "info")   # aucune machine SSH : rien à chercher

    def test_collecte_en_retard(self):
        x = by(d.build({"collect_ok": False}))["services"]
        self.assertEqual(x["state"], "todo")

    def test_suivi_auto_coupe(self):
        x = by(d.build({"backups_auto": False, "ssh_machines": 1}))["backups-default"]
        self.assertEqual(x["mode"], d.MANUAL)

    def test_cron_attend_l_onglet_sauvegardes(self):
        self.assertEqual(by(d.build({"backups_enabled": False}))["cron"]["state"], "info")
        self.assertEqual(by(d.build({"backups_enabled": True, "backups_next": 9.0}))["cron"]["next"], 9.0)


if __name__ == "__main__":
    unittest.main()
