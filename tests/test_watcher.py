"""watcher.py : alerte « connecteur en panne » confirmée sur CONFIRM_RUNS passages, puis « rétabli ».

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import watcher  # noqa: E402


def data(ok):
    return {"connectors": [{"type": "beszel", "name": "hub", "ok": ok, "message": "OK" if ok else "HTTP 400 : Failed to authenticate."}]}


class Connectors(unittest.TestCase):
    def run_seq(self, seq):
        prev, pending, out = watcher.connector_snaps(data(seq[0])), {}, []
        for ok in seq[1:]:
            cur = watcher.connector_snaps(data(ok))
            ev, pending = watcher.diff_connectors(prev, cur, pending)
            out.append([e["kind"] for e in ev])
            prev = cur
        return out

    def test_confirmed_failure_then_recovery(self):
        self.assertEqual(watcher.CONFIRM_RUNS, 2)
        self.assertEqual(self.run_seq([True, False, False, False, True, True]), [[], ["connecteur"], [], [], ["connecteur_ok"]])

    def test_single_blip_ignored(self):
        self.assertEqual(self.run_seq([True, False, True, True]), [[], [], []])

    def test_detail_is_the_connector_message(self):
        prev = watcher.connector_snaps(data(True))
        ev, p = watcher.diff_connectors(prev, watcher.connector_snaps(data(False)), {})
        ev, _ = watcher.diff_connectors(prev, watcher.connector_snaps(data(False)), p)
        self.assertEqual(ev[0]["detail"], "HTTP 400 : Failed to authenticate.")
        self.assertIn("connecteur", watcher.LABEL)


class Network(unittest.TestCase):
    """« New device on the network » (MynetworK): reference on the first reading, then one event per unknown device."""

    @staticmethod
    def data(*devices, followed=("10.0.0.2",)):
        return {"machine_list": [{"ip": ip} for ip in followed],
                "network": [{"devices": [{"ip": ip, "mac": mac, "hostname": None, "vendor": "Espressif", "status": "online"} for ip, mac in devices]}]}

    def test_reference_puis_nouvel_appareil(self):
        d1 = self.data(("10.0.0.2", "AA:00:00:00:00:02"), ("10.0.0.7", "AA:00:00:00:00:07"))
        ev, known = watcher.diff_network(None, watcher.network_snaps(d1))
        self.assertEqual((ev, list(known)), ([], ["appareil:AA:00:00:00:00:07"]))   # followed machine left out
        d2 = self.data(("10.0.0.8", "AA:00:00:00:00:07"), ("10.0.0.9", "AA:00:00:00:00:09"))   # same MAC, new IP: not new
        ev, known = watcher.diff_network(known, watcher.network_snaps(d2))
        self.assertEqual([(e["kind"], e["target"], e["label"]) for e in ev], [("appareil", "10.0.0.9", "Espressif")])
        self.assertIn("AA:00:00:00:00:09", ev[0]["detail"])
        self.assertEqual(watcher.diff_network(known, watcher.network_snaps(self.data(("10.0.0.9", "AA:00:00:00:00:09"))))[0], [])

    def test_outil_coupe_garde_ce_qui_est_connu(self):
        _, known = watcher.diff_network(None, watcher.network_snaps(self.data(("10.0.0.7", None))))
        self.assertEqual(watcher.diff_network(known, None), ([], known))
        self.assertEqual(list(known), ["appareil:10.0.0.7"])   # no MAC: keyed by IP
        self.assertIn("appareil", watcher.LABEL)
        self.assertIn("appareil", __import__("alerts").KINDS)


if __name__ == "__main__":
    unittest.main()
