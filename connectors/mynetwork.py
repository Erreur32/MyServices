"""MynetworK : inventaire du réseau (scanner LAN, Freebox, UniFi), en lecture seule, par son API REST.

Jeton « API » en lecture seule (Administration → API tokens, préfixe mwk_api_) : GET uniquement, réseaux privés seulement, routes
sur liste blanche, aucun secret dans les réponses (docs/API-TOKENS.md de MynetworK). Un jeton MCP y est refusé (401).
Routes lues (enveloppe {"success": true, "result": …}) :
  GET /api/health                       sans jeton (test d'accès ; version de l'appli depuis MynetworK 0.10.67)
  GET /api/network-scan/history         inventaire du scanner, paginé (limit 1000) : ip, mac, hostname, vendor, status, pingLatency…
  GET /api/plugins/unifi/clients        clients UniFi (facultatif : 403 / 404 si UniFi n'est pas branché)
  GET /api/plugins/unifi/devices        bornes, switches, passerelles UniFi (facultatif)
  GET /api/plugins/unifi/system         UniFi Network (version, mise à jour), UniFi OS, passerelle : firmware, adresse LAN, santé (MynetworK 0.10.68+, facultatif)
  (GET /api/connection/summary donne aussi, depuis 0.10.68, latest_firmware et update_available de la Freebox)
  GET /api/lan/devices?compact=1        hôtes vus par la Freebox (facultatif ; compact : résumé léger, paramètre ignoré avant MynetworK 0.11.3)
  GET /api/connection/summary           ligne et santé de la Freebox, sans IP ni numéro de série (facultatif, MynetworK 0.10.66+)
  GET /api/network-scan/stats           scan counters: total, online, offline, unknown, last scan (MynetworK 0.11.2+; else counted from the inventory)
  GET /api/plugins/unifi/top-traffic    data volume per client, ?mode=live|today|alltime&limit=1..50 (MynetworK 0.11.2+; 403 / 404 = absent)
  GET /api/plugins/unifi/card-devices   switches, gateways and access points with their port tables, for the front-panel cards (MynetworK 0.11.1+;
                                        403 / 404 / 503 = absent, see card_devices)
  GET /api/search/ip-details/<ip>       fiche complète d'une adresse en un appel : scan, UniFi, bail Freebox, redirections de ports, ping en direct,
                                        réservation DHCP (prévu, pas encore ouvert aux jetons API : 403 / 404 = absent, voir ip_details)
Les routes facultatives qui répondent 403 ou 404 ne sont pas une erreur : MynetworK n'a simplement pas cette source.
"""
from __future__ import annotations

import ipaddress
import threading
import re

from connectors.base import Connector, ConnectorError, Field, Result
from connectors.status_kit import duration, fact

FREEBOX_HOT = (75, 85)   # °C : warn, bad

PAGE = 1000   # maximum accepté par MynetworK
MAX_ITEMS = 5000  # garde-fou : un réseau plus grand n'est pas lu en entier


# Keys never kept from a detail sheet, whatever MynetworK sends (its own filter should have dropped them: a second one here)
SENSITIVE = re.compile(r"key|pass|token|secret|auth|cookie|psk|serial", re.I)
MAX_DEPTH = 6
TRAFFIC_MODES = ("live", "today", "alltime")
UNIFI_TIMEOUT = 60   # s, MynetworK reads the UniFi controller for these routes: slow when the controller is busy
MAX_CARD_DEVICES = 200   # a UniFi site has dozens of devices at most


def scrub(obj: object, depth: int = 0) -> object:
    """Copy of a JSON value without the keys that look like a secret; too deep structures are cut."""
    if depth > MAX_DEPTH:
        return None
    if isinstance(obj, dict):
        return {k: scrub(v, depth + 1) for k, v in obj.items() if not SENSITIVE.search(str(k))}
    if isinstance(obj, list):
        return [scrub(v, depth + 1) for v in obj[:200]]
    return obj


def compact_sheet(raw: object) -> dict:
    """The detail sheet of an address reduced to what the page shows (MynetworK 0.10.74+): scanner reading, where UniFi sees it plugged,
    the Freebox lease and port redirections. Fields it does not have are left out."""
    if not isinstance(raw, dict):
        return {}
    sc, un = raw.get("scanner") or {}, raw.get("unifi") or {}
    cl, sw, ap, dev = (un.get(k) or {} for k in ("client", "switch", "ap", "device"))
    ports = sorted({p if isinstance(p, int) else p.get("port") for p in sc.get("openPorts") or []
                    if isinstance(p, int) or (isinstance(p, dict) and isinstance(p.get("port"), int))})
    wired = cl.get("is_wired")
    unifi = {"name": cl.get("name") or dev.get("name"), "wired": wired, "wireless": cl.get("is_wireless"),
             "switch_name": sw.get("name"), "switch_ip": sw.get("ip"), "switch_model": sw.get("model"), "switch_port": cl.get("sw_port") if wired else None,
             "ap_name": (ap.get("name") or cl.get("ap_name")) if wired is False else None, "ap_model": ap.get("model") if wired is False else None}
    fb = raw.get("freebox") if isinstance(raw.get("freebox"), dict) else {}
    out = {"scan": {"status": sc.get("status"), "ping_ms": sc.get("pingLatency"), "ports": ports, "ports_at": sc.get("lastPortScan")} if sc else None,
           "unifi": {k: v for k, v in unifi.items() if v not in (None, "")} or None,
           "freebox": {"dhcp": fb.get("dhcp"), "forwards": fb.get("portForwarding"), "name": fb.get("name"), "active": fb.get("active"), "type": fb.get("type")}
           if fb.get("dhcp") or fb.get("portForwarding") else None}
    out["freebox"] = {k: v for k, v in (out["freebox"] or {}).items() if v not in (None, "", [])} or None
    return {k: v for k, v in out.items() if v}


GATEWAY_KEYS = ("version", "upgradable", "upgrade_to_firmware", "lan_ip", "uptime", "cpu_pct", "mem_pct", "mem_total", "mem_used", "temperature")
SYSTEM_KEYS = ("version", "previous_version", "update_available", "update_downloaded", "name", "hostname", "uptime", "console_version")


def _unifi_system(got: object) -> dict | None:
    """UniFi system summary (MynetworK 0.10.68+): the fields named only, whatever else might come; None when the route is absent"""
    if not isinstance(got, dict):
        return None
    gw = got.get("gateway")
    return {**{k: got.get(k) for k in SYSTEM_KEYS}, "gateway": {k: gw.get(k) for k in GATEWAY_KEYS} if isinstance(gw, dict) else None}


def _result(got: object) -> object:
    if isinstance(got, dict) and "success" in got:
        if not got.get("success"):
            err = got.get("error") or {}
            raise ConnectorError(f"MynetworK : {err.get('message') or err.get('code') or 'refusé'}"[:200])
        return got.get("result")
    return got


def _when(v):
    """A date of MynetworK kept only when it is one (text): some versions send an empty object for firstSeen / lastSeen."""
    return v if isinstance(v, str) and v else None


def device(d: dict) -> dict:
    """Appareil du scanner réduit à ce que MyServices affiche (pas de champ libre : additionalInfo garde seulement les ports)."""
    info = d.get("additionalInfo") if isinstance(d.get("additionalInfo"), dict) else {}
    # openPorts: plain numbers (older MynetworK) or {"port": 445, "protocol": "tcp"} (current one)
    ports = sorted({p if isinstance(p, int) else p.get("port") for p in info.get("openPorts") or []
                    if isinstance(p, int) or (isinstance(p, dict) and isinstance(p.get("port"), int))})
    return {"ip": d.get("ip"), "mac": (d.get("mac") or None), "hostname": d.get("hostname") or None, "vendor": d.get("vendor") or None,
            "status": d.get("status") or "unknown", "ping_ms": d.get("pingLatency"), "first_seen": _when(d.get("firstSeen")),
            "last_seen": _when(d.get("lastSeen")), "ports": ports, "ports_at": _when(info.get("lastPortScan"))}


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

    def _get(self, path: str, params: dict | None = None, optional: bool = False, timeout: float | None = None):
        url = self.conf["url"].rstrip("/") + path + ("?" + "&".join(f"{k}={v}" for k, v in params.items()) if params else "")
        try:
            got = self.ctx.http(url, headers={"Authorization": f"Bearer {self.conf['token']}"},
                                verify_tls=self.conf.get("verify_tls", True) is not False, timeout=timeout)
        except ConnectorError as e:
            if str(e).startswith("HTTP 401"):
                raise ConnectorError("jeton refusé (jeton API mwk_api_… en lecture seule ?)") from None
            if optional and str(e)[:8] in ("HTTP 403", "HTTP 404", "HTTP 503"):   # 503 UNIFI_UNAVAILABLE: plugin not plugged in
                return None
            raise
        return _result(got)

    def scan_stats(self) -> dict | None:
        """The scan counters MynetworK gives (0.11.2+): {total, online, offline, unknown, last_scan}; None while the route is absent."""
        got = self._get("/api/network-scan/stats", optional=True)
        if not isinstance(got, dict):
            return None
        pick = lambda *names: next((got[n] for n in names if isinstance(got.get(n), (int, float)) and not isinstance(got.get(n), bool)), None)   # noqa: E731
        out = {"total": pick("total"), "online": pick("online"), "offline": pick("offline"), "unknown": pick("unknown"),
               "last_scan": next((got[n] for n in ("lastScan", "last_scan") if isinstance(got.get(n), (str, int, float))), None)}
        return out if out["total"] is not None else None

    def top_traffic(self, mode: str = "live", limit: int = 10) -> list[dict] | None:
        """Data volume per client (0.11.2+): the best `limit` clients over `mode` (live, today, alltime); None while the route is absent."""
        if mode not in TRAFFIC_MODES:
            return None
        got = self._get("/api/plugins/unifi/top-traffic", {"mode": mode, "limit": max(1, min(50, int(limit)))}, optional=True)
        items = None
        if isinstance(got, list):
            items = got
        elif isinstance(got, dict):
            items = got.get("items") or got.get("clients") or got.get("result")
        return [scrub(i) for i in items[:50] if isinstance(i, dict)] if isinstance(items, list) else None

    def card_devices(self) -> list[dict] | None:
        """UniFi switches, gateways and access points with the per-port data of the front-panel cards (MynetworK 0.11.1+), secrets removed
        on our side too; None while the route is absent (older MynetworK, UniFi not plugged in or not open to API tokens)."""
        got = self._get("/api/plugins/unifi/card-devices", optional=True)
        if not isinstance(got, list):
            return None
        return [scrub(d) for d in got[:MAX_CARD_DEVICES] if isinstance(d, dict) and d.get("mac")]

    def ip_details(self, ip: str) -> dict | None:
        """Detail sheet of one address (scan, UniFi, Freebox lease, port redirections, live ping, DHCP reservation) in one call, secrets
        removed; None while the route is not open to API tokens (403 / 404 / 503) or when `ip` is not an address."""
        try:
            addr = str(ipaddress.ip_address(ip))
        except ValueError:
            return None
        got = self._get(f"/api/search/ip-details/{addr}", optional=True)
        return scrub(got) if isinstance(got, dict) else None

    def version(self) -> str | None:
        """App version from /api/health (public, no token), given since MynetworK 0.10.67; None before."""
        try:
            got = self.ctx.http(self.conf["url"].rstrip("/") + "/api/health", verify_tls=self.conf.get("verify_tls", True) is not False, timeout=10)
        except ConnectorError:
            return None
        v = got.get("version") if isinstance(got, dict) else None
        return str(v).lstrip("v") if v else None

    def scan(self) -> list[dict]:
        """The scanner inventory alone (one paginated call): what the live tier reads often, without UniFi or the Freebox."""
        devices, offset, total = [], 0, None
        while total is None or (offset < total and offset < MAX_ITEMS):
            page = self._get("/api/network-scan/history", {"limit": PAGE, "offset": offset, "sortBy": "ip", "sortOrder": "asc"})
            if not isinstance(page, dict) or not isinstance(page.get("items"), list):
                raise ConnectorError("réponse sans inventaire (URL de MynetworK ?)")
            devices += [device(d) for d in page["items"] if isinstance(d, dict) and d.get("ip")]
            total = page.get("total") if isinstance(page.get("total"), int) else len(devices)
            if not page["items"]:
                break
            offset += PAGE
        return devices

    def _unifi_parts(self) -> tuple[object, object, object, str]:
        """(clients, devices, system, error): the three UniFi routes read at the same time, each with a long delay (MynetworK asks the UniFi
        controller behind them, which can take half a minute). A route that fails leaves its part empty and the first reason in `error`."""
        routes = {"clients": ("/api/plugins/unifi/clients", {"limit": PAGE}), "devices": ("/api/plugins/unifi/devices", {"limit": PAGE}),
                  "system": ("/api/plugins/unifi/system", None)}
        got: dict[str, object] = {}
        errors: list[str] = []

        def read(name: str) -> None:
            path, params = routes[name]
            try:
                got[name] = self._get(path, params, optional=True, timeout=UNIFI_TIMEOUT)
            except ConnectorError as e:
                errors.append(str(e))

        threads = [threading.Thread(target=read, args=(n,), daemon=True) for n in routes]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        return got.get("clients"), got.get("devices"), got.get("system"), (errors[0] if errors else "")

    def collect(self) -> dict:
        devices = self.scan()
        out: dict = {"devices": devices, "online": sum(1 for d in devices if d["status"] == "online"), "unifi": None, "unifi_error": ""}
        clients, gear, system, out["unifi_error"] = self._unifi_parts()
        if isinstance(clients, list) or isinstance(gear, list):
            out["unifi"] = {
                "clients": [{k: c.get(k) for k in ("name", "mac", "ip", "wired", "essid", "signal_dbm", "ap_mac", "switch_mac", "switch_port", "switch_name", "switch_ip")}
                            for c in clients or [] if isinstance(c, dict)],
                # upgradable / upgrade_to_firmware: kept when MynetworK passes them on from UniFi (the update waiting for a device)
                "devices": [{k: d.get(k) for k in ("name", "model", "type", "mac", "ip", "state", "version", "clients", "uptime", "cpu_pct", "mem_pct",
                                                   "upgradable", "upgrade_to_firmware")}
                            for d in gear or [] if isinstance(d, dict)]}
            out["unifi"]["system"] = _unifi_system(system)
        out["freebox"] = self._freebox()
        return out

    def _freebox(self) -> dict | None:
        """Freebox relayée par MynetworK : None si MynetworK n'a pas de Freebox (ou une version sans ces routes)."""
        def opt(path, params=None):
            try:
                return self._get(path, params, optional=True)
            except ConnectorError:   # Freebox non appairée : enveloppe {"success": false} de la Freebox
                return None
        summary, hosts = opt("/api/connection/summary"), opt("/api/lan/devices", {"compact": 1})   # only counted here: the compact form is enough
        if not isinstance(summary, dict) and not isinstance(hosts, list):
            return None
        out = {"connection": None, "system": None, "hosts": None, "hosts_active": None}
        if isinstance(summary, dict):
            out["connection"], out["system"] = summary.get("connection"), summary.get("system")
            # MynetworK 0.10.69+: storage, ftth, wifi, vms, vm_system and the permissions the paired app lacks; 0.10.72+: dhcp and firmware_update (already allowlisted over there)
            out.update({k: summary[k] for k in ("storage", "ftth", "wifi", "vms", "vm_system", "missing_rights", "dhcp", "firmware_update") if k in summary})
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
                      (f", UniFi : {len(u['clients'])} client(s)" if u else "") + (f" (UniFi indisponible : {data['unifi_error']})" if data.get("unifi_error") and not u else "") +
                      (", Freebox : " + ("ligne " + str(fb["connection"].get("state")) if fb.get("connection") else f"{fb['hosts']} hôte(s)") if fb else ""))

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c in (7505, 3000)), None)
        return {"url": f"http://{ip}:{web}"} if web else None


def _rate(bits) -> str:
    return f"{bits / 1e9:.1f} Gb/s".replace(".", ",") if bits >= 1e9 else f"{bits / 1e6:.0f} Mb/s"


def _full_tone(pct: float) -> str:
    """Tone of a storage filling: bad from 90 %, warn from 80 %."""
    if pct >= 90:
        return "bad"
    return "warn" if pct >= 80 else "ok"


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
    if s.get("update_available"):   # MynetworK 0.10.68+: the firmware the Freebox offers
        facts.append(fact("Mise à jour", f"→ {s['latest_firmware']}" if s.get("latest_firmware") else "disponible", "warn"))
    if s.get("uptime") is not None:
        facts.append(fact("Allumée depuis", duration(s["uptime"])))
    fans = [x for x in s.get("fans") or [] if isinstance(x, dict) and isinstance(x.get("value"), (int, float))]
    if fans:
        facts.append(fact("Ventilateur", " / ".join(f"{x['value']:.0f} tr/min" for x in fans)))
    if s.get("disk_status") and s["disk_status"] != "active":
        facts.append(fact("Disque interne", s["disk_status"], "warn"))
    parts = [p for p in (fb.get("storage") or {}).get("partitions") or [] if isinstance(p, dict) and isinstance(p.get("used_pct"), (int, float))]
    if parts:
        full = max(parts, key=lambda p: p["used_pct"])
        facts.append(fact("Stockage", f"{full['used_pct']:.0f} % ({full.get('label') or 'disque'})", _full_tone(full["used_pct"])))
    ftth = fb.get("ftth") or {}
    if ftth.get("sfp_pwr_rx") is not None:
        facts.append(fact("Fibre", f"{ftth['sfp_pwr_rx']:.1f} dBm reçus", "ok" if ftth.get("sfp_has_signal") is not False else "bad"))
    wifi = fb.get("wifi") or {}
    if wifi.get("aps"):
        facts.append(fact("Wi-Fi", f"{len(wifi['aps'])} borne(s)" + (f", {wifi['stations_count']} appareil(s)" if wifi.get("stations_count") is not None else "")))
    vms = [v for v in fb.get("vms") or [] if isinstance(v, dict)]
    if vms:
        facts.append(fact("Machines virtuelles", f"{sum(v.get('status') == 'running' for v in vms)} en marche sur {len(vms)}"))
    if fb.get("hosts") is not None:
        # the Freebox keeps every device it ever saw: behind another router (UniFi…) only that router is active, the rest is history
        facts.append(fact("Appareils actifs", f"{fb['hosts_active']}" + (f" (+{fb['hosts'] - fb['hosts_active']} dans l'historique)" if fb["hosts"] > fb["hosts_active"] else "")))
    return {"connector": "freebox", "name": row.get("name") or "", "label": f"{s.get('model') or 'Freebox'} (via MynetworK)",
            "ok": bool(row.get("ok")), "stale": row.get("stale"), "message": row.get("message"), "version": s.get("firmware"),
            "url": row.get("url"), "facts": facts[:11], "problems": problems}  # NOSONAR S6466: a slice never raises IndexError
