"""about.py : comparaison de versions, dernière version GitHub (réponse simulée, cache 6 h), journal des changements."""
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import about  # noqa: E402

RELEASE = {"tag_name": "v0.9.4", "name": "0.9.4", "html_url": "https://github.com/Erreur32/MyServices/releases/tag/v0.9.4", "published_at": "2026-10-12T08:00:00Z", "body": "Notes", "prerelease": False}


class Fake:
    def __init__(self, body=RELEASE, fail=False):
        self.body, self.fail, self.calls = body, fail, 0

    def __call__(self, req, timeout=0):
        self.calls += 1
        if self.fail:
            raise OSError("hors ligne")
        return io.BytesIO(json.dumps(self.body).encode())


class Versions(unittest.TestCase):
    def test_version_de_l_image(self):
        self.assertEqual(about.core_version("v0.9.3-0123456789abcdef0123456789abcdef01234567"), "0.9.3")
        self.assertEqual(about.core_version("v2.0.0-rc.1-abcdef1"), "2.0.0-rc.1")
        self.assertEqual(about.core_version("0.9.3"), "0.9.3")
        self.assertIsNone(about.core_version("dev"))
        self.assertIsNone(about.core_version("main-0123456789abcdef"))
        self.assertTrue(about.newer("v0.9.4", "v0.9.3-0123456789abcdef0123456789abcdef01234567"))
        self.assertFalse(about.newer("v0.9.3", "v0.9.3-0123456789abcdef0123456789abcdef01234567"))

    def test_version_prevue(self):
        self.assertEqual(about.planned("## Unreleased (next)\n- x\n\n## v0.9.3 (2026-10-11)\n"), "0.9.4")
        self.assertEqual(about.planned("## Unreleased\n\n## v0.9.9 (d)\n## v0.9.8 (d)\n"), "0.9.10")
        self.assertIsNone(about.planned("## v0.9.3 (2026-10-11)\n"))          # rien en cours : pas de version prévue
        self.assertIsNone(about.planned("## Unreleased\n"))                     # pas de version publiée de référence

    def test_comparaison(self):
        self.assertTrue(about.newer("v0.9.4", "0.9.3"))
        self.assertFalse(about.newer("v0.9.3", "0.9.3"))
        self.assertFalse(about.newer("v0.9.3", "0.9.4"))        # version locale en avance : pas « plus ancienne que la dernière »
        self.assertTrue(about.newer("0.10.0", "0.9.9"))         # 10 > 9, pas une comparaison de texte
        self.assertTrue(about.newer("1.0.0", "1.0.0-rc.1"))      # la finale suit sa préversion
        self.assertFalse(about.newer("v1.0.0", "dev"))           # image locale : rien à comparer
        self.assertFalse(about.newer(None, "0.9.3"))


class Latest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = Path(self.tmp.name)

    def test_lit_puis_garde_six_heures(self):
        f = Fake()
        r = about.latest(self.d, opener=f, now=1000.0)
        self.assertEqual((r["release"]["tag"], r["error"], r["cached"]), ("v0.9.4", None, False))
        about.latest(self.d, opener=f, now=1000.0 + 3600)
        self.assertEqual(f.calls, 1)                              # dans les 6 h : pas de nouvelle requête
        about.latest(self.d, opener=f, now=1000.0 + 7 * 3600)
        self.assertEqual(f.calls, 2)
        about.latest(self.d, force=True, opener=f, now=1000.0 + 7 * 3600 + 1)
        self.assertEqual(f.calls, 3)                              # « Vérifier maintenant »

    def test_hors_ligne_garde_la_derniere_reponse(self):
        about.latest(self.d, opener=Fake(), now=1000.0)
        r = about.latest(self.d, force=True, opener=Fake(fail=True), now=2000.0)
        self.assertEqual((r["release"]["tag"], r["cached"]), ("v0.9.4", True))
        self.assertIn("injoignable", r["error"])
        first = about.latest(Path(self.tmp.name) / "autre", opener=Fake(fail=True))
        self.assertIsNone(first["release"])                       # jamais joint : rien à montrer, pas d'exception

    def test_verification_coupee(self):
        f = Fake()
        r = about.latest(self.d, enabled=False, opener=f)
        self.assertEqual((f.calls, r["enabled"]), (0, False))

    def test_journal(self):
        p = self.d / "CHANGELOG.md"
        p.write_text("# Changelog\n\n## v0.9.3\n- x\n", encoding="utf-8")
        self.assertIn("v0.9.3", about.changelog(p))
        self.assertEqual(about.changelog(self.d / "absent.md"), "")


if __name__ == "__main__":
    unittest.main()
