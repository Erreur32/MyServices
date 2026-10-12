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

    def test_redirection_sans_titre(self):
        import http.server, threading
        class R(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_GET(self):
                body = b"<html><head><title>301 Moved Permanently</title></head></html>"
                self.send_response(301)
                self.send_header("Location", "https://x/")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), R)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            self.assertIsNone(netscan._page("127.0.0.1", srv.server_port))
        finally:
            srv.shutdown()
            srv.server_close()

    def test_port_ferme(self):
        import socket
        with socket.socket() as k:
            k.bind(("127.0.0.1", 0))
            port = k.getsockname()[1]
        self.assertIsNone(netscan._page("127.0.0.1", port, timeout=0.3))


class Targets(unittest.TestCase):
    def test_tout_le_reseau_sans_adresse_reseau_ni_diffusion(self):
        got = netscan.targets("192.168.1.0/24")
        self.assertEqual(len(got), 254)
        self.assertIn("192.168.1.5", got)  # une machine déjà déclarée est pinguée aussi
        self.assertNotIn("192.168.1.0", got)
        self.assertNotIn("192.168.1.255", got)

    def test_refuse_un_reseau_plus_grand_qu_un_24(self):
        with self.assertRaises(ValueError):
            netscan.targets("10.0.0.0/16")


class GuessOs(unittest.TestCase):
    def test_banniere_ssh(self):
        g = netscan.guess_os
        self.assertEqual(g("SSH-2.0-OpenSSH_for_Windows_9.5", set(), 64, None), ("windows", "SSH"))
        self.assertEqual(g("SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3", set(), 64, None), ("linux", "SSH"))
        self.assertEqual(g("SSH-2.0-OpenSSH_8.0 el9", set(), None, None), ("linux", "SSH"))

    def test_ports_et_mac(self):
        g = netscan.guess_os
        self.assertEqual(g(None, {3389}, None, None)[0], "windows")
        self.assertEqual(g(None, {135, 139, 445}, 128, None)[0], "windows")
        self.assertEqual(g(None, {139, 445}, 64, None), (None, None))        # Samba (Home Assistant, NAS) : pas Windows
        self.assertEqual(g(None, {139, 445}, 128, None)[0], "windows")       # NetBIOS + TTL 128 : Windows
        self.assertEqual(g(None, {139, 445}, None, None), (None, None))
        self.assertEqual(g(None, {548}, 64, None)[0], "macos")
        self.assertEqual(g(None, {62078}, 64, None)[0], "ios")
        self.assertEqual(g(None, set(), 64, "Raspberry Pi"), ("linux", "MAC"))
        self.assertEqual(g("SSH-2.0-OpenSSH_9.6", {5900}, 64, None)[0], "macos")

    def test_ttl_et_doute(self):
        g = netscan.guess_os
        self.assertEqual(g(None, set(), 128, None), ("windows", "TTL"))
        self.assertEqual(g(None, set(), 255, None), ("network", "TTL"))
        self.assertEqual(g(None, set(), 64, None), (None, None))   # Linux ou macOS : on ne dit rien
        self.assertEqual(g(None, {445}, None, None), (None, None))  # SMB seul : Windows ou NAS
        self.assertEqual(g(None, {5900}, 64, None), (None, None))   # VNC seul : n'importe quel système

    def test_describe_remplit_os_sans_changer_les_indices(self):
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p in (135, 445), lookup=lambda ip: ("pc", [], []),
                              banner=lambda ip, p: "", ssh=(22,), ttl=lambda ip: 128, vendor=lambda ip: None)
        self.assertEqual((d["os"], d["os_how"]), ("windows", "ports"))
        self.assertEqual(d["hints"], ["partage SMB"])
        self.assertNotIn(135, d["ports"])


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

    def test_appli_reconnue_par_le_nom_dns(self):
        d = netscan._describe("10.0.0.1", probe=lambda ip, p: p == 443, lookup=lambda ip: ("unifi.lan", [], []),
                              banner=lambda ip, p: p == 22, ssh=(22,), page=lambda ip, p: None)
        self.assertEqual(d["apps"], ["UniFi"])
        self.assertEqual(d["ssh_port"], 22)

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


class Auto(unittest.TestCase):
    """Recherche automatique : la première tout de suite, puis à intervalle régulier."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.file = Path(self.tmp.name) / "network-scan.json"
        netscan._state.update(phase="idle", found=[], ended=None, started=None)

    def test_premiere_recherche_tout_de_suite(self):
        self.assertTrue(netscan.due(self.file, 6, now=10 ** 9))

    def test_tentative_sans_resultat_attend_l_intervalle(self):   # ex. réseau introuvable : aucun fichier écrit, pas de relance chaque minute
        netscan._state.update(started=1000.0, ended=1000.0)
        self.assertFalse(netscan.due(self.file, 6, now=1000 + 60))
        self.assertTrue(netscan.due(self.file, 6, now=1000 + 6 * 3600))

    def test_due_apres_l_intervalle(self):
        self.file.write_text(json.dumps({"phase": "done", "ended": 1000.0, "started": 990.0, "found": []}))
        self.assertFalse(netscan.due(self.file, 6, now=1000 + 5 * 3600))
        self.assertTrue(netscan.due(self.file, 6, now=1000 + 6 * 3600))

    def test_zero_coupe_l_automatique(self):
        self.file.write_text(json.dumps({"phase": "done", "ended": 1.0, "found": []}))
        self.assertFalse(netscan.due(self.file, 0, now=10 ** 9))


class Run(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = Path(self.tmp.name) / "network-scan.json"
        self.addCleanup(self.tmp.cleanup)
        netscan._state.update(phase="idle", found=[], done=0, total=0, error=None, stopped=False)

    def test_trouve_les_machines_qui_repondent(self):
        up = {"192.168.1.10", "192.168.1.2"}
        ok = netscan.start(set(), self.file, ping=lambda ip: ip in up,
                           describe=lambda ip: {"ip": ip, "name": "", "ports": [], "hints": [], "apps": []}, net="192.168.1.0/29")
        self.assertTrue(ok)
        wait_done()
        st = netscan.state(self.file)
        self.assertEqual([f["ip"] for f in st["found"]], ["192.168.1.2"])  # /29 : .1 à .6 ; .10 hors réseau
        self.assertEqual((st["up"], st["described"]), (1, 1))
        self.assertEqual((st["total"], st["done"], st["stopped"], st["error"]), (6, 6, False, None))  # /29 : 6 adresses, aucune exclue
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
        """2e recherche : ce qui a répondu avant et plus maintenant est « disparu », machines déclarées comprises."""
        mk = lambda ip: {"ip": ip, "name": "", "ports": [], "hints": [], "apps": []}  # noqa: E731
        netscan.start(set(), self.file, ping=lambda ip: ip in {"192.168.1.2", "192.168.1.3", "192.168.1.4"}, describe=mk, net="192.168.1.0/29")
        wait_done()
        first_end = netscan.state(self.file)["ended"]
        netscan.start({"192.168.1.4"}, self.file, ping=lambda ip: ip in {"192.168.1.2", "192.168.1.5"}, describe=mk, net="192.168.1.0/29")
        wait_done()
        st = netscan.state(self.file)
        self.assertEqual([h["ip"] for h in st["found"]], ["192.168.1.2", "192.168.1.5"])
        self.assertEqual(st["previous"], ["192.168.1.2", "192.168.1.3", "192.168.1.4"])
        self.assertEqual(st["gone"], ["192.168.1.3", "192.168.1.4"])
        self.assertEqual({h["ip"]: h["known"] for h in st["found"]}, {"192.168.1.2": False, "192.168.1.5": False})
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

    def test_machine_declaree_decrite_et_marquee(self):
        mk = lambda ip: {"ip": ip, "name": "", "ports": [], "hints": [], "apps": [], "ssh_port": 22232}  # noqa: E731
        netscan.start({"192.168.1.2"}, self.file, ping=lambda ip: ip in {"192.168.1.2", "192.168.1.3"}, describe=mk, net="192.168.1.0/29")
        wait_done()
        got = {h["ip"]: h for h in netscan.state(self.file)["found"]}
        self.assertEqual((got["192.168.1.2"]["known"], got["192.168.1.2"]["ssh_port"]), (True, 22232))
        self.assertFalse(got["192.168.1.3"]["known"])

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


class MultiReseauxEtDiscret(unittest.TestCase):
    def test_targets_plusieurs_reseaux_sans_doublon(self):
        t = netscan.targets("192.168.1.0/30, 10.0.0.0/30,192.168.1.0/30")
        self.assertEqual(t, ["192.168.1.1", "192.168.1.2", "10.0.0.1", "10.0.0.2"])

    def test_targets_refuse_plus_grand_qu_un_24(self):
        with self.assertRaises(ValueError):
            netscan.targets("192.168.1.0/24,10.0.0.0/16")

    def test_port_5000_sans_appli_reconnue_n_est_pas_un_indice(self):
        base = dict(probe=lambda ip, p: p in (5000, 445), lookup=lambda ip: ("tower", [], []), banner=lambda ip, p: "", ssh=(22,),
                    ttl=lambda ip: None, vendor=lambda ip: None)
        d = netscan._describe("10.0.0.9", page=lambda ip, p: "Frigate" if p == 5000 else None, **base)
        self.assertEqual((d["hints"], d["apps"]), (["partage SMB"], ["Frigate"]))      # reconnu : c'est l'appli qui le dit
        d = netscan._describe("10.0.0.9", page=lambda ip, p: "MyElectricalData" if p == 5000 else None, **base)
        self.assertEqual((d["hints"], d["apps"]), (["partage SMB"], ["MyElectricalData"]))
        for title in ("Mon appli", None):                                              # inconnu ou muet : plus de « port 5000 »
            d = netscan._describe("10.0.0.9", page=lambda ip, p: title if p == 5000 else None, **base)
            self.assertEqual((d["hints"], d["apps"]), (["partage SMB"], []))

    def test_home_assistant_par_ses_ports(self):
        base = dict(lookup=lambda ip: ("ha", [], []), banner=lambda ip, p: "", ssh=(22,), page=lambda ip, p: None,
                    ttl=lambda ip: None, vendor=lambda ip: None)
        for port in (8123, 4357):
            d = netscan._describe("10.0.0.9", probe=lambda ip, p, port=port: p == port, **base)
            self.assertEqual(d["apps"], ["Home Assistant"], port)
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p == 80, **{**base, "page": lambda ip, p: "Home Assistant"})
        self.assertEqual(d["apps"], ["Home Assistant"])                                # HA servi sur le port 80 : reconnu par sa page

    def test_ports_connus_proxmox_ia_veeam(self):
        base = dict(lookup=lambda ip: ("srv", [], []), banner=lambda ip, p: "", ssh=(22,), page=lambda ip, p: None, ttl=lambda ip: None, vendor=lambda ip: None)
        for port, app in ((8006, "Proxmox VE"), (8007, "Proxmox Backup Server"), (11434, "Ollama"), (1234, "LM Studio"),
                          (32400, "Plex"), (9419, "Veeam Backup & Replication"), (9392, "Veeam Backup & Replication"), (9401, "Veeam Backup & Replication")):
            d = netscan._describe("10.0.0.9", probe=lambda ip, p, port=port: p == port, **base)
            self.assertEqual(d["apps"], [app], port)
            self.assertNotIn(port, [h for h in d["hints"] if isinstance(h, int)])
        # nom DNS « pve » : Proxmox même sans port reconnu
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: False, **{**base, "lookup": lambda ip: ("pve1.lan", [], [])})
        self.assertEqual(d["apps"], ["Proxmox VE"])

    def test_port_8080_lu_par_sa_page(self):
        base = dict(probe=lambda ip, p: p == 8080, lookup=lambda ip: ("gpu", [], []), banner=lambda ip, p: "", ssh=(22,), ttl=lambda ip: None, vendor=lambda ip: None)
        d = netscan._describe("10.0.0.9", page=lambda ip, p: "llama.cpp" if p == 8080 else None, **base)
        self.assertEqual((d["apps"], d["hints"]), (["llama.cpp"], []))
        d = netscan._describe("10.0.0.9", page=lambda ip, p: "Open WebUI" if p == 8080 else None, **base)
        self.assertEqual(d["apps"], ["Open WebUI"])
        d = netscan._describe("10.0.0.9", page=lambda ip, p: "Autre chose" if p == 8080 else None, **base)
        self.assertEqual((d["apps"], d["hints"]), ([], []))   # 8080 seul n'est pas un indice

    def test_nom_devine_sans_dns_netbios_puis_certificat(self):
        base = dict(lookup=lambda ip: (_ for _ in ()).throw(OSError("pas de nom")), banner=lambda ip, p: "", ssh=(22,), page=lambda ip, p: None,
                    ttl=lambda ip: None, vendor=lambda ip: None)
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p == 445, netbios=lambda ip: "GAMER32", cert=lambda ip: "autre", **base)
        self.assertEqual((d["name"], d["name_how"]), ("GAMER32", "netbios"))
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p in (445, 443), netbios=lambda ip: "", cert=lambda ip: "nas", **base)
        self.assertEqual((d["name"], d["name_how"]), ("nas", "certificat"))
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p == 443, netbios=lambda ip: "jamais", cert=lambda ip: "", **base)
        self.assertEqual((d["name"], d["name_how"]), ("", ""))   # NetBIOS n'est pas essayé sans SMB
        d = netscan._describe("10.0.0.9", probe=lambda ip, p: p == 445, netbios=lambda ip: "x", cert=lambda ip: "y",
                              **{**base, "lookup": lambda ip: ("pc.lan", [], [])})
        self.assertEqual((d["name"], d["name_how"]), ("pc", "dns"))   # le DNS passe avant

    def test_nom_plausible(self):
        for good, want in (("DESKTOP-4F2K", "DESKTOP-4F2K"), ("nas.lan", "nas"), ("*.home", ""), ("localhost", ""), ("192.168.1.5", ""),
                           ("", ""), ("a", ""), ("nom avec espace", ""), ("123-456", "")):
            self.assertEqual(netscan._clean_name(good), want, good)

    def test_netbios_lit_la_reponse_d_etat_de_noeud(self):
        import socket as sk
        entries = b"GAMER32        " + b"\x00" + b"\x04\x00" + b"WORKGROUP     " + b"\x00" + b"\x84\x00"   # poste (unique), groupe
        rdata = bytes([2]) + entries + b"\x00" * 6
        reply = (b"\x13\x37\x84\x00\x00\x00\x00\x01\x00\x00\x00\x00" + b"\x20" + b"CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" + b"\x00"
                 + b"\x00\x21\x00\x01" + b"\x00\x00\x00\x00" + len(rdata).to_bytes(2, "big") + rdata)

        class Fake:
            def __init__(self, *a): pass
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def settimeout(self, t): pass
            def sendto(self, data, addr): self.sent = (data, addr)
            def recvfrom(self, n): return reply, ("10.0.0.9", 137)
        real = sk.socket
        sk.socket = Fake
        try:
            self.assertEqual(netscan._netbios_name("10.0.0.9"), "GAMER32")
        finally:
            sk.socket = real

    def test_describe_discret_ne_devine_pas_par_ttl(self):
        args = dict(probe=lambda ip, p: False, lookup=lambda ip: ("x",), banner=lambda ip, p: None, page=lambda ip, p: None)
        self.assertEqual(netscan._describe("1.2.3.4", ttl=lambda ip: 128, **args)["os"], "windows")
        self.assertIsNone(netscan._describe("1.2.3.4", ttl=lambda ip: None, vendor=lambda ip: None, **args)["os"])


if __name__ == "__main__":
    unittest.main()
