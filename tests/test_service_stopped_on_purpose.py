"""A service whose container is stopped on purpose (docker_state rule shared with the health reading) is « off »: not probed,
never an alert, and back to normal by itself when the container runs again.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from msv.core import docker_state  # noqa: E402

try:
    from msv.collect import availability
    from msv.core import config
    # CI has no /config/services-meta.json and importing myservices reads it: the example stands in, for the import only
    with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
        from msv.collect import myservices
    from msv.collect import watcher
except ImportError:
    myservices = None


class Rule(unittest.TestCase):
    def test_clean_stops_and_created(self):
        for status in ("Created", "Exited (0) 3 hours ago", "Exited (137) 1 minute ago", "Exited (143) 2 days ago"):
            self.assertTrue(docker_state.intended_stop("web", status), status)

    def test_crash_or_running_is_not_a_wanted_stop(self):
        for status in ("Exited (1) 3 hours ago", "Exited (255) 3 hours ago", "Up 2 days", "Restarting (1) 5 seconds ago", "Dead"):
            self.assertFalse(docker_state.intended_stop("web", status), status)

    def test_listed_name_excuses_any_exit_code_but_not_a_loop(self):
        ok = docker_state.allowed_names(["KoboldCpp"])
        self.assertTrue(docker_state.intended_stop("koboldcpp", "Exited (1) 18 hours ago", ok))
        self.assertFalse(docker_state.intended_stop("other", "Exited (1) 18 hours ago", ok))
        self.assertFalse(docker_state.intended_stop("koboldcpp", "Restarting (1) 5 seconds ago", ok))
        self.assertEqual(docker_state.allowed_names(None), frozenset())


@unittest.skipIf(myservices is None, "needs the app dependencies (run in the image)")
class Rows(unittest.TestCase):
    def row(self, state, name="llamacpp", kind="docker"):
        return {"type": "proxy", "enabled": True, "domains": ["llama.lan"], "ip": "10.0.0.2", "port": 8081,
                "backend": {"up": False, "err": "ConnectionRefusedError"}, "service": {"kind": kind, "name": name, "state": state}}

    def test_flag_follows_the_container_state(self):
        self.assertEqual(myservices.stopped_on_purpose(self.row("Exited (0) 30 hours ago")), "Exited (0) 30 hours ago")
        self.assertEqual(myservices.stopped_on_purpose(self.row("Up 3 days")), "")
        self.assertEqual(myservices.stopped_on_purpose(self.row("Exited (1) 2 hours ago")), "")   # a crash stays a failure
        self.assertEqual(myservices.stopped_on_purpose(self.row("Exited (1) 2 hours ago"), ["LlamaCpp"]), "Exited (1) 2 hours ago")
        self.assertEqual(myservices.stopped_on_purpose(self.row("Exited (0)", kind="process")), "")   # only docker containers
        self.assertEqual(myservices.stopped_on_purpose({"type": "proxy"}), "")

    def test_the_machine_list_comes_from_the_services_meta(self):
        with mock.patch.object(myservices, "META_RAW", {"machines": {"10.0.0.2": {"name": "Jarvis", "stopped_ok": ["llamacpp"]}, "10.0.0.3": {"name": "Tower"}}}):
            self.assertEqual(myservices.machine_stopped_ok("10.0.0.2"), ["llamacpp"])
            self.assertEqual(myservices.machine_stopped_ok("10.0.0.3"), [])
            self.assertEqual(myservices.machine_stopped_ok("10.0.0.9"), [])   # a machine the file does not know

    def test_status_is_off_and_nothing_is_sampled(self):
        down = self.row("Up 3 days")
        self.assertEqual(watcher.status(down), "bad")
        stopped = {**down, "stopped": "Exited (0) 30 hours ago"}
        self.assertEqual(watcher.status(stopped), "off")
        self.assertEqual(availability.points({"hosts": [dict(stopped, id=1)]}), [])
        self.assertEqual(len(availability.points({"hosts": [dict(down, id=1)]})), 1)


if __name__ == "__main__":
    unittest.main()
