"""Recherche des machines du réseau local (étape 4 de « Premiers pas »), à la demande de l'admin.

Lecture seule, comme le reste de MyServices : un ping par adresse puis, pour celles qui répondent, le nom DNS et
quelques connexions TCP sur des ports connus (SSH, RDP, SMB, web…). Rien n'est écrit sur les machines trouvées et
rien n'est ajouté tout seul : la page propose « Ajouter » pour chacune.

Au plus un /24 (celui de la machine hôte), un seul passage à la fois, arrêt possible à tout moment. Les machines
déjà déclarées sont pinguées et décrites comme les autres (la page y retrouve leur SSH et leurs applis, pour les
accès encore à régler, et une machine déclarée qui ne répond plus est « disparue ») ; la page ne propose à l'ajout
que les autres. Le dernier résultat est gardé dans le dossier d'état.
"""
from __future__ import annotations

import html
import http.client
import ipaddress
import json
import re
import socket
import ssl
import subprocess
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

import known_apps

# Ports regardés sur une machine qui répond : port -> indice affiché (reprend l'assistant d'installation)
HINT_PORTS = {3389: "Windows (RDP)", 445: "partage SMB", 9419: "Veeam B&R (API 9419)", 8006: "Proxmox",
              5000: "port 5000", 8123: "Home Assistant", 81: "admin NPM", 80: "web", 443: "web", 32400: "Plex"}
# Ports regardés seulement pour deviner le système (jamais affichés comme indice) : RPC/NetBIOS Windows, AFP et VNC macOS, iPhone / iPad
OS_PORTS = (135, 139, 548, 5900, 62078)
RASPBERRY_OUI = ("b8:27:eb", "dc:a6:32", "e4:5f:01", "28:cd:c1", "d8:3a:dd")  # adresses MAC des Raspberry Pi : toujours Linux
PING_WORKERS, IDENTIFY_WORKERS, PROBE_TIMEOUT = 64, 16, 0.6
# SSH : le port 22 et les ports hors norme courants ; ceux de ~/.ssh/config (Port …) s'y ajoutent à chaque recherche
SSH_PORTS = (22, 222, 2200, 2222, 22022, 22222, 22232)

_lock = threading.Lock()
_state: dict = {"phase": "idle", "net": None, "total": 0, "done": 0, "up": 0, "described": 0, "found": [],
                "previous": [], "previous_ended": None, "gone": [],  # recherche d'avant : adresses trouvées, date, disparues depuis
                "started": None, "ended": None, "error": None, "stopped": False}
_stop = threading.Event()
_file: Path | None = None
_known: set[str] = set()


_ttls: dict[str, int] = {}  # TTL de la réponse au ping, par adresse : 128 Windows, 64 Linux / macOS / Android, 255 matériel réseau


def _ping(ip: str) -> bool:
    r = subprocess.run(["ping", "-c1", "-W1", ip], capture_output=True, text=True)
    if r.returncode:
        return False
    if m := re.search(r"ttl=(\d+)", r.stdout, re.I):
        _ttls[ip] = int(m.group(1))
    return True


def _vendor(ip: str) -> str | None:
    """Fabricant déduit de l'adresse MAC (table de voisins de l'hôte, même sous-réseau seulement) ; None si inconnu."""
    try:
        out = subprocess.run(["ip", "neigh", "show", ip], capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"lladdr (\S+)", out)
    return "Raspberry Pi" if m and m.group(1).lower().startswith(RASPBERRY_OUI) else None


LINUX_TAGS = ("debian", "ubuntu", "raspbian", "fedora", "centos", "red hat", "alpine", "freebsd")


def guess_os(banner: str | None, ports: set[int], ttl: int | None, vendor: str | None) -> tuple[str | None, str | None]:
    """Système probable et l'indice qui le dit : (« windows » | « linux » | « macos » | « ios » | « network », indice) ou (None, None).
    Une suggestion, jamais une certitude : en cas de doute, rien. Le TTL seul ne sépare pas Linux de macOS."""
    low = (banner or "").lower()
    if "windows" in low:
        return "windows", "SSH"
    if any(t in low for t in LINUX_TAGS) or re.search(r"\bel\d", low):
        return "linux", "SSH"
    if vendor == "Raspberry Pi":
        return "linux", "MAC"
    if 62078 in ports:
        return "ios", "port 62078"
    if ports & {135, 139, 3389}:
        return "windows", "ports"
    if 548 in ports:
        return "macos", "port 548"
    if "openssh" in low and 5900 in ports:  # OpenSSH sans étiquette de distribution + Partage d'écran
        return "macos", "SSH + port 5900"
    if ttl and ttl > 128:
        return "network", "TTL"
    if ttl and 64 < ttl <= 128:
        return "windows", "TTL"
    return None, None


def _open(ip: str, port: int) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=PROBE_TIMEOUT):
            return True
    except OSError:
        return False


def _page(ip: str, port: int, timeout: float = 1.5) -> str | None:
    """Titre de la page d'accueil (GET /, lecture seule, 32 Ko au plus) ; None s'il n'y en a pas, si la page n'est pas lisible ou si la réponse n'est pas 2xx.
    https : certificat vérifié (jamais désactivé) ; un appareil au certificat auto-signé n'a donc pas de titre."""
    cls = http.client.HTTPSConnection if port == 443 else http.client.HTTPConnection
    try:
        conn = cls(ip, port, timeout=timeout)
        conn.request("GET", "/", headers={"User-Agent": "MyServices-netscan", "Accept": "text/html"})
        resp = conn.getresponse()
        body = resp.read(32768).decode("utf-8", "replace")
        status = resp.status
        conn.close()
    except (OSError, ssl.SSLError, http.client.HTTPException):
        return None
    if not 200 <= status < 300:  # redirection ou erreur : son titre (« 301 Moved Permanently ») ne dit rien de l'appareil
        return None
    m = re.search(r"<title[^>]*>(.*?)</title>", body, re.I | re.S)
    title = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip() if m else ""
    return title[:80] or None


def _ssh_banner(ip: str, port: int) -> str:
    """Bannière SSH (« SSH-2.0-OpenSSH_9.2p1 Debian… ») ou "" : un port ouvert ne suffit pas, c'est peut-être autre chose."""
    try:
        with socket.create_connection((ip, port), timeout=PROBE_TIMEOUT) as c:
            c.settimeout(PROBE_TIMEOUT)
            data = c.recv(80)
    except OSError:
        return ""
    return data.split(b"\n")[0].decode("ascii", "replace").strip() if data.startswith(b"SSH-") else ""


def ssh_ports(configured: dict | None = None) -> tuple[int, ...]:
    """Ports SSH à essayer : les courants, plus ceux de la config SSH de l'app (déjà utilisés pour d'autres machines)."""
    import hostinfo
    cfg = configured if configured is not None else hostinfo.ssh_config()
    return tuple(dict.fromkeys(SSH_PORTS + tuple(sorted(int(v["port"]) for v in cfg.values() if v.get("port")))))


def _describe(ip: str, probe=_open, lookup=socket.gethostbyaddr, banner=_ssh_banner, ssh=SSH_PORTS, page=_page,
              ttl=lambda ip: _ttls.get(ip), vendor=_vendor) -> dict:
    """Une machine qui répond : nom DNS court, SSH (port et bannière), ports ouverts parmi HINT_PORTS, applis probables."""
    try:
        name = lookup(ip)[0].split(".")[0].lstrip("_")  # « _gateway » de systemd-resolved
    except OSError:
        name = ""
    with ThreadPoolExecutor(len(HINT_PORTS) + len(OS_PORTS) + len(ssh)) as px:
        probes = [px.submit(probe, ip, p) for p in HINT_PORTS]
        osf = [px.submit(probe, ip, p) for p in OS_PORTS]
        sshf = [px.submit(banner, ip, p) for p in ssh]
        opened = [p for p, f in zip(HINT_PORTS, probes) if f.result()]
        os_open = {p for p, f in zip(OS_PORTS, osf) if f.result()}
        got = {p: f.result() for p, f in zip(ssh, sshf)}
        ssh_port = next((p for p in ssh if got[p]), None)
    web = [p for p in (80, 443) if p in opened]
    with ThreadPoolExecutor(2) as wx:  # page d'accueil des ports web : le titre dit souvent ce que c'est
        pages = [{"port": p, "scheme": "https" if p == 443 else "http", "title": t} for p, t in zip(web, wx.map(lambda p: page(ip, p), web))]
    app_of = {p: hit[0].label for p in opened if (hit := known_apps.identify(port=p))}
    hints = list(dict.fromkeys((f"web :{p}" if p in (80, 443) else HINT_PORTS[p]) for p in opened if p not in app_of))
    if ssh_port:
        hints.insert(0, "SSH" if ssh_port == 22 else f"SSH :{ssh_port}")
        opened = sorted({*opened, ssh_port})
    title = next((x["title"] for x in pages if x["title"]), None)
    by_name = [hit[0].label] if name and (hit := known_apps.identify(name=name)) else []  # « unifi », « proxmox »…
    apps = list(dict.fromkeys([*app_of.values(), *(hit[0].label for x in pages if x["title"] and (hit := known_apps.identify(title=x["title"]))), *by_name]))
    banner_text = got.get(ssh_port) if ssh_port else None
    os_name, os_how = guess_os(banner_text if isinstance(banner_text, str) else None, {*opened, *os_open}, ttl(ip), vendor(ip))
    return {"ip": ip, "name": name, "ports": opened, "ssh_port": ssh_port, "hints": hints, "apps": apps,
            "title": title, "pages": pages, "os": os_name, "os_how": os_how}


def local_net() -> str:
    """Réseau local en CIDR d'après la route par défaut de l'hôte (réseau host), ou ""."""
    def sh(*argv):
        try:
            return subprocess.run(argv, capture_output=True, text=True, timeout=5).stdout.split()
        except (OSError, subprocess.TimeoutExpired):
            return []
    route = sh("ip", "-4", "route", "show", "default")
    dev = route[route.index("dev") + 1] if "dev" in route else ""
    addr = sh("ip", "-4", "-o", "addr", "show", "dev", dev, "scope", "global") if dev else []
    return str(ipaddress.ip_interface(addr[3]).network) if len(addr) > 3 else ""


def targets(net: str) -> list[str]:
    """Adresses à pinguer : tout le réseau, jamais plus grand qu'un /24."""
    network = ipaddress.ip_network(net, strict=False)
    if network.num_addresses > 256:
        raise ValueError("réseau plus grand qu'un /24")
    return [str(h) for h in network.hosts()]


def _ipkey(ip: str) -> tuple:
    return tuple(int(x) for x in ip.split("."))


def _save() -> None:
    if _file is None:
        return
    try:
        tmp = _file.with_suffix(".tmp")
        tmp.write_text(json.dumps(_state, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_file)
    except OSError:
        pass  # le résultat reste en mémoire


def _scan(hosts: list[str], ping=_ping, describe=None) -> None:
    """Corps du passage (testable : ping et describe sont injectables). Ping de toutes les adresses, puis description
    de celles qui répondent, au fur et à mesure ; s'arrête dès que _stop est levé."""
    describe = describe or _describe
    ex = ThreadPoolExecutor(PING_WORKERS)
    up: list[str] = []
    try:
        pending = {ex.submit(lambda ip=ip: ip if ping(ip) else None): ip for ip in hosts}
        while pending and not _stop.is_set():
            done, _ = wait(pending, timeout=0.2, return_when=FIRST_COMPLETED)
            for f in done:
                pending.pop(f)
                if f.result():
                    up.append(f.result())
            with _lock:
                _state["done"] = len(hosts) - len(pending)
        with _lock:
            _state.update(phase="identify", up=len(up), described=0)
        dx = ThreadPoolExecutor(IDENTIFY_WORKERS)  # le nom DNS peut prendre des secondes par machine : en parallèle
        try:
            todo = {dx.submit(describe, ip) for ip in up}
            while todo and not _stop.is_set():
                done, todo = wait(todo, timeout=0.2, return_when=FIRST_COMPLETED)
                with _lock:
                    _state["found"] += [{**f.result(), "known": f.result()["ip"] in _known} for f in done]
                    _state["described"] += len(done)
        finally:
            dx.shutdown(wait=False, cancel_futures=True)
        with _lock:
            _state["found"].sort(key=lambda h: _ipkey(h["ip"]))
    finally:
        ex.shutdown(wait=False, cancel_futures=True)


def _run(hosts: list[str], net: str, ping=_ping, describe=None) -> None:
    try:
        _scan(hosts, ping, describe or (lambda ip, ports=ssh_ports(): _describe(ip, ssh=ports)))
    except Exception as e:  # noqa: BLE001 : le passage ne doit jamais faire tomber le serveur
        with _lock:
            _state["error"] = f"{type(e).__name__}: {e}"
    with _lock:
        seen = {h["ip"] for h in _state["found"]}
        gone = [] if _stop.is_set() or _state["error"] else sorted(set(_state["previous"]) - seen, key=_ipkey)
        _state.update(phase="done", ended=time.time(), stopped=_stop.is_set(), gone=gone)
        _save()


def start(known: set[str], state_file: Path | None = None, ping=_ping, describe=None, net: str | None = None) -> bool:
    """Lance une recherche ; False s'il y en a déjà une. known : IP des machines déjà déclarées (ignorées)."""
    global _file, _known
    state(state_file)  # relit la dernière recherche enregistrée (serveur redémarré depuis)
    with _lock:
        if _state["phase"] in ("ping", "identify"):
            return False
        previous = [h["ip"] for h in _state["found"]] or _state["previous"]
        previous_ended = _state["ended"] if _state["found"] else _state["previous_ended"]
        _known = set(known)  # gardé pour l'information seulement : les machines connues sont décrites comme les autres
        net = net or local_net()
        if not net:
            _state.update(phase="done", error="réseau local introuvable", found=[], total=0, done=0, up=0, described=0, net=None,
                          started=time.time(), ended=time.time(), stopped=False)
            return True
        hosts = targets(net)
        _file = state_file or _file
        _stop.clear()
        _state.update(phase="ping", net=net, total=len(hosts), done=0, up=0, described=0, found=[], started=time.time(),
                      ended=None, error=None, stopped=False, previous=previous, previous_ended=previous_ended, gone=[])
    threading.Thread(target=_run, args=(hosts, net, ping, describe), daemon=True, name="netscan").start()
    return True


def due(state_file: Path, every_h: float, now: float | None = None) -> bool:
    """Vrai si une recherche automatique est due : seulement une fois qu'une recherche a été lancée à la main (le
    fichier de résultat existe), et si la dernière date de plus de `every_h` heures. every_h = 0 : jamais."""
    if every_h <= 0 or not state_file.exists():
        return False
    last = state(state_file).get("ended") or state(state_file).get("started") or 0
    return (now if now is not None else time.time()) - last >= every_h * 3600


def stop() -> None:
    _stop.set()


def state(state_file: Path | None = None) -> dict:
    """État complet (page) ; le dernier résultat enregistré est relu si rien n'a tourné depuis le démarrage."""
    global _file
    _file = state_file or _file
    with _lock:
        if _state["phase"] == "idle" and _file is not None and _file.exists():
            try:
                _state.update(json.loads(_file.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                pass
        return json.loads(json.dumps(_state))


def summary() -> dict:
    """Chiffres seuls (barre de progression, état du collecteur)."""
    with _lock:
        return {"running": _state["phase"] in ("ping", "identify"), "phase": _state["phase"], "done": _state["done"],
                "total": _state["total"], "up": _state["up"], "described": _state["described"], "found": len(_state["found"])}
