"""GPU by its own tool (health.py collect_gpu / parse_gpu): nvidia-smi csv and rocm-smi json.

  python3 -m unittest discover -s tests
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import health  # noqa: E402

NVIDIA = "NVIDIA GeForce RTX 3060, 12, 45, 1024, 12288, 30.50\nNVIDIA T400, [N/A], 38, 100, 4096, [N/A]\n"
ROCM = json.dumps({"card0": {"Card Series": "Radeon RX 6600", "GPU use (%)": "7", "Temperature (Sensor edge) (C)": "41.0",
                             "VRAM Total Memory (B)": str(8 * 1024 ** 3), "VRAM Total Used Memory (B)": str(1024 ** 3)}, "system": {"Driver version": "6.1"}})


class Gpu(unittest.TestCase):
    def test_nvidia_lines_with_missing_values(self):
        got = health.parse_gpu(NVIDIA + "---\n")
        self.assertEqual(got["gpus"][0], {"name": "NVIDIA GeForce RTX 3060", "util": 12.0, "temp": 45.0, "mem_used": 1024.0, "mem_total": 12288.0, "power": 30.5})
        self.assertIsNone(got["gpus"][1]["util"])
        self.assertIsNone(got["gpus"][1]["power"])

    def test_rocm_card_in_megabytes(self):
        got = health.parse_gpu("---\n" + ROCM)
        self.assertEqual(got["gpus"], [{"name": "Radeon RX 6600", "util": 7.0, "temp": 41.0, "mem_used": 1024, "mem_total": 8192, "power": None}])

    def test_nothing_installed_or_broken_output(self):
        self.assertEqual(health.parse_gpu("---\n"), {"available": False, "gpus": []})
        self.assertFalse(health.parse_gpu("---\n{not json")["available"])
        self.assertFalse(health.collect_gpu(lambda cmd, timeout=10: (127, ""))["available"])

    def test_collect_runs_the_shared_command(self):
        seen = []
        health.collect_gpu(lambda cmd, timeout=10: (seen.append(cmd), (0, ""))[1])
        self.assertEqual(seen, [health.GPU_CMD])
        self.assertIn(health.GPU_CMD, health.LINUX_AGENT_COMMANDS)


if __name__ == "__main__":
    unittest.main()
