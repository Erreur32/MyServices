"""Services declared by hand (services-meta.json « extra »): a name, an IP, a port and a scheme (http, https, or tcp for a port
without a web page). The collection probes them like any other service (myservices.py); here: list, add, edit, remove, try.
Read only on the network: a try is one TCP connection and, for http or https, one GET of the root page."""
import html
import ipaddress
import re
import socket
import ssl
import time
import urllib.error
import urllib.request

from msv.machines import setup

NAME_MAX = 80
SCHEMES = ("http", "https", "tcp")
TRY_TIMEOUT = 5
TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title>", re.I | re.S)


class ServiceError(Exception):
    """Readable refusal (invalid IP or port, duplicate, unknown service)."""


def _meta() -> dict:
    if not setup.META.exists():
        return {"machines": {}, "process_hosts": {}, "extra": []}
    import json
    return json.loads(setup.META.read_text(encoding="utf-8"))


def _check(name: str, ip: str, port, scheme: str) -> tuple[str, str, int, str]:
    name = (name or "").strip()
    if not name or len(name) > NAME_MAX:
        raise ServiceError(f"nom : 1 à {NAME_MAX} caractères")
    try:
        ip = str(ipaddress.ip_address(str(ip).strip()))
    except ValueError:
        raise ServiceError(f"adresse IP invalide : {ip or '?'}") from None
    try:
        port = int(port)
    except (TypeError, ValueError):
        raise ServiceError("port : un nombre de 1 à 65535") from None
    if not 1 <= port <= 65535:
        raise ServiceError("port : un nombre de 1 à 65535")
    if scheme not in SCHEMES:
        raise ServiceError("protocole : http, https ou tcp")
    return name, ip, port, scheme


def list_manual() -> list[dict]:
    return [dict(x) for x in _meta().get("extra", [])]


def add(name: str, ip: str, port, scheme: str = "http") -> dict:
    name, ip, port, scheme = _check(name, ip, port, scheme)
    meta = _meta()
    extra = meta.setdefault("extra", [])
    if any(x.get("ip") == ip and int(x.get("port", 0)) == port for x in extra):
        raise ServiceError(f"{ip}:{port} est déjà déclaré")
    item = {"name": name, "ip": ip, "port": port, "scheme": scheme}
    extra.append(item)
    setup.save(setup.META, meta)
    return item


def update(ip: str, port, name: str | None = None, scheme: str | None = None, new_port=None) -> dict:
    """Name, scheme or port of a declared service; the pair ip:port names it."""
    meta = _meta()
    extra = meta.setdefault("extra", [])
    cur = next((x for x in extra if x.get("ip") == ip and str(x.get("port")) == str(port)), None)
    if cur is None:
        raise ServiceError("service inconnu")
    name2, _, port2, scheme2 = _check(name if name is not None else cur["name"], ip, new_port if new_port is not None else cur["port"],
                                      scheme if scheme is not None else cur.get("scheme", "http"))
    if port2 != int(cur["port"]) and any(x is not cur and x.get("ip") == ip and int(x.get("port", 0)) == port2 for x in extra):
        raise ServiceError(f"{ip}:{port2} est déjà déclaré")
    cur.update(name=name2, port=port2, scheme=scheme2)
    setup.save(setup.META, meta)
    return dict(cur)


def remove(ip: str, port) -> None:
    meta = _meta()
    extra = meta.setdefault("extra", [])
    keep = [x for x in extra if not (x.get("ip") == ip and str(x.get("port")) == str(port))]
    if len(keep) == len(extra):
        raise ServiceError("service inconnu")
    meta["extra"] = keep
    setup.save(setup.META, meta)


def try_service(ip: str, port, scheme: str = "http") -> dict:
    """One TCP connection, then for http or https one GET of the root page: {up, ms, web, title, code, error}."""
    _, ip, port, scheme = _check("x", ip, port, scheme)
    t = time.monotonic()
    try:
        socket.create_connection((ip, port), timeout=TRY_TIMEOUT).close()
    except OSError as e:
        return {"up": False, "ms": None, "web": None, "title": None, "code": None, "error": type(e).__name__}
    out = {"up": True, "ms": round((time.monotonic() - t) * 1000), "web": None, "title": None, "code": None, "error": None}
    if scheme == "tcp":
        return out
    req = urllib.request.Request(f"{scheme}://{ip}:{port}/", headers={"User-Agent": "myservices-probe", "Accept": "text/html,*/*"})
    ctx = ssl.create_default_context()
    ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE   # NOSONAR S4830: a LAN service with its own certificate, read only; the page only says whether it answers
    try:
        with urllib.request.urlopen(req, timeout=TRY_TIMEOUT, context=ctx) as r:   # NOSONAR S5144: the address is the admin's own input, by design
            code, body = r.status, r.read(65536)
    except urllib.error.HTTPError as e:
        code, body = e.code, e.read(65536) if e.fp else b""
    except (OSError, ValueError) as e:   # URLError is an OSError
        out["error"] = type(getattr(e, "reason", e)).__name__
        return out
    m = TITLE_RE.search(body)
    out.update(code=code, web="ui" if m or b"<html" in body[:4096].lower() else "api",
               title=re.sub(r"\s+", " ", html.unescape(m.group(1).decode("utf-8", "replace"))).strip()[:120] if m else None)
    return out
