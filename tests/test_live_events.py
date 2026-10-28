"""Event stream for the page (live_events.py): a change is published once to every open stream, the body carries the current
state first, then the events, then heartbeats; nobody listening means no comparison at all.

  python3 -m unittest discover -s tests
"""
import queue
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.core import live_events  # noqa: E402


class Stream(unittest.TestCase):
    def test_watch_publishes_changes_only(self):
        q = live_events.subscribe()
        self.addCleanup(live_events.unsubscribe, q)
        value = {"n": 1}
        src = {"status": lambda: value, "broken": lambda: 1 / 0}
        last = live_events.watch(src, once=True)          # baseline: nothing published
        self.assertTrue(q.empty())
        last = live_events.watch(src, once=True, last=last)
        self.assertTrue(q.empty())                        # unchanged: nothing
        value["n"] = 2
        last = live_events.watch(src, once=True, last=last)
        self.assertEqual(q.get_nowait(), ("status", {"n": 2}))
        self.assertNotIn("broken", last)

    def test_body(self):
        q = live_events.subscribe()
        q.put(("tasks", {"collect": {"running": True}}))
        live_events.HEARTBEAT_S = 0.01
        body = live_events.stream(q, {"status": {"running": False}})
        self.assertEqual(next(body), "retry: 3000\n\n")
        self.assertEqual(next(body), 'event: status\ndata: {"running": false}\n\n')
        self.assertEqual(next(body), 'event: tasks\ndata: {"collect": {"running": true}}\n\n')
        self.assertEqual(next(body), ": ping\n\n")
        body.close()
        self.assertEqual(live_events.subscribers(), 0)   # closed by the client: unsubscribed

    def test_full_queue_drops_the_event(self):
        q = live_events.subscribe()
        self.addCleanup(live_events.unsubscribe, q)
        for i in range(live_events.QUEUE_MAX + 5):
            live_events.publish("status", i)
        self.assertEqual(q.qsize(), live_events.QUEUE_MAX)
