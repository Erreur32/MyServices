"""Services hidden from « To watch »: kept with the signature of their problem, shown again on request, the file never broken."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import services_hidden as sh  # noqa: E402


class ServicesHidden(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.f = Path(self.dir.name) / "state" / "services-watch-hidden.json"

    def tearDown(self):
        self.dir.cleanup()

    def test_hide_then_show_again(self):
        sh.set_hidden(self.f, "proxy12", "bad|backend down|down", "mail.lan", True)
        got = sh.read(self.f)
        self.assertEqual((got["proxy12"]["sig"], got["proxy12"]["name"]), ("bad|backend down|down", "mail.lan"))
        sh.set_hidden(self.f, "proxy12", "", "", False)
        self.assertEqual(sh.read(self.f), {})

    def test_hiding_again_takes_the_new_signature(self):
        sh.set_hidden(self.f, "proxy12", "warn|sans ACL|", "x", True)
        sh.set_hidden(self.f, "proxy12", "bad|backend down|down", "x", True)
        self.assertEqual(sh.read(self.f)["proxy12"]["sig"], "bad|backend down|down")

    def test_missing_or_broken_file_reads_empty(self):
        self.assertEqual(sh.read(self.f), {})
        self.f.parent.mkdir(parents=True)
        self.f.write_text("{pas du json", encoding="utf-8")
        self.assertEqual(sh.read(self.f), {})

    def test_bad_key_refused(self):
        with self.assertRaises(ValueError):
            sh.set_hidden(self.f, "", "s", "n", True)
        with self.assertRaises(ValueError):
            sh.set_hidden(self.f, "k" * 201, "s", "n", True)


if __name__ == "__main__":
    unittest.main()
