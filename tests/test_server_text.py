"""Every fixed French sentence the server sends as an error or a connector message has an English text (front/src/lib/server-text.json).

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "front/src/lib/server-text.json"   # not in the Docker image, only in the repository
TABLE = json.loads(FILE.read_text(encoding="utf-8")) if FILE.is_file() else {"exact": {}, "templates": []}
SOURCES = [*ROOT.glob("*.py"), *(ROOT / "msv").rglob("*.py"), *(ROOT / "connectors").glob("*.py")]
FIXED = re.compile(r'(?:deny\(\d+, |ConnectorError\()"([^"{\\]*)"\)')


def covered(text: str) -> bool:
    return text in TABLE["exact"] or any(re.search(p, text) for p, _ in TABLE["templates"])


@unittest.skipUnless(FILE.is_file(), "front sources not present")
class ServerText(unittest.TestCase):
    def test_fixed_messages_are_translated(self):
        missing = sorted({m for f in set(SOURCES) for m in FIXED.findall(f.read_text(encoding="utf-8")) if not covered(m)})
        self.assertEqual(missing, [], "add these to front/src/lib/server-text.json")

    def test_table_has_no_empty_text(self):
        self.assertTrue(all(k and v for k, v in TABLE["exact"].items()))


if __name__ == "__main__":
    unittest.main()
