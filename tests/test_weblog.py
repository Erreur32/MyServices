"""Web traffic of the NPM logs: the reader run on the machine (weblog_remote.py), its hourly history and flags (tile_history.web_trend), the alerts.

  python3 -m unittest discover -s tests
"""
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from msv.collect import health, tile_history as th, watcher, weblog_remote as wr  # noqa: E402

TZ = timezone(timedelta(hours=1))
NOW = datetime(2026, 11, 2, 12, 30, tzinfo=TZ).timestamp()


def line(t, host, ip, status=200, ua="Mozilla/5.0"):
    d = datetime.fromtimestamp(t, TZ).strftime("%d/%b/%Y:%H:%M:%S %z")
    return f'[{d}] - {status} {status} - GET https {host} "/" [Client {ip}] [Length 10] [Gzip -] [Sent-to 192.0.2.1] "{ua}" "-"\n'


class Reader(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def log(self, name, lines):
        p = self.dir / name
        p.write_text("".join(lines), encoding="utf-8")
        return str(p)

    def test_sent_between_single_quotes(self):
        self.assertNotIn("'", Path(wr.__file__).read_text(encoding="utf-8"))
        self.assertTrue(health.WEBLOG_CMD.startswith("python3 -c '") and health.WEBLOG_CMD in health.LINUX_AGENT_COMMANDS)
        self.assertTrue(any(s in health.WEBLOG_CMD for s in health.SLOW_CMDS))   # 40 s, on the agent too

    def test_totals_per_site_hour_and_diffuse_addresses(self):
        old = [line(NOW - 2 * 86400 + i, "rss.example.test", "203.0.113.1") for i in range(5000)]   # two days ago: skipped by the search
        day = [line(NOW - 3 * 3600 + i, "rss.example.test", f"198.51.100.{i % 40}") for i in range(40 * 60)]   # 40 addresses, 60 each: diffuse
        day += [line(NOW - 120, "rss.example.test", "203.0.113.9", 502)] * 3 + [line(NOW - 60, "rss.example.test", "203.0.113.8", ua="Googlebot/2.1")]
        day += [line(NOW - 30, "git.example.test", "203.0.113.7")] * 2
        w = wr.read([self.log("proxy-host-1_access.log", old + day)], NOW)
        rss = w["sites"]["rss.example.test"]
        self.assertEqual(sum(n for _, n, _ in rss["h"]), 2404)
        self.assertEqual((rss["dip"], rss["dreq"], rss["bots"], rss["m10"]), (40, 2400, 1, [4, 3]))
        self.assertEqual(rss["ips"], 41)   # 40 diffuse and the 5xx one; the bot is not an address of the site
        self.assertEqual(w["ips"], 43)
        self.assertEqual(list(w["sites"]), ["rss.example.test", "git.example.test"])   # busiest first
        self.assertLessEqual(len(w["top"]), wr.TOP_IPS)
        self.assertEqual(w["top"][0][1:], ["rss.example.test", 3])

    def test_start_of_finds_the_day_without_reading_the_week(self):
        lines = [line(NOW - 7 * 86400 + i * 60, "a.test", "203.0.113.1") for i in range(7 * 1440)]
        p = self.log("proxy-host-2_access.log", lines)
        with open(p, "rb") as f:
            size = f.seek(0, 2)
            at = wr.start_of(f, size, NOW - 86400)
            f.seek(at)
            first = [wr.when(x.decode()) for x in f.readlines()[:3]]
        self.assertLess(at, size)
        self.assertGreater(at, size * 0.8)
        self.assertTrue(all(t is None or t <= NOW - 86400 for t in first[:1]))

    def test_not_a_log_line(self):
        self.assertIsNone(wr.when("garbage"))
        self.assertIsNone(wr.when("[Client 1.2.3.4] [Length 1] [Gzip -] [x]"))
        self.assertEqual(wr.when(line(NOW, "a.test", "203.0.113.1")), NOW)


class Trend(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = Path(tmp.name) / "t.db"

    @staticmethod
    def web(hours, now=NOW, dip=0, dreq=0, m10=(0, 0)):
        """hours: requests of the hours before `now`, oldest first, the last one being the current hour"""
        cur = int(now) // 3600 * 3600
        h = [[cur - (len(hours) - 1 - i) * 3600, n, 0] for i, n in enumerate(hours)]
        return {"at": int(now), "sites": {"a.test": {"h": h, "dip": dip, "dreq": dreq, "m10": list(m10)}}}

    def test_usual_level_and_peak(self):
        w = self.web([400] * 20 + [4000, 900])
        th.web_trend(self.db, "m1", w, NOW)
        self.assertEqual((w["usual"], w["last"], w["now"], w["rising"]), (400, 4000, 900, True))
        self.assertEqual(w["sites"]["a.test"]["usual"], 400)
        calm = self.web([400] * 20 + [600, 300])
        th.web_trend(self.db, "m1", calm, NOW)
        self.assertFalse(calm["rising"])

    def test_no_history_no_usual(self):
        w = self.web([5000, 5000])
        th.web_trend(self.db, "m2", w, NOW)
        self.assertEqual((w["usual"], w["rising"]), (None, False))

    def test_diffuse_and_errors(self):
        w = self.web([1000], dip=184, dreq=600, m10=(200, 30))
        th.web_trend(self.db, "m3", w, NOW)
        s = w["sites"]["a.test"]
        self.assertEqual((s["diffuse"], s["errors"], s["total"]), (True, True, 1000))
        few = self.web([1000], dip=5, dreq=900, m10=(20, 20))   # 5 addresses are not diffuse; 20 requests are too few to judge
        th.web_trend(self.db, "m3", few, NOW)
        self.assertEqual((few["sites"]["a.test"]["diffuse"], few["sites"]["a.test"]["errors"]), (False, False))


class Alerts(unittest.TestCase):
    def test_peak_and_scraping_events(self):
        hosts = [{"id": "m1", "name": "ovh · 203.0.113.5", "web": {"rising": True, "last": 4000, "now": 900, "usual": 400,
                  "sites": {"rss.example.test": {"diffuse": True, "dreq": 620, "total": 1000, "dip": 184}, "b.test": {"diffuse": False}}}},
                 {"id": "m2", "name": "nas"}]
        peaks, scraped = watcher.web_snaps(hosts)
        self.assertEqual(list(peaks), ["web_pic:m1"])
        self.assertIn("4000 requêtes en une heure, contre 400", peaks["web_pic:m1"]["text"])
        self.assertEqual(list(scraped), ["aspiration:m1:rss.example.test"])
        self.assertIn("62 % des requêtes du jour viennent de 184 IP", scraped["aspiration:m1:rss.example.test"]["text"])
        self.assertEqual(watcher.web_snaps(None), (None, None))
        kinds = __import__("msv.alerts.alerts", fromlist=["KINDS"]).KINDS
        self.assertLessEqual({"web_pic", "aspiration"}, set(kinds))
        self.assertLessEqual({"web_pic", "aspiration"}, set(watcher.SEVERITY))
        self.assertLessEqual({"web_pic", "aspiration"}, set(watcher.LABEL))


if __name__ == "__main__":
    unittest.main()
