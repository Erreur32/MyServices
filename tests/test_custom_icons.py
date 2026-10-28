"""custom_icons: imported icons are checked like avatars, kept by content fingerprint, listed, served and removed.

  python3 -m unittest discover -s tests
"""
import base64
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import avatars  # noqa: E402
import custom_icons  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#09f"/></svg>'


class CustomIcons(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = mock.patch.dict("config.CFG", {"state_dir": self.tmp.name})
        p.start()
        self.addCleanup(p.stop)

    def test_ajout_lecture_liste_suppression(self):
        key = custom_icons.add(PNG, "ma box.png")
        self.assertRegex(key, r"^custom-[0-9a-f]{12}$")
        self.assertEqual(custom_icons.get(key), (PNG, "image/png"))
        self.assertEqual(custom_icons.listing(), [{"key": key, "label": "ma box", "mime": "image/png"}])
        self.assertEqual(custom_icons.add(PNG, "renommée"), key)   # same image: one icon, new name
        self.assertEqual([i["label"] for i in custom_icons.listing()], ["renommée"])
        svg = custom_icons.add(SVG)
        self.assertEqual(custom_icons.get(svg)[1], "image/svg+xml")
        self.assertEqual([i["label"] for i in custom_icons.listing()][-1], "Icône importée")
        self.assertTrue(custom_icons.remove(key))
        self.assertIsNone(custom_icons.get(key))
        self.assertFalse(custom_icons.remove(key))

    def test_refus(self):
        for bad in (b"", b"pas une image", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                    b'<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>'):
            with self.assertRaises(avatars.AvatarError):
                custom_icons.add(bad)
        self.assertEqual(custom_icons.listing(), [])

    def test_cles_inconnues_ou_piegees(self):
        for key in ("", "custom-zzz", "../index", "custom-0123456789ab/../x", "custom-0123456789ab"):
            self.assertIsNone(custom_icons.get(key))
            self.assertFalse(custom_icons.remove(key))

    def test_plafond(self):
        with mock.patch.object(custom_icons, "MAX_ICONS", 1):
            custom_icons.add(PNG)
            with self.assertRaises(custom_icons.IconError):
                custom_icons.add(SVG)
            custom_icons.add(PNG, "encore")   # already there: not a new icon

    def test_utilisee(self):
        self.assertTrue(custom_icons.used("custom-0123456789ab", '{"machines": {"10.0.0.1": {"icon": "custom-0123456789ab"}}}'))
        self.assertFalse(custom_icons.used("custom-0123456789ab", '{"machines": {"10.0.0.1": {"icon": "debian"}}}'))


if __name__ == "__main__":
    unittest.main()
