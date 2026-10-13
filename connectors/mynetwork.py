"""MynetworK : inventaire du réseau (scanner LAN, Freebox, UniFi), en lecture seule, par son API REST.

Jeton « API » en lecture seule (Administration → API tokens, préfixe mwk_api_) : GET uniquement, réseaux privés seulement, routes
sur liste blanche, aucun secret dans les réponses (docs/API-TOKENS.md de MynetworK). Un jeton MCP y est refusé (401).
Routes lues (enveloppe {"success": true, "result": …}) :
  GET /api/health                       sans jeton (test d'accès ; version de l'appli depuis MynetworK 0.10.67)
  GET /api/network-scan/history         inventaire du scanner, paginé (limit 1000) : ip, mac, hostname, vendor, status, pingLatency…
  GET /api/plugins/unifi/clients        clients UniFi (facultatif : 403 / 404 si UniFi n'est pas branché)
  GET /api/plugins/unifi/devices        bornes, switches, passerelles UniFi (facultatif)
  GET /api/lan/devices                  hôtes vus par la Freebox (facultatif)
  GET /api/connection/summary           ligne et santé de la Freebox, sans IP ni numéro de série (facultatif, MynetworK 0.10.66+)
Les routes facultatives qui répondent 403 ou 404 ne sont pas une erreur : MynetworK n'a simplement pas cette source.
"""
from __future__ import annotations

from connectors.base import Connector, ConnectorError, Field, Result
from connectors.status_kit import duration, fact

FREEBOX_HOT = (75, 85)   # °C : warn, bad

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
        """App version from /api/health (public, no token), given since MynetworK 0.10.67; None before."""
        try:
            got = self.ctx.http(self.conf["url"].rstrip("/") + "/api/health", verify_tls=self.conf.get("verify_tls", True) is not False, timeout=10)
        except ConnectorError:
            return None
        v = got.get("version") if isinstance(got, dict) else None
        return str(v).lstrip("v") if v else None

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
                # upgradable / upgrade_to_firmware: kept when MynetworK passes them on from UniFi (the update waiting for a device)
                "devices": [{k: d.get(k) for k in ("name", "model", "type", "mac", "ip", "state", "version", "clients", "uptime", "cpu_pct", "mem_pct",
                                                   "upgradable", "upgrade_to_firmware")}
                            for d in gear or [] if isinstance(d, dict)]}
        out["freebox"] = self._freebox()
        return out

    def _freebox(self) -> dict | None:
        """Freebox relayée par MynetworK : None si MynetworK n'a pas de Freebox (ou une version sans ces routes)."""
        def opt(path):
            try:
                return self._get(path, optional=True)
            except ConnectorError:   # Freebox non appairée : enveloppe {"success": false} de la Freebox
                return None
        summary, hosts = opt("/api/connection/summary"), opt("/api/lan/devices")
        if not isinstance(summary, dict) and not isinstance(hosts, list):
            return None
        out = {"connection": None, "system": None, "hosts": None, "hosts_active": None}
        if isinstance(summary, dict):
            out["connection"], out["system"] = summary.get("connection"), summary.get("system")
        if isinstance(hosts, list):
            out["hosts"] = len(hosts)
            out["hosts_active"] = sum(1 for h in hosts if isinstance(h, dict) and h.get("active"))
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
        u, fb = data["unifi"], data["freebox"]
        return Result(True, f"{len(data['devices'])} appareil(s), {data['online']} en ligne" +
                      (f", UniFi : {len(u['clients'])} client(s)" if u else "") +
                      (", Freebox : " + ("ligne " + str(fb["connection"].get("state")) if fb.get("connection") else f"{fb['hosts']} hôte(s)") if fb else ""))

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c in (7505, 3000)), None)
        return {"url": f"http://{ip}:{web}"} if web else None


def _rate(bits) -> str:
    return f"{bits / 1e9:.1f} Gb/s".replace(".", ",") if bits >= 1e9 else f"{bits / 1e6:.0f} Mb/s"


def freebox_status(row: dict) -> dict | None:
    """Carte « Service via API » de la Freebox lue par MynetworK (même forme que les connecteurs status), None sans Freebox."""
    fb = row.get("freebox")
    if not isinstance(fb, dict):
        return None
    c, s = fb.get("connection") or {}, fb.get("system") or {}
    facts, problems = [], []
    if c.get("state"):
        up = c["state"] == "up"
        facts.append(fact("Ligne", ("en ligne" if up else c["state"]) + (f" ({c['media'].upper()})" if c.get("media") else ""), "ok" if up else "bad"))
        if not up:
            problems.append(f"ligne Internet : {c['state']}")
    if c.get("bandwidth_down"):
        facts.append(fact("Débit max", _rate(c["bandwidth_down"]) + (f" / {_rate(c['bandwidth_up'])}" if c.get("bandwidth_up") else "")))
    if c.get("rate_down") is not None:
        facts.append(fact("Débit actuel", _rate(8 * c["rate_down"]) + (f" / {_rate(8 * (c.get('rate_up') or 0))}" if c.get("rate_up") is not None else "")))
    temps = [x for x in s.get("sensors") or [] if isinstance(x, dict) and isinstance(x.get("value"), (int, float))]
    if temps:
        hot = max(temps, key=lambda x: x["value"])
        tone = "bad" if hot["value"] >= FREEBOX_HOT[1] else "warn" if hot["value"] >= FREEBOX_HOT[0] else "ok"
        facts.append(fact("Température max", f"{hot['value']:.0f} °C ({hot.get('name') or hot.get('id')})", tone))
        if tone != "ok":
            problems.append(f"Freebox chaude : {hot.get('name') or hot.get('id')} à {hot['value']:.0f} °C")
    if s.get("uptime") is not None:
        facts.append(fact("Allumée depuis", duration(s["uptime"])))
    fans = [x for x in s.get("fans") or [] if isinstance(x, dict) and isinstance(x.get("value"), (int, float))]
    if fans:
        facts.append(fact("Ventilateur", " / ".join(f"{x['value']:.0f} tr/min" for x in fans)))
    if s.get("disk_status") and s["disk_status"] != "active":
        facts.append(fact("Disque interne", s["disk_status"], "warn"))
    if fb.get("hosts") is not None:
        # the Freebox keeps every device it ever saw: behind another router (UniFi…) only that router is active, the rest is history
        facts.append(fact("Appareils actifs", f"{fb['hosts_active']}" + (f" (+{fb['hosts'] - fb['hosts_active']} dans l'historique)" if fb["hosts"] > fb["hosts_active"] else "")))
    return {"connector": "freebox", "name": row.get("name") or "", "label": f"{s.get('model') or 'Freebox'} (via MynetworK)",
            "ok": bool(row.get("ok")), "stale": row.get("stale"), "message": row.get("message"), "version": s.get("firmware"),
            "url": row.get("url"), "facts": facts[:8], "problems": problems}  # NOSONAR S6466: a slice never raises IndexError
