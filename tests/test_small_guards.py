"""Small guards: the Proxmox crontab read through the guest agent (backups.qm_crontab), and the placeholders the commit guard lets
through (scripts/safety.py)."""
import importlib.util
import sys
import unittest
import unittest.mock
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from msv.backups import backups  # noqa: E402


def load_safety():
    spec = importlib.util.spec_from_file_location("safety", ROOT / "scripts" / "safety.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class QmCrontab(unittest.TestCase):
    def test_vm_id_and_alias_are_checked_before_ssh(self):
        with unittest.mock.patch("subprocess.run") as run:
            self.assertEqual(backups.qm_crontab("pve:101;reboot"), [])    # not digits: nothing is run
            self.assertEqual(backups.qm_crontab("-oProxyCommand=x:101"), [])   # an alias is never an ssh option
            run.assert_not_called()

    def test_reads_the_guest_crontab(self):
        out = unittest.mock.Mock(stdout='{"out-data": "5 3 * * * /usr/local/bin/save.sh\\n"}')
        with unittest.mock.patch("subprocess.run", return_value=out) as run:
            backups.qm_crontab("pve:101")
        self.assertIn("qm guest exec 101 -- crontab -l", run.call_args.args[0][-1])


class SafetyPlaceholders(unittest.TestCase):
    def test_placeholders_pass_real_values_do_not(self):
        p = load_safety().PLACEHOLDER
        for ok in ("changeme", "change-me", "change_me", "your-key", "<token>", "enc:v1:abc"):
            self.assertTrue(p.match(ok), ok)
        self.assertFalse(p.match("k8Fq2Lw9Zr"))


if __name__ == "__main__":
    unittest.main()
