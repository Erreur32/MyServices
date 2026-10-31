"""What a machine or a web page sends must not hold the server: these texts once took seconds, then minutes, in a regex."""
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from connectors import asus_router, docker_ssh  # noqa: E402
from msv.core import config  # noqa: E402

# CI has no /config/services-meta.json and importing myservices reads it: the example stands in, for the import only
with mock.patch.dict(config.CFG, {"meta": str(ROOT / "services-meta.example.json")}):
    from msv.collect import myservices  # noqa: E402


class SlowPatterns(unittest.TestCase):
    def quick(self, read):
        t0 = time.monotonic()
        got = read()
        self.assertLess(time.monotonic() - t0, 1)
        return got

    def test_a_stray_comma_in_a_router_answer_is_still_read(self):
        self.assertEqual(asus_router.parse('{"a": 1 , , "b": , "c": 2,}'), {"a": 1, "b": None, "c": 2})

    def test_a_long_blank_in_a_router_answer_is_quick(self):
        with self.assertRaises(asus_router.ConnectorError):
            self.quick(lambda: asus_router.parse(" " * 200_000 + "x"))

    def test_internal_addresses_are_read(self):
        out = "web=172.16.0.2/16 db=172.16.0.3/16 \n_host=10.0.0.5/24\nnothing here\nempty= \n"
        self.assertEqual(docker_ssh.parse_internal(out), {"172.16.0.2": "web", "172.16.0.3": "db", "10.0.0.5": "_host"})

    def test_a_long_word_in_an_agent_report_is_quick(self):
        self.assertEqual(self.quick(lambda: docker_ssh.parse_internal("1/" * 128_000)), {})

    def test_generator_is_found(self):
        page = b'<head><meta charset="x"><meta name="generator" content="WordPress 6.5"></head>'
        self.assertEqual(myservices.GENERATOR_RE.search(page).group(1), b"WordPress 6.5")

    def test_a_crafted_page_is_quick(self):
        trap = (b"<meta name='generator' " * 800)[:16384]
        self.assertIsNone(self.quick(lambda: myservices.GENERATOR_RE.search(trap)))
