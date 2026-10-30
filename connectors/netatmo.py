"""Netatmo: every product of an account read through its cloud API (no local API exists). Read-only: weather stations, Home Coach, then what a
home holds (thermostats, valves, cameras, smoke and CO detectors, shutters, Legrand devices). The cameras show on the Video page, picture only.

A refresh answers with a new refresh token and may invalidate the old one: the live token is kept encrypted beside config.json, never in it (a
settings save would race with it), and only one process at a time may refresh. A token pasted again in the settings replaces the kept one.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import time
import urllib.parse
from pathlib import Path

from connectors.base import Connector, ConnectorError, Field, RateLimited, Result
from connectors.status_kit import MAX_FACTS, MAX_PROBLEMS, fact, num
from msv.core import secrets_store

API = "https://api.netatmo.com"
EARLY_S = 60       # refresh a token this close to its end
LOW_BATTERY = 20   # percent
OUTDOOR = ("NOC", "NDB")   # the Presence and the doorbell; the other cameras stay indoors
WEATHER = {"Temperature": "temperature", "Humidity": "humidity", "CO2": "co2", "Noise": "noise", "Pressure": "pressure", "Rain": "rain",
           "sum_rain_24": "rain_24h", "WindStrength": "wind", "GustStrength": "gust", "WindAngle": "wind_angle", "health_idx": "air_quality"}
CAMERA, SHUTTER, HEATING = ("NACamera", "NOC", "NDB", "NCS", "NSD"), ("NBR", "NBO", "NBS", "Z3V", "Z3L"), ("NATherm1", "NRV", "OTM", "BNS")
INDOOR_MAIN = ("Temperature", "Humidity", "CO2", "Noise", "Pressure")
CURVES = {"NAMain": INDOOR_MAIN, "NHC": INDOOR_MAIN, "NAModule1": ("Temperature", "Humidity"), "NAModule4": ("Temperature", "Humidity", "CO2"),
          "NAModule3": ("Rain",), "NAModule2": ("WindStrength", "GustStrength")}
CURVE_TTL = 600    # the devices send a reading every 10 minutes; a page reopened spends no quota
HA_MARK = "Data provided by Netatmo"
HA_GROUP = "Home Assistant"
HA_KINDS = {"temperature": "temperature", "humidity": "humidity", "carbon_dioxide": "co2", "sound_pressure": "noise", "atmospheric_pressure": "pressure", "battery": "battery"}
HA_NAMED = {"wind_speed": "wind", "gust_strength": "gust", "precipitation": "rain", "precipitation_today": "rain_24h"}   # shortcut: English entity ids only, a Home Assistant set up in another language shows no wind or rain


def _values(d: dict | None) -> dict:
    return {key: d[raw] for raw, key in WEATHER.items() if isinstance(d, dict) and d.get(raw) is not None}


def weather(devices: list) -> list[dict]:
    """Stations and Home Coach as flat modules: {id, name, type, group, reachable, battery, low, values}."""
    out = []
    for dev in devices:
        group = dev.get("station_name") or dev.get("home_name") or dev.get("name") or "Netatmo"
        out.append({"id": dev.get("_id"), "device": dev.get("_id"), "name": dev.get("module_name") or dev.get("name") or group, "type": dev.get("type"), "group": group,
                    "reachable": dev.get("reachable") is not False, "battery": None, "low": False, "values": _values(dev.get("dashboard_data"))})
        out += [{"id": m.get("_id"), "device": dev.get("_id"), "name": m.get("module_name") or m.get("_id"), "type": m.get("type"), "group": group, "reachable": m.get("reachable") is not False,
                 "battery": num(m.get("battery_percent")), "low": False, "values": _values(m.get("dashboard_data"))} for m in dev.get("modules") or []]
    return out


def home_modules(home: dict, status: dict, read: dict) -> list[dict]:
    """The devices of a home with their live state (homesdata names them, homestatus gives the state). A home also lists its weather modules:
    those already in `read` (by id) only gain their room and Netatmo's own « low battery » verdict."""
    live = {m.get("id"): m for m in status.get("modules") or []}
    rooms = {r.get("id"): r.get("name") for r in home.get("rooms") or []}
    out = []
    for m in home.get("modules") or []:
        s = live.get(m.get("id"), {})
        low, room = str(s.get("battery_state") or "") in ("low", "very_low"), rooms.get(m.get("room_id"))
        if m.get("id") in read:
            read[m["id"]].update(room=room, low=low, last_seen=s.get("last_seen"))
            continue
        out.append({"id": m.get("id"), "name": m.get("name") or m.get("id"), "type": m.get("type"), "group": home.get("name") or "Netatmo", "room": room,
                    "reachable": s.get("reachable") is not False and s.get("status") != "disconnected", "battery": None, "low": low, "last_seen": s.get("last_seen"),
                    "values": {k: s[k] for k in ("monitoring", "status", "sd_status", "alim_status", "current_position", "floodlight", "on", "power") if s.get(k) is not None}})
    return out


def rooms_of(home: dict, status: dict) -> list[dict]:
    names = {r.get("id"): r.get("name") for r in home.get("rooms") or []}
    return [{"name": names.get(r.get("id")) or r.get("id"), "temperature": r.get("therm_measured_temperature"), "setpoint": r.get("therm_setpoint_temperature")}
            for r in status.get("rooms") or [] if r.get("therm_measured_temperature") is not None]


def summary(modules: list[dict], rooms: list[dict]) -> tuple[list[dict], list[str]]:
    gone = [m for m in modules if not m["reachable"]]
    low = [m for m in modules if m["low"] or (m["battery"] is not None and m["battery"] <= LOW_BATTERY)]
    count = lambda types: sum(1 for m in modules if m["type"] in types)   # noqa: E731
    facts = [fact("Appareils", len(modules)), fact("Hors ligne", len(gone), "bad" if gone else "ok")]
    if low:
        facts.append(fact("Piles faibles", len(low), "warn"))
    for label, n in (("Caméras", count(CAMERA)), ("Volets", count(SHUTTER)), ("Chauffage", count(HEATING)), ("Pièces chauffées", len(rooms))):
        if n:
            facts.append(fact(label, n))
    problems = [f"{m['name']} ne répond plus" for m in gone] + [f"{m['name']} : pile faible" + (f" ({m['battery']:.0f} %)" if m["battery"] is not None else "") for m in low]
    return facts[:MAX_FACTS], problems[:MAX_PROBLEMS]


def _ha_type(kinds: dict) -> str:
    """The Netatmo type of a device, told by what it measures: a sensor without CO2 stays outdoors, the page sorts them on that."""
    if "rain" in kinds:
        return "NAModule3"
    if "wind" in kinds:
        return "NAModule2"
    if "co2" in kinds:
        return "NAMain" if "noise" in kinds else "NAModule4"
    return "NAModule1"


def ha_sensors(states: list, stems: dict, kind=_ha_type) -> list[dict]:
    """A sensor belongs to the device with the longest matching entity id: « station_ext_humidity » to station_ext, not to station."""
    found: dict[str, dict] = {stem: {} for stem in stems}
    for st in states:
        kind_id, _, oid = str(st.get("entity_id", "")).partition(".")
        stem = max((x for x in stems if oid.startswith(x + "_")), key=len, default=None)
        if kind_id == "sensor" and stem:
            rest = oid[len(stem) + 1:]
            key = HA_NAMED.get(rest) or HA_KINDS.get((st.get("attributes") or {}).get("device_class"))
            if key and (key != "temperature" or "temp" in rest):   # a dew point or a heat index is a temperature too; shortcut: English entity ids
                found[stem][key] = st
    out = []
    for stem, kinds in found.items():
        values = {k: v for k, st in kinds.items() if k != "battery" and (v := num(st.get("state"))) is not None}
        battery = kinds.get("battery")
        out.append({"id": stem, "name": stems[stem]["name"], "type": kind(kinds), "group": HA_GROUP, "reachable": stems[stem]["up"], "low": False,
                    "battery": num(battery.get("state")) if battery else None, "values": values,
                    "entities": {k: st["entity_id"] for k, st in kinds.items() if k != "battery"}})
    return out


def from_home_assistant(states: list) -> dict | None:
    """The Netatmo devices a Home Assistant already reads, in the shape of this connector, for those without a Netatmo application.
    None when it reads none. A device is known by its connectivity sensor, the one entity it always has whatever the language."""
    mine = [st for st in states if (st.get("attributes") or {}).get("attribution") == HA_MARK]
    of = lambda domain: [st for st in mine if str(st.get("entity_id", "")).startswith(domain + ".")]   # noqa: E731
    name = lambda st: (st.get("attributes") or {}).get("friendly_name") or st["entity_id"]   # noqa: E731
    stems = {st["entity_id"].split(".", 1)[1].rsplit("_", 1)[0]: {"name": name(st).rsplit(" ", 1)[0], "up": st.get("state") == "on"}
             for st in of("binary_sensor") if (st.get("attributes") or {}).get("device_class") == "connectivity"}
    modules = ha_sensors(mine, stems)
    modules += [{"id": st["entity_id"], "name": name(st), "type": "NBR", "group": HA_GROUP, "reachable": st.get("state") != "unavailable", "battery": None, "low": False,
                 "values": {"current_position": st["attributes"]["current_position"]} if "current_position" in st["attributes"] else {}} for st in of("cover")]
    modules += [{"id": st["entity_id"], "name": name(st), "type": "NACamera", "group": HA_GROUP, "reachable": st.get("state") != "unavailable", "battery": None, "low": False,
                 "values": {"monitoring": "on" if st["attributes"].get("monitoring") else "off"}} for st in of("camera")]
    rooms = [{"name": name(st), "temperature": st["attributes"].get("current_temperature"), "setpoint": st["attributes"].get("temperature")} for st in of("climate")]
    return {"modules": modules, "rooms": rooms, "problems": summary(modules, rooms)[1]} if modules else None


class Netatmo(Connector):
    type = "netatmo"
    label = "Netatmo"
    kinds = ("status",)
    every = 600   # the devices send their readings every 10 minutes
    fields = (
        Field("client_id", "Client ID", required=True, help="Page de ton application sur dev.netatmo.com"),
        Field("client_secret", "Client secret", "password", required=True, secret=True),
        Field("refresh_token", "Refresh token", "password", required=True, secret=True,
              help="Généré sur la page de l'application. À recoller seulement si Netatmo refuse l'accès : MyServices le renouvelle ensuite tout seul."),
    )
    setup_fields = ("client_id", "client_secret", "refresh_token")
    guide = ("Ouvre https://dev.netatmo.com et connecte-toi avec ton compte Netatmo habituel.",
             "My Apps → Create : donne un nom, par exemple « MyServices ». Crée une application rien que pour MyServices : ne reprends pas celle de Home Assistant ni son jeton, chaque renouvellement pourrait couper l'autre logiciel.",
             "Si le formulaire demande un responsable des données (data protection officer), mets ton nom et ton e-mail. Pour un usage perso, la société et son site peuvent rester vides.",
             "Copie le Client ID et le Client secret de l'application dans les champs ci-dessus.",
             "Sur la même page, section Token generator : coche tous les droits read_ pour lire tes produits. Ajoute access_camera (caméras intérieures et sonnette) et access_presence (caméras extérieures) pour voir leur image dans la page Vidéo. Sans ces deux droits, la caméra est listée mais reste sans image. Laisse les droits write_ décochés : MyServices ne fait que lire.",
             "Clique sur Generate token, accepte sur la page Netatmo, puis copie le Refresh token (pas l'Access token) dans le champ ci-dessus. Clique sur Tester.",
             "Pour ajouter un droit plus tard : génère un nouveau jeton avec tous les droits voulus et colle-le ici. MyServices renouvelle ensuite le jeton tout seul, tu n'as rien d'autre à faire.")

    def _store(self) -> Path:
        from connectors.settings import config_file
        tag = hashlib.sha256(f"{self.name}".encode()).hexdigest()[:16]
        return config_file().parent / f"netatmo-{tag}.token"

    def _load(self, f: Path, fernet) -> dict:
        try:
            return json.loads(fernet.decrypt(f.read_bytes()))
        except (OSError, ValueError):
            return {}
        except Exception as e:   # InvalidToken: the key changed, start again from the token of the settings
            if type(e).__name__ == "InvalidToken":
                return {}
            raise

    def access_token(self) -> str:
        """A valid access token; refreshes under an inter-process lock so two readers never spend the same refresh token."""
        from connectors.settings import config_file
        f, seed = self._store(), hashlib.sha256(str(self.conf.get("refresh_token", "")).encode()).hexdigest()
        fernet = secrets_store._fernet(config_file(), create=True)
        try:
            with open(f.with_suffix(".lock"), "w", encoding="utf-8") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                kept = self._load(f, fernet)
                kept = kept if kept.get("seed") == seed else {}
                if kept.get("access") and kept.get("expires", 0) > time.time() + EARLY_S:
                    return kept["access"]
                try:
                    r = self.ctx.http(f"{API}/oauth2/token", method="POST", form={
                        "grant_type": "refresh_token", "refresh_token": kept.get("refresh") or self.conf.get("refresh_token"),
                        "client_id": self.conf.get("client_id"), "client_secret": self.conf.get("client_secret")})
                except RateLimited:
                    raise
                except ConnectorError as e:
                    if "HTTP 4" in str(e):
                        raise ConnectorError("Netatmo refuse l'accès : génère un nouveau Refresh token sur dev.netatmo.com et colle-le dans les réglages") from None
                    raise
                if not isinstance(r, dict) or not r.get("access_token"):
                    raise ConnectorError("réponse inattendue de Netatmo")
                tmp = f.with_suffix(".tmp")
                tmp.touch(mode=0o600)
                tmp.write_bytes(fernet.encrypt(json.dumps({
                    "seed": seed, "refresh": r.get("refresh_token") or kept.get("refresh") or self.conf.get("refresh_token"),
                    "access": r["access_token"], "expires": time.time() + float(r.get("expires_in") or 10800)}).encode()))
                tmp.replace(f)
                return r["access_token"]
        except OSError as e:
            raise ConnectorError(f"jeton Netatmo impossible à garder ({e.strerror})") from None

    def _get(self, path: str) -> dict:
        d = self.ctx.http(f"{API}/api/{path}", headers={"Authorization": f"Bearer {self.access_token()}"})
        return (d.get("body") or {}) if isinstance(d, dict) else {}

    def _optional(self, path: str, skipped: list) -> dict:
        """A token without the rights of a product gets a refusal for that product only."""
        try:
            return self._get(path)
        except RateLimited:
            raise
        except ConnectorError as e:
            skipped.append(f"{path.split('?')[0]} : {e}")
            return {}

    def curves(self, m: dict) -> dict:
        """The last 24 hours of a sensor, {measure: [[seconds, value], ...]}, read when a card is opened."""
        wanted, now = CURVES.get(m.get("type")), int(time.time())
        if not wanted or not m.get("device"):
            return {}
        q = {"device_id": m["device"], "scale": "30min", "type": ",".join(wanted), "date_begin": now - 86400, "optimize": "false"}
        if m["id"] != m["device"]:
            q["module_id"] = m["id"]
        body = self.ctx.cached(f"{self.name}-curves-{m['id']}", CURVE_TTL, lambda: self._get(f"getmeasure?{urllib.parse.urlencode(q)}"))
        out: dict[str, list] = {WEATHER[raw]: [] for raw in wanted}
        for ts, row in sorted(body.items(), key=lambda kv: int(kv[0])):
            for raw, v in zip(wanted, row):
                if v is not None:
                    out[WEATHER[raw]].append([int(ts), v])
        return out

    def collect(self) -> dict:
        skipped: list[str] = []
        modules = weather(self._optional("getstationsdata", skipped).get("devices") or [])
        modules += weather(self._optional("gethomecoachsdata", skipped).get("devices") or [])
        rooms: list[dict] = []
        read = {m["id"]: m for m in modules if m["id"]}
        for home in self._optional("homesdata", skipped).get("homes") or []:
            status = self._optional(f"homestatus?home_id={home.get('id')}", skipped).get("home") or {}
            modules += home_modules(home, status, read)
            rooms += rooms_of(home, status)
        if len(skipped) >= 3 and not modules:
            raise ConnectorError(f"aucun produit lisible ({skipped[0]})")
        facts, problems = summary(modules, rooms)
        cams = [{"name": m["name"], "up": m["reachable"], "detect": m["values"].get("monitoring") == "on", "place": "ext" if m["type"] in OUTDOOR else "int"} for m in modules if m["type"] in CAMERA]
        return {"version": None, "facts": facts, "problems": problems, "modules": modules, "rooms": rooms,
                **({"stream": {"role": "nvr", "engine": "Netatmo", "cameras": cams, "snapshot": True}} if cams else {})}

    def snapshot(self, cam: str) -> bytes:
        """The picture of the moment, through the camera's own address: homestatus gives it fresh, it changes when the camera reconnects."""
        for home in self._get("homesdata").get("homes") or []:
            names = {m.get("id"): m.get("name") for m in home.get("modules") or []}
            for m in (self._get(f"homestatus?home_id={home.get('id')}").get("home") or {}).get("modules") or []:
                if names.get(m.get("id")) == cam:
                    if not m.get("vpn_url"):
                        raise ConnectorError("cette caméra ne donne pas son adresse : régénère le jeton avec le droit access_camera")
                    return self.ctx.http(f"{m['vpn_url']}/live/snapshot_720.jpg", binary=True)
        raise ConnectorError("caméra inconnue")

    def test(self) -> Result:
        try:
            d = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, f"{len(d['modules'])} appareil(s) lu(s)")
