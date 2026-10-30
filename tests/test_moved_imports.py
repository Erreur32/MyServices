"""No `import netscan` for a module that now lives under msv/: since the 0.28.0 move such an import fails when it runs (HTTP 500 on /machines/advice)."""
import ast
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOVED = {p.stem for p in (ROOT / "msv").rglob("*.py") if p.stem != "__init__"}


class MovedImports(unittest.TestCase):
    def test_no_bare_import_of_a_module_under_msv(self):
        bad = []
        for p in [*(ROOT / "msv").rglob("*.py"), *(ROOT / "connectors").rglob("*.py")]:
            for n in ast.walk(ast.parse(p.read_text(encoding="utf-8"))):
                names = [a.name for a in n.names] if isinstance(n, ast.Import) else [n.module] if isinstance(n, ast.ImportFrom) and n.level == 0 and n.module else []
                bad += [f"{p.relative_to(ROOT)}:{n.lineno} {x}" for x in names if x.split(".")[0] in MOVED and x.split(".")[0] not in sys.stdlib_module_names and not (ROOT / x.split(".")[0]).exists()]
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
