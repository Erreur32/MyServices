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

    import api
    import auth
    import server
except ImportError:
    api = None

BASE = "/myservices/api/v1"

KEY = "k" * 12 + "0123456789"   # built at run time: no secret-looking literal in the repository
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 32


class Fake(BaseHTTPRequestHandler):
    routes: dict = {}

    def do_GET(self):
        code, obj = self.routes.get(self.path, (404, {"error": "not found"}))
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
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
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
                                            "detectors": {"coral": {"inference_speed": 9.2}}}),
                       "/api/config": (200, {"cameras": {"entree": {"detect": {"enabled": True}, "record": {"enabled": True}}, "jardin": {"detect": {"enabled": False}}}})}
        events = [{"camera": "entree", "label": "person", "start_time": 100.0}, {"camera": "entree", "label": "car", "start_time": 200.0}]
        c = self.make(Frigate)
        orig = c.get

        def get(path, headers=None, **kw):
            return events if path.startswith("/api/events") else orig(path, headers, **kw)
        c.get = get
        b = c.collect()["stream"]
        self.assertEqual([(x["name"], x["up"], x["detect"], x["record"], x["events"], x["last"]) for x in b["cameras"]],
                         [("entree", True, True, True, 2, 200.0), ("jardin", False, False, None, 0, None)])
        self.assertEqual((b["events"], b["labels"], b["detector_ms"], b["storage"]["total"]), (2, {"person": 1, "car": 1}, 9.2, 1000.0 * 1048576))

    def test_codec_and_route(self):
        self.assertEqual([codec_of("video, recvonly, HEVC"), codec_of("MJPEG"), codec_of("audio, Opus")], ["H.265", "MJPEG", None])
        self.assertEqual(reqstats.route_of(f"http://h/{KEY}/monitor/grp"), "/*/monitor/grp")
        self.assertEqual(reqstats.route_of("http://h/api/v1/processes"), "/api/v1/processes")


@unittest.skipIf(api is None, "FastAPI absent : tests à lancer dans l'image")
class Snapshot(unittest.TestCase):
    """GET stream/snapshot: an admin sees a camera seen at the last collection, the picture is never kept."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = Path(tmp.name)
        block = {"role": "nvr", "cameras": [{"name": "entree"}], "snapshot": True}
        (d / "data.json").write_text(json.dumps({"services_status": [{"connector": "frigate", "name": "tower", "stream": block}]}))
        server.STATIC = server.WEB = d
        api.AUTH = True
        api.STORE = auth.Store(d / "myservices.db")
        pw = "long-" + "p" * 12   # built at run time: the commit guard refuses any literal secret
        api.STORE.create_user("admin", pw, "admin")
        self.c = TestClient(api.app, client=("192.168.1.50", 50000))
        self.c.post(BASE + "/login", json={"username": "admin", "password": pw})
        self.cam = mock.Mock(type="frigate")
        self.cam.name = "tower"
        p = mock.patch("connectors.instances", return_value=[self.cam])
        p.start()
        self.addCleanup(p.stop)

    def get(self, camera):
        return self.c.get(BASE + "/stream/snapshot", params={"connector": "frigate", "name": "tower", "camera": camera})

    def test_known_camera_only_and_never_kept(self):
        self.cam.snapshot.return_value = JPEG
        r = self.get("entree")
        self.assertEqual((r.status_code, r.headers["content-type"], r.headers["cache-control"]), (200, "image/jpeg", "no-store"))
        self.assertEqual(r.content, JPEG)
        self.assertEqual(self.get("../../etc").status_code, 404)   # a camera not seen at the last collection
        self.cam.snapshot.return_value = b"<html>"
        self.assertEqual(self.get("entree").status_code, 502)
        self.assertTrue(any(a["action"] == "image de caméra vue" for a in api.STORE.audit_log(10)))


if __name__ == "__main__":
    unittest.main()
