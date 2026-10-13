"""Outils communs aux connecteurs « état d'un service » (kind `status`) : un service auto-hébergé lu par son API, dont on garde quelques chiffres
(« faits ») et la liste de ce qui ne va pas (« problèmes »). La page « Service via API » (onglet Santé) les affiche tels quels, sans écran par service.

collect() rend {"version": str | None, "facts": [fait, …], "problems": [texte, …]}, où un fait est {"label", "value", "tone"} (tone : ok, warn, bad
ou absent). Lecture seule, tolérante champ par champ : l'API de ces services bouge d'une version à l'autre, un champ absent est omis, jamais une erreur.
"""
from __future__ import annotations

import json
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import Connector, ConnectorError, Result

MAX_FACTS = 8
MAX_PROBLEMS = 12


def fact(label: str, value, tone: str | None = None) -> dict:
    return {"label": label, "value": str(value), **({"tone": tone} if tone else {})}


def size(n) -> str:
    """Octets -> « 1,5 To »."""
    if not isinstance(n, (int, float)) or n < 0:
        return "?"
    for unit in ("o", "Ko", "Mo", "Go", "To", "Po"):
        if n < 1024 or unit == "Po":
            return f"{n:.0f} {unit}" if unit == "o" else f"{n:.1f}".replace(".", ",") + f" {unit}"
        n /= 1024
    return "?"


def duration(sec) -> str:
    if not isinstance(sec, (int, float)) or sec < 0:
        return "?"
    d, h, m = int(sec) // 86400, int(sec) % 86400 // 3600, int(sec) % 3600 // 60
    return f"{d} j {h} h" if d else f"{h} h {m:02d}" if h else f"{m} min"


def num(v, default=None):
    """Nombre lu tolérant (int, float ou texte), sinon `default`."""
    try:
        return float(v) if not isinstance(v, bool) and v not in (None, "") else default
    except (TypeError, ValueError):
        return default


def host_port(ports: list, inner: int) -> int | None:
    """Host port published for a container port ([(host, container)]), for discover()."""
    return next((h for h, c in ports if c == inner), None)


def rows(v) -> list[dict]:
    """Liste d'objets, qu'elle soit nue ou rangée sous une clé courante (data, items, result, rows…)."""
    if isinstance(v, dict):
        for k in ("data", "items", "result", "results", "rows", "records", "nodes", "devices", "response"):
            if isinstance(v.get(k), list):
                v = v[k]
                break
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


class StatusConnector(Connector):
    """Base des connecteurs `status` : sous-classe = champs, `collect()`, et un `guide` ; `test()` en tire une ligne lisible."""
    kinds = ("status",)

    def base_url(self) -> str:
        url = str(self.conf.get("url", "")).strip().rstrip("/")
        if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
            raise ConnectorError("adresse : http://<IP>:<port> ou https://… attendu")
        return url

    def tls(self) -> bool:
        return self.conf.get("verify_tls", True) is not False

    def get(self, path: str, headers: dict | None = None, **kw):
        try:
            return self.ctx.http(self.base_url() + path, headers=headers, verify_tls=self.tls(), **kw)
        except ConnectorError as e:
            if str(e).startswith(("HTTP 401", "HTTP 403")):
                raise ConnectorError("accès refusé : clé, jeton ou compte à vérifier (droits de lecture)") from None
            raise

    def get_opt(self, path: str, headers: dict | None = None, **kw):
        """Like get(), but None when the route is missing or unreadable (feature absent, older version); a refused key still raises."""
        try:
            return self.get(path, headers, **kw)
        except ConnectorError as e:
            if str(e).startswith("accès refusé"):
                raise
            return None

    def test(self) -> Result:
        try:
            d = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        facts = " · ".join(f"{f['label']} {f['value']}" for f in d["facts"][:3])
        n = len(d["problems"])
        return Result(True, (facts or "lecture OK") + (f" · {n} point(s) à regarder" if n else ""), d.get("version"))

    @staticmethod
    def out(version, facts: list[dict], problems: list[str]) -> dict:
        return {"version": version or None, "facts": facts[:MAX_FACTS], "problems": [p for p in problems if p][:MAX_PROBLEMS]}


def raw_tcp(host: str, port: int, request: bytes, end: bytes, timeout: float = 5.0) -> str:
    """Échange texte sur une socket TCP (protocole NUT) : lit jusqu'à `end`. ConnectorError lisible."""
    try:
        with socket.create_connection((host, port), timeout=timeout) as s:
            s.settimeout(timeout)
            s.sendall(request)
            buf = b""
            while end not in buf and len(buf) < 200_000:
                chunk = s.recv(4096)
                if not chunk:
                    break
                buf += chunk
    except OSError as e:
        raise ConnectorError(f"injoignable ({e.__class__.__name__})") from None
    return buf.decode("utf-8", "replace")


def post_form(url: str, fields: dict, verify_tls: bool = True, timeout: float = 15.0):
    """POST application/x-www-form-urlencoded, réponse JSON (Synology DSM : les identifiants ne passent jamais dans l'URL)."""
    req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), headers={"User-Agent": "myservices", "Accept": "application/json"}, method="POST")
    ctx = None if verify_tls else ssl._create_unverified_context()  # NOSONAR S5527: opt-in per connector for a self-signed LAN certificate
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise ConnectorError(f"HTTP {e.code}") from None
    except (OSError, ValueError) as e:
        raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None
