"""The web app manifest: valid, and every icon it names exists (Chrome needs 192 and 512 px PNG to offer « Install »)."""
import json
import unittest
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "front" / "public"


class PwaManifestTest(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((PUBLIC / "manifest.webmanifest").read_text(encoding="utf-8"))

    def test_installable_fields(self):
        self.assertEqual(self.manifest["display"], "standalone")
        self.assertTrue(self.manifest["name"] and self.manifest["start_url"])

    def test_icons_exist_and_cover_192_and_512(self):
        sizes = {i["sizes"] for i in self.manifest["icons"]}
        self.assertLessEqual({"192x192", "512x512"}, sizes)
        for icon in self.manifest["icons"]:
            self.assertTrue((PUBLIC / icon["src"].lstrip("/")).is_file(), icon["src"])

    def test_icons_are_served_without_login(self):
        source = (PUBLIC.parent.parent / "msv" / "api" / "common.py").read_text(encoding="utf-8")
        for path in ["/manifest.webmanifest"] + [i["src"] for i in self.manifest["icons"]]:
            self.assertIn(f'"{path}"', source)


if __name__ == "__main__":
    unittest.main()
