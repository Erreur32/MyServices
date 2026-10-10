"""health.py : un bandeau de connexion (fastfetch, motd dans ~/.bashrc) ne doit pas fausser la lecture d'une machine.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import health  # noqa: E402

BANNER = "/root/.bashrc: ligne 77 : bind: avertissement\n        _,met$$$$$gg.\n   ,g$$P\"\"\n\x1b[16A\x1b[31Croot@Jarvis\n"


class AfterBanner(unittest.TestCase):
    def test_coupe_ce_qui_precede_le_repere(self):
        self.assertEqual(health.after_banner(BANNER + health.SSH_MARK + "\n3\n"), "3\n")

    def test_sans_repere_garde_tout(self):
        self.assertEqual(health.after_banner("3\n"), "3\n")

    def test_runner_ssh_linux_marque_et_nettoie(self):
        sent = {}

        def fake_run(argv, **kw):
            sent["cmd"] = argv[-1]
            return mock.Mock(returncode=0, stdout=BANNER + health.SSH_MARK + "\n7\n", stderr="")
        run = health.make_runner({"mode": "ssh", "target": "jarvis", "os": "linux"})
        with mock.patch.object(health.subprocess, "run", fake_run):
            rc, out = run("echo 7")
        self.assertEqual((rc, out), (0, "7\n"))
        self.assertTrue(sent["cmd"].startswith("printf"))

    def test_runner_windows_garde_sa_commande(self):
        sent = {}

        def fake_run(argv, **kw):
            sent["cmd"] = argv[-1]
            return mock.Mock(returncode=0, stdout="{}", stderr="")
        run = health.make_runner({"mode": "ssh", "target": "pc", "os": "windows"})
        with mock.patch.object(health.subprocess, "run", fake_run):
            run("powershell -c x")
        self.assertEqual(sent["cmd"], "powershell -c x")


class TemperatureCpu(unittest.TestCase):
    JARVIS = ("hwmon acpitz - 31000\nhwmon nvme Composite 31850\nhwmon nvme Sensor_2 55850\n"
              "hwmon k10temp Tctl 34000\nhwmon amdgpu edge 31000\nzone acpitz - 31000\n")

    def test_amd_prend_tctl_et_ignore_nvme_gpu_acpi(self):
        self.assertEqual(health.parse_cpu_temp(self.JARVIS), {"available": True, "celsius": 34.0, "source": "k10temp Tctl"})

    def test_intel_prefere_le_package(self):
        out = "hwmon coretemp Core_0 61000\nhwmon coretemp Package_id_0 66000\n"
        self.assertEqual(health.parse_cpu_temp(out)["celsius"], 66.0)

    def test_raspberry_par_la_zone_thermique(self):
        self.assertEqual(health.parse_cpu_temp("zone cpu-thermal - 48312\n")["celsius"], 48.3)

    def test_vm_sans_capteur_ou_sortie_bizarre(self):
        self.assertEqual(health.parse_cpu_temp(""), {"available": False})
        self.assertEqual(health.parse_cpu_temp("hwmon k10temp Tctl abc\nbruit\n"), {"available": False})
        self.assertEqual(health.parse_cpu_temp("hwmon k10temp Tctl 400000\n"), {"available": False})  # valeur absurde

    def test_niveaux(self):
        lv = lambda c: health.temp_level({"available": True, "celsius": c})
        self.assertEqual([lv(50), lv(85), lv(95)], ["ok", "warn", "crit"])
        self.assertEqual(health.temp_level({"available": False}), "na")
        self.assertEqual(health.temp_level(None), "na")


    def test_sans_capteur_dit_si_c_est_une_vm(self):
        def runner(virt):
            return lambda cmd, timeout=15: (0, "") if "hwmon" in cmd else (0 if virt != "none" else 1, virt + "\n")
        self.assertEqual(health.collect_cpu_temp(runner("kvm")), {"available": False, "virt": "kvm"})
        self.assertEqual(health.collect_cpu_temp(runner("none")), {"available": False})
        self.assertEqual(health.collect_cpu_temp(runner("none"), vm=True), {"available": False, "virt": "vm"})


class Ressources(unittest.TestCase):
    OUT = ("cpu  100 0 100 800 0 0 0 0 0 0\ncpu  150 0 150 900 0 0 0 0 0 0\n"
           "MemTotal:       16384000 kB\nMemAvailable:    4096000 kB\nSwapTotal:       2048000 kB\nSwapFree:        1024000 kB\n")

    def test_cpu_et_memoire(self):
        r = health.parse_resources(self.OUT)
        self.assertEqual(r["cpu_pct"], 50.0)  # 100 actifs sur 200 de temps
        self.assertEqual((r["mem_total_mb"], r["mem_used_mb"], r["mem_pct"]), (16000, 12000, 75.0))
        self.assertEqual((r["swap_total_mb"], r["swap_used_mb"]), (2000, 1000))

    def test_illisible(self):
        for bad in ("", "cpu  1 2 x 4 5 6 7 8\ncpu  1 2 3 4 5 6 7 8\n", "MemTotal: 1 kB\n"):
            self.assertEqual(health.parse_resources(bad), {"available": False})

    def test_niveaux_memoire(self):
        lv = lambda p: health.resources_level({"available": True, "mem_pct": p})
        self.assertEqual([lv(50), lv(90), lv(97)], ["ok", "warn", "crit"])
        self.assertEqual(health.resources_level({"available": False}), "na")


if __name__ == "__main__":
    unittest.main()
