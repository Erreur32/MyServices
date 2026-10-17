"""myservices: nginx rows, the NPM forward target overridden by an advanced config, the process reading warning; watcher: waiting DNS differences.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import config  # noqa: E402

# CI has no /config/services-meta.json and importing myservices reads it: the example stands in, for the import only (the global config is left as it was)
with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    import myservices  # noqa: E402
import watcher  # noqa: E402

ADV = "location / {\n  proxy_pass http://10.0.0.206:8080;\n}\n"


class NginxRows(unittest.TestCase):
    def test_one_row_per_unclaimed_port_with_the_first_name(self):
        hinfo = {"10.0.0.2": {"nginx_vhosts": [{"port": 80, "names": ["a.example.org", "b.example.org"], "conf": "s"},
                                               {"port": 8081, "names": [], "conf": "t"}]}, "10.0.0.3": None}
        used = {("10.0.0.2", 80)}
        rows = myservices.nginx_rows(hinfo, used)
        self.assertEqual([(r["port"], r["service"]["name"]) for r in rows], [(8081, "nginx")])
        self.assertIn(("10.0.0.2", 8081), used)
        used = set()
        rows = myservices.nginx_rows(hinfo, used)
        self.assertEqual(rows[0]["service"]["name"], "nginx · a.example.org")


class ForwardTarget(unittest.TestCase):
    def test_advanced_config_overrides_the_declared_target(self):
        h = {"forward_scheme": "http"}
        self.assertEqual(myservices.forward_target(h, "10.0.0.150", 8073, ADV), ("http", "10.0.0.206", 8080, "10.0.0.150:8073"))

    def test_same_target_or_no_override_keeps_the_declared_one(self):
        h = {"forward_scheme": "https"}
        self.assertEqual(myservices.forward_target(h, "10.0.0.206", 8080, ADV), ("https", "10.0.0.206", 8080, None))
        self.assertEqual(myservices.forward_target(h, "10.0.0.150", 8073, ""), ("https", "10.0.0.150", 8073, None))


class ProcessReading(unittest.TestCase):
    def conn(self, collect):
        return SimpleNamespace(type="process", name="srv", conf={"ip": "10.0.0.2"}, collect=collect)

    def run_read(self, collect):
        with mock.patch.object(myservices.cbase, "Status", wraps=myservices.cbase.Status), mock.patch.object(myservices, "CONNECTOR_STATUS", []) as seen:
            got = myservices._process_read(self.conn(collect))
        return got, seen[0]

    def test_partial_reading_is_a_warning_not_a_failure(self):
        got, st = self.run_read(lambda: {"ports": {80: {"name": "nginx", "lan": True}}, "hidden": 2})
        self.assertEqual(list(got), [80])
        self.assertTrue(st.ok)
        self.assertIn("lecture partielle", st.warning)

    def test_complete_reading_has_no_warning(self):
        _, st = self.run_read(lambda: {"ports": {}, "hidden": 0})
        self.assertEqual((st.ok, st.warning), (True, ""))

    def test_failure_stays_a_failure(self):
        def boom():
            raise RuntimeError("ssh coupé")
        got, st = self.run_read(boom)
        self.assertEqual((got, st.ok), ({}, False))


class WaitingDns(unittest.TestCase):
    def test_a_waiting_difference_raises_no_alert(self):
        g = {"rewrites_diff": [{"domain": "a.example.org", "answer": "10.0.0.1", "only": "10.0.0.2", "waiting": True},
                               {"domain": "b.example.org", "answer": "10.0.0.1", "only": "10.0.0.2", "waiting": False}],
             "user_rules_diff": [{"rule": "||x^", "only": "10.0.0.2", "waiting": True}, {"rule": "||y^", "only": "10.0.0.2"}], "servers": {}}
        keys = watcher.dns_snaps({"dns": g})
        self.assertEqual(sorted(keys), ["rulediff:||y^", "rwdiff:b.example.org:10.0.0.1"])


if __name__ == "__main__":
    unittest.main()
