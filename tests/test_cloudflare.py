"""connectors/cloudflare.py against a fake HTTP context whose answers follow the API documentation, never the real API.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import connectors  # noqa: E402
from connectors.base import ConnectorError, RateLimited  # noqa: E402
from connectors.cloudflare import API, EDGE_DETAIL, ERROR_NAMES, HTTP_DETAIL, STAMP, TRAFFIC, Cloudflare  # noqa: E402

TOKEN = "cf-" + "t" * 12   # built at run time: the safety check refuses tokens written as such
TRAFFIC_OK = {"data": {"viewer": {"zones": [{
    "week": [{"sum": {"requests": 2000, "cachedRequests": 500, "bytes": 3 * 2**30, "threats": 4, "pageViews": 100}, "uniq": {"uniques": 70}}], "days": []}]}}, "errors": None}


def zone(id_, name, **kw):
    return {"id": id_, "name": name, "status": "active", "paused": False, "plan": {"name": "Free Website"}, **kw}


SSL = {"z1": "strict", "z2": "flexible"}


class Fake:
    """Answers like Cloudflare; `refuse` holds the bits of URL answered 403."""

    def __init__(self, zones=None, refuse=(), traffic=None, total=None, proxied=3, names=None, http=None, edge=None):
        self.details = {HTTP_DETAIL: http, EDGE_DETAIL: edge}
        self.calls, self.refuse, self.proxied, self.names = [], refuse, proxied, names or {"data": None, "errors": [{"message": "no access"}]}
        self.zones, self.traffic = zones if zones is not None else [zone("z1", "exemple.fr"), zone("z2", "example.org")], traffic or TRAFFIC_OK
        self.total = total

    def http(self, url, *, method="GET", body=None, headers=None, **kw):
        self.calls.append((method, url, headers, body))
        path = url.removeprefix(API)
        if any(bit in path for bit in self.refuse):
            raise ConnectorError("HTTP 403")
        if path.startswith("/zones?"):
            return {"success": True, "result": self.zones, "result_info": {"total_count": self.total or len(self.zones)}}
        if path == "/graphql":
            if body["query"] in self.details:
                return self.details[body["query"]] or {"data": None, "errors": [{"message": "no access"}]}
            return self.names if body["query"] == ERROR_NAMES else self.traffic
        if "/dns_records" in path:
            records = [{"name": f"r{i}.exemple.fr", "type": "A", "proxied": i < self.proxied, "content": "192.0.2.1"} for i in range(9)]
            return {"result": [*records, {"name": "exemple.fr", "type": "MX", "proxied": False, "content": "mail.exemple.fr"}], "result_info": {"total_count": 10}}
        z, key = path.split("/")[2], path.rsplit("/", 1)[1]
        value = {"ssl": SSL[z], "always_use_https": "on" if z == "z1" else "off", "min_tls_version": "1.2", "security_level": "medium", "cache_level": "aggressive",
                 "security_header": {"strict_transport_security": {"enabled": z == "z1", "max_age": 0}}}[key]
        return {"result": {"id": key, "value": value}}


def conn(ctx):
    return Cloudflare({"type": "cloudflare", "name": "cf", "token": TOKEN}, ctx)


class CloudflareRead(unittest.TestCase):
    def test_registered_and_token_is_required_and_secret(self):
        self.assertIs(connectors.TYPES["cloudflare"], Cloudflare)
        self.assertEqual(Cloudflare.validate({}), ["« token » requis"])
        self.assertEqual([f.name for f in Cloudflare.fields if f.secret], ["token"])

    def test_two_domains_side_by_side(self):
        ctx = Fake()
        d = conn(ctx).collect()
        one, two = d["cloudflare"]["zones"]
        self.assertEqual(d["cloudflare"]["days"], 7)
        self.assertEqual(one, {"name": "exemple.fr", "status": "active", "paused": False, "plan": "Free Website",
                               "settings": {"ssl": "strict", "always_use_https": "on", "min_tls_version": "1.2", "security_header": True, "security_level": "medium", "cache_level": "aggressive"},
                               "dns": one["dns"], "traffic": one["traffic"]})
        self.assertEqual((one["dns"]["total"], one["dns"]["proxied"], len(one["dns"]["records"])), (10, 3, 9))   # the MX stays out of the web records
        self.assertEqual({k: one["traffic"][k] for k in ("requests", "cached", "bytes", "threats", "page_views", "visitors")},
                         {"requests": 2000, "cached": 500, "bytes": 3 * 2**30, "threats": 4, "page_views": 100, "visitors": 70})
        self.assertIs(two["settings"]["security_header"], False)
        facts = {f["label"]: f for f in d["facts"]}
        self.assertEqual({k: v["value"] for k, v in facts.items()},
                         {"Domaines": "2", "Réglages différents": "SSL, HTTPS forcé, HSTS", "Requêtes (7 j)": "4 000", "En cache (7 j)": "25 %", "Bande passante (7 j)": "6,0 Go",
                          "Visiteurs (7 j)": "140", "Menaces (7 j)": "8", "Enregistrements DNS": "20"})
        self.assertEqual(facts["Réglages différents"]["tone"], "warn")
        self.assertEqual(d["problems"], ["« example.org » : SSL flexible, liaison vers le serveur non chiffrée", "« example.org » : HTTPS non forcé"])

    def test_reads_and_never_writes(self):
        ctx = Fake()
        conn(ctx).collect()
        self.assertEqual({m for m, *_ in ctx.calls}, {"GET", "POST"})
        self.assertEqual({u for m, u, *_ in ctx.calls if m == "POST"}, {API + "/graphql"})   # the POST is the analytics query, nothing else
        self.assertNotIn("mutation", TRAFFIC + ERROR_NAMES + HTTP_DETAIL + EDGE_DETAIL)
        self.assertTrue(all(h["Authorization"] == f"Bearer {TOKEN}" and TOKEN not in u for _, u, h, _ in ctx.calls))   # token in a header, never in the address

    def test_the_content_of_a_dns_record_is_never_kept(self):
        d = conn(Fake()).collect()
        self.assertEqual(set(d["cloudflare"]["zones"][0]["dns"]["records"][0]), {"name", "type", "proxied"})
        self.assertNotIn("192.0.2.1", str(d))

    def test_every_day_of_the_week_is_there_even_a_quiet_one(self):
        yesterday = datetime.now(timezone.utc).date() - timedelta(days=1)
        days = [{"dimensions": {"date": yesterday.isoformat()}, "sum": {"requests": 12}}]
        d = conn(Fake(traffic={"data": {"viewer": {"zones": [{"week": [], "days": days}]}}})).collect()
        got = d["cloudflare"]["zones"][0]["traffic"]["days"]
        self.assertEqual(len(got), 7)
        self.assertEqual(got[-1], {"date": yesterday.isoformat(), "requests": 12})   # today is still running: it is never compared with a whole day
        self.assertEqual({x["requests"] for x in got[:-1]}, {0})

    def test_three_periods_each_with_the_one_before_it(self):
        codes = [{"edgeResponseStatus": 200, "requests": 70}, {"edgeResponseStatus": 525, "requests": 20}, {"edgeResponseStatus": 520, "requests": 10}]
        full = {"sum": {"requests": 100, "cachedRequests": 5, "bytes": 2048, "cachedBytes": 10, "threats": 3, "responseStatusMap": codes,
                        "countryMap": [{"clientCountryName": "NL", "requests": 9, "threats": 2}, {"clientCountryName": "FR", "requests": 90, "threats": 0}],
                        "browserMap": [{"uaBrowserFamily": "Chrome", "pageViews": 4}]}, "uniq": {"uniques": 8}}
        hour = datetime.now(timezone.utc).replace(minute=0) - timedelta(hours=1)
        hours = [{"dimensions": {"datetime": hour.strftime(STAMP)}, "sum": {"requests": 7, "cachedRequests": 2, "responseStatusMap": codes[1:2]}, "uniq": {"uniques": 3}}]
        answer = {"day": [full], "day_before": [{"sum": {"requests": 50}, "uniq": {"uniques": 4}}], "hours": hours}
        names = {"data": {"viewer": {"zones": [{"day": [{"count": 20, "dimensions": {"clientRequestHTTPHost": "www.exemple.fr", "edgeResponseStatus": 525}}]}]}}}
        got = conn(Fake(traffic={"data": {"viewer": {"zones": [answer]}}}, names=names)).collect()["cloudflare"]["zones"][0]["traffic"]["periods"]
        self.assertEqual(set(got), {"24h", "7d", "30d"})
        day = got["24h"]
        self.assertEqual((day["requests"], day["errors"], day["cached_bytes"], day["visitors"]), (100, 30, 10, 8))
        self.assertEqual((day["previous"]["requests"], day["previous"]["visitors"]), (50, 4))
        self.assertEqual([c["name"] for c in day["countries"]], ["FR", "NL"])
        self.assertEqual(day["browsers"], [{"name": "Chrome", "requests": 4}])
        self.assertEqual(len(day["points"]), 24)
        self.assertEqual(day["points"][-1], {"at": hour.strftime(STAMP), "requests": 7, "cached": 2, "bytes": 0, "cached_bytes": 0, "threats": 0, "errors": 20, "visitors": 3})
        self.assertEqual(day["hosts"], [{"name": "www.exemple.fr", "code": 525, "requests": 20}])
        self.assertEqual(len(got["30d"]["points"]), 30)

    def test_error_names_refused_leave_the_traffic_read(self):
        got = conn(Fake()).collect()["cloudflare"]["zones"][0]["traffic"]
        self.assertEqual(got["requests"], 2000)
        self.assertEqual(got["periods"]["7d"]["hosts"], [])

    def test_the_details_of_a_period(self):
        today = datetime.now(timezone.utc).date()
        http = {"data": {"viewer": {"zones": [{"week_visits": [{"sum": {"visits": 9, "pageViews": 12}}], "week_paths": [{"count": 5, "dimensions": {"clientRequestPath": "/" + "a" * 500}}],
                                               "week_origin": [{"count": 3, "dimensions": {"originResponseStatus": 0}}], "week_cache": [{"count": 2, "sum": {"edgeResponseBytes": 700}, "dimensions": {"cacheStatus": "dynamic"}}]}]}}}
        sample = [{"action": "block", "source": "waf", "clientCountryName": "NL", "clientRequestHTTPHost": "exemple.fr"}] * 2 + [{"action": "skip", "source": "waf", "clientCountryName": "FR", "clientRequestHTTPHost": "exemple.fr"}]
        edge = {"data": {"viewer": {"zones": [{"week_events": [{"count": 40, "dimensions": {"date": (today - timedelta(days=2)).isoformat()}}], "week_sample": sample, "week_dns": [{"count": 80}],
                                               "week_codes": [{"count": 2, "dimensions": {"responseCode": "NXDOMAIN"}}]}]}}}
        week = conn(Fake(http=http, edge=edge)).collect()["cloudflare"]["zones"][0]["traffic"]["periods"]["7d"]
        self.assertEqual((week["visits"], week["page_views"]), (9, 12))
        self.assertEqual(len(week["paths"][0]["name"]), 120)   # written by whoever sends the request
        self.assertEqual(week["origin"], [{"name": "0", "requests": 3}])   # 0: no answer from the server, not a missing value
        self.assertEqual(week["cache"], [{"name": "dynamic", "requests": 2, "bytes": 700}])
        self.assertEqual((week["security"]["events"], week["security"]["sample"], len(week["security"]["points"])), (40, 3, 7))
        self.assertEqual(week["security"]["points"][-2]["events"], 40)
        self.assertEqual(week["security"]["actions"], [{"name": "block", "requests": 2}, {"name": "skip", "requests": 1}])
        self.assertEqual((week["dns"]["total"], week["dns"]["codes"]), (80, [{"name": "NXDOMAIN", "requests": 2}]))

    def test_the_address_of_a_client_is_never_asked(self):
        self.assertNotIn("clientIP", HTTP_DETAIL + EDGE_DETAIL + TRAFFIC + ERROR_NAMES)

    def test_refused_details_leave_the_traffic_readable(self):
        week = conn(Fake()).collect()["cloudflare"]["zones"][0]["traffic"]["periods"]["7d"]
        self.assertEqual((week["requests"], week["paths"], week["security"]["events"], week["dns"]["total"]), (2000, [], 0, 0))

    def test_a_long_host_written_by_a_client_is_cut(self):
        names = {"data": {"viewer": {"zones": [{"week": [{"count": 1, "dimensions": {"clientRequestHTTPHost": "x" * 5000, "edgeResponseStatus": 520}}]}]}}}
        got = conn(Fake(names=names)).collect()["cloudflare"]["zones"][0]["traffic"]["periods"]["7d"]["hosts"]
        self.assertEqual(len(got[0]["name"]), 120)

    def test_a_missing_right_is_named_and_the_rest_still_reads(self):
        for refused, said in (("/settings/", "droit Zone Settings Read"), ("/dns_records", "droit DNS Read"), ("/graphql", "droit Analytics Read ou plan")):
            d = conn(Fake(refuse=(refused,))).collect()
            self.assertIn(f"non lu sur 2 domaine(s) : {said} à vérifier", d["problems"])
            self.assertEqual(len(d["cloudflare"]["zones"]), 2)
            self.assertEqual("Réglages différents" in [f["label"] for f in d["facts"]], refused != "/settings/")   # unread settings are not « none differ »

    def test_a_graphql_error_comes_with_a_200(self):
        d = conn(Fake(traffic={"data": None, "errors": [{"message": "zone does not have access to the path"}]})).collect()
        self.assertIsNone(d["cloudflare"]["zones"][0]["traffic"])
        self.assertNotIn("Requêtes (7 j)", [f["label"] for f in d["facts"]])

    def test_a_quiet_domain_is_zero_not_unread(self):
        d = conn(Fake(traffic={"data": {"viewer": {"zones": [{"week": [], "days": []}]}}})).collect()
        self.assertEqual(d["cloudflare"]["zones"][0]["traffic"]["requests"], 0)
        self.assertIn("En cache (7 j)", [f["label"] for f in d["facts"]])

    def test_a_dns_only_domain_has_no_ssl_or_https_problem(self):
        d = conn(Fake(proxied=0)).collect()
        self.assertEqual(d["problems"], [])

    def test_order_of_the_domains_is_kept(self):
        d = conn(Fake(zones=[zone("z2", "b.example"), zone("z1", "a.example")])).collect()
        self.assertEqual([z["name"] for z in d["cloudflare"]["zones"]], ["b.example", "a.example"])

    def test_refused_token_or_no_domain(self):
        with self.assertRaisesRegex(ConnectorError, "accès refusé"):
            conn(Fake(refuse=("/zones?",))).collect()
        with self.assertRaisesRegex(ConnectorError, "aucun domaine visible"):
            conn(Fake(zones=[])).collect()
        self.assertFalse(conn(Fake(refuse=("/zones?",))).test().ok)

    def test_rate_limit_stops_the_pass(self):
        class Limited(Fake):
            def http(self, url, **kw):
                if "/settings/" in url:
                    raise RateLimited("HTTP 429", 60)
                return super().http(url, **kw)
        with self.assertRaises(RateLimited):
            conn(Limited()).collect()

    def test_paused_pending_and_left_out_domains(self):
        d = conn(Fake(zones=[zone("z1", "exemple.fr", paused=True, status="pending")], total=23)).collect()
        self.assertEqual(d["problems"], ["« exemple.fr » en pause : Cloudflare ne le protège plus", "« exemple.fr » : état pending", "22 domaine(s) non lu(s), limite de 20"])
        self.assertEqual({f["label"]: f["value"] for f in d["facts"]}["Domaines"], "23")
        self.assertNotIn("Réglages différents", [f["label"] for f in d["facts"]])   # one domain has nothing to be compared with


if __name__ == "__main__":
    unittest.main()
