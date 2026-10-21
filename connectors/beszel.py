"""Beszel (hub) : santé des machines Linux et Windows qui ont son agent, en lecture seule.

API PocketBase du hub, avec un compte Beszel au rôle « readonly » (systèmes partagés avec lui, ou
SHARE_ALL_SYSTEMS=true sur le hub) :
  POST /api/collections/users/auth-with-password   connexion -> jeton
  GET  /api/beszel/info                            version du hub (« v »)
  GET  /api/collections/<c>/records                systems, system_details, smart_devices, systemd_services, containers,
                                                   system_stats (dernier relevé 1 min : taille des disques, sondes, swap)
Champs lus d'après le code source de Beszel v0.21.0 (internal/entities/system, migrations) : son API
« peut changer en version mineure », d'où une lecture tolérante champ par champ.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

from connectors.base import Connector, ConnectorError, Field, Result

SERVICE_FAILED = 2  # systemd_services.state : 0 actif, 1 inactif, 2 en échec, 3-5 transitions
HEALTH = {1: "starting", 2: "healthy", 3: "unhealthy"}  # containers.health ; 0 : no health check
TOKEN_MARGIN = 600      # a kept token is dropped 10 min before it expires
TOKEN_FALLBACK = 3600   # token without a readable expiry: kept an hour
# (url, user, password digest) -> (token, drop after) ; a changed password is a new key. Kept by the server process, so a pass does not sign in again (memory only, never on disk).
# Kept to its expiry, not « until refused »: an expired token can get an empty list from PocketBase instead of a 401.
_tokens: dict[tuple[str, str], tuple[str, float]] = {}


def _expiry(token: str) -> float | None:
    """The « exp » claim of a PocketBase token (a JWT), read without checking the signature: only to know when to sign in again."""
    try:
        part = token.split(".")[1]
        exp = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))).get("exp")
    except (IndexError, ValueError, AttributeError):
        return None
    return float(exp) if isinstance(exp, (int, float)) and not isinstance(exp, bool) else None


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

    def _key(self) -> tuple[str, str, str]:
        return self._base(), self.conf["user"], hashlib.sha256(str(self.conf["password"]).encode()).hexdigest()

    def _token(self) -> str:
        key = self._key()
        if not getattr(self, "_tok", None) and key in _tokens and _tokens[key][1] > time.time():
            self._tok, self._kept = _tokens[key][0], True
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
            self._kept = False
            exp = _expiry(self._tok)
            _tokens[key] = (self._tok, exp - TOKEN_MARGIN if exp else time.time() + TOKEN_FALLBACK)
        return self._tok

    def _get(self, path: str) -> object:
        try:
            return self._http(path, headers={"Authorization": self._token()})
        except ConnectorError as e:
            if not (getattr(self, "_kept", False) and str(e).startswith(("HTTP 401", "HTTP 403"))):
                raise
            _tokens.pop(self._key(), None)   # token revoked or the password changed: sign in again, once
            self._tok = None
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
        last = self._last_stats()
        disks = _disks(last)
        docker = {}
        try:
            running = self._records("containers")   # running containers only, as the agent sees them
        except ConnectorError:
            running = []   # older hub without this collection
        for c in running:
            docker.setdefault(c.get("system"), []).append(
                {"name": c.get("name"), "image": c.get("image"), "status": c.get("status"), "health": HEALTH.get(c.get("health")),
                 "cpu": _num(c.get("cpu")), "memory_mb": _num(c.get("memory")), "updatable": c.get("updatable") is True})
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
                "containers": sorted(docker.get(s.get("id"), []), key=lambda c: str(c["name"])),
                "sensors": _sensors(last.get(s.get("id"))), **_swap(last.get(s.get("id"))),
            })
        return {"systems": out}

    def _last_stats(self) -> dict:
        """{system: its last 1 min record (10 last minutes)}: disks, sensors and swap all come from it, one read."""
        since = (datetime.now(timezone.utc) - timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")
        last = {}
        for r in self._records("system_stats", f'type="1m" && created>="{since}"'):
            if r.get("system") not in last or str(r.get("created")) > str(last[r["system"]].get("created")):
                last[r.get("system")] = r
        return last

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


def _disks(last: dict) -> dict:
    """{système: [{mount, size_gb, used_gb, used_pct}]} : disque racine (« / », ou son nom FILESYSTEM) et disques en plus (efs)."""
    out = {}
    for sid, r in last.items():
        st = r.get("stats") or {}
        vols = [("/", st)] + sorted((k, v) for k, v in (st.get("efs") or {}).items() if isinstance(v, dict))
        out[sid] = [{"mount": name, "size_gb": round(v["d"], 1), "used_gb": round(_num(v.get("du")) or 0, 1),
                     "used_pct": round(_num(v.get("dp")) if _num(v.get("dp")) is not None
                                       else (_num(v.get("du")) or 0) * 100 / v["d"])}
                    for name, v in vols if _num(v.get("d"))]
    return out


def _sensors(r: dict | None) -> list[dict]:
    """Every temperature sensor of the last record (stats « t »), hottest first."""
    t = ((r or {}).get("stats") or {}).get("t")
    got = [{"name": str(k), "celsius": round(v, 1)} for k, v in (t.items() if isinstance(t, dict) else ()) if _num(v) is not None]
    return sorted(got, key=lambda x: -x["celsius"])


def _swap(r: dict | None) -> dict:
    """Swap size and use in GB (stats « s », « su »), when the machine has some."""
    st = (r or {}).get("stats") or {}
    size, used = _num(st.get("s")), _num(st.get("su"))
    return {"swap_gb": round(size, 2), "swap_used_gb": round(used or 0, 2)} if size else {}


def match(systems: list[dict], machines: dict) -> dict:
    """{IP de services-meta: système Beszel} : par adresse (host = IP), sinon par nom (sans casse)."""
    by_name = {str(m.get("name", "")).lower(): ip for ip, m in machines.items()}
    out = {}
    for s in systems:
        ip = s.get("host") if s.get("host") in machines else by_name.get(str(s.get("name", "")).lower())
        if ip and ip not in out:
            out[ip] = s
    return out
