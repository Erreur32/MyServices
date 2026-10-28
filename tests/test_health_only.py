"""health.py --only <ip>: how the machine read is merged with the snapshot of the others.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import health  # noqa: E402

A = {"id": "a", "name": "A · 10.0.0.2", "reachable": True}
B = {"id": "b", "name": "B · 10.0.0.3", "reachable": False}


class MergeOnly(unittest.TestCase):
    def test_the_machine_read_replaces_its_row(self):
        new = {"id": "b", "name": "B · 10.0.0.3", "reachable": True}
        hosts, asleep = health.merge_only([A, B], [], [new], [], "10.0.0.3")
        self.assertEqual([h["id"] for h in hosts], ["a", "b"])
        self.assertTrue(hosts[1]["reachable"])
        self.assertEqual(asleep, [])

    def test_a_machine_no_longer_read_loses_its_stale_row(self):
        hosts, _ = health.merge_only([A, B], [], [], [], "10.0.0.3")
        self.assertEqual([h["id"] for h in hosts], ["a"])

    def test_the_others_and_their_sleepers_are_kept(self):
        sleeper = {"id": "c", "name": "C", "ip": "10.0.0.4"}
        gone = {"id": "d", "name": "D", "ip": "10.0.0.3"}
        hosts, asleep = health.merge_only([A], [sleeper, gone], [], [], "10.0.0.3")
        self.assertEqual(([h["id"] for h in hosts], [a["id"] for a in asleep]), (["a"], ["c"]))


class Awake(unittest.TestCase):
    def test_only_the_systems_beszel_gives_as_up(self):
        besz = {"10.0.0.2": {"status": "up"}, "10.0.0.3": {"status": "down"}, "10.0.0.4": {"status": "paused"}, "10.0.0.5": None}
        self.assertEqual(health.awake_ips(besz), {"10.0.0.2"})


if __name__ == "__main__":
    unittest.main()
