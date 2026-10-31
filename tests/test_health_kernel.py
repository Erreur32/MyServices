"""Kernel errors (health.py collect_kernel_errors): the samples are the most recent lines, not the oldest; a CIFS mount notice is not an error.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from msv.collect import health
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

    NOTICE = ["oct. 26 12:56:47 host kernel: CIFS: VFS: Autodisabling the use of server inode numbers on \\\\10.0.0.6\\home",
              "oct. 26 12:56:47 host kernel: CIFS: VFS: The server doesn't seem to support them properly or the files might be on different servers (DFS)",
              "oct. 26 12:56:47 host kernel: CIFS: VFS: Hardlinks will not be recognized on this mount. Consider mounting with the \"noserverino\" option"]

    def test_cifs_mount_notice_is_not_a_kernel_error(self):
        got = health.collect_kernel_errors(lambda cmd, timeout=0: (0, "\n".join(self.NOTICE)))
        self.assertEqual(got, {"has_errors": False, "samples": []})

    def test_cifs_cleanup_of_an_interrupted_request_is_not_a_kernel_error(self):
        line = "oct. 31 20:08:54 host kernel: CIFS: VFS: \\\\10.0.0.6\\home Close unmatched open for MID:6747387"
        self.assertFalse(health.collect_kernel_errors(lambda cmd, timeout=0: (0, line))["has_errors"])

    def test_a_cifs_network_failure_stays_a_kernel_error(self):
        line = "oct. 31 20:08:54 host kernel: CIFS: VFS: \\\\10.0.0.6 has not responded in 180 seconds. Reconnecting..."
        self.assertTrue(health.collect_kernel_errors(lambda cmd, timeout=0: (0, line))["has_errors"])

    def test_a_real_error_is_kept_beside_the_notice(self):
        real = "oct. 26 13:00:00 host kernel: EXT4-fs error (device sda1): ext4_find_entry:1455: inode #2: comm ls: reading directory lblock 0"
        got = health.collect_kernel_errors(lambda cmd, timeout=0: (0, "\n".join([*self.NOTICE, real])))
        self.assertEqual(got, {"has_errors": True, "samples": [real]})


if __name__ == "__main__":
    unittest.main()
