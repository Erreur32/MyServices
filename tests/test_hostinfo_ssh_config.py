"""hostinfo.ssh_config: the aliases of ~/.ssh/config, the key kept being the first one listed (the one SSH tries first).

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import hostinfo  # noqa: E402


class SshConfig(unittest.TestCase):
    def test_the_first_key_is_kept(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "config").write_text("Host nas\n    HostName 10.0.0.4\n    User root\n    IdentityFile ~/.ssh/myservices\n    IdentityFile ~/.ssh/myservices_ecdsa\n"
                                             "Host pc\n    HostName 10.0.0.5\n    Port 2222\n    IdentityFile ~/.ssh/id_perso\n")
            with mock.patch.object(hostinfo, "SSH_DIR", Path(d)):
                got = hostinfo.ssh_config()
        self.assertEqual(got["10.0.0.4"]["identity"], "~/.ssh/myservices")   # the ECDSA key is only offered after it, for ESXi
        self.assertEqual((got["10.0.0.5"]["identity"], got["10.0.0.5"]["port"]), ("~/.ssh/id_perso", 2222))


if __name__ == "__main__":
    unittest.main()
