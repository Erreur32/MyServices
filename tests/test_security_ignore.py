"""Security page: the findings not signalled any more (security_ignore.py)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.machines import security_ignore  # noqa: E402


class SecurityIgnore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.meta = self.d / "services-meta.json"
        self.meta.write_text(json.dumps({"machines": {}, "services": {"a:1": {"description": "kept"}}}))
        (self.d / "data.json").write_text(json.dumps({"hosts": [], "security_ignore": []}))

    def tearDown(self):
        self.tmp.cleanup()

    def test_set_keeps_the_rest_of_the_meta_and_publishes_at_once(self):
        keys = ["ports|Myoueb|139 NetBIOS · 445 SMB", "certs:*", "ports|Myoueb|139 NetBIOS · 445 SMB"]
        self.assertEqual(security_ignore.set_keys(self.meta, self.d, keys), ["certs:*", "ports|Myoueb|139 NetBIOS · 445 SMB"])
        self.assertEqual(security_ignore.read(self.meta), ["certs:*", "ports|Myoueb|139 NetBIOS · 445 SMB"])
        self.assertEqual(json.loads(self.meta.read_text())["services"], {"a:1": {"description": "kept"}})
        self.assertEqual(json.loads((self.d / "data.json").read_text())["security_ignore"], ["certs:*", "ports|Myoueb|139 NetBIOS · 445 SMB"])

    def test_an_empty_list_clears_the_key(self):
        security_ignore.set_keys(self.meta, self.d, ["ports:*"])
        self.assertEqual(security_ignore.set_keys(self.meta, self.d, []), [])
        self.assertNotIn("security_ignore", json.loads(self.meta.read_text()))
        self.assertEqual(json.loads((self.d / "data.json").read_text())["security_ignore"], [])

    def test_bad_keys_are_refused(self):
        for bad in ("nothing", "unknown:*", "ports:x", "ports|only-title", "ports|a|b\nc", "x" * 400, "sites:*|y"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                security_ignore.set_keys(self.meta, self.d, [bad])
        self.assertEqual(security_ignore.read(self.meta), [])

    def test_read_without_a_file(self):
        self.assertEqual(security_ignore.read(self.d / "none.json"), [])


if __name__ == "__main__":
    unittest.main()
