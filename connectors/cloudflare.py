"""Cloudflare: the domains of an account side by side, read only: six settings, DNS record counts and the traffic of the last 7 days.

Routes read: GET /zones, GET /zones/{id}/settings/{setting} (one by one, the global read is deprecated), GET /zones/{id}/dns_records and POST /graphql
(Analytics: queries only). DNS: only the name, type and proxied state of the web records are kept, never their content: origin addresses are not stored.
A token without one of the optional rights (DNS, Zone Settings, Analytics) still lists its domains: what it cannot read is named in the problems.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from connectors.base import ConnectorError, Field, RateLimited
from connectors.status_kit import StatusConnector, fact, num, size

API = "https://api.cloudflare.com/client/v4"
DAYS = 7
MAX_ZONES = 20   # 8 calls per domain at about 0.5 s each, read by READERS at a time to stay in the 60 s of a pass; above that a problem says how many were left out
READERS = 4
MAX_RECORDS = 1000   # shortcut: one page of records, a zone beyond it shows its first 1000 in the checks; follow result_info if a user ever gets there
WEB_RECORDS = ("A", "AAAA", "CNAME")
SETTINGS = {"ssl": "SSL", "always_use_https": "HTTPS forcé", "min_tls_version": "TLS minimal", "security_header": "HSTS",
            "security_level": "Niveau de sécurité", "cache_level": "Cache"}
# Variables left undeclared, as in Cloudflare's own example: its gateway fills them in by name. Two reads of one table: the week as one group for its unique
# visitors (a sum of days would count a visitor once per day), and the requests of each day for the curve.
TRAFFIC = ("{viewer{zones(filter:{zoneTag:$zone}){"
           "week:httpRequests1dGroups(limit:1,filter:{date_geq:$since,date_lt:$until}){sum{requests cachedRequests bytes threats pageViews} uniq{uniques}} "
           f"days:httpRequests1dGroups(limit:{DAYS},orderBy:[date_ASC],filter:{{date_geq:$since,date_lt:$until}}){{dimensions{{date}} sum{{requests}}}}"
           "}}}")


def _spaced(n: int) -> str:
    return f"{n:,}".replace(",", " ")


class Cloudflare(StatusConnector):
    type = "cloudflare"
    label = "Cloudflare"
    every = 3600   # settings rarely move and the traffic is counted by the day
    fields = (Field("token", "Jeton d'API Cloudflare", "password", required=True, secret=True, help="jeton personnalisé en lecture seule (voir le guide)"),)
    setup_fields = ("token",)
    guide = (
        "Sur dash.cloudflare.com, ouvrir le profil, puis « API Tokens », « Create Token » et « Custom token ».",
        "Donner ces quatre droits en lecture, et aucun autre : Zone / Zone / Read, Zone / DNS / Read, Zone / Zone Settings / Read, Zone / Analytics / Read.",
        "Dans « Zone Resources », choisir « All zones » ou seulement les domaines à comparer.",
        "Copier le jeton dans le champ ci-dessus : Cloudflare ne l'affiche qu'une fois. MyServices ne modifie rien sur Cloudflare.",
    )

    def _api(self, path: str, **kw):
        return self.ctx.http(API + path, headers={"Authorization": f"Bearer {self.conf.get('token') or ''}"}, **kw)

    def _read(self, path: str, **kw) -> dict:
        """The answer of an optional route, {} when it is refused or unreadable; a rate limit stops the pass."""
        try:
            got = self._api(path, **kw)
        except RateLimited:
            raise
        except ConnectorError:
            return {}
        return got if isinstance(got, dict) else {}

    def _zones(self) -> dict:
        try:
            got = self._api(f"/zones?per_page={MAX_ZONES}")
        except ConnectorError as e:
            if str(e).startswith(("HTTP 400", "HTTP 401", "HTTP 403")):
                raise ConnectorError("accès refusé : jeton Cloudflare à vérifier (droit Zone Read)") from None
            raise
        if not isinstance(got, dict) or not isinstance(got.get("result"), list):
            raise ConnectorError("réponse inattendue de Cloudflare")
        if not got["result"]:
            raise ConnectorError("aucun domaine visible : droit Zone Read et Zone Resources du jeton à vérifier")
        return got

    def _setting(self, zone: str, key: str):
        value = (self._read(f"/zones/{zone}/settings/{key}").get("result") or {}).get("value")
        if key == "security_header":
            return (value.get("strict_transport_security") or {}).get("enabled") is True if isinstance(value, dict) else None
        return value if isinstance(value, str) else None

    def _dns(self, zone: str) -> dict | None:
        got = self._read(f"/zones/{zone}/dns_records?per_page={MAX_RECORDS}")
        total = (got.get("result_info") or {}).get("total_count")
        if total is None:
            return None
        records = [{"name": r.get("name"), "type": r.get("type"), "proxied": r.get("proxied") is True}
                   for r in got.get("result") or [] if isinstance(r, dict) and r.get("type") in WEB_RECORDS]
        return {"total": total, "proxied": sum(1 for r in records if r["proxied"]), "records": records}

    def _traffic(self, zone: str, since: str, until: str) -> dict | None:
        got = self._read("/graphql", method="POST", body={"query": TRAFFIC, "variables": {"zone": zone, "since": since, "until": until}})
        found = ((got.get("data") or {}).get("viewer") or {}).get("zones")
        if got.get("errors") or not found:
            return None   # a plan without this table answers 200 with an error
        group = (found[0].get("week") or [{}])[0]
        total = group.get("sum") or {}
        by_day = {(d.get("dimensions") or {}).get("date"): int(num((d.get("sum") or {}).get("requests"), 0)) for d in found[0].get("days") or []}
        first = date.fromisoformat(since)
        return {"requests": int(num(total.get("requests"), 0)), "cached": int(num(total.get("cachedRequests"), 0)), "bytes": int(num(total.get("bytes"), 0)),
                "threats": int(num(total.get("threats"), 0)), "page_views": int(num(total.get("pageViews"), 0)),
                "visitors": int(num((group.get("uniq") or {}).get("uniques"), 0)),
                "days": [{"date": day, "requests": by_day.get(day, 0)} for day in ((first + timedelta(days=i)).isoformat() for i in range(DAYS))]}   # a quiet day has no group

    def _zone(self, z: dict, since: str, until: str) -> dict:
        zone = z.get("id")
        return {"name": z.get("name"), "status": z.get("status"), "paused": z.get("paused") is True, "plan": (z.get("plan") or {}).get("name"),
                "settings": {k: self._setting(zone, k) for k in SETTINGS},
                "dns": self._dns(zone),
                "traffic": self._traffic(zone, since, until)}

    def collect(self) -> dict:
        got = self._zones()
        today = datetime.now(timezone.utc).date()
        since, until = (today - timedelta(days=DAYS - 1)).isoformat(), (today + timedelta(days=1)).isoformat()
        with ThreadPoolExecutor(READERS) as pool:
            zones = list(pool.map(lambda z: self._zone(z, since, until), [z for z in got["result"] if isinstance(z, dict)]))
        total = (got.get("result_info") or {}).get("total_count") or len(zones)

        return {**self.out(None, self._facts(zones, total), self._problems(zones, total)), "cloudflare": {"days": DAYS, "zones": zones}}

    @staticmethod
    def _facts(zones: list[dict], total: int) -> list[dict]:
        facts = [fact("Domaines", total)]
        if sum(1 for z in zones if any(v is not None for v in z["settings"].values())) > 1:
            apart = [label for k, label in SETTINGS.items() if len({z["settings"][k] for z in zones if z["settings"][k] is not None}) > 1]
            facts.append(fact("Réglages différents", ", ".join(apart) or "aucun", "warn" if apart else "ok"))
        read = [z["traffic"] for z in zones if z["traffic"]]
        if read:
            requests, cached = sum(t["requests"] for t in read), sum(t["cached"] for t in read)
            facts += [fact(f"Requêtes ({DAYS} j)", _spaced(requests)), fact(f"En cache ({DAYS} j)", f"{round(100 * cached / requests) if requests else 0} %"),
                      fact(f"Bande passante ({DAYS} j)", size(sum(t["bytes"] for t in read))), fact(f"Visiteurs ({DAYS} j)", _spaced(sum(t["visitors"] for t in read))),
                      fact(f"Menaces ({DAYS} j)", _spaced(sum(t["threats"] for t in read)))]
        if any(z["dns"] for z in zones):
            facts.append(fact("Enregistrements DNS", _spaced(sum(z["dns"]["total"] for z in zones if z["dns"]))))
        return facts

    @staticmethod
    def _problems(zones: list[dict], total: int) -> list[str]:
        problems = []
        for z in zones:
            name, ssl = z["name"], z["settings"]["ssl"]
            if z["paused"]:
                problems.append(f"« {name} » en pause : Cloudflare ne le protège plus")
            if z["status"] != "active":
                problems.append(f"« {name} » : état {z['status']}")
            if (z["dns"] or {}).get("proxied") == 0:
                continue   # DNS only: no request goes through Cloudflare, its SSL and HTTPS settings apply to nothing
            if ssl in ("off", "flexible"):
                problems.append(f"« {name} » : SSL {ssl}, liaison vers le serveur non chiffrée")
            if z["settings"]["always_use_https"] == "off":
                problems.append(f"« {name} » : HTTPS non forcé")
        unread = {"droit Zone Settings Read": sum(1 for z in zones if None in z["settings"].values()), "droit DNS Read": sum(1 for z in zones if z["dns"] is None),
                  "droit Analytics Read ou plan": sum(1 for z in zones if z["traffic"] is None)}
        problems += [f"non lu sur {n} domaine(s) : {what} à vérifier" for what, n in unread.items() if n]
        if total > len(zones):
            problems.append(f"{total - len(zones)} domaine(s) non lu(s), limite de {MAX_ZONES}")
        return problems
