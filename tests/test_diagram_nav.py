"""diagram_nav.py : bandeau « ← MyServices · Généré avec Archify » ajouté aux schémas."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import diagram_nav as dn  # noqa: E402

PAGE = "<html><body><svg></svg></body></html>"


class Nav(unittest.TestCase):
    def test_bandeau_avec_retour_autres_schemas_et_origine(self):
        out = dn.inject(PAGE, "carte", ["carte", "acces"])
        self.assertIn('href="v2/"', out)                              # retour à l'application
        self.assertIn('href="acces.html"', out)                       # autre schéma
        self.assertNotIn('href="carte.html"', out)                    # celui qu'on regarde n'est pas un lien
        self.assertIn("Généré avec", out)
        self.assertIn(dn.ARCHIFY_URL, out)
        self.assertNotIn('href="sauvegardes.html"', out)              # schéma absent : pas de lien mort
        self.assertTrue(out.index("ms-nav") < out.index("</body>"))

    def test_idempotent(self):
        once = dn.inject(PAGE, "carte", ["carte", "acces"])
        twice = dn.inject(once, "carte", ["carte", "acces"])
        self.assertEqual(once, twice)
        self.assertEqual(twice.count("ms-nav"), 1)
        self.assertEqual(dn.inject(once, "carte", ["carte", "acces", "alertes"]).count('id="ms-nav"'), 1)   # nouvelle liste : remplacé, pas doublé

    def test_page_sans_body_inchangee(self):
        self.assertEqual(dn.inject("<svg/>", "carte", ["carte"]), "<svg/>")


if __name__ == "__main__":
    unittest.main()
