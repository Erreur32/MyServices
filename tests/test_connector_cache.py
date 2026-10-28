"""Cache du contexte des connecteurs (connectors/base.py Context.cached) et alerte « version non testée » (watcher.py).

  python3 -m unittest discover -s tests
"""
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors.base import Context  # noqa: E402
from msv.collect import watcher  # noqa: E402


class Cache(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ctx = Context(cache_dir=self.tmp.name)
        self.calls = 0

    def tearDown(self):
        self.tmp.cleanup()

    def fn(self):
        self.calls += 1
        return {"n": self.calls}

    def test_valeur_gardee_pendant_la_duree(self):
        self.assertEqual(self.ctx.cached("a/b", 60, self.fn), {"n": 1})
        self.assertEqual(self.ctx.cached("a/b", 60, self.fn), {"n": 1})
        self.assertEqual(self.calls, 1)

    def test_valeur_expiree_relue(self):
        self.ctx.cached("k", 60, self.fn)
        time.sleep(0.02)
        self.assertEqual(self.ctx.cached("k", 0.01, self.fn), {"n": 2})

    def test_cles_separees_et_nom_sans_danger(self):
        self.ctx.cached("../../etc/passwd", 60, self.fn)
        self.ctx.cached("autre", 60, self.fn)
        self.assertEqual(self.calls, 2)
        self.assertEqual(sorted(p.parent for p in Path(self.tmp.name).rglob("*.json")), [Path(self.tmp.name)] * 2)

    def test_erreur_n_ecrase_pas_le_cache(self):
        self.ctx.cached("k", 0.01, self.fn)
        time.sleep(0.02)

        def boom():
            raise RuntimeError("service injoignable")
        with self.assertRaises(RuntimeError):
            self.ctx.cached("k", 0.01, boom)
        self.assertEqual(self.ctx.cached("k", 60, self.fn), {"n": 1})  # l'ancienne valeur est toujours là

    def test_sans_dossier_ou_fichier_illisible(self):
        bare = Context()
        self.assertEqual(bare.cached("k", 60, self.fn), {"n": 1})
        self.assertEqual(bare.cached("k", 60, self.fn), {"n": 2})  # rien de gardé
        (Path(self.tmp.name) / "connectors-k.json").write_text("pas du json")
        self.assertEqual(self.ctx.cached("k", 60, self.fn), {"n": 3})


def snap(version, tested, ok=True):
    return watcher.connector_snaps({"connectors": [{"type": "beszel", "name": "hub", "ok": ok, "message": "OK", "version": version, "version_tested": tested}]})


class Version(unittest.TestCase):
    def test_nouvelle_version_non_testee_alerte_une_fois(self):
        ev, _ = watcher.diff_connectors(snap("0.21.0", True), snap("0.22.0", False), {})
        self.assertEqual([e["kind"] for e in ev], ["connecteur_version"])
        self.assertIn("0.22.0 (avant : 0.21.0)", ev[0]["detail"])
        ev, _ = watcher.diff_connectors(snap("0.22.0", False), snap("0.22.0", False), {})
        self.assertEqual(ev, [])  # même version : pas de répétition

    def test_version_testee_ou_inconnue_sans_alerte(self):
        self.assertEqual(watcher.diff_connectors(snap("0.20.0", True), snap("0.21.0", True), {})[0], [])
        self.assertEqual(watcher.diff_connectors(snap(None, None), snap("0.22.0", False), {})[0], [])  # première lecture : référence
        self.assertEqual(watcher.diff_connectors(snap("0.21.0", True), snap(None, None), {})[0], [])

    def test_connecteur_en_panne_pas_d_alerte_version(self):
        self.assertEqual(watcher.diff_connectors(snap("0.21.0", True), snap("0.22.0", False, ok=False), {})[0], [])

    def test_type_d_evenement_declare(self):
        self.assertIn("connecteur_version", watcher.SEVERITY)
        self.assertIn("connecteur_version", watcher.LABEL)



class Recent(unittest.TestCase):
    """cbase.recent: a result read a moment ago (by the collection) is reused by another task instead of a second call."""

    def test_reuse_window(self):
        import time as _t
        from connectors.base import recent
        conn = type("C", (), {"type": "glances", "name": "g"})()
        now = _t.time()
        self.assertEqual(recent(conn, {"glances/g": {"ok": True, "last": {"x": 1}, "at": now - 60}}, 600), {"x": 1})
        self.assertIsNone(recent(conn, {"glances/g": {"ok": True, "last": {"x": 1}, "at": now - 900}}, 600))
        self.assertIsNone(recent(conn, {"glances/g": {"ok": False, "last": {"x": 1}, "at": now}}, 600))
        self.assertIsNone(recent(conn, {"glances/g": {"ok": True, "last": {"x": 1}}}, 600))   # older state, no time: read again
        self.assertIsNone(recent(conn, {}, 600))


if __name__ == "__main__":
    unittest.main()
