"""Secrets chiffrés de config.json (secrets_store.py) : chiffrement, lecture transparente par config.load,
clé absente ou changée refusée clairement.

  python3 -m unittest discover -s tests   (cryptography requise : image, ou hôte qui l'a)
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    import cryptography  # noqa: F401

    import secrets_store
except ImportError:
    secrets_store = None


@unittest.skipIf(secrets_store is None, "cryptography absente")
class Secrets(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.f = Path(self.tmp.name) / "config.json"
        self.cfg = {"public_url": "http://x/", "telegram_token": "123:ABC", "telegram_chat_id": "42",
                    "npm": [{"name": "lan", "url": "http://n:81", "user": "a@b", "password": "motdepasse"}],
                    "connectors": [{"type": "uptime-kuma", "name": "k", "url": "http://k", "api_key": "uk_1"}]}

    def tearDown(self):
        self.tmp.cleanup()

    def test_encrypt_then_load(self):
        out, n = secrets_store.encrypt_all(self.cfg, self.f)
        self.assertEqual(n, 3)
        raw = json.dumps(out)
        for clear in ("123:ABC", "motdepasse", "uk_1"):
            self.assertNotIn(clear, raw)
        self.assertEqual((out["public_url"], out["telegram_chat_id"], out["npm"][0]["user"]), ("http://x/", "42", "a@b"))
        self.assertEqual(oct((self.f.parent / "secret.key").stat().st_mode & 0o777), "0o600")
        self.f.write_text(json.dumps(out))
        import config
        os.environ["MYSERVICES_CONFIG"] = str(self.f)
        try:
            cfg = config.load()
        finally:
            del os.environ["MYSERVICES_CONFIG"]
        self.assertEqual((cfg["telegram_token"], cfg["npm"][0]["password"], cfg["connectors"][0]["api_key"]),
                         ("123:ABC", "motdepasse", "uk_1"))
        again, n2 = secrets_store.encrypt_all(out, self.f)
        self.assertEqual((n2, again), (0, out))  # déjà chiffré : rien ne change

    def test_missing_or_changed_key(self):
        out, _ = secrets_store.encrypt_all(self.cfg, self.f)
        (self.f.parent / "secret.key").unlink()
        with self.assertRaises(secrets_store.SecretError) as e:
            secrets_store.decrypt_all(out, self.f)
        self.assertIn("absent", str(e.exception))
        secrets_store.encrypt_all({"telegram_token": "x"}, self.f)  # nouvelle clé
        with self.assertRaises(secrets_store.SecretError) as e:
            secrets_store.decrypt_all(out, self.f)
        self.assertIn("clé", str(e.exception))

    def test_plain_config_untouched(self):
        self.assertIs(secrets_store.decrypt_all(self.cfg, self.f), self.cfg)
        self.assertFalse((self.f.parent / "secret.key").exists())


if __name__ == "__main__":
    unittest.main()
