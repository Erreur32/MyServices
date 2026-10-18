"""scripts/release.py : une version, partout. Essais sur une copie minimale du dépôt."""
import datetime as dt
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("release", ROOT / "scripts" / "release.py")
release = importlib.util.module_from_spec(spec)
sys.modules["release"] = release
spec.loader.exec_module(release)

FILES = ["front/package.json", "front/package-lock.json", "README.md", "README.fr.md", "CHANGELOG.md", "RELEASE-NOTES.md"]


class Release(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        if not all((ROOT / f).exists() for f in FILES):
            self.skipTest("fichiers du dépôt absents (image sans front/ ni docs)")
        for f in FILES:
            (self.root / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / f, self.root / f)

    def test_le_depot_est_coherent(self):
        self.assertEqual(release.check(ROOT), [])

    def test_versions_suivantes(self):
        self.assertEqual(release.bump("0.9.3", "patch"), "0.9.4")
        self.assertEqual(release.bump("0.9.3", "minor"), "0.10.0")
        self.assertEqual(release.bump("0.9.3", "major"), "1.0.0")

    def test_date_en_anglais(self):
        self.assertEqual(release.english_date(dt.date(2026, 10, 11)), "11 October 2026")
        self.assertEqual(release.english_date(dt.date(2026, 2, 1)), "1 February 2026")

    def test_applique_partout(self):
        old = release.current(self.root)
        new = release.bump(old, "patch")
        files = release.apply(self.root, new, dt.date(2026, 10, 12))
        for rel, text in files.items():
            (self.root / rel).write_text(text, encoding="utf-8")
        self.assertEqual(release.current(self.root), new)
        self.assertEqual(release.check(self.root), [])                      # tout dit la même chose
        lock = json.loads((self.root / "front/package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual((lock["version"], lock["packages"][""]["version"]), (new, new))
        ch = (self.root / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIn(f"## v{new} (2026-10-12)", ch)
        self.assertLess(ch.index("## Unreleased"), ch.index(f"## v{new}"))   # une section « Unreleased » vide est rouverte au-dessus
        self.assertIn(f"`:{new}`", (self.root / "README.md").read_text(encoding="utf-8"))
        self.assertIn("12 October 2026", (self.root / "RELEASE-NOTES.md").read_text(encoding="utf-8"))
        # on peut enchaîner : sans « Unreleased » plein de contenu, la version suivante est quand même possible
        again = release.apply(self.root, release.bump(new, "patch"), dt.date(2026, 10, 13))
        self.assertIn("## v", again["CHANGELOG.md"])

    def test_refus(self):
        with self.assertRaises(release.ReleaseError):
            release.apply(self.root, "abc", dt.date.today())
        with self.assertRaises(release.ReleaseError):
            release.apply(self.root, release.current(self.root), dt.date.today())
        (self.root / "CHANGELOG.md").write_text("# Changelog\n\n## v0.9.3 (2026-10-11)\n", encoding="utf-8")   # rien à publier
        with self.assertRaises(release.ReleaseError):
            release.apply(self.root, "0.9.4", dt.date.today())

    def test_incoherence_detectee(self):
        cur = release.current(self.root)
        (self.root / "README.md").write_text((self.root / "README.md").read_text(encoding="utf-8").replace(f"`:{cur}`", "`:0.0.1`"), encoding="utf-8")   # indépendant de la version du moment
        self.assertTrue(any("README.md" in p for p in release.check(self.root)))


if __name__ == "__main__":
    unittest.main()
