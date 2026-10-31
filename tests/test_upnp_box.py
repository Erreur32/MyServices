"""connectors/upnp_box.py and box_kit.py: the UPnP IGD reading against frozen SOAP answers, never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import importlib.util
import json
import unittest
from unittest import mock
from xml.sax.saxutils import escape

import connectors
from connectors import upnp_box
from connectors.base import Context, ConnectorError, RateLimited
from connectors.box_kit import Box, box_card, facts_of, public_address
from connectors.settings import category
from connectors.upnp_box import UPnPBox, is_up, location_of, per_second, positive, search

LOCATION = "http://10.0.0.1:49000/igd.xml"
PUBLIC_IP = ".".join(("1", "1", "1", "42"))   # a global address: the documentation ranges are not
SERIAL = "SN-0001"
GATEWAY = upnp_box.SEARCH_TARGETS[0]


def service(kind: str, path: str, urn: str = "urn:schemas-upnp-org") -> str:
    return f"<service><serviceType>{urn}:service:{kind}:1</serviceType><controlURL>{path}</controlURL></service>"


def description(*services: str, extra: str = "") -> bytes:
    return (f'<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0">{extra}<device><manufacturer>Acme</manufacturer><modelName>Box 7</modelName>'
            f'<serialNumber>{SERIAL}</serialNumber><serviceList>{"".join(services)}</serviceList><deviceList><device><modelName>inner</modelName></device></deviceList>'
            '</device></root>').encode()


def answer(action: str, **values) -> bytes:
    body = "".join(f"<{k}>{escape(str(v))}</{k}>" for k, v in values.items())
    return (f'<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:{action}Response xmlns:u="urn:x">{body}'
            f"</u:{action}Response></s:Body></s:Envelope>").encode()


COMMON, IP, PPP = service("WANCommonInterfaceConfig", "/common"), service("WANIPConnection", "/ip"), service("WANPPPConnection", "/ppp")
LINK = answer("GetCommonLinkProperties", NewWANAccessType="DSL", NewLayer1UpstreamMaxBitRate=2000000, NewLayer1DownstreamMaxBitRate=40000000, NewPhysicalLinkStatus="Up")


class FakeContext(Context):
    """Answers by control address and action; an action not listed is what most boxes do: an HTTP 500."""

    def __init__(self, desc: bytes, answers: dict | None = None):
        super().__init__()
        self.desc, self.answers, self.posts = desc, {k: list(v) if isinstance(v, list) else v for k, v in (answers or {}).items()}, []

    def http(self, url, *, method="GET", payload=None, headers=None, binary=False, **kw):
        self.posts.append((method, url, (headers or {}).get("SOAPAction", "")))
        if method == "GET":
            return self.desc
        got = self.answers.get((url.rsplit("/", 1)[-1], headers["SOAPAction"].strip('"').rsplit("#", 1)[-1]))
        if isinstance(got, list):
            return got.pop(0)
        if got is None:
            raise ConnectorError("HTTP 500")
        return got


FULL = {("common", "GetCommonLinkProperties"): LINK,
        ("common", "GetTotalBytesReceived"): [answer("GetTotalBytesReceived", NewTotalBytesReceived=1000000), answer("GetTotalBytesReceived", NewTotalBytesReceived=2000000)],
        ("common", "GetTotalBytesSent"): [answer("GetTotalBytesSent", NewTotalBytesSent=500), answer("GetTotalBytesSent", NewTotalBytesSent=500)],
        ("ip", "GetStatusInfo"): answer("GetStatusInfo", NewConnectionStatus="Connected", NewLastConnectionError="ERROR_NONE", NewUptime=7200),
        ("ip", "GetExternalIPAddress"): answer("GetExternalIPAddress", NewExternalIPAddress=PUBLIC_IP)}


def read(desc: bytes, answers: dict | None = None, url: str = LOCATION) -> tuple[dict, FakeContext]:
    ctx = FakeContext(desc, answers)
    with mock.patch.object(upnp_box.time, "sleep"), mock.patch.object(upnp_box.time, "monotonic", side_effect=iter(range(100))):
        return UPnPBox({"type": "upnp-box", "name": "b", "url": url}, ctx).collect(), ctx


class Model(unittest.TestCase):
    def test_absent_fields_stay_none_and_are_not_shown(self):
        self.assertEqual(facts_of(Box()), [])
        d = box_card(Box())
        self.assertEqual((d["version"], d["facts"], d["problems"]), (None, [], []))
        self.assertTrue(all(v is None for v in d["box"].values()))

    def test_full_box(self):
        d = box_card(Box(line="fibre", connected=True, down_bps=5000000, up_bps=0, line_down_bps=8 * 10**9, uptime_s=90000, firmware="1.2", update_available=True,
                         latest_firmware="1.3", devices=12, wifi=False, temperature=51.4))
        shown = {f["label"]: f["value"] for f in d["facts"]}
        self.assertEqual(shown, {"Ligne": "en ligne (fibre)", "Débit actuel": "5,0 Mb/s / 0,0 Mb/s", "Débit max": "8,0 Gb/s", "Connectée depuis": "1 j 1 h",
                                 "Mise à jour": "→ 1.3", "Appareils": "12", "Wi-Fi": "coupé", "Température": "51 °C"})
        self.assertEqual(d["version"], "1.2")

    def test_line_down_is_a_problem(self):
        d = box_card(Box(connected=False))
        self.assertEqual(d["problems"], ["connexion Internet coupée"])
        self.assertEqual(d["facts"], [{"label": "Ligne", "value": "coupée", "tone": "bad"}])

    def test_line_type_alone(self):
        self.assertEqual(facts_of(Box(line="mobile")), [{"label": "Ligne", "value": "4G/5G"}])

    def test_only_a_public_address_is_kept(self):
        self.assertEqual(public_address(f" {PUBLIC_IP} "), PUBLIC_IP)
        self.assertEqual(public_address("2606:4700:4700::1111"), "2606:4700:4700::1111")
        for bad in ("0.0.0.0", "10.0.0.9", "100.64.0.1", "", None, "n/a"):   # safety:allow
            self.assertIsNone(public_address(bad), bad)


class Discovery(unittest.TestCase):
    def test_location_only_from_the_private_address_that_answered(self):
        ok = f"HTTP/1.1 200 OK\r\nST: {GATEWAY}\r\nLOCATION: {LOCATION}\r\n\r\n".encode()
        self.assertEqual(location_of(ok, "10.0.0.1"), LOCATION)
        self.assertIsNone(location_of(ok, "10.0.0.2"), "another host")
        self.assertIsNone(location_of(ok.replace(b"10.0.0.1", b"1.1.1.1"), "1.1.1.1"), "not on the LAN")
        self.assertIsNone(location_of(b"HTTP/1.1 200 OK\r\n\r\n", "10.0.0.1"))
        self.assertIsNone(location_of(ok.replace(GATEWAY.encode(), b"urn:schemas-upnp-org:device:MediaServer:1"), "10.0.0.1"), "a media server answers any search")
        self.assertIsNone(location_of(ok.replace(LOCATION.encode(), b"file://10.0.0.1/etc/passwd"), "10.0.0.1"))
        self.assertIsNone(location_of(ok.replace(LOCATION.encode(), b"http://[broken"), "10.0.0.1"))

    def _search(self, *answers):
        sock = mock.MagicMock()
        sock.__enter__.return_value = sock
        sock.recvfrom.side_effect = answers
        with mock.patch.object(upnp_box.socket, "socket", return_value=sock):
            return search(), sock

    def test_first_good_answer_wins(self):
        junk = (b"HTTP/1.1 200 OK\r\n\r\n", ("10.0.0.7", 1900))
        good = (f"ST: {GATEWAY}\r\nLOCATION: {LOCATION}\r\n\r\n".encode(), ("10.0.0.1", 1900))
        found, sock = self._search(junk, good)
        self.assertEqual(found, LOCATION)
        self.assertEqual(sock.sendto.call_count, 2)
        self.assertIn(b"ssdp:discover", sock.sendto.call_args[0][0])

    def test_no_box_says_what_to_do(self):
        err = TimeoutError()
        with self.assertRaises(ConnectorError) as e:
            self._search(err)
        self.assertIn("aucune box UPnP", str(e.exception))

    def test_no_multicast_route_is_a_readable_error(self):
        with mock.patch.object(upnp_box.socket, "socket", side_effect=OSError(101, "Network is unreachable")), self.assertRaises(ConnectorError) as e:
            search()
        self.assertIn("Network is unreachable", str(e.exception))

    def test_no_box_through_the_connector(self):
        ctx = FakeContext(b"")
        with mock.patch.object(upnp_box, "search", side_effect=ConnectorError("aucune box UPnP trouvée")):
            r = UPnPBox({"type": "upnp-box", "name": "b"}, ctx).test()
        self.assertFalse(r.ok)
        self.assertEqual(ctx.posts, [])


class Helpers(unittest.TestCase):
    def test_rates(self):
        self.assertEqual(per_second(1000, 2000, 2), 4000)
        self.assertEqual(per_second(1000, 1000, 1), 0)
        self.assertIsNone(per_second(0, 0, 1), "a box that does not count")
        self.assertIsNone(per_second(2000, 10, 1), "the counter wrapped")
        self.assertIsNone(per_second(None, 10, 1))

    def test_positive(self):
        self.assertEqual(positive("7200"), 7200)
        self.assertIsNone(positive("0"))
        self.assertIsNone(positive(None))
        self.assertIsNone(positive("n/a"))

    def test_is_up(self):
        self.assertTrue(is_up("Connected", "Down"))
        self.assertFalse(is_up("Disconnected", "Up"))
        self.assertTrue(is_up(None, "Up"))
        self.assertIsNone(is_up(None, None))


@unittest.skipUnless(importlib.util.find_spec("defusedxml"), "defusedxml lives in the image")
class Reading(unittest.TestCase):
    def test_full_box(self):
        d, ctx = read(description(COMMON, IP), FULL)
        box = d["box"]
        self.assertEqual((box["model"], box["line"], box["connected"], box["uptime_s"]), ("Acme Box 7", "dsl", True, 7200))
        self.assertEqual((box["line_down_bps"], box["line_up_bps"]), (40000000, 2000000))
        self.assertEqual((box["down_bps"], box["up_bps"]), (8000000, 0))
        self.assertEqual(box["public_ip"], PUBLIC_IP)
        self.assertIsNone(box["firmware"])
        self.assertEqual(d["problems"], [])
        self.assertTrue(all(url.startswith("http://10.0.0.1:49000/") for _, url, _ in ctx.posts))

    def test_search_uses_the_cache_key_of_the_instance(self):
        ctx = FakeContext(description(COMMON, IP), FULL)
        ctx.cached = mock.Mock(return_value=LOCATION)
        with mock.patch.object(upnp_box.time, "sleep"):
            UPnPBox({"type": "upnp-box", "name": "b"}, ctx).collect()
        ctx.cached.assert_called_once_with("upnp-box-b", upnp_box.LOCATION_TTL, upnp_box.search)
        self.assertEqual(ctx.posts[0], ("GET", LOCATION, ""))

    def test_address_stays_out_of_the_card_and_the_serial_number_is_not_kept(self):
        d, _ = read(description(COMMON, IP), FULL)
        self.assertNotIn(PUBLIC_IP, json.dumps(d["facts"]))
        self.assertNotIn(SERIAL, json.dumps(d))

    def test_only_the_read_queries_are_posted(self):
        _, ctx = read(description(COMMON, IP), FULL)
        actions = {action.strip('"').rsplit("#", 1)[-1] for method, _, action in ctx.posts if method == "POST"}
        self.assertTrue(actions and all(a.startswith("Get") for a in actions), actions)

    def test_box_without_wan_ip_connection_reads_ppp(self):
        answers = {**FULL, ("ppp", "GetStatusInfo"): FULL["ip", "GetStatusInfo"], ("ppp", "GetExternalIPAddress"): FULL["ip", "GetExternalIPAddress"]}
        box = read(description(COMMON, PPP), answers)[0]["box"]
        self.assertEqual((box["connected"], box["public_ip"]), (True, PUBLIC_IP))

    def test_both_connections_take_the_connected_one(self):
        idle = answer("GetStatusInfo", NewConnectionStatus="Unconfigured", NewUptime=0)
        answers = {("ip", "GetStatusInfo"): idle, ("ppp", "GetStatusInfo"): FULL["ip", "GetStatusInfo"], ("ppp", "GetExternalIPAddress"): FULL["ip", "GetExternalIPAddress"]}
        box = read(description(IP, PPP), answers)[0]["box"]
        self.assertEqual((box["connected"], box["uptime_s"], box["public_ip"]), (True, 7200, PUBLIC_IP))

    def test_only_the_common_service(self):
        box = read(description(COMMON), {("common", "GetCommonLinkProperties"): LINK})[0]["box"]
        self.assertEqual((box["connected"], box["line"], box["public_ip"], box["uptime_s"]), (True, "dsl", None, None))

    def test_only_the_connection_service(self):
        box = read(description(IP), FULL)[0]["box"]
        self.assertEqual((box["connected"], box["line"], box["down_bps"], box["line_down_bps"]), (True, None, None, None))

    def test_missing_values_stay_none(self):
        answers = {("common", "GetCommonLinkProperties"): answer("GetCommonLinkProperties", NewWANAccessType="Ethernet"), ("ip", "GetStatusInfo"): answer("GetStatusInfo", NewConnectionStatus="Connected")}
        d, ctx = read(description(COMMON, IP), answers)
        box = d["box"]
        self.assertIsNone(box["line"], "Ethernet tells nothing of the line behind it")
        self.assertEqual((box["down_bps"], box["line_down_bps"], box["uptime_s"], box["public_ip"]), (None, None, None, None))
        self.assertEqual(d["facts"], [{"label": "Ligne", "value": "en ligne", "tone": "ok"}])
        self.assertEqual(sum("GetTotalBytes" in action for _, _, action in ctx.posts), 2, "no second sample of counters that do not answer")

    def test_disconnected_box(self):
        answers = {**FULL, ("ip", "GetStatusInfo"): answer("GetStatusInfo", NewConnectionStatus="Disconnected"), ("ip", "GetExternalIPAddress"): answer("GetExternalIPAddress", NewExternalIPAddress="0.0.0.0")}   # safety:allow
        d = read(description(COMMON, IP), answers)[0]
        self.assertEqual((d["box"]["connected"], d["box"]["public_ip"], d["problems"]), (False, None, ["connexion Internet coupée"]))

    def test_device_that_is_no_gateway(self):
        desc = description(service("ContentDirectory", "/cd"))
        with self.assertRaises(ConnectorError) as e:
            read(desc)
        self.assertIn("aucune connexion Internet", str(e.exception))

    def test_tr064_services_are_ignored(self):
        desc = description(service("WANIPConnection", "/tr", urn="urn:dslforum-org"))
        with self.assertRaises(ConnectorError):
            read(desc)

    def test_box_that_refuses_every_query(self):
        desc = description(COMMON, IP)
        with self.assertRaises(ConnectorError) as e:
            read(desc)
        self.assertIn("refuse les requêtes", str(e.exception))

    def test_rate_limit_is_not_a_missing_value(self):
        ctx = FakeContext(description(COMMON, IP))
        ctx.http = mock.Mock(side_effect=[description(COMMON, IP), RateLimited("HTTP 429")])
        box = UPnPBox({"type": "upnp-box", "name": "b", "url": LOCATION}, ctx)
        with self.assertRaises(RateLimited):
            box.collect()

    def test_control_address_on_another_host_is_dropped(self):
        evil = service("WANCommonInterfaceConfig", "http://10.0.0.99/steal")
        desc = description(evil)
        with self.assertRaises(ConnectorError):
            read(desc)

    def test_url_base_is_honoured_on_the_same_host(self):
        _, ctx = read(description(COMMON, IP, extra="<URLBase>http://10.0.0.1:5000/</URLBase>"), FULL)
        self.assertTrue(any(url == "http://10.0.0.1:5000/common" for _, url, _ in ctx.posts))

    def test_xml_bomb_refused(self):
        bomb = b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><r>&b;</r>'
        with self.assertRaises(ConnectorError) as e:
            read(bomb)
        self.assertEqual(str(e.exception), "réponse XML illisible")

    def test_broken_xml(self):
        with self.assertRaises(ConnectorError):
            read(b"not xml")

    def test_test_button(self):
        ctx = FakeContext(description(COMMON, IP), FULL)
        with mock.patch.object(upnp_box.time, "sleep"):
            r = UPnPBox({"type": "upnp-box", "name": "b", "url": LOCATION}, ctx).test()
        self.assertTrue(r.ok)
        self.assertNotIn(PUBLIC_IP, r.message)


class Registration(unittest.TestCase):
    def test_registered_in_the_network_family(self):
        self.assertIs(connectors.TYPES["upnp-box"], UPnPBox)
        self.assertEqual(category("upnp-box"), "Réseau / DNS")
        self.assertEqual(UPnPBox.validate({}), [], "the address is optional: the box is searched for")

    def test_bad_address_refused(self):
        box = UPnPBox({"name": "b", "url": "ftp://x"}, FakeContext(b""))
        with self.assertRaises(ConnectorError):
            box.location()
