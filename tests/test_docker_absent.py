"""Docker absent d'une machine ≠ Docker inaccessible : seul le second est une panne (clé non autorisée, compte hors du groupe docker).

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import docker_ssh  # noqa: E402


def fake(rc, out="", err=""):
    return mock.Mock(returncode=rc, stdout=out, stderr=err)


class DockerAbsent(unittest.TestCase):
    def read(self, result):
        absent = []
        with mock.patch.object(docker_ssh.subprocess, "run", return_value=result):
            return docker_ssh.docker_containers("srv", absent), bool(absent)

    def test_commande_introuvable_n_est_pas_une_panne(self):
        self.assertEqual(self.read(fake(127, err="bash: docker : commande introuvable")), ([], True))
        self.assertEqual(self.read(fake(1, err="sh: 1: docker: not found")), ([], True))
        self.assertEqual(self.read(fake(1, err="bash: line 1: docker: command not found")), ([], True))

    def test_acces_refuse_reste_une_panne(self):
        self.assertEqual(self.read(fake(1, err="permission denied while trying to connect to the Docker daemon socket")), (None, False))
        self.assertEqual(self.read(fake(255, err="Permission denied (publickey).")), (None, False))  # clé SSH non autorisée

    def test_docker_present_sans_conteneur(self):
        self.assertEqual(self.read(fake(0, out="")), ([], False))

    def test_test_du_connecteur_le_dit(self):
        conn = docker_ssh.DockerSSH({"name": "x", "ssh": "srv", "ip": "10.0.0.2"}, mock.Mock())
        with mock.patch.object(docker_ssh.subprocess, "run", return_value=fake(127, err="docker: command not found")):
            r = conn.test()
        self.assertTrue(r.ok)
        self.assertIn("pas de Docker", r.message)
        with mock.patch.object(docker_ssh.subprocess, "run", return_value=fake(255, err="Permission denied")):
            self.assertFalse(conn.test().ok)

    def test_collect_sans_docker_ne_lit_pas_les_reseaux(self):
        conn = docker_ssh.DockerSSH({"name": "x", "ssh": "srv", "ip": "10.0.0.2"}, mock.Mock())
        with mock.patch.object(docker_ssh.subprocess, "run", return_value=fake(127, err="docker: command not found")):
            got = conn.collect()
        self.assertEqual((got["containers"], got["absent"], got["internal"]), ([], True, {}))


if __name__ == "__main__":
    unittest.main()
