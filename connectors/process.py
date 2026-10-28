"""Process en écoute (services hors Docker) d'une machine, par `ss -tlnp`, en lecture seule. Le compte doit
pouvoir voir le nom des process (root, ou sudo) ; sinon les ports sont vus sans nom et ignorés.

Une instance par entrée de services-meta « process_hosts » {IP: alias}.
"""
from __future__ import annotations

import os
import re
import subprocess

from connectors.base import Connector, ConnectorError, Field
from msv.remote.sshmux import SSH_MUX

# Process locaux sans intérêt dans l'annuaire (ports RPC/NFS éphémères, résolveur, docker)
NOISE_PORTS = {53, 111, 631, 2049, 5355}  # même chose vue par le port seul : DNS local, RPC, CUPS, NFS, LLMNR
NOISE_PROCS = {"docker-proxy", "rpcbind", "rpc.statd", "rpc.mountd", "systemd-resolve", "master"}
# Not root on the machine: a sudoers rule for « ss -tlnpH » alone (given in the page, or MSV_SUDO=1 for the agent) shows every
# process; without one, plain ss. The Linux agent runs this same command
LISTEN_SH = "sudo -n ss -tlnpH 2>/dev/null || ss -tlnpH"


def listening_processes(alias):
    """{port: process} des services non-docker d'une machine (ss -tlnp), lan=False si loopback.
    ConnectorError si la machine n'a pas répondu (SSH coupé, délai, ss absent)."""
    return listening_read(alias)[0]


def listening_read(alias):
    """(ports, hidden) : comme listening_processes, plus le nombre de ports en écoute dont `ss` cache le nom du process
    (compte sans root : il ne voit que ses propres process), pour dire que la lecture est partielle."""
    cmd = ["ss", "-tlnpH"] if alias == "local" else \
        ["ssh", *SSH_MUX, "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, LISTEN_SH]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    except subprocess.TimeoutExpired:
        raise ConnectorError(f"{alias} : délai dépassé") from None
    if r.returncode != 0:
        raise ConnectorError(f"{alias} : {(r.stderr.strip() or f'code {r.returncode}')[-160:]}")
    return parse_listening(r.stdout)


def parse_listening(out: str):
    """(ports, hidden) d'après la sortie de `ss -tlnpH` (lue par SSH ou envoyée par l'agent Linux)."""
    ports, hidden = {}, set()
    for line in out.splitlines():
        cols = line.split()
        m = re.match(r"(.*):(\d+)$", cols[3]) if len(cols) > 3 else None
        p = re.search(r'\(\("([^"]+)"', line)
        if m and not p and int(m.group(2)) not in NOISE_PORTS:
            hidden.add(int(m.group(2)))
        if m and p and p.group(1) not in NOISE_PROCS:
            bind(ports.setdefault(int(m.group(2)), {"name": p.group(1), "lan": False}), m.group(1))
    return ports, len(hidden - set(ports))


ANY_ADDR = ("*", "0.0.0.0", "[::]", "::", "")   # listens on every interface: reachable through the machine's IP
LOOPBACK = ("127.", "[::1]", "::1")


def bind(port: dict, addr: str) -> dict:
    """Records the listen address of a port (`addr`) on its entry: `lan` once an address is not loopback, and `addr` the widest
    one seen (any-address first), so a process bound on a bridge or a container network (172.30.0.3) keeps that address."""
    loop = addr.startswith(LOOPBACK)
    port["lan"] = port["lan"] or not loop
    if "addr" not in port or (addr in ANY_ADDR and port["addr"] not in ANY_ADDR) or (port["addr"].startswith(LOOPBACK) and not loop):
        port["addr"] = addr
    return port


def internal_bind(addr: str | None, ip: str) -> bool:
    """True when a port is bound to an address the collector cannot reach through the machine's IP: not any-address, not the
    machine itself, not loopback (an Apache behind Anubis listening on a Docker bridge). The probe then has nothing to say."""
    if not addr or addr in ANY_ADDR:
        return False
    a = addr.strip("[]").split("%")[0]
    return a not in (ip, f"::ffff:{ip}") and not a.startswith(LOOPBACK)


def host_ports() -> dict:
    """{port: {"name", "lan"}} des ports TCP en écoute de la machine qui fait tourner MyServices, lus dans
    /proc/net/tcp et tcp6 : en réseau host, le conteneur y voit ceux de l'hôte, sans SSH ni socket Docker.
    Pas de nom de process ici (« port N ») ; la sonde HTTP de la collecte nomme ensuite l'appli (titre)."""
    ports = {}
    for f in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            lines = open(f, encoding="ascii").read().splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            cols = line.split()
            if len(cols) < 4 or cols[3] != "0A":  # 0A = LISTEN
                continue
            addr, port = cols[1].rsplit(":", 1)
            port = int(port, 16)
            loop = addr in ("0100007F", "00000000000000000000000001000000") or addr.endswith("7F")
            if port < 32768 and port not in NOISE_PORTS:  # au-delà : ports éphémères (RPC, clients)
                p = ports.setdefault(port, {"name": f"port {port}", "lan": False})
                p["lan"] = p["lan"] or not loop
    return ports


def host_docker() -> dict:
    """Docker sur la machine hôte, vu sans SSH ni socket : en réseau host, /sys/class/net liste les interfaces
    de l'hôte. `docker0` = Docker présent ; un `veth*` par conteneur en réseau bridge ; un `br-*` par réseau
    compose. C'est une estimation (les conteneurs en réseau host n'y figurent pas) : le relevé exact vient du SSH."""
    try:
        names = os.listdir("/sys/class/net")
    except OSError:
        return {"present": False, "containers": 0, "networks": 0}
    bridges = [n for n in names if n.startswith("br-")]
    return {"present": "docker0" in names or bool(bridges), "containers": sum(n.startswith("veth") for n in names),
            "networks": len(bridges)}


class Process(Connector):
    type = "process"
    label = "Process en écoute (SSH)"
    kinds = ("inventory",)
    fields = (Field("ssh", "Alias SSH de la machine", required=True), Field("ip", "IP de la machine", required=True))

    def collect(self) -> dict:
        ports, hidden = listening_read(self.conf["ssh"])
        return {"ports": ports, "hidden": hidden}
