"""Beszel (hub) : santé des machines Linux et Windows qui ont son agent, en lecture seule.

API PocketBase du hub, avec un compte Beszel au rôle « readonly » (systèmes partagés avec lui, ou
SHARE_ALL_SYSTEMS=true sur le hub) :
  POST /api/collections/users/auth-with-password   connexion -> jeton
  GET  /api/beszel/info                            version du hub (« v »)
  GET  /api/collections/<c>/records                systems, system_details, smart_devices, systemd_services,
                                                   system_stats (dernier relevé 1 min : taille des disques)
Champs lus d'après le code source de Beszel v0.21.0 (internal/entities/system, migrations) : son API
« peut changer en version mineure », d'où une lecture tolérante champ par champ.
"""
from __future__ import annotations

import urllib.parse
from datetime import datetime, timedelta, timezone

from connectors.base import Connector, ConnectorError, Field, Result

SERVICE_FAILED = 2  # systemd_services.state : 0 actif, 1 inactif, 2 en échec, 3-5 transitions


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _pair(v, i):
    return _num(v[i]) if isinstance(v, list) and len(v) > i else None


class Beszel(Connector):
    type = "beszel"
    label = "Beszel"
    kinds = ("health",)
    images = ("henrygd/beszel",)
    tested = ("0.20", "0.21")
    fields = (
        Field("url", "URL du hub", "url", required=True, help="ex. http://192.168.1.10:8090"),
        Field("user", "E-mail du compte Beszel (pas son nom), rôle readonly", required=True,
              help="Beszel n'accepte que l'e-mail pour se connecter ; compte au rôle readonly, systèmes partagés avec lui"),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé"),
    )
    setup_fields = ("url", "user", "password")

    def _base(self) -> str:
        return self.conf["url"].rstrip("/")

    def _http(self, path: str, **kw) -> object:
        return self.ctx.http(self._base() + path, verify_tls=self.conf.get("verify_tls", True) is not False, **kw)

    def _token(self) -> str:
        if not getattr(self, "_tok", None):
            try:
                got = self._http("/api/collections/users/auth-with-password", method="POST",
                                 body={"identity": self.conf["user"], "password": self.conf["password"]})
            except ConnectorError as e:
                if "@" not in self.conf["user"]:   # the hub signs in by e-mail only, never by the user name
                    raise ConnectorError(f"{e} : mettre l'e-mail du compte, pas son nom") from None
                raise
            self._tok = (got or {}).get("token")
            if not self._tok:
                raise ConnectorError("connexion refusée (compte ou mot de passe ?)")
        return self._tok

    def _get(self, path: str) -> object:
        return self._http(path, headers={"Authorization": self._token()})

    def _records(self, coll: str, flt: str | None = None) -> list[dict]:
        out, page = [], 1
        while True:
            q = {"perPage": 500, "page": page, **({"filter": flt} if flt else {})}
            got = self._get(f"/api/collections/{coll}/records?{urllib.parse.urlencode(q)}") or {}
            out += got.get("items") or []
            if page >= (got.get("totalPages") or 1):
                return out
            page += 1

    def version(self) -> str | None:
        return (self._get("/api/beszel/info") or {}).get("v")

    def collect(self) -> dict:
        systems = self._records("systems")
        if not systems:
            raise ConnectorError("aucun système visible : partager les systèmes avec ce compte (ou SHARE_ALL_SYSTEMS)")
        details = {d.get("system"): d for d in self._records("system_details")}
        smart, failed = {}, {}
        for d in self._records("smart_devices"):
            smart.setdefault(d.get("system"), []).append(
                {"name": d.get("name"), "model": d.get("model"), "state": d.get("state"), "temp": _num(d.get("temp")),
                 "hours": _num(d.get("hours")), "cycles": _num(d.get("cycles")), "capacity": _num(d.get("capacity"))})
        for s in self._records("systemd_services", f"state={SERVICE_FAILED}"):
            failed.setdefault(s.get("system"), []).append(s.get("name"))
        disks = self._disks()
        out = []
        for s in systems:
            info, det = s.get("info") or {}, details.get(s.get("id")) or {}
            out.append({
                "id": s.get("id"), "name": s.get("name"), "host": s.get("host"), "status": s.get("status"),
                "cpu": _num(info.get("cpu")), "mem_pct": _num(info.get("mp")), "disk_pct": _num(info.get("dp")),
                "extra_disks_pct": {k: v for k, v in (info.get("efs") or {}).items() if _num(v) is not None},
                "load": info.get("la") if isinstance(info.get("la"), list) else None,
                "uptime_s": _num(info.get("u")), "temp": _num(info.get("dt")),
                "services_total": _pair(info.get("sv"), 0), "services_failed": _pair(info.get("sv"), 1),
                "updates": _pair(info.get("pu"), 0), "updates_security": _pair(info.get("pu"), 1),
                "agent": info.get("v"), "os": det.get("os_name"), "kernel": det.get("kernel"),
                "cpu_model": det.get("cpu"), "cores": _num(det.get("cores")), "memory": _num(det.get("memory")),
                "smart": smart.get(s.get("id"), []), "failed_services": sorted(failed.get(s.get("id"), [])),
                "disks": disks.get(s.get("id"), []),
            })
        return {"systems": out}

    def _disks(self) -> dict:
        """{système: [{mount, size_gb, used_gb, used_pct}]} d'après le dernier relevé 1 min de chaque système
        (10 dernières minutes) : disque racine (« / », ou son nom FILESYSTEM) et disques en plus (efs)."""
        since = (datetime.now(timezone.utc) - timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")
        last = {}
        for r in self._records("system_stats", f'type="1m" && created>="{since}"'):
            if r.get("system") not in last or str(r.get("created")) > str(last[r["system"]].get("created")):
                last[r.get("system")] = r
        out = {}
        for sid, r in last.items():
            st = r.get("stats") or {}
            vols = [("/", st)] + sorted((k, v) for k, v in (st.get("efs") or {}).items() if isinstance(v, dict))
            out[sid] = [{"mount": name, "size_gb": round(v["d"], 1), "used_gb": round(_num(v.get("du")) or 0, 1),
                         "used_pct": round(_num(v.get("dp")) if _num(v.get("dp")) is not None
                                           else (_num(v.get("du")) or 0) * 100 / v["d"])}
                        for name, v in vols if _num(v.get("d"))]
        return out

    def test(self) -> Result:
        try:
            v = self.version()
            got = self.collect()["systems"]
        except ConnectorError as e:
            return Result(False, str(e))
        up = sum(1 for s in got if s["status"] == "up")
        return Result(True, f"{len(got)} système(s), {up} en ligne", v)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        hub = next((h for h, c in ports if c == 8090), None)
        return {"url": f"http://{ip}:{hub}"} if hub else None


def match(systems: list[dict], machines: dict) -> dict:
    """{IP de services-meta: système Beszel} : par adresse (host = IP), sinon par nom (sans casse)."""
    by_name = {str(m.get("name", "")).lower(): ip for ip, m in machines.items()}
    out = {}
    for s in systems:
        ip = s.get("host") if s.get("host") in machines else by_name.get(str(s.get("name", "")).lower())
        if ip and ip not in out:
            out[ip] = s
    return out
