"""fast.statuses_missing: the state of the connectors read only by the light reading (Beszel), for the settings cards."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fast  # noqa: E402


class Missing(unittest.TestCase):
    live = {"sources": {"beszel/beszel": {"ok": True, "status": {"10.0.0.2": {}, "10.0.0.3": {}}},
                        "mynetwork/mynetwork": {"ok": True}, "proxmox/pve": {"ok": False, "error": "injoignable (timed out)"}}}

    def test_only_what_the_collection_does_not_list(self):
        got = fast.statuses_missing(self.live, {("mynetwork", "mynetwork")})
        self.assertEqual([(r["type"], r["name"], r["ok"], r["message"]) for r in got],
                         [("beszel", "beszel", True, "2 système(s)"), ("proxmox", "pve", False, "injoignable (timed out)")])

    def test_followed_systems_are_counted_for_the_tag(self):
        got = fast.statuses_missing(self.live, set())
        self.assertEqual([r["found"] for r in got if r["type"] == "beszel"], [[{"name": "systèmes", "count": 2}]])

    def test_nothing_without_a_light_reading(self):
        self.assertEqual(fast.statuses_missing({}, set()), [])


if __name__ == "__main__":
    unittest.main()
