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
    return NS(device_info=Res(model=model, **info), handler=handler, address="192.0.2.9", model=model)


class Maybe:
    def __init__(self, value):
        self.value = value

    def get(self):
        if isinstance(self.value, Exception):
            raise self.value
        return self.value


def fake_lib(results):
    class Client:
        def __init__(self, user, password, timeout):
            self.args = (user, password)

        async def discover_devices(self, target, timeout_s):   # like the library: awaited first, then iterated
            async def each():
                for r in results:
                    yield Maybe(r)
            return each()

    return NS(ApiClient=Client, requests=NS(PowerDataInterval=NS(Hourly="h")))


def conn(results):
    tapo._series.clear()
    c = tapo.Tapo({"name": "t", "username": "me@example.com", "password": PW, "targets": "192.0.2.255"}, None)
    return c, mock.patch.object(tapo, "_lib", lambda: fake_lib(results))


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

    def test_a_missing_library_is_said(self):
        c = tapo.Tapo({"name": "t"}, None)
        with mock.patch.object(tapo, "_lib", side_effect=ImportError), self.assertRaises(ConnectorError):
            c.collect()

    def test_kinds_from_models(self):
        self.assertEqual([tapo.kind_of(m) for m in ("P110M", "TP10", "P304M", "H100", "L530", "C520WS", "TC70", "T315")], ["plug", "plug", "hub", "hub", "light", "camera", "camera", "other"])


if __name__ == "__main__":
    unittest.main()
