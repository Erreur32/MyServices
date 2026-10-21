"""State files of the API (api.py _read_json, _write_json): the port error samples kept between two diagnostics.

  À lancer dans l'image (FastAPI) : python3 -m unittest discover -s tests
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    import api
except ImportError:
    api = None


@unittest.skipIf(api is None, "FastAPI absent (tests de l'image)")
class StateJson(unittest.TestCase):
    def test_written_whole_then_read_back(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "state" / "port-errors-samples.json"
            api._write_json(path, [{"mac": "aa", "rx": 3}])
            self.assertEqual(api._read_json(path, []), [{"mac": "aa", "rx": 3}])
            self.assertFalse(path.with_name(path.name + ".tmp").exists())

    def test_missing_or_broken_file_gives_the_default(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "absent.json"
            self.assertEqual(api._read_json(path, []), [])
            path.write_text("{pas du json", encoding="utf-8")
            self.assertEqual(api._read_json(path, {"x": 1}), {"x": 1})

    def test_unwritable_place_costs_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            blocker = Path(d) / "file"
            blocker.write_text("", encoding="utf-8")
            api._write_json(blocker / "sub" / "samples.json", [1])   # parent is a file: OSError swallowed
            self.assertIsNone(api._read_json(blocker / "sub" / "samples.json", None))


if __name__ == "__main__":
    unittest.main()
