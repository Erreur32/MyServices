"""connectors.process.listening_read: ports whose process name `ss` hides (no root) are counted, not silently lost.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import process  # noqa: E402

SS = ('LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1,fd=6))\n'
      "LISTEN 0 128 0.0.0.0:3000 0.0.0.0:*\n"
      "LISTEN 0 128 0.0.0.0:111 0.0.0.0:*\n")


class Hidden(unittest.TestCase):
    def test_counts_hidden_ports_not_noise(self):
        with mock.patch.object(process.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=SS, stderr="")):
            ports, hidden = process.listening_read("srv")
        self.assertEqual(list(ports), [80])
        self.assertEqual(hidden, 1)


if __name__ == "__main__":
    unittest.main()
