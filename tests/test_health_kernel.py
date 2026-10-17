"""Kernel errors (health.py collect_kernel_errors): the samples are the most recent lines, not the oldest.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    import health
except ImportError:
    health = None


@unittest.skipIf(health is None, "health.py needs its dependencies (run in the image)")
class KernelErrors(unittest.TestCase):
    def test_keeps_the_eight_most_recent_lines(self):
        out = "\n".join(f"oct. 17 10:{n:02d}:00 host kernel: error {n}" for n in range(20))
        got = health.collect_kernel_errors(lambda cmd, timeout=0: (0, out))
        self.assertTrue(got["has_errors"])
        self.assertEqual(len(got["samples"]), 8)
        self.assertTrue(got["samples"][-1].endswith("error 19"))
        self.assertTrue(got["samples"][0].endswith("error 12"))

    def test_no_entries_is_clean(self):
        got = health.collect_kernel_errors(lambda cmd, timeout=0: (0, "-- No entries --"))
        self.assertEqual(got, {"has_errors": False, "samples": []})


if __name__ == "__main__":
    unittest.main()
