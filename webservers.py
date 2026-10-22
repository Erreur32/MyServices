"""Serveurs web d'une machine (fiche machine › Logiciels et services) : NPM, Anubis, Apache, nginx, Caddy, Traefik, HAProxy, lighttpd,
chacun avec sa façon de tourner (conteneur Docker, service systemd, ou binaire lancé à la main), ses ports et ce qu'il y a derrière lui.

Tout est déduit de ce que la collecte a déjà lu (docker ps, hostinfo, ss) : aucune connexion de plus. Un process qui écoute n'est
répertorié que s'il porte le nom d'un serveur web connu : les autres binaires (sshd, outils système) ne sont jamais listés.
"""
from __future__ import annotations

import re

from connectors.docker_ssh import HOST_ADDR

# (key, label, image) : the first match wins, so the proxy managers come before the plain nginx images
WEB_IMAGES: tuple[tuple[str, str, str], ...] = (
    ("npm", "Nginx Proxy Manager", r"nginx-proxy-manager"),
    ("anubis", "Anubis", r"techarohq/anubis"),
    ("traefik", "Traefik", r"(^|/)traefik(:|$)"),
    ("caddy", "Caddy", r"(^|/)caddy(:|$)"),
    ("haproxy", "HAProxy", r"(^|/)haproxy(:|$)"),
    ("apache", "Apache", r"(^|/)(httpd|apache2?)(:|$)"),
    ("nginx", "nginx", r"(^|/)(nginx|nginx-unprivileged|openresty)(:|$)"),
    ("lighttpd", "lighttpd", r"lighttpd"),
)
_IMAGES = [(k, label, re.compile(rx, re.I)) for k, label, rx in WEB_IMAGES]
LABELS = {k: label for k, label, _ in WEB_IMAGES}
# Process name -> key: only these binaries are listed (an unknown process listening is not a web server)
BINARIES = {"nginx": "nginx", "apache2": "apache", "httpd": "apache", "caddy": "caddy", "traefik": "traefik",
            "haproxy": "haproxy", "lighttpd": "lighttpd"}
UNITS = {"apache2": "apache", "httpd": "apache", "nginx": "nginx", "caddy": "caddy", "traefik": "traefik",
         "haproxy": "haproxy", "lighttpd": "lighttpd"}   # systemd unit -> key (hostinfo « web_units »)
# A proxy manager in a container runs the binary of another key: its process must not be listed again as a binary
RUNS = {"npm": "nginx"}
LOOPBACK = ("127.0.0.1", "localhost", "::1", "[::1]")


def web_kind(image: str | None) -> str | None:
    """Clé du serveur web d'une image Docker (« npm », « anubis », « nginx »…) ; None pour une autre appli."""
    return next((k for k, _, rx in _IMAGES if image and rx.search(image)), None)


def _up(c: dict) -> bool:
    return (c.get("status") or "").startswith("Up")


def _host_ports(c: dict) -> list[int]:
    """Ports où le conteneur écoute sur la machine : publiés (LAN), liés à la boucle locale, ou lus dans sa config en réseau hôte."""
    return sorted({hp for hp, _ in c.get("ports") or []} | set(c.get("local_ports") or []) | set(c.get("listen") or []))


def _apache_ports(info: dict) -> set[int]:
    return set(info.get("apache_listen") or []) | {v["port"] for v in info.get("vhosts") or []}


def _nginx_ports(info: dict) -> set[int]:
    return {v["port"] for v in info.get("nginx_vhosts") or []}


def _vhost(server: str, vhosts: list | None, port: int | None, domains: list | None = None) -> str:
    """« apache2 · vhost » de ce port : celui qui porte un des domaines demandés (le relais transmet le nom d'hôte), sinon le 1er chargé
    (celui qui répond par défaut) ; le serveur seul s'il n'y a aucun vhost lisible."""
    here = [v for v in vhosts or [] if v.get("port") == port and v.get("names")]
    want = {d.lower() for d in domains or []}
    v = next((v for v in here if want & {n.lower() for n in v["names"]}), here[0] if here else None)
    return f"{server} · {v['names'][0]}" if v else server


def behind(target: str | None, ip: str, containers: list | None, internal: dict | None, procs: dict | None, info: dict | None,
           domains: list | None = None) -> dict | None:
    """Ce qu'il y a derrière une cible « hôte:port » vue depuis la machine `ip` (TARGET d'Anubis) : un conteneur (par son IP dans un
    réseau docker, ou par son port sur la machine), Apache, nginx, un process. {kind, name, addr} ; kind None si rien n'est reconnu."""
    if not target or ":" not in target:
        return None
    host, _, port_s = target.rpartition(":")
    port = int(port_s) if port_s.isdigit() else None
    out = {"kind": None, "name": None, "addr": target}
    conts, internal, procs, info = containers or [], internal or {}, procs or {}, info or {}
    by_name = {c["name"]: c for c in conts}
    seen = internal.get(host)
    if seen and seen != HOST_ADDR:   # IP of a container in a docker network of this machine
        c = by_name.get(seen)
        return {**out, "kind": "docker", "name": seen, **({"image": c["image"]} if c else {})}
    if host not in LOOPBACK and seen != HOST_ADDR and host != ip:
        return out   # another machine: the address is shown as it is
    return {**out, **_local_server(port, conts, procs, info, domains)}


def _local_server(port: int | None, conts: list, procs: dict, info: dict, domains: list | None) -> dict:
    """What listens on `port` of the machine itself (a container, Apache, nginx, a process): {kind, name(, image)}, {} if unknown."""
    c = next((c for c in conts if port in _host_ports(c)), None)
    if c:
        return {"kind": "docker", "name": c["name"], "image": c["image"]}
    if info.get("apache") and port in _apache_ports(info):
        return {"kind": "apache", "name": _vhost("apache2", info.get("vhosts"), port, domains)}
    if info.get("nginx") and port in _nginx_ports(info):
        return {"kind": "nginx", "name": _vhost("nginx", info.get("nginx_vhosts"), port, domains)}
    p = procs.get(port)
    if p and not p.get("port_only"):
        return {"kind": "process", "name": p["name"]}
    return {}


def _docker_servers(ip: str, conts: list, internal: dict | None, procs: dict, info: dict) -> tuple[list[dict], set[int], set[str]]:
    """Web servers running in a container: (rows, ports held by a container, keys running in a host-network container)."""
    out: list[dict] = []
    claimed: set[int] = set()       # ports held by a container: the process seen there is that container
    in_docker: set[str] = set()     # keys running in a host-network container: their process is that container
    for c in conts:
        k = web_kind(c.get("image"))
        ports = _host_ports(c)
        claimed |= set(ports)
        host_net = "host" in (c.get("network") or "").split(",")
        if k and host_net and _up(c):
            in_docker |= {k, RUNS.get(k, k)}
        if not k:
            continue
        out.append({"key": k, "label": LABELS[k], "mode": "docker", "name": c["name"], "ports": ports, "up": _up(c),
                    "host_net": host_net, "target": c.get("target"),
                    "behind": behind(c.get("target"), ip, conts, internal, procs, info) if c.get("target") else None})
    return out, claimed, in_docker


def _service_servers(procs: dict, info: dict) -> list[dict]:
    """Web servers running as an active systemd unit (Apache and nginx also when only their service is seen as active)."""
    out: list[dict] = []
    units = [u for u in info.get("web_units") or [] if u in UNITS]
    if info.get("apache") and "apache2" not in units:
        units.append("apache2")
    if info.get("nginx") and "nginx" not in units:
        units.append("nginx")
    for u in units:
        k = UNITS[u]
        if k == "apache":
            ports, vh = sorted(_apache_ports(info)), info.get("vhosts") or []
        elif k == "nginx":
            ports, vh = sorted(_nginx_ports(info)), info.get("nginx_vhosts") or []
        else:
            ports, vh = sorted(p for p, v in procs.items() if BINARIES.get(_proc(v)) == k), []
        row = {"key": k, "label": LABELS[k], "mode": "service", "name": u, "ports": ports, "up": True,
               "host_net": False, "target": None, "behind": None}
        if vh:
            row["vhosts"] = len(vh)
            row["vhosts_unreadable"] = len(info.get("vhosts_unreadable") or []) if k == "apache" else 0
        out.append(row)
    return out


def _binary_servers(procs: dict, skip: set[str], claimed: set[int]) -> list[dict]:
    """Web servers seen only as a listening process (no service, no container): one row per binary with all its ports."""
    binaries: dict[str, dict] = {}
    for port, p in sorted(procs.items()):
        name = _proc(p)
        k = BINARIES.get(name)
        if not k or k in skip or port in claimed or p.get("port_only"):
            continue
        b = binaries.setdefault(name, {"key": k, "label": LABELS[k], "mode": "binary", "name": name, "ports": [], "up": True,
                                       "host_net": False, "target": None, "behind": None})
        b["ports"].append(port)
    return list(binaries.values())


def machine_web(ip: str, containers: list | None, internal: dict | None, procs: dict | None, info: dict | None) -> list[dict]:
    """Serveurs web de la machine, dans l'ordre de WEB_IMAGES : [{key, label, mode, name, ports, up, host_net, target, behind, vhosts}].
    mode : « docker » (conteneur), « service » (unité systemd active), « binary » (process qui écoute sans service ni conteneur)."""
    conts, procs, info = containers or [], procs or {}, info or {}
    out, claimed, in_docker = _docker_servers(ip, conts, internal, procs, info)
    services = _service_servers(procs, info)
    as_unit = {w["key"] for w in services}
    out += services
    out += _binary_servers(procs, as_unit | in_docker, claimed)
    order = [k for k, _, _ in WEB_IMAGES]
    return sorted(out, key=lambda w: order.index(w["key"]))


def _proc(p: dict) -> str:
    """Nom du process sans « .exe » (agent Windows)."""
    return str(p.get("name") or "").lower().removesuffix(".exe")


def container_list(containers: list | None) -> list[dict] | None:
    """Tous les conteneurs de la machine, même sans service rattaché (fiche machine) : forme courte pour la page. None = Docker illisible."""
    if containers is None:
        return None
    return [{"name": c["name"], "image": c["image"], "status": c.get("status") or "", "up": _up(c),
             "host_net": "host" in (c.get("network") or "").split(","),
             "ports": sorted({hp for hp, _ in c.get("ports") or []} | set(c.get("listen") or [])),
             "local_ports": c.get("local_ports") or [], "compose": c.get("compose") or None}
            for c in sorted(containers, key=lambda c: c["name"].lower())]


def add_behind(rows: list[dict], dock: dict, internal: dict, procs: dict, hinfo: dict) -> None:
    """Services portés par un relais à cible (Anubis) : service["behind"] = ce qu'il y a derrière, pour le chemin NPM → Anubis → appli."""
    for r in rows:
        s = r.get("service") or {}
        if s.get("kind") != "docker" or not s.get("target"):
            continue
        ip = r.get("host_ip") or r.get("ip")
        b = behind(s["target"], ip, dock.get(ip), internal.get(ip), procs.get(ip), hinfo.get(ip), r.get("domains"))
        if b:
            s["behind"] = b
