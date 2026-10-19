"""fast.py: live.json derived from the shared readings of the readers; a source that failed keeps its last picture.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fast  # noqa: E402

DEVICES = [{"ip": "10.0.0.2", "status": "online", "ping_ms": 0.4, "ports": [22, 445], "ports_at": "2026-10-17T22:04:57Z", "hostname": "x"}]


class Net:
    type, name = "mynetwork", "mynetwork"

    def __init__(self, sheet=None):
        self.sheet, self.asked = sheet, []

    def ip_details(self, ip):
        self.asked.append(ip)
        return self.sheet


class Pve:
    type, name = "proxmox", "pve"


class Bes:
    type, name = "beszel", "beszel"


def entry(last, ok=True, at=1e6, message="OK", version=None):
    """A shared state entry as run_isolated leaves it."""
    e = {"ok": ok, "tried": at, "message": message, "version": version, "version_at": at}
    if ok:
        e.update(at=at, last=last)
    elif last is not None:
        e["last"] = last
    return e


STATE = {"mynetwork/mynetwork": entry({"devices": DEVICES, "online": 1}),
         "proxmox/pve": entry({"guests": [{"node": "pve", "vmid": 101, "status": "running"}, {"node": "pve", "vmid": 102, "status": "stopped"}], "nodes": [{"name": "pve", "online": True}]}),
         "beszel/beszel": entry({"systems": [{"name": "a", "status": "up"}, {"name": "b", "status": "up"}]}, version="0.12.1")}


def run(insts, prev=None, state=STATE, **kw):
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "live.json"
        doc = fast.refresh({}, path, ["10.0.0.2"], state, insts, prev, **kw)
        assert json.loads(path.read_text(encoding="utf-8"))["sources"].keys() == doc["sources"].keys()
        return doc


class Fast(unittest.TestCase):
    def test_beszel_total_and_version_from_the_shared_reading(self):
        src = run([Bes()])["sources"]["beszel/beszel"]
        self.assertEqual((src["total"], src["version"], src["ok"], src["at"]), (2, "0.12.1", True, 1e6))

    def test_never_read_gives_no_entry(self):
        self.assertEqual(run([Net(), Pve(), Bes()], state={})["sources"], {})

    def test_devices_ports_and_guests(self):
        doc = run([Net(), Pve()])
        d = doc["sources"]["mynetwork/mynetwork"]
        self.assertEqual(d["devices"]["10.0.0.2"], {"status": "online", "ping_ms": 0.4, "ports": [22, 445], "ports_at": "2026-10-17T22:04:57Z"})
        g = doc["sources"]["proxmox/pve"]
        self.assertEqual((g["guests"]["pve/101"], g["guests"]["pve/102"], g["nodes"]), ("running", "stopped", {"pve": True}))

    def test_closed_detail_route_is_asked_once(self):
        net = Net(sheet=None)
        doc = run([net])
        self.assertEqual(net.asked, ["10.0.0.2"])
        self.assertEqual(doc["sources"]["mynetwork/mynetwork"]["details"], {})

    def test_details_are_kept_between_two_periods(self):
        net = Net(sheet={"scanner": {"status": "online", "pingLatency": 0.6, "openPorts": [{"port": 445, "protocol": "tcp"}], "lastPortScan": "2026-10-17T22:00:00Z"}})
        first = run([net], now=1000.0)
        second = run([net], prev=first, now=1100.0, details_every=900)
        self.assertEqual(net.asked, ["10.0.0.2"])   # not asked again before the period is over
        self.assertEqual(second["sources"]["mynetwork/mynetwork"]["details"]["10.0.0.2"], {"scan": {"status": "online", "ping_ms": 0.6, "ports": [445], "ports_at": "2026-10-17T22:00:00Z"}})
        run([net], prev=second, now=2100.0, details_every=900)
        self.assertEqual(len(net.asked), 2)

    def test_compact_sheet_of_the_real_shape(self):
        from connectors.mynetwork import compact_sheet
        raw = {"ip": "10.0.0.2", "scanner": {"status": "online", "pingLatency": 0.64, "openPorts": [{"port": 445, "protocol": "tcp"}, {"port": 135, "protocol": "tcp"}], "lastPortScan": "t"},
               "freebox": None,
               "unifi": {"device": {"name": "Pc"}, "client": {"name": "Pc", "is_wired": True, "is_wireless": False, "ap_name": "Switch", "sw_port": 3},
                         "switch": {"name": "Switch", "ip": "10.0.0.4", "model": "USW"}, "ap": None}}
        got = compact_sheet(raw)
        self.assertEqual(got["scan"], {"status": "online", "ping_ms": 0.64, "ports": [135, 445], "ports_at": "t"})
        self.assertEqual(got["unifi"], {"name": "Pc", "wired": True, "wireless": False, "switch_name": "Switch", "switch_ip": "10.0.0.4", "switch_model": "USW", "switch_port": 3})
        self.assertNotIn("freebox", got)   # nothing from the Freebox: left out
        wifi = compact_sheet({"unifi": {"client": {"name": "Phone", "is_wired": False, "is_wireless": True, "ap_name": "Salon", "sw_port": 9}, "ap": {"name": "Salon", "model": "U6"}}})
        self.assertEqual(wifi["unifi"], {"name": "Phone", "wired": False, "wireless": True, "ap_name": "Salon", "ap_model": "U6"})   # no switch port for Wi-Fi
        fb = compact_sheet({"freebox": {"dhcp": {"ip": "10.0.0.2", "static": True}, "portForwarding": [{"lan_port": 22}], "name": "pc", "active": True, "apiKey": "x"}})
        self.assertEqual(fb["freebox"], {"dhcp": {"ip": "10.0.0.2", "static": True}, "forwards": [{"lan_port": 22}], "name": "pc", "active": True})
        self.assertNotIn("freebox", compact_sheet({"freebox": {"name": "pc", "dhcp": None}}))   # a box that only knows the name: nothing to add
        self.assertEqual(compact_sheet(None), {})

    def test_beszel_status_by_machine(self):
        import tempfile
        meta = Path(tempfile.mkdtemp()) / "meta.json"
        meta.write_text(json.dumps({"machines": {"10.0.0.2": {"name": "Gamer32"}, "10.0.0.3": {"name": "nas"}}}), encoding="utf-8")
        systems = [{"name": "[Win] PC Gamer32", "host": "10.0.0.2", "status": "up"}, {"name": "nas", "host": "elsewhere", "status": "down"}, {"name": "unknown", "host": "9.9.9.9", "status": "up"}]
        got = fast._beszel_by_ip(systems, {"meta": str(meta)})
        self.assertEqual(got, {"10.0.0.2": {"status": "up", "name": "[Win] PC Gamer32"}, "10.0.0.3": {"status": "down", "name": "nas"}})   # by address, else by name
        self.assertEqual(fast._beszel_by_ip(systems, {"meta": str(meta) + ".none"}), {})

    def test_a_failing_source_keeps_its_last_picture(self):
        first = run([Net()])
        down = run([Net()], prev=first, state={"mynetwork/mynetwork": entry({"devices": DEVICES}, ok=False, message="HTTP 500")})
        s = down["sources"]["mynetwork/mynetwork"]
        self.assertEqual((s["ok"], "HTTP 500" in s["error"]), (False, True))
        self.assertEqual(s["devices"]["10.0.0.2"]["ports"], [22, 445])   # from the previous live picture
        self.assertEqual(s["details"], first["sources"]["mynetwork/mynetwork"]["details"])

    def test_read_ignores_old_or_missing_files(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "live.json"
            self.assertEqual(fast.read(p), {})
            p.write_text(json.dumps({"ts": time.time() - 5000, "sources": {}}), encoding="utf-8")
            self.assertEqual(fast.read(p), {})
            p.write_text(json.dumps({"ts": time.time(), "sources": {"a": {}}}), encoding="utf-8")
            self.assertEqual(list(fast.read(p)["sources"]), ["a"])


if __name__ == "__main__":
    unittest.main()
