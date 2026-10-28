"""backups.resolve_ssh: the access of a declared machine is found again from its address when the declared one cannot work in this installation.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.backups import backups  # noqa: E402

BY_IP = {"10.0.0.9": "m-209", "10.0.0.6": "hote", "10.0.0.2": "m-202"}
KNOWN = {"hote", "m-209", "m-202"}
HOSTS = [{"id": "tower", "ip": "10.0.0.9", "ssh": "tower"},        # alias brought from another install, not defined here
         {"id": "dev", "ip": "10.0.0.2", "ssh": None},             # « local »: the collector of the old install
         {"id": "ok", "ip": "10.0.0.6", "ssh": "hote"},            # defined here: left alone
         {"id": "ha", "ip": "10.0.0.1", "api": "ha", "ssh": None},  # API machine: left alone
         {"id": "far", "ip": "203.0.113.7", "ssh": "echosystem"}]    # unknown address: left alone


class Resolve(unittest.TestCase):
    def test_container_finds_the_access_by_address(self):
        got = {h["id"]: h["ssh"] for h in backups.resolve_ssh(HOSTS, BY_IP, KNOWN, True)}
        self.assertEqual(got, {"tower": "m-209", "dev": "m-202", "ok": "hote", "ha": None, "far": "echosystem"})

    def test_local_stays_local_outside_a_container(self):
        got = {h["id"]: h["ssh"] for h in backups.resolve_ssh(HOSTS, BY_IP, KNOWN, False)}
        self.assertIsNone(got["dev"])
        self.assertEqual(got["tower"], "m-209")

    def test_aliases_of_the_ssh_config_and_machines_of_the_meta(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / ".ssh").mkdir()
            (Path(d) / ".ssh" / "config").write_text("Host hote m-1\n  HostName x\nHost *\n  User y\n# Host nope\n", encoding="utf-8")
            meta = Path(d) / "services-meta.json"
            meta.write_text(json.dumps({"machines": {"10.0.0.1": {"ssh": "m-1"}, "10.0.0.2": {"ssh": "m-2", "disabled": True}, "10.0.0.3": {}}}), encoding="utf-8")
            with mock.patch.object(Path, "home", return_value=Path(d)), mock.patch.dict(backups.CFG, {"meta": str(meta)}):
                self.assertEqual(backups.ssh_aliases(), {"hote", "m-1"})
                self.assertEqual(backups.machine_aliases(), {"10.0.0.1": "m-1"})
            with mock.patch.object(Path, "home", return_value=Path(d) / "none"), mock.patch.dict(backups.CFG, {"meta": str(meta) + ".none"}):
                self.assertEqual((backups.ssh_aliases(), backups.machine_aliases()), (set(), {}))


if __name__ == "__main__":
    unittest.main()
