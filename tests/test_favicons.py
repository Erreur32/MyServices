"""Favicons of the proxied services: only the service itself is contacted, and only real images are kept.

  python3 -m unittest discover -s tests
"""
import sys
import tempfile
import time
import unittest
import urllib.error
from email.message import Message
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from msv.collect import favicons  # noqa: E402

try:
    from fastapi.testclient import TestClient

    from msv.api import api, common, server
    from msv.core import auth, tokens
except ImportError:
    api = None

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 20
ICO = b"\0\0\1\0" + b"x" * 20
HOST = "app.example.test"
ROOT_URL = "http://10.0.0.5:8080"


class Answer:
    def __init__(self, body):
        self.status, self.headers, self.body = 200, {}, body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self, n):
        return self.body[:n]


class Site:
    """An opener answering from a table of url -> body, or -> Location for a redirect; records what was asked"""
    def __init__(self, pages):
        self.pages, self.asked = pages, []

    def open(self, req, timeout):
        self.asked.append(req.full_url)
        hit = self.pages.get(req.full_url)
        if isinstance(hit, str):
            headers = Message()
            headers["Location"] = hit
            raise urllib.error.HTTPError(req.full_url, 302, "Found", headers, None)
        if hit is None:
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", Message(), None)
        return Answer(hit)


def grab(pages):
    site = Site(pages)
    return favicons.fetch(site, "http", "10.0.0.5", 8080, HOST, 1), site


class Links(unittest.TestCase):
    def test_plain_icon_before_touch_icon(self):
        page = b'<link rel="apple-touch-icon" href="/big.png"><link href="/a.ico" rel="shortcut icon"/><link rel="stylesheet" href="/s.css">'
        self.assertEqual(favicons.icon_links(page), ["/a.ico", "/big.png"])

    def test_mask_icon_is_not_an_icon(self):
        self.assertEqual(favicons.icon_links(b'<link rel="mask-icon" href="/m.svg">'), [])


class Kind(unittest.TestCase):
    def test_real_types(self):
        for data, kind in ((PNG, "png"), (ICO, "ico"), (b"GIF89a..", "gif"), (b"\xff\xd8\xff\xe0", "jpg"), (b"RIFF0000WEBPVP8 ", "webp"),
                           (b'\n<?xml version="1.0"?><svg xmlns="x"/>', "svg")):
            self.assertEqual(favicons.kind_of(data), kind)

    def test_a_page_is_not_an_image(self):
        self.assertIsNone(favicons.kind_of(b"<!doctype html><html></html>"))
        self.assertIsNone(favicons.kind_of(b'<?xml version="1.0"?><html/>'))
        self.assertIsNone(favicons.kind_of(b""))


class Paths(unittest.TestCase):
    def test_same_service(self):
        self.assertEqual(favicons.path_of("img/a.png?v=2", f"{ROOT_URL}/app/", HOST), "/app/img/a.png?v=2")
        self.assertEqual(favicons.path_of(f"https://{HOST}/a.png", f"{ROOT_URL}/", HOST), "/a.png")

    def test_anywhere_else_is_dropped(self):
        for link in ("https://other.test/a.png", "//other.test/a.png", "ftp://10.0.0.5/a", "http://[bad/a"):
            self.assertIsNone(favicons.path_of(link, f"{ROOT_URL}/", HOST), link)


class Fetch(unittest.TestCase):
    def test_declared_icon(self):
        data, _ = grab({f"{ROOT_URL}/": b'<link rel="icon" href="/i.png">', f"{ROOT_URL}/i.png": PNG})
        self.assertEqual(data, PNG)

    def test_falls_back_to_favicon_ico(self):
        data, _ = grab({f"{ROOT_URL}/": b"<html></html>", f"{ROOT_URL}/favicon.ico": ICO})
        self.assertEqual(data, ICO)

    def test_inline_icon(self):
        data, _ = grab({f"{ROOT_URL}/": b'<link rel="icon" href="data:image/png;base64,iVBORw0KGgo=">'})
        self.assertEqual(data[:4], b"\x89PNG")

    def test_follows_a_redirect_on_the_same_service(self):
        data, _ = grab({f"{ROOT_URL}/": "/login", f"{ROOT_URL}/login": b'<link rel="icon" href="l.png">', f"{ROOT_URL}/l.png": PNG})
        self.assertEqual(data, PNG)

    def test_never_leaves_the_service(self):
        data, site = grab({f"{ROOT_URL}/": "https://evil.test/", f"{ROOT_URL}/favicon.ico": ICO})
        self.assertEqual(data, ICO)
        data, site = grab({f"{ROOT_URL}/": b'<link rel="icon" href="https://evil.test/i.png">'})
        self.assertIsNone(data)
        self.assertTrue(all(u.startswith(ROOT_URL) for u in site.asked), site.asked)

    def test_oversized_or_fake_is_refused(self):
        big = PNG + b"x" * favicons.MAX_ICON
        self.assertIsNone(grab({f"{ROOT_URL}/favicon.ico": big})[0])
        self.assertIsNone(grab({f"{ROOT_URL}/favicon.ico": b"<html>not found</html>"})[0])


def row(domain=HOST):
    return {"domains": [domain], "web": "ui", "web_scheme": "http", "ip": "10.0.0.5", "port": 8080}


class Refresh(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name) / "favicons"
        self.site = Site({f"{ROOT_URL}/favicon.ico": ICO})

    def run_on(self, rows):
        favicons.refresh(rows, self.folder, self.site, 1)
        return rows

    def test_stores_once_then_waits_a_week(self):
        r = self.run_on([row()])[0]
        self.assertTrue((self.folder / r["favicon"]).is_file())
        asked = len(self.site.asked)
        self.assertEqual(self.run_on([row()])[0]["favicon"], r["favicon"])
        self.assertEqual(len(self.site.asked), asked)

    def test_a_failed_read_keeps_the_icon(self):
        name = self.run_on([row()])[0]["favicon"]
        index = favicons._load(self.folder)
        index[HOST]["at"] = time.time() - favicons.WEEK - 1
        favicons._write(self.folder / favicons.INDEX, favicons.json.dumps(index).encode())
        self.site.pages = {}
        self.assertEqual(self.run_on([row()])[0]["favicon"], name)

    def test_a_service_down_is_not_contacted(self):
        self.assertNotIn("favicon", self.run_on([{**row(), "web": None}])[0])
        self.assertEqual(self.site.asked, [])

    def test_a_removed_domain_loses_its_file(self):
        name = self.run_on([row()])[0]["favicon"]
        self.run_on([])
        self.assertFalse((self.folder / name).exists())


@unittest.skipIf(api is None, "FastAPI absent: run in the image")
class Route(unittest.TestCase):
    NAME = "0123456789abcdef0123456789abcdef.svg"

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = Path(tmp.name)
        old = server.CFG.get("cache_dir"), common.AUTH, common.STORE, common.TOKENS
        self.addCleanup(self.restore, old)
        server.CFG["cache_dir"] = str(d)
        common.AUTH, common.STORE, common.TOKENS = True, auth.Store(d / "m.db"), tokens.Tokens(d / "m.db")
        common.STORE.create_user("admin", "un mot de passe long", "admin")
        (d / "favicons").mkdir()
        (d / "favicons" / self.NAME).write_bytes(b"<svg/>")
        (d / "secret.svg").write_bytes(b"<svg/>")
        self.url = "/myservices/api/v1/favicon/"
        self.anon = TestClient(api.app, client=("192.168.1.51", 50000))
        self.c = TestClient(api.app, client=("192.168.1.50", 50000))
        self.c.post("/myservices/api/v1/login", json={"username": "admin", "password": "un mot de passe long"})

    @staticmethod
    def restore(old):
        server.CFG["cache_dir"], common.AUTH, common.STORE, common.TOKENS = old

    def test_svg_served_sandboxed(self):
        r = self.c.get(self.url + self.NAME)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "image/svg+xml")
        self.assertIn("sandbox", r.headers["content-security-policy"])
        self.assertEqual(r.headers["x-content-type-options"], "nosniff")

    def test_needs_a_session(self):
        self.assertEqual(self.anon.get(self.url + self.NAME).status_code, 401)

    def test_only_a_stored_hash_is_served(self):
        for name in ("index.json", "secret.svg", "0" * 32 + ".svg", "0" * 32 + ".html", "..%2Fsecret.svg"):
            self.assertEqual(self.c.get(self.url + name).status_code, 404, name)


if __name__ == "__main__":
    unittest.main()
