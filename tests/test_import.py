"""import_install.py : conversion d'une installation classique vers /config (sans toucher l'original).

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.tools import import_install as imp  # noqa: E402


class Convert(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_npm_api_becomes_direct(self):
        npm = self.root / "npm"
        npm.mkdir()
        (npm / "npm-api.sh").write_text("#!/bin/sh\n")
        (npm / "npm-api.conf").write_text('NGINX_IP="127.0.0.1"\nNGINX_PORT=81\nAPI_USER=a@b\nAPI_PASS="p w"\n')
        cfg = imp.convert_config({"npm_api": str(npm / "npm-api.sh"), "web_dir": "/x", "sshlist": "/y",
                                  "discord_webhook": "https://d", "public_url": "old"}, "192.168.1.5",
                                 "http://new/", no_alerts=True)
        self.assertEqual(cfg["npm"], [{"name": "NPM", "url": "http://127.0.0.1:81", "user": "a@b",
                                       "password": "p w", "ip": "192.168.1.5"}])
        self.assertNotIn("npm_api", cfg)
        self.assertNotIn("web_dir", cfg)
        self.assertNotIn("sshlist", cfg)
        self.assertNotIn("discord_webhook", cfg)
        self.assertEqual(cfg["public_url"], "http://new/")

    def test_local_becomes_host_alias(self):
        meta = {"machines": {"1.1.1.1": {"ssh": "local"}, "2.2.2.2": {"ssh": "x", "health": "local"}},
                "process_hosts": {"1.1.1.1": "local", "3.3.3.3": "y"}}
        self.assertEqual(imp.convert_meta(meta), 3)
        self.assertEqual(meta["machines"]["1.1.1.1"]["ssh"], "hote")
        self.assertEqual(meta["machines"]["2.2.2.2"], {"ssh": "x", "health": "hote"})
        self.assertEqual(meta["process_hosts"], {"1.1.1.1": "hote", "3.3.3.3": "y"})

    def test_ssh_keys_copied_and_rewritten(self):
        home = self.root / "home"
        ssh = home / ".ssh"
        ssh.mkdir(parents=True)
        (ssh / "id_a").write_text("PRIV")
        (ssh / "id_a.pub").write_text("PUB")
        (ssh / "known_hosts").write_text("kh")
        (ssh / "config").write_text("Host a\n    HostName 1.2.3.4\n    IdentityFile ~/.ssh/id_a\n"
                                    "Host b\n    IdentityFile /nulle/part\n")
        dest = self.root / "config"
        dest.mkdir()
        keys = imp.convert_ssh(ssh, dest, "192.168.1.5", "root", "myservices")
        text = (dest / "ssh" / "config").read_text()
        self.assertEqual(keys, ["id_a"])
        self.assertIn("IdentityFile ~/.ssh/id_a\n", text)
        self.assertIn("Host hote\n    HostName 192.168.1.5\n    User root\n    IdentityFile ~/.ssh/myservices", text)
        self.assertEqual((dest / "ssh" / "id_a").read_text(), "PRIV")
        self.assertEqual((dest / "ssh" / "known_hosts").read_text(), "kh")
        self.assertEqual((ssh / "config").read_text().count("hote"), 0)  # original intact

    def test_backups_secrets_copied(self):
        sec = self.root / ".veeam-secrets"
        sec.write_text("VEEAM_USER=u\n")
        dest = self.root / "config"
        dest.mkdir()
        bm = {"hosts": [{"id": "v", "api": "veeam", "secrets": str(sec)}, {"id": "l", "ssh": "local"}]}
        imp.convert_backups(bm, dest)
        self.assertEqual(bm["hosts"][0]["secrets"], "/config/secrets/veeam-secrets")
        self.assertEqual((dest / "secrets" / "veeam-secrets").read_text(), "VEEAM_USER=u\n")
        self.assertEqual(bm["hosts"][1]["ssh"], "hote")



class Main(unittest.TestCase):
    """The whole command, end to end: a classic install in, a /config folder out, the original never touched."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.src, self.dest, self.ssh = self.root / "old", self.root / "config", self.root / ".ssh"
        for d in (self.src, self.ssh):
            d.mkdir()
        (self.src / "config.json").write_text(json.dumps({"web_dir": "/x", "public_url": "http://old/"}))
        (self.src / "services-meta.json").write_text(json.dumps({"machines": {"10.0.0.2": {"ssh": "local"}}}))
        (self.src / "backups-meta.json").write_text(json.dumps({"hosts": [{"id": "l", "ssh": "local"}], "sets": [{"id": "s"}]}))
        (self.ssh / "config").write_text("Host nas\n    HostName 10.0.0.3\n")

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, *extra):
        argv = ["import_install.py", "--from", str(self.src), "--to", str(self.dest), "--ssh-dir", str(self.ssh), "--host-ip", "10.0.0.1", *extra]
        with unittest.mock.patch.object(sys, "argv", argv), unittest.mock.patch("builtins.print"), unittest.mock.patch.object(imp, "say"):
            return imp.main()

    def test_converts_into_an_empty_folder(self):
        self.assertEqual(self.run_main(), 0)
        cfg = json.loads((self.dest / "config.json").read_text())
        self.assertNotIn("web_dir", cfg)
        self.assertEqual(json.loads((self.dest / "services-meta.json").read_text())["machines"]["10.0.0.2"]["ssh"], "hote")
        self.assertEqual(json.loads((self.dest / "backups-meta.json").read_text())["hosts"][0]["ssh"], "hote")
        self.assertIn("Host hote", (self.dest / "ssh" / "config").read_text())
        self.assertEqual((self.dest / "config.json").stat().st_mode & 0o777, 0o600)   # locked down
        self.assertIn("web_dir", (self.src / "config.json").read_text())            # original intact

    def test_refuses_a_filled_folder_without_force(self):
        self.dest.mkdir()
        (self.dest / "keep").write_text("x")
        with self.assertRaises(SystemExit):
            self.run_main()
        self.assertEqual(self.run_main("--force"), 0)

    def test_refuses_what_is_not_an_install(self):
        (self.src / "services-meta.json").unlink()
        with self.assertRaises(SystemExit):
            self.run_main()

if __name__ == "__main__":
    unittest.main()
