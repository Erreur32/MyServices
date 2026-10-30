"""bandwidth.py: the Internet link rate of the Freebox (shared reading) and of the UniFi gateway (WAN port), as tile_history points."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import bandwidth as bw  # noqa: E402
from msv.collect import tile_history as th  # noqa: E402

NOW = 1_793_000_000
STATE = {"npm/NPM": {"at": NOW, "last": {}},
         "mynetwork/mynetwork": {"at": NOW - 30, "last": {"freebox": {"connection": {"rate_down": 2_000_000, "rate_up": 50_000, "bandwidth_down": 8_000_000_000, "bandwidth_up": 4_000_000_000}}}}}
GATEWAY = {"type": "udm", "wan1": {"port_idx": 7}, "port_table": [{"port_idx": 6, "rx_bytes-r": 1}, {"port_idx": 7, "rx_bytes-r": 125_000, "tx_bytes-r": 25_000, "speed": 10000, "is_uplink": True}]}


class Bandwidth(unittest.TestCase):
    def test_freebox_in_kbit_per_second(self):
        got = bw.freebox_points(STATE)
        self.assertEqual(got[bw.FBX_DOWN], (NOW - 30, 16_000, 8_000_000))   # 2 MB/s = 16 Mb/s on an 8 Gb/s link
        self.assertEqual(got[bw.FBX_UP], (NOW - 30, 400, 4_000_000))
        self.assertEqual(bw.freebox_points({"mynetwork/x": {"at": NOW, "last": {"devices": []}}}), {})

    def test_internet_box_in_kbit_per_second(self):
        box = {"upnp-box/b": {"at": NOW, "last": {"box": {"down_bps": 18_400_000, "up_bps": 0, "line_down_bps": 40_000_000}}}}
        self.assertEqual(bw.box_points(box), {bw.BOX_DOWN: (NOW, 18_400, 40_000), bw.BOX_UP: (NOW, 0, 0)})
        self.assertEqual(bw.box_points({"upnp-box/b": {"at": NOW, "last": {"box": {"down_bps": None, "up_bps": None}}}}), {})
        self.assertEqual(bw.box_points(STATE), {})

    def test_unifi_wan_port_of_the_gateway(self):
        got = bw.unifi_points([{"type": "usw"}, GATEWAY], NOW)
        self.assertEqual(got, {bw.UNIFI_DOWN: (NOW, 1000, 10_000_000), bw.UNIFI_UP: (NOW, 200, 10_000_000)})
        no_wan = {"type": "udm", "port_table": [{"port_idx": 1, "is_uplink": True, "rx_bytes-r": 1_250, "tx_bytes-r": 0, "speed": 1000}]}
        self.assertEqual(bw.unifi_points([no_wan], NOW)[bw.UNIFI_DOWN][1], 10)   # no wan1: the port marked as uplink
        self.assertEqual(bw.unifi_points([{"type": "usw", "port_table": []}], NOW), {})

    def test_stored_each_reading_but_not_twice(self):
        with tempfile.TemporaryDirectory() as tmp:
            f, db = Path(tmp) / "connectors.json", Path(tmp) / "t.db"
            f.write_text(json.dumps(STATE), encoding="utf-8")
            self.assertEqual(bw.sample(db, f, [GATEWAY], now=NOW), 4)
            self.assertEqual(bw.sample(db, f, [GATEWAY], now=NOW + 30), 0)   # same Freebox reading, UniFi under the gap
            self.assertEqual(bw.sample(db, f, [GATEWAY], now=NOW + 150), 2)   # UniFi again, the Freebox reading is still the same
            self.assertEqual(th.series(db, bw.UNIFI_DOWN, 24, now=NOW + 150), [[NOW, 1000, 10_000_000], [NOW + 150, 1000, 10_000_000]])
            self.assertEqual(bw.sample(db, Path(tmp) / "none.json", [], now=NOW + 400), 0)


if __name__ == "__main__":
    unittest.main()
