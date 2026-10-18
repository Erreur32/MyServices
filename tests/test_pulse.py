"""pulse.py: confirmed ping state, the file the page reads, and the watcher events taken from it.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pulse  # noqa: E402
import watcher  # noqa: E402


class Confirm(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "pulse.json"
        self.up = {"10.0.0.2": True}
        self.p = pulse.Pulse(self.path, confirm=2, probe=lambda ip: (self.up[ip], 1.5 if self.up[ip] else None))

    def tearDown(self):
        self.dir.cleanup()

    def test_first_sight_is_adopted_silently(self):
        self.assertEqual(self.p.tick(["10.0.0.2"]), [])
        self.assertTrue(self.p.state["10.0.0.2"]["ping"])

    def test_a_lost_packet_is_not_an_outage(self):
        self.p.tick(["10.0.0.2"])
        self.up["10.0.0.2"] = False
        self.assertEqual(self.p.tick(["10.0.0.2"]), [])
        self.up["10.0.0.2"] = True
        self.assertEqual(self.p.tick(["10.0.0.2"]), [])
        self.assertTrue(self.p.state["10.0.0.2"]["ping"])

    def test_two_pulses_in_a_row_confirm_then_the_way_back(self):
        self.p.tick(["10.0.0.2"])
        self.up["10.0.0.2"] = False
        self.p.tick(["10.0.0.2"])
        self.assertEqual(self.p.tick(["10.0.0.2"]), ["10.0.0.2"])
        self.assertFalse(self.p.state["10.0.0.2"]["ping"])
        self.up["10.0.0.2"] = True
        self.p.tick(["10.0.0.2"])
        self.assertEqual(self.p.tick(["10.0.0.2"]), ["10.0.0.2"])

    def test_file_and_forgotten_machines(self):
        self.up["10.0.0.3"] = True
        self.p.tick(["10.0.0.2", "10.0.0.3"])
        self.p.tick(["10.0.0.2"])
        doc = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(list(doc["machines"]), ["10.0.0.2"])
        self.assertEqual(doc["machines"]["10.0.0.2"]["ms"], 1.5)
        self.assertEqual(list(pulse.read(self.path)), ["10.0.0.2"])

    def test_an_old_file_is_ignored(self):
        self.p.tick(["10.0.0.2"], now=time.time() - 3600)
        self.assertEqual(pulse.read(self.path), {})
        self.assertEqual(pulse.read(self.path.with_name("missing.json")), {})


class OwedTasks(unittest.TestCase):
    def test_what_cannot_start_is_asked_again(self):
        owed, started = pulse.Owed(), []
        owed.add(["10.0.0.2", "10.0.0.3"])
        busy = {"watch": True}
        run_w = lambda: (started.append("watch") or True) if not busy["watch"] else False
        run_h = lambda ip: started.append(ip) or True
        owed.settle(run_w, run_h, True, True)
        self.assertEqual((started, owed.watch, owed.health), (["10.0.0.2"], True, ["10.0.0.3"]))   # watcher busy, one health per pulse
        busy["watch"] = False
        owed.settle(run_w, run_h, True, True)
        self.assertEqual((started, owed.watch, owed.health), (["10.0.0.2", "watch", "10.0.0.3"], False, []))

    def test_a_task_that_is_off_is_forgotten(self):
        owed = pulse.Owed()
        owed.add(["10.0.0.2"])
        owed.settle(lambda: True, lambda ip: True, False, False)
        self.assertEqual((owed.watch, owed.health), (False, []))

    def test_no_change_owes_nothing(self):
        owed = pulse.Owed()
        owed.add([])
        self.assertEqual((owed.watch, owed.health), (False, []))


class WatcherTakesThePulse(unittest.TestCase):
    DATA = {"machine_list": [{"ip": "10.0.0.2", "name": "pc", "ping": True, "ssh": None},
                             {"ip": "10.0.0.3", "name": "nas", "ping": True, "off": True, "ssh": None}]}

    def test_pulse_ping_wins_and_needs_no_second_confirmation(self):
        prev = watcher.machine_snaps(self.DATA)
        cur = watcher.machine_snaps(self.DATA, {"10.0.0.2": {"ping": False}})
        ev, pending = watcher.diff_machines(prev, cur, {})
        self.assertEqual([e["kind"] for e in ev], ["hors_ligne"])
        self.assertEqual(pending, {})

    def test_without_pulse_two_passes_are_still_needed(self):
        data = {"machine_list": [{**self.DATA["machine_list"][0], "ping": False}]}
        prev = watcher.machine_snaps(self.DATA)
        ev, pending = watcher.diff_machines(prev, watcher.machine_snaps(data), {})
        self.assertEqual((ev, len(pending)), ([], 1))

    def test_a_machine_switched_off_on_purpose_never_alerts(self):
        prev = watcher.machine_snaps(self.DATA)
        cur = watcher.machine_snaps(self.DATA, {"10.0.0.3": {"ping": False}})
        self.assertEqual(watcher.diff_machines(prev, cur, {})[0], [])


if __name__ == "__main__":
    unittest.main()
