"""server.py: what follows a task that ended well, the pulse of the services and the quick recheck. No network, no thread, no real task.

  À lancer dans l'image : python3 -m unittest tests.test_server_pulses
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import msv.collect  # noqa: E402
from msv.api import server  # noqa: E402

IP = "192.0.2.10"
TARGET = f"{IP}:8080"
ROW = {"type": "npm", "id": 7, "ip": IP, "port": 8080, "enabled": True, "web": "up", "backend": {"up": True}}


class AfterSuccess(unittest.TestCase):
    STEPS = ("keep_availability", "build_map", "keep_history", "schedule_recheck", "keep_metrics")

    def ran(self, task: str) -> set[str]:
        with mock.patch.object(server, "threading") as threads:
            mocks = {name: mock.patch.object(server, name).start() for name in self.STEPS}
            self.addCleanup(mock.patch.stopall)
            server._after_success(task)
        self.started = threads.Thread.call_count
        return {name for name, m in mocks.items() if m.called}

    def test_collect_keeps_availability_and_builds_the_map(self):
        self.assertEqual(self.ran("collect"), {"keep_availability", "build_map"})
        self.assertEqual(self.started, 2)   # automatic backup and AdGuard

    def test_watch_keeps_history_and_schedules_the_recheck(self):
        self.assertEqual(self.ran("watch"), {"keep_history", "schedule_recheck"})

    def test_health_keeps_history_metrics_and_the_map(self):
        self.assertEqual(self.ran("health"), {"keep_history", "keep_metrics", "build_map"})

    def test_a_task_with_no_follow_up_does_nothing(self):
        self.assertEqual(self.ran("other"), set())


class WithCollection(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.web = Path(tmp.name)
        patcher = mock.patch.object(server, "WEB", self.web)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, data: dict) -> None:
        (self.web / server.DATA_FILE).write_text(json.dumps(data), encoding="utf-8")


class LastCollection(WithCollection):
    def test_reads_the_file(self):
        self.write({"generated": "g1"})
        self.assertEqual(server.last_collection(), {"generated": "g1"})

    def test_missing_or_broken_file_gives_nothing(self):
        self.assertEqual(server.last_collection(), {})
        (self.web / server.DATA_FILE).write_text("{", encoding="utf-8")
        self.assertEqual(server.last_collection(), {})

    def test_machines_switched_off_are_not_pinged(self):
        self.write({"machine_list": [{"ip": IP}, {"ip": "192.0.2.11", "disabled": True}, {"name": "no address"}]})
        self.assertEqual(server.pulse_ips(), [IP])


class PortsPass(WithCollection):
    def setUp(self):
        super().setUp()
        for target, value in (("agent_listening", {}), ("keep_pulse_availability", None)):
            patcher = mock.patch.object(server, target, return_value=value)
            setattr(self, target, patcher.start())
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(server.PORTS, "tick", return_value=[TARGET])
        self.tick = patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_followed_port_is_tried_and_kept(self):
        self.write({"hosts": [ROW]})
        self.assertTrue(server.ports_pass(60))
        self.tick.assert_called_once_with([TARGET])
        self.keep_pulse_availability.assert_called_once_with(server.PORTS, {TARGET: [("svc:npm:7", IP)]}, 60)

    def test_period_zero_tries_nothing(self):
        self.write({"hosts": [ROW]})
        self.assertFalse(server.ports_pass(0))
        self.tick.assert_not_called()

    def test_a_row_of_a_silent_agent_is_not_probed(self):
        self.write({"hosts": [{**ROW, "by_agent": True}]})
        self.assertFalse(server.ports_pass(60))
        self.tick.assert_not_called()

    def test_a_row_of_a_fresh_agent_uses_its_report(self):
        self.write({"hosts": [{**ROW, "by_agent": True}]})
        self.agent_listening.return_value = {IP: {8080}}
        self.assertTrue(server.ports_pass(60))
        self.assertEqual(server.AGENT_PORTS, {TARGET: True})

    def test_keys_leave_redirects_and_dead_rows_out(self):
        rows = [ROW, {**ROW, "type": "redirect", "id": 8}, {**ROW, "type": "dead", "id": 9}]
        self.assertEqual(server.ports_keys(rows), {TARGET: [("svc:npm:7", IP)]})


class KeepPulseAvailability(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules, {"msv.core.auth": mock.Mock()})   # needs argon2, in the image only
        patcher.start()
        self.addCleanup(patcher.stop)

    def kept(self, state: dict, machine: dict) -> dict:
        pulse = mock.Mock(state={TARGET: state})
        with mock.patch.dict(server.PULSE.state, {IP: machine}, clear=True), mock.patch("msv.collect.availability.record") as record:
            server.keep_pulse_availability(pulse, {TARGET: [("svc:npm:7", IP)]}, 60)
        return record.call_args.args[1]

    def test_a_service_that_answers_is_recorded(self):
        self.assertEqual(self.kept({"ping": True, "began": 5}, {"ping": True}), {"svc:npm:7": (True, 5)})

    def test_a_service_down_on_a_machine_up_is_recorded(self):
        self.assertEqual(self.kept({"ping": False, "began": 5}, {"ping": True}), {"svc:npm:7": (False, 5)})

    def test_a_service_down_with_its_machine_is_left_to_the_machine(self):
        self.assertEqual(self.kept({"ping": False, "began": 5}, {"ping": False}), {})

    def test_a_database_error_does_not_stop_the_pulse(self):
        pulse = mock.Mock(state={})
        with mock.patch("msv.collect.availability.record", side_effect=OSError("db")), mock.patch.object(server, "log") as log:
            server.keep_pulse_availability(pulse, {}, 60)
        log.assert_called_once()


class ScheduleRecheck(WithCollection):
    def setUp(self):
        super().setUp()
        patcher = mock.patch.dict(server.RECHECKED, {"gen": None})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_once_per_collection(self):
        self.write({"generated": "g1"})
        with mock.patch.object(server.threading, "Timer") as timer:
            server.schedule_recheck()
            server.schedule_recheck()
        timer.assert_called_once_with(server.recheck.DELAY, server.quick_recheck, args=("g1",))
        timer.return_value.start.assert_called_once()

    def test_no_collection_schedules_nothing(self):
        with mock.patch.object(server.threading, "Timer") as timer:
            server.schedule_recheck()
        timer.assert_not_called()


class QuickRecheck(WithCollection):
    def setUp(self):
        super().setUp()
        self.state = self.web / "watcher.json"
        self.state.write_text(json.dumps({"pending": {"a": {}}}), encoding="utf-8")
        self.write({"generated": "g1"})
        # the real modules need a config file at import
        fakes = {"myservices": mock.Mock(), "watcher": SimpleNamespace(STATE_FILE=self.state, RECHECK_FILE=self.web / "recheck.json")}
        for name, fake in fakes.items():
            patcher = mock.patch.object(msv.collect, name, fake, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(server, "run_chain")
        self.chain = patcher.start()
        self.addCleanup(patcher.stop)

    def run_with(self, todo: dict, still: list[str]) -> mock.Mock:
        with mock.patch.object(server.recheck, "pick", return_value=todo) as pick, mock.patch.object(server.recheck, "run", return_value={}), \
                mock.patch.object(server.recheck, "save"), mock.patch.object(server.recheck, "confirmed", return_value=still), \
                mock.patch.object(server, "enabled", return_value=True), mock.patch.object(server, "log"):
            server.quick_recheck("g1")
        return pick

    def test_nothing_to_try_runs_nothing(self):
        self.run_with({}, [])
        self.chain.assert_not_called()

    def test_a_service_still_down_starts_the_watcher(self):
        self.run_with({"a": {}}, ["a"])
        self.chain.assert_called_once_with(["watch"], "contrôle rapide")

    def test_a_service_back_up_starts_nothing(self):
        self.run_with({"a": {}}, [])
        self.chain.assert_not_called()

    def test_a_newer_collection_ignores_the_old_pending_list(self):
        self.write({"generated": "g2"})
        self.assertEqual(self.run_with({}, []).call_args.args[1], {})

    def test_an_unreadable_state_is_only_logged(self):
        self.state.write_text("{", encoding="utf-8")
        with mock.patch.object(server, "log") as log:
            server.quick_recheck("g1")
        log.assert_called_once()
        self.chain.assert_not_called()


if __name__ == "__main__":
    unittest.main()
