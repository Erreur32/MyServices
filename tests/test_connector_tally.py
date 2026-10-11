import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from connectors import settings  # noqa: E402


class Tally(unittest.TestCase):
    def test_compte_listes_dictionnaires_et_entiers(self):
        got = settings.tally({"entities": [1, 2, 3], "hosts": {"a": 1}, "unavailable": 4, "_cache": [1], "ok": True, "name": "x"})
        self.assertEqual(got, [{"name": "entities", "count": 3}, {"name": "hosts", "count": 1}, {"name": "unavailable", "count": 4}])

    def test_pas_un_dictionnaire(self):
        self.assertEqual(settings.tally(None), [])

    def test_limite_douze(self):
        self.assertEqual(len(settings.tally({str(i): [1] for i in range(30)})), 12)


if __name__ == "__main__":
    unittest.main()
