"""watcher.py : alerte « connecteur en panne » confirmée sur CONFIRM_RUNS passages, puis « rétabli ».

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import watcher  # noqa: E402


def data(ok):
    return {"connectors": [{"type": "beszel", "name": "hub", "ok": ok, "message": "OK" if ok else "HTTP 400 : Failed to authenticate."}]}


class Connectors(unittest.TestCase):
    def run_seq(self, seq):
        prev, pending, out = watcher.connector_snaps(data(seq[0])), {}, []
        for ok in seq[1:]:
            cur = watcher.connector_snaps(data(ok))
            ev, pending = watcher.diff_connectors(prev, cur, pending)
            out.append([e["kind"] for e in ev])
            prev = cur
        return out

    def test_confirmed_failure_then_recovery(self):
        self.assertEqual(watcher.CONFIRM_RUNS, 2)
        self.assertEqual(self.run_seq([True, False, False, False, True, True]), [[], ["connecteur"], [], [], ["connecteur_ok"]])

    def test_single_blip_ignored(self):
        self.assertEqual(self.run_seq([True, False, True, True]), [[], [], []])

    def test_detail_is_the_connector_message(self):
        prev = watcher.connector_snaps(data(True))
        ev, p = watcher.diff_connectors(prev, watcher.connector_snaps(data(False)), {})
        ev, _ = watcher.diff_connectors(prev, watcher.connector_snaps(data(False)), p)
        self.assertEqual(ev[0]["detail"], "HTTP 400 : Failed to authenticate.")
        self.assertIn("connecteur", watcher.LABEL)


if __name__ == "__main__":
    unittest.main()
