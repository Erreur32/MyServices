"""Vérification d'une machine (bouton « Tester » de la carte « Autoriser la clé ») : un accès SSH qui répond
doit invalider l'inventaire Docker en cache, sinon la collecte suivante rejoue le relevé raté d'avant la clé.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import machines_admin  # noqa: E402


class CheckExpiresInventory(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name) / "docker.json"
        self.cache.write_text(json.dumps({"ts": 1791636409.0, "data": {"10.0.0.1": None}}), encoding="utf-8")
        p = mock.patch.dict("config.CFG", {"cache_dir": self.tmp.name})
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def run_check(self, failed):
        def fake_check(ip, m, aliases):
            if failed:
                machines_admin.setup.FAILED.append("ssh")
        with mock.patch.object(machines_admin, "_meta", return_value={"machines": {"10.0.0.1": {}}}), \
                mock.patch.object(machines_admin.setup, "check_machine", fake_check), \
                mock.patch.object(machines_admin.setup, "ssh_aliases", return_value={}):
            return machines_admin.check("10.0.0.1")

    def test_machine_designee_par_son_nom(self):
        """Le bouton « Tester » envoie le nom du connecteur (nom de la machine), pas son IP."""
        meta = {"machines": {"10.0.0.1": {"name": "dev"}}}
        seen = []
        with mock.patch.object(machines_admin, "_meta", return_value=meta), \
                mock.patch.object(machines_admin.setup, "check_machine", lambda ip, m, a: seen.append(ip)), \
                mock.patch.object(machines_admin.setup, "ssh_aliases", return_value={}):
            self.assertEqual(machines_admin.check("dev")["failed"], 0)
            self.assertEqual(machines_admin.check("10.0.0.1")["failed"], 0)
            with self.assertRaises(machines_admin.MachineError):
                machines_admin.check("inconnue")
        self.assertEqual(seen, ["10.0.0.1", "10.0.0.1"])

    def test_ssh_ok_expire_le_cache(self):
        self.assertEqual(self.run_check(failed=False)["failed"], 0)
        c = json.loads(self.cache.read_text())
        self.assertEqual((c["ts"], c["stale"]), (1791636409.0, ["10.0.0.1"]))  # cette machine seule sera relue, le reste reste en cache

    def test_ssh_en_echec_garde_le_cache(self):
        self.assertEqual(self.run_check(failed=True)["failed"], 1)
        self.assertEqual(json.loads(self.cache.read_text())["ts"], 1791636409.0)


class PortRefuse(unittest.TestCase):
    """Connexion refusée : ce n'est pas la clé, c'est le port. La vérification le dit, avec le port vu par la recherche réseau."""

    def check(self, alias_port, scanned):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            conf = Path(d) / "config"
            conf.write_text(f"Host m-10-0-0-1\n    HostName 10.0.0.1\n    User debian32\n    Port {alias_port}\n", encoding="utf-8")

            def fake_check(ip, m, aliases):
                print("⚠ Serveur (10.0.0.1) : SSH m-10-0-0-1 : ssh: connect to host 10.0.0.1 port 22: Connection refused")
            with mock.patch.object(machines_admin, "_meta", return_value={"machines": {"10.0.0.1": {"name": "Serveur", "ssh": "m-10-0-0-1"}}}), \
                    mock.patch.object(machines_admin.setup, "check_machine", fake_check), \
                    mock.patch.object(machines_admin.setup, "ssh_aliases", return_value={"10.0.0.1": "m-10-0-0-1"}), \
                    mock.patch.object(machines_admin.setup, "SSH_CONF", str(conf)), \
                    mock.patch.object(machines_admin, "scan_ssh_port", return_value=scanned):
                machines_admin.setup.FAILED.clear()
                return machines_admin.check("Serveur")

    def test_autre_port_vu_par_la_recherche_reseau(self):
        r = self.check(22, 22232)
        self.assertEqual(r["failed"], 1)                       # une connexion refusée n'est plus comptée « ça marche »
        self.assertIn("22232", r["lines"][-1])
        self.assertIn("corriger le port", r["lines"][-1])

    def test_meme_port_refuse_pas_de_conseil_de_port(self):
        r = self.check(22, 22)
        self.assertEqual(r["failed"], 1)
        self.assertIn("sshd n'écoute pas là", r["lines"][-1])

    def test_resolve_par_nom_ou_ip(self):
        meta = {"machines": {"10.0.0.1": {"name": "dev"}, "10.0.0.2": {"name": "twin"}, "10.0.0.3": {"name": "twin"}}}
        with mock.patch.object(machines_admin, "_meta", return_value=meta):
            self.assertEqual(machines_admin.resolve("dev"), "10.0.0.1")
            self.assertEqual(machines_admin.resolve("10.0.0.2"), "10.0.0.2")
            with self.assertRaises(machines_admin.MachineError):
                machines_admin.resolve("twin")                  # deux machines du même nom : utiliser l'IP
            with self.assertRaises(machines_admin.MachineError):
                machines_admin.resolve("inconnue")


class IconField(unittest.TestCase):
    def test_icone_choisie_validee_et_gardee(self):
        self.assertEqual(machines_admin._clean({"name": "pc", "icon": "home-assistant"})["icon"], "home-assistant")
        self.assertNotIn("icon", machines_admin._clean({"name": "pc", "icon": ""}))   # vide = automatique
        for bad in ("../x", "Home Assistant", "a b", "<img>", "-x", "x-"):
            with self.assertRaises(machines_admin.MachineError):
                machines_admin._clean({"name": "pc", "icon": bad})


class Redetection(unittest.TestCase):
    """redetect() : les écarts entre les réglages enregistrés et la détection refaite, sans rien écrire."""

    def run_redetect(self, machines, detect_d, info=None, ports=None, ph=None, ips=None, gw="10.0.0.1", tags=None):
        meta = {"machines": machines, "process_hosts": ph or {}}
        d = {"up": True, "hints": [], "machine": {}, **detect_d}
        with mock.patch.object(machines_admin, "_meta", return_value=meta), \
                mock.patch.object(machines_admin, "detect", return_value=d), \
                mock.patch.object(machines_admin.hostinfo, "host_info", return_value=info), \
                mock.patch.object(machines_admin.hostinfo, "default_gateway", return_value=gw), \
                mock.patch.object(machines_admin, "_seen_tags", side_effect=lambda ip: list((tags or {}).get(ip, []))), \
                mock.patch("connectors.process.listening_processes", return_value=ports or {}), \
                mock.patch.object(machines_admin.setup, "save") as sv:
            out = machines_admin.redetect(ips)
        sv.assert_not_called()
        return {r["ip"]: r for r in out["machines"]}, out

    def test_drapeaux_a_allumer_et_service_hors_docker(self):
        r, out = self.run_redetect({"10.0.0.1": {"name": "box", "ssh": "box"}}, {}, info={"virt": "kvm", "npm": True},
                                   ports={8080: {"name": "app", "lan": True}, 9000: {"name": "loc", "lan": False}})
        x = r["10.0.0.1"]
        self.assertEqual(set(x["flags_on"]), {"gateway", "vm"})   # « npm » is set by the collection, never proposed
        self.assertEqual(x["flags_off"], [])
        self.assertTrue(x["process"])
        self.assertEqual([p["port"] for p in x["ports"]], [8080])
        self.assertEqual(out["changes"], 1)

    def test_drapeaux_a_eteindre_si_lu_par_ssh(self):
        m = {"name": "a", "ssh": "a", "vm": True, "npm": True, "gateway": True}
        r, _ = self.run_redetect({"10.0.0.5": m}, {}, info={"virt": None, "npm": False}, ports={}, ph={"10.0.0.5": "a"})
        self.assertEqual(set(r["10.0.0.5"]["flags_off"]), {"vm", "gateway"})

    def test_sans_ssh_rien_n_est_eteint(self):
        r, _ = self.run_redetect({"10.0.0.5": {"name": "a", "vm": True}}, {}, info=None)
        self.assertEqual(r["10.0.0.5"]["flags_off"], [])
        self.assertEqual(r["10.0.0.5"]["note"], "rien à changer")

    def test_ssh_muet_rien_n_est_eteint(self):
        r, _ = self.run_redetect({"10.0.0.5": {"name": "a", "ssh": "a", "vm": True}}, {}, info=None)
        self.assertEqual(r["10.0.0.5"]["flags_off"], [])

    def test_windows_off_et_systeme(self):
        r, _ = self.run_redetect({"10.0.0.9": {"name": "pc"}}, {"hints": ["Windows (RDP)"]})
        x = r["10.0.0.9"]
        self.assertEqual((x["os"], x["flags_on"]), ("windows", ["off"]))

    def test_injoignable_non_verifiable(self):
        r, out = self.run_redetect({"10.0.0.7": {"name": "x", "ssh": "x", "vm": True}}, {"up": False}, info={"virt": None})
        x = r["10.0.0.7"]
        self.assertFalse(x["verifiable"])
        self.assertEqual((x["flags_on"], x["flags_off"], x["os"], x["process"]), ([], [], None, False))
        self.assertIn("non vérifiable", x["note"])
        self.assertEqual(out["changes"], 0)

    def test_machine_desactivee_ignoree(self):
        r, _ = self.run_redetect({"10.0.0.7": {"name": "x", "disabled": True}}, {})
        self.assertEqual(r, {})

    def test_rien_a_changer(self):
        m = {"name": "a", "ssh": "a", "vm": True}
        r, out = self.run_redetect({"10.0.0.5": m}, {}, info={"virt": "kvm", "npm": False}, ports={}, ph={})
        self.assertEqual(r["10.0.0.5"]["note"], "rien à changer")
        self.assertEqual(out["changes"], 0)

    def test_liste_donnee_et_machine_inconnue(self):
        ms = {"10.0.0.5": {"name": "a"}, "10.0.0.6": {"name": "b"}}
        r, _ = self.run_redetect(ms, {}, ips=["10.0.0.6"])
        self.assertEqual(list(r), ["10.0.0.6"])
        with self.assertRaises(machines_admin.MachineError):
            self.run_redetect(ms, {}, ips=["10.0.0.99"])

    def test_etiquettes_du_role_mises_a_jour(self):
        """Port 5000 enregistré à l'époque, applis vues aujourd'hui : on propose d'ajouter l'appli et de retirer l'indice périmé."""
        m = {"10.0.0.2": {"name": "ha", "role": "SSH :22232, partage SMB, port 5000, ma note"}}
        seen = {"10.0.0.2": ["Home Assistant", "SSH :22232", "partage SMB"]}
        rs, out = self.run_redetect(m, {"hints": []}, tags=seen)
        self.assertEqual((rs["10.0.0.2"]["role_add"], rs["10.0.0.2"]["role_remove"]), (["Home Assistant"], ["port 5000"]))  # « ma note » reste
        self.assertIsNone(rs["10.0.0.2"]["note"])
        self.assertEqual(out["changes"], 1)

    def test_etiquette_automatique_disparue_retiree_mais_pas_le_texte_saisi(self):
        add, remove = machines_admin.role_changes("Plex, Ollama, mon NAS perso, web :5000 · Mon appli", ["Plex"])
        self.assertEqual(add, [])
        self.assertEqual(remove, ["Ollama", "web :5000 · Mon appli"])  # Ollama : appli connue qu'on ne voit plus ; « mon NAS perso » est de vous

    def test_rien_a_changer_quand_le_role_correspond(self):
        rs, _ = self.run_redetect({"10.0.0.3": {"name": "pc", "role": "SSH, partage SMB"}}, {"hints": []}, tags={"10.0.0.3": ["partage SMB", "SSH"]})
        self.assertEqual(rs["10.0.0.3"]["note"], "rien à changer")


class SshAlias(unittest.TestCase):
    """Préparer l'accès SSH d'une machine trouvée : bloc « Host » avec la clé de l'app, sans doublon."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.conf = Path(self.tmp.name) / "config"
        self.aliases = {}
        for p in (mock.patch.object(machines_admin.setup, "SSH_CONF", str(self.conf)),
                  mock.patch.object(machines_admin.setup, "DOCKER", True),
                  mock.patch.object(machines_admin.setup, "ssh_aliases", lambda: self.aliases)):
            p.start()
            self.addCleanup(p.stop)

    def test_cree_un_alias(self):
        r = machines_admin.add_alias("192.168.1.20", "pi", 2222)
        self.assertEqual(r, {"alias": "m-192-168-1-20", "created": True})
        txt = self.conf.read_text()
        for line in ("Host m-192-168-1-20", "HostName 192.168.1.20", "User pi", "Port 2222", "IdentityFile ~/.ssh/myservices",
                     "IdentitiesOnly yes", "StrictHostKeyChecking accept-new"):
            self.assertIn(line, txt)
        self.assertEqual(self.conf.stat().st_mode & 0o777, 0o600)

    def test_adresse_ssh_differente(self):
        """A server reached through another address: HostName is the DNS name, and the alias is found again through the machine's settings."""
        r = machines_admin.add_alias("192.168.1.20", "debian", 22232, host="srv.example.org")
        self.assertEqual(r, {"alias": "m-192-168-1-20", "created": True})
        self.assertIn("HostName srv.example.org", self.conf.read_text())
        conf = {"srv.example.org": {"alias": "m-192-168-1-20", "port": 22232, "user": "debian"}}
        meta = {"machines": {"192.168.1.20": {"name": "srv", "ssh": "m-192-168-1-20"}}}
        with mock.patch.object(machines_admin.hostinfo, "ssh_config", return_value=conf), mock.patch.object(machines_admin, "_meta", return_value=meta):
            r = machines_admin.add_alias("192.168.1.20", "debian", 2222, host="10.9.9.9")
            self.assertEqual(r, {"alias": "m-192-168-1-20", "created": False, "updated": True})
        txt = self.conf.read_text()
        self.assertIn("HostName 10.9.9.9", txt)
        self.assertIn("Port 2222", txt)
        with self.assertRaises(machines_admin.MachineError):
            machines_admin.add_alias("192.168.1.20", "debian", 22, host="bad host!")

    def test_alias_existant_repris(self):
        self.aliases["192.168.1.20"] = "nas"
        self.assertEqual(machines_admin.add_alias("192.168.1.20"), {"alias": "nas", "created": False, "updated": False})
        self.assertFalse(self.conf.exists())

    def test_refus(self):
        for args in (("pas-une-ip",), ("192.168.1.20", "Root; rm"), ("192.168.1.20", "root", 0), ("192.168.1.20", "root", 70000)):
            with self.assertRaises(machines_admin.MachineError, msg=args):
                machines_admin.add_alias(*args)

    def test_hors_docker(self):
        with mock.patch.object(machines_admin.setup, "DOCKER", False), self.assertRaises(machines_admin.MachineError):
            machines_admin.add_alias("192.168.1.20")

    def test_retrait_apres_abandon(self):
        """Add cancelled in the page: the block written by add_alias goes away, a hand-written alias stays."""
        self.conf.write_text("Host nas\n    HostName 192.168.1.5\n", encoding="utf-8")
        machines_admin.add_alias("192.168.1.20", "pi", 2222)
        self.aliases["192.168.1.20"] = "m-192-168-1-20"
        with mock.patch.object(machines_admin, "_meta", return_value={"machines": {}}):
            self.assertEqual(machines_admin.remove_alias("192.168.1.20"), {"removed": True})
        self.assertEqual(self.conf.read_text(), "Host nas\n    HostName 192.168.1.5\n")
        self.aliases["192.168.1.5"] = "nas"
        with mock.patch.object(machines_admin, "_meta", return_value={"machines": {}}):
            self.assertEqual(machines_admin.remove_alias("192.168.1.5"), {"removed": False})
        with self.assertRaises(machines_admin.MachineError):
            machines_admin.remove_alias("pas-une-ip")

    def test_retrait_refuse_si_machine_declaree(self):
        self.aliases["192.168.1.20"] = "m-192-168-1-20"
        meta = {"machines": {"192.168.1.20": {"name": "pi", "ssh": "m-192-168-1-20"}}}
        with mock.patch.object(machines_admin, "_meta", return_value=meta):
            self.assertEqual(machines_admin.remove_alias("192.168.1.20"), {"removed": False})

    def test_test_avant_ajout(self):
        """The access of a machine not declared yet is checked with a synthetic machine (Linux: ssh, Windows: health)."""
        seen = []

        def fake_check(ip, m, aliases):
            seen.append(m)
            print("✓ ok")
        with self.assertRaises(machines_admin.MachineError):
            machines_admin.probe_alias("192.168.1.20")
        self.aliases["192.168.1.20"] = "m-192-168-1-20"
        with mock.patch.object(machines_admin.setup, "check_machine", fake_check):
            self.assertEqual(machines_admin.probe_alias("192.168.1.20"), {"lines": ["✓ ok"], "failed": 0})
            machines_admin.probe_alias("192.168.1.20", windows=True)
        self.assertEqual(seen, [{"name": "192.168.1.20", "ssh": "m-192-168-1-20"}, {"name": "192.168.1.20", "os": "windows", "health": "m-192-168-1-20"}])


class DetectionDesReglages(unittest.TestCase):
    """Passerelle, NPM et machine virtuelle sont cochées d'après la détection (à confirmer dans la page)."""

    def test_npm_vu_dans_les_conteneurs(self):
        conts = [("npm", "jc21/nginx-proxy-manager:latest", ""), ("autre", "nginx", "")]
        self.assertTrue(machines_admin.setup.roles(conts)["npm"])
        self.assertNotIn("npm", machines_admin.setup.roles([("web", "nginx", "")]))

    def test_passerelle_par_defaut(self):
        out = mock.Mock(stdout="default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.5 metric 100\n")
        with mock.patch.object(machines_admin.subprocess, "run", return_value=out):
            self.assertEqual(machines_admin.default_gateway(), "192.168.1.1")
        with mock.patch.object(machines_admin.subprocess, "run", return_value=mock.Mock(stdout="")):
            self.assertIsNone(machines_admin.default_gateway())

    def test_detect_coche_la_passerelle_sans_ecraser_un_choix(self):
        def run(ip_known):
            with mock.patch.object(machines_admin, "_resolve", return_value=("192.168.1.1", None)), \
                    mock.patch.object(machines_admin, "_meta", return_value={"machines": {"192.168.1.1": ip_known} if ip_known else {}}), \
                    mock.patch.object(machines_admin, "default_gateway", return_value="192.168.1.1"), \
                    mock.patch.object(machines_admin.setup, "identify", return_value=("box", [])), \
                    mock.patch.object(machines_admin.setup, "_open", return_value=False), \
                    mock.patch.object(machines_admin.subprocess, "run", return_value=mock.Mock(returncode=0)):
                return machines_admin.detect("192.168.1.1")
        d = run(None)
        self.assertTrue(d["machine"]["gateway"])
        self.assertEqual(d["detected"], ["gateway"])
        d = run({"name": "box", "gateway": False})  # choix explicite de l'auteur : gardé
        self.assertFalse(d["machine"]["gateway"])
        self.assertEqual(d["detected"], [])

    def test_detect_ne_coche_pas_souvent_eteinte_pour_un_serveur_windows(self):
        def run(dns):
            with mock.patch.object(machines_admin, "_resolve", return_value=("10.0.0.9", None)), \
                    mock.patch.object(machines_admin, "_meta", return_value={"machines": {}}), \
                    mock.patch.object(machines_admin, "default_gateway", return_value="10.0.0.1"), \
                    mock.patch.object(machines_admin.setup, "identify", return_value=(dns, ["Windows (WinRM)", "Windows (RDP)"])), \
                    mock.patch.object(machines_admin.setup, "_open", return_value=False), \
                    mock.patch.object(machines_admin.subprocess, "run", return_value=mock.Mock(returncode=0)):
                return machines_admin.detect("10.0.0.9")["machine"]
        self.assertNotIn("off", run("WIN-L50HGL065P6"))       # Windows Server: must stay on, an outage deserves an alert
        self.assertTrue(run("DESKTOP-4F2K9QA")["off"])         # a PC is often switched off
        self.assertTrue(run("gamer32")["off"])


class MachineNonSuivie(unittest.TestCase):
    def test_le_drapeau_disabled_est_garde_par_la_page(self):
        out = machines_admin._clean({"name": "PC", "disabled": True, "off": False})
        self.assertTrue(out["disabled"])
        self.assertNotIn("off", out)
        self.assertNotIn("disabled", machines_admin._clean({"name": "PC", "disabled": False}))

    def test_la_sante_saute_une_machine_non_suivie(self):
        import health
        meta = {"machines": {"10.0.0.1": {"name": "A", "ssh": "a"}, "10.0.0.2": {"name": "B", "ssh": "b", "disabled": True}}}
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "m.json"
            f.write_text(json.dumps(meta), encoding="utf-8")
            with mock.patch.dict(health.CFG, {"meta": str(f)}):
                hosts, _ = health.load_hosts()
        self.assertEqual([h["ip"] for h in hosts], ["10.0.0.1"])


class ReglagesDetectes(unittest.TestCase):
    """La collecte dit quels interrupteurs de machine sont confirmés par la détection (les autres sont grisés dans la page)."""

    def flags(self, ip, info, os_=None, gw="10.0.0.1"):
        import hostinfo
        with mock.patch.object(hostinfo, "default_gateway", return_value=gw):
            return hostinfo.detected_flags(ip, info, {"os": os_} if os_ else {})

    def test_passerelle_vm_npm_windows(self):
        self.assertEqual(self.flags("10.0.0.1", {}), ["gateway"])
        self.assertEqual(self.flags("10.0.0.5", {"virt": "kvm", "npm": True}), ["vm", "npm"])
        self.assertEqual(self.flags("10.0.0.9", None, os_="windows"), ["off"])
        self.assertEqual(self.flags("10.0.0.7", {"virt": None, "npm": False}), [])

    def test_vm_windows_reconnue_par_le_modele_de_l_agent(self):
        import hostinfo
        for maker, model in (("QEMU", "Standard PC (i440FX + PIIX, 1996)"), ("VMware, Inc.", "VMware7,1"), ("Microsoft Corporation", "Virtual Machine"),
                             ("innotek GmbH", "VirtualBox")):
            self.assertTrue(hostinfo.is_vm_hardware({"maker": maker, "model": model}), model)
        for maker, model in (("ASUS", "ROG STRIX Z790-E"), ("Microsoft Corporation", "Surface Laptop 5"), (None, None)):
            self.assertFalse(hostinfo.is_vm_hardware({"maker": maker, "model": model}), model)
        self.assertFalse(hostinfo.is_vm_hardware(None))
        with mock.patch.object(hostinfo, "default_gateway", return_value="10.0.0.1"):
            self.assertEqual(hostinfo.detected_flags("10.0.0.9", None, {"os": "windows"}, {"maker": "QEMU", "model": "Standard PC (Q35 + ICH9, 2009)"}), ["vm", "off"])

    def test_infos_machine_lit_virt_et_npm(self):
        import hostinfo
        out = "##OS Debian\n##KERNEL 6.1\n##UP 10\n##SVC apache2=inactive nginx=inactive\n##SSHDR no\n##SSHD\n##DOCKER 2\n##VIRT kvm\n##NPM 1\n"
        with mock.patch.object(hostinfo.subprocess, "run", return_value=mock.Mock(returncode=0, stdout=out)):
            info = hostinfo.host_info("x")
        self.assertEqual((info["virt"], info["npm"]), ("kvm", True))
        with mock.patch.object(hostinfo.subprocess, "run", return_value=mock.Mock(returncode=0, stdout=out.replace("kvm", "none").replace("NPM 1", "NPM 0"))):
            info = hostinfo.host_info("x")
        self.assertEqual((info["virt"], info["npm"]), (None, False))


class PingTtl(unittest.TestCase):
    def test_ttl_de_la_reponse_au_ping(self):
        import hostinfo
        self.assertEqual(hostinfo.ping_ttl("64 bytes from 10.0.0.9: icmp_seq=1 ttl=128 time=0.6 ms\n"), 128)
        self.assertEqual(hostinfo.ping_ttl("64 bytes from x: TTL=64 time=1 ms"), 64)
        self.assertIsNone(hostinfo.ping_ttl(""))
        self.assertIsNone(hostinfo.ping_ttl(None))


class AliasWindows(unittest.TestCase):
    """Un PC Windows prend le compte Windows : l'alias « m-<ip> » créé en root par défaut est mis à jour, jamais un alias écrit à la main."""

    CONF = ("Host perso\n    HostName 10.0.0.9\n    User moi\n    Port 2222\n\n"
            "# Machine trouvée par la recherche réseau\nHost m-10-0-0-5\n    HostName 10.0.0.5\n    User root\n    Port 22\n"
            "    IdentityFile ~/.ssh/myservices\n")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conf = Path(self.tmp.name) / "config"
        self.conf.write_text(self.CONF, encoding="utf-8")
        self.addCleanup(self.tmp.cleanup)

    def run_set(self, alias, user, port=22):
        with mock.patch.object(machines_admin.setup, "SSH_CONF", str(self.conf)):
            return machines_admin._set_alias_user(alias, user, port)

    def test_alias_de_la_page_passe_au_compte_windows(self):
        self.assertTrue(self.run_set("m-10-0-0-5", "Jean.Dupont"))
        text = self.conf.read_text(encoding="utf-8")
        self.assertIn("Host m-10-0-0-5\n    HostName 10.0.0.5\n    User Jean.Dupont\n    Port 22", text)
        self.assertIn("User moi\n    Port 2222", text)  # l'autre alias n'est pas touché
        self.assertFalse(self.run_set("m-10-0-0-5", "Jean.Dupont"))  # rien à changer

    def test_alias_ecrit_a_la_main_jamais_modifie(self):
        self.assertFalse(self.run_set("perso", "root"))
        self.assertIn("User moi", self.conf.read_text(encoding="utf-8"))

    def test_comptes_windows_acceptes_et_injection_refusee(self):
        for ok in ("Administrateur", "Jean.Dupont", "user_1"):
            self.assertTrue(machines_admin._ALIAS_USER.match(ok), ok)
        for bad in ("a b", "x\nHost evil", "-oProxyCommand=x", "1abc", ""):
            self.assertFalse(machines_admin._ALIAS_USER.match(bad), bad)


if __name__ == "__main__":
    unittest.main()
