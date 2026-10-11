"""Schémas proposés (archify_extra.py) : réseau, services par machine, domaines, virtualisation ; disponibilité, structure, limites d'Archify.

  python3 -m unittest discover -s tests
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import archify_extra as ax  # noqa: E402

ID = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]*$")
DATA = {
    "generated": "2026-10-11T10:00:00+00:00",
    "machine_list": [{"ip": "10.0.0.2", "name": "srv", "info": {"vhosts": [{"port": 80, "names": ["a.fr", "www.a.fr"], "docroot": "/www"}, {"port": 443, "names": ["a.fr"]}], "nginx": False}},
                     {"ip": "10.0.0.3", "name": "web", "info": {"nginx": True}}],
    "hosts": [{"type": "proxy", "npm": "npm", "domains": ["x.lan", "y.lan"], "machine": "srv", "ip": "10.0.0.2", "port": 8080, "enabled": True, "service": {"kind": "docker", "name": "x"}},
              {"type": "proxy", "npm": "npm", "domains": ["z.lan"], "machine": "web", "ip": "10.0.0.3", "port": 81, "enabled": False, "app": {"label": "Z"}},
              {"type": "local", "machine": "srv", "ip": "10.0.0.2", "port": 9000, "domains": [], "service": {"kind": "docker", "name": "portainer", "title": "Portainer"}},
              {"type": "local", "machine": "srv", "ip": "10.0.0.2", "port": 9001, "service": {"kind": "docker", "name": "portainer", "title": "Portainer"}}],
    "network": [{"connector": "mynetwork", "devices": [{"ip": "192.168.1.50", "hostname": "nas", "status": "online"}, {"ip": "192.168.1.9", "hostname": "old", "status": "offline"}],
                 "unifi": {"devices": [{"name": "GW", "type": "udm", "mac": "aa", "ip": "192.168.1.1", "state": "connected"},
                                       {"name": "Switch", "type": "usw", "mac": "bb", "ip": "192.168.1.2", "state": "connected"},
                                       {"name": "AP", "type": "uap", "mac": "cc", "ip": "192.168.1.3", "state": "connected"}],
                           "clients": [{"name": "pc", "mac": "01", "ip": "192.168.1.5", "wired": True, "switch_mac": "bb", "switch_port": 3},
                                       {"name": "tel", "mac": "02", "ip": "192.168.1.6", "wired": False, "essid": "wifi", "signal_dbm": -60, "ap_mac": "cc"},
                                       {"name": "box", "mac": "03", "ip": "192.168.1.7", "wired": True, "switch_mac": "aa"}]}}],
    "virtualization": [{"connector": "proxmox", "name": "pve", "label": "Proxmox VE", "nodes": [{"name": "n1", "online": True, "cpu_pct": 12.0}],
                        "guests": [{"vmid": 100, "name": "vm1", "type": "qemu", "node": "n1", "status": "running", "template": False},
                                   {"vmid": 101, "name": "ct1", "type": "lxc", "node": "n1", "status": "stopped", "template": False},
                                   {"vmid": 9000, "name": "tpl", "type": "qemu", "node": "n1", "status": "stopped", "template": True}]}],
}


def check(test, spec):
    ids = [c["id"] for c in spec["components"]]
    test.assertEqual(len(ids), len(set(ids)), "identifiants en double")
    test.assertTrue(all(ID.match(i) for i in ids), [i for i in ids if not ID.match(i)])
    test.assertTrue(all(c["from"] in ids and c["to"] in ids for c in spec["connections"]))
    test.assertTrue(all(set(b["wraps"]) <= set(ids) for b in spec.get("boundaries", [])))
    test.assertLessEqual(spec["layout"]["cols"], 12)
    test.assertTrue(all(c["col"] < spec["layout"]["cols"] for c in spec["components"]))


class Extra(unittest.TestCase):
    def test_disponibilite(self):
        self.assertTrue(all(ax.available(k, DATA) for k in ax.CATALOG))
        self.assertFalse(any(ax.available(k, {}) for k in ax.CATALOG))
        self.assertFalse(ax.available("virtualisation", {"virtualization": [{"guests": [], "nodes": []}]}))

    def test_tous_valides(self):
        for k, build in ax.BUILD.items():
            check(self, build(DATA))

    def test_reseau_appareils_sous_leur_switch_ou_borne(self):
        spec = ax.build_reseau(DATA)
        labels = {c["label"]: c for c in spec["components"]}
        self.assertEqual(spec["components"][0]["label"], "GW")
        self.assertTrue({"Switch", "AP"} <= set(labels))
        bounds = {b["label"].split(" · ")[0]: b for b in spec["boundaries"]}
        under = lambda g: {c["label"] for c in spec["components"] if c["id"] in bounds[g]["wraps"][1:]}   # noqa: E731   (le premier est le bloc du groupe)
        self.assertIn("pc", under("Switch"))
        self.assertIn("tel", under("AP"))
        self.assertIn("box", under("Sur la passerelle"))
        self.assertEqual({"nas", "old"}, under("Autres appareils vus"))   # vus par le scanner, ni client UniFi ni appareil UniFi

    def test_services_par_machine_sans_doublon(self):
        spec = ax.build_services(DATA)
        srv = next(b for b in spec["boundaries"] if b["label"].startswith("srv"))
        names = [c["label"] for c in spec["components"] if c["id"] in srv["wraps"]]
        self.assertEqual(names.count("Portainer"), 1)
        self.assertIn("x", names)

    def test_domaines_npm_et_apache(self):
        spec = ax.build_domaines(DATA)
        titles = {b["label"].split(" · ")[0] for b in spec["boundaries"]}
        self.assertEqual(titles, {"npm", "Apache srv"})
        comps = {c["label"]: c for c in spec["components"]}
        self.assertEqual(comps["x.lan"]["sublabel"], "srv · x · +1")
        self.assertTrue(comps["z.lan"]["sublabel"].endswith("désactivé"))
        self.assertEqual(sum(1 for c in spec["components"] if c["label"] == "a.fr"), 2)             # un vhost par port
        self.assertEqual(spec["cards"][-1]["title"], "nginx installé (sites non lus)")

    def test_virtualisation_modeles_exclus(self):
        spec = ax.build_virtualisation(DATA)
        labels = {c["label"] for c in spec["components"]}
        self.assertTrue({"vm1", "ct1", "n1"} <= labels)
        self.assertNotIn("tpl", labels)

    def test_beaucoup_d_elements_restent_dans_les_limites(self):
        big = {**DATA, "hosts": [{"type": "proxy", "npm": f"n{i % 15}", "domains": [f"d{i}.lan"], "machine": f"m{i % 20}", "ip": "10.0.0.2", "port": 80 + i, "enabled": True,
                                  "service": {"kind": "docker", "name": f"s{i}"}} for i in range(300)]}
        for build in (ax.build_domaines, ax.build_services):
            spec = build(big)
            check(self, spec)
            self.assertTrue(any("autre" in c["title"].lower() or "suite" in c["title"] for c in spec.get("cards", [])))


if __name__ == "__main__":
    unittest.main()
