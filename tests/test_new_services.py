"""New services on the machines (new_services.py): proposed from the « nouveau » events, follow, don't follow (pause), resume."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import new_services  # noqa: E402

ROWS = [
    {"type": "local", "id": "10.0.0.2:8080", "ip": "10.0.0.2", "port": 8080, "machine": "nas", "name": "speedtest",
     "service": {"kind": "docker", "name": "speedtest", "image": "lscr.io/speedtest"}, "app": {"label": "Speedtest Tracker"}},
    {"type": "local", "id": "10.0.0.3:18991", "ip": "10.0.0.3", "port": 18991, "machine": "dev", "service": {"kind": "process", "name": "python3"}},
    {"type": "proxy", "id": "12", "domains": ["a.lan"]},
]
EVENTS = [{"ts": 300.0, "key": "local:10.0.0.3:18991"}, {"ts": 200.0, "key": "local:10.0.0.2:8080"},
          {"ts": 100.0, "key": "local:10.0.0.9:22"}, {"ts": 50.0, "key": "proxy:12"}]


class NewServices(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.meta = self.d / "services-meta.json"
        self.meta.write_text(json.dumps({"machines": {}, "services": {"10.0.0.2:8080": {"description": "kept"}}}))
        self.data = {"hosts": [dict(r) for r in ROWS]}
        (self.d / "data.json").write_text(json.dumps(self.data))

    def tearDown(self):
        self.tmp.cleanup()

    def keys(self, data=None):
        return [x["key"] for x in new_services.pending(data or self.data, EVENTS, self.d)]

    def test_only_present_machine_services_newest_first(self):
        got = new_services.pending(self.data, EVENTS, self.d)
        self.assertEqual([x["key"] for x in got], ["local:10.0.0.3:18991", "local:10.0.0.2:8080"])   # gone and NPM hosts left out
        self.assertEqual((got[1]["name"], got[1]["kind"], got[1]["app"], got[1]["since"]), ("speedtest", "docker", "Speedtest Tracker", 200.0))

    def test_a_service_a_connector_reads_is_not_proposed(self):
        by_url = [({"type": "speedtest-tracker", "url": "http://10.0.0.2:8080/"}, ())]
        self.assertEqual([x["key"] for x in new_services.pending(self.data, EVENTS, self.d, by_url)], ["local:10.0.0.3:18991"])
        by_image = [({"type": "x", "url": "https://10.0.0.2:55000"}, ("lscr.io/speedtest",))]   # another port of the same image's machine
        self.assertEqual(new_services.covered(ROWS, by_image), {"local:10.0.0.2:8080"})
        elsewhere = [({"type": "x", "url": "https://10.0.0.9:55000", "indexer_url": "bad url"}, ("lscr.io/speedtest",))]
        self.assertEqual(new_services.covered(ROWS, elsewhere), set())

    def test_follow_is_remembered(self):
        new_services.follow(["local:10.0.0.3:18991"], self.d)
        self.assertEqual(self.keys(), ["local:10.0.0.2:8080"])

    def test_ignore_pauses_under_ip_port_then_resume(self):
        self.assertEqual(new_services.ignore("local:10.0.0.2:8080", self.data, self.meta, self.d, self.d), "10.0.0.2:8080")
        entry = json.loads(self.meta.read_text())["services"]["10.0.0.2:8080"]
        self.assertEqual(entry["description"], "kept")
        self.assertTrue(entry["pause"].startswith("not followed ("))
        published = json.loads((self.d / "data.json").read_text())
        self.assertTrue(published["hosts"][0]["paused"])               # the page shows it at once
        self.assertEqual(self.keys(published), ["local:10.0.0.3:18991"])
        new_services.set_pause(self.meta, self.d, "10.0.0.2:8080", None)
        self.assertEqual(json.loads(self.meta.read_text())["services"]["10.0.0.2:8080"], {"description": "kept"})
        self.assertNotIn("paused", json.loads((self.d / "data.json").read_text())["hosts"][0])

    def test_public_on_purpose_set_then_removed(self):
        """« Public site, on purpose »: under the host's domain in services-meta.json, and in the published data.json at once."""
        new_services.set_public(self.meta, self.d, "a.lan", True)
        self.assertEqual(json.loads(self.meta.read_text())["services"]["a.lan"], {"public": True})
        self.assertTrue(json.loads((self.d / "data.json").read_text())["hosts"][2]["public_ok"])
        new_services.set_public(self.meta, self.d, "a.lan", False)
        self.assertNotIn("a.lan", json.loads(self.meta.read_text())["services"])   # an empty entry goes
        self.assertFalse(json.loads((self.d / "data.json").read_text())["hosts"][2]["public_ok"])
        self.assertEqual(json.loads(self.meta.read_text())["services"]["10.0.0.2:8080"], {"description": "kept"})   # the others untouched

    def test_edit_meta_keeps_the_entry_and_updates_the_page(self):
        r = self.data["hosts"][0]   # local 10.0.0.2:8080, entry « kept » under ip:port
        key = new_services.edit_meta(self.meta, self.d, r, {"category": "Réseau", "description": "Débit de la ligne", "tags": ["box", ""], "web": "ui",
                                                            "public": False, "direct_ok": True, "pause": True})
        self.assertEqual(key, "10.0.0.2:8080")   # the existing entry, not a new one
        entry = json.loads(self.meta.read_text())["services"]["10.0.0.2:8080"]
        self.assertEqual(entry, {"category": "Réseau", "description": "Débit de la ligne", "tags": ["box"], "web": "ui", "direct_ok": True, "pause": "paused by hand"})
        h = json.loads((self.d / "data.json").read_text())["hosts"][0]
        self.assertEqual((h["category"], h["description"], h["tags"], h["web"], h["direct_ok"], h["paused"]), ("Réseau", "Débit de la ligne", ["box"], "ui", True, "paused by hand"))
        new_services.edit_meta(self.meta, self.d, r, {"category": None, "description": "", "tags": [], "web": None, "public": False, "direct_ok": False, "pause": False})
        self.assertNotIn("10.0.0.2:8080", json.loads(self.meta.read_text())["services"])   # every field back to the detection: the entry goes
        self.assertNotIn("paused", json.loads((self.d / "data.json").read_text())["hosts"][0])

    def test_edit_meta_new_entry_under_the_domain_and_categories(self):
        self.assertEqual(new_services.edit_meta(self.meta, self.d, self.data["hosts"][2], {"public": True}), "a.lan")
        self.assertEqual(new_services.current_entry(self.meta, self.data["hosts"][2]), ("a.lan", {"public": True}))
        self.assertEqual(new_services.current_entry(self.meta, self.data["hosts"][1]), (None, {}))
        meta = json.loads(self.meta.read_text())
        meta["categories"] = [["IA", "ollama"], ["Médias", "plex"]]
        self.meta.write_text(json.dumps(meta))
        self.assertEqual(new_services.categories(self.meta, {"hosts": [{"category": "Infra"}, {"category": None}]}), ["IA", "Infra", "Médias"])

    def test_edit_meta_name_icon_app_address_alerts(self):
        r = self.data["hosts"][2]
        new_services.edit_meta(self.meta, self.d, r, {"name": "Films", "icon": "jellyfin", "app": "jellyfin", "open_url": "https://tv.lan/web", "alerts": "down"})
        self.assertEqual(new_services.current_entry(self.meta, r)[1], {"name": "Films", "icon": "jellyfin", "app": "jellyfin", "open_url": "https://tv.lan/web", "alerts": "down"})
        h = json.loads((self.d / "data.json").read_text())["hosts"][2]
        self.assertEqual((h["display_name"], h["icon"], h["open_url"], h["alerts"]), ("Films", "jellyfin", "https://tv.lan/web", "down"))
        self.assertEqual((h["app"]["key"], h["app"]["confidence"], h["app"]["hand"]), ("jellyfin", "sure", True))
        self.assertEqual(h["hand"], ["name", "icon", "app", "open_url", "alerts"])   # the page says these come from the hand
        new_services.edit_meta(self.meta, self.d, r, {})
        h = json.loads((self.d / "data.json").read_text())["hosts"][2]
        self.assertFalse({"display_name", "icon", "open_url", "alerts"} & set(h))
        self.assertEqual(h["hand"], [])

    def test_machine_ssh_never_proposed(self):
        data = {"hosts": self.data["hosts"] + [{"type": "local", "id": "10.0.0.3:22", "ip": "10.0.0.3", "port": 22, "app": {"key": "openssh"},
                                                "service": {"kind": "process", "name": "sshd"}}]}
        got = new_services.pending(data, [{"ts": 400.0, "key": "local:10.0.0.3:22"}, *EVENTS], self.d)
        self.assertNotIn("local:10.0.0.3:22", [x["key"] for x in got])

    def test_ignore_unknown_service(self):
        with self.assertRaises(LookupError):
            new_services.ignore("local:10.0.0.9:22", self.data, self.meta, self.d, self.d)


if __name__ == "__main__":
    unittest.main()
