"""health.py : un bandeau de connexion (fastfetch, motd dans ~/.bashrc) ne doit pas fausser la lecture d'une machine.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import health  # noqa: E402

BANNER = "/root/.bashrc: ligne 77 : bind: avertissement\n        _,met$$$$$gg.\n   ,g$$P\"\"\n\x1b[16A\x1b[31Croot@Jarvis\n"


class AfterBanner(unittest.TestCase):
    def test_coupe_ce_qui_precede_le_repere(self):
        self.assertEqual(health.after_banner(BANNER + health.SSH_MARK + "\n3\n"), "3\n")

    def test_sans_repere_garde_tout(self):
        self.assertEqual(health.after_banner("3\n"), "3\n")

    def test_runner_ssh_linux_marque_et_nettoie(self):
        sent = {}

        def fake_run(argv, **kw):
            sent["cmd"] = argv[-1]
            return mock.Mock(returncode=0, stdout=BANNER + health.SSH_MARK + "\n7\n", stderr="")
        run = health.make_runner({"mode": "ssh", "target": "jarvis", "os": "linux"})
        with mock.patch.object(health.subprocess, "run", fake_run):
            rc, out = run("echo 7")
        self.assertEqual((rc, out), (0, "7\n"))
        self.assertTrue(sent["cmd"].startswith("printf"))

    def test_runner_windows_garde_sa_commande(self):
        sent = {}

        def fake_run(argv, **kw):
            sent["cmd"] = argv[-1]
            return mock.Mock(returncode=0, stdout="{}", stderr="")
        run = health.make_runner({"mode": "ssh", "target": "pc", "os": "windows"})
        with mock.patch.object(health.subprocess, "run", fake_run):
            run("powershell -c x")
        self.assertEqual(sent["cmd"], "powershell -c x")


if __name__ == "__main__":
    unittest.main()
