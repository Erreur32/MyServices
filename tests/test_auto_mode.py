"""Auto mode: machines worth following added after a network search, once; nothing in manual mode."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.machines import machines_admin  # noqa: E402
from msv.machines import setup  # noqa: E402

try:
    import server
except ImportError:  # server.py needs the API dependencies
    server = None

FOUND = [
    {"ip": "10.0.0.1", "name": "known", "ssh_port": 22, "hints": ["SSH"], "apps": []},
    {"ip": "10.0.0.2", "name": "nas", "ssh_port": None, "hints": ["partage SMB"], "apps": []},
    {"ip": "10.0.0.3", "name": "", "ssh_port": None, "hints": [], "apps": ["Home Assistant"]},
    {"ip": "10.0.0.4", "name": "cam", "ssh_port": None, "hints": ["web", "port 554"], "apps": []},
    {"ip": "10.0.0.5", "name": "phone", "ssh_port": None, "hints": [], "apps": []},
    {"ip": "10.0.0.6", "name": "pve", "ssh_port": 22, "hints": ["SSH", "web (https)"], "apps": ["Proxmox VE"]},
]


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.meta = self.dir / "services-meta.json"
        self.meta.write_text(json.dumps({"machines": {"10.0.0.1": {"name": "known", "role": ""}}}))
        p = mock.patch.object(setup, "META", self.meta)
        p.start()
        self.addCleanup(p.stop)

    def machines(self) -> dict:
        return json.loads(self.meta.read_text())["machines"]


class AdoptFound(Base):
    def test_interesting_like_the_page(self):
        self.assertEqual([h["ip"] for h in FOUND if machines_admin.interesting(h)], ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.6"])

    def test_adds_new_interesting_not_skipped(self):
        self.assertEqual(machines_admin.adopt_found(FOUND, {"10.0.0.2"}), ["10.0.0.3", "10.0.0.6"])
        m = self.machines()
        self.assertEqual(m["10.0.0.3"]["name"], "10.0.0.3")                   # no name: the IP
        self.assertEqual(m["10.0.0.6"]["role"], "Proxmox VE, SSH, web (https)")
        self.assertNotIn("10.0.0.2", m)                                       # skipped (ignored or removed by hand)
        self.assertNotIn("10.0.0.4", m)                                       # camera: web and port only


@unittest.skipIf(server is None, "server.py needs FastAPI")
class AutoAdopt(Base):
    def setUp(self):
        super().setUp()
        (self.dir / "network-scan.json").write_text(json.dumps({"phase": "done", "ended": 100.0, "found": FOUND}))
        for k, v in {"state_dir": str(self.dir), "auto_mode": True, "netscan_ignored": [{"ip": "10.0.0.2"}]}.items():
            p = mock.patch.dict(server.CFG, {k: v})
            p.start()
            self.addCleanup(p.stop)
        for name in ("run_chain", "log"):
            p = mock.patch.object(server, name)
            setattr(self, name, p.start())
            self.addCleanup(p.stop)
        p = mock.patch.object(server, "enabled", lambda name: True)   # the collection task is on (it depends on the config otherwise)
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.object(server.netscan, "state", lambda f: json.loads(Path(f).read_text()))
        p.start()
        self.addCleanup(p.stop)

    def test_once_per_search_and_never_again_once_removed(self):
        server.auto_adopt()
        self.assertEqual(sorted(self.machines()), ["10.0.0.1", "10.0.0.3", "10.0.0.6"])
        self.run_chain.assert_called_once()
        server.auto_adopt()                                                   # same search: nothing more
        self.run_chain.assert_called_once()
        m = json.loads(self.meta.read_text())
        del m["machines"]["10.0.0.6"]                                         # removed by hand
        self.meta.write_text(json.dumps(m))
        (self.dir / "network-scan.json").write_text(json.dumps({"phase": "done", "ended": 200.0, "found": FOUND}))
        server.auto_adopt()
        self.assertNotIn("10.0.0.6", self.machines())

    def test_manual_mode_adds_nothing(self):
        server.CFG["auto_mode"] = False
        server.auto_adopt()
        self.assertEqual(list(self.machines()), ["10.0.0.1"])


if __name__ == "__main__":
    unittest.main()
