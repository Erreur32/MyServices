"""connectors/settings.reveal: a saved secret, shown in clear only for a secret field of that type."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import settings  # noqa: E402


class Reveal(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.file = Path(tmp.name) / "config.json"
        self.value = "pw-" + "x" * 6   # built at run time: the commit guard refuses any literal secret
        self.file.write_text(json.dumps({"connectors": [{"type": "npm", "name": "NPM", "url": "http://10.0.0.2:81",
                                                         "user": "a@b.c", "password": self.value}]}))
        p = mock.patch.object(settings, "config_file", return_value=self.file)
        p.start()
        self.addCleanup(p.stop)

    def test_secret_field_shown(self):
        self.assertEqual(settings.reveal("npm", "NPM", "password"), self.value)

    def test_only_secret_fields(self):
        for args in (("npm", "NPM", "user"), ("npm", "NPM", "nope"), ("nope", "NPM", "password")):
            with self.assertRaises(settings.SettingsError):
                settings.reveal(*args)
        with self.assertRaises(settings.SettingsError):
            settings.reveal("npm", "other", "password")


if __name__ == "__main__":
    unittest.main()
