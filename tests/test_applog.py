"""applog.py: what the container prints is kept, line by line, and read back from a given number."""
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import applog  # noqa: E402


class AppLog(unittest.TestCase):
    def setUp(self):
        applog._lines.clear()

    def test_lines_are_kept_and_written_through(self):
        out, err = io.StringIO(), io.StringIO()
        o, e = applog._Tee(out, False), applog._Tee(err, True)
        o.write("collect : démarré\n  [collect] 3 mach")
        o.write("ines\n\n")
        e.write("Traceback (most recent call last):\n")
        got = applog.lines()["lines"]
        self.assertEqual([(x["text"], x["err"]) for x in got],
                         [("collect : démarré", False), ("  [collect] 3 machines", False), ("Traceback (most recent call last):", True)])
        self.assertEqual(out.getvalue(), "collect : démarré\n  [collect] 3 machines\n\n")   # the real stream sees everything

    def test_read_after_a_number(self):
        t = applog._Tee(io.StringIO(), False)
        t.write("a\nb\nc\n")
        first = applog.lines()["lines"][0]["n"]
        self.assertEqual([x["text"] for x in applog.lines(first)["lines"]], ["b", "c"])


if __name__ == "__main__":
    unittest.main()
