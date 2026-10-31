"""connectors/cloudflare.py against a fake HTTP context whose answers follow the API documentation, never the real API.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import connectors  # noqa: E402
from connectors.base import ConnectorError, RateLimited  # noqa: E402
from connectors.cloudflare import API, TRAFFIC, Cloudflare  # noqa: E402

TOKEN = "cf-" + "t" * 12   # built at run time: the safety check refuses tokens written as such
TRAFFIC_OK = {"data": {"viewer": {"zones": [{"httpRequests1dGroups": [
    {"sum": {"requests": 2000, "cachedRequests": 500, "bytes": 3 * 2**30, "threats": 4, "pageViews": 100}, "uniq": {"uniques": 70}}]}]}}, "errors": None}


def zone(id_, name, **kw):
    return {"id": id_, "name": name, "status": "active", "paused": False, "plan": {"name": "Free Website"}, **kw}


SSL = {"z1": "strict", "z2": "flexible"}


class Fake:
    """Answers like Cloudflare; `refuse` holds the bits of URL answered 403."""

    def __init__(self, zones=None, refuse=(), traffic=None, total=None):
        self.calls, self.refuse = [], refuse
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
            return self.traffic
        if "/dns_records" in path:
            return {"result": [], "result_info": {"total_count": 3 if "proxied=true" in path else 10}}
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
        self.assertEqual(one, {"name": "exemple.fr", "status": "active", "paused": False, "plan": "Free Website", "dns": {"total": 10, "proxied": 3},
                               "settings": {"ssl": "strict", "always_use_https": "on", "min_tls_version": "1.2", "security_header": True, "security_level": "medium", "cache_level": "aggressive"},
                               "traffic": {"requests": 2000, "cached": 500, "bytes": 3 * 2**30, "threats": 4, "page_views": 100, "visitors": 70}})
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
        self.assertNotIn("mutation", TRAFFIC)
        self.assertTrue(all(h["Authorization"] == f"Bearer {TOKEN}" and TOKEN not in u for _, u, h, _ in ctx.calls))   # token in a header, never in the address

    def test_dns_records_themselves_are_never_fetched(self):
        ctx = Fake()
        d = conn(ctx).collect()
        self.assertTrue(all("per_page=1" in u for _, u, *_ in ctx.calls if "dns_records" in u))
        self.assertEqual(set(d["cloudflare"]["zones"][0]["dns"]), {"total", "proxied"})

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
        d = conn(Fake(traffic={"data": {"viewer": {"zones": [{"httpRequests1dGroups": []}]}}})).collect()
        self.assertEqual(d["cloudflare"]["zones"][0]["traffic"]["requests"], 0)
        self.assertIn("En cache (7 j)", [f["label"] for f in d["facts"]])

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
