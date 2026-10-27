"""dns_probe: the latency of a DNS server and the points kept for the DNS tiles, against a fake server on the loopback."""
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import dns_probe as dp  # noqa: E402
import tile_history as th  # noqa: E402


class FakeDns:
    """Answers every query with a header that says « response » (or does not answer at all)."""
    def __init__(self, answer: bool = True):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.answer = answer
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        try:
            data, addr = self.sock.recvfrom(512)
        except OSError:
            return
        if self.answer:
            self.sock.sendto(data[:2] + b"\x81\x80" + data[4:], addr)

    def close(self):
        self.sock.close()


class Latency(unittest.TestCase):
    def test_a_server_that_answers_gives_its_latency(self):
        fake = FakeDns()
        try:
            ms = dp.latency_ms("127.0.0.1", port=fake.port, timeout=1)
        finally:
            fake.close()
        self.assertIsNotNone(ms)
        self.assertGreaterEqual(ms, 1)

    def test_a_silent_server_gives_none(self):
        fake = FakeDns(answer=False)
        try:
            self.assertIsNone(dp.latency_ms("127.0.0.1", port=fake.port, timeout=0.3))
        finally:
            fake.close()


class Points(unittest.TestCase):
    def test_probe_counts_the_servers_that_answer(self):
        answers = {"10.0.0.1": 5, "10.0.0.2": None, "1.1.1.1": 12, "8.8.8.8": None}
        original = dp.latency_ms
        dp.latency_ms = lambda ip, *a, **k: answers[ip]
        try:
            got = dp.probe(["10.0.0.1", "10.0.0.2"])
        finally:
            dp.latency_ms = original
        self.assertEqual(got[dp.LOCAL], (1, 2))
        self.assertEqual(got["dns.ext.1.1.1.1.ms"], (12, 0))
        self.assertEqual(got["dns.ext.1.1.1.1.up"], (1, 1))
        self.assertEqual(got["dns.ext.8.8.8.8.up"], (0, 1))
        self.assertNotIn("dns.ext.8.8.8.8.ms", got)   # no latency for a resolver that did not answer

    def test_sample_stores_once_per_minute(self):
        original = dp.latency_ms
        dp.latency_ms = lambda ip, *a, **k: 7
        try:
            with tempfile.TemporaryDirectory() as tmp:
                db = Path(tmp) / "t.db"
                self.assertEqual(dp.sample(db, ["10.0.0.1"], now=10_000), 5)   # local + 2 x (answers, latency)
                self.assertEqual(dp.sample(db, ["10.0.0.1"], now=10_010), 0)   # the same minute
                self.assertEqual(dp.sample(db, ["10.0.0.1"], now=10_060), 5)   # the next one
                self.assertEqual(th.series(db, dp.LOCAL, 24, now=10_060), [[10_000, 1, 1], [10_060, 1, 1]])
        finally:
            dp.latency_ms = original

    def test_nothing_to_ask(self):
        self.assertEqual(dp.probe([], external=()), {})


if __name__ == "__main__":
    unittest.main()
