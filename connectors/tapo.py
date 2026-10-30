"""Tapo (TP-Link): the plugs, lights, hubs and cameras of a home, found and read over the local network with the `tapo` library (MIT, async).
Read-only: only `get_*` calls are made, nothing is switched. The devices are found by a UDP discovery at the address given (a broadcast address
reaches them all: the container runs in host network mode), then each is read with the Tapo account. The cameras only give their state here, no picture.

The library is imported when a read starts, so the rest of MyServices runs without it.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

from connectors.base import Connector, ConnectorError, Field, Result
from connectors.status_kit import MAX_FACTS, MAX_PROBLEMS, fact, num

DISCOVERY_S = 6        # seconds a discovery waits for the devices to answer
SERIES_TTL = 600       # the power curve of a plug is read again after this long
AUTH_WORDS = ("credential", "auth", "password", "login", "forbidden")
_series: dict[str, tuple[float, list]] = {}   # shortcut: kept in memory per process, a restart reads the curves again


def _lib():
    # Not in every image, and only needed when a read starts.
    import tapo   # noqa: PLC0415
    return tapo


def _dict(obj) -> dict:
    """A library result as a plain dict (each has to_dict), tolerant of a missing field."""
    if isinstance(obj, dict):
        return obj
    if obj is None:
        return {}
    to = getattr(obj, "to_dict", None)
    return to() if callable(to) else {k: v for k, v in vars(obj).items() if not k.startswith("_")}


def kind_of(model: str) -> str:
    """plug, light, hub (hubs and power strips: they hold children), camera or other, from the model name (P110M, L530, H100, C325WB, TC70…)."""
    m = model.upper()
    if m.startswith(("TC", "C")):
        return "camera"
    for prefixes, kind in ((("P3", "H"), "hub"), (("P", "TP"), "plug"), (("L",), "light")):
        if m.startswith(prefixes):
            return kind
    return "other"


def _power_series(entries: list) -> list[list]:
    out = []
    for e in entries:
        e = _dict(e)
        w, t = e.get("power"), e.get("start_date_time")
        if w is not None and isinstance(t, datetime):
            out.append([int(t.timestamp()), w])
    return out


def _online(status) -> bool:
    return "online" in str(status).lower()


class Tapo(Connector):
    type = "tapo"
    label = "Tapo"
    kinds = ("status",)
    every = 120
    fields = (
        Field("username", "Compte Tapo (e-mail)", required=True, help="Celui de l'application Tapo"),
        Field("password", "Mot de passe Tapo", "password", required=True, secret=True),
        Field("targets", "Adresse de recherche", default="255.255.255.255",
              help="Adresse de diffusion de ton réseau (par exemple 192.168.1.255) ou IP d'un appareil. Plusieurs : séparées par des virgules. Les appareils répondent sur le réseau local."),
    )
    setup_fields = ("username", "password", "targets")
    guide = ("Ouvre l'application Tapo et note l'e-mail et le mot de passe du compte qui possède tes appareils.",
             "Colle-les dans les champs ci-dessus. MyServices lit seulement : il n'allume ni n'éteint rien.",
             "Adresse de recherche : laisse 255.255.255.255, ou mets l'adresse de diffusion de ton réseau (la dernière adresse, par exemple 192.168.1.255). Pour un seul appareil, mets son IP.",
             "Les appareils sont lus sur ton réseau local, pas par le cloud. Une caméra Tapo donne son état, pas son image, dans cette version.",
             "Clique sur Tester : un appareil qui ne répond pas à la recherche n'est pas listé.")

    def _targets(self) -> list[str]:
        raw = str(self.conf.get("targets") or "255.255.255.255")
        return [t.strip() for t in raw.split(",") if t.strip()] or ["255.255.255.255"]

    async def _discover(self, lib) -> tuple[list, list[str]]:
        client = lib.ApiClient(self.conf.get("username", ""), self.conf.get("password", ""), 10)
        found, errors, seen = [], [], set()
        for target in self._targets():
            async for maybe in await client.discover_devices(target, DISCOVERY_S):
                try:
                    d = maybe.get()
                except Exception as e:   # noqa: BLE001
                    errors.append(str(e))
                    continue
                key = _dict(getattr(d, "device_info", None)).get("device_id") or getattr(d, "address", None) or id(d)
                if key not in seen:
                    seen.add(key)
                    found.append(d)
        return found, errors

    async def _plug(self, lib, h, row: dict) -> None:
        """Power now, today's and this month's energy (Wh), and the 24 hours of the plug's own history."""
        row["power_w"] = num(_dict(await h.get_current_power()).get("current_power"))
        use = _dict(await h.get_energy_usage())
        row["today_wh"], row["month_wh"] = num(use.get("today_energy")), num(use.get("month_energy"))
        kept = _series.get(row["id"])
        if not kept or time.time() - kept[0] > SERIES_TTL:
            end = datetime.now(timezone.utc)
            data = _dict(await h.get_power_data(lib.requests.PowerDataInterval.Hourly, end - timedelta(hours=24), end))
            kept = (time.time(), _power_series(data.get("entries") or []))
            _series[row["id"]] = kept
        row["series"] = kept[1]
        row["peak_w"] = max([w for _, w in kept[1]] + ([row["power_w"]] if row["power_w"] is not None else []), default=None)

    async def _children(self, h, parent: str) -> list[dict]:
        out = []
        for c in await h.get_child_device_list():
            c = _dict(c)
            row = {"id": c.get("device_id") or c.get("mac"), "name": c.get("nickname") or c.get("model"), "model": c.get("model"), "kind": "sensor", "parent": parent,
                   "mac": c.get("mac"), "fw": c.get("fw_ver"), "rssi": c.get("rssi"), "online": _online(c.get("status")), "battery_low": bool(c.get("at_low_battery"))}
            for key, src in (("temperature", "current_temperature"), ("humidity", "current_humidity")):
                if c.get(src) is not None:
                    row[key] = c[src]
            out.append(row)
        return out

    async def _read(self, lib, d) -> list[dict]:
        info = _dict(getattr(d, "device_info", None))
        ip = str(info.get("ip") or getattr(d, "address", None) or "")
        model = str(info.get("model") or getattr(d, "model", "") or "")
        name = info.get("nickname") or info.get("device_name") or model
        row = {"id": str(info.get("device_id") or info.get("mac") or ip), "name": name, "model": model, "kind": kind_of(model), "ip": ip, "mac": info.get("mac"),
               "fw": info.get("fw_ver"), "rssi": info.get("rssi"), "online": True, "on": info.get("device_on"), "brightness": info.get("brightness")}
        h, rows = getattr(d, "handler", None), []   # a device of a kind the lib does not drive ("Other") has no handler
        try:
            if hasattr(h, "get_energy_usage"):
                await self._plug(lib, h, row)
            if hasattr(h, "get_child_device_list"):
                rows = await self._children(h, name)
        except Exception as e:   # noqa: BLE001
            row["error"] = str(e)[:160]
        return [row, *rows]

    def collect(self) -> dict:
        try:
            lib = _lib()
        except ImportError:
            raise ConnectorError("bibliothèque « tapo » absente de cette image") from None

        async def run():
            found, errors = await self._discover(lib)
            return found, errors, [await self._read(lib, d) for d in found]

        try:
            _, errors, groups = asyncio.run(run())
        except OSError as e:
            raise ConnectorError(f"recherche impossible ({e.strerror or e.__class__.__name__})") from None
        devices = [r for g in groups for r in g]
        if not devices:
            if any(w in e.lower() for e in errors for w in AUTH_WORDS):
                raise ConnectorError("Tapo refuse ce compte : e-mail ou mot de passe à vérifier")
            raise ConnectorError(f"aucun appareil lisible ({errors[0]})" if errors else "aucun appareil Tapo trouvé : l'adresse de recherche est-elle la bonne ?")
        return self._summary(devices, errors)

    @staticmethod
    def _summary(devices: list[dict], errors: list[str]) -> dict:
        plugs = [d for d in devices if d.get("power_w") is not None]
        cams = [d for d in devices if d["kind"] == "camera"]
        facts = [fact("Appareils", len(devices))]
        if plugs:
            facts.append(fact("Puissance", f"{sum(d['power_w'] for d in plugs):.0f} W"))
        if cams:
            up = sum(1 for d in cams if d["online"])
            facts.append(fact("Caméras en ligne", f"{up}/{len(cams)}", "ok" if up == len(cams) else "warn"))
        problems = [f"{d['name']} : lecture impossible ({d['error']})" for d in devices if d.get("error")]
        problems += [f"{d['name']} ne répond plus" for d in devices if not d["online"]]
        problems += [f"{d['name']} : pile faible" for d in devices if d.get("battery_low")]
        if errors:
            reasons = " ; ".join(dict.fromkeys(e.strip()[:100] for e in errors if e.strip()))[:240]
            problems.append(f"{len(errors)} appareil(s) trouvé(s) mais refusé(s) ({reasons or 'raison inconnue'}) : compte Tapo à vérifier ; une caméra demande son compte caméra, réglé dans l'appli Tapo")
        return {"version": None, "facts": facts[:MAX_FACTS], "problems": problems[:MAX_PROBLEMS], "devices": devices}

    def test(self) -> Result:
        try:
            d = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, f"{len(d['devices'])} appareil(s) lu(s)")
