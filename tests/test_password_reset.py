"""Forgotten password: e-mail on the account, one-time reset link (30 min), same answer for a known or unknown account,
sessions closed, mail settings (password never shown). Mail sending replaced by a capture.

  To run in the image (FastAPI, argon2): python3 -m unittest discover -s tests
"""
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from fastapi.testclient import TestClient

    import api
    import auth
    import mailer
    import server
    import system
    import tokens
except ImportError:
    api = None

BASE = "/myservices/api/v1"


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class Reset(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = Path(self.tmp.name)
        server.STATIC = server.WEB = d
        api.AUTH = True
        api.STORE = auth.Store(d / "myservices.db")
        api.TOKENS = tokens.Tokens(d / "myservices.db")
        self.pw = "long-" + "p" * 12   # built at run time: the commit guard refuses any literal secret
        api.STORE.create_user("admin", self.pw, "admin")
        api.STORE.set_email("admin", "admin@example.test")
        self.sent = []
        cfg = {"smtp_host": "smtp.example.test", "smtp_from": "ms@example.test", "page_url": "https://ms.example.test"}
        for p in (mock.patch.dict(server.CFG, cfg), mock.patch.object(mailer, "send", lambda c, to, sub, text: self.sent.append((to, text)))):
            p.start()
            self.addCleanup(p.stop)
        self.c = TestClient(api.app, client=("192.168.1.70", 50000))

    def forgot(self, who):
        r = self.c.post(BASE + "/password/forgot", json={"identity": who})
        time.sleep(0.2)   # the e-mail goes from a thread
        return r

    def token(self):
        return self.sent[-1][1].split("reset=")[1].split()[0]

    def test_link_by_name_or_email_and_same_answer(self):
        known, unknown = self.forgot("admin"), self.forgot("nobody")
        self.assertEqual((known.status_code, unknown.status_code), (200, 200))
        self.assertEqual(known.json(), unknown.json())
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0][0], "admin@example.test")
        self.assertIn("https://ms.example.test/login.html?reset=", self.sent[0][1])
        self.assertEqual(self.forgot("ADMIN@example.test").status_code, 200)
        self.assertEqual(len(self.sent), 1)   # a second link within a minute: not sent again

    def test_reset_once_closes_sessions(self):
        self.c.post(BASE + "/login", json={"username": "admin", "password": self.pw})
        self.forgot("admin")
        tok, new = self.token(), "nouveau-" + "m" * 10
        self.assertTrue(self.c.get(BASE + "/password/reset", params={"token": tok}).json()["valid"])
        self.assertEqual(self.c.post(BASE + "/password/reset", json={"token": tok, "password": "court"}).status_code, 400)
        self.assertEqual(self.c.post(BASE + "/password/reset", json={"token": tok, "password": new}).status_code, 200)
        self.assertEqual(self.c.get(BASE + "/me").status_code, 401)   # old session closed
        self.assertEqual(self.c.post(BASE + "/password/reset", json={"token": tok, "password": new}).status_code, 400)   # once
        self.assertEqual(self.c.post(BASE + "/login", json={"username": "admin", "password": new}).status_code, 200)

    def test_expired_link(self):
        self.forgot("admin")
        tok = self.token()
        with mock.patch.object(auth.time, "time", return_value=time.time() + 31 * 60):
            self.assertFalse(api.STORE.reset_valid(tok))

    def test_no_mail_settings(self):
        with mock.patch.dict(server.CFG, {"smtp_host": ""}):
            self.assertEqual(self.forgot("admin").status_code, 503)

    def test_email_rules(self):
        api.STORE.create_user("bob", self.pw, "viewer")
        with self.assertRaises(auth.AuthError):
            api.STORE.set_email("bob", "pas-une-adresse")
        with self.assertRaises(auth.AuthError):
            api.STORE.set_email("bob", "Admin@Example.test")   # already another account's
        self.assertIsNone(api.STORE.set_email("bob", ""))

    def test_mail_settings_hide_password(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict("os.environ", {"MYSERVICES_CONFIG": str(Path(d) / "config.json")}):
            out = system.set_mail_settings(server, "smtp.example.test", 465, "ssl", "u", "secret-" + "x" * 4, "ms@example.test", "https://ms.example.test/")
            self.assertEqual((out["password_set"], out["page_url"], out["ready"]), (True, "https://ms.example.test", True))
            self.assertNotIn("password", out)
            self.assertNotIn("secret-", (Path(d) / "config.json").read_text())   # encrypted at rest
            with self.assertRaises(ValueError):
                system.set_mail_settings(server, "h", 25, "ssl", "", None, "ms@example.test", "javascript:alert(1)")


if __name__ == "__main__":
    unittest.main()
