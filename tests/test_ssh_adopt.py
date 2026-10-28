"""SSH switch: adopted by itself when the key works and nothing was set; never when it was turned off by hand."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.machines import machines_admin  # noqa: E402
from msv.machines import setup  # noqa: E402


class Adopt(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.meta = Path(tmp.name) / "services-meta.json"
        self.meta.write_text(json.dumps({"machines": {
            "10.0.0.1": {"name": "pve", "role": "", "ssh": None},
            "10.0.0.2": {"name": "ha", "role": ""},
            "10.0.0.3": {"name": "off", "role": "", "ssh": False},
            "10.0.0.4": {"name": "pc", "role": "", "os": "windows"},
            "10.0.0.5": {"name": "set", "role": "", "ssh": "other"},
            "10.0.0.6": {"name": "dis", "role": "", "disabled": True},
        }}))
        p = mock.patch.object(setup, "META", self.meta)
        p.start()
        self.addCleanup(p.stop)

    def test_adopted_only_when_never_set(self):
        found = {ip: f"a{ip[-1]}" for ip in ("10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5", "10.0.0.6")}
        self.assertEqual(sorted(machines_admin.adopt_ssh(found)), ["10.0.0.1", "10.0.0.2"])
        m = json.loads(self.meta.read_text())["machines"]
        self.assertEqual((m["10.0.0.1"]["ssh"], m["10.0.0.2"]["ssh"]), ("a1", "a2"))
        self.assertIs(m["10.0.0.3"]["ssh"], False)          # turned off by hand: stays off
        self.assertEqual(m["10.0.0.5"]["ssh"], "other")      # already set: untouched

    def test_off_by_hand_is_kept(self):
        self.assertIs(machines_admin._clean({"name": "x", "ssh": False})["ssh"], False)
        self.assertIsNone(machines_admin._clean({"name": "x"})["ssh"])


if __name__ == "__main__":
    unittest.main()
