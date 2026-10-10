"""history.py : recopie des events.json dans SQLite sans doublon, filtres, comptes par jour, rétention.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import history  # noqa: E402


def iso(dt):
    return dt.astimezone().isoformat(timespec="seconds")


class History(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.db, self.f = d / "h.db", d / "events.json"
        now = datetime.now()
        self.events = [
            {"kind": "panne", "key": "proxy:12", "label": "nas.lan", "machine": "srv", "target": "nas.lan", "detail": "5xx", "ts": iso(now)},
            {"kind": "retabli", "key": "proxy:12", "label": "nas.lan", "machine": "srv", "target": "nas.lan", "ts": iso(now - timedelta(hours=1))},
            {"kind": "nouveau", "key": "local:1", "label": "python3", "machine": "pc", "at": (now - timedelta(days=2)).strftime("%Y-%m-%d %H:%M")},
            {"kind": "panne", "key": "old", "label": "x", "ts": iso(now - timedelta(days=400))},  # au-delà d'un an
            {"kind": "bizarre"},  # sans date : ignoré
            {"kind": "dns", "label": "AdGuard", "ts": iso(now - timedelta(minutes=5))},  # sans clé : pas de doublon
        ]
        self.f.write_text(json.dumps({"events": self.events}))

    def tearDown(self):
        self.tmp.cleanup()

    def test_ingest_dedup_retention(self):
        self.assertEqual(history.ingest(self.db, self.f, "watcher"), 4)  # celui de 400 j n'entre pas
        self.assertEqual(history.ingest(self.db, self.f, "watcher"), 0)  # relu : rien en double
        got = history.query(self.db)
        self.assertEqual([e["kind"] for e in got], ["panne", "dns", "retabli", "nouveau"])
        self.assertEqual(history.ingest(self.db, Path(self.tmp.name) / "absent.json", "health"), 0)

    def test_filters_and_per_day(self):
        history.ingest(self.db, self.f, "watcher")
        self.assertEqual([e["label"] for e in history.query(self.db, kind="panne")], ["nas.lan"])
        self.assertEqual([e["machine"] for e in history.query(self.db, machine="pc")], ["pc"])
        self.assertEqual(len(history.query(self.db, since=time.time() - 3 * 3600)), 3)
        self.assertEqual([e["label"] for e in history.query(self.db, q="nas")], ["nas.lan", "nas.lan"])
        days = history.per_day(self.db, 30)
        self.assertEqual(sum(d["n"] for d in days), 4)
        self.assertEqual({d["kind"] for d in days}, {"panne", "retabli", "nouveau", "dns"})


if __name__ == "__main__":
    unittest.main()
