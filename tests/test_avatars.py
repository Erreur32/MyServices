"""avatars.py: images recognised by their content, SVG kept only when it is plain drawing (no script, entity or outside link)."""
import base64
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import avatars  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
OK_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>' \
         b'<circle cx="5" cy="5" r="4" fill="url(#g)"/><use href="#g"/></svg>'


class Check(unittest.TestCase):
    def test_raster_by_content(self):
        self.assertEqual(avatars.check(PNG), "image/png")
        self.assertEqual(avatars.check(b"\xff\xd8\xff\xe0" + b"0" * 10), "image/jpeg")
        self.assertEqual(avatars.check(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp")
        self.assertEqual(avatars.check(b"GIF89a" + b"0" * 10), "image/gif")
        for bad in (b"", b"MZ\x90\x00 an exe", b"<html><script>x</script></html>", b"x" * (avatars.MAX_BYTES + 1)):
            with self.assertRaises(avatars.AvatarError):
                avatars.check(bad)

    def test_plain_svg_kept(self):
        self.assertEqual(avatars.check(OK_SVG), "image/svg+xml")
        self.assertEqual(avatars.check(b'<?xml version="1.0"?>\n' + OK_SVG), "image/svg+xml")

    def test_dangerous_svg_refused(self):
        for bad in (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                    b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
                    b'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
                    b'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
                    b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink"><use x:href="https://evil.example/a.svg#b"/></svg>',
                    b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>',
                    b'<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/a.css);</style></svg>',
                    b'<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.example/x)"/></svg>',
                    b'<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>',
                    b'<svg xmlns="http://www.w3.org/2000/svg"><rect'):
            with self.assertRaises(avatars.AvatarError, msg=bad[:60]):
                avatars.check(bad)

    def test_embedded_image_allowed(self):
        img = b'<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBORw0KGgo="/></svg>'
        self.assertEqual(avatars.check(img), "image/svg+xml")

    def test_data_url_and_version(self):
        raw, mime = avatars.from_data_url("data:image/png;base64," + base64.b64encode(PNG).decode())
        self.assertEqual((raw, mime), (PNG, "image/png"))
        with self.assertRaises(avatars.AvatarError):
            avatars.from_data_url("data:image/png;base64,@@@")
        self.assertEqual(len(avatars.version(PNG)), 12)
        self.assertIsNone(avatars.version(None))


if __name__ == "__main__":
    unittest.main()
