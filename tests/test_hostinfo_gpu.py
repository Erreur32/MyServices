"""hostinfo.parse_gpus: graphics adapters read by lspci over SSH (names only).

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    import hostinfo
except ImportError:
    hostinfo = None


@unittest.skipIf(hostinfo is None, "hostinfo.py needs its dependencies (run in the image)")
class ParseGpus(unittest.TestCase):
    def test_integrated_and_discrete(self):
        raw = "VGA compatible controller: Intel Corporation HD Graphics 630 (rev 04)|3D controller: NVIDIA Corporation GP107 [GeForce GTX 1050 Ti] (rev a1)"
        self.assertEqual(hostinfo.parse_gpus(raw), ["Intel HD Graphics 630", "NVIDIA GP107 [GeForce GTX 1050 Ti]"])

    def test_amd_vendor_and_duplicates(self):
        raw = "VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Cezanne [Radeon Vega] (rev c5)|VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Cezanne [Radeon Vega] (rev c5)"
        self.assertEqual(hostinfo.parse_gpus(raw), ["AMD Cezanne [Radeon Vega]"])

    def test_virtual_adapters_are_skipped(self):
        raw = "VGA compatible controller: Red Hat, Inc. QXL paravirtual graphic card (rev 05)|VGA compatible controller: Cirrus Logic GD 5446"
        self.assertEqual(hostinfo.parse_gpus(raw), [])

    def test_nothing(self):
        self.assertEqual(hostinfo.parse_gpus(""), [])


if __name__ == "__main__":
    unittest.main()
