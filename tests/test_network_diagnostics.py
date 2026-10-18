"""network_diagnostics.py: ports negotiated below their maximum and the other potential problems of the UniFi devices.

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import network_diagnostics as nd  # noqa: E402

GW, SW = "aa:00:00:00:00:01", "aa:00:00:00:00:02"


def port(n, up=True, speed=1000, media="GE", **kw):
    return {"port_idx": n, "up": up, "speed": speed if up else 0, "media": media, **kw}


GATEWAY = {"mac": GW, "name": "Gateway", "type": "udm", "state": 1, "port_table": [port(2, speed=100, media="2.5GE"), port(5, speed=100, media="10GE"), port(3, False, media="2.5GE"), port(7, speed=10000, media="SFP+")]}
SWITCH = {"mac": SW, "name": "Switch", "type": "usw", "state": 1, "uplink": {"uplink_mac": GW, "uplink_remote_port": 7, "port_idx": 10, "speed": 10000},
          "port_table": [port(1, speed=1000, media="2P5GE"), port(2, speed=2500, media="2P5GE"), port(3, speed=10, media="2P5GE"), port(10, speed=10000, media="SFP+")]}
CLIENTS = [{"wired": True, "switch_mac": SW, "switch_port": 1, "name": "nas"}, {"wired": True, "switch_mac": GW, "switch_port": 2, "name": "old-pc"}]


class Ports(unittest.TestCase):
    def test_media_gives_the_maximum(self):
        self.assertEqual([nd.port_max({"media": m}) for m in ("GE", "2P5GE", "2.5GE", "10GE", "SFP+", " sfp+ ", "weird", None)], [1000, 2500, 2500, 10000, 10000, 10000, None, None])

    def test_100_mbps_on_a_faster_port_is_a_warning_and_names_what_is_plugged(self):
        got = nd.findings([GATEWAY, SWITCH], CLIENTS)
        g2 = next(f for f in got if f["device"] == "Gateway" and f["port"] == 2)
        self.assertEqual((g2["severity"], g2["speed"], g2["max"], g2["peer"]), ("warn", 100, 2500, "old-pc"))
        self.assertTrue(any(f["device"] == "Gateway" and f["port"] == 5 and f["severity"] == "warn" for f in got))

    def test_10_mbps_is_bad_and_one_gigabit_on_a_2_5_port_is_only_a_hint(self):
        got = nd.findings([SWITCH], CLIENTS)
        self.assertEqual(next(f for f in got if f["port"] == 3)["severity"], "bad")
        hint = next(f for f in got if f["port"] == 1)
        self.assertEqual((hint["severity"], hint["peer"]), ("info", "nas"))
        self.assertFalse(any(f["port"] == 2 for f in got))        # 2.5G on a 2.5G port: fine

    def test_a_port_down_or_at_its_maximum_is_not_reported(self):
        got = nd.findings([GATEWAY], [])
        self.assertFalse(any(f["port"] in (3, 7) for f in got))

    def test_link_between_two_devices_is_judged_at_the_slower_end(self):
        ok = nd.findings([GATEWAY, SWITCH], [])
        self.assertFalse(any(f["kind"] == "link" for f in ok))                                     # 10G between 10G and 10G
        slow = {**SWITCH, "uplink": {**SWITCH["uplink"], "speed": 1000}}
        got = [f for f in nd.findings([GATEWAY, slow], []) if f["kind"] == "link"]
        self.assertEqual((got[0]["severity"], got[0]["speed"], got[0]["max"], got[0]["peer"]), ("warn", 1000, 10000, "Gateway"))
        self.assertFalse(any(f["device"] == "Switch" and f["port"] == 10 and f["kind"] == "speed" for f in nd.findings([GATEWAY, slow], [])))   # not reported twice


class Others(unittest.TestCase):
    def test_device_down_wan_down_firmware_and_load(self):
        devs = [{"mac": "x1", "name": "AP", "type": "uap", "state": 0}, {"mac": "x2", "name": "GW", "type": "udm", "state": 1, "wan1": {"up": False, "port_idx": 6}, "upgradable": True,
                "upgrade_to_firmware": "9.9.9", "system-stats": {"cpu": 95, "mem": 40}}]
        kinds = [(f["kind"], f["severity"]) for f in nd.findings(devs)]
        self.assertEqual(sorted(kinds), sorted([("offline", "bad"), ("wan", "bad"), ("firmware", "info"), ("load", "warn")]))

    def test_sorted_by_severity_and_odd_data_does_not_raise(self):
        got = nd.findings([GATEWAY, SWITCH, {"mac": None}, {"port_table": "x"}], [{"wired": True}])
        sev = [nd.SEVERITY[f["severity"]] for f in got]
        self.assertEqual(sev, sorted(sev))
        self.assertEqual(nd.summary(got), {"bad": sum(1 for s in sev if s == 0), "warn": sum(1 for s in sev if s == 1), "info": sum(1 for s in sev if s == 2)})


class More(unittest.TestCase):
    def codes(self, devices=(), clients=(), scan=()):
        return sorted((f["code"], f["severity"]) for f in nd.findings(list(devices), list(clients), list(scan)))

    def test_weak_wifi_signal_is_told_with_the_access_point_and_the_client(self):
        ap = {"mac": "ap:1", "name": "Hall", "type": "uap", "state": 1}
        got = nd.findings([ap], [{"wired": False, "signal_dbm": -78, "ap_mac": "ap:1", "name": "phone"}, {"wired": False, "signal_dbm": -90, "ap_mac": "ap:1", "name": "cam"},
                                 {"wired": False, "signal_dbm": -60, "ap_mac": "ap:1", "name": "tv"}, {"wired": True, "signal_dbm": -99}])
        self.assertEqual([(f["code"], f["severity"], f["device"], f["peer"]) for f in got], [("wifi_weak", "bad", "Hall", "cam"), ("wifi_weak", "warn", "Hall", "phone")])

    def test_one_address_with_two_mac_addresses_is_a_conflict(self):
        clients = [{"ip": "10.0.0.5", "mac": "AA:BB:CC:00:00:01", "name": "tv"}]
        scan = [{"ip": "10.0.0.5", "mac": "aa-bb-cc-00-00-02", "status": "online"}, {"ip": "10.0.0.6", "mac": "aa:bb:cc:00:00:03"}, {"ip": "10.0.0.6", "mac": "AA:BB:CC:00:00:03"}]
        got = nd.findings([], clients, scan)
        self.assertEqual([(f["code"], f["args"]["ip"], f["peer"]) for f in got], [("ip_conflict", "10.0.0.5", "tv")])    # the same MAC written two ways is not a conflict

    def test_mesh_temperature_reboot_and_crowded_access_point(self):
        d = {"mac": "m1", "name": "AP", "type": "uap", "state": 1, "uplink": {"type": "wireless"}, "general_temperature": 85, "uptime": 120, "num_sta": 60}
        self.assertEqual(self.codes([d]), sorted([("mesh", "warn"), ("temp", "warn"), ("reboot", "info"), ("clients", "info")]))
        self.assertEqual(self.codes([{**d, "general_temperature": 95, "uplink": {}, "uptime": 99999, "num_sta": 3}]), [("temp", "bad")])

    def test_latency_a_wired_device_should_not_have(self):
        clients = [{"ip": "10.0.0.7", "wired": True}]
        scan = [{"ip": "10.0.0.7", "status": "online", "ping_ms": 80}, {"ip": "10.0.0.8", "status": "online", "ping_ms": 80}, {"ip": "10.0.0.9", "status": "online", "ping_ms": 500},
                {"ip": "10.0.0.10", "status": "offline", "ping_ms": 900}]
        self.assertEqual(self.codes([], clients, scan), sorted([("latency_wired", "warn"), ("latency", "info")]))


class OkPorts(unittest.TestCase):
    def test_up_ports_without_finding_are_listed_with_what_is_plugged(self):
        items = nd.findings([GATEWAY, SWITCH], CLIENTS)
        ok = nd.ok_ports([GATEWAY, SWITCH], CLIENTS, items)
        keys = {(r["device"], r["port"]) for r in ok}
        self.assertIn(("Gateway", 7), keys)                               # up, at its maximum
        self.assertIn(("Switch", 2), keys)
        self.assertNotIn(("Gateway", 3), keys)                            # down
        self.assertNotIn(("Gateway", 2), keys)                            # has a finding
        self.assertNotIn(("Switch", 1), keys)
        self.assertIsNone(next(r for r in ok if r["device"] == "Gateway" and r["port"] == 7)["peer"])
        self.assertEqual(next(r for r in ok if r["device"] == "Switch" and r["port"] == 10)["peer"], "Gateway")     # the uplink names its other end


class Cards(unittest.TestCase):
    CLIENT = {"wired": True, "mac": "04:42:1a:e9:4e:a5", "switch_mac": SW, "switch_port": 3, "name": "pc", "switch_name": "Switch"}

    def run_nic(self, nic, devices=None):
        return nd.findings(devices if devices is not None else [SWITCH], [self.CLIENT], [], [{"name": "pc", "ip": "10.0.0.50", "nics": [{"mac": "04:42:1A:E9:4E:A5", **nic}]}])

    def test_half_duplex_is_bad_and_names_the_switch_port(self):
        got = [f for f in self.run_nic({"name": "eth0", "speed": 100, "duplex": "half"}) if f["code"] == "nic_half"]
        self.assertEqual((got[0]["severity"], got[0]["device"], got[0]["peer"]), ("bad", "pc", "Switch port 3"))
        self.assertTrue([f for f in self.run_nic({"name": "Ethernet", "speed": 1000, "full_duplex": False}) if f["code"] == "nic_half"])   # the Windows way

    def test_a_forced_speed_is_a_warning_and_automatic_is_not(self):
        self.assertTrue([f for f in self.run_nic({"speed": 1000, "setting": "1.0 Gbps Full Duplex"}) if f["code"] == "nic_forced"])
        self.assertFalse([f for f in self.run_nic({"speed": 1000, "setting": "Auto Negotiation"}) if f["code"] == "nic_forced"])
        self.assertFalse([f for f in self.run_nic({"speed": 1000, "setting": "Négociation automatique"}) if f["code"] == "nic_forced"])

    def test_a_card_that_can_do_more_than_it_negotiates(self):
        low = [f for f in self.run_nic({"speed": 1000, "max": 2500}, [{**SWITCH, "port_table": [port(3, speed=1000, media="2P5GE")]}]) if f["code"] == "nic_low"]
        self.assertEqual((low[0]["speed"], low[0]["max"]), (1000, 2500))
        slow_port = [f for f in self.run_nic({"speed": 1000, "max": 2500}, [{**SWITCH, "port_table": [port(3, speed=1000, media="GE")]}]) if f["code"] == "nic_low"]
        self.assertEqual(slow_port, [])                                  # the switch port is a gigabit one: 1000 is all it can do

    def test_card_and_port_not_reporting_the_same_speed(self):
        got = [f for f in self.run_nic({"speed": 100}, [{**SWITCH, "port_table": [port(3, speed=1000, media="GE")]}]) if f["code"] == "nic_mismatch"]
        self.assertEqual((got[0]["speed"], got[0]["max"]), (100, 1000))

    def test_the_machine_card_is_given_next_to_the_switch_port(self):
        machines = [{"name": "pc", "ip": "10.0.0.50", "nics": [{"mac": "04:42:1A:E9:4E:A5", "name": "eth0", "speed": 100, "duplex": "full", "max": 1000}]}]
        sw = {**SWITCH, "port_table": [port(3, speed=1000, media="GE")]}
        items = nd.findings([sw], [self.CLIENT], [], machines)
        ok = nd.ok_ports([sw], [self.CLIENT], [], machines)
        self.assertEqual(ok[0]["nic"], {"machine": "pc", "name": "eth0", "speed": 100, "max": 1000, "duplex": "full", "setting": None})
        self.assertIsNone(nd.ok_ports([sw], [self.CLIENT], [], [])[0]["nic"])                       # the machine did not tell: nothing invented
        slow = nd.findings([{**SWITCH, "port_table": [port(3, speed=100, media="GE")]}], [self.CLIENT], [], machines)
        self.assertEqual(next(f for f in slow if f["kind"] == "speed")["nic"]["speed"], 100)
        self.assertIsNotNone(items)

    def test_no_known_speed_means_no_finding(self):
        self.assertEqual([f for f in self.run_nic({"speed": None, "duplex": "half"}) if f["kind"] == "nic"], [])


class AcceptedFindings(unittest.TestCase):
    def test_remembered_and_out_of_the_summary(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "accepted.json"
            items = [{"severity": "warn", "code": "speed_100", "mac": "AA:BB", "port": 3, "args": {}}, {"severity": "warn", "code": "speed_100", "mac": "AA:BB", "port": 4, "args": {}}]
            nd.set_accepted(f, nd.finding_key(items[0]), "hub", True)
            marked = nd.mark_accepted(items, nd.accepted_keys(f))
            self.assertEqual([i["accepted"] for i in marked], [True, False])
            self.assertEqual(nd.summary(marked)["warn"], 1)
            nd.set_accepted(f, nd.finding_key(items[0]), "", False)
            self.assertEqual(nd.accepted_keys(f), {})
            self.assertEqual(nd.accepted_keys(Path(d) / "missing.json"), {})


class SlowMachineCard(unittest.TestCase):
    def test_100_mbps_card_without_known_maximum_is_reported(self):
        got = nd.findings([], [], [], [{"name": "pc", "ip": "10.0.0.2", "nics": [{"name": "eth0", "mac": "aa:bb:cc:dd:ee:01", "speed": 100, "duplex": "full"}]}])
        self.assertEqual([f["code"] for f in got if f["kind"] == "nic"], ["nic_slow"])

    def test_gigabit_card_is_quiet(self):
        got = nd.findings([], [], [], [{"name": "pc", "ip": "10.0.0.2", "nics": [{"name": "eth0", "mac": "aa:bb:cc:dd:ee:01", "speed": 1000, "duplex": "full"}]}])
        self.assertEqual([f for f in got if f["kind"] == "nic"], [])


if __name__ == "__main__":
    unittest.main()
