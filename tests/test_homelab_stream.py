"""Video and cameras connectors (Shinobi, go2rtc, MediaMTX, Owncast) and Frigate's « stream » block, on a fake server."""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import reqstats  # noqa: E402
from connectors.base import ConnectorError, Context  # noqa: E402
from connectors.homelab_media import Frigate  # noqa: E402
from connectors.homelab_stream import Go2rtc, MediaMTX, Owncast, Shinobi, codec_of  # noqa: E402

try:
    import tempfile
    from unittest import mock

    from fastapi.testclient import TestClient

    from msv.api import api
    from msv.api import common
    from msv.core import auth
    from msv.api import server
except ImportError:
    api = None
    common = None

BASE = "/myservices/api/v1"

KEY = "k" * 12 + "0123456789"   # built at run time: no secret-looking literal in the repository
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 32
PW = "pw-" + "f" * 10   # built at run time, like KEY


class Fake(BaseHTTPRequestHandler):
    routes: dict = {}
    token: str | None = None   # set: GET needs « Bearer <token> », and POST /api/login with PW gives it
    logins = 0

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        Fake.logins += 1
        ok = self.path == "/api/login" and body.get("password") == PW
        self.send_response(200 if ok else 401)
        if ok:
            self.send_header("Set-Cookie", f"frigate_token={self.token}; Path=/; HttpOnly")
        self.end_headers()
        self.wfile.write(b"{}")

    def do_GET(self):
        code, obj = self.routes.get(self.path, (404, {"error": "not found"}))
        if self.token and self.headers.get("Authorization") != f"Bearer {self.token}":
            code, obj = 401, {"message": "unauthorized"}
        body = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "image/jpeg" if isinstance(obj, bytes) else "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class Stream(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.srv.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def make(self, cls, **conf):
        return cls({"name": "x", "url": self.url, **conf}, Context(timeout=5))

    def test_shinobi(self):
        details = json.dumps({"detector": "1"})
        Fake.routes = {f"/{KEY}/monitor/grp": (200, [
            {"mid": "a1", "name": "Entrée", "mode": "record", "status": "Recording", "details": details, "host": "10.0.0.5", "path": "/secret"},
            {"mid": "b2", "name": "Garage", "mode": "start", "status": "Died", "details": "{}"},
            {"mid": "c3", "name": "Cave", "mode": "stop", "status": "Stopped"}]),
            f"/{KEY}/jpeg/grp/a1/s.jpg": (200, JPEG)}
        c = self.make(Shinobi, api_key=KEY, group_key="grp")
        d = c.collect()
        cams = d["stream"]["cameras"]
        self.assertEqual([(x["name"], x["up"], x["detect"], x["record"]) for x in cams],
                         [("Entrée", True, True, True), ("Garage", False, False, False), ("Cave", None, None, False)])
        self.assertEqual(d["problems"], ["caméra « Garage » sans image"])
        self.assertNotIn("10.0.0.5", json.dumps(d))   # the camera's address is never kept
        self.assertEqual(c.snapshot("Entrée"), JPEG)
        with self.assertRaises(ConnectorError):
            c.snapshot("Inconnue")
        self.assertFalse(any(KEY in route for _, route in reqstats._rows), "the key never reaches the request counters")
        Fake.routes = {f"/{KEY}/monitor/grp": (200, {"ok": False, "msg": "Not Authorized"})}
        with self.assertRaises(ConnectorError) as e:
            c.collect()
        self.assertIn("accès refusé", str(e.exception))

    def test_go2rtc(self):
        Fake.routes = {"/api": (200, {"version": "1.9.9"}),
                       "/api/streams": (200, {"entree": {"producers": [{"url": "rtsp://admin:pw@10.0.0.5/s", "medias": ["video, recvonly, H264"]}],
                                                         "consumers": [{"type": "WebRTC/UDP"}, {"type": "RTSP"}]},
                                              "jardin": {"producers": [{"url": "rtsp://10.0.0.6/s"}], "consumers": []}}),
                       "/api/frame.jpeg?src=entree": (200, JPEG)}
        c = self.make(Go2rtc)
        d = c.collect()
        self.assertEqual(d["version"], "1.9.9")
        s = d["stream"]["streams"]
        self.assertEqual((s[0]["name"], s[0]["ready"], s[0]["codec"], s[0]["readers"], s[0]["kinds"]), ("entree", True, "H.264", 2, ["RTSP", "WebRTC/UDP"]))
        self.assertEqual((s[1]["ready"], s[1]["readers"]), (False, 0))
        self.assertNotIn("rtsp://", json.dumps(d))
        self.assertEqual(c.snapshot("entree"), JPEG)

    def test_mediamtx_and_owncast(self):
        Fake.routes = {"/v3/info": (200, {"version": "v1.12.0"}),
                       "/v3/paths/list?itemsPerPage=200": (200, {"items": [
                           {"name": "cam1", "ready": True, "tracks": ["H265", "Opus"], "source": {"type": "rtspSource"}, "readers": [{"type": "webRTCSession"}]},
                           {"name": "cam2", "ready": False, "tracks": [], "readers": []}]}),
                       "/api/status": (200, {"online": True, "viewerCount": 6, "versionNumber": "0.2.3", "lastConnectTime": "2026-10-24T10:00:00Z"})}
        d = self.make(MediaMTX).collect()
        self.assertEqual(d["facts"][0]["value"], "1/2")
        self.assertEqual(d["stream"]["streams"][0]["codec"], "H.265")
        o = self.make(Owncast).collect()
        self.assertEqual((o["stream"]["live"]["online"], o["stream"]["live"]["viewers"], o["version"]), (True, 6, "0.2.3"))

    def test_frigate_block(self):
        Fake.routes = {"/api/stats": (200, {"service": {"version": "0.16.2", "uptime": 60,
                                                        "storage": {"/media/frigate/recordings": {"total": 1000.0, "used": 840.0, "free": 160.0}}},
                                            "cameras": {"entree": {"camera_fps": 5.0}, "jardin": {"camera_fps": 0.0}},
                                            "detectors": {"coral": {"inference_speed": 9.2, "pid": 11}},
                                            "cpu_usages": {"11": {"cpu": "3.5", "mem": "1.2"}}, "gpu_usages": {"intel-vaapi": {"gpu": "12 %", "mem": "5 %"}}}),
                       "/api/config": (200, {"cameras": {"entree": {"detect": {"enabled": True}, "record": {"enabled": True}}, "jardin": {"detect": {"enabled": False}}}})}
        events = [{"camera": "entree", "label": "person", "start_time": 100.0}, {"camera": "entree", "label": "car", "start_time": 200.0}]
        c = self.make(Frigate)
        orig = c.get

        def get(path, headers=None, **kw):
            return events if path.startswith("/api/events") else orig(path, headers, **kw)
        c.get = get
        got = c.collect()
        b, sysb = got["stream"], got["frigate"]
        self.assertEqual((sysb["detectors"][0]["name"], sysb["detectors"][0]["ms"], sysb["detectors"][0]["cpu"], sysb["uptime"]), ("coral", 9.2, 3.5, 60.0))
        self.assertEqual([x["name"] for x in sysb["cameras"]], ["entree", "jardin"])
        self.assertEqual(sysb["storage"][0]["free"], 160.0)
        self.assertEqual((sysb["gpus"][0]["name"], sysb["gpus"][0]["gpu"], sysb["gpus"][0]["mem"]), ("intel-vaapi", 12.0, 5.0))
        self.assertEqual([(x["name"], x["up"], x["detect"], x["record"], x["events"], x["last"]) for x in b["cameras"]],
                         [("entree", True, True, True, 2, 200.0), ("jardin", False, False, None, 0, None)])
        self.assertEqual((b["events"], b["labels"], b["detector_ms"], b["storage"]["total"]), (2, {"person": 1, "car": 1}, 9.2, 1000.0 * 1048576))

    def test_frigate_overview_figures(self):
        """Events per hour (oldest first), the objects of each camera and the five latest events, for the overview page."""
        import time as _t
        Fake.routes = {"/api/stats": (200, {"service": {}, "cameras": {"entree": {"camera_fps": 5.0}, "jardin": {"camera_fps": 5.0}}}),
                       "/api/config": (200, {"cameras": {}})}
        now = _t.time()
        events = [{"camera": "entree", "label": "person", "start_time": now - 120}, {"camera": "entree", "label": "person", "start_time": now - 300},
                  {"camera": "jardin", "label": "cat", "start_time": now - 7300}, {"camera": "jardin", "label": "car", "start_time": now - 90000}]
        c = self.make(Frigate)
        orig = c.get
        c.get = lambda path, headers=None, **kw: events if path.startswith("/api/events") else orig(path, headers, **kw)
        b = c.collect()["stream"]
        self.assertEqual((b["hourly"][23], b["hourly"][21], sum(b["hourly"])), (2, 1, 3))   # the day-old car is outside the 24 h
        self.assertEqual({x["name"]: x["labels"] for x in b["cameras"]}, {"entree": {"person": 2}, "jardin": {"cat": 1, "car": 1}})
        self.assertEqual([(r["camera"], r["label"]) for r in b["recent"]][:2], [("entree", "person"), ("entree", "person")])
        self.assertEqual(len(b["recent"]), 4)

    def test_frigate_account(self):
        stats = {"service": {"version": "0.16.2"}, "cameras": {"entree": {"camera_fps": 5.0}}}
        Fake.routes = {"/api/stats": (200, stats)}
        Fake.token, Fake.logins = None, 0
        self.assertEqual(self.make(Frigate).collect()["version"], "0.16.2")
        self.assertEqual(Fake.logins, 0, "no account, no sign-in (port 5000)")
        Fake.token = "jwt-" + "a" * 12
        try:
            anonymous = self.make(Frigate)
            with self.assertRaises(ConnectorError) as e:
                anonymous.collect()
            self.assertIn("accès refusé", str(e.exception))
            c = self.make(Frigate, user="viewer", password=PW)
            d = c.collect()
            self.assertEqual((d["version"], Fake.logins), ("0.16.2", 1))
            c.collect()
            self.assertEqual(Fake.logins, 1, "the token is kept between calls")
            Fake.token = "jwt-" + "b" * 12   # expired: one new sign-in
            c.collect()
            self.assertEqual(Fake.logins, 2)
            wrong = self.make(Frigate, user="viewer", password="wrong")
            with self.assertRaises(ConnectorError) as e:
                wrong.collect()
            self.assertIn("compte refusé", str(e.exception))
            self.assertNotIn(PW, json.dumps(d))
            self.assertFalse(any(PW in route for _, route in reqstats._rows))
        finally:
            Fake.token = None

    def test_codec_and_route(self):
        self.assertEqual([codec_of("video, recvonly, HEVC"), codec_of("MJPEG"), codec_of("audio, Opus")], ["H.265", "MJPEG", None])
        self.assertEqual(reqstats.route_of(f"http://h/{KEY}/monitor/grp"), "/*/monitor/grp")
        self.assertEqual(reqstats.route_of("http://h/api/v1/processes"), "/api/v1/processes")


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class Snapshot(unittest.TestCase):
    """GET stream/snapshot and stream/live: a signed-in user sees a camera seen at the last collection, the picture is never kept."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = Path(tmp.name)
        block = {"role": "nvr", "cameras": [{"name": "entree"}], "snapshot": True}
        (d / "data.json").write_text(json.dumps({"services_status": [{"connector": "frigate", "name": "tower", "stream": block}]}))
        server.STATIC = server.WEB = d
        common.AUTH = True
        common.STORE = auth.Store(d / "myservices.db")
        pw = "long-" + "p" * 12   # built at run time: the commit guard refuses any literal secret
        common.STORE.create_user("admin", pw, "admin")
        self.c = TestClient(api.app, client=("192.168.1.50", 50000))
        self.c.post(BASE + "/login", json={"username": "admin", "password": pw})
        self.cam = mock.Mock(type="frigate")
        self.cam.name = "tower"
        p = mock.patch("connectors.instances", return_value=[self.cam])
        p.start()
        self.addCleanup(p.stop)

    def get(self, camera):
        return self.c.get(BASE + "/stream/snapshot", params={"connector": "frigate", "name": "tower", "camera": camera})

    def test_curves_of_a_known_device_only(self):
        (server.WEB / "data.json").write_text(json.dumps({"services_status": [{"connector": "home-assistant", "instance": "ha", "netatmo": {"modules": [{"id": "m"}]}}]}))
        self.cam.type, self.cam.name = "home-assistant", "ha"
        self.cam.curves.return_value = {"temperature": [[1, 20]]}
        ask = lambda module: self.c.get(BASE + "/domotique/curves", params={"connector": "home-assistant", "name": "ha", "module": module})   # noqa: E731
        self.assertEqual(ask("m").json(), {"series": {"temperature": [[1, 20]]}})
        self.assertEqual(ask("ailleurs").status_code, 404)

    def test_known_camera_only_and_never_kept(self):
        self.cam.snapshot.return_value = JPEG
        r = self.get("entree")
        self.assertEqual((r.status_code, r.headers["content-type"], r.headers["cache-control"]), (200, "image/jpeg", "no-store"))
        self.assertEqual(r.content, JPEG)
        self.assertEqual(self.get("../../etc").status_code, 404)   # a camera not seen at the last collection
        self.cam.snapshot.return_value = b"<html>"
        self.assertEqual(self.get("entree").status_code, 502)

    def test_live_feed_relayed_audited_and_limited(self):
        import io
        body = io.BytesIO(b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + JPEG + b"\r\n")
        body.headers = {"Content-Type": "multipart/x-mixed-replace; boundary=frame"}
        self.cam.mjpeg.return_value = body
        r = self.c.get(BASE + "/stream/live", params={"connector": "frigate", "name": "tower", "camera": "entree"})
        self.assertEqual((r.status_code, r.headers["cache-control"]), (200, "no-store"))
        self.assertTrue(r.headers["content-type"].startswith("multipart/x-mixed-replace"))
        self.assertIn(JPEG, r.content)
        self.assertTrue(body.closed)                                      # the source is always closed
        actions = [a["action"] for a in common.STORE.audit_log(10)]
        self.assertIn("flux de caméra ouvert", actions)
        self.assertIn("flux de caméra arrêté", actions)
        self.assertEqual(self.c.get(BASE + "/stream/live", params={"connector": "frigate", "name": "tower", "camera": "../x"}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
