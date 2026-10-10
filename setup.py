#!/usr/bin/env python3
"""Assistant de configuration MyServices : écrit config.json et services-meta.json, puis teste.

  python3 setup.py           questions (valeurs actuelles proposées par défaut), relançable sans risque :
                             un services-meta.json existant est complété, jamais écrasé
  python3 setup.py --add [IP|alias]
                             une seule machine, nouvelle ou déjà déclarée (détection reprise) : ping, ports,
                             SSH Linux ou Windows, docker, AdGuard, VM, souvent éteinte, services web, services
                             connus (NPM…) proposés comme connecteurs ; ne touche pas aux autres machines ;
                             config.json seulement pour un connecteur accepté ; puis vérifie cette machine
  python3 setup.py --lan     affiche le réseau local (CIDR), utilisé par install.sh
  python3 setup.py --check   tests seuls, sans question : chaque instance NPM (facultatif), SSH + docker
                             par machine, AdGuard, droits de health.py, dossier web ; code de sortie 1
                             si un test échoue (droits facultatifs manquants = simple avertissement)

À lancer sous l'utilisateur du collecteur (root avec install.sh) : ce sont SES clés SSH et son
~/.ssh/config qui servent. Lecture seule sur le réseau, comme le collecteur.
"""
from __future__ import annotations

import getpass
import glob
import ipaddress
import json
import os
import re
import select
import shutil
import signal
import socket
import subprocess
import sys
import termios
import tty
import urllib.parse
import urllib.request
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import connectors
import connectors.base as cbase
import hostinfo
import notify
import npmapi
from config import CFG, DEFAULTS, HERE

CONFIG = Path(os.environ.get("MYSERVICES_CONFIG") or HERE / "config.json")
META = Path(CFG["meta"])
EXAMPLE_META = HERE / "services-meta.example.json"
EXAMPLE_BACKUPS = HERE / "backups-meta.example.json"
FAILED: list[str] = []
# Version Docker (image : MYSERVICES_DOCKER=1) : commandes et chemins vus de l'hôte, page dans l'image
DOCKER = os.environ.get("MYSERVICES_DOCKER") == "1"
SETUP = "docker compose exec myservices python3 setup.py" if DOCKER else "sudo python3 setup.py"
SSH_CONF = "/config/ssh/config" if DOCKER else "/root/.ssh/config"


def ask(q: str, default: str = "") -> str:
    a = input(f"{q}{f' [{default}]' if default else ''} : ").strip()
    return a or default


def yes(q: str, default: bool = True) -> bool:
    a = input(f"{q} [{'O/n' if default else 'o/N'}] : ").strip().lower()
    return default if not a else a in ("o", "oui", "y", "yes")


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def bad(msg: str) -> None:
    print(f"  ✗ {msg}")
    FAILED.append(msg)


def warn(msg: str) -> None:
    print(f"  ⚠ {msg}")


def save(path: Path, data: dict) -> None:
    """JSON en 600, rendu au propriétaire du projet (pas de fichier root dans le dépôt). config.json avec
    une clé de chiffrement (secrets chiffrés, version Docker) : secrets rechiffrés avant écriture."""
    if path == CONFIG:
        import secrets_store
        if secrets_store.key_path(CONFIG).exists():
            data, _ = secrets_store.encrypt_all(data, CONFIG)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    st = HERE.stat()
    if os.geteuid() == 0:
        os.chown(tmp, st.st_uid, st.st_gid)
    tmp.replace(path)
    print(f"→ {path} écrit")


def run(alias: str, cmd: str, timeout: int = 20) -> subprocess.CompletedProcess | None:
    """Commande locale (alias "local") ou via SSH, sans mot de passe ni question."""
    argv = ["sh", "-c", cmd] if alias == "local" else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", alias, cmd]
    try:
        return subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


def ssh_why(alias: str, r: subprocess.CompletedProcess | None) -> str:
    """Cause d'un échec SSH en BatchMode (r : résultat de run(alias, "true")), avec la commande qui le règle."""
    if r is None:
        return f"SSH {alias} : délai dépassé (machine éteinte, pare-feu ?)"
    err = r.stderr.lower()
    if "host key verification failed" in err or "no matching host key" in err:
        return f"SSH {alias} : clé d'hôte inconnue, l'accepter une fois : sudo ssh {alias} true"
    if "remote host identification has changed" in err:
        return f"SSH {alias} : clé d'hôte changée (réinstallation ?) : sudo ssh-keygen -R <hôte>, puis sudo ssh {alias} true"
    if "permission denied" in err:
        return (f"SSH {alias} : clé refusée (clé publique de /config/ssh dans authorized_keys du compte visé ?)" if DOCKER else
                f"SSH {alias} : clé refusée (ssh-copy-id fait pour root de cette machine ? clé sans phrase de passe ?)")
    if "could not resolve" in err:
        return f"SSH {alias} : alias ou HostName inconnu de {SSH_CONF}"
    return f"SSH {alias} : {(r.stderr.strip() or 'code ' + str(r.returncode))[-200:]}"


def containers(alias: str) -> list[tuple[str, str, str]] | None:
    """[(nom, image, ports)] des conteneurs ; None = docker inaccessible (absent ou droits)."""
    r = run(alias, "docker ps -a --format '{{.Names}}|{{.Image}}|{{.Ports}}'")
    if r is None or r.returncode != 0:
        return None
    return [tuple((line.split("|") + ["", ""])[:3]) for line in r.stdout.splitlines() if line]


def roles(conts: list[tuple[str, str, str]]) -> dict:
    """Drapeaux services-meta déduits des conteneurs : AdGuard Home, adguardhome-sync."""
    flags = {}
    for name, image, _ in conts:
        if "adguardhome-sync" in image or name.endswith("adguardhome-sync"):
            flags["adguard_sync"] = name
        elif "adguard/adguardhome" in image:
            flags["adguard"] = name
        elif "nginx-proxy-manager" in image:
            flags["npm"] = True  # sous-titre de la page : cette machine héberge NPM
    return flags


# AdGuard Home installé sans Docker : emplacements de AdGuardHome.yaml (script officiel, snap)
NATIVE_ADGUARD = ("/opt/AdGuardHome/AdGuardHome.yaml", "/var/snap/adguard-home/current/AdGuardHome.yaml")


def find_adguard(alias: str, conts: list | None) -> str | None:
    """AdGuard Home de la machine : nom du conteneur, sinon chemin de AdGuardHome.yaml (installation native)."""
    found = roles(conts or []).get("adguard")
    if found:
        return found
    r = run(alias, " ".join(f"[ -e {f} ] && echo {f} && exit;" for f in NATIVE_ADGUARD) + " true")
    return r.stdout.strip() or None if r and r.returncode == 0 else None


def is_vm(alias: str) -> bool:
    """Machine virtuelle ou conteneur (systemd-detect-virt) : health.py n'y lit pas SMART."""
    r = run(alias, "systemd-detect-virt 2>/dev/null")
    return bool(r and r.stdout.strip() not in ("", "none"))


def npm_admin(ports: str) -> tuple[str, int]:
    """(adresse d'écoute, port hôte) de l'admin NPM (port 81 du conteneur) d'après docker ps."""
    m = re.search(r"(\d+\.\d+\.\d+\.\d+):(\d+)->81/tcp", ports)
    return (m.group(1), int(m.group(2))) if m else ("0.0.0.0", 81)


def npm_test(inst: dict) -> str | None:
    """Résumé de lecture d'une instance NPM, None si échec (message affiché)."""
    try:
        got = npmapi.fetch(inst)
    except npmapi.NPMError as e:
        warn(str(e))
        return None
    return f"{len(got['hosts'])} proxy hosts, {len(got['redirects'])} redirections, {len(got['streams'])} streams"


# Ports sondés sur les machines trouvées sur le réseau : indice de ce qu'elles sont (rien n'est envoyé)
HINT_PORTS = {22: "SSH", 3389: "Windows (RDP)", 445: "partage SMB", 9419: "Veeam B&R (API 9419)", 8006: "Proxmox",
              5000: "port 5000", 8123: "Home Assistant", 81: "admin NPM", 80: "web", 443: "web", 32400: "Plex"}
# Services web proposés dans « extra » à l'ajout d'une machine sans SSH : port -> (schéma, nom par défaut)
WEB_PORTS = {80: ("http", "Interface web"), 443: ("https", "Interface web (https)"), 32400: ("http", "Plex")}


def _open(ip: str, port: int) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=0.6):
            return True
    except OSError:
        return False


def parse_targets(text: str) -> list[str]:
    """« 192.168.0.4 192.168.0.10-20 » -> IP listées et plages (dernier octet) ; ValueError si illisible."""
    out = []
    for tok in text.replace(",", " ").split():
        base, _, end = tok.partition("-")
        first = ipaddress.ip_address(base)
        last = int(end) if end else int(str(first).rsplit(".", 1)[1])
        prefix = str(first).rsplit(".", 1)[0]
        out += [f"{prefix}.{n}" for n in range(int(str(first).rsplit(".", 1)[1]), last + 1)]
    return out


STOP_KEY = "q"  # touche d'arrêt de la recherche réseau, sans Entrée


@contextmanager
def keys():
    """Lecture des touches une à une (sans Entrée) pendant le bloc ; renvoie une fonction : touche frappée
    ou "". Hors terminal : jamais de touche. Les frappes restées en attente sont jetées à la sortie,
    pour ne pas répondre à la question suivante."""
    if not sys.stdin.isatty():
        yield lambda: ""
        return
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    tty.setcbreak(fd)
    try:
        yield lambda: sys.stdin.read(1) if select.select([sys.stdin], [], [], 0)[0] else ""
    finally:
        termios.tcflush(fd, termios.TCIFLUSH)
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def lan_scan(net: str, targets: list[str] | None = None, skip: set[str] = frozenset()) -> dict[str, tuple[str, list[str]]]:
    """{ip: (nom DNS, indices)} des machines qui répondent au ping : targets, sinon le réseau local
    (/24 au plus), sauf skip (machines déjà déclarées : ni pinguées ni proposées).
    Touche STOP_KEY (ou Ctrl+C) pendant les pings : arrêt, machines déjà trouvées gardées."""
    hosts = targets or [str(ip) for ip in ipaddress.ip_network(net).hosts()]
    if len(hosts) > 254:  # réseau plus grand qu'un /24 : seul le /24 de la collectrice est parcouru
        hosts = [str(ip) for ip in ipaddress.ip_network(f"{local_net()[0]}/24", strict=False).hosts()]
    known = len(hosts)
    hosts = [ip for ip in hosts if ip not in skip]
    if known > len(hosts):
        print(f"  {known - len(hosts)} machine(s) déjà dans services-meta.json : ignorée(s)")

    def ping(ip):
        return ip if subprocess.run(["ping", "-c1", "-W1", ip], capture_output=True).returncode == 0 else None
    ex, up, stopped = ThreadPoolExecutor(64), [], False
    pending = {ex.submit(ping, ip) for ip in hosts}
    try:
        with keys() as key:
            while pending:
                done, pending = wait(pending, timeout=0.2, return_when=FIRST_COMPLETED)
                up += [f.result() for f in done if f.result()]
                if sys.stdout.isatty():  # compteur sur une ligne, réécrite
                    print(f"\r  {len(hosts) - len(pending)}/{len(hosts)} testées, {len(up)} trouvée(s)"
                          f"  ({STOP_KEY} = arrêter)", end="", flush=True)
                if key().lower() == STOP_KEY:
                    stopped = True
                    break
    except KeyboardInterrupt:
        stopped = True
    finally:
        if stopped:
            print(f"\n  recherche arrêtée : {len(up)} machine(s) déjà trouvée(s)")
        elif sys.stdout.isatty():
            print()  # fin de la ligne du compteur
        old = signal.signal(signal.SIGINT, signal.SIG_IGN)  # un 2e Ctrl+C ne casse pas l'arrêt en cours
        try:
            ex.shutdown(wait=False, cancel_futures=True)
        finally:
            signal.signal(signal.SIGINT, old)

    if up:
        print(f"  identification de {len(up)} machine(s) : nom, ports…")
    with ThreadPoolExecutor(32) as ex:
        return dict(zip(up, ex.map(identify, up)))


def identify(ip: str) -> tuple[str, list[str]]:
    """(nom DNS court, indices d'après les ports ouverts) d'une machine."""
    try:
        name = socket.gethostbyaddr(ip)[0].split(".")[0].lstrip("_")  # « _gateway » de systemd-resolved
    except OSError:
        name = ""
    with ThreadPoolExecutor(len(HINT_PORTS)) as px:  # ports en parallèle : ~0,6 s par machine au plus
        opened = list(px.map(lambda port: _open(ip, port), HINT_PORTS))
    return name, list(dict.fromkeys(h for (port, h), o in zip(HINT_PORTS.items(), opened) if o))


def ssh_os(alias: str) -> tuple[str | None, subprocess.CompletedProcess | None]:
    """("linux" | "windows" | None, résultat SSH pour ssh_why). Windows : OpenSSH Server répond, mais sans
    uname ni true (shell cmd ou PowerShell) ; reconnu par PowerShell."""
    r = run(alias, "uname -s", timeout=10)
    if r is not None and r.returncode == 0:
        return "linux", r
    if r is not None and "permission denied" not in r.stderr.lower():
        import health
        w = run(alias, health.ps_command("$PSVersionTable.PSVersion.Major"), timeout=30)
        if w is not None and w.returncode == 0 and w.stdout.strip().isdigit():
            return "windows", w
    return None, r


def attach_ssh(m: dict, alias: str, kind: str, conts: list | None = None) -> None:
    """Accès SSH d'une machine : Linux = inventaire (ssh, docker, AdGuard, VM) ; Windows = santé seulement
    (le collecteur ne lit que Linux : "ssh" reste null, l'alias va dans "health")."""
    if kind == "windows":
        m.update(ssh=None, os="windows", health=alias)
        ok(f"Windows joignable par {alias} : santé activée (\"os\": \"windows\", \"health\": \"{alias}\")")
        return
    conts = conts if conts is not None else containers(alias)
    m["ssh"] = alias
    m.update(roles(conts or []))
    if is_vm(alias):
        m["vm"] = True
    ok(f"docker : {len(conts)} conteneurs") if conts is not None else warn("docker inaccessible (groupe docker ?)")
    for k in ("adguard", "adguard_sync"):
        if k in m:
            ok(f"  {k} détecté : {m[k]}")


def ask_extras(meta: dict, ip: str, m: dict, hints: list[str]) -> None:
    """Machine sans inventaire Linux : « souvent éteint ? » et services web à suivre (extra)."""
    # PC souvent éteint (poste, portable) : « machine éteinte » sans alerte tant qu'il ne répond pas
    if yes("  Souvent éteint (PC, portable) ?", m.get("off", "Windows (RDP)" in hints or m.get("os") == "windows")):
        m["off"] = True
    else:
        m.pop("off", None)
    # Services web : sondés à chaque passage par le collecteur (sinon seulement le ping)
    with ThreadPoolExecutor(len(WEB_PORTS)) as px:
        web = [p for p, o in zip(WEB_PORTS, px.map(lambda p: _open(ip, p), WEB_PORTS)) if o]
    known = {(x["ip"], x["port"]) for x in meta.setdefault("extra", [])}
    for port in web:
        scheme, label = WEB_PORTS[port]
        if (ip, port) not in known and yes(f"  Suivre {scheme}://{ip}:{port} ({label}) ?"):
            meta["extra"].append({"name": ask("    Nom", f"{m['name']} · {label}"), "ip": ip,
                                  "port": port, "scheme": scheme})


WEB_SERVERS = ("nginx", "apache2", "httpd", "caddy", "lighttpd")


def page_url(ip: str) -> str:
    """URL de la page : port du serveur web local qui répond déjà sur /myservices/ (réinstallation, config
    faite à la main), sinon 80 s'il y écoute, sinon son premier port (Apache sur 8066 : …:8066/myservices/)."""
    r = run("local", "ss -tlnpH")
    ports = set()
    for line in r.stdout.splitlines() if r else []:
        m = re.search(r"^\S+\s+\S+\s+\S+\s+(?:\S*):(\d+)\s", line)
        pid = re.search(r"pid=(\d+)", line)
        if not (m and pid and any(f'"{w}"' in line for w in WEB_SERVERS)):
            continue
        try:  # nginx d'un conteneur (NPM en réseau host) : ce n'est pas le serveur web de la page
            cgroup = Path(f"/proc/{pid.group(1)}/cgroup").read_text()
        except OSError:
            cgroup = ""
        if "docker" in cgroup or "containerd" in cgroup:
            continue
        ports.add(int(m.group(1)))
    ports = sorted(ports)

    def url(port):
        return f"http://{ip}{'' if port == 80 else f':{port}'}/myservices/"

    def serves(port):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/myservices/data.json", timeout=2) as resp:
                return resp.status == 200
        except (OSError, ValueError):
            return False
    with ThreadPoolExecutor(16) as ex:
        hit = next((p for p, ok_ in zip(ports, ex.map(serves, ports)) if ok_), None)
    if hit:
        return url(hit)
    return url(80 if 80 in ports or not ports else ports[0])


def local_net() -> tuple[str, str, str]:
    """(IP du collecteur, passerelle, réseau local en CIDR) d'après la route par défaut."""
    gw, ip, net = "", "", ""
    r = run("local", "ip -4 route show default")
    if r and r.stdout.split():
        w = r.stdout.split()
        gw = w[w.index("via") + 1] if "via" in w else ""
        dev = w[w.index("dev") + 1] if "dev" in w else ""
        a = run("local", f"ip -4 -o addr show dev {dev} scope global")
        if a and a.stdout.split():
            cidr = a.stdout.split()[3]
            ip, net = cidr.split("/")[0], str(ipaddress.ip_interface(cidr).network)
    return ip, gw, net


# ---------------------------------------------------------------------------
# config.json
# ---------------------------------------------------------------------------

def setup_config() -> dict:
    cur = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    val = {**DEFAULTS, **cur}
    print(f"\n== config.json ({'existant, valeurs actuelles par défaut' if cur else 'nouveau'})")

    val["web_dir"] = ask("Dossier web (servi par nginx, data.json y est écrit)", val["web_dir"])
    ip = local_net()[0] or socket.gethostname()
    val["public_url"] = ask("URL de la page (lien dans les alertes, vide = aucun)", val["public_url"] or page_url(ip))
    if val["public_url"] and not val["public_url"].endswith("/"):  # /myservices sans / : 404 (Alias / location en /myservices/)
        val["public_url"] += "/"
    val["collector_name"] = ask("Nom de cette machine dans les alertes", val["collector_name"] or socket.gethostname())
    val["discord_webhook"] = ask("Webhook Discord des alertes (vide = aucun)", val["discord_webhook"])
    # Santé des machines : health.py intégré (health_url "health/") ou health-watcher externe (autre URL)
    if val["health_url"] in ("", "health/"):
        val["health_url"] = "health/" if yes("Santé des machines (health.py : disque, systemd, maj, SMART…, toutes les 6 h) ?",
                                             val["health_url"] != "" or not CONFIG.exists()) else ""
    else:
        ok(f"santé : health-watcher externe ({val['health_url']}), gardé")
    if val["discord_webhook"] and yes("Envoyer un message de test sur ce webhook ?", False):
        req = urllib.request.Request(val["discord_webhook"], headers={"Content-Type": "application/json", "User-Agent": "myservices-setup"},
                                     data=json.dumps({"content": "MyServices : test du webhook (setup.py)"}).encode())
        try:
            urllib.request.urlopen(req, timeout=10).close()
            ok("message de test envoyé")
        except OSError as e:
            warn(f"échec de l'envoi : {e}")
    # Telegram : jeton de @BotFather ; conversation trouvée par getUpdates après un message envoyé au bot
    val["telegram_token"] = ask("Jeton du bot Telegram des alertes (@BotFather, vide = aucun)", val["telegram_token"])
    if val["telegram_token"]:
        if not val["telegram_chat_id"]:
            input("  Écrire un message au bot (ou l'ajouter au groupe et y écrire), puis Entrée…")
            try:
                chats = notify.telegram_chats(val["telegram_token"])
            except (OSError, ValueError) as e:
                chats = []
                warn(f"lecture des conversations du bot impossible : {notify.why(e)}")
            for cid, name in chats:
                print(f"  {cid} : {name}")
            if len(chats) == 1:
                val["telegram_chat_id"] = chats[0][0]
        val["telegram_chat_id"] = ask("  Conversation qui reçoit (chat_id)", val["telegram_chat_id"])
        CFG.update(telegram_token=val["telegram_token"], telegram_chat_id=val["telegram_chat_id"])
        if val["telegram_chat_id"] and yes("Envoyer un message de test sur Telegram ?", False):
            sent, msg = notify.send_telegram("MyServices : test des alertes Telegram (setup.py)")
            ok(msg) if sent else warn(msg)
    else:
        val["telegram_chat_id"] = ""
    return val


def save_config(val: dict) -> None:
    # Seules les valeurs différentes des défauts sont écrites : le fichier reste lisible
    save(CONFIG, {k: v for k, v in val.items() if k.startswith("_") or k not in DEFAULTS or v != DEFAULTS[k]})


# ---------------------------------------------------------------------------
# services-meta.json
# ---------------------------------------------------------------------------

def setup_meta() -> dict:
    exists = META.exists()
    meta = json.loads((META if exists else EXAMPLE_META).read_text(encoding="utf-8"))
    print(f"\n== services-meta.json ({'existant : ajout des machines manquantes' if exists else 'nouveau'})")
    if not exists:  # l'exemple ne sert que pour _doc et les catégories
        meta.update(machines={}, ignored_ips=[], process_hosts={}, services={}, extra=[])
    machines = meta["machines"]

    ip, gw, _ = local_net()
    if DOCKER and ip and ip not in machines:
        # Conteneur : « local » serait le conteneur lui-même ; la machine hôte se lit par l'alias « hote »
        # (créé par import_install.py, ou à ajouter dans /config/ssh/config), comme les autres machines
        machines[ip] = {"name": socket.gethostname(), "role": "hôte de MyServices (Docker)", "ssh": None}
        kind, r = ssh_os("hote")
        if kind == "linux":
            attach_ssh(machines[ip], "hote", kind)
            meta["process_hosts"][ip] = "hote"
        else:
            warn(f"{ip} : machine hôte sans accès SSH ({ssh_why('hote', r)}) : alias « hote » dans {SSH_CONF}, "
                 f"puis {SETUP} --add hote")
    elif ip and ip not in machines:
        conts = containers("local")
        machines[ip] = {"name": socket.gethostname(), "role": "collecteur MyServices", "ssh": "local", **roles(conts or [])}
        if is_vm("local"):
            machines[ip]["vm"] = True
        meta["process_hosts"][ip] = "local"
        ok(f"{ip} : cette machine ({'docker : ' + str(len(conts)) + ' conteneurs' if conts is not None else 'docker inaccessible'})")
    if gw and gw not in machines and yes(f"Ajouter la passerelle {gw} ?"):
        machines[gw] = {"name": ask("  Nom", "Passerelle"), "role": "passerelle", "ssh": None, "gateway": True}

    seen = set(machines)
    for host, s in hostinfo.ssh_config().items():
        try:
            hip = socket.gethostbyname(host)
        except OSError:
            warn(f"{s['alias']} : {host} ne résout pas, ignoré")
            continue
        if hip in seen:
            # Machine déjà déclarée sans SSH (ajoutée par la recherche réseau) à qui on a donné un alias depuis
            m = machines.get(hip)
            if m and not m.get("ssh") and not isinstance(m.get("health"), str) and not m.get("gateway"):
                kind, r = ssh_os(s["alias"])
                if kind:
                    if yes(f"{m.get('name', hip)} ({hip}) est déclarée sans SSH : utiliser l'alias {s['alias']} ({kind}) ?"):
                        attach_ssh(m, s["alias"], kind)
                else:
                    warn(f"{m.get('name', hip)} : alias {s['alias']} trouvé, mais {ssh_why(s['alias'], r)}")
            continue
        seen.add(hip)
        kind, r = ssh_os(s["alias"])
        if not kind:
            warn(ssh_why(s["alias"], r))
        conts = containers(s["alias"]) if kind == "linux" else None
        state = {"linux": "SSH ✓, docker : " + (f"{len(conts)} conteneurs" if conts is not None else "inaccessible (groupe docker ?)"),
                 "windows": "Windows, OpenSSH ✓ : santé"}.get(kind, "SSH injoignable")
        if not yes(f"Ajouter {s['alias']} ({hip}, {state}) ?", bool(kind)):
            continue
        m = {"name": ask("  Nom", s["alias"]), "role": ask("  Rôle (libre)", ""), "ssh": None}
        if kind:
            attach_ssh(m, s["alias"], kind, conts)
        machines[hip] = m

    # AdGuard Home installé après l'ajout de la machine : roles() ne joue qu'à l'ajout, d'où une nouvelle
    # détection sur les machines déjà déclarées avec SSH (adguardhome-sync est détecté par le collecteur)
    for mip, m in machines.items():
        if m.get("ssh") and "adguard" not in m:  # machine ajoutée à l'instant : déjà détectée, rien de neuf
            found = find_adguard(m["ssh"], containers(m["ssh"]))
            what = f"installation native, {found}" if found and found.startswith("/") else f"conteneur {found}"
            if found and yes(f"AdGuard Home détecté sur {m.get('name', mip)} ({what}) : le suivre ?"):
                m["adguard"] = found

    # Machines sans alias SSH (Windows, NAS, box…) : trouvées par un ping du réseau local, ajoutées sans
    # inventaire (ssh null) : ping, services manuels, sauvegardes. Pour docker et la santé : un alias SSH.
    net = local_net()[2]
    # Ctrl+C pendant le scan ou les propositions : arrête seulement cette partie, les machines déjà
    # ajoutées sont gardées et setup.py continue (NPM, enregistrement)
    print(f"\nAutres machines (Windows, NAS, box…) : Entrée = chercher sur tout {net} (~10 s, touche {STOP_KEY} pour arrêter),"
          "\n  ou leurs IP seulement (ex. 192.168.0.4 192.168.0.10-20), ou n = aucune")
    while True:
        a = ask("  Machines à chercher", "") if net else "n"
        try:
            targets = [] if a.lower() in ("", "o", "oui") else None if a.lower() in ("n", "non") else parse_targets(a)
            break
        except ValueError:
            warn(f"« {a} » illisible : IP séparées par des espaces, plage 192.168.0.10-20")
    if targets is not None:
        try:
            found = lan_scan(net, targets, skip=seen)
            print(f"  {len(found)} machine(s) non déclarée(s) répondent ({STOP_KEY} : arrêter la liste)")
            for hip, (name, hints) in sorted(found.items(), key=lambda x: ipaddress.ip_address(x[0])):
                what = ", ".join(hints) or "aucun port connu"
                a = input(f"Ajouter {hip}{' (' + name + ')' if name else ''} : {what} ? [o/N/{STOP_KEY}] : ").strip().lower()
                if a == STOP_KEY:
                    warn("liste arrêtée : machines déjà ajoutées gardées")
                    break
                if a not in ("o", "oui", "y", "yes"):
                    continue
                m = {"name": ask("  Nom", name or hip), "role": ask("  Rôle (libre)", hints[0] if hints else ""), "ssh": None}
                machines[hip] = m  # seulement une fois nom et rôle donnés
                ask_extras(meta, hip, m, hints)
                if "SSH" in hints:
                    warn(f"  {hip} accepte SSH : un alias dans {SSH_CONF}, puis relancer setup.py, donne docker et santé")
        except KeyboardInterrupt:
            print()
            warn("recherche réseau arrêtée : machines déjà ajoutées gardées, suite de la configuration")

    for m in machines.values():  # l'hôte NPM se déduit maintenant des instances de config.json
        m.pop("npm", None)
    save(META, meta)
    print("Catégories, surcharges de services et services manuels : à éditer à la main (voir _doc).")
    return machines


# ---------------------------------------------------------------------------
# Instances NPM (config.json « npm »)
# ---------------------------------------------------------------------------

# npm-api.sh (projet séparé, déjà configuré par son npm-api.conf) : accès préféré, aucun identifiant
# NPM dans config.json. Cherché dans le PATH et aux emplacements usuels d'un clone.
NPM_API_GLOBS = ("/opt/*/npm-api.sh", "/opt/*/*/npm-api.sh", "/usr/local/bin/npm-api.sh", "/root/*/npm-api.sh",
                 "/home/*/npm-api.sh", "/home/*/*/npm-api.sh", "/home/*/*/*/npm-api.sh")


def find_npm_api() -> list[str]:
    found, seen = [], set()
    for f in [shutil.which("npm-api.sh") or ""] + [g for pat in NPM_API_GLOBS for g in sorted(glob.glob(pat))]:
        if f and os.access(f, os.X_OK) and os.path.realpath(f) not in seen:
            seen.add(os.path.realpath(f))
            found.append(f)
    return found


def npm_credentials(inst: dict) -> dict:
    inst["user"] = ask("  Identifiant (e-mail) de l'admin NPM", inst.get("user", ""))
    inst["password"] = getpass.getpass("  Mot de passe (non affiché) : ") or inst.get("password", "")
    return inst


def setup_npm(val: dict, machines: dict) -> None:
    """Instances existantes testées, NPM détectés dans docker proposés, ajout manuel possible."""
    print("\n== Instances Nginx Proxy Manager")
    by_alias = {m["ssh"]: ip for ip, m in machines.items() if m.get("ssh")}
    triples = {ip: (m["name"], m.get("role", ""), m.get("ssh")) for ip, m in machines.items()}
    insts = val["npm"] or ([{"name": "NPM", "api": val["npm_api"]}] if val["npm_api"] else [])
    val["npm_api"] = ""  # ancien format converti en instance « api »
    kept = []
    for inst in insts:
        res = npm_test(inst)
        if res:
            ok(f"{inst['name']} : {res}")
        elif yes(f"  Retirer l'instance {inst['name']} ?", False):
            continue
        kept.append(inst)
    known = {npmapi.instance_ip(i, triples) for i in kept}
    used = {os.path.realpath(i["api"]) for i in kept if i.get("api")}

    # Chemin toujours demandé, pré-rempli avec le script trouvé : Entrée = celui-ci, autre chemin, n = aucun
    found = [f for f in find_npm_api() if os.path.realpath(f) not in used]
    while True:
        default = found[0] if found else ""
        path = ask("Chemin de npm-api.sh déjà configuré" + (f" (trouvé ; autre chemin, ou n = aucun)" if default
                                                          else " (vide = aucun)"), default)
        if not path or path.lower() in ("n", "non"):
            break
        path = os.path.expanduser(path)
        found = [f for f in found if os.path.realpath(f) != os.path.realpath(path)]
        if os.path.realpath(path) in used:
            warn(f"{path} : déjà utilisé")
            continue
        if not os.access(path, os.X_OK):
            warn(f"{path} : introuvable ou non exécutable (chmod +x ?)")
            continue
        inst = {"name": "NPM", "api": path}
        res = npm_test(inst)
        if res:
            ok(res)
        else:
            warn(f"échec : npm-api.conf à côté du script ? test : {path} --info")
            if not yes("  Garder quand même ?", False):
                continue
        ip = npmapi.instance_ip(inst, triples)
        if ip and ip in known:
            warn(f"NPM {ip} déjà déclaré : pas de 2e instance (chaque host serait affiché deux fois)")
            continue
        inst["name"] = ask("  Nom de l'instance", machines.get(ip, {}).get("name") or "NPM")
        kept.append(inst)
        known.add(ip)
        used.add(os.path.realpath(path))
        if not found and not yes("Un autre npm-api.sh (autre instance NPM) ?", False):
            break

    for alias, mip in by_alias.items():
        for name, image, ports in containers(alias) or []:
            if "nginx-proxy-manager" not in image or mip in known:
                continue
            bind, port = npm_admin(ports)
            local_only = bind.startswith("127.")
            inst = {"name": machines[mip]["name"], "ip": mip,
                    "url": f"http://{'127.0.0.1' if local_only or alias == 'local' else mip}:{port}"}
            if local_only and alias != "local":
                inst["ssh"] = alias  # admin sur 127.0.0.1 de la machine distante : lu par SSH
            how = f"admin {bind}:{port}" + (", lu par SSH" if inst.get("ssh") else "")
            if not yes(f"NPM détecté sur {machines[mip]['name']} ({mip}, {how}) : l'ajouter ?"):
                continue
            inst["name"] = ask("  Nom de l'instance", inst["name"])
            api = ask("  Chemin de npm-api.sh déjà configuré pour ce NPM (vide = identifiants de l'admin)")
            if api:
                inst = {"name": inst["name"], "ip": mip, "api": os.path.expanduser(api)}
            while True:
                res = npm_test(inst if api else npm_credentials(inst))
                if res or not yes("  Réessayer ?", False):
                    break
            if res:
                ok(f"{inst['name']} : {res}")
            elif not yes("  Garder quand même ?", False):
                continue
            kept.append(inst)
            known.add(mip)

    while yes("Ajouter une instance NPM à la main ?", False):
        inst = {"name": ask("  Nom de l'instance")}
        mode = ask("  Accès : 1 = npm-api.sh déjà configuré, 2 = URL directe + identifiants, 3 = par SSH + identifiants", "1")
        if mode == "1":
            inst["api"] = os.path.expanduser(ask("  Chemin de npm-api.sh"))
        else:
            if mode == "3":
                inst["ssh"] = ask("  Alias SSH de la machine")
            inst["url"] = ask("  URL de l'admin NPM" + (" vue depuis cette machine" if mode == "3" else ""),
                              "http://127.0.0.1:81" if mode == "3" else "")
            npm_credentials(inst)
        inst["ip"] = ask("  IP de ce NPM vue du LAN (contrôle DNS)", npmapi.instance_ip(inst, triples) or "")
        res = npm_test(inst)
        if res:
            ok(f"{inst['name']} : {res}")
        if res or yes("  Garder quand même ?", False):
            kept.append(inst)
    if not kept:
        ok("pas de NPM : annuaire docker, process et services manuels seulement")
    names = [i["name"] for i in kept]
    if len(set(names)) != len(names):
        bad("deux instances NPM ont le même nom : corriger config.json")
    val["npm"] = kept


# ---------------------------------------------------------------------------
# Sauvegardes (backups-meta.json) : assistant Veeam Backup & Replication
# ---------------------------------------------------------------------------

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "x"


def _veeam_secrets(path: Path) -> bool:
    """Compte en lecture (rôle Veeam Backup Viewer) écrit en 600 ; False si rien n'est saisi."""
    if path.exists() and yes(f"  Identifiants Veeam déjà dans {path} : les garder ?"):
        return True
    user = ask("  Compte Veeam en lecture seule (rôle « Veeam Backup Viewer »), ex. NOMDUPC\\compte")
    if not user:
        return False
    password = getpass.getpass("  Mot de passe (non affiché) : ")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(f"VEEAM_USER={user}\nVEEAM_PASS={password}\n")
    os.chmod(path, 0o600)
    ok(f"identifiants écrits dans {path} (600)")
    return True


def setup_backups(val: dict, machines: dict) -> None:
    """Onglet Backups. Veeam : serveur trouvé (port 9419), compte testé, un jeu par job choisi.
    Proxmox, tar, rsync… : jeux décrits à la main (fichiers d'archives), voir backups-meta.example.json."""
    import backups
    print("\n== Sauvegardes (onglet Backups)")
    path = Path(CFG["backups_meta"])
    bm = json.loads(path.read_text(encoding="utf-8")) if path.exists() else \
        {"hosts": [], "sets": [], "discover": json.loads(EXAMPLE_BACKUPS.read_text(encoding="utf-8"))["discover"],
         "discover_ignore": {}, "cron_ignore": [], "syncthing": []}
    if path.exists():
        ok(f"{path.name} : {len(bm.get('sets', []))} jeu(x) déjà décrit(s)")
    veeam = next((h for h in bm["hosts"] if h.get("api") == "veeam"), None)
    if not yes("Veeam Backup & Replication (Windows) : suivre ses jobs ?" if not veeam else
               f"Veeam ({veeam['url']}) : chercher de nouveaux jobs ?", bool(veeam)):
        print("Autres sauvegardes (Proxmox vzdump, tar, rsync, NAS) : jeux à décrire dans backups-meta.json,\n"
              "  sur le modèle de backups-meta.example.json (README, bloc 7).")
        if path.exists() and not val["backups_url"]:  # inventaire écrit à la main : onglet activé
            val["backups_url"] = "backups.json"
        return
    if not veeam:
        # Serveur Veeam : la machine déclarée dont le port 9419 (API REST) répond
        with ThreadPoolExecutor(16) as ex:
            cands = [ip for ip, hit in zip(machines, ex.map(lambda ip: _open(ip, 9419), machines)) if hit]
        if cands:
            ok(f"API Veeam (port 9419) trouvée sur {', '.join(cands)}")
        else:
            warn("aucune machine ne répond sur le port 9419 : pare-feu Windows à ouvrir pour cette machine")
        url = ask("  Serveur Veeam : IP ou URL de l'API", cands[0] if cands else "")
        if not url:
            return
        url = url if url.startswith("http") else f"https://{url}:9419"
        ip = urllib.parse.urlsplit(url).hostname
        veeam = {"id": "veeam", "label": machines.get(ip, {}).get("name") or "Veeam", "ip": ip,
                 "kind": "Veeam Backup & Replication", "api": "veeam", "url": url,
                 "secrets": str(Path("/root" if os.geteuid() == 0 else Path.home()) / ".veeam-secrets")}
    while True:
        if not _veeam_secrets(Path(veeam["secrets"])):
            return
        got, err = backups.api_collect(backups.Veeam, veeam, "API Veeam")
        if got:
            break
        warn(f"{err} (port 9419 ouvert ? compte au rôle Veeam Backup Viewer ? NOMDUPC\\compte ou compte seul)")
        if not yes("  Réessayer avec d'autres identifiants ?", True):
            return
    jobs = got["veeam_jobs"]
    ok(f"API Veeam : {len(jobs)} job(s)")
    if veeam not in bm["hosts"]:
        bm["hosts"].append(veeam)
    known = {loc.get("veeam_job") for st in bm["sets"] for loc in st.get("locations", [])}
    by_name = {m.get("name", ip).lower(): (ip, m) for ip, m in machines.items()}
    for job, j in sorted(jobs.items()):
        if job in known:
            continue
        last = datetime.fromtimestamp(j["last_run"]).strftime("%d/%m %H:%M") if j["last_run"] else "jamais"
        if not yes(f"Suivre le job « {job} » (dernier passage {last}, {j['result']}) ?", True):
            continue
        guess = next((m.get("name") for n, (ip, m) in by_name.items() if n and n in job.lower()), "")
        origin = ask("  Machine sauvegardée par ce job (nom)", guess or job)
        ip, m = by_name.get(origin.lower(), ("", {}))
        oid = _slug(origin)
        if not any(h["id"] == oid for h in bm["hosts"]):  # poste sauvegardé : ni SSH ni API, seulement origine
            bm["hosts"].append({"id": oid, "label": origin, "ip": ip, "kind": m.get("role", ""), "api": "none"})
        age = ask("  Alerte si le dernier passage a plus de (jours)", "2")
        bm["sets"].append({"id": _slug(f"{oid}-{job}"), "label": f"{origin} : {job}", "origin": oid,
                           "schedule": "job Veeam", "max_age_days": float(age) if age.replace(".", "", 1).isdigit() else 2,
                           "locations": [{"host": "veeam", "veeam_job": job, "via": "Veeam"}]})
    save(path, bm)
    val["backups_url"] = "backups.json"
    print("Test : sudo python3 backups.py (écrit web/backups.json), puis sudo ./install.sh pour le timer (07:05, 19:05).")


# ---------------------------------------------------------------------------
# --check
# ---------------------------------------------------------------------------

def check_windows(alias, label: str) -> None:
    """Machine Windows : OpenSSH Server joignable par l'alias « health », PowerShell qui répond."""
    import health
    if not isinstance(alias, str):
        warn(f"{label} : \"os\": \"windows\" sans alias : \"health\": \"<alias SSH>\" (README, santé Windows)")
        return
    r = run(alias, health.ps_command("$PSVersionTable.PSVersion.Major;([Security.Principal.WindowsPrincipal]"
                                     "[Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')"), timeout=30)
    if r is None or r.returncode != 0:
        why = ssh_why(alias, run(alias, "echo ok", timeout=10))
        warn(f"{label} : {why}. Windows : OpenSSH Server démarré ? clé d'un administrateur dans "
             "C:\\ProgramData\\ssh\\administrators_authorized_keys")
        return
    ver, admin = (r.stdout.split() + ["?", "?"])[:2]
    ok(f"{label} : Windows joignable (PowerShell {ver})")
    if admin.lower() != "true":
        warn(f"{label} : compte non administrateur : échecs de connexion (journal Sécurité) non lisibles")


def check_health(alias: str, label: str, m: dict) -> None:
    """Droits facultatifs de health.py : lecture du journal (groupe adm), SMART (sudoers smartctl).
    sudo -l vérifie la règle sans lancer smartctl."""
    alias = m["health"] if isinstance(m.get("health"), str) else alias
    if alias == "local":
        return  # health.py tourne en root sur la collectrice
    r = run(alias, "journalctl -q -n 1 --no-pager 2>/dev/null | grep -q .")
    if not (r and r.returncode == 0):
        warn(f"{label} : journal non lisible (échecs SSH, noyau) : sudo usermod -aG adm <compte> sur la machine")
    if m.get("vm"):
        return
    # Compte et disques réels (NVMe : le contrôleur nvme0, comme health.py), pour donner la règle exacte
    r = run(alias, "test -x /usr/sbin/smartctl && whoami && lsblk -dno NAME,TYPE | awk '$2==\"disk\"{print $1}'")
    if not (r and r.returncode == 0):
        warn(f"{label} : smartctl absent (sudo apt install smartmontools), ou \"vm\": true si c'est une VM")
        return
    user, *disks = r.stdout.split()
    devs = sorted({"/dev/" + re.sub(r"^(nvme\d+)n\d+$", r"\1", d) for d in disks})
    if all((x := run(alias, f"sudo -n -l /usr/sbin/smartctl -H {d}")) and x.returncode == 0 for d in devs):
        return
    # Disques un par un, jamais /dev/* : dans sudoers, * peut aussi couvrir des options (-s off…)
    rule = f"{user} ALL=(root) NOPASSWD: " + ", ".join(f"/usr/sbin/smartctl -H {d}" for d in devs)
    warn(f"{label} : SMART refusé. Sur la machine :\n      echo '{rule}' | sudo tee /etc/sudoers.d/myservices-smart-health"
         " && sudo chmod 440 /etc/sudoers.d/myservices-smart-health && sudo visudo -cf /etc/sudoers.d/myservices-smart-health")


def ssh_aliases() -> dict[str, str]:
    """{IP: alias} des hôtes de ~/.ssh/config (premier alias par IP)."""
    aliases = {}
    for host, s in hostinfo.ssh_config().items():
        try:
            aliases.setdefault(socket.gethostbyname(host), s["alias"])
        except OSError:
            pass
    return aliases


def check_machine(mip: str, m: dict, aliases: dict[str, str]) -> None:
    """Accès d'une machine de services-meta : SSH, docker, AdGuard, santé (Windows : PowerShell).
    aliases : ssh_aliases(), pour signaler une machine sans SSH alors qu'un alias la vise."""
    alias, label = m.get("ssh"), f"{m.get('name', mip)} ({mip})"
    if m.get("os") == "windows":  # santé Windows : alias dans « health », jamais dans « ssh » (collecteur Linux)
        check_windows(m.get("health"), label)
        return
    if not alias:
        if mip in aliases and not m.get("gateway"):
            warn(f"{label} : l'alias SSH « {aliases[mip]} » vise cette machine, mais \"ssh\" est null. "
                 f"{SETUP} --add {aliases[mip]} le règle, ou \"ssh\": \"{aliases[mip]}\" dans services-meta.json")
        else:
            ok(f"{label} : pas d'inventaire (ssh null)")
        return
    conts = containers(alias)
    if conts is not None:
        ok(f"{label} : docker {len(conts)} conteneurs")
    elif alias != "local" and ((r := run(alias, "true", timeout=10)) is None or r.returncode != 0):
        warn(f"{label} : {ssh_why(alias, r)}")
        return
    else:
        warn(f"{label} : docker inaccessible (absent, ou compte hors du groupe docker : usermod -aG docker <compte>, "
             "puis nouvelle session)")
    names = {c[0] for c in conts or []}
    for k in ("adguard", "adguard_sync"):
        if m.get(k) and not str(m[k]).startswith("/") and conts is not None and m[k] not in names:
            bad(f"{label} : conteneur {k} « {m[k]} » introuvable")
    if str(m.get("adguard", "")).startswith("/"):  # AdGuard natif : fichier lu par cat, ou sudo -n cat
        f = m["adguard"]
        r = run(alias, f"test -r {f} || sudo -n -l /usr/bin/cat {f} >/dev/null 2>&1 && echo ok; whoami")
        if r and r.stdout.split()[:1] == ["ok"]:
            ok(f"{label} : AdGuard natif lisible ({f})")
        else:
            user = (r.stdout.split() or ["<compte>"])[-1] if r else "<compte>"
            warn(f"{label} : {f} illisible. Sur la machine :\n      echo '{user} ALL=(root) NOPASSWD: /usr/bin/cat {f}'"
                 " | sudo tee /etc/sudoers.d/myservices-adguard && sudo chmod 440 /etc/sudoers.d/myservices-adguard"
                 " && sudo visudo -cf /etc/sudoers.d/myservices-adguard")
    elif m.get("adguard") in names:
        r = run(alias, f"docker exec {m['adguard']} test -r /opt/adguardhome/conf/AdGuardHome.yaml")
        if r and r.returncode == 0:
            ok(f"{label} : AdGuard {m['adguard']} lisible")
        else:
            warn(f"{label} : /opt/adguardhome/conf/AdGuardHome.yaml illisible dans {m['adguard']} "
                 "(image autre que adguard/adguardhome ?)")
    if "adguard_sync" not in m and any("adguardhome-sync" in f"{c[0]} {c[1]}" for c in conts or []):
        ok(f"{label} : adguardhome-sync détecté (lu automatiquement ; \"adguard_sync\": false pour l'ignorer)")
    if CFG["health_url"] == "health/" and m.get("health") is not False and not m.get("off"):
        check_health(alias, label, m)


def check() -> int:
    print("== Vérification")
    if sys.version_info < (3, 9):
        bad(f"Python {sys.version.split()[0]} : 3.9 minimum")
    for f in (CONFIG, META):
        if not f.exists():
            bad(f"{f} absent : python3 setup.py")
    if FAILED:
        return 1
    conns = []
    for kind in cbase.KINDS:  # réglage faux : échec, sauf pour une alerte (la collecte n'en dépend pas)
        try:
            have = {(c.type, c.name) for c in conns}  # un connecteur à plusieurs apports : testé une fois
            conns += [c for c in connectors.instances(CFG, kind=kind) if (c.type, c.name) not in have]
        except connectors.ConnectorError as e:
            (warn if kind == "alerts" else bad)(f"{e}{' : pas d’envoi' if kind == 'alerts' else ''}")
    if not any(c.type == "npm" for c in conns) and not FAILED:
        ok("pas de NPM (config.json : npm vide) : annuaire docker, process et services manuels seulement")
    triples = {mip: (m.get("name"), m.get("role"), m.get("ssh"))
               for mip, m in json.loads(META.read_text(encoding="utf-8")).get("machines", {}).items()}
    seen_ip = {}
    for c in conns:  # chaque connecteur : connexion, lecture et version du service
        r = c.test()
        label = f"{c.label} {c.name}" if c.type != "npm" else f"NPM {c.name}"
        if not r.ok:
            bad(f"{label} illisible : {r.message}")
            continue
        tested = cbase.version_tested(r.version, c.tested)
        ok(f"{label} : {r.message}" + (f" (version {r.version})" if r.version else ""))
        if tested is False:
            warn(f"{label} : version {r.version} non testée (testées : {', '.join(c.tested)}) : à surveiller, "
                 "l'API a pu changer")
        if c.type == "npm":
            ip = c.lan_ip(triples)
            if ip and ip in seen_ip:
                bad(f"NPM {c.name} = NPM {seen_ip[ip]} ({ip}) : même NPM déclaré deux fois, chaque host serait en double. "
                    f"Retirer l'entrée « {c.name} » de « npm » dans config.json")
            seen_ip.setdefault(ip, c.name)
    web = Path(CFG["web_dir"])
    if DOCKER:  # page dans l'image, fichiers produits dans le volume
        if os.access(web, os.W_OK) or (not web.exists() and os.access(web.parent, os.W_OK)):
            ok(f"dossier des fichiers produits {web} (volume /data)")
        else:
            bad(f"{web} non inscriptible : volume /data appartenant au compte {os.geteuid()} ?")
    elif web.is_dir():
        ok(f"dossier web {web}")
    else:
        bad(f"{web} absent (web_dir)")
    if CFG["public_url"]:  # lien des alertes : doit mener à la page (port, / final)
        try:
            with urllib.request.urlopen(CFG["public_url"].rstrip("/") + "/data.json", timeout=5) as resp:
                ok(f"page joignable : {CFG['public_url']}")
        except (OSError, ValueError) as e:
            ip = local_net()[0] or socket.gethostname()
            warn(f"public_url {CFG['public_url']} ne répond pas ({getattr(e, 'code', None) or getattr(e, 'reason', e)}). "
                 f"Port du serveur web ? Proposé : {page_url(ip)} (config.json, ou {SETUP})")
    # Canaux d'alerte (Discord, Telegram) : testés plus haut avec les autres connecteurs, sans rien publier
    if not any("alerts" in c.kinds for c in conns) and not FAILED:
        ok("alertes : ni Discord ni Telegram (seulement la page et la sortie des services)")
    try:
        meta = json.loads(META.read_text(encoding="utf-8"))
    except ValueError as e:
        bad(f"{META} illisible : {e}")
        return 1
    # Alias de ~/.ssh/config par IP : machine sans SSH alors qu'un alias la vise = alias oublié
    aliases = ssh_aliases()
    for mip, m in meta.get("machines", {}).items():
        check_machine(mip, m, aliases)
    bm = Path(CFG["backups_meta"])
    if bm.exists():
        try:
            n = len(json.loads(bm.read_text(encoding="utf-8")).get("sets", []))
            ok(f"sauvegardes : {n} jeu(x) dans {bm.name}" + ("" if CFG["backups_url"] else " (backups_url vide : onglet masqué)"))
        except ValueError as e:
            bad(f"{bm} illisible : {e}")
    print(f"\n{'✗ ' + str(len(FAILED)) + ' échec(s)' if FAILED else '✓ prêt'}")
    return 1 if FAILED else 0


def propose_connectors(ip: str, conts: list[tuple[str, str, str]]) -> None:
    """Conteneurs d'un service connu (NPM…) sur la machine : propose d'activer son connecteur, réglages
    pré-remplis par discover(), testé avant d'être écrit dans config.json. Déjà configuré : rien."""
    if not CONFIG.exists():
        return
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    try:
        have = connectors.instances(cfg)
    except connectors.ConnectorError:
        return
    def already(c) -> bool:  # instance déjà réglée sur cette machine (NPM : IP vue du LAN, sinon l'URL)
        return (c.lan_ip({}) if hasattr(c, "lan_ip") else None) == ip or ip in str(c.conf.get("url", ""))
    for name, image, ports in conts:
        for cls in connectors.for_image(image):
            if cls.type == "adguard":  # machine lue par SSH : son AdGuard est déjà suivi par find_adguard
                continue
            if any(c.type == cls.type and already(c) for c in have):
                continue
            pairs = [(int(h), int(c_)) for h, c_ in re.findall(r"(?:[\d.]+:)?(\d+)->(\d+)/tcp", ports)]
            proposed = cls.discover(image, ip, pairs) or {}
            if not yes(f"{cls.label} trouvé (conteneur {name}) : l'ajouter comme connecteur ?"):
                continue
            conf = {"name": ask("  Nom de cette instance", name)}
            for f in cls.fields:
                if f.name not in cls.setup_fields:
                    continue
                if f.secret:
                    conf[f.name] = getpass.getpass(f"  {f.label} (non affiché) : ")
                else:
                    conf[f.name] = ask(f"  {f.label}", str(proposed.get(f.name) or f.default or ""))
            conf = {k: v for k, v in conf.items() if v not in ("", None)}
            missing = cls.validate(conf)
            r = cls(conf, connectors.Context()).test() if not missing else None
            if r is None or not r.ok:
                warn(f"{cls.label} {conf['name']} : {', '.join(missing) if missing else r.message} : non ajouté")
                continue
            ok(f"{cls.label} {conf['name']} : {r.message}" + (f" (version {r.version})" if r.version else ""))
            key = "npm" if cls.type == "npm" else "connectors"  # NPM : clé lue aussi par l'ancien code
            cfg.setdefault(key, []).append(conf if key == "npm" else {"type": cls.type, **conf})
            save(CONFIG, cfg)


def add_machine(target: str) -> int:
    """setup.py --add : une seule machine, toutes les détections, puis sa vérification. Le reste de la
    configuration (config.json, autres machines, NPM, sauvegardes) n'est pas touché."""
    if not META.exists():
        sys.exit(f"{META} absent : lancer d'abord {SETUP}")
    meta = json.loads(META.read_text(encoding="utf-8"))
    machines = meta.setdefault("machines", {})
    target = target or ask("Machine à ajouter ou à reprendre (IP, nom ou alias SSH)")
    if not target:
        return 1
    # Alias SSH : donné directement, sinon celui qui vise l'IP
    host = next((h for h, s in hostinfo.ssh_config().items() if s["alias"] == target), target)
    try:
        ip = socket.gethostbyname(host)
    except OSError:
        bad(f"{target} : ni IP, ni nom connu, ni alias de {SSH_CONF}")
        return 1
    aliases = ssh_aliases()
    alias = target if host != target else aliases.get(ip)
    up = subprocess.run(["ping", "-c1", "-W1", ip], capture_output=True).returncode == 0
    name, hints = identify(ip)
    print(f"\n== {ip}{' (' + name + ')' if name else ''} : {'répond au ping' if up else 'ne répond pas au ping'}, "
          f"{', '.join(hints) or 'aucun port connu'}{', alias SSH ' + alias if alias else ''}")

    m = machines.get(ip)
    if m:
        print(f"  déjà déclarée : {json.dumps(m, ensure_ascii=False)}")
        if not yes("Reprendre la détection (nom, rôle et réglages gardés) ?"):
            return 0
    else:
        if not (up or alias) and not yes("Elle ne répond pas : l'ajouter quand même ?", False):
            return 1
        m = {"name": ask("  Nom", name or alias or ip), "role": ask("  Rôle (libre)", hints[0] if hints else ""), "ssh": None}

    kind = None
    if alias and not m.get("gateway"):
        kind, r = ssh_os(alias)
        if kind:
            attach_ssh(m, alias, kind)
        else:
            warn(ssh_why(alias, r))
    elif "SSH" in hints:
        warn(f"{ip} accepte SSH : un alias dans {SSH_CONF} (README), puis --add de nouveau : docker et santé")
    if kind == "linux":
        found = None if "adguard" in m else find_adguard(alias, [])  # conteneur AdGuard : déjà vu par attach_ssh
        if found and yes(f"AdGuard Home natif ({found}) : le suivre ?"):
            m["adguard"] = found
        propose_connectors(ip, containers(alias) or [])
    else:
        ask_extras(meta, ip, m, hints)
    if m.get("off") and isinstance(m.get("health"), str):
        warn("souvent éteinte : health.py ne la relève pas (\"off\": true l'exclut de la santé)")
    machines[ip] = m
    save(META, meta)

    print("\n== Vérification")
    check_machine(ip, m, aliases)
    print(f"\n{'✗ ' + str(len(FAILED)) + ' échec(s)' if FAILED else '✓ prêt'} : "
          "pris en compte au prochain passage du collecteur (ou bouton ⟳)")
    return 1 if FAILED else 0


def main() -> int:
    if "--check" in sys.argv:
        return check()
    if "--lan" in sys.argv:  # pour install.sh : réseau autorisé par nginx
        print(local_net()[2])
        return 0
    if not sys.stdin.isatty():
        sys.exit("setup.py pose des questions : lancer dans un terminal (ou --check)")
    if "--add" in sys.argv:
        args = sys.argv[sys.argv.index("--add") + 1:]
        try:
            return add_machine(args[0] if args else "")
        except (KeyboardInterrupt, EOFError):
            print("\nabandon : rien n'est écrit")
            return 1
    print("MyServices : configuration. Entrée = valeur proposée, Ctrl+C = abandon (rien n'est écrit avant la fin d'une section).")
    try:
        cfg = setup_config()
        machines = setup_meta()
        setup_npm(cfg, machines)
        setup_backups(cfg, machines)
        save_config(cfg)
    except (KeyboardInterrupt, EOFError):
        print("\nabandon")
        return 1
    # Relecture : check() s'appuie sur CFG, rechargé avec les fichiers écrits
    import config
    CFG.update(config.load())
    FAILED.clear()
    print()
    return check()


if __name__ == "__main__":
    sys.exit(main())
