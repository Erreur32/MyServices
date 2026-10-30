"""Every fixed French sentence the server sends as an error or a connector message has an English text (front/src/lib/server-text.json).

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import ast
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "front/src/lib/server-text.json"   # not in the Docker image, only in the repository
TABLE = json.loads(FILE.read_text(encoding="utf-8")) if FILE.is_file() else {"exact": {}, "templates": []}
SOURCES = [*ROOT.glob("*.py"), *(ROOT / "msv").rglob("*.py"), *(ROOT / "connectors").glob("*.py")]
FIXED = re.compile(r'(?:deny\(\d+, |ConnectorError\(|\bfact\(|Result\((?:True|False), )"([^"{\\]*)"[,)]')


def covered(text: str) -> bool:
    return text in TABLE["exact"] or any(re.search(p, text) for p, _ in TABLE["templates"])


@unittest.skipUnless(FILE.is_file(), "front sources not present")
class ServerText(unittest.TestCase):
    def test_fixed_messages_are_translated(self):
        missing = sorted({m for f in set(SOURCES) for m in FIXED.findall(f.read_text(encoding="utf-8")) if not covered(m)})
        self.assertEqual(missing, [], "add these to front/src/lib/server-text.json")

    def test_connector_forms_are_translated(self):
        import connectors
        texts = set()
        for c in connectors.TYPES.values():
            texts |= {c.label, *(c.guide if hasattr(c, "guide") else ()), *(m.get(k) for m in c.modes for k in ("label", "help"))}
            texts |= {x for f in c.fields for x in (f.label, f.help)}
        self.assertEqual(sorted(t for t in texts if t and not covered(t)), [], "add these to front/src/lib/server-text.json")

    def test_problem_lists_are_translated(self):
        found = set()
        for f in (ROOT / "connectors").glob("*.py"):
            for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
                targets = n.targets if isinstance(n, ast.Assign) else [n.target] if isinstance(n, ast.AugAssign) else []
                call = isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name) and n.func.value.id == "problems"
                if call or any(isinstance(x, ast.Name) and x.id == "problems" for x in targets):
                    parts = {id(p) for j in ast.walk(n) if isinstance(j, ast.JoinedStr) for p in j.values}   # pieces of an f-string are no sentence
                    found |= {c.value for c in ast.walk(n) if isinstance(c, ast.Constant) and isinstance(c.value, str) and " " in c.value.strip() and id(c) not in parts}
        self.assertEqual(sorted(t for t in found if not covered(t)), [], "add these to front/src/lib/server-text.json")

    def test_table_has_no_empty_text(self):
        self.assertTrue(all(k and v for k, v in TABLE["exact"].items()))


if __name__ == "__main__":
    unittest.main()
