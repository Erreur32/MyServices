"""pulse.py: confirmed ping state, the file the page reads, and the watcher events taken from it.

  python3 -m unittest discover -s tests
"""
import json
import socket
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import pulse  # noqa: E402
from msv.collect import watcher  # noqa: E402


class AgentPorts(unittest.TestCase):
    row = {"enabled": True, "ip": "10.0.0.5", "port": 22, "backend": {"up": True}, "web": "none"}

    def test_silent_port_followed_only_when_read_by_the_agent(self):
        self.assertIsNone(pulse.port_of(self.row))
        self.assertEqual(pulse.port_of({**self.row, "by_agent": True}), "10.0.0.5:22")

    def test_state_from_the_report_and_nothing_without_it(self):
        row = {**self.row, "by_agent": True}
        self.assertEqual(pulse.agent_states([row], {"10.0.0.5": {22, 80}}), {"10.0.0.5:22": True})
        self.assertEqual(pulse.agent_states([row], {"10.0.0.5": {80}}), {"10.0.0.5:22": False})
        self.assertEqual(pulse.agent_states([row], {}), {})   # agent silent or no ports section: no state, so no false outage


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


class Contradicted(unittest.TestCase):
    HOSTS = [{"name": "Gamer32 · 10.0.0.2", "reachable": False}, {"name": "NAS · 10.0.0.3", "reachable": True}, {"name": "Box · 10.0.0.4", "reachable": False}]
    STATE = {"10.0.0.2": {"ping": True}, "10.0.0.3": {"ping": True}, "10.0.0.4": {"ping": False}}

    def test_only_a_host_that_pings_but_is_called_unreachable(self):
        tried = {}
        self.assertEqual(pulse.contradicted(self.HOSTS, self.STATE, 600, tried, 1000.0), ["10.0.0.2"])

    def test_a_fresh_snapshot_is_left_alone(self):
        self.assertEqual(pulse.contradicted(self.HOSTS, self.STATE, 30, {}, 1000.0), [])

    def test_retries_are_spaced_more_and_more(self):
        tried, got = {}, []
        for t in range(0, 20000, 300):
            got.append(bool(pulse.contradicted(self.HOSTS, self.STATE, 600, tried, float(t))))
        times = [t * 300 for t, g in enumerate(got) if g]
        self.assertEqual(times[:4], [0, 600, 1800, 4200])   # 10 min, 20 min, 40 min...
        self.assertLessEqual(max(b - a for a, b in zip(times, times[1:])), 7200)

    def test_back_to_normal_forgets_the_machine(self):
        tried = {"10.0.0.2": (0.0, 3)}
        pulse.contradicted([{"name": "Gamer32 · 10.0.0.2", "reachable": True}], self.STATE, 600, tried, 10.0)
        self.assertEqual(tried, {})


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


class PortPulse(unittest.TestCase):
    ROW = {"type": "local", "id": "1", "enabled": True, "ip": "10.0.0.5", "port": 8080, "backend": {"up": True}}

    def test_only_a_port_the_collection_probed_is_followed(self):
        self.assertEqual(pulse.port_of(self.ROW), "10.0.0.5:8080")
        for other in ({"paused": "x"}, {"machine_off": True}, {"stopped": "exited"}, {"enabled": False}, {"backend": {"up": True, "internal": True}},
                      {"backend": {}}, {"ip": None}, {"web": "none"}):
            self.assertIsNone(pulse.port_of({**self.ROW, **other}), other)
        self.assertEqual(pulse.port_of({**self.ROW, "web": "none", "backend": {"up": False}}), "10.0.0.5:8080")   # down: its return is followed

    def test_a_closed_port_is_seen_without_a_wait(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            s.listen()
            target = "127.0.0.1:%d" % s.getsockname()[1]
            self.assertTrue(pulse.port_open(target)[0])
        self.assertEqual(pulse.port_open(target), (False, None))

    def test_a_confirmed_port_change_is_announced_at_once_and_a_5xx_keeps_its_two_runs(self):
        down = watcher.snapshot(self.ROW, {"10.0.0.5:8080": {"ping": False}})
        self.assertEqual((down["status"], down["pulse"]), ("bad", True))
        before = watcher.snapshot(self.ROW)
        self.assertEqual([e["kind"] for e in watcher.diff({"local:1": before}, {"local:1": down}, {})[0]], ["panne"])
        proxy = {**self.ROW, "type": "proxy", "public": {"code": 502}}
        bad = watcher.snapshot(proxy, {"10.0.0.5:8080": {"ping": True}})
        self.assertEqual((bad["status"], bad["pulse"]), ("bad", False))
        ok = watcher.snapshot({**self.ROW, "type": "proxy", "public": {"code": 200}})
        self.assertEqual(watcher.diff({"proxy:1": ok}, {"proxy:1": bad}, {})[0], [])


class LiveSettings(unittest.TestCase):
    def core(self):
        from msv.core import config
        return type("Core", (), {"CFG": {k: config.DEFAULTS[k] for k in ("pulse_every", "pulse_confirm", "ports_every", "fast_every")}})()

    def test_values_are_checked_and_defaults_are_not_written(self):
        from msv.collect import system
        from unittest import mock
        core, written = self.core(), []
        with mock.patch.object(system, "_update_config", side_effect=lambda c, change: (lambda raw: (change(raw), written.append(dict(raw))))({"pulse_every": 99})):
            out = system.set_live(core, {"pulse_every": 15, "pulse_confirm": 3})
            self.assertEqual((core.CFG["pulse_every"], core.CFG["pulse_confirm"], out["values"]["pulse_every"]), (15, 3, 15))
            system.set_live(core, {"pulse_every": 30})   # the default: the key is removed from config.json
            self.assertNotIn("pulse_every", written[-1])
            for bad in ({"pulse_every": 5}, {"pulse_confirm": 0}, {"fast_every": 30}, {"pulse_every": True}, {"pulse_every": "x"}):
                with self.assertRaises(ValueError):
                    system.set_live(core, bad)
            system.set_live(core, {"pulse_every": 0})   # 0 = off is allowed for the pulse and the fast tier
            with self.assertRaises(ValueError):
                system.set_live(core, {"pulse_confirm": 0})


if __name__ == "__main__":
    unittest.main()
