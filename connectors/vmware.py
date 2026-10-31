"""VMware vCenter Server: ESXi hosts, VMs and datastores, read only, by its REST API (vSphere Automation API).

Account: a vCenter user with the « Read-only » role on the vCenter object (propagated), e.g. myservices@vsphere.local.
  vCenter 7.0 U2 and later   POST /api/session (Basic) -> "token" ; then header vmware-api-session-id
  vCenter 6.7 / 7.0          POST /rest/com/vmware/cis/session -> {"value": token} ; same header, answers wrapped in {"value": …}
Routes read (GET):
  /api/vcenter/host                          hosts: name, connection_state, power_state
  /api/vcenter/vm?hosts=<host>               VMs of each host: name, power_state, cpu_count, memory_size_MiB
  /api/vcenter/datastore                     datastores: name, type, capacity, free_space
  /api/vcenter/vm/<vm>/guest/identity        IP and hostname given by VMware Tools (powered-on VMs only ; 503 without Tools)
  /api/appliance/system/version              version (optional: may need more rights)
The session is closed at the end (DELETE). Nothing else is ever written. A self-signed certificate is the rule: not verified by default.
"""
from __future__ import annotations

import base64
import urllib.parse

from connectors.base import Connector, ConnectorError, Field, Result

REST_PREFIX = "/rest"

MAX_VMS = 500
MAX_IDENTITY = 200   # guest identity is one call per VM: the first ones only on a very big vCenter


def _pct(used, total):
    return round(100 * used / total, 1) if isinstance(used, (int, float)) and isinstance(total, (int, float)) and total > 0 else None


class VCenter(Connector):
    type = "vcenter"
    label = "VMware vCenter"
    kinds = ("virtualization",)
    images = ()
    tested = ("7", "8")
    fields = (
        Field("url", "URL de vCenter", "url", required=True, help="https://<vcenter>"),
        Field("user", "Compte en lecture seule", required=True, help="rôle « Read-only », ex. myservices@vsphere.local"),
        Field("password", "Mot de passe du compte", "password", required=True, secret=True, help="chiffré dans config.json, jamais renvoyé à la page"),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="décoché : certificat auto-signé (cas courant)"),
    )
    setup_fields = ("url", "user", "password")
    guide = (
        "Dans vCenter : Administration → Single Sign On → Users and Groups : créer l'utilisateur « myservices » (domaine vsphere.local).",
        "Administration → Access Control → Global Permissions (ou l'objet vCenter) : ajouter cet utilisateur avec le rôle « Read-only », « Propagate to children » coché.",
        "MyServices ne fait que lire : liste des hôtes, des VM et des datastores. Aucune action sur les VM.",
    )

    def _base(self) -> str:
        return self.conf["url"].rstrip("/")

    def _call(self, path: str, method: str = "GET", headers: dict | None = None):
        return self.ctx.http(self._base() + path, method=method, headers=headers, verify_tls=bool(self.conf.get("verify_tls")))

    def _login(self) -> tuple[str, str]:
        """(session token, API prefix: « /api » or « /rest » for vCenter 6.7 / 7.0 before U2)."""
        basic = "Basic " + base64.b64encode(f"{self.conf['user']}:{self.conf['password']}".encode()).decode()
        for prefix, path in (("/api", "/api/session"), (REST_PREFIX, "/rest/com/vmware/cis/session")):
            try:
                got = self._call(path, "POST", {"Authorization": basic})
            except ConnectorError as e:
                msg = str(e)
                if msg.startswith("HTTP 401"):
                    raise ConnectorError("compte refusé (utilisateur@domaine et mot de passe ?)") from None
                if msg[:8] == "HTTP 404" and prefix == "/api":
                    continue   # older vCenter: the /rest route
                if "CERTIFICATE_VERIFY_FAILED" in msg:
                    raise ConnectorError("certificat non reconnu : décocher « Vérifier le certificat » (certificat auto-signé)") from None
                raise
            token = got.get("value") if isinstance(got, dict) else got
            if isinstance(token, str) and token:
                return token, prefix
            raise ConnectorError("réponse sans jeton de session (URL de vCenter ?)")
        raise ConnectorError("API REST introuvable (vCenter 6.7 ou plus récent ?)")

    def _get(self, token: str, prefix: str, path: str, optional: bool = False):
        rest = path
        if prefix == REST_PREFIX:   # old API: filters spelled filter.hosts, answers wrapped in {"value": …}
            rest = rest.replace("?hosts=", "?filter.hosts=")
        try:
            got = self._call(prefix + rest, headers={"vmware-api-session-id": token})
        except ConnectorError as e:
            if optional:
                return None
            if str(e).startswith("HTTP 403"):
                raise ConnectorError("droits insuffisants : donner le rôle « Read-only » au compte, propagé") from None
            raise
        return got.get("value") if prefix == REST_PREFIX and isinstance(got, dict) and "value" in got else got

    def collect(self) -> dict:
        token, prefix = self._login()
        try:
            hosts = self._get(token, prefix, "/vcenter/host")
            if not isinstance(hosts, list):
                raise ConnectorError("réponse sans hôtes (URL de vCenter ?)")
            nodes, guests = [], []
            for h in hosts:
                if not isinstance(h, dict) or not h.get("host"):
                    continue
                nodes.append({"name": h.get("name"), "online": h.get("connection_state") == "CONNECTED" and h.get("power_state", "POWERED_ON") == "POWERED_ON",
                              "cpu_pct": None, "mem_pct": None, "uptime": None, "id": h["host"]})
                vms = self._get(token, prefix, "/vcenter/vm?hosts=" + urllib.parse.quote(h["host"]), optional=True) or []
                for v in vms if isinstance(vms, list) else []:
                    if isinstance(v, dict) and v.get("vm") and len(guests) < MAX_VMS:
                        on = v.get("power_state") == "POWERED_ON"
                        mib = v.get("memory_size_MiB")
                        guests.append({"vmid": v["vm"], "name": v.get("name"), "type": "vm", "node": h.get("name"), "status": "running" if on else "stopped",
                                       "template": False, "cpu_pct": None, "mem_pct": None, "uptime": None, "cpus": v.get("cpu_count"),
                                       "maxmem": mib * 2**20 if isinstance(mib, int) else None, "tags": []})
            for g in [g for g in guests if g["status"] == "running"][:MAX_IDENTITY]:
                ident = self._get(token, prefix, f"/vcenter/vm/{urllib.parse.quote(str(g['vmid']))}/guest/identity", optional=True)
                if isinstance(ident, dict):
                    g["ip"], g["hostname"] = ident.get("ip_address"), ident.get("host_name")
                    g["os"] = (ident.get("full_name") or {}).get("default_message") if isinstance(ident.get("full_name"), dict) else None
            stores = self._get(token, prefix, "/vcenter/datastore", optional=True) or []
            storage = []
            for d in stores if isinstance(stores, list) else []:
                if isinstance(d, dict) and d.get("name"):
                    cap, free = d.get("capacity"), d.get("free_space")
                    used = cap - free if isinstance(cap, int) and isinstance(free, int) else None
                    storage.append({"name": d["name"], "node": None, "type": d.get("type"), "shared": d.get("type") in ("NFS", "NFS41", "VSAN", "VVOL"),
                                    "status": "available", "used": used, "total": cap, "used_pct": _pct(used, cap)})
        finally:
            self._logout(token, prefix)
        return {"nodes": nodes, "guests": guests, "storage": storage, "backups": None,
                "totals": {"vm": len(guests), "lxc": 0, "running": sum(1 for g in guests if g["status"] == "running"),
                           "stopped": sum(1 for g in guests if g["status"] != "running")}}

    def version(self) -> str | None:
        """Called before collect() by the runner: its own short session (the version route may need more than Read-only: then None)."""
        if getattr(self, "found_version", None):
            return self.found_version
        token, prefix = self._login()
        try:
            ver = self._get(token, prefix, "/appliance/system/version", optional=True)
        finally:
            self._logout(token, prefix)
        self.found_version = ver.get("version") if isinstance(ver, dict) else None
        return self.found_version

    def _logout(self, token: str, prefix: str) -> None:
        try:
            self._call(prefix + ("/session" if prefix == "/api" else "/com/vmware/cis/session"), "DELETE", {"vmware-api-session-id": token})
        except ConnectorError:
            pass   # the session expires by itself

    def test(self) -> Result:
        try:
            d = self.collect()
            v = self.version()
        except ConnectorError as e:
            return Result(False, str(e))
        t = d["totals"]
        return Result(True, f"{len(d['nodes'])} hôte(s) ESXi, {t['vm']} VM, {t['running']} en marche, {len(d['storage'])} datastore(s)", v)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return None
