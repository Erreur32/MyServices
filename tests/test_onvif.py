"""ONVIF connector on a fake camera: its clock dates the account, one camera per video source, addresses kept on the camera's host."""
import base64
import hashlib
import importlib.util
import re
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import onvif  # noqa: E402
from connectors.base import ConnectorError, Context  # noqa: E402

PW = "pw-" + "o" * 10   # built at run time: no secret-looking literal in the repository
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 32
CAM_TIME = "<tt:UTCDateTime><tt:Time><tt:Hour>10</tt:Hour><tt:Minute>0</tt:Minute><tt:Second>0</tt:Second></tt:Time><tt:Date><tt:Year>2020</tt:Year><tt:Month>1</tt:Month><tt:Day>1</tt:Day></tt:Date></tt:UTCDateTime>"


def soap(body: str) -> bytes:
    return (f'<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema" '
            f'xmlns:trt="http://www.onvif.org/ver10/media/wsdl"><s:Body>{body}</s:Body></s:Envelope>').encode()


def profile(token: str, source: str) -> str:
    return f'<trt:Profiles token="{token}"><tt:Name>{token}</tt:Name><tt:VideoSourceConfiguration><tt:SourceToken>{source}</tt:SourceToken></tt:VideoSourceConfiguration></trt:Profiles>'


@unittest.skipUnless(importlib.util.find_spec("defusedxml"), "defusedxml lives in the image")
class Camera(unittest.TestCase):
    def make(self, sources=("v1",), media="http://192.0.2.99:8080/onvif/media", snap="http://192.0.2.99/snap.jpg?p=1", refuse=False):
        c = onvif.Onvif({"name": "o", "url": "http://10.0.0.8", "user": "viewer", "password": PW}, Context(timeout=5))
        self.asked = []
        answers = {
            "GetSystemDateAndTime": soap(f"<GetSystemDateAndTimeResponse><tt:SystemDateAndTime>{CAM_TIME}</tt:SystemDateAndTime></GetSystemDateAndTimeResponse>"),
            "GetDeviceInformation": soap("<GetDeviceInformationResponse><Manufacturer>Hikvision</Manufacturer><Model>DS-2CD2043</Model><FirmwareVersion>V5.7.3</FirmwareVersion></GetDeviceInformationResponse>"),
            "GetCapabilities": soap(f"<GetCapabilitiesResponse><tt:Capabilities><tt:Media><tt:XAddr>{media}</tt:XAddr></tt:Media></tt:Capabilities></GetCapabilitiesResponse>"),
            "GetProfiles": soap("<trt:GetProfilesResponse>" + "".join(profile(f"{s}-{k}", s) for s in sources for k in ("main", "sub")) + "</trt:GetProfilesResponse>"),
            "GetSnapshotUri": soap(f"<trt:GetSnapshotUriResponse><trt:MediaUri><tt:Uri>{snap}</tt:Uri></trt:MediaUri></trt:GetSnapshotUriResponse>"),
        }

        def http(url, payload=None, digest=None, **kw):
            if payload is None:
                self.asked.append(("GET", url, digest))
                return JPEG
            op = re.search(rb"<s:Body><(\w+)", payload).group(1).decode()
            self.asked.append((op, url, payload.decode()))
            if refuse and op != "GetSystemDateAndTime":
                raise ConnectorError("HTTP 400")
            return answers[op]
        c.ctx.http = http
        return c

    def test_a_lone_camera_named_by_its_model_with_its_picture(self):
        c = self.make()
        d = c.collect()
        self.assertEqual((d["version"], d["facts"][0]["value"], d["stream"]["engine"]), ("V5.7.3", "Hikvision DS-2CD2043", "Hikvision"))
        self.assertEqual([(x["name"], x["up"]) for x in d["stream"]["cameras"]], [("Hikvision DS-2CD2043", True)])   # main and sub streams: one camera
        self.assertNotIn(PW, str(d))
        self.assertEqual(c.snapshot("Hikvision DS-2CD2043"), JPEG)
        self.assertEqual(self.asked[-1], ("GET", "http://10.0.0.8/snap.jpg?p=1", ("viewer", PW)))   # another host given: its path, on the camera
        self.assertTrue(all(u.startswith("http://10.0.0.8") for _, u, _ in self.asked))

    def test_the_account_is_dated_at_the_camera_clock(self):
        c = self.make()
        c.collect()
        signed = next(p for op, _, p in self.asked if op == "GetDeviceInformation")
        created = re.search(r"<Created[^>]*>([^<]+)<", signed).group(1)
        self.assertEqual(created[:13], "2020-01-01T10")   # the camera's 2020, not our date
        nonce = base64.b64decode(re.search(r"<Nonce[^>]*>([^<]+)<", signed).group(1))
        digest = base64.b64encode(hashlib.sha1(nonce + created.encode() + PW.encode()).digest()).decode()
        self.assertIn(f">{digest}</Password>", signed)
        self.assertNotIn(PW, signed)
        self.assertNotIn("<Security", self.asked[0][2])   # the clock is asked without the account

    def test_a_recorder_has_one_camera_per_source(self):
        c = self.make(sources=("v1", "v2", "v3"))
        d = c.collect()
        self.assertEqual([x["name"] for x in d["stream"]["cameras"]], ["Caméra 1", "Caméra 2", "Caméra 3"])
        c.snapshot("Caméra 2")
        self.assertIn("<ProfileToken>v2-main</ProfileToken>", next(p for op, _, p in reversed(self.asked) if op == "GetSnapshotUri"))
        with self.assertRaises(ConnectorError):
            c.snapshot("Caméra 9")

    def test_a_refused_account_says_so(self):
        with self.assertRaises(ConnectorError) as e:
            self.make(refuse=True).collect()
        self.assertIn("accès refusé", str(e.exception))

    def test_security_header_is_well_formed(self):
        head = onvif.security("a<b", PW, time.time(), nonce=b"n" * 16)
        self.assertIn("<Username>a&lt;b</Username>", head)


if __name__ == "__main__":
    unittest.main()
