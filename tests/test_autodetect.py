"""autodetect.py : AdGuard Home branché tout seul quand un conteneur est vu, une fois par machine."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import autodetect as ad  # noqa: E402

DOCK = {"10.0.0.2": [{"name": "adguardhome", "image": "adguard/adguardhome:latest"}, {"name": "adguardhome-sync", "image": "ghcr.io/bakito/adguardhome-sync:latest"}],
        "10.0.0.3": [{"name": "plex", "image": "plexinc/pms-docker"}], "10.0.0.4": {"containers": [{"name": "dns", "image": "docker.io/adguard/adguardhome:v0.107"}]},
        "10.0.0.5": {"containers": None}}
MACHINES = {ip: {"name": ip, "ssh": f"m-{ip}"} for ip in ("10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5")}


class AdGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / "state" / "adguard-auto.json"

    def test_conteneur_trouve_hors_sync(self):
        self.assertEqual(ad.adguard_container(DOCK["10.0.0.2"]), "adguardhome")        # pas adguardhome-sync
        self.assertEqual(ad.adguard_container(DOCK["10.0.0.4"]), "dns")                # image avec registre et étiquette
        self.assertIsNone(ad.adguard_container(DOCK["10.0.0.3"]))

    def test_une_fois_par_machine(self):
        self.assertEqual(ad.adguard(MACHINES, DOCK, self.state), {"10.0.0.2": "adguardhome", "10.0.0.4": "dns"})
        self.assertEqual(ad.adguard(MACHINES, DOCK, self.state), {})                    # déjà regardées : ne revient pas
        self.assertEqual(sorted(json.loads(self.state.read_text())), ["10.0.0.2", "10.0.0.3", "10.0.0.4"])
        self.assertNotIn("10.0.0.5", json.loads(self.state.read_text()))                # inventaire illisible : retentée

    def test_deja_regle_ou_sans_ssh_ou_desactivee_ignore(self):
        machines = {"10.0.0.2": {"ssh": "a", "adguard": "mon-conteneur"}, "10.0.0.4": {"ssh": None}, "10.0.0.6": {"ssh": "x", "disabled": True}}
        dock = {**DOCK, "10.0.0.6": DOCK["10.0.0.2"]}
        self.assertEqual(ad.adguard(machines, dock, self.state), {})


if __name__ == "__main__":
    unittest.main()
