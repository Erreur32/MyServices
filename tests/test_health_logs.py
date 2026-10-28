"""Biggest logs (health.py collect_big_logs): files of /var/log and journal size, read from the command output.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import health  # noqa: E402


class BigLogs(unittest.TestCase):
    def test_files_and_journal(self):
        out = "3145728000 /var/log/big.log\n20971520 /var/log/syslog\nnot a line\n---\nArchived and active journals take up 1.5G in the file system.\n"
        got = health.collect_big_logs(lambda cmd, timeout=15: (0, out))
        self.assertEqual(got, {"available": True, "files": [{"path": "/var/log/big.log", "mb": 3000}, {"path": "/var/log/syslog", "mb": 20}], "journal_mb": 1536})

    def test_unavailable_when_command_fails(self):
        self.assertFalse(health.collect_big_logs(lambda cmd, timeout=15: (1, ""))["available"])


if __name__ == "__main__":
    unittest.main()
