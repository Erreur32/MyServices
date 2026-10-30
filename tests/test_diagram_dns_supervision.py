"""archify_extra: the DNS and supervision diagrams."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.diagram import archify_extra as x  # noqa: E402

DATA = {
    "generated": "2026-10-29T10:00:00+00:00",
    "machine_list": [
        {"ip": "10.0.0.2", "name": "srv", "ssh": {"user": "root", "port": 22}, "agent": None,
         "links": {"sources": [{"source": "beszel", "label": "Beszel", "ok": True}, {"source": "unifi", "label": "UniFi", "ok": True}]}},
        {"ip": "10.0.0.3", "name": "PC", "agent": {"os": "Windows 11"}, "ssh": None, "links": {"sources": []}},
    ],
    "services_status": [{"connector": "wazuh", "machines": {"10.0.0.3": {"agent": "PC", "status": "active"}}}],
    "dns": {"npm_ip": "10.0.0.2", "servers": {"10.0.0.2": {"name": "srv", "container": "adguardhome", "readable": True, "rewrites": 3, "user_rules": 1, "silent": 0}},
            "sync": {"10.0.0.2": {"last_done": {"10.0.0.9": "2026-10-29T09:00:00"}, "errors_24h": 0, "errors_open": 0}},
            "machines": [{"ip": "10.0.0.3", "name": "PC", "state": "ok", "answer": ["10.0.0.3"]}], "orphans": ["a"]},
}


def coherent(test, spec):
    ids = {c["id"] for c in spec["components"]}
    test.assertEqual(len(ids), len(spec["components"]), "duplicate ids")
    test.assertTrue(all(c["from"] in ids and c["to"] in ids for c in spec["connections"]))
    test.assertLessEqual(spec["layout"]["cols"], 12)


class DnsSupervision(unittest.TestCase):
    def test_supervision_groups_by_tool_without_network_discovery_tools(self):
        rows = x._watchers(DATA)
        self.assertEqual(set(rows), {"Beszel", "Lecture SSH", "Agent MyServices", "Wazuh"})   # UniFi only discovers: not listed
        coherent(self, x.build_supervision(DATA))

    def test_dns_has_servers_answers_and_gaps(self):
        spec = x.build_dns(DATA)
        coherent(self, spec)
        labels = {c["label"] for c in spec["components"]}
        self.assertIn("Réponses aux machines", labels)
        self.assertIn("Écarts à regarder", labels)

    def test_available(self):
        self.assertTrue(x.available("dns", DATA) and x.available("supervision", DATA))
        self.assertFalse(x.available("dns", {}) or x.available("supervision", {}))


if __name__ == "__main__":
    unittest.main()
