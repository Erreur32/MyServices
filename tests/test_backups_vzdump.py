"""Proxmox VE dumps (vzdump, without Proxmox Backup): reading on the host (agent run on a fake /etc/pve), sets from the page,
level and copies (rsync to a NAS) in backups.py.

  python3 -m unittest discover -s tests
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import backups  # noqa: E402
import backups_admin as ba  # noqa: E402
from test_backups_admin import Base  # noqa: E402

NOW = int(time.time())
DUMP = "/var/lib/vz/dump"


def name(kind, vmid, ts, ext=".vma.zst"):
    return f"vzdump-{kind}-{vmid}-{time.strftime('%Y_%m_%d-%H_%M_%S', time.localtime(ts))}{ext}"


class Agent(unittest.TestCase):
    """The agent's vzdump part, run for real on a fake Proxmox tree (paths rewritten in its source)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, rel, text="", mtime=None):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        if mtime:
            os.utime(p, (mtime, mtime))

    def run_agent(self):
        src = backups.AGENT.replace("/etc/pve", f"{self.root}/pve").replace("/var/lib/vz", f"{self.root}/vz")
        r = subprocess.run([sys.executable, "-", json.dumps({"locs": {}, "vzdump": True})], input=src, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_groupes_par_machine_invitee_et_stockage(self):
        self.write("pve/storage.cfg", "dir: local\n\tpath /var/lib/vz\n\tcontent iso,backup\n\n"
                   f"nfs: nas\n\texport /pve\n\tpath {self.root}/mnt/nas\n\tserver 10.0.0.9\n\tcontent backup\n\n"
                   f"dir: isos\n\tpath {self.root}/isos\n\tcontent iso\n")
        self.write("pve/nodes/pve1/qemu-server/100.conf", "name: web\nmemory: 2048\n[snap1]\nname: old\n")
        self.write("pve/nodes/pve1/lxc/101.conf", "hostname: dns\n")
        self.write(f"vz/dump/{name('qemu', 100, NOW - 86400)}", "x" * 10, NOW - 86400)
        self.write(f"vz/dump/{name('qemu', 100, NOW - 3600)}", "x" * 20, NOW - 3600)
        self.write(f"vz/dump/{name('qemu', 100, NOW - 60, '.log')}", "log", NOW - 60)      # log newer than the dump: not an archive
        self.write(f"vz/dump/{name('lxc', 101, NOW - 7200, '.tar.zst')}", "y", NOW - 7200)
        self.write("vz/dump/autre.tar.gz", "z")
        self.write(f"mnt/nas/dump/{name('qemu', 100, NOW - 3600)}", "x", NOW - 3600)
        self.write(f"isos/dump/{name('qemu', 100, NOW)}", "x")                              # storage without « backup » content: ignored
        got = self.run_agent()["vzdump"]
        by = {(Path(g["dir"]).parent.name, g["kind"], g["vmid"]): g for g in got}
        self.assertEqual(set(by), {("vz", "qemu", "100"), ("vz", "lxc", "101"), ("nas", "qemu", "100")})
        web = by[("vz", "qemu", "100")]
        self.assertEqual((web["name"], web["count"], web["size"], web["network"], web["storage"]), ("web", 2, 20, False, "local"))
        self.assertEqual(web["newest_name"], name("qemu", 100, NOW - 3600))
        self.assertEqual(by[("vz", "lxc", "101")]["name"], "dns")
        self.assertEqual((by[("nas", "qemu", "100")]["network"], by[("nas", "qemu", "100")]["storage"]), (True, "nas"))

    def test_pas_un_proxmox(self):
        self.assertNotIn("vzdump", self.run_agent())

    def test_motif_et_exclusions_d_un_jeu(self):
        self.write(f"d/{name('qemu', 100, NOW - 3600)}", "x", NOW - 3600)
        self.write(f"d/{name('qemu', 100, NOW - 60, '.log')}", "l", NOW - 60)
        self.write(f"d/{name('qemu', 1000, NOW)}", "o", NOW)
        req = {"locs": {"s#0": {"path": f"{self.root}/d", "pattern": "vzdump-qemu-100-*", "exclude": ba.VZDUMP_SIDE, "depth": 1}}}
        r = subprocess.run([sys.executable, "-", json.dumps(req)], input=backups.AGENT, capture_output=True, text=True, timeout=30)
        files = json.loads(r.stdout)["locs"]["s#0"]["files"]
        self.assertEqual([f["name"] for f in files], [name("qemu", 100, NOW - 3600)])


GROUPS = [{"dir": DUMP, "storage": "local", "network": False, "kind": "qemu", "vmid": "100", "name": "web", "count": 3, "newest": NOW - 3600,
           "newest_name": name("qemu", 100, NOW - 3600), "size": 20},
          {"dir": DUMP, "storage": "local", "network": False, "kind": "lxc", "vmid": "101", "name": "dns", "count": 1, "newest": NOW - 7200,
           "newest_name": name("lxc", 101, NOW - 7200, ".tar.zst"), "size": 5},
          {"dir": "/mnt/pve/nas/dump", "storage": "nas", "network": True, "kind": "qemu", "vmid": "102", "name": "db", "count": 1, "newest": NOW - 3600,
           "newest_name": name("qemu", 102, NOW - 3600), "size": 5}]


class Wizard(Base):
    def discover(self, out=None):
        with mock.patch.object(backups, "run_py", return_value=(out or {"vzdump": GROUPS}, "")) as run:
            got = ba.vzdump_discover()
        self.assertTrue(json.loads(run.call_args.args[2])["vzdump"])
        return got

    def follow(self, *groups, **kw):
        return ba.vzdump_follow([{"ip": "10.0.0.2", "dir": g["dir"], "kind": g["kind"], "vmid": g["vmid"], "network": g["network"],
                                  "label": f"VM {g['vmid']}", "max_age_days": 2, **kw} for g in groups])

    def test_recherche_ne_modifie_rien_et_ignore_les_non_proxmox(self):
        got = self.discover()
        self.assertEqual([len(m["groups"]) for m in got["machines"]], [3])
        self.assertEqual(got["machines"][0]["groups"][0]["suggested_age"], 2.0)
        self.assertFalse(self.meta.exists())
        self.assertEqual(self.discover({"local": []})["machines"], [])   # read fine, but not a Proxmox host: not listed

    def test_un_jeu_par_machine_invitee(self):
        self.assertEqual(self.follow(*GROUPS), {"added": 3, "updated": 0})
        self.assertEqual(self.follow(GROUPS[0], label="Web"), {"added": 0, "updated": 1})
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        locs = {s["label"]: s["locations"][0] for s in meta["sets"]}
        self.assertEqual((locs["Web"]["pattern"], locs["Web"]["exclude"], locs["Web"]["vzdump"]), ("vzdump-qemu-100-*", ba.VZDUMP_SIDE, "qemu/100"))
        self.assertTrue(locs["VM 102"]["offsite"])
        self.assertEqual({s["label"]: s["expect_offsite"] for s in meta["sets"]}, {"Web": False, "VM 101": False, "VM 102": True})
        self.assertEqual([g["followed"] for g in self.discover()["machines"][0]["groups"]], [True, True, True])
        self.assertEqual(ba.current()["vzdump"], {"followed": 3})
        # the dump folder stays free for a plain folder set
        self.assertEqual(ba.follow([self.item(path=DUMP, label="Dumps")]), {"added": 1, "updated": 0})

    def test_refus(self):
        for bad in ({"kind": "docker"}, {"vmid": "1;rm"}, {"dir": "../etc"}, {"ip": "10.0.0.3"}):
            with self.subTest(bad=bad), self.assertRaises(ba.BackupError):
                ba.vzdump_follow([{"ip": "10.0.0.2", "dir": DUMP, "kind": "qemu", "vmid": "100", "label": "x", **bad}])
        self.assertFalse(self.meta.exists())

    def test_copie_rsync_vers_le_nas_trouvee_pour_chaque_vm(self):
        self.follow(GROUPS[0], GROUPS[1])
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        sid = {s["locations"][0]["vzdump"]: s["id"] for s in meta["sets"]}
        ba.add_copy(sid["qemu/100"], "10.0.0.2", "/mnt/nas/proxmox")
        meta = json.loads(self.meta.read_text(encoding="utf-8"))
        copy = meta["sets"][0]["locations"][1]
        self.assertEqual((copy["pattern"], copy["exclude"]), ("vzdump-qemu-100-*", ba.VZDUMP_SIDE))
        want = {GROUPS[1]["newest_name"]: [(sid["lxc/101"], GROUPS[1]["newest_name"])]}
        hits = [{"ip": "10.0.0.2", "name": "Serveur", "found": {GROUPS[1]["newest_name"]: [{"dir": "/mnt/nas/proxmox", "network": True}]}}]
        got = ba.copies_from_hits(meta, want, hits)
        self.assertEqual([(c["set_id"], c["path"], c["offsite"]) for c in got], [(sid["lxc/101"], "/mnt/nas/proxmox", True)])


class Analyse(unittest.TestCase):
    META = {"hosts": [{"id": "pve", "label": "Proxmox", "ip": "10.0.0.2"}, {"id": "nas", "label": "NAS", "ip": "10.0.0.9"}],
            "sets": [{"id": "web", "label": "web", "origin": "pve", "max_age_days": 2, "expect_offsite": True,
                      "locations": [{"host": "pve", "path": DUMP, "pattern": "vzdump-qemu-100-*", "vzdump": "qemu/100"},
                                    {"host": "nas", "path": "/volume1/pve", "pattern": "vzdump-qemu-100-*"}]},
                     {"id": "db", "label": "db", "origin": "pve", "max_age_days": 2, "expect_offsite": True,
                      "locations": [{"host": "pve", "path": "/mnt/pve/nas/dump", "pattern": "vzdump-qemu-102-*", "vzdump": "qemu/102", "offsite": True}]}]}

    def run_analyse(self, nas_files):
        f = {"name": name("qemu", 100, NOW - 86400), "mtime": NOW - 86400, "size": 20}
        db = {"name": name("qemu", 102, NOW - 3600), "mtime": NOW - 3600, "size": 5}
        res = {"pve": ({"locs": {"web#0": {"exists": True, "count": 1, "size": 20, "files": [f]},
                                 "db#0": {"exists": True, "count": 1, "size": 5, "files": [db]}}, "disks": [], "crons": []}, ""),
               "nas": ({"locs": {"web#1": {"exists": True, "count": len(nas_files), "size": 20, "files": nas_files}}, "disks": [], "crons": []}, "")}
        return {s["id"]: s for s in backups.analyse(self.META, res, {}, NOW)["sets"]}, f

    def test_copie_rsync_a_jour_puis_en_retard(self):
        old = {"name": name("qemu", 100, NOW - 8 * 86400), "mtime": NOW - 8 * 86400, "size": 20}   # rsync stopped a week ago
        sets, f = self.run_analyse([old])
        self.assertEqual((sets["web"]["level"], sets["web"]["locations"][1]["level"]), ("crit", "warn"))
        sets, _ = self.run_analyse([f])
        self.assertEqual((sets["web"]["level"], sets["web"]["offsite"]), ("ok", 1))

    def test_dump_sur_stockage_reseau_compte_hors_machine(self):
        sets, _ = self.run_analyse([])
        self.assertEqual((sets["db"]["level"], sets["db"]["offsite"]), ("ok", 1))


if __name__ == "__main__":
    unittest.main()
