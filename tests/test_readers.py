"""readers.py: one reader per connector at its own period, shared state reused by the tasks.

  python3 -m unittest discover -s tests
"""
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import readers  # noqa: E402
import connectors.base as cbase  # noqa: E402
from connectors.base import ConnectorError  # noqa: E402


class Fake(cbase.Connector):
    type, label, kinds = "fake", "Fake", ("status",)

    def __init__(self, name, conf=None, fail=False, every=None):
        super().__init__({"name": name, **(conf or {})}, cbase.Context())
        self.fail, self.calls = fail, 0
        if every:
            self.every = every

    def collect(self):
        self.calls += 1
        if self.fail:
            raise ConnectorError("down")
        return {"items": [1, 2, 3]}


def patched(insts):
    return mock.patch.object(readers, "instances", return_value=insts)


def tick(path, now, **kw):
    """A tick at a frozen clock: run_isolated stamps the entries with time.time()."""
    with mock.patch("time.time", return_value=now):
        return readers.tick({}, path, now=now, **kw)


class Period(unittest.TestCase):
    def test_own_minutes_then_type_then_default(self):
        self.assertEqual(cbase.period(Fake("a", {"every": 2}), 300), 120)
        self.assertEqual(cbase.period(Fake("a", every=45), 300), 45)
        self.assertEqual(cbase.period(Fake("a"), 300), 300)
        self.assertEqual(cbase.period(Fake("a", {"every": 0}), 300), 300)   # zero or wrong: the default
        self.assertEqual(cbase.period(Fake("a", {"every": "x"}), 300), 300)
        self.assertEqual(cbase.period(Fake("a", {"every": 100000}), 300), cbase.EVERY_MAX)

    def test_due_when_never_tried_or_period_over(self):
        c = Fake("a", {"every": 1})
        self.assertTrue(readers.due(c, {}, 1000, 300))
        self.assertFalse(readers.due(c, {"fake/a": {"tried": 970}}, 1000, 300))
        self.assertTrue(readers.due(c, {"fake/a": {"tried": 930}}, 1000, 300))
        self.assertTrue(readers.due(Fake("b", fail=True), {"fake/b": {"tried": 600, "ok": False}}, 1000, 300))   # a failure waits for the next period too


class Tick(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "connectors.json"

    def tearDown(self):
        self.tmp.cleanup()

    def test_reads_due_ones_in_parallel_and_merges_the_state(self):
        a, b = Fake("a"), Fake("b", fail=True)
        with patched([a, b]):
            got = tick(self.path, 1000, default=300)
        self.assertEqual([(c.name, st.ok) for c, st in got], [("a", True), ("b", False)])
        state = cbase.load_state(self.path)
        self.assertEqual(state["fake/a"]["last"], {"items": [1, 2, 3]})
        self.assertEqual((state["fake/a"]["message"], state["fake/a"]["found"]), ("OK", [{"name": "items", "count": 3}]))
        self.assertEqual((state["fake/b"]["ok"], state["fake/b"]["failures"], "down" in state["fake/b"]["message"]), (False, 1, True))
        with patched([a, b]):
            self.assertEqual(tick(self.path, 1000 + 100, default=300), [])   # nothing due before the period
            got = tick(self.path, 1000 + 300, default=300)
        self.assertEqual(len(got), 2)
        self.assertEqual(a.calls, 2)

    def test_merge_keeps_the_entries_of_the_other_process(self):
        cbase.save_state(self.path, {"other/x": {"ok": True, "last": 1}})
        with patched([Fake("a")]):
            tick(self.path, 1000)
        self.assertEqual(set(cbase.load_state(self.path)), {"other/x", "fake/a"})
        stale = {"fake/a": {"ok": False, "tried": 1}, "other/x": {"ok": False}}   # a copy loaded long ago
        cbase.merge_state(self.path, stale, ["fake/a"])
        self.assertEqual(cbase.load_state(self.path)["other/x"], {"ok": True, "last": 1})

    def test_recent_reading_reused_by_a_task_with_its_status(self):
        a = Fake("a", {"every": 5})
        with patched([a]):
            tick(self.path, 1000)
        state = cbase.load_state(self.path)
        with mock.patch("time.time", return_value=1000 + 300 + 30):
            data, st = readers.recent(a, state, {"fast_every": 300})
        self.assertEqual((data, st.ok, st.found, st.stale), ({"items": [1, 2, 3]}, True, [{"name": "items", "count": 3}], False))
        with mock.patch("time.time", return_value=1000 + 300 + readers.SLACK + 1):
            self.assertEqual(readers.recent(a, state, {"fast_every": 300}), (None, None))   # too old: the task reads itself
        self.assertEqual(readers.recent(a, state, {"fast_every": 0}), (None, None))   # readers off
        self.assertIsNone(cbase.status_of(Fake("never"), state))

    def test_status_of_a_failed_reading_with_an_old_good_one(self):
        state = {"fake/a": {"ok": False, "tried": 2, "failures": 3, "since": 1, "message": "down", "last": {"items": [1]}, "version": "1.0"}}
        st = cbase.status_of(Fake("a"), state)
        self.assertEqual((st.ok, st.stale, st.failures, st.since, st.message, st.found), (False, True, 3, 1, "down", [{"name": "items", "count": 1}]))

    def test_instances_skips_the_collection_readers_and_dedups(self):
        a, npm, dock = Fake("a"), Fake("npm"), Fake("d", {"ssh": "alias"})
        npm.type, dock.type = "npm", "docker"
        with mock.patch.object(readers.connectors, "instances", side_effect=lambda cfg, kind=None, **_: [a, npm, dock] if kind in ("status", "network") else []):
            self.assertEqual([c.name for c in readers.instances({})], ["a"])

    def test_timeout_is_a_failure_not_a_hang(self):
        slow = Fake("slow")
        ev = threading.Event()
        slow.collect = lambda: ev.wait(5) or {"x": 1}
        with patched([slow]):
            got = readers.tick({}, self.path, timeout=0.05)
        ev.set()
        self.assertFalse(got[0][1].ok)


if __name__ == "__main__":
    unittest.main()
