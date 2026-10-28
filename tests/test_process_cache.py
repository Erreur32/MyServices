"""Listening ports (ss) kept PROCESS_CACHE_TTL: read over SSH every other collection, the last reading in between.

  python3 -m unittest tests.test_process_cache
"""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import myservices  # noqa: E402


class ProcessCache(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "process.json")
        self.patch = mock.patch.object(myservices, "PROCESS_CACHE", self.path)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.dir.cleanup()

    def conn(self, calls):
        c = mock.Mock(type="process", name="10.0.0.2", conf={"ip": "10.0.0.2", "label": "srv"})
        c.collect = lambda: calls.append(1) or {"ports": {22: {"process": "sshd"}}, "hidden": 0}
        return c

    def test_une_lecture_ssh_puis_le_cache(self):
        calls, fresh = [], {}
        self.assertEqual(myservices._process_read(self.conn(calls), fresh), {22: {"process": "sshd"}})
        myservices._process_store(fresh)
        again = myservices._process_read(self.conn(calls), {})
        self.assertEqual((again, len(calls)), ({22: {"process": "sshd"}}, 1))   # port numbers stay numbers, no second SSH read

    def test_cache_perime_ou_absent(self):
        self.assertIsNone(myservices._process_cached("10.0.0.2"))
        myservices._process_store({"10.0.0.2": {"ports": {"22": {}}, "hidden": 0, "t": time.time() - myservices.PROCESS_CACHE_TTL}})
        self.assertIsNone(myservices._process_cached("10.0.0.2"))
        calls = []
        myservices._process_read(self.conn(calls))   # no `fresh`: read now, cache left aside
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
