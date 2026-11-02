"""A service that does not answer gives a plain result, whatever the failure: urllib wraps most of them in URLError, an OSError."""
import http.client
import socket
import sys
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from msv.core import config  # noqa: E402
from msv.machines import setup  # noqa: E402

# CI has no /config/services-meta.json and importing myservices reads it: the example stands in, for the import only
with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    from msv.collect import myservices  # noqa: E402

REFUSED = urllib.error.URLError(ConnectionRefusedError())


class ProbeErrors(unittest.TestCase):
    def test_https_gives_the_cause_of_a_url_error(self):
        with mock.patch.object(myservices, "_get", side_effect=REFUSED):
            self.assertEqual(myservices.probe_https("a.example.test"), {"code": None, "err": "ConnectionRefusedError"})

    def test_https_gives_a_plain_network_error(self):
        with mock.patch.object(myservices, "_get", side_effect=TimeoutError()):
            self.assertEqual(myservices.probe_https("a.example.test"), {"code": None, "err": "TimeoutError"})

    def test_https_keeps_the_code_of_a_failed_lookup(self):
        lost = urllib.error.URLError(socket.gaierror(-3, "Temporary failure in name resolution"))
        with mock.patch.object(myservices, "_get", side_effect=lost):
            self.assertEqual(myservices.probe_https("a.example.test"), {"code": None, "err": "gaierror", "errno": -3})

    def test_a_lost_lookup_of_a_name_the_dns_answers_is_marked(self):
        rows = [{"domains": ["A.example.test"], "public": {"err": "gaierror"}, "dns": {"answers": {"a.example.test": {"10.0.0.2": ["10.0.0.9"], "10.0.0.3": None}}}},
                {"domains": ["b.example.test"], "public": {"err": "gaierror"}, "dns": {"answers": {"b.example.test": {"10.0.0.2": []}}}},
                {"domains": ["c.example.test"], "public": {"err": "gaierror"}},
                {"domains": ["d.example.test"], "public": {"code": 200}, "dns": {"answers": {"d.example.test": {"10.0.0.2": ["10.0.0.9"]}}}}]
        myservices.mark_dns_ok(rows)
        self.assertEqual([r["public"].get("dns_ok") for r in rows], [True, None, None, None])

    def test_follow_gives_the_cause_of_each_failure(self):
        for failure, name in ((REFUSED, "ConnectionRefusedError"), (http.client.BadStatusLine("x"), "BadStatusLine"), (ValueError(), "ValueError")):
            with mock.patch.object(myservices._opener_title, "open", side_effect=failure):
                self.assertEqual(myservices.probe_follow("a.example.test"), {"code": None, "err": name})

    def test_web_tries_both_schemes_then_gives_up(self):
        with mock.patch.object(myservices, "_fetch", side_effect=REFUSED) as fetch:
            self.assertIsNone(myservices.probe_web("http", "10.0.0.5", 8080))
        self.assertEqual([c.args[0] for c in fetch.call_args_list], ["http", "https"])


class PageUrl(unittest.TestCase):
    def test_port_read_from_ss(self):
        line = 'LISTEN 0 511 0.0.0.0:8066 0.0.0.0:* users:(("apache2",pid=999999,fd=4))\nLISTEN 0 511 [::]:9000 [::]:* users:(("other",pid=999998,fd=4))\n'
        answer = mock.MagicMock()
        answer.__enter__.return_value.status = 200
        with mock.patch.object(setup, "run", return_value=SimpleNamespace(stdout=line)), \
                mock.patch.object(setup.urllib.request, "urlopen", return_value=answer):
            self.assertEqual(setup.page_url("10.0.0.5"), "http://10.0.0.5:8066/myservices/")


if __name__ == "__main__":
    unittest.main()
