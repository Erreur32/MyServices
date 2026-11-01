"""connectors/reqstats.py: request counters per connector and route, what is to watch, the limits known (development block).

  python3 -m unittest discover -s tests
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import reqstats  # noqa: E402
from msv.remote import sshmux  # noqa: E402

URL = "http://10.0.0.9:7505"


class Routes(unittest.TestCase):
    def test_route_without_query_address_grouped_mode_kept(self):
        self.assertEqual(reqstats.route_of(URL + "/api/network-scan/history?limit=1000&offset=0"), "/api/network-scan/history")
        self.assertEqual(reqstats.route_of(URL + "/api/search/ip-details/10.0.0.2"), "/api/search/ip-details/*")
        self.assertEqual(reqstats.route_of(URL + "/api/plugins/unifi/top-traffic?mode=live&limit=10"), "/api/plugins/unifi/top-traffic?mode=live")
        self.assertEqual(reqstats.route_of(URL + "/api/plugins/unifi/top-traffic"), "/api/plugins/unifi/top-traffic")
        self.assertEqual(reqstats.route_of(URL + "/api/lan/devices?compact=1"), "/api/lan/devices")


class Tasks(unittest.TestCase):
    """A task is a short process: its calls reach the server through a file."""
    def setUp(self):
        reqstats.reset()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.spool = str(Path(self.tmp.name) / "spool.jsonl")

    def in_task(self):
        return mock.patch.dict(os.environ, {reqstats.SPOOL_ENV: self.spool})

    def test_a_task_writes_to_the_file_and_the_server_reads_it_once(self):
        with self.in_task():
            reqstats.record("mynetwork/lan", URL + "/api/lan/devices?key=secret", 12, 200, now=1000)
            self.assertEqual(reqstats.snapshot()["rows"], [])
        self.assertNotIn("secret", Path(self.spool).read_text())
        with Path(self.spool).open("a") as f:
            f.write('["cut short')   # a task killed mid-line
        reqstats.drain(self.spool)
        reqstats.drain(self.spool)
        [row] = reqstats.snapshot(now=1010)["rows"]
        self.assertEqual((row["owner"], row["route"], row["total"], row["per_min"]), ("mynetwork/lan", "/api/lan/devices", 1, 1))
        self.assertEqual(os.listdir(self.tmp.name), [])

    def test_no_file_is_nothing_to_read(self):
        reqstats.drain(self.spool)
        self.assertEqual(reqstats.snapshot()["rows"], [])

    def test_ssh_counted_per_machine_and_read_local_is_not(self):
        with mock.patch.object(sshmux.subprocess, "run", return_value=SimpleNamespace(returncode=1, stderr="", stdout="")):
            sshmux.ssh_run("docker", "nas", ["ssh", "nas", "docker ps"])
            sshmux.ssh_run("docker", "local", ["sh", "-c", "docker ps"])
        with mock.patch.object(sshmux.subprocess, "run", return_value=SimpleNamespace(returncode=255, stderr="refused", stdout="")):
            sshmux.ssh_run("health", "nas", ["ssh", "nas", "x"])
        with mock.patch.object(sshmux.subprocess, "run", side_effect=subprocess.TimeoutExpired("ssh", 1)), self.assertRaises(subprocess.TimeoutExpired):
            sshmux.ssh_run("ports", "nas", ["ssh", "nas", "x"])
        rows = {(r["owner"], r["route"]): (r["last_code"], r["last_error"]) for r in reqstats.snapshot()["rows"]}
        self.assertEqual(rows, {("ssh/nas", "docker"): (1, ""), ("ssh/nas", "health"): (None, "refused"), ("ssh/nas", "ports"): (None, "no answer")})


class Counters(unittest.TestCase):
    def setUp(self):
        reqstats.reset()

    def test_windows_durations_and_codes(self):
        for i in range(5):
            reqstats.record("mynetwork/lan", URL + "/api/network-scan/history?offset=0", 100 + i, 200, now=1000 + i * 10)
        reqstats.record("mynetwork/lan", URL + "/api/network-scan/history", 300, None, "injoignable (x)", now=5000)
        snap = reqstats.snapshot(now=5010)
        [row] = snap["rows"]
        self.assertEqual((row["owner"], row["route"], row["total"]), ("mynetwork/lan", "/api/network-scan/history", 6))
        self.assertEqual((row["per_min"], row["per_hour"]), (1, 1))   # the five old calls are more than an hour back
        self.assertEqual((row["last_ms"], row["avg_ms"], row["last_code"], row["last_error"]), (300, 135, None, "injoignable (x)"))
        self.assertEqual((row["limit"], row["watch"], snap["watch"]), (None, False, []))

    def test_route_near_its_limit_is_to_watch(self):
        for i in range(24):
            reqstats.record("mynetwork/lan", URL + f"/api/search/ip-details/10.0.0.{i}", 50, 200, now=1000 + i)
        snap = reqstats.snapshot(now=1030)
        [row] = snap["rows"]
        self.assertEqual((row["limit"], row["per_min"], row["watch"]), (30, 24, True))
        self.assertEqual(snap["watch"], [{"owner": "mynetwork/lan", "route": "/api/search/ip-details/*", "per_min": 24, "limit": 30, "n429": 0, "retry_after": None}])
        self.assertFalse(reqstats.snapshot(now=1000 + 3600 + 30)["rows"][0]["watch"])   # an hour later: nothing recent

    def test_429_recent_is_to_watch_with_its_delay(self):
        reqstats.record("mynetwork/lan", URL + "/api/plugins/unifi/top-traffic?mode=live", 20, 429, "HTTP 429 : Too many requests", 12, now=1000)
        snap = reqstats.snapshot(now=1100)
        [row] = snap["rows"]
        self.assertEqual((row["n429"], row["retry_after"], row["last_code"], row["watch"]), (1, 12, 429, True))
        self.assertEqual(snap["watch"][0]["retry_after"], 12)
        reqstats.record("mynetwork/lan", URL + "/api/plugins/unifi/top-traffic?mode=live", 20, 200, now=1200)   # back to normal: the 429 stays counted, not to watch
        row = reqstats.snapshot(now=1300)["rows"][0]
        self.assertEqual((row["n429"], row["watch"]), (1, False))

    def test_total_limit_of_a_connector(self):
        for i in range(250):
            reqstats.record("mynetwork/lan", URL + f"/api/route{i % 7}", 1, 200, now=1000)
        reqstats.hit("mynetwork/lan", "x")   # a cache hit is not a call
        snap = reqstats.snapshot(now=1001)
        self.assertEqual(snap["watch"], [{"owner": "mynetwork/lan", "route": "*", "per_min": 250, "limit": 300, "n429": 0, "retry_after": None}])
        self.assertEqual([r for r in snap["rows"] if r["route"] == "cache:x"][0]["hits"], 1)
        self.assertEqual(reqstats.snapshot(now=1001)["rows"][0]["owner"], "mynetwork/lan")

    def test_unknown_service_has_no_limit_and_rows_are_bounded(self):
        for i in range(reqstats.MAX_ROUTES + 5):
            reqstats.record("beszel/hub", URL + f"/api/r{i}", 1, 200, now=1000 + i)
        snap = reqstats.snapshot(now=2000)
        self.assertEqual(len(snap["rows"]), reqstats.MAX_ROUTES)
        self.assertNotIn("/api/r0", [r["route"] for r in snap["rows"]])   # the oldest row went
        self.assertEqual(snap["watch"], [])
        reqstats.reset()
        self.assertEqual(reqstats.snapshot()["rows"], [])


if __name__ == "__main__":
    unittest.main()
