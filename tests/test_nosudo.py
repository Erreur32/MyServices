"""msv.core.nosudo: a sudo refused over SSH is not asked again for a day (sudo mails every refusal), in every collection that uses sudo.

  python3 -m unittest tests.test_nosudo
"""
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import adguard, process  # noqa: E402
from connectors.base import ConnectorError  # noqa: E402
from msv.core import nosudo  # noqa: E402

NOW = 1792678313


class StateInTmp(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = mock.patch.object(nosudo, "_path", return_value=Path(tmp.name) / "nosudo.json")
        p.start()
        self.addCleanup(p.stop)


class Memory(StateInTmp):
    def test_refus_retenu_un_jour(self):
        self.assertFalse(nosudo.skipped("srv", "smart", NOW))
        nosudo.record("srv", "smart", True, NOW)
        self.assertTrue(nosudo.skipped("srv", "smart", NOW + 3600))
        self.assertFalse(nosudo.skipped("srv", "ss", NOW + 3600))                     # per read
        self.assertFalse(nosudo.skipped("other", "smart", NOW + 3600))                # per machine
        self.assertFalse(nosudo.skipped("srv", "smart", NOW + nosudo.RETRY_S))        # asked again after a day
        with mock.patch.object(nosudo, "FORCE", True):
            self.assertFalse(nosudo.skipped("srv", "smart", NOW + 60))                # « Relire » asks again at once
        nosudo.record("srv", "smart", False, NOW + 60)
        self.assertFalse(nosudo.skipped("srv", "smart", NOW + 120))                   # rule added: forgotten
        self.assertEqual(nosudo._load(), {})

    def test_sans_alias_rien(self):
        nosudo.record(None, "smart", True, NOW)
        self.assertFalse(nosudo.skipped(None, "smart", NOW))
        self.assertFalse(nosudo._path().exists())


class Ports(StateInTmp):
    def test_ss_refuse_puis_sans_sudo(self):
        calls = []

        def run(*a, **k):
            calls.append(a[0][-1])
            return SimpleNamespace(returncode=0, stdout="", stderr="NOSUDO\n")
        with mock.patch.object(process.subprocess, "run", side_effect=run):
            process.listening_read("srv")
            process.listening_read("srv")
        self.assertIn("sudo -n ss", calls[0])
        self.assertEqual(calls[1], "ss -tlnpH")                                       # refused: not asked again
        self.assertIn("sudo -n ss -tlnpH", process.LISTEN_SH)                        # the agents' command is unchanged


class AdGuardNative(StateInTmp):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(adguard, "agent_dns", return_value={})   # no agent report: read over SSH
        p.start()
        self.addCleanup(p.stop)

    def ag(self, answers, seen):
        def ssh(alias, cmd, timeout=None):
            seen.append(cmd)
            return answers.pop(0)
        return adguard.AdGuard({"name": "x", "ip": "10.0.0.2", "ssh": "dns", "target": "/opt/AdGuardHome/AdGuardHome.yaml"},
                               SimpleNamespace(ssh=ssh))

    def test_sudo_refuse_retenu(self):
        seen = []
        ag = self.ag(["@@SUDO\nsudo: a password is required\n@@FAIL\n", "rewrites: []\n"], seen)
        with self.assertRaises(ConnectorError):
            ag.collect()
        self.assertTrue(nosudo.skipped("dns", "adguard"))
        ag.collect()
        self.assertEqual(seen[1], "cat /opt/AdGuardHome/AdGuardHome.yaml")             # no sudo while refused

    def test_lu_par_sudo(self):
        seen = []
        self.ag(["@@SUDO\nfiltering:\n  rewrites: []\n"], seen).collect()
        self.assertFalse(nosudo.skipped("dns", "adguard"))


if __name__ == "__main__":
    unittest.main()
