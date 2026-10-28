"""machines_admin.publish: name and tags written into the published data.json at once (no wait for the next collection).

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import machines_admin  # noqa: E402


class Publish(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name) / "data.json"
        p = mock.patch.dict("msv.core.config.CFG", {"web_dir": self.tmp.name})
        p.start()
        self.addCleanup(p.stop)

    def test_role_et_nom_publies(self):
        self.data.write_text(json.dumps({"machine_list": [{"ip": "10.0.0.2", "name": "srv", "role": "Docker"}, {"ip": "10.0.0.3", "name": "pc", "role": ""}],
                                         "machines": {"10.0.0.2": {"name": "srv", "role": "Docker"}}}), encoding="utf-8")
        machines_admin.publish("10.0.0.2", {"name": "Serveur", "role": "Docker, NAS"})
        got = json.loads(self.data.read_text(encoding="utf-8"))
        self.assertEqual([(m["name"], m["role"]) for m in got["machine_list"]], [("Serveur", "Docker, NAS"), ("pc", "")])
        self.assertEqual(got["machines"]["10.0.0.2"]["role"], "Docker, NAS")
        machines_admin.publish("10.0.0.2", {"name": "Serveur", "role": None})   # last tag removed
        self.assertEqual(json.loads(self.data.read_text(encoding="utf-8"))["machine_list"][0]["role"], "")

    def test_rien_avant_la_premiere_collecte(self):
        machines_admin.publish("10.0.0.2", {"name": "x", "role": "y"})
        self.assertFalse(self.data.exists())

    def test_machine_retiree_disparait_de_la_liste_publiee(self):
        self.data.write_text(json.dumps({"machine_list": [{"ip": "10.0.0.2", "name": "srv"}, {"ip": "10.0.0.3", "name": "pc"}],
                                         "machines": {"10.0.0.2": {"name": "srv"}, "10.0.0.3": {"name": "pc"}}}), encoding="utf-8")
        machines_admin.unpublish("10.0.0.2")
        got = json.loads(self.data.read_text(encoding="utf-8"))
        self.assertEqual([m["ip"] for m in got["machine_list"]], ["10.0.0.3"])
        self.assertEqual(list(got["machines"]), ["10.0.0.3"])
        machines_admin.unpublish("10.0.0.9")   # unknown: nothing to rewrite
        machines_admin.unpublish("10.0.0.3")
        self.assertEqual(json.loads(self.data.read_text(encoding="utf-8"))["machine_list"], [])


if __name__ == "__main__":
    unittest.main()
