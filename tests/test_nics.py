"""Network cards of the machines: read over SSH (sysfs, ethtool) and by the Windows agent (Get-NetAdapter).

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import health  # noqa: E402
from msv.collect import hostinfo  # noqa: E402


class Ssh(unittest.TestCase):
    def test_lines_become_cards(self):
        raw = "##OS x\n##NIC enp3s0 04:42:1a:e9:4e:a5 up 1000 full 2500\n##NIC eno1 aa:bb:cc:00:00:01 down - - -\n##NIC bad line\n##KERNEL 6\n"
        got = hostinfo.parse_nics(raw)
        self.assertEqual(got[0], {"name": "enp3s0", "mac": "04:42:1a:e9:4e:a5", "up": True, "speed": 1000, "duplex": "full", "max": 2500})
        self.assertEqual((got[1]["up"], got[1]["speed"], got[1]["duplex"], got[1]["max"]), (False, None, None, None))
        self.assertEqual(len(got), 2)

    def test_the_remote_script_reads_only(self):
        self.assertIn("##NIC", hostinfo.REMOTE)
        self.assertNotIn("ethtool -s", hostinfo.REMOTE)            # never changes a card's setting
        self.assertNotIn("ip link set", hostinfo.REMOTE)


class Windows(unittest.TestCase):
    def test_adapters_of_the_agent_report(self):
        hw = health.hardware_of_raw({"m": "Asus", "nic": [{"n": "Ethernet", "mac": "04-42-1A-E9-4E-A5", "sp": 2500000000, "fd": True, "sd": "Auto Negotiation"},
                                                         {"n": "Idle", "mac": "", "sp": 0, "fd": False, "sd": ""}, "junk"]})
        self.assertEqual(hw["nics"][0], {"name": "Ethernet", "mac": "04:42:1a:e9:4e:a5", "speed": 2500, "full_duplex": True, "setting": "Auto Negotiation"})
        self.assertEqual((hw["nics"][1]["speed"], hw["nics"][1]["mac"]), (None, None))
        self.assertEqual(len(hw["nics"]), 2)

    def test_the_powershell_only_reads(self):
        import inspect
        src = inspect.getsource(health)
        self.assertIn("Get-NetAdapter -Physical", src)
        self.assertNotIn("Set-NetAdapter", src)


if __name__ == "__main__":
    unittest.main()
