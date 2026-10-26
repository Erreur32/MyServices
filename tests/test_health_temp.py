"""Processor temperature: a machine's own threshold (temp_warn_c) and an alert only once it stays hot (TEMP_SUSTAIN_S).

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


@unittest.skipIf(health is None, "health.py needs its dependencies (run in the image)")
class TempLevel(unittest.TestCase):
    def test_defaults_without_a_duration(self):
        self.assertEqual([health.temp_level({"celsius": c}) for c in (60, 85, 95)], ["ok", "warn", "crit"])
        self.assertEqual(health.temp_level({"available": False}), "na")

    def test_the_machine_threshold_moves_both_levels(self):
        self.assertEqual([health.temp_level({"celsius": c, "warn_c": 70}) for c in (69, 70, 80)], ["ok", "warn", "crit"])
        self.assertEqual(health.temp_thresholds({"warn_c": True}), (health.TEMP_WARN_C, health.TEMP_CRIT_C))   # a bool is not a threshold

    def test_a_short_peak_is_not_an_alert(self):
        self.assertEqual(health.temp_level({"celsius": 96, "hot_s": health.TEMP_SUSTAIN_S - 1}), "ok")
        self.assertEqual(health.temp_level({"celsius": 96, "hot_s": health.TEMP_SUSTAIN_S}), "crit")


@unittest.skipIf(health is None, "health.py needs its dependencies (run in the image)")
class TrackHeat(unittest.TestCase):
    def test_counts_since_the_first_hot_pass(self):
        h = {"temp": {"available": True, "celsius": 90.0}}
        health.track_heat(h, None, None, 1000.0)
        self.assertEqual((h["temp"]["hot_since"], h["temp"]["hot_s"], h["temp"]["level"], h["temp"]["warn_c"], h["temp"]["crit_c"]),
                         (1000.0, 0, "ok", 85, 95))
        health.track_heat(h, None, 1000.0, 1000.0 + health.TEMP_SUSTAIN_S)
        self.assertEqual((h["temp"]["hot_since"], h["temp"]["hot_s"], h["temp"]["level"]), (1000.0, health.TEMP_SUSTAIN_S, "warn"))

    def test_back_under_the_threshold_forgets(self):
        h = {"temp": {"available": True, "celsius": 70.0, "hot_since": 1.0, "hot_s": 5000}}
        health.track_heat(h, 85, 1.0, 9000.0)
        self.assertNotIn("hot_since", h["temp"])
        self.assertEqual(h["temp"]["level"], "ok")

    def test_the_machine_threshold_reaches_the_reading(self):
        h = {"temp": {"available": True, "celsius": 72.0}}
        health.track_heat(h, 70, 0.0, 10_000.0)
        self.assertEqual((h["temp"]["warn_c"], h["temp"]["crit_c"], h["temp"]["level"]), (70, 80, "warn"))
        self.assertEqual(health.hot_since_of([h | {"id": "a"}, {"id": "b", "temp": {"available": False}}]), {"a": 0.0})

    def test_no_temperature_no_change(self):
        h = {"temp": {"available": False}}
        health.track_heat(h, None, None, 1.0)
        self.assertEqual(h["temp"], {"available": False, "warn_c": 85, "crit_c": 95, "level": "na"})
        health.track_heat({"reachable": False}, None, None, 1.0)   # no temp key: nothing to do

    def test_load_hosts_carries_the_threshold(self):
        with tempfile.TemporaryDirectory() as t:
            meta = Path(t) / "meta.json"
            meta.write_text(json.dumps({"machines": {"10.0.0.2": {"name": "Jarvis", "ssh": "jarvis", "temp_warn_c": 75}}}), encoding="utf-8")
            with mock.patch.dict(health.CFG, {"meta": str(meta)}):
                hosts, _ = health.load_hosts()
        self.assertEqual(hosts[0]["temp_warn_c"], 75)


@unittest.skipIf(machines_admin is None, "machines_admin.py needs its dependencies (run in the image)")
class TempSetting(unittest.TestCase):
    def test_validated_and_removable(self):
        with mock.patch.object(machines_admin, "aliases", return_value=[]):
            self.assertEqual(machines_admin._clean({"name": "x", "temp_warn_c": "75"})["temp_warn_c"], 75)
            self.assertNotIn("temp_warn_c", machines_admin._clean({"name": "x", "temp_warn_c": None}))
            for bad in (40, 120, "hot", True, 7.5):
                with self.assertRaises(machines_admin.MachineError):
                    machines_admin._clean({"name": "x", "temp_warn_c": bad})

    def test_patch_accepts_the_field(self):
        self.assertIn("temp_warn_c", machines_admin.PAGE)


if __name__ == "__main__":
    unittest.main()
