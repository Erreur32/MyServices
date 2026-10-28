"""Progression de l'assistant côté serveur : validée à la lecture et à l'écriture."""
import json
import tempfile
import unittest
from pathlib import Path

from msv.core import assistant_state as st


class State(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "state" / "assistant.json"

    def tearDown(self):
        self.dir.cleanup()

    def test_never_used(self):
        self.assertIsNone(st.load(self.path))
        self.assertFalse(st.finished(None))

    def test_save_then_load(self):
        got = st.save(self.path, {"current": "access", "done": ["welcome", "machine"], "skipped": ["network"], "host": "192.168.1.10"})
        self.assertEqual(got, {"current": "access", "done": ["welcome", "machine"], "skipped": ["network"], "host": "192.168.1.10", "accepted": []})
        self.assertEqual(st.load(self.path), got)
        self.assertFalse(self.path.with_name("assistant.json.tmp").exists())   # no leftover temporary file

    def test_garbage_is_cleaned(self):
        got = st.clean({"current": "tools", "done": ["welcome", "welcome", "inconnue", 3], "skipped": ["welcome", "alerts"], "host": "pas une ip"})
        self.assertEqual(got, {"current": "tools", "done": ["welcome"], "skipped": ["alerts"], "host": "", "accepted": []})   # a done step is not also skipped
        for bad in (None, "x", [], {"current": "nope"}, {"done": ["welcome"]}):
            self.assertEqual(st.clean(bad), {"current": "welcome", "done": [], "skipped": [], "host": "", "accepted": []})

    def test_unreadable_file(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("pas du json", encoding="utf-8")
        self.assertIsNone(st.load(self.path))
        self.path.write_text(json.dumps({"current": "inconnue"}), encoding="utf-8")
        self.assertEqual(st.load(self.path)["current"], "welcome")

    def test_host_must_be_an_address(self):
        self.assertEqual(st.clean({"current": "machine", "host": "../../etc"})["host"], "")
        self.assertEqual(st.clean({"current": "machine", "host": "fe80::1"})["host"], "fe80::1")

    def test_accepted_machines_are_addresses_without_duplicates(self):
        got = st.clean({"current": "access", "accepted": ["192.168.1.5", "192.168.1.5", "pas une ip", 3, None, "fe80::2", "../x"]})
        self.assertEqual(got["accepted"], ["192.168.1.5", "fe80::2"])
        self.assertEqual(st.clean({"current": "access", "accepted": "192.168.1.5"})["accepted"], [])   # not a list
        many = st.clean({"current": "access", "accepted": [f"10.0.{i // 250}.{i % 250 + 1}" for i in range(900)]})["accepted"]
        self.assertEqual(len(many), st.MAX_ACCEPTED)

    def test_finished(self):
        self.assertFalse(st.finished({"current": "alerts", "done": ["welcome"], "skipped": []}))
        self.assertTrue(st.finished({"current": "alerts", "done": list(st.STEPS[:3]), "skipped": list(st.STEPS[3:])}))


if __name__ == "__main__":
    unittest.main()
