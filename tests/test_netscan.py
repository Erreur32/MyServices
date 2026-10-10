"""netscan.py : recherche des machines du réseau local, sans toucher au réseau (ping et sondes injectés).

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import netscan  # noqa: E402


def wait_done(timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        if netscan.summary()["phase"] == "done":
            return
        time.sleep(0.02)
    raise AssertionError("le passage ne se termine pas")


class Targets(unittest.TestCase):
    def test_exclut_les_machines_connues(self):
        got = netscan.targets("192.168.1.0/24", {"192.168.1.5", "192.168.1.1"})
        self.assertEqual(len(got), 252)
        self.assertNotIn("192.168.1.5", got)
        self.assertNotIn("192.168.1.0", got)
        self.assertNotIn("192.168.1.255", got)

    def test_refuse_un_reseau_plus_grand_qu_un_24(self):
        with self.assertRaises(ValueError):
            netscan.targets("10.0.0.0/16", set())


class Describe(unittest.TestCase):
    def test_ports_indices_et_applis(self):
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p in (22, 8006, 443, 80), lookup=lambda ip: ("pve.lan", [], []))
        self.assertEqual(d["name"], "pve")
        self.assertEqual(sorted(d["ports"]), [22, 80, 443, 8006])
        self.assertEqual(d["hints"], ["SSH", "Proxmox", "web"])  # ordre de HINT_PORTS ; 80 et 443 : un seul « web »
        self.assertEqual(d["apps"], ["Proxmox VE"])

    def test_sans_nom_dns(self):
        def no_name(ip):
            raise OSError
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: False, lookup=no_name)
        self.assertEqual((d["name"], d["ports"], d["hints"]), ("", [], []))


class Run(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = Path(self.tmp.name) / "network-scan.json"
        self.addCleanup(self.tmp.cleanup)
        netscan._state.update(phase="idle", found=[], done=0, total=0, error=None, stopped=False)

    def test_trouve_les_machines_qui_repondent(self):
        up = {"192.168.1.10", "192.168.1.2"}
        ok = netscan.start({"192.168.1.1"}, self.file, ping=lambda ip: ip in up,
                           describe=lambda ip: {"ip": ip, "name": "", "ports": [], "hints": [], "apps": []}, net="192.168.1.0/29")
        self.assertTrue(ok)
        wait_done()
        st = netscan.state(self.file)
        self.assertEqual([f["ip"] for f in st["found"]], ["192.168.1.2"])  # /29 : .1 à .6 ; .10 hors réseau
        self.assertEqual((st["total"], st["done"], st["stopped"], st["error"]), (5, 5, False, None))
        self.assertEqual(json.loads(self.file.read_text())["found"][0]["ip"], "192.168.1.2")

    def test_un_seul_passage_a_la_fois(self):
        gate = threading.Event()
        ping = lambda ip: gate.wait(2) and False  # noqa: E731
        self.assertTrue(netscan.start(set(), self.file, ping=ping, describe=lambda ip: {}, net="192.168.1.0/29"))
        self.assertFalse(netscan.start(set(), self.file, ping=ping, describe=lambda ip: {}, net="192.168.1.0/29"))
        gate.set()
        wait_done()

    def test_arret(self):
        gate = threading.Event()
        netscan.start(set(), self.file, ping=lambda ip: gate.wait(3) and False, describe=lambda ip: {}, net="192.168.1.0/28")
        netscan.stop()
        gate.set()
        wait_done()
        self.assertTrue(netscan.state(self.file)["stopped"])

    def test_erreur_dans_un_sondage_n_arrete_pas_le_serveur(self):
        def boom(ip):
            raise RuntimeError("x")
        netscan.start(set(), self.file, ping=boom, describe=lambda ip: {}, net="192.168.1.0/30")
        wait_done()
        self.assertIsNotNone(netscan.state(self.file)["error"])


if __name__ == "__main__":
    unittest.main()
