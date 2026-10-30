"""connectors/netatmo.py: the rotating token and the reading of each product, against a fake HTTP context (never the real API).

  python3 -m unittest discover -s tests
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from connectors.base import ConnectorError, RateLimited
from connectors.netatmo import Netatmo, from_home_assistant, summary, weather

SEED, NEXT = "seed-" + "x", "next-" + "y"   # built here so the secret guard sees no literal


class FakeCtx:
    def __init__(self, routes=None):
        self.routes, self.calls, self.rotations = routes or {}, [], 0

    def cached(self, key, ttl, fn):
        return fn()

    def http(self, url, **kw):
        self.calls.append((url, kw))
        if url.endswith("/oauth2/token"):
            self.rotations += 1
            return {"access_token": f"a{self.rotations}", "refresh_token": f"{NEXT}{self.rotations}", "expires_in": 10800}
        for key, value in self.routes.items():
            if key in url:
                if isinstance(value, Exception):
                    raise value
                return {"body": value}
        return {"body": {}}


class Base(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        env = mock.patch.dict(os.environ, {"MYSERVICES_CONFIG": f"{d.name}/config.json", "MYSERVICES_SECRET_KEY": f"{d.name}/secret.key"})
        env.start()
        self.addCleanup(env.stop)
        self.dir = Path(d.name)

    def conn(self, ctx, token=SEED):
        return Netatmo({"name": "n", "client_id": "i", "client_secret": "s", "refresh_token": token}, ctx)


class Token(Base):
    def test_kept_token_is_reused_then_the_new_refresh_token_is_spent(self):
        ctx = FakeCtx()
        self.assertEqual(self.conn(ctx).access_token(), "a1")
        self.assertEqual(self.conn(ctx).access_token(), "a1")
        self.assertEqual(ctx.rotations, 1)
        f = next(self.dir.glob("netatmo-*.token"))
        self.assertNotIn(NEXT.encode(), f.read_bytes())
        data = f.read_bytes()
        from msv.core import secrets_store
        fernet = secrets_store._fernet(self.dir / "config.json")
        import json
        kept = json.loads(fernet.decrypt(data))
        kept["expires"] = 0
        f.write_bytes(fernet.encrypt(json.dumps(kept).encode()))
        self.conn(ctx).access_token()
        self.assertEqual(ctx.calls[-1][1]["form"]["refresh_token"], f"{NEXT}1")

    def test_a_token_pasted_again_replaces_the_kept_one(self):
        ctx = FakeCtx()
        self.conn(ctx).access_token()
        self.conn(ctx, "pasted").access_token()
        self.assertEqual(ctx.calls[-1][1]["form"]["refresh_token"], "pasted")

    def test_refusal_says_what_to_do(self):
        ctx = FakeCtx()
        ctx.http = mock.Mock(side_effect=ConnectorError("HTTP 400 invalid_grant"))
        with self.assertRaisesRegex(ConnectorError, "nouveau Refresh token"):
            self.conn(ctx).access_token()


class Reading(Base):
    STATION = {"devices": [{"station_name": "Maison", "module_name": "Salon", "type": "NAMain", "reachable": True, "dashboard_data": {"Temperature": 21.5, "CO2": 600},
                            "modules": [{"_id": "w", "module_name": "Vent", "type": "NAModule2", "reachable": False, "battery_percent": 93},
                                        {"module_name": "VIP", "type": "NAModule4", "reachable": True, "battery_percent": 15, "dashboard_data": {"Humidity": 47}}]}]}
    HOME = {"homes": [{"id": "h", "name": "Maison", "rooms": [{"id": "r", "name": "Salon"}], "modules": [{"id": "c", "type": "NOC", "name": "Porte"}, {"id": "v", "type": "NBR", "name": "Volet", "room_id": "r"}]}]}
    STATUS = {"home": {"rooms": [{"id": "r", "therm_measured_temperature": 20.1, "therm_setpoint_temperature": 21}],
                       "modules": [{"id": "c", "monitoring": "on"}, {"id": "v", "reachable": False, "current_position": 100}]}}

    def test_every_product_is_read(self):
        d = self.conn(FakeCtx({"getstationsdata": self.STATION, "homesdata": self.HOME, "homestatus": self.STATUS})).collect()
        self.assertEqual(len(d["modules"]), 5)
        self.assertEqual(d["modules"][0]["values"], {"temperature": 21.5, "co2": 600})
        self.assertEqual(d["rooms"], [{"name": "Salon", "temperature": 20.1, "setpoint": 21}])
        self.assertIn("Vent ne répond plus", d["problems"])
        self.assertIn("VIP : pile faible (15 %)", d["problems"])
        self.assertIn("Volet ne répond plus", d["problems"])

    def test_a_weather_module_listed_again_by_its_home_counts_once(self):
        home = {"homes": [{"id": "h", "rooms": [{"id": "r", "name": "Terrasse"}], "modules": [{"id": "w", "type": "NAModule2", "room_id": "r"}]}]}
        status = {"home": {"modules": [{"id": "w", "battery_state": "low"}]}}
        d = self.conn(FakeCtx({"getstationsdata": self.STATION, "homesdata": home, "homestatus": status})).collect()
        self.assertEqual(len(d["modules"]), 3)
        self.assertEqual(d["modules"][1]["room"], "Terrasse")
        self.assertEqual(d["problems"].count("Vent ne répond plus"), 1)
        self.assertIn("Vent : pile faible (93 %)", d["problems"])

    def test_cameras_reach_the_video_page_and_a_picture_uses_the_fresh_address(self):
        status = {"home": {"modules": [{"id": "c", "monitoring": "on", "vpn_url": "https://cam.test/x"}]}}
        ctx = FakeCtx({"homesdata": self.HOME, "homestatus": status})
        d = self.conn(ctx).collect()
        self.assertEqual(d["stream"]["cameras"], [{"name": "Porte", "up": True, "detect": True, "place": "ext"}])
        ctx.routes["/live/snapshot_720.jpg"] = b"x"
        self.conn(ctx).snapshot("Porte")
        self.assertEqual(ctx.calls[-1][0], "https://cam.test/x/live/snapshot_720.jpg")
        self.assertTrue(ctx.calls[-1][1]["binary"])
        with self.assertRaises(ConnectorError):
            self.conn(ctx).snapshot("Autre")

    def test_a_product_without_rights_does_not_stop_the_others(self):
        d = self.conn(FakeCtx({"getstationsdata": self.STATION, "gethomecoachsdata": ConnectorError("HTTP 403"), "homesdata": ConnectorError("HTTP 403")})).collect()
        self.assertEqual(len(d["modules"]), 3)

    def test_nothing_readable_is_an_error(self):
        err = ConnectorError("HTTP 403")
        with self.assertRaises(ConnectorError):
            self.conn(FakeCtx({"getstationsdata": err, "gethomecoachsdata": err, "homesdata": err})).collect()

    def test_rate_limit_stops_the_pass(self):
        with self.assertRaises(RateLimited):
            self.conn(FakeCtx({"getstationsdata": RateLimited("HTTP 429")})).collect()

    def test_summary_counts_only_what_exists(self):
        facts, problems = summary(weather([{"name": "Coach", "type": "NHC", "reachable": True}]), [])
        self.assertEqual([f["label"] for f in facts], ["Appareils", "Hors ligne"])
        self.assertEqual(problems, [])


MARK = {"attribution": "Data provided by Netatmo"}


def ha(eid, state, **attrs):
    return {"entity_id": eid, "state": state, "attributes": {**MARK, **attrs}}


class ThroughHomeAssistant(unittest.TestCase):
    STATES = [
        ha("binary_sensor.station_connectivity", "on", device_class="connectivity", friendly_name="Station Connectivity"),
        ha("binary_sensor.station_ext_connectivity", "off", device_class="connectivity", friendly_name="Station ext Connectivity"),
        ha("binary_sensor.station_vent_connectivity", "on", device_class="connectivity", friendly_name="Station vent Connectivity"),
        ha("sensor.station_temperature", "22.4", device_class="temperature", friendly_name="Renamed by hand"),
        ha("sensor.station_carbon_dioxide", "512", device_class="carbon_dioxide"),
        ha("sensor.station_noise", "42", device_class="sound_pressure"),
        ha("sensor.station_ext_temperature", "9.9", device_class="temperature"),
        ha("sensor.station_ext_battery", "12", device_class="battery"),
        ha("sensor.station_vent_wind_speed", "unavailable", device_class="wind_speed"),
        ha("cover.volet", "open", friendly_name="Volet", current_position=48),
        ha("camera.salon", "streaming", friendly_name="Salon", monitoring=True),
        ha("climate.salon", "heat", friendly_name="Salon", current_temperature=20, temperature=21),
        {"entity_id": "sensor.other_temperature", "state": "1", "attributes": {"device_class": "temperature"}},
    ]

    def test_nothing_from_netatmo_gives_nothing(self):
        self.assertIsNone(from_home_assistant(self.STATES[-1:]))

    def test_devices_in_the_shape_of_the_connector(self):
        d = from_home_assistant(self.STATES)
        by = {m["id"]: m for m in d["modules"]}
        self.assertEqual(sorted(by), ["camera.salon", "cover.volet", "station", "station_ext", "station_vent"])
        self.assertEqual((by["station"]["name"], by["station"]["type"]), ("Station", "NAMain"))
        self.assertEqual(by["station"]["values"], {"temperature": 22.4, "co2": 512, "noise": 42})
        self.assertEqual(by["station"]["entities"]["co2"], "sensor.station_carbon_dioxide")
        self.assertEqual((by["station_ext"]["type"], by["station_ext"]["battery"], by["station_ext"]["reachable"]), ("NAModule1", 12, False))
        self.assertEqual((by["station_vent"]["type"], by["station_vent"]["values"]), ("NAModule2", {}))
        self.assertEqual(by["cover.volet"]["values"], {"current_position": 48})
        self.assertEqual(by["camera.salon"]["values"], {"monitoring": "on"})
        self.assertEqual(d["rooms"], [{"name": "Salon", "temperature": 20, "setpoint": 21}])
        self.assertIn("Station ext ne répond plus", d["problems"])


class Curves(Base):
    def test_a_module_is_read_with_its_station(self):
        ctx = FakeCtx({"getmeasure": {"1000": [20.5, None], "500": [20, 48]}})
        out = self.conn(ctx).curves({"id": "m", "device": "d", "type": "NAModule1"})
        self.assertEqual(out, {"temperature": [[500, 20], [1000, 20.5]], "humidity": [[500, 48]]})
        url = next(u for u, _ in ctx.calls if "getmeasure" in u)
        self.assertIn("device_id=d", url)
        self.assertIn("module_id=m", url)

    def test_a_station_has_no_module_id_and_an_unknown_type_no_curve(self):
        ctx = FakeCtx({"getmeasure": {}})
        c = self.conn(ctx)
        c.curves({"id": "d", "device": "d", "type": "NAMain"})
        self.assertNotIn("module_id", next(u for u, _ in ctx.calls if "getmeasure" in u))
        self.assertEqual(c.curves({"id": "x", "device": "d", "type": "NBR"}), {})


if __name__ == "__main__":
    unittest.main()
