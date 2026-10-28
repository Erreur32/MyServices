import unittest

from msv.collect import health


def host(**over):
    base = {"disks": [], "systemd": {"failed": []}, "docker": {"accessible": False}, "kernel": {"has_errors": False},
            "load": {"available": False}, "ssh_auth": {"available": False}, "smart": {"accessible": False}, "temp": {"available": False},
            "res": {"available": False}}
    base.update(over)
    return base


class HostChecks(unittest.TestCase):
    def test_one_level_per_control_and_the_worst_is_the_host_level(self):
        h = host(load={"available": True, "cpu_pct": 95.0}, docker={"accessible": True, "unhealthy": 0, "restarting": 0, "exited": 1},
                 disks=[{"mount": "C:", "used_pct": 91, "warning": True, "critical": True}])
        checks = health.host_checks(h)
        self.assertEqual(checks["load"], "warn")      # Windows: instant CPU above CPU_WARN_PCT
        self.assertEqual(checks["docker"], "warn")    # one container exited counts
        self.assertEqual(checks["disk"], "crit")
        self.assertEqual(checks["smart"], "na")
        self.assertEqual(health.host_level(h), "crit")

    def test_healthy_host_all_ok_or_na(self):
        self.assertTrue(all(v in ("ok", "na") for v in health.host_checks(host()).values()))
        self.assertEqual(health.host_level(host()), "ok")


if __name__ == "__main__":
    unittest.main()
