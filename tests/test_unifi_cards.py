"""unifi_cards.py: the data of the UniFi cards, read through MynetworK and kept a few seconds.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import unifi_cards  # noqa: E402
from connectors.base import ConnectorError  # noqa: E402
from connectors.mynetwork import MynetworK  # noqa: E402


class Fake:
    type = "mynetwork"

    def __init__(self, result):
        self.result, self.calls = result, 0

    def card_devices(self):
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def run(insts, now):
    with mock.patch.object(unifi_cards.connectors, "instances", return_value=insts):
        return unifi_cards.read({}, now)


class Cards(unittest.TestCase):
    def setUp(self):
        unifi_cards.reset()

    def test_devices_of_the_first_mynetwork_that_has_the_route(self):
        none, ok = Fake(None), Fake([{"mac": "aa"}])
        doc = run([none, ok], 100.0)
        self.assertEqual((doc["source"], doc["devices"], doc["error"]), ("mynetwork", [{"mac": "aa"}], ""))

    def test_the_unifi_controller_is_read_when_mynetwork_has_no_route(self):
        ctl = Fake([{"mac": "bb"}])
        ctl.type, ctl.conf = "unifi", {"auth": "account"}
        doc = run([Fake(None), ctl], 100.0)
        self.assertEqual((doc["source"], doc["devices"]), ("unifi", [{"mac": "bb"}]))

    def test_a_controller_with_an_api_key_is_not_asked(self):
        key = Fake([{"mac": "bb"}])
        key.type, key.conf = "unifi", {"auth": "api_key"}
        self.assertIsNone(run([key], 100.0)["source"])
        self.assertEqual(key.calls, 0)

    def test_a_controller_that_fails_is_told_and_its_detail_kept_out_of_the_page(self):
        ctl = Fake(ConnectorError("HTTP 500 secret detail"))
        ctl.type, ctl.conf = "unifi", {"auth": "account"}
        doc = run([ctl], 100.0)
        self.assertEqual((doc["source"], doc["error"]), (None, unifi_cards.FAILED_CONTROLLER))

    def test_a_wrong_connector_setting_gives_no_source(self):
        with mock.patch.object(unifi_cards.connectors, "instances", side_effect=ConnectorError("réglage faux")):
            doc = unifi_cards.read({}, 100.0)
        self.assertEqual((doc["source"], doc["devices"], doc["error"]), (None, [], ""))

    def test_a_failed_reading_is_not_asked_again_for_a_while(self):
        f = Fake(ConnectorError("down"))
        run([f], 100.0)
        run([f], 100.0 + unifi_cards.TTL + 5)   # past the normal delay, still inside the longer one after a failure
        self.assertEqual(f.calls, 1)
        run([f], 100.0 + unifi_cards.TTL_FAILED + 1)
        self.assertEqual(f.calls, 2)

    def test_one_reading_is_shared_for_a_few_seconds(self):
        f = Fake([{"mac": "aa"}])
        run([f], 100.0)
        run([f], 103.0)
        self.assertEqual(f.calls, 1)
        run([f], 100.0 + unifi_cards.TTL + 1)
        self.assertEqual(f.calls, 2)

    def test_no_route_gives_no_source_and_an_error_is_told(self):
        self.assertIsNone(run([Fake(None)], 100.0)["source"])
        unifi_cards.reset()
        doc = run([Fake(ConnectorError("HTTP 500"))], 100.0)
        self.assertEqual((doc["source"], doc["devices"], doc["error"]), (None, [], unifi_cards.FAILED))


class Connector(unittest.TestCase):
    def conn(self, got):
        c = MynetworK.__new__(MynetworK)
        c._get = lambda path, params=None, optional=False: got
        return c

    def test_secrets_and_non_devices_are_dropped(self):
        got = [{"mac": "aa", "name": "sw", "x_authkey": "no", "port_table": [{"port_idx": 1, "up": True, "x_password": "no"}]}, {"name": "no mac"}, "x"]
        out = self.conn(got).card_devices()
        self.assertEqual(out, [{"mac": "aa", "name": "sw", "port_table": [{"port_idx": 1, "up": True}]}])

    def test_absent_route_is_none(self):
        self.assertIsNone(self.conn(None).card_devices())
        self.assertIsNone(self.conn({"not": "a list"}).card_devices())


if __name__ == "__main__":
    unittest.main()
