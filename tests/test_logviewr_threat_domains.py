"""LogviewR threats get the domains their addresses went after (connectors/logviewr.py add_threat_domains).

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import logviewr  # noqa: E402
from connectors.base import ConnectorError  # noqa: E402


def web_hit(domain):
    return [{"pluginId": "npm", "domain": domain}]


class ThreatDomains(unittest.TestCase):
    def test_known_addresses_are_not_searched_again(self):
        stats = {"top_ips": [{"ip": "203.0.113.5", "domains": [{"domain": "a.test", "hits": 4}]}]}
        calls = []
        got = logviewr.add_threat_domains([{"ips": ["203.0.113.5"]}], stats, lambda ip: calls.append(ip) or [])
        self.assertEqual((got[0]["domains"], calls), (["a.test"], []))

    def test_searches_are_capped_and_a_failure_is_survived(self):
        calls = []

        def search(ip):
            calls.append(ip)
            if ip.endswith(".1"):
                raise ConnectorError("down")
            return web_hit("b.test")

        threats = [{"ips": [f"203.0.{n}.{i}" for i in range(1, 4)]} for n in range(4)]   # 12 distinct addresses
        threats = logviewr.add_threat_domains(threats, None, search)
        self.assertEqual(len(calls), logviewr.THREAT_LOOKUPS)
        self.assertEqual(threats[0]["domains"], ["b.test"])


if __name__ == "__main__":
    unittest.main()
