"""Backup folder on another box, read-only: FTP / FTPS (a Freebox, a NAS, any FTP server) or a Samba share (SMB).

The same shape as the SSH agent of backups.py comes out of `scan()` (exists, count, size, newest files), so a followed
folder is judged exactly like a local one: age of the newest file, copy kept up to date, and so on. Nothing is written
or deleted on the remote side: listing and metadata only.

FTP / FTPS use the standard library (MLSD, or LIST when the server has no MLSD). Samba goes through the `smbclient` program
(package smbclient of the image); its password travels in the environment (PASSWD), never on a command line.
"""
from __future__ import annotations

import calendar
import fnmatch
import re
import shutil
import ssl
import subprocess
import time

from connectors.base import Connector, ConnectorError, Field, Result

PROTOCOLS = ("ftp", "ftps", "smb")
DEFAULT_PORT = {"ftp": 21, "ftps": 21, "smb": 445}
LIST_TIMEOUT = 20      # seconds, per network call
SCAN_BUDGET = 90       # seconds for a whole folder walk
SCAN_MAX = 5000        # entries read at most in one folder (the newest 60 files are kept)
KEEP = 60              # files kept per folder, newest first (as the SSH agent does)
MONTHS = {m: i for i, m in enumerate(("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)}
LIST_RX = re.compile(r"^([\-dl])\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3})\s+(\d+)\s+(\d{4}|\d\d:\d\d)\s+(.+)$")
SMB_RX = re.compile(r"^\s{2}(.+?)\s+([A-Za-z]*)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s*$")
HOST_RX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")


def check_path(path: str) -> str:
    """A folder path inside the remote share: absolute, no `..`, none of the characters smbclient or a shell would read as syntax."""
    p = "/" + str(path or "").strip().strip("/")
    if ".." in p.split("/") or len(p) > 300 or any(c in p for c in '"\\;\n\r\0`$'):
        raise ConnectorError("chemin invalide")
    return p


def _list_time(month: str, day: str, year_or_time: str, now: float) -> int:
    """mtime of a Unix LIST line (« Oct 10 12:34 » = this year, or last year if that would be in the future; « Oct 10 2025 »)."""
    mon = MONTHS.get(month, 1)
    if ":" in year_or_time:
        hh, mm = (int(x) for x in year_or_time.split(":"))
        year = time.gmtime(now).tm_year
        t = calendar.timegm((year, mon, int(day), hh, mm, 0))
        return t if t <= now + 86400 else calendar.timegm((year - 1, mon, int(day), hh, mm, 0))
    return calendar.timegm((int(year_or_time), mon, int(day), 0, 0, 0))


def parse_list_line(line: str, now: float) -> dict | None:
    """One line of a Unix-style LIST answer -> {name, is_dir, size, mtime}; None for anything else (« total 12 », DOS style…)."""
    m = LIST_RX.match(line.rstrip("\r\n"))
    if not m or m.group(6) in (".", ".."):
        return None
    kind, size, month, day, yt, name = m.groups()
    if kind == "l":
        name = name.split(" -> ")[0]
    return {"name": name, "is_dir": kind == "d", "size": int(size), "mtime": _list_time(month, day, yt, now)}


def parse_smb_line(line: str) -> dict | None:
    """One line of smbclient's `ls` -> {name, is_dir, size, mtime}; None for « . », « .. », the footer and noise."""
    m = SMB_RX.match(line)
    if not m or m.group(1) in (".", ".."):
        return None
    name, attrs, size, when = m.groups()
    try:
        mtime = int(time.mktime(time.strptime(re.sub(r"\s+", " ", when), "%a %b %d %H:%M:%S %Y")))
    except ValueError:
        mtime = 0
    return {"name": name, "is_dir": "D" in attrs, "size": int(size), "mtime": mtime}


class RemoteFolder(Connector):
    type = "backup-folder"
    label = "Dossier distant (FTP, FTPS, Samba)"
    kinds = ("backups",)
    guide = (
        "Un dossier de sauvegarde sur une Freebox, un NAS ou un serveur FTP / Samba : MyServices ne fait que lister les fichiers (nom, date, taille).",
        "Créer, si possible, un compte en lecture seule. Freebox : activer le serveur FTP (Paramètres de la Freebox → Partage de fichiers), le dossier est celui du disque.",
        "Samba : indiquer le nom du partage ; FTPS pour un FTP chiffré (certificat auto-signé accepté, réseau local).",
    )
    fields = (
        Field("protocol", "Protocole", "choice", required=True, default="ftp", choices=PROTOCOLS),
        Field("host", "Adresse (IP ou nom)", required=True, help="192.168.1.254 pour une Freebox"),
        Field("port", "Port", "number", help="vide : 21 (FTP, FTPS) ou 445 (Samba)"),
        Field("user", "Compte (lecture seule)", help="vide : accès anonyme"),
        Field("password", "Mot de passe", "password", secret=True, help="chiffré dans config.json, jamais renvoyé à la page"),
        Field("share", "Partage Samba", help="nom du partage, Samba seulement"),
    )

    @classmethod
    def validate(cls, conf: dict) -> list[str]:
        out = super().validate(conf)
        host, proto = str(conf.get("host") or ""), conf.get("protocol") or "ftp"
        if host and not HOST_RX.match(host):
            out.append("« host » : adresse ou nom sans espace ni caractère spécial")
        if proto not in PROTOCOLS:
            out.append("« protocol » : ftp, ftps ou smb")
        if proto == "smb" and not re.fullmatch(r"[\w .$-]{1,80}", str(conf.get("share") or "")):
            out.append("« share » : nom du partage Samba requis")
        return out

    # ───────────── Connection and listing ─────────────

    @property
    def proto(self) -> str:
        return self.conf.get("protocol") or "ftp"

    def _port(self) -> int:
        return int(self.conf.get("port") or DEFAULT_PORT[self.proto])

    def _ftp(self):
        import ftplib
        if self.proto == "ftps":
            ctx = ssl.create_default_context()
            ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE   # NOSONAR S4830 S5527: self-signed certificate of a LAN box
            ftp = ftplib.FTP_TLS(context=ctx)
        else:
            ftp = ftplib.FTP()   # NOSONAR S5332: plain FTP is what many boxes (Freebox…) offer; « ftps » is there for the others
        try:
            ftp.connect(self.conf["host"], self._port(), timeout=LIST_TIMEOUT)
            ftp.login(self.conf.get("user") or "anonymous", self.conf.get("password") or "")
            if self.proto == "ftps":
                ftp.prot_p()
        except (OSError, ftplib.Error, EOFError) as e:
            raise ConnectorError(f"FTP : {e}"[:200]) from None
        return ftp

    def _list_ftp(self, ftp, path: str) -> list[dict]:
        import ftplib
        try:
            out = []
            for name, f in ftp.mlsd(path, facts=["type", "size", "modify"]):
                kind = f.get("type", "")
                if name in (".", "..") or kind in ("cdir", "pdir"):
                    continue
                mod = f.get("modify", "")[:14]
                mtime = calendar.timegm(time.strptime(mod, "%Y%m%d%H%M%S")) if len(mod) == 14 else 0
                out.append({"name": name, "is_dir": kind == "dir", "size": int(f.get("size") or 0), "mtime": mtime})
            return out
        except ftplib.error_perm:   # no MLSD on this server: the Unix-style LIST is read instead
            pass
        except (OSError, ftplib.Error, ValueError, EOFError) as e:
            raise ConnectorError(f"FTP : {e}"[:200]) from None
        lines: list[str] = []
        try:
            ftp.retrlines("LIST " + path if path != "/" else "LIST", lines.append)
        except (OSError, ftplib.Error, EOFError) as e:
            raise ConnectorError(f"FTP : {e}"[:200]) from None
        now = time.time()
        return [e for e in (parse_list_line(l, now) for l in lines) if e]

    def _list_smb(self, path: str) -> list[dict]:
        if not shutil.which("smbclient"):
            raise ConnectorError("smbclient absent de cette installation (paquet smbclient)")
        cmd = ["smbclient", f"//{self.conf['host']}/{self.conf['share']}", "-p", str(self._port()), "-t", str(LIST_TIMEOUT),
               *(["-U", self.conf["user"]] if self.conf.get("user") else ["-N"]), "-c", (f'cd "{path}"; ' if path != "/" else "") + "ls"]
        env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", **({"PASSWD": self.conf["password"]} if self.conf.get("password") else {})}
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=LIST_TIMEOUT * 3, env=env)   # NOSONAR S4721: argument list, no shell; host / share / path checked
        except subprocess.TimeoutExpired:
            raise ConnectorError("Samba : délai dépassé") from None
        text = r.stdout + r.stderr
        status = re.search(r"NT_STATUS_[A-Z_]+", text)
        if r.returncode != 0 or status:
            raise ConnectorError("Samba : " + (status.group(0) if status else (text.strip().splitlines() or ["échec"])[-1])[:150])
        return [e for e in (parse_smb_line(l) for l in r.stdout.splitlines()) if e]

    def list_dir(self, path: str = "/") -> list[dict]:
        """Entries of one folder: [{name, is_dir, size, mtime}]. Read-only; one connection per call."""
        path = check_path(path)
        if self.proto == "smb":
            return self._list_smb(path)
        ftp = self._ftp()
        try:
            return self._list_ftp(ftp, path)
        finally:
            try:
                ftp.quit()
            except Exception:   # NOSONAR S5754: the link may be gone already; nothing more to do
                ftp.close()

    def scan(self, path: str, depth: int = 1, pattern: str = "*", exclude: list[str] | None = None) -> dict:
        """The shape of the SSH agent for one folder: {exists, count, size, files: newest first}. `depth` levels of sub-folders."""
        path = check_path(path)
        try:
            self.list_dir(path)
        except ConnectorError as e:
            if re.search(r"550|NT_STATUS_OBJECT_(NAME|PATH)_NOT_FOUND|NT_STATUS_NO_SUCH_FILE|not found|No such", str(e), re.I):
                return {"exists": False}
            raise
        files, todo, seen, t0 = [], [(path, "", 1)], 0, time.time()
        while todo and seen < SCAN_MAX and time.time() - t0 < SCAN_BUDGET:
            cur, rel, level = todo.pop(0)
            for e in self.list_dir(cur):
                seen += 1
                if e["name"].startswith("."):
                    continue
                if e["is_dir"]:
                    if level < depth:
                        todo.append((cur.rstrip("/") + "/" + e["name"], rel + e["name"] + "/", level + 1))
                elif fnmatch.fnmatch(e["name"], pattern) and not any(fnmatch.fnmatch(e["name"], x) for x in exclude or []):
                    files.append({"name": rel + e["name"], "mtime": e["mtime"], "size": e["size"]})
        files.sort(key=lambda f: -f["mtime"])
        return {"exists": True, "count": len(files), "size": sum(f["size"] for f in files), "files": files[:KEEP]}

    # ───────────── Connector contract ─────────────

    def collect(self) -> dict:
        """What the box answers at its root: proves the account works. The followed folders are read by backups.py (scan)."""
        names = sorted(e["name"] for e in self.list_dir("/"))
        return {"user": self.proto.upper(), "locs": {}, "disks": [], "crons": [], "cron_root": None, "root": names}

    def test(self) -> Result:
        try:
            n = len(self.list_dir("/"))
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, f"connecté : {n} élément(s) à la racine")
