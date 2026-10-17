"""machines_admin.save: services outside Docker are read by default when SSH is switched on with the root account.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import machines_admin  # noqa: E402

CONF = {"10.0.0.2": {"alias": "srv", "user": "root"}, "10.0.0.3": {"alias": "pc", "user": "bob"}}


class ProcessDefault(unittest.TestCase):
    def run_save(self, ip, alias, old=None):
        meta = {"machines": {ip: old} if old else {}, "process_hosts": {}, "extra": []}
        with mock.patch.object(machines_admin, "_meta", return_value=meta), mock.patch.object(machines_admin.setup, "save"), \
                mock.patch.object(machines_admin.hostinfo, "ssh_config", return_value=CONF), mock.patch.object(machines_admin, "expire_inventory"):
            machines_admin.save(ip, {"name": "x", "ssh": alias}, process=False)
        return meta["process_hosts"]

    def test_root_enables_it(self):
        self.assertEqual(self.run_save("10.0.0.2", "srv"), {"10.0.0.2": "srv"})

    def test_other_account_does_not(self):
        self.assertEqual(self.run_save("10.0.0.3", "pc"), {})

    def test_already_on_keeps_the_choice(self):
        self.assertEqual(self.run_save("10.0.0.2", "srv", old={"name": "x", "ssh": "srv"}), {})


if __name__ == "__main__":
    unittest.main()
