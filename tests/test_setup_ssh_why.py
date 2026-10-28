"""setup.py refused_key_text: the message names the key THIS alias uses (an alias can carry a key of its own).

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from msv.machines import setup as setup_mod
except ImportError:
    setup_mod = None


@unittest.skipIf(setup_mod is None, "setup.py not importable here")
class RefusedKey(unittest.TestCase):
    def test_names_the_account_and_the_public_key_of_the_alias(self):
        with tempfile.TemporaryDirectory() as d:
            key = Path(d) / "id_ed25519_box"
            Path(str(key) + ".pub").write_text("ssh-ed25519 AAAApublic box\n")
            out = f"user debian32\nidentityfile {key}\nidentityfile {d}/missing\n"
            with mock.patch.object(setup_mod.subprocess, "run", return_value=SimpleNamespace(stdout=out)):
                text = setup_mod.refused_key_text("box")
        self.assertIn("id_ed25519_box", text)
        self.assertIn("« debian32 »", text)
        self.assertIn("ssh-ed25519 AAAApublic box", text)

    def test_falls_back_to_the_general_advice_without_a_key(self):
        with mock.patch.object(setup_mod.subprocess, "run", return_value=SimpleNamespace(stdout="user root\n")):
            self.assertIn("clé publique de /config/ssh", setup_mod.refused_key_text("box"))


if __name__ == "__main__":
    unittest.main()
