"""archify_map.py : cartes Archify (réseau et santé, sauvegardes) : composants, liaisons, placement sans croisement.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import archify_map  # noqa: E402

DATA = {
    "generated": "2026-10-10T01:00:00+00:00",
    "npm_instances": {"NPM": "10.0.0.2"},
    "dns": {"servers": {"10.0.0.2": {"name": "srv", "rewrites": 3}, "10.0.0.3": {"name": "mon"}}},
    "machine_list": [{"ip": "10.0.0.2", "name": "srv", "ping": True}, {"ip": "10.0.0.3", "name": "mon", "ping": True},
                     {"ip": "10.0.0.9", "name": "PC", "off": True}, {"ip": "10.0.0.1", "name": "box", "gateway": True, "ping": True}],
    "hosts": [{"type": "proxy", "enabled": True, "npm": "NPM", "ip": "10.0.0.2"},
              {"type": "proxy", "enabled": True, "npm": "NPM", "ip": "10.0.0.2"},
              {"type": "proxy", "enabled": True, "npm": "NPM", "ip": "10.0.0.3"},
              {"type": "proxy", "enabled": False, "npm": "NPM", "ip": "10.0.0.9"},
              {"type": "local", "ip": "10.0.0.9"}],
}


class Map(unittest.TestCase):
    def test_spec(self):
        s = archify_map.build(DATA)
        self.assertEqual((s["diagram_type"], s["meta"]["output"], s["layout"]["mode"]), ("architecture", "carte.html", "grid"))
        ids = {c["id"]: c for c in s["components"]}
        self.assertEqual(ids["npm_npm"]["label"], "NPM")  # pas « NPM NPM »
        self.assertEqual(ids["m_10_0_0_9"]["sublabel"], "10.0.0.9 · éteinte")
        self.assertEqual(ids["m_10_0_0_1"]["type"], "database")  # passerelle
        hosts = {(c["from"], c["to"]): c.get("label") for c in s["connections"]}
        self.assertEqual(hosts[("npm_npm", "m_10_0_0_2")], "2 hosts")
        self.assertEqual(hosts[("npm_npm", "m_10_0_0_3")], "1 hosts")
        self.assertNotIn(("npm_npm", "m_10_0_0_9"), hosts)  # host désactivé : pas de liaison
        self.assertIn(("dns_10_0_0_2", "npm_npm"), hosts)

    def test_grid_no_overlap(self):
        s = archify_map.build(DATA)
        cells = [(c["row"], c["col"]) for c in s["components"]]
        self.assertEqual(len(cells), len(set(cells)))  # une case par composant
        self.assertTrue(all(0 <= c < s["layout"]["cols"] for _, c in cells))
        rows = {c["id"]: c["row"] for c in s["components"]}
        self.assertEqual((rows["internet"], rows["npm_npm"], rows["m_10_0_0_2"], rows["m_10_0_0_9"]), (0, 1, 2, 3))

    def test_health(self):
        stats = {"hosts": [{"name": "srv · 10.0.0.2", "level": "ok"},
                           {"name": "mon · 10.0.0.3", "level": "crit",
                            "disks": [{"used_pct": 93, "critical": True}, {"used_pct": 20}]},
                           {"name": "absent · 10.0.0.77", "level": "down"}]}
        s = archify_map.build(DATA, stats)
        ids = {c["id"]: c for c in s["components"]}
        self.assertEqual((ids["m_10_0_0_2"]["icon"], ids["m_10_0_0_2"]["tag"]), ("success", "santé OK"))
        self.assertEqual(ids["m_10_0_0_3"]["icon"], "failure")
        self.assertNotIn("icon", ids["m_10_0_0_9"])  # pas relevée par la santé
        card = s["cards"][0]
        self.assertEqual((card["dot"], card["items"]), ("rose", ["absent : injoignable", "mon : critique (disque 93 %)"]))
        self.assertNotIn("cards", archify_map.build(DATA, {"hosts": [{"name": "srv · 10.0.0.2", "level": "ok"}]}))


BACKUPS = {
    "generated": "2026-10-10T07:05:00+02:00",
    "hosts": [{"id": "srv", "label": "srv", "ip": "10.0.0.2", "sets": ["a", "b"], "level": "warn",
               "last_local": {"age": 0.5}, "copies": [{"host": "nas", "sets": 2, "age": 1.2, "level": "ok"},
                                                      {"host": "cloud", "sets": 1, "age": 9, "level": "warn"},
                                                      {"host": "inconnu", "sets": 1, "age": 1, "level": "ok"}]},
              {"id": "nas", "label": "NAS", "ip": "10.0.0.5", "sets": [], "storage": True, "level": "ok", "copies": []},
              {"id": "cloud", "label": "Cloud", "sets": [], "level": "ok", "copies": []}],
    "issues": [{"level": "warn", "set": "b", "text": "copie Cloud : 9 j"}],
}


class Backups(unittest.TestCase):
    def test_spec(self):
        s = archify_map.build_backups(BACKUPS)
        self.assertEqual(s["meta"]["output"], "sauvegardes.html")
        ids = {c["id"]: c for c in s["components"]}
        self.assertEqual(ids["b_srv"]["sublabel"], "10.0.0.2 · dernier 12 h")
        self.assertEqual((ids["b_nas"]["type"], ids["b_nas"]["sublabel"]), ("database", "10.0.0.5 · stockage"))
        self.assertEqual(ids["b_srv"]["icon"], "waiting")
        links = {(c["from"], c["to"]): c for c in s["connections"]}
        self.assertEqual(links[("b_srv", "b_nas")]["label"], "2 jeux · 1 j")
        self.assertEqual(links[("b_srv", "b_cloud")].get("variant"), "dashed")  # copie en retard
        self.assertEqual(len(links), 2)  # machine hors liste : pas de liaison
        self.assertEqual(s["cards"][0]["items"], ["b : copie Cloud : 9 j"])
        cells = [(c["row"], c["col"]) for c in s["components"]]
        self.assertEqual(len(cells), len(set(cells)))
        self.assertEqual((ids["b_srv"]["row"], ids["b_nas"]["row"]), (0, 2))  # producteurs en haut, stockages dessous

    def test_empty(self):
        s = archify_map.build_backups({"hosts": []})
        self.assertEqual([c["id"] for c in s["components"]], ["aucune"])

    def test_main_writes_specs(self):
        with tempfile.TemporaryDirectory() as d:
            web, out = Path(d) / "web", Path(d) / "out"
            (web / "health").mkdir(parents=True)
            out.mkdir()
            (web / "data.json").write_text(json.dumps(DATA))
            sys.argv = ["archify_map.py", str(web), str(out)]
            archify_map.main()
            self.assertEqual(sorted(f.name for f in out.iterdir()), ["carte.archify.json"])  # sans backups.json
            (web / "backups.json").write_text(json.dumps(BACKUPS))
            archify_map.main()
            self.assertEqual(sorted(f.name for f in out.iterdir()), ["carte.archify.json", "sauvegardes.archify.json"])


if __name__ == "__main__":
    unittest.main()
