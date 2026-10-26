"""Containers a machine may leave stopped (« stopped_ok » of a machine): even an exit code 1 is then an intended stop, not a failure.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    import health
    import machines_admin
except ImportError:
    health = machines_admin = None

PS = ("web|Up 2 days|nginx:latest\n"
      "koboldcpp|Exited (1) 18 hours ago|koboldcpp-vulkan:v1\n"
      "llamacpp|Exited (0) 30 hours ago|llama:1\n"
      "crashy|Exited (1) 2 hours ago|app:1\n")


def run(cmd, timeout=0):
    return (0, PS) if cmd == health.DOCKER_PS_CMD else (1, "")


@unittest.skipIf(health is None, "health.py needs its dependencies (run in the image)")
class StoppedOk(unittest.TestCase):
    def test_exit_code_one_is_a_failure_by_default(self):
        d = health.collect_docker(run)
        self.assertEqual((d["exited"], health.docker_level(d)), (2, "warn"))
        self.assertEqual({c["name"] for c in d["issues"]}, {"koboldcpp", "crashy"})

    def test_listed_container_is_an_intended_stop(self):
        d = health.collect_docker(run, ["KoboldCpp"])   # names are compared without case
        self.assertEqual([c["name"] for c in d["issues"]], ["crashy"])   # the others still count
        self.assertEqual({c["name"] for c in d["stopped_list"]}, {"koboldcpp", "llamacpp"})
        self.assertEqual(d["total"], 2)

    def test_all_listed_gives_ok(self):
        d = health.collect_docker(run, ["koboldcpp", "crashy"])
        self.assertEqual((d["exited"], health.docker_level(d)), (0, "ok"))

    def test_a_restart_loop_is_never_excused(self):
        loop = lambda cmd, timeout=0: (0, "koboldcpp|Restarting (1) 5 seconds ago|k:1\n") if cmd == health.DOCKER_PS_CMD else (1, "")
        self.assertEqual(health.collect_docker(loop, ["koboldcpp"])["restarting"], 1)

    def test_the_machine_setting_reaches_the_reading(self):
        with tempfile.TemporaryDirectory() as t:
            meta = Path(t) / "meta.json"
            meta.write_text(json.dumps({"machines": {"10.0.0.2": {"name": "Jarvis", "ssh": "jarvis", "stopped_ok": ["koboldcpp"]},
                                                     "10.0.0.3": {"name": "Tower", "ssh": "tower"}}}), encoding="utf-8")
            with mock.patch.dict(health.CFG, {"meta": str(meta)}):
                hosts, _ = health.load_hosts()
        self.assertEqual([h["stopped_ok"] for h in hosts], [["koboldcpp"], []])
        got = health.collect_linux(hosts[0], run)["docker"]
        self.assertEqual([c["name"] for c in got["issues"]], ["crashy"])


@unittest.skipIf(machines_admin is None, "machines_admin.py needs its dependencies (run in the image)")
class StoppedOkSetting(unittest.TestCase):
    def test_cleaned_and_deduplicated(self):
        got = machines_admin._clean({"name": "Jarvis", "stopped_ok": [" koboldcpp ", "koboldcpp", "anna-kokoro"]})
        self.assertEqual(got["stopped_ok"], ["koboldcpp", "anna-kokoro"])
        self.assertNotIn("stopped_ok", machines_admin._clean({"name": "Jarvis", "stopped_ok": []}))

    def test_bad_values_refused(self):
        for bad in ("koboldcpp", ["a b"], ["../x"], [3], [f"c{n}" for n in range(31)]):
            with self.assertRaises(machines_admin.MachineError, msg=str(bad)):
                machines_admin._clean({"name": "Jarvis", "stopped_ok": bad})


@unittest.skipIf(machines_admin is None, "machines_admin.py needs its dependencies (run in the image)")
class MachinePatch(unittest.TestCase):
    """patch() changes some fields and keeps the rest of the record: save() alone takes the whole page record."""
    JARVIS = {"name": "Jarvis", "role": "Ollama, SSH, Docker", "ssh": "jarvis", "icon": "server", "vm": True, "notes": "kept"}

    def run_patch(self, fields, machines=None):
        with tempfile.TemporaryDirectory() as t:
            meta = Path(t) / "meta.json"
            meta.write_text(json.dumps({"machines": machines or {"10.0.0.2": self.JARVIS}, "process_hosts": {}, "extra": []}), encoding="utf-8")
            with mock.patch.object(machines_admin.setup, "META", meta), mock.patch.object(machines_admin, "aliases", return_value=[{"alias": "jarvis"}]), \
                    mock.patch.object(machines_admin, "expire_inventory"):
                got = machines_admin.patch("10.0.0.2", fields)
                return got, json.loads(meta.read_text(encoding="utf-8"))["machines"]["10.0.0.2"]

    def test_one_field_changes_and_the_others_stay(self):
        got, stored = self.run_patch({"stopped_ok": ["koboldcpp"]})
        self.assertEqual(got, stored)
        self.assertEqual({k: stored[k] for k in ("name", "role", "ssh", "icon", "vm", "notes")}, self.JARVIS)
        self.assertEqual(stored["stopped_ok"], ["koboldcpp"])

    def test_null_removes_a_field(self):
        _, stored = self.run_patch({"icon": None, "role": "Ollama"})
        self.assertNotIn("icon", stored)
        self.assertEqual((stored["role"], stored["name"]), ("Ollama", "Jarvis"))

    def test_refusals(self):
        for fields in ({}, {"colour": "red"}, {"stopped_ok": "koboldcpp"}, None):
            with self.assertRaises(machines_admin.MachineError, msg=str(fields)):
                self.run_patch(fields)
        with self.assertRaises(machines_admin.MachineError):   # a machine nobody declared is not created by a patch
            self.run_patch({"role": "x"}, machines={"10.0.0.9": self.JARVIS})
        with self.assertRaises(machines_admin.MachineError):
            machines_admin.patch("not-an-ip", {"role": "x"})


if __name__ == "__main__":
    unittest.main()
