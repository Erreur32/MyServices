"""connectors/hitron_coda.py: the reading of the web pages of a Hitron CODA against frozen answers (fetch() replaced), never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import json
import unittest

from connectors.base import ConnectorError, Context
from connectors.hitron_coda import LOCKED, REFUSED, REFUSED_BY, HitronCoda, address_of, seconds_of, signal_facts

BASE = "http://192.168.0.1"
PUBLIC_IP = ".".join(("1", "1", "1", "42"))   # a global address: the documentation ranges are not
SECRET = "pw-" + "x".join(("a", "b", "c"))    # built at run time, never a literal credential
INFO = [{"swVersion": "7.1.1.1.2-RC", "wanIp": PUBLIC_IP + "/21", "systemUptime": "04 Days,22 Hours,23 Minutes,48 Seconds"}]
INIT = [{"registration": "Success", "networkAccess": "Permitted"}]
DOWN = [{"signalStrength": "3.500", "snr": "36.4"}, {"signalStrength": "1.500", "snr": "35.0"}]
UP = [{"signalStrength": "47.500"}]
HOSTS = [{"online": "active"}, {"online": "inactive"}, {"online": "active"}]


def j(v) -> bytes:
    return json.dumps(v).encode()


class Fake(HitronCoda):
    """Answers by path; a path not listed is a 404. Records the calls."""

    def __init__(self, answers: dict, **conf):
        super().__init__({"type": "hitron-coda", "name": "box", "url": BASE, "username": "cusadmin", "password": SECRET, **conf}, Context())
        self.answers, self.calls = answers, []

    def fetch(self, path, form=None):
        self.calls.append((path, form))
        if path not in self.answers:
            raise ConnectorError("HTTP 404")
        answer = self.answers[path]
        return answer(form) if callable(answer) else answer


def good() -> dict:
    return {"index.html": b"", "goform/login": b"success", "goform/logout": b"", "data/getSysInfo.asp": j(INFO), "data/getCMInit.asp": j(INIT),
            "data/dsinfo.asp": j(DOWN), "data/usinfo.asp": j(UP), "data/getConnectInfo.asp": j(HOSTS)}


class Helpers(unittest.TestCase):
    def test_readers(self):
        self.assertEqual(seconds_of("04 Days,22 Hours,23 Minutes,48 Seconds"), 4 * 86400 + 22 * 3600 + 23 * 60 + 48)
        self.assertIsNone(seconds_of("?"))
        self.assertEqual(address_of(PUBLIC_IP + "/21"), PUBLIC_IP)
        self.assertIsNone(address_of("10.40.1.2/21"))
        self.assertEqual([f["label"] for f in signal_facts(DOWN, UP)], ["Signal descendant", "Signal montant"])
        self.assertEqual(signal_facts([], []), [])


class Reading(unittest.TestCase):
    def setUp(self):
        REFUSED_BY.clear()

    def test_full(self):
        box = Fake(good())
        card = box.collect()
        b = card["box"]
        self.assertEqual((b["line"], b["connected"], b["public_ip"], b["firmware"], b["devices"], b["uptime_s"]), ("cable", True, PUBLIC_IP, "7.1.1.1.2-RC", 2, 4 * 86400 + 22 * 3600 + 23 * 60 + 48))
        self.assertIn("Signal descendant", [f["label"] for f in card["facts"]])
        self.assertEqual(box.calls[-1][0], "goform/logout")
        self.assertNotIn(SECRET, json.dumps(card))
        self.assertTrue(box.test().ok)

    def test_missing_pages(self):
        answers = {k: v for k, v in good().items() if k in ("goform/login", "data/getSysInfo.asp")}
        b = Fake(answers).collect()["box"]
        self.assertEqual((b["connected"], b["devices"], b["public_ip"]), (None, None, PUBLIC_IP))

    def test_refused_once_and_remembered(self):
        answers = {**good(), "goform/login": b"failed"}
        box = Fake(answers)
        with self.assertRaises(ConnectorError) as e:
            box.collect()
        self.assertEqual(str(e.exception), REFUSED)
        self.assertNotIn(SECRET, str(e.exception))
        self.assertEqual(sum(1 for c in box.calls if c[0] == "goform/login"), 1)
        again = Fake(answers)
        with self.assertRaises(ConnectorError):
            again.collect()
        self.assertEqual(again.calls, [])
        Fake(good(), password=SECRET + "2").collect()   # other settings: tried again

    def test_locked(self):
        box = Fake({**good(), "goform/login": b"LoginProtect=9|58|21"})
        with self.assertRaises(ConnectorError) as e:
            box.collect()
        self.assertEqual(str(e.exception), LOCKED)
        self.assertEqual(REFUSED_BY, {})

    def test_not_a_hitron_and_unreadable(self):
        box = Fake({})
        with self.assertRaises(ConnectorError):
            box.collect()
        box = Fake({**good(), "data/getSysInfo.asp": b"nope"})
        with self.assertRaises(ConnectorError):
            box.collect()
        box = Fake({**good(), "data/getSysInfo.asp": b"<html>login</html>"})
        with self.assertRaises(ConnectorError):
            box.collect()


if __name__ == "__main__":
    unittest.main()
