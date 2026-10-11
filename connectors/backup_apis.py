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

from connectors.base import Connector, ConnectorError, Field, Result
from connectors.proxmox import ProxmoxBackup


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
    """Veeam B&R par son API REST. Compte : soit « user » + « password » (réglés dans la page, mot de passe chiffré dans
    config.json), soit un fichier de secrets CLÉ=valeur (ancienne méthode, toujours lue)."""
    type = "veeam"
    label = "Veeam Backup & Replication"
    kinds = ("backups",)
    tested = ("12", "13")
    guide = (
        "Dans la console Veeam : Menu → Users and Roles → Add, créer (ou choisir) un compte Windows dédié.",
        "Lui donner le seul rôle « Veeam Backup Viewer » (lecture seule : il ne peut ni lancer ni modifier un job).",
        "L'adresse est celle de l'API REST : https://<serveur>:9419 (le port 9392 est celui de la console).",
    )
    fields = (
        Field("url", "URL de l'API REST", "url", required=True, help="https://<serveur>:9419"),
        Field("user", "Compte (lecture seule)", help="rôle Veeam Backup Viewer, par exemple DOMAINE\\myservices"),
        Field("password", "Mot de passe du compte", "password", secret=True, help="chiffré dans config.json, jamais renvoyé à la page"),
        Field("secrets", "Ou fichier VEEAM_USER= / VEEAM_PASS= (mode 600)", help="ancienne méthode, si aucun compte n'est saisi"),
        Field("api_version", "x-api-version", default="1.1-rev0"),
    )

    @classmethod
    def validate(cls, conf: dict) -> list[str]:
        missing = [f"« {k} » requis" for k in ("url",) if not conf.get(k)]
        if not conf.get("secrets") and not (conf.get("user") and conf.get("password")):
            missing.append("« user » et « password » (ou « secrets ») requis")
        return missing

    def _call(self, path: str, data: bytes | None = None, token: str | None = None) -> dict:
        hd = {"x-api-version": self.conf.get("api_version") or "1.1-rev0", **({"Authorization": "Bearer " + token} if token else {})}
        req = urllib.request.Request(self.conf["url"].rstrip("/") + path, data=data, headers=hd)
        ctx = ssl._create_unverified_context()  # certificat auto-signé de Veeam (LAN), comme la console
        with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
            return json.load(r)

    def _credentials(self) -> tuple[str, str]:
        if self.conf.get("user") and self.conf.get("password"):
            return self.conf["user"], self.conf["password"]
        env = read_secrets(self.conf["secrets"])
        if not env.get("VEEAM_USER") or not env.get("VEEAM_PASS"):
            raise ConnectorError(f"VEEAM_USER / VEEAM_PASS absents de {self.conf['secrets']}")
        return env["VEEAM_USER"], env["VEEAM_PASS"]

    def fetch(self) -> tuple[list, list]:
        """(jobs, dépôts) bruts de l'API : lecture seule (un jeton d'accès, puis deux GET)."""
        user, pw = self._credentials()
        form = urllib.parse.urlencode({"grant_type": "password", "username": user, "password": pw}).encode()
        try:
            try:
                token = self._call("/api/oauth2/token", form)["access_token"]
            except urllib.error.HTTPError as e:
                e.close()
                if e.code in (400, 401):  # Veeam répond 400 « invalid_grant » à un mauvais compte
                    raise ConnectorError(f"identifiants refusés (HTTP {e.code}) : vérifier le compte et son mot de passe") from None
                raise
            jobs = self._call("/api/v1/jobs/states", token=token).get("data", [])
        except (OSError, ValueError, KeyError) as e:
            raise ConnectorError(f"{e if isinstance(e, urllib.error.HTTPError) else getattr(e, 'reason', e)}"[:200]) from None
        try:  # capacité des dépôts : facultatif (droits ou version)
            repos = self._call("/api/v1/backupInfrastructure/repositories/states", token=token).get("data", [])
        except (OSError, ValueError):
            repos = []
        return jobs, repos

    def collect(self) -> dict:
        return veeam_parse(*self.fetch())

    def test(self) -> Result:
        jobs, repos = self.fetch()
        return Result(True, f"connecté : {len(jobs)} job(s), {len(repos)} dépôt(s) lus")


class HomeAssistant(Connector):
    """Sauvegardes et disque de Home Assistant (module backups.py, fichier de secrets) ; l'état et les mises à jour
    sont lus par connectors/home_assistant.py (adresse + jeton, réglable dans la page)."""
    type = "home-assistant-backups"
    label = "Home Assistant"
    kinds = ("backups",)
    fields = (Field("secrets", "Fichier HA_URL= / HA_TOKEN= (mode 600)", required=True),)  # ou url + token du connecteur « home-assistant »

    def _env(self) -> dict:
        """Adresse et jeton : ceux du connecteur Home Assistant de la page (url + token) ou, à défaut, le fichier de secrets."""
        if self.conf.get("url") and self.conf.get("token"):
            return {"HA_URL": self.conf["url"], "HA_TOKEN": self.conf["token"]}
        return read_secrets(self.conf["secrets"])

    def _states(self, env: dict) -> list:
        req = urllib.request.Request(env["HA_URL"].rstrip("/") + "/api/states", headers={"Authorization": "Bearer " + env["HA_TOKEN"]})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)

    def version(self) -> str | None:
        env = self._env()
        req = urllib.request.Request(env["HA_URL"].rstrip("/") + "/api/config", headers={"Authorization": "Bearer " + env["HA_TOKEN"]})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r).get("version")
        except (OSError, ValueError):
            return None

    def collect(self) -> dict:
        env = self._env()
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


class PbsBackups(ProxmoxBackup):
    """Sauvegardes d'un Proxmox Backup Server : dernier passage de chaque groupe (une VM, un conteneur ou un hôte) de chaque magasin.
    Mêmes réglages que le connecteur « proxmox-backup » (jeton DatastoreAudit). Forme rendue : celle de backups.py (pbs_groups, disques)."""
    type = "proxmox-backup-backups"

    def groups(self) -> list[dict]:
        """Groupes de tous les magasins : {store, type, id, last (epoch), count, comment}. Lecture seule (GET)."""
        stores = self._get("/admin/datastore")
        if not isinstance(stores, list):
            raise ConnectorError("réponse sans magasins (URL de Proxmox Backup Server ? droits DatastoreAudit ?)")
        out = []
        for st in stores:
            name = st.get("store") if isinstance(st, dict) else None
            if not name:
                continue
            for g in self._get(f"/admin/datastore/{name}/groups", optional=True) or []:
                if isinstance(g, dict) and g.get("backup-id"):
                    out.append({"store": name, "type": g.get("backup-type") or "?", "id": str(g["backup-id"]),
                                "last": g.get("last-backup") if isinstance(g.get("last-backup"), int) else None,
                                "count": g.get("backup-count") if isinstance(g.get("backup-count"), int) else 0,
                                "comment": str(g.get("comment") or "")})
        return out

    def collect(self) -> dict:
        disks = []
        for u in self._get("/status/datastore-usage") or []:
            if isinstance(u, dict) and u.get("store") and u.get("total"):
                total, used = int(u["total"]), int(u.get("used") or 0)
                disks.append({"dev": u["store"], "fs": "pbs", "mount": u["store"], "size": total, "used": used, "avail": max(total - used, 0),
                              "pct": round(used * 100 / total, 1)})
        out = {"user": "API Proxmox Backup", "locs": {}, "cron_root": None, "disks": disks, "crons": [], "pbs_groups": {}}
        for g in self.groups():
            key = f"{g['store']}/{g['type']}/{g['id']}"
            out["pbs_groups"][key] = {"last_run": g["last"], "count": g["count"]}
            out["crons"].append({"src": "Proxmox Backup " + g["type"],
                                 "line": f"{g['store']} · {g['id']} : dernier {_fmt(g['last'])}, {g['count']} sauvegarde(s)"})
        return out

    def test(self) -> Result:
        n = len(self.groups())
        return Result(True, f"connecté : {n} groupe(s) de sauvegarde lus", self.version())
