"""discoveries.py : ce qui est automatique, ce qui demande un clic, ce qui reste à faire."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.machines import discoveries as d  # noqa: E402


def by(items):
    return {x["id"]: x for x in items}


class Discoveries(unittest.TestCase):
    def test_recherche_reseau_jamais_lancee_part_seule(self):
        x = by(d.build({"net_has_run": False, "net_every_h": 6}))["network"]
        self.assertEqual((x["mode"], x["state"]), (d.AUTO, "ok"))              # la première se lance toute seule : rien à faire
        off = by(d.build({"net_has_run": False, "net_every_h": 0}))["network"]
        self.assertEqual((off["mode"], off["state"]), (d.MANUAL, "info"))
        self.assertEqual((x["action"]["run"], x["action"]["href"]), ("netscan", "#settings/machines/devices"))   # launches, then shows the machines found

    def test_recherche_reseau_deja_faite_se_repete_seule(self):
        x = by(d.build({"net_has_run": True, "net_last": 1000.0, "net_every_h": 6}))["network"]
        self.assertEqual((x["state"], x["last"], x["next"]), ("ok", 1000.0, 1000.0 + 6 * 3600))
        off = by(d.build({"net_has_run": True, "net_last": 1000.0, "net_every_h": 0}))["network"]
        self.assertEqual((off["mode"], off["next"]), (d.MANUAL, None))        # répétition coupée : à la main

    def test_rappel_coupe_ne_compte_plus_mais_reste_liste(self):
        base = {"unknown_hosts": 32, "net_has_run": True, "net_every_h": 6}
        on = by(d.build(base))["hosts"]
        self.assertEqual((on["state"], on["mutable"], on["muted"]), ("suggest", True, False))   # facultatif : proposé, pas exigé
        off = by(d.build({**base, "muted": ["hosts"]}))["hosts"]
        self.assertEqual((off["state"], off["muted"], off["note"]), ("info", True, "oublié"))
        refused = {"key_refused": [{"ip": "10.0.0.2", "name": "x"}]}
        self.assertEqual(by(d.build(refused))["ssh:10.0.0.2"]["state"], "todo")
        key = by(d.build({**refused, "muted": ["access:10.0.0.2"]}))["ssh:10.0.0.2"]   # access forgotten in Discovery → machines
        self.assertEqual((key["mutable"], key["muted"], key["state"]), (True, True, "info"))

    def test_stopped_container_is_not_suggested(self):
        props = [{"connector": "glances", "label": "Glances", "ip": "10.0.0.1", "running": True, "state": "Up 2 days"},
                 {"connector": "glances", "label": "Glances", "ip": "10.0.0.2", "running": False, "state": "Exited (0) 2 weeks ago"}]
        m = by(d.build({"proposals": props}))
        self.assertEqual((m["connector:glances@10.0.0.1"]["state"], m["connector:glances@10.0.0.1"]["running"]), ("suggest", True))
        off = m["connector:glances@10.0.0.2"]
        self.assertEqual((off["state"], off["running"], off["note"]), ("info", False, "conteneur arrêté (Exited (0) 2 weeks ago)"))

    def test_les_modes_sont_dits_clairement(self):
        m = by(d.build({"ssh_machines": 2, "auto_checked": 2}))
        self.assertEqual(m["services"]["mode"], d.AUTO)
        self.assertEqual(m["redetect"]["mode"], d.MANUAL)                       # ne se fait jamais seul
        self.assertEqual(m["backups-default"]["mode"], d.FIRST)
        self.assertEqual(m["backups-other"]["mode"], d.MANUAL)
        self.assertEqual(m["cron"]["mode"], d.AUTO)

    def test_sauvegardes_a_chercher_et_connecteurs_proposes(self):
        props = [{"connector": "adguard", "label": "AdGuard Home", "ip": "10.0.0.8", "machine": "PC", "url": "http://10.0.0.8:3000", "via": "service Windows"},
                 {"connector": "frigate", "label": "Frigate", "ip": "10.0.0.9", "url": "http://10.0.0.9:5000"}]
        m = by(d.build({"ssh_machines": 2, "proposals": props, "backups_search_last": None}))
        self.assertEqual(m["backups-other"]["state"], "suggest")
        one = m["connector:adguard@10.0.0.8"]
        self.assertEqual((one["state"], one["title"]), ("suggest", "AdGuard Home trouvé sur PC"))                  # une notification par appli reconnue
        self.assertIn("service Windows", one["what"])
        self.assertEqual(one["action"]["prefill"], {"type": "adguard", "name": "adguard", "url": "http://10.0.0.8:3000"})   # le connecteur s'ouvre déjà rempli
        self.assertEqual(m["connector:frigate@10.0.0.9"]["title"], "Frigate trouvé (10.0.0.9)")
        self.assertNotIn("connectors", m)
        m = by(d.build({"ssh_machines": 2, "proposals": [], "backups_search_last": 5.0}))
        self.assertEqual((m["backups-other"]["state"], m["connectors"]["state"]), ("info", "ok"))
        self.assertEqual(by(d.build({"ssh_machines": 0}))["backups-other"]["state"], "info")   # aucune machine SSH : rien à chercher

    def test_autres_notifications_a_faire(self):
        m = by(d.build({"unknown_hosts": 3, "net_has_run": True, "net_last": 5.0, "net_every_h": 6,
                        "key_refused": [{"ip": "10.0.0.7", "name": "Serveur"}], "agents_waiting": [{"ip": "10.0.0.50", "name": "Gamer32"}]}))
        self.assertEqual((m["hosts"]["state"], m["hosts"]["action"]["href"]), ("suggest", "#settings/machines/devices"))
        self.assertEqual((m["ssh:10.0.0.7"]["state"], m["agent:10.0.0.50"]["state"]), ("todo", "todo"))        # une machine qui n'est plus lue : nécessaire
        self.assertEqual(m["ssh:10.0.0.7"]["title"], "Clé SSH à autoriser sur Serveur")
        self.assertEqual(m["ssh:10.0.0.7"]["action"]["href"], "#settings/machines/10.0.0.7")
        self.assertEqual(m["agent:10.0.0.50"]["title"], "Agent à installer sur Gamer32")
        quiet = by(d.build({"net_has_run": True, "net_last": 5.0, "net_every_h": 6}))
        self.assertFalse([k for k in quiet if k.startswith(("ssh:", "agent:", "hosts"))])        # rien à faire : rien de ces trois notifications

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
