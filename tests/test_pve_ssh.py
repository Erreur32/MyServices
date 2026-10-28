"""Proxmox VE read by SSH (pve_ssh.read / rows): pvesh output turned into the rows of the « proxmox » connector.

  python3 -m unittest discover -s tests
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.remote import pve_ssh  # noqa: E402

RES = [{"type": "node", "node": "pve", "status": "online", "cpu": 0.12, "mem": 4 << 30, "maxmem": 16 << 30, "maxcpu": 8, "uptime": 3600},
       {"type": "qemu", "vmid": 101, "name": "Monitor", "node": "pve", "status": "running", "template": 0, "cpu": 0.5,
        "mem": 2 << 30, "maxmem": 4 << 30, "maxcpu": 2, "maxdisk": 32 << 30, "tags": "linux;media"},
       {"type": "lxc", "vmid": 102, "name": "dns", "node": "pve", "status": "stopped", "template": 0},
       {"type": "storage", "storage": "local", "node": "pve", "disk": 30, "maxdisk": 100, "shared": 0, "status": "available"}]


class PveSsh(unittest.TestCase):
    def run_with(self, stdout, stderr=""):
        done = subprocess.CompletedProcess([], 0, stdout, stderr)
        with mock.patch.object(pve_ssh.subprocess, "run", return_value=done) as run:
            got = pve_ssh.read("proxmox")
        self.assertEqual(run.call_args.args[0][:2], ["ssh", "-o"])
        return got

    def test_lecture(self):
        data, err, version = self.run_with("pve-manager/8.2.4/faa83925c9641325 (running kernel: 6.8.12-1-pve)\n" + json.dumps(RES))
        self.assertEqual((err, version), ("", "8.2.4"))
        self.assertEqual(data["totals"], {"vm": 1, "lxc": 1, "running": 1, "stopped": 1})
        g = data["guests"][0]
        self.assertEqual((g["mem_pct"], g["cpus"], g["tags"]), (50.0, 2, ["linux", "media"]))
        self.assertEqual(data["storage"][0]["used_pct"], 30.0)

    def test_etat_du_noeud_et_capteurs(self):
        status = {"loadavg": ["0.52", "0.40", "0.35"], "wait": 0.012, "swap": {"used": 1 << 20, "total": 8 << 30},
                  "rootfs": {"used": 10 << 30, "total": 100 << 30}, "kversion": "Linux 6.8.12-1-pve #1 SMP",
                  "cpuinfo": {"model": "Intel N100", "sockets": 1, "cpus": 4}}
        sensors = {"coretemp-isa-0000": {"Package id 0": {"temp1_input": 52.0}, "Core 0": {"temp2_input": 49.0}},
                   "nct6798-isa-0a20": {"fan1": {"fan1_input": 1200.0}, "fan2": {"fan2_input": 0.0}}, "nvme-pci-0100": {"Composite": {"temp1_input": 70.0}}}
        out = ("pve-manager/8.2.4/x (running kernel: 6.8)\n@@res\n" + json.dumps(RES) + "\n@@node pve\n" + json.dumps(status)
               + "\n@@sensors pve\n" + json.dumps(sensors))
        data, err, version = self.run_with(out)
        n = data["nodes"][0]
        self.assertEqual((err, version), ("", "8.2.4"))
        self.assertEqual((n["load"], n["iowait_pct"], n["kernel"], n["model"], n["cores"]), ([0.52, 0.4, 0.35], 1.2, "6.8.12-1-pve", "Intel N100", 4))
        self.assertEqual((n["swap_total"], n["root_total"]), (8 << 30, 100 << 30))
        self.assertEqual((n["temp_c"], n["fans_rpm"]), (52.0, [1200]))   # only CPU chips count for the temperature; a stopped fan is not listed

    def test_sans_capteurs_rien_n_est_ajoute(self):
        data, _, _ = self.run_with("pve-manager/8.2.4/x\n@@res\n" + json.dumps(RES) + "\n@@sensors pve\n")
        self.assertNotIn("temp_c", data["nodes"][0])

    def test_erreur_lisible(self):
        data, err, _ = self.run_with("", "bash: pvesh: command not found")
        self.assertIsNone(data)
        self.assertIn("pvesh", err)

    def test_lignes_et_hote_deja_lu_par_un_connecteur(self):
        machines = [{"ip": "10.0.0.5", "name": "pve", "ssh": {}, "info": {"proxmox": True}},
                    {"ip": "10.0.0.6", "name": "pve2", "ssh": {}, "info": {"proxmox": True}},
                    {"ip": "10.0.0.7", "name": "nas", "ssh": {}, "info": {"proxmox": False}}]
        sshc = {ip: {"alias": ip} for ip in ("10.0.0.5", "10.0.0.6", "10.0.0.7")}
        with mock.patch.object(pve_ssh, "read", return_value=(pve_ssh.pve_resources(RES), "", "8.2.4")) as rd:
            rows = pve_ssh.rows(machines, sshc, {"10.0.0.6"})
        self.assertEqual([c.args[0] for c in rd.call_args_list], ["10.0.0.5"])
        r = rows[0]
        self.assertEqual((r["connector"], r["via"], r["url"], r["ok"], r["version"]), ("proxmox", "ssh", "https://10.0.0.5:8006", True, "8.2.4"))


if __name__ == "__main__":
    unittest.main()
