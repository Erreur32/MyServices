"""MynetworK : inventaire du réseau (scanner LAN, Freebox, UniFi), en lecture seule, par son API REST.

Jeton « API » en lecture seule (Administration → API tokens, préfixe mwk_api_) : GET uniquement, réseaux privés seulement, routes
sur liste blanche, aucun secret dans les réponses (docs/API-TOKENS.md de MynetworK). Un jeton MCP y est refusé (401).
Routes lues (enveloppe {"success": true, "result": …}) :
  GET /api/health                       sans jeton (test d'accès)
  GET /api/network-scan/history         inventaire du scanner, paginé (limit 1000) : ip, mac, hostname, vendor, status, pingLatency…
  GET /api/plugins/unifi/clients        clients UniFi (facultatif : 403 / 404 si UniFi n'est pas branché)
  GET /api/plugins/unifi/devices        bornes, switches, passerelles UniFi (facultatif)
Les routes facultatives qui répondent 403 ou 404 ne sont pas une erreur : MynetworK n'a simplement pas cette source.
"""
from __future__ import annotations

from connectors.base import Connector, ConnectorError, Field, Result

PAGE = 1000   # maximum accepté par MynetworK
MAX_ITEMS = 5000  # garde-fou : un réseau plus grand n'est pas lu en entier


def _result(got: object) -> object:
    if isinstance(got, dict) and "success" in got:
        if not got.get("success"):
            err = got.get("error") or {}
            raise ConnectorError(f"MynetworK : {err.get('message') or err.get('code') or 'refusé'}"[:200])
        return got.get("result")
    return got


def device(d: dict) -> dict:
    """Appareil du scanner réduit à ce que MyServices affiche (pas de champ libre : additionalInfo garde seulement les ports)."""
    info = d.get("additionalInfo") if isinstance(d.get("additionalInfo"), dict) else {}
    ports = [p for p in info.get("openPorts") or [] if isinstance(p, int)]
    return {"ip": d.get("ip"), "mac": (d.get("mac") or None), "hostname": d.get("hostname") or None, "vendor": d.get("vendor") or None,
            "status": d.get("status") or "unknown", "ping_ms": d.get("pingLatency"), "first_seen": d.get("firstSeen"),
            "last_seen": d.get("lastSeen"), "ports": ports}


class MynetworK(Connector):
    type = "mynetwork"
    label = "MynetworK"
    kinds = ("network",)
    images = ("ghcr.io/erreur32/mynetwork", "erreur32/mynetwork")
    tested = ("0.10",)
    fields = (
        Field("url", "URL de MynetworK", "url", required=True, help="ex. http://192.168.1.10:7505"),
        Field("token", "Jeton API en lecture seule (mwk_api_…)", "password", required=True, secret=True,
              help="MynetworK → Administration → API tokens : nom « MyServices », validité au choix. Montré une seule fois."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True),
    )
    setup_fields = ("url", "token")
    guide = (
        "Dans MynetworK : Administration → API tokens → créer un jeton nommé « MyServices » (lecture seule).",
        "Copier le jeton (mwk_api_…) tout de suite : il n'est montré qu'une fois.",
        "Un jeton MCP ne marche pas ici : il faut un jeton « API ».",
    )

    def _get(self, path: str, params: dict | None = None, optional: bool = False):
        url = self.conf["url"].rstrip("/") + path + ("?" + "&".join(f"{k}={v}" for k, v in params.items()) if params else "")
        try:
            got = self.ctx.http(url, headers={"Authorization": f"Bearer {self.conf['token']}"},
                                verify_tls=self.conf.get("verify_tls", True) is not False)
        except ConnectorError as e:
            if str(e).startswith("HTTP 401"):
                raise ConnectorError("jeton refusé (jeton API mwk_api_… en lecture seule ?)") from None
            if optional and str(e)[:8] in ("HTTP 403", "HTTP 404"):
                return None
            raise
        return _result(got)

    def version(self) -> str | None:
        return None  # /api/health ne donne que l'état

    def collect(self) -> dict:
        devices, offset, total = [], 0, None
        while total is None or (offset < total and offset < MAX_ITEMS):
            page = self._get("/api/network-scan/history", {"limit": PAGE, "offset": offset, "sortBy": "ip", "sortOrder": "asc"})
            if not isinstance(page, dict) or not isinstance(page.get("items"), list):
                raise ConnectorError("réponse sans inventaire (URL de MynetworK ?)")
            items = [device(d) for d in page["items"] if isinstance(d, dict) and d.get("ip")]
            devices += items
            total = page.get("total") if isinstance(page.get("total"), int) else len(devices)
            if not page["items"]:
                break
            offset += PAGE
        out: dict = {"devices": devices, "online": sum(1 for d in devices if d["status"] == "online"), "unifi": None}
        clients = self._get("/api/plugins/unifi/clients", {"limit": PAGE}, optional=True)
        gear = self._get("/api/plugins/unifi/devices", {"limit": PAGE}, optional=True)
        if isinstance(clients, list) or isinstance(gear, list):
            out["unifi"] = {
                "clients": [{k: c.get(k) for k in ("name", "mac", "ip", "wired", "essid", "signal_dbm", "ap_mac", "switch_mac", "switch_port")}
                            for c in clients or [] if isinstance(c, dict)],
                "devices": [{k: d.get(k) for k in ("name", "model", "type", "mac", "ip", "state", "version", "clients", "uptime")}
                            for d in gear or [] if isinstance(d, dict)]}
        return out

    def test(self) -> Result:
        try:
            self.ctx.http(self.conf["url"].rstrip("/") + "/api/health", verify_tls=self.conf.get("verify_tls", True) is not False)
        except ConnectorError as e:
            return Result(False, str(e))
        try:
            data = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        u = data["unifi"]
        return Result(True, f"{len(data['devices'])} appareil(s), {data['online']} en ligne" +
                      (f", UniFi : {len(u['clients'])} client(s)" if u else ""))

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c in (7505, 3000)), None)
        return {"url": f"http://{ip}:{web}"} if web else None
