#!/usr/bin/env python3
"""MyServices : annuaire de tous les services du LAN + statut live.

Sources, toutes en LECTURE SEULE :
  - zéro, une ou plusieurs instances NPM (config.json : npm, voir npmapi.py) : proxy hosts,
    redirections, access lists ;
  - docker ps (local ou SSH) sur chaque machine inventoriée : conteneur, image,
    état/health, projet compose et labels OCI (titre, description, version, URL) ;
    les ports publiés qu'aucun host NPM ne proxifie deviennent des services « hors NPM » ;
  - ss -tlnp sur les process_hosts : process non-docker ;
  - titre HTML du backend (GET direct) : identifie les services web sans conteneur ;
  - services-meta.json (à la main, chemin : config.json meta) : catégorie/description/tags forcés + services
    ajoutés à la main (ni NPM ni docker) ;
  - AdGuard Home (machines.adguard) : réécritures et règles perso (AdGuardHome.yaml par
    docker exec), et réponse de chaque AdGuard pour chaque domaine NPM (requête DNS directe).

Écrit <web_dir>/data.json, lu par le front (/). Cron 30 min (état du
réseau, pas du monitoring : Uptime Kuma s'en charge) ; l'inventaire docker + infos machines
(session SSH) est mis en cache 2 h, le test des méthodes SSH 30 min. Une machine qui change
d'état au ping court-circuite ces deux caches.
advanced_config n'est JAMAIS recopié (peut contenir des secrets) : seuls des
drapeaux dérivés (garde ACL, Cloudflare) sont exportés.
"""
import fcntl
import html
import http.client
import contextlib
import json
import os
import re
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import connectors
import connectors.base as cbase
from connectors.uptime_kuma import attach_monitors
from connectors.docker_ssh import HOST_ADDR
from connectors.process import host_ports
import esxi_ssh
import virt_ssh
import pve_ssh
import agents
import hostinfo
import inventory_cache
import api_link
import known_apps
import last_known as last_known_services
import matching
from connectors import mynetwork as mynetwork_conn
import npmapi

from config import CFG, next_timer_run

OUT = os.path.join(CFG["web_dir"], "data.json")
META = CFG["meta"]
DOCKER_CACHE = os.path.join(CFG["cache_dir"], "docker.json")
DOCKER_CACHE_TTL = CFG["docker_cache_ttl"]
SSH_CACHE = os.path.join(CFG["cache_dir"], "ssh.json")
SSH_CACHE_TTL = CFG["ssh_cache_ttl"]
CACHE_SLACK = CFG["cache_slack"]  # marge : un cache de 30 min doit être périmé au passage suivant (cron 30 min)
PROBE_TIMEOUT = CFG["probe_timeout"]
# Avancement lu par le bouton « Rafraîchir » de la page (refresh-api.py) ; posé par myservices.service
PROGRESS = os.environ.get("MYSERVICES_PROGRESS")
STEPS = 8
_progress_lock = threading.Lock()
_progress_last = [0.0]

NPM_ONLY: set = set()  # machines joignables seulement depuis NPM (pare-feu) : sondées via NPM
DISABLED: set = set()  # machines non suivies (services-meta.json : disabled)
SSH_OFF: set = set()  # machines dont l'interrupteur SSH est coupé à la main (ssh: false) : jamais lues par SSH
MACHINES_OFF: set = set()  # machines éteintes volontairement : services « machine éteinte » tant que le ping échoue
MACHINE_FLAGS: dict = {}
ADGUARD: dict = {}  # IP du serveur DNS -> connecteur AdGuard Home
ADGUARD_SYNC: dict = {}  # IP -> conteneur adguardhome-sync (machines.adguard_sync)
NPM_IPS: dict = {}  # nom d'instance NPM -> IP vue du LAN (contrôle DNS des hosts à garde LAN)
META_RAW: dict = {}  # services-meta.json lu (connecteurs tirés des machines : docker, AdGuard)
CONNECTOR_STATUS: list = []  # état de chaque connecteur lu pendant le passage (data.json « connectors »)
CONNECTORS_STATE = Path(CFG["state_dir"]) / "connectors.json"  # échecs consécutifs, dernier résultat bon
try:  # connecteurs « logs » (Dozzle) : liens vers les journaux des conteneurs ; mal réglé = pas de lien
    LOGS = [c for c in connectors.instances(CFG, kind="logs") if hasattr(c, "link")]
except connectors.ConnectorError as e:
    LOGS = []
    print(f"⚠ journaux : {e}", file=sys.stderr)
ROLE_FLAGS = ("gateway", "npm")  # rôles affichés par la page (passerelle, hôte NPM), recopiés tels quels dans data.json


def _load_config():
    """Machines, catégories et IP ignorées : lus dans services-meta.json (éditable à la main)."""
    try:
        with open(META) as f:
            cfg = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit(f"{META} illisible : {e} (modèle : services-meta.example.json)")
    # Machine désactivée (Réglages → Machines, « Machine suivie » coupée) : ni ping, ni SSH, ni santé ; elle reste connue
    # (nom, services NPM qui la visent) et compte comme éteinte voulue, donc aucune alerte.
    off_ips = {ip for ip, m in cfg.get("machines", {}).items() if m.get("disabled")}
    if off_ips:
        cfg = {**cfg, "machines": {ip: ({**m, "ssh": None, "health": False} if ip in off_ips else m) for ip, m in cfg["machines"].items()},
               "process_hosts": {ip: v for ip, v in cfg.get("process_hosts", {}).items() if ip not in off_ips}}
    machines = {ip: (m["name"], m.get("role", ""), m.get("ssh")) for ip, m in cfg.get("machines", {}).items()}
    global DISABLED, SSH_OFF
    DISABLED = off_ips
    SSH_OFF = {ip for ip, m in cfg.get("machines", {}).items() if m.get("ssh") is False}   # SSH coupé à la main : jamais lu par SSH
    global META_RAW, NPM_ONLY, MACHINES_OFF, MACHINE_FLAGS, ADGUARD, ADGUARD_SYNC
    META_RAW = cfg
    MACHINE_FLAGS = {ip: {k: True for k in ROLE_FLAGS if m.get(k)} for ip, m in cfg.get("machines", {}).items()}
    try:  # AdGuard Home : connecteurs « dns » (machine avec SSH dans services-meta, ou API dans config.json)
        ADGUARD = {c.conf["ip"]: c for c in connectors.instances(CFG, kind="dns", meta=cfg)}
    except connectors.ConnectorError as e:
        sys.exit(str(e))
    # adguard_sync absent = détecté dans l'inventaire docker (adguard_sync_detect), false = jamais lu
    ADGUARD_SYNC = {ip: m.get("adguard_sync") for ip, m in cfg.get("machines", {}).items()
                    if m.get("ssh") and m.get("adguard_sync") is not False}
    NPM_ONLY = {ip for ip, m in cfg.get("machines", {}).items() if m.get("npm_only")}
    MACHINES_OFF = {ip for ip, m in cfg.get("machines", {}).items() if m.get("off")} | off_ips
    cats = [(n, re.compile(p, re.I)) for n, p in cfg.get("categories", [])]
    return machines, set(cfg.get("ignored_ips", [])), cfg.get("process_hosts", {}), cats


# IP -> (nom, rôle, alias ssh pour docker ps ; None = pas d'inventaire docker)
MACHINES, IGNORED_IPS, PROCESS_HOSTS, CATEGORIES = _load_config()

def read_npm():
    """Toutes les instances NPM (connecteurs « npm »), entrées marquées (_npm, _acl) et id uniques.

    Chaque instance est lue isolément (connectors.run_isolated) : en échec, son dernier résultat bon est
    réutilisé et marqué périmé (data.json « connectors »), le passage continue. Sans résultat bon
    antérieur, le passage s'arrête comme avant : sans les hosts d'une instance, le watcher les verrait
    tous « disparus », data.json reste celui du passage précédent (alerte « périmé »).
    La 1re instance garde les id NPM bruts (historique du watcher conservé quand on en ajoute
    une), les suivantes sont préfixées « nom/ ».
    """
    try:
        insts = connectors.instances(CFG, kind="services")
    except connectors.ConnectorError as e:
        sys.exit(str(e))
    insts = [c for c in insts if c.type == "npm"]
    if not insts:  # NPM facultatif : annuaire docker, process et services manuels seulement
        return [], [], [], []
    state = cbase.load_state(CONNECTORS_STATE)
    with ThreadPoolExecutor(len(insts)) as ex:
        jobs = [ex.submit(cbase.run_isolated, c, state, 120) for c in insts]
    lists = {k: [] for k in npmapi.LISTS if k != "acls"}
    for n, (conn, job) in enumerate(zip(insts, jobs)):
        got, st = job.result()
        CONNECTOR_STATUS.append(st)
        if got is None:
            cbase.save_state(CONNECTORS_STATE, state)
            sys.exit(f"NPM {conn.name} : {st.message}")
        if not st.ok:
            print(f"⚠ NPM {conn.name} : {st.message} ; dernier résultat bon réutilisé ({st.failures} passage(s) en échec)",
                  file=sys.stderr)
        NPM_IPS[conn.name] = conn.lan_ip(MACHINES)
        acls = {a["id"]: a["name"] for a in got["acls"]}
        for k in lists:
            for x in got[k]:
                x = dict(x, _npm=conn.name, _acl=acls.get(x.get("access_list_id")))
                if n:
                    x["id"] = f'{conn.name}/{x["id"]}'
                lists[k].append(x)
    cbase.save_state(CONNECTORS_STATE, state)
    for ip in filter(None, NPM_IPS.values()):  # rôle « hôte NPM » affiché par la page
        if ip in MACHINE_FLAGS:
            MACHINE_FLAGS[ip]["npm"] = True
    return lists["hosts"], lists["redirects"], lists["dead"], lists["streams"]


def agent_reports() -> dict:
    """Derniers relevés des agents {IP: {"report", "seen", "fresh"}} ; vide si la base n'existe pas (installation sans agents)."""
    try:
        from auth import db_path
        return agents.Agents(db_path(CFG)).fresh_reports()
    except Exception as e:  # base absente ou illisible : la collecte continue sans agents
        print(f"⚠ agents : {e}", file=sys.stderr)
        return {}


def _process_read(conn):
    """Connecteur « process » d'une machine : {port: process} ; état ajouté au passage."""
    t0 = time.time()
    try:
        got = conn.collect()["ports"]
        ok, msg = True, f"{len(got)} port(s) en écoute"
    except Exception as e:  # SSH coupé, ss absent, bug : machine sans process ce passage, comme avant
        got, ok, msg = {}, False, str(e)
    CONNECTOR_STATUS.append(cbase.Status(conn.type, conn.conf.get("label") or conn.name, ok, msg, extra={"ip": conn.conf.get("ip")},
                                         duration_s=round(time.time() - t0, 2)))
    return got


def _docker_read(conn):
    """Connecteur Docker d'une machine : conteneurs (None = inaccessible) et réseaux, état ajouté au passage."""
    t0 = time.time()
    try:
        got = conn.collect()
    except Exception as e:  # bug du connecteur : la machine est vue « docker inaccessible », le passage continue
        got = {"containers": None, "internal": {}}
        print(f"⚠ docker {conn.conf.get('label')} : erreur interne ({type(e).__name__}: {e})", file=sys.stderr)
    n = got["containers"]
    msg = "pas de Docker sur cette machine" if got.get("absent") else f"{len(n)} conteneurs" if n is not None else "docker inaccessible (SSH ou groupe docker)"
    CONNECTOR_STATUS.append(cbase.Status(conn.type, conn.conf.get("label") or conn.name, n is not None, msg, extra={"ip": conn.conf.get("ip")},
                                         duration_s=round(time.time() - t0, 2)))
    return got


def adopt_ssh(hinfo: dict) -> None:
    """Machines lues par SSH à ce passage (clé testée : relevé obtenu) sans interrupteur réglé : l'accès est enregistré tout seul
    (machines_admin.adopt_ssh), l'utilisateur peut le couper ensuite. Effet au prochain passage (Docker, santé). Mode manuel : rien."""
    if not CFG["auto_mode"]:
        return
    sshc = hostinfo.ssh_config()
    found = {ip: sshc[ip]["alias"] for ip, info in hinfo.items() if info and ip in sshc and MACHINES.get(ip, (0, 0, None))[2] is None}
    if not found:
        return
    try:
        import machines_admin
        for ip in machines_admin.adopt_ssh(found):
            print(f"SSH activé tout seul pour {MACHINES[ip][0]} ({ip}) : accès « {found[ip]} », clé testée", flush=True)
    except Exception as e:  # noqa: BLE001 : la collecte continue, l'interrupteur reste à activer à la main
        print(f"⚠ activation automatique du SSH impossible : {type(e).__name__}: {e}", flush=True)


def _read_inventory(only: set | None = None) -> dict:
    """Lit par SSH l'inventaire Docker et les infos machines ; only : seulement ces IP (relecture d'une machine)."""
    want = lambda ip: only is None or ip in only  # noqa: E731
    docks = {c.conf["ip"]: c for c in connectors.instances(CFG, kind="inventory", meta=META_RAW) if c.type == "docker" and want(c.conf["ip"])}
    with ThreadPoolExecutor(8) as ex:
        jobs = {ip: ex.submit(_docker_read, c) for ip, c in docks.items()}
        # Infos machines (SSH, OS, Apache…) : toute IP connue ayant une entrée ~/.ssh/config, plus la machine collectrice en local
        sshc = hostinfo.ssh_config()
        hi = {ip: ex.submit(hostinfo.host_info, "local" if MACHINES.get(ip, (0, 0, None))[2] == "local" else sshc[ip]["alias"])
              for ip in MACHINES if want(ip) and ip not in DISABLED | SSH_OFF and (ip in sshc or MACHINES[ip][2] == "local")}
    got = {ip: job.result() for ip, job in jobs.items()}
    data = {ip: g["containers"] for ip, g in got.items()}
    data["_internal"] = {ip: g["internal"] for ip, g in got.items()}
    data["_hostinfo"] = {ip: j.result() for ip, j in hi.items()}
    return data


def docker_inventory(force: bool | set = False):
    """Inventaire Docker et machines, gardé DOCKER_CACHE_TTL (inventory_cache) : une machine marquée « stale » (accès SSH changé,
    état de ping changé) est seule relue, les autres restent en cache. force : True = tout relire ; ensemble d'IP = celles-là."""
    return inventory_cache.refresh(DOCKER_CACHE, DOCKER_CACHE_TTL - CACHE_SLACK, _read_inventory, force)


PING_TTL: dict = {}  # IP -> TTL de la dernière réponse au ping (128 Windows, 64 Linux / macOS, 255 matériel réseau)


def ping(ip):
    r = subprocess.run(["ping", "-c1", "-W1", ip], capture_output=True, text=True)
    if (ttl := hostinfo.ping_ttl(r.stdout)) is not None:
        PING_TTL[ip] = ttl
    return r.returncode == 0


def load_ssh_cache():
    try:
        with open(SSH_CACHE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def ssh_methods(cache, ip, port, force):
    """hostinfo.auth_methods mis en cache SSH_CACHE_TTL (chaque test = un « Invalid user » dans auth.log)."""
    c = cache.get(ip) or {}
    if not force and c.get("port") == port and time.time() - c.get("ts", 0) < SSH_CACHE_TTL - CACHE_SLACK:
        return c.get("methods")
    methods = hostinfo.auth_methods(ip, port)
    cache[ip] = {**c, "ts": time.time(), "port": port, "methods": methods}
    return methods


def probe_tcp(host, port):
    t = time.monotonic()
    try:
        with socket.create_connection((host, int(port)), timeout=PROBE_TIMEOUT):
            return {"up": True, "ms": round((time.monotonic() - t) * 1000)}
    except OSError as e:
        return {"up": False, "err": type(e).__name__}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_opener = urllib.request.build_opener(_NoRedirect)
# Les noms purement LAN (ex. outil.lan) sont souvent servis avec un wildcard
# du type *.lan.exemple.fr, et beaucoup de backends LAN ont un cert auto-signé. Sans vérif
# uniquement pour ces sondes anonymes (GET /, aucun identifiant envoyé) ; signalé
# via cert_ok=false côté NPM.
_insecure = ssl.create_default_context()  # NOSONAR S5527: opt-in per connector for a self-signed LAN certificate
_insecure.check_hostname = False
_insecure.verify_mode = ssl.CERT_NONE  # NOSONAR S4830: opt-in per connector for a self-signed LAN certificate
_opener_insecure = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=_insecure))
_opener_title = urllib.request.build_opener(urllib.request.HTTPSHandler(context=_insecure))


def _get(opener, domain):
    req = urllib.request.Request(f"https://{domain}/", method="GET", headers={"User-Agent": "myservices-probe"})
    try:
        with opener.open(req, timeout=PROBE_TIMEOUT) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def probe_https(domain):
    """Code HTTP renvoyé par NPM pour ce domaine (pas de suivi de redirection)."""
    t = time.monotonic()
    cert_ok = True
    try:
        try:
            code = _get(_opener, domain)
        except urllib.error.URLError as e:
            if not isinstance(e.reason, ssl.SSLCertVerificationError):
                raise
            cert_ok = False
            code = _get(_opener_insecure, domain)
    except (urllib.error.URLError, OSError) as e:
        return {"code": None, "err": type(getattr(e, "reason", e)).__name__}
    return {"code": code, "ms": round((time.monotonic() - t) * 1000), "cert_ok": cert_ok}


TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title>", re.I | re.S)


def _title(body):
    m = TITLE_RE.search(body)
    return re.sub(r"\s+", " ", html.unescape(m.group(1).decode("utf-8", "replace"))).strip()[:120] if m else None


def probe_follow(domain):
    """Redirection NPM suivie jusqu'au bout (comme curl -L) : page finale réellement servie."""
    req = urllib.request.Request(f"https://{domain}/", headers={"User-Agent": "myservices-probe", "Accept": "text/html,*/*"})
    try:
        try:
            with _opener_title.open(req, timeout=PROBE_TIMEOUT) as r:
                code, url, body = r.status, r.geturl(), r.read(65536)
        except urllib.error.HTTPError as e:
            code, url, body = e.code, e.geturl(), e.read(65536) if e.fp else b""
    except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as e:
        return {"code": None, "err": type(getattr(e, "reason", e)).__name__}
    return {"code": code, "url": url, "title": _title(body)}


def _fetch(scheme, ip, port, host):
    headers = {"User-Agent": "myservices-probe", "Accept": "text/html,*/*"}
    if host:
        headers["Host"] = host
    req = urllib.request.Request(f"{scheme}://{ip}:{port}/", headers=headers)
    try:
        with _opener_title.open(req, timeout=PROBE_TIMEOUT) as r:
            return r.status, r.headers, r.read(65536)
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read(65536) if e.fp else b""


GENERATOR_RE = re.compile(rb"<meta[^>]+name=[\"']generator[\"'][^>]*content=[\"']([^\"']{1,80})", re.I)
FP_HEADERS = ("server", "x-powered-by", "x-generator", "www-authenticate")


def fingerprint(headers, body: bytes) -> str:
    """Empreinte HTTP d'un backend, en minuscules, une information par ligne : en-têtes utiles (Server, X-Powered-By…), noms des en-têtes
    présents (certaines applis ont les leurs : x-pi-hole, x-transmission-session-id), noms des cookies posés (sans leurs valeurs) et
    balise meta generator. Rien de la page n'est gardé."""
    h = headers or {}
    lines = [f"{k}: {h.get(k, '').strip()[:100]}" for k in FP_HEADERS if h.get(k)]
    lines.append("headers: " + " ".join(sorted({k.lower() for k in h.keys()})))
    cookies = [c.split("=", 1)[0].strip() for c in (h.get_all("Set-Cookie") if hasattr(h, "get_all") else []) or []]
    if cookies:
        lines.append("cookies: " + " ".join(cookies))
    m = GENERATOR_RE.search(body[:16384])
    if m:
        lines.append("generator: " + html.unescape(m.group(1).decode("utf-8", "replace")).strip())
    return "\n".join(lines).lower()


def probe_web(scheme, ip, port, host=None):
    """Interface web du backend : {"web": ui|api|none, "title", "scheme"}.

    ui   = page HTML (même derrière un login) ;
    api  = répond en HTTP mais sans page HTML (JSON, texte, 404 nu…) ;
    none = port ouvert mais pas du HTTP (SSH, SMB, DNS…) ; None si injoignable.
    Réessaie dans l'autre schéma (http <-> https) si le premier échoue ou si le
    serveur répond « plain HTTP request sent to HTTPS port ».
    """
    for sch in (scheme, "https" if scheme == "http" else "http"):
        try:
            code, headers, body = _fetch(sch, ip, port, host)
            ctype = (headers.get("Content-Type", "") if headers else "")
        except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError):
            continue
        if code == 400 and b"sent to HTTPS port" in body:
            continue
        title = _title(body)
        is_html = "html" in ctype.lower() or re.search(rb"<(html|body|!doctype)", body[:4096], re.I)
        # Une page d'erreur HTML sans titre (404 nginx nu, etc.) n'est pas une interface
        ui = is_html and (title or code < 400) and not (code == 404 and (title or "").startswith("404"))
        return {"web": "ui" if ui else "api", "title": title, "scheme": sch, "code": code, "fp": fingerprint(headers, body)}
    return None


HOST_RE = re.compile(r"^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
BLOCKED_IPS = {"0.0.0.0"}  # réponse d'AdGuard pour un nom bloqué (blocking_mode: default)
# AdGuard limite à 20 requêtes/s par /24 (ratelimit), limite partagée avec tout le LAN : au-delà il jette
# les paquets, pour nous comme pour les autres appareils. Requêtes en file, DNS_QPS par serveur.
DNS_QPS = CFG["dns_qps"]


def _on(alias, sh):
    """Commande shell sur la machine : en local pour la collectrice ("local"), sinon par SSH."""
    return ["bash", "-c", sh] if alias == "local" else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", alias, sh]


def adguard_sync_detect(dock):
    """Conteneur adguardhome-sync de chaque machine (adguard_sync absent de services-meta) : cherché
    dans l'inventaire docker par image ou par nom. Machine sans ce conteneur : rien à lire."""
    for ip, name in list(ADGUARD_SYNC.items()):
        if name is None:
            found = [c["name"] for c in dock.get(ip) or [] if "adguardhome-sync" in f'{c["image"]} {c["name"]}']
            if found:
                ADGUARD_SYNC[ip] = found[0]
            else:
                del ADGUARD_SYNC[ip]


def _sync_time(ts):
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%f%z")
    except ValueError:
        return None


def adguard_sync_state(alias, container):
    """Journal 24 h d'adguardhome-sync : origine, dernière synchro réussie par réplique, intervalle entre
    deux synchros (médiane, d'après le journal : pas besoin de connaître son cron), nombre d'erreurs.
    None = illisible. La config d'adguardhome-sync (mots de passe) n'est jamais lue."""
    cmd = _on(alias, f"docker logs --since 24h {container} 2>&1 | grep -E 'Sync done|ERROR'")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode not in (0, 1):  # grep : 1 = aucune ligne
        return None
    last, runs, origin, errors = {}, {}, None, 0
    for line in r.stdout.splitlines():
        ts = line.split("\t", 1)[0]
        if "\tERROR\t" in line:
            errors += 1
        m = re.search(r'Sync done.*"to": "(?:https?://)?([\d.]+)', line)
        if m:
            last[m.group(1)] = ts
            runs.setdefault(m.group(1), []).append(_sync_time(ts))
            f = re.search(r'"from": "(?:https?://)?([\d.]+)', line)
            origin = f.group(1) if f else origin
    times = sorted(t for t in max(runs.values(), key=len, default=[]) if t)
    gaps = sorted((b - a).total_seconds() / 60 for a, b in zip(times, times[1:]))
    return {"container": container, "origin": origin, "last_done": last, "errors_24h": errors,
            "interval_min": round(gaps[len(gaps) // 2]) if gaps else None}


def _skip_name(data, pos):
    while data[pos]:
        if data[pos] >= 0xC0:
            return pos + 2
        pos += data[pos] + 1
    return pos + 1


def dns_a(server, name, timeout=3, tries=2):
    """Adresses IPv4 renvoyées par ce serveur DNS ([] = aucune, NXDOMAIN compris), None = pas de réponse."""
    labels = name.rstrip(".").split(".")
    if not all(0 < len(x) < 64 for x in labels):
        return []
    qid = (os.getpid() ^ hash(name)) & 0xFFFF
    q = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + \
        b"".join(bytes([len(x)]) + x.encode("ascii", "replace") for x in labels) + b"\0" + struct.pack(">HH", 1, 1)
    for _ in range(tries):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(timeout)
                s.sendto(q, (server, 53))
                data = s.recv(4096)
            if data[:2] != q[:2]:
                continue
            pos, ips = len(q), []  # la question est renvoyée telle quelle
            for _ in range(struct.unpack(">H", data[6:8])[0]):
                pos = _skip_name(data, pos)
                typ, _cls, _ttl, ln = struct.unpack(">HHIH", data[pos:pos + 10])
                pos += 10
                if typ == 1 and ln == 4:
                    ips.append(socket.inet_ntoa(data[pos:pos + 4]))
                pos += ln
            return sorted(set(ips))
        except (OSError, struct.error, IndexError):
            continue
    return None


def dns_ask_all(server, names):
    """dns_a sur chaque nom, à DNS_QPS requêtes/s au plus."""
    out = {}
    for d in names:
        t = time.monotonic()
        out[d] = dns_a(server, d)
        time.sleep(max(0.0, 1 / DNS_QPS - (time.monotonic() - t)))
    return out


def _private(ip):
    return ip.startswith(("10.", "192.168.", "127.")) or re.match(r"172\.(1[6-9]|2\d|3[01])\.", ip) is not None


def _same_answer(a, b):
    """Deux réponses équivalentes : mêmes IP privées ; IP publiques comparées en bloc (Cloudflare en change à chaque requête)."""
    def norm(ips):
        return sorted({ip if _private(ip) or ip in BLOCKED_IPS else "publique" for ip in ips})
    return norm(a) == norm(b)


def _rule_host(rule):
    """Nom visé par une règle perso AdGuard de blocage (||nom^…) ; None pour une exception @@ ou une autre syntaxe."""
    m = re.match(r"\|\|([a-z0-9.*_-]+)\^", rule.lower())
    return m.group(1) if m else None


def _rewrite_hits(rewrite, name):
    """La réécriture AdGuard (nom exact ou *.domaine) s'applique à ce nom."""
    return name == rewrite or rewrite.startswith("*.") and name.endswith(rewrite[1:])


def dns_check(rows):
    """Contrôle DNS AdGuard, lecture seule : chaque domaine NPM est demandé à chaque AdGuard, et les
    réécritures sont comparées entre instances et aux hosts NPM. Problèmes par ligne dans r["dns"]."""
    servers = sorted(ADGUARD)
    npm_rows = [r for r in rows if r["type"] in ("proxy", "redirect", "dead")]
    names = sorted({d.lower() for r in npm_rows if r["enabled"] for d in r["domains"]})
    with ThreadPoolExecutor(2 * len(servers) + len(ADGUARD_SYNC)) as ex:  # une file de requêtes par serveur DNS
        state = cbase.load_state(CONNECTORS_STATE)
        confs = {ip: ex.submit(cbase.run_isolated, c, state, 60) for ip, c in ADGUARD.items()}
        asked = {s: ex.submit(dns_ask_all, s, names) for s in servers}
        syncs = {ip: ex.submit(adguard_sync_state, MACHINES[ip][2], c) for ip, c in ADGUARD_SYNC.items()}
    confs = {ip: f.result() for ip, f in confs.items()}
    cbase.save_state(CONNECTORS_STATE, state)
    CONNECTOR_STATUS.extend(st for _, st in confs.values())
    # Illisible ce passage : pas de contrôle sur ses réécritures (comme avant), même si un résultat ancien existe
    confs = {ip: (data if st.ok else None) for ip, (data, st) in confs.items()}
    ans = {(s, d): v for s, f in asked.items() for d, v in f.result().items()}

    # Réécritures actives, toutes instances : {domain, answer, on: [machines qui l'ont]}
    rewrites = {}
    for ip, c in confs.items():
        for x in (c or {}).get("rewrites", []):
            if x["enabled"]:
                rewrites.setdefault((x["domain"], x["answer"]), []).append(MACHINES[ip][0] if ip in MACHINES else ip)
    rewrites = [{"domain": d, "answer": a, "on": on} for (d, a), on in sorted(rewrites.items())]
    blocked_by = {}  # nom -> règle perso qui le bloque
    for c in confs.values():
        for rule in (c or {}).get("user_rules", []):
            h = _rule_host(rule)
            for d in names:
                if h and (d == h or d.endswith("." + h)):
                    blocked_by.setdefault(d, rule)
    for r in npm_rows:
        if not r["enabled"]:
            continue
        private = r.get("lan_only") and not r.get("public_ok")
        per, issues = {}, []
        for d in (x.lower() for x in r["domains"]):
            a = {s: ans[(s, d)] for s in servers}
            per[d] = a
            got = [v for v in a.values() if v is not None]
            if not HOST_RE.match(d):
                issues.append(["nom", d])
            if got and all(not v for v in got):
                issues.append(["absent", d])
            if d in blocked_by or any(BLOCKED_IPS & set(v) for v in got):
                issues.append(["bloque", d])
            if len(got) > 1 and not all(_same_answer(got[0], v) for v in got[1:]):
                issues.append(["ecart", d])
            if private and any(ip != NPM_IPS.get(r["npm"]) and ip not in BLOCKED_IPS for v in got for ip in v):
                issues.append(["hors_lan", d])
        r["dns"] = {"answers": per, "issues": issues, "rule": {d: blocked_by[d] for d in per if d in blocked_by},
                    "rewrites": [x for x in rewrites if any(_rewrite_hits(x["domain"], d) for d in per)]}
    return {
        "npm_ip": next(iter(NPM_IPS.values()), None),
        "npm_ips": NPM_IPS,
        "servers": {ip: {"name": MACHINES[ip][0] if ip in MACHINES else ADGUARD[ip].conf.get("label", ip),
                         "container": ADGUARD[ip].conf.get("target") or ADGUARD[ip].conf.get("url"),
                         "readable": confs[ip] is not None,
                         "rewrites": len(confs[ip]["rewrites"]) if confs[ip] else None,
                         "user_rules": len(confs[ip]["user_rules"]) if confs[ip] else None,
                         "silent": sum(1 for d in names if ans[(ip, d)] is None)} for ip in servers},
        "sync": {ip: _sync_origin(f.result() or {"container": ADGUARD_SYNC[ip], "unreadable": True}, servers)
                 for ip, f in syncs.items()},
        **_rewrites_report(confs, npm_rows, set(NPM_IPS.values())),
    }


def _sync_origin(s, servers):
    """Origine absente du journal : la seule instance AdGuard qui n'est pas une réplique, sinon inconnue."""
    if not s.get("origin"):
        rest = [ip for ip in servers if ip not in s.get("last_done", {})]
        s["origin"] = rest[0] if len(rest) == 1 and s.get("last_done") else None
    return s


def _rewrites_report(confs, npm_rows, npm_ips):
    """Réécritures : écarts entre instances, puis rapprochement avec NPM (toutes instances confondues)."""
    ok = {ip: c for ip, c in confs.items() if c is not None}
    sets = {ip: {(x["domain"], x["answer"], x["enabled"]) for x in c["rewrites"]} for ip, c in ok.items()}
    rsets = {ip: set(c["user_rules"]) for ip, c in ok.items()}
    rw_diff = sorted({(d, a, e, ip) for ip, s in sets.items() for d, a, e in s
                      if any((d, a, e) not in o for o in sets.values())})
    rules_diff = sorted({(x, ip) for ip, s in rsets.items() for x in s if any(x not in o for o in rsets.values())})
    npm_state = {}
    for r in npm_rows:
        for d in r["domains"]:
            npm_state[d.lower()] = npm_state.get(d.lower(), False) or bool(r["enabled"])
    orphans, direct, invalid = [], [], []
    for d, a, e in sorted(set().union(*sets.values()) if sets else set()):
        if not e:
            continue
        if not HOST_RE.match(d):
            invalid.append({"domain": d, "answer": a})
        if a not in npm_ips and a.lower() not in npm_state:
            direct.append({"domain": d, "answer": a})  # vers une machine, sans NPM : information seulement
            continue
        hit = [v for n, v in npm_state.items() if _rewrite_hits(d, n)]
        if not hit:
            orphans.append({"domain": d, "answer": a, "why": "aucun host NPM"})
        elif not any(hit):
            orphans.append({"domain": d, "answer": a, "why": "host NPM désactivé"})
    return {
        "rewrites_diff": [{"domain": d, "answer": a, "enabled": e, "only": ip} for d, a, e, ip in rw_diff],
        "user_rules_diff": [{"rule": x, "only": ip} for x, ip in rules_diff],
        "orphans": orphans, "direct": direct, "invalid": invalid,
    }


def categorize(*texts):
    blob = " ".join(t for t in texts if t)
    for name, rx in CATEGORIES:
        if rx.search(blob):
            return name
    return "Autre"


def load_meta():
    try:
        with open(META) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"services": {}, "extra": []}


def row(kind, ident, ip, port, **kw):
    mach = MACHINES.get(ip)
    base = {"type": kind, "id": ident, "domains": [], "enabled": True, "scheme": "http", "ip": ip, "port": port,
            "machine": mach[0] if mach else None, "machine_role": mach[1] if mach else None}
    base.update(kw)
    return base


def docker_service(c, how):
    svc = {"kind": "docker", "name": c["name"], "image": c["image"], "inner": c.get("inner"),
           "state": c["status"], "compose": c["compose"], "title": c["title"],
           "description": c["description"], "version": c["version"], "url": c["url"], "match": how}
    if LOGS:  # connecteur Dozzle : lien vers les journaux du conteneur (aucun journal lu ici)
        svc["logs_url"] = LOGS[0].link(c["name"])
    return svc


WEBCHECK_CACHE = os.path.join(CFG["cache_dir"], "webcheck.json")
WEBCHECK_MAX_AGE = 23 * 3600  # chaque site au plus une fois par jour


def webcheck_rows(rows):
    """Connecteur Web-Check : contrôles légers (certificat, HSTS, en-têtes, security.txt) des hosts NPM
    joignables en HTTPS, au plus une fois par jour et par site, quelques sites par passage (les plus
    anciens d'abord). Résultat (cache) dans r["webcheck"] de chaque host contrôlé."""
    try:
        wc = next((c for c in connectors.instances(CFG, kind="services") if c.type == "web-check"), None)
    except connectors.ConnectorError:
        return  # déjà signalé par read_npm (même registre)
    if wc is None:
        return
    targets = {}
    for r in rows:
        if r["type"] in ("proxy", "redirect") and r.get("enabled") and (r.get("public") or {}).get("code"):
            d = next((x for x in r["domains"] if not x.startswith("*.")), None)
            if d:
                targets.setdefault(d.lower(), []).append(r)
    try:
        with open(WEBCHECK_CACHE) as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    now = time.time()
    due = sorted((d for d in targets if now - cache.get(d, {}).get("ts", 0) > WEBCHECK_MAX_AGE),
                 key=lambda d: cache.get(d, {}).get("ts", 0))[:int(wc.conf.get("per_run") or 10)]
    t0, err = time.time(), None
    with ThreadPoolExecutor(3) as ex:  # 3 sites à la fois : Web-Check lance 4 contrôles par site
        for d, fut in [(d, ex.submit(wc.check_site, d)) for d in due]:
            try:
                cache[d] = {"ts": now, "data": fut.result()}
            except connectors.ConnectorError as e:
                err = str(e)
            except Exception as e:  # bug du connecteur : le passage continue, sans ce site
                err = f"erreur interne du connecteur ({type(e).__name__}: {e})"
    for d in list(cache):  # sites retirés de NPM : oubliés
        if d not in targets:
            del cache[d]
    os.makedirs(os.path.dirname(WEBCHECK_CACHE), exist_ok=True)
    with open(WEBCHECK_CACHE, "w") as f:
        json.dump(cache, f)
    for d, rs in targets.items():
        if d in cache:
            for r in rs:
                r["webcheck"] = dict(cache[d]["data"], checked=round(cache[d]["ts"]), domain=d)
    CONNECTOR_STATUS.append(cbase.Status(wc.type, wc.name, err is None, err or f"{len(due)} site(s) contrôlé(s), "
                                         f"{sum(1 for d in targets if d in cache)}/{len(targets)} à jour",
                                         duration_s=round(time.time() - t0, 2)))


def uptime_rows(rows):
    """Connecteurs Uptime Kuma : chaque sonde rattachée au service qu'elle surveille (même domaine que
    son URL, ou même IP:port), dans r["uptime"] : état, temps de réponse, jours de certificat."""
    try:
        kumas = [c for c in connectors.instances(CFG, kind="services") if c.type == "uptime-kuma"]
    except connectors.ConnectorError:
        return  # déjà signalé par read_npm (même registre)
    if not kumas:
        return
    state = cbase.load_state(CONNECTORS_STATE)
    for c in kumas:
        data, st = cbase.run_isolated(c, state, 60)
        CONNECTOR_STATUS.append(st)
        attach_monitors(rows, (data or {}).get("monitors", []), c.name, st.stale)
    cbase.save_state(CONNECTORS_STATE, state)


def connector_rows(kind: str) -> list[dict]:
    """Connecteurs d'un apport (status : Home Assistant ; network : MynetworK ; security : LogviewR ; containers : Dockhand ;
    virtualization : Proxmox) : état de chaque instance et ses données, pour data.json ; une instance injoignable garde son
    dernier relevé, marqué périmé."""
    try:
        insts = connectors.instances(CFG, kind=kind)
    except connectors.ConnectorError:
        return []  # déjà signalé par read_npm (même registre)
    out, state = [], cbase.load_state(CONNECTORS_STATE)
    for c in insts:
        data, st = cbase.run_isolated(c, state, 60)
        CONNECTOR_STATUS.append(st)
        out.append({"connector": c.type, "name": c.name, "label": c.label, "ok": st.ok, "stale": st.stale, "message": st.message,
                    "version": st.version, "url": c.conf.get("url"), **(data or {})})
    if insts:
        cbase.save_state(CONNECTORS_STATE, state)
    return out


def progress(step, label, done=None, total=None):
    """Écrit l'étape en cours (JSON atomique) ; les compteurs de sondes sont limités à 2 écritures/s."""
    if not PROGRESS:
        return
    with _progress_lock:
        now = time.time()
        if done is not None and done < total and now - _progress_last[0] < 0.5:
            return
        _progress_last[0] = now
        tmp = PROGRESS + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"step": step, "steps": STEPS, "label": label, "done": done, "total": total, "ts": now}, f)
        os.replace(tmp, PROGRESS)


def published(url: str, inside: str = "") -> str:
    """URL d'une intégration donnée à la page, seulement si son fichier existe déjà (sinon la page le
    demanderait pour rien : 404 dans la console). URL absolue (autre site) : gardée telle quelle."""
    if not url or "://" in url or url.startswith("/"):
        return url
    return url if (Path(CFG["web_dir"]) / url / inside).exists() else ""


def main():
    progress(1, "lecture NPM (hosts, redirections, ACL)" if CFG["npm"] or CFG["npm_api"] else "pas de NPM configuré")
    hosts, redirects, dead, streams = read_npm()
    # Ping d'abord : une machine qui change d'état invalide les caches SSH et docker
    progress(2, "ping des machines")
    with ThreadPoolExecutor(8) as ex:
        pings = dict(zip(MACHINES, ex.map(lambda ip: False if ip in DISABLED else ping(ip), MACHINES)))
    ssh_cache = load_ssh_cache()
    changed = {ip for ip, up in pings.items() if ip in ssh_cache and ssh_cache[ip].get("ping") not in (None, up)}
    if changed:
        print("état ping changé, caches ignorés : " + ", ".join(sorted(changed)), file=sys.stderr)
    progress(3, "inventaire Docker et machines (SSH, cache 2 h)")
    dock = docker_inventory(force=changed)  # machines dont l'état de ping a changé : relues seules
    # Machine hôte -> {IP interne docker: conteneur} : un NPM ne joint que les réseaux docker de SA
    # machine (172.x se répètent d'une machine à l'autre), d'où une recherche par hôte d'instance
    internal = dock.pop("_internal", {})
    hinfo = dock.pop("_hostinfo", {})
    adopt_ssh(hinfo)
    # Vhosts Apache : (ip, port, nom) -> vhost ; Apache sert des fichiers locaux derrière NPM
    vhost_by = {}
    for ip, info in hinfo.items():
        for v in (info or {}).get("vhosts", []):
            for n in v["names"]:
                vhost_by[(ip, v["port"], n.lower())] = v

    def apache_service(ip, port, domains):
        info = hinfo.get(ip) or {}
        if not info.get("apache"):
            return None
        ports = set(info.get("apache_listen", [])) | {v["port"] for v in info.get("vhosts", [])}
        if port not in ports:
            return None
        v = next((vhost_by[(ip, port, d.lower())] for d in domains if (ip, port, d.lower()) in vhost_by), None)
        match = "vhost"
        # Nom déclaré nulle part : Apache répond avec le 1er vhost chargé sur ce port (ordre alphabétique
        # de sites-enabled, celui de hostinfo) ; seulement si tout est lisible, sinon le vrai vhost peut manquer
        if not v and domains and not info.get("vhosts_unreadable"):
            v = next((x for x in info.get("vhosts", []) if x["port"] == port and x["names"]), None)
            match = "défaut"
        if v:
            return {"kind": "apache", "name": f'apache2 · {v["names"][0]}' + (" (défaut)" if match == "défaut" else ""),
                    "vhost": v["names"][0], "aliases": v["names"][1:], "docroot": v["docroot"], "conf": v["conf"], "match": match}
        return {"kind": "apache", "name": "apache2", "match": "port",
                "note": "vhost non trouvé (config non lisible : " + ", ".join(info.get("vhosts_unreadable", [])) + ")"
                if info.get("vhosts_unreadable") else "vhost non trouvé"}
    progress(4, "process hors Docker")
    with ThreadPoolExecutor(4) as ex:
        jobs = {ip: ex.submit(_process_read, c)
                for ip, c in ((c.conf["ip"], c) for c in connectors.instances(CFG, kind="inventory", meta=META_RAW)
                              if c.type == "process")}
    procs = {ip: j.result() for ip, j in jobs.items()}
    # PC Windows lus par leur agent : ports à l'écoute et système viennent de son dernier relevé frais (rien lu par SSH)
    agent_sys, agent_apps, agent_fresh = {}, {}, {}
    for ip, a in agent_reports().items():
        if a["fresh"]:
            agent_fresh[ip] = a["report"]
            agent_sys[ip] = agents.system_of(a["report"])
            if agent_sys[ip]:
                agent_sys[ip]["hardware"] = agents.hardware_of(a["report"])
            if not procs.get(ip):
                procs[ip] = agents.ports_of(a["report"])
            wdock = agents.docker_of(a["report"])           # Docker du PC (docker.exe) : même forme que la lecture par SSH
            if wdock is not None and not dock.get(ip):
                dock[ip] = wdock
            apps = known_apps.apps_from_services(agents.services_of(a["report"]))
            agent_apps[ip] = apps
            if agent_sys[ip]:
                agent_sys[ip].update(docker=len(wdock) if wdock is not None else None, apps=[{"key": x.key, "label": x.label} for x in apps])
    meta = load_meta()
    # Machine hôte de MyServices (« host » : true) sans process lus par SSH : ses ports en écoute, lus sur place
    # (premier démarrage : de quoi remplir la page avant toute clé SSH ; les conteneurs reconnus passent devant)
    for ip, m in META_RAW.get("machines", {}).items():
        if m.get("host") and not procs.get(ip):
            procs[ip] = {p: dict(v, port_only=True) for p, v in host_ports().items()}

    # Index docker : (ip, port hôte) -> conteneur ; par nom pour les conteneurs en réseau host
    by_port, by_name = {}, {}
    for ip, conts in dock.items():
        for c in conts or []:
            by_name.setdefault(ip, {})[c["name"].lower()] = c
            for hp, inner in c["ports"]:
                by_port[(ip, hp)] = dict(c, inner=inner)

    rows, used = [], set()
    for h in hosts:
        ip, port = h["forward_host"], h["forward_port"]
        if ip in IGNORED_IPS:
            continue
        adv = h.get("advanced_config") or ""
        svc = via = cname = None
        hip = ip  # machine où chercher le service (l'hôte NPM quand la cible n'existe que vu de lui)
        npm_host = NPM_IPS.get(h["_npm"])
        seen_by_npm = internal.get(npm_host, {}).get(ip)
        if npm_host and ip.startswith("127."):  # boucle locale DU CONTENEUR NPM, pas de la collectrice
            via, how = npm_host, "boucle locale du conteneur NPM"
        elif ip != npm_host and seen_by_npm == HOST_ADDR:  # service de l'hôte NPM via son pont docker
            via = hip = npm_host
            how = "service de l'hôte (pont docker)"
        elif seen_by_npm and seen_by_npm != HOST_ADDR:  # conteneur sur un réseau docker interne de l'hôte NPM
            via, cname, how = npm_host, seen_by_npm, "réseau docker interne"
            c = by_name.get(via, {}).get(cname.lower())
            svc = docker_service(c, "IP interne") if c else {"kind": "docker", "name": cname, "match": "IP interne"}
        elif (ip, port) in by_port:
            svc = docker_service(by_port[(ip, port)], "port")
        if svc is None and cname is None:
            # Conteneurs en réseau host (pas de port publié) : rattachés si le 1er label du
            # domaine et le nom du conteneur sont préfixes l'un de l'autre (ad -> adguardhome)
            label = re.sub(r"[^a-z0-9]", "", h["domain_names"][0].split(".")[0].lower())
            named = [c for n, c in by_name.get(hip, {}).items()
                     if len(label) >= 2 and (n.startswith(label) or label.startswith(n))]
            cands = [c for c in named if "host" in c["network"] and c["status"].startswith("Up")]
            if len(cands) == 1:
                svc = docker_service(cands[0], "nom")
            else:
                # Conteneurs arrêtés (Created/Exited, sans port publié) : même règle de nom ;
                # plusieurs conteneurs d'un même projet compose = la pile entière
                stopped = [c for c in named if not c["status"].startswith("Up")]
                if len(stopped) == 1:
                    svc = docker_service(stopped[0], "nom (arrêté)")
                elif stopped and len({c["compose"] for c in stopped}) == 1 and stopped[0]["compose"]:
                    st = {c["status"].split(" ")[0] for c in stopped}
                    svc = dict(docker_service(stopped[0], "nom (arrêté)"), name=f'{label} ({stopped[0]["compose"]})',
                               image=", ".join(sorted(c["name"] for c in stopped)),
                               state=st.pop() if len(st) == 1 else "arrêtés")
        if svc is None:
            svc = apache_service(hip, port, h["domain_names"])
        if svc is None and port in procs.get(hip, {}):
            svc = {"kind": "process", "name": procs[hip][port]["name"]}
        used.add((ip, port))
        used.add((hip, port))  # service de l'hôte NPM vu par son pont : pas de doublon « hors NPM » sur son IP
        rows.append(row(
            "proxy", h["id"], ip, port,
            npm=h["_npm"],
            domains=h["domain_names"],
            enabled=bool(h["enabled"]),
            scheme=h["forward_scheme"],
            service=svc,
            acl_id=h["access_list_id"],
            acl=h["_acl"],
            acl_adv=bool(re.search(r"acl_lan|\$acl_\w+\s*=\s*0|^\s*deny\s", adv, re.M)),
            cloudflare="CF-Connecting-IP" in adv,
            lan_only=bool(h["access_list_id"]) or "acl_lan" in adv,  # garde LAN : le nom doit résoudre vers NPM en local
            closes_root=bool(re.search(r"location\s+/\s*\{\s*return\s+444\s*;", adv)),  # / fermé exprès (444)
            ssl=bool(h["certificate_id"]),
            ssl_forced=bool(h["ssl_forced"]),
            hsts=bool(h["hsts_enabled"]),
            http2=bool(h["http2_support"]),
            websocket=bool(h["allow_websocket_upgrade"]),
            block_exploits=bool(h["block_exploits"]),
            caching=bool(h["caching_enabled"]),
            locations=len(h.get("locations") or []),
            advanced=bool(adv.strip()),
            nginx_online=(h.get("meta") or {}).get("nginx_online"),
            nginx_err=(h.get("meta") or {}).get("nginx_err"),
            created=h["created_on"],
            modified=h["modified_on"],
        ))
        if ip in NPM_ONLY:
            rows[-1].update(internal=True, machine_role=rows[-1]["machine_role"] + " · joignable seulement depuis NPM")
        if via:
            mach = MACHINES.get(via)
            rows[-1].update(machine=mach[0], machine_role=f"{mach[1]} · {how}", internal=True, host_ip=via)
    for r in redirects:
        rows.append({
            "type": "redirect",
            "id": r["id"],
            "npm": r["_npm"],
            "domains": r["domain_names"],
            "enabled": bool(r["enabled"]),
            "target": f'{r.get("forward_scheme", "")}://{r.get("forward_domain_name")}',
            "target_host": (urllib.parse.urlsplit(f'//{r.get("forward_domain_name") or ""}').hostname or "").lower(),
            "http_code": r.get("forward_http_code"),
            "ssl": bool(r.get("certificate_id")),
            "ssl_forced": bool(r.get("ssl_forced")),
            "created": r["created_on"],
            "modified": r["modified_on"],
        })
    for r in dead:  # hosts « 404 » : NPM répond 404 pour ces domaines
        rows.append({
            "type": "dead",
            "id": r["id"],
            "npm": r["_npm"],
            "domains": r["domain_names"],
            "enabled": bool(r["enabled"]),
            "ssl": bool(r.get("certificate_id")),
            "ssl_forced": bool(r.get("ssl_forced")),
            "service": {"kind": "npm", "name": "page 404 de NPM"},
            "created": r["created_on"],
            "modified": r["modified_on"],
        })
    # Redirection : service = celui du proxy host NPM visé (www.exemple.fr -> exemple.fr -> Apache),
    # redirections en chaîne suivies ; cible hors NPM = page finale (probe_follow) plus bas
    proxy_by = {d.lower(): r for r in rows if r["type"] == "proxy" for d in r["domains"]}
    redir_by = {d.lower(): r for r in rows if r["type"] == "redirect" for d in r["domains"]}
    for r in rows:
        if r["type"] != "redirect":
            continue
        dom, seen = r["target_host"], set()
        while dom in redir_by and dom not in seen:
            seen.add(dom)
            dom = redir_by[dom]["target_host"]
        p = proxy_by.get(dom)
        if p:
            r.update(target_proxy=p["id"], target_ip=p.get("host_ip") or p["ip"],
                     machine=p["machine"], machine_role=p["machine_role"])
            if p.get("service"):
                r["service"] = dict(p["service"], match="redirection", via=dom)
    for r in streams:  # streams TCP/UDP : port d'entrée NPM -> ip:port
        ip, port = r.get("forwarding_host"), r.get("forwarding_port")
        rows.append(row(
            "stream", r["id"], ip, port,
            npm=r["_npm"],
            name=f'stream :{r.get("incoming_port")}',
            enabled=bool(r.get("enabled")),
            incoming_port=r.get("incoming_port"),
            tcp=bool(r.get("tcp_forwarding")),
            udp=bool(r.get("udp_forwarding")),
            created=r.get("created_on"),
            modified=r.get("modified_on"),
        ))

    # Hors NPM : ports docker publiés non proxifiés, process LAN des process_hosts, ajouts manuels
    for ip, conts in dock.items():
        for c in conts or []:
            for hp, inner in c["ports"]:
                if (ip, hp) not in used:
                    used.add((ip, hp))
                    rows.append(row("local", f"{ip}:{hp}", ip, hp, name=c["name"],
                                    service=docker_service(dict(c, inner=inner), "port")))
    for ip, ports in procs.items():
        for port, p in ports.items():
            if p["lan"] and (ip, port) not in used:
                used.add((ip, port))
                rows.append(row("local", f"{ip}:{port}", ip, port, name=p["name"],
                                service=None if p.get("port_only") else {"kind": "process", "name": p["name"]}))
    for ip, info in hinfo.items():
        if not (info and info.get("apache")):
            continue
        for port in sorted(set(info.get("apache_listen", [])) | {v["port"] for v in info.get("vhosts", [])}):
            if (ip, port) not in used:
                used.add((ip, port))
                names = [n for v in info["vhosts"] if v["port"] == port for n in v["names"][:1]]
                rows.append(row("local", f"{ip}:{port}", ip, port, name=f"apache2 :{port}",
                                service={"kind": "apache", "name": "apache2" + (" · " + ", ".join(names) if names else ""),
                                         "match": "port"}))
                addr = info.get("apache_listen_addr", {}).get(str(port))
                if addr and addr not in ("0.0.0.0", "*", "[::]", ip):  # lié à une IP interne : pas de sonde depuis le collecteur
                    rows[-1].update(internal=True, listen_addr=addr, ssh_active=True,  # apache2 actif (systemctl, via SSH)
                                    machine_role=rows[-1]["machine_role"] + f" · Apache écoute seulement sur {addr}")
    for x in meta.get("extra", []):
        rows.append(row("local", f'{x["ip"]}:{x["port"]}', x["ip"], x["port"], name=x["name"],
                        scheme=x.get("scheme", "http"), manual=True,
                        service={"kind": "manuel", "name": x["name"]}))

    # Surcharges manuelles : par domaine, puis ip:port, puis nom de conteneur
    def meta_for(r):
        s = r.get("service") or {}
        keys = r["domains"] + [f'{r.get("ip")}:{r.get("port")}', s.get("name", "")]
        return next((meta.get("services", {})[k] for k in keys if k in meta.get("services", {})), {})
    for r in rows:
        r["_meta"] = meta_for(r)
        if r["_meta"].get("pause"):  # « ne plus sonder » : aucune sonde tant que la pause est posée
            r["paused"] = r["_meta"]["pause"]
        mip = r.get("host_ip") or r.get("ip")
        if mip in MACHINES_OFF and not pings.get(mip):  # éteinte volontairement : rien à sonder
            r["machine_off"] = True
    probed = [i for i, r in enumerate(rows) if not r.get("paused") and not r.get("machine_off")]
    # IP docker internes : joignables seulement depuis NPM, pas de sonde directe depuis le collecteur
    direct = [i for i in probed if rows[i].get("ip") and not rows[i].get("internal")]
    named = [i for i in probed if rows[i]["domains"]]
    redir = [i for i in named if rows[i]["type"] == "redirect" and rows[i]["enabled"]]
    total, done = 2 * len(direct) + len(named) + len(redir), [0]

    def tick(_f):
        with _progress_lock:
            done[0] += 1
        progress(5, "sondes TCP, HTTPS et web (1er passage)", done[0], total)

    progress(5, "sondes TCP, HTTPS et web (1er passage)", 0, total)
    with ThreadPoolExecutor(48) as ex:
        backend = {i: ex.submit(probe_tcp, rows[i]["ip"], rows[i]["port"]) for i in direct}
        public = {i: ex.submit(probe_https, rows[i]["domains"][0]) for i in named}
        web = {i: ex.submit(probe_web, rows[i]["scheme"], rows[i]["ip"], rows[i]["port"], rows[i]["domains"][0] if rows[i]["domains"] else None)
               for i in direct}
        follow = {i: ex.submit(probe_follow, rows[i]["domains"][0]) for i in redir}
        for f in (*backend.values(), *public.values(), *web.values(), *follow.values()):
            f.add_done_callback(tick)
    backend = {i: f.result() for i, f in backend.items()}
    public = {i: f.result() for i, f in public.items()}
    web = {i: f.result() for i, f in web.items()}
    follow = {i: f.result() for i, f in follow.items()}
    progress(6, "confirmation des sondes lentes (2e passage, évite les fausses alertes)")
    # 2e essai, peu parallèle : à 48 sondes simultanées, DNS et sites derrière
    # Cloudflare/Anubis dépassent le délai et donnent de fausses erreurs
    with ThreadPoolExecutor(4) as ex:
        rb = {i: ex.submit(probe_tcp, rows[i]["ip"], rows[i]["port"]) for i, v in backend.items() if not v["up"]}
        rp = {i: ex.submit(probe_https, rows[i]["domains"][0]) for i, v in public.items() if v.get("err")}
        rf = {i: ex.submit(probe_follow, rows[i]["domains"][0]) for i, v in follow.items() if not v["code"]}
        rw = {i: ex.submit(probe_web, rows[i]["scheme"], rows[i]["ip"], rows[i]["port"],
                           rows[i]["domains"][0] if rows[i]["domains"] else None)
              for i, v in web.items() if v is None and backend[i]["up"]}
    for src, dst in ((rb, backend), (rp, public), (rw, web), (rf, follow)):
        for i, f in src.items():
            dst[i] = f.result()
    last_known = last_known_services.previous_services(OUT)
    for i, r in enumerate(rows):
        if i in backend:
            r["backend"] = backend[i]
        elif r.get("ssh_active"):
            r["backend"] = {"up": True, "internal": True, "via": "ssh"}
        elif r.get("internal"):
            r["backend"] = {"up": None, "internal": True}
        if i in public:
            r["public"] = public[i]
        if i in follow:
            r["follow"] = follow[i]
        w = web.get(i)
        if w is None and r.get("backend", {}).get("up"):
            w = {"web": "none"}
        r["web"] = w["web"] if w else None
        r["web_scheme"] = w.get("scheme") if w else None
        r["page_title"] = w.get("title") if w else (r.get("follow") or {}).get("title")
        if w and w.get("fp"):
            r["fingerprint"] = w["fp"]  # lu par known_apps.annotate puis retiré : seule l'appli reconnue est écrite dans data.json
        s = r.get("service") or {}
        if not s and r["page_title"]:
            r["service"] = s = {"kind": "web", "name": r["page_title"]}
        if not s and r["enabled"] and not r.get("backend", {}).get("up") and (r["type"], str(r["id"])) in last_known:
            r["service"] = s = {**last_known[(r["type"], str(r["id"]))], "stale": True}  # backend muet : dernière identification connue
        m = r.pop("_meta") or meta_for(r)
        r["category"] = m.get("category") or categorize(" ".join(r["domains"]), r.get("name"), s.get("name"),
                                                         s.get("image"), s.get("title"), r["page_title"])
        known_apps.annotate(r, keep_category=bool(m.get("category")))
        r["description"] = m.get("description") or s.get("description") or None
        r["tags"] = m.get("tags", [])
        if "web" in m:  # surcharge manuelle : "ui" / "api" / "none"
            r["web"] = m["web"]
        r["direct_ok"] = bool(m.get("direct_ok"))  # UI hors NPM voulue : exclue du compteur
        r["public_ok"] = bool(m.get("public"))  # site public voulu : pas d'ACL attendue

    webcheck_rows(rows)
    uptime_rows(rows)

    progress(7, "DNS AdGuard : réécritures et réponses de chaque instance")
    adguard_sync_detect(dock)
    dns = dns_check(rows) if ADGUARD else None

    progress(8, "machines : SSH et écriture de data.json")
    sshc = hostinfo.ssh_config()
    extras, notes = hostinfo.sshlist_entries()  # accès et notes du script sshlist (config.json : sshlist)
    for ip, e in extras.items():
        sshc.setdefault(ip, e)
    machines_out = []
    for ip, (name, role, _) in MACHINES.items():
        info, sc = hinfo.get(ip), sshc.get(ip)
        rs = [r for r in rows if (r.get("host_ip") or r.get("ip")) == ip]
        machines_out.append({
            "ip": ip, "name": name, "role": role,
            "ping": pings[ip],
            "off": ip in MACHINES_OFF,
            "disabled": ip in DISABLED,
            "ttl": PING_TTL.get(ip),  # indice du système pour une machine sans SSH (suggestion, jamais une certitude)
            "detected": hostinfo.detected_flags(ip, info, META_RAW.get("machines", {}).get(ip, {})),
            "icon": META_RAW.get("machines", {}).get(ip, {}).get("icon") or None,  # icône choisie dans Réglages → Machines (absent = automatique)
            "local": MACHINES[ip][2] == "local",
            "ssh": {"alias": sc["alias"], "port": sc["port"], "user": sc["user"], "identity": sc["identity"],
                    "key_fp": hostinfo.key_fingerprint(sc["identity"]), "host_key": hostinfo.host_key(ip, sc["port"]),
                    "methods": ssh_methods(ssh_cache, ip, sc["port"], ip in changed),
                    "note": notes.get(f'{sc["user"]}@{ip}:{sc["port"]}') or sc.get("note")} if sc and ip not in DISABLED | SSH_OFF else None,
            "info": info,
            "agent": ({**agent_sys[ip], "via": "agent"} if agent_sys.get(ip) else None),  # système lu par l'agent (info = lu par SSH)
            "services": len(rs), "npm": sum(1 for r in rs if r["type"] != "local"),
            "down": sum(1 for r in rs if r.get("enabled") and not r.get("paused") and not r.get("machine_off")
                        and (r.get("backend") or {}).get("up") is False),
        })

    for ip, up in pings.items():
        ssh_cache.setdefault(ip, {})["ping"] = up
    with open(SSH_CACHE, "w") as f:
        json.dump(ssh_cache, f)

    # Avant « out » : ces lectures ajoutent leur état à CONNECTOR_STATUS, que « connectors » (ci-dessous) recopie ;
    # lues dans le dictionnaire, après « connectors », leur état manquait et la page disait « pas encore lu »
    services_status, network, security, containers, virtualization = (connector_rows(k) for k in ("status", "network", "security", "containers", "virtualization"))
    connector_rows("logs")   # Dozzle: only its state and version for the connector card (its links are added to the containers)
    # An API without version (Dockhand…): the one of the container behind the connector URL, when its image says it
    urls = {}
    with contextlib.suppress(connectors.ConnectorError):
        urls = {(c.type, c.name): c.conf.get("url") for c in connectors.instances(CFG)}
    for card in (*services_status, *network, *security, *containers, *virtualization):
        if not card.get("version"):
            card["version"] = api_link.app_version(card.get("url"), rows)
    for st in CONNECTOR_STATUS:
        if st.type == "dozzle" and st.ok:   # its own reading returns no figure: the containers given a « logs » link are its badge
            st.found = [{"name": "conteneurs reliés", "count": sum(1 for r in rows if (r.get("service") or {}).get("logs_url"))}]
        if not st.version and (v := api_link.app_version(urls.get((st.type, st.name)), rows)):
            st.version, st.version_tested = v, None   # not read by the API: no « untested » warning
    linked = api_link.by_machine([*services_status, *network, *security, *containers, *virtualization], {m["ip"] for m in machines_out})
    services_status += [fb for row in network if row.get("connector") == "mynetwork" and (fb := mynetwork_conn.freebox_status(row))]   # Freebox read through MynetworK
    # Proxmox hosts read by SSH (after api_link: SSH is not an API badge), unless a connector already reads them
    virtualization += pve_ssh.rows(machines_out, sshc, {api_link.host_ip(c.get("url")) for c in virtualization if c.get("connector") == "proxmox"})
    # ESXi hosts read by SSH, unless a vCenter connector already lists them (by IP or by name)
    vc_hosts = {x for c in virtualization if c.get("connector") == "vcenter" for n in c.get("nodes") or [] for x in (n.get("ip"), n.get("name"))}
    virtualization += esxi_ssh.rows(machines_out, sshc, {m["ip"] for m in machines_out if m["ip"] in vc_hosts or m["name"] in vc_hosts})
    virtualization += virt_ssh.rows(machines_out, sshc)   # KVM / libvirt, Incus / LXD, VirtualBox read by SSH
    names = {m["ip"]: m["name"] for m in machines_out}
    for ip, rep in agent_fresh.items():   # Windows PCs read by their agent: Hyper-V VMs, last Veeam Agent and Windows Server Backup
        if (hv := agents.hyperv_of(rep, names.get(ip, ip))) is not None:
            virtualization.append({"connector": "hyperv", "name": names.get(ip, ip), "label": "Hyper-V", "ok": True, "stale": False,
                                   "message": "lu par l'agent Windows", "version": None, "url": None, "via": "agent", "ip": ip, **hv})
        services_status += [agents.windows_backup_card(b, names.get(ip, ip)) for b in agents.windows_backups_of(rep)]
    for m in machines_out:   # machine lue par l'API d'un connecteur (Home Assistant…) : la page le sait, elle ne dit plus « sans SSH »
        if m["ip"] in linked:
            m["api"] = linked[m["ip"]]
    # Matching layer: the same machine as seen by MynetworK / UniFi, Beszel, Proxmox and Dockhand (Beszel: its last result, no new call)
    cstate = cbase.load_state(CONNECTORS_STATE)
    beszel = [{"name": k.split("/", 1)[1], "systems": (v.get("last") or {}).get("systems", [])}
              for k, v in cstate.items() if k.startswith("beszel/") and isinstance(v, dict)]
    unifi = [s for s in services_status if s.get("connector") == "unifi" and s.get("unifi")]   # UniFi read directly, not through MynetworK
    links = matching.link(machines_out, network + unifi, virtualization, containers, beszel)
    for m in machines_out:
        m["links"] = links["machines"].get(m["ip"])
    declared_now = connectors.declared(CFG, META_RAW)
    detected_apps = known_apps.propose(rows, declared_now, with_linked=True) + [   # applis reconnues, reliées ou non : « proposals » garde les non reliées
        p for ip, apps in agent_apps.items()
        for p in known_apps.propose_windows(ip, (MACHINES.get(ip) or [None])[0], apps, procs.get(ip) or {}, declared_now, with_linked=True)]
    # Not proposed when already covered: read over SSH without a connector (Proxmox by pvesh: the connector would read the same), a
    # connector whose address is a name served by NPM (its backend is this machine), or Dozzle (one server shows every host's logs)
    by_ssh = {(v.get("connector"), v.get("ip")) for v in virtualization if v.get("via") == "ssh"}
    backend = {d.lower(): r.get("ip") for r in rows if r["type"] == "proxy" for d in r.get("domains") or []}
    by_name = {(c.get("type"), backend.get((urllib.parse.urlsplit(str(c.get("url") or "")).hostname or "").lower()))
               for c in declared_now if c.get("url")}
    one = {c.get("type") for c in declared_now} & {"dozzle"}
    for p in detected_apps:
        if p["linked"]:
            continue
        if (p["connector"], p["ip"]) in by_ssh:
            p.update(linked=True, via="ssh")
        elif (p["connector"], p["ip"]) in by_name or p["connector"] in one:
            p["linked"] = True
    out = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "next_run": next_timer_run("myservices.timer"),
        "page": {"health_url": published(CFG["health_url"], "stats.json"), "backups_url": published(CFG["backups_url"]),
                 **{k: CFG[k] for k in ("links", "stale_min")},
                 "map": bool(os.environ.get("MYSERVICES_ARCHIFY")) and os.path.exists(os.environ["MYSERVICES_ARCHIFY"])},
        "docker_cache_age": round(time.time() - json.load(open(DOCKER_CACHE))["ts"]),
        "docker_unreachable": [MACHINES[ip][0] for ip, c in dock.items() if c is None],
        "machines": {ip: {"name": m[0], "role": m[1], **MACHINE_FLAGS[ip]} for ip, m in MACHINES.items()},
        "npm_instances": NPM_IPS,
        "connectors": [{**{k: v for k, v in vars(st).items() if k != "extra"}, **({"ip": st.extra["ip"]} if st.extra.get("ip") else {})}
                       for st in CONNECTOR_STATUS],  # ip : la machine visée (deux machines peuvent porter le même nom)
        "categories": [n for n, _ in CATEGORIES] + ["Autre"],
        "hosts": rows,
        "proposals": [p for p in detected_apps if not p["linked"]],
        "detected_apps": detected_apps,
        "services_status": services_status,
        "network": network,
        "security": security,
        "containers": containers,
        "virtualization": virtualization,
        "dns": dns,
        "machine_list": machines_out,
        "unlinked": links["unlinked"],   # seen by a tool (MynetworK, Proxmox, Dockhand, Beszel), not followed here
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = f"{OUT}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print(f"{len(rows)} entrées -> {os.path.normpath(OUT)}", file=sys.stderr)


if __name__ == "__main__":
    import app_user
    app_user.drop_root()   # docker compose exec : root -> compte 10001 (sa config SSH, fichiers de /data restés à lui)
    # Un seul passage à la fois (cron + lancement manuel) : sinon on sort sans rien faire
    lock = open(os.path.join(os.path.dirname(DOCKER_CACHE), "run.lock"), "w") \
        if os.makedirs(os.path.dirname(DOCKER_CACHE), exist_ok=True) is None else None
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("passage déjà en cours, ignoré", file=sys.stderr)
        sys.exit(0)
    main()
