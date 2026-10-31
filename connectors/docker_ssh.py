"""Docker par SSH : conteneurs d'une machine (docker ps) et adresses de ses réseaux docker, en lecture
seule, par l'alias SSH de la machine (ou sur place pour l'alias « local » de l'installation classique).

Une instance par machine de services-meta avec un accès SSH (déclarée par connectors.declared). Le
compte SSH doit pouvoir lancer docker (groupe docker) ; sinon « docker inaccessible ».
"""
from __future__ import annotations

import re
import subprocess

from connectors.base import Connector, Field, Result
from msv.remote.sshmux import SSH_MUX

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


def loopback_ports(spec):
    """Ports TCP publiés sur la boucle locale de l'hôte (127.0.0.1:3011->3000/tcp) : invisibles du LAN, mais un relais de la même
    machine (Anubis, Apache, nginx) peut les viser ; servent à nommer ce qu'il y a derrière lui."""
    return sorted({int(h) for h in re.findall(r"(?:127\.\d+\.\d+\.\d+|\[::1\]):(\d+)->\d+/tcp", spec)})


# Host network: no published port, the listening port is in the configuration. Only these variables are read, and they are filtered
# ON the machine (grep), so that the other ones (passwords, tokens) never leave it. BIND / TARGET: Anubis; PORT: many web apps
ENV_KEYS = ("BIND", "PORT", "TARGET")
ENV_MARK = "@@ENV"
ENV_SH = (f"echo {ENV_MARK}; docker ps -aq --filter network=host | xargs -r docker inspect --format "
          "'{{range .Config.Env}}{{$.Name}}={{.}}{{println}}{{end}}' | grep -E '^/[^=]+=(" + "|".join(ENV_KEYS) + ")=' ; true")


def env_port(value: str) -> int | None:
    """Port d'écoute d'une valeur BIND / PORT (« :8445 », « 0.0.0.0:8445 », « 8445 ») ; None pour un socket unix ou une valeur sans port."""
    m = re.fullmatch(r"(?:(?:[\w.\-]*|\[[0-9a-f:]*\]):)?(\d{1,5})", value.strip(), re.I)
    return int(m.group(1)) if m and 0 < int(m.group(1)) < 65536 else None


def env_target(value: str) -> str | None:
    """« hôte:port » visé par un TARGET http(s) (Anubis) ; None pour un socket unix ou une valeur illisible."""
    value = value.strip()
    # host and optional port at the start, then any path without blanks (a looser tail would backtrack on long values)
    m = re.match(r"https?://([\w.\-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?", value, re.I)
    if not m or re.search(r"\s", value):
        return None
    return f"{m.group(1)}:{m.group(2) or (443 if value.strip().lower().startswith('https') else 80)}"


def parse_env(text: str) -> dict:
    """{nom du conteneur: {listen: [ports], target: "hôte:port"}} d'après les lignes « /nom=CLÉ=valeur » de ENV_SH."""
    out: dict = {}
    for line in text.splitlines():
        m = re.match(r"/([^=]+)=(" + "|".join(ENV_KEYS) + r")=(.*)$", line)
        if not m:
            continue
        c = out.setdefault(m.group(1), {"listen": [], "target": None})
        if m.group(2) == "TARGET":
            c["target"] = env_target(m.group(3))
        elif (port := env_port(m.group(3))) and port not in c["listen"]:
            c["listen"].append(port)
    return out


DOCKER_SH = f"docker ps -a --format '{DOCKER_FMT}' && {{ {ENV_SH}; }}"   # the Linux agent runs this same command


def docker_absent(rc: int, stderr: str) -> bool:
    """Le shell distant n'a pas trouvé la commande docker (code 127) : Docker n'est pas installé, ce n'est pas une panne d'accès."""
    low = (stderr or "").lower()
    return rc == 127 or "docker: command not found" in low or "docker: not found" in low


def docker_containers(alias, absent: list | None = None):
    """Liste des conteneurs d'une machine (docker ps local ou via SSH). None = inaccessible ; [] si Docker n'est pas installé
    (`absent` reçoit alors True : l'appelant le distingue d'une machine Docker sans conteneur)."""
    cmd = ["sh", "-c", DOCKER_SH] if alias == "local" else ["ssh", *SSH_MUX, "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, DOCKER_SH]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode != 0:
        if docker_absent(r.returncode, r.stderr):
            if absent is not None:
                absent.append(True)
            return []
        return None
    return parse_containers(r.stdout)


def parse_containers(out: str) -> list[dict]:
    """Conteneurs d'après la sortie de DOCKER_SH (lue par SSH ou envoyée par l'agent Linux)."""
    ps, _, env = out.partition(f"{ENV_MARK}\n")
    env = parse_env(env)
    out = []
    for line in ps.splitlines():
        f = (line.split("|") + [""] * 10)[:10]
        c = {
            "name": f[0], "image": f[1], "status": f[3], "compose": f[4], "title": f[5],
            "description": f[6], "version": f[7], "url": f[8], "network": f[9],
            "ports": publish_ports(f[2]), "local_ports": loopback_ports(f[2]),
        }
        if f[0] in env:   # host network: listening port and target read in its configuration
            c.update(env[f[0]])
        out.append(c)
    return out


NET_FMT = "{{range .Containers}}{{.Name}}={{.IPv4Address}} {{end}}"


INTERNAL_ADDR = re.compile(r"([\d.]+)/\d+")
HOST_ADDR = "_host"  # adresse de la machine elle-même (pont docker, IP secondaire) : service de l'hôte
NET_SH = (f"docker network ls -q --filter driver=bridge | xargs -r docker network inspect --format '{NET_FMT}'; "
          f"ip -4 -o addr show scope global | awk '{{print \"{HOST_ADDR}=\" $4}}'")


def docker_internal_ips(alias):
    """{ip_interne: nom_conteneur} des réseaux docker bridge d'une machine, plus ses propres adresses
    (HOST_ADDR) : un NPM qui vise 172.x.0.1 ou une IP du pont joint un service de l'hôte, pas un conteneur."""
    cmd = ["sh", "-c", NET_SH] if alias == "local" else \
        ["ssh", *SSH_MUX, "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, NET_SH]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout
    except subprocess.TimeoutExpired:
        return {}
    return parse_internal(out)


def parse_internal(out: str) -> dict:
    """{ip_interne: nom_conteneur} d'après la sortie de NET_SH (lue par SSH ou envoyée par l'agent Linux)."""
    pairs = (word.rpartition("=") for word in out.split())   # word by word: this text can come from an agent report, and one regex over it took minutes on a long word
    return {m[1]: name for name, _, addr in pairs if name and (m := INTERNAL_ADDR.match(addr))}


class DockerSSH(Connector):
    type = "docker"
    label = "Docker (SSH)"
    kinds = ("inventory",)
    fields = (Field("ssh", "Alias SSH de la machine", required=True), Field("ip", "IP de la machine", required=True))

    def collect(self) -> dict:
        """{containers: [...] ou None si docker inaccessible, internal: {ip: conteneur}}. Les adresses de la
        machine (HOST_ADDR) sont lues même sans accès docker : elles servent au rattachement des hosts NPM."""
        absent: list = []
        got = docker_containers(self.conf["ssh"], absent)
        return {"containers": got, "internal": {} if absent else docker_internal_ips(self.conf["ssh"]), "absent": bool(absent)}

    def test(self) -> Result:
        absent: list = []
        got = docker_containers(self.conf["ssh"], absent)
        if got is None:
            return Result(False, "docker inaccessible (SSH, ou compte hors du groupe docker)")
        if absent:
            return Result(True, "pas de Docker sur cette machine")
        return Result(True, f"{len(got)} conteneurs")
