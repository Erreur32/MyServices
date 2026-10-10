"""Uptime Kuma : état, temps de réponse et certificat de ses sondes, en lecture seule.

GET /metrics (format Prometheus), authentification basique : nom libre, mot de passe = clé d'API
(Paramètres → Clés d'API). Limité par Uptime Kuma à 60 requêtes par minute : un passage en fait une.
Métriques et codes d'après le code source (server/prometheus.js, src/util.ts) :
  monitor_status 1 = en ligne, 0 = en panne, 2 = en attente, 3 = maintenance
  monitor_response_time (ms), monitor_cert_days_remaining ; étiquettes monitor_id, monitor_name,
  monitor_type, monitor_url, monitor_hostname, monitor_port.
"""
from __future__ import annotations

import base64
import re
import urllib.parse
import urllib.error
import urllib.request

from connectors.base import Connector, ConnectorError, Field, Result

STATUS = {0: "down", 1: "up", 2: "pending", 3: "maintenance"}
LINE = re.compile(r'^([a-z_]+)\{(.*)\}\s+(\S+)$')
LABEL = re.compile(r'(\w+)="((?:[^"\\]|\\.)*)"')


def parse_metrics(text: str) -> dict:
    """{monitors: [...], version} depuis le texte Prometheus de /metrics."""
    mons, version = {}, None
    for line in text.splitlines():
        m = LINE.match(line.strip())
        if not m:
            continue
        name, value = m.group(1), m.group(3)
        labels = {k: v.replace('\\"', '"').replace("\\\\", "\\") for k, v in LABEL.findall(m.group(2))}
        if name == "app_version":
            version = labels.get("version") or version
            continue
        if not name.startswith("monitor_") or "monitor_id" not in labels:
            continue
        mon = mons.setdefault(labels["monitor_id"], {
            "id": labels["monitor_id"], "name": labels.get("monitor_name"), "type": labels.get("monitor_type"),
            "url": None if labels.get("monitor_url") in ("", "null", "https://") else labels.get("monitor_url"),
            "hostname": None if labels.get("monitor_hostname") in ("", "null") else labels.get("monitor_hostname"),
            "port": None if labels.get("monitor_port") in ("", "null") else labels.get("monitor_port"),
            "status": None, "response_ms": None, "cert_days": None})
        try:
            v = float(value)
        except ValueError:
            continue
        if name == "monitor_status":
            mon["status"] = STATUS.get(int(v))
        elif name == "monitor_response_time":
            mon["response_ms"] = round(v)
        elif name == "monitor_cert_days_remaining":
            mon["cert_days"] = round(v)
    return {"monitors": sorted(mons.values(), key=lambda x: (x["name"] or "").lower()), "version": version}


class UptimeKuma(Connector):
    type = "uptime-kuma"
    label = "Uptime Kuma"
    kinds = ("services",)
    images = ("louislam/uptime-kuma",)
    tested = ("1.23", "2")
    fields = (
        Field("url", "URL d'Uptime Kuma", "url", required=True, help="ex. http://192.168.1.10:3001"),
        Field("api_key", "Clé d'API (Paramètres → Clés d'API)", "password", required=True, secret=True),
    )
    setup_fields = ("url", "api_key")

    def _metrics(self) -> dict:
        if getattr(self, "_got", None) is None:  # version et sondes : une seule requête par passage
            auth = base64.b64encode(f"myservices:{self.conf['api_key']}".encode()).decode()
            req = urllib.request.Request(self.conf["url"].rstrip("/") + "/metrics",
                                         headers={"Authorization": f"Basic {auth}", "User-Agent": "myservices"})
            try:
                with urllib.request.urlopen(req, timeout=self.ctx.timeout) as r:
                    text = r.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                raise ConnectorError(f"HTTP {e.code}" + (" : clé d'API refusée" if e.code == 401 else "")) from None
            except (OSError, ValueError) as e:
                raise ConnectorError(f"injoignable ({getattr(e, 'reason', e)})") from None
            self._got = parse_metrics(text)
            if not self._got["monitors"] and "monitor_" not in text:
                raise ConnectorError("réponse sans métriques Uptime Kuma (URL ?)")
        return self._got

    def version(self) -> str | None:
        return self._metrics()["version"]

    def collect(self) -> dict:
        return {"monitors": self._metrics()["monitors"]}

    def test(self) -> Result:
        try:
            mons = self.collect()["monitors"]
            v = self.version()
        except ConnectorError as e:
            return Result(False, str(e))
        down = sum(1 for m in mons if m["status"] == "down")
        return Result(True, f"{len(mons)} sonde(s)" + (f", {down} en panne" if down else ""), v)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c == 3001), None)
        return {"url": f"http://{ip}:{web}"} if web else None


def attach_monitors(rows: list[dict], monitors: list[dict], instance: str, stale: bool = False) -> int:
    """Chaque sonde rattachée aux services qu'elle surveille : même domaine que son URL, sinon même
    IP:port (sondes ping / port). Ajoute {name, status, response_ms, cert_days, instance, stale} à
    r["uptime"] ; rend le nombre de sondes rattachées."""
    by_domain, by_addr = {}, {}
    for r in rows:
        for d in r.get("domains") or []:
            by_domain.setdefault(d.lower(), []).append(r)
        if r.get("ip") and r.get("port"):
            by_addr.setdefault(f'{r["ip"]}:{r["port"]}', []).append(r)
    n = 0
    for m in monitors:
        u = urllib.parse.urlsplit(m["url"]) if m.get("url") else None
        try:
            port = u.port if u else None
        except ValueError:
            port = None
        host = (u.hostname if u else None) or m.get("hostname")
        hits = by_domain.get((host or "").lower()) or by_addr.get(f"{host}:{port or m.get('port')}") or []
        for r in hits:
            r.setdefault("uptime", []).append({k: m.get(k) for k in ("name", "status", "response_ms", "cert_days")}
                                              | {"instance": instance, "stale": stale})
        n += bool(hits)
    return n
