"""myservices.advanced_target: a proxy_pass in `location /` of the advanced config is the real backend of an NPM host.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from msv.core import config  # noqa: E402

from unittest import mock  # noqa: E402

# CI has no /config/services-meta.json and importing myservices reads it: the example stands in, for the import only (the global config is left as it was)
with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    import myservices  # noqa: E402


class AdvancedTarget(unittest.TestCase):
    def test_root_location(self):
        adv = "location / {\n  proxy_set_header Host $host;\n  proxy_pass http://10.0.0.206:8080;\n}\n"
        self.assertEqual(myservices.advanced_target(adv), ("http", "10.0.0.206", 8080))

    def test_default_ports(self):
        self.assertEqual(myservices.advanced_target("location / { proxy_pass https://10.0.0.5; }"), ("https", "10.0.0.5", 443))

    def test_other_location_variable_or_empty(self):
        self.assertIsNone(myservices.advanced_target("location /api { proxy_pass http://10.0.0.5:80; }"))
        self.assertIsNone(myservices.advanced_target("location / { proxy_pass http://$backend; }"))
        self.assertIsNone(myservices.advanced_target("location / { proxy_pass http://app.local:80; }"))
        self.assertIsNone(myservices.advanced_target(""))


if __name__ == "__main__":
    unittest.main()
