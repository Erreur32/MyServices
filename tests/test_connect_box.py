"""connectors/connect_box.py: the reading of a Compal Connect Box against frozen XML answers, never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import importlib.util
import unittest

from connectors import connect_box
from connectors.base import ConnectorError, Context
from connectors.connect_box import ConnectBox, celsius, flow_rates, link_up
from connectors.upnp_box import parse_xml

PUBLIC_IP = ".".join(("1", "1", "1", "42"))
SECRET = "pw" + "-".join(("a", "b", "c")) + "&x"   # built at run time, never a literal
BASE = "http://192.168.0.1"


NEEDS_XML = unittest.skipIf(importlib.util.find_spec("defusedxml") is None, "defusedxml absent : tests à lancer dans l'image")


def xml(body: str) -> bytes:
    return f'<?xml version="1.0" encoding="utf-8"?><root>{body}</root>'.encode()


SETTINGS = xml("<AccessLevel>1</AccessLevel><OperatorId>VF</OperatorId><AccessDenied>NONE</AccessDenied><SwVersion>CH7465LG-NCIP-6.15.32p3-NOSH</SwVersion>")
CMSTATUS = xml("<provisioning_st>Online</provisioning_st><cm_comment>x</cm_comment><cm_docsis_mode>DOCSIS 3.1</cm_docsis_mode><cm_network_access>Allowed</cm_network_access><FileName>fw.bin</FileName>"
               "<serviceflows><serviceflow><Sfid>1</Sfid><pMaxTrafficRate>400000000</pMaxTrafficRate><direction>1</direction></serviceflow>"
               "<serviceflow><Sfid>2</Sfid><pMaxTrafficRate>50000000</pMaxTrafficRate><direction>2</direction></serviceflow></serviceflows>")
PAGES = {1: SETTINGS, 144: CMSTATUS, 2: xml("<cm_network_access>Allowed</cm_network_access>"), 107: xml(f"<WanMAC>00:11:22:33:44:55</WanMAC><WanIP>{PUBLIC_IP}</WanIP>"),
         123: xml("<Client><MACAddr>aa</MACAddr></Client><Client><MACAddr>bb</MACAddr></Client><Client><MACAddr>cc</MACAddr></Client>"), 136: xml("<TunnerTemperature>110</TunnerTemperature><Temperature>122</Temperature>")}


class FakeBox(ConnectBox):
    """Answers by fun number; a number missing from `pages` is an HTTP 404 (an error code in the dict is raised)."""

    def __init__(self, pages: dict, login: bytes | Exception = b"ok", conf: dict | None = None):
        super().__init__({"type": "connect-box", "name": "box", "url": BASE, "password": SECRET, **(conf or {})}, Context())
        self.pages, self.login_answer, self.sent = pages, login, []

    def fetch(self, path, form=None):
        self.sent.append((path, form))
        self.token = "tok"
        if path == connect_box.LOGIN_PAGE:
            return b"<html/>"
        fun = int(form.split("fun=")[1].split("&")[0])
        if fun == connect_box.FUN_LOGIN:
            if isinstance(self.login_answer, Exception):
                raise self.login_answer
            return self.login_answer
        if fun == connect_box.FUN_LOGOUT:
            return b""
        answer = self.pages.get(fun, ConnectorError("HTTP 404"))
        if isinstance(answer, Exception):
            raise answer
        return answer


@NEEDS_XML
class Helpers(unittest.TestCase):
    def test_temperature_fahrenheit(self):
        self.assertEqual((celsius("122"), celsius(None), celsius("abc"), celsius("-500")), (50.0, None, None, None))

    def test_link_words(self):
        self.assertEqual((link_up("Allowed", None), link_up("Denied", None), link_up(None, "Online"), link_up(None, None)), (True, False, True, None))

    def test_flow_rates_take_the_highest_per_direction(self):
        self.assertEqual(flow_rates(parse_xml(CMSTATUS)), (400_000_000, 50_000_000))


@NEEDS_XML
class Reading(unittest.TestCase):
    def setUp(self):
        connect_box.REFUSED_BY.clear()

    def test_full_reading(self):
        box = FakeBox(PAGES)
        d = box.collect()
        self.assertEqual(d["box"], {"model": "Connect Box (DOCSIS 3.1)", "line": "cable", "connected": True, "down_bps": None, "up_bps": None, "line_down_bps": 400_000_000, "line_up_bps": 50_000_000,
                                    "public_ip": PUBLIC_IP, "uptime_s": None, "firmware": "CH7465LG-NCIP-6.15.32p3-NOSH", "update_available": None, "latest_firmware": None,
                                    "devices": 3, "wifi": None, "temperature": 50.0})
        self.assertNotIn(PUBLIC_IP, str(d["facts"]))
        self.assertNotIn("00:11:22", str(d))
        funs = [f.split("fun=")[1].split("&")[0] for _, f in box.sent if f]
        self.assertEqual(funs[0], "15")
        self.assertEqual(funs[-1], "16", "the session is closed")
        self.assertTrue(all(f.startswith("token=tok&fun=") for _, f in box.sent if f), "token first, fun second")
        self.assertEqual({f for _, f in box.sent if f and "fun=15" in f}, {f"token=tok&fun=15&Username=NULL&Password=" + connect_box.urllib.parse.quote(SECRET, safe="")})

    def test_missing_pages_leave_fields_empty(self):
        d = FakeBox({1: SETTINGS}).collect()
        b = d["box"]
        self.assertEqual((b["connected"], b["public_ip"], b["devices"], b["temperature"], b["line_down_bps"], b["firmware"]), (None, None, None, None, None, "CH7465LG-NCIP-6.15.32p3-NOSH"))

    def test_private_wan_address_is_not_public(self):
        d = FakeBox({**PAGES, 107: xml("<WanIP>10.1.2.3</WanIP>")}).collect()
        self.assertIsNone(d["box"]["public_ip"])

    def test_access_denied_means_line_down(self):
        d = FakeBox({**PAGES, 2: xml("<cm_network_access>Denied</cm_network_access>")}).collect()
        self.assertIs(d["box"]["connected"], False)

    def test_refused_login_stops_at_once_and_is_remembered(self):
        for refused in (ConnectorError("HTTP 403"), b"<root>KDGloginincorrect</root>"):
            connect_box.REFUSED_BY.clear()
            box = FakeBox(PAGES, refused)
            with self.assertRaises(ConnectorError) as cm:
                box.collect()
            self.assertNotIn(SECRET, str(cm.exception))
            self.assertEqual(sum(1 for _, f in box.sent if f and "fun=15" in f), 1)
            self.assertFalse(any("fun=1&" in (f or "") or (f or "").endswith("fun=1") for _, f in box.sent), "no reading after a refusal")
            again = FakeBox(PAGES)
            with self.assertRaises(ConnectorError):
                again.collect()
            self.assertEqual(again.sent, [], "no second attempt with the same password")
            changed = FakeBox(PAGES, conf={"password": SECRET + "2"})
            self.assertTrue(changed.collect()["box"])

    def test_unreadable_xml_is_an_error(self):
        box = FakeBox({1: b"<<<"})
        with self.assertRaises(ConnectorError):
            box.collect()

    def test_not_a_connect_box(self):
        box = FakeBox({1: xml("<foo/>")})
        with self.assertRaises(ConnectorError):
            box.collect()
        box = FakeBox({})
        with self.assertRaises(ConnectorError):
            box.collect()

    def test_lost_session_and_no_password(self):
        box = FakeBox({1: ConnectorError("HTTP 401")})
        with self.assertRaises(ConnectorError) as cm:
            box.collect()
        self.assertEqual(str(cm.exception), connect_box.SESSION_LOST)
        box = FakeBox(PAGES, conf={"password": ""})
        with self.assertRaises(ConnectorError):
            box.collect()

    def test_the_test_button_shows_no_address_or_secret(self):
        r = FakeBox(PAGES).test()
        self.assertTrue(r.ok)
        self.assertNotIn(PUBLIC_IP, r.message)
        self.assertNotIn(SECRET, r.message)

    def test_password_is_a_secret_field(self):
        self.assertTrue(next(f for f in ConnectBox.fields if f.name == "password").secret)
        self.assertEqual(ConnectBox.type, "connect-box")


if __name__ == "__main__":
    unittest.main()
