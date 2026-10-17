"""Infos machines pour MyServices : accès SSH, sécurité sshd, OS, Docker, vhosts Apache.

Tout est en LECTURE SEULE : une seule commande SSH par machine (mise en cache avec
l'inventaire docker), plus la lecture locale de ~/.ssh/config et ~/.ssh/known_hosts.
Jamais de clé privée ni de contenu secret : seulement le chemin de la clé et
l'empreinte de sa partie publique.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from config import CFG

SSH_DIR = Path.home() / ".ssh"

# Exécuté sur chaque machine (bash) ; chaque ligne commence par un marqueur ##XXX
REMOTE = r"""
echo "##OS $(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
echo "##KERNEL $(uname -r)"
echo "##UP $(cut -d. -f1 /proc/uptime)"
echo "##SVC apache2=$(systemctl is-active apache2 2>/dev/null) nginx=$(systemctl is-active nginx 2>/dev/null)"
echo "##SSHDR $( [ -r /etc/ssh/sshd_config ] && echo yes || echo no)"
echo "##SSHD $(grep -h -E -i '^[[:space:]]*(Port|PermitRootLogin|PasswordAuthentication)[[:space:]]' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | tr -s ' \t' ' ' | paste -sd';')"
echo "##DOCKERBIN $(command -v docker >/dev/null 2>&1 && echo yes || echo no)"
echo "##DOCKER $(docker ps -q 2>/dev/null | wc -l)"
echo "##VIRT $(systemd-detect-virt 2>/dev/null)"
echo "##ESXI $(vmware -v 2>/dev/null)"
echo "##PVE $( [ -d /etc/pve ] && command -v pvesh >/dev/null 2>&1 && echo yes || echo no)"
echo "##HV $(for t in virsh incus lxc VBoxManage; do command -v $t >/dev/null 2>&1 && printf '%s ' $t; done)"
echo "##NPM $(docker ps --format '{{.Image}}' 2>/dev/null | grep -c nginx-proxy-manager)"
echo "##LISTEN $(grep -h -E -i '^[[:space:]]*Listen[[:space:]]' /etc/apache2/ports.conf 2>/dev/null | awk '{print $2}' | sort -u | paste -sd' ')"
for f in /etc/apache2/sites-enabled/*.conf; do
  [ -e "$f" ] || continue
  if [ -r "$f" ]; then echo "##F $f"; grep -E -i '^[[:space:]]*(<VirtualHost|ServerName|ServerAlias|DocumentRoot)' "$f"
  else echo "##U $f"; fi
done
for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
  [ -f "$f" ] || continue
  if [ -r "$f" ]; then echo "##NF $f"; grep -E -i '^[[:space:]]*(server[[:space:]]*\{|listen[[:space:]]|server_name[[:space:]])' "$f"
  else echo "##NU $f"; fi
done
"""


def ping_ttl(stdout: str) -> int | None:
    """TTL de la réponse d'un ping (128 : Windows, 64 : Linux / macOS, 255 : matériel réseau), None si absent."""
    m = re.search(r"ttl=(\d+)", stdout or "", re.I)
    return int(m.group(1)) if m else None


def default_gateway() -> str | None:
    """Adresse de la passerelle par défaut de l'hôte (box ou routeur), d'après sa route par défaut ; None si introuvable."""
    try:
        out = subprocess.run(["ip", "-4", "route", "show", "default"], capture_output=True, text=True, timeout=5).stdout.split()
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out[out.index("via") + 1] if "via" in out else None


def detected_flags(ip: str, info: dict | None, conf: dict) -> list[str]:
    """Réglages de machine que la détection confirme (page : un interrupteur non détecté est grisé) : passerelle (route par
    défaut de l'hôte), machine virtuelle (systemd-detect-virt), hôte NPM (conteneur), Windows (poste souvent éteint)."""
    out = []
    if ip == default_gateway():
        out.append("gateway")
    if (info or {}).get("virt"):
        out.append("vm")
    if (info or {}).get("npm"):
        out.append("npm")
    if conf.get("os") == "windows":
        out.append("off")
    return out


def ssh_config() -> dict[str, dict]:
    """{HostName: {alias, port, user, identity}} depuis ~/.ssh/config (1re entrée par IP)."""
    out, cur = {}, None
    try:
        lines = (SSH_DIR / "config").read_text().splitlines()
    except OSError:
        return out
    for line in lines:
        m = re.match(r"\s*(\w+)\s+(.+?)\s*$", line)
        if not m:
            continue
        k, v = m.group(1).lower(), m.group(2)
        if k == "host":
            cur = {"alias": v.split()[0], "port": 22, "user": None, "identity": None}
        elif cur is not None:
            if k == "hostname":
                out.setdefault(v, cur)
            elif k == "port":
                cur["port"] = int(v)
            elif k == "user":
                cur["user"] = v
            elif k == "identityfile":
                cur["identity"] = v
    return out


SSHLIST = Path(CFG["sshlist"]) if CFG["sshlist"] else None


def sshlist_entries() -> tuple[dict[str, dict], dict[str, str]]:
    """Accès SSH et notes déclarés dans le script sshlist de l'utilisateur (source de vérité).

    Retourne ({ip: accès}, {"user@ip:port": note}) : EXTRAS = accès sans entrée ~/.ssh/config
    (ex. passerelle UniFi), NOTES = libellé libre par cible.
    """
    if SSHLIST is None:
        return {}, {}
    try:
        txt = SSHLIST.read_text()
    except OSError:
        return {}, {}
    extras = {}
    for user, host, note in re.findall(r'^\s*"ssh (?:(\S+)@)?([\w.-]+)\|([^"]*)"', txt, re.M):
        extras[host] = {"alias": f"ssh {user + '@' if user else ''}{host}", "port": 22, "user": user or None,
                        "identity": None, "note": note}
    notes = dict(re.findall(r'^\s*\["([^"]+)"\]="([^"]*)"', txt, re.M))
    return extras, notes


def _run(cmd: list[str], timeout: int = 10) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (subprocess.TimeoutExpired, OSError):
        return ""


def key_fingerprint(identity: str | None) -> str | None:
    """Empreinte de la clé PUBLIQUE associée (fichier .pub), jamais la clé privée."""
    if not identity:
        return None
    pub = Path(os.path.expanduser(identity) + ".pub")
    m = re.search(r"(SHA256:\S+).*\((\w+)\)", _run(["ssh-keygen", "-lf", str(pub)]))
    return f"{m.group(2)} {m.group(1)}" if m else None


def host_key(ip: str, port: int) -> str | None:
    """Empreinte de la clé d'hôte connue (known_hosts), de préférence ED25519."""
    target = ip if port == 22 else f"[{ip}]:{port}"
    found = re.findall(r"^\S+ (\w+) (SHA256:\S+)", _run(["ssh-keygen", "-l", "-F", target, "-f", str(SSH_DIR / "known_hosts")]), re.M)
    if not found:
        return None
    best = next((f for f in found if f[0] == "ED25519"), found[0])
    return f"{best[0]} {best[1]}"


def auth_methods(ip: str, port: int) -> list[str] | None:
    """Méthodes d'authentification réellement proposées par sshd (sans se connecter).

    Tentative avec l'utilisateur fictif « nobody » et aucune méthode : le serveur
    répond « Permission denied (publickey,password) », c'est-à-dire sa config EFFECTIVE.
    """
    try:
        err = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "PreferredAuthentications=none", "-o", "ConnectTimeout=4",
                              "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
                              "-p", str(port), f"nobody@{ip}", "true"],
                             capture_output=True, text=True, timeout=10).stderr
    except (subprocess.TimeoutExpired, OSError):
        return None
    m = re.search(r"Permission denied \(([^)]*)\)", err)
    return m.group(1).split(",") if m else None


def parse_apache(text: str) -> tuple[list[dict], list[str], list[int], dict]:
    """(vhosts, fichiers non lisibles, ports Listen, {port: adresse Listen}) depuis la sortie de REMOTE."""
    vhosts, unreadable, listen, listen_addr, conf, cur = [], [], [], {}, None, None
    for line in text.splitlines():
        if line.startswith("##F "):
            conf, cur = line[4:].strip(), None
        elif line.startswith("##U "):
            unreadable.append(os.path.basename(line[4:].strip()))
        elif line.startswith("##LISTEN"):
            listen = [int(p.split(":")[-1]) for p in line[8:].split() if p.split(":")[-1].isdigit()]
            # « Listen 172.30.0.3:8443 » : Apache lié à une seule adresse (souvent un réseau docker)
            listen_addr = {int(p.rsplit(":", 1)[1]): p.rsplit(":", 1)[0] for p in line[8:].split()
                           if ":" in p and p.rsplit(":", 1)[1].isdigit()}
        elif line.startswith(("##NF ", "##NU ")):
            conf, cur = None, None   # nginx files are read by parse_nginx, not as Apache
        elif line.startswith("##"):
            continue
        elif conf:
            s = line.strip()
            m = re.match(r"<VirtualHost\s+[^:>]*:(\d+)", s, re.I)
            if m:
                cur = {"port": int(m.group(1)), "names": [], "docroot": None, "conf": os.path.basename(conf)}
                vhosts.append(cur)
                continue
            if cur is None:
                continue
            k, _, v = s.partition(" ")
            v = v.strip().strip('"')
            if k.lower() in ("servername", "serveralias"):
                cur["names"] += v.split()
            elif k.lower() == "documentroot":
                cur["docroot"] = v
    return vhosts, unreadable, listen, listen_addr


_NGINX_NO_NAME = {"_", "localhost", "default_server", ""}


def _nginx_directive(cur: dict, word: str, rest: str) -> None:
    """One `listen` or `server_name` line of a server block, kept on that block."""
    if word == "listen":
        m = re.search(r"(?:^|:)(\d{1,5})(?:\s|$)", rest.strip() + " ")
        if m and int(m.group(1)) not in cur["ports"]:
            cur["ports"].append(int(m.group(1)))
    elif word == "server_name":
        cur["names"] += [n for n in rest.split() if n not in _NGINX_NO_NAME and not n.startswith(("~", "*", ".")) and "$" not in n]


def parse_nginx(text: str) -> tuple[list[dict], list[str]]:
    """(vhosts, unreadable files) from the ##NF / ##NU sections of REMOTE: one entry per (server block, port), with the
    real server_name values (wildcards, regexes, « _ » and localhost are left out)."""
    vhosts, unreadable, conf, cur = [], [], None, None
    for line in text.splitlines():
        if line.startswith("##NF "):
            conf, cur = os.path.basename(line[5:].strip()), None
        elif line.startswith("##NU "):
            unreadable.append(os.path.basename(line[5:].strip()))
            conf = None
        elif line.startswith("##"):
            conf = conf if line.startswith("##NF") else None
        elif conf:
            word, _, rest = line.strip().rstrip(";{ ").strip().partition(" ")
            if word.lower() == "server":
                cur = {"ports": [], "names": [], "conf": conf}
                vhosts.append(cur)
            elif cur is not None:
                _nginx_directive(cur, word.lower(), rest)
    out = [{"port": p, "names": v["names"], "conf": v["conf"]} for v in vhosts for p in (v["ports"] or [80])]
    return out, unreadable


def host_info(alias: str) -> dict | None:
    """Infos d'une machine : 1 commande SSH (ou locale). None si injoignable."""
    cmd = ["bash", "-c", REMOTE] if alias == "local" else \
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, REMOTE]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode == 255 or "##OS" not in r.stdout:
        return None
    tag = {m.group(1): m.group(2).strip() for m in re.finditer(r"^##(\w+) ?(.*)$", r.stdout, re.M)}
    svc = dict(kv.split("=", 1) for kv in tag.get("SVC", "").split() if "=" in kv)
    sshd = {}
    for kv in filter(None, tag.get("SSHD", "").split(";")):
        k, _, v = kv.strip().partition(" ")
        sshd.setdefault(k.lower(), v)  # 1re occurrence = valeur retenue par sshd
    if tag.get("SSHDR") == "yes":
        # Lisible mais option absente = valeur par défaut d'OpenSSH (Debian)
        for k, v in (("port", "22"), ("permitrootlogin", "prohibit-password"), ("passwordauthentication", "yes")):
            if k not in sshd:
                sshd[k] = v + " (défaut)"
    vhosts, unreadable, listen, listen_addr = parse_apache(r.stdout)
    nginx_vhosts, nginx_unreadable = parse_nginx(r.stdout)
    return {
        "os": tag.get("OS") or (tag.get("ESXI") if tag.get("ESXI", "").startswith("VMware ESXi") else None),
        "kernel": tag.get("KERNEL") or None,
        "uptime_s": int(tag["UP"]) if tag.get("UP", "").isdigit() else None,
        "apache": svc.get("apache2") == "active",
        "nginx": svc.get("nginx") == "active",
        "docker": int(tag["DOCKER"]) if tag.get("DOCKER", "").isdigit() else 0,
        "docker_installed": tag.get("DOCKERBIN") != "no",  # False : pas de Docker sur la machine (jamais une panne d'accès)
        "virt": tag.get("VIRT") if re.fullmatch(r"[a-z0-9-]{2,20}", tag.get("VIRT", "")) and tag.get("VIRT") != "none" else None,  # kvm, vmware, lxc…
        "npm": tag.get("NPM", "").isdigit() and int(tag["NPM"]) > 0,  # conteneur Nginx Proxy Manager présent
        "proxmox": tag.get("PVE") == "yes",
        "esxi": tag.get("ESXI", "").startswith("VMware ESXi"),  # VMware ESXi host: its VMs and datastores are read by vim-cmd  # Proxmox VE host: its guests and storages are read by pvesh at each collection
        "hypervisors": [t for t in tag.get("HV", "").split() if t in ("virsh", "incus", "lxc", "VBoxManage")],  # other hypervisors read by virt_ssh.py
        "sshd": sshd,  # vide si /etc/ssh/sshd_config illisible pour ce compte
        "vhosts": vhosts,
        "vhosts_unreadable": unreadable,
        "nginx_vhosts": nginx_vhosts,
        "nginx_unreadable": nginx_unreadable,
        "apache_listen": listen,
        "apache_listen_addr": {str(k): v for k, v in listen_addr.items()},
    }
