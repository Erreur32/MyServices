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

    def scan_with(self, out):
        import backups
        state = Path(self.tmp.name) / "state" / "auto.json"
        with mock.patch.object(backups, "run_py", return_value=out):
            return ba.auto_default(state), state

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

    def test_emplacements_propres_a_une_machine(self):
        ba.set_patterns(["/srv/commun"], {"10.0.0.2": ["/mnt/nvme0/pve/config", "/srv/commun"], "10.0.0.9": ["/inconnue"], "10.0.0.3": []})
        meta = ba._read()
        self.assertEqual(meta["discover_by_host"], {"10.0.0.2": ["/mnt/nvme0/pve/config", "/srv/commun"]})  # machine inconnue / vide écartée
        self.assertEqual(ba.host_patterns_of(meta, "10.0.0.2"), ["/home/backup", "/srv/commun", "/mnt/nvme0/pve/config"])
        self.assertEqual(ba.host_patterns_of(meta, "10.0.0.3"), ["/home/backup", "/srv/commun"])
        import backups
        with mock.patch.object(backups, "run_py", return_value=({"local": []}, "")) as run:
            ba.discover()
        self.assertIn("/mnt/nvme0/pve/config", run.call_args.args[2])
        ba.set_patterns(["/srv/commun"])  # by_host omitted: per-machine lists kept
        self.assertIn("10.0.0.2", ba._read()["discover_by_host"])
        ba.set_patterns([], {})
        self.assertNotIn("10.0.0.2", ba._read()["discover_by_host"])

    def test_chemins_refuses(self):
        for bad in ("relatif/dossier", "/", "/a/../etc", "/a\nb", "x" * 301):
            with self.assertRaises(ba.BackupError, msg=bad):
                ba.set_patterns([bad])
        with self.assertRaises(ba.BackupError):
            ba.set_patterns([f"/d{i}" for i in range(ba.PATTERNS_MAX + 1)])


class AutoDefault(Base):
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


class Seuil(Base):
    def test_seuil_propose_d_apres_l_age_observe(self):
        self.assertEqual(ba.suggest_age(0.2), 2.0)          # sauvegarde quotidienne
        self.assertEqual(ba.suggest_age(1.5), 2.0)
        self.assertEqual(ba.suggest_age(6.3), 8.0)          # hebdomadaire vue à 6 jours : pas critique d'emblée
        self.assertEqual(ba.suggest_age(7.0), 15.0)         # marge de 25 % : 7 j * 1,25 > 8
        self.assertEqual(ba.suggest_age(40), 31.0)          # au-delà du dernier palier
        self.assertEqual(ba.suggest_age(None), 8.0)         # dossier vide

    def test_auto_prend_le_seuil_observe(self):
        old = {"local": [{"path": "/home/backup", "size": 1, "newest": time_ago(6.3), "newest_name": "x.tgz", "readable": True}]}
        added, _ = self.scan_with((old, ""))
        self.assertEqual(len(added), 1)
        self.assertEqual(json.loads(self.meta.read_text(encoding="utf-8"))["sets"][0]["max_age_days"], 8.0)

    def test_jeu_depuis_la_page_sans_copie_exigee_et_modifiable(self):
        ba.follow([self.item()])
        sid = ba.current()["sets"][0]["id"]
        self.assertFalse(ba.current()["sets"][0]["expect_offsite"])        # dossier simple : aucune copie ailleurs n'est exigée
        ba.update_set(sid, label="Mon NAS", max_age_days=15, expect_offsite=True)
        s = ba.current()["sets"][0]
        self.assertEqual((s["label"], s["max_age_days"], s["expect_offsite"]), ("Mon NAS", 15.0, True))
        with self.assertRaises(ba.BackupError):
            ba.update_set("inconnu", label="x")
        with self.assertRaises(ba.BackupError):
            ba.update_set(sid, max_age_days=0)
        with self.assertRaises(ba.BackupError):
            ba.update_set(sid, label="  ")

    def test_archive_attendu_et_dossier_modifiables(self):
        ba.follow([self.item()])
        s = ba.current()["sets"][0]
        self.assertEqual((s["archived"], s["schedule"]), (False, ""))
        ba.update_set(s["id"], archived=True, schedule=" lun. 01:30 ", path="/srv/save/")
        s = ba.current()["sets"][0]
        self.assertEqual((s["archived"], s["schedule"], s["path"]), (True, "lun. 01:30", "/srv/save"))
        ba.update_set(s["id"], archived=False)
        self.assertFalse(ba.current()["sets"][0]["archived"])
        for bad in ({"schedule": "x" * 41}, {"path": "relative"}, {"path": "/a/../b"}, {"path": "/"}):
            with self.assertRaises(ba.BackupError):
                ba.update_set(s["id"], **bad)
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        meta["sets"].append({"id": "ha", "label": "HA", "origin": "ha", "max_age_days": 2, "locations": [{"host": "ha", "ha_backup": True}]})
        self.meta.write_text(json.dumps(meta), encoding="utf-8")
        with self.assertRaises(ba.BackupError):
            ba.update_set("ha", path="/x")

    def test_retention_note_et_comparaison_modifiables(self):
        ba.follow([self.item()])
        sid = ba.current()["sets"][0]["id"]
        ba.update_set(sid, retention=" 3 archives ", note="disque externe", mode="each")
        s = ba.current()["sets"][0]
        self.assertEqual((s["retention"], s["note"], s["mode"]), ("3 archives", "disque externe", "each"))
        ba.update_set(sid, note="  ")
        self.assertNotIn("note", json.loads(self.meta.read_text(encoding="utf-8"))["sets"][0])   # note vidée : retirée du fichier
        for bad in ({"mode": "tout"}, {"retention": "x" * 61}, {"note": "a\nb"}):
            with self.assertRaises(ba.BackupError):
                ba.update_set(sid, **bad)

    def test_emplacement_modifiable_et_source_deplacee(self):
        self.services.write_text(json.dumps({"machines": {"10.0.0.2": {"name": "Serveur", "role": "", "ssh": "srv"},
                                                          "10.0.0.5": {"name": "NAS", "role": "", "ssh": "nas"}}}), encoding="utf-8")
        ba.follow([self.item()])
        sid = ba.current()["sets"][0]["id"]
        ba.update_location(sid, 0, pattern="*.tar.gz", depth=2, via="tar 01:30", encrypted=True)
        loc = ba.current()["sets"][0]["locations"][0]
        self.assertEqual((loc["pattern"], loc["depth"], loc["via"], loc["encrypted"], loc["editable"]), ("*.tar.gz", 2, "tar 01:30", True, True))
        ba.update_location(sid, 0, ip="10.0.0.5", path="/volume1/save/")
        s = ba.current()["sets"][0]
        self.assertEqual((s["origin"], s["locations"][0]["ip"], s["locations"][0]["path"]), ("NAS", "10.0.0.5", "/volume1/save"))   # l'origine suit la source
        for args in ((sid, 3), (sid, 0, "10.0.0.3"), (sid, 0, None, "relatif"), (sid, 0, None, None, "a/b"), (sid, 0, None, None, ""), ("inconnu", 0)):
            with self.assertRaises(ba.BackupError):
                ba.update_location(*args)
        with self.assertRaises(ba.BackupError):
            ba.update_location(sid, 0, depth=6)

    def test_rythme_d_une_copie_garde_seulement_si_pas_quotidien(self):
        ba.follow([self.item()])
        sid = ba.current()["sets"][0]["id"]
        ba.update_location(sid, 0, every_days=7)
        self.assertEqual(ba.current()["sets"][0]["locations"][0]["every_days"], 7)
        ba.update_location(sid, 0, every_days=1)
        self.assertNotIn("every_days", json.loads(self.meta.read_text(encoding="utf-8"))["sets"][0]["locations"][0])
        self.assertEqual(ba.current()["sets"][0]["locations"][0]["every_days"], 1)
        for bad in (0, 32):
            with self.assertRaises(ba.BackupError):
                ba.update_location(sid, 0, every_days=bad)

    def test_emplacement_d_une_source_non_modifiable(self):
        meta = {"hosts": [], "sets": [{"id": "ha", "label": "HA", "origin": "ha", "max_age_days": 2, "locations": [{"host": "ha", "path": "/backup", "ha_backup": True}]}]}
        self.meta.write_text(json.dumps(meta), encoding="utf-8")
        self.assertFalse(ba.current()["sets"][0]["locations"][0]["editable"])
        with self.assertRaises(ba.BackupError):
            ba.update_location("ha", 0, pattern="*.tar")


def time_ago(days):
    import time
    return int(time.time() - days * 86400)


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


class Copies(Base):
    def setUp(self):
        super().setUp()
        self.services.write_text(json.dumps({"machines": {
            "10.0.0.2": {"name": "Serveur", "role": "", "ssh": "srv"},
            "10.0.0.5": {"name": "NAS", "role": "", "ssh": "nas"}}}), encoding="utf-8")
        ba.follow([self.item()])
        self.sid = ba.current()["sets"][0]["id"]

    def test_copie_sur_une_autre_machine_exigee_puis_retiree(self):
        self.assertEqual(ba.add_copy(self.sid, "10.0.0.5", "/volume1/backup/serveur"), {"offsite": True})
        s = ba.current()["sets"][0]
        self.assertTrue(s["expect_offsite"])
        self.assertEqual(s["copies"], [{"index": 1, "host": "NAS", "path": "/volume1/backup/serveur", "offsite": True}])
        loc = json.loads(self.meta.read_text(encoding="utf-8"))["sets"][0]["locations"][1]
        self.assertEqual((loc["via"], loc["depth"]), ("copie", ba.DEPTH))
        ba.remove_copy(self.sid, 1)
        s = ba.current()["sets"][0]
        self.assertEqual((s["copies"], s["expect_offsite"]), ([], False))

    def test_copie_sur_la_meme_machine_n_exige_rien(self):
        self.assertEqual(ba.add_copy(self.sid, "10.0.0.2", "/mnt/disque2/backup"), {"offsite": False})
        self.assertFalse(ba.current()["sets"][0]["expect_offsite"])

    def test_refus(self):
        for args in (("inconnu", "10.0.0.5", "/x"), (self.sid, "10.9.9.9", "/x"), (self.sid, "10.0.0.5", "relatif"),
                     (self.sid, "10.0.0.2", "/home/backup")):
            with self.assertRaises(ba.BackupError, msg=args):
                ba.add_copy(*args)
        with self.assertRaises(ba.BackupError):
            ba.remove_copy(self.sid, 0)   # la source ne se retire pas comme une copie

    def test_suggestions(self):
        ba.follow([self.item(ip="10.0.0.5", path="/home/backup", label="NAS : /home/backup")])
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        nas_sid = ba.current()["sets"][1]["id"]
        report = {self.sid: {"locations": [{"newest": {"name": "daily/site.tar.gz"}}]}, nas_sid: {"locations": [{}]}}
        want = ba._wanted(meta, report)
        self.assertEqual(want, {"site.tar.gz": [(self.sid, "daily/site.tar.gz")]})
        share = {"dir": "/mnt/freebox/backup/serveur/daily", "network": True}   # archive in daily/ : the copy root is the folder above
        hits = [{"ip": "10.0.0.2", "name": "Serveur", "found": {"site.tar.gz": [{"dir": "/home/backup/daily", "network": False}, share,
                                                                                {"dir": "/mnt/disque2/daily", "network": False},
                                                                                {"dir": "/tmp/ailleurs", "network": False}]}},
                {"ip": "10.0.0.5", "name": "NAS", "found": {"site.tar.gz": [share]}}]
        got = ba.copies_from_hits(meta, want, hits)
        self.assertEqual([(c["name"], c["path"], c["offsite"]) for c in got],
                         [("NAS", "/mnt/freebox/backup/serveur", True), ("Serveur", "/mnt/disque2", False)])   # source left out, share once via another machine
        ba.add_copy(self.sid, "10.0.0.5", "/mnt/freebox/backup/serveur")
        got = ba.copies_from_hits(json.loads(self.meta.read_text(encoding="utf-8")), want, hits)
        self.assertEqual([c["path"] for c in got], ["/mnt/disque2"])   # already declared

    def test_partage_reseau_sur_la_machine_d_origine_compte_hors_machine(self):
        self.assertEqual(ba.add_copy(self.sid, "10.0.0.2", "/mnt/nas/serveur", network=True), {"offsite": True})
        s = ba.current()["sets"][0]
        self.assertTrue(s["expect_offsite"] and s["copies"][0]["offsite"])


class Rythme(unittest.TestCase):
    def test_rythme_observe(self):
        import backups
        day = 86400
        weekly = [{"mtime": 1_700_000_000 - k * 7 * day + j * 600} for k in range(4) for j in range(3)]   # 3 fichiers par passage
        self.assertEqual(backups.cadence(weekly), 7.0)
        self.assertEqual(backups.cadence([{"mtime": 1_700_000_000 - k * day} for k in range(10)]), 1.0)
        self.assertIsNone(backups.cadence(weekly[:3]))   # un seul passage
        # an old forgotten file does not stretch the rhythm: only the last 120 days before the newest archive count
        self.assertEqual(backups.cadence(weekly + [{"mtime": 1_700_000_000 - 400 * day}, {"mtime": 1_700_000_000 - 500 * day}]), 7.0)


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
