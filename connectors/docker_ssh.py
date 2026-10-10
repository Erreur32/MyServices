"""Docker par SSH : conteneurs d'une machine (docker ps) et adresses de ses réseaux docker, en lecture
seule, par l'alias SSH de la machine (ou sur place pour l'alias « local » de l'installation classique).

Une instance par machine de services-meta avec un accès SSH (déclarée par connectors.declared). Le
compte SSH doit pouvoir lancer docker (groupe docker) ; sinon « docker inaccessible ».
"""
from __future__ import annotations

import re
import subprocess

from connectors.base import Connector, Field, Result

DOCKER_FMT = ("{{.Names}}|{{.Image}}|{{.Ports}}|{{.Status}}|{{.Label \"com.docker.compose.project\"}}|"
              "{{.Label \"org.opencontainers.image.title\"}}|{{.Label \"org.opencontainers.image.description\"}}|"
              "{{.Label \"org.opencontainers.image.version\"}}|{{.Label \"org.opencontainers.image.url\"}}|{{.Networks}}")


def publish_ports(spec):
    """Ports TCP publiés {(hôte, conteneur)}, plages comprises (0.0.0.0:1514-1515->1514-1515/tcp).
    Ports liés à 127.0.0.1 / ::1 ignorés : pas un service LAN (ex. admin NPM réservée au tunnel SSH)."""
    out = set()
    lan = ",".join(p for p in spec.split(",") if not re.match(r"\s*(127\.|\[::1\])", p))
    for h1, h2, c1, c2 in re.findall(r":(\d+)(?:-(\d+))?->(\d+)(?:-(\d+))?/tcp", lan):
        h1, c1 = int(h1), int(c1)
        for i in range(int(h2 or h1) - h1 + 1):
            out.add((h1 + i, c1 + i))
    return sorted(out)


def docker_containers(alias):
    """Liste des conteneurs d'une machine (docker ps local ou via SSH). None = inaccessible."""
    if alias == "local":
        cmd = ["docker", "ps", "-a", "--format", DOCKER_FMT]
    else:
        cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, f"docker ps -a --format '{DOCKER_FMT}'"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode != 0:
        return None
    out = []
    for line in r.stdout.splitlines():
        f = (line.split("|") + [""] * 10)[:10]
        out.append({
            "name": f[0], "image": f[1], "status": f[3], "compose": f[4], "title": f[5],
            "description": f[6], "version": f[7], "url": f[8], "network": f[9],
            "ports": publish_ports(f[2]),
        })
    return out


NET_FMT = "{{range .Containers}}{{.Name}}={{.IPv4Address}} {{end}}"


HOST_ADDR = "_host"  # adresse de la machine elle-même (pont docker, IP secondaire) : service de l'hôte


def docker_internal_ips(alias):
    """{ip_interne: nom_conteneur} des réseaux docker bridge d'une machine, plus ses propres adresses
    (HOST_ADDR) : un NPM qui vise 172.x.0.1 ou une IP du pont joint un service de l'hôte, pas un conteneur."""
    sh = (f"docker network ls -q --filter driver=bridge | xargs -r docker network inspect --format '{NET_FMT}'; "
          f"ip -4 -o addr show scope global | awk '{{print \"{HOST_ADDR}=\" $4}}'")
    cmd = ["sh", "-c", sh] if alias == "local" else \
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, sh]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout
    except subprocess.TimeoutExpired:
        return {}
    return {ip: name for name, ip in re.findall(r"(\S+)=([\d.]+)/\d+", out)}


class DockerSSH(Connector):
    type = "docker"
    label = "Docker (SSH)"
    kinds = ("inventory",)
    fields = (Field("ssh", "Alias SSH de la machine", required=True), Field("ip", "IP de la machine", required=True))

    def collect(self) -> dict:
        """{containers: [...] ou None si docker inaccessible, internal: {ip: conteneur}}. Les adresses de la
        machine (HOST_ADDR) sont lues même sans accès docker : elles servent au rattachement des hosts NPM."""
        return {"containers": docker_containers(self.conf["ssh"]), "internal": docker_internal_ips(self.conf["ssh"])}

    def test(self) -> Result:
        got = docker_containers(self.conf["ssh"])
        if got is None:
            return Result(False, "docker inaccessible (SSH, ou compte hors du groupe docker)")
        return Result(True, f"{len(got)} conteneurs")
