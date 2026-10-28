"""myservices.mark_waiting: a difference between two AdGuard instances waits one adguardhome-sync interval before it counts.

  python3 -m unittest discover -s tests
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from msv.core import config  # noqa: E402

# CI has no /config/services-meta.json and importing myservices reads it: the example stands in, for the import only (the global config is left as it was)
with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    from msv.collect import myservices  # noqa: E402


def report():
    return {"rewrites_diff": [{"domain": "a.example.org", "answer": "10.0.0.1", "enabled": True, "only": "10.0.0.2"}], "user_rules_diff": [{"rule": "||x^", "only": "10.0.0.2"}]}


class Waiting(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = mock.patch.object(myservices, "DNS_DIFF_SEEN", os.path.join(tmp.name, "seen.json"))
        p.start()
        self.addCleanup(p.stop)

    def test_waits_then_counts(self):
        sync = {"10.0.0.2": {"interval_min": 10}}
        r = report()
        myservices.mark_waiting(r, sync, now=1000)
        self.assertTrue(r["rewrites_diff"][0]["waiting"] and r["user_rules_diff"][0]["waiting"])
        r = report()
        myservices.mark_waiting(r, sync, now=1000 + 12 * 60)   # inside interval + grace (13 min)
        self.assertTrue(r["rewrites_diff"][0]["waiting"])
        r = report()
        myservices.mark_waiting(r, sync, now=1000 + 14 * 60)
        self.assertFalse(r["rewrites_diff"][0]["waiting"])
        self.assertEqual(r["rewrites_diff"][0]["since"], 1000)

    def test_without_sync_nothing_waits(self):
        r = report()
        myservices.mark_waiting(r, {}, now=1000)
        self.assertFalse(r["rewrites_diff"][0]["waiting"])

    def test_gone_difference_is_forgotten(self):
        sync = {"10.0.0.2": {"interval_min": 10}}
        myservices.mark_waiting(report(), sync, now=1000)
        gone = {"rewrites_diff": [], "user_rules_diff": []}
        myservices.mark_waiting(gone, sync, now=2000)
        r = report()
        myservices.mark_waiting(r, sync, now=5000)
        self.assertEqual(r["rewrites_diff"][0]["since"], 5000)   # back again: the clock restarts


if __name__ == "__main__":
    unittest.main()
