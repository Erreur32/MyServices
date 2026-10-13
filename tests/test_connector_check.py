"""connectors/settings.check_saved: the saved settings are tested before the collection reads them."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import settings  # noqa: E402
from connectors.base import Result  # noqa: E402

try:
    from fastapi.testclient import TestClient

    import api
    import auth
    import server
except ImportError:
    api = None

BASE = "/myservices/api/v1"


class CheckSaved(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.file = Path(tmp.name) / "config.json"
        self.file.write_text(json.dumps({"connectors": [{"type": "beszel", "name": "hub", "url": "http://127.0.0.1:1",
                                                         "user": "ro@x", "password": "p" + "w" * 6}]}))
        p = mock.patch.object(settings, "config_file", return_value=self.file)
        p.start()
        self.addCleanup(p.stop)

    def test_unreachable_fails(self):
        ok, msg = settings.check_saved("beszel", "hub")
        self.assertFalse(ok)
        self.assertIn("injoignable", msg)

    def test_passing_test(self):
        with mock.patch("connectors.beszel.Beszel.test", return_value=Result(True, "2 système(s)", "0.21.0")):
            self.assertEqual(settings.check_saved("beszel", "hub"), (True, "2 système(s)"))

    def test_connector_bug_is_readable(self):
        with mock.patch("connectors.beszel.Beszel.test", side_effect=KeyError("x")):
            self.assertEqual(settings.check_saved("beszel", "hub"), (False, "erreur interne du connecteur (détail dans le journal du conteneur)"))

    def test_unknown_instance(self):
        with self.assertRaises(settings.SettingsError):
            settings.check_saved("beszel", "other")


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class SaveAndSwitch(unittest.TestCase):
    """PUT and PATCH: the collection is switched on only once a test of the saved settings passes."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = Path(tmp.name)
        self.file = d / "config.json"
        self.file.write_text(json.dumps({"connectors": []}))
        for p in (mock.patch.object(settings, "config_file", return_value=self.file),
                  mock.patch.object(api, "reread_connector")):
            self.reread = p.start()
            self.addCleanup(p.stop)
        server.STATIC = server.WEB = d
        api.AUTH = True
        api.STORE = auth.Store(d / "myservices.db")
        pw = "long-" + "p" * 12   # built at run time: the commit guard refuses any literal secret
        api.STORE.create_user("admin", pw, "admin")
        self.c = TestClient(api.app, client=("192.168.1.50", 50000))
        self.c.post(BASE + "/login", json={"username": "admin", "password": pw})
        self.h = {"X-CSRF-Token": self.c.cookies["ms_csrf"]}

    def save(self, test, collect=True):
        body = {"name": "hub", "config": {"url": "http://10.0.0.9:8090", "user": "ro@x", "password": "p" + "w" * 6}, "collect": collect}
        with mock.patch.object(settings, "check_saved", return_value=test) as chk:
            r = self.c.put(BASE + "/connectors/settings/beszel", json=body, headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json(), chk

    def test_passing_test_collects(self):
        out, _ = self.save((True, "1 système(s)"))
        self.assertTrue(out["enabled"])
        self.assertEqual(settings.names("beszel"), ["hub"])
        self.reread.assert_called_once()

    def test_failing_test_saves_switched_off(self):
        out, _ = self.save((False, "HTTP 400"))
        self.assertEqual((out["enabled"], out["failed"]), (False, True))
        self.assertNotIn("HTTP 400", out["message"])   # no error text here: the page asks the test route
        self.assertEqual(settings.names("beszel"), [])
        self.assertIsNotNone(settings.get("beszel", "hub"))
        self.reread.assert_not_called()

    def test_save_without_collection_skips_the_test(self):
        out, chk = self.save((True, "ok"), collect=False)
        self.assertFalse(out["enabled"])
        chk.assert_not_called()
        self.assertEqual(settings.names("beszel"), [])

    def test_switch_on_needs_a_passing_test(self):
        self.save((True, "ok"), collect=False)
        url = BASE + "/connectors/settings/beszel/hub"
        with mock.patch.object(settings, "check_saved", return_value=(False, "injoignable")):
            r = self.c.patch(url, json={"enabled": True}, headers=self.h)
        self.assertEqual(r.status_code, 409)
        self.assertIn("injoignable", r.text)
        self.assertEqual(settings.names("beszel"), [])
        with mock.patch.object(settings, "check_saved", return_value=(True, "ok")):
            self.assertEqual(self.c.patch(url, json={"enabled": True}, headers=self.h).status_code, 200)
        self.assertEqual(settings.names("beszel"), ["hub"])


if __name__ == "__main__":
    unittest.main()
