"""Web-Check (lissy93/web-check) : contrôles légers des sites publics, par l'instance de l'utilisateur.

API sans compte : GET /api/<contrôle>?url=<site> (server.js, version 2.3.3) ; version : GET /healthz. Contrôles retenus, légers
et sans scan : ssl (certificat, chaîne), hsts, http-security (en-têtes), security-txt. Jamais
« ports » ni « trace-route » (scans). Chaque site est contrôlé au plus une fois par jour (cache tenu
par l'appelant), quelques sites par passage pour étaler la charge.
"""
from __future__ import annotations

import urllib.parse
from datetime import datetime, timezone

from connectors.base import Connector, ConnectorError, Field, Result

CHECKS = ("ssl", "hsts", "http-security", "security-txt")
HEADERS = ("strictTransportPolicy", "contentSecurityPolicy", "xContentTypeOptions", "xFrameOptions",
           "referrerPolicy", "permissionsPolicy")


def _cert_days(valid_to: str | None) -> int | None:
    """« Dec 23 09:55:24 2026 GMT » (format de Node) -> jours restants."""
    try:
        end = datetime.strptime(str(valid_to), "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return (end - datetime.now(timezone.utc)).days


def summarize(raw: dict) -> dict:
    """Réponses des contrôles -> résumé stable (lecture tolérante : contrôle illisible = None)."""
    ssl, hsts, sec, txt = (raw.get(c) if isinstance(raw.get(c), dict) else {} for c in CHECKS)
    out = {
        "cert_days": _cert_days(ssl.get("valid_to")) if not ssl.get("error") else None,
        "cert_valid": ssl.get("isValid") if "isValid" in ssl else None,
        "hsts": hsts.get("hstsHeader") is not None if not hsts.get("error") and "hstsHeader" in hsts else None,
        "headers": {h: bool(sec[h]) for h in HEADERS if h in sec} or None if not sec.get("error") else None,
        "security_txt": txt.get("isPresent") if "isPresent" in txt else None,
        "errors": {c: str(raw[c].get("error"))[:120] for c in CHECKS if isinstance(raw.get(c), dict) and raw[c].get("error")},
    }
    hdr = out["headers"] or {}
    out["headers_ok"] = sum(hdr.values()) if hdr else None
    out["headers_total"] = len(hdr) if hdr else None
    return out


class WebCheck(Connector):
    type = "web-check"
    label = "Web-Check"
    kinds = ("services",)
    images = ("lissy93/web-check",)
    tested = ("2.3",)
    fields = (
        Field("url", "URL de Web-Check", "url", required=True, help="ex. http://192.168.1.10:3000"),
        Field("per_run", "Sites contrôlés par passage", "number", default=10,
              help="chaque site au plus une fois par jour ; étale la charge"),
    )
    setup_fields = ("url",)

    def check_site(self, domain: str) -> dict:
        site = "https://" + domain
        raw = {}
        for c in CHECKS:
            q = urllib.parse.urlencode({"url": site})
            try:
                raw[c] = self.ctx.http(f"{self.conf['url'].rstrip('/')}/api/{c}?{q}", timeout=45)
            except ConnectorError as e:
                raw[c] = {"error": str(e)}
        if all(isinstance(v, dict) and v.get("error") and "injoignable" in str(v["error"]) for v in raw.values()):
            raise ConnectorError(f"Web-Check injoignable ({raw['ssl']['error']})")
        return summarize(raw)

    def collect(self) -> dict:
        return {}  # le collecteur appelle check_site() site par site (cache d'un jour)

    def version(self) -> str | None:
        return (self.ctx.http(self.conf["url"].rstrip("/") + "/healthz", timeout=10) or {}).get("version")

    def test(self) -> Result:
        try:
            v = self.version()
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, "joignable : contrôles légers des sites publics, une fois par jour", v)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c == 3000), None)
        return {"url": f"http://{ip}:{web}"} if web else None
