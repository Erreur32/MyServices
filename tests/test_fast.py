"""fast.py: the light connector reads written to live.json, a source that fails keeps its last reading.

  python3 -m unittest discover -s tests
"""
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fast  # noqa: E402
from connectors.base import ConnectorError  # noqa: E402

DEVICES = [{"ip": "10.0.0.2", "status": "online", "ping_ms": 0.4, "ports": [22, 445], "ports_at": "2026-10-17T22:04:57Z", "hostname": "x"}]


class Net:
    type, name = "mynetwork", "mynetwork"

    def __init__(self, devices=DEVICES, sheet=None):
        self.devices, self.sheet, self.asked = devices, sheet, []

    def scan(self):
        if self.devices is None:
            raise ConnectorError("HTTP 500")
        return self.devices

    def ip_details(self, ip):
        self.asked.append(ip)
        return self.sheet


class Pve:
    type, name = "proxmox", "pve"

    def collect(self):
        return {"guests": [{"node": "pve", "vmid": 101, "status": "running"}, {"node": "pve", "vmid": 102, "status": "stopped"}],
                "nodes": [{"name": "pve", "online": True}]}


def run(insts, prev=None, **kw):
    with tempfile.TemporaryDirectory() as d, mock.patch.object(fast.connectors, "instances", side_effect=lambda cfg, kind=None, **_: [i for i in insts if (kind == "network") == (i.type == "mynetwork")]):
        path = Path(d) / "live.json"
        doc = fast.refresh({}, path, ["10.0.0.2"], prev, **kw)
        assert json.loads(path.read_text(encoding="utf-8"))["sources"].keys() == doc["sources"].keys()
        return doc


class Fast(unittest.TestCase):
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
        net = Net(sheet={"scan": {"status": "online"}})
        first = run([net], now=1000.0)
        second = run([net], prev=first, now=1100.0, details_every=900)
        self.assertEqual(net.asked, ["10.0.0.2"])   # not asked again before the period is over
        self.assertEqual(second["sources"]["mynetwork/mynetwork"]["details"]["10.0.0.2"], {"scan": {"status": "online"}})
        run([net], prev=second, now=2100.0, details_every=900)
        self.assertEqual(len(net.asked), 2)

    def test_a_failing_source_keeps_its_last_reading(self):
        first = run([Net()])
        down = run([Net(devices=None)], prev=first)
        s = down["sources"]["mynetwork/mynetwork"]
        self.assertEqual((s["ok"], "HTTP 500" in s["error"]), (False, True))
        self.assertEqual(s["devices"]["10.0.0.2"]["ports"], [22, 445])

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
