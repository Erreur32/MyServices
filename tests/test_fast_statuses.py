"""fast.statuses_missing: the state of the connectors read only by the light reading (Beszel), for the settings cards."""
import json
import sys
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import fast  # noqa: E402


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
    from msv.api import api
    from msv.api import common
    from msv.api.routes import services as routes_services
except ModuleNotFoundError:   # FastAPI absent outside the image
    api = None
    common = routes_services = None


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class WithTest(unittest.TestCase):
    row = {"type": "beszel", "name": "b", "ok": True, "message": "OK", "version": None, "found": []}
    test = {"at": 100.0, "ok": True, "message": "OK", "version": "0.12.1", "version_tested": True, "found": [{"name": "systèmes", "count": 3}]}

    def test_a_newer_test_gives_the_version_and_the_tags(self):
        got = routes_services._with_test(self.row, self.test, 50.0)
        self.assertEqual((got["version"], got["found"]), ("0.12.1", self.test["found"]))

    def test_a_test_is_kept_and_read_back(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d, unittest.mock.patch.dict(common.core.CFG, {"state_dir": d}):
            self.assertEqual(routes_services._tests(), {})
            routes_services.remember_test("beszel", "b", {"ok": True, "message": "OK", "version": "1", "found": [], "extra": "dropped"})
            got = routes_services._tests()["beszel/b"]
            self.assertEqual((got["ok"], got["version"], "extra" in got), (True, "1", False))

    def test_an_older_test_never_hides_a_failure_of_the_collection(self):
        failed = {**self.row, "ok": False, "message": "HTTP 500", "found": []}
        got = routes_services._with_test(failed, {**self.test, "at": 10.0}, 50.0)
        self.assertEqual((got["ok"], got["message"], got["version"]), (False, "HTTP 500", "0.12.1"))

    def test_a_test_made_since_the_save_ends_the_pending_mark(self):
        import tempfile
        from pathlib import Path
        data = {"generated": "1970-01-01T00:02:00+00:00", "connectors": [{"type": "beszel", "name": "b", "ok": True, "message": "old", "found": []}]}
        with tempfile.TemporaryDirectory() as d, unittest.mock.patch.object(routes_services.core, "WEB", Path(d)):
            Path(d, routes_services.core.DATA_FILE).write_text(json.dumps(data))
            with unittest.mock.patch.object(routes_services, "_saved", return_value={"beszel/b": 150.0}):
                with unittest.mock.patch.object(routes_services, "_tests", return_value={}):
                    self.assertTrue(routes_services.last_statuses()[0]["pending"])
                with unittest.mock.patch.object(routes_services, "_tests", return_value={"beszel/b": {**self.test, "at": 160.0, "message": "18 hôtes"}}):
                    got = routes_services.last_statuses()[0]
                    self.assertEqual((got.get("pending"), got["message"]), (None, "18 hôtes"))

    def test_an_older_test_leaves_a_complete_row_alone(self):
        full = {**self.row, "version": "0.1"}
        self.assertEqual(routes_services._with_test(full, self.test, 200.0), full)
        self.assertEqual(routes_services._with_test(self.row, None, 0.0), self.row)


if __name__ == "__main__":
    unittest.main()
