"""connectors/fritzbox.py and the Digest answer of Context.http: the TR-064 reading against frozen SOAP answers, never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import io
import importlib.util
import unittest
import urllib.error
from email.message import Message
from unittest import mock
from xml.sax.saxutils import escape

import connectors
from connectors import base
from connectors.base import ConnectorError, Context, digest_header
from connectors.fritzbox import FritzBox, bits, services_of
from connectors.settings import category
from connectors.upnp_box import parse_xml

PUBLIC_IP = ".".join(("1", "1", "1", "42"))   # a global address: the documentation ranges are not
USER, SECRET = "msv-" + "reader", "-".join(("pw", "not", "real"))
BASE = "http://192.168.178.1:49000"
TYPE = "urn:dslforum-org:service:"
CONTROLS = {"DeviceInfo:1": "deviceinfo", "UserInterface:1": "userif", "WANCommonInterfaceConfig:1": "common", "WANIPConnection:1": "ip", "WANPPPConnection:1": "ppp",
            "WLANConfiguration:1": "wlan1", "WLANConfiguration:2": "wlan2", "WLANConfiguration:3": "wlan3"}


NEEDS_XML = unittest.skipIf(importlib.util.find_spec("defusedxml") is None, "defusedxml absent : tests à lancer dans l'image")


def description(*skip: str, other_host: str = "") -> bytes:
    services = "".join(f"<service><serviceType>{TYPE}{k}</serviceType><controlURL>/upnp/control/{v}</controlURL></service>" for k, v in CONTROLS.items() if v not in skip)
    if other_host:
        services += f"<service><serviceType>{TYPE}Hosts:1</serviceType><controlURL>{other_host}/hosts</controlURL></service>"
    return f'<?xml version="1.0"?><root xmlns="urn:dslforum-org:device-1-0"><device><serviceList>{services}</serviceList></device></root>'.encode()


def answer(action: str, **values) -> bytes:
    body = "".join(f"<{k}>{escape(str(v))}</{k}>" for k, v in values.items())
    return (f'<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:{action}Response xmlns:u="urn:x">{body}</u:{action}Response>'
            "</s:Body></s:Envelope>").encode()


FULL = {("deviceinfo", "GetInfo"): answer("GetInfo", NewModelName="FRITZ!Box 7590", NewSoftwareVersion="154.07.59", NewUpTime=999999),
        ("common", "GetCommonLinkProperties"): answer("GetCommonLinkProperties", NewWANAccessType="DSL", NewLayer1UpstreamMaxBitRate=1000000, NewLayer1DownstreamMaxBitRate=50000000,
                                                       NewPhysicalLinkStatus="Up"),
        ("common", "GetAddonInfos"): answer("GetAddonInfos", NewByteSendRate=1000, NewByteReceiveRate=250000),
        ("ip", "GetStatusInfo"): answer("GetStatusInfo", NewConnectionStatus="Connected", NewUptime=7200),
        ("ip", "GetExternalIPAddress"): answer("GetExternalIPAddress", NewExternalIPAddress=PUBLIC_IP),
        ("userif", "GetInfo"): answer("GetInfo", NewUpgradeAvailable=1, **{"NewX_AVM-DE_Version": "165.07.61"}),
        ("wlan1", "GetInfo"): answer("GetInfo", NewEnable=0), ("wlan2", "GetInfo"): answer("GetInfo", NewEnable=1)}


class FakeContext(Context):
    """Answers by control address and action; an action not listed is an HTTP 500, what the box says for an action it lacks or refuses to this account."""

    def __init__(self, answers: dict, desc: bytes | None = None, refused: bool = False, no_tr064: bool = False):
        super().__init__()
        self.answers, self.desc, self.refused, self.no_tr064, self.calls = answers, desc or description(), refused, no_tr064, []

    def http(self, url, *, method="GET", payload=None, headers=None, binary=False, digest=None, **kw):
        self.calls.append((method, url, (headers or {}).get("SOAPAction", ""), digest))
        if method == "GET":
            if self.no_tr064:
                raise ConnectorError("HTTP 404")
            return self.desc
        if self.refused:
            raise ConnectorError("HTTP 401")
        got = self.answers.get((url.rsplit("/", 1)[-1], headers["SOAPAction"].strip('"').rsplit("#", 1)[-1]))
        if got is None:
            raise ConnectorError("HTTP 500")
        return got


def conf(**over) -> dict:
    return {"type": "fritzbox", "name": "box", "url": BASE, "username": USER, "password": SECRET, **over}


def read(answers: dict, **kw) -> tuple[dict, FakeContext]:
    ctx = FakeContext(answers, **kw)
    return FritzBox(conf(), ctx).collect(), ctx


class Digest(unittest.TestCase):
    CHALLENGE = ('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"')

    def test_the_example_of_rfc_2617(self):
        h = digest_header(self.CHALLENGE, "Mufasa", "Circle Of Life", "GET", "/dir/index.html", cnonce="0a4f113b")
        self.assertIn('response="6629fae49393a05397450978507c4ef1"', h)
        self.assertIn('opaque="5ccc069c403ebaf9f0171e9517f40e41"', h)

    def test_what_is_not_handled_is_none(self):
        for bad in ("Basic realm=x", "", 'Digest realm="x", nonce="n"', 'Digest realm="x", nonce="n", qop="auth", algorithm=SHA-512-256',
                    'Digest realm="x", qop="auth"'):
            self.assertIsNone(digest_header(bad, "u", "p", "POST", "/x"), bad)

    def test_sha256_and_a_quote_in_the_user(self):
        h = digest_header('Digest realm="r", nonce="n", qop="auth", algorithm=SHA-256', 'a"b', "p", "POST", "/x")
        self.assertIn('username="a\\"b"', h)
        self.assertIn("algorithm=SHA-256", h)
        self.assertEqual(len(h.split('response="')[1].split('"')[0]), 64)


class HttpDigest(unittest.TestCase):
    """Context.http answers the challenge once; the second refusal is the service's word."""

    def _error(self, code: int, challenge: str | None = None):
        headers = Message()
        if challenge:
            headers["WWW-Authenticate"] = challenge
        error = urllib.error.HTTPError("http://box/x", code, "no", headers, io.BytesIO(b""))
        self.addCleanup(error.close)
        return error

    def _response(self, body: bytes = b"<ok/>"):
        r = mock.MagicMock()
        r.__enter__.return_value = r
        r.read.return_value = body
        return r

    def _post(self, outcomes):
        with mock.patch.object(base.urllib.request, "urlopen", side_effect=outcomes) as op:
            try:
                got = Context().http("http://box:49000/upnp/control/x?a=1", method="POST", binary=True, payload=b"<x/>", digest=(USER, SECRET))
            except ConnectorError as e:
                got = e
        return got, op

    def test_the_challenge_is_answered_once(self):
        got, op = self._post([self._error(401, Digest.CHALLENGE), self._response()])
        self.assertEqual(got, b"<ok/>")
        self.assertEqual(op.call_count, 2)
        sent = op.call_args[0][0]
        self.assertTrue(sent.get_header("Authorization").startswith("Digest "))
        self.assertIn('uri="/upnp/control/x?a=1"', sent.get_header("Authorization"))
        self.assertNotIn(SECRET, sent.get_header("Authorization"))
        self.assertEqual(sent.data, b"<x/>")

    def test_a_second_refusal_stops(self):
        got, op = self._post([self._error(401, Digest.CHALLENGE), self._error(401, Digest.CHALLENGE), self._response()])
        self.assertIsInstance(got, ConnectorError)
        self.assertEqual(str(got), "HTTP 401")
        self.assertEqual(op.call_count, 2)

    def test_no_digest_challenge_is_a_plain_refusal(self):
        got, op = self._post([self._error(401, "Basic realm=x")])
        self.assertEqual((str(got), op.call_count), ("HTTP 401", 1))

    def test_without_digest_nothing_is_retried(self):
        with mock.patch.object(base.urllib.request, "urlopen", side_effect=[self._error(401, Digest.CHALLENGE)]) as op, self.assertRaises(ConnectorError):
            Context().http("http://box/x")
        self.assertEqual(op.call_count, 1)


class Address(unittest.TestCase):
    def addr(self, url) -> str:
        return FritzBox(conf(url=url), FakeContext({})).address()

    def test_default_ports_by_scheme(self):
        self.assertEqual(self.addr("http://fritz.box"), "http://fritz.box:49000")
        self.assertEqual(self.addr("https://fritz.box/"), "https://fritz.box:49443")
        self.assertEqual(self.addr("192.168.178.1"), "http://192.168.178.1:49000")
        self.assertEqual(self.addr("http://192.168.178.1:8080"), "http://192.168.178.1:8080")
        self.assertEqual(self.addr("http://[fd00::1]"), "http://[fd00::1]:49000")

    def test_empty_means_fritz_box(self):
        self.assertEqual(self.addr(""), "http://fritz.box:49000")

    def test_a_bad_address_is_readable(self):
        for bad in ("ftp://x", "http://[broken", "http://x:99999"):
            with self.assertRaises(ConnectorError, msg=bad) as e:
                self.addr(bad)
            self.assertIn("attendu", str(e.exception))


@NEEDS_XML
class Description(unittest.TestCase):
    def test_services_by_name_and_instance(self):
        s = services_of(parse_xml(description()), BASE)
        self.assertEqual(s[("WLANConfiguration", 2)].url, f"{BASE}/upnp/control/wlan2")
        self.assertEqual(s[("DeviceInfo", 1)].type, f"{TYPE}DeviceInfo:1")

    def test_a_control_address_on_another_host_is_dropped(self):
        s = services_of(parse_xml(description(other_host="http://6.6.6.6")), BASE)
        self.assertNotIn(("Hosts", 1), s)
        self.assertIn(("DeviceInfo", 1), s)


@NEEDS_XML
class Reading(unittest.TestCase):
    def test_full_box(self):
        d, ctx = read(FULL)
        self.assertEqual(d["box"], {"model": "FRITZ!Box 7590", "line": "dsl", "connected": True, "down_bps": 2000000, "up_bps": 8000, "line_down_bps": 50000000,
                                    "line_up_bps": 1000000, "public_ip": PUBLIC_IP, "uptime_s": 7200, "firmware": "154.07.59", "update_available": True,
                                    "latest_firmware": "165.07.61", "devices": None, "wifi": True, "temperature": None})
        self.assertEqual(d["version"], "154.07.59")
        shown = {f["label"]: f["value"] for f in d["facts"]}
        self.assertEqual(shown["Mise à jour"], "→ 165.07.61")
        self.assertNotIn(PUBLIC_IP, str(d["facts"]))
        self.assertTrue(all(c[0] == "GET" or c[2].split("#")[1].strip('"').startswith("Get") for c in ctx.calls), "read-only")
        self.assertTrue(all(c[3] == (USER, SECRET) for c in ctx.calls if c[0] == "POST"))

    def test_a_box_that_answers_little_leaves_the_rest_empty(self):
        d, _ = read({("deviceinfo", "GetInfo"): answer("GetInfo", NewModelName="FRITZ!Box 4040", NewSoftwareVersion="7.29")}, desc=description("userif", "wlan1", "wlan2", "ip", "ppp"))
        b = d["box"]
        self.assertEqual((b["model"], b["firmware"]), ("FRITZ!Box 4040", "7.29"))
        for k in ("line", "connected", "down_bps", "public_ip", "uptime_s", "update_available", "latest_firmware", "wifi"):
            self.assertIsNone(b[k], k)

    def test_line_types_and_ethernet_is_never_guessed(self):
        for access, line in (("X_AVM-DE_Fiber", "fibre"), ("X_AVM-DE_Cable", "cable"), ("X_AVM-DE_LTE", "mobile"), ("X_AVM-DE_Mobile", "mobile"), ("Ethernet", None), ("new", None)):
            d, _ = read({**FULL, ("common", "GetCommonLinkProperties"): answer("GetCommonLinkProperties", NewWANAccessType=access, NewPhysicalLinkStatus="Up")})
            self.assertEqual(d["box"]["line"], line, access)
        self.assertIsNone(d["box"]["line_down_bps"], "a fibre box says 0 for what it does not measure")

    def test_the_connected_wan_connection_is_the_one_read(self):
        d, ctx = read({**FULL, ("ip", "GetStatusInfo"): answer("GetStatusInfo", NewConnectionStatus="Disconnected", NewUptime=0),
                       ("ppp", "GetStatusInfo"): answer("GetStatusInfo", NewConnectionStatus="Connected", NewUptime=50),
                       ("ppp", "GetExternalIPAddress"): answer("GetExternalIPAddress", NewExternalIPAddress=PUBLIC_IP)})
        self.assertEqual((d["box"]["connected"], d["box"]["uptime_s"], d["box"]["public_ip"]), (True, 50, PUBLIC_IP))
        self.assertTrue(any(c[1].endswith("/ppp") and "GetExternalIPAddress" in c[2] for c in ctx.calls))

    def test_line_down_and_a_private_address(self):
        d, _ = read({**FULL, ("ip", "GetStatusInfo"): answer("GetStatusInfo", NewConnectionStatus="Disconnected", NewUptime=0),
                     ("ip", "GetExternalIPAddress"): answer("GetExternalIPAddress", NewExternalIPAddress="10.0.0.9")})
        self.assertIs(d["box"]["connected"], False)
        self.assertIsNone(d["box"]["public_ip"])
        self.assertEqual(d["problems"], ["connexion Internet coupée"])

    def test_wifi_off_and_update_not_available(self):
        d, _ = read({**FULL, ("wlan2", "GetInfo"): answer("GetInfo", NewEnable=0), ("userif", "GetInfo"): answer("GetInfo", NewUpgradeAvailable=0, **{"NewX_AVM-DE_Version": "165.07.61"})})
        self.assertIs(d["box"]["wifi"], False)
        self.assertIs(d["box"]["update_available"], False)
        self.assertIsNone(d["box"]["latest_firmware"], "an old « version » field is not an update")

    def test_a_rate_of_zero_is_a_rate(self):
        self.assertEqual((bits("0"), bits(None), bits("125")), (0, None, 1000))
        d, _ = read({**FULL, ("common", "GetAddonInfos"): answer("GetAddonInfos", NewByteSendRate=0, NewByteReceiveRate=0)})
        self.assertEqual((d["box"]["down_bps"], d["box"]["up_bps"]), (0, 0))


@NEEDS_XML
class Failures(unittest.TestCase):
    def test_a_refused_login_stops_at_the_first_call(self):
        ctx = FakeContext(FULL, refused=True)
        with self.assertRaises(ConnectorError) as e:
            FritzBox(conf(), ctx).collect()
        self.assertIn("utilisateur ou mot de passe refusé", str(e.exception))
        self.assertEqual(len([c for c in ctx.calls if c[0] == "POST"]), 1, "the box locks an address that keeps trying")
        self.assertNotIn(SECRET, str(e.exception))

    def test_tr064_off(self):
        with self.assertRaises(ConnectorError) as e:
            FritzBox(conf(), FakeContext({}, no_tr064=True)).collect()
        self.assertIn("TR-064 est coupé", str(e.exception))

    def test_a_device_without_services(self):
        with self.assertRaises(ConnectorError) as e:
            FritzBox(conf(), FakeContext({}, desc=b'<root xmlns="urn:dslforum-org:device-1-0"><device/></root>')).collect()
        self.assertIn("aucun service TR-064", str(e.exception))

    def test_an_account_without_the_right_gets_only_500(self):
        with self.assertRaises(ConnectorError) as e:
            FritzBox(conf(), FakeContext({})).collect()
        self.assertIn("refuse la lecture", str(e.exception))

    def test_unreadable_xml_is_an_error_not_a_crash(self):
        with self.assertRaises(ConnectorError):
            FritzBox(conf(), FakeContext({}, desc=b"<<<")).collect()

    def test_the_test_button_shows_no_secret_and_no_address(self):
        r = FritzBox(conf(), FakeContext(FULL)).test()
        self.assertTrue(r.ok)
        for secret in (SECRET, USER, PUBLIC_IP):
            self.assertNotIn(secret, r.message)


class Registration(unittest.TestCase):
    def test_registered_with_its_secret_hidden(self):
        self.assertIs(connectors.TYPES["fritzbox"], FritzBox)
        self.assertEqual(category("fritzbox"), "Réseau / DNS")
        self.assertEqual(FritzBox.validate({"url": BASE}), ["« username » requis", "« password » requis"])
        shown = FritzBox.public(conf())
        self.assertEqual(shown["password"], "configuré")
        self.assertNotIn(SECRET, str(shown))


if __name__ == "__main__":
    unittest.main()
