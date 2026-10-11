"""Sauvegardes décrites depuis la page (backups_admin.py) : recherche par SSH simulée, suivi, retrait, refus.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import backups_admin as ba  # noqa: E402

AGENT_OUT = {"local": [{"path": "/home/backup", "size": 5_000_000, "newest": 1_790_000_000, "newest_name": "etc.tar.gz", "readable": True}]}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.meta = d / "backups-meta.json"
        self.services = d / "services-meta.json"
        self.services.write_text(json.dumps({"machines": {
            "10.0.0.2": {"name": "Serveur", "role": "", "ssh": "srv"},
            "10.0.0.3": {"name": "PC", "role": "", "ssh": None},
            "10.0.0.4": {"name": "Vieux", "role": "", "ssh": "vieux", "disabled": True}}}), encoding="utf-8")
        self.example = d / "example.json"
        self.example.write_text(json.dumps({"discover": ["/home/backup*"]}), encoding="utf-8")
        for p in (mock.patch.dict("config.CFG", {"backups_meta": str(self.meta), "backups_url": ""}),
                  mock.patch.object(ba.setup, "META", self.services), mock.patch.object(ba.setup, "EXAMPLE_BACKUPS", self.example)):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def item(self, **kw):
        return {"ip": "10.0.0.2", "path": "/home/backup", "label": "Serveur : /home/backup", "max_age_days": 2, **kw}


class Discover(Base):
    def test_ne_lit_que_les_machines_avec_ssh_suivies(self):
        import backups
        with mock.patch.object(backups, "run_py", return_value=(AGENT_OUT, "")) as run:
            out = ba.discover()
        self.assertEqual([m["ip"] for m in out["machines"]], ["10.0.0.2"])  # ni le PC sans SSH, ni la machine non suivie
        self.assertEqual(run.call_args.args[0], "srv")
        req = json.loads(run.call_args.args[2])
        self.assertEqual((req["discover"], req["disks"], req["crons"]), (["/home/backup", "/home/backup*"], False, False))  # dossier par défaut d'abord ; lecture seule, rien d'autre
        folder = out["machines"][0]["folders"][0]
        self.assertEqual((folder["path"], folder["default"]), ("/home/backup", True))  # au chemin par défaut : la page le coche

    def test_machine_injoignable_dite_sans_planter(self):
        import backups
        with mock.patch.object(backups, "run_py", return_value=(None, "timeout après 240s")):
            m = ba.discover()["machines"][0]
        self.assertFalse(m["ok"])
        self.assertEqual((m["error"], m["folders"]), ("timeout après 240s", []))


class Patterns(Base):
    def test_dossier_par_defaut_toujours_cherche_et_autres_chemins_possibles(self):
        self.assertEqual(ba.current()["patterns"], ["/home/backup", "/home/backup*"])
        out = ba.set_patterns(["/srv/sauvegardes", "/mnt/*/save*", "/home/backup", "/srv/sauvegardes/"])
        self.assertEqual(out["patterns"], ["/home/backup", "/srv/sauvegardes", "/mnt/*/save*"])  # défaut en tête, sans doublon
        self.assertEqual(ba.current()["default_path"], "/home/backup")
        self.assertEqual(ba.set_patterns([])["patterns"], ["/home/backup"])  # le défaut ne se retire pas

    def test_chemins_refuses(self):
        for bad in ("relatif/dossier", "/", "/a/../etc", "/a\nb", "x" * 301):
            with self.assertRaises(ba.BackupError, msg=bad):
                ba.set_patterns([bad])
        with self.assertRaises(ba.BackupError):
            ba.set_patterns([f"/d{i}" for i in range(ba.PATTERNS_MAX + 1)])


class AutoDefault(Base):
    def scan_with(self, out):
        import backups
        state = Path(self.tmp.name) / "state" / "auto.json"
        with mock.patch.object(backups, "run_py", return_value=out):
            return ba.auto_default(state), state

    def test_suit_home_backup_a_la_premiere_lecture_puis_ne_revient_pas(self):
        added, state = self.scan_with((AGENT_OUT, ""))
        self.assertEqual([(a["ip"], a["path"]) for a in added], [("10.0.0.2", "/home/backup")])
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        self.assertEqual(meta["sets"][0]["locations"][0]["path"], "/home/backup")
        self.assertEqual(json.loads(state.read_text(encoding="utf-8")), ["10.0.0.2"])
        ba.unfollow(meta["sets"][0]["id"])                      # l'auteur le retire...
        again, _ = self.scan_with((AGENT_OUT, ""))
        self.assertEqual(again, [])                             # ... et il ne revient pas
        self.assertEqual(json.loads(self.meta.read_text(encoding="utf-8"))["sets"], [])

    def test_machine_injoignable_retentee_plus_tard(self):
        added, state = self.scan_with((None, "timeout"))
        self.assertEqual(added, [])
        self.assertEqual(json.loads(state.read_text(encoding="utf-8")), [])      # pas marquée : prochain passage
        added, _ = self.scan_with((AGENT_OUT, ""))
        self.assertEqual(len(added), 1)

    def test_autre_dossier_ou_illisible_ne_suit_rien(self):
        other = {"local": [{"path": "/srv/autre", "size": 1, "newest": 1, "newest_name": "x", "readable": True}]}
        self.assertEqual(self.scan_with((other, ""))[0], [])
        unreadable = {"local": [{"path": "/home/backup", "size": 1, "newest": 1, "newest_name": "x", "readable": False}]}
        self.assertEqual(self.scan_with((unreadable, ""))[0], [])
        self.assertFalse(self.meta.exists())                    # rien d'écrit


class Follow(Base):
    def test_ecrit_les_machines_et_les_jeux(self):
        self.assertEqual(ba.follow([self.item()]), {"added": 1, "updated": 0})
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        self.assertEqual(meta["hosts"][0]["ssh"], "srv")
        s = meta["sets"][0]
        self.assertEqual((s["label"], s["origin"], s["max_age_days"]), ("Serveur : /home/backup", "serveur", 2.0))
        self.assertEqual(s["locations"][0]["path"], "/home/backup")
        self.assertEqual(meta["discover"], ["/home/backup*"])  # motifs de recherche gardés
        self.assertEqual(oct(self.meta.stat().st_mode & 0o777), "0o600")

    def test_pas_de_doublon_et_les_autres_cles_sont_gardees(self):
        self.meta.write_text(json.dumps({"hosts": [{"id": "veeam", "api": "veeam", "label": "V", "url": "https://x:9419", "secrets": "/s"}],
                                         "sets": [], "syncthing": [{"x": 1}], "cron_ignore": ["foo"]}), encoding="utf-8")
        ba.follow([self.item()])
        out = ba.follow([self.item(label="Nouveau nom", max_age_days=5)])
        self.assertEqual(out, {"added": 0, "updated": 1})
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        self.assertEqual(len(meta["sets"]), 1)
        self.assertEqual((meta["sets"][0]["label"], meta["sets"][0]["max_age_days"]), ("Nouveau nom", 5.0))
        self.assertEqual([h["id"] for h in meta["hosts"]], ["veeam", "serveur"])
        self.assertEqual((meta["syncthing"], meta["cron_ignore"]), ([{"x": 1}], ["foo"]))

    def test_deux_dossiers_de_la_meme_machine_ont_deux_jeux(self):
        ba.follow([self.item(), self.item(path="/root/backups", label="Racine")])
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        self.assertEqual(len(meta["hosts"]), 1)
        self.assertEqual(len({s["id"] for s in meta["sets"]}), 2)

    def test_refus(self):
        for bad in (self.item(ip="10.0.0.3"), self.item(ip="10.0.0.4"), self.item(ip="1.2.3.4"), self.item(path="relatif"),
                    self.item(path="/home/../etc"), self.item(path="/"), self.item(label=""), self.item(label="x" * 81),
                    self.item(max_age_days=0), self.item(max_age_days=999), self.item(max_age_days="abc")):
            with self.assertRaises(ba.BackupError, msg=str(bad)):
                ba.follow([bad])
        with self.assertRaises(ba.BackupError):
            ba.follow([])
        self.assertFalse(self.meta.exists())  # un refus n'écrit rien


class Unfollow(Base):
    def test_retire_un_jeu(self):
        ba.follow([self.item(), self.item(path="/root/backups", label="Racine")])
        sid = ba.current()["sets"][0]["id"]
        ba.unfollow(sid)
        self.assertEqual(len(ba.current()["sets"]), 1)
        with self.assertRaises(ba.BackupError):
            ba.unfollow("inconnu")

    def test_current_sans_fichier(self):
        c = ba.current()
        self.assertEqual((c["sets"], c["exists"], c["tab"], c["machines"]), ([], False, False, 1))


class ReponseSsh(unittest.TestCase):
    """Un bandeau de connexion avant la réponse de l'agent ne la rend pas illisible (Jarvis, fastfetch dans ~/.bashrc)."""

    def run_with(self, stdout, rc=0):
        import backups
        with mock.patch.object(backups.subprocess, "run", return_value=mock.Mock(returncode=rc, stdout=stdout, stderr="")):
            return backups.run_py("srv", "print(1)", "{}")

    def test_bandeau_puis_json(self):
        banner = "/root/.bashrc: bind: avertissement\n        _,met$$$$$gg.\n\x1b[16A\x1b[31Croot@Jarvis\n"
        self.assertEqual(self.run_with(banner + '{"local": []}\n'), ({"local": []}, ""))

    def test_json_seul_et_illisible(self):
        self.assertEqual(self.run_with('{"a": 1}\n'), ({"a": 1}, ""))
        self.assertEqual(self.run_with("rien de JSON\n"), (None, "réponse illisible"))
        self.assertEqual(self.run_with("{cassé\n"), (None, "réponse illisible"))


if __name__ == "__main__":
    unittest.main()
