"""myservices.dns_check without AdGuard: the container's resolvers answer for the NPM domains and the machine names.

  python3 -m unittest discover -s tests
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import config  # noqa: E402

with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    import myservices  # noqa: E402


def row(domain, enabled=True, **kw):
    return {"type": "proxy", "enabled": enabled, "domains": [domain], "npm": "npm", "lan_only": False, "public_ok": False, **kw}


class Resolvers(unittest.TestCase):
    def test_reads_nameservers_and_search(self):
        with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as f:
            f.write("# generated\nsearch lan home.arpa\nnameserver 10.0.0.2\nnameserver fe80::1\nnameserver 10.0.0.3\noptions ndots:0\n")
        with mock.patch.object(myservices, "RESOLV_CONF", f.name):
            self.assertEqual(myservices.resolvers(), (["10.0.0.2", "10.0.0.3"], ["lan", "home.arpa"]))
        with mock.patch.object(myservices, "RESOLV_CONF", "/nonexistent/resolv.conf"):
            self.assertEqual(myservices.resolvers(), ([], []))


class WithoutAdGuard(unittest.TestCase):
    def run_check(self, answers, rows, resolv=(["10.0.0.2"], ["lan"])):
        with mock.patch.object(myservices, "ADGUARD", {}), mock.patch.object(myservices, "ADGUARD_SYNC", {}), \
                mock.patch.object(myservices, "resolvers", return_value=resolv), mock.patch.object(myservices, "DISABLED", set()), \
                mock.patch.object(myservices, "MACHINES", {"10.0.0.5": ("srv", "", "srv"), "10.0.0.9": ("pc", "", None)}), \
                mock.patch.object(myservices, "NPM_IPS", {"npm": "10.0.0.5"}), \
                mock.patch.object(myservices, "dns_ask_all", side_effect=lambda s, names: {n: answers.get(n) for n in names}), \
                mock.patch.object(myservices, "mark_waiting"), mock.patch.object(myservices.cbase, "load_state", return_value={}), \
                mock.patch.object(myservices.cbase, "save_state"):
            return myservices.dns_check(rows)

    def test_domains_and_machine_names_asked_to_the_resolver(self):
        rows = [row("app.example.org"), row("gone.example.org"), row("off.example.org", enabled=False)]
        d = self.run_check({"app.example.org": ["10.0.0.5"], "gone.example.org": [], "srv.lan": ["10.0.0.5"], "pc": ["10.0.0.42"]}, rows)
        self.assertEqual(d["resolver"], {"servers": ["10.0.0.2"], "search": ["lan"]})
        self.assertEqual(list(d["servers"]), ["10.0.0.2"])
        self.assertTrue(d["servers"]["10.0.0.2"]["resolver"])
        self.assertEqual(d["servers"]["10.0.0.2"]["silent"], 0)
        self.assertEqual(rows[0]["dns"]["issues"], [])
        self.assertEqual(rows[1]["dns"]["issues"], [["absent", "gone.example.org"]])
        self.assertNotIn("dns", rows[2])
        self.assertEqual([(m["name"], m["state"]) for m in d["machines"]], [("pc", "ailleurs"), ("srv", "ok")])
        self.assertEqual(d["sync"], {})
        self.assertEqual(d["rewrites_diff"], [])

    def test_public_answer_is_no_lan_name(self):
        rows = [row("app.example.org")]
        d = self.run_check({"app.example.org": ["10.0.0.5"], "pc": ["203.0.113.9"], "srv": ["203.0.113.9"]}, rows)   # a bare name caught by a public domain
        self.assertEqual([(m["name"], m["state"], m["answer"]) for m in d["machines"]], [("pc", "absent", []), ("srv", "absent", [])])

    def test_no_resolver_no_control(self):
        self.assertIsNone(self.run_check({}, [row("a.example.org")], resolv=([], [])))
