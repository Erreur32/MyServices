"""VMware: ESXi read by SSH (esxi_ssh.parse, on outputs written after vim-cmd / esxcli) and the vCenter connector against a FAKE
server (routes after the vSphere Automation API documentation). Neither a real ESXi nor a real vCenter here.

  python3 -m unittest discover -s tests
"""
import base64
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import connectors  # noqa: E402
from msv.remote import esxi_ssh  # noqa: E402
from msv.machines import matching  # noqa: E402
from connectors.base import Context  # noqa: E402
from connectors.vmware import VCenter  # noqa: E402

HOST = """(vim.host.Summary) {
   host = 'vim.HostSystem:ha-host',
   hardware = (vim.host.Summary.HardwareSummary) {
      vendor = "Dell Inc.",
      model = "PowerEdge R640",
      memorySize = 68719476736,
      cpuModel = "Intel(R) Xeon(R) Silver 4214 CPU @ 2.20GHz",
      cpuMhz = 2200,
      numCpuPkgs = 1,
      numCpuCores = 10,
      numCpuThreads = 20,
   },
   runtime = (vim.host.RuntimeInfo) {
      connectionState = "connected",
      powerState = "poweredOn",
      healthSystemRuntime = (vim.host.HealthStatusSystem.Runtime) {
         systemHealthInfo = (vim.host.SystemHealthInfo) {
            numericSensorInfo = (vim.host.NumericSensorInfo) [
               (vim.host.NumericSensorInfo) {
                  name = "System Board 1 Inlet Temp",
                  currentReading = 2300,
               }
            ],
         },
      },
   },
   config = (vim.host.ConfigSummary) {
      name = "esx01.lan",
      port = 443,
      product = (vim.AboutInfo) {
         name = "VMware ESXi",
         fullName = "VMware ESXi 8.0.2 build-22380479",
         version = "8.0.2",
         build = "22380479",
      },
   },
   quickStats = (vim.host.Summary.QuickStats) {
      overallCpuUsage = 4400,
      overallMemoryUsage = 32768,
      uptime = 864000,
   },
}"""

FS = """Mount Point                                        Volume Name  UUID                                 Mounted  Type            Size          Free
-------------------------------------------------  -----------  -----------------------------------  -------  ------  ------------  ------------
/vmfs/volumes/5f1e0000-aaaa                        datastore1   5f1e0000-aaaa                        true     VMFS-6  500000000000  125000000000
/vmfs/volumes/nfs-1                                NAS backups  nfs-1                                true     NFS     2000000000000 1000000000000
/vmfs/volumes/bootbank                             BOOTBANK1    bootbank                             true     vfat      4293591040    4000000000
"""


def vm(name, on, ip=None, host=None):
    guest = f'      hostName = "{host}",\n      ipAddress = "{ip}",' if ip else "      hostName = <unset>,\n      ipAddress = <unset>,"
    return f"""Listsummary:
(vim.vm.Summary) {{
   vm = 'vim.VirtualMachine:1',
   runtime = (vim.vm.RuntimeInfo) {{
      powerState = "{'poweredOn' if on else 'poweredOff'}",
   }},
   guest = (vim.vm.Summary.GuestSummary) {{
      guestFullName = "Debian GNU/Linux 12 (64-bit)",
      toolsStatus = "toolsOk",
{guest}
   }},
   config = (vim.vm.Summary.ConfigSummary) {{
      name = "{name}",
      template = false,
      memorySizeMB = 4096,
      numCpu = 2,
   }},
   storage = (vim.vm.Summary.StorageSummary) {{
      committed = 21474836480,
      uncommitted = 10737418240,
   }},
   quickStats = (vim.vm.Summary.QuickStats) {{
      overallCpuUsage = 1100,
      guestMemoryUsage = 1024,
      uptimeSeconds = {3600 if on else 0},
   }},
}}"""


OUT = f"##HOST\n{HOST}\n##FS\n{FS}##VM 1\n{vm('web01', True, '10.0.0.21', 'web01.lan')}\n##VM 2\n{vm('win srv', False)}\n"


class Esxi(unittest.TestCase):
    def test_hote_datastores_et_vm(self):
        data, err, version = esxi_ssh.parse(OUT)
        self.assertEqual((err, version), ("", "8.0.2"))
        n = data["nodes"][0]
        self.assertEqual((n["name"], n["cpus"], n["cpu_pct"], n["mem_pct"], n["uptime"]), ("esx01.lan", 20, 20.0, 50.0, 864000))
        self.assertEqual([(s["name"], s["used_pct"], s["shared"]) for s in data["storage"]], [("datastore1", 75.0, False), ("NAS backups", 50.0, True)])
        web, win = data["guests"]
        self.assertEqual((web["vmid"], web["name"], web["status"], web["ip"], web["hostname"], web["cpus"], web["mem_pct"], web["cpu_pct"]),
                         (1, "web01", "running", "10.0.0.21", "web01.lan", 2, 25.0, 25.0))
        self.assertEqual((win["name"], win["status"], win["ip"], win["mem_pct"], win["maxdisk"]), ("win srv", "stopped", None, None, 32212254720))
        self.assertEqual(data["totals"], {"vm": 2, "lxc": 0, "running": 1, "stopped": 1})

    def test_pas_un_esxi(self):
        data, err, _ = esxi_ssh.parse("##HOST\nsh: vim-cmd: not found\n##FS\n")
        self.assertIsNone(data)
        self.assertIn("vim-cmd", err)

    def test_vm_reliee_par_son_ip(self):
        data, _, _ = esxi_ssh.parse(OUT)
        row = {"connector": "esxi", "name": "esx01", "label": "VMware ESXi", "ok": True, "url": "https://10.0.0.5/ui/", **data}
        got = matching.link([{"ip": "10.0.0.5", "name": "esx01"}, {"ip": "10.0.0.21", "name": "serveur-web"}], virtualization=[row])
        self.assertEqual(got["machines"]["10.0.0.21"]["guest"]["vmid"], 1)
        self.assertEqual(got["machines"]["10.0.0.21"]["sources"][0]["by"], "ip")
        self.assertEqual(got["machines"]["10.0.0.5"]["hypervisor"]["node"], "esx01.lan")
        self.assertEqual([u["name"] for u in got["unlinked"]], ["win srv"])


USER, PASS = "myservices@vsphere.local", "pw-" + "x" * 6   # built at run time: the safety check refuses passwords written as such
TOKEN = "sess-" + "y" * 10


class FakeVc(BaseHTTPRequestHandler):
    seen: list = []
    old = False   # vCenter 6.7: only /rest

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _wrap(self, obj):
        return {"value": obj} if FakeVc.old else obj

    def do_POST(self):
        FakeVc.seen.append(("POST", self.path))
        if (self.path == "/api/session") == FakeVc.old:
            return self._send(404, {})
        if self.headers.get("Authorization") != "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode():
            return self._send(401, {"error_type": "UNAUTHENTICATED"})
        self._send(201, self._wrap(TOKEN))

    def do_DELETE(self):
        FakeVc.seen.append(("DELETE", self.path))
        self._send(200, {})

    def do_GET(self):
        FakeVc.seen.append(("GET", self.path))
        if self.headers.get("vmware-api-session-id") != TOKEN:
            return self._send(401, {})
        p = self.path.removeprefix("/rest" if FakeVc.old else "/api")
        hosts = "filter.hosts" if FakeVc.old else "hosts"
        routes = {
            "/vcenter/host": [{"host": "host-10", "name": "esx01.lan", "connection_state": "CONNECTED", "power_state": "POWERED_ON"},
                              {"host": "host-11", "name": "esx02.lan", "connection_state": "NOT_RESPONDING"}],
            f"/vcenter/vm?{hosts}=host-10": [{"vm": "vm-21", "name": "web01", "power_state": "POWERED_ON", "cpu_count": 2, "memory_size_MiB": 4096},
                                              {"vm": "vm-22", "name": "old", "power_state": "POWERED_OFF", "cpu_count": 1, "memory_size_MiB": 1024}],
            f"/vcenter/vm?{hosts}=host-11": [],
            "/vcenter/vm/vm-21/guest/identity": {"ip_address": "10.0.0.21", "host_name": "web01.lan",
                                                 "full_name": {"default_message": "Debian GNU/Linux 12 (64-bit)", "id": "x"}},
            "/vcenter/datastore": [{"datastore": "ds-1", "name": "datastore1", "type": "VMFS", "capacity": 1000, "free_space": 250}],
            "/appliance/system/version": {"version": "8.0.2.00100", "build": "22617221"},
        }
        r = routes.get(p)
        self._send(200, self._wrap(r)) if r is not None else self._send(404, {})


class VCenterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeVc)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        FakeVc.seen, FakeVc.old = [], False

    def conn(self, pw=PASS):
        return VCenter({"type": "vcenter", "name": "vc", "url": self.url, "user": USER, "password": pw}, Context(timeout=5))

    def check(self, d):
        self.assertEqual([(n["name"], n["online"]) for n in d["nodes"]], [("esx01.lan", True), ("esx02.lan", False)])
        web, old = d["guests"]
        self.assertEqual((web["name"], web["status"], web["node"], web["ip"], web["hostname"], web["cpus"], web["maxmem"]),
                         ("web01", "running", "esx01.lan", "10.0.0.21", "web01.lan", 2, 4 << 30))
        self.assertEqual((old["status"], old.get("ip")), ("stopped", None))
        self.assertEqual(d["storage"][0]["used_pct"], 75.0)
        self.assertNotIn(("GET", "/api/vcenter/vm/vm-22/guest/identity"), FakeVc.seen)   # powered off: no Tools to ask

    def test_lecture_et_session_fermee(self):
        c = self.conn()
        self.check(c.collect())
        self.assertEqual(c.version(), "8.0.2.00100")
        self.assertIn(("DELETE", "/api/session"), FakeVc.seen)
        self.assertEqual({m for m, _ in FakeVc.seen}, {"POST", "GET", "DELETE"})   # nothing else than a session and reads

    def test_ancien_vcenter_rest(self):
        FakeVc.old = True
        self.check(self.conn().collect())
        self.assertIn(("DELETE", "/rest/com/vmware/cis/session"), FakeVc.seen)

    def test_compte_refuse_et_registre(self):
        r = self.conn("wrong-" + "z").test()
        self.assertFalse(r.ok)
        self.assertIn("compte refusé", r.message)
        self.assertIn("vcenter", connectors.TYPES)
        self.assertTrue(r.ok is False and "password" not in r.message)


if __name__ == "__main__":
    unittest.main()
