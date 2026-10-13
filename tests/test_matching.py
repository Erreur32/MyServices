"""Matching layer: one machine seen by MynetworK, UniFi, Beszel, Proxmox and Dockhand.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import matching  # noqa: E402

MACHINES = [
    {"ip": "192.168.1.10", "name": "pve"},
    {"ip": "192.168.1.20", "name": "docker1"},
    {"ip": "192.168.1.30", "name": "nas", "info": {"hostname": "storage"}},
    {"ip": "192.168.1.40", "name": "web"},
    {"ip": "192.168.1.41", "name": "Web"},   # same short name twice: never matched by name
]
NET = [{"connector": "mynetwork", "name": "lan", "label": "MynetworK", "devices": [
    {"ip": "192.168.1.20", "mac": "aa-bb-cc-dd-ee-01", "hostname": "docker1.lan", "vendor": "Intel", "status": "online"},
    {"ip": "192.168.1.30", "mac": "AABBCCDDEE02", "hostname": "nas-backup", "status": "online"},
    {"ip": "192.168.1.99", "mac": "aa:bb:cc:dd:ee:99", "hostname": "camera", "status": "online"},
], "unifi": {"clients": [{"name": "x", "mac": "aa:bb:cc:dd:ee:02", "ip": "192.168.1.250", "ap_mac": "ap1"}], "devices": []}}]
VIRT = [
    {"connector": "proxmox", "name": "cluster", "label": "Proxmox VE", "ok": True, "url": "https://192.168.1.10:8006",
     "nodes": [{"name": "pve", "online": True}],
     "guests": [{"vmid": 101, "name": "docker1", "type": "qemu", "node": "pve", "status": "running"},
                {"vmid": 102, "name": "ghost", "type": "lxc", "node": "pve", "status": "stopped"},
                {"vmid": 900, "name": "tpl", "type": "qemu", "node": "pve", "template": True}]},
    {"connector": "proxmox-backup", "name": "pbs", "label": "Proxmox Backup Server", "ok": True, "url": "https://192.168.1.30:8007"},
]
DOCK = [{"connector": "dockhand", "name": "dh", "label": "Dockhand", "url": "http://192.168.1.20:3000", "environments": [
    {"name": "local", "host": "unix:///var/run/docker.sock", "containers": {"total": 12}},
    {"name": "far", "host": "tcp://10.9.9.9:2375"},
]}]
BESZEL = [{"name": "hub", "systems": [{"name": "storage.lan", "host": "nas.home", "status": "up"},
                                      {"name": "elsewhere", "host": "10.0.0.7", "status": "down"}]}]


class Gpus(unittest.TestCase):
    def test_gpuviewr_by_name(self):
        gpu = [{"connector": "gpuviewr", "name": "gv", "machines": [
            {"name": "docker1", "hostname": "x", "online": True, "gpus": [{"name": "RTX", "temp": 41}]},
            {"name": "ghost", "online": False, "gpus": []}]}]
        r = matching.link(MACHINES, services=gpu)
        s = [x for x in r["machines"]["192.168.1.20"]["sources"] if x["source"] == "gpuviewr"][0]
        self.assertEqual((s["by"], s["gpus"]), ("name", [{"name": "RTX", "temp": 41}]))
        self.assertEqual([u["name"] for u in r["unlinked"] if u["source"] == "gpuviewr"], ["ghost"])


class Normalise(unittest.TestCase):
    def test_mac(self):
        self.assertEqual(matching.norm_mac("aa-bb-cc-dd-ee-01"), "AA:BB:CC:DD:EE:01")
        self.assertEqual(matching.norm_mac("AABBCCDDEE02"), "AA:BB:CC:DD:EE:02")
        self.assertIsNone(matching.norm_mac("not a mac"))

    def test_name_and_host(self):
        self.assertEqual(matching.norm_name("PVE.lan."), "pve")
        self.assertIsNone(matching.norm_name("192.168.1.10"))
        self.assertEqual(matching.host_of("tcp://10.0.0.5:2375"), "10.0.0.5")
        self.assertEqual(matching.host_of("nas:22"), "nas")


class Link(unittest.TestCase):
    def setUp(self):
        self.r = matching.link(MACHINES, NET, VIRT, DOCK, BESZEL)
        self.m = self.r["machines"]

    def src(self, ip, source):
        return [s for s in self.m[ip]["sources"] if s["source"] == source]

    def test_mynetwork_by_ip_gives_mac_vendor_and_names(self):
        e = self.m["192.168.1.20"]
        self.assertEqual((e["mac"], e["vendor"]), ("AA:BB:CC:DD:EE:01", "Intel"))
        self.assertEqual(e["names"], ["docker1.lan"])
        self.assertEqual(self.src("192.168.1.20", "mynetwork")[0]["by"], "ip")

    def test_unifi_client_found_by_mac_after_ip_change(self):
        self.assertEqual(self.src("192.168.1.30", "unifi")[0]["by"], "mac")

    def test_unifi_read_directly_one_badge_with_mynetwork(self):
        direct = {"connector": "unifi", "name": "ucg", "label": "UniFi Network",
                  "unifi": {"clients": [{"name": "nas", "mac": "aa:bb:cc:dd:ee:02", "ip": "192.168.1.30"}],
                            "devices": [{"name": "USW", "mac": "aa:bb:cc:dd:ee:41", "ip": "192.168.1.40"}]}}
        m = matching.link(MACHINES, NET + [direct])["machines"]
        self.assertEqual(len([s for s in m["192.168.1.30"]["sources"] if s["source"] == "unifi"]), 1)
        self.assertEqual([s["by"] for s in m["192.168.1.40"]["sources"] if s["source"] == "unifi"], ["ip"])
        self.assertEqual(m["192.168.1.40"]["mac"], "AA:BB:CC:DD:EE:41")

    def test_proxmox_node_and_guest(self):
        self.assertEqual(self.m["192.168.1.10"]["hypervisor"]["node"], "pve")
        g = self.m["192.168.1.20"]["guest"]
        self.assertEqual((g["vmid"], g["node"], g["type"]), (101, "pve", "qemu"))
        self.assertEqual(self.src("192.168.1.20", "proxmox")[0]["by"], "name")

    def test_pbs_by_url(self):
        self.assertEqual(self.src("192.168.1.30", "proxmox-backup")[0]["by"], "ip")

    def test_dockhand_local_socket_is_dockhand_host(self):
        s = self.src("192.168.1.20", "dockhand")[0]
        self.assertEqual((s["environment"], s["containers"]), ("local", 12))

    def test_beszel_by_name_learnt_from_hostinfo(self):
        self.assertEqual(self.src("192.168.1.30", "beszel")[0]["by"], "name")

    def test_ambiguous_name_never_matched(self):
        r = matching.link(MACHINES, virtualization=[{"connector": "proxmox", "name": "c", "nodes": [], "guests": [
            {"vmid": 1, "name": "web", "status": "running"}]}])
        self.assertEqual(r["machines"]["192.168.1.40"]["sources"], [])
        self.assertEqual(r["unlinked"][0]["name"], "web")

    def test_unlinked(self):
        got = {(u["source"], u.get("name")) for u in self.r["unlinked"]}
        self.assertEqual(got, {("mynetwork", "camera"), ("proxmox", "ghost"), ("dockhand", "far"), ("beszel", "elsewhere")})

    def test_template_ignored_and_no_duplicates(self):
        self.assertNotIn("tpl", {u.get("name") for u in self.r["unlinked"]})
        again = matching.link(MACHINES, NET + NET)["machines"]["192.168.1.20"]["sources"]
        self.assertEqual(len([s for s in again if s["source"] == "mynetwork"]), 1)

    def test_empty(self):
        self.assertEqual(matching.link([]), {"machines": {}, "unlinked": []})


if __name__ == "__main__":
    unittest.main()
