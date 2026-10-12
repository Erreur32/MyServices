"""Proxmox VE et Proxmox Backup Server : machines virtuelles, conteneurs, nœuds, stockages et sauvegardes, en lecture seule, par leur API.

Jeton d'API sans mot de passe ni session (Datacenter → Permissions → API Tokens ; décocher « Privilege Separation » ou donner au jeton
lui-même le rôle PVEAuditor / Audit). Réponses : {"data": …}. Adresse : https://<hôte>:8006/api2/json (PVE), :8007 (PBS).
  PVE  Authorization: PVEAPIToken=utilisateur@royaume!nom=secret
       GET /version, GET /cluster/resources (nœuds, qemu, lxc, stockages), GET /cluster/tasks (sauvegardes vzdump récentes, facultatif)
  PBS  Authorization: PBSAPIToken=utilisateur@royaume!nom:secret   (deux-points, pas un égal)
       GET /version, GET /status/datastore-usage, GET /admin/datastore/<magasin>/snapshots
Un certificat auto-signé est la règle : « Vérifier le certificat » est décoché par défaut (comme la console). Seuls des GET sont émis.
"""
from __future__ import annotations

import time

from connectors.base import Connector, ConnectorError, Field, Result

MAX_GUESTS = 500


def _pct(used, total):
    if isinstance(used, (int, float)) and isinstance(total, (int, float)) and total > 0 and not isinstance(used, bool):
        return round(100 * used / total, 1)
    return None


def resources(res: list) -> dict:
    """Nodes, guests and storages of /cluster/resources (API or « pvesh get /cluster/resources » on the host, same rows)."""
    nodes, guests, storage = [], [], []
    for r in res:
        if not isinstance(r, dict):
            continue
        t = r.get("type")
        if t == "node":
            nodes.append({"name": r.get("node"), "online": r.get("status") == "online", "cpu_pct": _pct(r.get("cpu"), 1),
                          "mem_pct": _pct(r.get("mem"), r.get("maxmem")), "uptime": r.get("uptime"),
                          "cpus": r.get("maxcpu"), "mem": r.get("mem"), "maxmem": r.get("maxmem")})
        elif t in ("qemu", "lxc"):
            guests.append({"vmid": r.get("vmid"), "name": r.get("name"), "type": t, "node": r.get("node"),
                           "status": r.get("status"), "template": bool(r.get("template")),
                           "cpu_pct": _pct(r.get("cpu"), 1), "mem_pct": _pct(r.get("mem"), r.get("maxmem")),
                           "disk_pct": _pct(r.get("disk"), r.get("maxdisk")), "uptime": r.get("uptime"),
                           "cpus": r.get("maxcpu"), "mem": r.get("mem"), "maxmem": r.get("maxmem"), "maxdisk": r.get("maxdisk"),
                           "tags": [t for t in str(r.get("tags") or "").split(";") if t][:10]})
        elif t == "storage":
            storage.append({"name": r.get("storage"), "node": r.get("node"), "shared": bool(r.get("shared")),
                            "status": r.get("status"), "used_pct": _pct(r.get("disk"), r.get("maxdisk")),
                            "used": r.get("disk"), "total": r.get("maxdisk")})
    live = [g for g in guests if not g["template"]]
    return {"nodes": nodes, "guests": guests[:MAX_GUESTS], "storage": storage,
            "totals": {"vm": sum(1 for g in live if g["type"] == "qemu"), "lxc": sum(1 for g in live if g["type"] == "lxc"),
                       "running": sum(1 for g in live if g["status"] == "running"),
                       "stopped": sum(1 for g in live if g["status"] != "running")},
            "backups": None}


def _data(got: object):
    return got.get("data") if isinstance(got, dict) else None


class _Base(Connector):
    scheme = ""  # PVEAPIToken ou PBSAPIToken
    sep = "="    # séparateur entre l'identifiant du jeton et son secret

    def _auth(self) -> dict:
        return {"Authorization": f"{self.scheme}={self.conf['user']}{self.sep}{self.conf['secret']}"}

    def _get(self, path: str, optional: bool = False):
        try:
            got = self.ctx.http(self.conf["url"].rstrip("/") + "/api2/json" + path, headers=self._auth(),
                                verify_tls=bool(self.conf.get("verify_tls")))
        except ConnectorError as e:
            msg = str(e)
            if msg.startswith("HTTP 401"):
                raise ConnectorError("jeton refusé (utilisateur@royaume!nom et secret ?)") from None
            if optional and msg[:8] in ("HTTP 403", "HTTP 404", "HTTP 501"):
                return None
            if "CERTIFICATE_VERIFY_FAILED" in msg:
                raise ConnectorError("certificat non reconnu : décocher « Vérifier le certificat » (certificat auto-signé)") from None
            raise
        return _data(got)

    def version(self) -> str | None:
        v = self._get("/version")
        return str(v.get("version")) if isinstance(v, dict) and v.get("version") else None


class ProxmoxVE(_Base):
    type = "proxmox"
    label = "Proxmox VE"
    kinds = ("virtualization",)
    images = ()
    tested = ("8", "9")
    scheme = "PVEAPIToken"
    fields = (
        Field("url", "URL de Proxmox VE", "url", required=True, help="https://<hôte>:8006"),
        Field("user", "Identifiant du jeton", required=True, help="utilisateur@royaume!nom, ex. myservices@pve!lecture"),
        Field("secret", "Secret du jeton", "password", required=True, secret=True, help="montré une seule fois à la création"),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="décoché : certificat auto-signé (cas courant)"),
    )
    setup_fields = ("url", "user", "secret")
    guide = (
        "Dans Proxmox : Datacenter → Permissions → Users : créer un utilisateur « myservices » (royaume pve).",
        "Permissions : ajouter pour cet utilisateur, chemin « / », rôle PVEAuditor (lecture seule), « Propagate » coché.",
        "API Tokens : ajouter un jeton nommé « lecture » pour cet utilisateur ; décocher « Privilege Separation ".strip() +
        "» (ou donner PVEAuditor au jeton).",
        "Copier l'identifiant (myservices@pve!lecture) et le secret tout de suite : le secret n'est montré qu'une fois.",
    )

    def collect(self) -> dict:
        res = self._get("/cluster/resources")
        if not isinstance(res, list):
            raise ConnectorError("réponse sans ressources (URL de Proxmox ? droits PVEAuditor ?)")
        out = resources(res)
        tasks = self._get("/cluster/tasks", optional=True)
        if isinstance(tasks, list):
            dump = sorted((t for t in tasks if isinstance(t, dict) and t.get("type") == "vzdump" and t.get("endtime")),
                          key=lambda t: t["endtime"], reverse=True)
            if dump:
                out["backups"] = {"last": dump[0]["endtime"], "ok": dump[0].get("status") == "OK",
                                  "failed_recent": sum(1 for t in dump[:20] if t.get("status") != "OK")}
        return out

    def test(self) -> Result:
        try:
            v = self.version()
            d = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        t = d["totals"]
        return Result(True, f"{len(d['nodes'])} nœud(s), {t['vm']} VM, {t['lxc']} conteneur(s), {t['running']} en marche", v)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return None


class ProxmoxBackup(_Base):
    type = "proxmox-backup"
    label = "Proxmox Backup Server"
    kinds = ("virtualization",)
    tested = ("3", "4")
    scheme = "PBSAPIToken"
    sep = ":"
    fields = (
        Field("url", "URL de Proxmox Backup Server", "url", required=True, help="https://<hôte>:8007"),
        Field("user", "Identifiant du jeton", required=True, help="utilisateur@royaume!nom, ex. myservices@pbs!lecture"),
        Field("secret", "Secret du jeton", "password", required=True, secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="décoché : certificat auto-signé (cas courant)"),
    )
    setup_fields = ("url", "user", "secret")
    guide = (
        "Dans Proxmox Backup Server : Configuration → Access Control : créer l'utilisateur « myservices » et un jeton d'API « lecture ».",
        "Permissions : chemin « /datastore », rôle DatastoreAudit pour l'utilisateur et pour le jeton (lecture seule).",
        "Le secret du jeton n'est montré qu'une fois. L'identifiant a la forme myservices@pbs!lecture.",
    )

    def collect(self) -> dict:
        usage = self._get("/status/datastore-usage")
        if not isinstance(usage, list):
            raise ConnectorError("réponse sans magasins (URL de Proxmox Backup Server ? droits ?)")
        stores = []
        for u in usage:
            if not isinstance(u, dict) or not u.get("store"):
                continue
            last, groups = None, set()
            snaps = self._get(f"/admin/datastore/{u['store']}/snapshots", optional=True)
            for s in snaps if isinstance(snaps, list) else []:
                if isinstance(s, dict) and isinstance(s.get("backup-time"), int):
                    last = max(last or 0, s["backup-time"])
                    groups.add((s.get("backup-type"), s.get("backup-id")))
            stores.append({"name": u["store"], "used_pct": _pct(u.get("used"), u.get("total")), "total": u.get("total"),
                           "last_backup": last, "groups": len(groups), "age_h": round((time.time() - last) / 3600, 1) if last else None})
        return {"datastores": stores}

    def test(self) -> Result:
        try:
            v = self.version()
            d = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, f"{len(d['datastores'])} magasin(s) de sauvegardes", v)
