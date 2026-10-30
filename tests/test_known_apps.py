"""known_apps.py : reconnaître une appli d'après son image, sa page ou son port.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import connectors  # noqa: E402
from msv.machines import known_apps as ka  # noqa: E402


class Identify(unittest.TestCase):
    def key(self, **kw):
        r = ka.identify(**kw)
        return (r[0].key, r[1]) if r else None

    def test_image_est_sure(self):
        self.assertEqual(self.key(image="jc21/nginx-proxy-manager:2.12.3"), ("npm", ka.SURE))
        self.assertEqual(self.key(image="docker.io/adguard/adguardhome:v0.107.50"), ("adguard", ka.SURE))
        self.assertEqual(self.key(image="ghcr.io/home-assistant/home-assistant:stable"), ("homeassistant", ka.SURE))
        self.assertEqual(self.key(image="lscr.io/linuxserver/sonarr:latest"), ("sonarr", ka.SURE))

    def test_images_des_connecteurs_reprises(self):
        """Une image déclarée par un connecteur est reconnue sans être recopiée dans la table."""
        for t, cls in connectors.TYPES.items():
            for img in cls.images:
                found = ka.identify(image=img)
                self.assertIsNotNone(found, img)
                self.assertEqual(found[0].connector, t)

    def test_titre_est_probable(self):
        self.assertEqual(self.key(title="Nginx Proxy Manager"), ("npm", ka.PROBABLE))
        self.assertEqual(self.key(title="Uptime Kuma"), ("uptime-kuma", ka.PROBABLE))
        self.assertEqual(self.key(title="Apache2 Debian Default Page: It works"), ("apache", ka.PROBABLE))
        self.assertEqual(self.key(title="Login to Webmin"), ("webmin", ka.PROBABLE))
        self.assertEqual(self.key(title="Windows Admin Center"), ("wac", ka.PROBABLE))
        self.assertEqual([a.key for a in ka.apps_from_services([{"name": "ServerManagementGateway", "display": "Windows Admin Center"}])], ["wac"])

    def test_port_distinctif_est_possible(self):
        self.assertEqual(self.key(port=8384), ("syncthing", ka.POSSIBLE))
        self.assertEqual(self.key(port=32400), ("plex", ka.POSSIBLE))
        self.assertEqual(self.key(port=20443), ("wac", ka.POSSIBLE))

    def test_port_courant_ne_designe_rien(self):
        for port in (80, 443, 3000, 8080, 8090, 9000, 9090):
            self.assertIsNone(self.key(port=port), port)

    def test_empreinte_http_probable_sans_ssh(self):
        self.assertEqual(self.key(fingerprint="server: nginx\nheaders: content-type x-pi-hole server"), ("pihole", ka.PROBABLE))
        self.assertEqual(self.key(fingerprint="headers: x-transmission-session-id"), ("transmission", ka.PROBABLE))
        self.assertEqual(self.key(fingerprint="headers: set-cookie\ncookies: oc_sessionpassphrase"), ("nextcloud", ka.PROBABLE))
        self.assertEqual(self.key(fingerprint="cookies: i_like_gitea _csrf"), ("gitea", ka.PROBABLE))

    def test_serveur_web_seul_n_est_que_possible_et_cede_au_port(self):
        self.assertEqual(self.key(fingerprint="server: nginx/1.25.3\nheaders: server"), ("nginx-web", ka.POSSIBLE))
        self.assertEqual(self.key(fingerprint="server: caddy"), ("caddy-web", ka.POSSIBLE))
        self.assertEqual(self.key(fingerprint="server: nginx", port=8384), ("syncthing", ka.POSSIBLE))   # le port est plus parlant qu'un serveur web
        self.assertEqual(self.key(fingerprint="server: nginx", title="Netdata"), ("netdata", ka.PROBABLE))  # un titre prime sur l'empreinte
        self.assertEqual(self.key(fingerprint="server: nginx\nheaders: x-pi-hole", port=12345), ("pihole", ka.PROBABLE))   # l'appli prime sur le serveur web

    def test_nouveaux_ports_distinctifs(self):
        for port, key in ((8086, "influxdb"), (1880, "nodered"), (9696, "prowlarr"), (9091, "transmission"), (8200, "vault"), (5601, "kibana")):
            self.assertEqual(self.key(port=port), (key, ka.POSSIBLE), port)

    def test_image_prime_sur_titre_et_titre_sur_port(self):
        self.assertEqual(self.key(image="grafana/grafana", title="Plex", port=8384), ("grafana", ka.SURE))
        self.assertEqual(self.key(title="Netdata", port=8384), ("netdata", ka.PROBABLE))

    def test_nom_de_la_machine(self):
        self.assertEqual(self.key(name="unifi"), ("unifi", ka.PROBABLE))
        self.assertEqual(self.key(name="UDM-Pro"), ("unifi", ka.PROBABLE))
        self.assertEqual(self.key(name="proxmox"), ("proxmox", ka.PROBABLE))
        self.assertIsNone(self.key(name="gamer32"))
        self.assertEqual(self.key(title="UniFi Network"), ("unifi", ka.PROBABLE))
        self.assertEqual(ka.APPS[[a.key for a in ka.APPS].index("unifi")].connector, "unifi")

    def test_liste_de_fichiers_generique_n_est_pas_apache(self):
        self.assertIsNone(self.key(title="Index of /"))

    def test_agent_dozzle_meme_image_autre_port(self):
        """Same image as Dozzle: the container port 7007 makes it the agent, which has no page and proposes no connector."""
        self.assertEqual(self.key(image="amir20/dozzle:latest", inner=8080), ("dozzle", ka.SURE))
        self.assertEqual(self.key(image="amir20/dozzle:latest"), ("dozzle", ka.SURE))
        self.assertEqual(self.key(image="amir20/dozzle:latest", inner=7007), ("dozzle-agent", ka.SURE))
        self.assertEqual(self.key(port=7007), ("dozzle-agent", ka.POSSIBLE))   # open port seen by the network scan, without SSH

    def test_agents_par_image_process_ou_port(self):
        self.assertEqual(self.key(image="henrygd/beszel-agent:latest"), ("beszel-agent", ka.SURE))
        self.assertEqual(self.key(image="henrygd/beszel:latest"), ("beszel", ka.SURE))
        self.assertEqual(self.key(proc="beszel-agent"), ("beszel-agent", ka.PROBABLE))
        self.assertEqual(self.key(port=45876), ("beszel-agent", ka.POSSIBLE))
        self.assertEqual(self.key(image="ghcr.io/finsys/hawser:latest"), ("hawser", ka.SURE))
        self.assertEqual(self.key(proc="hawser"), ("hawser", ka.PROBABLE))
        self.assertEqual(self.key(image="ghcr.io/getarcaneapp/agent:latest"), ("arcane-agent", ka.SURE))
        self.assertIsNone(self.key(port=2376))   # Docker TLS: not Hawser on its own
        for a in ka.APPS:
            if a.agent_of:
                self.assertIn(a.ui, ("none", "api"), a.key)   # no page of its own
                self.assertIsNone(a.connector, a.key)
                self.assertIn(a.agent_of, {b.key for b in ka.APPS}, a.key)   # the hub's label is shown on the agent

    def test_annotate_agent(self):
        row = {"port": 7007, "category": "Autre", "web": None, "name": "dozzle-agent",
               "service": {"kind": "docker", "name": "dozzle-agent", "image": "amir20/dozzle:latest", "inner": 7007}}
        ka.annotate(row)
        self.assertEqual(row["app"]["key"], "dozzle-agent")
        self.assertEqual(row["app"]["agent_of"], "Dozzle")
        self.assertIsNone(row["app"]["connector"])
        self.assertEqual((row["category"], row["web"]), ("Monitoring", "none"))
        self.assertEqual(ka.propose([{**row, "ip": "10.0.0.5", "id": 1}], []), [])   # never proposed as a Dozzle server

    def test_process_lu_par_ssh(self):
        row = {"port": 45876, "category": "Autre", "web": None, "service": {"kind": "process", "name": "beszel-agent"}}
        ka.annotate(row)
        self.assertEqual((row["app"]["key"], row["app"]["confidence"]), ("beszel-agent", ka.PROBABLE))
        self.assertEqual(self.key(proc="sshd"), ("openssh", ka.PROBABLE))
        self.assertEqual(self.key(proc="glances"), ("glances", ka.PROBABLE))
        self.assertIsNone(self.key(proc="python3"))

    def test_categories_connues(self):
        """Every app category exists in the default list, otherwise the row lands in a category nobody filters on."""
        import json
        with open(Path(__file__).resolve().parent.parent / "services-meta.example.json", encoding="utf-8") as f:
            cats = {name for name, _ in json.load(f)["categories"]}
        self.assertEqual({a.category for a in ka.APPS} - cats, set())

    def test_inconnu(self):
        self.assertIsNone(self.key(image="postgres:16", title="Mon appli", port=12345))
        self.assertIsNone(self.key())

    def test_tableau_coherent(self):
        keys = [a.key for a in ka.APPS]
        self.assertEqual(len(keys), len(set(keys)), "clés en double")
        for a in ka.APPS:
            if a.connector:
                self.assertIn(a.connector, connectors.TYPES, a.key)
            self.assertIn(a.ui, ("ui", "api", "none"))


class Windows(unittest.TestCase):
    SVC = [{"name": "PlexUpdateService", "display": "Plex Update Service"}, {"name": "AdGuardHome", "display": "AdGuard Home"},
           {"name": "Spooler", "display": "Print Spooler"}, {"name": "Sonarr", "display": ""}, {"name": "Tailscale", "display": "Tailscale"}]

    def test_applis_reconnues_par_leurs_services(self):
        apps = ka.apps_from_services(self.SVC)
        self.assertEqual([a.key for a in apps], ["plex", "adguard", "sonarr"])        # le spooler et Tailscale ne désignent rien ici
        self.assertEqual(ka.apps_from_services([]), [])
        self.assertEqual(len(ka.apps_from_services(self.SVC + self.SVC)), 3)           # sans doublon

    def test_propositions_pour_un_pc(self):
        apps = ka.apps_from_services(self.SVC)
        got = {p["connector"]: p for p in ka.propose_windows("10.0.0.8", "PC", apps, {3000: {"name": "AdGuardHome", "lan": True}}, [])}
        self.assertEqual(got["adguard"]["url"], "http://10.0.0.8:3000")
        self.assertEqual((got["adguard"]["via"], got["adguard"]["machine"]), ("service Windows", "PC"))
        self.assertEqual(got["arr"]["url"], "http://10.0.0.8:8989")                    # port par défaut de Sonarr, même s'il n'écoute pas encore
        self.assertNotIn("plex", got)                                                  # Plex n'a pas de connecteur : reconnu, pas proposé
        declared = [{"type": "adguard", "name": "x", "url": "http://10.0.0.8:3000"}]
        self.assertNotIn("adguard", {p["connector"] for p in ka.propose_windows("10.0.0.8", "PC", apps, {}, declared)})   # déjà relié


class Annotate(unittest.TestCase):
    def test_empreinte_lue_puis_retiree(self):
        row = {"ip": "10.0.0.5", "port": 8888, "name": "port 8888", "category": "Autre", "web": None, "page_title": None, "service": None, "fingerprint": "headers: x-pi-hole"}
        ka.annotate(row)
        self.assertEqual((row["app"]["key"], row["app"]["confidence"], row["category"]), ("pihole", "probable", "Réseau / DNS"))
        self.assertNotIn("fingerprint", row)   # jamais écrite dans data.json

    def row(self, **kw):
        return {"ip": "10.0.0.5", "port": 8384, "name": "port 8384", "category": "Autre", "web": None, "page_title": None,
                "service": None, **kw}

    def test_port_seul_ne_change_que_app(self):
        r = self.row()
        ka.annotate(r)
        self.assertEqual(r["app"]["confidence"], ka.POSSIBLE)
        self.assertEqual((r["name"], r["category"], r["web"]), ("port 8384", "Autre", None))

    def test_page_reconnue_complete_nom_categorie_interface(self):
        r = self.row(page_title="Syncthing | dev")
        ka.annotate(r)
        self.assertEqual((r["name"], r["category"], r["web"]), ("Syncthing", "Fichiers / sync", "ui"))

    def test_reglage_manuel_garde(self):
        r = self.row(page_title="Syncthing", category="Perso", web="none", name="mon sync")
        ka.annotate(r, keep_category=True)
        self.assertEqual((r["name"], r["category"], r["web"]), ("mon sync", "Perso", "none"))

    def test_categorie_manuelle_autre_non_ecrasee(self):
        r = self.row(page_title="Syncthing")
        ka.annotate(r, keep_category=True)
        self.assertEqual(r["category"], "Autre")

    def test_inconnu_sans_app(self):
        r = self.row(port=12345, page_title="Mon site")
        ka.annotate(r)
        self.assertNotIn("app", r)


class Propose(unittest.TestCase):
    def rows(self):
        out = []
        for ip, port, title in [("10.0.0.5", 81, "Nginx Proxy Manager"), ("10.0.0.6", 81, None), ("10.0.0.5", 8384, "Syncthing")]:
            r = {"ip": ip, "port": port, "id": f"{ip}:{port}", "machine": "m", "page_title": title, "service": None,
                 "name": f"port {port}", "category": "Autre", "web": None}
            ka.annotate(r)
            out.append(r)
        return out

    def test_propose_par_machine_les_plus_sures_d_abord(self):
        got = ka.propose(self.rows(), [])
        self.assertEqual([(p["connector"], p["ip"], p["confidence"]) for p in got],
                         [("npm", "10.0.0.5", ka.PROBABLE), ("npm", "10.0.0.6", ka.POSSIBLE)])
        self.assertEqual(got[0]["url"], "http://10.0.0.5:81")

    def test_deja_regle_pour_cette_machine(self):
        got = ka.propose(self.rows(), [{"type": "npm", "name": "lan", "api": "http://10.0.0.5:81"}])
        self.assertEqual([p["ip"] for p in got], ["10.0.0.6"])

    def test_avec_les_deja_reliees_pour_le_tableau(self):
        got = ka.propose(self.rows(), [{"type": "npm", "name": "lan", "api": "http://10.0.0.5:81"}], with_linked=True)
        self.assertEqual([(p["ip"], p["linked"]) for p in got], [("10.0.0.5", True), ("10.0.0.6", False)])
        self.assertNotIn("linked", ka.propose(self.rows(), [])[0])

    def test_autre_type_ou_autre_machine_ne_masque_pas(self):
        got = ka.propose(self.rows(), [{"type": "adguard", "url": "http://10.0.0.5:3000"}, {"type": "npm", "api": "http://10.0.0.9:81"}])
        self.assertEqual(len(got), 2)



class RunState(unittest.TestCase):
    def test_running_container_proposed_first_stopped_kept_apart(self):
        app = {"key": "glances", "label": "Glances", "confidence": "sure", "connector": "glances"}
        rows = [{"type": "local", "id": "old", "ip": "10.0.0.1", "port": 80, "service": {"kind": "docker", "state": "Exited (0) 2 weeks ago"}, "app": app},
                {"type": "local", "id": "new", "ip": "10.0.0.1", "port": 81, "service": {"kind": "docker", "state": "Up 2 days (healthy)"}, "app": app},
                {"type": "local", "id": "off", "ip": "10.0.0.2", "port": 81, "service": {"kind": "docker", "state": "Created"}, "app": app}]
        got = {p["ip"]: p for p in ka.propose(rows, [])}
        self.assertEqual((got["10.0.0.1"]["service"], got["10.0.0.1"]["running"]), ("new", True))   # the running one wins
        self.assertEqual((got["10.0.0.2"]["running"], got["10.0.0.2"]["state"]), (False, "Created"))


class StillProposed(unittest.TestCase):
    """A connector saved since the last collection takes its proposal off at once (Discovery page, bell)."""

    def test_saved_connector_hides_its_proposal(self):
        props = [{"connector": "arcane", "ip": "10.0.0.6"}, {"connector": "glances", "ip": "10.0.0.6"}, {"connector": "arcane", "ip": "10.0.0.7"}]
        saved = [{"type": "arcane", "name": "a", "url": "http://10.0.0.6:3552", "enabled": False}]
        self.assertEqual(ka.still_proposed(props, saved), props[1:])
        self.assertEqual(ka.still_proposed(props, []), props)

class HandApp(unittest.TestCase):
    def test_app_set_by_hand_wins(self):
        row = {"service": {"image": "lscr.io/linuxserver/plex"}, "category": "Autre", "port": 9999}
        ka.annotate(row, app_key="jellyfin")
        self.assertEqual((row["app"]["key"], row["app"]["hand"], row["category"]), ("jellyfin", True, "Médias"))
        row = {"service": {}, "port": 9999}
        ka.annotate(row, app_key="nope")   # unknown key: the detection as before
        self.assertNotIn("app", row)
        self.assertTrue(all(a["key"] for a in ka.choices()))


if __name__ == "__main__":
    unittest.main()
