"""Content-Security-Policy per page (api.py csp_for): scripts stay strict everywhere; only the React front allows inline styles."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from msv.api import api
except Exception:   # noqa: BLE001 : the API needs its dependencies (FastAPI): skipped without them
    api = None


@unittest.skipIf(api is None, "api.py not importable here")
class Csp(unittest.TestCase):
    def test_the_front_allows_inline_styles_for_the_unifi_cards_but_no_inline_script(self):
        csp = api.csp_for("/")
        self.assertIn("style-src 'self' 'unsafe-inline'", csp)
        self.assertIn("script-src 'self';", csp)
        self.assertNotIn("script-src 'self' 'unsafe-inline'", csp)

    def test_the_sign_in_page_stays_fully_strict(self):
        csp = api.csp_for("/login.html")
        self.assertIn("style-src 'self';", csp)
        self.assertNotIn("unsafe-inline", csp)


if __name__ == "__main__":
    unittest.main()
