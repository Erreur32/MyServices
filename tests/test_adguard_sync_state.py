"""myservices.adguard_sync_state: an error of the sync log only counts until a later sync succeeds; the interval follows the latest runs.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import config  # noqa: E402

# CI has no /config/services-meta.json and importing myservices reads it: the example stands in, for the import only (the global config is left as it was)
with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    import myservices  # noqa: E402


def done(ts):
    return f'{ts}\tINFO\tsync\tsync/sync.go:309\tSync done\t{{"from": "10.0.0.1:8448", "to": "10.0.0.2:8448", "duration": "1s"}}'


ERR = '{}\tERROR\tsync\tsync/sync.go:204\tError getting parental status\t{{"error": "404"}}'


class SyncState(unittest.TestCase):
    def state(self, lines):
        out = SimpleNamespace(returncode=0, stdout="\n".join(lines) + "\n", stderr="")
        with mock.patch.object(myservices.subprocess, "run", return_value=out), mock.patch.object(myservices, "_on", return_value=["x"]):
            return myservices.adguard_sync_state("srv", "sync")

    def test_old_error_closed_by_a_later_success(self):
        s = self.state([done("2026-10-17T06:00:01.000+0200"), ERR.format("2026-10-17T07:02:33.000+0200"), done("2026-10-17T08:00:01.000+0200")])
        self.assertEqual((s["errors_24h"], s["errors_open"]), (1, 0))
        self.assertIn("parental status", s["last_error"])

    def test_error_after_the_last_success_stays_open(self):
        s = self.state([done("2026-10-17T06:00:01.000+0200"), ERR.format("2026-10-17T07:02:33.000+0200")])
        self.assertEqual((s["errors_24h"], s["errors_open"]), (1, 1))

    def test_no_error(self):
        s = self.state([done("2026-10-17T06:00:01.000+0200")])
        self.assertEqual((s["errors_24h"], s["errors_open"], s["last_error"]), (0, 0, None))

    def test_interval_follows_the_latest_runs(self):
        lines = [done(f"2026-10-17T{h:02d}:00:01.000+0200") for h in (2, 4, 6, 8, 10, 12)] + [done(f"2026-10-17T20:{m:02d}:01.000+0200") for m in range(0, 60, 5)]
        self.assertEqual(self.state(lines)["interval_min"], 5)


class ErrorState(unittest.TestCase):
    def test_unreadable_time_counts_as_open(self):
        self.assertEqual(myservices._error_state([(None, "x")], [])["errors_open"], 1)


if __name__ == "__main__":
    unittest.main()
