"""connectors/sfrbox.py: the reading of the local API of an SFR Box against frozen XML answers, never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import importlib.util
import unittest

import connectors
from connectors.base import ConnectorError, Context
from connectors.settings import category
from connectors.sfrbox import SFRBox, bits, celsius, line_of

PUBLIC_IP = ".".join(("1", "1", "1", "42"))   # a global address: the documentation ranges are not
BASE = "http://192.168.1.1"


NEEDS_XML = unittest.skipIf(importlib.util.find_spec("defusedxml") is None, "defusedxml absent : tests à lancer dans l'image")


def rsp(tag: str, **attrs) -> bytes:
    body = " ".join(f'{k}="{v}"' for k, v in attrs.items())
    return f'<?xml version="1.0"?><rsp stat="ok" version="1.0"><{tag} {body}/></rsp>'.encode()


FAIL = b'<?xml version="1.0"?><rsp stat="fail" version="1.0"><err code="204" msg="Invalid login and/or password"/></rsp>'
FTTH = {"system.getInfo": rsp("system", product_id="NB8-fibre", net_infra="ftth", version_mainfirmware="NB8-MAIN-R4.0.1", temperature=27560, serial_number="SECRETSERIAL", mac_addr="00:11:22:33:44:55"),
        "wan.getInfo": rsp("wan", status="up", uptime=7200, ip_addr=PUBLIC_IP, infra="ftth")}
DSL = {"system.getInfo": rsp("system", product_id="NB6VAC-FXC-r0", net_infra="adsl", version_mainfirmware="NB6VAC-MAIN-R4.0.44k"),
       "wan.getInfo": rsp("wan", status="up", uptime=10, ip_addr="192.168.0.5"), "dsl.getInfo": rsp("dsl", rate_down=20000, rate_up=1000, status="up")}


class FakeContext(Context):
    """Answers by method name; a method not listed is the box's refusal."""

    def __init__(self, answers: dict):
        super().__init__()
        self.answers, self.calls = answers, []

    def http(self, url, *, method="GET", payload=None, headers=None, binary=False, **kw):
        method_name = url.split("method=")[1]
        self.calls.append((method, method_name, payload))
        if method_name not in self.answers:
            raise ConnectorError("HTTP 404")
        return self.answers[method_name]


def read(answers: dict, **conf) -> tuple[dict, FakeContext]:
    ctx = FakeContext(answers)
    return SFRBox({"type": "sfrbox", "name": "box", "url": BASE, **conf}, ctx).collect(), ctx


class Helpers(unittest.TestCase):
    def test_line_types(self):
        self.assertEqual([line_of(x) for x in ("ftth", "adsl", "ADSL2+", "vdsl2", "fttb", "", None)], ["fibre", "dsl", "dsl", "dsl", None, None, None])

    def test_temperature_in_thousandths_or_degrees(self):
        self.assertEqual((celsius(27560), celsius("41"), celsius(None), celsius("abc"), celsius(900000)), (27.56, 41, None, None, None))

    def test_rates_in_kbit(self):
        self.assertEqual((bits("20000"), bits(0), bits(None)), (20_000_000, None, None))


@NEEDS_XML
class Reading(unittest.TestCase):
    def test_fibre_box(self):
        d, ctx = read(FTTH)
        self.assertEqual(d["box"], {"model": "NB8-fibre", "line": "fibre", "connected": True, "down_bps": None, "up_bps": None, "line_down_bps": None, "line_up_bps": None,
                                    "public_ip": PUBLIC_IP, "uptime_s": 7200, "firmware": "NB8-MAIN-R4.0.1", "update_available": None, "latest_firmware": None,
                                    "devices": None, "wifi": None, "temperature": 27.56})
        self.assertNotIn("SECRETSERIAL", str(d))
        self.assertNotIn("00:11:22", str(d))
        self.assertNotIn(PUBLIC_IP, str(d["facts"]))
        self.assertEqual([c[1] for c in ctx.calls], ["system.getInfo", "wan.getInfo"], "no DSL reading on a fibre line")

    def test_dsl_box_and_a_private_address(self):
        d, ctx = read(DSL)
        b = d["box"]
        self.assertEqual((b["line"], b["line_down_bps"], b["line_up_bps"], b["public_ip"], b["temperature"]), ("dsl", 20_000_000, 1_000_000, None, None))
        self.assertTrue(all(c[0] == "GET" and c[1].endswith(".getInfo") and c[2] is None for c in ctx.calls), "read-only, never the Wi-Fi or a login")
        self.assertFalse(any(c[1].startswith(("wlan", "auth")) for c in ctx.calls))

    def test_a_line_that_is_down(self):
        d, _ = read({**FTTH, "wan.getInfo": rsp("wan", status="down")})
        self.assertIs(d["box"]["connected"], False)

    def test_a_box_without_the_wan_reading_still_answers(self):
        d, _ = read({"system.getInfo": FTTH["system.getInfo"]})
        b = d["box"]
        self.assertEqual((b["model"], b["connected"], b["public_ip"], b["uptime_s"]), ("NB8-fibre", None, None, None))

    def test_a_refused_system_reading_is_an_error(self):
        with self.assertRaises(ConnectorError):
            read({"system.getInfo": FAIL})
        with self.assertRaises(ConnectorError):
            read({})

    def test_unreadable_xml_is_an_error_not_a_crash(self):
        with self.assertRaises(ConnectorError):
            read({"system.getInfo": b"<<<"})

    def test_the_test_button_shows_no_address(self):
        r = SFRBox({"type": "sfrbox", "name": "box", "url": BASE}, FakeContext(FTTH)).test()
        self.assertTrue(r.ok)
        self.assertNotIn(PUBLIC_IP, r.message)


class Registration(unittest.TestCase):
    def test_registered_without_any_secret(self):
        self.assertIs(connectors.TYPES["sfrbox"], SFRBox)
        self.assertEqual(category("sfrbox"), "Réseau / DNS")
        self.assertEqual(SFRBox.validate({"url": BASE}), [])
        self.assertFalse(any(f.secret for f in SFRBox.fields))


if __name__ == "__main__":
    unittest.main()
