"""Cloudflare: the domains of an account side by side, read only: six settings, DNS record counts and the traffic over 24 hours, 7 and 30 days.

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
MONTH = 30
HOURS = 24
TOP = 12   # lines kept in each breakdown: a domain sees about 100 countries
ERROR_HOSTS = 10
MAX_NAME = 120   # the host of a request is written by whoever sends it
STAMP = "%Y-%m-%dT%H:00:00Z"
MAX_ZONES = 20   # 9 calls per domain at about 0.5 s each, read by READERS at a time to stay in the 60 s of a pass; above that a problem says how many were left out
READERS = 4
MAX_RECORDS = 1000   # shortcut: one page of records, a zone beyond it shows its first 1000 in the checks; follow result_info if a user ever gets there
WEB_RECORDS = ("A", "AAAA", "CNAME")
SETTINGS = {"ssl": "SSL", "always_use_https": "HTTPS forcé", "min_tls_version": "TLS minimal", "security_header": "HSTS",
            "security_level": "Niveau de sécurité", "cache_level": "Cache"}
TOTALS = "requests cachedRequests bytes cachedBytes threats responseStatusMap{edgeResponseStatus requests}"
BREAKDOWN = ("pageViews countryMap{clientCountryName requests threats} contentTypeMap{edgeResponseContentTypeName requests bytes} "
             "clientSSLMap{clientSSLProtocol requests} clientHTTPVersionMap{clientHTTPProtocol requests} browserMap{uaBrowserFamily pageViews}")
DAY_WINDOW, HOUR_WINDOW = "date_geq:${},date_lt:${}", "datetime_geq:${},datetime_lt:${}"


def _whole(alias: str, table: str, window: str, fields: str) -> str:
    """A period read as one group: the unique visitors cannot be added up from smaller groups."""
    return f"{alias}:{table}(limit:1,filter:{{{window}}}){{sum{{{fields}}} uniq{{uniques}}}} "


# Variables left undeclared, as in Cloudflare's own example: its gateway fills them in by name. One query for each domain: every period, the one before it, and
# its bars. Hours are the only table read by the hour, and it reaches back 3 days.
TRAFFIC = ("{viewer{zones(filter:{zoneTag:$zone}){"
           + _whole("day", "httpRequests1hGroups", HOUR_WINDOW.format("day", "hour"), f"{TOTALS} {BREAKDOWN}")
           + _whole("day_before", "httpRequests1hGroups", HOUR_WINDOW.format("day_before", "day"), TOTALS)
           + _whole("week", "httpRequests1dGroups", DAY_WINDOW.format("week", "today"), f"{TOTALS} {BREAKDOWN}")
           + _whole("week_before", "httpRequests1dGroups", DAY_WINDOW.format("week_before", "week"), TOTALS)
           + _whole("month", "httpRequests1dGroups", DAY_WINDOW.format("month", "today"), f"{TOTALS} {BREAKDOWN}")
           + _whole("month_before", "httpRequests1dGroups", DAY_WINDOW.format("month_before", "month"), TOTALS)
           + f"hours:httpRequests1hGroups(limit:{HOURS},orderBy:[datetime_ASC],filter:{{{HOUR_WINDOW.format('day', 'hour')}}}){{dimensions{{datetime}} sum{{requests responseStatusMap{{edgeResponseStatus requests}}}}}} "
           + f"days:httpRequests1dGroups(limit:{MONTH},orderBy:[date_ASC],filter:{{{DAY_WINDOW.format('month', 'today')}}}){{dimensions{{date}} sum{{requests responseStatusMap{{edgeResponseStatus requests}}}}}}"
           + "}}}")
# A query of its own: this table is the one a plan can refuse, and the rest must survive that
_ERRORS_FILTER = "edgeResponseStatus_geq:500,edgeResponseStatus_lt:600"
ERROR_NAMES = ("{viewer{zones(filter:{zoneTag:$zone}){"
               + " ".join(f"{alias}:httpRequestsAdaptiveGroups(limit:{ERROR_HOSTS},orderBy:[count_DESC],filter:{{datetime_geq:${since},datetime_lt:${until},{_ERRORS_FILTER}}})"
                          "{count dimensions{clientRequestHTTPHost edgeResponseStatus}}"
                          for alias, since, until in (("day", "day", "hour"), ("week", "week_at", "today_at"), ("month", "month_at", "today_at")))
               + "}}}")


def _windows(now: datetime) -> dict:
    """Whole hours and whole days only: the running one would be compared with a complete one before it."""
    today, hour = now.date(), now.replace(minute=0, second=0, microsecond=0)
    days = {"today": 0, "week": DAYS, "week_before": 2 * DAYS, "month": MONTH, "month_before": 2 * MONTH}
    hours = {"hour": 0, "day": HOURS, "day_before": 2 * HOURS}
    return {**{k: (today - timedelta(days=n)).isoformat() for k, n in days.items()},
            **{f"{k}_at": f"{today - timedelta(days=days[k])}T00:00:00Z" for k in ("today", "week", "month")},
            **{k: (hour - timedelta(hours=n)).strftime(STAMP) for k, n in hours.items()}}


def _count(row: dict, key: str) -> int:
    return int(num(row.get(key), 0))


def _errors(total: dict) -> int:
    return sum(_count(r, "requests") for r in total.get("responseStatusMap") or [] if 500 <= _count(r, "edgeResponseStatus") < 600)


def _totals(group: dict) -> dict:
    total = group.get("sum") or {}
    return {"requests": _count(total, "requests"), "cached": _count(total, "cachedRequests"), "bytes": _count(total, "bytes"), "cached_bytes": _count(total, "cachedBytes"),
            "threats": _count(total, "threats"), "errors": _errors(total), "visitors": _count(group.get("uniq") or {}, "uniques")}


def _top(rows: list | None, name: str, count: str = "requests", extra: str | None = None) -> list[dict]:
    lines = [{"name": str(r.get(name) or "?")[:MAX_NAME], "requests": _count(r, count), **({extra: _count(r, extra)} if extra else {})} for r in rows or []]
    return sorted(lines, key=lambda r: -r["requests"])[:TOP]


def _points(rows: list | None, dimension: str, stamps: list[str]) -> list[dict]:
    """One bar for each stamp: a quiet hour or day has no group."""
    by_stamp = {(r.get("dimensions") or {}).get(dimension): r.get("sum") or {} for r in rows or []}
    return [{"at": at, "requests": _count(by_stamp.get(at, {}), "requests"), "errors": _errors(by_stamp.get(at, {}))} for at in stamps]


def _period(group: dict, before: dict, points: list[dict]) -> dict:
    total = group.get("sum") or {}
    return {**_totals(group), "previous": _totals(before), "points": points,
            "status": [{"code": _count(r, "edgeResponseStatus"), "requests": _count(r, "requests")} for r in total.get("responseStatusMap") or []],
            "countries": _top(total.get("countryMap"), "clientCountryName", extra="threats"), "content": _top(total.get("contentTypeMap"), "edgeResponseContentTypeName", extra="bytes"),
            "tls": _top(total.get("clientSSLMap"), "clientSSLProtocol"), "http": _top(total.get("clientHTTPVersionMap"), "clientHTTPProtocol"),
            "browsers": _top(total.get("browserMap"), "uaBrowserFamily", count="pageViews"), "hosts": []}


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

    def _graphql(self, query: str, variables: dict) -> dict | None:
        got = self._read("/graphql", method="POST", body={"query": query, "variables": variables})
        found = ((got.get("data") or {}).get("viewer") or {}).get("zones")
        return None if got.get("errors") or not found else found[0]   # a plan without a table answers 200 with an error

    def _traffic(self, zone: str, w: dict) -> dict | None:
        found = self._graphql(TRAFFIC, {"zone": zone, **w})
        if found is None:
            return None
        first = date.fromisoformat(w["month"])
        days = _points(found.get("days"), "date", [(first + timedelta(days=i)).isoformat() for i in range(MONTH)])
        hour = datetime.strptime(w["day"], STAMP)
        hours = _points(found.get("hours"), "datetime", [(hour + timedelta(hours=i)).strftime(STAMP) for i in range(HOURS)])
        def group(alias: str) -> dict:
            return (found.get(alias) or [{}])[0]

        periods = {"24h": _period(group("day"), group("day_before"), hours), "7d": _period(group("week"), group("week_before"), days[-DAYS:]), "30d": _period(group("month"), group("month_before"), days)}
        names = self._graphql(ERROR_NAMES, {"zone": zone, **w}) or {}
        for key, alias in (("24h", "day"), ("7d", "week"), ("30d", "month")):
            periods[key]["hosts"] = [{"name": str((r.get("dimensions") or {}).get("clientRequestHTTPHost") or "?")[:MAX_NAME], "code": _count(r.get("dimensions") or {}, "edgeResponseStatus"), "requests": _count(r, "count")}
                                     for r in names.get(alias) or []]
        week = periods["7d"]
        return {**{k: week[k] for k in ("requests", "cached", "bytes", "threats", "visitors")}, "page_views": _count(group("week").get("sum") or {}, "pageViews"),
                "days": [{"date": d["at"], "requests": d["requests"]} for d in week["points"]], "periods": periods}

    def _zone(self, z: dict, windows: dict) -> dict:
        zone = z.get("id")
        return {"name": z.get("name"), "status": z.get("status"), "paused": z.get("paused") is True, "plan": (z.get("plan") or {}).get("name"),
                "settings": {k: self._setting(zone, k) for k in SETTINGS},
                "dns": self._dns(zone),
                "traffic": self._traffic(zone, windows)}

    def collect(self) -> dict:
        got = self._zones()
        windows = _windows(datetime.now(timezone.utc))
        with ThreadPoolExecutor(READERS) as pool:
            zones = list(pool.map(lambda z: self._zone(z, windows), [z for z in got["result"] if isinstance(z, dict)]))
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
