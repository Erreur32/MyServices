"""setup.py --check : lecture de la sortie SSH sans le bandeau de connexion (fastfetch dans ~/.bashrc)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.machines import setup  # noqa: E402


class AfterMark(unittest.TestCase):
    def test_bandeau_ignore(self):
        out = "ASCII art\nCPU: AMD\n/dev/sda\n" + setup.MARK + "\nmyuser\nnvme0n1\nsda\n"
        self.assertEqual(setup.after_mark(out).split(), ["myuser", "nvme0n1", "sda"])

    def test_sans_repere_inchange(self):
        self.assertEqual(setup.after_mark("myuser\nsda\n"), "myuser\nsda\n")


if __name__ == "__main__":
    unittest.main()
