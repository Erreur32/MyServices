"""Per-machine disk and memory alert limits (health.apply_limits, resources_level)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import health  # noqa: E402


def host():
    return {"disks": [{"used_pct": 86, "inode_pct": 5, "critical": False, "warning": True}], "res": {"available": True, "mem_pct": 92}}


class Limits(unittest.TestCase):
    def test_defaults_untouched(self):
        h = host()
        health.apply_limits(h, {})
        self.assertTrue(h["disks"][0]["warning"] and not h["disks"][0]["critical"])
        self.assertNotIn("limits", h)
        self.assertEqual(health.resources_level(h["res"]), "warn")

    def test_own_disk_limits(self):
        h = host()
        health.apply_limits(h, {"disk_warn_pct": 90, "disk_crit_pct": 95})
        self.assertFalse(h["disks"][0]["warning"] or h["disks"][0]["critical"])
        h = host()
        health.apply_limits(h, {"disk_warn_pct": 50, "disk_crit_pct": 85})
        self.assertTrue(h["disks"][0]["critical"])
        self.assertEqual(h["limits"], {"disk_warn_pct": 50, "disk_crit_pct": 85})

    def test_own_memory_limits(self):
        h = host()
        health.apply_limits(h, {"mem_warn_pct": 95})
        self.assertEqual(health.resources_level(h["res"]), "ok")
        health.apply_limits(h, {"mem_warn_pct": 50, "mem_crit_pct": 90})
        self.assertEqual(health.resources_level(h["res"]), "crit")


if __name__ == "__main__":
    unittest.main()
