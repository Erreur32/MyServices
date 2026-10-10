"""Vérification d'une machine (bouton « Tester » de la carte « Autoriser la clé ») : un accès SSH qui répond
doit invalider l'inventaire Docker en cache, sinon la collecte suivante rejoue le relevé raté d'avant la clé.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import machines_admin  # noqa: E402


class CheckExpiresInventory(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name) / "docker.json"
        self.cache.write_text(json.dumps({"ts": 1791636409.0, "data": {"10.0.0.1": None}}), encoding="utf-8")
        p = mock.patch.dict("config.CFG", {"cache_dir": self.tmp.name})
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def run_check(self, failed):
        def fake_check(ip, m, aliases):
            if failed:
                machines_admin.setup.FAILED.append("ssh")
        with mock.patch.object(machines_admin, "_meta", return_value={"machines": {"10.0.0.1": {}}}), \
                mock.patch.object(machines_admin.setup, "check_machine", fake_check), \
                mock.patch.object(machines_admin.setup, "ssh_aliases", return_value={}):
            return machines_admin.check("10.0.0.1")

    def test_machine_designee_par_son_nom(self):
        """Le bouton « Tester » envoie le nom du connecteur (nom de la machine), pas son IP."""
        meta = {"machines": {"10.0.0.1": {"name": "dev"}}}
        seen = []
        with mock.patch.object(machines_admin, "_meta", return_value=meta), \
                mock.patch.object(machines_admin.setup, "check_machine", lambda ip, m, a: seen.append(ip)), \
                mock.patch.object(machines_admin.setup, "ssh_aliases", return_value={}):
            self.assertEqual(machines_admin.check("dev")["failed"], 0)
            self.assertEqual(machines_admin.check("10.0.0.1")["failed"], 0)
            with self.assertRaises(machines_admin.MachineError):
                machines_admin.check("inconnue")
        self.assertEqual(seen, ["10.0.0.1", "10.0.0.1"])

    def test_ssh_ok_expire_le_cache(self):
        self.assertEqual(self.run_check(failed=False)["failed"], 0)
        self.assertEqual(json.loads(self.cache.read_text())["ts"], 0)

    def test_ssh_en_echec_garde_le_cache(self):
        self.assertEqual(self.run_check(failed=True)["failed"], 1)
        self.assertEqual(json.loads(self.cache.read_text())["ts"], 1791636409.0)


class SshAlias(unittest.TestCase):
    """Préparer l'accès SSH d'une machine trouvée : bloc « Host » avec la clé de l'app, sans doublon."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.conf = Path(self.tmp.name) / "config"
        self.aliases = {}
        for p in (mock.patch.object(machines_admin.setup, "SSH_CONF", str(self.conf)),
                  mock.patch.object(machines_admin.setup, "DOCKER", True),
                  mock.patch.object(machines_admin.setup, "ssh_aliases", lambda: self.aliases)):
            p.start()
            self.addCleanup(p.stop)

    def test_cree_un_alias(self):
        r = machines_admin.add_alias("192.168.1.20", "pi", 2222)
        self.assertEqual(r, {"alias": "m-192-168-1-20", "created": True})
        txt = self.conf.read_text()
        for line in ("Host m-192-168-1-20", "HostName 192.168.1.20", "User pi", "Port 2222", "IdentityFile ~/.ssh/myservices",
                     "IdentitiesOnly yes", "StrictHostKeyChecking accept-new"):
            self.assertIn(line, txt)
        self.assertEqual(self.conf.stat().st_mode & 0o777, 0o600)

    def test_alias_existant_repris(self):
        self.aliases["192.168.1.20"] = "nas"
        self.assertEqual(machines_admin.add_alias("192.168.1.20"), {"alias": "nas", "created": False})
        self.assertFalse(self.conf.exists())

    def test_refus(self):
        for args in (("pas-une-ip",), ("192.168.1.20", "Root; rm"), ("192.168.1.20", "root", 0), ("192.168.1.20", "root", 70000)):
            with self.assertRaises(machines_admin.MachineError, msg=args):
                machines_admin.add_alias(*args)

    def test_hors_docker(self):
        with mock.patch.object(machines_admin.setup, "DOCKER", False), self.assertRaises(machines_admin.MachineError):
            machines_admin.add_alias("192.168.1.20")


if __name__ == "__main__":
    unittest.main()
