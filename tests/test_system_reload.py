"""system.reload_config / after_import: the settings are read again without a restart, then the tasks run one after the other.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import system  # noqa: E402


def fake_core(schedule=None):
    core = mock.Mock()
    core.CFG = {"schedule": schedule or {}, "old": 1}
    core.LOCK = threading.Lock()
    core.DEFAULTS_AT = {"collect": ("c.py", "0,15,30,45 *", 900), "watch": ("w.py", "5,20,35,50 *", 300)}
    core.TASKS = {"collect": {"fixed": False, "minutes": {0}, "hours": None, "at": "0 *"}, "watch": {"fixed": True, "minutes": {5}, "hours": None, "at": "5 *"}}
    core.parse_at = lambda spec: ({int(m) for m in spec.split()[0].split(",")}, None)
    core.enabled = lambda name: name != "watch"
    return core


class Reload(unittest.TestCase):
    def test_config_is_read_again_and_schedules_applied(self):
        core = fake_core()
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "config.json"
            f.write_text(json.dumps({"schedule": {"collect": "10,40 *", "watch": "1 *"}}))
            with mock.patch.dict(os.environ, {"MYSERVICES_CONFIG": str(f)}):
                self.assertTrue(system.reload_config(core))
        self.assertEqual(core.CFG["schedule"]["collect"], "10,40 *")
        self.assertNotIn("old", core.CFG)
        self.assertEqual((core.TASKS["collect"]["at"], core.TASKS["collect"]["minutes"]), ("10,40 *", {10, 40}))
        self.assertEqual(core.TASKS["watch"]["at"], "5 *")   # fixed by the environment: left alone

    def test_unreadable_config_changes_nothing(self):
        core = fake_core()
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "config.json"
            f.write_text("{not json")
            with mock.patch.dict(os.environ, {"MYSERVICES_CONFIG": str(f)}):
                self.assertFalse(system.reload_config(core))
        self.assertEqual(core.CFG["old"], 1)

    def test_after_import_runs_the_enabled_tasks_and_tells_when_a_restart_is_needed(self):
        core = fake_core()
        with mock.patch.object(system, "reload_config", return_value=True):
            out = system.after_import(core, ["settings", "machines"])
        core.run_chain.assert_called_once_with(["collect", "health"], "après un import")   # « watch » is off in this fake core
        self.assertEqual(out, {"reloaded": True, "restart": False})
        with mock.patch.object(system, "reload_config", return_value=True) as rc:
            out = system.after_import(core, ["settings", "secrets"])
        rc.assert_not_called()   # the key is read once at the start
        self.assertEqual(out, {"reloaded": False, "restart": True})
        with mock.patch.object(system, "reload_config", return_value=False):
            self.assertTrue(system.after_import(core, ["settings"])["restart"])
        self.assertFalse(system.after_import(core, ["machines"])["restart"])


if __name__ == "__main__":
    unittest.main()
