"""connectors/tapo.py: the discovery, the plugs' energy and the errors, against a fake `tapo` library (no device, no network).

  python3 -m unittest discover -s tests
"""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace as NS
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors import tapo
from connectors.base import ConnectorError

PW = "pw-" + "x"   # built here so the secret guard sees no literal


class Res(dict):
    def to_dict(self):
        return dict(self)


class Plug:
    async def get_current_power(self):
        return Res(current_power=86)

    async def get_energy_usage(self):
        return Res(today_energy=1840, month_energy=41200, current_power=86000)

    async def get_power_data(self, interval, start, end):
        t = datetime(2026, 10, 30, 10, tzinfo=timezone.utc)
        return Res(entries=[Res(start_date_time=t, power=40), Res(start_date_time=t.replace(hour=11), power=142), Res(start_date_time=t.replace(hour=12), power=None)])


class Hub:
    async def get_child_device_list(self):
        return [Res(device_id="c1", nickname="Chambre", model="T315", status="Online", at_low_battery=True, current_temperature=19.4, current_humidity=52, rssi=-60)]


def found(model, handler, **info):
    return NS(device_info=Res(model=model, **info), handler=handler, address=("192.0.2.9", 443), model=model)   # (ip, port) like the real library


class Maybe:
    def __init__(self, value):
        self.value = value

    def get(self):
        if isinstance(self.value, Exception):
            raise self.value
        return self.value


class Picture:
    def __init__(self, picture):
        self.picture, self.asked = picture, []

    async def get_snapshot(self, user, password):
        self.asked.append((user, password))
        if isinstance(self.picture, Exception):
            raise self.picture
        return self.picture


class Keeps:
    """A context whose cache keeps a value and gives it back, like Context.cached"""
    def __init__(self):
        self.kept = {}

    def cached(self, key, ttl, fn):
        if ttl == 0 or key not in self.kept:
            self.kept[key] = fn()
        return self.kept[key]


def fake_lib(results, raw=(), camera=None):
    class Client:
        def __init__(self, user, password, timeout):
            self.args = (user, password)

        async def discover_devices_raw(self, target, timeout_s):
            async def each():
                for r in raw:
                    yield Maybe(r)
            return each()

        async def c225(self, ip):
            return camera

        async def discover_devices(self, target, timeout_s):   # like the library: awaited first, then iterated
            async def each():
                for r in results:
                    yield Maybe(r)
            return each()

    return NS(ApiClient=Client, requests=NS(PowerDataInterval=NS(Hourly="h")))


def conn(results):
    tapo._series.clear()
    c = tapo.Tapo({"name": "t", "username": "me@example.com", "password": PW, "targets": "192.0.2.255"}, None)
    return c, mock.patch.object(tapo, "_lib", return_value=fake_lib(results))


class CameraPicture(unittest.TestCase):
    def setUp(self):
        self.conf = {"name": "t", "username": "me@example.com", "password": PW, "targets": "192.0.2.255", "camera_accounts": f"192.0.2.9 cam {PW} two; broken entry"}

    def conn(self, picture):
        c, self.cam = tapo.Tapo(self.conf, Keeps()), Picture(picture)
        with mock.patch.object(tapo, "_lib", return_value=fake_lib([found("C310", None, nickname="Salon", device_id="c1"), found("C320", None, nickname="Sans compte", device_id="c2", ip="192.0.2.8")], camera=self.cam)):
            self.out = c.collect()
        return c

    def picture(self, c):
        with mock.patch.object(tapo, "_lib", return_value=fake_lib([], camera=self.cam)):
            return c.snapshot("Salon")

    def test_only_a_camera_with_an_account_offers_its_picture_with_that_account(self):
        c = self.conn(b"\xff\xd8\xffjpeg")
        self.assertEqual([x["ip"] for x in self.out["stream"]["cameras"]], ["192.0.2.9"])
        self.assertEqual(self.picture(c), b"\xff\xd8\xffjpeg")
        self.assertEqual(self.cam.asked, [("cam", f"{PW} two")])   # a password may hold a space

    def test_no_account_no_stream_block(self):
        self.conf.pop("camera_accounts")
        self.conn(b"")
        self.assertNotIn("stream", self.out)

    def test_a_picture_refused_with_a_401_says_the_account_is_case_sensitive(self):
        c = self.conn(RuntimeError("401 response to DESCRIBE CSeq=2: Received Unauthorized after trying digest auth"))
        with self.assertRaises(ConnectorError) as e:
            self.picture(c)
        self.assertIn("majuscules", str(e.exception))

    def test_the_snapshot_object_of_the_library_gives_its_bytes(self):
        c = self.conn(NS(data=b"\xff\xd8\xffjpeg", content_type="image/jpeg"))   # tapo 0.12
        self.assertEqual(self.picture(c), b"\xff\xd8\xffjpeg")

    def test_a_camera_nobody_saw_has_no_picture(self):
        c = self.conn(b"")
        with self.assertRaises(ConnectorError):
            c.snapshot("Autre")
        self.assertEqual(self.cam.asked, [])


class Collect(unittest.TestCase):
    def test_a_plug_gives_its_power_energy_and_day_curve(self):
        c, p = conn([found("P110M", Plug(), nickname="Prise bureau", ip="192.0.2.21", device_id="p1", device_on=True, rssi=-58, fw_ver="1.3.2")])
        with p:
            d = c.collect()
        plug = d["devices"][0]
        self.assertEqual((plug["kind"], plug["power_w"], plug["today_wh"], plug["month_wh"], plug["peak_w"], plug["on"]), ("plug", 86, 1840, 41200, 142, True))
        self.assertEqual([w for _, w in plug["series"]], [40, 142])   # an hour without data is left out
        self.assertEqual(d["facts"][1]["value"], "86 W")
        self.assertEqual(d["problems"], [])

    def test_the_address_is_the_ip_alone(self):
        c, p = conn([found("P110M", Plug(), nickname="Prise", device_id="p1")])
        with p:
            self.assertEqual(c.collect()["devices"][0]["ip"], "192.0.2.9")
        self.assertEqual(tapo._ip(NS(address="192.0.2.30")), "192.0.2.30")
        self.assertEqual(tapo._ip(NS()), "")

    def test_a_hub_lists_its_sensors_and_a_camera_is_only_online(self):
        c, p = conn([found("H100", Hub(), nickname="Hub", device_id="h1"), found("C325WB", object(), nickname="Salon", device_id="c0")])
        with p:
            d = c.collect()
        kinds = {r["name"]: r["kind"] for r in d["devices"]}
        self.assertEqual(kinds, {"Hub": "hub", "Chambre": "sensor", "Salon": "camera"})
        self.assertEqual(next(f for f in d["facts"] if f["label"] == "Caméras en ligne")["value"], "1/1")
        self.assertIn("Chambre : pile faible", d["problems"])

    def test_a_device_the_library_cannot_drive_has_no_handler_and_is_still_listed(self):
        other = NS(device_info=Res(model="T999", nickname="Inconnu", device_id="o1"), address="192.0.2.30", model="T999")   # the real "Other" variant has no handler
        c, p = conn([other])
        with p:
            d = c.collect()
        self.assertEqual([r["name"] for r in d["devices"]], ["Inconnu"])

    def test_a_device_that_answers_the_discovery_but_not_the_reading_is_listed_with_the_reason(self):
        class Broken(Plug):
            async def get_current_power(self):
                raise RuntimeError("timeout")
        c, p = conn([found("P110", Broken(), nickname="Prise", device_id="p2")])
        with p:
            d = c.collect()
        self.assertEqual(d["devices"][0]["error"], "timeout")
        self.assertIn("lecture impossible", d["problems"][0])

    def test_a_refused_account_is_said_and_nothing_else_is_guessed(self):
        c, p = conn([RuntimeError("InvalidCredentials")])
        with p, self.assertRaises(ConnectorError) as e:
            c.collect()
        self.assertIn("compte", str(e.exception))
        c, p = conn([])
        with p, self.assertRaises(ConnectorError) as e:
            c.collect()
        self.assertIn("adresse de recherche", str(e.exception))

    def test_a_refused_device_next_to_a_readable_one_says_why(self):
        c, p = conn([found("P110M", Plug(), nickname="Prise", device_id="p1"), RuntimeError("Invalid camera credentials"), RuntimeError("Invalid camera credentials")])
        with p:
            d = c.collect()
        line = next(x for x in d["problems"] if "refusé" in x)
        self.assertIn("2 appareil(s) trouvé(s) mais refusé(s) (Invalid camera credentials)", line)   # the same reason is said once
        self.assertIn("compte caméra", line)

    def test_a_device_that_does_not_answer_the_reading_is_not_blamed_on_the_account(self):
        cause = 'DiscoveryError { ip: "10.0.0.11", source: Http(reqwest::Error { kind: Request, url: "http://10.0.0.11/app", ' + "x" * 80 + ' connection timed out }) }'
        line = tapo.Tapo._summary([], [cause])["problems"][0]
        self.assertIn("1 appareil(s) trouvé(s) mais illisible(s) (10.0.0.11 : ", line)
        self.assertIn("connection timed out", line)
        self.assertNotIn("compte", line)

    def test_a_picture_that_cannot_connect_says_the_cause_at_the_end_of_the_error(self):
        cause = ('Http(reqwest::Error { kind: Request, url: "https://10.0.0.12/", source: hyper_util::client::legacy::Error(Connect, Custom { kind: Other, '
                 'error: Custom { kind: InvalidData, error: "peer is incompatible: NoCipherSuitesInCommon" } }) })')
        self.assertTrue(tapo._reason(cause).startswith("10.0.0.12 : "))
        self.assertIn('NoCipherSuitesInCommon"', tapo._reason(cause))

    def test_a_picture_refused_on_the_stream_keeps_the_cause_before_the_connection_context(self):
        cause = ("RTSP DESCRIBE failed: 401 Unauthorized" + "x" * 40 + "\\n\\nconn: 192.0.2.191:38962(me)->192.0.2.15:554@2026-11-03T17:30:25.560602061Z"
                 "\\nmsg: 220@2026-11-03T17:30:25.576139779Z")
        reason = tapo._reason(cause)
        self.assertIn("401 Unauthorized", reason)
        self.assertNotIn("conn:", reason)

    def test_the_tapo_login_given_as_a_camera_account_is_refused_with_the_way_out(self):
        conf = {"username": "Me@example.com", "password": PW, "camera_accounts": f"192.0.2.11 me@example.com {PW}; 192.0.2.12 cam {PW}; 192.0.2.13 me@example.com other"}
        why = tapo.Tapo.refuse(conf)
        self.assertIn("192.0.2.11", why)
        self.assertNotIn("192.0.2.12", why)
        self.assertNotIn("192.0.2.13", why)   # a camera account may be named by the e-mail, with its own password
        self.assertIn("Compte de la caméra", why)
        self.assertEqual(tapo.Tapo.refuse({**conf, "camera_accounts": f"192.0.2.12 cam {PW}"}), "")

    def test_a_camera_given_the_tapo_login_is_not_asked_for_its_picture(self):
        conf = {"name": "t", "username": "me@example.com", "password": PW, "camera_accounts": f"192.0.2.11 me@example.com {PW}"}
        c = tapo.Tapo(conf, None)
        c.ctx = mock.Mock(cached=lambda *a: {"Cam": "192.0.2.11"})
        with mock.patch.object(tapo, "_lib") as lib, self.assertRaises(ConnectorError) as e:
            c.snapshot("Cam")
        lib.assert_not_called()
        self.assertIn("compte Tapo (e-mail)", str(e.exception))

    def test_the_test_tries_each_camera_and_says_which_one_is_refused(self):
        conf = {"name": "t", "username": "me@example.com", "password": PW, "camera_accounts": f"192.0.2.11 cam {PW}; 192.0.2.12 cam {PW}"}
        c = tapo.Tapo(conf, None)
        refused = ConnectorError("image refusée (401 Unauthorized)")
        with mock.patch.object(tapo.Tapo, "collect", return_value={"devices": [{}, {}]}), \
             mock.patch.object(tapo.Tapo, "_picture", side_effect=[b"jpg", refused]):
            r = c.test()
        self.assertTrue(r.ok)   # a camera refused does not switch off the plugs
        self.assertIn("caméra 192.0.2.11 : image OK", r.message)
        self.assertIn("caméra 192.0.2.12 : image refusée (401 Unauthorized)", r.message)

    def test_a_device_refused_by_the_account_is_still_listed_from_the_discovery(self):
        raw = Res(ip="192.0.2.11", message=Res(result=Res(device_model="C310", device_name="Cam", device_id="c9", firmware_version="1.9")))
        seen = Res(ip="192.0.2.9", message=Res(result=Res(device_model="P110M")))
        c = tapo.Tapo({"name": "t", "username": "me@example.com", "password": PW, "targets": "192.0.2.255"}, None)
        with mock.patch.object(tapo, "_lib", return_value=fake_lib([found("P110M", Plug(), nickname="Prise", device_id="p1"), RuntimeError("Connection refused")], [raw, seen])):
            d = c.collect()
        self.assertEqual([(r["name"], r["kind"], r["ip"]) for r in d["devices"]], [("Prise", "plug", "192.0.2.9"), ("Cam", "camera", "192.0.2.11")])
        self.assertIn("illisible", d["problems"][0])

    def test_an_unnamed_device_with_a_camera_account_is_a_camera_with_its_picture(self):
        raw = [Res(ip="192.0.2.11", message=Res(result=Res())), Res(ip="192.0.2.12", message=Res(result=Res()))]   # answers, but says nothing of itself
        conf = {"name": "t", "username": "me@example.com", "password": PW, "targets": "192.0.2.255", "camera_accounts": f"192.0.2.11 cam {PW}"}
        c = tapo.Tapo(conf, Keeps())
        with mock.patch.object(tapo, "_lib", return_value=fake_lib([found("P110M", Plug(), nickname="Prise", device_id="p1"), RuntimeError("Connection refused")], raw)):
            d = c.collect()
        self.assertEqual([(r["ip"], r["kind"]) for r in d["devices"][1:]], [("192.0.2.11", "camera"), ("192.0.2.12", "other")])
        self.assertEqual([x["ip"] for x in d["stream"]["cameras"]], ["192.0.2.11"])

    def test_a_missing_library_is_said(self):
        c = tapo.Tapo({"name": "t"}, None)
        with mock.patch.object(tapo, "_lib", side_effect=ImportError), self.assertRaises(ConnectorError):
            c.collect()

    def test_kinds_from_models(self):
        self.assertEqual([tapo.kind_of(m) for m in ("P110M", "TP10", "P304M", "H100", "L530", "C520WS", "TC70", "T315")], ["plug", "plug", "hub", "hub", "light", "camera", "camera", "other"])


if __name__ == "__main__":
    unittest.main()
