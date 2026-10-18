"""mailer.py: sending through a fake SMTP server (STARTTLS, SSL, none), readable errors, the reset message."""
import smtplib
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import mailer  # noqa: E402

CFG = {"smtp_host": "smtp.example.test", "smtp_from": "ms@example.test", "page_url": "https://ms.example.test", "smtp_user": "u",
       "smtp_password": "p" * 8}


class FakeSMTP:
    calls: list = []
    fail = None

    def __init__(self, host, port, timeout=None, context=None):
        FakeSMTP.calls.append(("open", type(self).__name__, host, port))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self, context=None):
        FakeSMTP.calls.append(("starttls",))

    def login(self, user, password):
        if FakeSMTP.fail:
            raise FakeSMTP.fail
        FakeSMTP.calls.append(("login", user))

    def send_message(self, msg):
        FakeSMTP.calls.append(("send", msg["To"], msg["From"], msg["Subject"]))


class FakeSSL(FakeSMTP):
    pass


class Last(unittest.TestCase):
    """The outcome of the latest sending is kept: the profile warns when a setting that worked stops working."""

    def test_a_failure_then_a_success_are_remembered(self):
        cfg = {"smtp_host": "h", "smtp_from": "a@b.test", "page_url": "https://x.test"}
        with mock.patch("smtplib.SMTP", side_effect=ConnectionRefusedError):
            with self.assertRaises(mailer.MailError):
                mailer.send(cfg, "to@b.test", "s", "t")
        self.assertFalse(mailer.LAST["ok"])
        self.assertIn("rien n'écoute", mailer.LAST["error"])
        with mock.patch("smtplib.SMTP", FakeSMTP):
            mailer.send(cfg, "to@b.test", "s", "t")
        self.assertEqual((mailer.LAST["ok"], mailer.LAST["error"]), (True, ""))


class Send(unittest.TestCase):
    def setUp(self):
        FakeSMTP.calls, FakeSMTP.fail = [], None
        for p in (mock.patch.object(smtplib, "SMTP", FakeSMTP), mock.patch.object(smtplib, "SMTP_SSL", FakeSSL)):
            p.start()
            self.addCleanup(p.stop)

    def test_starttls_default(self):
        mailer.send(CFG, "a@example.test", "Sujet", "Texte")
        self.assertEqual(FakeSMTP.calls, [("open", "FakeSMTP", "smtp.example.test", 587), ("starttls",), ("login", "u"),
                                          ("send", "a@example.test", "MyServices <ms@example.test>", "Sujet")])

    def test_ssl_and_none(self):
        mailer.send({**CFG, "smtp_security": "ssl"}, "a@example.test", "s", "t")
        self.assertEqual(FakeSMTP.calls[0], ("open", "FakeSSL", "smtp.example.test", 465))
        FakeSMTP.calls = []
        mailer.send({**CFG, "smtp_security": "none", "smtp_port": 25, "smtp_user": ""}, "a@example.test", "s", "t")
        self.assertEqual([c[0] for c in FakeSMTP.calls], ["open", "send"])   # no TLS, no login

    def test_errors_are_readable(self):
        FakeSMTP.fail = smtplib.SMTPAuthenticationError(535, b"bad")
        with self.assertRaisesRegex(mailer.MailError, "refusé"):
            mailer.send(CFG, "a@example.test", "s", "t")
        FakeSMTP.fail = OSError("connexion refusée")
        with self.assertRaisesRegex(mailer.MailError, "envoi impossible"):
            mailer.send(CFG, "a@example.test", "s", "t")
        with self.assertRaisesRegex(mailer.MailError, "non réglé"):
            mailer.send({**CFG, "page_url": ""}, "a@example.test", "s", "t")

    def test_reset_text(self):
        subject, text = mailer.reset_text("https://ms.example.test/", "TOK", "admin", 30)
        self.assertIn("https://ms.example.test/login.html?reset=TOK", text)
        self.assertIn("« admin »", text)
        self.assertIn("30 minutes", text)
        self.assertIn("mot de passe", subject)


if __name__ == "__main__":
    unittest.main()
