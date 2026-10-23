"""Sauvegardes lues par API, en lecture seule : Veeam Backup & Replication, Proxmox Backup Server, Synology Hyper Backup et Home Assistant.

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
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from connectors.base import Connector, ConnectorError, Field, Result
from connectors.status_kit import num, rows
from connectors.ha_mcp import HaMcp
from connectors.homelab_infra import Synology
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


VEEAM_HISTORY = 10   # runs kept per job: failures among the recent ones, observed rhythm
VEEAM_DETAILS_TTL = 1800   # job contents, backups and restore point counts: read again every 30 min at most
VEEAM_NO_ID = "-".join("0" * n for n in (8, 4, 4, 4, 12))   # Veeam's empty id (all zeros): an imported backup has no job
_UNITS = {"B": 0, "KB": 1, "MB": 2, "GB": 3, "TB": 4, "PB": 5}


def veeam_size(v) -> int | None:
    """Bytes of a size Veeam writes as text in the server's language: « 129,7 GB », « 120 GB », « 1.5 TB », « 1 024,5 MB »."""
    m = re.fullmatch(r"([\d\s\u00a0\u202f.,]+?)\s*([KMGTP]?B)", str(v or "").strip(), re.I)
    if not m:
        return None
    n = re.sub(r"[\s\u00a0\u202f]", "", m.group(1))
    if "," in n and "." in n:   # both: the last one is the decimal mark
        n = n.replace(".", "").replace(",", ".") if n.rfind(",") > n.rfind(".") else n.replace(",", "")
    try:
        return int(float(n.replace(",", ".")) * 1024 ** _UNITS[m.group(2).upper()])
    except ValueError:
        return None


def _newest(dates: list[str]) -> str | None:
    """The latest of ISO dates as Veeam writes them (offsets may differ), or None."""
    return max(dates, key=lambda d: datetime.fromisoformat(d.replace("Z", "+00:00"))) if dates else None


def veeam_objects(job_conf: dict | None, points: dict, backup_objects: list | None = None) -> list[dict]:
    """What a job backs up: [{"name", "host", "type", "size", "points"}]. VMs come from the job's settings (name, host they run on, size);
    a job without VMs there (a physical computer) gives the objects of its backup. « points »: restore points kept, when the backup is known."""
    out = []
    for inc in ((job_conf or {}).get("virtualMachines") or {}).get("includes") or []:
        io = inc.get("inventoryObject") or {}
        if io.get("name"):
            out.append({"name": io["name"], "host": io.get("hostName") or "", "type": io.get("type") or "", "size": veeam_size(inc.get("size"))})
    if not out:
        out = [{"name": o["name"], "host": "", "type": o.get("type") or "", "size": None} for o in backup_objects or [] if o.get("name")]
    for o in out:
        o["points"] = points.get(o["name"])
    return out


def veeam_history(job: dict, sessions: list, ts) -> list[dict]:
    """The job's last runs, newest first: [{"start", "end", "result"}]. A session belongs to the job by its jobId, or by its name
    (the session name is the job name) when the version gives no id."""
    mine = [x for x in sessions if (x.get("jobId") and x.get("jobId") == job.get("id")) or (not x.get("jobId") and x.get("name") == job.get("name"))]
    runs = [{"start": ts(x.get("creationTime")), "end": ts(x.get("endTime")), "result": (x.get("result") or {}).get("result") or "None"}
            for x in mine]
    return sorted((r for r in runs if r["start"]), key=lambda r: -r["start"])[:VEEAM_HISTORY]


def veeam_parse(jobs: list, repos: list, sessions: list | None = None) -> dict:
    """Réponses de l'API Veeam -> forme commune (disques = dépôts, crons = jobs, veeam_jobs par nom, avec ses derniers passages)."""
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
        hist = veeam_history(j, sessions or [], ts)
        last, nxt = ts(j.get("lastRun")) or (hist[0]["start"] if hist else None), ts(j.get("nextRun"))
        res = j.get("lastResult") or (hist[0]["result"] if hist else "None")   # a backup without job: its last session, when there is one
        out["veeam_jobs"][j.get("name", "?")] = {"last_run": last, "result": res, "status": j.get("status"), "next": nxt,
                                                 "repository": j.get("repositoryName"), "history": hist, "objects": j.get("objects") or []}
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
        ctx = ssl._create_unverified_context()  # NOSONAR S5527 ; certificat auto-signé de Veeam (LAN), comme la console
        with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
            return json.load(r)

    def _credentials(self) -> tuple[str, str]:
        if self.conf.get("user") and self.conf.get("password"):
            return self.conf["user"], self.conf["password"]
        env = read_secrets(self.conf["secrets"])
        if not env.get("VEEAM_USER") or not env.get("VEEAM_PASS"):
            raise ConnectorError(f"VEEAM_USER / VEEAM_PASS absents de {self.conf['secrets']}")
        return env["VEEAM_USER"], env["VEEAM_PASS"]

    def fetch(self) -> tuple[list, list, list]:
        """(jobs, dépôts, sessions) bruts de l'API : lecture seule (un jeton d'accès, puis trois GET)."""
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
        try:  # last runs of every job (history, rhythm): optional too
            sessions = self._call(f"/api/v1/sessions?limit={VEEAM_HISTORY * max(len(jobs), 1) * 3}&orderColumn=CreationTime&orderAsc=false",
                                  token=token).get("data", [])
        except (OSError, ValueError):
            sessions = []
        known = {j.get("id") for j in jobs if j.get("id")}
        det = self.ctx.cached(f"veeam-details-{self.conf['url']}", VEEAM_DETAILS_TTL, lambda: self._details(token, known))
        repo_names = {r.get("id"): r.get("name") for r in repos if r.get("id")}
        for j in jobs:
            j["objects"] = det["objects"].get(j.get("id")) or []
        for o in det["orphans"]:   # a backup whose job is not in jobs/states (Veeam 12.0: computers backed up by Veeam Agent)
            if o["name"] not in {j.get("name") for j in jobs}:
                jobs.append({**o, "repositoryName": repo_names.get(o.get("repositoryId"))})
        return jobs, repos, sessions

    def _data(self, path: str, token: str) -> list:
        """data of a GET, or [] when the version or the role does not give it (each detail is optional)."""
        try:
            return self._call(path, token=token).get("data") or []
        except (OSError, ValueError):
            return []

    def _last_point(self, token: str, backup_id: str, objects: list) -> str | None:
        """Date of the newest restore point of a backup: by the backup, else by each of its objects (the route differs between versions)."""
        q = "orderColumn=CreationTime&orderAsc=false&limit=1"
        got = self._data(f"/api/v1/objectRestorePoints?backupIdFilter={backup_id}&{q}", token)
        if not got:
            got = [p for o in objects if o.get("id") for p in self._data(f"/api/v1/backupObjects/{o['id']}/restorePoints?{q}", token)]
        return _newest([p["creationTime"] for p in got if p.get("creationTime")])

    def _details(self, token: str, known: set) -> dict:
        """What each job backs up (by job id) and the backups no job of jobs/states owns. One GET for the jobs' settings, one for the backups,
        one per backup for its objects (restore point counts) and, for a backup without a known job, one or two for its newest restore point."""
        conf = {j.get("id"): j for j in self._data("/api/v1/jobs?limit=500", token)}
        per_job: dict[str, dict] = {}
        for b in self._data("/api/v1/backups?limit=500", token):
            jid = b.get("jobId")
            if b.get("id") and jid and jid != VEEAM_NO_ID:
                per_job.setdefault(jid, []).append({**b, "objects": self._data(f"/api/v1/backups/{b['id']}/objects", token)})
        objects, orphans = {}, []
        for jid in set(conf) | set(per_job) | known:
            bks = per_job.get(jid, [])
            objs = [o for b in bks for o in b["objects"]]
            points = {}
            for o in objs:
                if o.get("name") and o.get("restorePointsCount") is not None:
                    points[o["name"]] = points.get(o["name"], 0) + o["restorePointsCount"]
            objects[jid] = veeam_objects(conf.get(jid), points, objs)
            if jid not in known and jid not in conf and bks:
                orphans.append({"id": jid, "name": bks[0].get("name") or jid, "type": bks[0].get("platformName") or "", "status": None,
                                "lastRun": _newest([d for b in bks if (d := self._last_point(token, b["id"], b["objects"]))]),
                                "repositoryId": bks[0].get("repositoryId"), "objects": objects[jid]})
        return {"objects": objects, "orphans": orphans}

    def collect(self) -> dict:
        return veeam_parse(*self.fetch())

    def test(self) -> Result:
        jobs, repos, _ = self.fetch()
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
        ha_backup = {"last_ok": ok, "last_attempt": tried, "next": nxt}
        if str(self.conf.get("mcp_url") or "").strip():   # mode avancé (module ha-mcp) : la liste réelle des sauvegardes, avec leurs copies ailleurs
            try:
                ha_backup["list"] = HaMcp(self.conf["mcp_url"], 30).get("backups")
            except ConnectorError as e:
                ha_backup["mcp_error"] = str(e)
        return {"user": "API REST", "locs": {}, "cron_root": None,
                "disks": [{"dev": "HAOS", "fs": "ext4", "mount": "/ (HAOS)", "size": int(total * gb), "used": int(used * gb),
                           "avail": int(free * gb), "pct": round(used * 100 / total, 1) if total else 0}] if total else [],
                "crons": [{"src": "gestionnaire de sauvegardes HA",
                           "line": f"auto : dernière réussie {_fmt(ok)}, dernier essai {_fmt(tried)}, prochaine {_fmt(nxt)} "
                                   f"(état {val('sensor.backup_backup_manager_state')})"}],
                "ha_backup": ha_backup}


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


DSM_FAIL = ("fail", "error", "partial", "interrupt", "cancel", "abort", "timeout")   # words of a failed last run (last_bkp_result), checked in lower case
DSM_TIME_FORMATS = ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S")


def dsm_time(v) -> int | None:
    """A Hyper Backup time (« 2026/10/17 03:00 » in the NAS's local time, or an epoch, or empty / « - » when never run) as an epoch."""
    if isinstance(v, (int, float)) and v > 0:
        return int(v)
    text = str(v or "").strip()
    if not text or text in ("-", "none", "0"):
        return None
    if text.isdigit():
        return int(text)
    for fmt in DSM_TIME_FORMATS:
        try:
            return int(datetime.strptime(text, fmt).timestamp())
        except ValueError:
            continue
    return None


class SynologyBackups(Synology):
    """Hyper Backup tasks of a Synology DSM: the last run of each task (date, result, next run). Same account as the « synology » connector
    (read-only user); the volumes give the disks. Shape returned: backups.py (synology_tasks, disks). Routes from DSM's web API, to confirm against a real NAS."""
    type = "synology-backups"
    BASE_ADDITIONAL = '["last_bkp_time","last_bkp_result"]'
    WIDE_ADDITIONAL = '["last_bkp_time","last_bkp_result","next_bkp_time","target_type"]'

    def tasks(self, sid: str) -> list[dict]:
        """Hyper Backup tasks : {name, id, last_run (epoch), result, next (epoch), state, target_type}. Empty list when the package is missing."""
        data = None
        for extra in (self.WIDE_ADDITIONAL, self.BASE_ADDITIONAL):   # an older DSM refuses the extra fields: ask again with the two known ones
            data = self._call(sid, "SYNO.Backup.Task", "list", 1, {"additional": extra})
            if data is not None:
                break
        out, seen = [], set()
        for t in rows((data or {}).get("task_list")):
            add = t.get("additional") if isinstance(t.get("additional"), dict) else {}
            get = lambda k: t.get(k) if t.get(k) not in (None, "") else add.get(k)   # noqa: E731
            name = str(t.get("name") or t.get("task_id") or "?")
            if name in seen:
                name = f"{name} #{t.get('task_id')}"
            seen.add(name)
            out.append({"name": name, "id": t.get("task_id"), "last_run": dsm_time(get("last_bkp_time")), "result": str(get("last_bkp_result") or "none"),
                        "next": dsm_time(get("next_bkp_time")), "state": str(t.get("state") or ""), "target_type": str(get("target_type") or "")})
        return out

    def snapshot(self) -> tuple[list[dict], list[dict]]:
        """(tasks, volumes) in one session, closed at the end."""
        sid = self.login()
        try:
            vols = rows((self._call(sid, "SYNO.Storage.CGI.Storage", "load_info") or {}).get("volumes"))
            return self.tasks(sid), vols
        finally:
            self.logout(sid)

    def collect(self) -> dict:
        tasks, vols = self.snapshot()
        disks = []
        for v in vols:
            sz = v.get("size") or {}
            total, used = num(sz.get("total")), num(sz.get("used"))
            if total:
                disks.append({"dev": str(v.get("id") or v.get("vol_path") or "volume"), "fs": "synology", "mount": str(v.get("vol_path") or v.get("id") or "volume"),
                              "size": int(total), "used": int(used or 0), "avail": max(int(total) - int(used or 0), 0), "pct": round((used or 0) * 100 / total, 1)})
        out = {"user": "API Synology DSM", "locs": {}, "cron_root": None, "disks": disks, "crons": [], "synology_tasks": {}}
        for t in tasks:
            out["synology_tasks"][t["name"]] = {k: t[k] for k in ("last_run", "result", "next", "state", "target_type")}
            out["crons"].append({"src": "Hyper Backup", "line": f"{t['name']} : dernier {_fmt(t['last_run'])} ({t['result']}), prochain {_fmt(t['next'])}"})
        return out

    def test(self) -> Result:
        tasks, _ = self.snapshot()
        return Result(True, f"connecté : {len(tasks)} tâche(s) Hyper Backup lue(s)")
