"""Fusion des sources de santé (health.py : source_order, read_host, complement) : priorité réglable, repli quand une source
se tait, une source ne complète que ce que la première n'a pas lu, poste « souvent éteint », validation côté machines_admin.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from msv.collect import health
    from msv.machines import machines_admin
except ImportError:
    health = None

DATA = {"disks": [{"m": "C:", "s": 500e9, "f": 400e9}], "cpu": 12, "mem": 41.5, "pd": [{"n": "SSD", "h": "Healthy"}],
        "ev": [], "fail": 0, "upd": [], "svc": [], "ncpu": 8}


def hc(**kw):
    return {"id": "pc", "name": "PC · 192.168.1.60", "os": "linux", "ip": "192.168.1.60", "target": "pc", "off": False, "sources": [], **kw}


def agent(fresh=True):
    return {"report": {"data": DATA}, "seen": time.time(), "fresh": fresh}


def beszel(up=True):
    return {"status": "up" if up else "down", "disks": [{"mount": "/", "size_gb": 100, "used_gb": 10, "used_pct": 10}],
            "cpu": 3.0, "mem_pct": 20.0, "temp": 51.0, "smart": [{"name": "nvme0", "state": "PASSED"}], "cores": 4}


def ssh_ok(host, **extra):
    h = {"id": host["id"], "name": host["name"], "reachable": True, "disks": [], "systemd": {"failed": []},
         "docker": {"accessible": False}, "apt": {"upgradable": 0, "sample": [], "available": True},
         "kernel": {"has_errors": False, "samples": []}, "reboot_required": False,
         "load": {"load_1": 0.1, "ncpu": 4, "available": True}, "ssh_auth": {"failed_24h": 0, "available": True},
         "smart": {"accessible": False, "disks": []}, "temp": {"available": False}, "res": {"available": False}, **extra}
    h["level"] = health.host_level(h)
    return h


def ssh_down(host):
    return {"id": host["id"], "name": host["name"], "reachable": False, "disks": [], "systemd": {"failed": []},
            "docker": {"accessible": False}, "level": "down", **health._EMPTY_HOST_EXTRAS}


@unittest.skipIf(health is None, "dépendances absentes : tests à lancer dans l'image")
class Sources(unittest.TestCase):
    def test_ordre_par_defaut_et_reglage(self):
        self.assertEqual(health.source_order(hc()), ["ssh", "agent", "beszel", "ha"])
        self.assertEqual(health.source_order(hc(os="windows")), ["agent", "ssh", "beszel", "ha"])
        self.assertEqual(health.source_order(hc(sources=["beszel"])), ["beszel", "ssh", "agent", "ha"])
        self.assertEqual(health.source_order(hc(sources=["agent", "agent", "nimporte"])), ["agent", "ssh", "beszel", "ha"])
        # a fresh agent goes first; a stale one does not; an order set by hand stays
        self.assertEqual(health.source_order(hc(), agent()), ["agent", "ssh", "beszel", "ha"])
        self.assertEqual(health.source_order(hc(), agent(fresh=False)), ["ssh", "agent", "beszel", "ha"])
        self.assertEqual(health.source_order(hc(sources=["ssh"]), agent()), ["ssh", "agent", "beszel", "ha"])

    def test_la_premiere_source_qui_repond_fait_foi(self):
        h = health.read_host(hc(), agent(fresh=False), beszel(), ssh=ssh_ok)
        self.assertEqual(h["source"], "ssh")
        self.assertEqual(h["sources"][0], "ssh")

    def test_agent_frais_d_abord_sans_ouvrir_le_ssh(self):
        calls = []
        h = health.read_host(hc(), agent(), beszel(), ssh=lambda x: calls.append(1) or ssh_ok(x))
        self.assertEqual(h["source"], "agent")
        self.assertEqual(calls, [])

    def test_priorite_changee_agent_d_abord(self):
        calls = []
        h = health.read_host(hc(sources=["agent"]), agent(), beszel(), ssh=lambda x: calls.append(1) or ssh_ok(x))
        self.assertEqual(h["source"], "agent")
        self.assertEqual(calls, [])  # SSH n'est pas relancé quand une source plus prioritaire répond

    def test_repli_quand_ssh_se_tait(self):
        h = health.read_host(hc(), agent(), beszel(), ssh=ssh_down)
        self.assertEqual((h["source"], h["reachable"]), ("agent", True))
        h = health.read_host(hc(), agent(fresh=False), beszel(), ssh=ssh_down)
        self.assertEqual((h["source"], h["reachable"]), ("beszel", True))

    def test_toutes_muettes_injoignable_sauf_poste_eteint(self):
        h = health.read_host(hc(), None, beszel(up=False), ssh=ssh_down)
        self.assertEqual((h["reachable"], h["level"], h["source"]), (False, "down", "ssh"))
        self.assertIsNone(health.read_host(hc(off=True), None, None, ssh=ssh_down))
        self.assertIsNone(health.read_host(hc(off=True, target=None), agent(fresh=False), None))

    def test_poste_eteint_garde_sa_fiche_grisee(self):
        a = health.asleep_entry(hc(off=True), agent(fresh=False))
        self.assertEqual((a["id"], a["ip"], a["os"]), ("pc", "192.168.1.60", "linux"))
        self.assertIsNotNone(a["last_seen"])
        self.assertIsNone(health.asleep_entry(hc(off=True), None)["last_seen"])

    def test_machine_sans_aucune_source(self):
        self.assertIsNone(health.read_host(hc(target=None), None, None))

    def test_complement_seulement_ce_qui_manque(self):
        h = health.read_host(hc(sources=["ssh"]), agent(), beszel(), ssh=ssh_ok)   # SSH first by hand: the fresh agent only complements
        self.assertEqual(h["res"], {"available": True, "cpu_pct": 12.0, "mem_pct": 41.5})  # agent, 1re source qui sait
        self.assertEqual(h["temp"]["celsius"], 51.0)                                       # Beszel : l'agent n'a pas de température
        self.assertTrue(h["smart"]["accessible"])
        self.assertEqual(h["sources"], ["ssh", "agent", "beszel"])
        # ce que SSH a lu n'est jamais écrasé
        h = health.read_host(hc(), None, beszel(), ssh=lambda x: ssh_ok(x, res={"available": True, "cpu_pct": 99.0, "mem_pct": 1.0}))
        self.assertEqual(h["res"]["cpu_pct"], 99.0)
        self.assertEqual(h["sources"], ["ssh", "beszel"])

    def test_agent_perime_ne_complete_pas(self):
        h = health.read_host(hc(), agent(fresh=False), None, ssh=ssh_ok)
        self.assertEqual(h["sources"], ["ssh"])
        self.assertFalse(h["res"]["available"])

    def test_vm_sans_smart_n_est_pas_complete(self):
        h = health.read_host(hc(), None, beszel(), ssh=lambda x: ssh_ok(x, smart={"accessible": False, "disks": [], "vm": True}))
        self.assertFalse(h["smart"]["accessible"])

    def test_inventaire_relu_machine_par_machine(self):
        import json
        import tempfile
        from msv.core import inventory_cache as ic
        with tempfile.TemporaryDirectory() as d:
            path, reads = str(Path(d) / "docker.json"), []

            def read(only):
                reads.append(sorted(only) if only is not None else None)
                ips = only if only is not None else {"10.0.0.1", "10.0.0.2"}
                return {**{ip: [f"c{len(reads)}"] for ip in ips}, "_internal": {ip: {} for ip in ips}, "_hostinfo": {ip: {"n": len(reads)} for ip in ips}}
            first = ic.refresh(path, 7200, read)                       # tout relu
            self.assertEqual(ic.refresh(path, 7200, read), first)      # cache : aucune lecture
            ic.mark_stale(path, "10.0.0.2")
            out = ic.refresh(path, 7200, read)                         # seule 10.0.0.2 est relue
            self.assertEqual(reads, [None, ["10.0.0.2"]])
            self.assertEqual((out["10.0.0.1"], out["10.0.0.2"]), (["c1"], ["c2"]))
            self.assertEqual(out["_hostinfo"]["10.0.0.2"], {"n": 2})
            self.assertEqual(json.loads(Path(path).read_text())["stale"], [])
            ic.refresh(path, 7200, read)
            self.assertEqual(len(reads), 2)                            # plus rien à relire
            ic.refresh(path, 7200, read, force={"10.0.0.1"})           # ping changé : cette machine seule
            self.assertEqual(reads[-1], ["10.0.0.1"])
            ic.mark_stale(path)                                        # sans machine : tout est relu
            ic.refresh(path, 7200, read)
            self.assertEqual(reads[-1], None)

    def test_lecture_ratee_reste_a_relire(self):
        import json
        import tempfile
        from msv.core import inventory_cache as ic
        with tempfile.TemporaryDirectory() as d:
            path = str(Path(d) / "docker.json")
            ic.refresh(path, 7200, lambda only: {"10.0.0.1": ["a"], "_internal": {}, "_hostinfo": {}})
            ic.mark_stale(path, "10.0.0.1")
            ic.refresh(path, 7200, lambda only: {"10.0.0.1": None, "_internal": {}, "_hostinfo": {}})  # clé pas encore autorisée
            self.assertEqual(json.loads(Path(path).read_text())["stale"], ["10.0.0.1"])
            # un tout premier passage raté : cache déjà périmé, relu au suivant
            path2 = str(Path(d) / "autre.json")
            ic.refresh(path2, 7200, lambda only: {"10.0.0.1": None, "_internal": {}, "_hostinfo": {}})
            self.assertIsNone(ic.load(path2, 7200))

    def test_machines_admin_valide_la_priorite(self):
        ok = machines_admin._clean({"name": "PC", "health_sources": ["agent", "ssh", "agent"]})
        self.assertEqual(ok["health_sources"], ["agent", "ssh"])
        self.assertNotIn("health_sources", machines_admin._clean({"name": "PC", "health_sources": []}))
        for bad in (["telepathie"], "agent", [1]):
            with self.assertRaises(machines_admin.MachineError):
                machines_admin._clean({"name": "PC", "health_sources": bad})


if __name__ == "__main__":
    unittest.main()


@unittest.skipIf(health is None, "dépendances absentes : tests à lancer dans l'image")
class ApiSource(unittest.TestCase):
    """A machine read through a service's API (Glances on the machine, Home Assistant's host): named after that service."""

    def test_glances_named(self):
        h = health.read_host(hc(target=None), None, None, api={**beszel(), "via": "Glances"})
        self.assertEqual((h["source"], h["api_name"], h["reachable"]), ("ha", "Glances", True))
        self.assertEqual(h["disks"][0]["mount"], "/")

    def test_home_assistant_by_default(self):
        h = health.read_host(hc(target=None), None, None, api=beszel())
        self.assertEqual(h["api_name"], "Home Assistant")


@unittest.skipIf(health is None, "dépendances absentes : tests à lancer dans l'image")
class BeszelExtras(unittest.TestCase):
    """Beszel's containers fill the Docker part of the health, its sensors the temperature."""

    def test_containers_and_sensors(self):
        sys_ = {**beszel(), "sensors": [{"name": "core", "celsius": 51.0}],
                "containers": [{"name": "web", "image": "nginx", "status": "Up 2 days", "health": "unhealthy", "cpu": 2.0, "memory_mb": 60, "updatable": True},
                               {"name": "db", "image": "pg", "status": "Up 2 days", "health": None, "cpu": 1.0, "memory_mb": 300, "updatable": False}]}
        h = health.read_host(hc(target=None), None, sys_)
        d = h["docker"]
        self.assertEqual((d["accessible"], d["total"], d["unhealthy"], d["healthy"], d["image_updates"]), (True, 2, 1, 1, ["web"]))
        self.assertEqual((d["top"][0]["name"], d["total_cpu"], d["issues"][0]["name"]), ("web", 3.0, "web"))
        self.assertEqual(h["temp"]["sensors"], [{"name": "core", "celsius": 51.0}])

    def test_no_docker(self):
        self.assertFalse(health.read_host(hc(target=None), None, beszel())["docker"]["accessible"])

    def test_sensors_complete_ssh(self):
        """SSH reads the temperature, Beszel adds every sensor; with no temperature from SSH, Beszel's is taken whole."""
        sys_ = {**beszel(), "sensors": [{"name": "core", "celsius": 51.0}]}
        host = hc()
        h = health.read_host(host, None, sys_, ssh=lambda x: ssh_ok(x, temp={"available": True, "celsius": 48.0, "source": "capteur"}))
        self.assertEqual((h["temp"]["celsius"], h["temp"]["sensors"], h["sources"]), (48.0, [{"name": "core", "celsius": 51.0}], ["ssh", "beszel"]))
        h = health.read_host(host, None, sys_, ssh=ssh_ok)
        self.assertEqual((h["temp"]["celsius"], h["temp"]["source"]), (51.0, "Beszel"))


@unittest.skipIf(health is None, "dépendances absentes : tests à lancer dans l'image")
class BeszelSmart(unittest.TestCase):
    def test_a_disk_beszel_cannot_read_is_not_a_failure(self):
        """Beszel reports « UNKNOWN » (temperature and hours at 0) for a disk it cannot query: the disk is left out, not counted as failed."""
        sys_ = {"smart": [{"name": "/dev/nvme0n1", "state": "UNKNOWN", "temp": 0, "hours": 0}]}
        self.assertEqual(health.smart_from_beszel(sys_), {"accessible": False, "source": "beszel", "disks": []})

    def test_readable_disks_are_kept_next_to_an_unreadable_one(self):
        sys_ = {"smart": [{"name": "/dev/sda", "state": "PASSED"}, {"name": "/dev/sdb", "state": "FAILED"}, {"name": "/dev/nvme0n1", "state": "UNKNOWN"}]}
        out = health.smart_from_beszel(sys_)
        self.assertTrue(out["accessible"])
        self.assertEqual([(d["device"], d["healthy"], d["failed"]) for d in out["disks"]], [("/dev/sda", True, False), ("/dev/sdb", False, True)])
