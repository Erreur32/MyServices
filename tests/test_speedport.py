"""connectors/speedport.py: the reading of the web pages of a Speedport against frozen answers (fetch() replaced), never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import hashlib
import json
import unittest

from connectors import speedport
from connectors.base import ConnectorError, Context
from connectors.speedport import REFUSED_BY, SHARED_KEY, Speedport, count_devices, decode, kbit, online, records, seal

BASE = "http://speedport.ip"
PUBLIC_IP = ".".join(("1", "1", "1", "42"))   # a global address: the documentation ranges are not
SECRET = "pw-" + "x".join(("a", "b", "c"))    # built at run time, never a literal credential
CHALLENGE = "ab" * 32


def page(**values) -> list:
    return [{"vartype": "value", "varid": k, "varvalue": v} for k, v in values.items()]


def blob(key: str, **values) -> bytes:
    return seal(key, json.dumps(page(**values))).encode()


STATUS = dict(device_name="Speedport Smart 4", firmware_version="010137.4.2.002.0", dsl_downstream="100000", dsl_upstream="40000", inet_uptime="7200", onlinestatus="online", use_wlan="1", serial_number="SECRETSERIAL")
DEVICES = [{"vartype": "template", "varid": "addmdevice", "varvalue": [{"varid": "mdevice_mac", "varvalue": m}, {"varid": "mdevice_connected", "varvalue": c}]} for m, c in (("m1", "1"), ("m2", "0"), ("m3", "1"))]


class Fake(Speedport):
    """Answers by path; a path not listed is a 404. Records the calls."""

    def __init__(self, answers: dict, **conf):
        super().__init__({"type": "speedport", "name": "box", "url": BASE, **conf}, Context())
        self.answers, self.calls = answers, []

    def fetch(self, path, body=None, referer=""):
        self.calls.append((path, body))
        if path not in self.answers:
            raise ConnectorError("HTTP 404")
        answer = self.answers[path]
        return answer(body) if callable(answer) else answer


def login_answers(good: bool) -> dict:
    def login(body):
        text = speedport.unseal(SHARED_KEY, body).decode()
        if text.startswith("getChallenge"):
            return blob(SHARED_KEY, challenge=CHALLENGE)
        proof = hashlib.sha256(f"{CHALLENGE}:{SECRET}".encode()).hexdigest()
        return blob(SHARED_KEY, login="success" if good and proof in text else "failed")
    return {"html/login/index.html": b"var httoken = 123;", "data/Login.json": login,
            "data/IPData.json": blob(CHALLENGE, public_ip_v4=PUBLIC_IP), "data/DeviceList.json": seal(CHALLENGE, json.dumps(DEVICES)).encode()}


class Helpers(unittest.TestCase):
    def test_round_trip_and_plain(self):
        self.assertEqual(decode(blob(SHARED_KEY, a="1"), SHARED_KEY), {"a": "1"})
        self.assertEqual(decode(json.dumps(page(a="1")).encode()), {"a": "1"})
        with self.assertRaises(ConnectorError):
            decode(blob(CHALLENGE, a="1"), SHARED_KEY)
        with self.assertRaises(ConnectorError):
            decode(b"<html>")

    def test_small_readers(self):
        self.assertEqual((kbit("100"), kbit(0), kbit(None), online("online"), online("offline"), online("?")), (100000, None, None, True, False, None))
        self.assertEqual(count_devices(records(DEVICES)), 2)
        self.assertIsNone(count_devices({}))


class Reading(unittest.TestCase):
    def setUp(self):
        REFUSED_BY.clear()

    def test_without_account_plain_and_encrypted(self):
        for raw in (json.dumps(page(**STATUS)).encode(), blob(SHARED_KEY, **STATUS)):
            box = Fake({"data/Status.json": raw}).collect()["box"]
            self.assertEqual((box["model"], box["line"], box["connected"], box["line_down_bps"], box["uptime_s"], box["wifi"], box["public_ip"], box["devices"]),
                             ("Speedport Smart 4", "dsl", True, 100_000_000, 7200, True, None, None))

    def test_with_account(self):
        f = Fake({"data/Status.json": blob(SHARED_KEY, **STATUS), **login_answers(True)}, password=SECRET)
        card = f.collect()
        self.assertEqual((card["box"]["public_ip"], card["box"]["devices"]), (PUBLIC_IP, 2))
        self.assertNotIn(PUBLIC_IP, str(card["facts"]))
        self.assertNotIn(SECRET, str(f.calls))
        self.assertNotIn("SECRETSERIAL", str(card))

    def test_refused_once_then_remembered(self):
        f = Fake({"data/Status.json": blob(SHARED_KEY, **STATUS), **login_answers(False)}, password=SECRET)
        with self.assertRaises(ConnectorError) as cm:
            f.collect()
        self.assertNotIn(SECRET, str(cm.exception))
        n = len(f.calls)
        with self.assertRaises(ConnectorError):
            f.collect()
        self.assertEqual(len([c for c in f.calls[n:] if c[0] == "data/Login.json"]), 0)

    def test_not_a_speedport_and_offline(self):
        with self.assertRaises(ConnectorError) as cm:
            Fake({}).collect()
        self.assertIn("Speedport", str(cm.exception))
        box = Fake({"data/Status.json": blob(SHARED_KEY, onlinestatus="offline")}).collect()
        self.assertEqual(box["problems"], ["connexion Internet coupée"])


if __name__ == "__main__":
    unittest.main()
