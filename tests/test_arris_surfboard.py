"""connectors/arris_surfboard.py: the reading of an Arris SURFboard against frozen pages and answers (fetch() replaced), never the network.

  À lancer dans l'image : python3 -m unittest discover -s tests
"""
import base64
import hashlib
import json
import unittest

from connectors import arris_surfboard as arris
from connectors.arris_surfboard import REFUSED_BY, ArrisSurfboard, hnap_auth, hnap_channels, login_keys, parse_page, uptime_s
from connectors.base import ConnectorError, Context

BASE = "https://192.168.100.1"
SECRET = "pw-" + "x".join(("a", "b", "c"))   # built at run time, never a literal credential
PUBLIC_KEY, CHALLENGE, UID = "A1" * 16, "B2" * 16, "uid-" + "7" * 8

# Shape of a real SB8200 capture (the header rows of the channel tables have no opening <tr>, as on the modem).
STATUS_PAGE = b"""<html><body><span id="thisModelNumberIs">SB8200</span>
<table><tr><th colspan="3">Startup Procedure</th></tr>
<tr><td>Procedure</td><td>Status</td><td>Comment</td></tr>
<tr><td>Acquire Downstream Channel</td><td>519000000 Hz</td><td>Locked</td></tr>
<tr><td>Connectivity State</td><td>OK</td><td>Operational</td></tr></table>
<table><tr><th colspan=8><strong>Downstream Bonded Channels</strong></th></tr>
<td><strong>Channel ID</strong></td><td>Lock Status</td><td>Modulation</td><td>Frequency</td><td>Power</td><td>SNR/MER</td><td>Corrected</td><td>Uncorrectables</td></tr>
<tr align='left'><td>17</td><td>Locked</td><td>QAM256</td><td>519000000 Hz</td><td>-2.4 dBmV</td><td>39.9 dB</td><td>32345</td><td>9369</td></tr>
<tr align='left'><td>12</td><td>Locked</td><td>QAM256</td><td>483000000 Hz</td><td>-1.8 dBmV</td><td>40.4 dB</td><td>39620</td><td>8120</td></tr>
<tr align='left'><td>13</td><td>Not Locked</td><td>Unknown</td><td>0 Hz</td><td>0.0 dBmV</td><td>0.0 dB</td><td>0</td><td>0</td></tr></table>
<table><tr><th colspan=7><strong>Upstream Bonded Channels</strong></th></tr>
<td>Channel</td><td>Channel ID</td><td>Lock Status</td><td>US Channel Type</td><td>Frequency</td><td>Width</td><td>Power</td></tr>
<tr align='left'><td>1</td><td>3</td><td>Locked</td><td>SC-QAM Upstream</td><td>32300000 Hz</td><td>6400000 Hz</td><td>51.0 dBmV</td></tr>
<tr align='left'><td>2</td><td>1</td><td>Locked</td><td>SC-QAM Upstream</td><td>19300000 Hz</td><td>6400000 Hz</td><td>50.0 dBmV</td></tr></table></body></html>"""
INFO_PAGE = b"""<table><tr><th colspan="2">Information</th></tr>
<tr><td><strong>Software Version</strong></td><td>SB8200.0200.174F.311915.NSH.RT.NA</td></tr>
<tr><td><strong>Serial Number</strong></td><td>SECRETSERIAL</td></tr></table>
<table><tr><th colspan="2">Status</th></tr><tr><td><strong>Up Time</strong></td><td>1 days 14h:12m:38s.00</td></tr></table>"""
DOWN = "1^Locked^256QAM^^549000000^0.6^39.0^15^7|+|2^Locked^256QAM^^555000000^1.2^38.5^20^1"
UP = "1^Locked^SC-QAM^^^30600000^46.5|+|2^Locked^SC-QAM^^^23700000^45.2"


def hmac_sha256_upper(key: str, msg: str) -> str:
    """An HMAC-SHA256 written out from the definition (RFC 2104), independent of the hmac module the connector uses."""
    k = key.encode()
    k = k.ljust(64, b"\0")
    inner = hashlib.sha256(bytes(b ^ 0x36 for b in k) + msg.encode()).digest()
    return hashlib.sha256(bytes(b ^ 0x5C for b in k) + inner).hexdigest().upper()


class Fake(ArrisSurfboard):
    """Answers by path; a path not listed is a 404. Records the calls."""

    def __init__(self, answers: dict, **conf):
        super().__init__({"type": "arris-surfboard", "name": "modem", "url": BASE, **conf}, Context())
        self.answers, self.calls = answers, []

    def fetch(self, path, body=None, headers=None):
        self.calls.append((path, body, headers or {}))
        if path not in self.answers:
            raise ConnectorError("HTTP 404")
        answer = self.answers[path]
        return answer(body, headers or {}) if callable(answer) else answer


def hnap_server(good: bool = True, stamp_ok: list | None = None):
    """The /HNAP1/ endpoint of a modem: checks every HNAP_AUTH with the independent calculation."""
    private = hmac_sha256_upper(PUBLIC_KEY + SECRET, CHALLENGE)
    proof = hmac_sha256_upper(private, CHALLENGE)

    def check(headers, key, action):
        digest, stamp = headers["HNAP_AUTH"].split(" ")
        ok = digest == hmac_sha256_upper(key, f'{stamp}"http://purenetworks.com/HNAP1/{action}"') and headers["SOAPAction"] == f'"http://purenetworks.com/HNAP1/{action}"'
        (stamp_ok if stamp_ok is not None else []).append(ok)

    def server(body, headers):
        req = json.loads(body)
        if "Login" in req:
            login = req["Login"]
            if login["Action"] == "request":
                check(headers, "withoutloginkey", "Login")
                return json.dumps({"LoginResponse": {"Challenge": CHALLENGE, "PublicKey": PUBLIC_KEY, "Cookie": UID, "LoginResult": "OK"}}).encode()
            check(headers, private, "Login")
            assert headers["Cookie"] == f"uid={UID}; PrivateKey={private}"
            return json.dumps({"LoginResponse": {"LoginResult": "OK" if good and login["LoginPassword"] == proof else "FAILED"}}).encode()
        check(headers, private, "GetMultipleHNAPs")
        names = list(req["GetMultipleHNAPs"])
        data = {
            "GetCustomerStatusSoftware": {"StatusSoftwareModelName": "S34", "StatusSoftwareSfVer": "AT01.01.010.042324_S3.04.735", "CustomerConnSystemUpTime": "7 days 14:23:56"},
            "GetCustomerStatusStartupSequence": {"CustomerConnConnectivityStatus": "OK", "CustomerConnConnectivityComment": "Operational"},
            "GetCustomerStatusConnectionInfo": {"CustomerConnNetworkAccess": "Allowed"},
            "GetCustomerStatusDownstreamChannelInfo": {"CustomerConnDownstreamChannel": DOWN},
            "GetCustomerStatusUpstreamChannelInfo": {"CustomerConnUpstreamChannel": UP}}
        return json.dumps({"GetMultipleHNAPsResponse": {f"{n}Response": data[n] for n in names}}).encode()
    return server


class Helpers(unittest.TestCase):
    def test_hnap_keys_match_independent_calculation(self):
        private, proof = login_keys(PUBLIC_KEY, SECRET, CHALLENGE)
        self.assertEqual(private, hmac_sha256_upper(PUBLIC_KEY + SECRET, CHALLENGE))
        self.assertEqual(proof, hmac_sha256_upper(private, CHALLENGE))

    def test_hnap_auth_header(self):
        digest, stamp = hnap_auth("K" * 8, "GetMultipleHNAPs", 1234567890123).split(" ")
        self.assertEqual(stamp, "1234567890123")
        self.assertEqual(digest, hmac_sha256_upper("K" * 8, '1234567890123"http://purenetworks.com/HNAP1/GetMultipleHNAPs"'))
        self.assertEqual(hnap_auth(None, "Login", 5).split(" ")[0], hmac_sha256_upper("withoutloginkey", '5"http://purenetworks.com/HNAP1/Login"'))

    def test_parse_page(self):
        page = parse_page(STATUS_PAGE)
        self.assertEqual(page["model"], "SB8200")
        self.assertEqual(page["startup"]["Connectivity State"], ["OK", "Operational"])
        self.assertEqual([c["lock"] for c in page["down"]], ["Locked", "Locked", "Not Locked"])
        self.assertEqual((page["down"][0]["power"], page["down"][0]["snr"], page["down"][0]["uncorrected"]), (-2.4, 39.9, 9369))
        self.assertEqual((len(page["up"]), page["up"][0]["power"]), (2, 51.0))
        self.assertEqual(parse_page(INFO_PAGE)["info"], {"software version": "SB8200.0200.174F.311915.NSH.RT.NA", "serial number": "SECRETSERIAL", "up time": "1 days 14h:12m:38s.00"})
        self.assertEqual(parse_page(b"<html>login</html>")["down"], [])

    def test_hnap_channels_and_uptime(self):
        down, up = hnap_channels(DOWN, UP)
        self.assertEqual((len(down), down[1]["snr"], down[0]["uncorrected"], up[1]["power"]), (2, 38.5, 7, 45.2))
        self.assertEqual(hnap_channels("", None), ([], []))
        self.assertEqual(uptime_s("1 days 14h:12m:38s.00"), 86400 + 14 * 3600 + 12 * 60 + 38)
        self.assertEqual(uptime_s("27 day(s) 10h:12m:37s"), 27 * 86400 + 10 * 3600 + 12 * 60 + 37)
        self.assertEqual(uptime_s("7 days 14:23:56"), 7 * 86400 + 14 * 3600 + 23 * 60 + 56)
        self.assertIsNone(uptime_s("Unknown"))


class OpenPage(unittest.TestCase):
    def test_reads_without_account(self):
        modem = Fake({"cmconnectionstatus.html": STATUS_PAGE, "cmswinfo.html": INFO_PAGE})
        card = modem.collect()
        box = card["box"]
        self.assertEqual((box["model"], box["line"], box["connected"], box["firmware"]), ("SB8200", "cable", True, "SB8200.0200.174F.311915.NSH.RT.NA"))
        self.assertEqual(box["uptime_s"], 86400 + 14 * 3600 + 12 * 60 + 38)
        facts = {f["label"]: f for f in card["facts"]}
        self.assertEqual(facts["Canaux descendants"]["value"], "2 verrouillés sur 3")
        self.assertEqual(facts["Canaux descendants"]["tone"], "warn")
        self.assertEqual(facts["Puissance descendante"]["value"], "-2,4 à 0,0 dBmV")
        self.assertEqual(facts["SNR minimal"]["tone"], "bad")   # the unlocked channel reads 0 dB
        self.assertEqual(facts["Erreurs non corrigées"]["value"], "17489")
        self.assertTrue(card["problems"])
        self.assertTrue(all(p[0] == "cmconnectionstatus.html" or p[0] == "cmswinfo.html" for p in modem.calls))
        self.assertNotIn("SECRETSERIAL", json.dumps(card))

    def test_login_page_without_password(self):
        with self.assertRaises(ConnectorError) as e:
            Fake({"cmconnectionstatus.html": b"<html>Login</html>"}).collect()
        self.assertEqual(str(e.exception), arris.NEEDS_LOGIN)

    def test_not_a_modem_and_redirect(self):
        with self.assertRaises(ConnectorError) as e:
            Fake({}).collect()
        self.assertEqual(str(e.exception), arris.NOT_ARRIS)

        def redirect(body, headers):
            raise ConnectorError("HTTP 302")
        with self.assertRaises(ConnectorError) as e:
            Fake({"cmconnectionstatus.html": redirect}).collect()
        self.assertEqual(str(e.exception), arris.REDIRECTED)


class Hnap(unittest.TestCase):
    def setUp(self):
        REFUSED_BY.clear()

    def test_full_reading(self):
        checks: list = []
        modem = Fake({"cmconnectionstatus.html": b"<html>Login</html>", "HNAP1/": hnap_server(True, checks)}, password=SECRET)
        card = modem.collect()
        box = card["box"]
        self.assertEqual((box["model"], box["firmware"], box["connected"], box["uptime_s"]), ("S34", "AT01.01.010.042324_S3.04.735", True, 7 * 86400 + 14 * 3600 + 23 * 60 + 56))
        facts = {f["label"]: f["value"] for f in card["facts"]}
        self.assertEqual((facts["Canaux descendants"], facts["Canaux montants"], facts["SNR minimal"]), ("2 verrouillés sur 2", "2 verrouillés sur 2", "38,5 dB"))
        self.assertTrue(checks and all(checks))   # every call was signed as the independent calculation says
        self.assertEqual(sum(1 for c in modem.calls if c[0] == "HNAP1/" and '"request"' in c[1]), 1)
        self.assertNotIn(SECRET, json.dumps(card))
        self.assertNotIn(SECRET, json.dumps(modem.calls))   # neither the password nor anything sent holds it in clear

    def test_refused_once_and_remembered(self):
        modem = Fake({"cmconnectionstatus.html": b"<html>Login</html>", "HNAP1/": hnap_server(False)}, password=SECRET)
        with self.assertRaises(ConnectorError) as e:
            modem.collect()
        self.assertEqual(str(e.exception), arris.REFUSED)
        self.assertNotIn(SECRET, str(e.exception))
        n = len(modem.calls)
        with self.assertRaises(ConnectorError):
            modem.collect()
        self.assertTrue(all(c[0] != "HNAP1/" for c in modem.calls[n:]))   # only the open pages again, no login
        self.assertEqual(REFUSED_BY[BASE], modem.fingerprint())

    def test_garbled_answer_falls_to_token_path(self):
        modem = Fake({"cmconnectionstatus.html": b"<html>Login</html>", "HNAP1/": b"<html>not json</html>"}, password=SECRET)
        with self.assertRaises(ConnectorError) as e:
            modem.collect()   # HNAP absent: the token path then finds nothing (404 here), which is not a refusal
        self.assertEqual(str(e.exception), "HTTP 404")
        self.assertNotIn(BASE, REFUSED_BY)


class Token(unittest.TestCase):
    def setUp(self):
        REFUSED_BY.clear()

    def test_comcast_token_flow(self):
        account = base64.b64encode(f"admin:{SECRET}".encode()).decode()
        token = "T" * 31

        def status(body, headers):
            return STATUS_PAGE if headers.get("Cookie") == f"credential={token}" else b"<html>Login</html>"

        modem = Fake({"HNAP1/": b"<html>nope</html>"}, password=SECRET)

        def fetch(path, body=None, headers=None):
            modem.calls.append((path, body, headers or {}))
            headers = headers or {}
            if path == "cmconnectionstatus.html":
                return status(body, headers) if "Cookie" in headers else b"<html>Login</html>"
            if path == f"cmconnectionstatus.html?{account}":
                assert headers["Authorization"] == f"Basic {account}"
                return token.encode()
            if path == "cmswinfo.html":
                return INFO_PAGE
            if path == "logout.html":
                return b""
            if path in modem.answers:
                return modem.answers[path]
            raise ConnectorError("HTTP 404")
        modem.fetch = fetch
        card = modem.collect()
        self.assertEqual(card["box"]["model"], "SB8200")
        self.assertEqual(modem.calls[-1][0], "logout.html")
        self.assertNotIn(SECRET, json.dumps(card))

    def test_refused_token(self):
        account = base64.b64encode(f"admin:{SECRET}".encode()).decode()
        modem = Fake({"HNAP1/": b"<html>nope</html>", "cmconnectionstatus.html": b"<html>Login</html>", f"cmconnectionstatus.html?{account}": b"<html>Login</html>"}, password=SECRET)
        with self.assertRaises(ConnectorError) as e:
            modem.collect()
        self.assertEqual(str(e.exception), arris.REFUSED)


if __name__ == "__main__":
    unittest.main()
