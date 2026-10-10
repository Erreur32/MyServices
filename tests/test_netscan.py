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


class PageTitle(unittest.TestCase):
    """_page lit le titre d'un vrai petit serveur local ; une seule requête GET."""

    @classmethod
    def setUpClass(cls):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        cls.methods = []
        outer = cls

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                outer.methods.append("GET")
                body = b"<html><head><TITLE>\n  Ma  &amp;  Box \n</TITLE></head></html>"
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                outer.methods.append("POST")
                self.send_response(405)
                self.end_headers()
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def test_titre_nettoye_et_une_seule_requete_get(self):
        self.assertEqual(netscan._page("127.0.0.1", self.srv.server_port), "Ma & Box")  # port quelconque : http
        self.assertEqual(self.methods, ["GET"])

    def test_port_ferme(self):
        import socket
        with socket.socket() as k:
            k.bind(("127.0.0.1", 0))
            port = k.getsockname()[1]
        self.assertIsNone(netscan._page("127.0.0.1", port, timeout=0.3))


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
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p in (8006, 443, 80), lookup=lambda ip: ("pve.lan", [], []),
                              banner=lambda ip, p: p == 22, ssh=(22,))
        self.assertEqual(d["name"], "pve")
        self.assertEqual(sorted(d["ports"]), [22, 80, 443, 8006])
        self.assertEqual(d["hints"], ["SSH", "web :80", "web :443"])  # 8006 : l'appli remplace l'indice de port
        self.assertEqual(d["apps"], ["Proxmox VE"])

    def test_ssh_hors_norme_reconnu_par_sa_banniere(self):
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p == 445, lookup=lambda ip: ("srv", [], []),
                              banner=lambda ip, p: p == 22232, ssh=(22, 22232))
        self.assertEqual(d["ssh_port"], 22232)
        self.assertEqual(d["hints"], ["SSH :22232", "partage SMB"])
        self.assertIn(22232, d["ports"])

    def test_ssh_sur_le_port_22_s_appelle_ssh(self):
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: False, lookup=lambda ip: ("srv", [], []),
                              banner=lambda ip, p: p == 22, ssh=(22, 22232))
        self.assertEqual((d["ssh_port"], d["hints"]), (22, ["SSH"]))

    def test_port_22_ouvert_sans_banniere_ssh_n_est_pas_ssh(self):
        """Un autre service sur le port 22 (ou un pare-feu qui accepte tout) ne passe pas pour SSH."""
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p == 22, lookup=lambda ip: ("srv", [], []),
                              banner=lambda ip, p: False, ssh=(22,))
        self.assertEqual((d["ssh_port"], d["hints"]), (None, []))

    def test_ports_ssh_de_la_config_ajoutes_aux_courants(self):
        got = netscan.ssh_ports({"1.2.3.4": {"port": 22232}, "5.6.7.8": {"port": 2022}, "9.9.9.9": {"port": 22}})
        self.assertEqual(got[:7], netscan.SSH_PORTS)
        self.assertIn(2022, got)
        self.assertEqual(len(got), len(set(got)), "pas de doublon")
        self.assertEqual(netscan.ssh_ports({}), netscan.SSH_PORTS)

    def test_sans_nom_dns(self):
        def no_name(ip):
            raise OSError
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: False, lookup=no_name)
        self.assertEqual((d["name"], d["ports"], d["hints"]), ("", [], []))


    def test_titre_de_la_page_et_appli_reconnue_par_son_titre(self):
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p in (80, 443), lookup=lambda ip: ("npm", [], []),
                              banner=lambda ip, p: False, ssh=(22,),
                              page=lambda ip, p: "Nginx Proxy Manager" if p == 80 else None)
        self.assertEqual(d["title"], "Nginx Proxy Manager")
        self.assertEqual(d["pages"], [{"port": 80, "scheme": "http", "title": "Nginx Proxy Manager"},
                                      {"port": 443, "scheme": "https", "title": None}])
        self.assertEqual(d["apps"], ["Nginx Proxy Manager"])

    def test_sans_port_web_pas_de_requete_de_page(self):
        asked = []
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p == 445, lookup=lambda ip: ("x", [], []),
                              banner=lambda ip, p: False, ssh=(22,), page=lambda ip, p: asked.append(p))
        self.assertEqual((asked, d["pages"], d["title"]), ([], [], None))

    def test_appli_reconnue_ne_double_pas_l_indice(self):
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p in (8123, 32400, 81, 445), lookup=lambda ip: ("ha", [], []))
        self.assertEqual(d["hints"], ["partage SMB"])
        self.assertEqual(sorted(d["apps"]), ["Home Assistant", "Nginx Proxy Manager", "Plex"])


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
        self.assertEqual((st["up"], st["described"]), (1, 1))
        self.assertEqual((st["total"], st["done"], st["stopped"], st["error"]), (5, 5, False, None))
        self.assertEqual(json.loads(self.file.read_text())["found"][0]["ip"], "192.168.1.2")

    def test_resultat_trie_par_adresse_meme_si_l_identification_finit_dans_le_desordre(self):
        up = {"192.168.1.9", "192.168.1.3", "192.168.1.5"}
        delays = {"192.168.1.3": 0.3, "192.168.1.5": 0.0, "192.168.1.9": 0.1}

        def slow(ip):
            time.sleep(delays[ip])
            return {"ip": ip, "name": "", "ports": [], "hints": [], "apps": []}
        netscan.start(set(), self.file, ping=lambda ip: ip in up, describe=slow, net="192.168.1.0/28")
        wait_done()
        self.assertEqual([f["ip"] for f in netscan.state(self.file)["found"]], ["192.168.1.3", "192.168.1.5", "192.168.1.9"])

    def test_identification_en_parallele(self):
        """14 machines à 0,2 s chacune : en série 2,8 s, en parallèle (16) environ 0,2 s."""
        up = {f"192.168.1.{n}" for n in range(1, 15)}
        t0 = time.time()
        netscan.start(set(), self.file, ping=lambda ip: ip in up, describe=lambda ip: (time.sleep(0.2), {"ip": ip})[1], net="192.168.1.0/24")
        wait_done(10)
        self.assertLess(time.time() - t0, 1.5)
        self.assertEqual(netscan.summary()["described"], 14)

    def test_changements_depuis_la_recherche_precedente(self):
        """2e recherche : ce qui a répondu avant et plus maintenant est « disparu » ; une machine ajoutée entre-temps
        (donc non pingée) n'est pas « disparue »."""
        mk = lambda ip: {"ip": ip, "name": "", "ports": [], "hints": [], "apps": []}  # noqa: E731
        netscan.start(set(), self.file, ping=lambda ip: ip in {"192.168.1.2", "192.168.1.3", "192.168.1.4"}, describe=mk, net="192.168.1.0/29")
        wait_done()
        first_end = netscan.state(self.file)["ended"]
        netscan.start({"192.168.1.4"}, self.file, ping=lambda ip: ip in {"192.168.1.2", "192.168.1.5"}, describe=mk, net="192.168.1.0/29")
        wait_done()
        st = netscan.state(self.file)
        self.assertEqual([h["ip"] for h in st["found"]], ["192.168.1.2", "192.168.1.5"])
        self.assertEqual(st["previous"], ["192.168.1.2", "192.168.1.3", "192.168.1.4"])
        self.assertEqual(st["gone"], ["192.168.1.3"])  # .4 est devenue une machine déclarée
        self.assertEqual(st["previous_ended"], first_end)

    def test_recherche_precedente_relue_apres_redemarrage(self):
        mk = lambda ip: {"ip": ip, "name": "", "ports": [], "hints": [], "apps": []}  # noqa: E731
        netscan.start(set(), self.file, ping=lambda ip: ip == "192.168.1.2", describe=mk, net="192.168.1.0/29")
        wait_done()
        netscan._state.update(phase="idle", found=[], previous=[], previous_ended=None, gone=[])  # serveur redémarré
        netscan.start(set(), self.file, ping=lambda ip: False, describe=mk, net="192.168.1.0/29")
        wait_done()
        self.assertEqual(netscan.state(self.file)["gone"], ["192.168.1.2"])

    def test_recherche_arretee_ne_dit_pas_disparu(self):
        mk = lambda ip: {"ip": ip, "name": "", "ports": [], "hints": [], "apps": []}  # noqa: E731
        netscan.start(set(), self.file, ping=lambda ip: ip == "192.168.1.2", describe=mk, net="192.168.1.0/29")
        wait_done()
        gate = threading.Event()
        netscan.start(set(), self.file, ping=lambda ip: gate.wait(3) and False, describe=mk, net="192.168.1.0/29")
        netscan.stop()
        gate.set()
        wait_done()
        self.assertEqual(netscan.state(self.file)["gone"], [])

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
