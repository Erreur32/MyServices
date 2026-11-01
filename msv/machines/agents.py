"""Agents MyServices (version Docker) : une machine envoie elle-même son relevé de santé, sans SSH.

- Un agent = un jeton msv_agent_ lié à UNE machine (son IP dans services-meta). Il ne sert qu'à envoyer un relevé
  pour cette machine : jamais à lire quoi que ce soit, ni à appeler une autre route.
- Affiché une seule fois à la création ; la base ne garde que son empreinte SHA-256 et ses 4 derniers caractères.
- Dernier relevé gardé tel quel (JSON) avec sa date : health.py le range dans les mêmes champs qu'une machine lue
  par SSH (parse_windows) tant qu'il est frais (moins de FRESH_MULT × l'intervalle annoncé par l'agent).
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from msv.machines.agent_reports import DEFAULT_INTERVAL, FRESH_MULT, fresh_reports
from msv.machines.winname import windows_name

VERSION = "9"                # Windows agent (agent.ps1)
LINUX_VERSION = "8"          # Linux agent (agent.py)
KINDS = ("windows", "linux")
PS_AGENT = "agent.ps1"       # script de l'agent Windows
SCRIPT_OF = {"windows": PS_AGENT, "linux": "agent.py"}
SCRIPTS = Path(__file__).resolve().parents[2] / "agent"
PREFIX = "msv_agent_"
SAFE_PATH = re.compile(r"/[A-Za-z0-9._/-]+")   # what install.sh accepts
NAME_RE = re.compile(r"^[\w .@-]{2,64}$")
MAX_BODY = 256 * 1024     # octets : un relevé fait quelques ko (compressé en gzip par l'agent Linux depuis sa version 3)
MAX_UNZIPPED = 2 * 1024 * 1024   # octets : un relevé gzip une fois décompressé (au-delà : refusé, jamais décompressé en entier)
# Windows report blocks the agent reads only every 6 h (hardware, physical disks, running services): absent from a report, they are kept
# from the previous one, so the machine does not lose them between two full reads
SLOW_KEYS = ("hw", "pd", "sv")
MIN_INTERVAL, MAX_INTERVAL = 60, 86400
MAX_LINUX_CMDS, MAX_LINUX_OUT, MAX_LINUX_CMD = 60, 200_000, 4000   # a Linux report: commands per report, characters per output and per command
MIN_GAP = 60              # s: an agent sends at most one report per minute (the rest gets 429)
LEGACY_HOST = "[Environment]::MachineName"   # what agents up to version 7 sent instead of the real name (script bug): means "unknown"
BAD_MAX, BAD_WINDOW = 10, 15 * 60   # bad tokens tolerated per IP, then refused until the window ends

SCHEMA = """
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY, ip TEXT NOT NULL, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, hint TEXT NOT NULL,
  created REAL NOT NULL, created_by TEXT, revoked REAL, last_seen REAL, last_ip TEXT,
  interval INTEGER, version TEXT, os_name TEXT, report TEXT);
"""


_bad: dict[str, list[float]] = {}   # IP -> dates of its recent bad tokens
_bad_lock = threading.Lock()


class AgentError(Exception):
    """Refus lisible."""


class Agents:
    def __init__(self, path: str | Path):
        self.path = str(path)
        with self._db() as db:
            db.executescript(SCHEMA)
            have = {r["name"] for r in db.execute("PRAGMA table_info(agents)")}
            for col, ddl in (("auto_update", "INTEGER NOT NULL DEFAULT 0"), ("update_requested", "REAL"),
                             ("hostname", "TEXT"), ("host_pending", "TEXT"), ("kind", "TEXT NOT NULL DEFAULT 'windows'"), ("level", "TEXT")):   # databases created before these columns
                if col not in have:
                    db.execute(f"ALTER TABLE agents ADD COLUMN {col} {ddl}")

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA journal_mode = WAL")
            yield db
        finally:
            db.close()

    def create(self, ip: str, name: str, by: str, kind: str = "windows") -> tuple[str, dict]:
        """(jeton en clair, à montrer une seule fois ; fiche). Un seul agent actif par machine : le précédent est révoqué."""
        try:
            ip = str(ipaddress.ip_address((ip or "").strip()))
        except ValueError:
            raise AgentError("adresse IP de la machine invalide")
        if kind not in KINDS:
            raise AgentError("type d'agent inconnu : windows ou linux")
        name = (name or "").strip()
        if not NAME_RE.match(name):
            raise AgentError("nom : 2 à 64 caractères (lettres, chiffres, espace, . _ @ -)")
        raw = PREFIX + secrets.token_urlsafe(32)
        now = time.time()
        with self._db() as db:
            db.execute("UPDATE agents SET revoked = ? WHERE ip = ? AND revoked IS NULL", (now, ip))
            aid = db.execute("INSERT INTO agents (ip, name, hash, hint, created, created_by, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
                             (ip, name, _h(raw), raw[-4:], now, by, kind)).lastrowid
        return raw, self.get(aid)

    def get(self, aid: int) -> dict:
        with self._db() as db:
            r = db.execute("SELECT * FROM agents WHERE id = ?", (aid,)).fetchone()
        if r is None:
            raise AgentError("agent inconnu")
        return _public(r)

    def listing(self) -> list[dict]:
        """Every agent, without its last report (a few dozen kB each, never shown in the list)."""
        with self._db() as db:
            return [_public(r) for r in db.execute(f"SELECT {PUBLIC_COLS} FROM agents ORDER BY revoked IS NOT NULL, created DESC")]

    def set_auto_update(self, aid: int, on: bool) -> None:
        """Mise à jour automatique d'un agent : à son prochain relevé, il récupère le script du serveur s'il est plus ancien."""
        with self._db() as db:
            if not db.execute("UPDATE agents SET auto_update = ? WHERE id = ? AND revoked IS NULL", (int(bool(on)), aid)).rowcount:
                raise AgentError("agent inconnu ou révoqué")

    def request_update(self, aid: int) -> None:
        """« Mettre à jour maintenant » : au prochain relevé l'agent récupère le script, même sans mise à jour automatique."""
        a = self.get(aid)
        if a["revoked"]:
            raise AgentError("agent révoqué")
        with self._db() as db:
            db.execute("UPDATE agents SET update_requested = ? WHERE id = ?", (time.time(), aid))

    def update_for(self, aid: int, version: str | None) -> dict | None:
        """Ce que le serveur répond à un relevé de version `version` : la mise à jour (version, chemin, empreinte du script servi) si l'agent est
        plus ancien et que la mise à jour est automatique ou demandée ; None sinon. Une demande dont l'agent est à jour est classée."""
        with self._db() as db:
            r = db.execute("SELECT auto_update, update_requested, kind FROM agents WHERE id = ? AND revoked IS NULL", (aid,)).fetchone()
            if r is None:
                return None
            kind = r["kind"] or "windows"
            if not older(version, version_of(kind)):
                if r["update_requested"]:
                    db.execute("UPDATE agents SET update_requested = NULL WHERE id = ?", (aid,))
                return None
        if not (r["auto_update"] or r["update_requested"]):
            return None
        return {"version": version_of(kind), "path": "/myservices/agent/" + SCRIPT_OF[kind], "sha256": script_sha256(SCRIPT_OF[kind])}

    def revoke(self, aid: int) -> None:
        with self._db() as db:
            if not db.execute("UPDATE agents SET revoked = ? WHERE id = ? AND revoked IS NULL", (time.time(), aid)).rowcount:
                raise AgentError("agent inconnu ou déjà révoqué")

    def allows_ip(self, ip: str | None) -> bool:
        """True when a live agent was created for this address: outside MYSERVICES_ALLOW, its machine still reaches the agent routes (common.AGENT_PATHS)."""
        with self._db() as db:
            return db.execute("SELECT 1 FROM agents WHERE ip = ? AND revoked IS NULL LIMIT 1", (ip,)).fetchone() is not None

    def purge(self, aid: int) -> None:
        """Efface un agent déjà révoqué (sa ligne seulement : son jeton ne marchait plus de toute façon). Un agent actif ne s'efface pas."""
        with self._db() as db:
            if not db.execute("DELETE FROM agents WHERE id = ? AND revoked IS NOT NULL", (aid,)).rowcount:
                raise AgentError("agent inconnu ou pas révoqué (révoquez-le d'abord)")

    def too_many_bad(self, ip: str) -> bool:
        """True when this IP presented too many bad tokens in the window (in memory: resets on restart)."""
        with _bad_lock:
            recent = [t for t in _bad.get(ip, []) if t > time.time() - BAD_WINDOW]
            _bad[ip] = recent
            return len(recent) >= BAD_MAX

    def note_bad(self, ip: str) -> None:
        with _bad_lock:
            _bad.setdefault(ip, []).append(time.time())
            if len(_bad) > 1000:   # drop IPs with nothing recent so the table stays small
                for k in [k for k, v in _bad.items() if not v or v[-1] <= time.time() - BAD_WINDOW]:
                    del _bad[k]

    def claim_host(self, aid: int, host: object) -> bool:
        """Host name announced by the agent. The first name seen is kept; another name is refused (token copied to another
        machine?) and held until the admin confirms it. True when the report can be stored."""
        host = str(host or "").strip()[:64]
        if not host or host == LEGACY_HOST:
            return True
        with self._db() as db:
            r = db.execute("SELECT hostname FROM agents WHERE id = ?", (aid,)).fetchone()
            if r is None:
                return False
            if not r["hostname"] or r["hostname"] == LEGACY_HOST:   # nothing known yet, or only the version 7 placeholder: learn the real name
                db.execute("UPDATE agents SET hostname = ?, host_pending = NULL WHERE id = ?", (host, aid))
                return True
            if r["hostname"].casefold() == host.casefold():
                db.execute("UPDATE agents SET host_pending = NULL WHERE id = ? AND host_pending IS NOT NULL", (aid,))   # the known host is back: drop the stale warning
                return True
            db.execute("UPDATE agents SET host_pending = ? WHERE id = ?", (host, aid))
            return False

    def confirm_host(self, aid: int) -> None:
        """The admin accepts the new host name (machine renamed)."""
        with self._db() as db:
            if not db.execute("UPDATE agents SET hostname = host_pending, host_pending = NULL "
                              "WHERE id = ? AND host_pending IS NOT NULL AND revoked IS NULL", (aid,)).rowcount:
                raise AgentError("aucun changement de nom à confirmer")

    def check(self, raw: str | None) -> dict:
        """Fiche de l'agent si le jeton est valable ; AgentError(code) sinon."""
        if not raw:
            raise AgentError("TOKEN_MISSING")
        if not raw.startswith(PREFIX):
            raise AgentError("TOKEN_INVALID")
        with self._db() as db:
            r = db.execute("SELECT * FROM agents WHERE hash = ?", (_h(raw),)).fetchone()
        if r is None:
            raise AgentError("TOKEN_INVALID")
        if r["revoked"]:
            raise AgentError("TOKEN_REVOKED")
        return _public(r)

    def store_report(self, aid: int, report: dict, ip: str) -> tuple[str | None, str | None]:
        """Garde le relevé (déjà validé) et note le passage de l'agent. Rend (niveau du relevé précédent, niveau de celui-ci) :
        None pour le précédent s'il n'y en avait pas ; le serveur relit la santé quand ils diffèrent."""
        interval = report.get("interval")
        interval = interval if isinstance(interval, int) and MIN_INTERVAL <= interval <= MAX_INTERVAL else DEFAULT_INTERVAL
        osd = (report.get("data") or {}).get("os")
        os_name = windows_name(str(report.get("os") or ""), osd.get("b") if isinstance(osd, dict) else None) or ""
        with self._db() as db:
            old = db.execute("SELECT report, level FROM agents WHERE id = ?", (aid,)).fetchone()
            prev = json.loads(old["report"]) if old and old["report"] and (old["level"] is None or _partial(report)) else None
            if prev is not None:
                keep_slow_keys(report, prev)
            level = report_level(report)
            if old and old["level"] is not None:
                before = old["level"]
            else:
                before = report_level(prev) if prev else None
            db.execute("UPDATE agents SET last_seen = ?, last_ip = ?, interval = ?, version = ?, os_name = ?, report = ?, level = ? "
                       "WHERE id = ? AND revoked IS NULL",
                       (time.time(), ip, interval, str(report.get("version") or "")[:32], os_name[:120],
                        json.dumps(report, ensure_ascii=False), level, aid))
        return before, level

    def fresh_reports(self) -> dict[str, dict]:
        """{IP: {"report": relevé, "seen": date, "fresh": bool}} pour les agents actifs ayant déjà envoyé un relevé."""
        return fresh_reports(self.path)


# Ports Windows sans intérêt dans l'annuaire : RPC dynamique (49152 et au-delà), RPC/DCOM (135), NetBIOS (139), diffusion de l'appli Connected Devices (5040),
# découverte UPnP (2869) et WSD (5357) tenues par http.sys : le pare-feu les ferme aux autres machines, elles seraient toujours « injoignables »
NOISE_PORTS = {135, 139, 2869, 5040, 5357}


def ports_of(report: dict | None) -> dict[int, dict]:
    """Ports TCP à l'écoute d'un relevé d'agent : {port: {"name": processus, "lan": joignable depuis le réseau}} (même forme que
    connectors/process.py). Les ports de bouclage seuls ne sont pas « lan » ; les ports dynamiques et le bruit Windows sont écartés."""
    from connectors import process
    out: dict[int, dict] = {}
    for it in ((report or {}).get("data") or {}).get("ports") or []:
        try:
            port, addr, name = int(it["p"]), str(it.get("a") or ""), str(it.get("n") or "").strip()
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= port < 49152 or port in NOISE_PORTS:
            continue
        process.bind(out.setdefault(port, {"name": name or f"port {port}", "lan": False}), addr)
    return out


def docker_states(report: dict | None) -> dict[str, str] | None:
    """{container: status} of a Linux agent report (the `docker ps -a` of the health reading, run every minute); None without it."""
    from msv.core import docker_state
    from msv.collect import health
    data = (report or {}).get("data") or {}
    got = (data.get("cmds") or {}).get(health.DOCKER_PS_CMD) if data.get("kind") == "linux" else None
    return docker_state.parse_states(got[1]) if isinstance(got, list) and len(got) == 2 and got[0] == 0 else None


def docker_of(report: dict | None) -> list[dict] | None:
    """Conteneurs Docker d'un relevé d'agent (docker.exe présent sur le PC), même forme que connectors.docker_ssh ; None si le relevé n'en
    parle pas (agent ancien, Docker absent ou inaccessible pour le compte SYSTEM). Texte du PC : jamais fait confiance aux champs."""
    from connectors.docker_ssh import publish_ports
    lines = ((report or {}).get("data") or {}).get("dk")
    if lines is None:
        return None
    out = []
    for ln in (lines if isinstance(lines, list) else [lines])[:200]:
        f = (str(ln).split("|") + [""] * 5)[:5]
        if f[0].strip():
            out.append({"name": f[0].strip()[:80], "image": f[1].strip()[:200], "status": f[3].strip()[:80], "compose": "", "title": "",
                        "description": "", "version": "", "url": "", "network": f[4].strip()[:80], "ports": publish_ports(f[2])})
    return out


# 24 h of the adguardhome-sync log, same filter as over SSH, the newest lines kept: its name first, as the agent finds the container itself
SYNC_LOG_SH = ("c=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -m1 adguardhome-sync | cut -d' ' -f1); "
               "[ -z \"$c\" ] || { echo \"##$c\"; timeout 15 docker logs --since 24h \"$c\" 2>&1 | grep -E 'Sync done|ERROR' | cut -c1-400 | tail -c 48000; }; true")


def sync_log(report: dict | None, container: str) -> str | None:
    """The adguardhome-sync log of a fresh Linux agent report; None for another container, or when the agent sends none."""
    got = (((report or {}).get("data") or {}).get("cmds") or {}).get(SYNC_LOG_SH)
    if not isinstance(got, list) or len(got) != 2:
        return None
    head, _, body = str(got[1]).partition("\n")
    return body if head == f"##{container}" else None


def inventory_commands() -> list[str]:
    """Commands of the SSH inventory the Linux agent runs too (version 4, running services from version 5): machine info, Docker containers and networks, listening ports."""
    from msv.collect import hostinfo
    from connectors.docker_ssh import DOCKER_SH, NET_SH
    from connectors.process import LISTEN_SH
    from msv.remote.virt_ssh import AGENT_CMD
    return [hostinfo.REMOTE, hostinfo.UNITS_SH, DOCKER_SH, NET_SH, LISTEN_SH, AGENT_CMD, SYNC_LOG_SH]


def inventory_cache() -> dict[str, int]:
    """Machine info changes seldom: the agent sends its last output again for an hour (the SSH inventory is kept 2 h)."""
    from msv.collect import hostinfo
    return {hostinfo.REMOTE: 3600, hostinfo.UNITS_SH: 3600}


def linux_inventory(report: dict | None) -> dict | None:
    """Inventaire d'un relevé d'agent Linux, lu avec le code de la lecture SSH : {"info", "containers", "internal", "ports"} (None pour ce
    qui manque ou n'a pas pu être lu : agent ancien, Docker inaccessible au compte de l'agent) ; None si ce n'est pas un relevé Linux."""
    from msv.collect import hostinfo
    from connectors import docker_ssh, process
    data = (report or {}).get("data") or {}
    if data.get("kind") != "linux" or not isinstance(data.get("cmds"), dict):
        return None
    cmds = data["cmds"]
    got = lambda cmd: cmds[cmd] if isinstance(cmds.get(cmd), list) and len(cmds[cmd]) == 2 else (None, "")  # noqa: E731
    info = hostinfo.parse_host_info(got(hostinfo.REMOTE)[1])
    if info:
        info["via"] = "agent"   # the page says where it was read
        rc_units, out_units = got(hostinfo.UNITS_SH)
        info["units"] = None if rc_units is None else hostinfo.parse_units(out_units)   # None: an agent too old to send them, the page says so
    rc, out = got(docker_ssh.DOCKER_SH)
    if rc == 0:
        containers = docker_ssh.parse_containers(out)
    elif rc is not None and docker_ssh.docker_absent(rc, out):
        containers = []   # Docker is not installed: no container, not an unknown list
    else:
        containers = None
    rc_net, out_net = got(docker_ssh.NET_SH)
    rc_ss, out_ss = got(process.LISTEN_SH)
    return {"info": info, "containers": containers, "internal": docker_ssh.parse_internal(out_net) if rc_net is not None else None,
            "ports": process.parse_listening(out_ss)[0] if rc_ss == 0 else None}


def inventory_gaps(report: dict | None) -> list[str]:
    """What a Linux agent report lacks to replace the SSH inventory: "info" (machine info), "docker" (containers or networks unreadable by the
    agent's account), "sudo" (listening ports without their process, `ss` needs root for that). Empty when complete, or when it is not a Linux report."""
    inv = linux_inventory(report)
    if inv is None:
        return []
    return [gap for gap, ok in (("info", inv["info"]), ("docker", inv["containers"] is not None and inv["internal"] is not None), ("sudo", inv["ports"])) if not ok]


def serves_inventory(report: dict | None) -> bool:
    """True when a Linux agent report carries the whole SSH inventory (machine info, Docker containers and networks, listening ports): the
    collection then opens no SSH connection to that machine. Any missing field (old agent, Docker unreadable) keeps the SSH read."""
    return linux_inventory(report) is not None and not inventory_gaps(report)


def rights_gaps(report: dict | None) -> list[str]:
    """What a Linux agent report cannot read for lack of sudo: "needrestart", "fail2ban", "hypervisors". A tool that is not installed, or an agent
    too old to send the section, is not a gap. Apart from inventory_gaps: it does not weigh on the SSH decision."""
    from msv.collect import health
    from msv.remote import pve_ssh, virt_ssh
    data = (report or {}).get("data") or {}
    cmds = data.get("cmds")
    if data.get("kind") != "linux" or not isinstance(cmds, dict):
        return []
    got = cmds.get(health.SYSTEM_CMD)
    secs = health._sections(str(got[1])) if isinstance(got, list) and len(got) == 2 else {}
    parsers = (("needrestart", "nr", health.parse_needrestart), ("fail2ban", "f2b", health.parse_fail2ban))
    gaps = [gap for gap, sec, parse in parsers if parse(secs.get(sec, []), "").get("access") is False]
    return gaps + ["hypervisors"] if virt_ssh.agent_refused(cmds) or pve_ssh.agent_refused(cmds) else gaps


def options_of(report: dict | None) -> dict:
    """What a Linux agent says its install reads, in the words of the install page (AgentOptions): only what is set, and only safe paths,
    because these values go in a command the admin pastes as root."""
    got = (((report or {}).get("data") or {}).get("cmds") or {}).get("options")
    try:
        raw = json.loads(got[1]) if isinstance(got, list) and len(got) == 2 else {}
    except (TypeError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict = {k: True for k in ("sudo", "dns", "backups", "borgmatic") if raw.get(k) is True}
    found = raw.get("backupDirs")
    dirs = [d for d in found if isinstance(d, str) and SAFE_PATH.fullmatch(d)] if isinstance(found, list) else []
    if dirs:
        out["backupDirs"] = ",".join(dirs)
    npm = raw.get("npm")
    if npm == "" or (isinstance(npm, str) and SAFE_PATH.fullmatch(npm)):
        out["npm"] = npm
    return out


def listening_ports(report: dict | None) -> set[int] | None:
    """Ports a fresh agent report says are listening (Linux: the `ss` of the inventory, Windows: its ports list); None when the report has
    none (old agent, section missing), so that nothing is taken for a closed port."""
    inv = linux_inventory(report)
    found = inv["ports"] if inv else ports_of(report)
    return set(found) or None if found is not None else None


def services_of(report: dict | None) -> list[dict]:
    """Services Windows en marche d'un relevé d'agent : [{"name", "display"}] (300 au plus), vide pour un agent ancien."""
    out = []
    for it in (((report or {}).get("data") or {}).get("sv") or [])[:300]:
        if isinstance(it, dict) and it.get("n"):
            out.append({"name": str(it["n"]).strip()[:80], "display": str(it.get("d") or "").strip()[:120]})
    return out


def system_of(report: dict | None) -> dict | None:
    """Système d'un relevé d'agent : {"os", "kernel" (build), "uptime_s"} ou None si le relevé n'en contient pas."""
    import datetime
    data = (report or {}).get("data") or {}
    o = data.get("os")
    if not isinstance(o, dict) or not o.get("n"):
        return None
    up = None
    try:
        up = int((datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(str(data["boot"]).replace("Z", "+00:00"))).total_seconds())
    except (KeyError, ValueError, TypeError):
        pass
    return {"os": windows_name(str(o["n"]).strip(), o.get("b")), "kernel": f"{o.get('v') or ''} (build {o.get('b')})".strip() if o.get("b") else o.get("v"), "uptime_s": up}


def hardware_of(report: dict | None) -> dict | None:
    """Matériel d'un relevé d'agent (clé « hw » : modèle, BIOS, processeur, mémoire, graphique, réseau...) ou None s'il est absent."""
    from msv.collect import health
    data = (report or {}).get("data")
    return health.hardware_of_raw(data.get("hw")) if isinstance(data, dict) else None


def _dt(v) -> float | None:
    import datetime
    try:
        return datetime.datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def hyperv_of(report: dict | None, node: str) -> dict | None:
    """Hyper-V VMs of an agent report (key « hv », Get-VM), in the shape of the virtualization rows; None if the PC has no Hyper-V."""
    vms = ((report or {}).get("data") or {}).get("hv")
    if not isinstance(vms, list):
        return None
    guests = []
    for v in vms[:300]:
        if not isinstance(v, dict) or not v.get("n"):
            continue
        on = str(v.get("s")).lower() == "running" or v.get("s") == 2   # State is text, or its enum number (2 = Running) on some hosts
        mem = v.get("m") if isinstance(v.get("m"), (int, float)) and v["m"] > 0 else None
        guests.append({"vmid": str(v["n"])[:80], "name": str(v["n"])[:80], "type": "vm", "node": node, "status": "running" if on else "stopped",
                       "template": False, "tags": [], "cpus": v.get("c") if isinstance(v.get("c"), int) else None,
                       "mem": mem if on else None, "maxmem": mem or (v.get("x") if isinstance(v.get("x"), (int, float)) and v["x"] > 0 else None),
                       "uptime": v.get("u") if on and isinstance(v.get("u"), int) and v["u"] > 0 else None})
    return {"nodes": [{"name": node, "online": True}], "guests": guests, "storage": [], "backups": None,
            "totals": {"vm": len(guests), "lxc": 0, "running": sum(1 for g in guests if g["status"] == "running"),
                       "stopped": sum(1 for g in guests if g["status"] != "running")}}


def windows_backups_of(report: dict | None) -> list[dict]:
    """Last Veeam Agent job (event 190 of the « Veeam Agent » log) and last Windows Server Backup (Microsoft-Windows-Backup: event 4 = success,
    level error otherwise) of an agent report: [{"tool", "at" (epoch), "ok", "warn", "message"}]. Event levels: 2 error, 3 warning."""
    data = (report or {}).get("data") or {}
    out = []
    for key, tool in (("va", "Veeam Agent"), ("wb", "Sauvegarde Windows Server")):
        e = data.get(key)
        if not isinstance(e, dict):
            continue
        msg = str(e.get("m") or "")[:200]
        failed = e.get("l") in (1, 2) or (key == "va" and re.search(r"\bfailed\b", msg, re.I) is not None)
        warn = e.get("l") == 3 or (key == "va" and re.search(r"\bwarning\b", msg, re.I) is not None)
        out.append({"tool": tool, "at": _dt(e.get("t")), "ok": not failed, "warn": warn and not failed, "message": msg})
    return out


def windows_backup_card(b: dict, machine: str) -> dict:
    """Status card (Health, « service via API ») for the last Veeam Agent or Windows Server Backup run seen by a Windows agent."""
    age = time.time() - b["at"] if b.get("at") else None
    late = age is None or age > 26 * 3600
    when = "jamais" if age is None else f"il y a {int(age // 86400)} j" if age >= 86400 else f"il y a {max(1, int(age // 3600))} h"
    problems = ([] if b["ok"] else [f"dernière sauvegarde en échec : {b['message']}"]) + ([f"terminée avec avertissements : {b['message']}"] if b["warn"] else [])
    if late and b["ok"]:
        problems.append(f"aucune sauvegarde réussie depuis plus de 26 h ({when})")
    return {"connector": "veeam-agent" if b["tool"] == "Veeam Agent" else "wbadmin", "name": machine, "label": b["tool"], "ok": True, "stale": False,
            "message": "lu par l'agent Windows", "version": None, "url": None, "via": "agent",
            "facts": [{"label": "Dernière sauvegarde", "value": when, "tone": "bad" if not b["ok"] else "warn" if late or b["warn"] else "ok"},
                      {"label": "Résultat", "value": "échec" if not b["ok"] else "avertissements" if b["warn"] else "réussie",
                       "tone": "bad" if not b["ok"] else "warn" if b["warn"] else "ok"}],
            "problems": problems}


PUBLIC_COLS = ("id, ip, name, hint, created, created_by, revoked, last_seen, last_ip, interval, version, os_name, auto_update, "
               "update_requested, hostname, host_pending, kind")   # what _public reads: the report stays in the database


def _partial(report: dict) -> bool:
    """Relevé Windows sans un des blocs lus toutes les 6 h (SLOW_KEYS) : il faut le compléter avec le précédent."""
    data = report.get("data") or {}
    return data.get("kind") != "linux" and any(k not in data for k in SLOW_KEYS)


def keep_slow_keys(report: dict, prev: dict) -> None:
    """Complète un relevé Windows avec les blocs lents (SLOW_KEYS) du relevé précédent quand l'agent ne les a pas relus cette fois."""
    data, old = report.get("data"), (prev or {}).get("data")
    if not isinstance(data, dict) or not isinstance(old, dict) or data.get("kind") == "linux":
        return
    for k in SLOW_KEYS:
        if k not in data and k in old:
            data[k] = old[k]


def report_level(report: dict) -> str | None:
    """Niveau de santé (ok, warn, crit) que donne un relevé, avec les mêmes règles que la page Santé ; None s'il est illisible."""
    from msv.collect import health
    try:
        data = report["data"]
        if data.get("kind") == "linux":
            return health.host_level(health.collect_linux({"id": "x", "name": "x"}, health.replay_runner(data.get("cmds"))))
        return health.host_level({"reachable": True, **health.parse_windows(data)})
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def validate_report(body) -> dict:
    """Relevé reçu : un objet {"interval", "version", "os", "host", "data"}. `data` est le relevé PowerShell (Windows) ou, pour un agent
    Linux, {"kind": "linux", "cmds": {commande: [code, sortie]}} : les sorties des commandes que lance la collecte SSH, rejouées côté serveur
    (jamais exécutées). AgentError sinon."""
    if not isinstance(body, dict) or not isinstance(body.get("data"), dict):
        raise AgentError("relevé invalide : objet « data » attendu")
    if body["data"].get("kind") == "linux":
        cmds = body["data"].get("cmds")
        if not isinstance(cmds, dict) or not 0 < len(cmds) <= MAX_LINUX_CMDS:
            raise AgentError("relevé invalide : « cmds » attendu (au plus %d commandes)" % MAX_LINUX_CMDS)
        for cmd, res in cmds.items():
            if (not isinstance(cmd, str) or len(cmd) > MAX_LINUX_CMD or not isinstance(res, list) or len(res) != 2
                    or not isinstance(res[0], int) or isinstance(res[0], bool) or not isinstance(res[1], str) or len(res[1]) > MAX_LINUX_OUT):
                raise AgentError("relevé invalide : sortie de commande illisible")
        return body
    from msv.collect import health
    try:
        health.parse_windows(body["data"])
    except (KeyError, TypeError, ValueError, AttributeError):
        raise AgentError("relevé invalide : champs illisibles")
    return body


def older(version: str | None, latest: str) -> bool:
    """Vrai si `version` (numéro d'un agent, « 5 ») est strictement plus ancienne que `latest` ; une version illisible ou absente est « plus ancienne »."""
    try:
        return int(str(version).strip()) < int(latest)
    except ValueError:
        return True


def version_of(kind: str) -> str:
    return LINUX_VERSION if kind == "linux" else VERSION


def script_sha256(name: str = PS_AGENT) -> str:
    """Empreinte du script d'agent tel que servi : l'agent la contrôle avant de remplacer son propre fichier."""
    return hashlib.sha256(script(name).encode("utf-8")).hexdigest()


def _public(r: sqlite3.Row) -> dict:
    now = time.time()
    interval = r["interval"] or DEFAULT_INTERVAL
    if r["revoked"]:
        state = "révoqué"
    elif not r["last_seen"]:
        state = "en attente"
    elif now - r["last_seen"] <= FRESH_MULT * interval:
        state = "actif"
    else:
        state = "silencieux"
    kind = r["kind"] or "windows"
    return {"auto_update": bool(r["auto_update"]), "update_requested": bool(r["update_requested"]), "latest_version": version_of(kind),
            "kind": kind, "outdated": bool(r["version"]) and older(r["version"], version_of(kind)),
            "id": r["id"], "ip": r["ip"], "name": r["name"], "hint": r["hint"], "created": r["created"],
            "created_by": r["created_by"], "revoked": r["revoked"], "last_seen": r["last_seen"], "last_ip": r["last_ip"],
            "interval": interval, "version": r["version"], "os": r["os_name"], "state": state,
            "hostname": None if r["hostname"] == LEGACY_HOST else r["hostname"], "host_pending": r["host_pending"]}


def _h(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def script(name: str) -> str:
    """agent.ps1 (relevé de health.WIN_PS inclus : une seule source pour SSH et agent) ou install.ps1, tels que servis.
    ASCII seulement : Windows PowerShell 5.1 lit un script sans BOM en ANSI."""
    if name == "dns-scan.py":
        import inspect
        from connectors import adguard
        head, _, tail = (SCRIPTS / name).read_text(encoding="utf-8").partition("\n\ndef rec(")
        return head + "\n\n" + "\n\n".join(inspect.getsource(f) for f in (adguard._scalar, adguard.normalize, adguard.parse_yaml)) + "\n\ndef rec(" + tail
    if name == "backup-scan.py":
        from msv.backups import backups
        return backups.SCAN_HEAD + backups.AGENT
    text = (SCRIPTS / name).read_text(encoding="utf-8")
    if name == "install.sh":
        from msv.remote import npmapi
        from msv.remote.pve_ssh import PVE_CMD
        return text.replace("__NPM_SCRIPT_URL__", npmapi.SCRIPT_URL).replace("__NPM_SCRIPT_SHA256__", npmapi.SCRIPT_SHA256).replace("__PVE_CMD__", PVE_CMD)
    if name == PS_AGENT:
        from msv.collect import health
        text = text.replace("#__COLLECT__", health.WIN_PS.strip()).replace("__VERSION__", VERSION)
    elif name == "agent.py":   # the Linux agent runs the commands the SSH collection runs: one list, here
        from msv.collect import health
        from msv.remote import npmapi
        text = (text.replace("__VERSION__", LINUX_VERSION).replace("__COMMANDS__", json.dumps(health.LINUX_AGENT_COMMANDS + inventory_commands()))
                .replace("__SMART_LIST__", json.dumps(health.SMART_LIST_CMD)).replace("__SMART_FMT__", json.dumps(health.smart_cmd("{target}")))
                .replace("__CACHED__", json.dumps({**health.LINUX_AGENT_CACHE, **inventory_cache()})).replace("__SMART_CACHE__", str(health.SMART_CACHE))
                .replace("__NPM_LISTS__", json.dumps([opt for _, opt in npmapi.LISTS.values()])))
    return text


def clean_url(url: str) -> str:
    """Adresse de MyServices pour l'agent : http(s)://hôte[:port], sans chemin. AgentError sinon."""
    url = (url or "").strip().rstrip("/")
    if not re.fullmatch(r"https?://[A-Za-z0-9.-]+(:\d{1,5})?", url) and not re.fullmatch(r"https?://\[[0-9A-Fa-f:]+\](:\d{1,5})?", url):
        raise AgentError("adresse de MyServices : http(s)://hôte[:port], sans chemin")
    return url


def install_command(base_url: str, token: str, kind: str = "windows") -> str:
    """Commande à coller sur la machine : PowerShell administrateur (Windows) ou terminal (Linux, sudo)."""
    if kind == "linux":
        return (f"export MSV_URL='{base_url}'\nexport MSV_TOKEN='{token}'\n"
                'curl -fsSL "$MSV_URL/agent/install.sh" | sudo env MSV_URL="$MSV_URL" MSV_TOKEN="$MSV_TOKEN" bash')
    return ("Set-ExecutionPolicy Bypass -Scope Process -Force\n"
            f"$env:MSV_URL = '{base_url}'\n$env:MSV_TOKEN = '{token}'\n"
            'iex (iwr "$env:MSV_URL/agent/install.ps1" -UseBasicParsing).Content')
