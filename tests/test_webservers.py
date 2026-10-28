"""Serveurs web d'une machine (webservers) et lecture Docker des conteneurs en réseau hôte (BIND / TARGET d'Anubis, ports en boucle locale).

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import webservers  # noqa: E402
from connectors import docker_ssh  # noqa: E402

IP = "10.0.0.9"


def cont(name, image, status="Up 3 weeks", network="bridge", ports=(), local_ports=(), listen=(), target=None):
    c = {"name": name, "image": image, "status": status, "network": network, "ports": list(ports), "local_ports": list(local_ports),
         "compose": "", "title": "", "description": "", "version": "", "url": ""}
    if listen or target:
        c.update(listen=list(listen), target=target)
    return c


# The case of the author's VPS: NPM, two Anubis in host network, FreshRSS on a bridge, Forgejo on the loopback, Apache as a service
CONTS = [
    cont("npm", "jc21/nginx-proxy-manager:latest", ports=[(80, 80), (443, 443), (81, 81)]),
    cont("anubis-rss", "ghcr.io/techarohq/anubis:latest", network="host", listen=[8445], target="172.30.0.3:8443"),
    cont("anubis-git", "ghcr.io/techarohq/anubis:latest", status="Exited (1) 2 days ago", network="host", listen=[8442], target="127.0.0.1:3011"),
    cont("rss", "freshrss/freshrss:latest"),
    cont("forgejo", "codeberg.org/forgejo/forgejo:9", local_ports=[3011]),
    cont("npm-db", "mariadb:11"),
]
INTERNAL = {"172.30.0.3": "rss", "172.30.0.1": "_host", IP: "_host"}
INFO = {"apache": True, "nginx": False, "web_units": ["apache2"], "apache_listen": [8080],
        "vhosts": [{"port": 8080, "names": ["blog.example.fr"]}], "vhosts_unreadable": ["x.conf"]}


class Behind(unittest.TestCase):
    def test_conteneur_par_ip_interne_ou_boucle_locale(self):
        self.assertEqual(webservers.behind("172.30.0.3:8443", IP, CONTS, INTERNAL, {}, INFO),
                         {"kind": "docker", "name": "rss", "addr": "172.30.0.3:8443", "image": "freshrss/freshrss:latest"})
        self.assertEqual(webservers.behind("127.0.0.1:3011", IP, CONTS, INTERNAL, {}, INFO)["name"], "forgejo")

    def test_apache_process_ou_autre_machine(self):
        self.assertEqual(webservers.behind("localhost:8080", IP, CONTS, INTERNAL, {}, INFO)["name"], "apache2 · blog.example.fr")
        self.assertEqual(webservers.behind(f"{IP}:8080", IP, [], {}, {}, dict(INFO, vhosts=[]))["name"], "apache2")
        two = dict(INFO, vhosts=[{"port": 8080, "names": ["default.example.fr"]}, {"port": 8080, "names": ["rss.example.fr", "www.rss.example.fr"]}])
        self.assertEqual(webservers.behind("127.0.0.1:8080", IP, [], {}, {}, two, ["RSS.example.fr"])["name"], "apache2 · rss.example.fr")
        self.assertEqual(webservers.behind("127.0.0.1:8080", IP, [], {}, {}, two, ["autre.example.fr"])["name"], "apache2 · default.example.fr")
        self.assertEqual(webservers.behind("127.0.0.1:9000", IP, [], {}, {9000: {"name": "php-fpm"}}, {})["name"], "php-fpm")
        self.assertEqual(webservers.behind("192.168.1.50:80", IP, CONTS, INTERNAL, {}, INFO), {"kind": None, "name": None, "addr": "192.168.1.50:80"})
        self.assertIsNone(webservers.behind(None, IP, CONTS, INTERNAL, {}, INFO))


class MachineWeb(unittest.TestCase):
    def test_vps_complet(self):
        web = webservers.machine_web(IP, CONTS, INTERNAL, {}, INFO)
        self.assertEqual([(w["key"], w["mode"], w["name"]) for w in web], [
            ("npm", "docker", "npm"), ("anubis", "docker", "anubis-rss"), ("anubis", "docker", "anubis-git"), ("apache", "service", "apache2")])
        rss, git, apache = web[1], web[2], web[3]
        self.assertEqual((rss["ports"], rss["host_net"], rss["up"], rss["behind"]["name"]), ([8445], True, True, "rss"))
        self.assertEqual((git["up"], git["behind"]["name"]), (False, "forgejo"))
        self.assertEqual((apache["ports"], apache["vhosts"], apache["vhosts_unreadable"]), ([8080], 1, 1))

    def test_binaire_web_seulement_et_jamais_les_autres(self):
        procs = {8088: {"name": "nginx", "lan": True}, 22: {"name": "sshd", "lan": True}, 9100: {"name": "node_exporter", "lan": True},
                 2019: {"name": "caddy", "lan": False}}
        web = webservers.machine_web(IP, [], {}, procs, {})
        self.assertEqual([(w["key"], w["mode"], w["ports"]) for w in web], [("caddy", "binary", [2019]), ("nginx", "binary", [8088])])

    def test_service_actif_ou_conteneur_ne_sont_pas_des_binaires(self):
        procs = {80: {"name": "nginx", "lan": True}, 8445: {"name": "anubis", "lan": True}}
        web = webservers.machine_web(IP, [], {}, procs, {"nginx": True, "web_units": ["nginx"], "nginx_vhosts": [{"port": 80, "names": ["a"]}]})
        self.assertEqual([(w["key"], w["mode"]) for w in web], [("nginx", "service")])
        npm_host = [cont("npm", "jc21/nginx-proxy-manager", network="host")]   # NPM in host network: its nginx process is NPM
        self.assertEqual([w["mode"] for w in webservers.machine_web(IP, npm_host, {}, {443: {"name": "nginx", "lan": True}}, {})], ["docker"])
        published = [cont("web", "nginx:alpine", ports=[(8080, 80)])]
        self.assertEqual([w["mode"] for w in webservers.machine_web(IP, published, {}, {8080: {"name": "nginx", "lan": True}}, {})], ["docker"])

    def test_releve_ancien_sans_web_units_et_autres_services(self):
        old = {"apache": True, "nginx": True, "nginx_vhosts": [{"port": 81, "names": ["a"]}]}   # hostinfo cache from before « web_units »
        self.assertEqual([(w["key"], w["mode"]) for w in webservers.machine_web(IP, [], {}, {}, old)], [("apache", "service"), ("nginx", "service")])
        caddy = webservers.machine_web(IP, [], {}, {443: {"name": "caddy", "lan": True}}, {"web_units": ["caddy"]})
        self.assertEqual([(w["mode"], w["ports"]) for w in caddy], [("service", [443])])

    def test_behind_nginx_ou_port_sans_nom(self):
        self.assertEqual(webservers.behind("127.0.0.1:81", IP, [], {}, {}, {"nginx": True, "nginx_vhosts": [{"port": 81, "names": []}]})["kind"], "nginx")
        self.assertIsNone(webservers.behind("127.0.0.1:81", IP, [], {}, {81: {"name": "port 81", "port_only": True}}, {})["kind"])

    def test_windows_exe_et_machine_sans_rien(self):
        self.assertEqual(webservers.machine_web(IP, None, None, {80: {"name": "nginx.exe", "lan": True}}, None)[0]["name"], "nginx")
        self.assertEqual(webservers.machine_web(IP, None, None, None, None), [])

    def test_images_reconnues(self):
        for image, key in (("jc21/nginx-proxy-manager:2.12", "npm"), ("nginx:alpine", "nginx"), ("traefik:v3", "traefik"),
                           ("httpd:2.4", "apache"), ("lscr.io/linuxserver/nginx", "nginx"), ("caddy", "caddy"), ("mariadb:11", None)):
            self.assertEqual(webservers.web_kind(image), key, image)


class Containers(unittest.TestCase):
    def test_liste_complete_triee(self):
        out = webservers.container_list(CONTS)
        self.assertEqual([c["name"] for c in out], ["anubis-git", "anubis-rss", "forgejo", "npm", "npm-db", "rss"])
        self.assertEqual((out[1]["ports"], out[1]["host_net"]), ([8445], True))
        self.assertEqual((out[2]["local_ports"], out[0]["up"]), ([3011], False))
        self.assertIsNone(webservers.container_list(None))

    def test_add_behind_sur_les_services_a_cible(self):
        rows = [{"ip": "172.30.0.1", "host_ip": IP, "service": {"kind": "docker", "name": "anubis-rss", "target": "172.30.0.3:8443"}},
                {"ip": IP, "service": {"kind": "apache", "name": "apache2"}}]
        webservers.add_behind(rows, {IP: CONTS}, {IP: INTERNAL}, {}, {IP: INFO})
        self.assertEqual(rows[0]["service"]["behind"]["name"], "rss")
        self.assertNotIn("behind", rows[1]["service"])


class DockerEnv(unittest.TestCase):
    def test_bind_target_et_port(self):
        got = docker_ssh.parse_env("/anubis-rss=BIND=:8445\n/anubis-rss=TARGET=http://172.30.0.3:8443\n/app=PORT=3000\n"
                                   "/sock=BIND=/run/anubis.sock\n/u=TARGET=unix:///run/app.sock\n/s=TARGET=https://10.0.0.2/\nbruit")
        self.assertEqual(got["anubis-rss"], {"listen": [8445], "target": "172.30.0.3:8443"})
        self.assertEqual(got["app"]["listen"], [3000])
        self.assertEqual((got["sock"]["listen"], got["u"]["target"], got["s"]["target"]), ([], None, "10.0.0.2:443"))

    def test_seules_ces_variables_quittent_la_machine(self):
        self.assertIn("grep -E '^/[^=]+=(BIND|PORT|TARGET)='", docker_ssh.ENV_SH)

    def test_ports_boucle_locale(self):
        self.assertEqual(docker_ssh.loopback_ports("127.0.0.1:3011->3000/tcp, 0.0.0.0:80->80/tcp, [::1]:5432->5432/tcp"), [3011, 5432])

    def test_lecture_complete(self):
        out = ("anubis-rss|ghcr.io/techarohq/anubis||Up 3 weeks||||||host\n"
               "forgejo|codeberg.org/forgejo/forgejo|127.0.0.1:3011->3000/tcp|Up 2 days||||||bridge\n"
               "@@ENV\n/anubis-rss=BIND=:8445\n/anubis-rss=TARGET=http://172.30.0.3:8443\n")
        with mock.patch.object(docker_ssh.subprocess, "run", return_value=mock.Mock(returncode=0, stdout=out, stderr="")):
            got = docker_ssh.docker_containers("srv")
        self.assertEqual((got[0]["listen"], got[0]["target"]), ([8445], "172.30.0.3:8443"))
        self.assertEqual((got[1]["ports"], got[1]["local_ports"]), ([], [3011]))
        self.assertNotIn("listen", got[1])


if __name__ == "__main__":
    unittest.main()
