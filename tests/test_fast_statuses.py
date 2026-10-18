"""fast.statuses_missing: the state of the connectors read only by the light reading (Beszel), for the settings cards."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fast  # noqa: E402


class Missing(unittest.TestCase):
    live = {"sources": {"beszel/beszel": {"ok": True, "status": {"10.0.0.2": {}, "10.0.0.3": {}}, "total": 5, "version": "0.12.1"},
                        "mynetwork/mynetwork": {"ok": True}, "proxmox/pve": {"ok": False, "error": "injoignable (timed out)"}}}

    def test_only_what_the_collection_does_not_list(self):
        got = fast.statuses_missing(self.live, {("mynetwork", "mynetwork")})
        self.assertEqual([(r["type"], r["name"], r["ok"], r["message"]) for r in got],
                         [("beszel", "beszel", True, "2 système(s)"), ("proxmox", "pve", False, "injoignable (timed out)")])

    def test_followed_systems_are_counted_for_the_tag(self):
        got = fast.statuses_missing(self.live, set())
        self.assertEqual([r["found"] for r in got if r["type"] == "beszel"], [[{"name": "systèmes", "count": 5}]])
        self.assertEqual([r["version"] for r in got if r["type"] == "beszel"], ["0.12.1"])

    def test_nothing_without_a_light_reading(self):
        self.assertEqual(fast.statuses_missing({}, set()), [])


try:
    import api
except ModuleNotFoundError:   # FastAPI absent outside the image
    api = None


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class WithTest(unittest.TestCase):
    row = {"type": "beszel", "name": "b", "ok": True, "message": "OK", "version": None, "found": []}
    test = {"at": 100.0, "ok": True, "message": "OK", "version": "0.12.1", "version_tested": True, "found": [{"name": "systèmes", "count": 3}]}

    def test_a_newer_test_gives_the_version_and_the_tags(self):
        got = api._with_test(self.row, self.test, 50.0)
        self.assertEqual((got["version"], got["found"]), ("0.12.1", self.test["found"]))

    def test_an_older_test_leaves_a_complete_row_alone(self):
        full = {**self.row, "version": "0.1"}
        self.assertEqual(api._with_test(full, self.test, 200.0), full)
        self.assertEqual(api._with_test(self.row, None, 0.0), self.row)


if __name__ == "__main__":
    unittest.main()
