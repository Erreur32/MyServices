"""More hypervisors read by their API, in the shape of the Proxmox rows (nodes, guests, storage, totals) for the Virtualization tab:
Unraid (official GraphQL API, Unraid 7.2 and later) and Proxmox Datacenter Manager (every remote it manages). Read only.

Unraid's schema is documented for « info » and « array »; « vms » and « parities » are read by separate queries and skipped if the
server does not know them. Checked against fake servers only.
"""
from __future__ import annotations

from connectors.base import Connector, ConnectorError, Field, Result
from connectors.proxmox import _pct, resources as pve_resources


def _totals(guests: list[dict]) -> dict:
    live = [g for g in guests if not g.get("template")]
    return {"vm": sum(1 for g in live if g["type"] in ("vm", "qemu")), "lxc": sum(1 for g in live if g["type"] == "lxc"),
            "running": sum(1 for g in live if g["status"] == "running"), "stopped": sum(1 for g in live if g["status"] != "running")}


class Unraid(Connector):
    """Unraid: array state and capacity, disks (state, temperature), parity, VMs. API key (x-api-key) with the read-only « guest » role.
    Route: POST /graphql (queries only)."""
    type = "unraid"
    label = "Unraid"
    kinds = ("virtualization",)
    images = ()
    fields = (
        Field("url", "Adresse d'Unraid", "url", required=True, help="http://<IP> (ou https://…)"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Settings → Management Access → API Keys, rôle « guest »"),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="certificat auto-signé courant"),
    )
    setup_fields = ("url", "api_key")
    guide = ("Unraid 7.2 ou plus récent (API intégrée ; avant : greffon « Unraid Connect »). Settings → Management Access → API Keys → « Create », rôle « guest » (lecture).",
             "MyServices n'envoie que des requêtes de lecture (aucune mutation).")
    BASE = "query { info { os { hostname uptime } } array { state capacity { kilobytes { free used total } } disks { name size status temp } } }"

    def _q(self, query: str, optional: bool = False):
        try:
            d = self.ctx.http(str(self.conf.get("url", "")).rstrip("/") + "/graphql", method="POST", body={"query": query},
                              headers={"x-api-key": str(self.conf.get("api_key", ""))}, verify_tls=self.conf.get("verify_tls") is True)
        except ConnectorError as e:
            if str(e).startswith(("HTTP 401", "HTTP 403")):
                raise ConnectorError("accès refusé : clé d'API d'Unraid à vérifier") from None
            if optional:
                return None
            raise
        if not isinstance(d, dict) or (d.get("errors") and not d.get("data")):
            if optional:
                return None
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à l'API d'Unraid (version 7.2 ou greffon Unraid Connect ?)")
        return d.get("data") or {}

    def collect(self) -> dict:
        d = self._q(self.BASE)
        info, arr = d.get("info") or {}, d.get("array") or {}
        host = ((info.get("os") or {}).get("hostname")) or "unraid"
        kb = ((arr.get("capacity") or {}).get("kilobytes")) or {}
        used, total = (int(float(kb[k])) * 1024 if str(kb.get(k, "")).replace(".", "").isdigit() else None for k in ("used", "total"))
        storage = [{"name": "array", "node": host, "shared": False, "status": str(arr.get("state") or "?").lower(),
                    "used": used, "total": total, "used_pct": _pct(used, total)}]
        disks = [x for x in arr.get("disks") or [] if isinstance(x, dict)]
        parities = (((self._q("query { array { parities { name status } } }", optional=True) or {}).get("array") or {}).get("parities")) or []
        bad = [x for x in disks + [p for p in parities if isinstance(p, dict)] if str(x.get("status") or "").upper() not in ("DISK_OK", "DISK_NP", "")]
        hot = [x for x in disks if isinstance(x.get("temp"), (int, float)) and x["temp"] >= 50]
        vms = (((self._q("query { vms { domains { uuid name state } } }", optional=True) or {}).get("vms") or {}).get("domains")) or []
        guests = [{"vmid": v.get("uuid") or v.get("name"), "name": v.get("name"), "type": "vm", "node": host,
                   "status": "running" if str(v.get("state") or "").upper() == "RUNNING" else "stopped", "template": False, "tags": []}
                  for v in vms if isinstance(v, dict)]
        problems = [f"disque {x.get('name', '?')} : {x.get('status')}" for x in bad] + [f"disque {x.get('name', '?')} à {x['temp']} °C" for x in hot]
        if str(arr.get("state") or "STARTED").upper() != "STARTED":
            problems.insert(0, f"grappe (array) : {arr.get('state')}")
        uptime = (info.get("os") or {}).get("uptime")
        return {"nodes": [{"name": host, "online": True, "uptime": uptime if isinstance(uptime, int) else None,
                           "model": f"{len(disks)} disque(s), {len(parities)} parité(s)"}],
                "guests": guests, "storage": storage, "totals": _totals(guests), "backups": None, "problems": problems}

    def version(self) -> str | None:
        d = self._q("query { info { versions { core { unraid } } } }", optional=True) or {}
        return (((d.get("info") or {}).get("versions") or {}).get("core") or {}).get("unraid")

    def test(self) -> Result:
        try:
            v, d = self.version(), self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, f"{d['totals']['vm']} VM · grappe {d['storage'][0]['status']}" + (f" · {len(d['problems'])} point(s) à regarder" if d["problems"] else ""), v)


class ProxmoxDatacenter(Connector):
    """Proxmox Datacenter Manager: nodes, guests and storages of every remote (Proxmox VE) it manages, in one place.
    API token (Authorization: PDMAPIToken user@realm!name:secret). Routes (GET): /api2/json/version, /api2/json/resources/list."""
    type = "pdm"
    label = "Proxmox Datacenter Manager"
    kinds = ("virtualization",)
    images = ()
    fields = (
        Field("url", "Adresse de Datacenter Manager", "url", required=True, help="https://<IP>:8443"),
        Field("user", "Identifiant du jeton", required=True, help="utilisateur@royaume!nom, ex. myservices@pdm!lecture"),
        Field("secret", "Secret du jeton", "password", required=True, secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="décoché : certificat auto-signé (cas courant)"),
    )
    setup_fields = ("url", "user", "secret")
    guide = ("Dans Proxmox Datacenter Manager : Configuration → Access Control → un utilisateur « myservices » avec le rôle « Auditor » sur « / », puis un jeton d'API.",
             "MyServices ne fait que des GET (version, ressources de chaque serveur distant).")

    def _get(self, path: str):
        h = {"Authorization": f"PDMAPIToken {self.conf.get('user', '')}:{self.conf.get('secret', '')}"}
        try:
            d = self.ctx.http(str(self.conf.get("url", "")).rstrip("/") + "/api2/json" + path, headers=h, verify_tls=self.conf.get("verify_tls") is True)
        except ConnectorError as e:
            if str(e).startswith(("HTTP 401", "HTTP 403")):
                raise ConnectorError("accès refusé : jeton de Datacenter Manager à vérifier (rôle Auditor)") from None
            raise
        return d.get("data") if isinstance(d, dict) else None

    def version(self) -> str | None:
        v = self._get("/version")
        return v.get("version") if isinstance(v, dict) else None

    def collect(self) -> dict:
        remotes = self._get("/resources/list")
        if not isinstance(remotes, list):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Proxmox Datacenter Manager")
        flat, problems = [], []
        for rem in remotes:
            if not isinstance(rem, dict):
                continue
            if rem.get("error"):
                problems.append(f"serveur « {rem.get('remote', '?')} » : {str(rem['error'])[:120]}")
            for r in rem.get("resources") or []:
                if not isinstance(r, dict):
                    continue
                r = dict(r)
                if r.get("type") == "node":
                    r.setdefault("node", r.get("name") or r.get("node"))
                if r.get("type") == "storage":
                    r.setdefault("storage", r.get("name") or r.get("storage"))
                flat.append(r)
        out = pve_resources(flat)
        out["problems"] = problems
        return out

    def test(self) -> Result:
        try:
            v, d = self.version(), self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        t = d["totals"]
        return Result(True, f"{len(d['nodes'])} nœud(s), {t['vm']} VM, {t['lxc']} conteneur(s), {t['running']} en marche", v)
