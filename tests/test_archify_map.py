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
            self.assertEqual(sorted(f.name for f in out.iterdir()), ["acces.archify.json", "carte.archify.json", "connecteurs.archify.json"])  # sans backups.json ni alertes
            (web / "backups.json").write_text(json.dumps(BACKUPS))
            (out / "alerts-summary.json").write_text(json.dumps({"channels": [{"type": "discord", "name": "D", "enabled": True}], "rules": 1, "reports": 0, "live": 1}))
            archify_map.main()
            self.assertEqual(sorted(f.name for f in out.iterdir()), ["acces.archify.json", "alertes.archify.json", "alerts-summary.json", "carte.archify.json",
                                                                     "connecteurs.archify.json", "sauvegardes.archify.json"])

    def test_schema_inchange_pas_regenere(self):
        import contextlib
        import io
        with tempfile.TemporaryDirectory() as d:
            web, out = Path(d) / "web", Path(d) / "out"
            (web / "health").mkdir(parents=True)
            out.mkdir()
            (web / "data.json").write_text(json.dumps(DATA))
            sys.argv = ["archify_map.py", str(web), str(out)]

            def run():
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    archify_map.main()
                return buf.getvalue().split()
            self.assertEqual(len(run()), 3)                          # premier passage : tout est à produire
            for n in ("carte", "connecteurs", "acces"):
                (web / f"{n}.html").write_text("<html></html>")      # pages produites par Archify
            self.assertEqual(run(), [])                              # rien n'a changé : rien à regénérer
            (web / "data.json").write_text(json.dumps({**DATA, "connectors": [{"type": "npm", "name": "npm", "ok": False, "message": "x"}]}))
            changed = [Path(x).name for x in run()]
            self.assertIn("connecteurs.archify.json", changed)

    def test_nouveaux_schemas_coherents(self):
        for spec in (archify_map.build_connectors({**DATA, "connectors": [{"type": "docker", "name": "srv", "ok": True, "message": "3 conteneurs"},
                                                                         {"type": "npm", "name": "npm", "ok": False, "message": "refusé"}]}),
                     archify_map.build_access(DATA, None),
                     archify_map.build_alert_chain({"channels": [{"type": "telegram", "name": "T", "enabled": False}], "rules": 2, "reports": 1, "live": 0}, "2026-10-11T10:00")):
            ids = {c["id"] for c in spec["components"]}
            self.assertEqual(len(ids), len(spec["components"]), "identifiants en double")
            self.assertTrue(all(c["from"] in ids and c["to"] in ids for c in spec["connections"]), spec["meta"]["title"])
            self.assertLessEqual(spec["layout"]["cols"], archify_map.MAX_COLS)
            self.assertTrue(all("row" in c and "col" in c for c in spec["components"]))

    def test_acces_chaque_machine_sous_sa_methode(self):
        ml = [{"ip": "10.0.0.2", "name": "srv", "ssh": {"user": "root", "port": 22}, "agent": {"state": "actif"}, "api": [{"label": "Beszel"}]},
              {"ip": "10.0.0.3", "name": "PC", "agent": {"state": "actif"}},
              {"ip": "10.0.0.4", "name": "ha", "api": [{"label": "Home Assistant"}]},
              {"ip": "10.0.0.5", "name": "box"}]
        spec = archify_map.build_access({"generated": "2026-10-11T10:00:00+00:00", "machine_list": ml}, None)
        by = {c["id"]: c for c in spec["components"]}
        self.assertEqual({k for k in by if k.startswith("g_")}, {"g_ssh", "g_agent", "g_api", "g_none"})
        self.assertEqual(by["a_10_0_0_2"]["sublabel"], "root@10.0.0.2:22 · + agent, Beszel")   # SSH d'abord, les autres accès en détail
        self.assertEqual(by["a_10_0_0_4"]["sublabel"], "10.0.0.4 · Home Assistant")
        self.assertEqual(by["a_10_0_0_5"]["sublabel"], "10.0.0.5 · ping seulement")
        self.assertEqual(len(spec["boundaries"]), 4)
        self.assertTrue(all(set(b["wraps"]) <= set(by) for b in spec["boundaries"]))
        many = [{"ip": f"10.1.0.{i}", "name": f"s{i}", "ssh": {"user": "u", "port": 22}} for i in range(1, 31)]
        big = archify_map.build_access({"generated": "x", "machine_list": many}, None)
        self.assertEqual(sum(1 for c in big["components"] if c["id"].startswith("a_")), archify_map.PER_GROUP)
        self.assertIn("(suite)", big["cards"][0]["title"])                                     # le reste est dans l'encadré
        self.assertLessEqual(big["layout"]["cols"], archify_map.MAX_COLS)


if __name__ == "__main__":
    unittest.main()
