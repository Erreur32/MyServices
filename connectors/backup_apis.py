"""Sauvegardes lues par API, en lecture seule : Veeam Backup & Replication et Home Assistant.

Instances tirées de backups-meta.json (hosts « api »: "veeam" / "ha"), identifiants dans un fichier
de secrets CLÉ=valeur (mode 600), jamais dans backups-meta.json. Forme rendue : celle de backups.py
(disques, crons, veeam_jobs / ha_backup).

Veeam : API REST (port 9419, pas 9392 qui est la console), compte au rôle « Veeam Backup Viewer » ;
  x-api-version 1.1-rev0 = v12 et suivantes. Certificat auto-signé de Veeam accepté (LAN).
Home Assistant : /api/states (capteurs du gestionnaire de sauvegardes, disque de l'hôte), jeton
  longue durée ; version par /api/config.
"""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from connectors.base import Connector, ConnectorError, Field


def read_secrets(path: str) -> dict:
    """Fichier CLÉ=valeur (mode 600) : identifiants jamais écrits dans backups-meta.json."""
    try:
        with open(path) as f:
            return dict(l.strip().split("=", 1) for l in f if "=" in l and not l.startswith("#"))
    except OSError as e:
        raise ConnectorError(f"secrets illisibles ({path} : {e.strerror})") from None


def _fmt(t):
    return datetime.fromtimestamp(t).strftime("%d/%m %H:%M") if t else "?"


def veeam_parse(jobs: list, repos: list) -> dict:
    """Réponses de l'API Veeam -> forme commune (disques = dépôts, crons = jobs, veeam_jobs par nom)."""
    def ts(v):
        try:
            return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp())
        except (AttributeError, TypeError, ValueError):
            return None
    gb, disks = 1024 ** 3, []
    for r in repos:
        size, free = r.get("capacityGB"), r.get("freeGB")
        if size:
            disks.append({"dev": r.get("name", "?"), "fs": r.get("type", "veeam"), "mount": r.get("path") or r.get("name", "?"),
                          "size": int(size * gb), "used": int((size - (free or 0)) * gb), "avail": int((free or 0) * gb),
                          "pct": round((size - (free or 0)) * 100 / size, 1)})
    out = {"user": "API REST Veeam", "locs": {}, "cron_root": None, "disks": disks, "crons": [], "veeam_jobs": {}}
    for j in jobs:
        last, res, nxt = ts(j.get("lastRun")), j.get("lastResult") or "None", ts(j.get("nextRun"))
        out["veeam_jobs"][j.get("name", "?")] = {"last_run": last, "result": res, "status": j.get("status"), "next": nxt}
        out["crons"].append({"src": "job Veeam " + (j.get("type") or ""),
                             "line": f"{j.get('name')} : dernier {_fmt(last)} ({res}), prochain {_fmt(nxt)}"})
    return out


class Veeam(Connector):
    type = "veeam"
    label = "Veeam Backup & Replication"
    kinds = ("backups",)
    fields = (
        Field("url", "URL de l'API REST", "url", required=True, help="https://<serveur>:9419"),
        Field("secrets", "Fichier VEEAM_USER= / VEEAM_PASS= (mode 600)", required=True),
        Field("api_version", "x-api-version", default="1.1-rev0"),
    )

    def _call(self, path: str, data: bytes | None = None, token: str | None = None) -> dict:
        hd = {"x-api-version": self.conf.get("api_version", "1.1-rev0"), **({"Authorization": "Bearer " + token} if token else {})}
        req = urllib.request.Request(self.conf["url"].rstrip("/") + path, data=data, headers=hd)
        ctx = ssl._create_unverified_context()  # certificat auto-signé de Veeam (LAN), comme la console
        with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
            return json.load(r)

    def collect(self) -> dict:
        env = read_secrets(self.conf["secrets"])
        if not env.get("VEEAM_USER") or not env.get("VEEAM_PASS"):
            raise ConnectorError(f"VEEAM_USER / VEEAM_PASS absents de {self.conf['secrets']}")
        form = urllib.parse.urlencode({"grant_type": "password", "username": env["VEEAM_USER"],
                                       "password": env["VEEAM_PASS"]}).encode()
        try:
            token = self._call("/api/oauth2/token", form)["access_token"]
            jobs = self._call("/api/v1/jobs/states", token=token).get("data", [])
        except (OSError, ValueError, KeyError) as e:
            raise ConnectorError(f"{e}"[:200]) from None
        try:  # capacité des dépôts : facultatif (droits ou version)
            repos = self._call("/api/v1/backupInfrastructure/repositories/states", token=token).get("data", [])
        except (OSError, ValueError):
            repos = []
        return veeam_parse(jobs, repos)


class HomeAssistant(Connector):
    type = "home-assistant"
    label = "Home Assistant"
    kinds = ("backups",)
    images = ("homeassistant/home-assistant", "ghcr.io/home-assistant/home-assistant")
    fields = (Field("secrets", "Fichier HA_URL= / HA_TOKEN= (mode 600)", required=True),)

    def _states(self, env: dict) -> list:
        req = urllib.request.Request(env["HA_URL"].rstrip("/") + "/api/states", headers={"Authorization": "Bearer " + env["HA_TOKEN"]})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)

    def version(self) -> str | None:
        env = read_secrets(self.conf["secrets"])
        req = urllib.request.Request(env["HA_URL"].rstrip("/") + "/api/config", headers={"Authorization": "Bearer " + env["HA_TOKEN"]})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r).get("version")
        except (OSError, ValueError):
            return None

    def collect(self) -> dict:
        env = read_secrets(self.conf["secrets"])
        try:
            states = {x["entity_id"]: x for x in self._states(env)}
        except (OSError, ValueError, KeyError, TypeError) as e:
            raise ConnectorError(f"{e}"[:200]) from None

        def val(eid):
            return (states.get(eid) or {}).get("state")

        def ts(eid):
            try:
                return int(datetime.fromisoformat(val(eid)).timestamp())
            except (TypeError, ValueError):
                return None
        gb = 1000 ** 3
        total, used, free = (float(val(f"sensor.home_assistant_host_disk_{k}") or 0) for k in ("total", "used", "free"))
        ok, tried, nxt = (ts(f"sensor.backup_{k}") for k in ("last_successful_automatic_backup",
                                                              "last_attempted_automatic_backup", "next_scheduled_automatic_backup"))
        return {"user": "API REST", "locs": {}, "cron_root": None,
                "disks": [{"dev": "HAOS", "fs": "ext4", "mount": "/ (HAOS)", "size": int(total * gb), "used": int(used * gb),
                           "avail": int(free * gb), "pct": round(used * 100 / total, 1) if total else 0}] if total else [],
                "crons": [{"src": "gestionnaire de sauvegardes HA",
                           "line": f"auto : dernière réussie {_fmt(ok)}, dernier essai {_fmt(tried)}, prochaine {_fmt(nxt)} "
                                   f"(état {val('sensor.backup_backup_manager_state')})"}],
                "ha_backup": {"last_ok": ok, "last_attempt": tried, "next": nxt}}
